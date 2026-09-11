/**
 * Layout-Datenformat v1 des Dungeon-Generators 2.0 — EINGEFROREN.
 * Frozen layout data format v1 of dungeon generator 2.0.
 *
 * Quelle: `design/ARCHITECTURE.md` §3.2–§3.7 (dort eingefroren), vertieft in
 * `design/data-model.md` §1. Aenderungen an den Interfaces sind eine
 * Versionserhoehung mit Migrationsschritt, kein Edit.
 * Source: `design/ARCHITECTURE.md` §3.2–§3.7 (frozen there), detailed in
 * `design/data-model.md` §1. Changing an interface means a version bump with a
 * migration step, never an in-place edit.
 *
 * Der tragende Grundsatz (§3.1): Das Layout enthaelt KEINE Fliesskommazahlen.
 * Jede Koordinate ist eine Ganzzahl — Zellindex, Ebenenindex, Hoehenstufe,
 * Vierteldrehung. Meter entstehen erst im Bauer, durch Multiplikation, auf
 * beiden Seiten mit derselben Funktion. Damit ist Determinismus per
 * Byte-Vergleich nachweisbar statt geglaubt.
 * The load-bearing principle (§3.1): the layout contains NO floating point
 * numbers. Every coordinate is an integer — cell index, storey index, height
 * step, quarter turn. Metres appear only in the builder, by multiplication,
 * on both sides through the same function. Determinism is therefore provable
 * by byte comparison instead of merely believed.
 *
 * Dieses Modul ist rein: kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie.
 * This module is pure: no Babylon, no DOM, no `node:`, no `Math.random`,
 * no clock, no trigonometry.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Raster / grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rasterkonstanten. Sie stehen ZUSAETZLICH im Dokument (`raster`), weil eine
 * Konstante sich aendern kann und ein altes Dokument dann still umgedeutet
 * wuerde.
 * Grid constants. They are ALSO written into each document, because a
 * constant can change and an old document would then be silently reinterpreted.
 *
 * `ZELLE_M`, `EBENE_M` und die 4-m-Mindesthoehe sind die belegten Werte aus
 * `shared/src/dungeonRaster.ts` (Figurenmasse aus `bewegung/masse.ts`:
 * KOERPER_RADIUS 0.4 / KOERPER_HOEHE 2.0, Z-Fighting-Rechnung fuer die
 * Stockwerkshoehe). Die Herleitung ueberlebt den Neubau, das Modul nicht.
 * `ZELLE_M`, `EBENE_M` and the 4 m headroom are the values already justified in
 * `shared/src/dungeonRaster.ts` (capsule radius 0.4 / capsule height 2.0, the
 * z-fighting calculation behind the storey height). The reasoning survives the
 * rebuild, the module does not.
 */
export const ZELLE_M = 4; // Kantenlaenge einer Zelle / cell edge length
export const EBENE_M = 8; // Stockwerkshoehe / storey height
export const HOEHEN_SCHRITT_M = 0.5; // feinste Hoehenstufe / finest height step
export const MIN_LICHTE_STUFEN = 8; // 4 m Mindesthoehe / minimum headroom
/**
 * Mindestkopfraum ueber der OBERSTEN Stufe eines Treppenlaufs, in Hoehenstufen
 * (4 = 2 m). NICHT `MIN_LICHTE_STUFEN`: ein Treppenabsatz ist kein Raum, und
 * 4 m Kopfraum ueber jeder Stufe waeren mit einer Ebenenhoehe von 8 m und einer
 * begehbaren Steigung nicht erreichbar. Die 2 m sind die Spielerkapsel (1,8 m)
 * plus eine Handbreit.
 * Minimum headroom above the TOPMOST step of a stair run, in height steps
 * (4 = 2 m). NOT `MIN_LICHTE_STUFEN`: a landing is not a room, and 4 m of
 * headroom over every step is unreachable with an 8 m storey and a walkable
 * gradient. The 2 m are the player capsule (1.8 m) plus a hand's breadth.
 */
export const TREPPE_KOPFRAUM_STUFEN = 4;
export const BLOCK_ZELLEN = 8; // 8x8 Zellen = 32 m je Block / cells per block

/**
 * Groesster erlaubter Materialindex einer Zelle. 0..5 sind die Basis-Layer des
 * Textur-Arrays; 6..9 sind Blend-Overlays (Moos, Feuchte, Frost, Russ) und
 * duerfen nie als `materialTag` einer Zelle auftauchen (ARCHITECTURE W5).
 * Highest legal cell material index. 0..5 are the base layers of the texture
 * array; 6..9 are blend overlays and must never appear as a cell `materialTag`.
 */
export const MAX_MATERIAL_TAG = 5;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Aufzaehlungen / enumerations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kanten einer Zelle als Bitmaske.
 * Cell edges as a bit mask.
 *
 * Himmelsrichtungen folgen der Projektkonvention (Minimap.ts, WorldMap.ts):
 * Norden = +z, Osten = +x.
 * Compass directions follow the project convention: north = +z, east = +x.
 */
export const enum Kante {
  Nord = 1,
  Ost = 2,
  Sued = 4,
  West = 8,
}

export const enum ZellenArt {
  Leer = 0, // Fels — nicht begehbar / solid rock, not walkable
  Boden = 1, // waagerechte Standflaeche / flat walkable floor
  Treppe = 2, // geneigt, ueberwindet Hoehenstufen / sloped, spans height steps
  Schacht = 3, // offen nach oben/unten (Leiter, Loch) / vertical opening
  Wasser = 4, // Boden unter Wasserspiegel / floor below water level
}

export const enum AnkerOrt {
  Wand = 0,
  Boden = 1,
  Decke = 2,
  Ecke = 3,
}

/**
 * Laufzeit-Spiegel der drei `const enum`s.
 * Runtime mirrors of the three `const enum`s.
 *
 * Warum doppelt: `const enum` wird von esbuild/Vite ueber Modulgrenzen hinweg
 * nicht zuverlaessig aufgeloest (dokumentiert in
 * `client/src/editor/GegenstandsKatalog.ts`). Das eingefrorene Format schreibt
 * `const enum` vor — die Spiegel sind deshalb KEINE Formataenderung, sondern
 * der sichere Weg, an einen Wert zu kommen, wo der Typ nicht reicht.
 * Why twice: esbuild/Vite do not reliably inline `const enum` across module
 * boundaries (documented in `GegenstandsKatalog.ts`). The frozen format
 * mandates `const enum` — these mirrors are therefore NOT a format change but
 * the safe way to obtain a value where the type alone will not do.
 */
export const KANTE = { Nord: 1, Ost: 2, Sued: 4, West: 8 } as const;
export const ZELLEN_ART = { Leer: 0, Boden: 1, Treppe: 2, Schacht: 3, Wasser: 4 } as const;
export const ANKER_ORT = { Wand: 0, Boden: 1, Decke: 2, Ecke: 3 } as const;

/** Alle vier Kantenbits, in fester Reihenfolge. / All four edge bits, fixed order. */
export const KANTEN: readonly Kante[] = [KANTE.Nord, KANTE.Ost, KANTE.Sued, KANTE.West];

/** Bitmaske aller vier Kanten. / Bit mask of all four edges. */
export const KANTE_ALLE = 15;

export type RaumTyp =
  | 'eingang'
  | 'gang'
  | 'kammer'
  | 'saal'
  | 'schatzkammer'
  | 'grabkammer'
  | 'treppe'
  | 'nische'
  | 'abschluss';

/**
 * Alle Raumtypen als Laufzeitliste — fuer Pruefungen und Editor-Auswahlen.
 * All room types as a runtime list — for validation and editor pickers.
 */
