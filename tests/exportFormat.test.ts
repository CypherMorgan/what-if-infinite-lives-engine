/**
 * The export format contract.
 *
 * `docs/EXPORT_FORMAT.md` documents the `.whatif.json` format for people who
 * want to read a universe in a text editor, or write one. This suite pins the
 * parts of that document that a hand-written file depends on, so the prose and
 * the code cannot quietly drift apart.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  exportDocument,
  exportToText,
  importFromText,
} from '../src/core/importExport';
import { SCHEMA_VERSION, type ScenarioPrompt, type SimulationDoc } from '../src/core/types';
import { createUniverse } from '../src/core/engine';
import { ALL_PACKS } from '../src/core/packs';
import pkg from '../package.json';

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

describe('the documented envelope', () => {
  it('has exactly the fields the documentation lists', () => {
    const envelope = exportDocument(makeDoc());
    expect(Object.keys(envelope).sort()).toEqual(
      [
        'appVersion',
        'checksum',
        'document',
        'exportedAt',
        'format',
        'formatVersion',
        'schemaVersion',
      ].sort()
    );
  });

  it('declares the format and its version', () => {
    const envelope = exportDocument(makeDoc());
    expect(EXPORT_FORMAT).toBe('whatif.universe');
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope.formatVersion).toBe(1);
  });

  it('carries the schema version of the document it wraps', () => {
    const doc = makeDoc();
    const envelope = exportDocument(doc);
    expect(envelope.schemaVersion).toBe(doc.schemaVersion);
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
    expect(envelope.schemaVersion).toBe(3);
  });

  it('reports the version of the app that wrote the file', () => {
    const envelope = exportDocument(makeDoc());
    expect(envelope.appVersion).toBe(pkg.version);
  });

  it('stamps the export with an ISO-8601 timestamp', () => {
    const envelope = exportDocument(makeDoc());
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(envelope.exportedAt))).toBe(false);
  });

  it('checksums the document as eight lowercase hex digits', () => {
    const envelope = exportDocument(makeDoc());
    expect(envelope.checksum).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes the checksum when the document changes', () => {
    const a = exportDocument(makeDoc(42));
    const b = exportDocument(makeDoc(43));
    expect(a.checksum).not.toBe(b.checksum);
  });
});

describe('the documented document', () => {
  it('has the fields the documentation lists', () => {
    const doc = makeDoc();
    for (const key of [
      'id',
      'schemaVersion',
      'createdAt',
      'updatedAt',
      'title',
      'seed',
      'prompt',
      'nodes',
      'edges',
      'branches',
      'layout',
      'vars',
      'assumptions',
      'collapsed',
      'meta',
    ]) {
      expect(doc).toHaveProperty(key);
    }
  });

  it('stores the scenario exactly as the documentation describes it', () => {
    const doc = makeDoc();
    expect(Object.keys(doc.prompt).sort()).toEqual(
      [
        'archetypes',
        'branchCount',
        'constraints',
        'decision',
        'goals',
        'horizon',
        'imagination',
        'resources',
        'situation',
        'title',
      ].sort()
    );
    expect(doc.prompt.horizon).toBe(24);
    expect(doc.prompt.imagination).toBeGreaterThanOrEqual(0);
    expect(doc.prompt.imagination).toBeLessThanOrEqual(1);
  });

  it('stores a node with the fields the documentation lists', () => {
    const doc = makeDoc();
    const node = Object.values(doc.nodes)[0];
    expect(node).toBeDefined();
    for (const key of [
      'id',
      'type',
      'title',
      'summary',
      't',
      'horizon',
      'branch',
      'depth',
      'parents',
      'children',
      'assumptions',
      'uncertainties',
      'evidence',
      'expandable',
      'expanded',
    ]) {
      expect(node).toHaveProperty(key);
    }
  });

  it('tags every piece of evidence with a class from the documented set', () => {
    const doc = makeDoc();
    const classes = new Set(['user-fact', 'research', 'assumption', 'speculation']);
    for (const node of Object.values(doc.nodes)) {
      for (const tag of node.evidence) {
        expect(classes.has(tag.cls)).toBe(true);
      }
    }
  });

  it('never stores a provider credential in the document', () => {
    const text = exportToText(makeDoc());
    expect(text).not.toMatch(/apiKey/i);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe('a hand-written file', () => {
  it('accepts a bare document with no envelope', () => {
    const doc = makeDoc();
    const result = importFromText(JSON.stringify(doc, null, 2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings.some((w) => w.includes('bare simulation document'))).toBe(true);
    }
  });

  it('warns but still loads a file whose checksum does not match', () => {
    const doc = makeDoc();
    const envelope = exportDocument(doc);
    envelope.checksum = 'deadbeef';
    const result = importFromText(JSON.stringify(envelope));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings.some((w) => w.includes('checksum'))).toBe(true);
    }
  });

  it('warns about a file from a newer export format but still loads it', () => {
    const doc = makeDoc();
    const envelope = exportDocument(doc);
    envelope.formatVersion = 99;
    const result = importFromText(JSON.stringify(envelope));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings.some((w) => w.includes('export format 99'))).toBe(true);
    }
  });

  it('rejects a file with no document id', () => {
    const doc = makeDoc() as unknown as Record<string, unknown>;
    delete doc['id'];
    const result = importFromText(JSON.stringify(doc));
    expect(result.ok).toBe(false);
  });

  it('rejects a file that is not an object', () => {
    const result = importFromText('"just a string"');
    expect(result.ok).toBe(false);
  });

  it('rejects a file with no nodes map', () => {
    const doc = makeDoc() as unknown as Record<string, unknown>;
    delete doc['nodes'];
    const result = importFromText(JSON.stringify(doc));
    expect(result.ok).toBe(false);
  });
});
