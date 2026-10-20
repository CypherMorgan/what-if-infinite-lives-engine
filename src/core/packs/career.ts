/**
 * Career pack: employment, the first ramp, management, organisational risk,
 * moving through people, and the pay conversation.
 *
 * The mechanism this pack models is that a career is mostly not chosen: you inherit a
 * manager, a budget line and a set of unwritten rules, and the outcomes that look like
 * personal performance are frequently decisions made above you for reasons you will not
 * be told.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'career.first-role',
    label: 'The first real role starts',
    summary:
      "A salary arrives in exchange for showing up, which restructures everything around it: time is now sold, so learning happens on someone else's schedule. The money matters, but the larger change is that you are finally inside an organisation, which is the only place professional practice can actually be acquired.",
    detail:
      'Employment is a base rather than a destination. It trades schedule ownership for structure, colleagues and a live demonstration of how work is really organised.',
    requires: ['career'],
    type: 'milestone',
    when: { all: [{ key: 'skill:professional-practice', op: '<', value: 25 }] },
    weight: 13,
    monthsMin: 0,
    monthsMax: 18,
    durationMonths: 3,
    once: true,
    effects: [
      { key: 'income', op: 'add', value: 2400, noise: 0.45, reason: 'salary for the first role' },
      {
        key: 'expenses',
        op: 'add',
        value: 320,
        noise: 0.4,
        reason: 'commuting and the cost of showing up daily',
      },
      {
        key: 'skill:professional-practice',
        op: 'add',
        value: 8,
        reason: 'learning how organisations actually work',
      },
      {
        key: 'network',
        op: 'add',
        value: 8,
        reason: 'colleagues who become the first professional network',
      },
      {
        key: 'optionality',
        op: 'add',
        value: 5,
        reason: 'employment is a base other moves are made from',
      },
      { key: 'focus', op: 'add', value: -6, reason: 'attention allocated by someone else' },
    ],
    assumptions: [
      'The role is permanent or long-term; short contracts are modelled as separate episodes.',
    ],
    uncertainties: [
      'Whether the role is a fit; early evidence is thin and arrives filtered through a manager.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'First employment is treated as a large step in professional practice regardless of seniority.',
      },
    ],
    tradeoffs: {
      gains: ['Income, structure and access to how the work is really done.'],
      costs: ['Schedule ownership, and the steepest part of the learning curve happens in public.'],
    },
    nextSteps: [
      'Spend the first ninety days learning who decides what, and how decisions actually get made.',
    ],
    imagination: 0,
  },
  {
    id: 'career.probation-ramp',
    label: 'The steep part of the first year',
    summary:
      'Productivity is low while the tools, vocabulary and unwritten rules are absorbed, and most people are judged on this window rather than on the trajectory behind it. The ramp itself, not the ability, is what decides whether the role survives to the point where you would be good at it.',
    detail:
      'Everything is expensive the first time: every task costs more attention than it will cost in six months. That gap is the whole event.',
    requires: ['career'],
    type: 'event',
    when: { all: [{ key: 'skill:professional-practice', op: '<', value: 40 }] },
    weight: 13,
    monthsMin: 1,
    monthsMax: 14,
    durationMonths: 5,
    cooldown: 12,
    effects: [
      {
        key: 'skill:professional-practice',
        op: 'add',
        value: 11,
        reason: 'absorbing tools, vocabulary and unwritten rules',
      },
      {
        key: 'stress',
        op: 'add',
        value: 9,
        reason: 'producing while still learning the environment',
      },
      {
        key: 'reputation',
        op: 'add',
        value: 6,
        reason: 'early reliability signals, which is what is measured',
      },
      { key: 'goalProgress', op: 'add', value: 7, reason: 'the ramp is the progress' },
      { key: 'information', op: 'add', value: 8, reason: 'a real view of what this job rewards' },
      {
        key: 'energy',
        op: 'add',
        value: -7,
        reason: 'the ramp costs more than the steady state will',
      },
    ],
    assumptions: [
      'Early performance is weighted heavily by managers whether or not that is intended.',
    ],
    uncertainties: [
      'Whether the manager is evaluating trajectory or current output; you rarely find out in time.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'Modelled as a steep initial learning curve followed by a judgement point.',
      },
    ],
    tradeoffs: {
      gains: ['The fastest skill acquisition available on this path, paid for by the environment.'],
      costs: ['Being assessed at your least capable moment.'],
    },
    failurePoints: [
      'Not asking questions for two months to look capable is the expensive version of this.',
    ],
    nextSteps: ['Ask what good looks like at ninety days, and get it in writing.'],
    imagination: 0,
  },
  {
    id: 'career.bad-management',
    label: 'Working for someone who is not managing',
    summary:
      'Priorities change weekly, feedback arrives as mood and credit moves upward. The work does not stop being yours, but the environment stops supporting it, so most of the loss comes from attention spent decoding rather than producing, and from output that never survives contact with the organisation.',
    detail:
      'Management quality is largely unchosen and disproportionately affects outcomes. The damage is rarely the manager personality; it is the rework and the second-guessing.',
    requires: ['career'],
    type: 'setback',
    when: {
      all: [
        { key: 'skill:professional-practice', op: '>=', value: 30 },
        { key: 'stress', op: '>=', value: 40 },
      ],
    },
    weight: 9,
    monthsMin: 6,
    monthsMax: 84,
    durationMonths: 5,
    cooldown: 22,
    effects: [
      {
        key: 'wellbeing',
        op: 'add',
        value: -12,
        reason: 'chronic uncertainty about where you stand',
      },
      { key: 'focus', op: 'add', value: -11, reason: 'attention spent decoding instructions' },
      { key: 'energy', op: 'add', value: -9, reason: 'effort spent on work that gets rebuilt' },
      { key: 'goalProgress', op: 'add', value: -8, reason: 'projects that do not survive the org' },
      { key: 'reputation', op: 'add', value: -6, reason: 'output attributed elsewhere' },
      {
        key: 'skill:professional-practice',
        op: 'add',
        value: -3,
        reason: 'picking up bad habits from a bad example',
      },
    ],
    assumptions: [
      'Management quality is a large and largely unchosen factor in how a role turns out.',
    ],
    uncertainties: [
      'Whether a reorg moves you to a different manager before the damage compounds.',
    ],
    evidence: [
      {
        cls: 'assumption',
        text: 'Treated as a structural drag on output and health rather than as a personal conflict.',
      },
    ],
    tradeoffs: {
      gains: ['A very clear picture of what you will not tolerate in the next role.'],
      costs: ['Health, momentum and credit, in roughly that order.'],
    },
    failurePoints: [
      'Quietly doing less to protect yourself is understandable and usually reads as the opposite.',
    ],
    nextSteps: ['Document the scope you were actually given before any conversation about it.'],
    imagination: 0,
  },
  {
    id: 'career.redundancy-risk',
    label: 'The role is exposed to a cut',
    summary:
      'The decision is not about your work. It is about a budget line, a reorg, or a segment that stopped performing, and your output is irrelevant to it. The difference between people who land well and people who do not is prepared optionality, which is the one thing that is hardest to build while employed and comfortable.',
    detail:
      'Modelled as organisational economics rather than performance. The state effects are deliberately lopsided toward the financial and the informational.',
    requires: ['career'],
    type: 'setback',
    when: {
      any: [
        { key: 'projectHealth', op: '<=', value: 35 },
        { key: 'risk', op: '>=', value: 55 },
        { key: 'optionality', op: '<=', value: 30 },
      ],
    },
    weight: 4,
    monthsMin: 8,
    monthsMax: 96,
    durationMonths: 4,
    cooldown: 30,
    once: true,
    effects: [
      {
        key: 'income',
        op: 'add',
        value: -1600,
        noise: 0.6,
        reason: 'salary stops while the search runs',
      },
      { key: 'money', op: 'add', value: -2400, noise: 0.5, reason: 'the gap between roles' },
      { key: 'stress', op: 'add', value: 14, reason: 'income interrupted without warning' },
      {
        key: 'optionality',
        op: 'add',
        value: -5,
        reason: 'position removed, near-term plans constrained',
      },
      {
        key: 'goalProgress',
        op: 'add',
        value: -9,
        reason: 'the plan has to be rebuilt around a lost role',
      },
      {
        key: 'information',
        op: 'add',
        value: 10,
        reason: 'a clear read on how secure this industry is',
      },
    ],
    assumptions: [
      'Redundancy is driven by organisational economics rather than by individual performance.',
    ],
    uncertainties: ['Timing, severance, and how quickly an equivalent role is available.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'Included as a rare, high-impact event; no frequency claim is made about any real labour market.',
      },
    ],
    tradeoffs: {
      gains: ['An honest read on how transferable the position really was.'],
      costs: ['Income, momentum and confidence all move at once.'],
    },
    failurePoints: [
      'Taking the first available offer to stop the discomfort usually costs more over two years than waiting a month longer.',
    ],
    nextSteps: ['Settle severance, references and equipment before negotiating anything else.'],
    imagination: 0,
  },
  {
    id: 'career.referral-jump',
    label: 'A move made through someone who has seen the work',
    summary:
      'The role was never advertised; it exists because someone who has watched you work put your name into a conversation. Switching this way tends to pay more and constrain you less, because the trust is transferred rather than demonstrated, and the negotiation starts from a person vouching rather than a CV being screened.',
    requires: ['career'],
    type: 'opportunity',
    when: {
      all: [
        { key: 'network', op: '>=', value: 35 },
        { key: 'reputation', op: '>=', value: 35 },
      ],
    },
    weight: 7,
    monthsMin: 8,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 24,
    once: true,
    effects: [
      {
        key: 'income',
        op: 'add',
        value: 620,
        noise: 0.55,
        reason: 'pay set by competing interest rather than a band',
      },
      {
        key: 'skill:professional-practice',
        op: 'add',
        value: 6,
        reason: 'new environment, new constraints',
      },
      { key: 'network', op: 'add', value: 9, reason: 'the referrer plus the new team' },
      { key: 'reputation', op: 'add', value: 8, reason: 'chosen rather than applied' },
      { key: 'optionality', op: 'add', value: 8, reason: 'the pattern has proved repeatable' },
      { key: 'stress', op: 'add', value: 6, reason: 'the environment resets to zero' },
    ],
    assumptions: [
      'Referral hiring runs heavily through weak ties rather than through close friends.',
    ],
    uncertainties: [
      'Whether the opportunity fits; the referral signal covers competence, not fit.',
    ],
    evidence: [
      {
        cls: 'research',
        text: 'Weak ties carry disproportionate access to job information and to roles that are never posted.',
        source: 'Granovetter, "The Strength of Weak Ties" (1973)',
      },
    ],
    tradeoffs: {
      gains: ['Better-constrained pay, and trust you did not have to spend six months building.'],
      costs: ["Your standing is now partly spent on someone else's judgement of you."],
    },
    nextSteps: ['Keep three weak ties warm before you need anything from them.'],
    imagination: 0.1,
  },
  {
    id: 'career.scope-and-pay',
    label: 'More scope, and the conversation about pay',
    summary:
      'You have been handed work above the current title while pay is still set by the old one. The window to correct it is short, because organisations quickly price a person at what they have been doing for a few months rather than at what was agreed, and after that the old number becomes the anchor for every future conversation.',
    detail:
      'Scope and pay almost never arrive together. The gap between them is where leverage is either built or quietly forfeited.',
    requires: ['career'],
    type: 'decision',
    when: {
      all: [
        { key: 'reputation', op: '>=', value: 40 },
        { key: 'skill:professional-practice', op: '>=', value: 45 },
      ],
    },
    weight: 6,
    monthsMin: 10,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 20,
    effects: [
      {
        key: 'skill:professional-practice',
        op: 'add',
        value: 7,
        reason: 'work taken on above the current level',
      },
      {
        key: 'leverage',
        op: 'add',
        value: 8,
        reason: 'more output per hour from accumulated context',
      },
      {
        key: 'income',
        op: 'add',
        value: 430,
        noise: 0.5,
        reason: 'pay corrected toward the new scope',
      },
      { key: 'stress', op: 'add', value: 8, reason: 'delivering above the level being paid at' },
      {
        key: 'decisionConfidence',
        op: 'add',
        value: 7,
        reason: 'a negotiation made from a concrete claim',
      },
      {
        key: 'optionality',
        op: 'add',
        value: 6,
        reason: 'seniority that travels to the next role',
      },
    ],
    assumptions: ['Scope growth precedes pay correction rather than accompanying it.'],
    uncertainties: ['Whether a budget exists at all; a strong case with no budget still loses.'],
    evidence: [
      {
        cls: 'assumption',
        text: 'Pay is modelled as lagging demonstrated scope, not as a direct function of it.',
      },
    ],
    tradeoffs: {
      gains: ['A credible, receipted case for more money.'],
      costs: ['Months of work at the old rate while the case is being built.'],
    },
    failurePoints: ['Making the case without an outside option is the version that usually fails.'],
    nextSteps: ['Write down the scope you now hold before you write down the number.'],
    imagination: 0,
  },
];

export const CAREER_PACK: RulePack = {
  id: 'career',
  name: 'Career and employment',
  description:
    'First role, the probation ramp, management you did not choose, organisational cuts, referral-driven moves, and the gap between the scope you hold and the pay you are given.',
  vars: [],
  rules,
  startingModifiers: [],
};
