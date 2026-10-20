/**
 * Business pack: building something people pay for, and the failure modes that are
 * structural rather than personal.
 *
 * The mechanism this pack models is that a new venture fails on cash timing, scope and
 * fixed obligations long before it fails on demand. Growth consumes money, hiring converts
 * flexibility into payroll, and the useful signal usually arrives while the price is still
 * set to win the first customers rather than to reflect the value.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'business.first-customers',
    label: 'People who owe you nothing pay',
    summary:
      'The first money arrives from buyers outside your own network, which is categorically different from friends, favours and pilot users. It prices the offer, proves the message can survive contact with strangers, and turns months of guesswork into a very small, very noisy dataset.',
    detail:
      'The payment matters less than its source. Money from people who chose you carries information that money from people who like you does not.',
    requires: ['business'],
    type: 'opportunity',
    when: { all: [{ key: 'skill:business-building', op: '>=', value: 20 }] },
    weight: 11,
    monthsMin: 2,
    monthsMax: 48,
    durationMonths: 2,
    cooldown: 14,
    once: true,
    effects: [
      { key: 'money', op: 'add', value: 1800, noise: 0.7, reason: 'first payments from unrelated buyers' },
      { key: 'income', op: 'add', value: 480, noise: 0.6, reason: 'revenue from early customers' },
      { key: 'marketFit', op: 'add', value: 12, reason: 'evidence that strangers will pay for this' },
      { key: 'skill:business-building', op: 'add', value: 8, reason: 'learning what actually closes a sale' },
      { key: 'optionality', op: 'add', value: 8, reason: 'an offer that has been proven repeatable once' },
      { key: 'stress', op: 'add', value: -6, reason: 'the central question stops being hypothetical' },
    ],
    assumptions: ["Early buyers are unrelated to the founder's own network; otherwise the signal is weaker than modelled."],
    uncertainties: ['Whether they buy again; a first purchase proves curiosity rather than retention.'],
    evidence: [
      { cls: 'assumption', text: 'Payment from strangers is treated as the first meaningful market signal available.' },
    ],
    tradeoffs: {
      gains: ['Real price information and an offer someone else has already said yes to.'],
      costs: ['Delivery obligations begin the moment the first invoice is paid.'],
    },
    nextSteps: ['Ask every early buyer what they almost bought instead.'],
    imagination: 0,
  },
  {
    id: 'business.promise-undelivered',
    label: 'A promise the work cannot keep',
    summary:
      'A deadline, a feature list or a level of quality was committed to before the work was understood, which is the normal case in bespoke work rather than a lapse of judgement. Now either the customer absorbs the failure or you absorb it in unpaid hours, and the second option is chosen far more often than anyone prices in.',
    detail:
      'Estimation before understanding is the root cause. The reputational cost lands immediately while the lesson takes months to be usable.',
    requires: ['business'],
    type: 'setback',
    when: { all: [{ key: 'skill:business-building', op: '>=', value: 30 }] },
    weight: 8,
    monthsMin: 4,
    monthsMax: 72,
    durationMonths: 3,
    cooldown: 16,
    effects: [
      { key: 'projectHealth', op: 'add', value: -10, reason: 'delivery gap against what was sold' },
      { key: 'reputation', op: 'add', value: -9, reason: 'a commitment missed in front of a customer' },
      { key: 'stress', op: 'add', value: 11, reason: 'scrambling to close the gap' },
      { key: 'money', op: 'add', value: -1400, noise: 0.6, reason: 'refund, penalty or unbilled overtime' },
      { key: 'energy', op: 'add', value: -7, reason: 'unpaid hours absorbed to rescue the work' },
      { key: 'information', op: 'add', value: 8, reason: 'a precise reading of true delivery cost' },
    ],
    assumptions: ['Scope is estimated before the work is understood, which is the ordinary condition in bespoke delivery.'],
    uncertainties: ['Whether the client absorbs it; some do, some do not, and this is not knowable in advance.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a scaling and estimation problem rather than as a character flaw.' },
    ],
    tradeoffs: {
      gains: ['A hard, cheap lesson in what delivery actually costs.'],
      costs: ['The reputation cost arrives before the lesson does.'],
    },
    failurePoints: ['Repeating it converts a hard lesson into a pattern that no apology fixes.'],
    nextSteps: ['Quote the next commitment in weeks, with one named risk attached to it.'],
    imagination: 0,
  },
  {
    id: 'business.product-market-signal',
    label: 'The signal arrives, and the price is wrong',
    summary:
      'Demand starts appearing without being chased: the same offer bought twice by strangers, asked for again, or referred onward. That is the only evidence separating a real market from encouragement, and it usually lands while the price is still set low to win the first customers, so correcting the price is the immediate lever and a bet on the value being legible.',
    detail:
      'Two things happen together here. Repeated unprompted demand resolves the central uncertainty, and it hands you the standing to charge what the work is worth.',
    requires: ['business'],
    type: 'milestone',
    when: { all: [{ key: 'audience', op: '>=', value: 30 }] },
    weight: 6,
    monthsMin: 6,
    monthsMax: 72,
    durationMonths: 4,
    cooldown: 24,
    once: true,
    effects: [
      { key: 'marketFit', op: 'add', value: 14, reason: 'repeat, unprompted demand' },
      { key: 'income', op: 'add', value: 560, noise: 0.55, reason: 'revenue at a corrected price' },
      { key: 'optionality', op: 'add', value: 9, reason: 'more than one buyer wants the same thing' },
      { key: 'reputation', op: 'add', value: 7, reason: 'customers vouch without being asked' },
      { key: 'goalProgress', op: 'add', value: 10, reason: 'the central uncertainty of a new venture resolves' },
      { key: 'risk', op: 'add', value: 5, reason: 'a higher price is a bet on the value being legible' },
    ],
    assumptions: ['Repeat demand is distinguishable from one-off interest within a few months of trading.'],
    uncertainties: ['Whether the market will accept the corrected price; willingness to pay does not survive doubling silently.'],
    evidence: [
      { cls: 'assumption', text: 'Treated as a threshold event, not a rate; the trigger is deliberately vague because timing is unknowable.' },
    ],
    tradeoffs: {
      gains: ['Permission to stop guessing about what the offer is worth.'],
      costs: ['Raising the price risks the very customers whose demand proved the point.'],
    },
    nextSteps: ['Raise the price on the next new customer only, and watch what happens to conversion.'],
    imagination: 0.1,
  },
  {
    id: 'business.cash-flow-crunch',
    label: 'Solvent on paper, broke this month',
    summary:
      'Revenue exists and may even be growing, and the money still is not there when the bills land. Invoices run at thirty or sixty days while suppliers, payroll and rent run at zero, so growth itself consumes cash faster than a flat month would. This is a timing problem that looks exactly like a survival problem from the inside.',
    requires: ['business'],
    type: 'setback',
    when: { all: [{ key: 'money', op: '<', value: 9000 }, { key: 'projectHealth', op: '>=', value: 30 }] },
    weight: 7,
    monthsMin: 4,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 18,
    effects: [
      { key: 'money', op: 'add', value: -3200, noise: 0.55, reason: 'obligations land before receivables clear' },
      { key: 'risk', op: 'add', value: 14, reason: 'one late payment becomes existential' },
      { key: 'stress', op: 'add', value: 12, reason: 'payroll and suppliers against a thin balance' },
      { key: 'optionality', op: 'add', value: -7, reason: 'every decision made for cash rather than for fit' },
      { key: 'expenses', op: 'add', value: 170, noise: 0.5, reason: 'late fees and financing costs' },
      { key: 'information', op: 'add', value: 6, reason: 'the cash cycle is now understood precisely' },
    ],
    assumptions: ['Receivables lag payables, and growth widens that gap rather than closing it.'],
    uncertainties: ['Whether a payment arrives in time; this is timing rather than solvency, and the difference is only visible afterwards.'],
    evidence: [
      { cls: 'assumption', text: 'The mismatch is modelled as structural to invoiced work, not as evidence of poor management.' },
    ],
    tradeoffs: {
      gains: ['A precise model of the cash cycle, which is the skill most founders never acquire.'],
      costs: ['Short-term decisions taken for cash rather than for the business.'],
    },
    failurePoints: ['Dilutive financing grabbed in a hurry is the expensive way out of what was only a timing problem.'],
    nextSteps: ['Roll the next thirteen weeks of cash weekly, before negotiating anything else.'],
    imagination: 0,
  },
  {
    id: 'business.key-partner',
    label: 'Letting someone into the decisions',
    summary:
      'There is more work than one person can carry, so the choice is who to admit to the decision-making, and on what terms. A partner or a first hire multiplies capacity and coordination cost together, and the split agreed in a hurry now is the one that will be argued about when there is finally something worth splitting.',
    detail:
      'Hiring converts a flexible cost into a fixed one. The leverage arrives after a ramp during which the cash effects are entirely negative.',
    requires: ['business'],
    type: 'decision',
    when: { all: [{ key: 'marketFit', op: '>=', value: 35 }, { key: 'stress', op: '>=', value: 35 }] },
    weight: 6,
    monthsMin: 6,
    monthsMax: 84,
    durationMonths: 4,
    cooldown: 24,
    once: true,
    effects: [
      { key: 'skill:business-building', op: 'add', value: 8, reason: 'delegation and hiring are new skills' },
      { key: 'leverage', op: 'add', value: 12, reason: "output no longer capped by one person's hours" },
      { key: 'money', op: 'add', value: -2600, noise: 0.5, reason: 'recruitment and onboarding before any return' },
      { key: 'expenses', op: 'add', value: 900, noise: 0.4, reason: 'payroll committed every month from now on' },
      { key: 'risk', op: 'add', value: 8, reason: 'a fixed obligation the revenue does not yet guarantee' },
      { key: 'wellbeing', op: 'add', value: 7, reason: 'load that was previously carried alone' },
    ],
    assumptions: ['Capacity is the binding constraint at this stage rather than demand.'],
    uncertainties: ['Whether the person brought in is the right one; no model can know that before the fact.'],
    evidence: [
      { cls: 'assumption', text: 'Delegation raises leverage only after a ramp, and the ramp cost is included in the cash effects.' },
    ],
    tradeoffs: {
      gains: ['Capacity, cover, and someone who can say no to bad work.'],
      costs: ['A fixed monthly obligation and a share of every decision after it.'],
    },
    failurePoints: ['Hiring before the offer is repeatable converts a capacity problem into a payroll problem.'],
    nextSteps: ['Write down exactly which decisions this person owns before the first conversation.'],
    imagination: 0,
  },
  {
    id: 'business.graceful-shutdown',
    label: 'Winding it down without drama',
    summary:
      "The venture stops on your terms rather than on a creditor's schedule. Contracts are completed or transferred, the people who are owed are paid first, and what remains is a set of assets, a reputation, a skill, a list of customers, that can be redeployed into whatever is attempted next.",
    detail:
      'Modelled as an orderly wind-down rather than a collapse. The optionality effect is deliberate: closing well returns attention and capital instead of consuming them.',
    requires: ['business'],
    type: 'ending',
    when: { all: [{ key: 'projectHealth', op: '<=', value: 25 }] },
    weight: 3,
    monthsMin: 10,
    monthsMax: 120,
    durationMonths: 5,
    once: true,
    effects: [
      { key: 'money', op: 'add', value: -1800, noise: 0.6, reason: 'closing costs, refunds and final obligations' },
      { key: 'income', op: 'mul', value: 0.12, reason: 'most revenue stops as contracts are transferred' },
      { key: 'expenses', op: 'add', value: -700, reason: 'recurring commitments ended' },
      { key: 'stress', op: 'add', value: -15, reason: 'the obligation consuming the attention is gone' },
      { key: 'optionality', op: 'add', value: 10, reason: 'capital and attention returned to the next attempt' },
      { key: 'goalProgress', op: 'add', value: -12, reason: 'the stated goal is given up rather than reached' },
    ],
    assumptions: ['The business can be closed with obligations met; an insolvent shutdown is a different path entirely.'],
    uncertainties: ['What the market makes of the closure; some endings cost reputation and others cost nothing.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a deliberate wind-down, not as bankruptcy, abandonment or a forced sale.' },
    ],
    tradeoffs: {
      gains: ['Cash, attention and options returned, plus a complete dataset on what did not work.'],
      costs: ['The goal is given up in public, and the money already spent stays spent.'],
    },
    nextSteps: ['Pay the people who are owed before taking anything out yourself.'],
    imagination: 0.1,
  },
];

export const BUSINESS_PACK: RulePack = {
  id: 'business',
  name: 'Building a business',
  description:
    'First customers, delivery promises made before the work was understood, the market signal and the price that follows it, cash timing, taking on a partner, and closing well.',
  vars: [],
  rules,
  startingModifiers: [],
};
