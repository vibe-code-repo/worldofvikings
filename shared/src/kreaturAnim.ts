/**
 * Animation of a creature, the parts client and server must agree on.
 *
 * Two channels, both plain ZDO members (no packet type):
 *
 *  - `anim` (ANIM_MEMBER): the STATE the creature is in — `idle`, `walk`, `run`
 *    and, for the fighters, `attack`. It is written on change only.
 *  - `animEinmal` (ANIM_EINMAL_MEMBER): a one-shot EVENT — `attack`, `hit`,
 *    `die` — written as `<clip>#<n>`. The counter `n` goes up on every event,
 *    so a second blow of the same kind is a change the client can see even
 *    though the clip name did not change.
 *
 * The client plays an event exactly once and falls back to the state.
 */

import type { KreaturAnim } from './constants.js';

/** Clips that play once and are triggered by an event (never looped). */
export type EinmalClip = 'attack' | 'hit' | 'die';

/** Everything a spawn entry may list in `clips`: the states plus the one-shots. */
export type KreaturClip = KreaturAnim | EinmalClip;

/** Every clip name a spawn entry may list. */
export const KREATUR_CLIPS: readonly KreaturClip[] = ['idle', 'walk', 'run', 'attack', 'hit', 'die'];

const EINMAL_CLIPS: readonly string[] = ['attack', 'hit', 'die'];

/** `<clip>#<n>` — the wire form of the one-shot member. */
export function formatEinmal(clip: EinmalClip, n: number): string {
  return `${clip}#${n}`;
}

/** Parse the one-shot member; anything malformed is `null` (never a guess). */
export function parseEinmal(wert: string | undefined): { clip: EinmalClip; n: number } | null {
  if (!wert) return null;
  const i = wert.lastIndexOf('#');
  if (i <= 0) return null;
  const clip = wert.slice(0, i);
  const n = Number(wert.slice(i + 1));
  if (!EINMAL_CLIPS.includes(clip) || !Number.isInteger(n) || n < 0) return null;
  return { clip: clip as EinmalClip, n };
}

/** The member value that follows `aktuell` for a new event of `clip`. */
export function naechstesEinmal(aktuell: string | undefined, clip: EinmalClip): string {
  const alt = parseEinmal(aktuell);
  return formatEinmal(clip, (alt?.n ?? 0) + 1);
}

/**
 * Check the clip list of one entry. A wrongly configured creature must fail
 * loudly at the place where the table is built, not stand still in the game.
 *
 *  - an empty list is not "has clips" and not "no clips": it is a mistake;
 *  - `idle` is mandatory — every fall-back chain ends there, and a creature
 *    that stops has to show something;
 *  - only known clip names, no duplicates;
 *  - `die` needs a duration (`dieSec`): the server keeps the body that long.
 */
export function pruefeClips(
  prefab: string,
  clips: readonly string[] | undefined,
  dieSec?: number
): void {
  if (clips === undefined) return;
  const wo = `[spawns] '${prefab}'`;
  if (clips.length === 0) {
    throw new Error(`${wo}: clips is empty — omit the field for a model without clips, or list them`);
  }
  for (const c of clips) {
    if (!(KREATUR_CLIPS as readonly string[]).includes(c)) {
      throw new Error(`${wo}: unknown clip '${c}' (allowed: ${KREATUR_CLIPS.join(', ')})`);
    }
  }
  if (new Set(clips).size !== clips.length) {
    throw new Error(`${wo}: clips lists a name twice (${clips.join(', ')})`);
  }
  if (!clips.includes('idle')) {
    throw new Error(`${wo}: clips must list 'idle' (${clips.join(', ')}) — without it a standing creature has no pose`);
  }
  if (clips.includes('die') && !(typeof dieSec === 'number' && Number.isFinite(dieSec) && dieSec > 0)) {
    throw new Error(`${wo}: clips lists 'die' but dieSec is missing — the server cannot know how long to keep the body`);
  }
}

/** Result of the group search: an index, or why there is none. */
export type GruppenWahl =
  | { readonly art: 'exakt' | 'teil'; readonly index: number }
  | { readonly art: 'fehlt' }
  | { readonly art: 'mehrdeutig'; readonly treffer: readonly string[] };

/**
 * Which animation group plays for a wanted state.
 *
 * Exact name (case-insensitive) first; else the name must CONTAIN the state
 * and exactly one group may do so. Two hits (`run` in `Run_02` and `Running`)
 * are a mistake in the model, not a coin toss: the result is `mehrdeutig`
 * and the caller reports it instead of playing whichever came first.
 */
export function waehleGruppe(namen: readonly string[], wunsch: string): GruppenWahl {
  const w = wunsch.toLowerCase();
  const exakt = namen.findIndex((n) => n.toLowerCase() === w);
  if (exakt >= 0) return { art: 'exakt', index: exakt };
  const teil: number[] = [];
  namen.forEach((n, i) => {
    if (n.toLowerCase().includes(w)) teil.push(i);
  });
  if (teil.length === 1) return { art: 'teil', index: teil[0]! };
  if (teil.length === 0) return { art: 'fehlt' };
  return { art: 'mehrdeutig', treffer: teil.map((i) => namen[i]!) };
}
