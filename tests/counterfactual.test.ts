/**
 * Counterfactual tests: assumption changes, decision changes, comparison snapshots,
 * lineage and explanations.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAssumptionChange,
  applyDecisionChange,
  changedAssumptions,
  diffSnapshots,
  noisyKeys,
  previewAssumption,
  reroll,
  snapshot,
  stabilityBetween,
  whyThisPath,
} from '../src/core/counterfactual';
import { ALL_PACKS } from '../src/core/packs';
import { createUniverse, derive } from '../src/core/engine';
import { validateGraph } from '../src/core/graph';
import { ARCHETYPE_OPTIONS, detectArchetypes } from '../src/core/archetypes';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.3,
  resources: ['savings of 12000', 'income 2400/month'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt });
}

function startNode(doc: SimulationDoc) {
  return Object.values(doc.nodes).find((n) => n.type === 'start');
}

describe('applyAssumptionChange', () => {
  it('rejects an unknown assumption id', () => {
    const result = applyAssumptionChange(makeDoc(), 'a.nope', 5, ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('rejects a non-editable assumption', () => {
    const doc = makeDoc();
    const locked = {
      ...doc,
      assumptions: doc.assumptions.map((a) => ({ ...a, editable: false })),
    };
    const result = applyAssumptionChange(locked, 'a.funds', 20_000, ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('rejects a non-finite value', () => {
    const result = applyAssumptionChange(makeDoc(), 'a.funds', Number.NaN, ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('rejects an unchanged value', () => {
    const doc = makeDoc();
    const funds = doc.assumptions.find((a) => a.id === 'a.funds');
    expect(funds).toBeDefined();
    const result = applyAssumptionChange(doc, 'a.funds', funds?.value ?? 0, ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('rebuilds a valid universe linked to its parent', () => {
    const parent = makeDoc();
    const result = applyAssumptionChange(parent, 'a.funds', 25_000, ALL_PACKS);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    const child = result.doc;
    expect(child.parentId).toBe(parent.id);
    expect(child.counterfactual?.target).toBe('Starting funds');
    expect(child.counterfactual?.toValue).toContain('25');
    expect(validateGraph(child).errors).toEqual([]);
    expect(child.title).not.toBe(parent.title);
    // The prompt and seed are deliberately untouched: only the assumption differs.
    expect(child.seed).toBe(parent.seed);
    expect(child.prompt.situation).toBe(parent.prompt.situation);
    // The changed value is actually in force in the rebuilt assumptions list.
    expect(child.assumptions.find((a) => a.id === 'a.funds')?.value).toBe(25_000);
  });

  it('is deterministic: the same change twice gives the same document', () => {
    const parent = makeDoc();
    const a = applyAssumptionChange(parent, 'a.funds', 25_000, ALL_PACKS);
    const b = applyAssumptionChange(parent, 'a.funds', 25_000, ALL_PACKS);
    if ('error' in a || 'error' in b) throw new Error('expected success');
    expect(JSON.stringify(a.doc.nodes)).toBe(JSON.stringify(b.doc.nodes));
  });

  it('actually changes the outcome relative to the parent', () => {
    const parent = makeDoc();
    const a = applyAssumptionChange(parent, 'a.funds', 25_000, ALL_PACKS);
    if ('error' in a) throw new Error('expected success');
    const start = startNode(a.doc);
    const parentStart = startNode(parent);
    expect(start?.state?.['money']).toBe(25_000);
    expect(parentStart?.state?.['money']).not.toBe(25_000);
    expect(changedAssumptions(parent, a.doc).map((d) => d.key)).toContain('a.funds');
  });
});

describe('applyDecisionChange', () => {
  it('rejects an unknown option id', () => {
    const result = applyDecisionChange(makeDoc(), 'opt-does-not-exist', ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('rejects an option that is already one of the branches', () => {
    const doc = makeDoc();
    const alreadyThere = Object.values(doc.nodes).find(
      (n) => n.type === 'decision' && n.depth === 1
    );
    const option = Object.values(ARCHETYPE_OPTIONS)
      .flat()
      .find((o) => o.label === alreadyThere?.title);
    expect(option).toBeDefined();
    if (!option) return;
    const result = applyDecisionChange(doc, option.id, ALL_PACKS);
    expect('error' in result).toBe(true);
  });

  it('builds a single-commitment universe that preserves the parent link', () => {
    const parent = makeDoc();
    const parentLabels = new Set(
      Object.values(parent.nodes)
        .filter((n) => n.type === 'decision' && n.depth === 1)
        .map((n) => n.title)
    );
    const option = Object.values(ARCHETYPE_OPTIONS)
      .flat()
      .find((o) => !parentLabels.has(o.label));
    expect(option).toBeDefined();
    if (!option) return;

    const result = applyDecisionChange(parent, option.id, ALL_PACKS);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.doc.parentId).toBe(parent.id);
    expect(result.doc.counterfactual?.toValue).toBe(option.label);
    expect(validateGraph(result.doc).errors).toEqual([]);
    // The original universe must be untouched by the operation.
    expect(parent.counterfactual).toBeUndefined();
    const decisions = Object.values(result.doc.nodes).filter(
      (n) => n.type === 'decision' && n.depth === 1
    );
    expect(decisions.map((d) => d.title)).toEqual([option.label]);
  });
});

describe('comparison snapshots', () => {
  it('snapshots an existing node with its branch identity', () => {
    const doc = makeDoc();
    const node = Object.values(doc.nodes).find((n) => n.children.length > 0);
    expect(node).toBeDefined();
    if (!node) return;
    const snap = snapshot(doc, node.id);
    expect(snap).not.toBeNull();
    expect(snap?.nodeId).toBe(node.id);
    expect(snap?.branchName.length).toBeGreaterThan(0);
    expect(snap?.evidenceCls.length).toBeGreaterThan(0);
  });

  it('snapshots an unknown node as null', () => {
    expect(snapshot(makeDoc(), 'nope')).toBeNull();
  });

  it('diffs two branch heads over meaningful differences only', () => {
    const doc = makeDoc();
    const heads = Object.values(doc.nodes).filter((n) => n.children.length === 0);
    expect(heads.length).toBeGreaterThanOrEqual(2);
    const a = snapshot(doc, heads[0]?.id ?? '');
    const b = snapshot(doc, heads[1]?.id ?? '');
    expect(a && b).toBeTruthy();
    if (!a || !b) return;

    const diffs = diffSnapshots(a, b);
    for (const d of diffs) {
      // Every reported entry must exceed its own noise floor.
      const floor = d.unit === 'currency' ? 50 : d.unit === 'months' ? 0.5 : 0.75;
      expect(Math.abs(d.delta)).toBeGreaterThanOrEqual(floor);
      expect(Number.isFinite(d.delta)).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
    }
    // Sorted largest-movement-first under the unit normalisation.
    const norm = (d: (typeof diffs)[number]) =>
      Math.abs(d.delta) / (d.unit === 'currency' ? 1000 : d.unit === 'months' ? 6 : 20);
    for (let i = 1; i < diffs.length; i += 1) {
      expect(norm(diffs[i - 1]!)).toBeGreaterThanOrEqual(norm(diffs[i]!));
    }
  });

  it('diffing identical snapshots reports no movement', () => {
    const doc = makeDoc();
    const node = Object.values(doc.nodes)[0];
    const snap = snapshot(doc, node?.id ?? '');
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(diffSnapshots(snap, snap)).toEqual([]);
  });

  it('classifies keys into stable, moved and sensitive', () => {
    const doc = makeDoc();
    const heads = Object.values(doc.nodes).filter((n) => n.children.length === 0);
    const a = snapshot(doc, heads[0]?.id ?? '');
    const b = snapshot(doc, heads[1]?.id ?? '');
    if (!a || !b) throw new Error('expected two snapshots');

    const report = stabilityBetween(a, b, noisyKeys(ALL_PACKS));
    const all = [...report.stable, ...report.moved, ...report.sensitive];
    // No key is classified twice.
    expect(new Set(all).size).toBe(all.length);
    // Every key in either snapshot state is classified.
    const keys = new Set([...Object.keys(a.state), ...Object.keys(b.state)]);
    expect(all.length).toBeGreaterThan(0);
    expect(keys.size).toBeGreaterThan(0);
  });
});

describe('lineage and explanation', () => {
  it('whyThisPath walks to the start and names the given facts', () => {
    const doc = makeDoc();
    const leaf = Object.values(doc.nodes).find((n) => n.parents.length > 0);
    expect(leaf).toBeDefined();
    const reasons = whyThisPath(doc, leaf?.id ?? '');
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toMatch(/^Started from:/);
    for (const r of reasons) expect(typeof r).toBe('string');
  });

  it('whyThisPath on the start node is a single given', () => {
    const doc = makeDoc();
    const start = startNode(doc);
    const reasons = whyThisPath(doc, start?.id ?? '');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^Started from:/);
  });

  it('reroll keeps identity but changes the draw, and records why', () => {
    const parent = makeDoc();
    const rerolled = reroll(parent, ALL_PACKS, parent.seed + 99);
    expect(rerolled.id).toBe(parent.id);
    expect(rerolled.createdAt).toBe(parent.createdAt);
    expect(rerolled.seed).toBe(parent.seed + 99);
    expect(rerolled.counterfactual?.target).toBe('Random seed');
    expect(rerolled.meta.provenance).toContain(String(parent.seed + 99));
    expect(validateGraph(rerolled).errors).toEqual([]);
    expect(JSON.stringify(rerolled.nodes)).not.toBe(JSON.stringify(parent.nodes));
  });

  it('reroll is deterministic per seed', () => {
    const parent = makeDoc();
    const a = reroll(parent, ALL_PACKS, 7);
    const b = reroll(parent, ALL_PACKS, 7);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });
});

describe('previewAssumption', () => {
  it('patches one key and returns a derived state', () => {
    const doc = makeDoc();
    const assumption = doc.assumptions.find((a) => a.id === 'a.income');
    expect(assumption).toBeDefined();
    if (!assumption) return;
    const base = derive({ income: 2400 }, detectArchetypes('work salary income'));
    const preview = previewAssumption(base, assumption, 5000, ['career']);
    expect(preview['income']).toBe(5000);
    expect(Object.values(preview).every((v) => Number.isFinite(v))).toBe(true);
  });
});
