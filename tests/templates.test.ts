/**
 * Scenario-template tests.
 *
 * A template is a starting point, so the things worth guarding are boring and
 * important: every template produces a universe, none of them invents money,
 * each one activates the rule packs its own words imply, and the catalogue is
 * internally consistent enough that the picker cannot render a dead card.
 */
import { describe, expect, it } from 'vitest';
import { detectArchetypes } from '../src/core/archetypes';
import { createUniverse } from '../src/core/engine';
import { ALL_PACKS } from '../src/core/packs';
import {
  SCENARIO_TEMPLATES,
  promptFromTemplate,
  templateById,
  type ScenarioTemplate,
} from '../src/core/templates';

/** Builds the document a template would create, with a fixed seed. */
function build(template: ScenarioTemplate) {
  const prompt = promptFromTemplate(template);
  return createUniverse({
    packs: ALL_PACKS,
    seed: 4242,
    prompt: {
      ...prompt,
      archetypes: detectArchetypes(
        `${prompt.situation} ${prompt.decision} ${prompt.goals.join(' ')}`
      ),
    },
  });
}

describe('Scenario templates — the catalogue', () => {
  it('has a unique, non-empty id for every template', () => {
    const ids = SCENARIO_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('writes a usable question on every card', () => {
    for (const t of SCENARIO_TEMPLATES) {
      expect(t.title.length, t.id).toBeGreaterThan(2);
      expect(t.blurb.length, t.id).toBeGreaterThan(10);
      expect(t.situation.length, t.id).toBeGreaterThan(40);
      expect(t.decision.length, t.id).toBeGreaterThan(20);
      expect(t.goals.length, t.id).toBeGreaterThan(0);
      expect(t.constraints.length, t.id).toBeGreaterThan(0);
    }
  });

  it('offers horizons, branch counts and imagination the engine accepts', () => {
    const horizons = new Set([12, 24, 36, 60, 120]);
    for (const t of SCENARIO_TEMPLATES) {
      expect(horizons.has(t.horizon), `${t.id}: horizon ${t.horizon}`).toBe(true);
      expect(t.branchCount, t.id).toBeGreaterThanOrEqual(2);
      expect(t.branchCount, t.id).toBeLessThanOrEqual(5);
      expect(t.imagination, t.id).toBeGreaterThanOrEqual(0);
      expect(t.imagination, t.id).toBeLessThanOrEqual(1);
    }
  });

  it('never puts invented money in the user’s mouth', () => {
    // The hint under "What you have" is an example placeholder, not data, and
    // is explicitly allowed to contain figures. The prose is not.
    for (const t of SCENARIO_TEMPLATES) {
      const prose = [t.situation, t.decision, ...t.goals, ...t.constraints].join(' ');
      expect(prose, t.id).not.toMatch(/[$€£]\s*\d/);
      expect(prose, t.id).not.toMatch(/\b\d{3,}\b/);
      expect(promptFromTemplate(t).resources, t.id).toEqual([]);
    }
  });

  it('activates a specific rule pack, not just the two permanent ones', () => {
    // `time` and `finance` are always appended, so a template that only
    // detected those would be a generic form with a nice title.
    for (const t of SCENARIO_TEMPLATES) {
      const detected = detectArchetypes(`${t.situation} ${t.decision} ${t.goals.join(' ')}`);
      const specific = detected.filter((id) => id !== 'time' && id !== 'finance');
      expect(specific.length, `${t.id} detected only ${detected.join(', ')}`).toBeGreaterThan(0);
    }
  });

  it('finds a template by id and returns nothing for an unknown one', () => {
    expect(templateById('the-move')?.title).toBe('The move');
    expect(templateById('not-a-template')).toBeUndefined();
  });

  it('hands out copies, so editing a prompt cannot change the catalogue', () => {
    const template = templateById('job-offer');
    if (!template) throw new Error('missing fixture');
    const prompt = promptFromTemplate(template);
    prompt.goals.push('something else');
    prompt.constraints.length = 0;
    expect(template.goals).not.toContain('something else');
    expect(template.constraints.length).toBeGreaterThan(0);
  });
});

describe('Scenario templates — building a universe', () => {
  for (const template of SCENARIO_TEMPLATES) {
    it(`builds a real, deterministic universe for “${template.title}”`, () => {
      const first = build(template);
      const second = build(template);

      expect(first.nodes).toEqual(second.nodes);
      expect(first.edges).toEqual(second.edges);
      expect(first.branches).toEqual(second.branches);

      // More than a start node and one path: the template has to lead
      // somewhere a person can actually explore.
      expect(Object.keys(first.nodes).length).toBeGreaterThan(8);
      expect(Object.keys(first.branches).length).toBeGreaterThanOrEqual(2);
      const start = Object.values(first.nodes).find((n) => n.type === 'start');
      expect(start?.title).toBe(template.title);
      expect(first.prompt.horizon).toBe(template.horizon);
      expect(first.prompt.constraints).toEqual(template.constraints);
    });
  }

  it('reads the figures the person supplies into the starting assumptions', () => {
    const template = templateById('the-pivot');
    if (!template) throw new Error('missing fixture');
    const prompt = promptFromTemplate(template);
    const doc = createUniverse({
      packs: ALL_PACKS,
      seed: 7,
      prompt: {
        ...prompt,
        resources: ['savings 21000', 'income 3400', 'monthly costs 1500'],
        archetypes: detectArchetypes(`${prompt.situation} ${prompt.decision}`),
      },
    });
    const value = (key: string): number | undefined =>
      doc.assumptions.find((a) => a.varKey === key)?.value;
    expect(value('money')).toBe(21_000);
    expect(value('income')).toBe(3_400);
    expect(value('expenses')).toBe(1_500);
  });

  it('labels unsupplied figures as defaults instead of inventing them', () => {
    const template = templateById('the-child');
    if (!template) throw new Error('missing fixture');
    const doc = build(template);
    const funds = doc.assumptions.find((a) => a.id === 'a.funds');
    expect(funds?.rationale).toMatch(/Not stated/);
  });
});
