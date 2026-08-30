/**
 * Der Zellkern des Dungeon-Generators 2.0: Stempel + Korrekturen -> Zellgitter,
 * und die eine symmetrische Wandableitung.
 * The cell core of dungeon generator 2.0: stamps + fixes -> cell grid, and the
 * one symmetric wall-derivation rule.
 *
 * Quelle: `design/ARCHITECTURE.md` §3.3/§3.6, vertieft in `design/data-model.md`
 * §1.3/§1.4. Dieses Modul ist rein: kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie.
 * Source: `design/ARCHITECTURE.md` §3.3/§3.6, detailed in `design/data-model.md`
 * §1.3/§1.4. This module is pure: no Babylon, no DOM, no `node:`, no
 * `Math.random`, no clock, no trigonometry.
 */

import type { Vector3 } from '../types.js';
import {
  EBENE_M,
  HOEHEN_SCHRITT_M,
  KANTE,
  KANTEN,
  ZELLE_M,
  ZELLEN_ART,
  gegenKante,
  nachbarZelle,
  type DungeonLayout2,
  type Kante,
  type RaumStempel,
  type Zelle,
  type ZellenArt,
} from './layout.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Das Zellgitter / the cell grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ausgerolltes Zellgitter. Sparse: Zellen, die nicht vorkommen, sind implizit
 * `ZellenArt.Leer` (Fels) — eine Karte, die jede Nicht-Wand-Zelle eintragen
 * muesste, waere fuer ein 60x60-Grab unnoetig gross und wuerde den
 * Grundsatz "der Bauer kennt nur, was da ist" verdrehen.
 * Rolled-out cell grid. Sparse: cells that are absent are implicitly
 * `ZellenArt.Leer` (solid rock) — a map that had to record every non-wall
 * cell would be needlessly large for a 60x60 barrow and would invert the
 * principle "the builder only knows what is actually there".
 *
 * Die Map-Iterationsreihenfolge ist NIE Logikquelle (Determinismus-Gesetz) —
 * jede Funktion, die eine Liste ausgibt, sortiert vorher explizit
 * (`zellenSortiert`).
 * Map iteration order is NEVER a source of logic (determinism law) — every
 * function that returns a list sorts explicitly beforehand (`zellenSortiert`).
 */
export interface ZellenGitter {
  readonly zellen: ReadonlyMap<string, Zelle>;
}

/** Schluessel einer Zellposition. Feste Feldreihenfolge wie in `layout.ts`. */
/** Key of a cell position. Fixed field order, matching `layout.ts`. */
export function schluesselZelle(x: number, z: number, ebene: number): string {
  return `${ebene}|${z}|${x}`;
}

/** Zelle an dieser Position, oder `undefined` wenn sie nicht im Gitter steht. */
/** Cell at this position, or `undefined` if it is not in the grid. */
export function zelleImGitter(gitter: ZellenGitter, x: number, z: number, ebene: number): Zelle | undefined {
  return gitter.zellen.get(schluesselZelle(x, z, ebene));
}

const LEER_STANDARD = {
  art: ZELLEN_ART.Leer as ZellenArt,
  boden: 0,
  decke: 0,
  wandErzwungen: 0,
  durchgangErzwungen: 0,
  materialTag: 0,
  oberflaeche: 0,
  stempelId: -1,
} as const;

/**
 * Virtuelle Fels-Zelle an einer Position, die nicht im Gitter steht. Wird von
 * der Wandableitung und der Erreichbarkeitspruefung benutzt, damit eine
 * fehlende Nachbarzelle (Kartenrand, ungestempeltes Feld) dieselbe Funktion
 * durchlaeuft wie eine echte — nie einen Sonderfall daneben.
 * Virtual rock cell at a position absent from the grid. Used by wall
 * derivation and the reachability check so a missing neighbour (map edge,
 * unstamped field) runs through the same function as a real one — never a
 * special case next to it.
 */
function leereZelle(x: number, z: number, ebene: number): Zelle {
  return { x, z, ebene, ...LEER_STANDARD };
}

/** Zelle an dieser Position — echt, oder eine virtuelle Fels-Zelle. */
/** Cell at this position — real, or a virtual rock cell. */
export function zelleOderLeer(gitter: ZellenGitter, x: number, z: number, ebene: number): Zelle {
  return zelleImGitter(gitter, x, z, ebene) ?? leereZelle(x, z, ebene);
}

/**
 * Alle Zellen, deterministisch sortiert nach (ebene, z, x). Die einzige Art,
 * wie dieses Modul eine Liste aus dem Gitter herausreicht — nie die rohe
 * Map-Iteration.
 * All cells, deterministically sorted by (ebene, z, x). The only way this
 * module hands out a list from the grid — never the raw map iteration.
 */
