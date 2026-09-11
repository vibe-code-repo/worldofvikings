/**
 * formUebersteuerung.ts — die Handvoll Prefabs, deren Kollisionsform
 * WEDER aus dem Speicher-Katalog NOCH aus der Geometrie kommt.
 *
 * ── Warum es diese Datei gibt ────────────────────────────────────────
 * Zwei andere Wege hätten nähergelegen und sind beide versperrt:
 *
 *   1. `prefabs.json` im Speicher ändern. Die Datei ist FREMD (sie kommt
 *      mit `~/wov-assets/store`, nicht aus diesem Repo) und wird nur
 *      gelesen; eine Änderung dort wäre beim nächsten Speicher-Import
 *      weg, ohne dass es jemandem auffiele.
 *   2. Den Generator `tools/store-prefabs.mjs` eine Ausnahme einbauen
 *      lassen. Dann stünde die Entscheidung in einer ERZEUGTEN Datei
 *      (`storeKollisionDaten.ts`, Kopfzeile „NICHT VON HAND ÄNDERN"),
 *      und wer sie dort liest, hielte sie für eine Angabe der Quelle.
 *      Sie ist aber das Gegenteil: eine Angabe GEGEN die Quelle.
 *
 * Deshalb eine eigene, kleine, von Hand gepflegte Tabelle. Sie wird VOR
 * dem Katalog und vor jeder Geometrieprobe gefragt — sowohl bei „ist das
 * fest?" ({@link istFesterKoerper}) als auch bei „welche Form?"
 * ({@link kollisionsForm}), auf Client und Server aus derselben Zeile.
 *
 * ── Was hier steht und warum ─────────────────────────────────────────
 * Die fünf GROSSEN BÜSCHE. Im Vorbild (Tale of Dark Lands) tragen sie
 * eine stehende Kapsel von r 0,65 m und 3,5–4,6 m Höhe; kleine Büsche
 * und Gras sind durchlässig (Vermessung der Original-Spieldaten,
 * Abschnitt C). Unser Speicher-Katalog führt alle fünf als
 * `art: 'none'` — durch einen viereinhalb Meter hohen Strauch liefe man
 * also hindurch, während man vor dem Baum daneben stehenbleibt.
 *
 * Der RADIUS ist die Zahl des Vorbilds und ausdrücklich NICHT gemessen:
 * Die Stammband-Messung in `formen.ts` ergäbe für diese Modelle 0,56 bis
 * 0,82 m (Median im Band 0,3–2,0 m) — plausibel, aber es ist Laub, und
 * wo genau in einem Blätterballen die Wand sitzt, ist eine
 * Spielentscheidung und keine Geometriefrage. 0,65 m ist die Antwort des
 * Vorbilds darauf.
 *
 * Die HÖHE dagegen ist gemessen, je Modell einzeln — s. die Zahlen an
 * den Zeilen unten.
 *
 * Hand-maintained overrides: prefabs whose collision shape comes neither
 * from the store catalogue nor from geometry. Asked BEFORE both.
 */
import type { KollisionsForm } from './form.js';

/**
 * Der Mantelradius der Grossstrauch-Kapsel, in Metern.
 *
 * Aus den Original-Spieldaten (`CapsuleCollider.radius` der grossen
 * Büsche), nicht aus unserer Geometrie — s. Dateikopf.
 */
export const GROSSBUSCH_RADIUS = 0.65;

/**
 * Prefabname → feste Form.
 *
 * ── Woher `yMax` kommt ───────────────────────────────────────────────
 * Aus der HÜLLBOX des Sichtnetzes, gemessen am 11.09.2026 mit dem
 * Node-GLB-Leser (`shared/src/kollision/glb.ts`, dieselben Zahlen, die
 * der Client aus seinen Babylon-Vertexdaten bekommt — das hält
 * `client/test/kollision-formen.ts` (a) fest).
 *
 * ── Und warum `yMin` NULL ist und nicht die Unterkante ───────────────
 * Nicht angenommen, sondern nachgesehen (Gedächtnisnotiz „Modellmaße
 * nicht annehmen": bei den Felsen lag der Ursprung MITTIG, und wer das
 * für alle Speichermodelle unterstellt, versenkt die halbe Kapsel).
 * Gemessen liegen die fünf Büsche mit ihrer Unterkante 0,137 bis
 * 0,357 m UNTER dem Ursprung und mit ihrer Oberkante 2,5 bis 4,4 m
 * darüber: Der Ursprung ist die Standfläche, nicht die Mitte. Die paar
 * Zentimeter Wurzelwerk darunter gehören nicht in die Kapsel — dort ist
 * Erde.
 *
 * Die Zeilen in der Reihenfolge der Streutabelle (`storeFlora.ts`).
 */
export const FORM_UEBERSTEUERUNG: ReadonlyMap<string, KollisionsForm> = new Map<
  string,
  KollisionsForm
>([
  // Hüllbox y [−0,195 … 4,448], Höhe 4,643 m — Bandradius wäre 0,817
  ['vegetation-large-bush-1a5', { art: 'kapsel', x: 0, z: 0, radius: GROSSBUSCH_RADIUS, yMin: 0, yMax: 4.448 }],
  // Hüllbox y [−0,357 … 4,417], Höhe 4,774 m — Bandradius wäre 0,710
  ['vegetation-large-bush-1a4', { art: 'kapsel', x: 0, z: 0, radius: GROSSBUSCH_RADIUS, yMin: 0, yMax: 4.417 }],
  // Hüllbox y [−0,165 … 3,594], Höhe 3,759 m — Bandradius wäre 0,733
  ['vegetation-large-bush-1a1', { art: 'kapsel', x: 0, z: 0, radius: GROSSBUSCH_RADIUS, yMin: 0, yMax: 3.594 }],
  // Hüllbox y [−0,291 … 3,570], Höhe 3,861 m — Bandradius wäre 0,559
  ['vegetation-large-bush-1a2', { art: 'kapsel', x: 0, z: 0, radius: GROSSBUSCH_RADIUS, yMin: 0, yMax: 3.570 }],
  // Hüllbox y [−0,137 … 2,549], Höhe 2,687 m — der kleinste der fünf
  ['vegetation-large-bush-1a3', { art: 'kapsel', x: 0, z: 0, radius: GROSSBUSCH_RADIUS, yMin: 0, yMax: 2.549 }],
]);

/**
 * Die übersteuerte Form eines Prefabs, oder `null`.
 *
 * Eine Funktion und nicht die blosse Map, damit die Aufrufer (Client wie
 * Server) EINE Frage stellen und nicht zwei — und damit die Stelle, an
 * der eines Tages mehr als ein Namensvergleich nötig wird, schon da ist.
 */
export function formUebersteuerung(prefabName: string): KollisionsForm | null {
  return FORM_UEBERSTEUERUNG.get(prefabName) ?? null;
}
