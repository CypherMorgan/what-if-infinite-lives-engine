/**
 * The time pack: attention as the budget that everything else is denominated in.
 *
 * The mechanism throughout is that hours are not interchangeable. Unbroken time is the only
 * format in which difficult work advances, fragmentation charges a switching cost on every
 * switch, and slack is what keeps ordinary disruptions ordinary. Weights are relative to
 * the other rules eligible at the same moment, never probabilities of anything happening
 * in a real life.
 */
import type { Rule, RulePack } from '../rulePack';

const TIME_RULES: Rule[] = [
  {
    id: 'time.weekly-deep-block',
    requires: ['time'],
    label: 'A small weekly block, held for months',
    summary:
      'A few hours a week are fenced off and defended, and after several months the block is unremarkable — which is exactly the point. Craft and shipped work climb slowly while scattered hours go nowhere, because difficult work only advances in unbroken time. The block that survives ordinary weeks beats the ambitious one that exists only in planning.',
    detail:
      'The mechanism is compounding on protected time: small repeated doses of uninterrupted attention accumulate into work that fragmented hours cannot produce. Modelled as focus and craft rising together, with progress trailing behind them and a small real cost in energy.',
    type: 'milestone',
    when: {},
    weight: 13,
    monthsMin: 2,
    monthsMax: 96,
    durationMonths: 5,
    cooldown: 8,
    effects: [
      { key: 'focus', op: 'add', value: 7, reason: 'a defended block becomes a habit' },
      {
        key: 'skill:craft',
        op: 'add',
        value: 6,
        noise: 0.35,
        reason: 'unbroken hours on hard work',
      },
      {
        key: 'goalProgress',
        op: 'add',
        value: 5,
        reason: 'difficult work advances only in long blocks',
      },
      { key: 'energy', op: 'add', value: -3, reason: 'deep work is genuinely tiring' },
      { key: 'stress', op: 'add', value: -4, reason: 'the important work is no longer squeezed' },
    ],
    assumptions: ['A few defended hours a week can be held for months alongside everything else.'],
    uncertainties: [
      'Whether the block survives a genuinely busy period; the model will not protect it for you.',
    ],
    evidence: [
      {
        cls: 'research',
        text: 'High-level performance depends on sustained, concentrated practice rather than scattered effort.',
        source: 'Ericsson, Krampe & Tesch-Römer, "The Role of Deliberate Practice" (1993)',
      },
    ],
    tradeoffs: {
      gains: [
        'Craft and progress rise together without a heroic push.',
        'The block gets easier to defend once it is a habit.',
      ],
      costs: [
        'Three or four hours a week removed from everything else.',
        'Interrupted weeks feel like failure even when they are normal.',
      ],
    },
    nextSteps: ['Put the block in the calendar before the week starts.'],
    failurePoints: ['The first time it is cancelled for a meeting, it becomes cancellable.'],
    imagination: 0,
  },
  {
    id: 'time.attention-fragmentation',
    requires: ['time'],
    label: 'The week fragments into ten-minute pieces',
    summary:
      'Messages, meetings and small requests arrive faster than they can be batched, so the week becomes a hundred short pieces. Switching costs are charged on every switch: the thread of difficult work is lost and has to be rebuilt, so full hours produce the output of far fewer. Nothing urgent that arrives is ever the thing that mattered most.',
    detail:
      'The cost is not the minutes the interruptions take but the residue each one leaves behind. Modelled as focus falling hard with craft and progress behind it, plus the load of permanently catching up on work that needed an unbroken stretch.',
    type: 'setback',
    when: { all: [{ key: 'focus', op: '<=', value: 40 }] },
    weight: 12,
    monthsMin: 2,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 9,
    effects: [
      { key: 'focus', op: 'add', value: -11, reason: 'attention broken into unusable pieces' },
      { key: 'skill:craft', op: 'add', value: -4, reason: 'no sustained stretch on hard problems' },
      { key: 'goalProgress', op: 'add', value: -6, reason: 'hours spent, far fewer delivered' },
      { key: 'energy', op: 'add', value: -7, reason: 'constant switching drains the day' },
      { key: 'stress', op: 'add', value: 7, reason: 'never catching up on the important work' },
    ],
    assumptions: ['Interruptions resume the moment they are not actively blocked.'],
    uncertainties: [
      'How much of the fragmentation is imposed externally versus invited is not modelled.',
    ],
    evidence: [
      {
        cls: 'research',
        text: 'Interrupted work leaves a residue that delays full return to the original task.',
        source: 'Leroy, "Why Is It So Hard to Do My Work?" (2009)',
      },
    ],
    tradeoffs: {
      gains: [
        'Everything urgent is handled promptly.',
        'The pattern becomes visible once it is named.',
      ],
      costs: [
        'Craft and progress — the only compounding assets here.',
        'Energy spent restarting rather than finishing.',
      ],
    },
    failurePoints: ['Responding faster makes the fragmentation worse, not better.'],
    nextSteps: ['Batch the interruptions into two windows instead of absorbing them all day.'],
    imagination: 0,
  },
  {
    id: 'time.commitment-ends',
    requires: ['time'],
    label: 'A commitment ends and hours come back',
    summary:
      'The course, the second job, the standing obligation or the commute finishes, and several evenings a week reappear with nothing replacing them. The first effect is relief rather than productivity: capacity returns before the schedule knows what to do with it. The money spent on the commitment stops too, so hours and surplus arrive together.',
    detail:
      'Ending commitments is the cheapest way to create time — no purchase required. Modelled as focus and energy recovering while the costs attached to the commitment disappear, and a modest rise in room to choose what happens next.',
    type: 'event',
    when: {},
    weight: 8,
    monthsMin: 3,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 16,
    effects: [
      { key: 'focus', op: 'add', value: 12, reason: 'a recurring block of hours released' },
      { key: 'stress', op: 'add', value: -9, reason: 'a standing obligation simply stops' },
      { key: 'energy', op: 'add', value: 6, reason: 'evenings available for recovery again' },
      {
        key: 'expenses',
        op: 'add',
        value: -130,
        reason: 'fees and travel attached to the commitment',
      },
      { key: 'optionality', op: 'add', value: 5, reason: 'room to choose what happens next' },
    ],
    assumptions: [
      'The commitment actually ends on schedule instead of expanding to fill the space.',
    ],
    uncertainties: ['Whether the freed hours get protected or immediately reoccupied.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'Modelled as time and cost released together, with no assumption about what replaces them.',
      },
    ],
    tradeoffs: {
      gains: [
        'Hours and surplus, without having to buy either.',
        'Recovery capacity that was fully committed.',
      ],
      costs: [
        'Whatever the commitment was building stops growing too.',
        'Freed time decays into drift without a job to do.',
      ],
    },
    nextSteps: ['Decide what the freed hours are for before the first free week arrives.'],
    failurePoints: ['Recommitting immediately to something equivalent undoes the whole gain.'],
    imagination: 0,
  },
  {
    id: 'time.no-slack-overload',
    requires: ['time'],
    label: 'A schedule with no slack in it',
    summary:
      'Every hour is already allocated, so a single disruption — a delayed train, a sick day, a request from the person who signs the cheques — cascades through the rest of the month. There is no buffer to absorb anything, which means small problems get handled at the worst available moment. Sleep and recovery absorb the overflow by default.',
    detail:
      'Slack is not wasted time; it is the capacity that keeps ordinary disruptions ordinary. Modelled as a fully loaded schedule where sleep, focus and energy pay for the first interruption, and the load compounds for as long as nothing is removed.',
    type: 'setback',
    when: { all: [{ key: 'stress', op: '>=', value: 58 }] },
    weight: 10,
    monthsMin: 4,
    monthsMax: 120,
    durationMonths: 4,
    cooldown: 12,
    effects: [
      { key: 'sleep', op: 'add', value: -9, reason: 'recovery absorbs the overflow' },
      { key: 'focus', op: 'add', value: -8, reason: 'no block left that can absorb a disruption' },
      { key: 'energy', op: 'add', value: -6, reason: 'back-to-back allocation with no recovery' },
      { key: 'stress', op: 'add', value: 8, reason: 'small problems arrive at the worst moment' },
      {
        key: 'goalProgress',
        op: 'add',
        value: -5,
        reason: 'important work displaced by whatever broke',
      },
    ],
    assumptions: ['A fully allocated schedule converts ordinary disruptions into crises.'],
    uncertainties: [
      'How much of the overload is chosen; the model treats it as a state, not a verdict.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'Bufferless schedules are modelled as amplifying ordinary events; no specific disruption is predicted.',
      },
    ],
    tradeoffs: {
      gains: [
        'Nothing sits idle while this lasts.',
        'The cost of having no slack becomes measurable.',
      ],
      costs: [
        'Sleep and focus fund every surprise.',
        'Important work is permanently displaced by urgent work.',
      ],
    },
    failurePoints: ['Filling the first newly freed hour is how the slack disappears again.'],
    nextSteps: ['Leave one evening a week unallocated as the month’s buffer.'],
    imagination: 0,
  },
  {
    id: 'time.buy-time-back',
    requires: ['time'],
    label: 'Paying to get the hours back',
    summary:
      'Chores, admin and routine work get outsourced or automated for a monthly fee, and the hours they consumed return to the work only you can do. The trade is explicit: recurring costs rise so that focus and stamina can rise with them. It only holds while the bought hours are spent on something worth more than they cost.',
    detail:
      'Buying time is a lever only when the value of the freed hours exceeds the fee — that test is left to the user rather than assumed here. Modelled as a permanent increase in monthly costs with focus, energy and progress climbing behind it.',
    type: 'opportunity',
    when: { all: [{ key: 'income', op: '>=', value: 3000 }] },
    weight: 6,
    monthsMin: 4,
    monthsMax: 96,
    durationMonths: 4,
    cooldown: 20,
    effects: [
      {
        key: 'expenses',
        op: 'add',
        value: 230,
        noise: 0.3,
        reason: 'a recurring fee for work you no longer do',
      },
      { key: 'focus', op: 'add', value: 10, reason: 'routine hours returned to high-value work' },
      { key: 'stress', op: 'add', value: -6, reason: 'the least useful tasks leave the schedule' },
      { key: 'energy', op: 'add', value: 5, reason: 'less drudgery per working week' },
      { key: 'goalProgress', op: 'add', value: 4, reason: 'freed hours spent on the actual goal' },
    ],
    assumptions: [
      'The fee is smaller than the value of the hours it buys, or the trade stops being a trade.',
    ],
    uncertainties: [
      'Whether the freed hours are genuinely redirected rather than absorbed by more of the same.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'Trades recurring cost for focus; the model does not verify the hourly value of the freed time.',
      },
    ],
    tradeoffs: {
      gains: [
        'Hours back on the only work that compounds.',
        'Less of the week spent on tasks that produce no progress.',
      ],
      costs: [
        'A permanent increase in the monthly cost base.',
        'Dependence on whatever it is now being paid for.',
      ],
    },
    failurePoints: ['If the bought hours are not redirected, this is simply a higher cost base.'],
    nextSteps: ['Outsource the task you resent most first; it is the clearest test of value.'],
    imagination: 0.1,
  },
];

export const TIME_PACK: RulePack = {
  id: 'time',
  name: 'Hours, attention and slack',
  description:
    'Protecting deep-work blocks, the fragmentation of attention, hours returning when a commitment ends, schedules with no slack, and paying to buy time back.',
  vars: [],
  rules: TIME_RULES,
  startingModifiers: [],
};
