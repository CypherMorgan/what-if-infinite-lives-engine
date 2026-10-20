/**
 * The uncertainty pack: how a path behaves when the question genuinely cannot be answered
 * from where you are standing.
 *
 * The mechanism throughout is that information has a price and a half-life. Some of it is
 * bought cheaply through small trials, some arrives through channels nobody planned, and
 * some never arrives at all — which is when decisions get made on thin evidence and have to
 * be revisited. Weights are relative to the other rules eligible at the same moment, never
 * probabilities of anything happening in a real life.
 */
import type { Rule, RulePack } from '../rulePack';

const UNCERTAINTY_RULES: Rule[] = [
  {
    id: 'uncertainty.cheap-experiment',
    requires: ['uncertainty'],
    label: 'A cheap experiment settles the real question',
    summary:
      'Instead of arguing with yourself, a small version of the option gets run for a few weeks at limited cost. It does not prove the path is right; it replaces the question that cannot be answered from an armchair with one piece of real evidence about how the work and you fit together. A negative result arrives while it is still affordable.',
    detail:
      'The experiment is scoped small enough that failing it is information rather than a disaster. Modelled as a modest cost to cash and attention, purchased with a large gain in evidence and in how well-founded the eventual choice feels.',
    type: 'opportunity',
    when: {},
    weight: 8,
    monthsMin: 2,
    monthsMax: 96,
    durationMonths: 2,
    cooldown: 12,
    effects: [
      {
        key: 'information',
        op: 'add',
        value: 13,
        reason: 'direct evidence about fit, not inference',
      },
      {
        key: 'decisionConfidence',
        op: 'add',
        value: 9,
        reason: 'the choice now rests on something that happened',
      },
      {
        key: 'money',
        op: 'add',
        value: -420,
        noise: 0.45,
        reason: 'the cost of running the experiment',
      },
      { key: 'focus', op: 'add', value: -4, reason: 'weeks spent testing rather than delivering' },
      { key: 'goalProgress', op: 'add', value: 3, reason: 'the test itself produces usable work' },
    ],
    assumptions: ['The experiment can be scoped small enough that failing it is survivable.'],
    uncertainties: ['Whether the small version predicts the full-size one; often it does not.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'A deliberately small trial is treated as evidence about fit; what it cannot tell you is left unquantified.',
      },
    ],
    tradeoffs: {
      gains: [
        'One real data point replaces months of speculation.',
        'A negative result costs little at this size.',
      ],
      costs: [
        'Cash and time the main plan does not get.',
        'A small version can mislead about the full-size one.',
      ],
    },
    nextSteps: [
      'Write down before starting which result would count as evidence against the idea.',
    ],
    failurePoints: ['Experiments without a pre-stated test are just postponed decisions.'],
    imagination: 0.1,
  },
  {
    id: 'uncertainty.analysis-paralysis',
    requires: ['uncertainty'],
    label: 'Analysis that burns months instead of resolving',
    summary:
      'Every new spreadsheet opens another question, and none of the questions are the kind that close from a desk. Months pass in which the only activity is evaluation, so the options quietly expire while they are being compared. The feeling of rigor stays intact while the evidence base stops moving at all.',
    detail:
      'The failure mode is procedural: gathering becomes a substitute for contact with reality. Modelled as options narrowing and progress falling while information barely improves — the entire cost of deliberation without its benefit.',
    type: 'setback',
    when: { all: [{ key: 'decisionConfidence', op: '<=', value: 35 }] },
    weight: 10,
    monthsMin: 2,
    monthsMax: 96,
    durationMonths: 5,
    cooldown: 15,
    effects: [
      {
        key: 'goalProgress',
        op: 'add',
        value: -8,
        reason: 'months spent evaluating instead of moving',
      },
      {
        key: 'optionality',
        op: 'add',
        value: -6,
        reason: 'options expire while they are compared',
      },
      { key: 'stress', op: 'add', value: 7, reason: 'deliberation with no deadline attached' },
      {
        key: 'information',
        op: 'add',
        value: 3,
        reason: 'far less new evidence than the time spent',
      },
      { key: 'focus', op: 'add', value: -5, reason: 'every work block opens another comparison' },
    ],
    assumptions: [
      'Some questions cannot be resolved by more desk research, however careful it is.',
    ],
    uncertainties: [
      'How much of the delay is diligence and how much is avoidance is not distinguishable from outside.',
    ],
    evidence: [
      {
        cls: 'research',
        text: 'A large set of attractive options can reduce satisfaction with the option eventually chosen.',
        source: 'Iyengar & Lepper, "When Choice Is Demotivating" (2000)',
      },
    ],
    tradeoffs: {
      gains: [
        'More of the option space is documented.',
        'The pattern becomes visible once it is named.',
      ],
      costs: [
        'Months of the horizon, which do not come back.',
        'Progress and optionality, both of which decay while you wait.',
      ],
    },
    failurePoints: ['Research feels like work, which is exactly why it is hard to stop.'],
    nextSteps: ['State what evidence would be sufficient, then stop when you have it.'],
    imagination: 0,
  },
  {
    id: 'uncertainty.unplanned-signal',
    requires: ['uncertainty'],
    label: 'An answer arrives from an unplanned source',
    summary:
      'A conversation at the wrong moment, a document nobody sent on purpose, a person who mentions the thing you have been circling for months. It could not have been found by searching harder in the direction you were already looking. It settles nothing by itself, but it reorders what you were about to do next.',
    detail:
      'Modelled as a step change in what you know plus the network it came through, with a small cost: the plan you were running has to be checked again. The direction of the shift is not predicted — unplanned information can strengthen a plan or invalidate it.',
    type: 'event',
    when: {},
    weight: 7,
    monthsMin: 2,
    monthsMax: 120,
    durationMonths: 1,
    cooldown: 13,
    effects: [
      {
        key: 'information',
        op: 'add',
        value: 11,
        reason: 'evidence that was not findable by searching',
      },
      { key: 'network', op: 'add', value: 5, reason: 'it arrived through a person' },
      { key: 'optionality', op: 'add', value: 4, reason: 'a path nobody had shown you' },
      {
        key: 'decisionConfidence',
        op: 'add',
        value: 4,
        reason: 'the ranking of options has better footing',
      },
      { key: 'focus', op: 'add', value: -3, reason: 'the current plan needs re-checking' },
    ],
    assumptions: [
      'Useful information frequently arrives through people and accidents rather than deliberate search.',
    ],
    uncertainties: [
      'Whether it arrives at all, and whether it helps or invalidates the current direction.',
    ],
    evidence: [
      {
        cls: 'research',
        text: 'Non-redundant information tends to arrive through contacts outside your immediate circle.',
        source: 'Burt, "Structural Holes: The Social Structure of Competition" (1992)',
      },
    ],
    tradeoffs: {
      gains: [
        'Evidence from a direction you could not search from.',
        'A connection with access to different information.',
      ],
      costs: [
        'The plan you were running now needs re-checking.',
        'Attention spent re-weighing the options.',
      ],
    },
    nextSteps: ['Act on the new fact within the week, before the plan reasserts itself.'],
    imagination: 0.2,
  },
  {
    id: 'uncertainty.under-evidenced-decision',
    requires: ['uncertainty'],
    label: 'A decision made on too little evidence',
    summary:
      'Waiting had stopped producing anything, so the choice was made with what was on hand — a reasonable move built on an incomplete picture. It unblocks the work immediately, then collides with the fact you did not have months later, when feedback forces a rewrite rather than a tweak. The momentum was real and so was the gap.',
    detail:
      'Acting on thin evidence beats stalling, and the model shows both halves: the decision releases work that was waiting, and the missing information returns later as rework. What it costs is not the choice itself but having to revisit it under load.',
    type: 'consequence',
    when: { all: [{ key: 'information', op: '<=', value: 45 }] },
    weight: 6,
    monthsMin: 3,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 17,
    effects: [
      {
        key: 'goalProgress',
        op: 'add',
        value: 4,
        reason: 'the decision unblocks work that was waiting',
      },
      {
        key: 'information',
        op: 'add',
        value: 8,
        reason: 'reality answers the question you could not',
      },
      {
        key: 'decisionConfidence',
        op: 'add',
        value: -7,
        reason: 'the basis for the choice turns out to be thin',
      },
      {
        key: 'goalProgress',
        op: 'add',
        value: -6,
        reason: 'rework once the missing fact surfaces',
      },
      { key: 'stress', op: 'add', value: 5, reason: 'a settled decision opens up again' },
    ],
    assumptions: [
      'Some decisions must be made before the evidence is complete; the horizon does not wait.',
    ],
    uncertainties: ['Whether the missing fact surfaces early enough to be cheap to fix.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'Modelled as two ordered effects — momentum now, rework later — with no prediction of when correction lands.',
      },
    ],
    tradeoffs: {
      gains: [
        'Motion, which generates the evidence deliberation could not.',
        'The real constraint becomes visible through contact with reality.',
      ],
      costs: ['A rewrite of settled work later.', 'Confidence in the next decision falls with it.'],
    },
    failurePoints: [
      'The rewrite gets treated as bad luck rather than as the original evidence gap.',
    ],
    nextSteps: [
      'Name the single assumption most likely to be wrong, then watch only that one thing.',
    ],
    imagination: 0,
  },
  {
    id: 'uncertainty.structured-comparison',
    requires: ['uncertainty'],
    label: 'A structured comparison re-ranks the options',
    summary:
      'The options are written down and judged against the same criteria, and the ranking changes on paper — what looked best was best at the thing you cared about least. The exercise costs about a week of attention and returns a defensible order plus a clear statement of what each choice actually requires of you.',
    detail:
      'The mechanism is commensurability: forcing identical measures onto every option exposes which criterion was doing the deciding. Modelled as a gain in evidence and earned confidence, paid for with a block of attention and a warning about wrong weights.',
    type: 'milestone',
    when: { all: [{ key: 'optionality', op: '>=', value: 40 }] },
    weight: 5,
    monthsMin: 3,
    monthsMax: 96,
    durationMonths: 2,
    cooldown: 18,
    effects: [
      {
        key: 'information',
        op: 'add',
        value: 12,
        reason: 'the same criteria applied to every option',
      },
      {
        key: 'decisionConfidence',
        op: 'add',
        value: 10,
        reason: 'confidence earned from a written comparison',
      },
      {
        key: 'optionality',
        op: 'add',
        value: 5,
        reason: 'options you had dismissed re-enter the ranking',
      },
      { key: 'focus', op: 'add', value: -5, reason: 'a week of attention spent on the comparison' },
      { key: 'goalProgress', op: 'add', value: 3, reason: 'the next step stops being arbitrary' },
    ],
    assumptions: ['The criteria used in the comparison are the ones that genuinely matter to you.'],
    uncertainties: [
      'A ranking built on wrong weights is confidently wrong; the weights themselves are not checked.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'Explicit criteria make option rankings inspectable; the choice of criteria is left to the user.',
      },
    ],
    tradeoffs: {
      gains: [
        'A defensible order instead of a recurring argument with yourself.',
        'Some options come back into view.',
      ],
      costs: [
        'A week of attention taken from the work.',
        'A written ranking can harden into a preference the evidence no longer supports.',
      ],
    },
    failurePoints: [
      'Re-weighting the criteria until the favourite wins defeats the entire exercise.',
    ],
    nextSteps: ['Set the weights before reading the options, not after.'],
    imagination: 0,
  },
  {
    id: 'uncertainty.choice-made',
    requires: ['uncertainty'],
    label: 'The choice is finally made',
    summary:
      'Enough. One option is selected, said out loud and started on, and the other paths stop being live hypotheses. The immediate feeling is not triumph but quiet: the open loop that occupied attention every day finally closes. From here the questions change from which path to how this one is made to work.',
    detail:
      'Committing has value beyond the content of the decision, because it releases the attention that deliberation was holding. The model deliberately does not know whether the choice is right — optionality is spent and exposure concentrates either way.',
    type: 'milestone',
    when: { all: [{ key: 'decisionConfidence', op: '>=', value: 55 }] },
    weight: 9,
    monthsMin: 3,
    monthsMax: 120,
    durationMonths: 3,
    once: true,
    effects: [
      { key: 'stress', op: 'add', value: -12, reason: 'the open loop finally closes' },
      { key: 'focus', op: 'add', value: 13, reason: 'attention returns to execution' },
      { key: 'goalProgress', op: 'add', value: 9, reason: 'direction settled, work resumes' },
      { key: 'decisionConfidence', op: 'add', value: 10, reason: 'a choice taken and owned' },
      { key: 'optionality', op: 'add', value: -10, reason: 'the untaken paths close' },
      { key: 'risk', op: 'add', value: 6, reason: 'commitment concentrates exposure' },
    ],
    assumptions: ['Committing releases attention regardless of whether the choice turns out well.'],
    uncertainties: ['Whether this is the right choice; the model deliberately does not know.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'Closing the deliberation loop is treated as a benefit independent of outcome quality.',
      },
    ],
    tradeoffs: {
      gains: ['Attention, energy and momentum returned to execution.'],
      costs: ['Optionality is spent; the untaken paths are no longer free to enter later.'],
    },
    nextSteps: ['Reopen only on new evidence, not on new anxiety.'],
    imagination: 0,
  },
];

export const UNCERTAINTY_PACK: RulePack = {
  id: 'uncertainty',
  name: 'Evidence, doubt and deciding',
  description:
    'Cheap experiments that resolve real questions, analysis that burns months, information from unplanned sources, decisions revisited, and structured comparisons.',
  vars: [],
  rules: UNCERTAINTY_RULES,
  startingModifiers: [],
};
