/**
 * rolle.ts (D3-K4) — the one rule of the dodge roll and of the jump cost, the same numbers for every caller.
 * Die eine Regel der Ausweichrolle und der Sprungkosten.
 *
 * Pure module: no clock, no state, no server context (the time comes in as an argument, `jetzt` in ms).
 * The server (`server/src/spiel/Rolle.ts`) keeps the per-player state and the packets; the client
 * (`PlayerController`, `RolleSteuerung`) predicts the same path with the same numbers.
 *
 *  - The roll covers `ROLLE_WEG_M` (the root travel of the clip `rolle`) in the direction the client names
 *    (`PacketType.Rolle`, yaw of the direction), along the CURVE of the clip: the root of the clip moves unevenly
 *    (85 % of the path in the first 0.375 s), `ROLLE_KURVE_ANTEIL` is the share of the path over the time, measured
 *    on the 21 hip keys of the clip, and server and client both move after it. The server drives the path itself;
 *    WASD is ignored while it runs.
 *  - The player is invulnerable for the whole clip (`ROLLE_DAUER_MS`) and cannot swing or block.
 *  - A roll costs `ROLLE_AUSDAUER` and needs the lock `ROLLE_ABKLINGZEIT_MS` after the one before.
 *  - Free room: the server simulates the path first with the shared movement step. A roll that would cover less
 *    than `ROLLE_MIN_ANTEIL` of the full path (rock, wall, steep slope) is refused and costs nothing.
 *  - A jump costs `SPRUNG_AUSDAUER` and locks the next billed jump for `SPRUNG_SPERRE_MS`.
 *
 * Angles use the convention of the block: the view points along (-sin yaw, -cos yaw).
 */
import { ROLLE_BEWEGUNG_S, ROLLE_TEMPO, ROLLE_WEG_M } from '../bewegung/masse.js';

export { ROLLE_BEWEGUNG_S, ROLLE_TEMPO, ROLLE_WEG_M };

/** Length of the clip `rolle` (ms): invulnerable, no swing, no block for this long. */
export const ROLLE_DAUER_MS = 875;
/**
 * The unit of the movement slices: the time (ms) the roll would take at the constant speed `ROLLE_TEMPO`. The
 * movement of a slice is `ROLLE_TEMPO` times its share of this time; the whole roll adds up to exactly this time,
 * whatever the rhythm of the packets or frames. (The clip runs `ROLLE_DAUER_MS`; its movement follows the curve.)
 */
export const ROLLE_BEWEGUNG_MS = ROLLE_BEWEGUNG_S * 1000;

/** Spacing of the keys of the clip `rolle` (s): 24 keys per second. */
export const ROLLE_KURVE_SCHRITT_S = 1 / 24;
/**
 * Share of `ROLLE_WEG_M` the root of the clip `rolle` has covered at the key k (time (k + 1) / 24 s, k = 0 ... 20; the
 * first key at 1/24 s is the start: before it the first pose is held). Hips, axis z of `WikingerKoerper.glb` (56 clips),
 * (z - z first key) / (z last key - z first key); the last key is `ROLLE_DAUER_MS`. Linear between the keys, like the clip.
 */
export const ROLLE_KURVE_ANTEIL: readonly number[] = [
  0.0, 0.18446, 0.320273, 0.390064, 0.451482, 0.530276, 0.638524, 0.754728, 0.847868, 0.881123, 0.886982,
  0.908614, 0.920243, 0.942273, 0.962263, 0.976639, 0.987873, 0.992778, 0.995664, 0.99918, 1.0,
];

/** Share (0 ... 1) of the path covered `t` seconds after the start of the roll: the curve of the clip. */
export function rolleWegAnteil(t: number): number {
  const n = ROLLE_KURVE_ANTEIL.length;
  const k = t / ROLLE_KURVE_SCHRITT_S - 1; // position in the table: 0 = first key
  if (!(k > 0)) return 0;
  if (k >= n - 1) return 1;
  const i = Math.floor(k);
  const f = k - i;
  return ROLLE_KURVE_ANTEIL[i]! + (ROLLE_KURVE_ANTEIL[i + 1]! - ROLLE_KURVE_ANTEIL[i]!) * f;
}
/** Stamina of one roll. */
export const ROLLE_AUSDAUER = 10;
/** Gap after a roll before the next one may begin (ms). */
export const ROLLE_ABKLINGZEIT_MS = 500;
/**
 * The server takes a new roll this long BEFORE its own lock ends (ms). The client counts the gap from its own
 * clock, the server from the arrival of the first packet: with network jitter a legitimate second roll can arrive
 * earlier than the first one's lock. The client lock stays 0.5 s; invulnerable share of a chain of rolls at the
 * server: 875 / (875 + 400) ms.
 */
