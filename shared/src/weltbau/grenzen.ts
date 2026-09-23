/**
 * grenzen.ts — die Schwellen der Weltprüfung an EINER Stelle.
 *
 * Die Werte für Hang, Höhenspanne und Zonenbudget sind ANNAHMEN: im Repo
 * gibt es keine Bauplatz-Grenze (nur die Bewegungsgrenzen in
 * `bewegung/masse.ts`). Mike bestätigt oder ändert sie; `world_check` nimmt
 * sie als Vorgaben und lässt jeden Wert per Eingabe überschreiben.
 *
 * Thresholds of the world check in one place. The slope, elevation-span and
 * zone-budget values are assumptions pending the owner's confirmation.
 */

/** Neigung (Grad), ab der ein Objekt gelb bzw. rot gemeldet wird. ANNAHME. */
export const HANG_GRAD_GELB = 30;
export const HANG_GRAD_ROT = 45;

/** Höhenspanne unter der Grundfläche eines Gebäudes (m), gelb bzw. rot. ANNAHME. */
export const GEBAEUDE_SPANNE_GELB = 0.4;
export const GEBAEUDE_SPANNE_ROT = 1.5;

/** Platzierungen je 64-m-Zone, gelb bzw. rot. ANNAHME (die DEV-Welt hat höchstens 20). */
export const ZONE_OBJEKTE_GELB = 40;
export const ZONE_OBJEKTE_ROT = 80;

/** Überlappung als Anteil der kleineren Grundfläche: ab hier gelb bzw. rot. */
export const UEBERLAPPUNG_GELB = 0.05;
export const UEBERLAPPUNG_ROT = 0.25;

/** Größte Kantenlänge eines Prüf-/Beschreibungsbereichs (m). */
export const BEREICH_MAX_KANTE = 512;

/** Größter Radius von `area_describe` (m) und Vorgabe. */
export const BESCHREIBEN_RADIUS_MAX = 256;
export const BESCHREIBEN_RADIUS_VORGABE = 32;

/** Höchstens so viele Befunde bzw. Objekte werden ausgegeben, der Rest wird nur gezählt. */
export const BEFUNDE_MAX = 200;
export const DIFF_EINTRAEGE_MAX = 500;
export const NAECHSTE_OBJEKTE_MAX = 50;

/** Zellgröße des Begehbarkeitsrasters für „Haus ohne Eingang“ (m). */
export const EINGANG_RASTER = 0.5;

/** Abstand des geschätzten Eingangspunkts vor der Grundfläche (m). */
export const EINGANG_ABSTAND = 1;

/** Ein „Haus“: fester Körper mit mindestens dieser Grundfläche (Kanten) und Höhe (m). */
export const HAUS_MIN_KANTE = 3;
export const HAUS_MIN_HOEHE = 2.5;
