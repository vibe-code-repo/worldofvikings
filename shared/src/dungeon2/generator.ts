/**
 * Der Auto-Generator des Dungeon-Generators 2.0: `erzeugeLayout()`, Phasen
 * P0..P10 nach `design/data-model.md` §2.3.
 * The auto generator of dungeon generator 2.0: `erzeugeLayout()`, phases
 * P0..P10 as per `design/data-model.md` §2.3.
 *
 * Rein und deterministisch: gleiche Eingabe -> gleiche Ausgabe, Byte fuer Byte,
 * in Node und im Browser. Kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie, und keine Entscheidung haengt
 * an der Iterationsreihenfolge einer `Map` oder eines `Set` — wo ueber eine
 * Menge entschieden wird, wird vorher kanonisch sortiert
 * (`design/data-model.md` §2.4).
 * Pure and deterministic: same input -> same output, byte for byte, in Node and
 * in the browser. No Babylon, no DOM, no `node:`, no `Math.random`, no clock,
 * no trigonometry, and no decision depends on the iteration order of a `Map` or
 * `Set` — wherever a set is decided over, it is canonically sorted first
 * (`design/data-model.md` §2.4).
 *
 * Stroeme (`ARCHITECTURE.md` W7):
 *   - EIN Architekturstrom fuer P0..P8, die Ziehreihenfolge ist Vertrag.
 *   - EIN Strom je Stempel fuer die Deko in P9: `mische(seeds.deko, stempel.id)`.
 *   - Keine Ziehung aus `seeds.material` — Material ist gehasht, nicht gezogen
 *     (W8), damit ein neuer Material-Seed den Grundriss nicht verschiebt.
 * Streams (`ARCHITECTURE.md` W7):
 *   - ONE architecture stream for P0..P8; the draw order is a contract.
 *   - ONE stream per stamp for decor in P9: `mische(seeds.deko, stempel.id)`.
 *   - No draw from `seeds.material` — material is hashed, not drawn (W8), so a
 *     new material seed never shifts the floor plan.
 *
 * Die gesamte `endcaps*`-Familie des Altgenerators entfaellt ersatzlos
 * (`ARCHITECTURE.md` AP4): Im Zellmodell ist "zumauern" immer moeglich, weil
 * eine Wand kein Bauteil mit Platzbedarf ist — P7 setzt eine Bitmaske, keinen
 * Notfall-Prefab.
 * The whole `endcaps*` family of the old generator is dropped without
 * replacement (`ARCHITECTURE.md` AP4): in the cell model "walling up" is always
 * possible because a wall is not a part that needs room — P7 sets a bit mask,
 * not an emergency prefab.
 */

import { XorShiftRandom } from '../worldgen/Random.js';
import {
  ANKER_ORT,
  BLOCK_ZELLEN,
  EBENE_M,
  HOEHEN_SCHRITT_M,
  KANTE,
  KANTEN,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  MIN_LICHTE_STUFEN,
  ZELLE_M,
  ZELLEN_ART,
  gegenKante,
  kanonisiereKante,
  mitPruefsumme,
  nachbarZelle,
  nurFehler,
  type AnkerOrt,
  type Befund,
  type DekoAnker,
  type DungeonLayout2,
  type Kante,
  type LayoutSeeds,
  type RaumStempel,
  type RaumTyp,
  type Tuer,
  type TuerZustand,
  type Zelle,
  type ZellenAenderung,
  type ZellenArt,
  type ZellenKorrektur,
} from './layout.js';
import {
  BODEN_DICKE_STUFEN,
  DECKE_DICKE_STUFEN,
  EBENE_IN_HOEHEN_SCHRITTEN,
  bodenStufen,
  offen,
  schluesselZelle,
  wandAnkerVersatz,
  wandZwischen,
  zelleImGitter,
  zelleOderLeer,
  zellenAufbauen,
  zellenSortiert,
  type AufbauOptionen,
  type ZellenGitter,
} from './cells.js';
import { validateLayoutVoll } from './validation.js';
import { mische } from './hashing.js';
import {
  ROLLEN,
  kanteZuDrehung,
  materialTagFuerStempel,
  profilFuer,
  rollenIndex,
  varianteFuerStempel,
  type RaumTypProfil,
  type ThemenProfil,
} from './themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Aussenkanten des Moduls / the module's outer edges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vorgaben, die den Generator von aussen festnageln. Alle optional — ohne sie
 * ergibt sich alles aus Thema und Seeds.
 * Constraints pinning the generator from outside. All optional — without them
 * everything follows from theme and seeds.
 */
export interface Erzeugungsvorgaben {
  /** Dokument-Kennung. Voreinstellung: `<thema>-<architektur-seed in hex>`. */
  /** Document id. Default: `<theme>-<architecture seed in hex>`. */
  readonly id: string;
  readonly name: string;
  /** Wachstumsgrenzen in ZELLEN. / Growth bounds in CELLS. */
  readonly grenzen: DungeonLayout2['grenzen'];
  /** Zielgroesse in ZELLEN, inklusive. / Target size in CELLS, inclusive. */
  readonly zielZellen: readonly [number, number];
  /**
   * NUR ZUM MESSEN: fuegt in P9 je Stempel EINE zusaetzliche Ziehung in den
   * Deko-Strom ein. Damit prueft `shared/test/dungeon2-generator.ts` das
   * Abnahmekriterium (e) aus `ARCHITECTURE.md` AP4 — "das Einfuegen einer
   * zusaetzlichen Ziehung in P9 veraendert kein einziges Stempel-Feld". Der
   * Haken steht hier und nicht im Test, weil ein Test, der den Generator
   * nachbaut, nicht den Generator misst.
   * FOR MEASUREMENT ONLY: inserts ONE extra draw per stamp into the decor
   * stream in P9. This is how `shared/test/dungeon2-generator.ts` checks
   * acceptance criterion (e) from `ARCHITECTURE.md` AP4 — "inserting an extra
   * draw in P9 changes not a single stamp field". The hook lives here and not
   * in the test, because a test that reimplements the generator does not
   * measure the generator.
   */
  readonly zusatzZiehungInP9: boolean;
}

/**
 * Was bei der Erzeugung herauskam — ueber das Layout hinaus. `erzeugeLayout()`
 * gibt nur das Layout zurueck (eingefrorene Signatur aus `data-model.md` §2);
 * wer messen will, nimmt `erzeugeLayoutMitBericht()`.
 * What came out of generation — beyond the layout. `erzeugeLayout()` returns
 * only the layout (frozen signature from `data-model.md` §2); whoever measures
 * takes `erzeugeLayoutMitBericht()`.
 */
export interface Erzeugungsbericht {
  readonly layout: DungeonLayout2;
  /**
   * true = die gewachsene Form fiel bei P10 durch und wurde durch die
   * deterministische einfache Form ersetzt. Ein Bericht mit `rueckfall: true`
   * ist ein Fund, kein Betriebsfall.
   * true = the grown shape failed P10 and was replaced by the deterministic
   * simple form. A report with `rueckfall: true` is a finding, not routine.
   */
  readonly rueckfall: boolean;
  /** Befunde der ausgelieferten Form. / Findings of the delivered shape. */
  readonly befunde: readonly Befund[];
  /** Zahl der begehbaren Zellen. / Number of walkable cells. */
  readonly zellenZahl: number;
  /** Zahl der Ebenen. / Number of storeys. */
  readonly ebenenZahl: number;
  /**
   * Wie oft die deterministische Auffuellung (P2b) einspringen musste, um die
   * gezogene Zielgroesse zu erreichen. Gross heisst: das Wachstum erstickt.
   * How often the deterministic filler (P2b) had to step in to reach
   * drawn target size. Large means: growth is suffocating.
   */
  readonly auffuellungen: number;
}

/**
 * Erzeugt ein vollstaendiges, gueltiges Layout. Die eingefrorene Signatur aus
 * `design/data-model.md` §2.
 * Generates a complete, valid layout. The frozen signature from
 * `design/data-model.md` §2.
 */
