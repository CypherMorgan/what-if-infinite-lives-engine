/**
 * Creative pack: making work public and trying to live from it.
 *
 * The mechanism this pack models is that creative output has two independent variables
 * that people constantly confuse: quality and distribution. You can improve one while the
 * other is completely unresponsive, and the platform that carries the work is rented on
 * terms that can be revised without you.
 */
import type { Rule, RulePack } from '../rulePack';

const rules: Rule[] = [
  {
    id: 'creative.ship-anyway',
    label: 'Publishing whether or not anyone is there',
    summary:
      'Work goes out on a schedule regardless of reception. The point is not exposure, it is that production becomes independent of motivation, which is the only reliable way to still be making things in three years after a long stretch of quiet feedback and no particular encouragement.',
    detail:
      'Consistency is modelled as the main controllable input. Nothing here implies that the work will be seen; it only moves the machine that could eventually be.',
    type: 'event',
    requires: ['creative'],
    when: {},
    weight: 15,
    monthsMin: 0,
    monthsMax: 72,
    durationMonths: 4,
    cooldown: 6,
    effects: [
      { key: 'portfolio', op: 'add', value: 8, noise: 0.4, reason: 'finished work released on a schedule' },
      { key: 'skill:craft', op: 'add', value: 6, reason: 'repetition under real deadlines' },
      { key: 'audience', op: 'add', value: 5, noise: 0.6, reason: 'slow accumulation of people who came back' },
      { key: 'goalProgress', op: 'add', value: 6, reason: 'the practice itself is the goal being met' },
      { key: 'stress', op: 'add', value: 4, reason: 'output continues regardless of mood' },
      { key: 'focus', op: 'add', value: -3, reason: 'release days eat into making time' },
    ],
    assumptions: ['A schedule survives longer than motivation, and volume is a precondition for quality.'],
    uncertainties: ['Whether anyone is watching; sustained publishing reaches few people in most fields for a long time.'],
    evidence: [
      { cls: 'assumption', text: 'Consistency is modelled as the main controllable input; no reception outcome is implied.' },
    ],
    tradeoffs: {
      gains: ['A body of work and a production habit that does not depend on how you feel.'],
      costs: ['Some of what ships will be work you would rather nobody had seen.'],
    },
    nextSteps: ['Fix the interval before fixing the quality bar.'],
    imagination: 0,
  },
  {
    id: 'creative.first-piece-lands',
    label: 'The first piece reaches people you did not send it to',
    summary:
      'Something gets shared, quoted, written about or commissioned from, and the people responsible are strangers. The audience number changes, but the more valuable change is informational: you now know which of the things you make travels, and that is knowledge nobody can hand you in advance.',
    detail:
      'The trigger is deliberately unspecified. Which piece lands and why is not predictable, only the fact that a body of work was necessary for it to be possible at all.',
    type: 'milestone',
    requires: ['creative'],
    when: { all: [{ key: 'portfolio', op: '>=', value: 35 }] },
    weight: 6,
    monthsMin: 6,
    monthsMax: 84,
    durationMonths: 3,
    once: true,
    effects: [
      { key: 'audience', op: 'add', value: 18, noise: 0.6, reason: 'strangers passing the work onward' },
      { key: 'reputation', op: 'add', value: 10, reason: 'a named piece people can point at' },
      { key: 'optionality', op: 'add', value: 8, reason: 'inbound interest that did not exist before' },
      { key: 'wellbeing', op: 'add', value: 9, reason: 'external evidence after a long quiet stretch' },
      { key: 'goalProgress', op: 'add', value: 9, reason: 'the work found an audience without being pushed' },
      { key: 'stress', op: 'add', value: 5, reason: 'attention arriving faster than expected' },
    ],
    assumptions: ['A piece has to be visible before it can be found, and most work never becomes visible.'],
    uncertainties: ['Which piece, and when. There is no way to predict the one that lands.'],
    evidence: [
      { cls: 'speculation', text: 'The trigger is left vague because the pattern is common and the cause is genuinely unknown.' },
    ],
    tradeoffs: {
      gains: ['A proof of concept and a template for what to make next.'],
      costs: ['The temptation to make more of the same thing forever after it.'],
    },
    nextSteps: ['Work out what that piece had in common with your other work before repeating it.'],
    imagination: 0.2,
  },
  {
    id: 'creative.platform-change',
    label: 'The channel changes the rules underneath you',
    summary:
      'A platform alters its ranking, its monetisation or its policy, and reach that took years to build disappears in a week. Nothing about the work changed. The distribution was rented, and the terms were revised by a party with no obligation to the people the revision affected.',
    type: 'setback',
    requires: ['creative'],
    when: { all: [{ key: 'audience', op: '>=', value: 45 }] },
    weight: 6,
    monthsMin: 8,
    monthsMax: 96,
    durationMonths: 5,
    cooldown: 30,
    once: true,
    effects: [
      { key: 'audience', op: 'add', value: -24, noise: 0.5, reason: 'reach removed by a platform policy change' },
      { key: 'income', op: 'add', value: -420, noise: 0.6, reason: 'monetisation terms rewritten' },
      { key: 'optionality', op: 'add', value: -12, reason: 'a rented channel proved to be exactly that' },
      { key: 'stress', op: 'add', value: 11, reason: 'income and audience reset at the same moment' },
      { key: 'goalProgress', op: 'add', value: -10, reason: 'years of accumulated reach reset' },
      { key: 'information', op: 'add', value: 14, reason: 'single-channel dependence, measured the hard way' },
    ],
    assumptions: ["Distribution built on somebody else's platform is subject to unilateral revision at any time."],
    uncertainties: ['Timing and direction; platform changes are announced rarely and explained even less.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a structural risk of rented distribution, not as a prediction about any platform.' },
    ],
    tradeoffs: {
      gains: ['A durable lesson about owning the audience relationship directly.'],
      costs: ['The rebuild happens from a weaker position than the original build did.'],
    },
    failurePoints: ['Doubling down on the same channel after the change is the common, expensive response.'],
    nextSteps: ['Move the audience somewhere you control: a list, a feed, a direct address.'],
    imagination: 0.1,
  },
  {
    id: 'creative.unpaid-work-trap',
    label: 'The work is used and nobody pays for it',
    summary:
      'Exposure arrives instead of money, and every yes raises your visibility while lowering your rate. This is a trap rather than a swindle, because each individual offer is rational on its own terms: the portfolio grows, the reputation grows, and the bank account does not, until the calendar is full of work that pays nothing.',
    detail:
      'The damage is to the reference price. Once the market has seen the work given away, every later fee has to argue against that precedent.',
    type: 'consequence',
    requires: ['creative'],
    when: { all: [{ key: 'reputation', op: '>=', value: 25 }, { key: 'portfolio', op: '>=', value: 30 }] },
    weight: 9,
    monthsMin: 5,
    monthsMax: 72,
    durationMonths: 4,
    cooldown: 20,
    effects: [
      { key: 'reputation', op: 'add', value: 8, reason: 'more people see the work' },
      { key: 'portfolio', op: 'add', value: 7, reason: 'the output exists and is inspectable' },
      { key: 'income', op: 'add', value: -260, noise: 0.7, reason: 'fee replaced by exposure' },
      { key: 'money', op: 'add', value: -900, noise: 0.6, reason: 'hours given away that could have been billed' },
      { key: 'energy', op: 'add', value: -9, reason: 'capacity spent on commitments that pay nothing' },
      { key: 'optionality', op: 'add', value: -6, reason: 'a lower reference price set by precedent' },
    ],
    assumptions: ['Visibility is genuinely valuable early, which is exactly what makes the trade seductive.'],
    uncertainties: ['Whether the exposure converts; often it does not, and the counterfactual is invisible.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a drift in reference price rather than as a single bad decision.' },
    ],
    tradeoffs: {
      gains: ['A larger audience and a portfolio that keeps growing.'],
      costs: ['Cash, energy, and a market that has learned the work is cheap.'],
    },
    failurePoints: ['The trap closes when the unpaid work is what fills the calendar.'],
    nextSteps: ['Quote a real number to the next requester, even if it is a discounted one.'],
    imagination: 0,
  },
  {
    id: 'creative.commission',
    label: 'Somebody pays for exactly this',
    summary:
      'A brief arrives with a budget attached. Being commissioned differs from being hired: the buyer is purchasing the particular thing you do, so the work reinforces the direction instead of diluting it, provided the scope, the rounds and the kill fee are written down before anything begins.',
    detail:
      'The contract is part of the work. An unwritten scope is the most common way a good commission turns into unpaid labour with a deadline.',
    type: 'opportunity',
    requires: ['creative'],
    when: { all: [{ key: 'reputation', op: '>=', value: 40 }] },
    weight: 7,
    monthsMin: 8,
    monthsMax: 96,
    durationMonths: 4,
    cooldown: 18,
    once: true,
    effects: [
      { key: 'income', op: 'add', value: 1400, noise: 0.7, reason: 'commission fee against a written brief' },
      { key: 'money', op: 'add', value: 2200, noise: 0.6, reason: 'first payment on the commission' },
      { key: 'reputation', op: 'add', value: 9, reason: 'a public, attributed commission' },
      { key: 'skill:client-work', op: 'add', value: 7, reason: 'scope, brief and delivery under contract' },
      { key: 'optionality', op: 'add', value: 7, reason: 'a second buyer for the same kind of work' },
      { key: 'stress', op: 'add', value: 6, reason: 'somebody else owns the deadline now' },
    ],
    assumptions: ['The commission is paid, scoped and delivered under an agreement rather than on trust alone.'],
    uncertainties: ['Whether it leads to another; a single commission proves remarkably little.'],
    evidence: [
      { cls: 'assumption', text: 'Paid briefs are treated as strong evidence of a market for this specific work.' },
    ],
    tradeoffs: {
      gains: ['Paid practice doing the thing you would have been doing anyway.'],
      costs: ['Creative control becomes negotiable, and the deadline is not.'],
    },
    nextSteps: ['Write scope, revision rounds and a kill fee before starting.'],
    imagination: 0,
  },
  {
    id: 'creative.can-it-carry-you',
    label: 'Can the work actually carry the life?',
    summary:
      'The numbers are finally on the table: what the work earns, what it costs to make, and how uneven the payments are across a year. The question is not whether the work is good, it is whether this combination of income variance and hours can support commitments you already have.',
    detail:
      'The decision is driven by measured variance rather than by confidence. Risk rises here even when the answer is yes, because everything now rests on one uneven source.',
    type: 'decision',
    requires: ['creative'],
    when: { any: [{ key: 'income', op: '>=', value: 1600 }, { key: 'audience', op: '>=', value: 55 }] },
    weight: 5,
    monthsMin: 18,
    monthsMax: 120,
    durationMonths: 4,
    cooldown: 30,
    once: true,
    effects: [
      { key: 'information', op: 'add', value: 16, reason: 'the real economics of the work, measured' },
      { key: 'decisionConfidence', op: 'add', value: 12, reason: 'a decision taken from a year of actual data' },
      { key: 'optionality', op: 'add', value: 8, reason: 'a direction chosen rather than defaulted into' },
      { key: 'goalProgress', op: 'add', value: 11, reason: 'a deliberate commitment to the work' },
      { key: 'stress', op: 'add', value: -8, reason: 'the ambiguity of not having decided is over' },
      { key: 'risk', op: 'add', value: 9, reason: 'income now depends on a single uneven source' },
    ],
    assumptions: ['A year of income history is enough to make structural risk visible, though nowhere near enough to forecast.'],
    uncertainties: ['Whether demand holds; nobody has that number in advance, including people it worked out for.'],
    evidence: [
      { cls: 'assumption', text: 'Modelled as a decision point driven by measured variance rather than by confidence levels.' },
    ],
    tradeoffs: {
      gains: ['A deliberate choice made from evidence, with the ambiguity resolved.'],
      costs: ['Everything now rests on one uneven source of income.'],
    },
    failurePoints: ['Using a good year as though it were a baseline is the standard version of this mistake.'],
    nextSteps: ["Write down the number that would make you stop, while you can still think about it clearly."],
    imagination: 0,
  },
];

export const CREATIVE_PACK: RulePack = {
  id: 'creative',
  name: 'Creative work',
  description:
    'Shipping regardless of reception, the first piece that travels, platforms that revise the rules, the unpaid-work trap, commissions, and the question of whether the work can carry a life.',
  vars: [],
  rules,
  startingModifiers: [],
};
