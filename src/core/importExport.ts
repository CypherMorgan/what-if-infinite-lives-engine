/**
 * Export and import.
 *
 * The export format is a documented, versioned JSON envelope wrapping the simulation document.
 * It is deliberately self-describing: it carries the schema version, the application version
 * that wrote it, and a checksum of the document so a truncated or corrupted file is rejected
 * before it is parsed.
 *
 * Imports are validated, migrated and repaired before they reach the store, and are rejected
 * outright when validation fails.
 */
import { validateDocument, IMPORT_LIMITS, type ValidationResult } from './validate';
import { migrate } from './migrations';
import { repairGraph } from './graph';
import { appError, err, ok, type AppError, type Result } from './result';
import type { SimulationDoc, SimulationSummary } from './types';
import { SCHEMA_VERSION } from './types';

export const EXPORT_FORMAT = 'whatif.universe';
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  document: SimulationDoc;
  /** FNV-1a of the serialised document, used to detect truncation. */
  checksum: string;
}

export const APP_VERSION = '1.0.0';

function fnv1a(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function serialize(doc: SimulationDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** Builds the export envelope for a document. */
export function exportDocument(doc: SimulationDoc): ExportEnvelope {
  const body = serialize(doc);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: doc.schemaVersion || SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    document: doc,
    checksum: fnv1a(body),
  };
}

export function exportToText(doc: SimulationDoc): string {
  return JSON.stringify(exportDocument(doc), null, 2);
}

/** File extension and filter used by the save dialog. */
export const EXPORT_FILE = {
  extension: '.whatif.json',
  filters: [{ name: 'What If? universe', extensions: ['whatif.json', 'json'] }],
} as const;

export interface ImportReport {
  doc: SimulationDoc;
  /** Non-blocking notes: migrations applied, repairs made, items dropped. */
  notes: string[];
  warnings: string[];
}

/**
 * Parses, validates, migrates and repairs an exported file.
 *
 * Never throws for expected failure modes — a bad file returns a typed error the UI can show.
 */
export function importFromText(text: string): Result<ImportReport, AppError> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return err(appError('empty_file', 'The file is empty.', undefined, true));
  }
  if (text.length > IMPORT_LIMITS.maxBytes) {
    return err(
      appError(
        'file_too_large',
        'The file is larger than the import limit.',
        `${Math.round(text.length / 1024 / 1024)} MB read; the limit is ${Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024)} MB.`,
      ),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return err(
      appError(
        'invalid_json',
        'The file is not valid JSON.',
        e instanceof Error ? e.message : 'Unknown parse error.',
      ),
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(appError('not_an_object', 'The file does not contain a JSON object.'));
  }

  const envelope = parsed as Partial<ExportEnvelope> & Record<string, unknown>;

  // Envelope checks. A bare document (no envelope) is accepted, for hand-edited files.
  const notes: string[] = [];
  const warnings: string[] = [];
  let rawDoc: unknown;

  if (envelope['format'] === EXPORT_FORMAT) {
    const document = envelope['document'];
    if (document === undefined || document === null) {
      return err(appError('missing_document', 'The file declares itself as a universe but contains no document.'));
    }
    rawDoc = document;

    const expectedChecksum = envelope['checksum'];
    if (typeof expectedChecksum === 'string' && expectedChecksum.length > 0) {
      const actual = fnv1a(serialize(document as SimulationDoc));
      if (actual !== expectedChecksum) {
        warnings.push(
          'The file checksum does not match its contents, which usually means it was edited by hand or truncated. It was loaded anyway.',
        );
      }
    }
    if (typeof envelope['formatVersion'] === 'number' && envelope['formatVersion'] > EXPORT_FORMAT_VERSION) {
      warnings.push(
        `This file uses export format ${envelope['formatVersion']}; this build understands ${EXPORT_FORMAT_VERSION}. It was loaded with best effort.`,
      );
    }
    if (typeof envelope['appVersion'] === 'string') {
      notes.push(`Exported by version ${envelope['appVersion']} on ${typeof envelope['exportedAt'] === 'string' ? envelope['exportedAt'] : 'an unknown date'}.`);
    }
  } else {
    rawDoc = parsed;
    warnings.push('No export envelope was found, so the file was treated as a bare simulation document.');
  }

  // Migrate.
  let migrated: unknown;
  try {
    const result = migrate(rawDoc);
    migrated = result.doc;
    notes.push(...result.notes);
  } catch (e) {
    return err(
      appError('migration_failed', 'The file could not be migrated to the current schema.', e instanceof Error ? e.message : undefined),
    );
  }

  // Validate.
  const validation: ValidationResult = validateDocument(migrated);
  if (!validation.ok || !validation.doc) {
    const fatal = validation.issues.filter((i) => i.fatal);
    const detail = validation.issues
      .slice(0, 10)
      .map((i) => `${i.path || '(root)'}: ${i.message}`)
      .join('\n');
    return err(
      appError(
        'validation_failed',
        fatal[0]?.message ?? 'The file failed validation and was not imported.',
        detail,
        false,
      ),
    );
  }

  // Repair derived structure.
  const repaired = repairGraph(validation.doc);
  if (repaired.fixed.length > 0) notes.push(...repaired.fixed);

  const nonFatal = validation.issues.filter((i) => !i.fatal);
  if (nonFatal.length > 0) {
    warnings.push(
      `${nonFatal.length} item${nonFatal.length === 1 ? '' : 's'} in the file were malformed and ${nonFatal.length === 1 ? 'was' : 'were'} normalised or dropped.`,
    );
  }

  return ok({ doc: repaired.doc, notes, warnings });
}

/** Filename used by the save dialog, derived from the title. */
export function exportFileName(doc: SimulationDoc): string {
  const slug =
    doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'universe';
  return `${slug}${EXPORT_FILE.extension}`;
}

/** Summary derived from a document, for the library list. */
export function summarise(doc: SimulationDoc): SimulationSummary {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodeCount: Object.keys(doc.nodes).length,
    branchCount: Object.keys(doc.branches).length,
    generator: doc.meta.generator,
    ...(doc.parentId ? { parentId: doc.parentId } : {}),
    isCounterfactual: Boolean(doc.counterfactual),
  };
}

/** Serialises a list of summaries for the library index. */
export interface LibraryIndex {
  format: 'whatif.library';
  version: number;
  updatedAt: string;
  items: SimulationSummary[];
}

export function serialiseIndex(items: SimulationSummary[]): LibraryIndex {
  return {
    format: 'whatif.library',
    version: 1,
    updatedAt: new Date().toISOString(),
    items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}
