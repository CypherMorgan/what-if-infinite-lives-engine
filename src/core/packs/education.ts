/**
 * Education pack: enrolment, the first-term shock, funding, supervised practice,
 * overload, and the credential meeting the labour market.
 *
 * The mechanism this pack models is that education spends money and time *first* and only
 * converts them into a credential much later, which means most of the interesting state on
 * this path is the gap between what has been paid and what has been earned.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'education.enrolment',
    label: 'Enrolment and the first real commitment',
    summary:
      'You commit to a program: money leaves before any credential arrives, the week acquires a fixed shape, and a deadline you did not set starts counting. What you buy is structure plus access to a field, and you pay for it in advance.',
    detail:
      'Enrolment is the moment a vague intention becomes a schedule with a cost attached. The credential is the point of the exercise, but almost everything measurable changes in the opposite direction first.',
    requires: ['education'],
    type: 'event',
    when: { all: [{ key: 'credential', op: '<', value: 85 }] },
    weight: 13,
    monthsMin: 0,
    monthsMax: 6,
    durationMonths: 2,
    once: true,
    effects: [
      { key: 'money', op: 'add', value: -3200, noise: 0.5, reason: 'tuition and enrolment fees paid up front' },
      { key: 'expenses', op: 'add', value: 160, noise: 0.4, reason: 'materials and fees added to the monthly baseline' },
      { key: 'skill:structured-theory', op: 'add', value: 7, reason: 'formal coursework begins' },
      { key: 'information', op: 'add', value: 6, reason: 'a structured map of the field' },
      { key: 'stress', op: 'add', value: 7, reason: 'schedule and financial commitment now fixed' },
      { key: 'optionality', op: 'add', value: -4, reason: 'the next two years are spoken for' },
    ],
    assumptions: ['Fees land before the credential does, so the cost is paid on credit against a future outcome.'],
    uncertainties: ['How much of the planned schedule survives contact with work and life.'],
    evidence: [
      { cls: 'assumption', text: 'Structured study builds theory faster than unstructured exposure; the rate is not measured.' },
    ],
    tradeoffs: {
      gains: ['Deadlines, structure and access to people who already work in the field.'],
      costs: ['Money and months committed before any credential exists to show for them.'],
    },
    nextSteps: ['Know the total cost of the program and the clean exit point before the second term.'],
    imagination: 0,
  },
  {
    id: 'education.first-term-shock',
    label: 'The first term lands harder than expected',
    summary:
      'The pace, the register of the writing and the standard of the work are all above what the prospectus suggested. Early results are poor not because the field is closed to you, but because the gap between what you already knew and what is actually expected is larger than it looked from outside.',
    detail:
      'This is an adjustment period being read as a verdict. The measurable damage is small; the interpretation placed on it is where paths end.',
    requires: ['education'],
    type: 'setback',
    when: { all: [{ key: 'credential', op: '<', value: 12 }] },
    weight: 10,
    monthsMin: 1,
    monthsMax: 9,
    durationMonths: 3,
    cooldown: 10,
    effects: [
      { key: 'skill:structured-theory', op: 'add', value: 3, reason: 'slower progress through harder material' },
      { key: 'stress', op: 'add', value: 11, reason: 'performance shock in the first term' },
      { key: 'wellbeing', op: 'add', value: -8, reason: 'early marks below expectation' },
      { key: 'goalProgress', op: 'add', value: -5, reason: 'pace behind the plan' },
      { key: 'focus', op: 'add', value: -6, reason: 'time spent reacting instead of scheduling' },
      { key: 'information', op: 'add', value: 12, reason: 'an accurate reading of the real standard' },
    ],
    assumptions: ['A first term contains an adjustment period rather than immediate competence.'],
    uncertainties: ['Whether the response is to escalate effort, change program, or withdraw entirely.'],
    evidence: [
      { cls: 'assumption', text: 'First-term performance dips are modelled as an adjustment effect, not as a fixed law.' },
    ],
    tradeoffs: {
      gains: ['The gap is now visible while it is still cheap to close.'],
      costs: ['Confidence and momentum, which are what determine whether anyone persists.'],
    },
    failurePoints: ['Reading an adjustment period as proof of not belonging is the usual way this ends the path.'],
    nextSteps: ['Get one piece of graded feedback and act on it before the next submission.'],
    imagination: 0,
  },
  {
    id: 'education.funding-gap',
    label: 'The funding does not stretch to the end',
    summary:
      'The money was budgeted against a plan that has changed: a longer program, higher costs, a support payment that stopped, or fewer paid hours than assumed. The remaining months now compete with each other, and the cheapest-looking option at this point is usually the one that costs the most later.',
    requires: ['education'],
    type: 'setback',
    when: { all: [{ key: 'money', op: '<', value: 4500 }, { key: 'credential', op: '<', value: 75 }] },
    weight: 7,
    monthsMin: 3,
    monthsMax: 60,
    durationMonths: 4,
    cooldown: 16,
    effects: [
      { key: 'money', op: 'add', value: -2200, noise: 0.6, reason: 'shortfall covered from savings or borrowing' },
      { key: 'income', op: 'add', value: -260, noise: 0.5, reason: 'paid hours cut to keep up with the workload' },
      { key: 'risk', op: 'add', value: 11, reason: 'less buffer standing behind the same plan' },
      { key: 'stress', op: 'add', value: 9, reason: 'financing uncertainty running alongside study' },
      { key: 'optionality', op: 'add', value: -5, reason: 'money becomes the constraint on every choice' },
      { key: 'information', op: 'add', value: 6, reason: 'a clear figure for what finishing actually costs' },
    ],
    assumptions: ['Study costs are recurring and rising rather than a single fixed sum agreed in advance.'],
    uncertainties: ['Whether an emergency loan, family support or extra work closes the gap at all.'],
    evidence: [
      { cls: 'assumption', text: 'Funding shortfalls are modelled as appearing mid-program rather than at the start.' },
    ],
    tradeoffs: {
      gains: ['A precise, usable number for the cost of completing.'],
      costs: ['Debt and exposure rise exactly when time is scarcest.'],
    },
    failurePoints: ['Quietly dropping study hours to earn more is how a two-year program becomes three.'],
    nextSteps: ['Model the remaining cost month by month before taking on any new obligation.'],
    imagination: 0,
  },
  {
    id: 'education.lab-placement',
    label: 'A lab or internship takes you on',
    summary:
      'Someone with a budget and a real problem lets you work on it. The value is not the line on the CV; it is that your work is now inspected by people who already know what good looks like, which compresses years of self-calibration into a few months of directed feedback.',
    detail:
      'Supervised practice is the only stage where mistakes are cheap and feedback is immediate. It is also where most people first discover which part of the field they are actually suited to.',
    requires: ['education'],
    type: 'opportunity',
    when: { all: [{ key: 'credential', op: '>=', value: 25 }, { key: 'skill:structured-theory', op: '>=', value: 30 }] },
    weight: 6,
    monthsMin: 6,
    monthsMax: 60,
    durationMonths: 4,
    cooldown: 20,
    once: true,
    effects: [
      { key: 'skill:research', op: 'add', value: 9, reason: 'working a live problem under supervision' },
      { key: 'network', op: 'add', value: 11, reason: 'people who have watched you work daily' },
      { key: 'reputation', op: 'add', value: 8, reason: 'work inspected by specialists' },
      { key: 'credential', op: 'add', value: 7, reason: 'practical component attached to the qualification' },
      { key: 'optionality', op: 'add', value: 8, reason: 'a reference into unadvertised roles' },
      { key: 'stress', op: 'add', value: 6, reason: 'performing at a standard not yet hit before' },
    ],
    assumptions: ['Placements are competitive and depend on someone in the program knowing your work exists.'],
    uncertainties: ['Whether the placement is paid; most are not, which collides with the funding gap.'],
    evidence: [
      { cls: 'assumption', text: 'Supervised practice transfers faster than solo practice; the magnitude is not modelled.' },
    ],
    tradeoffs: {
      gains: ['Calibration, references and an unromantic view of the actual work.'],
      costs: ['Months of cheap or unpaid work competing directly with paid hours.'],
    },
    nextSteps: ['Ask what the placement is called on a CV before agreeing to it.'],
    imagination: 0.1,
  },
  {
    id: 'education.academic-burnout',
    label: 'The reading no longer fits in the week',
    summary:
      'Sleep has become the variable that absorbs the difference between the workload and the hours available. Output holds for a while because reserves are being spent, and then the quality of the work slips, which is expensive when the work itself is the thing earning the credential.',
    requires: ['education'],
    type: 'setback',
    when: { all: [{ key: 'stress', op: '>=', value: 55 }, { key: 'credential', op: '<', value: 80 }] },
    weight: 8,
    monthsMin: 5,
    monthsMax: 72,
    durationMonths: 4,
    cooldown: 18,
    effects: [
      { key: 'sleep', op: 'add', value: -14, reason: 'recovery cut to protect the workload' },
      { key: 'wellbeing', op: 'add', value: -13, reason: 'sustained load without a rest period' },
      { key: 'energy', op: 'add', value: -12, reason: 'depleted reserves' },
      { key: 'skill:structured-theory', op: 'add', value: -3, reason: 'reading done in a state where nothing retains' },
      { key: 'goalProgress', op: 'add', value: -8, reason: 'progress slows as capacity falls' },
      { key: 'stress', op: 'add', value: 5, reason: 'the same gap is waiting next month' },
    ],
    assumptions: ['Sustained overload degrades both the quality of study and the capacity to continue.'],
    uncertainties: ['Individual tolerance varies widely and is not modelled per person.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a capacity problem; no claim is made about a specific threshold for any person.' },
    ],
    tradeoffs: {
      gains: ['The deadline is protected in the short run.'],
      costs: ['Health buffer and the quality of the work being produced.'],
    },
    failurePoints: ['This stays invisible to supervisors until the output collapses, by which point it costs a term.'],
    nextSteps: ['Protect sleep for two weeks before cutting anything else.'],
    imagination: 0,
  },
  {
    id: 'education.qualification-earned',
    label: 'The credential is awarded, and the market answers',
    summary:
      'The qualification is conferred, converting years of work into one line a stranger can verify. What it buys is passage through the first screen rather than an outcome; from here the interviews, the evidence and the story you tell about the work decide what it is actually worth.',
    detail:
      'A credential clears thresholds. It does not perform the job, and the transition from screening to selection is where most graduates are surprised.',
    requires: ['education'],
    type: 'milestone',
    when: { all: [{ key: 'credential', op: '>=', value: 55 }] },
    weight: 3,
    monthsMin: 18,
    monthsMax: 96,
    durationMonths: 5,
    once: true,
    effects: [
      { key: 'credential', op: 'add', value: 15, reason: 'the qualification is formally awarded' },
      { key: 'optionality', op: 'add', value: 12, reason: 'roles previously closed by an entry requirement' },
      { key: 'reputation', op: 'add', value: 9, reason: 'a credential other people can check' },
      { key: 'goalProgress', op: 'add', value: 14, reason: 'the stated goal of this path is met' },
      { key: 'stress', op: 'add', value: -8, reason: 'the largest deadline is behind you' },
      { key: 'income', op: 'add', value: 300, noise: 0.7, reason: 'first roles priced against the new credential' },
    ],
    assumptions: ['A credential clears screening thresholds; it does not by itself win the role.'],
    uncertainties: ['How the labour market prices this credential at the moment you actually enter it.'],
    evidence: [
      {
        cls: 'research',
        text: 'Formal qualifications operate largely as screening and signalling devices at entry.',
        source: 'Spence, "Job Market Signaling" (1973)',
      },
    ],
    tradeoffs: {
      gains: ['Verified access, and an asset that keeps working after you stop.'],
      costs: ['Years committed to one route, with the opportunity cost already spent.'],
    },
    nextSteps: ['Turn the credential into two pieces of evidence an interviewer can inspect in five minutes.'],
    imagination: 0,
  },
];

export const EDUCATION_PACK: RulePack = {
  id: 'education',
  name: 'Formal education',
  description:
    'Enrolment, the first-term adjustment, funding under pressure, supervised practice, overload, and the moment a credential meets the labour market.',
  vars: [],
  rules,
  startingModifiers: [],
};
