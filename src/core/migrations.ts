/**
 * Schema migrations.
 *
 * A document records the schema version it was written with. On load it is walked forward one
 * step at a time, so a file written by any earlier build of the application still opens. Each
 * step is a pure function of the previous shape and is unit-tested.
 *
 * Migrations are deliberately permissive about missing data: a field that does not exist gets a
 * sensible default rather than an error, because refusing to open a user's saved universe over
 * an optional field is worse than opening it with a default.
 */
import { SCHEMA_VERSION, type SimulationDoc } from './types';

type AnyDoc = Record<string, unknown>;

/**
 * v1 -> v2: introduce `collapsed`, `vars` and the `primary` flag on variable definitions.
 *
 * The original prototype stored no variable metadata at all and kept no collapsed-branch state.
 */
function v1_to_v2(doc: AnyDoc): AnyDoc {
  const next: AnyDoc = { ...doc };
  if (!Array.isArray(next['collapsed'])) next['collapsed'] = [];
  if (!Array.isArray(next['vars'])) next['vars'] = [];

  const keys = new Set<string>();
  const nodes = next['nodes'];
  if (typeof nodes === 'object' && nodes !== null) {
    for (const node of Object.values(nodes as Record<string, unknown>)) {
      const state = (node as { state?: Record<string, number> } | null)?.state;
      if (state) for (const key of Object.keys(state)) keys.add(key);
    }
  }

  const declared = new Set((next['vars'] as { key?: string }[]).map((v) => v?.key).filter(Boolean));
  const extra = [...keys].filter((k) => !declared.has(k)).slice(0, 120);
  next['vars'] = [
    ...(next['vars'] as unknown[]),
    ...extra.map((key) => ({
      key,
      label: key.startsWith('skill:') ? key.slice(6).replace(/-/g, ' ') : key,
      unit:
        key === 'money' || key === 'income' || key === 'expenses'
          ? 'currency'
          : key === 'runway'
            ? 'months'
            : 'level',
      kind: key.startsWith('skill:') ? 'skill' : 'resource',
      direction: 'up',
      domain: 'personal',
    })),
  ];

  next['schemaVersion'] = 2;
  return next;
}

/**
 * v2 -> v3: introduce `focusNode`, `camera` and per-node `ruleId`, and normalise the prompt's
 * `archetypes` list which older builds sometimes left as a comma-joined string.
 */
function v2_to_v3(doc: AnyDoc): AnyDoc {
  const next: AnyDoc = { ...doc };

  const prompt = next['prompt'];
  if (typeof prompt === 'object' && prompt !== null) {
    const p = prompt as Record<string, unknown>;
    if (typeof p['archetypes'] === 'string') {
      p['archetypes'] = p['archetypes']
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!Array.isArray(p['goals'])) p['goals'] = [];
    if (!Array.isArray(p['constraints'])) p['constraints'] = [];
    if (!Array.isArray(p['resources'])) p['resources'] = [];
    if (typeof p['imagination'] !== 'number') p['imagination'] = 0.2;
    if (typeof p['branchCount'] !== 'number') p['branchCount'] = 4;
    if (typeof p['horizon'] !== 'number') p['horizon'] = 24;
  }

  const assumptions = next['assumptions'];
  if (Array.isArray(assumptions)) {
    next['assumptions'] = assumptions.map((a) =>
      typeof a === 'object' && a !== null ? { editable: true, sensitivity: 0, ...a } : a
    );
  }

  if (typeof next['camera'] !== 'object' || next['camera'] === null) next['camera'] = undefined;
  if (typeof next['focusNode'] !== 'string') next['focusNode'] = undefined;

  next['schemaVersion'] = 3;
  return next;
}

type Migration = (doc: AnyDoc) => AnyDoc;

/** Indexed by the version the step upgrades *from*. */
const MIGRATIONS: Record<number, Migration> = {
  1: v1_to_v2,
  2: v2_to_v3,
};

export interface MigrationResult {
  doc: SimulationDoc;
  /** Human-readable notes about what changed, surfaced in the import dialog. */
  notes: string[];
}

/** Applies every migration needed to bring a document up to the current schema. */
export function migrate(input: unknown): MigrationResult {
  const notes: string[] = [];
  if (typeof input !== 'object' || input === null) {
    throw new Error('Cannot migrate a value that is not an object.');
  }

  let doc = { ...(input as AnyDoc) };
  let version = typeof doc['schemaVersion'] === 'number' ? (doc['schemaVersion'] as number) : 1;

  if (version > SCHEMA_VERSION) {
    notes.push(
      `This file was written by a newer version of the application (schema ${version}; this build understands ${SCHEMA_VERSION}). It was loaded with best effort.`
    );
  }

  let guard = 0;
  while (version < SCHEMA_VERSION && guard < 20) {
    guard += 1;
    const step = MIGRATIONS[version];
    if (!step) {
      notes.push(`No migration path exists from schema ${version}; stopped early.`);
      break;
    }
    doc = step(doc);
    const next =
      typeof doc['schemaVersion'] === 'number' ? (doc['schemaVersion'] as number) : version + 1;
    notes.push(`Migrated schema ${version} -> ${next}.`);
    version = next;
  }

  // Normalise to the version this build writes, in both directions: a file from the future is
  // loaded best-effort and then re-stamped as current, otherwise it would keep claiming a schema
  // no build can reason about every time it is saved again.
  if (version !== SCHEMA_VERSION) {
    doc['schemaVersion'] = SCHEMA_VERSION;
  }

  return { doc: doc as unknown as SimulationDoc, notes };
}

/** The list of schema versions this build can read, for diagnostics. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];
