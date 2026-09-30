/**
 * Treffer.ts (D2) — the server decides a melee hit from geometry and time.
 * Der Server entscheidet einen Nahkampftreffer aus Geometrie und Zeit.
 *
 * Pure functions, no server context and no import of `WovServer.ts`: the class keeps the
 * orchestration (stamina, loot, harvest) in `handleAttack`, this file holds the rules that can
 * be tested without a server:
 *
 *  - the hit sphere: centre (0; 1; 1) relative to the SERVER position and the tracked look
 *    direction of the attacker, radius 0.8 m, plus the target's body radius and a tolerance for
 *    a moving target (speed x 0.14 s, capped at 1.5 m);
 *  - the swing window: a swing counts 0.2 s after the weapon tip (`SCHLAG_FENSTER_S`); a stamp
 *    from the future or older than that is rejected;
 *  - the combo chain 1 -> 2 -> 3 (chain window 0.6 s after the end of the previous swing, like
 *    `KOMBO_FENSTER` in `AvatarRig`) and the cooldown per weapon;
 *  - the acknowledgement (`PacketType.AttackAck`) the server sends back for each swing.
 *
 * Wire extension of `PacketType.Attack` (appended after the weapon string, 16 bytes):
 *   Int32 seq, Int32 schritt (1..3, 0 = unknown), Float32 alterMs, Float32 spitzeMs.
 * An old client sends none of it: the server then derives the combo step itself, treats the
 * swing as fresh and sends NO acknowledgement (an old client never sees the new packet).
 */

import type { Vector3 } from '@wov/shared';

/** Kugelmitte relativ zur Serverposition: 1 m hoch, 1 m in Blickrichtung. */
export const KUGEL_HOEHE_M = 1;
export const KUGEL_VORN_M = 1;
export const KUGEL_RADIUS_M = 0.8;
/**
 * Koerperradius eines Ziels (m). Ein ZDO-Ursprung ist der Fusspunkt, ein Wesen hat Ausdehnung
 * (Ur rund 0,7 m); ohne diesen Zuschlag traefe die Kugel nur Ziele knapp 1 m vor dem Spieler.
 */
export const KOERPER_RADIUS_M = 0.6;
/** Toleranz fuer bewegte Ziele: Geschwindigkeit x 0,14 s, hoechstens 1,5 m. */
export const TOLERANZ_ZEIT_S = 0.14;
export const TOLERANZ_MAX_M = 1.5;
/** Fenster eines Schlags ab der Hiebspitze (s). */
export const SCHLAG_FENSTER_S = 0.2;
/** Hoechste Hiebspitze, die der Server einer Meldung glaubt (ms). */
export const SPITZE_MAX_MS = 600;
/** Kettenfenster: so lange nach dem ENDE des vorigen Schlags zaehlt der naechste zur Kombo (s). */
export const KETTE_FENSTER_S = 0.6;
export const KETTE_LAENGE = 3;
/** Zwei Attack-Pakete naeher als das zaehlen hoechstens einmal (ms). */
export const DOPPEL_MS = 50;
/** Clock jitter (ms) allowed when a claimed swing age reaches back into the previous swing's cooldown. */
export const UEBERLAPP_TOLERANZ_MS = 50;
/** Abklingzeit (ms) je Waffe; ohne Eintrag gilt die der langsamsten. */
export const ABKLINGZEIT_LANGSAMSTE_MS = 350;
export const ABKLINGZEIT_JE_WAFFE_MS: Readonly<Record<string, number>> = {};

/** Ausgang eines Schlags, wie ihn die Quittung nennt. */
export const SchlagErgebnis = {
  Treffer: 0,
  /** No creature struck (the swing then goes on to the harvest path). */
  Fehl: 1,
  Kombo: 2,
  Abklingzeit: 3,
  Zeit: 4,
  Ausdauer: 5,
} as const;
export type SchlagErgebnisWert = (typeof SchlagErgebnis)[keyof typeof SchlagErgebnis];

/** Wire fields an up-to-date client appends to `Attack`. */
export interface SchlagMeldung {
  seq: number;
  schritt: number;
  alterMs: number;
  spitzeMs: number;
}

/** Per-peer state of the chain and the cooldown. */
export interface SchlagZustand {
  /** Server time (ms) of the last ACCEPTED swing; 0 = none yet. */
  letzteZeit: number;
  /** Combo step (1..3) of that swing; 0 = none. */
  schritt: number;
  /** Cooldown (ms) that swing started. */
  abklingMs: number;
}

export function neuerSchlagZustand(): SchlagZustand {
  return { letzteZeit: 0, schritt: 0, abklingMs: 0 };
}

export function abklingzeitMs(waffe: string): number {
  return ABKLINGZEIT_JE_WAFFE_MS[waffe] ?? ABKLINGZEIT_LANGSAMSTE_MS;
}

/** Reads the appended fields; null for an old client (nothing appended) or a short tail. */
export function liesSchlagMeldung(rest: number, leser: { readInt32(): number; readFloat32(): number }): SchlagMeldung | null {
  if (rest < 16) return null;
  return { seq: leser.readInt32(), schritt: leser.readInt32(), alterMs: leser.readFloat32(), spitzeMs: leser.readFloat32() };
}

