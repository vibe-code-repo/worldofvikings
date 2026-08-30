/**
 * Der Geometrie-Bauer des Dungeon-Generators 2.0: aus einem Layout werden
 * deterministisch Sichtgeometrie, Kollision, Navigation und Deko-Plaetze —
 * blockweise, reihenfolgefrei, engine-neutral.
 * The geometry builder of dungeon generator 2.0: a layout deterministically
 * becomes visual geometry, collision, navigation and decor places — per block,
 * order free, engine neutral.
 *
 * Quelle: `design/ARCHITECTURE.md` §3.8 (Bauer-Vertrag, eingefroren) und
 * `design/data-model.md` §3. Dieses Modul ist rein: kein Babylon, kein DOM,
 * kein `node:`, kein `Math.random`, keine Uhr, keine Trigonometrie.
 * Source: `design/ARCHITECTURE.md` §3.8 (builder contract, frozen) and
 * `design/data-model.md` §3. This module is pure: no Babylon, no DOM, no
 * `node:`, no `Math.random`, no clock, no trigonometry.
 *
 * Die fuenf Vertragsregeln, hier als Code gelesen:
 * The five contract rules, read as code here:
 *   (1) `stuecke` und `kollision` sind zwei Listen, nie eine — beide entstehen
 *       aber aus DERSELBEN Quaderfunktion (`zellKanteZuQuader` in `cells.ts`).
 *       `stuecke` and `kollision` are two lists, never one — but both come out
 *       of the SAME box function (`zellKanteZuQuader` in `cells.ts`).
 *   (2) Der Bauer zieht nicht, er hasht (`hashPos`) — deshalb ist jeder Block
 *       einzeln und in beliebiger Reihenfolge baubar.
 *       The builder does not draw, it hashes (`hashPos`) — that is why every
 *       block can be built on its own and in any order.
 *   (3) Meter durch Multiplikation, nie durch Addition: alles wird in ganzen
 *       Zellachteln und Hoehenstufen gerechnet und genau einmal multipliziert.
 *       Metres by multiplication, never by accumulation: everything is computed
 *       in whole cell eighths and height steps and multiplied exactly once.
 *   (4) Bloecke sind die Einheit von allem Weiteren (8x8 Zellen einer Ebene).
 *       Blocks are the unit of everything downstream (8x8 cells of one storey).
 *   (5) Der Bauer kennt keine Grafikstufe. Er liefert immer alles; was auf
 *       Niedrig entfaellt, entscheidet der Client-Adapter ueber `art`.
 *       The builder knows no graphics tier. It always delivers everything; what
 *       is dropped on Low is the client adapter's decision, via `art`.
 */

import type { Vector3 } from '../types.js';
import {
  BLOCK_ZELLEN,
  HOEHEN_SCHRITT_M,
  KANTE,
  KANTEN,
  ZELLE_M,
  ZELLEN_ART,
  fnv1a32,
  gegenKante,
  kanonisiereKante,
  nachbarZelle,
  type DekoAnker,
  type DungeonLayout2,
  type Kante,
  type Tuer,
  type Zelle,
} from './layout.js';
import {
  ACHTEL_M,
  BODEN_DICKE_STUFEN,
  DECKE_DICKE_STUFEN,
  WAND_DICKE_ACHTEL,
  ZELL_ACHTEL,
  bodenStufen,
  hatBodenPlatte,
  hatDeckenPlatte,
  kantenDrehung,
  kantenStreifen,
  kantenStreifenHaelfte,
  obenStufen,
  offen,
  quaderInMeter,
  saeuleOben,
  zelleImGitter,
  zellenAufbauen,
  zellenSortiert,
  zellKanteZuQuaderGanz,
  type AufbauOptionen,
  type GanzQuader,
  type Quader,
  type ZellenGitter,
} from './cells.js';
import { hashPos, mische } from './hashing.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Der eingefrorene Vertrag / the frozen contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Block: 8x8 Zellen EINER Ebene, also 32 m Kante (ARCHITECTURE W3).
 * Bloecke sind gleich gross und gitterausgerichtet — anders als Raeume, die
 * sich ueberlappen duerfen und deshalb als Chunk untauglich sind.
 * A block: 8x8 cells of ONE storey, i.e. 32 m edge length (ARCHITECTURE W3).
 * Blocks are equally sized and grid aligned — unlike rooms, which may overlap
 * and are therefore unusable as chunks.
 */
export interface BlockId {
  readonly bx: number;
  readonly bz: number;
  readonly ebene: number;
}

/**
 * Blend-Attribute je ECKE eines Quaders — acht Werte je Groesse, in der festen
 * Eckreihenfolge von `ECKEN` (Bit 0 = x-max, Bit 1 = y-max, Bit 2 = z-max).
 * `hoeheUeberBoden` treibt Moos und Schmutz, `kantenAbstand` die Feuchte
 * (ARCHITECTURE W4). Im Client wandern beide nach `uv2`; der Shader kann sie
 * nicht selbst wissen, und "Feuchte via SSAO" ist gestrichen, weil SSAO im
 * Material-Pass nicht lesbar ist.
 * Blend attributes per CORNER of a box — eight values each, in the fixed corner
 * order of `ECKEN` (bit 0 = x max, bit 1 = y max, bit 2 = z max).
 * `hoeheUeberBoden` drives moss and grime, `kantenAbstand` drives moisture
 * (ARCHITECTURE W4). In the client both go into `uv2`; the shader cannot know
 * them, and "moisture via SSAO" is cancelled because SSAO is not readable in
 * the material pass.
 */
export interface BlendAttribute {
  /** Meter ueber der Bodenoberkante der Eigentuemerzelle. / Metres above the owner cell's floor. */
  readonly hoeheUeberBoden: readonly number[];
  /** Meter zur naechsten konkaven Kante, gedeckelt. / Metres to the nearest concave edge, capped. */
  readonly kantenAbstand: readonly number[];
}

/**
 * Art eines Bauteils. Der Client-Adapter entscheidet daran, was auf Stufe
 * Niedrig entfaellt (Vertragsregel 5) — `sims` und `kante` fallen zuerst.
 * Kind of a piece. The client adapter uses it to decide what is dropped on the
 * Low tier (contract rule 5) — `sims` and `kante` go first.
 */
export type BauStueckArt =
  | 'boden'
  | 'wand'
  | 'decke'
  | 'sims'
  | 'stufe'
  | 'tuerrahmen'
  | 'saeule'
  | 'kante';

export interface BauStueck {
  readonly art: BauStueckArt;
  readonly block: BlockId;
  readonly materialTag: number;
  /** Alles in Metern, aus Ganzzahlen berechnet — nie akkumuliert addiert. */
  /** Everything in metres, computed from integers — never accumulated. */
  readonly mitte: Vector3;
  readonly groesse: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
  readonly blend: BlendAttribute;
}

export interface KollisionsKoerper {
  readonly form: 'box' | 'rampe';
  readonly mitte: Vector3;
  readonly groesse: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
  /** Nur bei 'rampe': Steigung in Hoehenstufen je Zelle. / Ramp rise only. */
  readonly steigung?: number;
}

/**
 * Eine begehbare Zelle als Navigationsknoten. `offeneKanten` ist die Bitmaske
 * der Kanten OHNE Wand, `nachOben`/`nachUnten` die senkrechten Verbindungen
 * durch Schaechte. Der Server benutzt das fuer NPC-Wegfindung und
 * Spawn-Platzpruefung (ARCHITECTURE W10) — nie fuer Optik.
 * A walkable cell as a navigation node. `offeneKanten` is the bit mask of edges
 * WITHOUT a wall, `nachOben`/`nachUnten` are the vertical links through shafts.
 * The server uses this for NPC pathfinding and spawn placement (ARCHITECTURE
 * W10) — never for looks.
 */
export interface NavZelle {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly block: BlockId;
  /** Mitte der Standflaeche in Metern. / Centre of the standing surface, metres. */
  readonly mitte: Vector3;
  /** Lichte Hoehe in Metern. / Clear headroom in metres. */
  readonly lichteHoehe: number;
  readonly offeneKanten: number;
  readonly nachOben: boolean;
  readonly nachUnten: boolean;
}

/**
 * Ein aufgeloester Deko-Anker in Metern — die Eingabe des Bestueckers und
 * spaeter der ZDO-Erzeugung. Der Bauer loest nur den PLATZ auf, nie das Prefab:
 * welches Modell die Rolle bekommt, entscheidet `bestuecker.ts`.
 * A resolved decor anchor in metres — the input of the furnisher and later of
 * ZDO creation. The builder resolves only the PLACE, never the prefab: which
 * model a role gets is decided by `bestuecker.ts`.
 */
export interface DekoPlatz {
  readonly ankerId: number;
  readonly block: BlockId;
  readonly rolle: string;
  readonly prefab?: string;
  readonly ort: number;
  readonly kante?: Kante;
  readonly position: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
  readonly seed: number;
  readonly stempelId: number;
}

export interface BauErgebnis {
  readonly stuecke: readonly BauStueck[];
  readonly kollision: readonly KollisionsKoerper[];
  readonly nav: readonly NavZelle[];
  readonly dekoPlaetze: readonly DekoPlatz[];
  /** Wo ein Spieler beim Betreten steht — ausdruecklich, nicht hergeleitet. */
  /** Where a player stands on entering — explicit, not derived. */
  readonly spawnPunkt: Vector3;
  readonly huelle: { readonly min: Vector3; readonly max: Vector3 };
  readonly pruefsumme: string;
}

