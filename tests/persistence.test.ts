/**
 * Persistence tests: export/import round-trip, envelope checks, validation failures and
 * schema migrations.
 *
 * These guard the guarantee that a file written by this build opens in this build — and that a
 * damaged file is rejected with a message a person can act on rather than crashing the app.
 */
import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  exportDocument,
  exportFileName,
  exportToText,
  importFromText,
  serialiseIndex,
  serialize,
  summarise,
} from '../src/core/importExport';
import { SUPPORTED_SCHEMA_VERSIONS, migrate } from '../src/core/migrations';
import { validateDocument } from '../src/core/validate';
import { validateGraph } from '../src/core/graph';
import { createUniverse } from '../src/core/engine';
import { ALL_PACKS } from '../src/core/packs';
import { SCHEMA_VERSION, type ScenarioPrompt, type SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.3,
  resources: ['savings of 12000'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt });
}

describe('export envelope', () => {
  it('wraps the document in a self-describing, checksummed envelope', () => {
    const doc = makeDoc();
    const envelope = exportDocument(doc);
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope.schemaVersion).toBe(doc.schemaVersion);
    expect(envelope.appVersion).toBe(APP_VERSION);
    expect(envelope.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(envelope.document.id).toBe(doc.id);
  });

  it('produces a checksum that changes when the document changes', () => {
    const doc = makeDoc();
    const a = exportDocument(doc);
    const b = exportDocument({ ...doc, title: `${doc.title} (edited)` });
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('names a safe file from any title', () => {
    const doc = makeDoc();
    expect(exportFileName({ ...doc, title: '' })).toBe('universe.whatif.json');
    expect(exportFileName({ ...doc, title: 'What if I moved to Lisbon??' })).toBe(
      'what-if-i-moved-to-lisbon.whatif.json',
    );
  });

  it('summarises a document for the library index', () => {
    const doc = makeDoc();
    const summary = summarise(doc);
    expect(summary.id).toBe(doc.id);
    expect(summary.nodeCount).toBe(Object.keys(doc.nodes).length);
    expect(summary.branchCount).toBe(Object.keys(doc.branches).length);
    expect(summary.isCounterfactual).toBe(false);
  });

  it('serialises the index newest-first', () => {
    const index = serialiseIndex([
      { id: 'a', title: 'A', createdAt: '2026-01-01', updatedAt: '2026-01-01', nodeCount: 1, branchCount: 1, generator: 'offline', isCounterfactual: false },
      { id: 'b', title: 'B', createdAt: '2026-02-01', updatedAt: '2026-02-01', nodeCount: 1, branchCount: 1, generator: 'offline', isCounterfactual: false },
    ]);
    expect(index.items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('round trip', () => {
  it('export -> import returns an equivalent document', () => {
    const doc = makeDoc();
    const text = exportToText(doc);
    const result = importFromText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = result.value.doc;
    expect(loaded.id).toBe(doc.id);
    expect(loaded.title).toBe(doc.title);
    expect(loaded.seed).toBe(doc.seed);
    expect(Object.keys(loaded.nodes).length).toBe(Object.keys(doc.nodes).length);
    expect(Object.keys(loaded.edges).length).toBe(Object.keys(doc.edges).length);
    expect(Object.keys(loaded.branches).length).toBe(Object.keys(doc.branches).length);
    expect(loaded.assumptions).toEqual(doc.assumptions);
    expect(loaded.prompt).toEqual(doc.prompt);
    expect(validateGraph(loaded).errors).toEqual([]);
    // Every node survives with its text intact.
    for (const node of Object.values(doc.nodes)) {
      expect(loaded.nodes[node.id]?.title).toBe(node.title);
      expect(loaded.nodes[node.id]?.summary).toBe(node.summary);
    }
  });

  it('a bare document (no envelope) still imports, with a warning', () => {
    const doc = makeDoc();
    const result = importFromText(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((w) => w.includes('No export envelope'))).toBe(true);
    expect(result.value.doc.id).toBe(doc.id);
  });

  it('reports the exporting version as a note', () => {
    const result = importFromText(exportToText(makeDoc()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes.some((n) => n.includes(APP_VERSION))).toBe(true);
  });
});

describe('import failures are typed, not thrown', () => {
  it('rejects an empty file', () => {
    const result = importFromText('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty_file');
  });

  it('rejects invalid JSON', () => {
    const result = importFromText('{ this is not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_json');
    expect(result.error.detail).toBeTruthy();
  });

  it('rejects a JSON array', () => {
    const result = importFromText('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_an_object');
  });

  it('rejects an envelope with no document', () => {
    const result = importFromText(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('missing_document');
  });

  it('rejects an oversized file before parsing it', () => {
    const huge = 'x'.repeat(33 * 1024 * 1024);
    const result = importFromText(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('file_too_large');
  });

  it('rejects a document with no starting node', () => {
    const doc = makeDoc();
    const broken = JSON.parse(serialize(doc)) as SimulationDoc;
    for (const node of Object.values(broken.nodes)) {
      if (node.type === 'start') node.type = 'event';
    }
    const result = importFromText(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
    expect(result.error.message).toContain('starting node');
  });

  it('repairs a document whose edges point at nothing instead of losing the file', () => {
    const doc = makeDoc();
    const broken = JSON.parse(serialize(doc)) as SimulationDoc;
    // Point an edge at a node that does not exist. The importer must keep the file, drop the
    // bad edge, and say so — losing a user's universe over one bad line is not acceptable.
    const firstEdge = Object.values(broken.edges)[0];
    const edgeId = firstEdge?.id;
    if (firstEdge) firstEdge.to = 'ghost-node';
    const result = importFromText(JSON.stringify(broken));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes.some((n) => n.includes('dangling reference'))).toBe(true);
    expect(result.value.doc.edges[edgeId ?? '']).toBeUndefined();
    expect(validateGraph(result.value.doc).errors).toEqual([]);
    // The start node and the surviving branches are kept; only the now-unreachable tail is
    // pruned, and the notes say exactly what happened.
    expect(Object.values(result.value.doc.nodes).some((n) => n.type === 'start')).toBe(true);
    expect(Object.keys(result.value.doc.nodes).length).toBeLessThan(Object.keys(doc.nodes).length);
    expect(result.value.notes.some((n) => n.includes('unreachable node'))).toBe(true);
  });

  it('accepts a hand-edited file but warns about the checksum', () => {
    const doc = makeDoc();
    const envelope = exportDocument({ ...doc, title: 'Edited by hand' });
    // Tamper with the document without recomputing the checksum.
    envelope.document.title = 'Silently changed';
    const result = importFromText(JSON.stringify(envelope));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((w) => w.includes('checksum'))).toBe(true);
    expect(result.value.doc.title).toBe('Silently changed');
  });

  it('accepts a newer export format with a warning', () => {
    const envelope = exportDocument(makeDoc());
    const future = { ...envelope, formatVersion: EXPORT_FORMAT_VERSION + 5 };
    const result = importFromText(JSON.stringify(future));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((w) => w.includes('export format'))).toBe(true);
  });
});

describe('migrations', () => {
  it('declares every supported schema version', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(SCHEMA_VERSION);
    expect(SUPPORTED_SCHEMA_VERSIONS[0]).toBe(1);
  });

  it('walks a v1 document all the way to the current schema', () => {
    // A v1 document: no `collapsed`, no `vars`, no `focusNode`/`camera`, archetypes joined as
    // a comma string (which old builds wrote), assumptions without editable/sensitivity.
    const current = makeDoc();
    const v1 = JSON.parse(serialize(current)) as Record<string, unknown>;
    delete v1['collapsed'];
    delete v1['vars'];
    delete v1['focusNode'];
    delete v1['camera'];
    v1['schemaVersion'] = 1;
    const promptObj = v1['prompt'] as Record<string, unknown>;
    promptObj['archetypes'] = ['career', 'learning'].join(',');
    delete promptObj['goals'];
    delete promptObj['imagination'];
    v1['assumptions'] = (current.assumptions as unknown[]).map((a) => {
      const copy = { ...(a as Record<string, unknown>) };
      delete copy['editable'];
      delete copy['sensitivity'];
      return copy;
    });

    const { doc, notes } = migrate(v1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringContaining('1 -> 2'),
      expect.stringContaining('2 -> 3'),
    ]));
    expect(Array.isArray(doc.prompt.archetypes)).toBe(true);
    expect(doc.prompt.archetypes).toEqual(['career', 'learning']);
    expect(doc.prompt.goals).toEqual([]);
    expect(typeof doc.prompt.imagination).toBe('number');
    expect(Array.isArray(doc.collapsed)).toBe(true);
    expect(Array.isArray(doc.vars)).toBe(true);
    expect(doc.vars.length).toBeGreaterThan(0);
    // Migration must not lose the graph itself.
    expect(Object.keys(doc.nodes).length).toBe(Object.keys(current.nodes).length);
    expect(validateGraph(doc).errors).toEqual([]);
    // Defaults are restored for the fields v3 introduced.
    for (const a of doc.assumptions) {
      expect(a.editable).toBe(true);
      expect(a.sensitivity).toBe(0);
    }
    // And the migrated document must pass full import validation.
    const check = validateDocument(doc);
    expect(check.ok).toBe(true);
  });

  it('derives variable metadata from node state keys the v1 file never declared', () => {
    const current = makeDoc();
    const v1 = JSON.parse(serialize(current)) as Record<string, unknown>;
    v1['schemaVersion'] = 1;
    v1['vars'] = [];
    delete v1['collapsed'];

    const { doc } = migrate(v1);
    const keys = new Set(Object.values(doc.nodes).flatMap((n) => Object.keys(n.state ?? {})));
    const declared = new Set(doc.vars.map((v) => v.key));
    for (const key of keys) expect(declared.has(key)).toBe(true);
    const money = doc.vars.find((v) => v.key === 'money');
    expect(money?.unit).toBe('currency');
  });

  it('treats a document with no schemaVersion as v1', () => {
    const current = makeDoc();
    const raw = JSON.parse(serialize(current)) as Record<string, unknown>;
    delete raw['schemaVersion'];
    const { doc, notes } = migrate(raw);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('refuses a non-object', () => {
    expect(() => migrate('nope')).toThrow();
    expect(() => migrate(null)).toThrow();
    expect(() => migrate(42)).toThrow();
  });

  it('loads a future-schema document with an explanatory note instead of failing', () => {
    const current = makeDoc();
    const raw = { ...JSON.parse(serialize(current)), schemaVersion: 99 };
    const { doc, notes } = migrate(raw);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(notes.some((n) => n.includes('newer version'))).toBe(true);
  });

  it('stops gracefully on an unknown intermediate version', () => {
    const current = makeDoc();
    const raw = { ...JSON.parse(serialize(current)), schemaVersion: 1 };
    // Remove the 1 -> 2 path by pretending a gap version is in force.
    const { notes } = migrate({ ...raw, schemaVersion: 0 });
    expect(notes.some((n) => n.includes('No migration path'))).toBe(true);
  });
});
