/**
 * The finance pack: how a path responds when money is one of the constraints.
 *
 * These rules model the mechanics that do not care about intentions — burn rate, buffers,
 * debt servicing, and costs repriced by other people — so that financial pressure appears
 * as a set of interacting quantities rather than as a mood. Weights are relative to the
 * other rules eligible at the same moment; they are never probabilities of anything
 * happening in a real life.
 */
import type { Rule, RulePack } from '../rulePack';

const FINANCE_RULES: Rule[] = [
  {
    id: 'finance.lean-runway-discipline',
    requires: ['finance'],
    label: 'Cutting everything that is not essential',
    summary:
      "With funds thin, the budget becomes a survival instrument: a flat monthly draw replaces lumpy spending, and anything that is not required is dropped for now. The balance stops falling as fast, which is the entire point. The same discipline quietly closes social and professional doors that cost money to walk through.",
    detail:
      "Runway is funds divided by net burn, so cutting monthly costs extends it without new income. The model refuses to treat thrift as free: cheaper months are also narrower months, and the cut has to be sustainable to be worth anything.",
    type: 'consequence',
    when: { all: [{ key: 'money', op: '<=', value: 4000 }] },
    weight: 13,
    monthsMin: 2,
    monthsMax: 84,
    durationMonths: 3,
    cooldown: 10,
    effects: [
      { key: 'expenses', op: 'add', value: -210, reason: 'discretionary spending removed' },
      { key: 'optionality', op: 'add', value: -5, reason: 'cheaper months are narrower months' },
      { key: 'variance', op: 'add', value: -6, reason: 'a fixed draw instead of lumpy spending' },
      { key: 'stress', op: 'add', value: -4, reason: 'the balance stops falling as fast' },
      { key: 'decisionConfidence', op: 'add', value: 4, reason: 'one clear rule replaces daily negotiation' },
    ],
    assumptions: [
      'The costs cut are genuinely discretionary and do not remove the inputs the work depends on.',
    ],
    uncertainties: [
      'How much is truly discretionary differs per person and is not measured here.',
    ],
    evidence: [
      { cls: 'assumption', text: 'Runway is funds divided by net monthly burn, so lowering costs extends it arithmetically.' },
    ],
    tradeoffs: {
      gains: ['Runway extends without waiting for new income.', 'One spending rule ends constant self-negotiation.'],
      costs: ['Options that cost money to try are closed while this lasts.', 'Cuts made under pressure often hit the wrong things first.'],
    },
    nextSteps: ['Separate the costs that create income from the costs that only create comfort.'],
    failurePoints: ['If the cut removes what the work needs, income falls with it.'],
    imagination: 0,
  },
  {
    id: 'finance.emergency-fund-milestone',
    requires: ['finance'],
    label: 'A buffer big enough to work on its own',
    summary:
      "The balance crosses the point where it stops being just money: several months of costs sitting idle, growing on its own while nothing happens. Shocks that would have forced a decision now pass through without changing the plan. The growth is arithmetic on a balance rather than a forecast about any market.",
    detail:
      "Two things happen at once at this size of buffer — it absorbs months of costs, and its own growth becomes large enough to notice. Modelled as a modest gain on the balance plus a real reduction in exposure, not as a prediction of returns.",
    type: 'milestone',
    when: { all: [{ key: 'money', op: '>=', value: 10000 }] },
    weight: 5,
    monthsMin: 8,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 24,
    once: true,
    effects: [
      { key: 'money', op: 'add', value: 320, noise: 0.5, reason: 'growth on an idle balance' },
      { key: 'risk', op: 'add', value: -12, reason: 'months of costs held in reserve' },
      { key: 'optionality', op: 'add', value: 8, reason: 'delays and mistakes became affordable' },
      { key: 'stress', op: 'add', value: -7, reason: 'a shock no longer threatens the plan' },
      { key: 'decisionConfidence', op: 'add', value: 6, reason: 'choices made from security, not fear' },
    ],
    assumptions: [
      'A surplus held as liquid cash absorbs several months of costs before any other support is needed.',
    ],
    uncertainties: [
      'Inflation and returns on cash are not modelled; the growth figure is deliberately small.',
    ],
    evidence: [
      { cls: 'assumption', text: 'Buffer arithmetic only — months of cover and modest growth on a balance, not a market forecast.' },
    ],
    tradeoffs: {
      gains: ['Shocks stop being existential.', 'The buffer earns something while it waits.'],
      costs: ['Money in reserve is money not spent on skills, reach or opportunity.', 'Reaching this point takes many months of surplus.'],
    },
    failurePoints: ['The buffer gets absorbed by a lifestyle upgrade instead of held as insurance.'],
    nextSteps: ['Define what this money is for, so it is not quietly reclassified as spendable.'],
    imagination: 0,
  },
  {
    id: 'finance.debt-credit-trap',
    requires: ['finance'],
    label: 'Credit covers the gap, then widens it',
    summary:
      "With cash low, borrowing fills the monthly shortfall instead of ending it. Interest and fees join the cost base, so the gap credit was meant to bridge grows a little larger every month it is carried. Each payment now services the past rather than funding the plan, which is why this state is so hard to exit from the inside.",
    detail:
      "The trap is arithmetic: when expenses exceed income, debt enlarges the very shortfall it was covering. Modelled as a rising monthly cost plus a direct drain on cash, so the way out must come from income or a permanent cut, never from more borrowing.",
    type: 'setback',
    when: { all: [{ key: 'money', op: '<=', value: 1800 }] },
    weight: 6,
    monthsMin: 3,
    monthsMax: 96,
    durationMonths: 5,
    cooldown: 16,
    effects: [
      { key: 'expenses', op: 'add', value: 150, noise: 0.4, reason: 'interest and fees added to the cost base' },
      { key: 'money', op: 'add', value: -750, noise: 0.5, reason: 'borrowing to cover the monthly shortfall' },
      { key: 'stress', op: 'add', value: 11, reason: 'servicing debt on top of the original gap' },
      { key: 'optionality', op: 'add', value: -8, reason: 'future income is already promised away' },
      { key: 'decisionConfidence', op: 'add', value: -6, reason: 'options narrow as the balance falls' },
    ],
    assumptions: ['When cash runs low, credit is usually the next resource actually within reach.'],
    uncertainties: ['Access to credit and the terms offered are not modelled at all.'],
    evidence: [
      { cls: 'assumption', text: 'A carried balance raises monthly costs through interest; no particular rate is assumed.' },
    ],
    tradeoffs: {
      gains: ['The plan survives this month.', 'A repayment record, if payments are held.'],
      costs: ['Monthly costs rise while the balance falls.', 'Every later decision is made with less room behind it.'],
    },
    failurePoints: ['Minimum payments feel like progress while the balance moves the other way.'],
    nextSteps: ['Close the gap at income or cost level; credit only helps a gap that is already closing.'],
    imagination: 0,
  },
  {
    id: 'finance.cost-of-living-rise',
    requires: ['finance'],
    label: 'The cost of living moves without you',
    summary:
      "Rent, energy, food or insurance is repriced by someone else, and the new figure applies whether or not anything about your income has changed. For several months the same life simply costs more, so the surplus that was doing quiet work disappears. Nothing you did caused this and no amount of thrift on your side prevents it.",
    detail:
      "Modelled as a step change in monthly costs with no offsetting change in income — an external repricing, not a lifestyle change. It persists for months because that is how long it takes either income to adjust or the budget to be rebuilt around the new floor.",
    type: 'event',
    when: {},
    weight: 9,
    monthsMin: 4,
    monthsMax: 120,
    durationMonths: 6,
    cooldown: 22,
    effects: [
      { key: 'expenses', op: 'add', value: 170, noise: 0.35, reason: 'repriced rent, energy or insurance' },
      { key: 'money', op: 'add', value: -500, noise: 0.5, reason: 'absorbing the higher cost before income adjusts' },
      { key: 'stress', op: 'add', value: 5, reason: 'the same income buys less than it did' },
      { key: 'optionality', op: 'add', value: -4, reason: 'less surplus left to choose with' },
    ],
    assumptions: ['Over a multi-year horizon at least one major household cost is repriced upward.'],
    uncertainties: ['Which cost moves, by how much, and whether income rises to match it.'],
    evidence: [
      { cls: 'assumption', text: 'Representative of external repricing; the size and timing are not predicted.' },
    ],
    tradeoffs: {
      gains: ['A clearer picture of the true floor cost of living.', 'Pressure to raise income rather than keep trimming it.'],
      costs: ['Months of surplus absorbed before anything else changes.', 'Cuts elsewhere become unavoidable.'],
    },
    failurePoints: ['A budget built at exactly zero surplus has nowhere to absorb this.'],
    nextSteps: ['Rebuild the monthly baseline around the new figure rather than hoping it reverts.'],
    imagination: 0,
  },
  {
    id: 'finance.income-smoothing',
    requires: ['finance'],
    label: 'Irregular income turns into a steady draw',
    summary:
      "Work arrives as a retainer, a longer contract or a scheduled payment, so next month's income is known in advance instead of hoped for. Predictability is worth more than the same total paid unevenly: it lets costs, cuts and risks be planned a month at a time rather than a week at a time. The peaks are traded away along with the troughs.",
    detail:
      "Smoothing does not raise the total; it removes the swings that make planning impossible. Modelled as lower variance and a lower load from not knowing what next month pays, with a small scheduled payment added and the upside of the best months given up.",
    type: 'opportunity',
    when: {},
    weight: 7,
    monthsMin: 4,
    monthsMax: 96,
    durationMonths: 4,
    cooldown: 18,
    effects: [
      { key: 'stability', op: 'add', value: 16, reason: 'a recurring payment replaces one-off wins' },
      { key: 'variance', op: 'add', value: -11, reason: 'peaks and troughs removed from income' },
      { key: 'income', op: 'add', value: 260, noise: 0.4, reason: 'a scheduled payment added to the month' },
      { key: 'stress', op: 'add', value: -6, reason: 'next month is known before it arrives' },
      { key: 'risk', op: 'add', value: -5, reason: 'fewer months depend on a single good week' },
    ],
    assumptions: ['Income of the same size that can be predicted is worth more than an uneven total of the same size.'],
    uncertainties: ['Steady arrangements usually trade away upside; the lost peaks are not quantified.'],
    evidence: [
      { cls: 'assumption', text: 'Smoothing reduces variance rather than raising the total; the trade-off is capped upside.' },
    ],
    tradeoffs: {
      gains: ['Planning becomes possible a month ahead.', 'Load falls when next month is already known.'],
      costs: ['The arrangement typically costs some upside.', 'Dependence on whoever pays on schedule.'],
    },
    nextSteps: ['Convert the most predictable part of the work into a recurring payment first.'],
    failurePoints: ['If the steady part is signed at a discount too deep, stability costs more than it buys.'],
    imagination: 0,
  },
];

export const FINANCE_PACK: RulePack = {
  id: 'finance',
  name: 'Money, buffers and burn',
  description:
    'Lean-runway discipline, emergency buffers, debt traps, compounding, and the costs that arrive from outside your control.',
  vars: [],
  rules: FINANCE_RULES,
  startingModifiers: [],
};
