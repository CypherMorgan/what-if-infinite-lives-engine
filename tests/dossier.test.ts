/**
 * Future Dossier tests.
 *
 * The dossier is the readable brief of a path. It must be derived entirely from
 * the engine — no invented numbers, no prose that is not backed by a computed
 * figure — and it must stay stable for the same document.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PACKS } from '../src/core/packs';
import { createUniverse, pathTo } from '../src/core/engine';
import { withSensitivity, whyThisPath } from '../src/core/counterfactual';
import { buildDossier } from '../src/core/dossier';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.45,
  resources: ['savings of 12000', 'income 2400/month'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return withSensitivity(createUniverse({ packs: ALL_PACKS, seed, prompt }), ALL_PACKS);
}

/** The first node that is not the starting point. */
function firstRealNode(doc: SimulationDoc): string {
  const start = Object.values(doc.nodes).find((n) => n.type === 'start');
  const others = Object.values(doc.nodes).filter((n) => n.id !== start?.id);
  return (others[0]?.id ?? start?.id ?? '') as string;
}

describe('buildDossier', () => {
  it('returns null for a node that does not exist', () => {
    const doc = makeDoc();
    expect(buildDossier(doc, 'nope' as never, ALL_PACKS)).toBeNull();
  });

  it('describes the starting point', () => {
    const doc = makeDoc();
    const start = Object.values(doc.nodes).find((n) => n.type === 'start');
    expect(start).toBeDefined();
    const d = buildDossier(doc, start!.id, ALL_PACKS, { samples: 6 });
    expect(d).not.toBeNull();
    expect(d!.title).toBe(start!.title);
    expect(d!.atLabel).toBe('now');
    expect(d!.projectedMonth).toBe(doc.prompt.horizon);
    expect(d!.headline.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same document', () => {
    const doc = makeDoc();
    const id = firstRealNode(doc);
    const a = buildDossier(doc, id, ALL_PACKS, { samples: 6 });
    const b = buildDossier(doc, id, ALL_PACKS, { samples: 6 });
    expect(a?.headline).toBe(b?.headline);
    expect(a?.metrics.map((m) => m.delta)).toEqual(b?.metrics.map((m) => m.delta));
    expect(a?.spread).toEqual(b?.spread);
  });

  it('orders the metrics with the headline variables first', () => {
    const doc = makeDoc();
    const start = Object.values(doc.nodes).find((n) => n.type === 'start');
    const d = buildDossier(doc, start!.id, ALL_PACKS, { samples: 6 });
    const primary = doc.vars.filter((v) => v.primary).map((v) => v.key);
    const seenNonPrimary = d!.metrics.findIndex((m) => !primary.includes(m.key));
    if (seenNonPrimary >= 0) {
      const after = d!.metrics.slice(seenNonPrimary);
      expect(after.every((m) => !primary.includes(m.key))).toBe(true);
    }
  });

  it('reports a spread that is ordered low to high', () => {
    const doc = makeDoc();
    const start = Object.values(doc.nodes).find((n) => n.type === 'start');
    const d = buildDossier(doc, start!.id, ALL_PACKS, { samples: 8 });
    if (d?.spread) {
      expect(d.spread.p10).toBeLessThanOrEqual(d.spread.p50);
      expect(d.spread.p50).toBeLessThanOrEqual(d.spread.p90);
      expect(d.spread.samples).toBe(8);
    }
  });

  it('takes its gains and costs from the node the engine produced', () => {
    const doc = makeDoc();
    // Find a node that actually carries trade-offs.
    const withTradeoffs = Object.values(doc.nodes).find((n) => n.tradeoffs);
    if (!withTradeoffs) return;
    const d = buildDossier(doc, withTradeoffs.id, ALL_PACKS, { samples: 6 });
    expect(d!.gains).toEqual(withTradeoffs.tradeoffs?.gains ?? []);
    expect(d!.costs).toEqual(withTradeoffs.tradeoffs?.costs ?? []);
  });

  it('explains the path without leaking internal rule ids', () => {
    const doc = makeDoc();
    const id = firstRealNode(doc);
    const d = buildDossier(doc, id, ALL_PACKS, { samples: 6 });
    expect(d!.reasons.length).toBeGreaterThan(0);
    for (const reason of d!.reasons) {
      expect(reason).not.toMatch(/\(rule /);
    }
  });

  it('keeps the engine reasoning that the dossier cleans up', () => {
    const doc = makeDoc();
    const id = firstRealNode(doc);
    const raw = whyThisPath(doc, id);
    const cleaned = buildDossier(doc, id, ALL_PACKS, { samples: 6 })!.reasons;
    expect(cleaned.length).toBe(raw.length);
  });

  it('only lists readable variables as untouched', () => {
    const doc = makeDoc();
    const id = firstRealNode(doc);
    const d = buildDossier(doc, id, ALL_PACKS, { samples: 6 });
    const readable = new Set(doc.vars.filter((v) => v.primary).map((v) => v.label));
    for (const label of d!.stable) expect(readable.has(label)).toBe(true);
    for (const label of d!.sensitive) expect(readable.has(label)).toBe(true);
  });

  it('reports the assumptions with the greatest measured influence', () => {
    const doc = makeDoc();
    const start = Object.values(doc.nodes).find((n) => n.type === 'start');
    const d = buildDossier(doc, start!.id, ALL_PACKS, { samples: 6 });
    const influences = d!.influentialInputs.map((i) => i.influence);
    // Sorted largest first.
    expect([...influences].sort((a, b) => b - a)).toEqual(influences);
    for (const i of d!.influentialInputs) {
      expect(i.influence).toBeGreaterThan(0);
      expect(i.influence).toBeLessThanOrEqual(100);
    }
  });

  it('is honest about a path that changes nothing', () => {
    const doc = makeDoc();
    const start = Object.values(doc.nodes).find((n) => n.type === 'start');
    const d = buildDossier(doc, start!.id, ALL_PACKS, { samples: 6 });
    if (d!.metrics.every((m) => m.tone === 'flat')) {
      expect(d!.headline).toMatch(/moves little/);
      expect(d!.confidence).toMatch(/nothing/i);
    }
  });

  it('covers the whole path it is asked about', () => {
    const doc = makeDoc();
    const leaf = Object.values(doc.nodes).find((n) => n.children.length === 0);
    if (!leaf) return;
    expect(pathTo(doc, leaf.id).length).toBeGreaterThan(0);
    const d = buildDossier(doc, leaf.id, ALL_PACKS, { samples: 6 });
    expect(d!.nodeId).toBe(leaf.id);
    expect(d!.branchName).toBe(doc.branches[leaf.branch]?.name);
  });
});