export const RAUM_TYPEN: readonly RaumTyp[] = [
  'eingang',
  'gang',
  'kammer',
  'saal',
  'schatzkammer',
  'grabkammer',
  'treppe',
  'nische',
  'abschluss',
];

export type TuerZustand = 'offen' | 'zu' | 'verschlossen';

/** Alle Tuerzustaende als Laufzeitliste. / All door states as a runtime list. */
export const TUER_ZUSTAENDE: readonly TuerZustand[] = ['offen', 'zu', 'verschlossen'];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Die Zelle / the cell
// ─────────────────────────────────────────────────────────────────────────────

export interface Zelle {
  /** Rasterkoordinaten, Ganzzahlen. / Grid coordinates, integers. */
  readonly x: number;
  readonly z: number;
  /** Stockwerk. Hoehe der Ebene = ebene * EBENE_M. / Storey. */
  readonly ebene: number;

  readonly art: ZellenArt;

  /**
   * Bodenhoehe in HOEHEN_SCHRITT_M, RELATIV zur Ebene. Bei einer Treppe die
   * Hoehe an der Kante mit dem kleineren Index (siehe `neigung`).
   * Floor height in height steps, RELATIVE to the storey. On a stair cell the
   * height at the lower-index edge (see `neigung`).
   */
  readonly boden: number;
  /**
   * Deckenhoehe in HOEHEN_SCHRITT_M ueber dem Boden DIESER Zelle.
   * Ceiling height in height steps above the floor of THIS cell.
   */
  readonly decke: number;
  /** Nur bei Treppe: Richtung des Anstiegs. / Ascent direction, stairs only. */
  readonly neigung?: Kante;

  /**
   * Wand ERZWINGEN an diesen Kanten, auch wenn die Nachbarzelle begehbar ist.
   * Force a wall on these edges even if the neighbour is walkable.
   */
  readonly wandErzwungen: number;
  /**
   * Durchgang ERZWINGEN — keine Wand, auch wenn die Ableitung eine setzen
   * wuerde. Schlaegt `wandErzwungen`, auch das der Nachbarzelle.
   * Force an opening; beats `wandErzwungen`, including the neighbour's.
   */
  readonly durchgangErzwungen: number;

  /** Materialkennung, 0..MAX_MATERIAL_TAG. / Material index, 0..MAX_MATERIAL_TAG. */
  readonly materialTag: number;
  /**
   * Zusatzmerkmale fuers Material-Blending (Bitmaske). Im Format v1 reserviert,
   * die Bit-Belegung steht noch NICHT fest (ARCHITECTURE R11) — wer es vorher
   * benutzt, benutzt es falsch.
   * Extra flags for material blending (bit mask). Reserved in format v1, the
   * bit assignment is NOT yet fixed (ARCHITECTURE R11) — using it before that
   * is using it wrongly.
   */
  readonly oberflaeche: number;

  /**
   * Stempel, aus dem diese Zelle stammt — oder -1 fuer Handarbeit. NIE
   * verhaltensrelevant (ARCHITECTURE W1): kein Bauer-, Kollisions- oder
   * Shader-Pfad darf `stempelId` auswerten.
   * The stamp this cell came from, or -1 for hand work. NEVER behaviour
   * relevant (W1): no builder, collision or shader path may read `stempelId`.
   */
  readonly stempelId: number;
}

/**
 * Reihenfolge der Zellfelder in der kanonischen Serialisierung. Fest, weil eine
 * Objekt-Schluesselreihenfolge nie in die Pruefsumme eingehen darf.
 * Field order of a cell in the canonical serialisation. Fixed, because an
 * object key order must never influence the checksum.
 */
const ZELL_FELDER = [
  'art',
  'boden',
  'decke',
  'neigung',
  'wandErzwungen',
  'durchgangErzwungen',
  'materialTag',
  'oberflaeche',
  'stempelId',
] as const;

type ZellFeld = (typeof ZELL_FELDER)[number];

/** Teilaenderung an einer Zelle. / Partial change to a cell. */
export type ZellenAenderung = Partial<Omit<Zelle, 'x' | 'z' | 'ebene'>>;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stempel, Korrekturen, Tueren, Anker / stamps, fixes, doors, anchors
// ─────────────────────────────────────────────────────────────────────────────

export interface RaumStempel {
  /** Stabil ueber die Lebenszeit des Dokuments; wird NIE neu vergeben. */
  /** Stable for the lifetime of the document; NEVER reassigned. */
  readonly id: number;
  readonly typ: RaumTyp;

  /** Ankerzelle (kleinste x/z-Ecke vor der Drehung). / Anchor cell. */
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  /** Ausdehnung in Zellen. / Footprint in cells. */
  readonly breite: number;
  readonly tiefe: number;
  /** Hoehe ueber dem Raumboden, in HOEHEN_SCHRITT_M. / Height above room floor. */
  readonly hoehe: number;
  /** Anhebung des Raumbodens gegen die Ebene, in HOEHEN_SCHRITT_M. */
  /** Floor offset against the storey, in height steps. */
  readonly bodenVersatz: number;

  /** Vierteldrehungen um die Hochachse. 0..3, keine anderen Winkel. */
  /** Quarter turns around the up axis. 0..3, no other angles. */
  readonly drehung: 0 | 1 | 2 | 3;

  readonly seed: number;
  /** Themenvariante (Materialsatz-Index). / Theme variant. */
  readonly variante: number;

  /**
   * Reihenfolge beim Auftragen. Spaetere Stempel ueberschreiben die Zellen
   * frueherer. Damit ist „Gang durch Saal" definiert statt zufaellig.
   * Stamp order; later stamps overwrite the cells of earlier ones.
   */
  readonly ordnung: number;

  /** Tiefe im Wachstumsbaum, 0 = Eingang. / Depth in the growth tree, 0 = entrance. */
  readonly tiefeImBaum: number;
}

/**
 * Eine von Hand geaenderte Zelle. Wird NACH allen Stempeln aufgetragen.
 * A hand-edited cell. Applied AFTER all stamps.
 */
export interface ZellenKorrektur {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  /** Teilweise Ueberschreibung; fehlende Felder behalten den Stempelwert. */
  /** Partial override; missing fields keep the stamped value. */
  readonly aendere: ZellenAenderung;
  /** true = Zelle ganz entfernen (Fels). / true = carve the cell away. */
  readonly loeschen?: boolean;
}

export interface Tuer {
  /** Zelle und Kante, an der die Tuer steht — kanonisiert (s. `kanonisiereKante`). */
  /** Cell and edge the door sits on — canonicalised (see `kanonisiereKante`). */
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly kante: Kante;
  /** Tuerart aus dem Themenprofil ('holz', 'gitter', 'bogen', 'steinplatte'). */
  readonly art: string;
  readonly zustand: TuerZustand;
  /** Schluesselkennung bei `verschlossen`. / Key id when `verschlossen`. */
  readonly schluessel?: string;
}

export interface DekoAnker {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly ort: AnkerOrt;
  /** Bei Wand/Ecke: welche Kante. / Which edge, for wall/corner anchors. */
  readonly kante?: Kante;
  /**
   * Versatz innerhalb der Zelle in Achteln einer Zelle (u, v: 0..8) und Hoehe
   * in HOEHEN_SCHRITT_M (h). Ganzzahlen — siehe Grundsatz §3.1.
   * Offset inside the cell in eighths of a cell (u, v: 0..8) and height in
   * height steps (h). Integers — see the principle in §3.1.
   */
  readonly u: number;
  readonly v: number;
  readonly h: number;
  readonly drehung: 0 | 1 | 2 | 3;

