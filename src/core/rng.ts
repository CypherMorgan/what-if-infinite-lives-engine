/**
 * Deterministic pseudo-random number generation.
 *
 * Every stochastic decision in the engine routes through here so that a simulation is
 * exactly reproducible from its recorded seed. This is what makes the simulation testable
 * and lets a user re-open or re-run a universe and get the same result.
 */

/** A small, fast, well-distributed 32-bit generator (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalise any float/int seed into a 32-bit unsigned integer.
    this.state = (Math.floor(Math.abs(seed)) >>> 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Approximately normal via the sum of 12 uniforms (Irwin–Hall), mean 0, sd 1.
   * Bounded to ±6 sigma, which is a feature here: unbounded Gaussian tails would let a
   * single draw produce absurd outcomes in a life-path model.
   */
  normal(): number {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += this.next();
    return sum - 6;
  }

  /** Picks an index from `weights`, proportional to weight. Returns -1 for an empty input. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return weights.length > 0 ? 0 : -1;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i += 1) {
      const w = weights[i] ?? 0;
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /** Deterministically shuffles a copy of `items` (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      const a = out[i] as T;
      const b = out[j] as T;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  /** Current internal state, so a run can be checkpointed and resumed. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Stable 32-bit hash of a string — turns "the user's seed phrase" into a numeric seed. */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** Creates a fresh random seed value for a new universe. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * Percentile of a numeric sample using linear interpolation between closest ranks.
 * Used by the Monte Carlo spread readout.
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0] as number;
  const idx = (sortedAsc.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sortedAsc[lo] as number;
  const b = sortedAsc[hi] as number;
  return a + (b - a) * (idx - lo);
}