export type SchlagEntscheid =
  | { ok: true; schritt: number }
  | { ok: false; ergebnis: typeof SchlagErgebnis.Kombo | typeof SchlagErgebnis.Abklingzeit | typeof SchlagErgebnis.Zeit };

/**
 * May this swing count? Checks stamp, cooldown and chain, in that order. Changes nothing:
 * `verbucheSchlag` does that once the rest of the swing (stamina) went through.
 */
export function pruefeSchlag(z: SchlagZustand, m: SchlagMeldung | null, jetzt: number, waffe: string): SchlagEntscheid {
  if (m) {
    const spitze = Number.isFinite(m.spitzeMs) ? Math.min(Math.max(m.spitzeMs, 0), SPITZE_MAX_MS) : 0;
    // Negative age = a stamp from the future; too old = the window of this swing is over.
    if (!Number.isFinite(m.alterMs) || m.alterMs < 0 || m.alterMs > spitze + SCHLAG_FENSTER_S * 1000) {
      return { ok: false, ergebnis: SchlagErgebnis.Zeit };
    }
    // The age is the client's word. The server checks it against its own clock: a swing cannot have begun before the
    // previous accepted one was off cooldown. (An age of 0 claims nothing; it gains nothing either, because a hit is
    // always resolved against the server's state at arrival, never at the claimed time.)
    if (m.alterMs > 0 && z.letzteZeit > 0 && jetzt - m.alterMs < z.letzteZeit + z.abklingMs - UEBERLAPP_TOLERANZ_MS) {
      return { ok: false, ergebnis: SchlagErgebnis.Zeit };
    }
  }
  if (z.letzteZeit > 0 && jetzt - z.letzteZeit < Math.max(DOPPEL_MS, abklingzeitMs(waffe), z.abklingMs)) {
    return { ok: false, ergebnis: SchlagErgebnis.Abklingzeit };
  }
  const inKette = z.schritt >= 1 && jetzt - (z.letzteZeit + z.abklingMs) <= KETTE_FENSTER_S * 1000;
  const schritt = inKette ? (z.schritt % KETTE_LAENGE) + 1 : 1;
  // Only the finisher is refused when the client claims it without a valid second blow.
  if (m && m.schritt === KETTE_LAENGE && schritt < KETTE_LAENGE) return { ok: false, ergebnis: SchlagErgebnis.Kombo };
  return { ok: true, schritt };
}

export function verbucheSchlag(z: SchlagZustand, jetzt: number, schritt: number, waffe: string): void {
  z.letzteZeit = jetzt;
  z.schritt = schritt;
  z.abklingMs = abklingzeitMs(waffe);
}

/** Look direction as the client builds it: forward = (-sin yaw, -cos yaw). */
export function blickVorwaerts(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Tolerance (m) for a target moving at `tempo` m/s. */
export function zielToleranz(tempo: number): number {
  if (!Number.isFinite(tempo) || tempo <= 0) return 0;
  return Math.min(tempo * TOLERANZ_ZEIT_S, TOLERANZ_MAX_M);
}

/** Distance (m) from the hit sphere's centre to the target's chest point; NaN yaw = no sphere. */
export function abstandZurKugel(von: Vector3, yaw: number, ziel: Vector3): number {
  if (!Number.isFinite(yaw)) return Number.POSITIVE_INFINITY;
  const v = blickVorwaerts(yaw);
  const dx = ziel.x - (von.x + v.x * KUGEL_VORN_M);
  const dy = ziel.y + KUGEL_HOEHE_M - (von.y + KUGEL_HOEHE_M);
  const dz = ziel.z - (von.z + v.z * KUGEL_VORN_M);
  return Math.hypot(dx, dy, dz);
}

/** Below this horizontal distance (m) the target is inside the attacker: a hit whatever the look direction says. */
export const NAH_M = 0.8;

/**
 * Ranking distance of a hit, or null for a miss. The target is inside the sphere (body radius and
 * moving tolerance included), or so close to the attacker that a look direction means nothing
 * (an enemy stuck in the neck must be hittable; same rule as the cone's minimum distance).
 */
export function trefferAbstand(von: Vector3, yaw: number, ziel: Vector3, tempo = 0): number | null {
  const nah = Math.hypot(ziel.x - von.x, ziel.z - von.z);
  if (nah < NAH_M) return nah;
  const d = abstandZurKugel(von, yaw, ziel);
  return d <= KUGEL_RADIUS_M + KOERPER_RADIUS_M + zielToleranz(tempo) ? d : null;
}

export function trifftKugel(von: Vector3, yaw: number, ziel: Vector3, tempo = 0): boolean {
  return trefferAbstand(von, yaw, ziel, tempo) !== null;
}

/** Payload of `PacketType.AttackAck`: Int32 seq, Int32 schritt (server chain, 0 = refused), Int32 ergebnis. */
export function schreibeQuittung(
  w: { writeInt32(v: number): unknown },
  seq: number,
  schritt: number,
  ergebnis: SchlagErgebnisWert
): void {
  w.writeInt32(seq);
  w.writeInt32(schritt);
  w.writeInt32(ergebnis);
}
