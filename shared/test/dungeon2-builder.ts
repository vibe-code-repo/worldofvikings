/**
 * Messender Nachweis fuer den Geometrie-Bauer des Dungeon-Generators 2.0 (AP3).
 * Measuring proof for the geometry builder of dungeon generator 2.0 (AP3).
 *
 *   npx tsx test/dungeon2-builder.ts
 *
 * Geprueft werden die Kriterien aus `design/ARCHITECTURE.md`, AP3, sowie die
 * beiden Zusatzforderungen des Arbeitsauftrags:
 * Checked are the criteria from `design/ARCHITECTURE.md`, AP3, plus the two
 * additional demands of the work order:
 *
 *   (A) BLOCKWEISE GLEICHHEIT ueber Seeds: `baueGeometrie(l)` und die
 *       Vereinigung von `baueGeometrie(l, {bloecke:[b]})` ueber alle Bloecke
 *       sind identisch, auch bei zufaelliger Blockreihenfolge. Das ist die
 *       messbare Fassung von "der Bauer hasht, er zieht nicht".
 *       BLOCK-WISE EQUALITY across seeds — the measurable form of "the builder
 *       hashes, it does not draw".
 *   (B) GESCHLOSSENE VOLUMINA, zweifach:
 *       (B1) Kanten-Manifold je Bauteil: jede GERICHTETE Netzkante kommt genau
 *            einmal vor, jede ungerichtete genau zweimal, das vorzeichen-
 *            behaftete Volumen ist positiv (Umlaufrichtung nach aussen).
 *       (B2) Huellendeckung des Grabes: kein Punkt unmittelbar hinter einer
 *            Wand, einem Boden oder einer Decke ist offen — der Leak-Gedanke
 *            als Zahlentest, ohne ein einziges Pixel.
 *       CLOSED VOLUMES, twofold: (B1) edge manifold per piece, (B2) shell
 *       coverage of the barrow — the leak idea as a numeric test.
 *   (C) KOLLISION AUS DEMSELBEN LAYOUT: zwei Laeufe liefern bitgleiche
 *       Kollision; die Kollision haengt an keinem rein optischen Bauteil.
 *       (Die beidseitige Deckungspruefung Optik<->Kollision steht in
 *       `dungeon2-paritaet.ts`.)
 *       COLLISION FROM THE SAME LAYOUT.
 *   (D) KEIN HAARRISS: ueber ein 60x60-Zellen-Layout trennt benachbarte
 *       Bodenstuecke keine Luecke > 1e-6 m. Der Multiplikation-statt-Addition-
 *       Beweis.
 *       NO HAIRLINE CRACK over a 60x60 cell layout.
 */

import { XorShiftRandom } from '../src/worldgen/Random.js';
import {
  BLOCK_ZELLEN,
  EBENE_M,
  HOEHEN_SCHRITT_M,
  KANTE,
  KANTEN,
  MAX_MATERIAL_TAG,
  ZELLE_M,
  ZELLEN_ART,
  kanonisiereKante,
  mitPruefsumme,
  nachbarZelle,
  type DungeonLayout2,
  type Kante,
  type LayoutSeeds,
  type RaumStempel,
  type Zelle,
  type ZellenKorrektur,
} from '../src/dungeon2/layout.js';
import {
  ACHTEL_M,
  DECKE_DICKE_STUFEN,
  WAND_DICKE_ACHTEL,
  ZELL_ACHTEL,
  bodenStufen,
  kantenDrehung,
  lichtschaechte,
  obenStufen,
  offen,
  zelleImGitter,
  zellenAufbauen,
  zellenSortiert,
  zellKanteZuQuader,
  type ZellenGitter,
} from '../src/dungeon2/cells.js';
import {
  bauKanonisch,
  baueGeometrie,
  type BauStueckArt,
  blockSchluessel,
  blockVonZelle,
  bloeckeDesGitters,
  stueckZuNetz,
  type BauErgebnis,
  type BauStueck,
  type BlockId,
} from '../src/dungeon2/builder.js';
import { erzeugeLayout } from '../src/dungeon2/generator.js';
import { STEINGRAB, kanteZuDrehung, materialTagFuerStempel } from '../src/dungeon2/themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness (Muster aus dungeon2-invarianten.ts)
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

const thema = STEINGRAB;
const materialOptionen = {
  materialTagFuerStempel: (s: RaumStempel) => materialTagFuerStempel(thema, s),
};

/** Seeds aus einer Zaehlung, nicht aus einer Uhr. / Seeds from a count, not a clock. */
function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

