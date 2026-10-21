/**
 * The Future Dossier.
 *
 * A dossier is a plain-English brief about one path: where it leads, what it
 * costs, what it rests on, and how much the model is allowed to wobble.
 *
 * Everything in it is computed. The projection comes from `forecastFrom`, the
 * wobble from `outcomeSpread`, the reasoning from `whyThisPath`, and the
 * stability from `stabilityBetween`. Nothing is written by hand and nothing is
 * invented — where the model has nothing to say, the dossier says so rather
 * than filling the gap with prose.
 *
 * The module is deliberately free of UI concerns so it can be unit-tested and
 * reused by the export path.
 */
import type { NodeId, SimulationDoc, VarDef, VarUnit } from './types';
import type { RulePack } from './rulePack';
import { forecastFrom, outcomeSpread, type Spread } from './engine';
import { noisyKeys, snapshot, stabilityBetween, whyThisPath } from './counterfactual';
import { formatDelta, formatValue, getState, isBetter, noiseFloor } from './vars';
import { describeHorizon } from './graphLegend';

/** Which way a number moved, from the point of view of the person living it. */
export type DossierTone = 'better' | 'worse' | 'flat';

export interface DossierMetric {
  key: string;
  label: string;
  unit: VarUnit;
  /** Where the number stands at the node the dossier is about. */
  now: number;
  /** Where the model puts it by the end of the horizon. */
  projected: number;
  nowText: string;
  projectedText: string;
  delta: number;
  deltaText: string;
  tone: DossierTone;
  /** True when the model's own rules inject randomness into this variable. */
  noisy: boolean;
  hint?: string;
}

export interface Dossier {
  nodeId: NodeId;
  title: string;
  branchId: string;
  branchName: string;
  hue: number;
  /** Months from "now" the node sits at. */
  month: number;
  atLabel: string;
  /** The node's own time band, e.g. "6–18 months". */
  horizon: string;
  /** The month the projection reaches. */
  projectedMonth: number;
  projectedLabel: string;
  /** One sentence describing the path in plain words. */
  headline: string;
  metrics: DossierMetric[];
  /** The metric the spread figures describe. */
  headlineMetric: DossierMetric | null;
  gains: string[];
  costs: string[];
  /** Why the model produced this path, step by step. */
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  /** Things this path leaves alone. */
  stable: string[];
  /** Things that have moved since the start, on steady variables. */
  moved: string[];
  /** Things that move on variables the model treats as jumpy. */
  sensitive: string[];
  spread: Spread | null;
  spreadNote: string;
  confidence: string;
  /** Assumptions the engine recorded for this step. */
  assumptions: string[];
  /** The inputs with the largest measured influence on the outcome. */
  influentialInputs: { label: string; influence: number }[];
  provenance: string;
}

export interface DossierOptions {
  /** How many samples to use for the model-spread figure. */
  samples?: number;
}

/**
 * Builds the dossier for a node.
 *
 * Returns null when the node does not exist or carries no state to project
 * from — an empty dossier is worse than no dossier.
 */
