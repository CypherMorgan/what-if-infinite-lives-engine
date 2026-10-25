/**
 * Branch diff — two paths, side by side.
 *
 * The graph shows every path at once, which is the right way to see the shape
 * of a decision and the wrong way to answer "so which of these two is
 * different, and where do they part company?". This module answers that
 * question: it lines two branches up next to each other, finds the last step
 * they share, and lists the numbers that end up different.
 *
 * The comparison is made at a common moment. Two branches rarely end at the
 * same month, and comparing a state at month 12 with a state at month 30
 * would show the difference in *time* rather than the difference in *path*. So
 * both branches are projected forward to the horizon before they are compared.
 *
 * Like the dossier, everything here is derived from the document. There is no
 * scoring, no ranking and no recommendation — the diff reports what the model
 * produced and which side each difference favours, and stops there.
 */
import type { NodeId, SimulationDoc, StateVector } from './types';
import type { RulePack } from './rulePack';
import { forecastFrom, pathTo } from './engine';
import { NODE_TYPE_GUIDE, describeHorizon } from './graphLegend';
import { compareStates, largestGaps, type StateDiffMetric } from './compareMetrics';

/** One step on a path, reduced to what the diff needs to show it. */
export interface BranchDiffStep {
  id: NodeId;
  title: string;
  summary: string;
  /** "now" or "month 12". */
  atLabel: string;
  /** Months from the start of the scenario. */
  t: number;
  glyph: string;
  /** The plain-English name of the kind of step this is. */
  typeName: string;
}

export interface BranchDiffSide {
  branchId: string;
  name: string;
  hue: number;
  description: string;
  steps: BranchDiffStep[];
  /** The step the path ends on, if it has one. */
  endNodeId: NodeId | null;
  endTitle: string;
  endAtLabel: string;
  /** The state this path is projected to at the horizon. */
  projected: StateVector | null;
}

/** A number that ends up different between the two paths. */
export type BranchDiffMetric = StateDiffMetric;

export interface BranchDiff {
  a: BranchDiffSide;
  b: BranchDiffSide;
  /** The last step the two paths share — where they part company. */
  divergedAt: { nodeId: NodeId; title: string; atLabel: string; isStart: boolean } | null;
  /** The month the comparison is made at. */
  compareMonth: number;
  compareLabel: string;
  metrics: BranchDiffMetric[];
  /** How many of the tracked variables end up the same on both paths. */
  sameCount: number;
  /** How many end up different. */
  diffCount: number;
  /** One sentence describing the difference. */
  headline: string;
  /** The tally: which path is ahead on how many differences. */
  verdict: string;
}

/**
 * Builds the diff between two branches.
 *
 * Returns null when either branch does not exist.
 */
export function buildBranchDiff(
  doc: SimulationDoc,
  aBranchId: string,
  bBranchId: string,
  packs: readonly RulePack[]
): BranchDiff | null {
  const a = sideFor(doc, aBranchId, packs);
  const b = sideFor(doc, bBranchId, packs);
  if (!a || !b) return null;

  /* ---------------- where they part company ---------------- */

  const pathA = a.endNodeId ? pathTo(doc, a.endNodeId) : [];
  const pathB = b.endNodeId ? pathTo(doc, b.endNodeId) : [];
  const shared: NodeId[] = [];
  for (const id of pathA) {
    if (pathB.includes(id)) shared.push(id);
    else break;
  }
  const lastShared = shared.length > 0 ? shared[shared.length - 1] : undefined;
  const divergeNode = lastShared ? doc.nodes[lastShared] : undefined;
  const divergedAt = divergeNode
    ? {
        nodeId: divergeNode.id,
        title: divergeNode.title,
        atLabel: divergeNode.t === 0 ? 'now' : `month ${divergeNode.t}`,
        isStart: divergeNode.type === 'start',
      }
    : null;

  /* ---------------- the numbers ---------------- */

  const compareMonth = Math.max(doc.prompt.horizon, endMonth(doc, a), endMonth(doc, b));
  const stateA = a.projected ?? {};
  const stateB = b.projected ?? {};
  const { metrics, sameCount } = compareStates(stateA, stateB);

  /* ---------------- the wording ---------------- */

  const when = describeHorizon(compareMonth);
  const top = metrics.slice(0, 3);
  const headline =
    metrics.length === 0
      ? `By ${when}, ${a.name} and ${b.name} end up in the same place as far as the model can tell.`
      : `By ${when}, the two paths differ on ${metrics.length} thing${metrics.length === 1 ? '' : 's'}. The largest gaps are ${largestGaps(top)}.`;

  const aWins = metrics.filter((m) => m.favours === 'a').length;
  const bWins = metrics.filter((m) => m.favours === 'b').length;
  let verdict: string;
  if (metrics.length === 0) {
    verdict = 'On everything the model tracks, these two paths end up the same.';
  } else if (aWins === bWins) {
    verdict = `The differences split evenly: ${aWins} favour ${a.name}, ${bWins} favour ${b.name}.`;
  } else {
    const winner = aWins > bWins ? a : b;
    const count = Math.max(aWins, bWins);
    verdict = `${count} of the ${metrics.length} differences favour ${winner.name}.`;
  }
  if (sameCount > 0) {
    verdict += ` ${sameCount} other thing${sameCount === 1 ? '' : 's'} the model tracks end up the same either way.`;
  }

  return {
    a,
    b,
    divergedAt,
    compareMonth,
    compareLabel: when,
    metrics,
    sameCount,
    diffCount: metrics.length,
    headline,
    verdict,
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function sideFor(
  doc: SimulationDoc,
  branchId: string,
  packs: readonly RulePack[]
): BranchDiffSide | null {
  const branch = doc.branches[branchId];
  if (!branch) return null;

  const nodes = Object.values(doc.nodes)
    .filter((n) => n.branch === branchId)
    .sort((x, y) => x.t - y.t || x.depth - y.depth || x.title.localeCompare(y.title));

  const steps: BranchDiffStep[] = nodes.map((n) => {
    const guide = NODE_TYPE_GUIDE[n.type];
    return {
      id: n.id,
      title: n.title,
      summary: n.summary,
      atLabel: n.t === 0 ? 'now' : `month ${n.t}`,
      t: n.t,
      glyph: guide.glyph,
      typeName: guide.short,
    };
  });

  // The end of a path is the step furthest in time. When two steps share a
  // time, the one that does not lead anywhere else is the end.
  const end = branchEndNode(doc, branchId);

  return {
    branchId,
    name: branch.name,
    hue: branch.hue,
    description: branch.description,
    steps,
    endNodeId: end?.id ?? null,
    endTitle: end?.title ?? '',
    endAtLabel: end ? (end.t === 0 ? 'now' : `month ${end.t}`) : 'now',
    projected: end ? forecastFrom(doc, end.id, packs, 0) : null,
  };
}

/** The step a path ends on: furthest in time, preferring a leaf at that time. */
export function branchEndNode(doc: SimulationDoc, branchId: string) {
  const nodes = Object.values(doc.nodes).filter((n) => n.branch === branchId);
  return nodes.reduce<(typeof nodes)[number] | null>((best, n) => {
    if (!best) return n;
    if (n.t > best.t) return n;
    if (n.t === best.t && best.children.length > 0 && n.children.length === 0) return n;
    return best;
  }, null);
}

function endMonth(doc: SimulationDoc, side: BranchDiffSide): number {
  const end = side.endNodeId ? doc.nodes[side.endNodeId] : undefined;
  return end?.t ?? 0;
}
