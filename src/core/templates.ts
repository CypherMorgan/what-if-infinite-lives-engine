/**
 * Scenario templates.
 *
 * A template is a starting point, not an answer: it fills in the question and
 * the shape of the exploration, and nothing else. In particular it never
 * invents the user's money. The figures the engine needs come from what the
 * person types into "What you have", and when that is empty the generated
 * assumptions say they are mid-range defaults rather than presenting numbers
 * as if they were read from the situation.
 *
 * The text is deliberately ordinary, everyday language — it is what the
 * archetype detector and the rule packs read, so it has to be the kind of
 * sentence a person would actually write.
 */
import type { ScenarioPrompt } from './types';

export interface ScenarioTemplate {
  id: string;
  /** Short name for the picker. */
  title: string;
  /** One line saying which decision this is. */
  blurb: string;
  situation: string;
  decision: string;
  goals: string[];
  /** Months. */
  horizon: number;
  /** How many top-level paths to offer. */
  branchCount: number;
  /** 0 = grounded, 1 = speculative. */
  imagination: number;
  /** Placeholder for the "What you have" field — an example, never a value. */
  resourcesHint: string;
  /** Hard limits the person has already told us about. */
  constraints: string[];
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'job-offer',
    title: 'The job offer',
    blurb: 'A competing offer, a counter-offer, or staying where you are.',
    situation:
      'I have been in my current role for a few years. I have an offer from another company that pays more, but I would lose the people and the flexibility I have built up here. My current employer may counter-offer if I tell them.',
    decision:
      'Should I take the new job, use the offer to renegotiate where I am, or stay and ask for a promotion later?',
    goals: ['financial stability', 'learning', 'time with the people I care about'],
    horizon: 36,
    branchCount: 3,
    imagination: 0.4,
    resourcesHint: 'savings 14000, income 3200, rent 1200',
    constraints: ['notice period', 'current rent'],
  },
  {
    id: 'the-move',
    title: 'The move',
    blurb: 'Relocating for work, money or a different life — or staying put.',
    situation:
      'I am considering moving to another city or country. The move would change my rent, my commute, my income and who I see every week. People I am close to would stay behind, and building a new circle would take time.',
    decision: 'Should I move, stay where I am, or try a temporary stay before deciding?',
    goals: ['affordability', 'a life I actually want', 'closeness to family'],
    horizon: 36,
    branchCount: 3,
    imagination: 0.5,
    resourcesHint: 'savings 14000, income 3200, rent 1200',
    constraints: ['visa or paperwork', 'family commitments'],
  },
  {
    id: 'the-child',
    title: 'The child',
    blurb: 'Whether to have a child, and what it changes about work and time.',
    situation:
      'My partner and I are deciding whether to have a child. It would change our income, our housing, how much time we have for work and for each other, and how much help we could rely on. Neither of us is certain, and the timing matters to both of us.',
    decision: 'Should we try for a child now, wait, or decide not to?',
    goals: ['a family life we can sustain', 'financial stability', 'not losing ourselves'],
    horizon: 60,
    branchCount: 3,
    imagination: 0.45,
    resourcesHint: 'savings 14000, income 3200, rent 1200',
    constraints: ['childcare availability', 'family support'],
  },
  {
    id: 'the-pivot',
    title: 'The pivot',
    blurb: 'Leaving steady work to build something of your own.',
    situation:
      'I have a steady job and an idea I keep coming back to. Building it would mean giving up predictable income, working with clients or customers, and finding out whether people will pay for it. I could also build it on the side first.',
    decision: 'Should I quit to build it, build it on the side, or keep the job and drop the idea?',
    goals: ['independence', 'income that does not depend on one employer', 'work I chose'],
    horizon: 36,
    branchCount: 3,
    imagination: 0.55,
    resourcesHint: 'savings 14000, income 3200, monthly costs 1700',
    constraints: ['runway', 'current rent'],
  },
  {
    id: 'back-to-study',
    title: 'Back to study',
    blurb: 'A degree or qualification, part time, or learning on the job.',
    situation:
      'I am thinking about going back to study. A full degree would cost tuition and years of reduced income; a part-time course would be slower but safer; and I could learn the same skills through work and practice instead. I am not sure the qualification is what actually opens the door.',
    decision: 'Should I study full time, study part time, or build the skills without a course?',
    goals: ['a better career', 'mastery', 'not taking on debt I cannot carry'],
    horizon: 60,
    branchCount: 3,
    imagination: 0.35,
    resourcesHint: 'savings 14000, income 3200, tuition 9000',
    constraints: ['tuition cost', 'hours available'],
  },
  {
    id: 'buy-or-rent',
    title: 'Buy or rent',
    blurb: 'Committing to a mortgage, renting, or leaving the city open.',
    situation:
      'I am deciding whether to buy a place or keep renting. Buying would tie up my savings, fix my monthly cost and tie me to one city; renting keeps me flexible but the rent keeps moving. I do not know how long I want to stay.',
    decision: 'Should I buy now, keep renting, or rent somewhere cheaper and save the difference?',
    goals: ['a stable monthly cost', 'freedom to move', 'not being house-poor'],
    horizon: 60,
    branchCount: 3,
    imagination: 0.35,
    resourcesHint: 'savings 30000, income 3200, rent 1200',
    constraints: ['deposit', 'how long I plan to stay'],
  },
];

/** Looks a template up by id; `undefined` when it is not in the catalogue. */
export function templateById(id: string): ScenarioTemplate | undefined {
  return SCENARIO_TEMPLATES.find((t) => t.id === id);
}

/**
 * The parts of a scenario prompt a template can supply.
 *
 * Ids and archetypes are not part of this: the engine detects them from the
 * text, so a template cannot smuggle in a different rule set than its own
 * words justify.
 */
export function promptFromTemplate(template: ScenarioTemplate): Omit<ScenarioPrompt, 'archetypes'> {
  return {
    situation: template.situation,
    decision: template.decision,
    goals: [...template.goals],
    constraints: [...template.constraints],
    horizon: template.horizon,
    branchCount: template.branchCount,
    imagination: template.imagination,
    resources: [],
    title: template.title,
  };
}