  /**
   * Die ROLLE, nicht das Prefab ('fackel', 'truhe', 'altar', ...). Welches
   * Modell daraus wird, entscheidet der Bestuecker.
   * The ROLE, not the prefab. The furnisher resolves it.
   */
  readonly rolle: string;
  /** Von Hand festgenagelt: dieses Prefab und kein anderes. */
  /** Nailed down by hand: this prefab and no other. */
  readonly prefab?: string;
  readonly seed: number;
  /** Stempel, zu dem der Anker gehoert; -1 = Handarbeit. */
  /** Stamp the anchor belongs to; -1 = hand work. */
  readonly stempelId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Seeds und Dokument / seeds and document
// ─────────────────────────────────────────────────────────────────────────────

export interface LayoutSeeds {
  /** Grundriss: Stempel, Gaenge, Ebenen, Schleifen. / Floor plan. */
  readonly architektur: number;
  /** Oberflaechen: Variation, Moos, Feuchte, Schmutz. / Surfaces. */
  readonly material: number;
  /** Bestueckung: welches Prefab an welchem Anker. / Furnishing. */
  readonly deko: number;
}

export const LAYOUT_FORMAT = 'wov-dungeon-layout' as const;
export const LAYOUT_VERSION = 1;

export interface DungeonLayout2 {
  /** Unterscheidungsmerkmal gegen das Altformat. / Marker against the old format. */
  readonly format: typeof LAYOUT_FORMAT;
  readonly version: number;

  readonly id: string;
  readonly name: string;

  /** Themenprofil: Raumtypen, Gewichte, Materialsatz, Deko-Tabellen. */
  readonly thema: string;

  readonly seeds: LayoutSeeds;

  /**
   * Die Rasterwerte, mit denen dieses Dokument erzeugt wurde. Mitgeschrieben
   * und NICHT angenommen.
   * The grid this document was built with — written down, never assumed.
   */
  readonly raster: {
    readonly zelleM: number;
    readonly ebeneM: number;
    readonly hoehenSchrittM: number;
    readonly blockZellen: number;
  };

  /** Wachstumsgrenzen in ZELLEN, nicht in Metern. / Growth bounds in CELLS. */
  readonly grenzen: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly minEbene: number;
    readonly maxEbene: number;
  };

  /** Eingangszelle und die Kante, durch die man hereinkommt. / Entrance. */
  readonly eingang: {
    readonly x: number;
    readonly z: number;
    readonly ebene: number;
    readonly kante: Kante;
  };

  readonly stempel: readonly RaumStempel[];
  readonly korrekturen: readonly ZellenKorrektur[];
  readonly tueren: readonly Tuer[];
  readonly anker: readonly DekoAnker[];

