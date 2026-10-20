/**
 * The rule model.
 *
 * A "rule" is a data description of something that can happen on a life path: the
 * conditions under which it becomes possible, how it changes the state vector, how likely it
 * is to be chosen relative to its peers, and the narrative metadata the UI shows.
 *
 * Rules are pure data evaluated by pure functions, which is what makes the simulation
 * deterministic, inspectable and testable. There is no scenario-specific branching in code.
 */
import type { EvidenceTag, NodeType, TradeOff } from './types';
import { clampForUnit, getState } from './vars';
import type { VarDef } from './types';
import type { Rng } from './rng';

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface Condition {
  key: string;
  op: CompareOp;
  value: number;
}

export interface RuleWhen {
  /** Every condition must hold. */
  all?: Condition[];
  /** At least one condition must hold. */
  any?: Condition[];
  none?: Condition[];
}

export type EffectOp = 'add' | 'set' | 'mul' | 'addFrom';

export interface Effect {
  key: string;
  op: EffectOp;
  /** Constant operand for add/set/mul. */
  value?: number;
  /** Source key for addFrom, or the base for mul-with-source. */
  from?: string;
  /** Multiplier applied to `from`. */
  scale?: number;
  /**
   * Relative standard deviation of the change, sampled from the seeded RNG.
   * 0 (default) means fully deterministic. Never presented as a probability of a real outcome.
   */
  noise?: number;
  /** Human-readable cause, rendered in the node's state-change list. */
  reason: string;
  /** Optional per-key clamp applied with the variable's unit domain. */
  clampMin?: number;
  clampMax?: number;
}

export interface RuleDecision {
  question: string;
  options: { id: string; label: string; note?: string }[];
  /** The attribute a chosen option is scored against by the engine. */
  scoresOn?: string;
}

export interface Rule {
  id: string;
  /** Node title. */
  label: string;
  /** Short template using {situation}/{goal} style placeholders resolved by the engine. */
  summary: string;
  detail?: string;
  type: NodeType;
  when: RuleWhen;
  /** Relative selection weight among eligible rules. */
  weight: number;
  /** Earliest / latest month offset at which this rule may fire. */
  monthsMin: number;
  monthsMax: number;
  /** Months this event occupies before the next step. */
  durationMonths: number;
  /** Do not re-fire within this many months of the last firing. */
  cooldown?: number;
  /** Fire at most once per path. */
  once?: boolean;
  effects: Effect[];
  assumptions?: string[];
  uncertainties?: string[];
  evidence: EvidenceTag[];
  tradeoffs?: TradeOff;
  nextSteps?: string[];
  failurePoints?: string[];
  resources?: string[];
  decision?: RuleDecision;
  /**
   * 0 = mundane and grounded, 1 = highly imaginative. The realism slider filters the pool,
   * so "grounded analysis" and "creative exploration" genuinely produce different universes
   * rather than re-labelling the same output.
   */
  imagination?: number;
  /** Archetype ids that must be active for this rule to be considered. */
  requires?: string[];
}

/** A named collection of rules plus the variables it introduces. */
export interface RulePack {
  id: string;
  name: string;
  description: string;
  vars: VarDef[];
  rules: Rule[];
  /** Seeded adjustments to the initial state for this archetype. */
  startingModifiers?: Effect[];
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return Math.abs(a - b) < 1e-9;
    case '!=':
      return Math.abs(a - b) >= 1e-9;
  }
}

export function matchesConditions(state: Record<string, number>, when: RuleWhen): boolean {
  if (when.all?.length) {
    for (const c of when.all) if (!compare(getState(state, c.key), c.op, c.value)) return false;
  }
  if (when.any?.length) {
    let hit = false;
    for (const c of when.any) {
      if (compare(getState(state, c.key), c.op, c.value)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  if (when.none?.length) {
    for (const c of when.none) if (compare(getState(state, c.key), c.op, c.value)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Effect application
// ---------------------------------------------------------------------------

export interface AppliedEffect {
  key: string;
  before: number;
  after: number;
  reason: string;
}

export interface ApplyResult {
  state: Record<string, number>;
  applied: AppliedEffect[];
}

/**
 * Applies a rule's effects to a state vector without mutating the input.
 *
 * Effects are applied in order, and each one reads the *current* (already-updated) state, so
 * a later effect can depend on an earlier one — for example "income falls, therefore savings
 * growth slows". This ordering is part of the model's contract and is covered by tests.
 */
export function applyEffects(
  state: Record<string, number>,
  effects: readonly Effect[],
  vars: readonly VarDef[],
  rng: Rng,
): ApplyResult {
  const next: Record<string, number> = { ...state };
  const applied: AppliedEffect[] = [];
  const byKey = new Map(vars.map((v) => [v.key, v]));

  for (const eff of effects) {
    const unit = byKey.get(eff.key)?.unit ?? 'index';
    const before = getState(next, eff.key);
    let value: number;

    switch (eff.op) {
      case 'set':
        value = eff.value ?? 0;
        break;
      case 'mul':
        value = before * (eff.value ?? 1);
        break;
      case 'addFrom':
        value = before + getState(next, eff.from ?? eff.key) * (eff.scale ?? 1);
        break;
      case 'add':
      default:
        value = before + (eff.value ?? 0);
        break;
    }

    if (eff.noise && eff.noise !== 0) {
      // Scale the perturbation with the magnitude of the change, with a floor so that a
      // near-zero change still has a small amount of variation.
      const magnitude = Math.max(Math.abs(value - before), Math.abs(eff.value ?? 0) * 0.25);
      value += rng.normal() * magnitude * eff.noise;
    }

    const min = eff.clampMin ?? -Infinity;
    const max = eff.clampMax ?? Infinity;
    value = Math.min(Math.max(value, min), max);
    value = clampForUnit(eff.key, unit, value);

    next[eff.key] = value;
    applied.push({ key: eff.key, before, after: value, reason: eff.reason });
  }

  return { state: next, applied };
}

/** Merges the variables of several packs, later packs overriding earlier ones by key. */
export function mergeVars(packs: readonly RulePack[]): VarDef[] {
  const out: VarDef[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const v of pack.vars) {
      if (seen.has(v.key)) continue;
      seen.add(v.key);
      out.push(v);
    }
  }
  return out;
}