export function erzeugeLayout(
  thema: ThemenProfil,
  seeds: LayoutSeeds,
  vorgaben?: Partial<Erzeugungsvorgaben>
): DungeonLayout2 {
  return erzeugeLayoutMitBericht(thema, seeds, vorgaben).layout;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Innere Hilfstypen / internal helper types
// ─────────────────────────────────────────────────────────────────────────────

/** Eine offene Anschlusskante der Wachstumsfront. / An open frontier edge. */
interface Anschluss {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly kante: Kante;
  readonly stempelId: number;
  /** Baumtiefe des Stempels, an dem der Anschluss haengt. / Tree depth. */
  readonly tiefe: number;
}

/** Eine Zellkante als Platz. / A cell edge as a place. */
interface KantenPlatz {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly kante: Kante;
}

/** Sortierschluessel einer Kante: (ebene, z, x, kante). / Edge sort key. */
function kantenVergleich(a: KantenPlatz, b: KantenPlatz): number {
  return a.ebene - b.ebene || a.z - b.z || a.x - b.x || a.kante - b.kante;
}

/** Textschluessel einer kanonisierten Kante. / Text key of a canonical edge. */
function kantenSchluessel(k: KantenPlatz): string {
  return `${k.ebene}|${k.z}|${k.x}|${k.kante}`;
}

/** Acht Hexziffern eines uint32 — fuer sprechende, seedgebundene Kennungen. */
/** Eight hex digits of a uint32 — for readable, seed-bound ids. */
function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Grenzen / bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Voreingestellte Wachstumsgrenzen: ein Quadrat um den Ursprung, dessen Flaeche
 * rund das Fuenffache der oberen Zielgroesse betraegt. Enger waere ein
 * Steinbruch (das Wachstum erstickt an der Wand), weiter waere ein Faden (die
 * Raeume beruehren sich nie, und ohne Beruehrungen gibt es keine Schleifen, P5).
 * Default growth bounds: a square around the origin whose area is roughly five
 * times the upper target size. Tighter would be a quarry (growth suffocates at
 * the wall), wider would be a thread (rooms never touch, and without contacts
 * there are no loops, P5).
 */
function standardGrenzen(zielMax: number, ebenenZahl: number): DungeonLayout2['grenzen'] {
  const r = Math.max(12, Math.ceil(Math.sqrt(zielMax * 5) / 2) + 3);
  return {
    minX: -r,
    maxX: r,
    minZ: -r,
    maxZ: r,
    minEbene: 0,
    maxEbene: ebenenZahl - 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Der Generator / the generator
// ─────────────────────────────────────────────────────────────────────────────

/** Sicherheitsgrenze der Wachstumsschleife. / Safety bound of the growth loop. */
const MAX_SCHRITTE = 6000;
/** Wie viele Raumtypen ein Anschluss durchprobiert. / Room types tried per frontier edge. */
const MAX_TYP_VERSUCHE = 4;
/** Sicherheitsgrenze der Auffuellung (P2b). / Safety bound of the filler (P2b). */
const MAX_AUFFUELLUNGEN = 4000;

/**
 * Anstieg der Treppenlaeufe in Hoehenstufen, von unten nach oben. Summe =
 * `EBENE_IN_HOEHEN_SCHRITTEN` (16), je Lauf EINE Zelle (4 m) waagerecht.
 *
 * WARUM DREI UNGLEICHE LAEUFE UND NICHT ZWEI GLEICHE? Zwei Laeufe zu 8 Stufen
 * ergeben 4 m Anstieg auf 4 m Lauf — genau 45 Grad. Die Spielfigur kam dort
 * NICHT hinauf: `maxSlopeCosine` stand auf `STEIGUNGS_GRENZE_GRAD` = 40 Grad,
 * und Havoks Charaktercontroller laesst eine steilere Flaeche nicht als Boden
 * gelten.
 *
 * NACHTRAG 11.09.2026: Die Grenze liegt jetzt bei 60 Grad (Originalwert,
 * `shared/src/bewegung/masse.ts`). Die 45-Grad-Variante WAERE damit begehbar.
 * Die drei ungleichen Laeufe bleiben dennoch: Sie sind auch die schoenere
 * Treppe, und der Umbau haette keinen Gewinn ausser einer gesparten Zelle.
 * Die Messreihe unten bleibt als Beleg stehen, WIE hart die Grenze wirkt —
 * sie wirkt jetzt an einer anderen Stelle, nicht schwaecher.
 * Gemessen am 2026-08-30
 * (`client/test/dungeon2-laeufer.ts`, Seed 2, Lauf (-7,-4,E0)):
 *
 *   Steigungsgrenze 40 Grad -> hoechste Fusshoehe 6,00 m (Start 6,00 m)
 *   Steigungsgrenze 45 Grad -> hoechste Fusshoehe 6,00 m
 *   Steigungsgrenze 46 Grad -> hoechste Fusshoehe 7,62 m
 *
 * Die Kapsel bewegte sich also KEINEN Zentimeter aufwaerts, solange die Grenze
 * unter dem Rampenwinkel lag. Der Fehler hatte keine Zaehlung gegen sich: die
 * Treppe stand, sah richtig aus, war regelkonform — und war unbegehbar.
 *
 * 16 teilt sich nicht durch 3, also sind die Laeufe ungleich: 6 + 5 + 5. Das
 * ergibt 36,9 / 32,0 / 32,0 Grad, alle unter der Grenze. Gleich lange Laeufe
 * waeren huebscher, aber es gibt sie bei 16 Stufen und drei Laeufen nicht, und
 * eine Ebenenhoehe zu aendern hiesse das eingefrorene Format zu aendern.
 * Rise of the stair runs in height steps, bottom to top; the sum is one storey,
 * one cell (4 m) of horizontal run each. WHY THREE UNEQUAL RUNS AND NOT TWO
 * EQUAL ONES? Two runs of 8 steps are exactly 45 degrees, and the player figure
 * does NOT get up there: `PlayerController` sets `maxSlopeCosine` to 40 degrees
 * and Havok's character controller refuses a steeper face as ground. Measured on
 * 2026-08-30: at a 40 and at a 45 degree limit the capsule moved up not one
 * centimetre; at 46 degrees it climbed. 16 does not divide by 3, so the runs are
 * unequal: 6 + 5 + 5, i.e. 36.9 / 32.0 / 32.0 degrees.
 */
const TREPPE_ANSTIEGE: readonly number[] = [6, 5, 5];
/** Bodenhoehe je Lauf, aufsummiert. / Floor height per run, accumulated. */
const TREPPE_BODEN: readonly number[] = TREPPE_ANSTIEGE.reduce<number[]>(
  (liste, anstieg) => [...liste, liste[liste.length - 1]! + anstieg],
  [0]
).slice(0, TREPPE_ANSTIEGE.length);
/**
 * Deckenunterkante ALLER Laeufe: die Ebenensohle. Ueber jedem Lauf steht eine
 * Schachtzelle, also gibt es dort gar keine Deckenplatte — `obenStufen()` zieht
 * die lichte Saeule ohnehin bis zur Schachtsohle. Der Wert sorgt nur dafuer,
 * dass `Zelle.decke` nicht DARUEBER hinausreicht: sonst waere die Saeule des
 * Laufs hoeher als die Sohle, und die Wand der Schachtzelle stuende mitten
 * darin (`dungeon2-builder.ts` (G)).
 * Ceiling underside of ALL runs: the storey sole. A shaft cell stands above every
 * run, so there is no ceiling slab at all. The value only keeps `Zelle.decke`
 * from reaching BEYOND the sole.
 */
const TREPPE_DECKE_STUFEN = EBENE_IN_HOEHEN_SCHRITTEN;

/**
 * P0..P10 in einem Durchlauf. Lang, aber am Stueck lesbar — die Phasengrenzen
 * stehen als Ueberschriften im Rumpf, weil eine Zerlegung in zehn Funktionen
 * zehn Parameterlisten mit demselben Zustand bedeutet haette.
 * P0..P10 in one pass. Long, but readable in one piece — the phase boundaries
 * are headings in the body, because splitting into ten functions would have
 * meant ten parameter lists carrying the same state.
 */
export function erzeugeLayoutMitBericht(
  thema: ThemenProfil,
  seeds: LayoutSeeds,
  vorgaben?: Partial<Erzeugungsvorgaben>
): Erzeugungsbericht {
  // ── P0: Belegung, Stroeme, Grenzen ──────────────────────────────────────
  // P0: occupancy, streams, bounds.
  const arch = new XorShiftRandom(seeds.architektur >>> 0);

  // Die Ebenenzahl wird IMMER gezogen, auch wenn `vorgaben.grenzen` sie danach
  // ueberstimmt — sonst haengt die Ziehreihenfolge des Architekturstroms davon
  // ab, ob jemand Grenzen mitgegeben hat.
  // The storey count is ALWAYS drawn, even when `vorgaben.grenzen` overrides it
  // afterwards — otherwise the architecture stream's draw order would depend on
  // whether someone passed bounds.
  const ebenenGezogen = arch.rangeInt(thema.ebenen[0], thema.ebenen[1] + 1);

  const ziel = vorgaben?.zielZellen ?? thema.zielZellen;
  // Die Zielgroesse wird EINMAL aus dem Bereich gezogen, nicht bei der
  // Untergrenze abgebrochen — sonst waere jedes Grab gleich gross und die
  // obere Haelfte von `zielZellen` nur Zierde. `ziel[1]` bleibt daneben die
  // harte Obergrenze, an der ein zu grosser Raum abgelehnt wird.
  // The target size is drawn ONCE from the range instead of stopping at the
  // lower bound — otherwise every barrow would be the same size and the upper
  // half of `zielZellen` mere decoration. `ziel[1]` remains the hard cap at
  // which an oversized room is rejected.
  const zielMenge = arch.rangeInt(ziel[0], ziel[1] + 1);
  const grenzen = vorgaben?.grenzen ?? standardGrenzen(ziel[1], ebenenGezogen);
  const ebenenZahl = grenzen.maxEbene - grenzen.minEbene + 1;

  const materialOptionen: AufbauOptionen = {
    materialTagFuerStempel: (s) => materialTagFuerStempel(thema, s),
  };

  /** (ebene|z|x) -> stempelId. Nie als Reihenfolge gelesen. / Never read as an order. */
  const belegung = new Map<string, number>();
  /**
   * Stempel der beiden Treppenlaeufe. Aus ihnen waechst NICHTS nach: eine
   * Verbindung an ihrer Flanke wuerde zu einer Tuer, und die Tuer schluege die
   * Wand des Treppenhauses wieder auf (`durchgangErzwungen` schlaegt
   * `wandErzwungen`). Die Front waechst nur an der Schachtmuendung weiter.
   * Stamps of the two stair runs. NOTHING grows out of them: a connection on
   * their flank would become a door, and the door would tear the stairwell wall
   * open again (`durchgangErzwungen` beats `wandErzwungen`). The frontier grows
   * on at the shaft mouth only.
   */
  const treppenLaeufe = new Set<number>();
  const stempel: RaumStempel[] = [];
  /** stempelId -> elternId (-1 = Wurzel). / stamp id -> parent id (-1 = root). */
  const eltern = new Map<number, number>();
  const verbindungen = new Set<string>();
  const verbindungsListe: KantenPlatz[] = [];
  const anschluesse: Anschluss[] = [];
  let naechsteId = 0;
  let auffuellungen = 0;


  const frei = (x: number, z: number, ebene: number): boolean =>
    !belegung.has(schluesselZelle(x, z, ebene)) &&
    x >= grenzen.minX &&
    x <= grenzen.maxX &&
    z >= grenzen.minZ &&
    z <= grenzen.maxZ &&
    ebene >= grenzen.minEbene &&
    ebene <= grenzen.maxEbene;

  const rechteckFrei = (x: number, z: number, ebene: number, breite: number, tiefe: number): boolean => {
    for (let dx = 0; dx < breite; dx++) {
      for (let dz = 0; dz < tiefe; dz++) {
        if (!frei(x + dx, z + dz, ebene)) return false;
      }
    }
    return true;
  };

  /**
   * Traegt eine Verbindungskante ein — kanonisiert, damit dieselbe Kante von
   * beiden Seiten aus denselben Schluessel ergibt (`layout.ts`
   * `kanonisiereKante`). Doppelte Eintragungen sind still erlaubt, weil zwei
   * Wege zur selben Kante fuehren koennen (Baumkante und Schleifenkante).
   * Records a connection edge — canonicalised, so the same edge yields the same
   * key from both sides (`layout.ts` `kanonisiereKante`). Duplicate records are
   * silently allowed, because two paths can lead to the same edge (tree edge and
   * loop edge).
   */
  const verbindungHinzu = (x: number, z: number, ebene: number, kante: Kante): void => {
    const k = kanonisiereKante(x, z, ebene, kante);
    const schluessel = kantenSchluessel(k);
    if (verbindungen.has(schluessel)) return;
    verbindungen.add(schluessel);
    verbindungsListe.push(k);
  };

  /** Alle Randkanten eines Stempels, kanonisch sortiert. / Perimeter edges, sorted. */
  const randKanten = (s: RaumStempel): KantenPlatz[] => {
    const raus: KantenPlatz[] = [];
    for (let dx = 0; dx < s.breite; dx++) {
      for (let dz = 0; dz < s.tiefe; dz++) {
        const x = s.x + dx;
        const z = s.z + dz;
        for (const kante of KANTEN) {
          const n = nachbarZelle(x, z, kante);
          const drin =
            n.x >= s.x && n.x < s.x + s.breite && n.z >= s.z && n.z < s.z + s.tiefe;
          if (!drin) raus.push({ x, z, ebene: s.ebene, kante });
        }
      }
    }
    return raus.sort(kantenVergleich);
  };

  const setzeStempel = (
    typ: RaumTyp,
    x: number,
    z: number,
    ebene: number,
    breite: number,
    tiefe: number,
    hoehe: number,
    tiefeImBaum: number,
    elternId: number
  ): RaumStempel => {
    const id = naechsteId++;
    const s: RaumStempel = {
      id,
      typ,
      x,
      z,
      ebene,
      breite,
      tiefe,
      hoehe,
      // Alle erzeugten Raeume stehen auf der Ebenensohle. Ein Versatz waere
      // eine zweite Quelle fuer Hoehenunterschiede neben `ebene`, und die
      // abgeleitete Wandregel (|boden_A - boden_B| > 1 => Wand) wuerde dann
      // Verbindungen still zumauern, die der Generator gerade geoeffnet hat.
      // All generated rooms sit on the storey floor. An offset would be a second
      // source of height differences next to `ebene`, and the derived wall rule
      // (|boden_A - boden_B| > 1 => wall) would then silently wall up
      // connections the generator had just opened.
      bodenVersatz: 0,
      // Keine Drehung: Ein um 90 Grad gedrehtes Rechteck ist dasselbe Rechteck
      // mit vertauschter Breite und Tiefe, und genau so richtet P2 den
      // Fussabdruck an der Anschlussachse aus. Damit bleibt die Drehformel aus
      // `cells.ts` (AP2) im Auto-Generator unbenutzt statt halb benutzt —
      // siehe `design/decisions-log.md` AP4-1.
      // No rotation: a rectangle turned by 90 degrees is the same rectangle with
      // width and depth swapped, and that is exactly how P2 aligns the footprint
      // to the connection axis. The rotation formula from `cells.ts` (AP2)
      // therefore stays unused rather than half-used in the auto generator —
      // see `design/decisions-log.md` AP4-1.
      drehung: 0,
      // Abgeleitet, nicht gezogen: derselbe Strom-Seed, den der Bestuecker
      // ueber `mische(seeds.deko, id)` bildet (`data-model.md` §2.1/§2.5).
      // Derived, not drawn: the same stream seed the furnisher forms via
      // `mische(seeds.deko, id)` (`data-model.md` §2.1/§2.5).
      seed: mische(seeds.deko, id),
      variante: varianteFuerStempel({ x, z, ebene }, seeds.material),
      // Die Setzreihenfolge IST die Auftragsreihenfolge. Fussabdruecke
      // ueberlappen im Auto-Generator nie (P2 prueft das Rechteck), `ordnung`
      // ist hier also nur die stabile Sortierung fuer `kanonisch()`.
      // The placement order IS the application order. Footprints never overlap
      // in the auto generator (P2 checks the rectangle), so `ordnung` here is
      // just the stable sort for `kanonisch()`.
      ordnung: id,
      tiefeImBaum,
    };
    stempel.push(s);
    eltern.set(id, elternId);
    for (let dx = 0; dx < breite; dx++) {
      for (let dz = 0; dz < tiefe; dz++) {
        belegung.set(schluesselZelle(x + dx, z + dz, ebene), id);
      }
    }
    return s;
  };

  /**
   * Traegt bis zu `ausgaenge` neue Anschluesse eines frisch gesetzten Stempels
   * in die Wachstumsfront ein. Kandidaten sind seine Randkanten mit freier
   * Nachbarzelle, ohne die Kante zurueck zum Elternraum.
   * Adds up to `ausgaenge` new frontier edges of a freshly placed stamp.
   * Candidates are its perimeter edges with a free neighbour, minus the edge
   * leading back to the parent room.
   */
  const neueAnschluesse = (s: RaumStempel, profil: RaumTypProfil, rueckKante?: KantenPlatz): void => {
    const rest = randKanten(s).filter((k) => {
      if (
        rueckKante !== undefined &&
        k.x === rueckKante.x &&
        k.z === rueckKante.z &&
        k.kante === rueckKante.kante
      ) {
        return false;
      }
      const n = nachbarZelle(k.x, k.z, k.kante);
      return frei(n.x, n.z, k.ebene);
    });
    const wunsch = arch.rangeInt(profil.ausgaenge[0], profil.ausgaenge[1] + 1);
    const anzahl = Math.min(wunsch, rest.length);
    for (let i = 0; i < anzahl; i++) {
      const j = arch.rangeInt(0, rest.length);
      const k = rest.splice(j, 1)[0]!;
      anschluesse.push({ ...k, stempelId: s.id, tiefe: s.tiefeImBaum });
    }
  };

  /** Zaehlt, wie oft ein Raumtyp schon steht. / Counts placed rooms of a type. */
  const anzahlTyp = (typ: RaumTyp): number => stempel.reduce((n, s) => n + (s.typ === typ ? 1 : 0), 0);

  /**
   * Zieht einen Raumtyp gewichtet aus den an dieser Stelle erlaubten. Die
   * Kandidatenliste behaelt die Reihenfolge aus `thema.raumTypen` — eine feste
   * Datenliste, keine Mengeniteration.
   * Draws a room type by weight from those allowed here. The candidate list
   * keeps the order of `thema.raumTypen` — a fixed data list, not a set
   * iteration.
   */
  const zieheTyp = (a: Anschluss, nurEchteRaeume = false): RaumTypProfil | undefined => {
    const kandidaten = thema.raumTypen.filter((p) => {
      if (p.gewicht <= 0) return false;
      if (p.minTiefe !== undefined && a.tiefe + 1 < p.minTiefe) return false;
      if (p.maxAnzahl !== undefined && anzahlTyp(p.typ) >= p.maxAnzahl) return false;
      if (p.typ === 'treppe' && a.ebene + 1 > grenzen.maxEbene) return false;
      // An einer Schachtmuendung zaehlt nur ein echter Raum. `nische` und
      // `abschluss` sind 1x1-Verschlaege ohne eigene Ausgaenge — sie machen aus
      // der Sackgasse eine Sackgasse mit einem Schritt mehr, und ein zweites
      // Treppenhaus verschiebt die Frage nur eine Ebene hoeher.
      // At a shaft mouth only a real room counts. `nische` and `abschluss` are
      // 1x1 closets without exits of their own — they turn the dead end into a
      // dead end plus one step — and a second stairwell merely moves the
      // question one storey up.
      if (nurEchteRaeume && (p.typ === 'treppe' || p.typ === 'nische' || p.typ === 'abschluss')) {
        return false;
      }
      return true;
    });
    if (kandidaten.length === 0) return undefined;
    let summe = 0;
    for (const p of kandidaten) summe += p.gewicht;
    let r = arch.rangeInt(0, summe);
    for (const p of kandidaten) {
      r -= p.gewicht;
      if (r < 0) return p;
    }
    return kandidaten[kandidaten.length - 1];
  };

  // Korrekturen werden je Zelle gesammelt und erst am Ende zu genau EINEM
  // Eintrag verschmolzen — zwei Korrekturen auf derselben Zelle waeren
  // reihenfolgeabhaengig und werden von `validateLayout` als
  // `doppelte-korrektur` abgelehnt.
  // Fixes are collected per cell and merged into exactly ONE entry at the end —
  // two fixes on the same cell would be order dependent and are rejected by
  // `validateLayout` as `doppelte-korrektur`.
  interface KorrekturRoh {
    readonly x: number;
    readonly z: number;
    readonly ebene: number;
    art?: ZellenArt;
    boden?: number;
    decke?: number;
    neigung?: Kante;
    wandErzwungen?: number;
    durchgangErzwungen?: number;
  }
  const korrekturRoh = new Map<string, KorrekturRoh>();
  const korrekturEintrag = (x: number, z: number, ebene: number): KorrekturRoh => {
    const schluessel = schluesselZelle(x, z, ebene);
    const vorhanden = korrekturRoh.get(schluessel);
    if (vorhanden !== undefined) return vorhanden;
    const neu: KorrekturRoh = { x, z, ebene };
    korrekturRoh.set(schluessel, neu);
    return neu;
  };
  const setzeArt = (x: number, z: number, ebene: number, art: ZellenArt): void => {
    korrekturEintrag(x, z, ebene).art = art;
  };
  const mauereKante = (x: number, z: number, ebene: number, kante: Kante): void => {
    const e = korrekturEintrag(x, z, ebene);
    e.wandErzwungen = (e.wandErzwungen ?? 0) | kante;
  };
  /**
   * Macht eine Zelle zur Treppenstufe eines Laufs: Art, Anstiegsrichtung und
   * die Bodenhoehe an der TIEFEN Kante (`Zelle.boden` ist laut Format genau
   * das). Die lichte Hoehe bleibt beim Stempel — sie ist kein Sonderfall der
   * Treppe, sondern die gewoehnliche Raumhoehe ueber DIESEM Boden.
   * Turns a cell into one run of a staircase: kind, ascent direction and the
   * floor height at the LOW edge (per the format that is exactly what
   * `Zelle.boden` is). The clear height stays with the stamp — it is no special
   * case of the stair but the ordinary room height above THIS floor.
   */
  const setzeTreppe = (
    x: number,
    z: number,
    ebene: number,
    neigung: Kante,
    boden: number,
    decke: number
  ): void => {
    const e = korrekturEintrag(x, z, ebene);
    e.art = ZELLEN_ART.Treppe;
    e.neigung = neigung;
    e.boden = boden;
    // Die lichte Hoehe kommt als KORREKTUR, nicht als Stempelhoehe: der oberste
    // Lauf endet an der Ebenensohle und ist damit nur 5 Stufen hoch, waehrend
    // die Dokumentregel `stempel-lichte` von jedem Stempel `MIN_LICHTE_STUFEN`
    // verlangt. Sie darf das auch — ein Stempel kennt keinen Schacht. Dass die
    // Saeule dieses Laufs durch die Muendung weiterlaeuft, weiss erst das
    // Gitter, und dort prueft `lichte-hoehe` (validation.ts) genau das.
    // The clear height arrives as a FIX, not as a stamp height: the topmost run
    // ends at the storey sole and is thus only 5 steps tall, while the document
    // rule `stempel-lichte` demands `MIN_LICHTE_STUFEN` of every stamp. It may:
    // a stamp knows nothing of a shaft. That this run's column continues through
    // the mouth is known only to the grid, and there `lichte-hoehe` checks it.
    e.decke = decke;
  };
  /**
   * Erzwingt einen Durchgang an einer Kante. Innerhalb eines Treppenlaufs
   * unterscheiden sich die Bodenhoehen zweier Nachbarzellen um mehr als eine
   * Stufe, und die abgeleitete Wandregel (§3.3) wuerde den Lauf sonst genau in
   * der Mitte zumauern — der Fehler haette kein Symptom ausser „diese Treppe
   * fuehrt nirgendwohin".
   * Forces an opening on an edge. Inside a staircase run two neighbouring cells
   * differ in floor height by more than one step, and the derived wall rule
   * (§3.3) would otherwise wall the run up right in its middle — a fault whose
   * only symptom would be "this staircase leads nowhere".
   */
  const oeffneKante = (x: number, z: number, ebene: number, kante: Kante): void => {
    const e = korrekturEintrag(x, z, ebene);
    e.durchgangErzwungen = (e.durchgangErzwungen ?? 0) | kante;
  };

  // ── P1: Eingang ─────────────────────────────────────────────────────────
  // P1: entrance.
  const eingangProfil = profilFuer(thema, 'eingang');
  const eingangBreite = arch.rangeInt(
    eingangProfil?.breite[0] ?? 3,
    (eingangProfil?.breite[1] ?? 3) + 1
  );
  const eingangTiefe = arch.rangeInt(
    eingangProfil?.tiefe[0] ?? 3,
    (eingangProfil?.tiefe[1] ?? 3) + 1
  );
  const eingangHoehe = arch.rangeInt(
    eingangProfil?.hoehe[0] ?? 10,
    (eingangProfil?.hoehe[1] ?? 10) + 1
  );
  // Der Ursprung IST die Eingangszelle, die Eingangskante zeigt nach Sued —
  // `data-model.md` §2.3 P1, wie heute der Eingangs-Connector.
  // The origin IS the entrance cell, the entrance edge faces south —
  // `data-model.md` §2.3 P1, like today's entrance connector.
  const eingangStempel = setzeStempel(
    'eingang',
    0,
    0,
    grenzen.minEbene,
    eingangBreite,
    eingangTiefe,
    eingangHoehe,
    0,
    -1
  );
  neueAnschluesse(eingangStempel, eingangProfil ?? thema.raumTypen[0]!, {
    x: 0,
    z: 0,
    ebene: grenzen.minEbene,
    kante: KANTE.Sued,
  });

  // ── P2/P3/P4: Wachstum, Gaenge, Ebenen ──────────────────────────────────
  // P2/P3/P4: growth, corridors, storeys.
  //
  // Gaenge sind gewoehnliche Stempel (1xL) und entstehen hier mit, nicht als
  // Sonderweg (P3). Ebenen entstehen ueber `treppe`-Stempel, die ZWEI Ebenen
  // spannen und deren Belegungspruefung ueber beide laeuft (P4).
  // Corridors are ordinary stamps (1xL) and arise here, not on a special path
  // (P3). Storeys arise through `treppe` stamps that span TWO storeys and whose
  // occupancy check runs over both (P4).
  const versucheZuSetzen = (profil: RaumTypProfil, a: Anschluss, n: { x: number; z: number }): boolean => {
    let breite = arch.rangeInt(profil.breite[0], profil.breite[1] + 1);
    let tiefe = arch.rangeInt(profil.tiefe[0], profil.tiefe[1] + 1);
    const hoehe = arch.rangeInt(profil.hoehe[0], profil.hoehe[1] + 1);

    // Fussabdruck an der Anschlussachse ausrichten: Ein Gang, der nach Osten
    // abgeht, ist entlang x lang — sonst waere `gangLaenge` nur in einer
    // Himmelsrichtung wirksam.
    // Align the footprint to the connection axis: a corridor leaving to the east
    // is long along x — otherwise `gangLaenge` would only take effect in one
    // compass direction.
    const laengsX = a.kante === KANTE.Ost || a.kante === KANTE.West;
    if (laengsX) {
      const tausch = breite;
      breite = tiefe;
      tiefe = tausch;
    }
    const querMass = laengsX ? tiefe : breite;
    const versatz = arch.rangeInt(0, querMass);

    let x: number;
    let z: number;
    if (a.kante === KANTE.Nord) {
      x = n.x - versatz;
      z = n.z;
    } else if (a.kante === KANTE.Sued) {
      x = n.x - versatz;
      z = n.z - tiefe + 1;
    } else if (a.kante === KANTE.Ost) {
      x = n.x;
      z = n.z - versatz;
    } else {
      x = n.x - breite + 1;
      z = n.z - versatz;
    }

    const rueckKante: KantenPlatz = { x: n.x, z: n.z, ebene: a.ebene, kante: gegenKante(a.kante) };

    if (profil.typ === 'treppe') {
      // Ein Treppenaufgang belegt DREI Zellen auf zwei Ebenen: zwei
      // Treppenzellen auf der unteren Ebene, die den Ebenenabstand in zwei
      // gleichen Laeufen ueberwinden, und darueber die Schachtmuendung, in die
      // der obere Lauf austritt. Die Pruefung laeuft ueber ALLE drei — der
      // Altgenerator hat genau hier gepatzt (`roomBodyFromFloor`,
      // `data-model.md` §2.3 P4).
      // A staircase occupies THREE cells on two storeys: two stair cells on the
      // lower storey that span the storey gap in two equal runs, and above them
      // the shaft mouth the upper run emerges into. The check runs over ALL
      // three — this is exactly where the old generator slipped.
      if (a.ebene + 1 > grenzen.maxEbene) return false;
      if (belegung.size + 2 * TREPPE_ANSTIEGE.length > ziel[1]) return false;
      // Die Zellen der Laeufe, in Anstiegsrichtung hintereinander. Der letzte
      // traegt die Muendung ueber sich.
      // The run cells, one behind the other along the ascent. The last one
      // carries the mouth above it.
      const laufZellen: { x: number; z: number }[] = [{ x: n.x, z: n.z }];
      while (laufZellen.length < TREPPE_ANSTIEGE.length) {
        const vor = laufZellen[laufZellen.length - 1]!;
        laufZellen.push(nachbarZelle(vor.x, vor.z, a.kante));
      }
      const m = laufZellen[laufZellen.length - 1]!;
      for (const c of laufZellen) {
        if (!rechteckFrei(c.x, c.z, a.ebene, 1, 1)) return false;
      }
      // Ueber JEDEM Lauf muss die Zelle der Ebene darueber frei sein: das
      // Treppenhaus IST ein Schacht und belegt sie selbst.
      // Above EVERY run the cell of the storey above must be free: the stairwell
      // IS a shaft and occupies it itself.
      for (const c of laufZellen) {
        if (!rechteckFrei(c.x, c.z, a.ebene + 1, 1, 1)) return false;
      }

      // Merkposten fuer den Rueckbau. Ein Treppenhaus, an dessen Muendung oben
      // KEIN echter Raum anschliessbar ist, wird als GANZES verworfen — eine
      // Treppe in einen 1x1-Verschlag ohne Ausgang ist regelkonform und trotzdem
      // Unsinn (`erreichbar` ist erfuellt, begehbar ist sie nicht).
      // Bookmarks for the rollback. A stairwell whose mouth cannot attach to a
      // real room upstairs is discarded ENTIRELY — a staircase into a 1x1 closet
      // without an exit passes the rules and is nonsense all the same
      // (`reachable` holds, walkable it is not).
      const zurueckId = naechsteId;
      const zurueckStempel = stempel.length;
      const zurueckVerbindungen = verbindungsListe.length;
      const zurueckAnschluesse = anschluesse.length;
      const verwirfTreppenhaus = (): void => {
        for (let i = stempel.length - 1; i >= zurueckStempel; i--) {
          const s = stempel[i]!;
          for (let dx = 0; dx < s.breite; dx++) {
            for (let dz = 0; dz < s.tiefe; dz++) {
              belegung.delete(schluesselZelle(s.x + dx, s.z + dz, s.ebene));
            }
          }
          eltern.delete(s.id);
          treppenLaeufe.delete(s.id);
        }
        stempel.length = zurueckStempel;
        naechsteId = zurueckId;
        for (let i = verbindungsListe.length - 1; i >= zurueckVerbindungen; i--) {
          verbindungen.delete(kantenSchluessel(verbindungsListe[i]!));
        }
        verbindungsListe.length = zurueckVerbindungen;
        anschluesse.length = zurueckAnschluesse;
        // Die drei Zellen des Treppenhauses waren vor dem Setzen frei, ihre
        // Korrektureintraege koennen also nur von hier stammen.
        // The stairwell's three cells were free before placement, so their fix
        // entries can only come from here.
        for (const c of laufZellen) {
          korrekturRoh.delete(schluesselZelle(c.x, c.z, a.ebene));
          korrekturRoh.delete(schluesselZelle(c.x, c.z, a.ebene + 1));
        }
      };

      const laufStempel: RaumStempel[] = [];
      let elternId = a.stempelId;
      for (let i = 0; i < TREPPE_ANSTIEGE.length; i++) {
        const c = laufZellen[i]!;
        const lauf = setzeStempel(
          'treppe',
          c.x,
          c.z,
          a.ebene,
          1,
          1,
          MIN_LICHTE_STUFEN,
          a.tiefe + 1 + i,
          elternId
        );
        laufStempel.push(lauf);
        elternId = lauf.id;
      }
      // UEBER JEDEM Lauf eine Schachtzelle, nicht nur ueber dem obersten.
      //
      // Ein Treppenhaus IST ein Schacht. Wer nur die Muendung als `Schacht`
      // setzt und die Zellen ueber den unteren Laeufen als Fels stehen laesst,
      // gibt diesen Laeufen eine DECKENPLATTE — und die liegt bei einer Ebene
      // von 16 Stufen zwangslaeufig knapp: Gemessen blieb die Kapsel (1,8 m) am
      // Uebergang vom mittleren zum obersten Lauf haengen, weil ihr Kopf in die
      // Deckenplatte des mittleren stiess (`client/test/dungeon2-laeufer.ts`,
      // Seeds 2 und 5, je zwei Haenger, in beide Richtungen).
      // Es gibt keinen Deckenwert, der das aufloest: unter 16 ist der Kopfraum
      // zu klein, bei 16 faellt die Unterseite der Platte mit der Unterseite der
      // Muendungswand zusammen (4,00 m x 0,50 m koplanar, (F)), ueber 16 ragt
      // die lichte Saeule in die Ebene darueber ((G)). Ohne Platte gibt es die
      // Frage nicht mehr.
      // A SHAFT CELL ABOVE EVERY RUN, not only above the topmost. A stairwell IS
      // a shaft. Setting only the mouth as `Schacht` leaves the lower runs with a
      // CEILING SLAB, and with a 16 step storey that slab is inevitably tight:
      // measured, the capsule got stuck at the transition from the middle to the
      // topmost run because its head hit the middle run's ceiling slab. No
      // ceiling value resolves it; without a slab the question disappears.
      const schaechte: RaumStempel[] = [];
      for (let i = 0; i < laufZellen.length; i++) {
        const c = laufZellen[i]!;
        schaechte.push(
          setzeStempel(
            'treppe',
            c.x,
            c.z,
            a.ebene + 1,
            1,
            1,
            hoehe,
            a.tiefe + 1 + TREPPE_ANSTIEGE.length + i,
            elternId
          )
        );
      }
      const muendung = schaechte[schaechte.length - 1]!;
      // Jeder Lauf traegt seine Bodenhoehe an der TIEFEN Kante; der oberste
      // tritt nach oben in die Muendung aus.
      // Each run carries its floor height at the LOW edge; the topmost emerges
      // upwards into the mouth.
      for (let i = 0; i < TREPPE_ANSTIEGE.length; i++) {
        const c = laufZellen[i]!;
        setzeTreppe(
          c.x,
          c.z,
          a.ebene,
          a.kante,
          TREPPE_BODEN[i]!,
          TREPPE_DECKE_STUFEN - TREPPE_BODEN[i]!
        );
      }
      // Ein Treppenhaus ist eine Roehre: alles ausser Fuss und Kopf des Laufs
      // wird zugemauert. Das ist nicht Geschmack. Ein Raum, der spaeter seitlich
      // an den OBEREN Lauf stoesst, stiesse an eine Zelle, deren Boden 4 m
      // hoeher liegt — die Ableitung setzt dort zwar eine Wand, aber eine Tuer
      // auf derselben Kante schlaegt sie wieder auf (`durchgangErzwungen`
      // gewinnt), und dahinter liegt der massive Unterbau der Treppe. Der
      // Fehler zeigte sich als Loch in der Wand, nicht als Fehlermeldung.
      // A stairwell is a tube: everything but the run's foot and head is walled
      // up. Not a matter of taste. A room later abutting the UPPER run sideways
      // would meet a cell whose floor is 4 m higher — the derivation does put a
      // wall there, but a door on the same edge tears it open again
      // (`durchgangErzwungen` wins), and behind it lies the stair's solid
      // substructure. The fault showed as a hole in a wall, not as a finding.
      const quer: readonly Kante[] =
        a.kante === KANTE.Nord || a.kante === KANTE.Sued
          ? [KANTE.Ost, KANTE.West]
          : [KANTE.Nord, KANTE.Sued];
      for (const q of quer) {
        for (const c of laufZellen) mauereKante(c.x, c.z, a.ebene, q);
        // Auf der oberen Ebene wird die MUENDUNG ausgenommen: sie ist der
        // Ausgang, und ihre Querkanten sind die Kandidaten, an denen der Raum
        // oben anwaechst. Wer sie mitzumauert, laesst den Raum HINTER einer Wand
        // entstehen — gemessen 35 von 200 Seeds mit `erreichbar`-Befund und
        // Rueckfall auf die einfache Form.
        // On the upper storey the MOUTH is exempt: it is the exit, and its cross
        // edges are the candidates the upstairs room grows from. Walling them
        // grows the room BEHIND a wall — measured, 35 of 200 seeds fell back.
        for (const c of laufZellen.slice(0, -1)) mauereKante(c.x, c.z, a.ebene + 1, q);
      }
      mauereKante(m.x, m.z, a.ebene, a.kante);
      // Der Fuss des Schachts wird zugemauert: dort ist er nur Luft ueber dem
      // untersten Lauf, und ein Raum, der sich dort anlegte, blickte in ein
      // Loch. Die MUENDUNG bleibt offen — sie ist der Ausgang.
      // The shaft's foot is walled: there it is mere air above the lowest run.
      // The MOUTH stays open — it is the exit.
      mauereKante(laufZellen[0]!.x, laufZellen[0]!.z, a.ebene + 1, gegenKante(a.kante));
      for (const lauf of laufStempel) treppenLaeufe.add(lauf.id);
      // Aus den Schachtzellen UNTER der Muendung waechst nichts: sie sind Luft
      // ueber der Treppe, kein Zimmer.
      // Nothing grows out of the shaft cells below the mouth: they are air above
      // the stairs, not a room.
      for (const sch of schaechte.slice(0, -1)) treppenLaeufe.add(sch.id);
      // Die Kante zwischen den beiden Laeufen: 8 Hoehenstufen Unterschied
      // erzwingen nach §3.3 eine Wand, die den Lauf in der Mitte zumauern
      // wuerde.
      // The edge between the two runs: 8 height steps of difference force a
      // wall per §3.3 that would seal the run in its middle.
      for (const c of laufZellen.slice(0, -1)) oeffneKante(c.x, c.z, a.ebene, a.kante);
      // Die Muendung wird `Schacht` — die einzige Zellenart, ueber die
      // `erreichbareZellen()` (cells.ts, AP2) senkrecht laeuft, und die einzige,
      // die keine Bodenplatte bekommt, wenn unter ihr etwas Offenes liegt.
      // The mouth becomes `Schacht` — the only cell type through which
      // `erreichbareZellen()` (cells.ts, AP2) travels vertically, and the only
      // one that gets no floor slab when something open lies below it.
      for (const c of laufZellen) setzeArt(c.x, c.z, a.ebene + 1, ZELLEN_ART.Schacht);
      verbindungHinzu(a.x, a.z, a.ebene, a.kante);
      // Die Muendung MUSS an einen echten Raum derselben Ebene anschliessen.
      // Vorher hing das am Zufall: die Muendung wurde nur als Wachstumsfront
      // eingetragen, und wenn die Zielgroesse vorher erreicht war (oder die
      // gezogene Ausgangszahl 1 lautete und die Kante ins Gestein zeigte), blieb
      // oben ein 1x1-Verschlag stehen — bei Seed 2 vier von sechs Muendungen.
      // Deshalb waechst hier SOFORT ein Raum aus der Muendung, statt es der
      // Hauptschleife zu ueberlassen.
      // The mouth MUST attach to a real room on the same storey. Before, this
      // was left to chance: the mouth was merely registered as a frontier edge,
      // and if the target size had already been reached (or the drawn exit count
      // was 1 and that edge pointed into rock), a 1x1 closet stayed up there —
      // four of six mouths at seed 2. So a room is grown out of the mouth RIGHT
      // HERE instead of leaving it to the main loop.
      // GERADEAUS ZUERST.
      //
      // Die Muendung hat keine Bodenplatte — unter ihr steht die Rampe, und die
      // erreicht die Ebenensohle erst an ihrer OBEREN Kante. In der Zellmitte
      // steht man 1,25 m TIEFER. Tritt die Figur geradeaus aus, laeuft sie die
      // Rampe hinauf und ohne Absatz auf die Bodenplatte des Raums. Jede ANDERE
      // offene Kante der Muendung waere eine Stufe von 1,25 m, und Havoks
      // Charaktercontroller kennt keine Stufenhoehe: gemessen blieb die Kapsel
      // an genau solchen Kanten stehen (`client/test/dungeon2-laeufer.ts`,
      // Seed 5, Zellen (9,4,E1) und (11,4,E1)). Deshalb bleibt am Ende GENAU
      // EINE Kante offen — die, durch die der Raum gewachsen ist.
      // STRAIGHT AHEAD FIRST. The mouth has no
      // floor slab; at its centre one stands 1.25 m below the storey sole.
      // Straight ahead the figure walks up the ramp onto the room's floor with no
      // step; every OTHER open edge of the mouth is a 1.25 m step, and Havok's
      // character controller knows no step height. Those edges stay open and are
      // carried as a documented residue: walling them made 35 of 200 seeds
      // unreachable (measured).
      const obenKanten = randKanten(muendung).filter((k) => {
        const o = nachbarZelle(k.x, k.z, k.kante);
        return frei(o.x, o.z, k.ebene);
      });
      const geradeaus = obenKanten.findIndex((k) => k.kante === a.kante);
      if (geradeaus > 0) obenKanten.unshift(obenKanten.splice(geradeaus, 1)[0]!);
      let angebunden = false;
      // Der bevorzugte Ausgang wird OHNE Ziehung genommen — sonst verschoebe die
      // Bevorzugung den Architekturstrom (W7).
      // The preferred exit is taken WITHOUT a draw.
      let ersterVersuch = obenKanten.length > 0 && obenKanten[0]!.kante === a.kante;
      while (obenKanten.length > 0 && !angebunden) {
        const j = ersterVersuch ? 0 : arch.rangeInt(0, obenKanten.length);
        ersterVersuch = false;
        const k = obenKanten.splice(j, 1)[0]!;
        const o = nachbarZelle(k.x, k.z, k.kante);
        const anOben: Anschluss = { ...k, stempelId: muendung.id, tiefe: muendung.tiefeImBaum };
        for (let versuch = 0; versuch < MAX_TYP_VERSUCHE; versuch++) {
          const obenProfil = zieheTyp(anOben, true);
          if (obenProfil === undefined) break;
          if (versucheZuSetzen(obenProfil, anOben, o)) {
            angebunden = true;
            break;
          }
        }
      }
      if (!angebunden) {
        verwirfTreppenhaus();
        return false;
      }
      // Die Laeufe bekommen keine eigenen Ausgaenge — sie sind der Aufstieg,
      // nicht ein Raum. Die Front waechst an der Muendung weiter.
      // The runs get no exits of their own — they are the ascent, not a room.
      // The frontier grows at the mouth.
      neueAnschluesse(muendung, profil, undefined);
      return true;
    }

    if (belegung.size + breite * tiefe > ziel[1]) return false;
    if (!rechteckFrei(x, z, a.ebene, breite, tiefe)) return false;

    const s = setzeStempel(profil.typ, x, z, a.ebene, breite, tiefe, hoehe, a.tiefe + 1, a.stempelId);
    verbindungHinzu(a.x, a.z, a.ebene, a.kante);
    neueAnschluesse(s, profil, rueckKante);
    return true;
  };

  /** Front aus allen Randkanten aller Stempel neu aufbauen. / Rebuild the frontier. */
  const nachwuchs = (): void => {
    const alle = [...stempel].sort((p, q) => p.ordnung - q.ordnung || p.id - q.id);
    for (const s of alle) {
      if (treppenLaeufe.has(s.id)) continue;
      for (const k of randKanten(s)) {
        const n = nachbarZelle(k.x, k.z, k.kante);
        if (frei(n.x, n.z, k.ebene)) {
          anschluesse.push({ ...k, stempelId: s.id, tiefe: s.tiefeImBaum });
        }
      }
    }
  };

  let schritte = 0;
  while (belegung.size < zielMenge && schritte < MAX_SCHRITTE) {
    schritte++;
    if (anschluesse.length === 0) {
      nachwuchs();
      if (anschluesse.length === 0) break;
    }
    const i = arch.rangeInt(0, anschluesse.length);
    const a = anschluesse.splice(i, 1)[0]!;
    const n = nachbarZelle(a.x, a.z, a.kante);
    if (!frei(n.x, n.z, a.ebene)) continue;
    for (let versuch = 0; versuch < MAX_TYP_VERSUCHE; versuch++) {
      const profil = zieheTyp(a);
      if (profil === undefined) break;
      if (versucheZuSetzen(profil, a, n)) break;
    }
  }

  // ── P2b: deterministische Auffuellung ───────────────────────────────────
  // P2b: deterministic filler.
  //
  // Wenn das gewichtete Wachstum die Untergrenze nicht erreicht (jeder freie
  // Platz ist zu klein fuer die gezogenen Typen), fuellt eine ZIEHUNGSFREIE
  // Regel auf: die kanonisch erste freie Zelle neben einem Stempel bekommt
  // einen 1x1-`abschluss`. Kein Neuwuerfeln (das kostet Determinismus-
  // Klarheit, `ARCHITECTURE.md` AP4) und kein Notfallzweig ohne Pruefung.
  // If weighted growth misses the lower bound (every free spot is too small for
  // the drawn types), a DRAW-FREE rule fills up: the canonically first free cell
  // next to a stamp receives a 1x1 `abschluss`. No re-rolling (that costs
  // determinism clarity, `ARCHITECTURE.md` AP4) and no unchecked emergency
  // branch.
  const abschlussProfil = profilFuer(thema, 'abschluss');
  while (belegung.size < zielMenge && auffuellungen < MAX_AUFFUELLUNGEN) {
    let bester: { k: KantenPlatz; eltern: RaumStempel } | undefined;
    const alle = [...stempel].sort((p, q) => p.ordnung - q.ordnung || p.id - q.id);
    for (const s of alle) {
      if (treppenLaeufe.has(s.id)) continue;
      for (const k of randKanten(s)) {
        const n = nachbarZelle(k.x, k.z, k.kante);
        if (!frei(n.x, n.z, k.ebene)) continue;
        const kandidat: KantenPlatz = { x: n.x, z: n.z, ebene: k.ebene, kante: k.kante };
        if (bester === undefined || kantenVergleich(kandidat, bester.k) < 0) {
          bester = { k: kandidat, eltern: s };
        }
      }
    }
    if (bester === undefined) break;
    const p = bester.k;
    const neu = setzeStempel(
      'abschluss',
      p.x,
      p.z,
      p.ebene,
      1,
      1,
      abschlussProfil?.hoehe[0] ?? 8,
      bester.eltern.tiefeImBaum + 1,
      bester.eltern.id
    );
    verbindungHinzu(p.x, p.z, p.ebene, gegenKante(p.kante));
    auffuellungen++;
    void neu;
  }

  // ── Beruehrungskanten: Vorrat fuer P5 und P7 ────────────────────────────
  // Contact edges: the stock for P5 and P7.
  //
  // Zwei begehbare Nachbarzellen sind ohne Zutun OFFEN (abgeleitete Wandregel,
  // §3.3) — im Zellmodell ist die Frage also nicht "wo mache ich auf", sondern
  // "wo mache ich zu". Jede Kante zwischen zwei VERSCHIEDENEN Stempeln, die
  // keine Verbindung ist, ist ein Kandidat: P5 nimmt einen Teil als Schleife,
  // P7 mauert den Rest zu.
  // Two walkable neighbours are OPEN by default (derived wall rule, §3.3) — in
  // the cell model the question is not "where do I open" but "where do I close".
  // Every edge between two DIFFERENT stamps that is not a connection is a
  // candidate: P5 takes a share as loops, P7 walls up the rest.
  const beruehrungen: KantenPlatz[] = [];
  {
    const zellenListe = [...belegung.keys()]
      .map((k) => {
        const teile = k.split('|');
        return { ebene: Number(teile[0]), z: Number(teile[1]), x: Number(teile[2]) };
      })
      .sort((p, q) => p.ebene - q.ebene || p.z - q.z || p.x - q.x);
    for (const c of zellenListe) {
      const idA = belegung.get(schluesselZelle(c.x, c.z, c.ebene));
      // Nur die kanonischen Kanten Nord und Ost besuchen — sonst zaehlt jede
      // Kante zweimal (`layout.ts` `istKanonischeKante`).
      // Visit only the canonical edges north and east — otherwise every edge
      // counts twice (`layout.ts` `istKanonischeKante`).
      for (const kante of [KANTE.Nord, KANTE.Ost] as const) {
        const n = nachbarZelle(c.x, c.z, kante);
        const idB = belegung.get(schluesselZelle(n.x, n.z, c.ebene));
        if (idB === undefined || idA === idB) continue;
        // Eine Flanke eines Treppenlaufs ist kein Kandidat — weder fuer eine
        // Schleife (P5) noch fuer eine Tuer (P8). Der Boden eines Laufs liegt
        // bis zu 4 m ueber dem der Nachbarzelle; eine Schleife dort waere kein
        // Weg, sondern ein Loch in der Wand ueber dem massiven Unterbau. P7
        // mauert diese Kanten zwar zu, aber eine Tuer schlueg die Wand wieder
        // auf (`durchgangErzwungen` schlaegt `wandErzwungen`).
        // A stair run's flank is no candidate — neither for a loop (P5) nor for
        // a door (P8). A run's floor sits up to 4 m above its neighbour's; a
        // loop there would be no path but a hole in the wall above the solid
        // substructure. P7 does wall these edges up, but a door would tear the
        // wall open again (`durchgangErzwungen` beats `wandErzwungen`).
        if ((idA !== undefined && treppenLaeufe.has(idA)) || treppenLaeufe.has(idB)) continue;
        const platz: KantenPlatz = { x: c.x, z: c.z, ebene: c.ebene, kante };
        if (verbindungen.has(kantenSchluessel(platz))) continue;
        beruehrungen.push(platz);
      }
    }
    beruehrungen.sort(kantenVergleich);
  }

  // ── P5: Schleifen ───────────────────────────────────────────────────────
  // P5: loops.
  //
  // Ohne diese Phase ist jeder erzeugte Dungeon ein Baum, und Baeume laufen
  // sich beim Spielen als Sackgassenparcours an (`data-model.md` §2.3 P5).
  // Without this phase every generated dungeon is a tree, and trees play out as
  // a dead-end obstacle course.
  const zuMauern: KantenPlatz[] = [...beruehrungen];
  {
    const anzahl = Math.min(
      zuMauern.length,
      Math.floor(zuMauern.length * thema.schleifenAnteil + 0.5)
    );
    for (let i = 0; i < anzahl; i++) {
      const j = arch.rangeInt(0, zuMauern.length);
      const k = zuMauern.splice(j, 1)[0]!;
      verbindungHinzu(k.x, k.z, k.ebene, k.kante);
    }
  }

  // ── P6: Pflichtraeume ───────────────────────────────────────────────────
  // P6: mandatory rooms.
  //
  // Auswahl ueber eine kanonisch sortierte Kandidatenliste, NIE ueber eine
  // Iterationsreihenfolge, und ohne Ziehung — die Regel ist "der tiefste,
  // groesste, aelteste Blattraum".
  // Selection over a canonically sorted candidate list, NEVER over an iteration
  // order, and without a draw — the rule is "the deepest, largest, oldest leaf
  // room".
  {
    // Ueber die Stempelliste laufen, nicht ueber die Map — eine
    // Map-Iteration ist hier zwar unschaedlich (es entsteht nur eine
    // Mitgliedschaftsmenge), aber die Regel lautet "gar nicht", nicht
    // "nur wenn es diesmal nichts ausmacht".
    // Walk the stamp list, not the map — a map iteration would be harmless here
    // (only a membership set arises), but the rule is "not at all", not "only
    // when it happens to be harmless".
    const hatKinder = new Set<number>();
    for (const s of stempel) {
      const elternId = eltern.get(s.id) ?? -1;
      if (elternId >= 0) hatKinder.add(elternId);
    }
    const blaetter = stempel
      .filter((s) => !hatKinder.has(s.id) && s.typ !== 'eingang' && s.typ !== 'treppe')
      .sort(
        (a, b) =>
          b.tiefeImBaum - a.tiefeImBaum ||
          b.breite * b.tiefe - a.breite * a.tiefe ||
          a.id - b.id
      );
    const vergeben = new Set<number>();
    for (const typ of ['grabkammer', 'schatzkammer'] as const) {
      if (stempel.some((s) => s.typ === typ)) continue;
      const profil = profilFuer(thema, typ);
      const passend =
        blaetter.find(
          (s) =>
            !vergeben.has(s.id) &&
            profil !== undefined &&
            s.breite >= profil.breite[0] &&
            s.tiefe >= profil.tiefe[0]
        ) ?? blaetter.find((s) => !vergeben.has(s.id));
      if (passend === undefined) continue;
      vergeben.add(passend.id);
      const idx = stempel.findIndex((s) => s.id === passend.id);
      // Umtypisieren aendert Inhalt und Material, nie den Fussabdruck — der
      // Raum ist schon gewachsen, und ihn nachtraeglich zu vergroessern hiesse,
      // die Belegungspruefung von P2 zu umgehen.
      // Retyping changes content and material, never the footprint — the room
      // has already grown, and enlarging it afterwards would mean bypassing
      // P2's occupancy check.
      stempel[idx] = { ...stempel[idx]!, typ };
    }
  }

  // ── P7: Abschluesse ─────────────────────────────────────────────────────
  // P7: closures.
  //
  // Uebrige Beruehrungskanten zumauern. Offene Anschluesse, die ins Gestein
  // zeigen, brauchen nichts: Zelle gegen Fels ergibt die Wand schon aus der
  // Ableitung (`genau eine begehbar`).
  // Wall up the remaining contact edges. Open frontier edges pointing into rock
  // need nothing: cell against rock already yields the wall from the derivation
  // (`exactly one walkable`).
  for (const k of zuMauern.sort(kantenVergleich)) {
    mauereKante(k.x, k.z, k.ebene, k.kante);
  }

  // ── P8: Tueren ──────────────────────────────────────────────────────────
  // P8: doors.
  const tueren: Tuer[] = [];
  {
    const kanten = [...verbindungsListe].sort(kantenVergleich);
    for (const k of kanten) {
      if (!(arch.nextFloat() < thema.tuerChance)) continue;
      const art = thema.tuerArten[arch.rangeInt(0, thema.tuerArten.length)] ?? 'holz';
      const wuerfel = arch.rangeInt(0, 100);
      const n = nachbarZelle(k.x, k.z, k.kante);
      const idA = belegung.get(schluesselZelle(k.x, k.z, k.ebene));
      const idB = belegung.get(schluesselZelle(n.x, n.z, k.ebene));
      const anSchatzkammer = [idA, idB].some(
        (id) => id !== undefined && stempel.some((s) => s.id === id && s.typ === 'schatzkammer')
      );
      let zustand: TuerZustand = wuerfel < 55 ? 'zu' : 'offen';
      let schluessel: string | undefined;
      if (anSchatzkammer) {
        // Die Schatzkammer ist der einzige Ort, an dem eine verschlossene Tuer
        // etwas erzaehlt. Ohne `schluessel` waere sie ein Befund
        // (`tuer-feld`), nicht ein Raetsel.
        // The treasure chamber is the only place where a locked door tells a
        // story. Without a `schluessel` it would be a finding (`tuer-feld`),
        // not a puzzle.
        zustand = 'verschlossen';
        schluessel = `${thema.id}-schatzkammer`;
      }
      tueren.push(
        schluessel === undefined
          ? { x: k.x, z: k.z, ebene: k.ebene, kante: k.kante, art, zustand }
          : { x: k.x, z: k.z, ebene: k.ebene, kante: k.kante, art, zustand, schluessel }
      );
    }
  }

  // ── Dokument ohne Anker zusammensetzen / assemble the document sans anchors ─
  const baueKorrekturen = (): ZellenKorrektur[] => [...korrekturRoh.values()]
    .sort((a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x)
    .map((k) => {
      // Feste Feldreihenfolge, gesetzte Felder nur wenn belegt. `art`
      // ausgelassen heisst „Stempelwert behalten"; deshalb bekommt eine reine
      // Wandkorrektur `wandErzwungen: 0` als ausdruecklichen Grundwert, wie
      // bisher.
      // Fixed field order, fields only when set. An omitted `art` means "keep
      // the stamped value"; a pure wall fix therefore keeps its explicit
      // `wandErzwungen: 0` base value, as before.
      const aendere: ZellenAenderung = {};
      if (k.art !== undefined) (aendere as { art?: ZellenArt }).art = k.art;
      if (k.boden !== undefined) (aendere as { boden?: number }).boden = k.boden;
      if (k.decke !== undefined) (aendere as { decke?: number }).decke = k.decke;
      if (k.neigung !== undefined) (aendere as { neigung?: Kante }).neigung = k.neigung;
      if (k.wandErzwungen !== undefined || k.art === undefined) {
        (aendere as { wandErzwungen?: number }).wandErzwungen = k.wandErzwungen ?? 0;
      }
      if (k.durchgangErzwungen !== undefined) {
        (aendere as { durchgangErzwungen?: number }).durchgangErzwungen = k.durchgangErzwungen;
      }
      return { x: k.x, z: k.z, ebene: k.ebene, aendere };
    });

  const kennung = vorgaben?.id ?? `${thema.id}-${hex8(seeds.architektur)}`;
  const baueOhneAnker = (korrekturen: readonly ZellenKorrektur[]): DungeonLayout2 => ({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    id: kennung,
    name: vorgaben?.name ?? `${thema.id} ${hex8(seeds.architektur)}`,
    thema: thema.id,
    seeds,
    raster: {
      zelleM: ZELLE_M,
      ebeneM: EBENE_M,
      hoehenSchrittM: HOEHEN_SCHRITT_M,
      blockZellen: BLOCK_ZELLEN,
    },
    grenzen,
    eingang: { x: 0, z: 0, ebene: grenzen.minEbene, kante: KANTE.Sued },
    stempel,
    korrekturen,
    tueren,
    anker: [],
    pruefsumme: '',
  });

  // ── P8b: Deckenbeschnitt ────────────────────────────────────────────────
  // P8b: ceiling trim.
  //
  // Ein Stempel waehlt seine `hoehe`, BEVOR feststeht, ob spaeter ein Raum
  // ueber ihm waechst. Die Regel `ebenen-abstand` verlangt aber, dass die
  // Deckenplatte einer Zelle unter der Bodenplatte der Zelle darueber bleibt —
  // mit `DECKE_DICKE_STUFEN` + `BODEN_DICKE_STUFEN` = 4 Stufen Bauteil dazwischen
  // und einer Stufe Fels als echtem Abstand. Statt alle Raumhoehen global auf
  // dieses Maximum zu deckeln (ein Saal waere dann UEBERALL 5,5 m statt 7,5 m
  // hoch, auch dort, wo ueber ihm nur Fels steht), beschneidet diese Phase die
  // lichte Hoehe genau in den Zellen, unter denen wirklich ein Stockwerk liegt.
  // A stamp picks its `hoehe` BEFORE it is known whether a room will later grow
  // above it. The `ebenen-abstand` rule requires a cell's ceiling slab to stay
  // below the floor slab of the cell above. Rather than capping every room
  // height globally (a hall would then be 5.5 m instead of 7.5 m EVERYWHERE,
  // even where only rock sits above it), this phase trims the clear height in
  // exactly those cells that really have a storey over them.
  //
  // Die Phase zieht NICHT: sie rechnet. Sie steht deshalb nach P8 und vor P9
  // und verschiebt keine einzige Ziehung des Architekturstroms (W7).
  // The phase does not draw, it computes. It therefore sits between P8 and P9
  // and shifts no draw of the architecture stream (W7).
  {
    const vorlaeufig = zellenAufbauen(baueOhneAnker(baueKorrekturen()), materialOptionen);
    for (const zelle of zellenSortiert(vorlaeufig)) {
      if (!offen(zelle.art)) continue;
      const oben = zelleImGitter(vorlaeufig, zelle.x, zelle.z, zelle.ebene + 1);
      if (oben === undefined || !offen(oben.art)) continue;
      // Der Schacht ueber einer offenen Zelle IST die senkrechte Oeffnung —
      // dort gibt es beide Platten nicht (siehe `validation.ts`).
      // The shaft above an open cell IS the vertical opening — neither slab
      // exists there.
      if (oben.art === ZELLEN_ART.Schacht) continue;
      const bodenUnterkanteOben = bodenStufen(oben) - BODEN_DICKE_STUFEN;
      // `obenStufen` statt `boden + decke`: eine Zelle, ueber der ein Schacht
      // steht, zieht ihre lichte Saeule bis zu dessen Sohle — die faellt aber
      // schon durch die Ausnahme oben heraus. Hier sind beide gleich.
      // `obenStufen` rather than `boden + decke`; here the two coincide.
      const hoechsteDecke = bodenUnterkanteOben - DECKE_DICKE_STUFEN - 1 - bodenStufen(zelle);
      if (zelle.decke <= hoechsteDecke) continue;
      // Unter `MIN_LICHTE_STUFEN` wird NICHT beschnitten: eine Zelle, die nur
      // noch geduckt begehbar waere, ist ein Fehler des Grundrisses, kein Fall
      // fuer eine stille Korrektur. Sie bleibt stehen, `validateLayoutVoll`
      // meldet sie in P10, und der Rueckfall greift — laut statt still.
      // No trim below `MIN_LICHTE_STUFEN`: a cell that would only be walkable
      // stooping is a floor-plan error, not a case for a silent fix. It stays,
      // P10 reports it and the fallback takes over — loudly, not silently.
      if (hoechsteDecke < MIN_LICHTE_STUFEN) continue;
      korrekturEintrag(zelle.x, zelle.z, zelle.ebene).decke = hoechsteDecke;
    }
  }

  const ohneAnker = baueOhneAnker(baueKorrekturen());

  // ── P9: Deko-Anker ──────────────────────────────────────────────────────
  // P9: decor anchors.
  const gitter = zellenAufbauen(ohneAnker, materialOptionen);
  const anker = setzeAnker(
    ohneAnker,
    gitter,
    thema,
    seeds,
    grenzen,
    vorgaben?.zusatzZiehungInP9 === true
  );

  const gewachsen = mitPruefsumme({ ...ohneAnker, anker });

  // ── P10: Abnahme ────────────────────────────────────────────────────────
  // P10: acceptance.
  //
  // Ein Befund der Schwere `fehler` wirft nicht, sondern faellt auf die
  // deterministische einfache Form zurueck — NIE auf einen neuen Wurf
  // (`ARCHITECTURE.md` AP4: "nie neu wuerfeln — neu wuerfeln kostet
  // Determinismus-Klarheit").
  // A finding of severity `fehler` does not throw but falls back to the
  // deterministic simple form — NEVER to a fresh roll (`ARCHITECTURE.md` AP4:
  // "never re-roll — re-rolling costs determinism clarity").
  const befunde = validateLayoutVoll(gewachsen, materialOptionen);
  if (nurFehler(befunde).length === 0) {
    return {
      layout: gewachsen,
      rueckfall: false,
      befunde,
      zellenZahl: belegung.size,
      ebenenZahl,
      auffuellungen,
    };
  }

  const einfach = einfacheForm(thema, seeds, kennung, ohneAnker.name);
  const einfachBefunde = validateLayoutVoll(einfach, materialOptionen);
  if (nurFehler(einfachBefunde).length > 0) {
    const erste = nurFehler(einfachBefunde)[0]!;
    throw new Error(
      `dungeon2/generator: auch die einfache Form ist ungueltig (${erste.regel}: ${erste.text}) — das ist ein Fehler im Generator, kein Seed-Pech`
    );
  }
  return {
    layout: einfach,
    rueckfall: true,
    befunde: einfachBefunde,
    zellenZahl: zellenSortiert(zellenAufbauen(einfach, materialOptionen)).length,
    ebenenZahl: 1,
    auffuellungen,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. P9 im Einzelnen / P9 in detail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spannweiten der Ankerkennung. Eine Anker-Id entsteht aus der LAYOUT-POSITION
 * (grenzenrelativ), dem Ankerort und der Rolle — nie aus der Ziehreihenfolge.
 * Das ist die Zusage aus `ARCHITECTURE.md` AP13: "sonst wandert der ZDO-Zustand
 * einer geoeffneten Truhe auf eine andere, sobald sich irgendetwas an der
 * Generierung aendert".
 * Spans of the anchor id. An anchor id is formed from the LAYOUT POSITION
 * (relative to the bounds), the anchor place and the role — never from a draw
 * order. That is the promise from `ARCHITECTURE.md` AP13.
 */
const ANKER_SPANNE_XZ = 4096;
const ANKER_SPANNE_EBENE = 64;

/**
 * Positionsgebundene Ankerkennung. Ergebnis < 2^53, also eine sichere
 * Ganzzahl; `null`, wenn die Position ausserhalb der Spannweiten liegt (dann
 * gibt es lieber keinen Anker als einen mit kollidierender Id).
 * Position-bound anchor id. Result < 2^53, i.e. a safe integer; `null` if the
 * position lies outside the spans (better no anchor than one with a colliding
 * id).
 */
function ankerId(
  grenzen: DungeonLayout2['grenzen'],
  x: number,
  z: number,
  ebene: number,
  ort: number,
  rolle: string
): number | null {
  const rx = x - grenzen.minX;
  const rz = z - grenzen.minZ;
  const re = ebene - grenzen.minEbene;
  const ri = rollenIndex(rolle);
  if (rx < 0 || rx >= ANKER_SPANNE_XZ) return null;
  if (rz < 0 || rz >= ANKER_SPANNE_XZ) return null;
  if (re < 0 || re >= ANKER_SPANNE_EBENE) return null;
  if (ri < 0 || ri >= ROLLEN.length) return null;
  return (((re * ANKER_SPANNE_XZ + rz) * ANKER_SPANNE_XZ + rx) * 4 + ort) * ROLLEN.length + ri;
}

/**
 * Setzt die Deko-Anker: je Stempel ein eigener Strom aus
 * `mische(seeds.deko, stempel.id)`, darin die Muster aus `dekoMuster` in der
 * Reihenfolge des Profils. Ein eigener Strom je Stempel heisst: eine zusaetzliche
 * Ziehung in einem Raum verschiebt keinen anderen — und keinen Stempel
 * (`ARCHITECTURE.md` W7, Abnahmekriterium AP4 (e)).
 * Places the decor anchors: one own stream per stamp from
 * `mische(seeds.deko, stempel.id)`, running the patterns from `dekoMuster` in
 * profile order. One stream per stamp means an extra draw in one room shifts no
 * other — and no stamp at all.
 */
function setzeAnker(
  layout: DungeonLayout2,
  gitter: ZellenGitter,
  thema: ThemenProfil,
  seeds: LayoutSeeds,
  grenzen: DungeonLayout2['grenzen'],
  zusatzZiehung: boolean
): DekoAnker[] {
  const alle = zellenSortiert(gitter);
  const nachStempel = new Map<number, Zelle[]>();
  for (const zelle of alle) {
    const liste = nachStempel.get(zelle.stempelId);
    if (liste === undefined) nachStempel.set(zelle.stempelId, [zelle]);
    else liste.push(zelle);
  }

  const anker: DekoAnker[] = [];
  const vergebene = new Set<number>();

  const setze = (
    zelle: Zelle,
    ort: AnkerOrt,
    rolle: string,
    u: number,
    v: number,
    h: number,
    drehung: 0 | 1 | 2 | 3,
    stempelId: number,
    kante?: Kante
  ): void => {
    const id = ankerId(grenzen, zelle.x, zelle.z, zelle.ebene, ort, rolle);
    if (id === null || vergebene.has(id)) return;
    vergebene.add(id);
    const basis: DekoAnker = {
      id,
      x: zelle.x,
      z: zelle.z,
      ebene: zelle.ebene,
      ort,
      u,
      v,
      h,
      drehung,
      rolle,
      seed: mische(seeds.deko, id),
      stempelId,
    };
    anker.push(kante === undefined ? basis : { ...basis, kante });
  };

  const stempelSortiert = [...layout.stempel].sort((a, b) => a.ordnung - b.ordnung || a.id - b.id);
  for (const s of stempelSortiert) {
    const zellen = nachStempel.get(s.id) ?? [];
    if (zellen.length === 0) continue;
    const profil = profilFuer(thema, s.typ);
    if (profil === undefined) continue;

    const strom = new XorShiftRandom(mische(seeds.deko, s.id));
    // Der Messhaken aus `Erzeugungsvorgaben.zusatzZiehungInP9` — genau EINE
    // zusaetzliche Ziehung, an genau einer Stelle.
    // The measurement hook from `Erzeugungsvorgaben.zusatzZiehungInP9` —
    // exactly ONE extra draw, in exactly one place.
    if (zusatzZiehung) strom.nextInt();

    // Alle Wandkanten dieses Raums, kanonisch sortiert. Ein Wandanker MUSS an
    // einer Kante mit Wand sitzen, sonst meldet `validation.ts` `anker-in-luft`.
    // All wall edges of this room, canonically sorted. A wall anchor MUST sit on
    // an edge that has a wall, otherwise `validation.ts` reports `anker-in-luft`.
    const wandKanten: { zelle: Zelle; kante: Kante }[] = [];
    for (const zelle of zellen) {
      for (const kante of KANTEN) {
        const n = nachbarZelle(zelle.x, zelle.z, kante);
        if (wandZwischen(zelle, zelleOderLeer(gitter, n.x, n.z, zelle.ebene))) {
          wandKanten.push({ zelle, kante });
        }
      }
    }

    for (const muster of profil.dekoMuster) {
      switch (muster) {
        case 'wandfackeln': {
          for (const wk of wandKanten) {
            if (strom.rangeInt(0, 100) >= 14) continue;
            // `wandAnkerVersatz` statt `4, 4`: eine Fackel gehoert AN die
            // Wandflaeche, nicht in die Zellmitte (siehe `cells.ts`).
            // `wandAnkerVersatz` instead of `4, 4`: a torch belongs ON the wall
            // face, not in the centre of the cell.
            const w = wandAnkerVersatz(wk.kante);
            setze(wk.zelle, ANKER_ORT.Wand, 'fackel', w.u, w.v, 5, kanteZuDrehung(wk.kante), s.id, wk.kante);
          }
          break;
        }
        case 'bodenschutt': {
          for (const zelle of zellen) {
            if (strom.rangeInt(0, 100) >= 9) continue;
            const u = strom.rangeInt(1, 8);
            const v = strom.rangeInt(1, 8);
            const d = strom.rangeInt(0, 4) as 0 | 1 | 2 | 3;
            setze(zelle, ANKER_ORT.Boden, 'geroell', u, v, 0, d, s.id);
          }
          break;
        }
        case 'wandnische': {
          if (wandKanten.length === 0) break;
          const wk = wandKanten[strom.rangeInt(0, wandKanten.length)]!;
          const w = wandAnkerVersatz(wk.kante);
          setze(wk.zelle, ANKER_ORT.Wand, 'urne', w.u, w.v, 3, kanteZuDrehung(wk.kante), s.id, wk.kante);
          break;
        }
        case 'mitte-altar': {
          // Die Mitte ist gerechnet, nicht gezogen — ein Altar steht in der
          // Mitte, oder er ist kein Altar.
          // The centre is computed, not drawn — an altar stands in the centre,
          // or it is not an altar.
          const mx = s.x + ((s.breite - 1) >> 1);
          const mz = s.z + ((s.tiefe - 1) >> 1);
          const mitte = zellen.find((c) => c.x === mx && c.z === mz);
          if (mitte !== undefined) setze(mitte, ANKER_ORT.Boden, 'altar', 4, 4, 0, 0, s.id);
          break;
        }
        case 'sarkophage': {
          const rest = [...zellen];
          const anzahl = Math.min(rest.length, strom.rangeInt(1, 4));
          for (let i = 0; i < anzahl; i++) {
            const j = strom.rangeInt(0, rest.length);
            const zelle = rest.splice(j, 1)[0]!;
            const d = strom.rangeInt(0, 4) as 0 | 1 | 2 | 3;
            setze(zelle, ANKER_ORT.Boden, 'sarkophag', 4, 4, 0, d, s.id);
          }
          break;
        }
        case 'truhe': {
          const zelle = zellen[strom.rangeInt(0, zellen.length)]!;
          const d = strom.rangeInt(0, 4) as 0 | 1 | 2 | 3;
          setze(zelle, ANKER_ORT.Boden, 'truhe', 4, 4, 0, d, s.id);
          break;
        }
        case 'saeulen': {
          // Strukturell, ohne Ziehung: jede zweite Zelle in beiden Achsen, und
          // nur in Raeumen, die dafuer gross genug sind.
          // Structural, without a draw: every second cell on both axes, and only
          // in rooms large enough for it.
          if (s.breite < 5 || s.tiefe < 5) break;
          for (const zelle of zellen) {
            if ((zelle.x - s.x) % 2 !== 1 || (zelle.z - s.z) % 2 !== 1) continue;
            setze(zelle, ANKER_ORT.Boden, 'saeule', 4, 4, 0, 0, s.id);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return anker.sort((a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x || a.id - b.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Die deterministische einfache Form / the deterministic simple form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Der Rueckfall aus P10: Eingangsraum, Gang, Kammer — in einer Reihe, ohne
 * Beruehrungen, ohne Tuer, ohne Anker. Feste Zahlen, kein Strom, kein Seed:
 * Ein Rueckfall, der noch einmal zieht, waere ein zweiter Generator, den
 * niemand misst.
 * The fallback from P10: entrance room, corridor, chamber — in a line, without
 * contacts, without a door, without anchors. Fixed numbers, no stream, no seed:
 * a fallback that draws again would be a second generator that nobody measures.
 */
export function einfacheForm(
  thema: ThemenProfil,
  seeds: LayoutSeeds,
  id: string,
  name: string
): DungeonLayout2 {
  const bau = (
    stempelId: number,
    typ: RaumTyp,
    x: number,
    z: number,
    breite: number,
    tiefe: number,
    hoehe: number,
    tiefeImBaum: number
  ): RaumStempel => ({
    id: stempelId,
    typ,
    x,
    z,
    ebene: 0,
    breite,
    tiefe,
    hoehe,
    bodenVersatz: 0,
    drehung: 0,
    seed: mische(seeds.deko, stempelId),
    variante: varianteFuerStempel({ x, z, ebene: 0 }, seeds.material),
    ordnung: stempelId,
    tiefeImBaum,
  });

  return mitPruefsumme({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    id,
    name,
    thema: thema.id,
    seeds,
    raster: {
      zelleM: ZELLE_M,
      ebeneM: EBENE_M,
      hoehenSchrittM: HOEHEN_SCHRITT_M,
      blockZellen: BLOCK_ZELLEN,
    },
    grenzen: { minX: -2, maxX: 4, minZ: -1, maxZ: 13, minEbene: 0, maxEbene: 0 },
    eingang: { x: 0, z: 0, ebene: 0, kante: KANTE.Sued },
    stempel: [
      bau(0, 'eingang', 0, 0, 3, 3, 12, 0),
      bau(1, 'gang', 1, 3, 1, 5, 10, 1),
      bau(2, 'kammer', -1, 8, 5, 5, 12, 2),
    ],
    korrekturen: [],
    tueren: [],
    anker: [],
    pruefsumme: '',
  });
}