function baue(layout: DungeonLayout2, gitter?: ZellenGitter, bloecke?: readonly BlockId[]): BauErgebnis {
  return baueGeometrie(layout, {
    aufbau: materialOptionen,
    ...(gitter === undefined ? {} : { gitter }),
    ...(bloecke === undefined ? {} : { bloecke }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. Die geteilte Kantenfunktion / the shared edge function
// ─────────────────────────────────────────────────────────────────────────────

{
  // `cells.kantenDrehung` und `themen.kanteZuDrehung` sind zwei Fassungen
  // derselben Zuordnung (cells.ts darf themen.ts nicht importieren). Sie hier
  // gegeneinander zu halten ist billiger, als sie eines Tages auseinander
  // laufen zu lassen.
  // `cells.kantenDrehung` and `themen.kanteZuDrehung` are two versions of the
  // same mapping (cells.ts must not import themen.ts). Holding them against
  // each other here is cheaper than letting them drift apart one day.
  let gleich = true;
  for (const kante of KANTEN) if (kantenDrehung(kante) !== kanteZuDrehung(kante)) gleich = false;
  pruefe('kantenDrehung (cells) und kanteZuDrehung (themen) stimmen ueberein', gleich);

  // Symmetrie der geteilten Kantenfunktion: von beiden Seiten derselbe Quader
  // in Mitte und Groesse. `drehung` ist ABSICHTLICH gegenlaeufig — sie sagt,
  // welche Seite in den Raum blickt, und das ist von Norden aus etwas anderes
  // als von Sueden. Genau deshalb wird sie hier getrennt geprueft (Gegenkante)
  // und nicht stillschweigend mitverglichen.
  // Symmetry of the shared edge function: the same box in centre and size from
  // either side. `drehung` is DELIBERATELY opposite — it says which side faces
  // into the room, and that differs between north and south. Which is exactly
  // why it is checked separately here (opposite edge) instead of being silently
  // folded into the comparison.
  let symmetrisch = true;
  let drehungGegenlaeufig = true;
  let geprueft = 0;
  for (let i = 0; i < 10; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    for (const zelle of zellenSortiert(gitter)) {
      for (const kante of KANTEN) {
        // Auch die Fels-Nachbarin zaehlt: der Quader muss auch von aussen
        // derselbe sein, sonst kaeme die Aussenwand doppelt.
        // The rock neighbour counts too: the box must be the same from outside
        // as well, otherwise the outer wall would come twice.
        const p = nachbarZelle(zelle.x, zelle.z, kante);
        const nachbar = zelleImGitter(gitter, p.x, p.z, zelle.ebene) ?? felsZelle(p.x, p.z, zelle.ebene);
        const hin = zellKanteZuQuader(gitter, zelle, kante);
        const her = zellKanteZuQuader(gitter, nachbar, gegen(kante));
        geprueft++;
        if ((hin === null) !== (her === null)) {
          symmetrisch = false;
          continue;
        }
        if (hin === null || her === null) continue;
        if (JSON.stringify([hin.mitte, hin.groesse]) !== JSON.stringify([her.mitte, her.groesse])) {
          symmetrisch = false;
        }
        if ((hin.drehung + 2) % 4 !== her.drehung) drehungGegenlaeufig = false;
      }
    }
  }
  pruefe(
    `zellKanteZuQuader ist symmetrisch in Mitte und Groesse (${geprueft} Kantenpaare)`,
    symmetrisch && geprueft > 10000,
    `geprueft: ${geprueft}`
  );
  pruefe('zellKanteZuQuader dreht die Blickrichtung mit der Kante um', drehungGegenlaeufig);
}

function felsZelle(x: number, z: number, ebene: number): Zelle {
  return {
    x,
    z,
    ebene,
    art: ZELLEN_ART.Leer,
    boden: 0,
    decke: 0,
    wandErzwungen: 0,
    durchgangErzwungen: 0,
    materialTag: 0,
    oberflaeche: 0,
    stempelId: -1,
  };
}

function gegen(kante: Kante): Kante {
  if (kante === KANTE.Nord) return KANTE.Sued;
  if (kante === KANTE.Sued) return KANTE.Nord;
  if (kante === KANTE.Ost) return KANTE.West;
  return KANTE.Ost;
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) Blockweise Gleichheit / block-wise equality
// ─────────────────────────────────────────────────────────────────────────────

const BLOCK_SEEDS = 25;

{
  let abweichungen = 0;
  let ersteAbweichung = '';
  let bloeckeGesamt = 0;
  let stueckeGesamt = 0;

  for (let i = 0; i < BLOCK_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const voll = baue(layout, gitter);
    stueckeGesamt += voll.stuecke.length;

    const bloecke = bloeckeDesGitters(gitter);
    bloeckeGesamt += bloecke.length;

    // Zufaellige, aber seed-feste Blockreihenfolge — genau der Fall
    // "Spawnbloecke zuerst, Rest nachziehen" aus ARCHITECTURE W8.
    // Random but seed-fixed block order — exactly the "spawn blocks first,
    // rest afterwards" case from ARCHITECTURE W8.
    const rng = new XorShiftRandom(0x51ce0000 + i);
    const gemischt = [...bloecke];
    for (let k = gemischt.length - 1; k > 0; k--) {
      const j = rng.rangeInt(0, k + 1);
      const t = gemischt[k]!;
      gemischt[k] = gemischt[j]!;
      gemischt[j] = t;
    }

    const teilStuecke: BauStueck[] = [];
    const teile: BauErgebnis[] = [];
    for (const block of gemischt) {
      const teil = baue(layout, gitter, [block]);
      teile.push(teil);
      teilStuecke.push(...teil.stuecke);
      // Jedes Teilergebnis darf NUR Stuecke seines eigenen Blocks enthalten.
      // Every partial result may contain ONLY pieces of its own block.
      for (const s of teil.stuecke) {
        if (blockSchluessel(s.block) !== blockSchluessel(block)) {
          abweichungen++;
          if (ersteAbweichung === '') ersteAbweichung = `Seed ${i}: fremder Block im Teilbau`;
        }
      }
    }

    const vollText = bauKanonisch({
      stuecke: voll.stuecke,
      kollision: voll.kollision,
      nav: voll.nav,
      dekoPlaetze: voll.dekoPlaetze,
      spawnPunkt: voll.spawnPunkt,
      huelle: voll.huelle,
    });
    const teilText = bauKanonisch({
      stuecke: sortiereWieBau(teilStuecke),
      kollision: sortiereKoerper(teile.flatMap((t) => [...t.kollision])),
      nav: teile.flatMap((t) => [...t.nav]).sort((a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x),
      dekoPlaetze: teile
        .flatMap((t) => [...t.dekoPlaetze])
        .sort((a, b) => a.ankerId - b.ankerId),
      spawnPunkt: voll.spawnPunkt,
      huelle: voll.huelle,
    });
    const vollTextGeordnet = bauKanonisch({
      stuecke: voll.stuecke,
      kollision: voll.kollision,
      nav: [...voll.nav].sort((a, b) => a.ebene - b.ebene || a.z - b.z || a.x - b.x),
      dekoPlaetze: [...voll.dekoPlaetze].sort((a, b) => a.ankerId - b.ankerId),
      spawnPunkt: voll.spawnPunkt,
      huelle: voll.huelle,
    });
    void vollText;

    if (teilText !== vollTextGeordnet) {
      abweichungen++;
      if (ersteAbweichung === '') {
        const a = teilText.split('\n');
        const b = vollTextGeordnet.split('\n');
        let zeile = 0;
        while (zeile < a.length && zeile < b.length && a[zeile] === b[zeile]) zeile++;
        ersteAbweichung = `Seed ${i}, Zeile ${zeile}: Teil "${a[zeile] ?? '<fehlt>'}" vs Voll "${b[zeile] ?? '<fehlt>'}"`;
      }
    }

    // Der Spawnpunkt darf NICHT von der Blockauswahl abhaengen.
    // The spawn point must NOT depend on the block selection.
    for (const teil of teile) {
      if (JSON.stringify(teil.spawnPunkt) !== JSON.stringify(voll.spawnPunkt)) {
        abweichungen++;
        if (ersteAbweichung === '') ersteAbweichung = `Seed ${i}: Spawnpunkt haengt an der Blockauswahl`;
      }
    }
  }

  pruefe(
    `(A) blockweise Gleichheit ueber ${BLOCK_SEEDS} Seeds (${bloeckeGesamt} Bloecke, ${stueckeGesamt} Stuecke)`,
    abweichungen === 0,
    ersteAbweichung
  );
}

/** Dieselbe Sortierung, die `baueGeometrie` selbst benutzt. / The builder's own sort. */
function sortiereWieBau(stuecke: readonly BauStueck[]): BauStueck[] {
  return [...stuecke]
    .map((wert, index) => ({ wert, index, s: stueckText(wert) }))
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.index - b.index))
    .map((e) => e.wert);
}

function stueckText(s: BauStueck): string {
  return [
    s.block.ebene,
    s.block.bz,
    s.block.bx,
    s.art,
    s.materialTag,
    s.mitte.y,
    s.mitte.z,
    s.mitte.x,
    s.groesse.y,
    s.groesse.z,
    s.groesse.x,
    s.drehung,
  ].join('|');
}

function sortiereKoerper<T extends { form: string; mitte: { x: number; y: number; z: number }; groesse: { x: number; y: number; z: number }; drehung: number; steigung?: number }>(
  liste: readonly T[]
): T[] {
  const text = (k: T): string =>
    [k.form, k.mitte.y, k.mitte.z, k.mitte.x, k.groesse.y, k.groesse.z, k.groesse.x, k.drehung, k.steigung ?? 0].join('|');
  return [...liste]
    .map((wert, index) => ({ wert, index, s: text(wert) }))
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.index - b.index))
    .map((e) => e.wert);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gleichheit ueber Seeds / equality across seeds
// ─────────────────────────────────────────────────────────────────────────────

const GLEICH_SEEDS = 100;

{
  const summen = new Set<string>();
  let ungleicheWiederholung = 0;
  for (let i = 0; i < GLEICH_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const a = baue(layout);
    const b = baue(layout);
    if (a.pruefsumme !== b.pruefsumme) ungleicheWiederholung++;
    summen.add(a.pruefsumme);
  }
  pruefe(`gleicher Seed -> gleiche Bau-Pruefsumme (${GLEICH_SEEDS} Seeds)`, ungleicheWiederholung === 0);
  pruefe(
    `${GLEICH_SEEDS} verschiedene Seeds -> ${summen.size} verschiedene Bau-Pruefsummen`,
    summen.size === GLEICH_SEEDS
  );
}

// Eingefrorene Tabelle. Neuausgabe mit DUNGEON2_EINFRIEREN=1 (siehe unten).
// Frozen table. Reprint with DUNGEON2_EINFRIEREN=1 (see below).
const EINGEFROREN: readonly (readonly [number, string, number, number, number])[] = [
  // Neu eingefroren am 2026-08-30: `ebenen-abstand` prueft seither die Kanten
  // der PLATTEN, der Generator beschneidet die Decke unter einem Stockwerk
  // (P8b) und sperrt die Zelle ueber dem unteren Treppenlauf. Beides aendert
  // Layouts absichtlich; Begruendung im `design/decisions-log.md`.
  // Zweites Mal am selben Tag: das Treppenhaus hat drei Laeufe statt zwei und
  // eine Schachtroehre darueber, weil zwei Laeufe 45 Grad steil und damit
  // unbegehbar waren (gemessen, `client/test/dungeon2-laeufer.ts`).
  // Re-frozen twice on 2026-08-30 — deliberate layout changes, see the log.
  //
  // Drittes Mal am 2026-08-31 (Befund 3): Wandanker sitzen nicht mehr in der
  // Zellmitte, sondern in der Wandflaeche (`wandAnkerVersatz`). Die
  // BEGRUENDUNG, warum das kein verstecktes zweites Ereignis ist, steht in den
  // Zahlen daneben: Stuecke, Koerper und Navzellen sind Spalte fuer Spalte
  // UNVERAENDERT (1018/939/303 usw.) — es hat sich kein Quader bewegt, nur die
  // Ankerkoordinaten, die in dieselbe Pruefsumme eingehen. Waere hier eine
  // Zahl mitgewandert, waere die Neueinfrierung nicht zu rechtfertigen.
  // Third re-freeze on 2026-08-31 (finding 3): wall anchors moved from the
  // cell centre onto the wall face. The justification stands in the numbers
  // beside them: pieces, bodies and nav cells are UNCHANGED column by column.
  [0, '11bf20b1', 1018, 939, 303],
  [1, '249616c3', 1172, 1061, 337],
  [7, '091f4e86', 1230, 1063, 324],
  [42, 'd6811ea6', 1039, 958, 309],
  [199, '14583bdc', 1113, 969, 296],
];

{
  const zeilen: string[] = [];
  let abweichungen = 0;
  let erste = '';
  for (const [index, summe, stuecke, koerper, nav] of EINGEFROREN) {
    const layout = erzeugeLayout(thema, seedsFuer(index));
    const ergebnis = baue(layout);
    zeilen.push(
      `${index}/${ergebnis.pruefsumme}/${ergebnis.stuecke.length}/${ergebnis.kollision.length}/${ergebnis.nav.length}`
    );
    const gleich =
      ergebnis.pruefsumme === summe &&
      ergebnis.stuecke.length === stuecke &&
      ergebnis.kollision.length === koerper &&
      ergebnis.nav.length === nav;
    if (!gleich) {
      abweichungen++;
      if (erste === '') {
        erste = `Seed ${index}: ${ergebnis.pruefsumme}/${ergebnis.stuecke.length}/${ergebnis.kollision.length}/${ergebnis.nav.length} statt ${summe}/${stuecke}/${koerper}/${nav}`;
      }
    }
  }
  if (process.env.DUNGEON2_EINFRIEREN === '1') {
    console.log('EINFRIEREN (Seed/Pruefsumme/Stuecke/Koerper/Nav):');
    for (const z of zeilen) console.log(`  ${z}`);
  }
  pruefe('eingefrorene Bau-Werte (5 Seeds) unveraendert', abweichungen === 0, erste);
}

// ─────────────────────────────────────────────────────────────────────────────
// (B1) Kanten-Manifold je Bauteil / edge manifold per piece
// ─────────────────────────────────────────────────────────────────────────────

const MANIFOLD_SEEDS = 10;

{
  let stuecke = 0;
  let gerichteteFehler = 0;
  let ungerichteteFehler = 0;
  let volumenFehler = 0;
  let normalenFehler = 0;
  let uvFehler = 0;
  let erste = '';

  for (let i = 0; i < MANIFOLD_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const ergebnis = baue(layout);
    for (const stueck of ergebnis.stuecke) {
      stuecke++;
      const netz = stueckZuNetz(stueck);

      if (netz.uv2.length !== (netz.positionen.length / 3) * 2) uvFehler++;
      if (netz.normalen.length !== netz.positionen.length) normalenFehler++;

      // Eckpunkte auf ihre EXAKTE Position verschweissen — 24 Netzecken werden
      // zu 8 Raumecken. Nur dann ist "jede gerichtete Kante genau einmal" eine
      // Aussage ueber das Volumen und nicht ueber die Vertexliste.
      // Weld vertices onto their EXACT position — 24 mesh corners become 8
      // spatial corners. Only then is "every directed edge exactly once" a
      // statement about the volume, not about the vertex list.
      const nummer = new Map<string, number>();
      const punktNummer: number[] = [];
      for (let v = 0; v < netz.positionen.length; v += 3) {
        const schluessel = `${netz.positionen[v]}|${netz.positionen[v + 1]}|${netz.positionen[v + 2]}`;
        let n = nummer.get(schluessel);
        if (n === undefined) {
          n = nummer.size;
          nummer.set(schluessel, n);
        }
        punktNummer.push(n);
      }

      const gerichtet = new Map<string, number>();
      const ungerichtet = new Map<string, number>();
      let volumen = 0;
      for (let t = 0; t < netz.indizes.length; t += 3) {
        const a = punktNummer[netz.indizes[t]!]!;
        const b = punktNummer[netz.indizes[t + 1]!]!;
        const c = punktNummer[netz.indizes[t + 2]!]!;
        for (const [von, nach] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          gerichtet.set(`${von}>${nach}`, (gerichtet.get(`${von}>${nach}`) ?? 0) + 1);
          const u = von < nach ? `${von}-${nach}` : `${nach}-${von}`;
          ungerichtet.set(u, (ungerichtet.get(u) ?? 0) + 1);
        }
        volumen += spatprodukt(netz, netz.indizes[t]!, netz.indizes[t + 1]!, netz.indizes[t + 2]!);
      }

      let g = true;
      for (const anzahl of gerichtet.values()) if (anzahl !== 1) g = false;
      let u = true;
      for (const anzahl of ungerichtet.values()) if (anzahl !== 2) u = false;
      if (!g) {
        gerichteteFehler++;
        if (erste === '') erste = `Seed ${i}, ${stueck.art}: gerichtete Kante mehrfach`;
      }
      if (!u) {
        ungerichteteFehler++;
        if (erste === '') erste = `Seed ${i}, ${stueck.art}: ungerichtete Kante nicht genau zweimal`;
      }
      if (!(volumen / 6 > 0)) {
        volumenFehler++;
        if (erste === '') erste = `Seed ${i}, ${stueck.art}: Volumen ${volumen / 6} <= 0`;
      }
    }
  }

  pruefe(
    `(B1) jede gerichtete Netzkante genau einmal (${stuecke} Stuecke, ${MANIFOLD_SEEDS} Seeds)`,
    gerichteteFehler === 0,
    erste
  );
  pruefe('(B1) jede ungerichtete Netzkante genau zweimal', ungerichteteFehler === 0, erste);
  pruefe('(B1) vorzeichenbehaftetes Volumen positiv (Umlaufrichtung nach aussen)', volumenFehler === 0, erste);
  pruefe('(B1) Normalen und uv2 haben die richtige Laenge', normalenFehler === 0 && uvFehler === 0);
  pruefe('(B1) es gab ueberhaupt Stuecke zu pruefen', stuecke > 1000, `${stuecke}`);
}

function spatprodukt(netz: { positionen: readonly number[] }, i0: number, i1: number, i2: number): number {
  const p = netz.positionen;
  const ax = p[i0 * 3]!;
  const ay = p[i0 * 3 + 1]!;
  const az = p[i0 * 3 + 2]!;
  const bx = p[i1 * 3]!;
  const by = p[i1 * 3 + 1]!;
  const bz = p[i1 * 3 + 2]!;
  const cx = p[i2 * 3]!;
  const cy = p[i2 * 3 + 1]!;
  const cz = p[i2 * 3 + 2]!;
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

// ─────────────────────────────────────────────────────────────────────────────
// (B2) Huellendeckung — der Leak-Gedanke als Zahlentest
// (B2) shell coverage — the leak idea as a numeric test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Punkt ist gedeckt, wenn er in einem festen Bauteil liegt (Boden, Wand,
 * Decke, Stufe, Tuerrahmen) ODER im lichten Raum einer begehbaren Zelle. Der
 * zweite Fall ist kein Schlupfloch: "offen in den Nachbarraum" ist genau das,
 * was eine Tuer sein soll — ein Leck ist "offen in den Fels".
 * A point is covered if it lies inside a solid piece (floor, wall, ceiling,
 * step, door frame) OR inside the clear space of a walkable cell. The second
 * case is not a loophole: "open into the neighbouring room" is exactly what a
 * doorway is — a leak is "open into the rock".
 */
const FESTE_ARTEN = new Set(['boden', 'wand', 'decke', 'stufe', 'tuerrahmen']);
const RASTER_M = 4;

function raum(x: number, y: number, z: number): string {
  return `${Math.floor(x / RASTER_M)}|${Math.floor(y / RASTER_M)}|${Math.floor(z / RASTER_M)}`;
}

function baueIndex(stuecke: readonly BauStueck[], alleArten = false): Map<string, BauStueck[]> {
  const index = new Map<string, BauStueck[]>();
  for (const s of stuecke) {
    if (!alleArten && !FESTE_ARTEN.has(s.art)) continue;
    const x0 = Math.floor((s.mitte.x - s.groesse.x / 2) / RASTER_M);
    const x1 = Math.floor((s.mitte.x + s.groesse.x / 2) / RASTER_M);
    const y0 = Math.floor((s.mitte.y - s.groesse.y / 2) / RASTER_M);
    const y1 = Math.floor((s.mitte.y + s.groesse.y / 2) / RASTER_M);
    const z0 = Math.floor((s.mitte.z - s.groesse.z / 2) / RASTER_M);
    const z1 = Math.floor((s.mitte.z + s.groesse.z / 2) / RASTER_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const schluessel = `${x}|${y}|${z}`;
          const liste = index.get(schluessel);
          if (liste === undefined) index.set(schluessel, [s]);
          else liste.push(s);
        }
      }
    }
  }
  return index;
}

