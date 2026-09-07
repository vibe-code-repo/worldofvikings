/**
 * Picking the next clip out of a bank, and the small deterministic random the
 * picking needs.
 *
 * Ten gravel footsteps chosen with `Math.random()` play the same clip twice in
 * a row about one step in ten, and a doubled footstep is the one thing a player
 * *does* notice about footsteps. A shuffle bag deals the bank out in a random
 * order, refills when it is empty, and never starts a new deal with the clip
 * the last one ended on — so every clip is heard as often as every other, and
 * none is heard twice running.
 *
 * The random is passed in and defaults to a seeded one rather than to
 * `Math.random`, because a test that asserts "not the same clip twice" against
 * an unseeded generator is a test that fails once a fortnight on somebody
 * else's machine (agent rule 14, agent rule 17 — this randomness decides only
 * *which of the author's clips* is heard, never what is in the world file).
 */

/** A source of numbers in `[0, 1)`. */
export type RandomSource = () => number;

/**
 * A small, fast, seeded generator (mulberry32).
 *
 * Written out here rather than pulled from `@wov/editor-core`, which has one:
 * the renderer must not depend on editor-only code (`pnpm lint:boundaries`),
 * and this is eight lines.
 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deals a bank out, one clip at a time. */
export interface ClipBag {
  /** The next clip; never the one just returned, unless the bank has one. */
  next(): string;
  /** How many clips are left before the bag refills. */
  readonly remaining: number;
}

/**
 * A shuffle bag over a bank of clips.
 *
 * @throws {Error} when the bank is empty — a bank with no clips is a world-file
 * mistake, and returning `''` would turn it into a silent one.
 */
export function createClipBag(
  clips: readonly string[],
  random: RandomSource = seededRandom(0x5eed),
): ClipBag {
  if (clips.length === 0) {
    throw new Error('sound: a footstep bank needs at least one clip');
  }
  let bag: string[] = [];
  let last: string | null = null;

  const refill = (): void => {
    bag = [...clips];
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [bag[index], bag[swap]] = [bag[swap] as string, bag[index] as string];
    }
    // A fresh deal that starts on the clip the last one ended with would be the
    // one repeat the bag exists to prevent. With two or more clips there is
    // always somewhere else for it to go.
    if (bag.length > 1 && bag[bag.length - 1] === last) {
      [bag[bag.length - 1], bag[0]] = [bag[0] as string, bag[bag.length - 1] as string];
    }
  };

  return {
    next() {
      if (bag.length === 0) {
        refill();
      }
      const clip = bag.pop() as string;
      last = clip;
      return clip;
    },
    get remaining() {
      return bag.length;
    },
  };
}

/**
 * A playback rate jittered by `±jitter` around 1.
 *
 * Pitch and speed together, because that is what changing a buffer's rate does
 * and what a real footstep does: a harder step is shorter *and* brighter. Six
 * percent is enough to stop ten clips sounding like ten clips and small enough
 * that nobody hears a pitch bend.
 */
export function jitteredRate(jitter: number, random: RandomSource): number {
  const amount = Math.min(Math.max(jitter, 0), 1);
  return 1 + (random() * 2 - 1) * amount;
}

/** A random number of seconds in `[min, max]`, for a one-shot's next start. */
export function intervalIn(range: readonly [number, number], random: RandomSource): number {
  const [low, high] = range;
  return low + random() * Math.max(high - low, 0);
}
