/**
 * Messender Nachweis fuer den Zellkern des Dungeon-Generators 2.0 (AP2).
 * Measuring proof for the cell core of dungeon generator 2.0 (AP2).
 *
 *   npx tsx test/dungeon2-invarianten.ts
 *
 * Geprueft werden die drei Kriterien aus `design/ARCHITECTURE.md`, AP2:
 * Checked are the three criteria from `design/ARCHITECTURE.md`, AP2:
 *
 *   (a) SYMMETRIETEST: fuer 10.000 zufaellig (seed-fest) erzeugte, kanten-
 *       benachbarte Zellpaare gilt wandZwischen(A,B) === wandZwischen(B,A).
 *       Das ist der Test, der die "kleinerer Index gewinnt"-Falle faengt.
 *       SYMMETRY TEST: for 10,000 randomly (seed-fixed) generated, edge-
 *       adjacent cell pairs, wandZwischen(A,B) === wandZwischen(B,A) holds.
 *       This is the test that catches the "smaller index wins" trap.
 *   (b) Jede der acht gitterabhaengigen Invarianten
 *       (`erreichbar`,`lichte-hoehe`,`doppelbelegung`,`ebenen-abstand`,
 *       `treppe-anschluss`,`tuer-im-fels`,`anker-in-luft`,`rueckgrat`) hat
 *       einen Positiv- UND einen Negativfall; der Negativfall muss genau
 *       seinen `regel`-Namen liefern.
 *       Each of the eight grid-dependent invariants has a positive AND a
 *       negative case; the negative case must yield exactly its `regel` name.
 *   (c) `zellenAufbauen()` ist idempotent und reihenfolgeunabhaengig:
 *       dieselben Stempel in gemischter Array-Reihenfolge (bei gleicher
 *       `ordnung`) ergeben dasselbe Gitter.
 *       `zellenAufbauen()` is idempotent and order independent: the same
 *       stamps in shuffled array order (at equal `ordnung`) yield the same
 *       grid.
 */

