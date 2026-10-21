/**
 * The vocabulary of the graph, in plain English.
 *
 * The canvas, the legend, the inspector and the node list all have to agree on
 * what a shape means and what a colour means. Keeping that agreement in one
 * place means a newcomer never has to guess — and it means the legend can
 * never drift away from what is actually drawn.
 *
 * The guiding rule for every string here: say what the thing *is*, not what
 * the code calls it. "A difficulty" rather than "setback". "Where you are now"
 * rather than "start node".
 */
import type { NodeType } from './types';

export interface NodeTypeGuide {
  /** The glyph drawn on the card. */
  glyph: string;
  /** A single word, for the card and the legend. */
  short: string;
  /** The plain-English name. */
  name: string;
  /** One line explaining what this kind of node means. */
  meaning: string;
  /** RGB tint used for the glyph on the canvas. */
  tint: [number, number, number];
}

export const NODE_TYPE_GUIDE: Record<NodeType, NodeTypeGuide> = {
  start: {
    glyph: '◆',
    short: 'Now',
    name: 'Where you are now',
    meaning: 'The starting point of this universe. Everything else grows out of it.',
    tint: [79, 216, 255],
  },
  decision: {
    glyph: '◈',
    short: 'Decision',
    name: 'A choice you make',
    meaning: 'A fork in the road — a choice that leads to genuinely different futures.',
    tint: [255, 183, 77],
  },
  event: {
    glyph: '●',
    short: 'Event',
    name: 'Something happens',
    meaning: 'An event, whether you planned it or not.',
    tint: [177, 140, 255],
  },
  opportunity: {
    glyph: '▲',
    short: 'Opening',
    name: 'An opening',
    meaning: 'Something becomes available to you.',
    tint: [92, 230, 168],
  },
  setback: {
    glyph: '▼',
    short: 'Difficulty',
    name: 'A difficulty',
    meaning: 'A problem, a cost, or a delay. Every realistic path has these.',
    tint: [255, 125, 156],
  },
  milestone: {
    glyph: '✦',
    short: 'Turning point',
    name: 'A turning point',
    meaning: 'A significant change in your circumstances.',
    tint: [255, 224, 130],
  },
  consequence: {
    glyph: '»',
    short: 'Result',
    name: 'What follows',
    meaning: 'The direct result of the step before it.',
    tint: [154, 166, 196],
  },
  alternative: {
    glyph: '❖',
    short: 'Other route',
    name: 'Another way',
    meaning: 'A different route that was available but not taken.',
    tint: [126, 200, 255],
  },
  ending: {
    glyph: '■',
    short: 'Later',
    name: 'Where it lands',
    meaning: 'The state of things at the end of the horizon.',
    tint: [232, 237, 249],
  },
};

/** The order node types appear in the legend — roughly how a story unfolds. */
export const NODE_TYPE_ORDER: NodeType[] = [
  'start',
  'decision',
  'event',
  'opportunity',
  'setback',
  'milestone',
  'consequence',
  'alternative',
  'ending',
];

/**
 * The short sentences shown the first time somebody opens the graph.
 *
 * Deliberately no jargon. A newcomer needs to know three things: where they
 * are, which way time runs, and what they can do next.
 */
export const GRAPH_ORIENTATION = {
  title: 'How to read this graph',
  points: [
    {
      heading: 'It starts with you, right now.',
      body: 'The blue diamond is where your life stands today. Every branch grows out of it.',
    },
    {
      heading: 'Each branch is one possible direction.',
      body: 'A branch is a "what if I went this way instead?" — a different route from the same starting point.',
    },
    {
      heading: 'Time runs from left to right.',
      body: 'Cards further right are further in the future. The number on each card is how many months from now it sits.',
    },
    {
      heading: 'Click a card to see why it is there.',
      body: 'The panel on the right explains what each step assumes, what it costs, and what could go wrong.',
    },
    {
      heading: 'Nothing here is a prediction.',
      body: 'This is a model built from the numbers you gave it. It shows consequences, not prophecies.',
    },
  ],
} as const;

/**
 * A plain-English description of the scenario's time horizon.
 *
 * "60 months" is a number nobody feels. "5 years" is.
 */
export function describeHorizon(months: number): string {
  if (months < 1) return 'less than a month';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = months / 12;
  const rounded = Math.round(years * 10) / 10;
  const yearText = `${rounded} year${rounded === 1 ? '' : 's'}`;
  const leftover = months % 12;
  if (leftover === 0) return yearText;
  return `${yearText} ${leftover} month${leftover === 1 ? '' : 's'}`;
}

/** A short word for how far the model reaches. */
export function imaginationLabel(value: number): string {
  const pct = Math.round(value * 100);
  if (pct <= 33) return 'grounded';
  if (pct <= 66) return 'balanced';
  return 'imaginative';
}

/**
 * A plain-English description of the imagination setting.
 *
 * The number itself is meaningless to most people; what it controls is not.
 */
export function describeImagination(value: number): string {
  const pct = Math.round(value * 100);
  const label = imaginationLabel(value);
  if (label === 'grounded')
    return `Grounded — ${pct}% reach. Mostly ordinary, defensible developments.`;
  if (label === 'balanced')
    return `Balanced — ${pct}% reach. Grounded paths, plus a few less obvious ones.`;
  return `Imaginative — ${pct}% reach. Less likely, but internally coherent possibilities.`;
}