/**
 * Auswahl fuer einen Teilbau. Ohne `bloecke` wird alles gebaut.
 * Selection for a partial build. Without `bloecke` everything is built.
 *
 * `gitter` und `aufbau`: Das Layout speichert STEMPEL, nicht Zellen — die
 * Zellen entstehen erst durch `zellenAufbauen()`, und deren `materialTag`
 * haengt am Thema. Wer viele Bloecke einzeln baut, reicht das einmal
 * ausgerollte Gitter herein, sonst rollt jeder Aufruf erneut aus. Das ist eine
 * reine Beschleunigung: das Ergebnis ist dasselbe.
 * `gitter` and `aufbau`: the layout stores STAMPS, not cells — the cells only
 * come into being through `zellenAufbauen()`, and their `materialTag` depends
 * on the theme. Whoever builds many blocks individually hands in the once
 * rolled-out grid, otherwise every call rolls out again. This is purely a
 * speed-up: the result is the same.
 */
export interface BauAuswahl {
  readonly bloecke?: readonly BlockId[];
  readonly gitter?: ZellenGitter;
  readonly aufbau?: AufbauOptionen;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Konstanten des Bauers / builder constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Materialkennung der senkrechten Bauteile. `Zelle.materialTag` ist laut
 * `themen.ts` das ZELLmaterial, also der Boden des Raumtyps; die W5-Tabelle
 * fuehrt Tag 0 als "Wand-Quader (Sandstein hell)" und Tag 1 als "Fels roh".
 * Regel: waagerechte Flaechen nehmen den Zelltag, senkrechte den Wandtag — mit
 * der einen Ausnahme, dass ein aus dem Fels geschlagener Raum (Zelltag 1) auch
 * Felswaende bekommt.
 * Material tag of the vertical pieces. Per `themen.ts`, `Zelle.materialTag` is
 * the CELL material, i.e. the floor of the room type; the W5 table lists tag 0
 * as "ashlar wall (light sandstone)" and tag 1 as "raw rock". Rule: horizontal
 * surfaces take the cell tag, vertical ones the wall tag — with the single
 * exception that a room hewn out of the rock (cell tag 1) also gets rock walls.
 */
const WAND_MATERIAL_TAG = 0;
const FELS_MATERIAL_TAG = 1;

/** Lichte Tuerhoehe in Hoehenstufen (6 = 3 m). / Clear door height in steps. */
const TUER_HOEHE_STUFEN = 6;
/** Breite eines Tuerpfostens in Zellachteln. / Width of a door post, eighths. */
const TUER_PFOSTEN_ACHTEL = 1;

/** Hoehe der Sims-Unterkante ueber dem Boden, in Hoehenstufen (6 = 3 m). */
/** Height of the ledge's underside above the floor, in height steps (6 = 3 m). */
const SIMS_HOEHE_STUFEN = 6;
/** Dicke des Simses in Hoehenstufen (1 = 0,5 m). / Ledge thickness, steps. */
const SIMS_DICKE_STUFEN = 1;
/** Auskragung des Simses in Zellachteln (1 = 0,5 m). / Ledge overhang, eighths. */
const SIMS_TIEFE_ACHTEL = 1;
/**
 * Mindest-Raumhoehe in Hoehenstufen, damit ein Sims gesetzt wird. Unter dieser
 * Hoehe schlaegt man sich den Kopf an — Sims-Unterkante plus Dicke plus einen
 * Schritt Luft.
 * Minimum room height in height steps for a ledge to be placed. Below that you
 * would hit your head — ledge underside plus thickness plus one step of air.
 */
const SIMS_MIN_HOEHE_STUFEN = SIMS_HOEHE_STUFEN + SIMS_DICKE_STUFEN + 1;
/**
 * Salz des Sims-Stroms und die Schwelle. `hashPos` liefert uint32; die Schwelle
 * ist ein Viertel des Wertebereichs, also rund 25 % der Wandkanten.
 * Salt of the ledge hash and its threshold. `hashPos` yields uint32; the
 * threshold is a quarter of the range, i.e. roughly 25 % of the wall edges.
 */
const SALZ_SIMS = 0x5115;
const SIMS_SCHWELLE = 0x40000000;

/**
 * Deckel des `kantenAbstand`. Weiter als zwei Meter von einer konkaven Kante
 * entfernt ist "mittendrin", und ein unbegrenzter Wert wuerde in `uv2` nur
 * Praezision verschenken.
 * Cap of `kantenAbstand`. More than two metres from a concave edge is "in the
 * middle", and an unbounded value would only waste precision in `uv2`.
 */
const KANTEN_ABSTAND_MAX_M = 2;

/**
 * Feste Eckreihenfolge eines Quaders: Bit 0 = x-max, Bit 1 = y-max,
 * Bit 2 = z-max. Sie ist Teil des Vertrags, weil `BlendAttribute` acht Werte
 * ohne eigene Koordinaten traegt — ohne feste Reihenfolge waeren sie unlesbar.
 * Fixed corner order of a box: bit 0 = x max, bit 1 = y max, bit 2 = z max. It
 * is part of the contract, because `BlendAttribute` carries eight values
 * without coordinates of their own — without a fixed order they are unreadable.
 */
export const ECKEN_ZAHL = 8;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bloecke / blocks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blockindex einer Zellkoordinate. `Math.floor` statt einer Division mit
 * Abschneiden, damit negative Zellkoordinaten (das Gitter waechst in beide
 * Richtungen) nicht auf denselben Block wie positive fallen.
 * Block index of a cell coordinate. `Math.floor` rather than truncating
 * division, so negative cell coordinates (the grid grows both ways) do not land
 * in the same block as positive ones.
 */
export function blockIndex(zellKoordinate: number): number {
  return Math.floor(zellKoordinate / BLOCK_ZELLEN);
}

/** Block einer Zellposition. / Block of a cell position. */
export function blockVonZelle(x: number, z: number, ebene: number): BlockId {
  return { bx: blockIndex(x), bz: blockIndex(z), ebene };
}

/** Schluessel eines Blocks, feste Feldreihenfolge. / Key of a block. */
export function blockSchluessel(block: BlockId): string {
  return `${block.ebene}|${block.bz}|${block.bx}`;
}

/**
 * Alle Bloecke, in denen dieser Bau etwas erzeugt, deterministisch sortiert
 * nach (ebene, bz, bx). Aus dem GITTER, nicht aus den Grenzen: leere Bloecke
 * gibt es nicht.
 * All blocks in which this build produces anything, deterministically sorted by
 * (ebene, bz, bx). From the GRID, not from the bounds: there are no empty
 * blocks.
 *
 * Es genuegt NICHT, die Bloecke der Zellen zu nehmen. Eine Wand gehoert dem
 * Block ihrer KANONISCHEN Zelle, und die kann Fels sein und ausserhalb jedes
 * bewohnten Blocks liegen: die Suedkante der Zelle (x, z = -8) kanonisiert auf
 * die Zelle (x, -9), also auf den Blockstreifen darunter. Wer diese Bloecke
 * vergisst, verliert genau die Aussenwaende am unteren/linken Blockrand — und
 * zwar still, weil der Vollbau sie hat und nur die Vereinigung sie verliert.
 * Taking the blocks of the cells is NOT enough. A wall belongs to the block of
 * its CANONICAL cell, which may be rock and lie outside every inhabited block:
 * the south edge of cell (x, z = -8) canonicalises onto cell (x, -9), i.e. onto
 * the block strip below. Whoever forgets these blocks loses exactly the outer
 * walls at the lower/left block border — silently, because the full build has
 * them and only the union loses them.
 */
export function bloeckeDesGitters(gitter: ZellenGitter): BlockId[] {
  const gesehen = new Map<string, BlockId>();
  const merke = (block: BlockId): void => {
    const schluessel = blockSchluessel(block);
    if (!gesehen.has(schluessel)) gesehen.set(schluessel, block);
  };
  for (const zelle of zellenSortiert(gitter)) {
    merke(blockVonZelle(zelle.x, zelle.z, zelle.ebene));
    for (const kante of KANTEN) {
      const k = kanonisiereKante(zelle.x, zelle.z, zelle.ebene, kante);
      merke(blockVonZelle(k.x, k.z, k.ebene));
    }
  }
  return Array.from(gesehen.values()).sort(
    (a, b) => a.ebene - b.ebene || a.bz - b.bz || a.bx - b.bx
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Blend-Attribute / blend attributes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Waagerechter Abstand einer Eckkoordinate zu allen Wandebenen der
 * Eigentuemerzelle, in Zellachteln. Wandebenen sind die Zellgrenzen, an denen
 * `zellKanteZuQuaderGanz` einen Quader liefert — die "konkaven Kanten" aus
 * ARCHITECTURE W4 sind genau die Linien, an denen eine solche Wand auf den
 * Boden oder die Decke trifft.
 * Horizontal distance of a corner coordinate to all wall planes of the owner
 * cell, in cell eighths. Wall planes are the cell borders where
 * `zellKanteZuQuaderGanz` yields a box — the "concave edges" from ARCHITECTURE
 * W4 are exactly the lines where such a wall meets the floor or the ceiling.
 */
function wandEbenen(gitter: ZellenGitter, zelle: Zelle): { achseX: number[]; achseZ: number[] } {
  const achseX: number[] = [];
  const achseZ: number[] = [];
  for (const kante of KANTEN) {
    if (zellKanteZuQuaderGanz(gitter, zelle, kante) === null) continue;
    const streifen = kantenStreifen(zelle.x, zelle.z, kante);
    if (kante === KANTE.Ost || kante === KANTE.West) {
      achseX.push((streifen.xa0 + streifen.xa1) / 2);
    } else {
      achseZ.push((streifen.za0 + streifen.za1) / 2);
    }
  }
  return { achseX, achseZ };
}

/**
 * Blend-Attribute eines Quaders gegen seine Eigentuemerzelle. Rein rechnerisch,
 * ohne Ziehung und ohne Nachbarschaftssuche ueber die Zelle hinaus — deshalb
 * blockweise stabil.
 * Blend attributes of a box against its owner cell. Purely arithmetic, without
 * a draw and without neighbourhood search beyond the cell — hence stable per
 * block.
 */
function blendFuer(gitter: ZellenGitter, zelle: Zelle, q: GanzQuader): BlendAttribute {
  const bodenOben = bodenStufen(zelle);
  const deckeUnten = obenStufen(gitter, zelle);
  const ebenen = wandEbenen(gitter, zelle);

  const hoeheUeberBoden: number[] = [];
  const kantenAbstand: number[] = [];
  for (let ecke = 0; ecke < ECKEN_ZAHL; ecke++) {
    const xa = (ecke & 1) === 0 ? q.xa0 : q.xa1;
    const ys = (ecke & 2) === 0 ? q.ys0 : q.ys1;
    const za = (ecke & 4) === 0 ? q.za0 : q.za1;

    hoeheUeberBoden.push((ys - bodenOben) * HOEHEN_SCHRITT_M);

    let naechste = KANTEN_ABSTAND_MAX_M;
    const zumBoden = Math.abs(ys - bodenOben) * HOEHEN_SCHRITT_M;
    if (zumBoden < naechste) naechste = zumBoden;
    const zurDecke = Math.abs(deckeUnten - ys) * HOEHEN_SCHRITT_M;
    if (zurDecke < naechste) naechste = zurDecke;
    for (const ebene of ebenen.achseX) {
      const d = Math.abs(xa - ebene) * ACHTEL_M;
      if (d < naechste) naechste = d;
    }
    for (const ebene of ebenen.achseZ) {
      const d = Math.abs(za - ebene) * ACHTEL_M;
      if (d < naechste) naechste = d;
    }
    kantenAbstand.push(naechste);
  }
  return { hoeheUeberBoden, kantenAbstand };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Bauteile erzeugen / emitting pieces
// ─────────────────────────────────────────────────────────────────────────────

/** Materialkennung eines Bauteils. / Material tag of a piece. */
function materialFuer(art: BauStueckArt, zelle: Zelle): number {
  if (art === 'boden' || art === 'stufe') return zelle.materialTag;
  return zelle.materialTag === FELS_MATERIAL_TAG ? FELS_MATERIAL_TAG : WAND_MATERIAL_TAG;
}

/** Sammelbecken eines Bauvorgangs. / Accumulator of one build run. */
interface Sammler {
  readonly stuecke: BauStueck[];
  readonly kollision: KollisionsKoerper[];
}

/**
 * Traegt einen Quader als Sichtgeometrie ein — und, wenn `fest`, denselben
 * Quader zusaetzlich als Kollisionskoerper. DERSELBE `Quader`, nicht eine
 * zweite Rechnung: das ist Vertragsregel 1 in einer Zeile.
 * Records a box as visual geometry — and, if `fest`, the same box additionally
 * as a collision body. THE SAME `Quader`, not a second calculation: that is
 * contract rule 1 in one line.
 */
function trage(
  sammler: Sammler,
  gitter: ZellenGitter,
  zelle: Zelle,
  block: BlockId,
  art: BauStueckArt,
  q: GanzQuader,
  fest: boolean
): void {
  if (q.xa1 <= q.xa0 || q.ys1 <= q.ys0 || q.za1 <= q.za0) return;
  const quader: Quader = quaderInMeter(q);
  sammler.stuecke.push({
    art,
    block,
    materialTag: materialFuer(art, zelle),
    mitte: quader.mitte,
    groesse: quader.groesse,
    drehung: quader.drehung,
    blend: blendFuer(gitter, zelle, q),
  });
  if (fest) {
    sammler.kollision.push({
      form: 'box',
      mitte: quader.mitte,
      groesse: quader.groesse,
      drehung: quader.drehung,
    });
  }
}

/** Ganzzahliger Fussabdruck einer ganzen Zelle. / Integer footprint of a cell. */
function zellFussabdruck(zelle: Zelle): { xa0: number; xa1: number; za0: number; za1: number } {
  const xa = zelle.x * ZELL_ACHTEL;
  const za = zelle.z * ZELL_ACHTEL;
  return { xa0: xa, xa1: xa + ZELL_ACHTEL, za0: za, za1: za + ZELL_ACHTEL };
}

/**
 * Boden, Decke und (bei `Treppe`) Stufen einer Zelle. Ein `Schacht` ueber einer
 * begehbaren Zelle bekommt keine Bodenplatte und die Zelle darunter keine
 * Decke — das ist die senkrechte Oeffnung, und `obenStufen()` zieht die
 * Wandsaeule darunter bis an den Schachtboden hoch, damit kein Ring offen
 * bleibt.
 * Floor, ceiling and (for `Treppe`) steps of a cell. A `Schacht` above a
 * walkable cell gets no floor slab and the cell below no ceiling — that is the
 * vertical opening, and `obenStufen()` pulls the wall column below up to the
 * shaft floor so that no ring stays open.
 */
function baueZelle(sammler: Sammler, gitter: ZellenGitter, zelle: Zelle): void {
  if (!offen(zelle.art)) return;
  const block = blockVonZelle(zelle.x, zelle.z, zelle.ebene);
  const fuss = zellFussabdruck(zelle);
  const unten = bodenStufen(zelle);
  const oben = obenStufen(gitter, zelle);

  if (hatBodenPlatte(gitter, zelle)) {
    if (zelle.art === ZELLEN_ART.Treppe) {
      baueStufen(sammler, gitter, zelle, block, fuss, unten);
    } else {
      trage(
        sammler,
        gitter,
        zelle,
        block,
        'boden',
        { ...fuss, ys0: unten - BODEN_DICKE_STUFEN, ys1: unten, drehung: 0 },
        true
      );
    }
  }

  if (hatDeckenPlatte(gitter, zelle)) {
    trage(
      sammler,
      gitter,
      zelle,
      block,
      'decke',
      { ...fuss, ys0: oben, ys1: deckenOberkante(gitter, zelle, oben), drehung: 0 },
      true
    );
  }
}

/**
 * Oberkante der Deckenplatte in Hoehenstufen. Normalerweise
 * `oben + DECKE_DICKE_STUFEN` — aber nie hoeher als die UNTERKANTE der
 * Bodenplatte des Stockwerks darueber.
 *
 * Ohne den Deckel liegen die beiden Platten im buendigen Fall (Deckenoberkante
 * = Bodenoberkante oben) im selben Raumteil, und ihre Oberseiten fallen in eine
 * Ebene. Der Spieler im oberen Raum sieht dann zwei Flaechen um dieselben Pixel
 * streiten: die dunkle Bodenplatte seines Raums und die Deckenplatte des Raums
 * darunter, die nach `materialFuer()` den WAND-Tag traegt — das gemeldete
 * "helles Mauerwerk flackert durch den Boden". Wird der Deckel bindend, faellt
 * die Deckenplatte ganz weg (`trage()` verwirft entartete Quader): dicht bleibt
 * es, weil die Bodenplatte darueber genau denselben Zellfussabdruck hat, und
 * von unten sieht man dann ihre Unterseite statt einer zweiten Platte.
 * Top of the ceiling slab in height steps. Normally
 * `oben + DECKE_DICKE_STUFEN` — but never higher than the UNDERSIDE of the
 * floor slab of the storey above. Without that cap the two slabs occupy the
 * same space in the flush case and their top faces fall into one plane; the
 * player in the upper room then sees two surfaces fight over the same pixels —
 * the reported "light masonry flickering through the floor". If the cap binds,
 * the ceiling slab drops out entirely (`trage()` discards degenerate boxes): it
 * stays sealed because the floor slab above has exactly the same cell
 * footprint, and from below one then sees its underside instead of a second
 * slab.
 */
function deckenOberkante(gitter: ZellenGitter, zelle: Zelle, oben: number): number {
  const voll = oben + DECKE_DICKE_STUFEN;
  const drueber = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
  if (drueber === undefined || !offen(drueber.art) || !hatBodenPlatte(gitter, drueber)) return voll;
  const sohle = bodenStufen(drueber) - BODEN_DICKE_STUFEN;
  return sohle < voll ? sohle : voll;
}

/**
 * Treppenzelle: acht Stufenquader entlang der Neigungsachse, dazu EIN
 * Rampenkoerper als Kollision. Die Optik ist gestuft, die Kollision glatt —
 * genau die Trennung aus Vertragsregel 1: eine feinere Treppe darf spaeter das
 * Bild aendern, nie das Laufgefuehl.
 * Stair cell: eight step boxes along the ascent axis, plus ONE ramp body as
 * collision. The visuals are stepped, the collision smooth — exactly the split
 * from contract rule 1: a finer staircase may later change the picture, never
 * the way it walks.
 *
 * Der Anstieg wird an der Nachbarzelle in Neigungsrichtung GEMESSEN, nicht
 * angenommen: `Zelle.boden` ist laut Format die Hoehe an der Kante mit dem
 * kleineren Index, das Ziel steht in der Nachbarzelle.
 * The rise is MEASURED at the neighbour cell in the ascent direction, not
 * assumed: per the format, `Zelle.boden` is the height at the lower-index edge,
 * and the target sits in the neighbour cell.
 */
/**
 * Anstieg einer Treppenzelle in Hoehenstufen, GEMESSEN statt angenommen.
 * Gemessen wird am oberen Ende des Laufs, und das kann zweierlei sein:
 *
 *   (1) die Nachbarzelle in Neigungsrichtung auf DERSELBEN Ebene — der Fall
 *       „Hoehensprung innerhalb eines Stockwerks";
 *   (2) die Schachtmuendung DIREKT UEBER dieser Zelle — der Fall „letzter Lauf
 *       eines Aufgangs". Der Lauf tritt dann nicht seitlich aus, sondern nach
 *       oben in die Muendung, deren Sohle die Oberkante der letzten Stufe ist.
 *
 * Ohne (2) misst der oberste Lauf eines Aufgangs einen Anstieg von 0 und baut
 * acht gleich hohe Quader — also einen flachen Boden. Der Fehler hat keine
 * Zaehlung gegen sich: es entstehen genau so viele Stufenstuecke wie sonst.
 * Rise of a stair cell in height steps, MEASURED instead of assumed. Measured
 * at the run's upper end, which can be two things: (1) the neighbour cell in
 * the ascent direction on the SAME storey — "height jump within a storey"; or
 * (2) the shaft mouth DIRECTLY ABOVE this cell — "last run of a staircase",
 * where the run emerges upwards and the mouth's sole is the top of the last
 * step. Without (2) the topmost run measures a rise of 0 and builds eight boxes
 * of equal height — a flat floor. The fault has no count against it: exactly as
 * many step pieces are produced as otherwise.
 */
function anstiegStufen(gitter: ZellenGitter, zelle: Zelle, neigung: Kante): number {
  const unten = bodenStufen(zelle);
  const p = nachbarZelle(zelle.x, zelle.z, neigung);
  const seitlich = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
  if (seitlich !== undefined && offen(seitlich.art)) {
    const anstieg = bodenStufen(seitlich) - unten;
    if (anstieg > 0) return anstieg;
  }
  const muendung = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
  if (muendung !== undefined && muendung.art === ZELLEN_ART.Schacht) {
    const anstieg = bodenStufen(muendung) - unten;
    if (anstieg > 0) return anstieg;
  }
  return 0;
}

/**
 * Unterkante der SICHTBAREN Stufenquader in Hoehenstufen. Eine Treppe steht auf
 * einem massiven Unterbau, sie schwebt nicht: liegt die Zelle am tiefen Ende
 * des Laufs hoeher als ihre Nachbarin (zweiter Lauf eines Aufgangs), reichen
 * die Quader bis zu deren Bodenunterkante hinunter.
 *
 * Der Grund ist nicht Schoenheit, sondern Dichtheit: zwischen zwei Laeufen
 * steht KEINE Wand (der Generator erzwingt dort einen Durchgang, sonst mauerte
 * die Hoehenregel §3.3 die Treppe in ihrer Mitte zu). Ohne Unterbau blickte man
 * an dieser Kante unter den oberen Lauf ins Nichts — ein Leck, das
 * `dungeon2-builder.ts` (B2) als offene Zellkante meldet.
 *
 * Der RAMPENKOERPER bleibt davon unberuehrt: sein `ys0` ist
 * `unten - BODEN_DICKE_STUFEN`, und `client/src/engine/DungeonBuilder.ts`
 * (`kollisionsForm`) rechnet die Laufflaeche genau daraus zurueck.
 * Underside of the VISIBLE step boxes in height steps. A staircase stands on
 * solid substructure, it does not float: if the cell sits higher at the run's
 * low end than its neighbour (second run of an ascent), the boxes reach down to
 * that neighbour's floor underside. The reason is not beauty but tightness:
 * there is NO wall between two runs (the generator forces an opening there,
 * otherwise the height rule §3.3 would seal the stair in its middle). Without
 * the substructure one would look under the upper run into nothing — a leak
 * that `dungeon2-builder.ts` (B2) reports as an open cell edge. The RAMP body
 * is untouched: its `ys0` stays `unten - BODEN_DICKE_STUFEN`, and
 * `kollisionsForm` in the client recovers the tread from exactly that.
 */
function sockelStufen(
  gitter: ZellenGitter,
  zelle: Zelle,
  neigung: Kante,
  unten: number
): number {
  const p = nachbarZelle(zelle.x, zelle.z, gegenKante(neigung));
  const tief = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
  const nachbarUnten =
    tief !== undefined && offen(tief.art) ? bodenStufen(tief) : unten;
  return (nachbarUnten < unten ? nachbarUnten : unten) - BODEN_DICKE_STUFEN;
}

function baueStufen(
  sammler: Sammler,
  gitter: ZellenGitter,
  zelle: Zelle,
  block: BlockId,
  fuss: { xa0: number; xa1: number; za0: number; za1: number },
  unten: number
): void {
  const neigung: Kante = zelle.neigung ?? KANTE.Nord;
  const anstieg = anstiegStufen(gitter, zelle, neigung);
  const sockel = sockelStufen(gitter, zelle, neigung, unten);

  const anZahl = ZELL_ACHTEL;
  const laengsX = neigung === KANTE.Ost || neigung === KANTE.West;
  // Die Trittflaechen werden NICHT auf die lichte Breite gestutzt, obwohl sie
  // eine halbe Wanddicke in die flankierende Wand ragen und dort koplanare
  // Deck- und Stirnflaechen erzeugen.
  //
  // Grund, gemessen: unter dem OBEREN Lauf eines Treppenhauses sind die
  // Stufenquader der Unterbau (`sockelStufen` zieht sie bis zur Bodenunterkante
  // der tieferen Nachbarin hinab), die flankierende Wand beginnt aber erst an
  // der Bodenoberkante IHRER Zelle — also vier Meter hoeher. Ein Beschnitt
  // schnitt dort eine handbreite Spalte auf, durch die man vom unteren Lauf aus
  // unter den oberen sah. Der Wandflucht-Waechter (G) haelt fest, dass die
  // Stufen nur in der eigenen Treppenzelle stehen; die paar koplanaren
  // Eckflaechen bleiben im dokumentierten Rest von (F).
  // The treads are NOT trimmed to the clear width, although they reach half a
  // wall thickness into the flanking wall and produce coplanar top and end faces
  // there. Reason, measured: beneath the UPPER run of a staircase the step boxes
  // ARE the substructure (`sockelStufen` pulls them down to the lower
  // neighbour's floor underside), while the flanking wall only starts at the
  // floor top of ITS cell — four metres higher. Trimming tore open a slit there
  // through which one saw under the upper run from the lower one.
  for (let i = 0; i < anZahl; i++) {
    // Fortschritt entlang der Neigung: Schritt i liegt bei i..i+1 Achteln,
    // gezaehlt von der TIEFEN Seite aus.
    // Progress along the ascent: step i covers eighths i..i+1, counted from the
    // LOW side.
    const vorwaerts = neigung === KANTE.Nord || neigung === KANTE.Ost;
    const a0 = vorwaerts ? i : anZahl - 1 - i;
    const stufenOben = unten + Math.round((anstieg * (i + 1)) / anZahl);
    const teil = laengsX
      ? { xa0: fuss.xa0 + a0, xa1: fuss.xa0 + a0 + 1, za0: fuss.za0, za1: fuss.za1 }
      : { xa0: fuss.xa0, xa1: fuss.xa1, za0: fuss.za0 + a0, za1: fuss.za0 + a0 + 1 };
    trage(
      sammler,
      gitter,
      zelle,
      block,
      'stufe',
      { ...teil, ys0: sockel, ys1: stufenOben, drehung: kantenDrehung(neigung) },
      false
    );
  }

  const rampe = quaderInMeter({
    ...fuss,
    ys0: unten - BODEN_DICKE_STUFEN,
    ys1: unten + (anstieg > 0 ? anstieg : 0),
    drehung: kantenDrehung(neigung),
  });
  sammler.kollision.push({
    form: 'rampe',
    mitte: rampe.mitte,
    groesse: rampe.groesse,
    drehung: rampe.drehung,
    steigung: anstieg,
  });
}

/**
 * Simse an den Waenden einer Zelle — die einzige Stelle, an der der Bauer
 * variiert, und er ZIEHT nicht, er HASHT (Vertragsregel 2, ARCHITECTURE W8).
 * Ein Sims ist reine Optik: er bekommt KEINEN Kollisionskoerper, weil der
 * Adapter ihn auf Stufe Niedrig weglassen darf — waere er fest, haenge das
 * Laufgefuehl an der Grafikstufe (Vertragsregel 5).
 * Ledges on a cell's walls — the only place where the builder varies, and it
 * does not DRAW, it HASHES (contract rule 2, ARCHITECTURE W8). A ledge is pure
 * visuals: it gets NO collision body, because the adapter may drop it on the
 * Low tier — were it solid, the way it walks would depend on the graphics tier
 * (contract rule 5).
 */
/**
 * Traegt diese Kante der Zelle einen Sims? Genau dann, wenn dort eine Wand
 * steht und der Ortshash unter der Schwelle liegt. Als eigene Funktion, weil
 * ein Sims auch die Frage nach dem Sims der QUERKANTE beantworten koennen muss
 * (Eckregel unten) — und weil zwei Ableitungen derselben Bedingung frueher oder
 * spaeter auseinanderlaufen.
 * Does this edge of the cell carry a ledge? Exactly when a wall stands there
 * and the position hash is below the threshold. Its own function, because a
 * ledge must also be able to answer the question for the PERPENDICULAR edge
 * (corner rule below) — and because two derivations of one condition drift
 * apart sooner or later.
 */
function hatSims(gitter: ZellenGitter, zelle: Zelle, kante: Kante, seedSims: number): boolean {
  if (zellKanteZuQuaderGanz(gitter, zelle, kante) === null) return false;
  return hashPos(zelle.x, zelle.z, zelle.ebene, mische(seedSims, kante)) < SIMS_SCHWELLE;
}

/**
 * Einzug eines Sims-Endes in Zellachteln an der QUERKANTE `quer`:
 *
 *   0 — dort steht keine Wand, der Sims laeuft bis an die Zellgrenze und stoesst
 *       stumpf an den Sims der Nachbarzelle (Flaechen Ruecken an Ruecken);
 *   1 — dort steht eine Wand: um genau ihre halbe Dicke, sonst steckte das
 *       Sims-Ende IN der Wand und seine Stirnflaeche laege in derselben Ebene
 *       wie die Wandflaeche;
 *   2 — dort steht eine Wand UND ein Sims, und dieser Sims muss ihm weichen:
 *       zusaetzlich um die Auskragung, sonst belegen beide dasselbe Eckstueck
 *       und ihre Deck- und Bodenflaechen streiten um dieselben Pixel.
 *
 * Weichen muessen die Simse entlang X (Nord/Sued) — eine feste, willkuerfreie
 * Vorfahrt. Wichen beide, bliebe im Eck ein Loch; wiche keiner, bliebe das
 * Z-Fighting. Ohne Vorfahrt entschiede die Reihenfolge, und die darf nie
 * entscheiden (Determinismus-Gesetz).
 * Inset of a ledge end in cell eighths at the PERPENDICULAR edge: 0 — no wall
 * there, the ledge runs to the cell border and butts against the neighbour's
 * ledge back to back; 1 — a wall stands there, by exactly its half thickness,
 * otherwise the ledge end is stuck INSIDE the wall and its end face lies in the
 * same plane as the wall face; 2 — a wall AND a ledge stand there and this
 * ledge must yield: additionally by the overhang, otherwise both occupy the
 * same corner block and their top and bottom faces fight over the same pixels.
 * The ledges along X (north/south) are the ones that yield — a fixed,
 * arbitrariness-free right of way. If both yielded, a hole would remain in the
 * corner; if neither did, the z-fighting would remain. Without a right of way
 * the order would decide, and order must never decide (determinism law).
 */
function simsEinzug(
  gitter: ZellenGitter,
  zelle: Zelle,
  quer: Kante,
  seedSims: number,
  weicht: boolean
): number {
  if (zellKanteZuQuaderGanz(gitter, zelle, quer) === null) return 0;
  const wand = WAND_DICKE_ACHTEL / 2;
  if (!weicht || !hatSims(gitter, zelle, quer, seedSims)) return wand;
  return wand + SIMS_TIEFE_ACHTEL;
}

function baueSimse(sammler: Sammler, gitter: ZellenGitter, zelle: Zelle, seedSims: number): void {
  if (!offen(zelle.art)) return;
  // In einer Treppenzelle IST der Boden gestuft; ein Sims auf halber Hoehe
  // schneidet dort in die Stufenquader und liefert waagerechte Flaechen in
  // deren Ebene. Ein Wandbrett im Treppenhaus ist ohnehin keine Architektur.
  // In a stair cell the floor ITSELF is stepped; a ledge at mid height cuts
  // into the step boxes there and yields horizontal faces in their plane. A
  // wall board inside a staircase is not architecture anyway.
  if (zelle.art === ZELLEN_ART.Treppe) return;
  const unten = bodenStufen(zelle);
  const oben = obenStufen(gitter, zelle);
  if (oben - unten < SIMS_MIN_HOEHE_STUFEN) return;

  const block = blockVonZelle(zelle.x, zelle.z, zelle.ebene);
  const ys0 = unten + SIMS_HOEHE_STUFEN;
  const ys1 = ys0 + SIMS_DICKE_STUFEN;
  for (const kante of KANTEN) {
    if (!hatSims(gitter, zelle, kante, seedSims)) continue;
    const streifen = kantenStreifen(zelle.x, zelle.z, kante);
    const laengsX = kante === KANTE.Nord || kante === KANTE.Sued;
    const weicht = laengsX;
    const a = simsEinzug(gitter, zelle, laengsX ? KANTE.West : KANTE.Sued, seedSims, weicht);
    const b = simsEinzug(gitter, zelle, laengsX ? KANTE.Ost : KANTE.Nord, seedSims, weicht);
    const laengs = laengsX
      ? { xa0: streifen.xa0 + a, xa1: streifen.xa1 - b, za0: streifen.za0, za1: streifen.za1 }
      : { xa0: streifen.xa0, xa1: streifen.xa1, za0: streifen.za0 + a, za1: streifen.za1 - b };
    const innen =
      kante === KANTE.Nord
        ? { ...laengs, za0: streifen.za0 - SIMS_TIEFE_ACHTEL, za1: streifen.za0 }
        : kante === KANTE.Sued
          ? { ...laengs, za0: streifen.za1, za1: streifen.za1 + SIMS_TIEFE_ACHTEL }
          : kante === KANTE.Ost
            ? { ...laengs, xa0: streifen.xa0 - SIMS_TIEFE_ACHTEL, xa1: streifen.xa0 }
            : { ...laengs, xa0: streifen.xa1, xa1: streifen.xa1 + SIMS_TIEFE_ACHTEL };
    trage(sammler, gitter, zelle, block, 'sims', { ...innen, ys0, ys1, drehung: kantenDrehung(kante) }, false);
  }
}

/**
 * Die Bauteile EINER kanonischen Kante: Wand, oder Tuerrahmen, oder Sturz.
 * Eigentuemer ist immer die kanonische Zelle (die mit kleinerem (ebene,z,x)) —
 * so gehoert jede Kante genau einem Block, egal von welcher Seite man sie
 * ansieht. Das ist die Voraussetzung fuer die blockweise Gleichheit.
 * The pieces of ONE canonical edge: wall, or door frame, or header. The owner
 * is always the canonical cell (the one with the smaller (ebene,z,x)) — so
 * every edge belongs to exactly one block, no matter which side you look from.
 * That is the precondition for block-wise equality.
 */
function baueKante(
  sammler: Sammler,
  gitter: ZellenGitter,
  a: Zelle,
  kante: Kante,
  block: BlockId,
  tuerAnKante: ReadonlyMap<string, Tuer>
): void {
  const p = nachbarZelle(a.x, a.z, kante);
  const b = zelleImGitter(gitter, p.x, p.z, a.ebene);
  const aOffen = offen(a.art);
  const bOffen = b !== undefined && offen(b.art);
  if (!aOffen && !bOffen) return;

  // Die Eigentuemerzelle fuer Material und Blend: die begehbare Seite, bei
  // zwei begehbaren die kanonische. Nie `stempelId` (ARCHITECTURE W1).
  // The owner cell for material and blend: the walkable side, the canonical one
  // when both are walkable. Never `stempelId` (ARCHITECTURE W1).
  const eigner = aOffen ? a : b!;

  const wand = zellKanteZuQuaderGanz(gitter, a, kante);
  if (wand !== null) {
    trage(sammler, gitter, eigner, block, 'wand', wand, true);
    return;
  }
  if (!aOffen || !bOffen || b === undefined) return;

  // Offene Kante: oben muss trotzdem zu sein. Unterschiedliche Deckenhoehen
  // lassen sonst einen senkrechten Spalt stehen, durch den man in den Fels
  // sieht — der klassische Leak.
  // Open edge: the top must still be closed. Differing ceiling heights would
  // otherwise leave a vertical slit through which one sees into the rock — the
  // classic leak.
  const streifen = kantenStreifen(a.x, a.z, kante);
  const tuer = tuerAnKante.get(kantenSchluessel(a.x, a.z, a.ebene, kante));
  // Bau-Saeulen (mit Platten) fuer die Frage "wo endet die Deckenplatte",
  // LICHTE Saeulen fuer die Frage "wie weit sieht jemand hindurch".
  // Structural columns (with slabs) for "where does the ceiling slab end",
  // CLEAR columns for "how far can anyone see through".
  const saeuleA = saeuleOben(gitter, a);
  const saeuleB = saeuleOben(gitter, b);
  const lichtMax = Math.max(obenStufen(gitter, a), obenStufen(gitter, b));
  const lichtMin = Math.min(obenStufen(gitter, a), obenStufen(gitter, b));
  const laengsX = kante === KANTE.Nord || kante === KANTE.Sued;

  // Einzug eines Stueck-ENDES an der Querkante `quer`, in Zellachteln. Steht
  // dort eine Wand (oder, bei den Stuecken, die weichen muessen, ein
  // Tuerrahmen), so ragt sie eine halbe Wanddicke in die Zelle: ein Stueck, das
  // bis an die Zellgrenze laeuft, steckt genau so tief in ihr, und seine
  // Stirnflaeche liegt in derselben Ebene wie ihre. Vorfahrt hat die Kante
  // entlang Z (Ost/West) — dieselbe willkuerfreie Regel wie beim Sims, damit im
  // Eck weder ein Loch noch eine doppelte Flaeche bleibt.
  // Inset of a piece END at the perpendicular edge `quer`, in cell eighths. If a
  // wall stands there (or, for the pieces that must yield, a door frame), it
  // reaches half a wall thickness into the cell: a piece running to the cell
  // border is sunk exactly that deep into it, and its end face lies in the same
  // plane as the wall's. Right of way belongs to the edge along Z (east/west) —
  // the same arbitrariness-free rule as for the ledge, so that neither a hole
  // nor a doubled face remains in the corner.
  //
  // ZWEI Faelle, und der Unterschied ist der zwischen huebsch und dicht:
  //
  //   `einzugZier` — fuer Stuecke, die NICHTS dichten (die Tuerpfosten). Hier
  //     genuegt eine Querwand auf EINER der beiden Seiten: was in ihr steckt,
  //     bekommt keine Flaeche, und was dabei auf der anderen Seite wegfaellt,
  //     hat nie etwas verschlossen.
  //   `einzugDicht` — fuer Stuecke, die einen Schlitz schliessen (den Sturz).
  //     Hier muessen BEIDE Seiten eine Querwand haben, sonst nimmt man dem
  //     Sturz auf der wandlosen Seite ein Stueck weg, das dort niemand ersetzt.
  //     Genau so entstand beim ersten Anlauf ein schwarzer Spalt neben der
  //     Laibung — im Bild sofort zu sehen, in keiner Zaehlung.
  // TWO cases, and the difference is the one between pretty and sealed:
  // `einzugZier` for pieces that seal NOTHING (the door posts) — a perpendicular
  // wall on EITHER side suffices. `einzugDicht` for pieces that close a slit
  // (the header) — BOTH sides must have one, otherwise the header loses a piece
  // on the wall-less side that nobody replaces. That is exactly how a black slit
  // appeared beside the reveal on the first attempt — obvious in the picture, in
  // no count.
  const querWand = (zelle: Zelle, quer: Kante): boolean =>
    zellKanteZuQuaderGanz(gitter, zelle, quer) !== null;
  const einzugZier = (quer: Kante): number => {
    const halb = WAND_DICKE_ACHTEL / 2;
    if (querWand(a, quer) || querWand(b, quer)) return halb;
    if (!laengsX) return 0;
    const tuerDort =
      tuerAnKante.has(kantenSchluessel(a.x, a.z, a.ebene, quer)) ||
      tuerAnKante.has(kantenSchluessel(b.x, b.z, b.ebene, quer));
    return tuerDort ? halb : 0;
  };
  const einzugDicht = (quer: Kante): number =>
    querWand(a, quer) && querWand(b, quer) ? WAND_DICKE_ACHTEL / 2 : 0;
  /** Ein Kantenstueck auf die lichte Laenge zwischen den Querwaenden stutzen. */
  /** Trim an edge piece to the clear length between the perpendicular walls. */
  const gestutzt = (
    s: { xa0: number; xa1: number; za0: number; za1: number },
    einzug: (quer: Kante) => number
  ): { xa0: number; xa1: number; za0: number; za1: number } => {
    const e0 = einzug(laengsX ? KANTE.West : KANTE.Sued);
    const e1 = einzug(laengsX ? KANTE.Ost : KANTE.Nord);
    return laengsX
      ? { ...s, xa0: s.xa0 + e0, xa1: s.xa1 - e1 }
      : { ...s, za0: s.za0 + e0, za1: s.za1 - e1 };
  };

  if (tuer !== undefined) {
    const bodenMax = Math.max(bodenStufen(a), bodenStufen(b));
    const sturzUnten = bodenMax + TUER_HOEHE_STUFEN;
    // Der Sturz endet an der NIEDRIGEREN Deckenunterkante. Was darueber noch zu
    // schliessen ist, schliesst die Laibung weiter unten — dasselbe Stueck wie
    // an einer Oeffnung ohne Tuer, denn eine Tuerkante IST eine offene Kante mit
    // Rahmen. Reichte der Sturz bis zur hoechsten Deckenunterkante, laege sein
    // oberes Ende in der Deckenplatte des niedrigeren Raums, und seine
    // Stirnflaechen fielen mit deren Stirnflaechen in eine Ebene.
    // The header ends at the LOWER ceiling underside. Whatever remains to be
    // closed above it is closed by the reveal further down — the same piece as
    // at an opening without a door, because a door edge IS an open edge with a
    // frame. Were the header to reach the highest ceiling underside, its upper
    // end would sit inside the lower room's ceiling slab, and its end faces
    // would fall into one plane with that slab's.
    trage(
      sammler,
      gitter,
      eigner,
      block,
      'wand',
      { ...gestutzt(streifen, einzugDicht), ys0: sturzUnten, ys1: lichtMin, drehung: kantenDrehung(kante) },
      true
    );
    // Wie die Wand: der Pfosten beginnt an der Boden-OBERKANTE. Was darunter
    // liegt, steckt in der Bodenplatte und faellt koplanar mit deren Unterseite
    // zusammen.
    // Like the wall: the post starts at the floor TOP. What lies below is stuck
    // inside the floor slab and falls coplanar with its underside.
    const untenMin = Math.min(bodenStufen(a), bodenStufen(b));
    // Die Pfosten stehen an den Enden des LICHTEN Durchgangs, nicht an den Enden
    // der Zelle: ein Pfosten am Zellende waere in der dortigen Querwand versenkt.
    // The posts stand at the ends of the CLEAR opening, not at the ends of the
    // cell: a post at the cell end would be sunk into the perpendicular wall.
    for (const seite of [0, 1] as const) {
      const zier = gestutzt(streifen, einzugZier);
      const von = laengsX ? zier.xa0 : zier.za0;
      const bis = laengsX ? zier.xa1 : zier.za1;
      const p0 = seite === 0 ? von : bis - TUER_PFOSTEN_ACHTEL;
      const p1 = seite === 0 ? von + TUER_PFOSTEN_ACHTEL : bis;
      const pfosten = laengsX
        ? { xa0: p0, xa1: p1, za0: streifen.za0, za1: streifen.za1 }
        : { xa0: streifen.xa0, xa1: streifen.xa1, za0: p0, za1: p1 };
      trage(
        sammler,
        gitter,
        eigner,
        block,
        'tuerrahmen',
        { ...pfosten, ys0: untenMin, ys1: sturzUnten, drehung: kantenDrehung(kante) },
        true
      );
    }
  }

  // Die LAIBUNG einer Oeffnung: der Schlitz ueber der niedrigeren Deckenplatte.
  // Er faengt an deren OBERKANTE an (darunter steht die Platte selbst) und
  // reicht bis zur hoechsten Deckenunterkante — so weit blickt jemand aus dem
  // hoeheren Raum durch die Oeffnung.
  //
  // Und er belegt nur die HAELFTE des Kantenstreifens, die auf der Seite der
  // niedrigeren Zelle liegt. Der ganze Streifen ragte einen halben Meter ueber
  // die Wandflucht in den hoeheren Raum hinein — das war der gemeldete Quader,
  // der vor einer sonst planen Wand steht. Die andere Haelfte hat nichts zu
  // dichten: dort steht die Deckenplatte des hoeheren Raums.
  // The REVEAL of an opening: the slit above the lower ceiling slab. It starts
  // at that slab's TOP (below it stands the slab itself) and reaches up to the
  // highest ceiling underside — that is how far someone in the higher room sees
  // through the opening. And it occupies only the HALF of the edge strip on the
  // lower cell's side. The whole strip stuck half a metre past the wall line
  // into the higher room — that was the reported box standing in front of an
  // otherwise flat wall. The other half has nothing to seal: the higher room's
  // ceiling slab stands there.
  const niedrigIstA = saeuleA < saeuleB;
  const laibungUnten = niedrigIstA ? saeuleA : saeuleB;
  if (lichtMax > laibungUnten) {
    trage(
      sammler,
      gitter,
      eigner,
      block,
      'wand',
      {
        // NICHT gestutzt: die Laibung reicht bis zur hoechsten Deckenunterkante,
        // und eine Querwand endet an IHRER eigenen — die kann tiefer liegen.
        // Wer hier stutzt, schneidet ein Loch in die Decke der Oeffnung.
        // NOT trimmed: the reveal reaches the highest ceiling underside, while a
        // perpendicular wall ends at ITS own, which may be lower. Trimming here
        // cuts a hole into the opening's head.
        ...kantenStreifenHaelfte(a.x, a.z, kante, niedrigIstA),
        ys0: laibungUnten,
        ys1: lichtMax,
        drehung: kantenDrehung(kante),
      },
      true
    );
  }
}

/** Schluessel einer KANONISCHEN Kante. / Key of a CANONICAL edge. */
function kantenSchluessel(x: number, z: number, ebene: number, kante: Kante): string {
  const k = kanonisiereKante(x, z, ebene, kante);
  return `${k.ebene}|${k.z}|${k.x}|${k.kante}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Der Bauer / the builder
// ─────────────────────────────────────────────────────────────────────────────

/** Meter-x der linken Zellkante. / Metre x of the cell's low edge. */
function achtelZuMeter(achtel: number): number {
  return achtel * ACHTEL_M;
}

/**
 * Weltposition eines Deko-Ankers. `u`/`v` sind Achtel einer Zelle, `h` sind
 * Hoehenstufen ueber dem Boden DIESER Zelle — beides Ganzzahlen, beides mit
 * genau einer Multiplikation in Meter uebersetzt.
 * World position of a decor anchor. `u`/`v` are eighths of a cell, `h` are
 * height steps above the floor of THIS cell — both integers, both translated
 * into metres with exactly one multiplication.
 */
function ankerPosition(gitter: ZellenGitter, anker: DekoAnker): Vector3 | null {
  const zelle = zelleImGitter(gitter, anker.x, anker.z, anker.ebene);
  if (zelle === undefined || !offen(zelle.art)) return null;
  return {
    x: achtelZuMeter(anker.x * ZELL_ACHTEL + anker.u),
    y: (bodenStufen(zelle) + anker.h) * HOEHEN_SCHRITT_M,
    z: achtelZuMeter(anker.z * ZELL_ACHTEL + anker.v),
  };
}

/**
 * Der Spawnpunkt: die Mitte der Eingangszelle, auf ihrer Bodenoberkante.
 * AUSDRUECKLICH, nicht hergeleitet (ARCHITECTURE §3.8) — und immer aus dem
 * VOLLEN Gitter, nie aus der Blockauswahl, sonst haette ein Teilbau einen
 * anderen Spawn als der Vollbau.
 * The spawn point: the centre of the entrance cell, on its floor top.
 * EXPLICIT, not derived (ARCHITECTURE §3.8) — and always from the FULL grid,
 * never from the block selection, otherwise a partial build would have a
 * different spawn than the full one.
 *
 * Ist die Eingangszelle kein begehbares Feld (ein ungueltiges Layout, das
 * `validateLayout` melden wuerde), faellt der Punkt deterministisch auf die
 * erste Zelle in (ebene,z,x)-Sortierung zurueck — nie auf "irgendeine".
 * If the entrance cell is not walkable (an invalid layout, which
 * `validateLayout` would report), the point falls back deterministically to the
 * first cell in (ebene,z,x) order — never to "some" cell.
 */
function spawnPunktVon(layout: DungeonLayout2, gitter: ZellenGitter): Vector3 {
  const eingang = zelleImGitter(gitter, layout.eingang.x, layout.eingang.z, layout.eingang.ebene);
  const zelle = eingang !== undefined && offen(eingang.art) ? eingang : zellenSortiert(gitter).find((c) => offen(c.art));
  if (zelle === undefined) return { x: 0, y: 0, z: 0 };
  return {
    x: (zelle.x * 2 + 1) * (ZELLE_M / 2),
    y: bodenStufen(zelle) * HOEHEN_SCHRITT_M,
    z: (zelle.z * 2 + 1) * (ZELLE_M / 2),
  };
}

/** Sortierschluessel eines Bauteils. / Sort key of a piece. */
function stueckSchluessel(s: BauStueck): string {
  return [
    s.block.ebene,
    s.block.bz,
    s.block.bx,
    s.art,
    s.materialTag,
    zahl(s.mitte.y),
    zahl(s.mitte.z),
    zahl(s.mitte.x),
    zahl(s.groesse.y),
    zahl(s.groesse.z),
    zahl(s.groesse.x),
    s.drehung,
  ].join('|');
}

/** Sortierschluessel eines Kollisionskoerpers. / Sort key of a collision body. */
function koerperSchluessel(k: KollisionsKoerper): string {
  return [
    k.form,
    zahl(k.mitte.y),
    zahl(k.mitte.z),
    zahl(k.mitte.x),
    zahl(k.groesse.y),
    zahl(k.groesse.z),
    zahl(k.groesse.x),
    k.drehung,
    k.steigung ?? 0,
  ].join('|');
}

/**
 * Zahl als Text, `-0` zu `0` normalisiert — dieselbe Regel wie in `layout.ts`.
 * Sie ist hier noetig, weil eine `-0` in einer Mitte zwei rechnerisch gleiche
 * Ergebnisse auseinanderlaufen liesse.
 * A number as text, `-0` normalised to `0` — the same rule as in `layout.ts`.
 * Needed here because a `-0` in a centre would let two arithmetically equal
 * results diverge.
 */
function zahl(w: number): string {
  if (!Number.isFinite(w)) return '?';
  if (w === 0) return '0';
  return String(w);
}

/**
 * Kanonischer Text eines Bauergebnisses — die Grundlage der Pruefsumme. Alle
 * Listen sind vorher sortiert; eine Map-Iterationsreihenfolge geht nie ein.
 * Canonical text of a build result — the basis of the checksum. All lists are
 * sorted beforehand; a map iteration order never enters.
 */
export function bauKanonisch(ergebnis: {
  readonly stuecke: readonly BauStueck[];
  readonly kollision: readonly KollisionsKoerper[];
  readonly nav: readonly NavZelle[];
  readonly dekoPlaetze: readonly DekoPlatz[];
  readonly spawnPunkt: Vector3;
  readonly huelle: { readonly min: Vector3; readonly max: Vector3 };
}): string {
  const zeilen: string[] = [];
  zeilen.push(`spawn ${zahl(ergebnis.spawnPunkt.x)} ${zahl(ergebnis.spawnPunkt.y)} ${zahl(ergebnis.spawnPunkt.z)}`);
  zeilen.push(
    `huelle ${zahl(ergebnis.huelle.min.x)} ${zahl(ergebnis.huelle.min.y)} ${zahl(ergebnis.huelle.min.z)} ` +
      `${zahl(ergebnis.huelle.max.x)} ${zahl(ergebnis.huelle.max.y)} ${zahl(ergebnis.huelle.max.z)}`
  );
  for (const s of ergebnis.stuecke) {
    zeilen.push(
      `stueck ${stueckSchluessel(s)} ${s.blend.hoeheUeberBoden.map(zahl).join(',')} ${s.blend.kantenAbstand.map(zahl).join(',')}`
    );
  }
  for (const k of ergebnis.kollision) zeilen.push(`koerper ${koerperSchluessel(k)}`);
  for (const n of ergebnis.nav) {
    zeilen.push(
      `nav ${n.ebene}|${n.z}|${n.x} ${zahl(n.mitte.x)} ${zahl(n.mitte.y)} ${zahl(n.mitte.z)} ` +
        `${zahl(n.lichteHoehe)} ${n.offeneKanten} ${n.nachOben ? 1 : 0} ${n.nachUnten ? 1 : 0}`
    );
  }
  for (const d of ergebnis.dekoPlaetze) {
    zeilen.push(
      `deko ${d.ankerId} ${d.rolle} ${d.prefab ?? ''} ${d.ort} ${d.kante ?? 0} ` +
        `${zahl(d.position.x)} ${zahl(d.position.y)} ${zahl(d.position.z)} ${d.drehung} ${d.seed} ${d.stempelId}`
    );
  }
  return zeilen.join('\n');
}

/**
 * Baut die Geometrie eines Layouts — ganz, oder nur die genannten Bloecke.
 * Die eingefrorene Signatur aus `design/data-model.md` §3.
 * Builds the geometry of a layout — completely, or only the named blocks. The
 * frozen signature from `design/data-model.md` §3.
 */
export function baueGeometrie(layout: DungeonLayout2, auswahl?: BauAuswahl): BauErgebnis {
  const gitter = auswahl?.gitter ?? zellenAufbauen(layout, auswahl?.aufbau);
  const gewaehlt =
    auswahl?.bloecke === undefined ? null : new Set(auswahl.bloecke.map(blockSchluessel));
  const imBau = (block: BlockId): boolean => gewaehlt === null || gewaehlt.has(blockSchluessel(block));

  const sammler: Sammler = { stuecke: [], kollision: [] };
  const seedSims = mische(layout.seeds.material, SALZ_SIMS);

  const tuerAnKante = new Map<string, Tuer>();
  for (const tuer of layout.tueren) {
    tuerAnKante.set(kantenSchluessel(tuer.x, tuer.z, tuer.ebene, tuer.kante), tuer);
  }

  const alleZellen = zellenSortiert(gitter);

  // Zellteile: Eigentuemer ist der Block der Zelle selbst.
  // Cell parts: the owner is the block of the cell itself.
  for (const zelle of alleZellen) {
    if (!imBau(blockVonZelle(zelle.x, zelle.z, zelle.ebene))) continue;
    baueZelle(sammler, gitter, zelle);
    baueSimse(sammler, gitter, zelle, seedSims);
  }

  // Kantenteile: Eigentuemer ist der Block der KANONISCHEN Zelle. Jede Kante
  // wird genau einmal betrachtet, egal von welcher Seite sie zuerst auftaucht.
  // Edge parts: the owner is the block of the CANONICAL cell. Every edge is
  // considered exactly once, no matter from which side it first shows up.
  const erledigt = new Set<string>();
  for (const zelle of alleZellen) {
    for (const kante of KANTEN) {
      const k = kanonisiereKante(zelle.x, zelle.z, zelle.ebene, kante);
      const schluessel = `${k.ebene}|${k.z}|${k.x}|${k.kante}`;
      if (erledigt.has(schluessel)) continue;
      erledigt.add(schluessel);
      const kantenBlock = blockVonZelle(k.x, k.z, k.ebene);
      if (!imBau(kantenBlock)) continue;
      const kanonZelle =
        zelleImGitter(gitter, k.x, k.z, k.ebene) ??
        ({
          x: k.x,
          z: k.z,
          ebene: k.ebene,
          art: ZELLEN_ART.Leer,
          boden: 0,
          decke: 0,
          wandErzwungen: 0,
          durchgangErzwungen: 0,
          materialTag: 0,
          oberflaeche: 0,
          stempelId: -1,
        } as Zelle);
      baueKante(sammler, gitter, kanonZelle, k.kante, kantenBlock, tuerAnKante);
    }
  }

  // Navigation: eine Zeile je begehbarer Zelle im Bau.
  // Navigation: one row per walkable cell in the build.
  const nav: NavZelle[] = [];
  for (const zelle of alleZellen) {
    if (!offen(zelle.art)) continue;
    const block = blockVonZelle(zelle.x, zelle.z, zelle.ebene);
    if (!imBau(block)) continue;
    let offeneKanten = 0;
    for (const kante of KANTEN) {
      const p = nachbarZelle(zelle.x, zelle.z, kante);
      const n = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
      if (n === undefined || !offen(n.art)) continue;
      if (zellKanteZuQuaderGanz(gitter, zelle, kante) === null) offeneKanten |= kante;
    }
    const untenZelle = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene - 1);
    const obenZelle = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
    // Standhoehe IN DER ZELLMITTE, nicht an der Kante. Bei einer flachen Zelle
    // ist das dasselbe; bei einer Treppe liegt die Mitte der Lauflaeche eine
    // halbe Steigung ueber `Zelle.boden` (das laut Format die Hoehe an der
    // TIEFEN Kante ist). Stuende hier die Kantenhoehe, saehe jede Wegfindung
    // und jede Spawnpruefung die Treppe zwei Meter zu tief — und faende dort
    // Luft.
    // Standing height AT THE CELL CENTRE, not at the edge. For a flat cell they
    // are the same; on a stair the middle of the tread lies half a rise above
    // `Zelle.boden` (which per the format is the height at the LOW edge). With
    // the edge height here every path search and spawn check would see the
    // stair two metres too low — and find air.
    const standHoehe =
      zelle.art === ZELLEN_ART.Treppe
        ? (bodenStufen(zelle) + anstiegStufen(gitter, zelle, zelle.neigung ?? KANTE.Nord) / 2) *
          HOEHEN_SCHRITT_M
        : bodenStufen(zelle) * HOEHEN_SCHRITT_M;
    nav.push({
      x: zelle.x,
      z: zelle.z,
      ebene: zelle.ebene,
      block,
      mitte: {
        x: (zelle.x * 2 + 1) * (ZELLE_M / 2),
        y: standHoehe,
        z: (zelle.z * 2 + 1) * (ZELLE_M / 2),
      },
      lichteHoehe: (obenStufen(gitter, zelle) - bodenStufen(zelle)) * HOEHEN_SCHRITT_M,
      offeneKanten,
      nachOben: obenZelle !== undefined && obenZelle.art === ZELLEN_ART.Schacht,
      nachUnten:
        zelle.art === ZELLEN_ART.Schacht && untenZelle !== undefined && offen(untenZelle.art),
    });
  }

  // Deko-Plaetze: Eigentuemer ist der Block der Ankerzelle.
  // Decor places: the owner is the block of the anchor cell.
  const dekoPlaetze: DekoPlatz[] = [];
  for (const anker of [...layout.anker].sort(
    (a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x || a.id - b.id
  )) {
    const block = blockVonZelle(anker.x, anker.z, anker.ebene);
    if (!imBau(block)) continue;
    const position = ankerPosition(gitter, anker);
    if (position === null) continue;
    dekoPlaetze.push({
      ankerId: anker.id,
      block,
      rolle: anker.rolle,
      ...(anker.prefab === undefined ? {} : { prefab: anker.prefab }),
      ort: anker.ort,
      ...(anker.kante === undefined ? {} : { kante: anker.kante }),
      position,
      drehung: anker.drehung,
      seed: anker.seed,
      stempelId: anker.stempelId,
    });
  }

  // Sortieren mit vorberechneten Schluesseln (Schwartz-Transformation): der
  // Vergleicher darf keinen Schluessel zweimal rechnen, sonst kostet die
  // Sortierung eines grossen Grabes mehr als der ganze Bau.
  // Sorting with precomputed keys (Schwartzian transform): the comparator must
  // not compute a key twice, otherwise sorting a large barrow costs more than
  // the whole build.
  const stuecke = nachSchluessel(sammler.stuecke, stueckSchluessel);
  const kollision = nachSchluessel(sammler.kollision, koerperSchluessel);

  const huelle = huelleVon(stuecke, kollision);
  const spawnPunkt = spawnPunktVon(layout, gitter);
  const ohnePruefsumme = { stuecke, kollision, nav, dekoPlaetze, spawnPunkt, huelle };
  return {
    ...ohnePruefsumme,
    pruefsumme: fnv1a32(bauKanonisch(ohnePruefsumme)).toString(16).padStart(8, '0'),
  };
}

/**
 * Stabil nach einem Textschluessel sortieren, jeder Schluessel genau einmal
 * gerechnet. Bei gleichem Schluessel entscheidet die Ursprungsreihenfolge — und
 * die ist ihrerseits deterministisch, weil alle Erzeugerschleifen sortiert
 * laufen.
 * Stable sort by a text key, every key computed exactly once. On equal keys the
 * original order decides — and that is itself deterministic, because every
 * producing loop runs in sorted order.
 */
function nachSchluessel<T>(liste: readonly T[], schluessel: (w: T) => string): T[] {
  return liste
    .map((wert, index) => ({ wert, index, s: schluessel(wert) }))
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.index - b.index))
    .map((e) => e.wert);
}

/** Achsparallele Huelle ueber alles Gebaute. / Axis-aligned hull over everything built. */
function huelleVon(
  stuecke: readonly BauStueck[],
  kollision: readonly KollisionsKoerper[]
): { min: Vector3; max: Vector3 } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const nimm = (mitte: Vector3, groesse: Vector3): void => {
    if (mitte.x - groesse.x / 2 < minX) minX = mitte.x - groesse.x / 2;
    if (mitte.y - groesse.y / 2 < minY) minY = mitte.y - groesse.y / 2;
    if (mitte.z - groesse.z / 2 < minZ) minZ = mitte.z - groesse.z / 2;
    if (mitte.x + groesse.x / 2 > maxX) maxX = mitte.x + groesse.x / 2;
    if (mitte.y + groesse.y / 2 > maxY) maxY = mitte.y + groesse.y / 2;
    if (mitte.z + groesse.z / 2 > maxZ) maxZ = mitte.z + groesse.z / 2;
  };
  for (const s of stuecke) nimm(s.mitte, s.groesse);
  for (const k of kollision) nimm(k.mitte, k.groesse);
  if (!Number.isFinite(minX)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Netzdaten / mesh data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reine Netzdaten eines Bauteils — Positionen, Normalen, `uv2` und Indizes,
 * ohne jede Engine. Der Client-Adapter (AP6) fuellt damit einen
 * `VertexData`-Satz, der Test rechnet damit die Kanten-Manifold-Pruefung.
 * Vierundzwanzig Eckpunkte (vier je Flaeche), damit die Normalen flach bleiben
 * — ein Quader mit acht geteilten Eckpunkten haette gemittelte Normalen und
 * damit weiche Kanten, das Gegenteil des Leitbilds.
 * Pure mesh data of one piece — positions, normals, `uv2` and indices, without
 * any engine. The client adapter (AP6) fills a `VertexData` set from it, the
 * test computes the edge-manifold check from it. Twenty-four vertices (four per
 * face) so the normals stay flat — a box with eight shared vertices would have
 * averaged normals and therefore soft edges, the opposite of the design brief.
 */
export interface Netz {
  readonly positionen: readonly number[];
  readonly normalen: readonly number[];
  readonly uv2: readonly number[];
  readonly indizes: readonly number[];
}

/**
 * Die sechs Flaechen eines Quaders, jede mit vier Eckindizes in
 * `ECKEN`-Nummerierung, gegen den Uhrzeigersinn von aussen gesehen. Die
 * Reihenfolge ist fest — der Manifold-Test verlangt, dass jede gerichtete Kante
 * GENAU EINMAL vorkommt, und das ist nur bei durchgehend gleicher Umlaufrichtung
 * der Fall.
 * The six faces of a box, each with four corner indices in `ECKEN` numbering,
 * counter-clockwise seen from outside. The order is fixed — the manifold test
 * demands that every directed edge appears EXACTLY ONCE, which only holds with
 * a consistent winding throughout.
 */
const FLAECHEN: readonly { readonly normale: readonly [number, number, number]; readonly ecken: readonly [number, number, number, number] }[] = [
  { normale: [1, 0, 0], ecken: [1, 3, 7, 5] }, // +X
  { normale: [-1, 0, 0], ecken: [4, 6, 2, 0] }, // -X
  { normale: [0, 1, 0], ecken: [6, 7, 3, 2] }, // +Y
  { normale: [0, -1, 0], ecken: [0, 1, 5, 4] }, // -Y
  { normale: [0, 0, 1], ecken: [5, 7, 6, 4] }, // +Z
  { normale: [0, 0, -1], ecken: [1, 0, 2, 3] }, // -Z
];

/**
 * Bauteil -> Netzdaten. `drehung` wird NICHT angewandt: die Quader dieses
 * Bauers sind achsparallel, `groesse` steht bereits in Weltachsen, und
 * `drehung` ist reine Ausrichtungsangabe fuer den Adapter (welche Seite in den
 * Raum blickt). Wer sie hier zusaetzlich anwendete, drehte den Quader zweimal.
 * Piece -> mesh data. `drehung` is NOT applied: the boxes of this builder are
 * axis aligned, `groesse` is already in world axes, and `drehung` is a pure
 * orientation hint for the adapter (which side faces into the room). Applying
 * it here as well would rotate the box twice.
 */
export function stueckZuNetz(stueck: BauStueck): Netz {
  const x0 = stueck.mitte.x - stueck.groesse.x / 2;
  const x1 = stueck.mitte.x + stueck.groesse.x / 2;
  const y0 = stueck.mitte.y - stueck.groesse.y / 2;
  const y1 = stueck.mitte.y + stueck.groesse.y / 2;
  const z0 = stueck.mitte.z - stueck.groesse.z / 2;
  const z1 = stueck.mitte.z + stueck.groesse.z / 2;

  const positionen: number[] = [];
  const normalen: number[] = [];
  const uv2: number[] = [];
  const indizes: number[] = [];

  for (const flaeche of FLAECHEN) {
    const basis = positionen.length / 3;
    for (const ecke of flaeche.ecken) {
      positionen.push((ecke & 1) === 0 ? x0 : x1, (ecke & 2) === 0 ? y0 : y1, (ecke & 4) === 0 ? z0 : z1);
      normalen.push(flaeche.normale[0], flaeche.normale[1], flaeche.normale[2]);
      uv2.push(stueck.blend.hoeheUeberBoden[ecke] ?? 0, stueck.blend.kantenAbstand[ecke] ?? 0);
    }
    indizes.push(basis, basis + 1, basis + 2, basis, basis + 2, basis + 3);
  }
  return { positionen, normalen, uv2, indizes };
}