export function buildDossier(
  doc: SimulationDoc,
  nodeId: NodeId,
  packs: readonly RulePack[],
  options: DossierOptions = {}
): Dossier | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;

  const current = node.state;
  if (!current) return null;

  const projected = forecastFrom(doc, nodeId, packs, 0);
  if (!projected) return null;

  const branch = doc.branches[node.branch];
  const noisy = new Set(noisyKeys(packs));
  const projectedMonth = Math.max(doc.prompt.horizon, node.t);

  /* ---------------- the outlook ---------------- */

  const metrics: DossierMetric[] = [];
  for (const def of doc.vars) {
    if (!(def.key in current) || !(def.key in projected)) continue;
    const now = getState(current, def.key);
    const after = getState(projected, def.key);
    const delta = after - now;
    const floor = noiseFloor(def.unit, def.key);
    const moved = Math.abs(delta) >= floor;
    const tone: DossierTone = !moved ? 'flat' : isBetter(delta, def) ? 'better' : 'worse';
    metrics.push({
      key: def.key,
      label: def.label,
      unit: def.unit,
      now,
      projected: after,
      nowText: formatValue(now, def.unit),
      projectedText: formatValue(after, def.unit),
      delta,
      deltaText: formatDelta(delta, def.unit),
      tone,
      noisy: noisy.has(def.key),
      ...(def.hint ? { hint: def.hint } : {}),
    });
  }

  // Primary variables first, then whatever moved most.
  const primary = new Set(doc.vars.filter((v) => v.primary).map((v) => v.key));
  metrics.sort((a, b) => {
    const pa = primary.has(a.key) ? 0 : 1;
    const pb = primary.has(b.key) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return magnitude(b) - magnitude(a);
  });

  const movedMetrics = metrics.filter((m) => m.tone !== 'flat');
  const headlineMetric = movedMetrics[0] ?? null;

  /* ---------------- the wording ---------------- */

  const headline = buildHeadline(movedMetrics, projectedMonth);

  let confidence: string;
  const noisyMoved = movedMetrics.filter((m) => m.noisy);
  if (movedMetrics.length === 0) {
    confidence =
      'Nothing the model tracks moves much from here, so there is little here to be confident or worried about.';
  } else if (noisyMoved.length === 0) {
    confidence = 'Every change here sits on a variable the model treats as steady.';
  } else {
    confidence = `${noisyMoved.length} of the changes here sit on variables the model itself treats as jumpy — read those numbers loosely.`;
  }

  /* ---------------- the wobble ---------------- */

  const spreadKey = headlineMetric?.key ?? metrics[0]?.key ?? null;
  const spread = spreadKey
    ? outcomeSpread(doc, nodeId, packs, spreadKey, options.samples ?? 24)
    : null;

  /* ---------------- what happened on the way here ---------------- */

  const startId = Object.values(doc.nodes).find((n) => n.type === 'start')?.id;
  let stable: string[] = [];
  let moved: string[] = [];
  let sensitive: string[] = [];
  if (startId && startId !== nodeId) {
    const a = snapshot(doc, startId);
    const b = snapshot(doc, nodeId);
    if (a && b) {
      const report = stabilityBetween(a, b, [...noisy]);
      // The raw report covers every variable the engine tracks — thirty-odd
      // names. Only the ones a person actually reads are worth showing.
      const readable = new Set(doc.vars.filter((v) => v.primary).map((v) => v.label));
      stable = report.stable.filter((label) => readable.has(label));
      moved = report.moved.filter((label) => readable.has(label));
      sensitive = report.sensitive.filter((label) => readable.has(label));
    }
  }

  const influentialInputs = doc.assumptions
    .filter((a) => a.sensitivity > 0)
    .sort((x, y) => y.sensitivity - x.sensitivity)
    .slice(0, 3)
    .map((a) => ({ label: a.label, influence: Math.round(a.sensitivity * 100) }));

  return {
    nodeId: node.id,
    title: node.title,
    branchId: node.branch,
    branchName: branch?.name ?? 'This path',
    hue: branch?.hue ?? 200,
    month: node.t,
    atLabel: node.t === 0 ? 'now' : `month ${node.t}`,
    horizon: node.horizon,
    projectedMonth,
    projectedLabel: describeHorizon(projectedMonth),
    headline,
    metrics,
    headlineMetric,
    gains: node.tradeoffs?.gains ?? [],
    costs: node.tradeoffs?.costs ?? [],
    reasons: whyThisPath(doc, nodeId).map(cleanReason),
    risks: [...(node.failurePoints ?? []), ...node.uncertainties],
    nextSteps: node.nextSteps ?? [],
    stable,
    moved,
    sensitive,
    spread,
    spreadNote:
      'How much this number could wobble if the model made slightly different internal choices. It is a measure of the model, not a probability of anything happening to you.',
    confidence,
    assumptions: node.assumptions,
    influentialInputs,
    provenance: doc.meta.provenance,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * How much a metric moved, relative to its unit.
 *
 * Comparing raw deltas across units would let a $500 swing drown out a
 * three-month change in runway, so each unit gets its own yardstick.
 */
function magnitude(metric: DossierMetric): number {
  const scale =
    metric.unit === 'currency'
      ? 1000
      : metric.unit === 'months'
        ? 6
        : metric.unit === 'percent' || metric.unit === 'level'
          ? 20
          : 10;
  return Math.abs(metric.delta) / scale;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** "3 months", "12 points", "$1.2k" — a magnitude with a unit a person can read. */
function deltaPhrase(metric: DossierMetric): string {
  const abs = Math.abs(metric.delta);
  switch (metric.unit) {
    case 'level':
      return `${round1(abs)} points`;
    case 'months':
      return `${round1(abs)} months`;
    case 'percent':
      return `${Math.round(abs)}%`;
    case 'currency':
      return formatValue(abs, 'currency');
    case 'count':
      return `${round1(abs)}`;
    default:
      return `${round1(abs)}`;
  }
}

function joinList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}

function buildHeadline(moved: DossierMetric[], projectedMonth: number): string {
  const when = describeHorizon(projectedMonth);
  if (moved.length === 0) {
    return `Nothing the model tracks moves much between here and ${when}.`;
  }
  const top = moved.slice(0, 3).map((m) => {
    const verb = m.tone === 'better' ? 'improves' : 'gets worse';
    return `${m.label} ${verb} by ${deltaPhrase(m)}`;
  });
  return `By ${when}, ${joinList(top)}.`;
}

/**
 * The variable definition for a metric, if the document still declares it.
 * Used by the UI for tooltips.
 */
export function metricDef(doc: SimulationDoc, key: string): VarDef | undefined {
  return doc.vars.find((v) => v.key === key);
}

/**
 * Drops the internal rule id from a reason.
 *
 * "triggered by the state reached earlier (rule learning.building-in-public)"
 * is traceable but opaque. The id stays available in the inspector; the
 * dossier is for people who want the story, not the mechanism.
 */
function cleanReason(reason: string): string {
  return reason.replace(/\s*\(rule [^)]*\)/g, '');
}