  /**
   * FNV-1a ueber `kanonisch()`, also ueber alles obige OHNE dieses Feld. Der
   * Zeuge, an dem sich zeigt, ob Server und Client dasselbe Grab meinen.
   * FNV-1a over `kanonisch()`, i.e. over everything above WITHOUT this field.
   * The witness that server and client mean the same dungeon.
   */
  readonly pruefsumme: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Kantenrechnung / edge arithmetic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nachbarzelle ueber eine Kante. Norden = +z, Osten = +x (Projektkonvention).
 * Neighbour cell across an edge. North = +z, east = +x (project convention).
 */
export function nachbarZelle(x: number, z: number, kante: Kante): { x: number; z: number } {
  switch (kante) {
    case KANTE.Nord:
      return { x, z: z + 1 };
    case KANTE.Ost:
      return { x: x + 1, z };
    case KANTE.Sued:
      return { x, z: z - 1 };
    default:
      return { x: x - 1, z };
  }
}

/** Gegenkante. / Opposite edge. */
export function gegenKante(kante: Kante): Kante {
  switch (kante) {
    case KANTE.Nord:
      return KANTE.Sued;
    case KANTE.Ost:
      return KANTE.West;
    case KANTE.Sued:
      return KANTE.Nord;
    default:
      return KANTE.Ost;
  }
}

/**
 * Eine Kante gehoert zwei Zellen. Gespeichert wird sie immer an der Zelle mit
 * dem kleineren (`ebene`, `z`, `x`) — der SCHREIBWEG kanonisiert, nicht der
 * Leseweg. Mit Norden = +z und Osten = +x bleiben genau `Nord` und `Ost` als
 * kanonische Kanten uebrig; `Sued` und `West` klappen auf die Nachbarzelle um.
 * An edge belongs to two cells. It is always stored at the cell with the
 * smaller (`ebene`, `z`, `x`) — the WRITE path canonicalises, not the read
 * path. With north = +z and east = +x exactly `Nord` and `Ost` remain as
 * canonical edges; `Sued` and `West` fold over to the neighbour cell.
 */
export function kanonisiereKante(
  x: number,
  z: number,
  ebene: number,
  kante: Kante
): { x: number; z: number; ebene: number; kante: Kante } {
  if (kante === KANTE.Nord || kante === KANTE.Ost) return { x, z, ebene, kante };
  const n = nachbarZelle(x, z, kante);
  return { x: n.x, z: n.z, ebene, kante: gegenKante(kante) };
}

/** Ist die Kante bereits in kanonischer Form? / Is the edge already canonical? */
export function istKanonischeKante(kante: number): boolean {
  return kante === KANTE.Nord || kante === KANTE.Ost;
}

/** Genau ein gesetztes Kantenbit? / Exactly one edge bit set? */
function istEinzelneKante(w: unknown): boolean {
  return w === KANTE.Nord || w === KANTE.Ost || w === KANTE.Sued || w === KANTE.West;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Kanonisierung / canonicalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zahl als Text. `-0` wird zu `0` normalisiert, damit zwei rechnerisch gleiche
 * Layouts nicht an einem Vorzeichenbit auseinanderlaufen. Nicht endliche Werte
 * bekommen einen festen Text; sie sind ungueltig und werden von
 * `validateLayout` gemeldet — die Kanonisierung darf daran nicht scheitern.
 * A number as text. `-0` is normalised to `0` so two arithmetically equal
 * layouts do not diverge over a sign bit. Non-finite values get a fixed text;
 * they are invalid and reported by `validateLayout` — canonicalisation must
 * not throw over them.
 */
function zahlText(w: number): string {
  if (typeof w !== 'number' || !Number.isFinite(w)) return '?';
  if (w === 0) return '0';
  return String(w);
}

/** Text mit JSON-Anfuehrung — eine Regel, die in Node und Browser gleich ist. */
/** Text with JSON quoting — one rule, identical in Node and the browser. */
function txt(s: string): string {
  return JSON.stringify(typeof s === 'string' ? s : String(s));
}

/**
 * Eine Zellaenderung in FESTER Feldreihenfolge. Fehlende Felder entfallen;
 * `loeschen: false` und ein fehlendes `loeschen` sind dasselbe.
 * A cell change in FIXED field order. Missing fields are omitted; `loeschen:
 * false` and an absent `loeschen` mean the same thing.
 */
function aendereText(a: ZellenAenderung): string {
  const teile: string[] = [];
  for (const feld of ZELL_FELDER) {
    const wert = (a as Record<ZellFeld, number | undefined>)[feld];
    if (wert === undefined) continue;
    teile.push(`${feld}=${zahlText(wert)}`);
  }
  return teile.join(';');
}

function stempelText(s: RaumStempel): string {
  return [
    zahlText(s.id),
    txt(s.typ),
    zahlText(s.x),
    zahlText(s.z),
    zahlText(s.ebene),
    zahlText(s.breite),
    zahlText(s.tiefe),
    zahlText(s.hoehe),
    zahlText(s.bodenVersatz),
    zahlText(s.drehung),
    zahlText(s.seed),
    zahlText(s.variante),
    zahlText(s.ordnung),
    zahlText(s.tiefeImBaum),
  ].join(',');
}

function korrekturText(k: ZellenKorrektur): string {
  return [
    zahlText(k.x),
    zahlText(k.z),
    zahlText(k.ebene),
    k.loeschen === true ? '1' : '0',
    `{${aendereText(k.aendere ?? {})}}`,
  ].join(',');
}

function tuerText(t: Tuer): string {
  return [
    zahlText(t.x),
    zahlText(t.z),
    zahlText(t.ebene),
    zahlText(t.kante),
    txt(t.art),
    txt(t.zustand),
    t.schluessel === undefined ? '-' : txt(t.schluessel),
  ].join(',');
}

function ankerText(a: DekoAnker): string {
  return [
    zahlText(a.id),
    zahlText(a.x),
    zahlText(a.z),
    zahlText(a.ebene),
    zahlText(a.ort),
    a.kante === undefined ? '-' : zahlText(a.kante),
    zahlText(a.u),
    zahlText(a.v),
    zahlText(a.h),
    zahlText(a.drehung),
    txt(a.rolle),
    a.prefab === undefined ? '-' : txt(a.prefab),
    zahlText(a.seed),
    zahlText(a.stempelId),
  ].join(',');
}

/**
 * Sortiert Eintraege nach einem Ganzzahl-Schluessel und — bei Gleichstand —
 * nach ihrem eigenen Text. Der Texttiebreak ist der Grund, warum keine
 * Eingabereihenfolge durchschlagen kann, auch nicht bei gleichem Schluessel.
 * Sorts entries by an integer key and, on ties, by their own text. That text
 * tiebreak is why no input order can leak through, not even on equal keys.
 */
function sortiereZeilen<T>(
  liste: readonly T[],
  schluessel: (e: T) => readonly number[],
  text: (e: T) => string
): string[] {
  const zeilen = liste.map((e) => ({ k: schluessel(e), t: text(e) }));
  zeilen.sort((a, b) => {
    const n = Math.min(a.k.length, b.k.length);
    for (let i = 0; i < n; i++) {
      if (a.k[i]! !== b.k[i]!) return a.k[i]! < b.k[i]! ? -1 : 1;
    }
    if (a.t === b.t) return 0;
    return a.t < b.t ? -1 : 1;
  });
  return zeilen.map((e) => e.t);
}

/**
 * Deterministische Serialisierung: sortierte Listen, feste Feldreihenfolge,
 * ohne `pruefsumme`.
 * Deterministic serialisation: sorted lists, fixed field order, without
 * `pruefsumme`.
 *
 * Sortiert wird VOR dem Serialisieren (ARCHITECTURE §3.6): Stempel nach
 * (`ordnung`, `id`); Korrekturen, Tueren und Anker nach (`ebene`, `z`, `x`,
 * Unterscheidungsfeld). Eine `Map`-Iterationsreihenfolge darf nie in die
 * Pruefsumme eingehen.
 * Sorting happens BEFORE serialising (§3.6): stamps by (`ordnung`, `id`);
 * fixes, doors and anchors by (`ebene`, `z`, `x`, discriminator). A `Map`
 * iteration order must never enter the checksum.
 */
export function kanonisch(layout: DungeonLayout2): string {
  const zeilen: string[] = [];

  zeilen.push(`format=${txt(layout.format)}`);
  zeilen.push(`version=${zahlText(layout.version)}`);
  zeilen.push(`id=${txt(layout.id)}`);
  zeilen.push(`name=${txt(layout.name)}`);
  zeilen.push(`thema=${txt(layout.thema)}`);
  zeilen.push(
    `seeds=${zahlText(layout.seeds.architektur)},${zahlText(layout.seeds.material)},${zahlText(
      layout.seeds.deko
    )}`
  );
  zeilen.push(
    `raster=${zahlText(layout.raster.zelleM)},${zahlText(layout.raster.ebeneM)},${zahlText(
      layout.raster.hoehenSchrittM
    )},${zahlText(layout.raster.blockZellen)}`
  );
  zeilen.push(
    `grenzen=${zahlText(layout.grenzen.minX)},${zahlText(layout.grenzen.maxX)},${zahlText(
      layout.grenzen.minZ
    )},${zahlText(layout.grenzen.maxZ)},${zahlText(layout.grenzen.minEbene)},${zahlText(
      layout.grenzen.maxEbene
    )}`
  );
  zeilen.push(
    `eingang=${zahlText(layout.eingang.x)},${zahlText(layout.eingang.z)},${zahlText(
      layout.eingang.ebene
    )},${zahlText(layout.eingang.kante)}`
  );

  const stempel = sortiereZeilen(layout.stempel, (s) => [s.ordnung, s.id], stempelText);
  zeilen.push(`stempel=${stempel.length}`);
  for (const s of stempel) zeilen.push(`  ${s}`);

  const korrekturen = sortiereZeilen(
    layout.korrekturen,
    (k) => [k.ebene, k.z, k.x],
    korrekturText
  );
  zeilen.push(`korrekturen=${korrekturen.length}`);
  for (const k of korrekturen) zeilen.push(`  ${k}`);

  const tueren = sortiereZeilen(layout.tueren, (t) => [t.ebene, t.z, t.x, t.kante], tuerText);
  zeilen.push(`tueren=${tueren.length}`);
  for (const t of tueren) zeilen.push(`  ${t}`);

  const anker = sortiereZeilen(layout.anker, (a) => [a.ebene, a.z, a.x, a.id], ankerText);
  zeilen.push(`anker=${anker.length}`);
  for (const a of anker) zeilen.push(`  ${a}`);

  return zeilen.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Pruefsumme / checksum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a (32 Bit) ueber die UTF-8-Bytes eines Textes.
 * FNV-1a (32 bit) over the UTF-8 bytes of a text.
 *
 * Kein HMAC, kein `crypto`: Die Pruefsumme ist ein Zeuge gegen Auseinander-
 * laufen, keine Absicherung gegen einen Angreifer — und `crypto` laeuft in Node
 * anders als im Browser, und zwar still (Notiz „Node-Krypto ist nicht
 * Browser-Krypto"). Die UTF-8-Umrechnung steht ausgeschrieben statt ueber
 * `TextEncoder`, damit auch die Byte-Erzeugung nachweislich dieselbe ist.
 * No HMAC, no `crypto`: the checksum is a witness against divergence, not a
 * defence against an attacker — and `crypto` behaves differently in Node than
 * in the browser, silently. The UTF-8 conversion is spelled out instead of
 * using `TextEncoder`, so that even byte generation is provably the same.
 */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5 >>> 0;
  const mische = (b: number): void => {
    h = (h ^ (b & 0xff)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    // Ersatzpaar zu einem Codepoint zusammenziehen / combine a surrogate pair
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const t = text.charCodeAt(i + 1);
      if (t >= 0xdc00 && t <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (t - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      mische(c);
    } else if (c < 0x800) {
      mische(0xc0 | (c >> 6));
      mische(0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      mische(0xe0 | (c >> 12));
      mische(0x80 | ((c >> 6) & 0x3f));
      mische(0x80 | (c & 0x3f));
    } else {
      mische(0xf0 | (c >> 18));
      mische(0x80 | ((c >> 12) & 0x3f));
      mische(0x80 | ((c >> 6) & 0x3f));
      mische(0x80 | (c & 0x3f));
    }
  }
  return h >>> 0;
}

/**
 * FNV-1a ueber `kanonisch()`, als acht Hex-Zeichen in Kleinschreibung.
 * FNV-1a over `kanonisch()`, as eight lowercase hex characters.
 */
export function layoutPruefsumme(layout: DungeonLayout2): string {
  return fnv1a32(kanonisch(layout)).toString(16).padStart(8, '0');
}

/**
 * Layout mit frisch gerechneter Pruefsumme. Der einzige Ort, an dem
 * `pruefsumme` gesetzt werden soll.
 * The layout with a freshly computed checksum. The only place `pruefsumme`
 * should be set.
 */
export function mitPruefsumme(layout: DungeonLayout2): DungeonLayout2 {
  return { ...layout, pruefsumme: layoutPruefsumme(layout) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Migration / migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Migrationsschritte v_n -> v_{n+1}, indiziert ueber die Ausgangsversion.
 * Eine Kette reiner Schritte, NIE ein wachsender Sanitizer: Der Sanitizer sagt
 * „ist das gueltig", die Migration sagt „was bedeutete das damals".
 * Migration steps v_n -> v_{n+1}, indexed by source version. A chain of pure
 * steps, NEVER a growing sanitizer: the sanitizer says "is this valid", the
 * migration says "what did this mean back then".
 *
 * v1 ist die erste Version, deshalb ist die Kette leer. Sie steht trotzdem hier,
 * damit der zweite Autor keinen Ort erfinden muss.
 * v1 is the first version, so the chain is empty. It is spelled out anyway so
 * the second author does not have to invent a place for it.
 */
const MIGRATIONS_SCHRITTE: ReadonlyMap<number, (roh: RohObjekt) => RohObjekt> = new Map();

type RohObjekt = Record<string, unknown>;

function istObjekt(w: unknown): w is RohObjekt {
  return typeof w === 'object' && w !== null && !Array.isArray(w);
}

function istGanz(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w) && Number.isInteger(w);
}

function istListe(w: unknown): w is unknown[] {
  return Array.isArray(w);
}

/**
 * Liest ein rohes Objekt streng in ein `DungeonLayout2` — oder gibt `null`
 * zurueck. Das ist die Typpruefung des Formats: Sie lehnt jede Fliesskommazahl
 * an einer Ganzzahlstelle ab, denn TypeScript kann `0.5` nicht von `1`
 * unterscheiden (beides ist `number`).
 * Strictly reads a raw object into a `DungeonLayout2`, or returns `null`. This
 * IS the format's type check: it rejects any floating point number in an
 * integer slot, because TypeScript cannot tell `0.5` from `1` (both `number`).
 */
function leseLayout(roh: unknown): DungeonLayout2 | null {
  if (!istObjekt(roh)) return null;
  if (roh.format !== LAYOUT_FORMAT) return null;
  if (!istGanz(roh.version)) return null;
  if (typeof roh.id !== 'string' || typeof roh.name !== 'string') return null;
  if (typeof roh.thema !== 'string') return null;
  if (typeof roh.pruefsumme !== 'string') return null;

  const s = roh.seeds;
  if (!istObjekt(s) || !istGanz(s.architektur) || !istGanz(s.material) || !istGanz(s.deko)) {
    return null;
  }

  const r = roh.raster;
  if (!istObjekt(r)) return null;
  if (!istGanz(r.zelleM) || !istGanz(r.ebeneM) || !istGanz(r.blockZellen)) return null;
  // `hoehenSchrittM` ist ein METERMASS, keine Koordinate — 0.5 ist hier
  // richtig und kein Verstoss gegen den Ganzzahl-Grundsatz.
  // `hoehenSchrittM` is a METRE measure, not a coordinate — 0.5 is correct
  // here and no violation of the integer principle.
  if (typeof r.hoehenSchrittM !== 'number' || !Number.isFinite(r.hoehenSchrittM)) return null;

  const g = roh.grenzen;
  if (
    !istObjekt(g) ||
    !istGanz(g.minX) ||
    !istGanz(g.maxX) ||
    !istGanz(g.minZ) ||
    !istGanz(g.maxZ) ||
    !istGanz(g.minEbene) ||
    !istGanz(g.maxEbene)
  ) {
    return null;
  }

  const e = roh.eingang;
  if (!istObjekt(e) || !istGanz(e.x) || !istGanz(e.z) || !istGanz(e.ebene)) return null;
  if (!istEinzelneKante(e.kante)) return null;

  if (!istListe(roh.stempel) || !istListe(roh.korrekturen)) return null;
  if (!istListe(roh.tueren) || !istListe(roh.anker)) return null;

  const stempel: RaumStempel[] = [];
  for (const w of roh.stempel) {
    const st = leseStempel(w);
    if (st === null) return null;
    stempel.push(st);
  }

  const korrekturen: ZellenKorrektur[] = [];
  for (const w of roh.korrekturen) {
    const k = leseKorrektur(w);
    if (k === null) return null;
    korrekturen.push(k);
  }

  const tueren: Tuer[] = [];
  for (const w of roh.tueren) {
    const t = leseTuer(w);
    if (t === null) return null;
    tueren.push(t);
  }

  const anker: DekoAnker[] = [];
  for (const w of roh.anker) {
    const a = leseAnker(w);
    if (a === null) return null;
    anker.push(a);
  }

  return {
    format: LAYOUT_FORMAT,
    version: roh.version,
    id: roh.id,
    name: roh.name,
    thema: roh.thema,
    seeds: { architektur: s.architektur, material: s.material, deko: s.deko },
    raster: {
      zelleM: r.zelleM,
      ebeneM: r.ebeneM,
      hoehenSchrittM: r.hoehenSchrittM,
      blockZellen: r.blockZellen,
    },
    grenzen: {
      minX: g.minX,
      maxX: g.maxX,
      minZ: g.minZ,
      maxZ: g.maxZ,
      minEbene: g.minEbene,
      maxEbene: g.maxEbene,
    },
    eingang: { x: e.x, z: e.z, ebene: e.ebene, kante: e.kante as Kante },
    stempel,
    korrekturen,
    tueren,
    anker,
    pruefsumme: roh.pruefsumme,
  };
}

function leseDrehung(w: unknown): 0 | 1 | 2 | 3 | null {
  return w === 0 || w === 1 || w === 2 || w === 3 ? w : null;
}

function leseStempel(w: unknown): RaumStempel | null {
  if (!istObjekt(w)) return null;
  if (typeof w.typ !== 'string' || !(RAUM_TYPEN as readonly string[]).includes(w.typ)) return null;
  const drehung = leseDrehung(w.drehung);
  if (drehung === null) return null;
  const felder = [
    'id',
    'x',
    'z',
    'ebene',
    'breite',
    'tiefe',
    'hoehe',
    'bodenVersatz',
    'seed',
    'variante',
    'ordnung',
    'tiefeImBaum',
  ] as const;
  for (const f of felder) if (!istGanz(w[f])) return null;
  return {
    id: w.id as number,
    typ: w.typ as RaumTyp,
    x: w.x as number,
    z: w.z as number,
    ebene: w.ebene as number,
    breite: w.breite as number,
    tiefe: w.tiefe as number,
    hoehe: w.hoehe as number,
    bodenVersatz: w.bodenVersatz as number,
    drehung,
    seed: w.seed as number,
    variante: w.variante as number,
    ordnung: w.ordnung as number,
    tiefeImBaum: w.tiefeImBaum as number,
  };
}

function leseAenderung(w: unknown): ZellenAenderung | null {
  if (!istObjekt(w)) return null;
  const a: Record<string, number> = {};
  for (const feld of ZELL_FELDER) {
    const wert = w[feld];
    if (wert === undefined) continue;
    if (!istGanz(wert)) return null;
    a[feld] = wert;
  }
  return a as ZellenAenderung;
}

function leseKorrektur(w: unknown): ZellenKorrektur | null {
  if (!istObjekt(w)) return null;
  if (!istGanz(w.x) || !istGanz(w.z) || !istGanz(w.ebene)) return null;
  const aendere = leseAenderung(w.aendere ?? {});
  if (aendere === null) return null;
  if (w.loeschen !== undefined && typeof w.loeschen !== 'boolean') return null;
  // `loeschen: false` und ein fehlendes Feld sind dasselbe — beim Lesen
  // vereinheitlicht, damit sie nicht zwei Pruefsummen ergeben.
  // `loeschen: false` and an absent field mean the same — unified on read so
  // they cannot produce two different checksums.
  return w.loeschen === true
    ? { x: w.x, z: w.z, ebene: w.ebene, aendere, loeschen: true }
    : { x: w.x, z: w.z, ebene: w.ebene, aendere };
}

function leseTuer(w: unknown): Tuer | null {
  if (!istObjekt(w)) return null;
  if (!istGanz(w.x) || !istGanz(w.z) || !istGanz(w.ebene)) return null;
  if (!istEinzelneKante(w.kante)) return null;
  if (typeof w.art !== 'string') return null;
  if (typeof w.zustand !== 'string' || !(TUER_ZUSTAENDE as readonly string[]).includes(w.zustand)) {
    return null;
  }
  if (w.schluessel !== undefined && typeof w.schluessel !== 'string') return null;
  const t: Tuer = {
    x: w.x,
    z: w.z,
    ebene: w.ebene,
    kante: w.kante as Kante,
    art: w.art,
    zustand: w.zustand as TuerZustand,
  };
  return w.schluessel === undefined ? t : { ...t, schluessel: w.schluessel };
}

function leseAnker(w: unknown): DekoAnker | null {
  if (!istObjekt(w)) return null;
  const drehung = leseDrehung(w.drehung);
  if (drehung === null) return null;
  const felder = ['id', 'x', 'z', 'ebene', 'ort', 'u', 'v', 'h', 'seed', 'stempelId'] as const;
  for (const f of felder) if (!istGanz(w[f])) return null;
  if (typeof w.rolle !== 'string') return null;
  if (w.prefab !== undefined && typeof w.prefab !== 'string') return null;
  if (w.kante !== undefined && !istEinzelneKante(w.kante)) return null;
  const a: DekoAnker = {
    id: w.id as number,
    x: w.x as number,
    z: w.z as number,
    ebene: w.ebene as number,
    ort: w.ort as AnkerOrt,
    u: w.u as number,
    v: w.v as number,
    h: w.h as number,
    drehung,
    rolle: w.rolle,
    seed: w.seed as number,
    stempelId: w.stempelId as number,
  };
  const mitKante = w.kante === undefined ? a : { ...a, kante: w.kante as Kante };
  return w.prefab === undefined ? mitKante : { ...mitKante, prefab: w.prefab };
}

/**
 * Migration eines rohen Dokuments auf die aktuelle Version — oder `null`, wenn
 * es keins ist.
 * Migrates a raw document to the current version, or `null` if it is not one.
 *
 * Regel zur Pruefsumme: Lief KEIN Migrationsschritt, bleibt sie unangetastet
 * (das Dokument ist unveraendert, der Zeuge muss weiter stimmen). Lief
 * mindestens einer, wird sie neu gerechnet — der Inhalt hat sich berechtigt
 * geaendert, und eine alte Pruefsumme waere dann ein falscher Zeuge.
 * Checksum rule: if NO migration step ran, it is left untouched (the document
 * is unchanged and the witness must still hold). If at least one ran, it is
 * recomputed — the content legitimately changed and an old checksum would be a
 * false witness.
 */
export function migriere(roh: unknown): DungeonLayout2 | null {
  if (!istObjekt(roh)) return null;
  if (roh.format !== LAYOUT_FORMAT) return null;
  if (!istGanz(roh.version)) return null;
  if (roh.version < 1 || roh.version > LAYOUT_VERSION) return null;

  let stand: RohObjekt = roh;
  let geaendert = false;
  while ((stand.version as number) < LAYOUT_VERSION) {
    const schritt = MIGRATIONS_SCHRITTE.get(stand.version as number);
    if (schritt === undefined) return null;
    stand = schritt(stand);
    geaendert = true;
  }

  const gelesen = leseLayout(stand);
  if (gelesen === null) return null;
  return geaendert ? mitPruefsumme(gelesen) : gelesen;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Invarianten / invariants
// ─────────────────────────────────────────────────────────────────────────────

export type Schwere = 'fehler' | 'warnung' | 'hinweis';

/**
 * Stabile Kurznamen der Regeln — dieselbe Bauform wie `RasterBefund.regel`
 * heute, damit Tests und der Editor-Pruefbericht darauf filtern koennen.
 * Stable short rule names — the same shape as today's `RasterBefund.regel`, so
 * tests and the editor report can filter on them.
 *
 * Die Namen ALLER Invarianten aus ARCHITECTURE §3.7 stehen hier, auch die, die
 * erst mit dem Zellgitter pruefbar sind (AP2, `validation.ts`). Ein Regelname
 * an zwei Orten waere ein Regelname, der einmal umbenannt wird.
 * The names of ALL invariants from §3.7 live here, including those only
 * checkable with the cell grid (AP2, `validation.ts`). A rule name in two
 * places is a rule name that gets renamed in one of them.
 */
export type LayoutRegel =
  // ── auf dem Dokument pruefbar / checkable on the document ──
  | 'format'
  | 'version'
  | 'raster'
  | 'ganzzahl'
  | 'pruefsumme'
  | 'material-tag'
  | 'kante-bit'
  | 'drehung'
  | 'zellen-art'
  | 'anker-ort'
  | 'anker-feld'
  | 'anker-stempel'
  | 'tuer-feld'
  | 'tuer-kanonisch'
  | 'doppelte-id'
  | 'doppelte-korrektur'
  | 'doppelte-tuer'
  | 'stempel-groesse'
  | 'stempel-lichte'
  | 'grenzen'
  // ── erst mit dem Zellgitter pruefbar (AP2) / needs the cell grid (AP2) ──
  | 'erreichbar'
  | 'lichte-hoehe'
  | 'doppelbelegung'
  | 'ebenen-abstand'
  | 'treppe-anschluss'
  | 'tuer-im-fels'
  | 'anker-in-luft'
  | 'rueckgrat';

export interface Befund {
  /** Wo — z. B. `Stempel 7`, `Tuer 3`, `Dokument`. / Where. */
  readonly wo: string;
  readonly schwere: Schwere;
  readonly regel: LayoutRegel;
  readonly text: string;
}

/**
 * Prueft alle Invarianten aus ARCHITECTURE §3.7, die OHNE das ausgerollte
 * Zellgitter entscheidbar sind.
 * Checks every invariant from §3.7 that is decidable WITHOUT the rolled-out
 * cell grid.
 *
 * Die uebrigen (Erreichbarkeit, lichte Hoehe je Zelle, Doppelbelegung,
 * Ebenenabstand, Treppenanschluss, Tuer im Fels, Anker in der Luft, Rueckgrat)
 * brauchen `zellenAufbauen()`/`wandZwischen()` aus `cells.ts` und gehoeren
 * deshalb in `validation.ts` (AP2) — dort wird diese Funktion aufgerufen und
 * ihre Befunde werden ergaenzt, nicht ersetzt.
 * The remaining ones need `zellenAufbauen()`/`wandZwischen()` from `cells.ts`
 * and therefore belong in `validation.ts` (AP2) — which calls this function and
 * appends its own findings rather than replacing them.
 */
export function validateLayout(layout: DungeonLayout2): Befund[] {
  const befunde: Befund[] = [];
  const melde = (wo: string, schwere: Schwere, regel: LayoutRegel, text: string): void => {
    befunde.push({ wo, schwere, regel, text });
  };

  /** Ganzzahlpruefung mit Meldung. / Integer check with reporting. */
  const ganz = (wo: string, feld: string, wert: unknown): boolean => {
    if (istGanz(wert)) return true;
    melde(
      wo,
      'fehler',
      'ganzzahl',
      `${feld} ist keine endliche Ganzzahl (${String(wert)}) — das Layout enthaelt keine Fliesskommazahlen`
    );
    return false;
  };

  // ── Kopf / header ──────────────────────────────────────────────────────
  if (layout.format !== LAYOUT_FORMAT) {
    melde('Dokument', 'fehler', 'format', `format ist "${String(layout.format)}"`);
  }
  if (!istGanz(layout.version) || layout.version < 1 || layout.version > LAYOUT_VERSION) {
    melde(
      'Dokument',
      'fehler',
      'version',
      `version ${String(layout.version)} liegt ausserhalb 1..${LAYOUT_VERSION}`
    );
  }

  ganz('Dokument', 'seeds.architektur', layout.seeds.architektur);
  ganz('Dokument', 'seeds.material', layout.seeds.material);
  ganz('Dokument', 'seeds.deko', layout.seeds.deko);

  // ── Raster / grid ──────────────────────────────────────────────────────
  ganz('Dokument', 'raster.zelleM', layout.raster.zelleM);
  ganz('Dokument', 'raster.ebeneM', layout.raster.ebeneM);
  ganz('Dokument', 'raster.blockZellen', layout.raster.blockZellen);
  if (typeof layout.raster.hoehenSchrittM !== 'number' || !(layout.raster.hoehenSchrittM > 0)) {
    melde('Dokument', 'fehler', 'raster', 'raster.hoehenSchrittM ist nicht positiv und endlich');
  }
  // Ein abweichendes Raster ist kein Fehler, sondern genau der Grund, warum es
  // im Dokument steht — aber es muss auffallen.
  // A deviating grid is not an error but exactly why it is stored in the
  // document — it just must not pass unnoticed.
  if (
    layout.raster.zelleM !== ZELLE_M ||
    layout.raster.ebeneM !== EBENE_M ||
    layout.raster.hoehenSchrittM !== HOEHEN_SCHRITT_M ||
    layout.raster.blockZellen !== BLOCK_ZELLEN
  ) {
    melde(
      'Dokument',
      'warnung',
      'raster',
      `Dokumentraster (${layout.raster.zelleM}/${layout.raster.ebeneM}/${layout.raster.hoehenSchrittM}/${layout.raster.blockZellen}) weicht von den Konstanten ab`
    );
  }

  // ── Grenzen / bounds ───────────────────────────────────────────────────
  const g = layout.grenzen;
  for (const [feld, wert] of [
    ['grenzen.minX', g.minX],
    ['grenzen.maxX', g.maxX],
    ['grenzen.minZ', g.minZ],
    ['grenzen.maxZ', g.maxZ],
    ['grenzen.minEbene', g.minEbene],
    ['grenzen.maxEbene', g.maxEbene],
  ] as const) {
    ganz('Dokument', feld, wert);
  }
  if (g.minX > g.maxX || g.minZ > g.maxZ || g.minEbene > g.maxEbene) {
    melde('Dokument', 'fehler', 'grenzen', 'grenzen sind leer (min > max)');
  }

  // ── Eingang / entrance ─────────────────────────────────────────────────
  const e = layout.eingang;
  ganz('Eingang', 'x', e.x);
  ganz('Eingang', 'z', e.z);
  ganz('Eingang', 'ebene', e.ebene);
  if (!istEinzelneKante(e.kante)) {
    melde('Eingang', 'fehler', 'kante-bit', `kante ${String(e.kante)} ist kein einzelnes Kantenbit`);
  }
  if (istGanz(e.x) && istGanz(e.z) && istGanz(e.ebene) && !imBereich(g, e.x, e.z, e.ebene)) {
    melde('Eingang', 'fehler', 'grenzen', 'Eingangszelle liegt ausserhalb der Grenzen');
  }

  // ── Stempel / stamps ───────────────────────────────────────────────────
  const stempelIds = new Set<number>();
  layout.stempel.forEach((s, i) => {
    const wo = `Stempel ${istGanz(s.id) ? `#${s.id}` : `[${i}]`}`;
    for (const [feld, wert] of [
      ['id', s.id],
      ['x', s.x],
      ['z', s.z],
      ['ebene', s.ebene],
      ['breite', s.breite],
      ['tiefe', s.tiefe],
      ['hoehe', s.hoehe],
      ['bodenVersatz', s.bodenVersatz],
      ['seed', s.seed],
      ['variante', s.variante],
      ['ordnung', s.ordnung],
      ['tiefeImBaum', s.tiefeImBaum],
    ] as const) {
      ganz(wo, feld, wert);
    }
    if (leseDrehung(s.drehung) === null) {
      melde(wo, 'fehler', 'drehung', `drehung ${String(s.drehung)} ist keine Vierteldrehung 0..3`);
    }
    if (!(RAUM_TYPEN as readonly string[]).includes(s.typ)) {
      melde(wo, 'fehler', 'stempel-groesse', `typ "${String(s.typ)}" ist kein bekannter Raumtyp`);
    }
    if (istGanz(s.breite) && istGanz(s.tiefe) && (s.breite < 1 || s.tiefe < 1)) {
      melde(wo, 'fehler', 'stempel-groesse', `Grundflaeche ${s.breite}x${s.tiefe} ist leer`);
    }
    if (istGanz(s.hoehe) && s.hoehe < MIN_LICHTE_STUFEN) {
      melde(
        wo,
        'fehler',
        'stempel-lichte',
        `hoehe ${s.hoehe} liegt unter MIN_LICHTE_STUFEN (${MIN_LICHTE_STUFEN})`
      );
    }
    if (istGanz(s.id)) {
      if (stempelIds.has(s.id)) {
        melde(wo, 'fehler', 'doppelte-id', `Stempel-Id ${s.id} kommt mehrfach vor`);
      }
      stempelIds.add(s.id);
    }
  });

  // ── Korrekturen / fixes ────────────────────────────────────────────────
  const korrekturPlaetze = new Set<string>();
  layout.korrekturen.forEach((k, i) => {
    const wo = `Korrektur [${i}]`;
    const gut = ganz(wo, 'x', k.x) && ganz(wo, 'z', k.z) && ganz(wo, 'ebene', k.ebene);
    const a = k.aendere ?? {};
    for (const feld of ZELL_FELDER) {
      const wert = (a as Record<string, unknown>)[feld];
      if (wert === undefined) continue;
      ganz(wo, `aendere.${feld}`, wert);
    }
    if (a.materialTag !== undefined && istGanz(a.materialTag)) {
      pruefeMaterialTag(melde, wo, a.materialTag);
    }
    if (a.art !== undefined && istGanz(a.art) && (a.art < 0 || a.art > ZELLEN_ART.Wasser)) {
      melde(wo, 'fehler', 'zellen-art', `aendere.art ${a.art} ist keine bekannte Zellenart`);
    }
    for (const feld of ['wandErzwungen', 'durchgangErzwungen'] as const) {
      const wert = a[feld];
      if (wert === undefined || !istGanz(wert)) continue;
      if (wert < 0 || wert > KANTE_ALLE) {
        melde(wo, 'fehler', 'kante-bit', `aendere.${feld} ${wert} liegt ausserhalb 0..${KANTE_ALLE}`);
      }
    }
    if (a.neigung !== undefined && !istEinzelneKante(a.neigung)) {
      melde(wo, 'fehler', 'kante-bit', `aendere.neigung ${String(a.neigung)} ist kein Kantenbit`);
    }
    if (a.stempelId !== undefined && istGanz(a.stempelId)) {
      pruefeStempelBezug(melde, wo, 'aendere.stempelId', a.stempelId, stempelIds);
    }
    if (!gut) return;
    // Zwei Korrekturen auf derselben Zelle sind reihenfolgeabhaengig — genau
    // die Sorte stiller Mehrdeutigkeit, die der Ganzzahl-Grundsatz austreiben
    // soll.
    // Two fixes on the same cell are order dependent — exactly the kind of
    // silent ambiguity the integer principle is meant to remove.
    const schluessel = `${k.ebene}|${k.z}|${k.x}`;
    if (korrekturPlaetze.has(schluessel)) {
      melde(
        wo,
        'fehler',
        'doppelte-korrektur',
        `Zelle (${k.x},${k.z},E${k.ebene}) wird mehrfach korrigiert`
      );
    }
    korrekturPlaetze.add(schluessel);
    if (!imBereich(g, k.x, k.z, k.ebene)) {
      melde(wo, 'warnung', 'grenzen', `Zelle (${k.x},${k.z},E${k.ebene}) liegt ausserhalb der Grenzen`);
    }
  });

  // ── Tueren / doors ─────────────────────────────────────────────────────
  const tuerPlaetze = new Set<string>();
  layout.tueren.forEach((t, i) => {
    const wo = `Tuer [${i}]`;
    const gut = ganz(wo, 'x', t.x) && ganz(wo, 'z', t.z) && ganz(wo, 'ebene', t.ebene);
    if (!istEinzelneKante(t.kante)) {
      melde(wo, 'fehler', 'kante-bit', `kante ${String(t.kante)} ist kein einzelnes Kantenbit`);
    } else if (!istKanonischeKante(t.kante)) {
      melde(
        wo,
        'fehler',
        'tuer-kanonisch',
        'Tueren stehen an der Zelle mit dem kleineren (ebene,z,x) — erlaubt sind nur Nord und Ost'
      );
    }
    if (typeof t.art !== 'string' || t.art.length === 0) {
      melde(wo, 'fehler', 'tuer-feld', 'art ist leer');
    }
    if (!(TUER_ZUSTAENDE as readonly string[]).includes(t.zustand)) {
      melde(wo, 'fehler', 'tuer-feld', `zustand "${String(t.zustand)}" ist unbekannt`);
    }
    if (t.zustand === 'verschlossen' && (t.schluessel === undefined || t.schluessel.length === 0)) {
      melde(wo, 'fehler', 'tuer-feld', 'verschlossene Tuer ohne schluessel');
    }
    if (t.zustand !== 'verschlossen' && t.schluessel !== undefined) {
      melde(wo, 'warnung', 'tuer-feld', 'schluessel an einer nicht verschlossenen Tuer');
    }
    if (!gut || !istEinzelneKante(t.kante)) return;
    const schluessel = `${t.ebene}|${t.z}|${t.x}|${t.kante}`;
    if (tuerPlaetze.has(schluessel)) {
      melde(wo, 'fehler', 'doppelte-tuer', 'Auf dieser Kante steht bereits eine Tuer');
    }
    tuerPlaetze.add(schluessel);
  });

  // ── Anker / anchors ────────────────────────────────────────────────────
  const ankerIds = new Set<number>();
  layout.anker.forEach((a, i) => {
    const wo = `Anker ${istGanz(a.id) ? `#${a.id}` : `[${i}]`}`;
    for (const [feld, wert] of [
      ['id', a.id],
      ['x', a.x],
      ['z', a.z],
      ['ebene', a.ebene],
      ['ort', a.ort],
      ['u', a.u],
      ['v', a.v],
      ['h', a.h],
      ['seed', a.seed],
      ['stempelId', a.stempelId],
    ] as const) {
      ganz(wo, feld, wert);
    }
    if (leseDrehung(a.drehung) === null) {
      melde(wo, 'fehler', 'drehung', `drehung ${String(a.drehung)} ist keine Vierteldrehung 0..3`);
    }
    if (istGanz(a.ort) && (a.ort < 0 || a.ort > ANKER_ORT.Ecke)) {
      melde(wo, 'fehler', 'anker-ort', `ort ${a.ort} ist kein bekannter Ankerort`);
    }
    const brauchtKante = a.ort === ANKER_ORT.Wand || a.ort === ANKER_ORT.Ecke;
    if (brauchtKante && a.kante === undefined) {
      melde(wo, 'fehler', 'anker-feld', 'Wand-/Eckanker ohne kante');
    }
    if (a.kante !== undefined && !istEinzelneKante(a.kante)) {
      melde(wo, 'fehler', 'kante-bit', `kante ${String(a.kante)} ist kein einzelnes Kantenbit`);
    }
    for (const [feld, wert] of [
      ['u', a.u],
      ['v', a.v],
    ] as const) {
      if (istGanz(wert) && (wert < 0 || wert > 8)) {
        melde(wo, 'fehler', 'anker-feld', `${feld} ${wert} liegt ausserhalb 0..8 (Achtel einer Zelle)`);
      }
    }
    if (typeof a.rolle !== 'string' || a.rolle.length === 0) {
      melde(wo, 'fehler', 'anker-feld', 'rolle ist leer — der Anker ist ein Platz mit Aufgabe');
    }
    if (a.prefab !== undefined && (typeof a.prefab !== 'string' || a.prefab.length === 0)) {
      melde(wo, 'fehler', 'anker-feld', 'prefab ist gesetzt, aber leer');
    }
    if (istGanz(a.stempelId)) {
      pruefeStempelBezug(melde, wo, 'stempelId', a.stempelId, stempelIds);
    }
    if (istGanz(a.id)) {
      if (ankerIds.has(a.id)) {
        melde(wo, 'fehler', 'doppelte-id', `Anker-Id ${a.id} kommt mehrfach vor`);
      }
      ankerIds.add(a.id);
    }
  });

  // ── Der Zeuge / the witness ────────────────────────────────────────────
  const soll = layoutPruefsumme(layout);
  if (layout.pruefsumme !== soll) {
    melde(
      'Dokument',
      'fehler',
      'pruefsumme',
      `pruefsumme "${String(layout.pruefsumme)}" statt "${soll}"`
    );
  }

  return befunde;
}

function pruefeMaterialTag(
  melde: (wo: string, schwere: Schwere, regel: LayoutRegel, text: string) => void,
  wo: string,
  tag: number
): void {
  if (tag < 0 || tag > MAX_MATERIAL_TAG) {
    melde(
      wo,
      'fehler',
      'material-tag',
      `materialTag ${tag} liegt ausserhalb 0..${MAX_MATERIAL_TAG} — 6..9 sind Blend-Overlays, keine Zellmaterialien`
    );
  }
}

function pruefeStempelBezug(
  melde: (wo: string, schwere: Schwere, regel: LayoutRegel, text: string) => void,
  wo: string,
  feld: string,
  id: number,
  bekannt: ReadonlySet<number>
): void {
  if (id === -1) return;
  if (!bekannt.has(id)) {
    melde(wo, 'fehler', 'anker-stempel', `${feld} ${id} zeigt auf keinen vorhandenen Stempel`);
  }
}

function imBereich(
  g: DungeonLayout2['grenzen'],
  x: number,
  z: number,
  ebene: number
): boolean {
  return (
    x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ && ebene >= g.minEbene && ebene <= g.maxEbene
  );
}

/** Nur Befunde der Schwere `fehler`. / Findings of severity `fehler` only. */
export function nurFehler(befunde: readonly Befund[]): Befund[] {
  return befunde.filter((b) => b.schwere === 'fehler');
}
