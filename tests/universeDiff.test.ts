/**
 * Universe diff tests.
 *
 * A universe diff is easy to make dishonest: pair two paths that do not
 * correspond, blame an assumption for a difference that came from a different
 * random draw, or hide the fact that the two documents answer different
 * questions. These tests guard those failure modes, plus the ordinary job of
 * reporting the changed assumptions and the outcomes they moved.
 */
import { describe, expect, it } from 'vitest';
import { buildUniverseDiff, relateUniverses, type UniverseRef } from '../src/core/universeDiff';
import { applyAssumptionChange, applyDecisionChange } from '../src/core/counterfactual';
import { createUniverse } from '../src/core/engine';
import { ALL_PACKS } from '../src/core/packs';
import { ALL_VARS } from '../src/core/packs/vars';
import { isBetter } from '../src/core/vars';
import { ARCHETYPE_OPTIONS } from '../src/core/archetypes';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer', 'Keep income stable'],
  constraints: ['Mortgage payment'],
  horizon: 24,
  branchCount: 3,
  imagination: 0.4,
  resources: ['savings of 12000', 'income 2400/month'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function makeDoc(overrides: Partial<ScenarioPrompt> = {}, seed = 42): SimulationDoc {
  return createUniverse({ packs: ALL_PACKS, seed, prompt: { ...prompt, ...overrides } });
}

function childOfFunds(parent: SimulationDoc): SimulationDoc {
  const result = applyAssumptionChange(parent, 'a.funds', 25_000, ALL_PACKS);
  if ('error' in result) throw new Error(result.error);
  return result.doc;
}

function refsOf(...docs: SimulationDoc[]): UniverseRef[] {
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    ...(d.parentId ? { parentId: d.parentId } : {}),
  }));
}

describe('relateUniverses', () => {
  it('recognises a direct fork in either direction', () => {
    const parent = makeDoc();
    const child = childOfFunds(parent);

    const forward = relateUniverses(
      { id: child.id, title: child.title, parentId: parent.id },
      { id: parent.id, title: parent.title },
      refsOf(parent, child)
    );
    expect(forward.kind).toBe('a-from-b');
    expect(forward.commonAncestor?.id).toBe(parent.id);
    expect(forward.label).toContain('derived from');

    const backward = relateUniverses(
      { id: parent.id, title: parent.title },
      { id: child.id, title: child.title, parentId: parent.id },
      refsOf(parent, child)
    );
    expect(backward.kind).toBe('b-from-a');
    expect(backward.commonAncestor?.id).toBe(parent.id);
  });

  it('recognises two forks of the same universe as siblings', () => {
    const parent = makeDoc();
    const first = childOfFunds(parent);
    const income = applyAssumptionChange(parent, 'a.income', 4200, ALL_PACKS);
    if ('error' in income) throw new Error(income.error);

    const relation = relateUniverses(
      { id: first.id, title: first.title, parentId: parent.id },
      { id: income.doc.id, title: income.doc.title, parentId: parent.id },
      refsOf(parent, first, income.doc)
    );
    expect(relation.kind).toBe('siblings');
    expect(relation.commonAncestor?.id).toBe(parent.id);
    expect(relation.commonAncestor?.stepsFromA).toBe(1);
    expect(relation.commonAncestor?.stepsFromB).toBe(1);
    expect(relation.label).toContain('Both are forks');
  });

  it('reports a missing parent as incomplete rather than unrelated with certainty', () => {
    const relation = relateUniverses(
      { id: 'u1', title: 'A', parentId: 'gone' },
      { id: 'u2', title: 'B' },
      []
    );
    expect(relation.kind).toBe('unrelated');
    expect(relation.incomplete).toBe(true);
    expect(relation.label).toContain('parent universes are no longer saved');
  });

  it('says plainly when it is the same universe', () => {
    const doc = makeDoc();
    const relation = relateUniverses(
      { id: doc.id, title: doc.title },
      { id: doc.id, title: doc.title },
      []
    );
    expect(relation.kind).toBe('same');
    expect(relation.label).toContain('same universe');
  });
});

describe('buildUniverseDiff — assumptions', () => {
  it('finds the assumption that was changed to make the fork', () => {
    const parent = makeDoc();
    const child = childOfFunds(parent);
    const diff = buildUniverseDiff(parent, child, ALL_PACKS, { refs: refsOf(parent, child) });

    expect(diff.relationship.kind).toBe('b-from-a');
    expect(diff.relationship.commonAncestor?.id).toBe(parent.id);
    expect(diff.changedAssumptions).toHaveLength(1);
    const change = diff.changedAssumptions[0]!;
    expect(change.key).toBe('a.funds');
    expect(change.kind).toBe('changed');
    expect(change.a).toBe(parent.assumptions.find((a) => a.id === 'a.funds')?.value);
    expect(change.b).toBe(25_000);
    expect(change.delta).toBe(change.b! - change.a!);
    expect(change.aText).not.toBe(change.bText);
    // The unchanged assumptions are counted, not listed as differences.
    expect(diff.sharedAssumptionCount).toBe(parent.assumptions.length - 1);

    // The child's own record of the fork is surfaced, not just inferred.
    expect(diff.lineageNotes.join(' ')).toContain('Rebuilt from the same seed');
  });

  it('reports assumptions that exist on one side only', () => {
    const a = makeDoc();
    const b: SimulationDoc = {
      ...a,
      id: 'crafted',
      assumptions: [
        ...a.assumptions.filter((x) => x.id !== 'a.costs'),
        {
          id: 'a.childcare',
          label: 'Childcare',
          varKey: 'expenses',
          unit: 'currency',
          baseValue: 900,
          value: 900,
          rationale: 'A cost only this universe models.',
          sensitivity: 0,
          editable: true,
        },
      ],
    };

    const diff = buildUniverseDiff(a, b, ALL_PACKS);
    expect(diff.changedAssumptions.map((x) => [x.key, x.kind])).toEqual([
      ['a.costs', 'only-a'],
      ['a.childcare', 'only-b'],
    ]);
    const onlyB = diff.changedAssumptions.find((x) => x.key === 'a.childcare');
    expect(onlyB?.aText).toBe('—');
    expect(onlyB?.delta).toBeNull();
  });

  it('says so when the two universes start from the same assumptions', () => {
    const doc = makeDoc();
    const diff = buildUniverseDiff(doc, doc, ALL_PACKS);
    expect(diff.relationship.kind).toBe('same');
    expect(diff.changedAssumptions).toEqual([]);
    expect(diff.sharedAssumptionCount).toBe(doc.assumptions.length);
    expect(diff.headline).toContain('same assumptions');
    expect(diff.paths.every((p) => p.diffCount === 0)).toBe(true);
  });
});