function imFesten(
  index: Map<string, BauStueck[]>,
  x: number,
  y: number,
  z: number,
  ausser1?: BauStueck,
  ausser2?: BauStueck
): boolean {
  for (const s of index.get(raum(x, y, z)) ?? []) {
    if (s === ausser1 || s === ausser2) continue;
    if (Math.abs(x - s.mitte.x) >= s.groesse.x / 2) continue;
    if (Math.abs(y - s.mitte.y) >= s.groesse.y / 2) continue;
    if (Math.abs(z - s.mitte.z) >= s.groesse.z / 2) continue;
    return true;
  }
  return false;
}

function imLichten(gitter: ZellenGitter, x: number, y: number, z: number): boolean {
  const zx = Math.floor(x / ZELLE_M);
  const zz = Math.floor(z / ZELLE_M);
  for (const zelle of zellenAnPosition(gitter, zx, zz)) {
    const unten = bodenStufens(zelle) * HOEHEN_SCHRITT_M;
    const oben = obenStufen(gitter, zelle) * HOEHEN_SCHRITT_M;
    if (y > unten && y < oben) return true;
  }
  return false;
}

function bodenStufens(zelle: Zelle): number {
  return bodenStufen(zelle);
}

function zellenAnPosition(gitter: ZellenGitter, x: number, z: number): Zelle[] {
  const treffer: Zelle[] = [];
  for (let ebene = -4; ebene <= 8; ebene++) {
    const zelle = zelleImGitter(gitter, x, z, ebene);
    if (zelle !== undefined && offen(zelle.art)) treffer.push(zelle);
  }
  return treffer;
}

const LECK_SEEDS = 10;

