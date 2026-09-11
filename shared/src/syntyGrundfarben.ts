/**
 * Grundfarben der Speicher-Materialien — die Faktoren, die in den
 * GLB-Dateien fehlen.
 *
 * ── Der Befund ───────────────────────────────────────────────────────
 * Die Modelle unter `assets/store/` bringen ihre Texturen vollstaendig
 * mit, aber bei **593 von 635 Materialslots** fehlt der
 * `baseColorFactor`. Der Lader setzt dann 1/1/1, und jeder Stein steht im
 * Bild so hell, wie seine Textur hell ist. Gemessen an der Pose
 * `hanghimmel` um 12:00: Findling sRGB-Luma **85**, das Zielband der
 * Farbanalyse vom 11.09.2026 liegt bei **51–76**, Fels gegen Boden 1,63
 * gegen 0,96–1,24.
 *
 * Die Zahlen unten sind deshalb **nicht geschaetzt**. Der Materialname im
 * GLB ist derselbe Schluessel, unter dem der Faktor in den Quelldaten
 * steht, aus denen der Speicher erzeugt wurde; 53 Namen wurden
 * gegengeprueft, ohne ein einziges Gegenbeispiel. Was hier steht, ist ein
 * zurueckgegebener, kein erfundener Wert.
 *
 * ── Schluessel ist der MATERIALname, nicht der Modellname ────────────
 * Ein Modell traegt bis zu drei Materialien mit verschiedenen Faktoren
 * (`sm-env-rock-cliff-02-1` fuehrt vier). Ein Schluessel je Modell
 * koennte nur einen davon ausdruecken.
 *
 * Gleichnamige Materialien aus ZWEI Dateien sind zwei Objekte: jede GLB
 * bringt ihre eigene Materialinstanz mit. `Dungeon_Material_01` auf einem
 * Findling und `Dungeon_Material_01` in einem Gewoelbe stehen deshalb
 * unabhaengig voneinander — die Gruppenregel unten faerbt nur das erste.
 *
 * ── Zwei Regeln, uebernommen von `FIGUR_TOENUNG` ─────────────────────
 *  1. **Setzen, nicht multiplizieren.** `AssetManager.fixupMaterial`
 *     laeuft je MESH, und mehrere Meshes teilen sich ein Material.
 *     Multipliziert man, wird dasselbe Modell bei jedem weiteren Mesh
 *     dunkler — ein Fehler, der von der Ladereihenfolge abhaengt und sich
 *     als „mal so, mal so" zeigt. Setzen ist ausserdem der Grund, warum
 *     die zwei Ladewege (Welt und Editor-Katalog) einander nicht stoeren
 *     koennen.
 *  2. **1/1/1 heisst „nicht anfassen".** Solche Zeilen stehen gar nicht
 *     erst in der Tabelle; `syntyGrundfarbe()` gibt dort `null` zurueck,
 *     und der Aufrufer laesst das Material in Ruhe.
 *
 * ── Was NICHT in der Tabelle steht, und warum ────────────────────────
 *  • **Vegetation.** `tools/store-vegetation-aufbereiten.mjs` baut fuer
 *    Rinde, Laub, Nadeln und Gras eigene Materialien mit eigenen Namen
 *    (`rinde-eiche`, `laub`, `nadeln`, …) und setzt deren
 *    `baseColorFactor` beim Aufbereiten. Die vier Rindenfaktoren des
 *    Speichers (`Trunks`, `Oak_Bark_A`, `Oak_Bark_A 2 Dark`,
 *    `Birch_Bark_A`) sind bewusst weggelassen: Sie stuenden nur dann noch
 *    im Bild, wenn die Aufbereitung ausfaellt — und dann waere ein
 *    zweiter Faktor auf einem schon getoenten Material genau die
 *    Doppelung, die Regel 1 verhindern soll. {@link syntyGrundfarbe}
 *    laesst Vegetationspfade zusaetzlich hart aus.
 *  • **Requisiten als Gruppe.** 93,8 % der Requisitenslots stehen in den
 *    Quelldaten auf 1/1/1. Eine pauschale Abdunklung waere eine
 *    Erfindung; die wenigen benannten Ausnahmen stehen einzeln unten.
 *  • **Haeuser als Gruppe.** Ihr gewichteter Faktor ist 0,992 — das
 *    Dunkle steckt dort im Atlas (`…Texture_01_Dark`), der im Speicher
 *    bitgleich vorliegt. Nichts zu tun.
 *
 * Base colour factors missing from the store GLBs, keyed by material name.
 * Set, never multiply; 1/1/1 means "leave alone"; vegetation is excluded.
 */