export function zellenSortiert(gitter: ZellenGitter): Zelle[] {
  return Array.from(gitter.zellen.values()).sort(
    (a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x
  );
}

/** Ist eine Zellenart begehbar/offen (alles ausser Fels)? */
/** Is a cell type walkable/open (anything but solid rock)? */
export function offen(art: ZellenArt): boolean {
  return art !== ZELLEN_ART.Leer;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wandableitung / wall derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ist ein Wert genau ein einzelnes Kantenbit? Wird von `validation.ts`
 * gebraucht, um z. B. `Zelle.neigung` zu pruefen — `layout.ts` haelt die
 * gleichnamige Pruefung fuer Dokumentfelder intern, hier ist die
 * Zellgitter-Fassung.
 * Is a value exactly one single edge bit? Used by `validation.ts` to check
 * e.g. `Zelle.neigung` — `layout.ts` keeps the like-named check internal for
 * document fields, this is the cell-grid counterpart.
 */
export function istGueltigeKante(w: unknown): w is Kante {
  return w === KANTE.Nord || w === KANTE.Ost || w === KANTE.Sued || w === KANTE.West;
}

/** Hat eine Kanten-Bitmaske dieses eine Kantenbit gesetzt? */
/** Does an edge bit mask have this one edge bit set? */
function hatKante(maske: number, kante: Kante): boolean {
  return (maske & kante) !== 0;
}

/**
 * Welche Kante fuehrt von Zelle `a` zu ihrer Kantennachbarin `b`? Wirft, wenn
 * die beiden nicht genau einen Rasterschritt entlang einer Achse auseinander
 * liegen — `wandZwischen` ist nur fuer echte Kantennachbarn definiert.
 * Which edge leads from cell `a` to its edge-neighbour `b`? Throws if the two
 * are not exactly one grid step apart along one axis — `wandZwischen` is only
 * defined for genuine edge neighbours.
 */
function kanteVonNach(a: { x: number; z: number }, b: { x: number; z: number }): Kante {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx === 0 && dz === 1) return KANTE.Nord;
  if (dx === 1 && dz === 0) return KANTE.Ost;
  if (dx === 0 && dz === -1) return KANTE.Sued;
  if (dx === -1 && dz === 0) return KANTE.West;
  throw new Error(
    `wandZwischen: Zellen (${a.x},${a.z}) und (${b.x},${b.z}) sind nicht kantenbenachbart`
  );
}

/**
 * Steht zwischen zwei Kantennachbarn eine Wand? Die eine, SYMMETRISCHE Regel
 * aus `layout.ts` §3.3 / ARCHITECTURE §3.3:
 *
 *   Wand(A,B) = ( abgeleitet(A,B) ∨ erzwungen_A ∨ erzwungen_B )
 *               ∧ ¬( durchgang_A ∨ durchgang_B )
 *   abgeleitet(A,B) = genau eine begehbar ∨ |boden_A − boden_B| > 1
 *
 * Symmetrisch per Konstruktion: Die Kante von `a` nach `b` und die Kante von
 * `b` nach `a` sind Gegenkanten (`kanteVonNach`/`gegenKante`), und jedes der
 * beiden Flag-Paare wird ODER-verknuepft, nie "die kleinere Zelle gewinnt" —
 * genau die Falle, die der Symmetrietest fangen soll.
 * Whether a wall stands between two edge neighbours. The one SYMMETRIC rule
 * from `layout.ts` §3.3 / ARCHITECTURE §3.3 (formula above). Symmetric by
 * construction: the edge from `a` to `b` and from `b` to `a` are opposite
 * edges, and each flag pair is OR-combined, never "the smaller cell wins" —
 * exactly the trap the symmetry test is meant to catch.
 *
 * Erfordert dieselbe `ebene`. Eine fehlende Nachbarin wird ueber
 * `zelleOderLeer` zu einer virtuellen Fels-Zelle — die ist niemals "begehbar",
 * traegt keine erzwungenen Kanten, und ergibt so automatisch eine Wand am
 * Kartenrand, ohne einen Sonderfall zu brauchen.
 * Requires the same `ebene`. A missing neighbour becomes a virtual rock cell
 * via `zelleOderLeer` — never "open", carries no forced edges, and thus
 * automatically yields a wall at the map edge without a special case.
 */
export function wandZwischen(a: Zelle, b: Zelle): boolean {
  if (a.ebene !== b.ebene) {
    throw new Error('wandZwischen: Zellen liegen auf verschiedenen Ebenen');
  }
  const kanteAB = kanteVonNach(a, b);
  const kanteBA = gegenKante(kanteAB);

  const aOffen = offen(a.art);
  const bOffen = offen(b.art);
  const abgeleitet = aOffen !== bOffen || (aOffen && bOffen && Math.abs(a.boden - b.boden) > 1);

  const erzwungen = hatKante(a.wandErzwungen, kanteAB) || hatKante(b.wandErzwungen, kanteBA);
  const durchgang = hatKante(a.durchgangErzwungen, kanteAB) || hatKante(b.durchgangErzwungen, kanteBA);

  return (abgeleitet || erzwungen) && !durchgang;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Stempel -> Zellen / stamps -> cells
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platzhalter-Materialtag fuer frisch gestempelte Zellen (2 = Boden-Platten,
 * siehe ARCHITECTURE W5-Tabelle). `themen.ts`/`generator.ts` (AP4) ersetzen
 * das ueber Korrekturen bzw. eigene Materiallogik durch Themen-Werte; AP2 hat
 * noch kein Themenprofil zur Verfuegung, ein fester Platzhalter ist die
 * konservative Wahl.
 * Placeholder material tag for freshly stamped cells (2 = laid floor slabs,
 * see the ARCHITECTURE W5 table). `themen.ts`/`generator.ts` (AP4) replace
 * this via fixes resp. their own material logic with themed values; AP2 has
 * no theme profile available yet, a fixed placeholder is the conservative
 * choice.
 */
const STEMPEL_MATERIAL_PLATZHALTER = 2;

/**
 * Optionen des Ausrollens. Heute genau eine: woher der `materialTag` einer
 * frisch gestempelten Zelle kommt.
 * Roll-out options. Exactly one today: where the `materialTag` of a freshly
 * stamped cell comes from.
 *
 * ENTSCHEIDUNG (AP4, siehe `design/decisions-log.md` AP4-2): `cells.ts` darf
 * `themen.ts` nicht importieren — das Dokument nennt sein Thema nur als Text,
 * und eine Themensuche im Zellkern waere eine Registry im reinen Modul. Statt
 * dessen reicht der Aufrufer, der das Thema kennt, eine reine Funktion herein.
 * Ohne Option bleibt der Platzhalter — das Verhalten von AP2, unveraendert.
 * DECISION (AP4, see `design/decisions-log.md` AP4-2): `cells.ts` must not
 * import `themen.ts` — the document names its theme only as text, and a theme
 * lookup inside the cell core would be a registry inside the pure module.
 * Instead the caller, who knows the theme, hands in a pure function. Without
 * the option the placeholder stays — AP2's behaviour, unchanged.
 */
export interface AufbauOptionen {
  readonly materialTagFuerStempel?: (stempel: RaumStempel) => number;
}

/**
 * Ein lokaler Zellversatz (vor Rasterverschiebung um die Stempelposition).
 * A local cell offset (before translating by the stamp's grid position).
 */
interface LokalerVersatz {
  readonly lx: number;
  readonly lz: number;
}

/**
 * Dreht einen lokalen Versatz innerhalb eines `breite`x`tiefe`-Fussabdrucks um
 * `drehung` Vierteldrehungen (gegen den Uhrzeigersinn, Norden = +z, Osten =
 * +x). Das Ergebnis liegt wieder bei (0,0) beginnend — die "Ankerzelle
 * (kleinste x/z-Ecke)" aus `data-model.md` §1.4 bleibt so nach jeder Drehung
 * an derselben Weltposition `stempel.x`/`stempel.z`, nur der Fussabdruck
 * selbst wechselt bei 90°/270° die Ausdehnung (breite<->tiefe).
 * Rotates a local offset within a `breite`x`tiefe` footprint by `drehung`
 * quarter turns (counter-clockwise, north = +z, east = +x). The result again
 * starts at (0,0) — the "anchor cell (smallest x/z corner)" from
 * `data-model.md` §1.4 therefore stays at the same world position
 * `stempel.x`/`stempel.z` after any rotation; only the footprint's own extent
 * swaps (breite<->tiefe) at 90°/270°.
 *
 * ENTSCHEIDUNG (nicht in ARCHITECTURE ausformuliert, siehe
 * `design/decisions-log.md` AP2-1): Diese Drehformel ist die konservative,
 * dokumentierte Wahl fuer AP2. `generator.ts` (AP4) ist der einzige heutige
 * Erzeuger von `RaumStempel.drehung` und legt sich damit erst dort fest, ob
 * diese Konvention seinen Anforderungen genuegt.
 * DECISION (not spelled out in ARCHITECTURE, see `design/decisions-log.md`
 * AP2-1): this rotation formula is the conservative, documented choice for
 * AP2. `generator.ts` (AP4) is the only producer of `RaumStempel.drehung`
 * today and is where it is actually settled whether this convention meets
 * its needs.
 */
function dreheVersatz(v: LokalerVersatz, breite: number, tiefe: number, drehung: 0 | 1 | 2 | 3): LokalerVersatz {
  switch (drehung) {
    case 0:
      return v;
    case 1:
      return { lx: v.lz, lz: breite - 1 - v.lx };
    case 2:
      return { lx: breite - 1 - v.lx, lz: tiefe - 1 - v.lz };
    default:
      return { lx: tiefe - 1 - v.lz, lz: v.lx };
  }
}

/** Alle (gedrehten) lokalen Zellversaetze eines Stempel-Fussabdrucks. */
/** All (rotated) local cell offsets of a stamp footprint. */
function stempelVersaetze(stempel: RaumStempel): LokalerVersatz[] {
  const versaetze: LokalerVersatz[] = [];
  for (let lx = 0; lx < stempel.breite; lx++) {
    for (let lz = 0; lz < stempel.tiefe; lz++) {
      versaetze.push(dreheVersatz({ lx, lz }, stempel.breite, stempel.tiefe, stempel.drehung));
    }
  }
  return versaetze;
}

/**
 * Traegt einen einzelnen Stempel auf ein Gitter auf. Erzeugt fuer jede Zelle
 * seines (gedrehten) Fussabdrucks eine begehbare Boden-Zelle und ueberschreibt
 * damit, was vorher an dieser Position stand — "spaetere Stempel
 * ueberschreiben die Zellen frueherer" (`ordnung`, ARCHITECTURE §3.4).
 * Reine Funktion: nimmt ein Gitter, gibt ein neues zurueck.
 * Applies a single stamp onto a grid. Creates a walkable floor cell for every
 * cell of its (rotated) footprint, overwriting whatever stood there before —
 * "later stamps overwrite the cells of earlier ones" (`ordnung`, ARCHITECTURE
 * §3.4). Pure function: takes a grid, returns a new one.
 */
export function stempelSetzen(
  gitter: ZellenGitter,
  stempel: RaumStempel,
  optionen?: AufbauOptionen
): ZellenGitter {
  const zellen = new Map(gitter.zellen);
  const materialTag = optionen?.materialTagFuerStempel?.(stempel) ?? STEMPEL_MATERIAL_PLATZHALTER;
  for (const { lx, lz } of stempelVersaetze(stempel)) {
    const x = stempel.x + lx;
    const z = stempel.z + lz;
    const zelle: Zelle = {
      x,
      z,
      ebene: stempel.ebene,
      art: ZELLEN_ART.Boden,
      boden: stempel.bodenVersatz,
      decke: stempel.hoehe,
      wandErzwungen: 0,
      durchgangErzwungen: 0,
      materialTag,
      oberflaeche: 0,
      stempelId: stempel.id,
    };
    zellen.set(schluesselZelle(x, z, stempel.ebene), zelle);
  }
  return { zellen };
}

/**
 * Entfernt alle Zellen, deren AKTUELLER Eigentuemer dieser Stempel ist, und
 * gibt sie auf Fels zurueck (Loeschen aus dem Gitter, implizit `Leer`).
 *
 * EINSCHRAENKUNG (dokumentiert, siehe `design/decisions-log.md` AP2-2): Diese
 * Funktion arbeitet auf dem bereits ausgerollten Gitter, nicht auf dem
 * Dokument. Lag unter dem entfernten Stempel ein FRUEHERER, jetzt
 * ueberschriebener Stempel (sich ueberlappende Raeume, "Gang durch Saal"),
 * kommen dessen Zellen NICHT zurueck — dafuer muss der Aufrufer den
 * betroffenen Stempel aus `layout.stempel` streichen und `zellenAufbauen()`
 * neu laufen lassen, die einzige vollstaendig korrekte Quelle der Wahrheit.
 * `stempelEntfernen` ist die billige Editor-Vorschau fuer den haeufigen Fall
 * "letzten gesetzten Raum wieder wegnehmen", nicht der Ersatz fuer den vollen
 * Aufbau.
 * LIMITATION (documented, see `design/decisions-log.md` AP2-2): this function
 * operates on the already rolled-out grid, not on the document. If an
 * EARLIER, now overwritten stamp lay underneath the removed one (overlapping
 * rooms, "corridor through hall"), its cells do NOT come back — for that the
 * caller must strike the affected stamp from `layout.stempel` and re-run
 * `zellenAufbauen()`, the only fully correct source of truth.
 * `stempelEntfernen` is the cheap editor preview for the common case "undo
 * the room I just placed", not a replacement for the full rebuild.
 */
export function stempelEntfernen(gitter: ZellenGitter, stempelId: number): ZellenGitter {
  const zellen = new Map(gitter.zellen);
  for (const [schluessel, zelle] of gitter.zellen) {
    if (zelle.stempelId === stempelId) zellen.delete(schluessel);
  }
  return { zellen };
}

/**
 * Rollt ein vollstaendiges Layout zum Zellgitter aus: Stempel in fester
 * Reihenfolge (`ordnung`, dann `id` als Texttiebreak — dieselbe Sortierung wie
 * `kanonisch()` in `layout.ts`, damit "gleiche `ordnung`" nie von der
 * Eingabe-Array-Reihenfolge abhaengt), dann Korrekturen NACH allen Stempeln,
 * dann Tueren (implizieren `durchgangErzwungen` auf ihrer Kante — wer eine Tuer
 * setzt, muss die Wand nicht extra oeffnen, `data-model.md` §1.5).
 * Rolls out a complete layout into the cell grid: stamps in fixed order
 * (`ordnung`, then `id` as a text tiebreak — the same sort as `kanonisch()` in
 * `layout.ts`, so "equal `ordnung`" never depends on input array order), then
 * fixes AFTER all stamps, then doors (imply `durchgangErzwungen` on their
 * edge — setting a door does not require separately opening the wall,
 * `data-model.md` §1.5).
 */
export function zellenAufbauen(layout: DungeonLayout2, optionen?: AufbauOptionen): ZellenGitter {
  const stempelSortiert = [...layout.stempel].sort((a, b) => a.ordnung - b.ordnung || a.id - b.id);
  let gitter: ZellenGitter = { zellen: new Map() };
  for (const stempel of stempelSortiert) gitter = stempelSetzen(gitter, stempel, optionen);

  const korrekturenSortiert = [...layout.korrekturen].sort(
    (a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x
  );
  const zellen = new Map(gitter.zellen);
  for (const korrektur of korrekturenSortiert) {
    const schluessel = schluesselZelle(korrektur.x, korrektur.z, korrektur.ebene);
    if (korrektur.loeschen === true) {
      zellen.delete(schluessel);
      continue;
    }
    const vorhanden = zellen.get(schluessel) ?? leereZelle(korrektur.x, korrektur.z, korrektur.ebene);
    zellen.set(schluessel, { ...vorhanden, ...korrektur.aendere, x: korrektur.x, z: korrektur.z, ebene: korrektur.ebene });
  }

  for (const tuer of layout.tueren) {
    const schluessel = schluesselZelle(tuer.x, tuer.z, tuer.ebene);
    const vorhanden = zellen.get(schluessel);
    // Eine Tuer auf Fels ist ungueltig (Regel `tuer-im-fels`, `validation.ts`)
    // — hier nur ueberspringen statt werfen, die Meldung ist Sache der Pruefung.
    // A door on rock is invalid (rule `tuer-im-fels`, `validation.ts`) — just
    // skipped here, reporting it is the validator's job.
    if (vorhanden === undefined) continue;
    zellen.set(schluessel, { ...vorhanden, durchgangErzwungen: vorhanden.durchgangErzwungen | tuer.kante });
  }

  return { zellen };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Nachbarschafts-Hilfen fuer die Invarianten (`validation.ts`, AP2)
// ─────────────────────────────────────────────────────────────────────────────

/** Ist die begehbare Nachbarzelle an dieser Kante (selbe Ebene) vorhanden? */
/** Is the walkable neighbour at this edge (same storey) present? */
export function nachbarBegehbar(gitter: ZellenGitter, zelle: Zelle, kante: Kante): boolean {
  const p = nachbarZelle(zelle.x, zelle.z, kante);
  const n = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
  return n !== undefined && offen(n.art);
}

/**
 * Alle Zellpositionen, die vom Eingang aus erreichbar sind (Flutfuellung ueber
 * offene Kanten innerhalb einer Ebene, plus vertikal durch `Schacht`-Zellen —
 * siehe `design/decisions-log.md` AP2-4). Ergebnis als Schluessel-Set, damit
 * `validation.ts` reine Mengenzugehoerigkeit prueft statt selbst zu suchen.
 * All cell positions reachable from the entrance (flood fill over open edges
 * within one storey, plus vertically through `Schacht` cells — see
 * `design/decisions-log.md` AP2-4). Result as a key set, so `validation.ts`
 * checks plain set membership instead of searching itself.
 */
export function erreichbareZellen(
  gitter: ZellenGitter,
  start: { readonly x: number; readonly z: number; readonly ebene: number }
): ReadonlySet<string> {
  const startZelle = zelleImGitter(gitter, start.x, start.z, start.ebene);
  const besucht = new Set<string>();
  if (startZelle === undefined || !offen(startZelle.art)) return besucht;

  besucht.add(schluesselZelle(start.x, start.z, start.ebene));
  const warteschlange: Zelle[] = [startZelle];
  while (warteschlange.length > 0) {
    const aktuell = warteschlange.shift()!;
    const kandidaten: Zelle[] = [];

    for (const kante of KANTEN) {
      const p = nachbarZelle(aktuell.x, aktuell.z, kante);
      const n = zelleImGitter(gitter, p.x, p.z, aktuell.ebene);
      if (n !== undefined && offen(n.art) && !wandZwischen(aktuell, n)) kandidaten.push(n);
    }
    // Schacht = "offen nach oben/unten" (layout.ts, ZellenArt-Kommentar) — die
    // einzige vertikale Verbindung zwischen zwei Ebenen. Die Bedingung haengt
    // am SCHACHT, nicht an der Zelle, von der aus man kommt: nach OBEN geht es,
    // wenn ueber einem ein Schacht steht (dieselbe Bedingung, unter der
    // `hatBodenPlatte()` die Bodenplatte weglaesst), nach UNTEN, wenn man
    // selbst der Schacht ist. Nur so ist die Verbindung in beide Richtungen
    // dieselbe — ein Treppenlauf, der in eine Schachtmuendung austritt, ist von
    // unten her sonst eine Sackgasse, und das faellt erst als „obere Ebene
    // nicht erreichbar" auf.
    // Schacht = "open upward/downward" (layout.ts) — the only vertical
    // connection between two storeys. The condition hangs on the SHAFT, not on
    // the cell one comes from: UPWARD works when a shaft stands above (the same
    // condition under which `hatBodenPlatte()` omits the floor slab), DOWNWARD
    // when one is the shaft oneself. Only that makes the link the same in both
    // directions — otherwise a stair run emerging into a shaft mouth is a dead
    // end from below, which only shows up as "upper storey unreachable".
    const darueber = zelleImGitter(gitter, aktuell.x, aktuell.z, aktuell.ebene + 1);
    if (darueber !== undefined && darueber.art === ZELLEN_ART.Schacht) kandidaten.push(darueber);
    if (aktuell.art === ZELLEN_ART.Schacht) {
      const darunter = zelleImGitter(gitter, aktuell.x, aktuell.z, aktuell.ebene - 1);
      if (darunter !== undefined && offen(darunter.art)) kandidaten.push(darunter);
    }

    for (const n of kandidaten) {
      const schluessel = schluesselZelle(n.x, n.z, n.ebene);
      if (besucht.has(schluessel)) continue;
      besucht.add(schluessel);
      warteschlange.push(n);
    }
  }
  return besucht;
}

/**
 * Zellhoehen in HOEHEN_SCHRITT_M je Ebene, ganzzahlig — Baustein fuer die
 * Ebenenabstand-Pruefung (`validation.ts`). `EBENE_M / HOEHEN_SCHRITT_M` ist
 * mit den eingefrorenen Konstanten (8 / 0.5) exakt 16, eine Ganzzahl.
 * Cell heights in height steps per storey, as an integer — building block for
 * the storey-gap check (`validation.ts`). With the frozen constants (8 / 0.5)
 * `EBENE_M / HOEHEN_SCHRITT_M` is exactly 16, an integer.
 */
export const EBENE_IN_HOEHEN_SCHRITTEN = EBENE_M / HOEHEN_SCHRITT_M;

// ─────────────────────────────────────────────────────────────────────────────
// 5. Die EINE geteilte Kantenfunktion (AP3) / the ONE shared edge function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Achtel einer Zelle als Meterwert. Alle waagerechten Masse dieses Moduls
 * werden in GANZEN Achteln gerechnet und genau einmal am Schluss mit dieser
 * Konstanten multipliziert — nie akkumuliert addiert (Bauer-Vertragsregel 3,
 * ARCHITECTURE §3.8). ZELLE_M/8 = 0.5 ist binaer exakt, damit ist jede
 * Zellgrenze auf beiden Seiten bitgleich und ein Haarriss bauartbedingt
 * unmoeglich.
 * One eighth of a cell in metres. Every horizontal measure in this module is
 * computed in WHOLE eighths and multiplied by this constant exactly once at
 * the end — never accumulated by addition (builder contract rule 3,
 * ARCHITECTURE §3.8). ZELLE_M/8 = 0.5 is exact in binary, so every cell border
 * is bit-identical from both sides and a hairline crack is impossible by
 * construction.
 */
export const ACHTEL_M = ZELLE_M / 8;

/** Achtel je Zelle. / Eighths per cell. */
export const ZELL_ACHTEL = 8;

/**
 * Dicke der Bodenplatte, der Deckenplatte und der Waende. Boden und Decke in
 * HOEHEN_SCHRITT_M (2 = 1 m), Waende in Zellachteln (2 = 1 m). Ganzzahlen,
 * damit die Umrechnung in Meter exakt bleibt.
 * Thickness of the floor slab, the ceiling slab and the walls. Floor and
 * ceiling in height steps (2 = 1 m), walls in cell eighths (2 = 1 m).
 * Integers, so the conversion to metres stays exact.
 */
export const BODEN_DICKE_STUFEN = 2;
export const DECKE_DICKE_STUFEN = 2;
export const WAND_DICKE_ACHTEL = 2;

/**
 * Ein achsparalleler Quader in METERN — das gemeinsame Ergebnis von
 * Sichtgeometrie und Kollision. `drehung` ist bei achsparallelen Quadern
 * kosmetisch (sie sagt dem Adapter, wohin die Flaeche blickt), aber sie steht
 * im eingefrorenen Vertrag (`BauStueck`, `KollisionsKoerper`) und wird deshalb
 * hier schon mitgeliefert.
 * An axis-aligned box in METRES — the shared result of visual geometry and
 * collision. `drehung` is cosmetic for axis-aligned boxes (it tells the adapter
 * which way the face looks), but it is part of the frozen contract
 * (`BauStueck`, `KollisionsKoerper`) and is therefore supplied here already.
 */
export interface Quader {
  readonly mitte: Vector3;
  readonly groesse: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
}

/**
 * Ein Quader in GANZEN Rastereinheiten: waagerecht in Zellachteln, senkrecht in
 * Hoehenstufen. Die interne Rechenform — `quaderInMeter()` ist der einzige Ort,
 * an dem daraus Meter werden.
 * A box in WHOLE grid units: horizontally in cell eighths, vertically in height
 * steps. The internal computation form — `quaderInMeter()` is the only place it
 * becomes metres.
 */
export interface GanzQuader {
  readonly xa0: number;
  readonly xa1: number;
  readonly ys0: number;
  readonly ys1: number;
  readonly za0: number;
  readonly za1: number;
  readonly drehung: 0 | 1 | 2 | 3;
}

/**
 * Ganzzahliger Quader -> Meter. Mitte und Groesse entstehen durch je EINE
 * Multiplikation einer Ganzzahl mit einer binaer exakten Konstanten
 * (ACHTEL_M/2 = 0.25, HOEHEN_SCHRITT_M/2 = 0.25). Damit sind auch die aus
 * `mitte ± groesse/2` zurueckgerechneten Ecken wieder exakt.
 * Integer box -> metres. Centre and size each arise from ONE multiplication of
 * an integer with a binary-exact constant (ACHTEL_M/2 = 0.25,
 * HOEHEN_SCHRITT_M/2 = 0.25). Corners recovered as `mitte ± groesse/2` are
 * therefore exact as well.
 */
export function quaderInMeter(q: GanzQuader): Quader {
  return {
    mitte: {
      x: (q.xa0 + q.xa1) * (ACHTEL_M / 2),
      y: (q.ys0 + q.ys1) * (HOEHEN_SCHRITT_M / 2),
      z: (q.za0 + q.za1) * (ACHTEL_M / 2),
    },
    groesse: {
      x: (q.xa1 - q.xa0) * ACHTEL_M,
      y: (q.ys1 - q.ys0) * HOEHEN_SCHRITT_M,
      z: (q.za1 - q.za0) * ACHTEL_M,
    },
    drehung: q.drehung,
  };
}

/**
 * Vierteldrehung einer Kante — dieselbe Zuordnung wie `themen.kanteZuDrehung`
 * (Nord = 0, dann im Uhrzeigersinn). Sie steht hier ein zweites Mal, weil
 * `cells.ts` `themen.ts` nicht importieren darf (Registry im reinen Modul,
 * `sideEffects: false`); der Test `dungeon2-builder.ts` haelt beide Fassungen
 * gegeneinander, damit sie nicht auseinanderlaufen.
 * Quarter turn of an edge — the same mapping as `themen.kanteZuDrehung`
 * (north = 0, then clockwise). It appears here a second time because
 * `cells.ts` must not import `themen.ts` (registry inside the pure module,
 * `sideEffects: false`); the test `dungeon2-builder.ts` holds both versions
 * against each other so they cannot drift apart.
 */
export function kantenDrehung(kante: Kante): 0 | 1 | 2 | 3 {
  if (kante === KANTE.Nord) return 0;
  if (kante === KANTE.Ost) return 1;
  if (kante === KANTE.Sued) return 2;
  return 3;
}

/** Bodenoberkante einer Zelle in Hoehenstufen, absolut. / Floor top, absolute. */
export function bodenStufen(zelle: Zelle): number {
  return zelle.ebene * EBENE_IN_HOEHEN_SCHRITTEN + zelle.boden;
}

/**
 * Hat diese Zelle eine Bodenplatte? Nein genau dann, wenn sie ein `Schacht`
 * ist UND darunter eine begehbare Zelle liegt — dann IST sie die senkrechte
 * Oeffnung, und eine Platte waere ihr Gegenteil.
 * Does this cell get a floor slab? No exactly when it is a `Schacht` AND a
 * walkable cell lies below — then it IS the vertical opening, and a slab would
 * be its opposite.
 */
export function hatBodenPlatte(gitter: ZellenGitter, zelle: Zelle): boolean {
  if (zelle.art !== ZELLEN_ART.Schacht) return true;
  const unten = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene - 1);
  return unten === undefined || !offen(unten.art);
}

/** Der `Schacht` unmittelbar ueber dieser Zelle, falls es einen gibt. */
/** The `Schacht` directly above this cell, if there is one. */
function schachtDarueber(gitter: ZellenGitter, zelle: Zelle): Zelle | undefined {
  if (!offen(zelle.art)) return undefined;
  const oben = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
  if (oben === undefined || oben.art !== ZELLEN_ART.Schacht) return undefined;
  return oben;
}

/** Hat diese Zelle eine Deckenplatte? Nein, wenn ueber ihr ein Schacht steht. */
/** Does this cell get a ceiling slab? No if a shaft stands above it. */
export function hatDeckenPlatte(gitter: ZellenGitter, zelle: Zelle): boolean {
  return schachtDarueber(gitter, zelle) === undefined;
}

/**
 * Deckenunterkante der lichten Saeule dieser Zelle in Hoehenstufen. Steht ein
 * Schacht darueber, reicht die Saeule bis zu dessen Bodenhoehe hinauf — sonst
 * bliebe zwischen der (weggelassenen) Decke unten und dem Schachtboden oben ein
 * Ring ohne Wand, und genau das waere ein Leck.
 * Ceiling underside of this cell's clear column in height steps. If a shaft
 * stands above, the column reaches up to the shaft's floor height — otherwise
 * a ring without walls would remain between the (omitted) ceiling below and the
 * shaft floor above, and that is exactly what a leak is.
 */
export function obenStufen(gitter: ZellenGitter, zelle: Zelle): number {
  const eigen = bodenStufen(zelle) + zelle.decke;
  const schacht = schachtDarueber(gitter, zelle);
  if (schacht === undefined) return eigen;
  const schachtBoden = bodenStufen(schacht);
  return schachtBoden > eigen ? schachtBoden : eigen;
}

/** Unterkante der WANDSAEULE (also inklusive Bodenplatte, wenn es eine gibt). */
/** Bottom of the WALL column (i.e. including the floor slab, if there is one). */
export function saeuleUnten(gitter: ZellenGitter, zelle: Zelle): number {
  const boden = bodenStufen(zelle);
  return hatBodenPlatte(gitter, zelle) ? boden - BODEN_DICKE_STUFEN : boden;
}

/** Oberkante der WANDSAEULE (also inklusive Deckenplatte, wenn es eine gibt). */
/** Top of the WALL column (i.e. including the ceiling slab, if there is one). */
export function saeuleOben(gitter: ZellenGitter, zelle: Zelle): number {
  const oben = obenStufen(gitter, zelle);
  return hatDeckenPlatte(gitter, zelle) ? oben + DECKE_DICKE_STUFEN : oben;
}

/**
 * Ganzzahliger Fussabdruck einer Kante: der Streifen ueber der Zellgrenze, so
 * breit wie die Zelle und `WAND_DICKE_ACHTEL` dick, mittig auf der Grenze.
 * Mittig heisst: die Funktion liefert fuer (A, Nord) und (B, Sued) genau
 * denselben Streifen — die Symmetrie ist geometrisch, nicht nur logisch.
 * Integer footprint of an edge: the strip across the cell border, as wide as
 * the cell and `WAND_DICKE_ACHTEL` thick, centred on the border. Centred means
 * the function yields exactly the same strip for (A, Nord) and (B, Sued) — the
 * symmetry is geometric, not merely logical.
 */
export function kantenStreifen(
  x: number,
  z: number,
  kante: Kante
): { xa0: number; xa1: number; za0: number; za1: number } {
  const halb = WAND_DICKE_ACHTEL / 2;
  const xa = x * ZELL_ACHTEL;
  const za = z * ZELL_ACHTEL;
  switch (kante) {
    case KANTE.Nord:
      return { xa0: xa, xa1: xa + ZELL_ACHTEL, za0: za + ZELL_ACHTEL - halb, za1: za + ZELL_ACHTEL + halb };
    case KANTE.Sued:
      return { xa0: xa, xa1: xa + ZELL_ACHTEL, za0: za - halb, za1: za + halb };
    case KANTE.Ost:
      return { xa0: xa + ZELL_ACHTEL - halb, xa1: xa + ZELL_ACHTEL + halb, za0: za, za1: za + ZELL_ACHTEL };
    default:
      return { xa0: xa - halb, xa1: xa + halb, za0: za, za1: za + ZELL_ACHTEL };
  }
}

/**
 * DIE geteilte Kantenfunktion aus ARCHITECTURE §3.8: Sichtgeometrie UND
 * Kollision rufen sie, nie zwei gleich gemeinte Rechnungen nebeneinander. Sie
 * liefert den Wandquader zwischen `zelle` und ihrer Nachbarin an `kante` —
 * oder `null`, wenn dort keine Wand steht (`wandZwischen`) bzw. beide Seiten
 * Fels sind (dann gibt es nichts zu bauen, nur ungestoerten Berg).
 * THE shared edge function from ARCHITECTURE §3.8: visual geometry AND
 * collision both call it, never two separately written calculations that mean
 * the same. It returns the wall box between `zelle` and its neighbour across
 * `kante` — or `null` when no wall stands there (`wandZwischen`) or when both
 * sides are rock (nothing to build, just undisturbed mountain).
 *
 * Die senkrechte Ausdehnung ist die VEREINIGUNG der Wandsaeulen beider
 * begehbaren Beteiligten. Auch das ist symmetrisch: eine Trennwand mitten im
 * Saal ist von beiden Seiten aus derselbe Quader.
 * The vertical extent is the UNION of the wall columns of both walkable
 * participants. Symmetric as well: a partition wall in the middle of a hall is
 * the same box seen from either side.
 */
export function zellKanteZuQuaderGanz(
  gitter: ZellenGitter,
  zelle: Zelle,
  kante: Kante
): GanzQuader | null {
  const p = nachbarZelle(zelle.x, zelle.z, kante);
  const nachbar = zelleOderLeer(gitter, p.x, p.z, zelle.ebene);
  const aOffen = offen(zelle.art);
  const bOffen = offen(nachbar.art);
  if (!aOffen && !bOffen) return null;
  if (!wandZwischen(zelle, nachbar)) return null;

  let ys0 = Number.POSITIVE_INFINITY;
  let ys1 = Number.NEGATIVE_INFINITY;
  for (const teilnehmer of [zelle, nachbar]) {
    if (!offen(teilnehmer.art)) continue;
    const u = saeuleUnten(gitter, teilnehmer);
    const o = saeuleOben(gitter, teilnehmer);
    if (u < ys0) ys0 = u;
    if (o > ys1) ys1 = o;
  }
  if (!Number.isFinite(ys0) || ys1 <= ys0) return null;

  const streifen = kantenStreifen(zelle.x, zelle.z, kante);
  return { ...streifen, ys0, ys1, drehung: kantenDrehung(kante) };
}

/** Dieselbe Funktion, Ergebnis in Metern. / The same function, result in metres. */
export function zellKanteZuQuader(
  gitter: ZellenGitter,
  zelle: Zelle,
  kante: Kante
): Quader | null {
  const ganz = zellKanteZuQuaderGanz(gitter, zelle, kante);
  return ganz === null ? null : quaderInMeter(ganz);
}