import { XorShiftRandom } from '../src/worldgen/Random.js';
import {
  ANKER_ORT,
  EBENE_M,
  HOEHEN_SCHRITT_M,
  KANTE,
  BLOCK_ZELLEN,
  LAYOUT_FORMAT,
  MIN_LICHTE_STUFEN,
  ZELLE_M,
  ZELLEN_ART,
  mitPruefsumme,
  type Befund,
  type DekoAnker,
  type DungeonLayout2,
  type Kante as KanteTyp,
  type LayoutRegel,
  type RaumStempel,
  type Tuer,
  type Zelle,
  type ZellenArt,
  type ZellenKorrektur,
} from '../src/dungeon2/layout.js';
import {
  schluesselZelle,
  wandZwischen,
  zellenAufbauen,
  zellenSortiert,
  type ZellenGitter,
} from '../src/dungeon2/cells.js';
import { validateZellgitter } from '../src/dungeon2/validation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness (Muster aus dungeon2-layout.ts)
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function hatFehler(befunde: readonly Befund[], regel: LayoutRegel): boolean {
  return befunde.some((b) => b.regel === regel && b.schwere === 'fehler');
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Symmetrietest der Wandableitung / symmetry test of wall derivation
// ─────────────────────────────────────────────────────────────────────────────

const ZELLEN_ARTEN: readonly ZellenArt[] = [
  ZELLEN_ART.Leer,
  ZELLEN_ART.Boden,
  ZELLEN_ART.Treppe,
  ZELLEN_ART.Schacht,
  ZELLEN_ART.Wasser,
];
const ALLE_KANTEN: readonly KanteTyp[] = [KANTE.Nord, KANTE.Ost, KANTE.Sued, KANTE.West];

/** Baut eine zufaellige Zelle an gegebener Position mit zufaelligen Feldern. */
/** Builds a random cell at a given position with random fields. */
function zufallsZelle(rng: XorShiftRandom, x: number, z: number, ebene: number): Zelle {
  return {
    x,
    z,
    ebene,
    art: ZELLEN_ARTEN[rng.rangeInt(0, ZELLEN_ARTEN.length)]!,
    boden: rng.rangeInt(-8, 9),
    decke: rng.rangeInt(0, 32),
    wandErzwungen: rng.rangeInt(0, 16),
    durchgangErzwungen: rng.rangeInt(0, 16),
    materialTag: rng.rangeInt(0, 6),
    oberflaeche: rng.rangeInt(0, 4),
    stempelId: rng.rangeInt(-1, 8),
  };
}

{
  const rng = new XorShiftRandom(20260830); // Datum als fester Seed / date as a fixed seed
  const DURCHLAEUFE = 10_000;
  let alleSymmetrisch = true;
  let ersteAbweichung = -1;

  for (let i = 0; i < DURCHLAEUFE; i++) {
    const x = rng.rangeInt(-20, 20);
    const z = rng.rangeInt(-20, 20);
    const ebene = rng.rangeInt(-2, 2);
    const kante = ALLE_KANTEN[rng.rangeInt(0, ALLE_KANTEN.length)]!;
    const a = zufallsZelle(rng, x, z, ebene);
    const nachbarPos = { x: x + (kante === KANTE.Ost ? 1 : kante === KANTE.West ? -1 : 0), z: z + (kante === KANTE.Nord ? 1 : kante === KANTE.Sued ? -1 : 0) };
    const b = zufallsZelle(rng, nachbarPos.x, nachbarPos.z, ebene);

    const vorwaerts = wandZwischen(a, b);
    const rueckwaerts = wandZwischen(b, a);
    if (vorwaerts !== rueckwaerts && alleSymmetrisch) {
      alleSymmetrisch = false;
      ersteAbweichung = i;
    }
  }
  pruefe(
    `wandZwischen ist symmetrisch ueber ${DURCHLAEUFE} zufaellige Zellpaare`,
    alleSymmetrisch,
    alleSymmetrisch ? '' : `erste Abweichung bei Durchlauf ${ersteAbweichung}`
  );
}

// Randfall von Hand: Kartenrand (fehlende Nachbarin) erzeugt automatisch eine
// Wand, wenn die vorhandene Seite begehbar ist — keine Ausnahme noetig.
// Hand-picked edge case: a missing neighbour automatically yields a wall when
// the present side is walkable — no exception needed.
{
  const boden: Zelle = {
    x: 0,
    z: 0,
    ebene: 0,
    art: ZELLEN_ART.Boden,
    boden: 0,
    decke: 8,
    wandErzwungen: 0,
    durchgangErzwungen: 0,
    materialTag: 0,
    oberflaeche: 0,
    stempelId: -1,
  };
  const felsNachbar: Zelle = { ...boden, x: 1, z: 0, art: ZELLEN_ART.Leer, stempelId: -1 };
  pruefe('Wand zwischen Boden und Fels (vorwaerts)', wandZwischen(boden, felsNachbar) === true);
  pruefe('Wand zwischen Boden und Fels (rueckwaerts)', wandZwischen(felsNachbar, boden) === true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bauhilfen fuer die Invarianten-Faelle / builders for the invariant cases
// ─────────────────────────────────────────────────────────────────────────────

function stempel(o: Partial<RaumStempel> & Pick<RaumStempel, 'id' | 'x' | 'z' | 'ordnung' | 'tiefeImBaum'>): RaumStempel {
  return {
    typ: 'kammer',
    ebene: 0,
    breite: 3,
    tiefe: 3,
    hoehe: MIN_LICHTE_STUFEN,
    bodenVersatz: 0,
    drehung: 0,
    seed: 1,
    variante: 0,
    ...o,
  };
}

function basisLayout(o: {
  stempel?: RaumStempel[];
  korrekturen?: ZellenKorrektur[];
  tueren?: Tuer[];
  anker?: DekoAnker[];
  eingang?: DungeonLayout2['eingang'];
  grenzen?: DungeonLayout2['grenzen'];
}): DungeonLayout2 {
  const roh: DungeonLayout2 = {
    format: LAYOUT_FORMAT,
    version: 1,
    id: 'test-ap2',
    name: 'AP2-Testgrab',
    thema: 'steingrab',
    seeds: { architektur: 1, material: 2, deko: 3 },
    raster: { zelleM: ZELLE_M, ebeneM: EBENE_M, hoehenSchrittM: HOEHEN_SCHRITT_M, blockZellen: BLOCK_ZELLEN },
    grenzen: o.grenzen ?? { minX: -10, maxX: 10, minZ: -10, maxZ: 10, minEbene: -1, maxEbene: 1 },
    eingang: o.eingang ?? { x: 1, z: 1, ebene: 0, kante: KANTE.Nord },
    stempel: o.stempel ?? [stempel({ id: 0, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' })],
    korrekturen: o.korrekturen ?? [],
    tueren: o.tueren ?? [],
    anker: o.anker ?? [],
    pruefsumme: '',
  };
  return mitPruefsumme(roh);
}

function pruefeInvariante(
  name: string,
  regel: LayoutRegel,
  positivLayout: DungeonLayout2,
  negativLayout: DungeonLayout2
): void {
  const positivBefunde = validateZellgitter(positivLayout, zellenAufbauen(positivLayout));
  pruefe(`${name}: Positivfall ohne Fehler '${regel}'`, !hatFehler(positivBefunde, regel));

  const negativBefunde = validateZellgitter(negativLayout, zellenAufbauen(negativLayout));
  pruefe(`${name}: Negativfall liefert Fehler '${regel}'`, hatFehler(negativBefunde, regel));
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) Die acht gitterabhaengigen Invarianten, je Positiv- und Negativfall
// ─────────────────────────────────────────────────────────────────────────────

// erreichbar — Positiv: ein Raum. Negativ: ein zweiter, unverbundener Raum.
{
  const positiv = basisLayout({});
  const negativ = basisLayout({
    stempel: [
      stempel({ id: 0, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' }),
      stempel({ id: 1, x: 8, z: 8, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
    ],
  });
  pruefeInvariante('erreichbar', 'erreichbar', positiv, negativ);
}

// lichte-hoehe — Positiv: decke = MIN_LICHTE_STUFEN. Negativ: eine Korrektur
// druecht die Deckenhoehe einer Zelle unter das Minimum (der Stempel selbst
// bleibt gueltig, damit NUR `lichte-hoehe` anschlaegt, nicht `stempel-lichte`).
{
  const positiv = basisLayout({});
  const negativ = basisLayout({
    korrekturen: [{ x: 1, z: 1, ebene: 0, aendere: { decke: MIN_LICHTE_STUFEN - 1 } }],
  });
  pruefeInvariante('lichte-hoehe', 'lichte-hoehe', positiv, negativ);
}

// doppelbelegung — durch den Map-Schluessel strukturell ausgeschlossen; die
// Pruefung in `validation.ts` ist eine defensive Zweitpruefung ueber die
// tatsaechlichen (x,z,ebene)-Werte der Zellen, nicht ueber den Map-Schluessel.
// Negativfall: ein absichtlich VERFAELSCHTES Gitter mit zwei Map-Eintraegen
// unter verschiedenen Schluesseln, aber identischer (x,z,ebene) — das kann
// `zellenAufbauen()` nie erzeugen, genau deshalb wird es hier von Hand gebaut.
{
  const layout = basisLayout({});
  const positivBefunde = validateZellgitter(layout, zellenAufbauen(layout));
  pruefe("doppelbelegung: Positivfall (echtes Gitter) ohne Fehler 'doppelbelegung'", !hatFehler(positivBefunde, 'doppelbelegung'));

  const zelle: Zelle = {
    x: 1,
    z: 1,
    ebene: 0,
    art: ZELLEN_ART.Boden,
    boden: 0,
    decke: MIN_LICHTE_STUFEN,
    wandErzwungen: 0,
    durchgangErzwungen: 0,
    materialTag: 0,
    oberflaeche: 0,
    stempelId: 0,
  };
  const verfaelschtesGitter: ZellenGitter = {
    zellen: new Map([
      [schluesselZelle(1, 1, 0), zelle],
      ['korrupter-zweitschluessel', zelle],
    ]),
  };
  const negativBefunde = validateZellgitter(layout, verfaelschtesGitter);
  pruefe("doppelbelegung: Negativfall (verfaelschtes Gitter) liefert Fehler 'doppelbelegung'", hatFehler(negativBefunde, 'doppelbelegung'));
}

// ebenen-abstand — Positiv: normale Raumhoehe (8) unter EBENE_M/HOEHEN_SCHRITT_M
// (16) Abstand. Negativ: eine ueberhoehte Zelle (hoehe 20) reicht in die
// Bodenunterkante der Ebene darueber hinein.
{
  const gemeinsam = { grenzen: { minX: -1, maxX: 5, minZ: -1, maxZ: 5, minEbene: 0, maxEbene: 1 } };
  const positiv = basisLayout({
    ...gemeinsam,
    stempel: [
      stempel({ id: 0, x: 0, z: 0, ebene: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' }),
      stempel({ id: 1, x: 0, z: 0, ebene: 1, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
    ],
  });
  const negativ = basisLayout({
    ...gemeinsam,
    stempel: [
      stempel({ id: 0, x: 0, z: 0, ebene: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang', hoehe: 20 }),
      stempel({ id: 1, x: 0, z: 0, ebene: 1, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
    ],
  });
  pruefeInvariante('ebenen-abstand', 'ebenen-abstand', positiv, negativ);

  // WAECHTER zum Fund vom 2026-08-30: Die Regel verglich die Decken-UNTERkante
  // mit der Boden-OBERkante und liess damit `DECKE_DICKE_STUFEN +
  // BODEN_DICKE_STUFEN` = 4 Stufen (2 m) Ueberdeckung durchgehen. Die drei
  // Faelle unten liegen GENAU in dieser Luecke — die alte Formel meldete bei
  // allen dreien nichts (nachgerechnet: `boden + decke` = 11/12/14 ist bei
  // jedem kleiner als die 16 der Ebene darueber), die neue meldet alle drei.
  //
  // 11 ist die groesste Hoehe, die unter einem belegten Stockwerk noch passt:
  // 11 + DECKE_DICKE (2) = 13 < 16 - BODEN_DICKE (2) = 14.
  // GUARD for the finding of 2026-08-30: the rule compared the ceiling
  // UNDERSIDE against the floor TOPSIDE and thereby let 4 steps (2 m) of
  // overlap pass. The three cases below sit exactly in that gap — the old
  // formula reported nothing for any of them, the new one reports all three.
  for (const [hoehe, erwartetFehler] of [[11, false], [12, true], [13, true], [14, true]] as const) {
    const fall = basisLayout({
      ...gemeinsam,
      stempel: [
        stempel({ id: 0, x: 0, z: 0, ebene: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang', hoehe }),
        stempel({ id: 1, x: 0, z: 0, ebene: 1, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
      ],
    });
    const befunde = validateZellgitter(fall, zellenAufbauen(fall));
    pruefe(
      `ebenen-abstand: hoehe ${hoehe} unter einem belegten Stockwerk ${erwartetFehler ? 'wird gemeldet' : 'bleibt gruen'}`,
      hatFehler(befunde, 'ebenen-abstand') === erwartetFehler,
      befunde.map((b) => `${b.regel}: ${b.text}`).join(' | ')
    );
  }
}

// treppe-anschluss — Positiv: eine Treppenzelle mitten im Raum, beide Enden
// (neigung und Gegenkante) haben begehbare Nachbarn. Negativ: eine
// Treppenzelle ohne `neigung`.
{
  const positiv = basisLayout({
    korrekturen: [{ x: 1, z: 1, ebene: 0, aendere: { art: ZELLEN_ART.Treppe, neigung: KANTE.Nord } }],
  });
  const negativ = basisLayout({
    korrekturen: [{ x: 1, z: 1, ebene: 0, aendere: { art: ZELLEN_ART.Treppe } }],
  });
  pruefeInvariante('treppe-anschluss', 'treppe-anschluss', positiv, negativ);
}

// tuer-im-fels — Positiv: eine Tuer zwischen zwei aneinandergrenzenden
// Raeumen. Negativ: dieselbe Tuer, aber der zweite Raum fehlt (Tuer im Fels).
{
  const zweiRaeume = [
    stempel({ id: 0, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' }),
    stempel({ id: 1, x: 3, z: 0, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
  ];
  const gemeinsam = { grenzen: { minX: -1, maxX: 6, minZ: -1, maxZ: 3, minEbene: 0, maxEbene: 0 } };
  const tuer: Tuer = { x: 2, z: 1, ebene: 0, kante: KANTE.Ost, art: 'holz', zustand: 'offen' };

  const positiv = basisLayout({ ...gemeinsam, stempel: zweiRaeume, tueren: [tuer] });
  const negativ = basisLayout({
    ...gemeinsam,
    stempel: [zweiRaeume[0]!],
    tueren: [tuer],
  });
  pruefeInvariante('tuer-im-fels', 'tuer-im-fels', positiv, negativ);
}

// anker-in-luft — Positiv: ein Bodenanker in der begehbaren Raumzelle.
// Negativ: derselbe Anker, aber ausserhalb jeder Zelle (im Fels).
{
  const ankerGut: DekoAnker = {
    id: 0,
    x: 1,
    z: 1,
    ebene: 0,
    ort: ANKER_ORT.Boden,
    u: 4,
    v: 4,
    h: 0,
    drehung: 0,
    rolle: 'fackel',
    seed: 1,
    stempelId: 0,
  };
  const ankerLuft: DekoAnker = { ...ankerGut, x: 9, z: 9 };
  const positiv = basisLayout({ anker: [ankerGut] });
  const negativ = basisLayout({ anker: [ankerLuft] });
  pruefeInvariante('anker-in-luft', 'anker-in-luft', positiv, negativ);
}

// Zusatzfall (nicht Pflicht, aber billig): ein Wandanker OHNE Wand an seiner
// Kante — deckt den zweiten Zweig von `anker-in-luft` ab (begehbare Zelle,
// aber keine Wand an der behaupteten Kante).
// Extra case (not mandatory, but cheap): a wall anchor WITHOUT a wall at its
// edge — covers the second branch of `anker-in-luft` (walkable cell, but no
// wall on the claimed edge).
{
  const wandAnkerOhneWand: DekoAnker = {
    id: 1,
    x: 1,
    z: 1,
    ebene: 0,
    ort: ANKER_ORT.Wand,
    kante: KANTE.Nord, // Nachbarzelle (1,2) ist im 3x3-Raum ebenfalls begehbar -> keine Wand
    u: 0,
    v: 4,
    h: 8,
    drehung: 0,
    rolle: 'fackel',
    seed: 1,
    stempelId: 0,
  };
  const layout = basisLayout({ anker: [wandAnkerOhneWand] });
  const befunde = validateZellgitter(layout, zellenAufbauen(layout));
  pruefe("anker-in-luft: Wandanker ohne Wand an der Kante liefert Fehler 'anker-in-luft'", hatFehler(befunde, 'anker-in-luft'));
}

// rueckgrat — wiederverwendet das erreichbar-Paar: im verbundenen Fall ist
// der tiefste Stempel erreichbar, im getrennten Fall nicht.
{
  const positiv = basisLayout({
    stempel: [
      stempel({ id: 0, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' }),
      stempel({ id: 1, x: 3, z: 0, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
    ],
    tueren: [{ x: 2, z: 1, ebene: 0, kante: KANTE.Ost, art: 'holz', zustand: 'offen' }],
    grenzen: { minX: -1, maxX: 6, minZ: -1, maxZ: 3, minEbene: 0, maxEbene: 0 },
  });
  const negativ = basisLayout({
    stempel: [
      stempel({ id: 0, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' }),
      stempel({ id: 1, x: 8, z: 8, ordnung: 1, tiefeImBaum: 1, typ: 'kammer' }),
    ],
  });
  pruefeInvariante('rueckgrat', 'rueckgrat', positiv, negativ);
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) zellenAufbauen: idempotent und reihenfolgeunabhaengig
// ─────────────────────────────────────────────────────────────────────────────

{
  // Drei sich ueberlappende Stempel mit GLEICHER `ordnung` — nur die
  // Sortierung nach `id` als Tiebreak darf entscheiden, wer wen ueberschreibt.
  // Three overlapping stamps with EQUAL `ordnung` — only the `id` tiebreak may
  // decide who overwrites whom.
  const s0 = stempel({ id: 5, x: 0, z: 0, ordnung: 0, tiefeImBaum: 0, typ: 'eingang' });
  const s1 = stempel({ id: 2, x: 1, z: 1, ordnung: 0, tiefeImBaum: 0, typ: 'kammer' });
  const s2 = stempel({ id: 9, x: 2, z: 2, ordnung: 0, tiefeImBaum: 0, typ: 'nische' });

  const grenzen = { minX: -1, maxX: 6, minZ: -1, maxZ: 6, minEbene: 0, maxEbene: 0 };
  const inReihenfolgeA = basisLayout({ stempel: [s0, s1, s2], grenzen });
  const inReihenfolgeB = basisLayout({ stempel: [s2, s0, s1], grenzen });
  const inReihenfolgeC = basisLayout({ stempel: [s1, s2, s0], grenzen });

  const textA = JSON.stringify(zellenSortiert(zellenAufbauen(inReihenfolgeA)));
  const textB = JSON.stringify(zellenSortiert(zellenAufbauen(inReihenfolgeB)));
  const textC = JSON.stringify(zellenSortiert(zellenAufbauen(inReihenfolgeC)));

  pruefe('zellenAufbauen ist reihenfolgeunabhaengig (A vs B)', textA === textB);
  pruefe('zellenAufbauen ist reihenfolgeunabhaengig (A vs C)', textA === textC);

  const nochmalA = JSON.stringify(zellenSortiert(zellenAufbauen(inReihenfolgeA)));
  pruefe('zellenAufbauen ist idempotent (zweiter Aufruf, gleiche Eingabe)', textA === nochmalA);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-invarianten: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
