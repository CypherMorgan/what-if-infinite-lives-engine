/**
 * Learning pack: self-directed skill acquisition outside a formal program.
 *
 * The mechanism this pack models is that *consumption* and *production* are different
 * activities with different returns. Almost every rule here turns on whether finished,
 * inspectable work exists, because that is the artefact both the market and the learner
 * themselves can actually measure against.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'learning.building-in-public',
    label: 'Learning by shipping in the open',
    summary:
      'Instead of finishing a course first, you build small things and publish them. Each piece gets inspected by strangers, which is uncomfortable and also the only feedback loop that does not care how hard you tried. Progress becomes visible in the artefacts rather than in the hours logged.',
    detail:
      'Publishing converts effort into evidence. It also forces scope down to something finishable, which is the skill beginners most often lack.',
    requires: ['learning'],
    type: 'opportunity',
    when: {},
    weight: 14,
    monthsMin: 0,
    monthsMax: 48,
    durationMonths: 4,
    cooldown: 8,
    effects: [
      { key: 'portfolio', op: 'add', value: 9, noise: 0.4, reason: 'finished pieces published' },
      { key: 'skill:craft', op: 'add', value: 6, reason: 'building under real constraints' },
      { key: 'reputation', op: 'add', value: 5, reason: 'visible, inspectable work' },
      { key: 'optionality', op: 'add', value: 5, reason: 'more paths opened by work people can see' },
      { key: 'goalProgress', op: 'add', value: 6, reason: 'measured by output rather than by attendance' },
      { key: 'stress', op: 'add', value: 4, reason: 'publishing before it feels ready' },
    ],
    assumptions: ['Feedback and opportunity attach to finished work, and finished work is available to anyone.'],
    uncertainties: ['Whether anyone is looking; early publishing reaches very few people for a long time.'],
    evidence: [
      { cls: 'assumption', text: 'Public work attracts correction and opportunity; the frequency is not modelled.' },
    ],
    tradeoffs: {
      gains: ['A trail of finished work, which is what gatekeepers actually inspect.'],
      costs: ['Time spent on presentation instead of depth, while still visibly unskilled.'],
    },
    nextSteps: ['Fix the interval before fixing the quality bar; one small thing at a time.'],
    imagination: 0,
  },
  {
    id: 'learning.tutorial-hell',
    label: 'Hours in, nothing to show',
    summary:
      'Course completions rise and the portfolio does not. The material supplies the feeling of progress, a finished lecture and a working example, without ever asking you to produce something a stranger could inspect, so the skill that matters is not the one being exercised. The loop is comfortable, which is why it is hard to leave.',
    detail:
      'Consumption accumulates understanding and produces no artefact. The tell is a rising theory score beside a flat portfolio.',
    requires: ['learning'],
    type: 'setback',
    when: { all: [{ key: 'portfolio', op: '<', value: 30 }, { key: 'skill:structured-theory', op: '>=', value: 35 }] },
    weight: 12,
    monthsMin: 3,
    monthsMax: 48,
    durationMonths: 4,
    cooldown: 14,
    effects: [
      { key: 'skill:structured-theory', op: 'add', value: 6, reason: 'consumption keeps accumulating' },
      { key: 'portfolio', op: 'add', value: -2, reason: 'existing pieces date while nothing new ships' },
      { key: 'goalProgress', op: 'add', value: -7, reason: 'effort without external evidence' },
      { key: 'stress', op: 'add', value: 6, reason: 'hours spent with no visible movement' },
      { key: 'optionality', op: 'add', value: -4, reason: 'no artifact exists to open a door' },
      { key: 'information', op: 'add', value: 10, reason: 'the method is measurably not working' },
    ],
    assumptions: ['Consuming material and producing work are different activities with different returns.'],
    uncertainties: ['How long someone stays inside the loop; it is self-reinforcing and rarely interrupted by events.'],
    evidence: [
      { cls: 'speculation', text: 'Tutorial hell is a widely reported pattern among self-directed learners, not a measured phenomenon.' },
    ],
    tradeoffs: {
      gains: ['A broad map of the field and very cheap experimentation.'],
      costs: ['Calendar time, and the compounding advantage of having shipped nothing.'],
    },
    failurePoints: ['Finishing the course is treated as the goal, which is exactly what keeps the loop closed.'],
    nextSteps: ['Stop adding courses and spend the next ten hours finishing one thing a stranger could use.'],
    imagination: 0,
  },
  {
    id: 'learning.first-paid-work',
    label: 'The portfolio earns its first payment',
    summary:
      'Someone who has inspected the work offers money for more of it. The change is not primarily financial: an outside party has now priced your output, which converts an internal judgement about your ability into a market one, and removes the argument you have been having with yourself.',
    requires: ['learning'],
    type: 'milestone',
    when: { all: [{ key: 'portfolio', op: '>=', value: 45 }] },
    weight: 6,
    monthsMin: 6,
    monthsMax: 72,
    durationMonths: 3,
    once: true,
    effects: [
      { key: 'income', op: 'add', value: 520, noise: 0.6, reason: 'paid work won from the portfolio' },
      { key: 'money', op: 'add', value: 900, noise: 0.7, reason: 'the first payment for it' },
      { key: 'reputation', op: 'add', value: 9, reason: 'a buyer who can vouch for the work' },
      { key: 'skill:client-work', op: 'add', value: 7, reason: 'scoping and delivering for a real buyer' },
      { key: 'optionality', op: 'add', value: 7, reason: 'paid evidence that other people can see' },
      { key: 'stress', op: 'add', value: 5, reason: 'delivering for someone who is paying' },
    ],
    assumptions: ['A portfolio of finished work is enough to reduce the risk for a first small commission.'],
    uncertainties: ['Whether the first buyer arrives through the portfolio or through plain luck.'],
    evidence: [
      { cls: 'assumption', text: 'Inspectable work lowers the information gap for a first buyer; no outcome rate is claimed.' },
    ],
    tradeoffs: {
      gains: ['Market evidence, and a reference worth more than any certificate.'],
      costs: ['Deadlines now belong to someone else, including the parts you would rather not do.'],
    },
    nextSteps: ['Write down what the client actually bought, then sell exactly that again.'],
    imagination: 0,
  },
  {
    id: 'learning.method-change',
    label: 'The current method has stopped working',
    summary:
      'Progress has flattened while effort has not. The evidence points at the method rather than the clock: practice has become repetition at a comfortable difficulty, and more hours at that same difficulty will produce more of the same flat line. Something in the routine has to change, and the change will feel like getting worse.',
    detail:
      'A plateau is treated here as information about the training conditions rather than about the person. The intervention is difficulty or feedback, not volume.',
    requires: ['learning'],
    type: 'decision',
    when: { all: [{ key: 'skill:craft', op: '>=', value: 50 }] },
    weight: 8,
    monthsMin: 8,
    monthsMax: 84,
    durationMonths: 3,
    cooldown: 20,
    effects: [
      { key: 'information', op: 'add', value: 12, reason: 'a diagnosis of why progress stopped' },
      { key: 'decisionConfidence', op: 'add', value: 8, reason: 'a choice made from evidence rather than mood' },
      { key: 'skill:craft', op: 'add', value: 5, noise: 0.5, reason: 'harder, better-targeted practice' },
      { key: 'goalProgress', op: 'add', value: 7, reason: 'the curve moves again' },
      { key: 'focus', op: 'add', value: 6, reason: 'one method chosen deliberately instead of several tried' },
      { key: 'stress', op: 'add', value: 5, reason: 'deliberate practice is uncomfortable by design' },
    ],
    assumptions: ['Changing difficulty or feedback source restarts progress; this is common but unmeasured here.'],
    uncertainties: ['Whether the new method suits this person; there is no way to know in advance of trying it.'],
    evidence: [
      {
        cls: 'research',
        text: 'Expert performance is associated with structured practice at increasing difficulty, not with accumulated hours alone.',
        source: 'Ericsson, Krampe and Tesch-Romer, "The Role of Deliberate Practice" (1993)',
      },
    ],
    tradeoffs: {
      gains: ['The curve moves again and the ceiling is raised.'],
      costs: ['A temporary drop in output while the new method is still clumsy.'],
    },
    nextSteps: ['Take the hardest version of the task you can still get real feedback on.'],
    imagination: 0,
  },
  {
    id: 'learning.community-contribution',
    label: 'A contribution other people keep',
    summary:
      'You fix or extend something a community depends on, and the change is adopted rather than acknowledged. Maintainers now recognise the name, which is a form of reputation no credential can supply because anyone can verify it by reading the history of the project.',
    requires: ['learning'],
    type: 'opportunity',
    when: { all: [{ key: 'skill:craft', op: '>=', value: 40 }, { key: 'portfolio', op: '>=', value: 25 }] },
    weight: 5,
    monthsMin: 6,
    monthsMax: 84,
    durationMonths: 3,
    cooldown: 18,
    once: true,
    effects: [
      { key: 'reputation', op: 'add', value: 12, reason: 'work kept in a project other people rely on' },
      { key: 'network', op: 'add', value: 10, reason: 'maintainers who know the commit history' },
      { key: 'skill:craft', op: 'add', value: 7, reason: 'reviewed by people better than you' },
      { key: 'optionality', op: 'add', value: 9, reason: 'a reputation that travels with you' },
      { key: 'skill:communication', op: 'add', value: 5, reason: 'explaining decisions to strangers in writing' },
      { key: 'stress', op: 'add', value: 3, reason: 'public review from people you have never met' },
    ],
    assumptions: ['Communities reward visible, correct contributions regardless of who made them.'],
    uncertainties: ['Whether the maintainers are welcoming; some projects are not, and that is not visible from outside.'],
    evidence: [
      { cls: 'assumption', text: 'Peer review in public projects is modelled as accelerating skill and reputation together.' },
    ],
    tradeoffs: {
      gains: ['Unprompted credibility and a network built on demonstrated competence.'],
      costs: ['Unpaid hours, and reputational cost if the contribution turns out to be wrong.'],
    },
    nextSteps: ['Start with documentation or a small fix; the real barrier is social, not technical.'],
    imagination: 0.1,
  },
  {
    id: 'learning.imposter-pressure',
    label: 'The gap between you and the people you read',
    summary:
      'The more you learn, the more precisely you can see how much you do not know, and the comparison set has quietly changed to people who have been at it for a decade. Capability is rising while confidence falls, which is a familiar pattern rather than a verdict, but it still costs you the most visible work.',
    requires: ['learning'],
    type: 'setback',
    when: { any: [{ key: 'reputation', op: '>=', value: 35 }, { key: 'skill:craft', op: '>=', value: 55 }] },
    weight: 9,
    monthsMin: 6,
    monthsMax: 96,
    durationMonths: 3,
    cooldown: 15,
    effects: [
      { key: 'wellbeing', op: 'add', value: -8, reason: 'measured against an expert reference set' },
      { key: 'focus', op: 'add', value: -9, reason: 'attention spent on self-assessment' },
      { key: 'stress', op: 'add', value: 7, reason: 'anxiety about the work being seen' },
      { key: 'goalProgress', op: 'add', value: -4, reason: 'the harder, more visible task gets avoided' },
      { key: 'decisionConfidence', op: 'add', value: -6, reason: 'choices deferred while doubt is resolved' },
      { key: 'information', op: 'add', value: 5, reason: 'a more accurate map of the field' },
    ],
    assumptions: ['Self-assessment improves as competence grows, so discomfort here is expected rather than pathological.'],
    uncertainties: ['How much this costs this person; for some it is a rounding error, for others it stops the work.'],
    evidence: [
      {
        cls: 'research',
        text: "Accurate self-appraisal and belief in one's own capability are separable, and competence alone does not produce the belief.",
        source: 'Bandura, "Self-efficacy: Toward a unifying theory of behavioral change" (1977)',
      },
    ],
    tradeoffs: {
      gains: ['A calibrated sense of where the real standard sits.'],
      costs: ['Confidence and forward motion, while nothing measurable has changed.'],
    },
    failurePoints: ['The instinctive response is to stop publishing, which removes the only feedback loop available.'],
    nextSteps: ["Compare against your own last six months, not against someone else's public profile."],
    imagination: 0,
  },
];

export const LEARNING_PACK: RulePack = {
  id: 'learning',
  name: 'Self-directed learning',
  description:
    'Portfolio-first practice, the consumption loop, first paid work, plateaus and method changes, community contribution, and the confidence cost of knowing what you do not know.',
  vars: [],
  rules,
  startingModifiers: [],
};