import { istStoreModell } from './storeKatalog.js';

/** Ein Farbfaktor, linear, wie ihn glTF als `baseColorFactor` fuehrt. */
export type Grundfarbe = readonly [number, number, number];

/**
 * Die Faktoren je Materialname.
 *
 * Hinter jeder Zeile steht, auf wie vielen Materialslots der Quelldaten
 * der Wert gemessen wurde (`Slots`) und wie oft der Name im Speicher
 * vorkommt (`Speicher`). Eine Zeile mit `Slots 0` ist kein Ratespiel: Der
 * Wert steht in der gleichnamigen Materialdatei, das Modell selbst kommt
 * in den zwei ausgemessenen Szenen nur nicht vor.
 */
export const SYNTY_GRUNDFARBE: Readonly<Record<string, Grundfarbe>> = {
  // ── Fels, Klippe, Eis ──────────────────────────────────────────────
  /** Slots 323, Speicher 13 — der Fels-/Klippenwert, beide Szenen einig. */
  'PolygonFantasyKingdom_Mat_01_A 2': [0.466, 0.4245, 0.3784],
  /** Slots 28, Speicher 14 — derselbe Wert, zweite Materialdatei. */
  'PolygonFantasyKingdom_Mat_01_A 2 1': [0.466, 0.4245, 0.3784],
  /** Slots 1, Speicher 1 — der hellere Kiesel (`rock-pebble-02-1`). */
  'PolygonFantasyKingdom_Mat_01_A 3': [0.7, 0.6359, 0.5673],
  /** Slots 0, Speicher 12 — Gletscher und Schneeflecken. */
  Ice: [0.851, 0.851, 0.851],
  /** Slots 15, Speicher 2 — Pflaster und Hausfelsen. */
  'Dark_PolyVikings_Material_01 1': [0.5, 0.488, 0.4759],

  // ── Gebautes: Pfeiler, Treppen, Mauern ─────────────────────────────
  /** Slots 16, Speicher 1 — `sm-env-structure-stairs-01`. */
  'Dark 85 PolygonFantasyKingdom_Mat_01_A 2': [0.85, 0.85, 0.85],
  /** Slots 12, Speicher 1 — `sm-prop-village-entrance-01`. */
  'Dark 85 PolyVikings_Material_01 2': [0.85, 0.85, 0.85],
  /** Slots 3, Speicher 1 — Burgmauerstueck an einem Schmuckstueck. */
  'PolygonFantasyKingdom_Mat_Castle_Wall_01 1': [0.75, 0.7125, 0.7125],
  /** Slots 2, Speicher 1 — die Platte unter `environment-start-position`. */
  'Dungeon_Dark_Material_01 2': [0.455, 0.455, 0.455],
  /** Slots 84, Speicher 2 — Vordach und Torbogen. */
  Lit: [0.5, 0.5, 0.5],

  // ── Zaeune, Stege, Gelaender ───────────────────────────────────────
  /** Slots 367, Speicher 5 — der Zaun-/Stegwert. */
  'Dark 60 PolyVikings_Material_01 1': [0.6, 0.6, 0.6],

  // ── Einzelne Requisiten ────────────────────────────────────────────
  /** Slots 0, Speicher 8 — Truemmer eines zerstoerten Hauses. */
  Destroyed_House: [0.75, 0.75, 0.75],
  /** Slots 0, Speicher 2 — Palisadenspitzen. */
  SM_Prop_Log_Spike_09: [0.85, 0.85, 0.85],
  /** Slots 2, Speicher 1 — der blaue Kristall. */
  SM_Item_Crystal_04: [0.451, 0.5882, 1.0],
};

/**
 * Der Gruppenwert fuer Fels und Klippe (Stufe B der Farbanalyse).
 *
 * Warum die Tabelle allein nicht reicht: **53,3 %** der 892 geladenen
 * Fels-Instanzen haengen an `Dungeon_Material_01` und `PolyVikings_
 * Material_01` — zwei Materialien, die auch in den Quelldaten auf 1/1/1
 * stehen, weil dort dieselbe Form mit einem anderen Material gesetzt
 * wurde. Werkgetreu allein senkt die gewichtete Findling-Luma nur von 85
 * auf 78 und verfehlt das Zielband.
 *
 * Deshalb bekommt JEDES Material eines Landschafts-Felsmodells diesen
 * Wert, sofern es keine eigene Zeile in {@link SYNTY_GRUNDFARBE} hat. Es
 * ist der Wert, der an 322 von 322 Klippenslots und an 323 von 399
 * Felsslots der Quelldaten gemessen wurde — die Ausweitung auf die zwei
 * 1/1/1-Materialien ist die einzige Gestaltungsentscheidung dieser Datei,
 * und sie hat eine Zahl hinter sich (gemessen: 85 → 62, Zielband 51–76).
 *
 * Stufe C (0,271/0,247/0,220 → Luma 51) traefe das untere Ende des Bandes
 * punktgenau, liegt aber unter jedem gemessenen Faktor. Sie steht hier
 * bewusst NICHT.
 */
