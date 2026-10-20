/**
 * Variable registry, units and formatting.
 *
 * Variables are plain numeric state keys so that state is trivially diffable and
 * serialisable. This module supplies the metadata that makes them presentable and gives
 * the simulation engine its "is more of this good?" semantics.
 */
import type { VarDef, VarUnit, StateVector } from './types';

export function formatValue(value: number, unit: VarUnit): string {
  switch (unit) {
    case 'currency': {
      const abs = Math.abs(value);
      const sign = value < 0 ? '-' : '';
      if (abs >= 1_000_000)
        return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
      if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
      return `${sign}$${Math.round(abs)}`;
    }
    case 'months':
      return `${round1(value)} mo`;
    case 'percent':
      return `${Math.round(value)}%`;
    case 'count':
      return round1(value).toString();
    case 'level':
      return `${Math.round(value)}/100`;
    case 'index':
    default:
      return round1(value).toString();
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Signed delta formatting, e.g. "+$1.2k" / "−8%". */
export function formatDelta(delta: number, unit: VarUnit): string {
  if (Math.abs(delta) < 1e-9) return 'no change';
  const body = formatValue(Math.abs(delta), unit).replace(/^-/, '');
  return `${delta > 0 ? '+' : '−'}${body}`;
}

/** Human label for a month offset, e.g. 0 -> "now", 18 -> "1.5 years". */
export function formatHorizon(months: number): string {
  if (months <= 0) return 'now';
  if (months < 12) return `${Math.round(months)} mo`;
  const years = months / 12;
  return `${round1(years)} yr`;
}

/** Clamp helper used by every state transition so values stay in sane domains. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamps a value into the legal domain implied by its unit. */
export function clampForUnit(key: string, unit: VarUnit, value: number): number {
  if (key.startsWith('money')) return clamp(value, -2_000_000, 50_000_000);
  if (unit === 'percent' || unit === 'level') return clamp(value, 0, 100);
  if (unit === 'months') return clamp(value, 0, 1200);
  if (unit === 'count') return clamp(value, 0, 10_000);
  return value;
}

/**
 * Directionality: for most "level"/"percent" capacity vars more is better, but for risk
 * and burnout-flavoured vars more is worse.
 */
const LOWER_IS_BETTER = /risk|debt|burnout|stress|expense|exposure|cost/i;

export function isBetter(delta: number, def: VarDef): boolean {
  if (def.direction === 'neutral' || Math.abs(delta) < 1e-9) return false;
  const lowerBetter = def.direction === 'down' || LOWER_IS_BETTER.test(def.key);
  return lowerBetter ? delta < 0 : delta > 0;
}

/** Per-unit "meaningful change" threshold, used to suppress noise in readouts. */
export function noiseFloor(unit: VarUnit, key = ''): number {
  switch (unit) {
    case 'currency':
      return key.startsWith('income') || key.startsWith('expense') ? 25 : 100;
    case 'percent':
    case 'level':
      return 1;
    default:
      return 0.25;
  }
}

/** Reads a state value, defaulting to 0 — state keys are optionally present by design. */
export function getState(state: StateVector, key: string): number {
  return state[key] ?? 0;
}

/** Applies an ordered list of [key, value] pairs, preserving every other key. */
export function withValues(state: StateVector, patch: StateVector): StateVector {
  return { ...state, ...patch };
}