export const ROLLE_SPERRE_TOLERANZ_MS = 100;
/**
 * Share of the full path the free-room check demands. 0.8 lets a roll slide along a wall at up to ~37 degrees to
 * it (cos 37 = 0.8) and still counts a roll into a wall, a rock or a slope above the limit as blocked. Lower
 * would let the clip run its 4.85 m while the figure stops after half of it; higher would refuse rolls that
 * graze a bush.
 */
export const ROLLE_MIN_ANTEIL = 0.8;
export const ROLLE_MIN_WEG_M = ROLLE_WEG_M * ROLLE_MIN_ANTEIL;

/** Stamina of one jump. */
export const SPRUNG_AUSDAUER = 5;
/** Lock after a billed jump (ms): a series of jump flags in a second pays for the first only. */
export const SPRUNG_SPERRE_MS = 800;

/** Server messages (catalogue keys, `@key`, de/en). */
export const SERVER_MELDUNG_ROLLE_ZU_ERSCHOEPFT = '@kampf.zu_erschoepft';
export const SERVER_MELDUNG_ROLLE_BLOCKIERT = '@kampf.rolle_blockiert';
export const SERVER_MELDUNG_AUSGEWICHEN = '@kampf.ausgewichen';

/** Why a roll is refused. */
export type RolleAblehnung = 'tot' | 'flug' | 'wasser' | 'laeuft' | 'abklingzeit' | 'ausdauer' | 'richtung';

/** The state a roll request meets. */
export interface RolleStand {
  readonly tot: boolean;
  readonly flug: boolean;
  readonly imWasser: boolean;
  /** End of the roll running now (ms), 0 = none. */
  readonly rolleBis: number;
  /** The next roll may begin at this time (ms). */
  readonly rolleSperreBis: number;
  readonly ausdauer: number;
  /** The yaw of the requested direction. */
  readonly yaw: number;
}

/** The first reason that forbids a roll `jetzt`, or null when it is allowed (free room is checked separately). */
export function rolleAblehnung(stand: RolleStand, jetzt: number): RolleAblehnung | null {
  if (stand.tot) return 'tot';
  if (stand.flug) return 'flug';
  if (!Number.isFinite(stand.yaw)) return 'richtung';
  if (rolleLaeuft(stand.rolleBis, jetzt)) return 'laeuft';
  if (jetzt < stand.rolleSperreBis - ROLLE_SPERRE_TOLERANZ_MS) return 'abklingzeit';
  if (stand.imWasser) return 'wasser';
  if (!(stand.ausdauer >= ROLLE_AUSDAUER)) return 'ausdauer';
  return null;
}

/** Is a roll running `jetzt`? `rolleBis` is exclusive; 0 = none. */
export function rolleLaeuft(rolleBis: number, jetzt: number): boolean {
  return rolleBis > 0 && jetzt < rolleBis;
}

/**
 * Is the player invulnerable `jetzt`? From the start of the roll to its end; a clock that jumped back before the
 * start is no roll.
 */
export function rolleUnverwundbar(rolleStart: number, rolleBis: number, jetzt: number): boolean {
  return rolleBis > 0 && jetzt >= rolleStart && jetzt < rolleBis;
}

/** Direction of the roll (unit vector on the ground) from its yaw. */
export function rolleRichtung(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** The yaw that names the direction (x, z). */
export function rolleYawVon(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Does the simulated path leave enough room? `weg` = metres the figure covered. */
export function rolleFreiraumOk(weg: number): boolean {
  return Number.isFinite(weg) && weg >= ROLLE_MIN_WEG_M;
}

/**
 * The slice of movement of one tick: from `zuletzt` (ms, the end of the last slice) to `jetzt`, clipped to the clip of
 * the roll that began at `start`. Returns the new end of slice and the seconds to move at the speed `ROLLE_TEMPO`
 * (`dt` = the share of the path of the curve in this slice times `ROLLE_BEWEGUNG_S`). All slices add up to
 * `ROLLE_BEWEGUNG_S`, whatever the rhythm.
 */
export function rolleScheibe(start: number, zuletzt: number, jetzt: number): { bis: number; dt: number } {
  const ende = start + ROLLE_DAUER_MS;
  const bis = Math.max(zuletzt, Math.min(jetzt, ende));
  const dt = Math.max(0, rolleWegAnteil((bis - start) / 1000) - rolleWegAnteil((zuletzt - start) / 1000)) * ROLLE_BEWEGUNG_S;
  return { bis, dt };
}

/** One billed jump or none: the stamina and the lock after a jump flag `jetzt`. */
export function sprungAbrechnen(
  ausdauer: number,
  sperreBis: number,
  jetzt: number
): { bezahlt: boolean; ausdauer: number; sperreBis: number } {
  if (jetzt < sperreBis || !(ausdauer >= SPRUNG_AUSDAUER)) return { bezahlt: false, ausdauer, sperreBis };
  return { bezahlt: true, ausdauer: ausdauer - SPRUNG_AUSDAUER, sperreBis: jetzt + SPRUNG_SPERRE_MS };
}
