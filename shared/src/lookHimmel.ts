/**
 * Die Himmelsregler, die A5 (Verlauf und Wolken) und A12 (Sonnenhalo)
 * brauchen — als EIGENE Datei, weil `shared/src/lookProfil.ts` in diesem
 * Workflow dem Integrator gehört.
 *
 * The sky knobs A5 (gradient, clouds) and A12 (sun halo) need — in their
 * own file because `lookProfil.ts` belongs to the integrator this round.
 *
 * ── Wie das hier gemeint ist ─────────────────────────────────────────
 * Das ist KEIN zweites Profil und keine zweite Wahrheit. Es ist ein
 * Stück von `LookHimmel`, das noch nicht dort steht, mit genau der Form,
 * die es dort haben wird:
 *
 *   · `LookHimmelPlus`          die Felder
 *   · `LOOK_HIMMEL_PLUS_VORGABE` ihre Vorgabewerte
 *   · `LOOK_HIMMEL_PLUS_BEREICHE` die Skalen-Wächter für `BEREICHE`
 *   · `liesHimmelPlus()`         der Leser, der beides zusammenführt
 *
 * Der Leser ist der Grund, aus dem das überhaupt geht: Er nimmt das
 * `look.himmel`-Objekt, wie es aus `mischeLook()` herauskommt, und fällt
 * für jedes Feld, das dort (noch) fehlt, auf die Vorgabe zurück. Solange
 * die Felder nicht in `LookHimmel` stehen, filtert `mischeLook()` sie aus
 * `server.yml` weg und `liesHimmelPlus()` liefert die Vorgaben — der
 * Client sieht also genau den kalibrierten Stand. Sobald der Integrator
 * die vier Zeilen einhängt (s. unten), greifen die Werte aus `server.yml`
 * ohne eine einzige weitere Änderung.
 *
 * ⚠ Bis dahin gehören diese Schlüssel NICHT in `server/data/server.yml`:
 * `pruefeLook()` kennt sie nicht, meldet „liest niemand" und der Server
 * startet nicht. Das ist kein Versehen, sondern die Haltung der Datei.
 *
 * ── EINHÄNGEZEILE für den Integrator (shared/src/lookProfil.ts) ──────
 *
 *   1. `import { LOOK_HIMMEL_PLUS_VORGABE, LOOK_HIMMEL_PLUS_BEREICHE,
 *       type LookHimmelPlus } from './lookHimmel';`
 *   2. `export interface LookHimmel extends LookHimmelPlus {`   (Zeile 137)
 *   3. In `LOOK_VORGABE` (Zeile 327):
 *      `himmel: { zenit: '#6E8A9C', horizont: '#96A0A3',
 *                 'sonnenglühen': 0.2, ...LOOK_HIMMEL_PLUS_VORGABE },`
 *   4. In `BEREICHE` hinter `look.himmel.sonnenglühen`:
 *      `...LOOK_HIMMEL_PLUS_BEREICHE,`
 *
 * Danach darf der `look.himmel:`-Block in `server.yml` die neuen Schlüssel
 * tragen; die Werte, mit denen die Nachweise gemessen sind, stehen als
 * Kommentar bei den Vorgaben unten.
 */

/**
 * Die neuen Himmelsfelder.
 *
 * Alle sind 0..1-Größen oder Faktoren um 1 — absichtlich, damit eine
 * verwechselte Skala sofort am Bereichswächter scheitert und nicht erst
 * am Bild (dieselbe Lehre wie `saettigung: 68` in `lookProfil.ts`).
 */
export interface LookHimmelPlus {
  /**
   * Wolkendeckung, 0..1 — ODER −1 = „dem Wetter folgen".
   *
   * −1 ist die Vorgabe und heißt: `EnvSetup.rainCloudAlpha` des gerade
   * laufenden Wetters entscheidet, wie bisher. Ein Wert ≥ 0 übersteuert
   * das für ALLE Wetter und ist deshalb ein Diagnose- und kein
   * Look-Regler — wer ihn setzt, hat auch im Regen dieselbe Decke.
   */
  wolken: number;
  /**
   * Wie weit die besonnte Wolkenseite zum Weiß hin geht, 0..1.
   *
   * Nicht „Wolkenfarbe": Die Wolke wird aus der HIMMELSFARBE AN DIESER
   * STELLE aufgehellt, nicht aus einer eigenen Farbe gemischt. Das ist
   * der Grund, warum eine Wolke am Horizont anders aussieht als im
   * Zenit, ohne dass jemand zwei Farben pflegen muss — und es hält die
   * Sättigung des Himmels dort, wo sie kalibriert ist.
   */
  wolkenHelligkeit: number;
  /** Faktor auf die Himmelsfarbe für die abgewandte Wolkenseite, 0..1. */
  wolkenSchatten: number;
  /**
   * Parallaxe der dritten Wolkenlage, 0..1.
   *
   * Die Lagen werden auf eine Ebene über dem Betrachter projiziert
   * (`dir.xz / dir.y`). Wer zwei Lagen auf dieselbe Ebene legt, bekommt
   * zwei Muster, die sich beim Drehen GLEICH schnell bewegen — flach.
   * Dieser Wert hebt die dritte Lage auf eine andere Höhe; sie wandert
   * dann langsamer über den Himmel, und erst das liest als Tiefe.
   */
  wolkenParallaxe: number;
  /**
   * Silberrand: wie stark der Wolkenrand zur Sonne hin aufleuchtet, 0..1.
   *
   * Angesetzt wird er am RAND, nicht in der Fläche — gerechnet aus dem
   * Abstand der Wolkendichte zu ihrer eigenen Schwelle. Eine über die
   * ganze Wolke gelegte Sonnenfarbe wäre eine gefärbte Wolke und kein
   * Rand.
   */
  silberrand: number;
  /**
   * A12 — Breite des ZWEITEN, breiteren Sonnenhofs, 0..1.
   *
   * Dieselbe Abbildung wie `sonnenglühen`, aber auf einem weiteren
   * Bereich: 0 = Exponent 90 (≈ 7° Halbwertsbreite), 1 = Exponent 1,5
   * (der halbe Himmel). Der schmale Term bleibt daneben stehen; das
   * Vorbild hat BEIDES — einen hellen Kern von wenigen Grad und einen
   * Hof, der bei rund 9° im Himmel verschwindet (Bild 3, Sonnenhof:
   * +45 Luma im Kern, +14 bei 6°, ±0 ab 9°).
   */
  haloBreite: number;
  /** A12 — Stärke des zweiten Sonnenhofs, 0..1 (0 = kein zweiter Term). */
  haloStaerke: number;
}

