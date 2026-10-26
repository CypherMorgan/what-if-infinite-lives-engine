/**
 * The universe a first launch opens with.
 *
 * It is a real document, built by the same offline engine as any other: the
 * first window is never an empty shell and never a mock-up. The question is a
 * three-way life fork on purpose. For these words the engine selects exactly
 * three top-level branches — taking the job, moving abroad, and cutting costs
 * to buy time — so the first graph a person sees answers the question on the
 * card instead of wandering off in unrelated directions.
 *
 * The figures are sample figures, and the assumptions they produce are
 * editable like any other universe's. They are here so the first graph has
 * something concrete to model, not because the app knows anything about the
 * person opening it.
 */
import { detectArchetypes } from './archetypes';
import { createUniverse } from './engine';
import { getActivePacks } from './packs';
import { randomSeed } from './rng';
import type { ScenarioPrompt, SimulationDoc } from './types';

export const DEMO_TITLE = 'The offer abroad';

const SITUATION =
  'I have a steady job and an offer to do similar work in another country. Taking it means a ' +
  'higher salary, a city where I know nobody, and leaving the friends and family I see every ' +
  'week. I could also stay where I am, or cut my costs and give myself a year to decide.';

const DECISION =
  'Should I take the job abroad, stay in the job I have, or cut my costs and give myself a year ' +
  'to decide?';

const GOALS = ['work that stretches me', 'financial security', 'people I can count on'];

/**
 * The starting point, in the same shape the new-universe form produces.
 *
 * Archetypes are detected from the same three fields the form reads — the
 * situation, the decision and the goals — so the first launch cannot claim a
 * rule pack that the form would not have activated for the same words.
 */
export function demoPrompt(): ScenarioPrompt {
  const archetypes = detectArchetypes(`${SITUATION} ${DECISION} ${GOALS.join(' ')}`);
  return {
    situation: SITUATION,
    decision: DECISION,
    goals: [...GOALS],
    constraints: ['current rent', 'visa and paperwork'],
    horizon: 36,
    branchCount: 3,
    imagination: 0.45,
    resources: ['savings 24000', 'income 3600', 'monthly costs 1900'],
    archetypes: archetypes.length > 0 ? archetypes : ['career', 'finance', 'relocation'],
    title: DEMO_TITLE,
  };
}

/** A complete first-run universe. The seed is a parameter so tests can pin it. */
export function demoUniverse(seed: number = randomSeed()): SimulationDoc {
  return createUniverse({ packs: getActivePacks(), seed, prompt: demoPrompt() });
}
