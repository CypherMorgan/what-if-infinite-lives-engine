/**
 * Relocation pack: moving to a different country or region and staying there.
 *
 * The mechanism this pack models is that relocation front-loads cost and administrative
 * dependency while deferring every benefit. Almost nothing improves until some threshold
 * of paperwork, residence and local contact is crossed, which is why the first year reads
 * as pure loss even when the decision is a good one.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'relocation.administrative-year',
    label: 'The year of forms, stamps and appointments',
    summary:
      'Legal status is not a decision, it is a queue. Every other plan on this path sits behind it: no lease, no job, no booking past a date you do not control, so the paperwork quietly becomes the critical path for a life that is otherwise ready to start.',
    detail:
      'Administration is modelled as a gate rather than a background annoyance, because it determines which other rules are even eligible to fire.',
    type: 'event',
    requires: ['relocation'],
    when: { all: [{ key: 'visaSecurity', op: '<', value: 65 }] },
    weight: 13,
    monthsMin: 0,
    monthsMax: 36,
    durationMonths: 6,
    cooldown: 12,
    effects: [
      { key: 'visaSecurity', op: 'add', value: 16, reason: 'applications processed and status advanced' },
      { key: 'money', op: 'add', value: -1600, noise: 0.6, reason: 'fees, translations and legal advice' },
      { key: 'stress', op: 'add', value: 10, reason: 'deadlines controlled by somebody else' },
      { key: 'focus', op: 'add', value: -8, reason: 'attention consumed by administration' },
      { key: 'optionality', op: 'add', value: -5, reason: 'major decisions paused until status settles' },
      { key: 'information', op: 'add', value: 7, reason: 'a precise map of what the system requires' },
    ],
    assumptions: ['Status is granted in stages and each stage gates a different set of rights.'],
    uncertainties: ['Processing time, which is the least controllable variable anywhere on this path.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a generic staged process; no specific country rules are represented.' },
    ],
    tradeoffs: {
      gains: ['Once settled, the constraint disappears entirely for years at a time.'],
      costs: ['Months of living as though on hold, paid for at full cost.'],
    },
    failurePoints: ['Letting a document lapse converts a long wait into a restart.'],
    nextSteps: ['Keep an expiry diary that looks a year further ahead than you think you need.'],
    imagination: 0,
  },
  {
    id: 'relocation.arrival-costs',
    label: 'The first month costs more than the plan',
    summary:
      'Deposits, flights, furniture, a bond, a temporary lease, and a month of doing everything the expensive way. None of it is exactly wasted, but the buffer takes its largest single hit before any of the upside has had time to arrive, which is the point where most people conclude, wrongly, that the move was a mistake.',
    type: 'setback',
    requires: ['relocation'],
    when: { all: [{ key: 'belonging', op: '<', value: 30 }] },
    weight: 11,
    monthsMin: 0,
    monthsMax: 6,
    durationMonths: 2,
    once: true,
    effects: [
      { key: 'money', op: 'add', value: -5200, noise: 0.6, reason: 'deposits, travel and setup in the first month' },
      { key: 'expenses', op: 'add', value: 420, noise: 0.5, reason: 'a higher baseline cost of living' },
      { key: 'optionality', op: 'add', value: -8, reason: 'the buffer that funded the move is now spent' },
      { key: 'stress', op: 'add', value: 9, reason: 'settling in while paying premium prices' },
      { key: 'relationships', op: 'add', value: -7, reason: 'everyone you know is in another time zone' },
      { key: 'belonging', op: 'add', value: 4, reason: 'a place that is finally yours, even if unfamiliar' },
    ],
    assumptions: ['Relocation carries a large one-off cost and a higher recurring baseline than was assumed before arrival.'],
    uncertainties: ['How much of the buffer survives the first month; it varies enormously by city and by support network.'],
    evidence: [
      { cls: 'assumption', text: 'Setup is modelled as a single large hit rather than as a gradual ramp.' },
    ],
    tradeoffs: {
      gains: ['The one-off cost is front-loaded and then stops recurring.'],
      costs: ['Every month hereafter costs more than the month before it did.'],
    },
    nextSteps: ['Rent furnished for the first three months; buying early is the classic way to overpay.'],
    imagination: 0,
  },
  {
    id: 'relocation.local-network',
    label: 'People here start expecting you',
    summary:
      'The shift is small and structural: a few faces become familiar, an invitation arrives without you asking, and somebody would now notice if you stopped turning up. Belonging does not arrive as a feeling, it accumulates through repeated unremarkable contact with the same people in the same places.',
    detail:
      'Proximity and repetition do most of the work here. Effort matters far less than showing up to the same thing several weeks running.',
    type: 'opportunity',
    requires: ['relocation'],
    when: { all: [{ key: 'network', op: '>=', value: 25 }, { key: 'belonging', op: '<', value: 65 }] },
    weight: 8,
    monthsMin: 4,
    monthsMax: 72,
    durationMonths: 4,
    cooldown: 16,
    effects: [
      { key: 'belonging', op: 'add', value: 13, reason: 'repeated contact with the same people' },
      { key: 'relationships', op: 'add', value: 10, reason: 'relationships that exist in this place' },
      { key: 'network', op: 'add', value: 9, reason: 'local ties, entirely separate from the ones left behind' },
      { key: 'wellbeing', op: 'add', value: 9, reason: 'social contact stops being effortful' },
      { key: 'optionality', op: 'add', value: 6, reason: 'local knowledge arrives through people rather than research' },
      { key: 'stress', op: 'add', value: -6, reason: 'less of the low-grade load of being a stranger' },
    ],
    assumptions: ['Repeated unstructured contact in the same setting is the ordinary route to local ties.'],
    uncertainties: ['Whether the people available are the right ones; proximity produces ties, not necessarily good ones.'],
    evidence: [
      {
        cls: 'research',
        text: 'Friendship formation in residential settings tracks physical proximity far more than shared interest.',
        source: 'Festinger, Schachter and Back, "Social Pressures in Informal Groups" (1950)',
      },
    ],
    tradeoffs: {
      gains: ['The strongest available input into feeling at home anywhere.'],
      costs: ['Time and commitment competing directly with the work the move was for.'],
    },
    nextSteps: ['Same place, same time, weekly; proximity outperforms intention.'],
    imagination: 0,
  },
  {
    id: 'relocation.qualification-recognition',
    label: 'The credential does not translate',
    summary:
      'The qualification that opened doors at home means less here: it is unfamiliar, unverified, or formally not accepted, so the experience has to be re-proven through a local examination, a lower title, or a job one level below the one you left. Nothing about your ability changed; the translation did.',
    detail:
      'This is a recognition problem being experienced as a competence problem. The state effects deliberately separate the credential from the person.',
    type: 'consequence',
    requires: ['relocation'],
    when: { all: [{ key: 'credential', op: '>=', value: 40 }] },
    weight: 7,
    monthsMin: 3,
    monthsMax: 60,
    durationMonths: 6,
    cooldown: 26,
    effects: [
      { key: 'credential', op: 'add', value: -10, reason: 'qualification discounted by the local market' },
      { key: 'income', op: 'add', value: -520, noise: 0.6, reason: 'a role below the one previously held' },
      { key: 'stress', op: 'add', value: 11, reason: 're-proving competence already proven elsewhere' },
      { key: 'optionality', op: 'add', value: -9, reason: 'roles closed until local recognition arrives' },
      { key: 'goalProgress', op: 'add', value: -7, reason: 'the professional timeline resets by a step' },
      { key: 'information', op: 'add', value: 10, reason: 'a clear view of how this market reads credentials' },
    ],
    assumptions: ['Credentials are interpreted through a local frame rather than on their intrinsic content.'],
    uncertainties: ['Whether recognition needs exams, supervised hours, or only a certified translation.'],
    evidence: [
      { cls: 'assumption', text: 'Treated as a translation and recognition problem rather than as a judgement about the qualification.' },
    ],
    tradeoffs: {
      gains: ['A defined route back to the right level once recognition is secured.'],
      costs: ['Months of underemployment that feel like a personal failure but are neither.'],
    },
    failurePoints: ['Underemployment that runs long enough quietly becomes the new baseline and stops being a phase.'],
    nextSteps: ['Find the exact recognition route and its total cost before applying for anything.'],
    imagination: 0,
  },
  {
    id: 'relocation.family-distance',
    label: 'The distance lands on the people who stayed',
    summary:
      'Visits get planned around flight prices and annual leave, and the important moments happen without you: a birthday, an illness, a funeral. The relationship does not erode through conflict, it erodes through absence, and each trip home makes the next departure noticeably harder than the last.',
    type: 'setback',
    requires: ['relocation'],
    when: { any: [{ key: 'relationships', op: '>=', value: 45 }, { key: 'belonging', op: '>=', value: 40 }] },
    weight: 9,
    monthsMin: 6,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 20,
    effects: [
      { key: 'relationships', op: 'add', value: -9, reason: 'absent at the moments that mattered' },
      { key: 'wellbeing', op: 'add', value: -8, reason: 'grief with no event to attach itself to' },
      { key: 'money', op: 'add', value: -1800, noise: 0.6, reason: 'flights home bought to hold the relationship together' },
      { key: 'focus', op: 'add', value: -6, reason: 'attention permanently split between two places' },
      { key: 'stress', op: 'add', value: 6, reason: 'guilt that recurs with every missed event' },
      { key: 'decisionConfidence', op: 'add', value: -7, reason: 'the decision to stay reopens every time you leave' },
    ],
    assumptions: ['Time zones and travel cost make presence a scheduled and expensive act rather than a spontaneous one.'],
    uncertainties: ['Whether the relationship absorbs it; some do, some do not, and there is no way to test it in advance.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a slow structural load rather than as a single dramatic event.' },
    ],
    tradeoffs: {
      gains: ['The new life becomes possible at all; this is the price, not a side effect of it.'],
      costs: ['Money, attention, and not being there when it counted.'],
    },
    failurePoints: ['Deciding to go back soon, for years, is how this becomes permanent on both sides at once.'],
    nextSteps: ['Book the next visit before leaving the current one.'],
    imagination: 0,
  },
  {
    id: 'relocation.becomes-home',
    label: 'The place stops being somewhere you are visiting',
    summary:
      'The shift is unremarkable: you stop translating everything, you know which place to go to for what, and when someone asks where you are from the answer takes a while. Integration is not an achievement, it is the point at which the daily cost of being a stranger falls to almost nothing.',
    detail:
      'Belonging here is the accumulated residue of ordinary days rather than a decision. It is rarely noticed while it happens, which is why the node exists.',
    type: 'milestone',
    requires: ['relocation'],
    when: { all: [{ key: 'belonging', op: '>=', value: 62 }] },
    weight: 4,
    monthsMin: 18,
    monthsMax: 120,
    durationMonths: 4,
    once: true,
    effects: [
      { key: 'belonging', op: 'add', value: 14, reason: 'the place is familiar rather than foreign' },
      { key: 'stress', op: 'add', value: -10, reason: 'the cost of being a stranger is gone' },
      { key: 'wellbeing', op: 'add', value: 10, reason: 'daily life no longer requires translation' },
      { key: 'optionality', op: 'add', value: 9, reason: 'rooted here, with local standing to build on' },
      { key: 'goalProgress', op: 'add', value: 10, reason: 'the move has produced what it was meant to' },
      { key: 'visaSecurity', op: 'add', value: 6, reason: 'status typically strengthened by time settled' },
    ],
    assumptions: ['Belonging accumulates through residence and repeated contact rather than through decision.'],
    uncertainties: ['Whether acceptance follows; feeling at home and being treated as local are different things.'],
    evidence: [
      {
        cls: 'research',
        text: 'Adjustment to a new culture is described as a staged process with a later recovery phase rather than a steady climb.',
        source: 'Oberg, "Culture shock: Adjustment to new cultural environments" (1960)',
      },
    ],
    tradeoffs: {
      gains: ['Everything that took effort becomes automatic.'],
      costs: ['The identity built around being the person who moved starts to fade.'],
    },
    nextSteps: ['Notice it while it is happening; this stage is almost never marked by anything external.'],
    imagination: 0.1,
  },
];

export const RELOCATION_PACK: RulePack = {
  id: 'relocation',
  name: 'Relocation',
  description:
    'The administrative year, the arrival cost, a local network forming, credentials that do not translate, the distance paid by family, and the point at which the new place becomes home.',
  vars: [],
  rules,
  startingModifiers: [],
};
