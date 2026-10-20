/**
 * The health pack: capacity, sleep, illness and the pace the body actually keeps.
 *
 * The mechanism throughout is that health is a capacity with its own accounting. Load is
 * paid out of sleep and reserves before it shows up anywhere else, and it is rebuilt by
 * consistency rather than by intention. Weights are relative to the other rules eligible
 * at the same moment, never probabilities of anything happening in a real life.
 */
import type { Rule, RulePack } from '../rulePack';

const HEALTH_RULES: Rule[] = [
  {
    id: 'health.sleep-collapse',
    requires: ['health'],
    label: 'Sleep pays for the load first',
    summary:
      "Work expands into the hours reserved for recovery, and within a few weeks the debt shows up in the body rather than in the calendar. Attention narrows, mistakes multiply, and the same task takes noticeably longer than it used to. Output holds for a while only because reserves are being spent, which makes this easy to misread as sustainable.",
    detail:
      "Sleep is the first thing sacrificed and the first thing whose loss produces visible error. Modelled as falling sleep quality and energy with a direct cost to focus and craft — the predictable result of load exceeding capacity, not a failure of discipline.",
    type: 'setback',
    when: { all: [{ key: 'stress', op: '>=', value: 55 }] },
    weight: 12,
    monthsMin: 3,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 9,
    effects: [
      { key: 'sleep', op: 'add', value: -17, noise: 0.3, reason: 'recovery hours taken back by work' },
      { key: 'energy', op: 'add', value: -12, reason: 'reserves spent instead of rebuilt' },
      { key: 'focus', op: 'add', value: -9, reason: 'attention running on insufficient sleep' },
      { key: 'skill:craft', op: 'add', value: -3, reason: 'more errors per hour of practice' },
      { key: 'wellbeing', op: 'add', value: -8, reason: 'recovery deferred, not cancelled' },
    ],
    assumptions: ['Sustained load above capacity is paid out of sleep before anything else gives.'],
    uncertainties: ['How quickly it bites, and how much this particular person can absorb.'],
    evidence: [
      { cls: 'research', text: 'Sleep restriction reliably degrades attention, reaction time and judgment.', source: 'Experimental sleep-restriction studies (general finding)' },
    ],
    tradeoffs: {
      gains: ['Short-term output is protected.', 'Once named, the cause is unambiguous.'],
      costs: ['Hours recovered later cost more than they saved.', 'Craft quality falls while effort rises.'],
    },
    failurePoints: ['This is routinely read as dedication rather than as a warning.'],
    nextSteps: ['Restore a fixed stop time before trying to shrink the workload.'],
    imagination: 0,
  },
  {
    id: 'health.recovery-protocol',
    requires: ['health'],
    label: 'A recovery routine that actually holds',
    summary:
      "Instead of waiting to collapse, recovery gets scheduled: a fixed stop time, protected sleep, and a workload sized to the hours that genuinely exist. Within a couple of months sleep quality and energy climb back, while output recovers more slowly on a base that no longer shrinks every week. The pace is deliberately unimpressive, which is why it survives contact with real weeks.",
    detail:
      "The mechanism is unglamorous — capacity is rebuilt by consistency, not by one long rest taken at the end. Modelled as sleep, energy and wellbeing recovering with load falling, while progress resumes modestly rather than spectacularly.",
    type: 'opportunity',
    when: { all: [{ key: 'sleep', op: '<=', value: 40 }] },
    weight: 8,
    monthsMin: 4,
    monthsMax: 96,
    durationMonths: 5,
    cooldown: 20,
    effects: [
      { key: 'sleep', op: 'add', value: 15, reason: 'a fixed stop time held for months' },
      { key: 'energy', op: 'add', value: 11, reason: 'recovery scheduled rather than improvised' },
      { key: 'wellbeing', op: 'add', value: 8, reason: 'the workload sized to the hours that exist' },
      { key: 'stress', op: 'add', value: -9, reason: 'no more borrowing from next week' },
      { key: 'focus', op: 'add', value: 6, reason: 'rested attention holds for longer stretches' },
    ],
    assumptions: ['Sleep and energy respond to a sustained change in schedule within a few months.'],
    uncertainties: ['Whether the workload can actually be sized down — in many jobs it cannot.'],
    evidence: [
      { cls: 'research', text: 'Recovery restores performance that prior sleep loss had degraded.', source: 'Sleep recovery and performance literature (general finding)' },
    ],
    tradeoffs: {
      gains: ['Capacity stops shrinking every week.', 'Progress resumes on a stable base.'],
      costs: ['Commitments made at full intensity have to be renegotiated.', 'Recovery is much slower than the collapse was.'],
    },
    nextSteps: ['Fix the stop time first; the workload follows from it, not the other way round.'],
    failurePoints: ['One exception becomes the pattern within a fortnight.'],
    imagination: 0,
  },
  {
    id: 'health.illness-stoppage',
    requires: ['health'],
    label: 'Illness removes you for a stretch',
    summary:
      "A bug, an injury or a flare takes capacity off the table for weeks rather than days. Work in flight stalls exactly where it is, and earned output drops even though nothing about the plan has changed. Rest is not optional in this stretch, so the months are spent recovering instead of progressing.",
    detail:
      "Modelled as a hard drop in capacity with a one-off loss of earnings where pay depends on hours worked. The small dip in load is a side effect of being unable to work, not a benefit worth having — the schedule stops because it has to.",
    type: 'setback',
    when: {},
    weight: 7,
    monthsMin: 2,
    monthsMax: 120,
    durationMonths: 2,
    cooldown: 14,
    effects: [
      { key: 'energy', op: 'add', value: -16, reason: 'the body spends its budget on recovery' },
      { key: 'focus', op: 'add', value: -11, reason: 'capacity unavailable for concentrated work' },
      { key: 'healthBuffer', op: 'add', value: -8, reason: 'illness draws down the buffer' },
      { key: 'money', op: 'add', value: -350, noise: 0.5, reason: 'fees not billed while unable to work' },
      { key: 'goalProgress', op: 'add', value: -5, reason: 'work in flight stalls where it stands' },
      { key: 'stress', op: 'add', value: -4, reason: 'the schedule stops entirely' },
    ],
    assumptions: ['Illness and injury occur on any long horizon, and more often under sustained load.'],
    uncertainties: ['Severity, duration, and whether earnings are actually lost all depend on the arrangement.'],
    evidence: [
      { cls: 'research', text: 'Higher psychological stress is associated with greater susceptibility to common illness.', source: 'Cohen, Tyrrell & Smith, "Psychological Stress and Susceptibility to the Common Cold" (1991)' },
    ],
    tradeoffs: {
      gains: ['A forced and unarguable stop.', 'Clear information about how fragile the schedule was.'],
      costs: ['Earnings and progress, at the same time.', 'Recovery time is taken from the plan, not added to it.'],
    },
    failurePoints: ['Returning at full speed the week after recovering is how this repeats.'],
    nextSteps: ['Re-enter at reduced load for the first two weeks back.'],
    imagination: 0,
  },
  {
    id: 'health.exercise-compounds',
    requires: ['health'],
    label: 'Movement starts paying compound interest',
    summary:
      "Several months of regular, unglamorous exercise accumulate into something structural: more energy on ordinary working days, sleep that arrives without effort, and a larger buffer against whatever comes next. None of it looks dramatic in any single week, which is exactly why it is invisible while it is working. The dose that survives a bad month beats the one that does not.",
    detail:
      "Exercise is modelled as a compounding input rather than an event: small repeated doses that raise the floor rather than produce a peak. The conversion rate to capacity is not measured, and an injury would reverse part of it.",
    type: 'milestone',
    when: {},
    weight: 10,
    monthsMin: 4,
    monthsMax: 120,
    durationMonths: 6,
    cooldown: 16,
    effects: [
      { key: 'healthBuffer', op: 'add', value: 9, reason: 'months of regular physical load' },
      { key: 'energy', op: 'add', value: 7, reason: 'capacity that shows up on ordinary days' },
      { key: 'sleep', op: 'add', value: 6, reason: 'recovery that arrives on schedule' },
      { key: 'stress', op: 'add', value: -6, reason: 'physical load discharges accumulated stress' },
      { key: 'wellbeing', op: 'add', value: 5, reason: 'mood and capacity move together' },
    ],
    assumptions: ['The routine is sustained for months rather than attempted for a fortnight.'],
    uncertainties: ['Injury can reverse the gains; individual responses are not modelled.'],
    evidence: [
      { cls: 'research', text: 'Exercise has been tested in randomised trials as an intervention for depressive symptoms.', source: 'Blumenthal et al., exercise and major depression (1999)' },
    ],
    tradeoffs: {
      gains: ['Energy and sleep improve together, and compound.', 'A larger buffer before the next setback.'],
      costs: ['Several hours a week that cannot be used elsewhere.', 'The gains disappear quietly once it stops.'],
    },
    nextSteps: ['Keep the dose small enough that a bad month does not end it.'],
    failurePoints: ['An ambitious start is the most common reason this never compounds.'],
    imagination: 0,
  },
  {
    id: 'health.scare-forces-reprioritisation',
    requires: ['health'],
    label: 'A scare reorders the priority list',
    summary:
      "A test result, a diagnosis appointment, or a body that simply refuses to continue puts health at the top of the list without asking permission. Commitments that had looked mandatory get dropped, and the plan slows down deliberately for the first time. What comes back is a clear reading of what was actually optional.",
    detail:
      "The episode itself costs capacity; the reordering that follows is a choice made under new information. Modelled as a real hit to reserves plus a deliberate reduction in load, with progress sacrificed on purpose rather than lost by accident.",
    type: 'consequence',
    when: { all: [{ key: 'stress', op: '>=', value: 62 }] },
    weight: 3,
    monthsMin: 6,
    monthsMax: 120,
    durationMonths: 5,
    cooldown: 30,
    once: true,
    effects: [
      { key: 'healthBuffer', op: 'add', value: -14, reason: 'the episode itself draws down reserves' },
      { key: 'stress', op: 'add', value: -12, reason: 'commitments dropped on purpose' },
      { key: 'goalProgress', op: 'add', value: -7, reason: 'the plan slows to protect health' },
      { key: 'information', op: 'add', value: 12, reason: 'a clear read on what was actually optional' },
      { key: 'wellbeing', op: 'add', value: -6, reason: 'the scare itself is not free' },
    ],
    assumptions: [
      'Modelled as rare and high-impact; its position on the timeline implies nothing about any real event.',
    ],
    uncertainties: ['Severity and aftermath are not modelled — this marks a change of priorities, not a prognosis.'],
    evidence: [
      { cls: 'speculation', text: 'Included at low weight because a path that never reorders around health would be incomplete, not because any specific event is predicted.' },
    ],
    tradeoffs: {
      gains: ['A brutally honest list of what was optional.', 'Load drops below the level that caused this.'],
      costs: ['Progress absorbs the hit, on purpose this time.', 'Some dropped commitments never come back.'],
    },
    failurePoints: ['Readopting the previous commitments within months is how the cycle restarts.'],
    nextSteps: ['Write down what was cut while the reason for cutting it is still fresh.'],
    imagination: 0.1,
  },
];

export const HEALTH_PACK: RulePack = {
  id: 'health',
  name: 'Health, sleep and pace',
  description:
    'Sleep under load, recovery that holds, illness that removes capacity, exercise as a compounding input, and the scares that reorder priorities.',
  vars: [],
  rules: HEALTH_RULES,
  startingModifiers: [],
};