{
  let lecks = 0;
  let proben = 0;
  let erstesLeck = '';

  for (let i = 0; i < LECK_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const ergebnis = baue(layout, gitter);
    const index = baueIndex(ergebnis.stuecke);

    for (const zelle of zellenSortiert(gitter)) {
      if (!offen(zelle.art)) continue;
      const unten = bodenStufen(zelle);
      const oben = obenStufen(gitter, zelle);
      // Der Probenpunkt in der Zellflaeche liegt ein halbes Achtel NEBEN der
      // Zellmitte. Grund: die Mitte faellt genau auf die Naht zwischen dem
      // vierten und fuenften Stufenquader einer Treppenzelle, und `imFesten`
      // zaehlt (richtigerweise, `>=`) einen Punkt genau auf einer Flaeche als
      // aussen. Eine nahtbreite Fuge ist kein Leck — wer sie als eines meldet,
      // misst das Probenraster statt das Grab. Der Versatz bleibt weit
      // innerhalb der Zelle und trifft weiter jede echte Luecke.
      // The in-plane probe point sits half an eighth BESIDE the cell centre.
      // Reason: the centre falls exactly on the seam between the fourth and
      // fifth step box of a stair cell, and `imFesten` counts (rightly, `>=`) a
      // point exactly on a face as outside. A seam of zero width is not a leak
      // — reporting it as one measures the probe grid, not the barrow. The
      // offset stays well inside the cell and still hits every real gap.
      const mx = (zelle.x * 2 + 1) * (ZELLE_M / 2) + ACHTEL_M / 2;
      const mz = (zelle.z * 2 + 1) * (ZELLE_M / 2) + ACHTEL_M / 2;

      // Vier Seiten: unmittelbar HINTER der Zellgrenze (halbes Achtel weiter)
      // muss Fels sein — also festes Bauteil oder Nachbarraum.
      //
      // Und zwar an DREI Stellen jeder Kante, nicht nur in ihrer Mitte: dicht
      // bei beiden Ecken und dazwischen. In den Ecken stossen die Wandstreifen
      // zweier Richtungen aneinander, dort stutzen Sturz, Laibung und Pfosten
      // ihre Enden — und genau dort riss ein Beschnitt beim ersten Anlauf eine
      // handbreite schwarze Spalte auf, die die Mittenprobe nicht sah. Eine
      // Probe in der Mitte misst die Wand, nicht ihre Naehte.
      // Four sides: immediately BEHIND the cell border (half an eighth further)
      // there must be rock — i.e. solid piece or neighbouring room. And at THREE
      // places along every edge, not only at its middle: close to both corners
      // and in between. In the corners the wall strips of two directions meet,
      // and there header, reveal and posts trim their ends — exactly where one
      // trim tore open a black slit on the first attempt, which the middle probe
      // did not see. A probe in the middle measures the wall, not its seams.
      const laengsProben = [ACHTEL_M / 2, ZELLE_M / 2, ZELLE_M - ACHTEL_M / 2];
      for (const kante of KANTEN) {
        const n = nachbarZelle(zelle.x, zelle.z, kante);
        void n;
        const querKante = kante === KANTE.Nord || kante === KANTE.Sued;
        for (const versatz of laengsProben) {
          const px =
            kante === KANTE.Ost
              ? (zelle.x + 1) * ZELLE_M + ACHTEL_M / 2
              : kante === KANTE.West
                ? zelle.x * ZELLE_M - ACHTEL_M / 2
                : zelle.x * ZELLE_M + versatz;
          const pz =
            kante === KANTE.Nord
              ? (zelle.z + 1) * ZELLE_M + ACHTEL_M / 2
              : kante === KANTE.Sued
                ? zelle.z * ZELLE_M - ACHTEL_M / 2
                : zelle.z * ZELLE_M + versatz;
          void querKante;
          for (let stufe = unten; stufe < oben; stufe++) {
            const y = (stufe + 0.5) * HOEHEN_SCHRITT_M;
            proben++;
            if (imFesten(index, px, y, pz) || imLichten(gitter, px, y, pz)) continue;
            lecks++;
            if (erstesLeck === '') {
              erstesLeck = `Seed ${i}: Zelle (${zelle.x},${zelle.z},${zelle.ebene}) Kante ${kante} bei x=${px}, y=${y}, z=${pz}`;
            }
          }
        }
      }

      // Unter dem Boden und ueber der Decke.
      // Below the floor and above the ceiling.
      for (const [y, wo] of [
        [(unten - 0.5) * HOEHEN_SCHRITT_M, 'unter dem Boden'],
        [(oben + 0.5) * HOEHEN_SCHRITT_M, 'ueber der Decke'],
      ] as const) {
        proben++;
        if (imFesten(index, mx, y, mz) || imLichten(gitter, mx, y, mz)) continue;
        lecks++;
        if (erstesLeck === '') {
          erstesLeck = `Seed ${i}: Zelle (${zelle.x},${zelle.z},${zelle.ebene}) ${wo} bei y=${y}`;
        }
      }
    }
  }

  pruefe(
    `(B2) geschlossene Huelle: ${proben} Proben ueber ${LECK_SEEDS} Seeds, kein Leck`,
    lecks === 0,
    erstesLeck
  );
  pruefe('(B2) es wurde ueberhaupt geprobt', proben > 20000, `${proben}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (C) Kollision aus demselben Layout / collision from the same layout
// ─────────────────────────────────────────────────────────────────────────────

{
  const layout = erzeugeLayout(thema, seedsFuer(11));
  const a = baue(layout);
  const b = baue(layout);
  pruefe(
    '(C) zwei Laeufe liefern bitgleiche Kollision',
    JSON.stringify(a.kollision) === JSON.stringify(b.kollision)
  );

  // Rein optische Bauteile duerfen KEINEN Kollisionskoerper haben, sonst haenge
  // das Laufgefuehl an der Grafikstufe (Vertragsregel 5). Gemessen ueber die
  // Zahl: die Zahl der Koerper ist genau die Zahl der festen Stuecke plus die
  // Rampen der Treppenzellen.
  // Purely visual pieces must have NO collision body, otherwise the way it
  // walks would depend on the graphics tier (contract rule 5). Measured by
  // count: the number of bodies is exactly the number of solid pieces plus the
  // ramps of the stair cells.
  const feste = a.stuecke.filter((s) => FESTE_ARTEN.has(s.art) && s.art !== 'stufe').length;
  const rampen = a.kollision.filter((k) => k.form === 'rampe').length;
  const boxen = a.kollision.filter((k) => k.form === 'box').length;
  pruefe(
    '(C) genau ein Kollisionskoerper je festem Bauteil, keiner je Sims',
    boxen === feste,
    `${boxen} Boxen gegen ${feste} feste Stuecke (Rampen: ${rampen})`
  );
  pruefe(
    '(C) es gibt ueberhaupt rein optische Bauteile (sonst prueft die Zeile darueber nichts)',
    a.stuecke.some((s) => s.art === 'sims'),
    'kein einziger Sims im Grab'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (D) Kein Haarriss / no hairline crack
// ─────────────────────────────────────────────────────────────────────────────

{
  // Ein Layout von Hand: 60x60 Zellen als EIN Stempel. Das ist der Fall, der
  // eine akkumulierende Rechnung entlarvt — bei 60 Schritten sind die Fehler
  // gross genug, um sie zu sehen, und klein genug, um sie zu uebersehen.
  // A hand-built layout: 60x60 cells as ONE stamp. This is the case that
  // exposes an accumulating calculation.
  const gross = handLayout({
    stempel: [
      {
        id: 1,
        typ: 'saal',
        x: 0,
        z: 0,
        ebene: 0,
        breite: 60,
        tiefe: 60,
        hoehe: 10,
        bodenVersatz: 0,
        drehung: 0,
        seed: 1,
        variante: 0,
        ordnung: 0,
        tiefeImBaum: 0,
      },
    ],
    grenzen: { minX: -1, maxX: 61, minZ: -1, maxZ: 61, minEbene: 0, maxEbene: 0 },
  });
  const ergebnis = baue(gross);
  const boeden = ergebnis.stuecke.filter((s) => s.art === 'boden');
  pruefe('(D) 60x60 Zellen ergeben 3600 Bodenstuecke', boeden.length === 3600, `${boeden.length}`);

  // Nachbarschaft ueber die exakte Kante: die Oberkante von A muss die
  // Unterkante von B auf 0 treffen, nicht auf 1e-6.
  // Adjacency across the exact border: A's max must meet B's min at 0, not at
  // 1e-6.
  const nachPosition = new Map<string, BauStueck>();
  for (const s of boeden) nachPosition.set(`${s.mitte.x}|${s.mitte.z}`, s);
  let groessteLuecke = 0;
  let paare = 0;
  for (const s of boeden) {
    for (const [dx, dz] of [
      [ZELLE_M, 0],
      [0, ZELLE_M],
    ] as const) {
      const nachbar = nachPosition.get(`${s.mitte.x + dx}|${s.mitte.z + dz}`);
      if (nachbar === undefined) continue;
      paare++;
      const kanteA = dx !== 0 ? s.mitte.x + s.groesse.x / 2 : s.mitte.z + s.groesse.z / 2;
      const kanteB = dx !== 0 ? nachbar.mitte.x - nachbar.groesse.x / 2 : nachbar.mitte.z - nachbar.groesse.z / 2;
      const luecke = Math.abs(kanteA - kanteB);
      if (luecke > groessteLuecke) groessteLuecke = luecke;
      const hoehe = Math.abs(s.mitte.y - nachbar.mitte.y);
      if (hoehe > groessteLuecke) groessteLuecke = hoehe;
    }
  }
  pruefe(
    `(D) kein Haarriss ueber ${paare} Nachbarpaare (groesste Luecke ${groessteLuecke} m)`,
    paare > 7000 && groessteLuecke === 0,
    `${groessteLuecke}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Meter-Exaktheit, Materialkennungen, Bloecke
// exact metres, material tags, blocks
// ─────────────────────────────────────────────────────────────────────────────

{
  const layout = erzeugeLayout(thema, seedsFuer(5));
  const gitter = zellenAufbauen(layout, materialOptionen);
  const ergebnis = baue(layout, gitter);

  let unExakt = 0;
  let ausserhalb = 0;
  let falscherBlock = 0;
  for (const s of ergebnis.stuecke) {
    for (const w of [s.mitte.x, s.mitte.y, s.mitte.z, s.groesse.x, s.groesse.y, s.groesse.z]) {
      if (!Number.isInteger(w * 4)) unExakt++;
    }
    if (s.materialTag < 0 || s.materialTag > MAX_MATERIAL_TAG) ausserhalb++;
    const bx = Math.floor(Math.floor(s.mitte.x / ZELLE_M) / BLOCK_ZELLEN);
    const bz = Math.floor(Math.floor(s.mitte.z / ZELLE_M) / BLOCK_ZELLEN);
    // Wandquader liegen mittig auf der Zellgrenze; ihre Mitte kann deshalb in
    // die Nachbarzelle fallen. Erlaubt ist Abweichung um hoechstens einen Block.
    // Wall boxes sit centred on the cell border; their centre may therefore fall
    // into the neighbouring cell. A deviation of at most one block is allowed.
    if (Math.abs(bx - s.block.bx) > 1 || Math.abs(bz - s.block.bz) > 1) falscherBlock++;
  }
  pruefe('alle Masse sind Vielfache von 0,25 m (exakt, kein Rundungsrest)', unExakt === 0, `${unExakt}`);
  pruefe(`alle materialTag in 0..${MAX_MATERIAL_TAG} (Overlays 6-9 sind Blend-Layer, W5)`, ausserhalb === 0);
  pruefe('jedes Stueck liegt im oder direkt an seinem Block', falscherBlock === 0, `${falscherBlock}`);

  // Jede begehbare Zelle hat genau eine Nav-Zelle, und die Nav-Bloecke stimmen.
  // Every walkable cell has exactly one nav cell, and the nav blocks match.
  const begehbar = zellenSortiert(gitter).filter((z) => offen(z.art)).length;
  pruefe(`nav deckt jede begehbare Zelle (${ergebnis.nav.length} von ${begehbar})`, ergebnis.nav.length === begehbar);
  let navBlockFehler = 0;
  for (const n of ergebnis.nav) {
    const soll = blockVonZelle(n.x, n.z, n.ebene);
    if (blockSchluessel(soll) !== blockSchluessel(n.block)) navBlockFehler++;
  }
  pruefe('nav-Bloecke stimmen mit blockVonZelle ueberein', navBlockFehler === 0);

  // Deko-Plaetze: jeder Anker in einer begehbaren Zelle wird aufgeloest.
  // Decor places: every anchor in a walkable cell is resolved.
  const ankerInZellen = layout.anker.filter((a) => {
    const z = zelleImGitter(gitter, a.x, a.z, a.ebene);
    return z !== undefined && offen(z.art);
  }).length;
  pruefe(
    `dekoPlaetze loest jeden Anker in einer begehbaren Zelle auf (${ergebnis.dekoPlaetze.length} von ${ankerInZellen})`,
    ergebnis.dekoPlaetze.length === ankerInZellen && ankerInZellen > 0
  );
  let ankerAusserhalb = 0;
  for (const d of ergebnis.dekoPlaetze) {
    if (d.position.x < ergebnis.huelle.min.x || d.position.x > ergebnis.huelle.max.x) ankerAusserhalb++;
    if (d.position.z < ergebnis.huelle.min.z || d.position.z > ergebnis.huelle.max.z) ankerAusserhalb++;
  }
  pruefe('alle Deko-Plaetze liegen in der Huelle', ankerAusserhalb === 0);

  // Spawnpunkt sitzt auf der Bodenoberkante der Eingangszelle.
  // The spawn point sits on the floor top of the entrance cell.
  const eingang = zelleImGitter(gitter, layout.eingang.x, layout.eingang.z, layout.eingang.ebene);
  pruefe(
    'Spawnpunkt sitzt in der Mitte der Eingangszelle, auf ihrer Bodenoberkante',
    eingang !== undefined &&
      ergebnis.spawnPunkt.x === (eingang.x * 2 + 1) * (ZELLE_M / 2) &&
      ergebnis.spawnPunkt.z === (eingang.z * 2 + 1) * (ZELLE_M / 2) &&
      ergebnis.spawnPunkt.y === bodenStufen(eingang) * HOEHEN_SCHRITT_M
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Handfaelle: Treppe und Schacht / hand cases: stairs and shafts
// ─────────────────────────────────────────────────────────────────────────────

function handLayout(teile: {
  stempel: readonly RaumStempel[];
  grenzen: DungeonLayout2['grenzen'];
  korrekturen?: readonly ZellenKorrektur[];
  eingang?: DungeonLayout2['eingang'];
}): DungeonLayout2 {
  return mitPruefsumme({
    format: 'wov-dungeon-layout',
    version: 1,
    id: 'hand',
    name: 'Handfall',
    thema: 'steingrab',
    seeds: { architektur: 1, material: 2, deko: 3 },
    raster: { zelleM: ZELLE_M, ebeneM: 8, hoehenSchrittM: HOEHEN_SCHRITT_M, blockZellen: BLOCK_ZELLEN },
    grenzen: teile.grenzen,
    eingang: teile.eingang ?? { x: 0, z: 0, ebene: 0, kante: KANTE.Sued },
    stempel: teile.stempel,
    korrekturen: teile.korrekturen ?? [],
    tueren: [],
    anker: [],
    pruefsumme: '',
  });
}

function stempel(teile: Partial<RaumStempel> & { id: number }): RaumStempel {
  return {
    typ: 'kammer',
    x: 0,
    z: 0,
    ebene: 0,
    breite: 2,
    tiefe: 2,
    hoehe: 10,
    bodenVersatz: 0,
    drehung: 0,
    seed: 1,
    variante: 0,
    ordnung: 0,
    tiefeImBaum: 0,
    ...teile,
  };
}

{
  // Treppenzelle: ein 3x1-Gang, dessen mittlere Zelle eine Treppe nach Norden
  // ist und deren Nordnachbarin zwei Stufen hoeher liegt.
  // Stair cell: a 3x1 corridor whose middle cell is a stair to the north and
  // whose northern neighbour lies two steps higher.
  const layout = handLayout({
    stempel: [stempel({ id: 1, x: 0, z: 0, breite: 1, tiefe: 3, hoehe: 10 })],
    korrekturen: [
      { x: 0, z: 1, ebene: 0, aendere: { art: ZELLEN_ART.Treppe, neigung: KANTE.Nord } },
      { x: 0, z: 2, ebene: 0, aendere: { boden: 2 } },
    ],
    grenzen: { minX: -1, maxX: 2, minZ: -1, maxZ: 4, minEbene: 0, maxEbene: 0 },
  });
  const ergebnis = baue(layout);
  const stufen = ergebnis.stuecke.filter((s) => s.art === 'stufe');
  const rampen = ergebnis.kollision.filter((k) => k.form === 'rampe');
  pruefe('Treppenzelle liefert acht Stufenquader', stufen.length === 8, `${stufen.length}`);
  pruefe('Treppenzelle liefert genau EINE Rampe als Kollision', rampen.length === 1, `${rampen.length}`);
  pruefe('die Rampe traegt die gemessene Steigung 2', rampen[0]?.steigung === 2, `${rampen[0]?.steigung}`);
  pruefe(
    'kein Bodenquader in der Treppenzelle (die Stufen SIND der Boden)',
    !ergebnis.stuecke.some(
      (s) => s.art === 'boden' && s.mitte.z > ZELLE_M && s.mitte.z < 2 * ZELLE_M
    )
  );
  // Die Stufen steigen an: die letzte ist hoeher als die erste.
  // The steps rise: the last is higher than the first.
  const oben = stufen.map((s) => s.mitte.y + s.groesse.y / 2);
  pruefe('die Stufen steigen an', Math.max(...oben) > Math.min(...oben));
}

{
  // Schacht: zwei Ebenen uebereinander, die obere Zelle (0,0,1) ist ein
  // Schacht ueber der begehbaren Zelle (0,0,0).
  // Shaft: two storeys, the upper cell (0,0,1) is a shaft above the walkable
  // cell (0,0,0).
  const layout = handLayout({
    stempel: [
      stempel({ id: 1, x: 0, z: 0, ebene: 0, breite: 2, tiefe: 2, hoehe: 10 }),
      stempel({ id: 2, x: 0, z: 0, ebene: 1, breite: 2, tiefe: 2, hoehe: 10, ordnung: 1 }),
    ],
    korrekturen: [{ x: 0, z: 0, ebene: 1, aendere: { art: ZELLEN_ART.Schacht } }],
    grenzen: { minX: -1, maxX: 3, minZ: -1, maxZ: 3, minEbene: 0, maxEbene: 1 },
  });
  const gitter = zellenAufbauen(layout, materialOptionen);
  const ergebnis = baue(layout, gitter);
  const inZelle = (s: BauStueck, x: number, z: number): boolean =>
    s.mitte.x > x * ZELLE_M && s.mitte.x < (x + 1) * ZELLE_M && s.mitte.z > z * ZELLE_M && s.mitte.z < (z + 1) * ZELLE_M;
  const bodenImSchacht = ergebnis.stuecke.some(
    (s) => s.art === 'boden' && inZelle(s, 0, 0) && s.mitte.y > 7
  );
  const deckeDarunter = ergebnis.stuecke.some(
    (s) => s.art === 'decke' && inZelle(s, 0, 0) && s.mitte.y < 7
  );
  pruefe('Schachtzelle bekommt keine Bodenplatte', !bodenImSchacht);
  pruefe('die Zelle unter dem Schacht bekommt keine Deckenplatte', !deckeDarunter);

  // Die Wandsaeule darunter reicht bis zum Schachtboden hinauf — sonst bliebe
  // ein Ring offen, und genau das waere das Leck.
  // The wall column below reaches up to the shaft floor — otherwise a ring
  // would stay open, and that is exactly the leak.
  const untenZelle = zelleImGitter(gitter, 0, 0, 0)!;
  pruefe(
    'obenStufen zieht die Saeule unter dem Schacht bis auf dessen Bodenhoehe',
    obenStufen(gitter, untenZelle) === bodenStufen(zelleImGitter(gitter, 0, 0, 1)!)
  );

  const index = baueIndex(ergebnis.stuecke);
  let lecks = 0;
  for (const zelle of zellenSortiert(gitter)) {
    if (!offen(zelle.art)) continue;
    const mx = (zelle.x * 2 + 1) * (ZELLE_M / 2);
    const mz = (zelle.z * 2 + 1) * (ZELLE_M / 2);
    for (const kante of KANTEN) {
      const px = kante === KANTE.Ost ? (zelle.x + 1) * ZELLE_M + ACHTEL_M / 2 : kante === KANTE.West ? zelle.x * ZELLE_M - ACHTEL_M / 2 : mx;
      const pz = kante === KANTE.Nord ? (zelle.z + 1) * ZELLE_M + ACHTEL_M / 2 : kante === KANTE.Sued ? zelle.z * ZELLE_M - ACHTEL_M / 2 : mz;
      for (let stufe = bodenStufen(zelle); stufe < obenStufen(gitter, zelle); stufe++) {
        const y = (stufe + 0.5) * HOEHEN_SCHRITT_M;
        if (!imFesten(index, px, y, pz) && !imLichten(gitter, px, y, pz)) lecks++;
      }
    }
  }
  pruefe('der Schacht bleibt dicht (keine offene Kante zwischen den Ebenen)', lecks === 0, `${lecks}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (E) Treppen kommen an / stairs arrive
// ─────────────────────────────────────────────────────────────────────────────
//
// WAECHTER. Der Fehler, den dieser Block fangen soll, hatte in KEINER Zaehlung
// ein Symptom: `baueStufen()` war jahrelang tot, weil der Generator keine
// einzige `Treppe`-Zelle erzeugte (er verband Ebenen mit zwei Schachtzellen),
// und als es sie gab, mass der obere Lauf einen Anstieg von 0 und baute acht
// gleich hohe Quader — also einen flachen Boden. Stueckzahl, Dreieckszahl,
// Manifold, Dichtheit: alles blieb gruen. Gemessen wird deshalb nicht "es gibt
// Stufenstuecke", sondern "sie steigen", und zwar an der ZAHL DER
// VERSCHIEDENEN Oberkanten.
// GUARD. The fault this block catches had a symptom in NO count: `baueStufen()`
// was dead because the generator produced not a single `Treppe` cell, and once
// it did, the upper run measured a rise of 0 and built eight boxes of equal
// height — a flat floor. Piece count, triangle count, manifold, tightness: all
// stayed green. So what is measured is not "step pieces exist" but "they rise",
// via the NUMBER OF DISTINCT top faces.

{
  let seedsMitTreppe = 0;
  let stufenGesamt = 0;
  let flacheLaeufe = 0;
  let ersterFlacher = '';
  let obersteStufeAmEnde = 0;
  let treppenZellen = 0;
  let hubGesamt = 0;
  let aufgaenge = 0;

  for (let i = 0; i < 12; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const treppen = zellenSortiert(gitter).filter((z) => z.art === ZELLEN_ART.Treppe);
    if (treppen.length === 0) continue;
    seedsMitTreppe++;
    treppenZellen += treppen.length;
    // Ein Aufgang ist eine MUENDUNG: die Schachtzelle ueber dem obersten Lauf.
    // Ueber den unteren Laeufen steht ebenfalls je eine Schachtzelle (das
    // Treppenhaus ist eine durchgehende Roehre), die zaehlt hier nicht mit.
    // One ascent is one MOUTH: the shaft cell above the topmost run. A shaft cell
    // stands above the lower runs too, and those do not count here.
    aufgaenge += zellenSortiert(gitter).filter((z) => {
      if (z.art !== ZELLEN_ART.Schacht) return false;
      const unten = zelleImGitter(gitter, z.x, z.z, z.ebene - 1);
      if (unten === undefined || unten.art !== ZELLEN_ART.Treppe) return true;
      const w = nachbarZelle(unten.x, unten.z, unten.neigung ?? KANTE.Nord);
      const weiter = zelleImGitter(gitter, w.x, w.z, unten.ebene);
      return weiter === undefined || weiter.art !== ZELLEN_ART.Treppe;
    }).length;
    const ergebnis = baue(layout, gitter);
    const stufen = ergebnis.stuecke.filter((s) => s.art === 'stufe');
    stufenGesamt += stufen.length;

    for (const zelle of treppen) {
      const inZelle = stufen.filter(
        (s) =>
          s.mitte.x > zelle.x * ZELLE_M &&
          s.mitte.x < (zelle.x + 1) * ZELLE_M &&
          s.mitte.z > zelle.z * ZELLE_M &&
          s.mitte.z < (zelle.z + 1) * ZELLE_M &&
          Math.abs(s.mitte.y - bodenStufen(zelle) * HOEHEN_SCHRITT_M) < ZELLE_M * 2
      );
      // Acht Quader je Treppenzelle, und so viele VERSCHIEDENE Oberkanten, wie
      // der Lauf Hoehenstufen steigt. Waere der Anstieg 0, waere es EINE — die
      // Zahl der Quader bliebe acht.
      //
      // Seit dem 2026-08-30 steigt ein Lauf 6 oder 5 Stufen ueber acht Achtel
      // (frueher 8 ueber 8, also 45 Grad — unbegehbar, siehe `generator.ts`
      // `TREPPE_ANSTIEGE`). Acht Achtel auf fuenf Stufen zu verteilen heisst,
      // dass drei Trittflaechen zwei Achtel tief sind statt eines; die Quader
      // bleiben acht, die Oberkanten werden fuenf.
      // Eight boxes per stair cell, and as many DISTINCT top faces as the run
      // climbs height steps. Since 2026-08-30 a run climbs 6 or 5 steps across
      // eight eighths (formerly 8 over 8, i.e. 45 degrees — unwalkable).
      const oberkanten = new Set(inZelle.map((s) => s.mitte.y + s.groesse.y / 2));
      const anstieg = treppenAnstieg(gitter, zelle);
      if (inZelle.length !== 8 || oberkanten.size !== anstieg) {
        flacheLaeufe++;
        if (ersterFlacher === '') {
          ersterFlacher = `Seed ${i}: Zelle (${zelle.x},${zelle.z},E${zelle.ebene}) hat ${inZelle.length} Stufenquader mit ${oberkanten.size} verschiedenen Oberkanten`;
        }
        continue;
      }
      // Die oberste Stufe endet an der Sohle des Ziels — also genau `anstieg`
      // Hoehenstufen ueber dem eigenen Boden. NICHT mehr „eine halbe Ebene":
      // ein Aufgang besteht seit dem 2026-08-30 aus drei ungleichen Laeufen
      // (6 + 5 + 5 = 16), und ihre SUMME ist die Ebene.
      // The topmost step ends at the target's sole, i.e. exactly `anstieg` height
      // steps above its own floor. No longer "half a storey": an ascent consists
      // of three unequal runs whose SUM is the storey.
      const hoechste = Math.max(...oberkanten);
      const hub = hoechste - bodenStufen(zelle) * HOEHEN_SCHRITT_M;
      if (Math.abs(hub - anstieg * HOEHEN_SCHRITT_M) < 1e-9) obersteStufeAmEnde++;
      hubGesamt += hub;
    }
  }

  pruefe(
    `(E) erzeugte Grabmaeler enthalten Treppenzellen (${seedsMitTreppe} von 12 Seeds, ${treppenZellen} Zellen)`,
    seedsMitTreppe >= 6 && treppenZellen >= 12,
    `${seedsMitTreppe} Seeds, ${treppenZellen} Zellen`
  );
  pruefe(
    `(E) jede Treppenzelle liefert acht STEIGENDE Stufenquader (${stufenGesamt} Stuecke)`,
    flacheLaeufe === 0 && stufenGesamt === treppenZellen * 8,
    ersterFlacher !== '' ? ersterFlacher : `${stufenGesamt} Stuecke bei ${treppenZellen} Zellen`
  );
  pruefe(
    `(E) jeder Lauf endet an der Sohle seines Ziels (${obersteStufeAmEnde} von ${treppenZellen} Laeufen)`,
    obersteStufeAmEnde === treppenZellen,
    `${obersteStufeAmEnde} von ${treppenZellen} Laeufen`
  );
  // Und die SUMME ist die Ebene: drei Laeufe je Aufgang, zusammen 8 m. Ohne
  // diese Zeile koennte jeder Lauf einzeln „an der Sohle seines Ziels" enden und
  // der Aufgang trotzdem auf halber Hoehe steckenbleiben.
  // And the SUM is the storey: three runs per ascent, 8 m together. Without this
  // line every run could end "at its target's sole" and the ascent still stop
  // halfway.
  pruefe(
    `(E) die Laeufe eines Aufgangs ueberwinden zusammen eine Ebene (${EBENE_M} m)`,
    aufgaenge > 0 && Math.abs(hubGesamt - aufgaenge * EBENE_M) < 1e-9,
    `${hubGesamt.toFixed(2)} m ueber ${aufgaenge} Aufgaenge`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (F) Koplanaritaet — keine zwei Flaechen streiten um dieselben Pixel
// (F) coplanarity — no two faces fight over the same pixels
// ─────────────────────────────────────────────────────────────────────────────
//
// WAECHTER zu einem Befund aus der Vorschau: auf Bodenflaechen flackerten
// streifenweise helle Mauerwerkstexturen durch. Ursache war, dass Waende und
// Tuerpfosten bis UNTER die Bodenplatte und bis UEBER die Deckenplatte reichten
// und ihre Deckflaechen damit exakt in deren Ebenen fielen — auf dem Stockwerk
// darueber sah man das als Streifen, weil senkrechte Bauteile den Wand-Tag
// tragen (`materialFuer`), waagerechte den Zell-Tag.
//
// Was gemessen wird: Flaechenpaare, die (1) in DERSELBEN Ebene liegen,
// (2) in DIESELBE Richtung blicken und (3) sich mit echter Flaeche ueberlappen.
// Nur diese drei zusammen sind Z-Fighting. Zwei koplanare Flaechen, die
// VONEINANDER WEG blicken, sind eine Beruehrung — davon lebt jeder Quaderbau,
// und ein Test, der sie meldet, meldet die Bauart statt einen Fehler.
//
// Und nur, was man SEHEN kann: die Probe einen Hauch vor der Flaeche muss im
// lichten Raum einer begehbaren Zelle liegen und darf nicht in einem dritten
// Bauteil stecken. Zwei Wandenden, die sich tief im Fels durchdringen,
// flackern nirgends.
//
// GUARD for a finding from the preview: light masonry textures flickered
// through the floor in stripes. Cause: walls and door posts reached BELOW the
// floor slab and ABOVE the ceiling slab, so their end faces fell exactly into
// those slabs' planes. Measured are face pairs that (1) lie in the SAME plane,
// (2) look in the SAME direction and (3) overlap with real area — only all
// three together are z-fighting; coplanar faces looking AWAY from each other
// are a contact surface, which every box build lives on. And only what can be
// SEEN: the probe a hair in front of the face must lie in the clear space of a
// walkable cell and must not sit inside a third piece.

/**
 * Anstieg einer Treppenzelle in Hoehenstufen, GEMESSEN wie im Bauer: am oberen
 * Ende des Laufs, und das ist entweder die Nachbarzelle in Neigungsrichtung
 * oder die Schachtmuendung darueber.
 * Rise of a stair cell in height steps, MEASURED as in the builder.
 */
function treppenAnstieg(gitter: ZellenGitter, zelle: dungeon2.Zelle): number {
  const unten = bodenStufen(zelle);
  const neigung = zelle.neigung;
  if (neigung !== undefined) {
    const p = nachbarZelle(zelle.x, zelle.z, neigung);
    const seitlich = zelleImGitter(gitter, p.x, p.z, zelle.ebene);
    if (seitlich !== undefined && offen(seitlich.art) && bodenStufen(seitlich) > unten) {
      return bodenStufen(seitlich) - unten;
    }
  }
  const muendung = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
  if (muendung !== undefined && muendung.art === ZELLEN_ART.Schacht) {
    return bodenStufen(muendung) - unten;
  }
  return 0;
}

const KOPLANAR_SEEDS = 12;
const KOPLANAR_EPS = 1e-4;
/**
 * Arten, deren waagerechte Flaechen der Spieler unmittelbar ansieht: Boden und
 * Trittflaeche unter den Fuessen, Decke ueber dem Kopf, Sims auf Augenhoehe.
 * Genau hier trat der gemeldete Fehler auf, und genau hier gilt NULL.
 * Kinds whose horizontal faces the player looks at directly. Exactly where the
 * reported fault appeared, and exactly where ZERO holds.
 */
const SICHTFLAECHEN = new Set<BauStueckArt>(['boden', 'decke', 'stufe', 'sims']);
interface Flaeche {
  readonly achse: 0 | 1 | 2;
  readonly koord: number;
  readonly a0: number;
  readonly a1: number;
  readonly b0: number;
  readonly b1: number;
  readonly richtung: 1 | -1;
  readonly stueck: number;
}

function flaechenVon(s: BauStueck, stueck: number): Flaeche[] {
  const x0 = s.mitte.x - s.groesse.x / 2;
  const x1 = s.mitte.x + s.groesse.x / 2;
  const y0 = s.mitte.y - s.groesse.y / 2;
  const y1 = s.mitte.y + s.groesse.y / 2;
  const z0 = s.mitte.z - s.groesse.z / 2;
  const z1 = s.mitte.z + s.groesse.z / 2;
  return [
    { achse: 0, koord: x0, a0: y0, a1: y1, b0: z0, b1: z1, richtung: -1, stueck },
    { achse: 0, koord: x1, a0: y0, a1: y1, b0: z0, b1: z1, richtung: 1, stueck },
    { achse: 1, koord: y0, a0: x0, a1: x1, b0: z0, b1: z1, richtung: -1, stueck },
    { achse: 1, koord: y1, a0: x0, a1: x1, b0: z0, b1: z1, richtung: 1, stueck },
    { achse: 2, koord: z0, a0: x0, a1: x1, b0: y0, b1: y1, richtung: -1, stueck },
    { achse: 2, koord: z1, a0: x0, a1: x1, b0: y0, b1: y1, richtung: 1, stueck },
  ];
}

{
  let sichtflaechenStreit = 0;
  let restStreit = 0;
  let groessteFlaeche = 0;
  let ersterStreit = '';
  let ersterRest = '';
  let groesserRest = '';

  for (let i = 0; i < KOPLANAR_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const ergebnis = baue(layout, gitter);
    // Der Index deckt hier ALLE Arten ab (auch den Sims): fuer die Frage
    // "verdeckt etwas diese Flaeche" zaehlt jeder Quader, nicht nur die festen.
    // The index covers ALL kinds here (the ledge too): for "does something cover
    // this face" every box counts, not only the solid ones.
    const index = baueIndex(ergebnis.stuecke, true);

    const eimer = new Map<string, Flaeche[]>();
    ergebnis.stuecke.forEach((s, n) => {
      for (const f of flaechenVon(s, n)) {
        const schluessel = `${f.achse}|${f.koord}|${f.richtung}`;
        const liste = eimer.get(schluessel);
        if (liste === undefined) eimer.set(schluessel, [f]);
        else liste.push(f);
      }
    });

    for (const liste of eimer.values()) {
      for (let p = 0; p < liste.length; p++) {
        for (let q = p + 1; q < liste.length; q++) {
          const f = liste[p]!;
          const g = liste[q]!;
          if (f.stueck === g.stueck) continue;
          const a0 = Math.max(f.a0, g.a0);
          const a1 = Math.min(f.a1, g.a1);
          const b0 = Math.max(f.b0, g.b0);
          const b1 = Math.min(f.b1, g.b1);
          if (a1 - a0 <= 1e-9 || b1 - b0 <= 1e-9) continue;

          const am = (a0 + a1) / 2;
          const bm = (b0 + b1) / 2;
          const c = f.koord + f.richtung * KOPLANAR_EPS;
          const px = f.achse === 0 ? c : am;
          const py = f.achse === 1 ? c : f.achse === 0 ? am : bm;
          const pz = f.achse === 2 ? c : bm;
          const s1 = ergebnis.stuecke[f.stueck]!;
          const s2 = ergebnis.stuecke[g.stueck]!;
          if (imFesten(index, px, py, pz, s1, s2)) continue;
          if (!imLichten(gitter, px, py, pz)) continue;

          // ZWEI Klassen, und die Trennung ist der gemeldete Fehler selbst:
          //
          //   STRENG (null erlaubt): eine WAAGERECHTE Flaeche, an der ein Boden,
          //     eine Decke, eine Trittflaeche oder ein Sims beteiligt ist, und
          //     die weiter reicht als ein WANDECK (eine halbe Wanddicke, 0,5 m,
          //     in beide Richtungen). Das ist genau das gemeldete Bild: ein
          //     halben Meter breiter, aber vier Meter langer Mauerwerksstreifen
          //     im Boden. Es ist die Klasse, die man beim Gehen ansieht.
          //   REST (nur beschraenkt): senkrechte Stirnflaechen und Eckstuecke —
          //     dort, wo ein Wandzug, eine Laibung und eine Platte an derselben
          //     Zellgrenze auslaufen. Sie sind hoechstens ein Wandeck breit,
          //     stehen am Rand des Blickfelds, und jeder Versuch, sie
          //     wegzuschneiden, hat entweder ein Leck oder eine halbmeter-tiefe
          //     Nische erzeugt (siehe `cells.ts`, `zellKanteZuQuaderGanz`, und
          //     den decisions-log-Eintrag). Die Schranke haelt fest, dass ihre
          //     Zahl nicht wieder waechst.
          // TWO classes, and the split is the reported fault itself: STRICT (zero
          // allowed) — a HORIZONTAL face involving a floor, ceiling, tread or
          // ledge that reaches further than a WALL CORNER (half a wall thickness,
          // 0.5 m, in both directions); exactly the reported picture, and the
          // class one looks at while walking. RESIDUE (bounded only) — vertical
          // end faces and corner blocks where a wall run, a reveal and a slab all
          // run out at the same cell border; every attempt to cut them away
          // produced either a leak or a half-metre niche.
          const eck = (WAND_DICKE_ACHTEL * ACHTEL_M) / 2;
          const flaeche = (a1 - a0) * (b1 - b0);
          const waagerecht = f.achse === 1;
          const sichtbar = SICHTFLAECHEN.has(s1.art) || SICHTFLAECHEN.has(s2.art);
          const grosz = a1 - a0 > eck + 1e-9 || b1 - b0 > eck + 1e-9;
          const text = `Seed ${i}: ${s1.art}/${s2.art}, Ebene Achse ${f.achse} = ${f.koord}, Ueberlappung ${(a1 - a0).toFixed(2)} m x ${(b1 - b0).toFixed(2)} m`;
          if (waagerecht && sichtbar && grosz) {
            sichtflaechenStreit++;
            if (ersterStreit === '') ersterStreit = text;
          } else {
            restStreit++;
            if (flaeche > groessteFlaeche) {
              groessteFlaeche = flaeche;
              // Der GROESSTE Rest, nicht nur der erste: die Schranke faellt an
              // der Flaeche, und wer dann den ersten Fall liest, sucht am
              // falschen Ort.
              // The LARGEST residue, not merely the first: the bound trips on
              // the area, and reading the first case then searches the wrong spot.
              groesserRest = text;
            }
            if (ersterRest === '') ersterRest = text;
          }
        }
      }
    }
  }

  pruefe(
    `(F) keine flackernde waagerechte Sichtflaeche groesser als ein Wandeck (${KOPLANAR_SEEDS} Seeds)`,
    sichtflaechenStreit === 0,
    ersterStreit
  );
  // Regressionsbremse fuer den dokumentierten Rest: senkrechte Stirnflaechen
  // zweier Stuecke, die BEIDE an derselben Zellgrenze enden — ein Wandzug, der
  // an einer Oeffnung ausläuft, und die Deckenplatte derselben Zelle. Sie sind
  // hoechstens ein Wandeck gross. Der Fix dafuer verlangte, dass ein Wandquader
  // in zwei Quader zerfaellt (siehe decisions-log); die Schranke haelt fest,
  // dass die Zahl nicht wieder waechst.
  // Regression brake for the documented residue: vertical end faces of two
  // pieces that BOTH terminate at the same cell border. See decisions-log.
  pruefe(
    `(F) der dokumentierte Rest bleibt klein (${restStreit} Faelle, groesste ${groessteFlaeche.toFixed(2)} m²)`,
    // Schranke am 2026-08-30 von 60 auf 80 gehoben: Das Treppenhaus belegt
    // seither sechs Zellen statt drei (drei Laeufe, darueber drei Schachtzellen),
    // und jede Zellgrenze mehr bringt ein paar Eckstuecke mit. Die GROESSE des
    // Restes ist dabei GESUNKEN — von 1,00 m² auf 0,50 m² —, und das ist die
    // Zahl, die das Bild betrifft.
    // Bound raised from 60 to 80 on 2026-08-30: the stairwell now occupies six
    // cells instead of three, and every extra cell border brings a few corner
    // pieces. The SIZE of the residue FELL, from 1.00 m² to 0.50 m².
    restStreit <= 80 && groessteFlaeche <= 1 + 1e-9,
    `erster: ${ersterRest} | groesster: ${groesserRest}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (G) Wandflucht — nichts steht vor der Wand
// (G) wall line — nothing stands in front of the wall
// ─────────────────────────────────────────────────────────────────────────────
//
// WAECHTER zum zweiten Befund aus der Vorschau: einzelne langgestreckte Quader
// standen sichtbar VOR einer sonst planen Wand. Es waren die Fuellstuecke ueber
// Oeffnungen: sie belegten den GANZEN Kantenstreifen, und der liegt mittig auf
// der Zellgrenze — also ragte ein halber Meter davon in den lichten Raum der
// Nachbarzelle.
//
// Gemessen wird der lichte Raum jeder begehbaren Zelle: waagerecht bis an die
// Wandflucht (ein Achtel, die halbe Wanddicke, an jeder Kante mit Wand oder
// Tuer), senkrecht von der Bodenoberkante bis zur Deckenunterkante. Kein Stueck
// darf mit echtem Volumen darin liegen. Zwei Ausnahmen mit eigener Regel:
//   * `stufe` in einer Treppenzelle — die Trittflaechen SIND dort der Boden;
//   * `sims` — die Auskragung ist gewollt. Sie wird darum nicht uebergangen,
//     sondern SCHAERFER geprueft: genau SIMS_TIEFE_ACHTEL tief und nur an einer
//     Kante, an der auch eine Wand steht.
// GUARD for the second finding: single elongated boxes stood visibly IN FRONT
// of an otherwise flat wall — the fillers above openings, which occupied the
// WHOLE edge strip although that strip straddles the cell border. Measured is
// every walkable cell's clear space; no piece may sit inside it with real
// volume. Two exceptions with rules of their own: stair treads (they ARE the
// floor there) and ledges (the overhang is intended — and therefore checked
// more strictly, not skipped).

const FLUCHT_SEEDS = 12;

{
  let vorDerFlucht = 0;
  let ersterVorstand = '';
  let simse = 0;
  let simsFalsch = 0;
  let ersterSims = '';

  for (let i = 0; i < FLUCHT_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const ergebnis = baue(layout, gitter);
    const tuerKanten = new Set(
      layout.tueren.map((t) => {
        const k = kanonisiereKante(t.x, t.z, t.ebene, t.kante);
        return `${k.ebene}|${k.z}|${k.x}|${k.kante}`;
      })
    );

    for (const zelle of zellenSortiert(gitter)) {
      if (!offen(zelle.art)) continue;
      // Die Wandflucht liegt eine halbe Wanddicke in der Zelle — an jeder Kante,
      // an der eine Wand ODER ein Tuerrahmen steht (der Rahmen IST dort die
      // Wandflucht, er belegt denselben Streifen wie die Waende links und
      // rechts von ihm).
      // The wall line lies half a wall thickness inside the cell — at every edge
      // carrying a wall OR a door frame (the frame IS the wall line there).
      const flucht = (kante: Kante): number => {
        if (zellKanteZuQuader(gitter, zelle, kante) !== null) return WAND_DICKE_ACHTEL / 2;
        const k = kanonisiereKante(zelle.x, zelle.z, zelle.ebene, kante);
        return tuerKanten.has(`${k.ebene}|${k.z}|${k.x}|${k.kante}`) ? WAND_DICKE_ACHTEL / 2 : 0;
      };
      const xa = zelle.x * ZELL_ACHTEL;
      const za = zelle.z * ZELL_ACHTEL;
      const lx0 = (xa + flucht(KANTE.West)) * ACHTEL_M;
      const lx1 = (xa + ZELL_ACHTEL - flucht(KANTE.Ost)) * ACHTEL_M;
      const lz0 = (za + flucht(KANTE.Sued)) * ACHTEL_M;
      const lz1 = (za + ZELL_ACHTEL - flucht(KANTE.Nord)) * ACHTEL_M;
      const ly0 = bodenStufen(zelle) * HOEHEN_SCHRITT_M;
      // Die WIRKLICHE Deckenunterkante: `obenStufen()` ist die geplante, aber
      // die Regel `ebenen-abstand` vergleicht nur `boden + decke` mit der Sohle
      // darueber und laesst die DICKE der Bodenplatte des Stockwerks darueber
      // aus. Wo der Abstand knapp ist, haengt diese Platte darum bis zu einen
      // halben Meter in den Raum — gemessen, nicht vermutet (siehe
      // decisions-log). Das ist kein Vorstand vor die Wandflucht, sondern eine
      // zu grosszuegige Layoutregel; der Wandflucht-Waechter misst deshalb gegen
      // die wirkliche Unterkante.
      // The REAL ceiling underside: `obenStufen()` is the planned one, but the
      // `ebenen-abstand` rule leaves the THICKNESS of the storey above's floor
      // slab out of the comparison. Where the gap is tight, that slab hangs up
      // to half a metre into the room — measured, not assumed. That is not a
      // piece in front of the wall line but a too generous layout rule, so the
      // wall-line guard measures against the real underside.
      const drueber = zelleImGitter(gitter, zelle.x, zelle.z, zelle.ebene + 1);
      const sohleDrueber =
        drueber !== undefined && offen(drueber.art) && drueber.art !== ZELLEN_ART.Schacht
          ? (bodenStufen(drueber) - 2) * HOEHEN_SCHRITT_M
          : Number.POSITIVE_INFINITY;
      const ly1 = Math.min(obenStufen(gitter, zelle) * HOEHEN_SCHRITT_M, sohleDrueber);

      for (const s of ergebnis.stuecke) {
        const ux = Math.min(s.mitte.x + s.groesse.x / 2, lx1) - Math.max(s.mitte.x - s.groesse.x / 2, lx0);
        const uy = Math.min(s.mitte.y + s.groesse.y / 2, ly1) - Math.max(s.mitte.y - s.groesse.y / 2, ly0);
        const uz = Math.min(s.mitte.z + s.groesse.z / 2, lz1) - Math.max(s.mitte.z - s.groesse.z / 2, lz0);
        if (ux <= 1e-9 || uy <= 1e-9 || uz <= 1e-9) continue;
        if (s.art === 'stufe' && zelle.art === ZELLEN_ART.Treppe) continue;
        if (s.art === 'sims') {
          simse++;
          // Ein Sims kragt genau um SIMS_TIEFE_ACHTEL aus, und nur an einer
          // Kante mit Wand. Weiter waere er ein Vorsprung, ohne Wand ein
          // Schwebebrett.
          // A ledge overhangs by exactly SIMS_TIEFE_ACHTEL, and only at an edge
          // with a wall. Further would be a ledge sticking out, without a wall a
          // floating board.
          const tiefe = Math.min(ux, uz);
          const ander = tiefe === ux ? uz : ux;
          const anWand = KANTEN.some(
            (k) => zellKanteZuQuader(gitter, zelle, k) !== null && flucht(k) > 0
          );
          if (Math.abs(tiefe - ACHTEL_M) > 1e-9 || ander <= 0 || !anWand) {
            simsFalsch++;
            if (ersterSims === '') {
              ersterSims = `Seed ${i}: Zelle (${zelle.x},${zelle.z},E${zelle.ebene}) Sims kragt ${tiefe.toFixed(2)} m aus`;
            }
          }
          continue;
        }
        vorDerFlucht++;
        if (ersterVorstand === '') {
          ersterVorstand = `Seed ${i}: Zelle (${zelle.x},${zelle.z},E${zelle.ebene}) — ${s.art} ragt ${Math.min(ux, uz).toFixed(2)} m x ${uy.toFixed(2)} m in den lichten Raum`;
        }
      }
    }
  }

  pruefe(
    `(G) kein Bauteil ragt vor die Wandflucht in den lichten Raum (${FLUCHT_SEEDS} Seeds)`,
    vorDerFlucht === 0,
    ersterVorstand
  );
  pruefe(
    `(G) jeder Sims kragt genau ${ACHTEL_M} m aus, an einer Wand (${simse} Simse)`,
    simsFalsch === 0 && simse > 500,
    ersterSims !== '' ? ersterSims : `${simse} Simse`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (H) Kein Nullkoerper — jede Platte hat ihre volle Dicke
// (H) no degenerate body — every slab has its full thickness
// ─────────────────────────────────────────────────────────────────────────────
//
// WAECHTER zum Fund vom 2026-08-30 (`ebenen-abstand` verglich die falschen
// Flaechen, siehe `validation.ts`). Das Symptom war KEIN Loch: `deckenOberkante()`
// stutzt die Deckenplatte stillschweigend auf die Sohle des Stockwerks
// darueber, und wo die Regel eine Ueberdeckung durchliess, blieb davon eine
// Platte der Dicke NULL uebrig — ein Quader ohne Volumen, der als Sichtgeometrie
// UND als Havok-Box in den Bau ging.
//
// GEGENPROBE (gemessen am Stand vor dem Fix, dieselben 60 Seeds): 52 Deckenplatten
// der Dicke 0 und 34 der halben Dicke; danach 0 und 0. Der Waechter ist also
// nachweislich rot gewesen.
// GUARD for the finding of 2026-08-30. The symptom was NOT a hole:
// `deckenOberkante()` silently trims the ceiling slab to the sole of the storey
// above, and where the rule let an overlap pass, a slab of thickness ZERO
// remained — a box without volume that went into the build as visual geometry
// AND as a Havok box. COUNTER-CHECK (measured on the pre-fix state, same 60
// seeds): 52 ceiling slabs of thickness 0 and 34 of half thickness; afterwards 0
// and 0.
const NULLKOERPER_SEEDS = 60;
{
  let duenneDecken = 0;
  let nullkoerper = 0;
  let deckenZahl = 0;
  let erstesDuenn = '';
  let erstesNull = '';
  const MASZ = DECKE_DICKE_STUFEN * HOEHEN_SCHRITT_M;

  for (let i = 0; i < NULLKOERPER_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const ergebnis = baue(layout, gitter);
    for (const s of ergebnis.stuecke) {
      if (s.groesse.x <= 1e-9 || s.groesse.y <= 1e-9 || s.groesse.z <= 1e-9) {
        nullkoerper++;
        if (erstesNull === '') {
          erstesNull = `Seed ${i}: ${s.art} ${s.groesse.x}x${s.groesse.y}x${s.groesse.z} bei (${s.mitte.x},${s.mitte.y},${s.mitte.z})`;
        }
      }
      if (s.art !== 'decke') continue;
      deckenZahl++;
      if (Math.abs(s.groesse.y - MASZ) > 1e-9) {
        duenneDecken++;
        if (erstesDuenn === '') {
          erstesDuenn = `Seed ${i}: Deckenplatte ${s.groesse.y} m statt ${MASZ} m bei (${s.mitte.x},${s.mitte.y},${s.mitte.z})`;
        }
      }
    }
    for (const k of ergebnis.kollision) {
      if (k.groesse.x <= 1e-9 || k.groesse.y <= 1e-9 || k.groesse.z <= 1e-9) {
        nullkoerper++;
        if (erstesNull === '') {
          erstesNull = `Seed ${i}: Kollisionskoerper ${k.groesse.x}x${k.groesse.y}x${k.groesse.z}`;
        }
      }
    }
  }

  pruefe(
    `(H) kein Bauteil und kein Kollisionskoerper ohne Volumen (${NULLKOERPER_SEEDS} Seeds)`,
    nullkoerper === 0,
    erstesNull
  );
  pruefe(
    `(H) jede Deckenplatte ist ${MASZ} m dick (${deckenZahl} Platten, ${NULLKOERPER_SEEDS} Seeds)`,
    duenneDecken === 0 && deckenZahl > 10000,
    erstesDuenn !== '' ? erstesDuenn : `${deckenZahl} Platten`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lichtschacht-Muendungen (M2 / AP18) / light shaft mouths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Godrays haengen an `lichtschaechte()`. Die Funktion darf drei Fehler nicht
 * machen, und alle drei waeren im Bild NICHT als Fehler zu erkennen — man saehe
 * nur „zu viele Strahlen" oder „ein Strahl im Fels" und suchte im Effekt:
 *
 *  (a) Ein Schachtstapel ist EINE Muendung. Drei uebereinanderliegende
 *      Schachtzellen ergaeben sonst drei Godray-Quellen im selben Loch — und
 *      auf Stufe Hoch dreimal dieselbe Verdeckungspassage.
 *  (b) Eine Muendung steht ueber einer BEGEHBAREN Zelle. Ein Schacht ueber
 *      Fels ist ein Loch im Fels; ein Strahl dort leuchtete in einen Raum, den
 *      es nicht gibt. Es ist dieselbe Unterscheidung, die `hatBodenPlatte()`
 *      fuer die Geometrie trifft — der Test haelt beide gegeneinander.
 *  (c) Die Hoehe ist die OBERKANTE der lichten Saeule (`obenStufen`), nicht der
 *      Boden. Eine Quelle am Boden des Schachtes saehe aus wie eine Fackel.
 * Godrays hang off `lichtschaechte()`, and none of its three possible mistakes
 * would read as a mistake in the picture.
 */
{
  let stapelEinfach = true;
  let ueberBegehbar = true;
  let hoeheStimmt = true;
  let muendungen = 0;
  let mitSchacht = 0;
  let erstesProblem = '';
  for (let i = 0; i < 12; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const gefunden = lichtschaechte(gitter, layout);
    muendungen += gefunden.length;
    if (gefunden.some((l) => l.art === 'schacht')) mitSchacht += 1;

    // (a) Kein Stapel doppelt: die Zahl der Muendungen darf nie groesser sein
    //     als die Zahl der Schacht-SAEULEN (x,z,ebene-unabhaengig gezaehlt ist
    //     zu grob — gezaehlt werden Schaechte OHNE Schacht darueber).
    const spitzen = zellenSortiert(gitter).filter((z) => {
      if (z.art !== ZELLEN_ART.Schacht) return false;
      const oben = zelleImGitter(gitter, z.x, z.z, z.ebene + 1);
      return oben === undefined || oben.art !== ZELLEN_ART.Schacht;
    }).length;
    const ausSchacht = gefunden.filter((l) => l.art === 'schacht').length;
    if (ausSchacht > spitzen) {
      stapelEinfach = false;
      if (erstesProblem === '') erstesProblem = `Seed ${i}: ${ausSchacht} > ${spitzen} Spitzen`;
    }

    for (const l of gefunden) {
      const zelle = zelleImGitter(gitter, l.x, l.z, l.ebene);
      if (zelle === undefined) {
        ueberBegehbar = false;
        if (erstesProblem === '') erstesProblem = `Seed ${i}: Muendung ohne Zelle`;
        continue;
      }
      if (l.art === 'schacht') {
        // (b) darunter muss etwas Begehbares liegen
        const unten = zelleImGitter(gitter, l.x, l.z, l.ebene - 1);
        if (unten === undefined || !offen(unten.art)) {
          ueberBegehbar = false;
          if (erstesProblem === '') erstesProblem = `Seed ${i}: Schacht ueber Fels`;
        }
        // (c) Hoehe = Oberkante der lichten Saeule
        if (Math.abs(l.mitte.y - obenStufen(gitter, zelle) * HOEHEN_SCHRITT_M) > 1e-9) {
          hoeheStimmt = false;
          if (erstesProblem === '') erstesProblem = `Seed ${i}: Hoehe ${l.mitte.y}`;
        }
      }
      // Waagerecht immer die Zellmitte — dieselbe Rechnung wie der Bauer.
      if (
        Math.abs(l.mitte.x - (l.x + 0.5) * ZELLE_M) > 1e-9 ||
        Math.abs(l.mitte.z - (l.z + 0.5) * ZELLE_M) > 1e-9
      ) {
        hoeheStimmt = false;
        if (erstesProblem === '') erstesProblem = `Seed ${i}: Mitte verrutscht`;
      }
    }
  }
  pruefe('lichtschaechte: ein Schachtstapel ergibt eine Muendung', stapelEinfach, erstesProblem);
  pruefe('lichtschaechte: jede Muendung steht ueber einer begehbaren Zelle', ueberBegehbar, erstesProblem);
  pruefe('lichtschaechte: Muendung sitzt auf der Oberkante der lichten Saeule', hoeheStimmt, erstesProblem);
  // Der Zeuge gegen eine Funktion, die immer die leere Liste liefert: Ein
  // Godray-Modul mit null Quellen schaltet sich selbst ab und saehe von aussen
  // aus wie „Godrays kosten nichts".
  // The witness against a function that always returns the empty list.
  pruefe(
    'lichtschaechte: findet ueberhaupt etwas (Eingang immer, Schacht meistens)',
    muendungen >= 12 && mitSchacht > 0,
    `${muendungen} Muendungen, ${mitSchacht} Graeber mit Schacht`
  );

  // Determinismus: zweimal dasselbe Layout, zweimal dieselbe Liste — inklusive
  // Reihenfolge. Die Godray-Wahl haengt an Indizes.
  // Determinism: the same layout twice yields the same list, order included.
  const l1 = erzeugeLayout(thema, seedsFuer(3));
  const a = JSON.stringify(lichtschaechte(zellenAufbauen(l1, materialOptionen), l1));
  const b = JSON.stringify(lichtschaechte(zellenAufbauen(l1, materialOptionen), l1));
  pruefe('lichtschaechte ist deterministisch (Liste und Reihenfolge)', a === b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-builder: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
