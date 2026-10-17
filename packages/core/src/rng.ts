/**
 * Deterministic pseudo-random number generation.
 *
 * Every synthetic signal in ventloom - tremor traces, geodetic noise, tephra
 * chemistry - is a pure function of an integer seed. Run the same seed twice
 * and the observatory is bit-identical, which is what makes the demos, the
 * test suite and CI agree.
 */

/** A stream of deterministic pseudo-random doubles in [0, 1). */
export interface Rng {
  /** Next uniform double in [0, 1). */
  next(): number;
  /** Uniform double in [min, max). */
  uniform(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Standard normal deviate via Box–Muller (cached pair). */
  normal(): number;
  /** Normal deviate with the given mean and standard deviation. */
  gaussian(mean: number, stdDev: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Picks one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * mulberry32 - a fast, well-distributed 32-bit PRNG.
 *
 * Chosen over a full `sfmt`/`xoshiro` implementation because it is small,
 * passes the PractRand suites comfortably at the sizes ventloom needs
 * (10^4–10^6 draws per trace), and has no 53-bit float edge cases.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  };

  return {
    next,
    uniform: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    normal,
    gaussian: (mean, stdDev) => mean + normal() * stdDev,
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) {
        throw new RangeError("pick() called with an empty list");
      }
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as (typeof out)[number];
        const b = out[j] as (typeof out)[number];
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}

/**
 * Hashes an arbitrary string into a 32-bit seed (FNV-1a).
 *
 * Lets any named entity - a station id, a volcano slug - own a stable,
 * independent random stream without a lookup table.
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The seed this repository's world was generated from. */
export const WORLD_SEED = 7331;