describe('buildUniverseDiff — outcomes', () => {
  it('compares the paths that correspond, at one common moment', () => {
    const parent = makeDoc();
    const child = childOfFunds(parent);
    const diff = buildUniverseDiff(parent, child, ALL_PACKS, { refs: refsOf(parent, child) });

    expect(diff.paths.length).toBeGreaterThan(0);
    expect(diff.onlyA).toEqual([]);
    expect(diff.onlyB).toEqual([]);
    expect(diff.compareMonth).toBeGreaterThanOrEqual(
      Math.max(parent.prompt.horizon, child.prompt.horizon)
    );
    expect(diff.compareLabel.length).toBeGreaterThan(0);

    // Paths are paired by name, not by their positional branch id.
    const parentPaths = Object.values(parent.branches).map((b) => b.name);
    for (const path of diff.paths) {
      expect(parentPaths).toContain(path.name);
      expect(path.aEndTitle.length).toBeGreaterThan(0);
      expect(path.bEndTitle.length).toBeGreaterThan(0);
    }
  });

  it('points "favours" the way the model thinks is better', () => {
    const parent = makeDoc();
    const diff = buildUniverseDiff(parent, childOfFunds(parent), ALL_PACKS);
    for (const path of diff.paths) {
      for (const m of path.metrics) {
        const def = ALL_VARS.find((v) => v.key === m.key);
        if (!def) continue;
        if (m.favours === 'b') expect(isBetter(m.delta, def)).toBe(true);
        else if (m.favours === 'a') expect(isBetter(-m.delta, def)).toBe(true);
        else {
          expect(isBetter(m.delta, def)).toBe(false);
          expect(isBetter(-m.delta, def)).toBe(false);
        }
      }
    }
  });

  it('does not invent a pairing when the fork chooses a different decision', () => {
    const parent = makeDoc();
    const labels = new Set(
      Object.values(parent.nodes)
        .filter((n) => n.type === 'decision' && n.depth === 1)
        .map((n) => n.title)
    );
    const option = Object.values(ARCHETYPE_OPTIONS)
      .flat()
      .find((o) => !labels.has(o.label));
    expect(option).toBeDefined();
    if (!option) return;

    const result = applyDecisionChange(parent, option.id, ALL_PACKS);
    if ('error' in result) throw new Error(result.error);

    const diff = buildUniverseDiff(parent, result.doc, ALL_PACKS);
    expect(diff.relationship.kind).toBe('b-from-a');
    expect(diff.lineageNotes.join(' ')).toContain('Initial decision');
    expect(diff.paths).toEqual([]);
    expect(diff.onlyA.length).toBeGreaterThan(0);
    expect(diff.onlyB.length).toBeGreaterThan(0);
    expect(diff.headline).toContain('share no path');
  });

  it('never compares one random draw against another without saying so', () => {
    const a = makeDoc({}, 42);
    const b = makeDoc({}, 1234);
    const diff = buildUniverseDiff(a, b, ALL_PACKS);
    expect(diff.sameSeed).toBe(false);
    expect(diff.relationship.kind).toBe('unrelated');
    expect(diff.verdict).toContain('different random draws');
  });

  it('flags a different question instead of treating it as a version', () => {
    const a = makeDoc();
    const b = makeDoc({ decision: 'Should I move to another city?' });
    const diff = buildUniverseDiff(a, b, ALL_PACKS);
    expect(diff.sameQuestion).toBe(false);
    expect(diff.setupDifferences).toContain('the decision under consideration');
    expect(diff.headline).toContain('different questions');
    expect(diff.verdict).toContain('separate answers');
  });

  it('compares horizons at the furthest moment either universe models', () => {
    const a = makeDoc();
    const b = makeDoc({ horizon: 36 });
    const diff = buildUniverseDiff(a, b, ALL_PACKS);
    expect(diff.sameQuestion).toBe(true);
    expect(diff.setupDifferences).toContain('the time horizon (24 vs 36 months)');
    expect(diff.compareMonth).toBeGreaterThanOrEqual(36);
  });

  it('is deterministic and order-sensitive only in labelling', () => {
    const parent = makeDoc();
    const child = childOfFunds(parent);
    const first = buildUniverseDiff(parent, child, ALL_PACKS);
    const second = buildUniverseDiff(parent, child, ALL_PACKS);
    expect(first.headline).toBe(second.headline);
    expect(first.paths.map((p) => [p.name, p.diffCount])).toEqual(
      second.paths.map((p) => [p.name, p.diffCount])
    );

    const swapped = buildUniverseDiff(child, parent, ALL_PACKS);
    expect(swapped.relationship.kind).toBe('a-from-b');
    expect(swapped.paths.map((p) => p.name).sort()).toEqual(first.paths.map((p) => p.name).sort());
  });
});
