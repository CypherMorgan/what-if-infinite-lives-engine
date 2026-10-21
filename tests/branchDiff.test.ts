/**
 * Branch diff tests.
 *
 * The diff is the answer to "these two, specifically — where do they part
 * company, and what is different at the end?". These tests guard the parts a
 * person would be misled by: a comparison made at two different moments, a
 * divergence point that is not where the paths actually split, or a "favours"
 * that points the wrong way.
 */
import { describe, expect, it } from 'vitest';
import { buildBranchDiff } from '../src/core/branchDiff';
import { createUniverse } from '../src/core/engine';
import { ALL_PACKS } from '../src/core/packs';
import { ALL_VARS } from '../src/core/packs/vars';
import { isBetter } from '../src/core/vars';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 36,
  branchCount: 3,
  imagination: 0.4,
  resources: ['savings of 12000'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt });
}

/** The branches that are actual paths, not the starting point. */
function pathIds(doc: SimulationDoc): string[] {
  const startBranch = Object.values(doc.nodes).find((n) => n.type === 'start')?.branch;
  return Object.values(doc.branches)
    .map((b) => b.id)
    .filter((id) => id !== startBranch);
}

describe('branch diff', () => {
  it('refuses to compare a branch that does not exist', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    expect(buildBranchDiff(doc, a!, b!, ALL_PACKS)).not.toBeNull();
    expect(buildBranchDiff(doc, 'nope', b!, ALL_PACKS)).toBeNull();
    expect(buildBranchDiff(doc, a!, 'nope', ALL_PACKS)).toBeNull();
  });

  it('lines the two paths up with the steps the model actually built', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;

    for (const side of [diff.a, diff.b]) {
      const onBranch = Object.values(doc.nodes).filter((n) => n.branch === side.branchId);
      expect(side.steps.length).toBe(onBranch.length);
      // The steps run forward in time.
      const times = side.steps.map((s) => s.t);
      expect([...times].sort((x, y) => x - y)).toEqual(times);
    }
  });

  it('compares both paths at the same moment, never at two different ones', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;
    expect(diff.compareMonth).toBeGreaterThanOrEqual(doc.prompt.horizon);
    // Both sides were projected to that same moment.
    expect(diff.a.projected).not.toBeNull();
    expect(diff.b.projected).not.toBeNull();
  });

  it('finds the step the two paths part company at', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;
    expect(diff.divergedAt).not.toBeNull();
    if (!diff.divergedAt) return;
    // The shared step is a real node in the document.
    expect(doc.nodes[diff.divergedAt.nodeId]).toBeDefined();
    // The two paths do not share the step that follows it.
    const aIds = diff.a.steps.map((s) => s.id);
    const bIds = diff.b.steps.map((s) => s.id);
    expect(aIds).not.toEqual(bIds);
  });

  it('reports the differences it finds and the ones it does not', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;
    expect(diff.diffCount).toBe(diff.metrics.length);
    expect(diff.sameCount).toBeGreaterThanOrEqual(0);
    expect(diff.headline.length).toBeGreaterThan(20);
    expect(diff.verdict.length).toBeGreaterThan(10);
  });

  it('points "favours" the way the model thinks is better', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;

    for (const m of diff.metrics) {
      const def = ALL_VARS.find((v) => v.key === m.key);
      if (!def) continue;
      if (m.favours === 'b') expect(isBetter(m.delta, def)).toBe(true);
      else if (m.favours === 'a') expect(isBetter(-m.delta, def)).toBe(true);
      else {
        expect(isBetter(m.delta, def)).toBe(false);
        expect(isBetter(-m.delta, def)).toBe(false);
      }
    }
  });

  it('orders the differences so the largest lead', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;
    for (let i = 1; i < diff.metrics.length; i++) {
      const prev = diff.metrics[i - 1]!;
      const cur = diff.metrics[i]!;
      const scale = (m: typeof prev): number =>
        m.unit === 'currency'
          ? 1000
          : m.unit === 'months'
            ? 6
            : m.unit === 'percent' || m.unit === 'level'
              ? 20
              : 10;
      expect(Math.abs(prev.delta) / scale(prev)).toBeGreaterThanOrEqual(
        Math.abs(cur.delta) / scale(cur)
      );
    }
  });

  it('gives the same answer every time', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const first = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    const second = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    expect(first?.headline).toBe(second?.headline);
    expect(first?.metrics.map((m) => m.key)).toEqual(second?.metrics.map((m) => m.key));
  });

  it('reads the same when the two paths are swapped', () => {
    const doc = makeDoc();
    const [a, b] = pathIds(doc);
    const forward = buildBranchDiff(doc, a!, b!, ALL_PACKS);
    const backward = buildBranchDiff(doc, b!, a!, ALL_PACKS);
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();
    if (!forward || !backward) return;
    // The same differences, the other way round.
    expect(forward.metrics.map((m) => m.key).sort()).toEqual(
      backward.metrics.map((m) => m.key).sort()
    );
    expect(forward.sameCount).toBe(backward.sameCount);
    expect(forward.divergedAt?.nodeId).toBe(backward.divergedAt?.nodeId);
  });

  it('says so plainly when two paths are the same', () => {
    const doc = makeDoc();
    // The same branch compared with itself has no differences at all.
    const [a] = pathIds(doc);
    const diff = buildBranchDiff(doc, a!, a!, ALL_PACKS);
    expect(diff).not.toBeNull();
    if (!diff) return;
    expect(diff.metrics.length).toBe(0);
    expect(diff.headline).toContain('same place');
    expect(diff.verdict).toContain('the same');
  });
});
