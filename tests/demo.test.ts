/**
 * The first-run universe.
 *
 * This is the one document every new install sees before it has been given
 * anything, so it has to be real (built by the engine, not a mock-up), it has
 * to answer the question it asks, and it must not pretend the sample figures
 * came from the person opening the app.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_TITLE, demoPrompt, demoUniverse } from '../src/core/demo';
import type { SimulationDoc } from '../src/core/types';

/** The shape of a document without its randomly generated ids. */
function shape(doc: SimulationDoc): string[] {
  return Object.values(doc.nodes)
    .map((node) => `${node.t}|${node.type}|${node.title}|${node.state?.['money'] ?? ''}`)
    .sort();
}

describe('Demo universe — the question', () => {
  it('opens with a three-way life fork, not a grievance at work', () => {
    const prompt = demoPrompt();
    expect(prompt.title).toBe(DEMO_TITLE);
    expect(prompt.situation.startsWith('I have a steady job')).toBe(true);
    expect(prompt.goals).toHaveLength(3);
    expect(prompt.horizon).toBeGreaterThanOrEqual(24);
  });

  it('asks a question the first three branches actually answer', () => {
    const doc = demoUniverse(42);
    const branches = Object.values(doc.branches).filter((branch) => branch.id !== 'b0');
    expect(branches).toHaveLength(3);

    const labels = branches
      .map((branch) => doc.nodes[branch.root]?.title)
      .filter((title): title is string => typeof title === 'string')
      .sort();

    // These are the engine's own branch names. The demo question is written
    // around them so the first graph is not about something else.
    expect(labels).toEqual(['Cut costs and extend runway', 'Move abroad', 'Take a steady job']);
  });

  it('activates the packs the words describe', () => {
    const prompt = demoPrompt();
    expect(prompt.archetypes).toEqual(
      expect.arrayContaining(['career', 'relocation', 'finance', 'relationships'])
    );

    const doc = demoUniverse(42);
    expect(doc.prompt.archetypes).toEqual(prompt.archetypes);
  });
});

describe('Demo universe — the document', () => {
  it('is a real simulation, not a placeholder', () => {
    const doc = demoUniverse(42);
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(10);
    expect(Object.keys(doc.edges).length).toBeGreaterThan(10);
    for (const node of Object.values(doc.nodes)) {
      expect(node.title.length).toBeGreaterThan(0);
      expect(node.summary.length).toBeGreaterThan(0);
    }
    expect(Object.values(doc.nodes).some((node) => node.delta && node.delta.length > 0)).toBe(true);
  });

  it('uses the sample figures that are written on the card', () => {
    const doc = demoUniverse(42);
    const start = Object.values(doc.nodes).find((node) => node.type === 'start');
    expect(start?.state?.['money']).toBe(24000);
    expect(start?.state?.['income']).toBe(3600);
    expect(start?.state?.['expenses']).toBe(1900);

    const byKey = new Map(doc.assumptions.map((a) => [a.varKey, a]));
    expect(byKey.get('money')?.value).toBe(24000);
    expect(byKey.get('income')?.value).toBe(3600);
    expect(byKey.get('expenses')?.value).toBe(1900);
    expect(byKey.get('money')?.editable).toBe(true);
  });

  it('is deterministic for a pinned seed', () => {
    expect(shape(demoUniverse(7))).toEqual(shape(demoUniverse(7)));
  });

  it('does not clip the situation on the card', () => {
    const doc = demoUniverse(42);
    const start = Object.values(doc.nodes).find((node) => node.type === 'start');
    expect(start?.summary).toBe(demoPrompt().situation);
    expect(start?.summary.endsWith('.')).toBe(true);
  });
});
