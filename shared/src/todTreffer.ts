/**
 * Death and hit reaction of a player figure — the parts client and server must agree on.
 *
 * The SERVER decides who dies and who is hit, and from which side (it knows the
 * attacker's position and the victim's view yaw). The clients only play the clip
 * the server names:
 *
 *  - the victim gets two small packets (`PlayerTod`, `PlayerTreffer`, an index each);
 *  - every other player sees the same event on the victim's character ZDO
 *    (`animEinmal` = `<clip>#<n>`, plus `anim` = the death clip while the body lies).
 *
 * Clip names are the animation groups of the shipped body models
 * (WikingerKoerper.glb / WikingerinKoerper.glb, 48 clips).
 */

/** How long a dead player lies before the server revives him (ms). One knob for the whole game. */
export const TOD_LIEGEZEIT_MS = 5000;

/**
 * Shortest gap between two hit reactions on one figure (s). The clip is 1.33 s long;
 * a wolf bites every 2 s, a pack of three every ~0.7 s. Restarting the layer at every
 * bite would freeze the upper body at the first frames of the reaction (the flinch would
 * never be seen to play out), so a new hit inside this window only adds blood and sound.
 * 0.65 s = about half the clip: the flinch has visibly peaked (its widest deflection
 * lies at 0.46–0.58 s) before the next one may cut in.
 */
export const TREFFER_MINDESTABSTAND_S = 0.65;

/** Death clips. `tod_vorn` = the body falls forward, `tod_hinten` = it falls backward. */
export const TOD_CLIPS = ['tod_vorn', 'tod_hinten'] as const;
export type TodClip = (typeof TOD_CLIPS)[number];

/** Hit reactions (upper-body layer), named after the side the blow comes FROM. */
export const TREFFER_CLIPS = [
  'treffer_vorn_links',
  'treffer_vorn_rechts',
  'treffer_hinten_links',
  'treffer_hinten_rechts',
] as const;
export type TrefferClip = (typeof TREFFER_CLIPS)[number];

/** Side of the attacker relative to the victim's view: in front or behind, on the left or the right. */
export interface Richtung {
  vorn: boolean;
  links: boolean;
}

/**
 * Where the attacker stands relative to the victim's view.
 *
 * `blickYaw` uses the server's convention (WovServer.fuehreBlickNach): the view
 * points along (−sin yaw, −cos yaw), the right hand side along (−cos yaw, sin yaw)
 * in the ground plane. `null` when the direction is unknown — no view yet, or the
 * attacker stands exactly on the victim.
 */
export function richtungZuAngreifer(
  blickYaw: number | null,
  opfer: { x: number; z: number },
  angreifer: { x: number; z: number }
): Richtung | null {
  if (blickYaw === null || !Number.isFinite(blickYaw)) return null;
  const dx = angreifer.x - opfer.x;
  const dz = angreifer.z - opfer.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || dx * dx + dz * dz < 1e-12) return null;
  const fx = -Math.sin(blickYaw);
  const fz = -Math.cos(blickYaw);
  const vor = dx * fx + dz * fz;
  // right = (fz, -fx)
  const rechts = dx * fz - dz * fx;
  // Dead ahead / dead behind has no side: it counts as the right one (deterministic).
  return { vorn: vor >= 0, links: rechts < -1e-9 };
}

/** Reaction clip for a blow from `r`; an unknown direction shows the front-left flinch. */
export function trefferClipFuer(r: Richtung | null): TrefferClip {
  const vorn = r?.vorn ?? true;
  const links = r?.links ?? true;
  return vorn
    ? links ? 'treffer_vorn_links' : 'treffer_vorn_rechts'
    : links ? 'treffer_hinten_links' : 'treffer_hinten_rechts';
}

/**
 * Death clip for a killing blow from `r`: struck from the front, the figure is thrown
 * backwards (`tod_hinten`); struck from behind it falls forward (`tod_vorn`).
 * Without a direction: `tod_vorn`.
 */
export function todClipFuer(r: Richtung | null): TodClip {
  return r !== null && r.vorn ? 'tod_hinten' : 'tod_vorn';
}

/** Wire index of a death clip (PlayerTod) and back; unknown indices are `null`, never a guess. */
export function todClipIndex(clip: TodClip): number {
  return TOD_CLIPS.indexOf(clip);
}
export function todClipVonIndex(i: number): TodClip | null {
  return Number.isInteger(i) ? (TOD_CLIPS[i] ?? null) : null;
}
export function trefferClipIndex(clip: TrefferClip): number {
  return TREFFER_CLIPS.indexOf(clip);
}
export function trefferClipVonIndex(i: number): TrefferClip | null {
  return Number.isInteger(i) ? (TREFFER_CLIPS[i] ?? null) : null;
}

/** Is this the name of a death or hit clip? (the one-shot names the ZDO member may carry for a player) */
export function istTodOderTrefferClip(name: string): boolean {
  return (TOD_CLIPS as readonly string[]).includes(name) || (TREFFER_CLIPS as readonly string[]).includes(name);
}

/**
 * A server message that is a catalogue key, not a text: the server writes `@` + key into the
 * message field of `InteractResult`, the client translates it (`GameI18n.serverMeldung`).
 */
export const SERVER_MELDUNG_SCHLUESSEL_PRAEFIX = '@';

/** The bed the player had set is gone: he wakes at the world spawn (catalogue key `tod.bett_verloren`). */
export const SERVER_MELDUNG_BETT_VERLOREN = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}tod.bett_verloren`;
