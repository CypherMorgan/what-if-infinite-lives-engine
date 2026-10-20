/**
 * The relationships pack: other people as both a cost and a hedge.
 *
 * The mechanism throughout is that attention is the actual currency. Relationships gain
 * depth through scheduled, repeated contact and lose it through sustained absence, and both
 * movements feed back into what is practically possible — who takes your call, who warns
 * you, who absorbs the downside of a risky move. Weights are relative to the other rules
 * eligible at the same moment, never probabilities of anything happening in a real life.
 */
import type { Rule, RulePack } from '../rulePack';

const RELATIONSHIPS_RULES: Rule[] = [
  {
    id: 'relationships.protected-time',
    requires: ['relationships'],
    label: 'Time for people, held on purpose',
    summary:
      "Evenings and weekends are walled off for the people you actually care about, and the wall holds for a few months rather than for a weekend. Contact becomes predictable instead of opportunistic, so relationships deepen and belonging rises with them. The hours come out of work time, which is the honest cost of the trade.",
    detail:
      "The mechanism is regularity: relationships respond to dependable contact, not to intensity. Modelled with a small but real cost to focus, because protected hours have to come out of somewhere real.",
    type: 'event',
    when: {},
    weight: 12,
    monthsMin: 1,
    monthsMax: 96,
    durationMonths: 4,
    cooldown: 8,
    effects: [
      { key: 'relationships', op: 'add', value: 11, reason: 'predictable contact held over months' },
      { key: 'belonging', op: 'add', value: 7, reason: 'roots maintained deliberately' },
      { key: 'wellbeing', op: 'add', value: 6, reason: 'people restored the energy work takes' },
      { key: 'stress', op: 'add', value: -5, reason: 'time off the clock is genuinely off' },
      { key: 'focus', op: 'add', value: -4, reason: 'the hours come out of work time' },
    ],
    assumptions: ['Depth responds to scheduled, repeated contact rather than to grand gestures.'],
    uncertainties: ['Whether the calendar still protects the time once deadline pressure returns.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a direct exchange — work hours become relationship hours — with both sides shown.' },
    ],
    tradeoffs: {
      gains: ['Depth and belonging, both slow to build and fast to lose.', 'Recovery that work cannot provide on its own.'],
      costs: ['A few hours a week taken from the plan.', 'Deadlines absorb the slack elsewhere in the month.'],
    },
    nextSteps: ['Put it in the calendar before the week starts, the same way a meeting would be.'],
    imagination: 0,
  },
  {
    id: 'relationships.drift-from-neglect',
    requires: ['relationships'],
    label: 'The slow drift nobody decided on',
    summary:
      "No argument and no ending — just a stretch where contact does not happen, until messages get rarer and the honest conversations stop. The distance is invisible while it forms and expensive to close afterwards. Opportunities that would have come through those people quietly go somewhere else.",
    detail:
      "Drift is neglect compounded rather than a single failure. Modelled as a fall in relationship depth and the surrounding network, with the practical consequence — fewer warnings, referrals and openings — shown explicitly rather than left implied.",
    type: 'setback',
    when: { all: [{ key: 'stress', op: '>=', value: 50 }] },
    weight: 11,
    monthsMin: 4,
    monthsMax: 120,
    durationMonths: 5,
    cooldown: 14,
    effects: [
      { key: 'relationships', op: 'add', value: -10, reason: 'months of contact that did not happen' },
      { key: 'network', op: 'add', value: -6, reason: 'people stop routing opportunities your way' },
      { key: 'belonging', op: 'add', value: -7, reason: 'no maintained root where you are' },
      { key: 'wellbeing', op: 'add', value: -5, reason: 'isolation that arrived without an event' },
      { key: 'optionality', op: 'add', value: -4, reason: 'doors closed by silence, not by refusal' },
    ],
    assumptions: ['Neglected relationships weaken gradually rather than all at once.'],
    uncertainties: ['Which relationships survive neglect is not modelled individually.'],
    evidence: [
      { cls: 'assumption', text: 'Treats relationship maintenance as a recurring cost, not a one-time achievement.' },
    ],
    tradeoffs: {
      gains: ['Nothing — this is a pure cost of attention spent entirely elsewhere.'],
      costs: ['Depth, network and belonging fall together.', 'Reopening the contact later is awkward and slow.'],
    },
    failurePoints: ['The relationship never announces that it is ending.'],
    nextSteps: ['One unremarkable message reopens far more than an explanation would.'],
    imagination: 0,
  },
  {
    id: 'relationships.family-obligation',
    requires: ['relationships'],
    label: 'A family obligation narrows the map',
    summary:
      "A parent, a child or a sibling needs hands-on time, and saying no is not really on the table. Travel, care and coordination take hours and money out of the plan, and the options involving relocation or risk quietly stop being available. Showing up also deepens the bond, which is the part that does not fit on a spreadsheet.",
    detail:
      "Care obligations are modelled as a genuine constraint on options and focus, with a direct cash cost, while also strengthening the relationship that caused the commitment. Both directions are shown because both are true at once.",
    type: 'consequence',
    when: { all: [{ key: 'relationships', op: '>=', value: 35 }] },
    weight: 7,
    monthsMin: 3,
    monthsMax: 120,
    durationMonths: 6,
    cooldown: 24,
    effects: [
      { key: 'optionality', op: 'add', value: -9, reason: 'relocation and risk options taken off the table' },
      { key: 'focus', op: 'add', value: -7, reason: 'hours redirected to care and coordination' },
      { key: 'money', op: 'add', value: -850, noise: 0.5, reason: 'travel and direct costs of helping' },
      { key: 'stress', op: 'add', value: 8, reason: 'an obligation that cannot be declined' },
      { key: 'relationships', op: 'add', value: 6, reason: 'showing up deepens the bond' },
    ],
    assumptions: ['Family obligations are treated as non-negotiable commitments rather than optional help.'],
    uncertainties: ['Duration is the largest unknown; care roles usually run longer than first estimated.'],
    evidence: [
      { cls: 'assumption', text: 'Both the constraint and the closeness it produces are modelled; the net depends entirely on duration.' },
    ],
    tradeoffs: {
      gains: ['A deeper relationship with the people you showed up for.', 'Clear information about what you are willing to trade.'],
      costs: ['Months of options and attention.', 'A direct hit to cash at the least convenient moment.'],
    },
    failurePoints: ['Care roles expand quietly — a three-month commitment is often a year.'],
    nextSteps: ['Agree a schedule with the other people who share the obligation before it becomes yours alone.'],
    imagination: 0,
  },
  {
    id: 'relationships.support-widens-options',
    requires: ['relationships'],
    label: 'Someone close changes what is possible',
    summary:
      "A person in your circle both cushions the downside and opens a door: a place to stay, a shared cost, or an introduction you could not have manufactured yourself. A move or commitment that was reckless alone becomes merely risky with support. The help is theirs to give, which is why this cannot be scheduled.",
    detail:
      "Modelled as lower exposure and higher optionality from practical support, plus the network effect of being introduced by someone already trusted. It is gated on the relationship actually existing — support of this size does not appear out of nowhere.",
    type: 'opportunity',
    when: { all: [{ key: 'relationships', op: '>=', value: 55 }] },
    weight: 5,
    monthsMin: 4,
    monthsMax: 120,
    durationMonths: 4,
    cooldown: 26,
    once: true,
    effects: [
      { key: 'risk', op: 'add', value: -11, reason: 'the downside is shared while you get established' },
      { key: 'optionality', op: 'add', value: 10, reason: 'a door opened by someone who trusts you' },
      { key: 'network', op: 'add', value: 8, reason: 'introduced into someone else’s circle' },
      { key: 'stress', op: 'add', value: -8, reason: 'the worst case is no longer yours alone' },
      { key: 'decisionConfidence', op: 'add', value: 7, reason: 'a big move backed by people rather than nerve' },
    ],
    assumptions: ['Close relationships provide practical support, not only emotional support.'],
    uncertainties: ['Whether support arrives when needed; it is offered, never scheduled.'],
    evidence: [
      { cls: 'speculation', text: 'The amount of practical help is invented for the model; the claim being made is only the direction — support reduces exposure.' },
    ],
    tradeoffs: {
      gains: ['A move that was reckless alone becomes affordable.', 'Access to a circle you did not build.'],
      costs: ['An obligation to the person who helped.', 'Their help arrives with their view of what you should do next.'],
    },
    nextSteps: ['Ask one person for one specific thing rather than for general support.'],
    failurePoints: ['Help accepted on unstated terms gets called in at the worst moment.'],
    imagination: 0.15,
  },
  {
    id: 'relationships.conflict-attention-cost',
    requires: ['relationships'],
    label: 'A conflict quietly eats the week',
    summary:
      "An unresolved argument sits in the background of every working hour, replaying itself the moment attention drops. The disagreement itself costs a few minutes; the rumination costs days of focus and sleep. Work that needs full attention gets delivered at three-quarters capacity, and nothing about the work has changed.",
    detail:
      "The damage is attention rather than drama: an open conflict occupies the working memory that deep work needs. Modelled as focus and energy falling with progress behind them, plus a real hit to the relationship itself while it stays unresolved.",
    type: 'setback',
    when: {},
    weight: 10,
    monthsMin: 2,
    monthsMax: 120,
    durationMonths: 2,
    cooldown: 11,
    effects: [
      { key: 'focus', op: 'add', value: -12, reason: 'an open disagreement running in the background' },
      { key: 'energy', op: 'add', value: -7, reason: 'rumination costs more than the argument did' },
      { key: 'wellbeing', op: 'add', value: -6, reason: 'the relationship is strained' },
      { key: 'relationships', op: 'add', value: -5, reason: 'unresolved, so it does not stay small' },
      { key: 'goalProgress', op: 'add', value: -4, reason: 'deep work delivered at three-quarters capacity' },
    ],
    assumptions: ['Unresolved conflict occupies attention out of proportion to the time it takes.'],
    uncertainties: ['Whether it resolves inside this episode or gets carried into the next one.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as an attention cost rather than a verdict on the relationship; magnitudes are illustrative.' },
    ],
    tradeoffs: {
      gains: ['The issue becomes visible enough to be addressed.', 'A clear lesson in what unresolved conflict costs.'],
      costs: ['Days of focus spent on minutes of disagreement.', 'Progress slips while the work itself is unchanged.'],
    },
    failurePoints: ['Left alone, this becomes the background state rather than a passing episode.'],
    nextSteps: ['Name the specific disagreement in one conversation instead of three imagined ones.'],
    imagination: 0,
  },
];

export const RELATIONSHIPS_PACK: RulePack = {
  id: 'relationships',
  name: 'People, obligation and support',
  description:
    'Time deliberately protected for people, drift from neglect, family obligations that narrow options, support that de-risks a move, and conflict that costs attention.',
  vars: [],
  rules: RELATIONSHIPS_RULES,
  startingModifiers: [],
};
