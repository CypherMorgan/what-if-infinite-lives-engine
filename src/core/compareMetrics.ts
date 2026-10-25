/**
 * Comparing two state vectors, in numbers a person can read.
 *
 * Two features need the same answer to "which tracked quantities end up
 * different, and which side does the model consider better?": the branch diff
 * (two paths inside one universe) and the universe diff (the same path in two
 * versions of a universe). Keeping the comparison here means the two views
 * cannot disagree about what counts as a difference, how big it is, or which
 * side it favours.
 *
 * Nothing here is scored and nothing is recommended. A metric reports what the
 * engine produced and which direction its own variable definition calls better.
 */
import type { StateVector, VarUnit } from './types';
import { ALL_VARS } from './packs/vars';
import { formatValue, getState, isBetter, noiseFloor } from './vars';

/** A number that ends up different between two states. */
export interface StateDiffMetric {
  key: string;
  label: string;
  unit: VarUnit;
  /** The value in the first state. */
  a: number;
  /** The value in the second state. */
  b: number;
  aText: string;
  bText: string;
  /** "b − a", formatted. */
  deltaText: string;
  delta: number;
  /** Which side this difference favours. 'same' when neither is better. */
  favours: 'a' | 'b' | 'same';
}

export interface StateComparison {
  metrics: StateDiffMetric[];
  /** How many tracked variables end up the same on both sides. */
  sameCount: number;
}

/**
 * Compares two states over the union of their keys.
 *
 * Differences below the variable's noise floor are counted as the same, so the
 * table does not fill with model jitter. Metrics are sorted largest-first.
 */
export function compareStates(a: StateVector, b: StateVector): StateComparison {
  const tracked = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const metrics: StateDiffMetric[] = [];
  let sameCount = 0;

  for (const key of tracked) {
    const def = ALL_VARS.find((v) => v.key === key);
    if (!def) continue;
    const from = getState(a, key);
    const to = getState(b, key);
    const delta = to - from;
    if (Math.abs(delta) < noiseFloor(def.unit, def.key)) {
      sameCount += 1;
      continue;
    }
    let favours: StateDiffMetric['favours'] = 'same';
    if (isBetter(delta, def)) favours = 'b';
    else if (isBetter(-delta, def)) favours = 'a';
    metrics.push({
      key,
      label: def.label,
      unit: def.unit,
      a: from,
      b: to,
      aText: formatValue(from, def.unit),
      bText: formatValue(to, def.unit),
      deltaText: signedText(delta, def.unit),
      delta,
      favours,
    });
  }

  // The largest differences lead, so the consequential ones are what a person
  // reads first.
  metrics.sort((x, y) => metricMagnitude(y) - metricMagnitude(x));
  return { metrics, sameCount };
}

/** How big a difference is, relative to its unit. */
export function metricMagnitude(metric: Pick<StateDiffMetric, 'delta' | 'unit'>): number {
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

/** A magnitude with a unit a person can read. */
export function amountText(value: number, unit: VarUnit): string {
  const abs = Math.abs(value);
  switch (unit) {
    case 'level':
      return `${Math.round(abs)} points`;
    case 'months':
      return `${Math.round(abs * 10) / 10} months`;
    case 'percent':
      return `${Math.round(abs)}%`;
    case 'currency':
      return formatValue(abs, 'currency');
    case 'count':
      return `${Math.round(abs * 10) / 10}`;
    default:
      return `${Math.round(abs * 10) / 10}`;
  }
}

/**
 * A difference with its sign spelled out.
 *
 * "+$71k" and "−28 points" read as a direction at a glance; "$71k" and
 * "−28 points" do not, because the first one is unsigned.
 */
export function signedText(delta: number, unit: VarUnit): string {
  if (Math.abs(delta) < 1e-9) return 'no change';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${amountText(delta, unit)}`;
}

/**
 * A short plain-language list of the largest gaps, e.g.
 * "Money ($12k), Wellbeing (9 points)".
 */
export function largestGaps(metrics: readonly StateDiffMetric[], limit = 3): string {
  return metrics
    .slice(0, limit)
    .map((m) => `${m.label} (${amountText(Math.abs(m.delta), m.unit)})`)
    .join(', ');
}
