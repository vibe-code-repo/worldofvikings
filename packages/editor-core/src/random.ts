/**
 * The editor's only source of randomness.
 *
 * Agent rule 17 allows a tool to randomise *as a convenience* on the condition
 * that the result is persisted — and rule 16 forbids generating the world at
 * run time. Both are only true if the randomness is a value someone can write
 * down: a scatter run has to produce the same world file on the reviewer's
 * machine as on the author's, and a test has to be able to state what it
 * expects. `Math.random` can do neither, so it is not used anywhere in this
 * package; a seed is.
 *
 * The generator is mulberry32 — thirty-two bits of state, four operations per
 * draw. It is chosen for being short enough to read and verify here rather than
 * for statistical strength: what is being decided is where a tuft of grass
 * stands, not a cryptographic key.
 */

/** Two to the power of 32, the modulus the state counts in. */
const STATE_MODULUS = 0x1_0000_0000;

/** The odd increment mulberry32 adds per draw. */
const STEP = 0x6d2b79f5;

/** A seeded stream of numbers. Every draw advances it. */
export interface Random {
  /** The next value in `[0, 1)`. */
  next(): number;
  /** The next value in `[low, high)`, or exactly `low` when the range is empty. */
  between(low: number, high: number): number;
  /**
   * The index of one entry, chosen with a probability proportional to its
   * weight. Weights must be finite and positive; an empty list gives `0`.
   */
  weighted(weights: readonly number[]): number;
}

/**
 * A generator for one seed.
 *
 * The seed is reduced into the 32-bit state rather than rejected when it is
 * large or negative, so a seed a person typed is always usable.
 */
export function createRandom(seed: number): Random {
  let state = Number.isFinite(seed) ? Math.trunc(seed) % STATE_MODULUS : 0;
  if (state < 0) {
    state += STATE_MODULUS;
  }

  const next = (): number => {
    state = (state + STEP) % STATE_MODULUS;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / STATE_MODULUS;
  };

  return {
    next,
    between(low, high) {
      return high <= low ? low : low + next() * (high - low);
    },
    weighted(weights) {
      const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
      if (weights.length === 0 || total <= 0) {
        return 0;
      }
      let remaining = next() * total;
      for (let index = 0; index < weights.length; index += 1) {
        remaining -= Math.max(0, weights[index] ?? 0);
        if (remaining < 0) {
          return index;
        }
      }
      // Only reachable through floating point rounding at the very top of the
      // range; the last entry is the one that range belongs to.
      return weights.length - 1;
    },
  };
}