export const FELS_GRUNDFARBE: Grundfarbe = [0.466, 0.4245, 0.3784];

/**
 * Landschaftsfels — die Modelle, auf die {@link FELS_GRUNDFARBE} als
 * Gruppenwert wirkt.
 *
 * Aufgezaehlt statt „alles mit `rock` oder `stone` im Namen": Der
 * Speicher fuehrt unter demselben Wortstamm Bauwerk und Requisite —
 * `sm-env-stonewall-01` (Mauer), `sm-env-stone-throne-01` (Thron),
 * `sm-prop-path-rock-group-03` (gesetzter Weg), `sm-prop-table-stone-03`
 * (Tisch), `sm-bld-house-chimney-stone-01` (Schornstein),
 * `sm-prop-grinding-wheel-01-stone` (Schleifstein), `sm-item-rock-01`
 * (Gegenstand). Keines davon ist Landschaft, und keines darf den
 * Gruppenwert bekommen — sonst dunkelt die Regel Requisiten ab, was die
 * Quelldaten mit 93,8 % auf 1/1/1 ausdruecklich nicht tun.
 *
 * Erfasst werden `sm-env-rock-*` (Findling, Brocken, Klippe, Zacke,
 * Kugel, Kiesel), `sm-env-stone-0*`, `sm-env-glacier-0*` und
 * `sm-env-rubble-pebbles-*` — zusammen 39 der 54 Speicherdateien mit
 * Fels-Wortstamm; die uebrigen 15 sind die oben genannten Bauwerke und
 * Requisiten, die `shared/test/synty-grundfarben.ts` einzeln nachprueft.
 */
const FELS_MODELL = /(?:^|\/)sm-env-(?:rock-|stone-0|glacier-0|rubble-pebbles-)/;

/** Vegetationspfade — die Aufbereitung hat dort schon getoent. */
const VEGETATION_MODELL = /(?:^|\/)vegetation\//;

/**
 * Der Faktor fuer EIN Material eines Speicher-Modells, oder `null`.
 *
 * `null` heisst immer dasselbe: Finger weg. Das gilt fuer alles ausserhalb
 * des Speichers, fuer Vegetation, fuer jedes Material ohne Zeile auf einem
 * Modell ohne Gruppe — und damit auch fuer die 1/1/1-Faelle, die gar nicht
 * erst in der Tabelle stehen.
 *
 * Reihenfolge: Vegetation schlaegt alles, dann die Tabelle (werkgetreu),
 * zuletzt der Gruppenwert. Die Tabelle steht VOR der Gruppe, damit der
 * helle Kiesel (`PolygonFantasyKingdom_Mat_01_A 3`, 0,700) seinen
 * gemessenen Wert behaelt, statt vom Gruppenwert ueberfahren zu werden.
 *
 * @param materialName Name des Materials aus der GLB.
 * @param modell       Modellpfad wie im Ladeweg (`store/environment/…`,
 *                     mit oder ohne `.glb`).
 */
export function syntyGrundfarbe(materialName: string, modell: string): Grundfarbe | null {
  if (!istStoreModell(modell)) return null;
  if (VEGETATION_MODELL.test(modell)) return null;
  const eigen = Object.prototype.hasOwnProperty.call(SYNTY_GRUNDFARBE, materialName)
    ? SYNTY_GRUNDFARBE[materialName]
    : undefined;
  if (eigen) return eigen;
  return FELS_MODELL.test(modell) ? FELS_GRUNDFARBE : null;
}

/**
 * Ist das ein Landschafts-Felsmodell? — exportiert, weil
 * `shared/test/synty-grundfarben.ts` die Ausschluesse oben einzeln
 * nachprueft und eine zweite Kopie des Musters unweigerlich auseinander
 * liefe.
 */
export function istFelsModell(modell: string): boolean {
  return istStoreModell(modell) && !VEGETATION_MODELL.test(modell) && FELS_MODELL.test(modell);
}