/**
 * Die Vorgaben — gemessen, nicht gewählt.
 *
 * `wolken: −1` lässt `Klar-Comic` entscheiden (dort steht seit dieser
 * Runde 0,34, s. `shared/src/environment.ts`). Die übrigen Zahlen sind
 * gegen Bild 3 der Referenz kalibriert; welche Messung welche Zahl
 * trägt, steht in `design/look-referenz.md`, Nachtrag „Himmel A5/A12".
 */
export const LOOK_HIMMEL_PLUS_VORGABE: LookHimmelPlus = {
  wolken: -1,
  wolkenHelligkeit: 0.35,
  wolkenSchatten: 0.7,
  wolkenParallaxe: 0.35,
  silberrand: 0.5,
  haloBreite: 0.28,
  haloStaerke: 0.22,
};

/**
 * Skalenwächter, wie sie in `BEREICHE` (lookProfil.ts) gehören.
 *
 * `wolken` beginnt bei −1, weil genau das „folge dem Wetter" heißt; alles
 * andere ist 0..1. Ein Ausrutscher auf Prozent (34 statt 0,34) fällt
 * damit beim Serverstart auf und nicht im Bild.
 */
export const LOOK_HIMMEL_PLUS_BEREICHE: ReadonlyArray<readonly [string, readonly [number, number]]> = [
  ['look.himmel.wolken', [-1, 1]],
  ['look.himmel.wolkenHelligkeit', [0, 1]],
  ['look.himmel.wolkenSchatten', [0, 1]],
  ['look.himmel.wolkenParallaxe', [0, 1]],
  ['look.himmel.silberrand', [0, 1]],
  ['look.himmel.haloBreite', [0, 1]],
  ['look.himmel.haloStaerke', [0, 1]],
];

/**
 * Die neuen Felder aus einem `look.himmel`-Objekt lesen — mit Rückfall.
 *
 * Genommen wird ein Feld nur, wenn es eine ENDLICHE Zahl ist. `NaN` und
 * `Infinity` sind `typeof 'number'` und würden sonst durchrutschen; ein
 * `NaN` in einem Shader-Uniform ist ein schwarzes Bild ohne Fehlermeldung
 * — die teuerste Sorte Fehler in dieser Codebasis.
 *
 * Reads the new fields off a `look.himmel` object, falling back to the
 * defaults for anything missing or not a finite number.
 */
export function liesHimmelPlus(himmel: unknown): LookHimmelPlus {
  const aus: LookHimmelPlus = { ...LOOK_HIMMEL_PLUS_VORGABE };
  if (typeof himmel !== 'object' || himmel === null) return aus;
  const roh = himmel as Record<string, unknown>;
  for (const k of Object.keys(LOOK_HIMMEL_PLUS_VORGABE) as Array<keyof LookHimmelPlus>) {
    const v = roh[k];
    if (typeof v === 'number' && Number.isFinite(v)) aus[k] = v;
  }
  return aus;
}

/**
 * Exponent des Sonnenhofs aus seiner Breite.
 *
 * Eine eigene Funktion, weil sie an DREI Stellen dieselbe sein muss: im
 * Fragment-Shader der Kuppel, in der CPU-Fassung, aus der das
 * Umgebungslicht entsteht, und im Test, der die Halbwertsbreite prüft.
 * Die Zahl, die man am Ende sehen will, ist der WINKEL — deshalb steht
 * er hier als Umkehrung daneben.
 *
 * Exponent for the broad halo; `haloWinkel` inverts it so a test can
 * assert the half-width in degrees instead of an exponent.
 */
export function haloExponent(breite: number): number {
  const b = Math.max(0, Math.min(1, breite));
  return 90 - (90 - 1.5) * b;
}

/** Halbwertswinkel des Hofs in Grad — `cos(w)^n = 0,5`. */
export function haloWinkel(breite: number): number {
  const n = haloExponent(breite);
  return (Math.acos(Math.pow(0.5, 1 / n)) * 180) / Math.PI;
}
