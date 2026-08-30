/**
 * Prueft den Client-Bauer (AP6) OHNE GPU und OHNE Havok.
 * Checks the client builder (AP6) WITHOUT a GPU and WITHOUT Havok.
 *
 * Die drei Pruefkriterien aus `ARCHITECTURE.md` AP6, in dieser Reihenfolge:
 *  (a) Zeichenaufruf- und Meshzahl je Block gegen die erwartete Formel
 *      (Bloecke x belegte materialTags) — hier gegen die AUS DEM BAUER
 *      GEZAEHLTE Formel, nicht gegen eine abgeschriebene Zahl.
 *  (b) Ein Charakter, ueber das Layout geschoben, faellt nirgends durch den
 *      Boden und bleibt an keiner Kante haengen — ueber die STRECKE gemessen,
 *      nicht ueber die Zeit (Vault: „bei fester Zeit misst sich schnellerer
 *      Code teurer").
 *  (c) Auf- und Abbau x20: Mesh-, Material- und Texturzahl der Szene kehren
 *      exakt auf den Ausgangswert zurueck.
 * The three acceptance criteria from `ARCHITECTURE.md` AP6, in that order.
 *
 * Havok laeuft hier NICHT — die Emscripten-Fassung startet unter Node nicht
 * verlaesslich. Gemessen wird stattdessen das, worauf der Spieler tatsaechlich
 * steht: die Kollisionsformen (`KollisionsForm`), also genau die Zahlen, die
 * `DungeonBauer` an `PhysicsShapeBox` weiterreicht. Dass Babylons Quaternion
 * die Rampe in dieselbe Richtung kippt wie unsere Rechnung, wird zusaetzlich
 * mit Babylons eigener Matrix nachgerechnet.
 * Havok does NOT run here. What is measured instead is what the player actually
 * stands on: the collision shapes, i.e. exactly the numbers `DungeonBauer`
 * hands to `PhysicsShapeBox`. That Babylon's quaternion tilts the ramp the same
 * way as our maths is additionally recomputed with Babylon's own matrix.
 */
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/pbr.vertex';
import {
  DungeonBauer,
  VERTICES_JE_QUADER,
  formOberkante,
  kollisionsForm,
  type KollisionsForm,
} from '../src/engine/DungeonBuilder';
import {
  DUNGEON_SCHICHT_ATTRIBUT,
  DungeonGrafikStufe,
  setzeDungeonStufe,
} from '../src/engine/DungeonMaterial';
import { DUNGEON_SSAO_MAX_Z, DUNGEON_SSAO_RADIUS } from '../src/engine/DungeonAtmosphere';
// Ueber das Barrel, NICHT ueber `../../shared/src/...`: ein relativer Pfad aus
// `client/test/` hinaus liegt ausserhalb des `rootDir` der Client-Typpruefung,
// und `tsc` bricht dann mit TS6059 ab. Der Weg ueber `@wov/shared` ist derselbe,
// den auch der Client-Quelltext nimmt — der Test prueft damit die Kette, die
// spaeter wirklich laeuft.
// Through the barrel, NOT through a relative path out of `client/test/`: that
// lies outside the client type check's `rootDir` and `tsc` aborts with TS6059.
import { dungeon2 } from '@wov/shared';

const {
  erzeugeLayout,
  STEINGRAB,
  baueGeometrie,
  blockSchluessel,
  stueckZuNetz,
  zellenAufbauen,
  HOEHEN_SCHRITT_M,
  KANTE,
  KANTEN,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  ZELLE_M,
  ZELLEN_ART,
  layoutPruefsumme,
  nachbarZelle,
} = dungeon2;
type DungeonLayout2 = dungeon2.DungeonLayout2;
type KollisionsKoerper = dungeon2.KollisionsKoerper;

let rot = 0;
function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.error(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

/**
 * Fuer Pruefungen mit `await`.
 *
 * Eine eigene Funktion, weil `pruefe()` eine `async`-Funktion zwar ANNIMMT
 * (`() => Promise<void>` ist auf `() => void` zuweisbar), ihr `try`/`catch` den
 * Fehler aber nie sieht: die Zusicherung faellt im Mikrotask, lange nachdem
 * `pruefe()` „ok" gemeldet hat. Eine solche Pruefung ist gruen, egal was sie
 * behauptet.
 * A separate function, because `pruefe()` would ACCEPT an async function but its
 * `try`/`catch` would never see the failure: the assertion fails in a microtask
 * long after `pruefe()` reported "ok". Such a check is green no matter what.
 */
async function pruefeAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.error(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

/**
 * Der Abstand, mit dem gemessen wird. Nicht kleiner: 25 cm sind ein Sechzehntel
 * einer Zelle und die Haelfte des Figurenradius — feiner traefe dieselbe Wand
 * nur mehrfach. Nicht groesser: eine Luecke von einer Zellbreite wuerde
 * uebersprungen.
 * The sampling step. Not finer: 25 cm is a sixteenth of a cell and half the
 * body radius. Not coarser: a gap one cell wide would be stepped over.
 */
const SCHRITT_M = 0.25;
/** Figurenmasse aus `dungeonRaster.ts`. / Body measures from `dungeonRaster.ts`. */
const KOERPER_RADIUS = 0.4;
const KOERPER_HOEHE = 1.8;
/** Fusshoehe, ab der ein Hindernis zaehlt. / Foot height an obstacle counts from. */
const STOLPER_HOEHE = 0.35;

const engine = new NullEngine();
const szene = new Scene(engine);

// ─────────────────────────────────────────────────────────────────────────────
// 0. Werkzeug / tools
// ─────────────────────────────────────────────────────────────────────────────

function baueLayout(seed: number): DungeonLayout2 {
  return erzeugeLayout(STEINGRAB, { architektur: seed, material: 4711, deko: 815 });
}

/** Alle Dreiecke eines Meshes als sortierbare Zeichenketten. / Triangles as keys. */
function dreieckeAusMesh(mesh: Mesh): string[] {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const idx = mesh.getIndices()!;
  const schluessel: string[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const ecken: string[] = [];
    for (let e = 0; e < 3; e++) {
      const v = idx[i + e]! * 3;
      ecken.push(`${pos[v]!.toFixed(4)},${pos[v + 1]!.toFixed(4)},${pos[v + 2]!.toFixed(4)}`);
    }
    // Ecken NICHT sortieren: die Umlaufrichtung entscheidet, welche Seite man
    // sieht. Ein Dreieck mit vertauschten Ecken waere ein anderes Dreieck.
    // Do NOT sort the corners: the winding decides which side is visible.
    schluessel.push(ecken.join('|'));
  }
  return schluessel;
}

/**
 * Ortsregister der Kollisionsformen.
 *
 * Ohne dieses Register laeuft der Begehbarkeitstest gegen ALLE Formen — bei
 * 800 bis 1000 Koerpern je Grab, 32 Koerperpunkten je Probe und rund 8.000
 * Proben je Seed sind das Milliarden Vergleiche, und der Test lief in den
 * Zeitgeber statt in eine Antwort. Ein 4-Meter-Raster (die Zellgroesse) laesst
 * je Abfrage eine Handvoll Formen uebrig.
 * Spatial register of the collision shapes. Without it the walkability test
 * runs against ALL shapes — billions of comparisons — and hits the timeout
 * instead of an answer.
 */
type FormIndex = Map<string, KollisionsForm[]>;
const RASTER_M = 4;

/** Grobe Huelle einer (evtl. gekippten) Form. / Coarse hull of a shape. */
function huelle(form: KollisionsForm): { hx: number; hz: number } {
  if (form.achse === null) return { hx: form.halbe.x, hz: form.halbe.z };
  const cos = Math.abs(Math.cos(form.winkel));
  const sin = Math.abs(Math.sin(form.winkel));
  return form.achse === 'x'
    ? { hx: form.halbe.x, hz: form.halbe.z * cos + form.halbe.y * sin }
    : { hx: form.halbe.x * cos + form.halbe.y * sin, hz: form.halbe.z };
}

function baueIndex(formen: readonly KollisionsForm[]): FormIndex {
  const index: FormIndex = new Map();
  for (const form of formen) {
    const h = huelle(form);
    const x0 = Math.floor((form.mitte.x - h.hx - KOERPER_RADIUS) / RASTER_M);
    const x1 = Math.floor((form.mitte.x + h.hx + KOERPER_RADIUS) / RASTER_M);
    const z0 = Math.floor((form.mitte.z - h.hz - KOERPER_RADIUS) / RASTER_M);
    const z1 = Math.floor((form.mitte.z + h.hz + KOERPER_RADIUS) / RASTER_M);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const schluessel = `${x}|${z}`;
        let liste = index.get(schluessel);
        if (liste === undefined) {
          liste = [];
          index.set(schluessel, liste);
        }
        liste.push(form);
      }
    }
  }
  return index;
}

function nahe(index: FormIndex, x: number, z: number): readonly KollisionsForm[] {
  return index.get(`${Math.floor(x / RASTER_M)}|${Math.floor(z / RASTER_M)}`) ?? [];
}

/** Traegt (x,z) etwas, und wie hoch? / Is (x,z) supported, and how high? */
function oberkante(index: FormIndex, x: number, z: number, untenBis: number): number | null {
  let beste: number | null = null;
  for (const form of nahe(index, x, z)) {
    const y = formOberkante(form, x, z);
    if (y === null) continue;
    if (y > untenBis) continue;
    if (beste === null || y > beste) beste = y;
  }
  return beste;
}

/** Steckt der Punkt in einer achsparallelen Form? / Point inside an axis box? */
function imKoerper(form: KollisionsForm, x: number, y: number, z: number): boolean {
  if (form.achse !== null) return false;
  return (
    Math.abs(x - form.mitte.x) < form.halbe.x &&
    Math.abs(y - form.mitte.y) < form.halbe.y &&
    Math.abs(z - form.mitte.z) < form.halbe.z
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Kriterium (a): Meshzahl, Vertexzahl, Vollstaendigkeit
//    Criterion (a): mesh count, vertex count, completeness
// ─────────────────────────────────────────────────────────────────────────────

const SEEDS = [1234, 99, 7];

for (const seed of SEEDS) {
  const layout = baueLayout(seed);
  const gitter = zellenAufbauen(layout);
  const voll = baueGeometrie(layout, { gitter });

  const paare = new Set<string>();
  for (const s of voll.stuecke) paare.add(`${blockSchluessel(s.block)}#${s.materialTag}`);

  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
  const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  bauer.baueAlles();
  const stat = bauer.statistik();

  pruefe(`Seed ${seed}: Meshzahl = Bloecke x belegte materialTags (${paare.size})`, () => {
    assert.equal(stat.meshes, paare.size);
    assert.ok(stat.bloeckeGebaut > 0, 'kein Block gebaut');
    assert.equal(stat.bloeckeGebaut, stat.bloeckeGesamt);
  });

  pruefe(`Seed ${seed}: Vertex- und Dreieckszahl = Bauteile x 24 bzw. x 12`, () => {
    assert.equal(stat.vertices, voll.stuecke.length * VERTICES_JE_QUADER);
    assert.equal(stat.dreiecke, voll.stuecke.length * 12);
  });

  pruefe(`Seed ${seed}: kein Dreieck verloren, keines doppelt (Blockvereinigung = Vollbau)`, () => {
    const ausMeshes: string[] = [];
    for (const knoten of bauer.wurzel.getChildren()) {
      const mesh = knoten as Mesh;
      if (typeof mesh.getIndices !== 'function' || mesh.getIndices() === null) continue;
      ausMeshes.push(...dreieckeAusMesh(mesh));
    }
    const ausBauer: string[] = [];
    for (const stueck of voll.stuecke) {
      const netz = stueckZuNetz(stueck);
      for (let i = 0; i < netz.indizes.length; i += 3) {
        const ecken: string[] = [];
        for (let e = 0; e < 3; e++) {
          const v = netz.indizes[i + e]! * 3;
          ecken.push(
            `${netz.positionen[v]!.toFixed(4)},${netz.positionen[v + 1]!.toFixed(4)},${netz.positionen[v + 2]!.toFixed(4)}`
          );
        }
        ausBauer.push(ecken.join('|'));
      }
    }
    ausMeshes.sort();
    ausBauer.sort();
    assert.equal(ausMeshes.length, ausBauer.length, 'Dreieckszahl');
    for (let i = 0; i < ausBauer.length; i++) {
      if (ausMeshes[i] !== ausBauer[i]) {
        assert.fail(`erstes abweichendes Dreieck bei ${i}: ${ausMeshes[i]} != ${ausBauer[i]}`);
      }
    }
  });

  pruefe(`Seed ${seed}: jedes Mesh traegt uv2 UND die Schichtnummer`, () => {
    // Die zulaessigen Blend-Paare kommen AUS DEM BAUER, nicht aus einer
    // Vermutung ueber ihren Wertebereich. Der erste Anlauf verlangte
    // `hoeheUeberBoden >= 0` und faerbte rot, obwohl alles stimmte: die
    // Unterkante einer Bodenplatte liegt einen Meter UNTER der Bodenoberkante,
    // der Wert ist dort also -1. Eine Bereichsannahme prueft die Annahme, ein
    // Mengenvergleich prueft die Daten.
    // The permitted blend pairs come FROM THE BUILDER, not from a guess about
    // their range: a floor slab's underside sits one metre BELOW the floor top,
    // so the value is -1 there.
    const erlaubt = new Set<string>();
    for (const stueck of voll.stuecke) {
      for (let i = 0; i < stueck.blend.hoeheUeberBoden.length; i++) {
        erlaubt.add(
          `${stueck.blend.hoeheUeberBoden[i]!.toFixed(4)}|${stueck.blend.kantenAbstand[i]!.toFixed(4)}`
        );
      }
    }
    let geprueft = 0;
    for (const knoten of bauer.wurzel.getChildren()) {
      const mesh = knoten as Mesh;
      if (typeof mesh.getVerticesData !== 'function') continue;
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (pos === null) continue;
      geprueft++;
      const uv2 = mesh.getVerticesData(VertexBuffer.UV2Kind);
      const schicht = mesh.getVerticesData(DUNGEON_SCHICHT_ATTRIBUT);
      assert.ok(uv2 !== null, `${mesh.name}: kein uv2`);
      assert.ok(schicht !== null, `${mesh.name}: kein ${DUNGEON_SCHICHT_ATTRIBUT}`);
      assert.equal(uv2!.length, (pos.length / 3) * 2, `${mesh.name}: uv2-Laenge`);
      assert.equal(schicht!.length, pos.length / 3, `${mesh.name}: Schichtlaenge`);
      // Der Tag steht im Meshnamen — und muss in JEDEM Vertex derselbe sein.
      // Waere er es nicht, saehe eine Wand teilweise wie ein Boden aus.
      // The tag is in the mesh name and must be the same in EVERY vertex.
      const erwartet = Number(mesh.name.slice(mesh.name.lastIndexOf('_t') + 2));
      for (const wert of schicht!) assert.equal(wert, erwartet, `${mesh.name}: Schicht`);
      // Jedes Blend-Paar im Mesh muss ein Paar sein, das der Bauer ausgerechnet
      // hat. Das faengt die zwei Fehler, die kein Symptom haetten: vertauschte
      // Komponenten (Feuchte treibt dann Moos) und ein leeres `uv2` (Blending
      // ist dann still aus).
      // Every blend pair in the mesh must be one the builder computed. This
      // catches the two failures without a symptom: swapped components and an
      // empty `uv2`.
      for (let i = 0; i < uv2!.length; i += 2) {
        const paar = `${uv2![i]!.toFixed(4)}|${uv2![i + 1]!.toFixed(4)}`;
        assert.ok(erlaubt.has(paar), `${mesh.name}: fremdes Blend-Paar ${paar}`);
      }
      assert.ok(mesh.isWorldMatrixFrozen, `${mesh.name}: Weltmatrix nicht eingefroren`);
    }
    assert.ok(geprueft > 0, 'kein Mesh gefunden');
    assert.equal(geprueft, stat.meshes);
  });

  bauer.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Grafikstufe: Geometrie faellt weg, Kollision NICHT (Vertragsregel 5)
//    Graphics tier: geometry is dropped, collision is NOT (contract rule 5)
// ─────────────────────────────────────────────────────────────────────────────

pruefe('Stufe Niedrig laesst Simse und Kanten weg — und NUR die', () => {
  const layout = baueLayout(1234);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const zier = voll.stuecke.filter((s) => s.art === 'sims' || s.art === 'kante').length;
  assert.ok(zier > 0, 'dieser Seed hat gar keine Zier — der Test misst nichts');

  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
  const mittel = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  mittel.baueAlles();
  const statMittel = mittel.statistik();

  setzeDungeonStufe(DungeonGrafikStufe.Niedrig);
  const niedrig = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  niedrig.baueAlles();
  const statNiedrig = niedrig.statistik();

  assert.equal(
    statNiedrig.vertices,
    statMittel.vertices - zier * VERTICES_JE_QUADER,
    `Niedrig ${statNiedrig.vertices} statt ${statMittel.vertices - zier * VERTICES_JE_QUADER}`
  );
  mittel.dispose();
  niedrig.dispose();
  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
});

pruefe('die Grafikstufe aendert die Kollision um KEINEN Wert (Vertragsregel 5)', () => {
  const layout = baueLayout(99);
  const schluessel = (formen: readonly KollisionsForm[]): string =>
    formen
      .map(
        (f) =>
          `${f.mitte.x},${f.mitte.y},${f.mitte.z}|${f.halbe.x},${f.halbe.y},${f.halbe.z}|${f.achse}|${f.winkel}`
      )
      .sort()
      .join(';');

  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
  const mittel = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  mittel.baueAlles();
  const a = schluessel(mittel.formen());
  mittel.dispose();

  setzeDungeonStufe(DungeonGrafikStufe.Niedrig);
  const niedrig = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  niedrig.baueAlles();
  const b = schluessel(niedrig.formen());
  niedrig.dispose();
  setzeDungeonStufe(DungeonGrafikStufe.Mittel);

  assert.ok(a.length > 0, 'keine Kollisionsformen');
  assert.equal(a, b, 'Kollision haengt an der Grafikstufe — Vertragsregel 5 verletzt');
});

pruefe('setzeStufe() baut die Geometrie neu, statt nur den Shader umzuschalten', () => {
  const layout = baueLayout(7);
  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
  const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  bauer.baueAlles();
  const vorher = bauer.statistik().vertices;
  bauer.setzeStufe(DungeonGrafikStufe.Niedrig);
  const nachher = bauer.statistik().vertices;
  assert.ok(nachher < vorher, `Vertexzahl blieb bei ${vorher} — nur der Shader wurde geschaltet`);
  // Und zurueck: derselbe Stand, nicht irgendeiner.
  bauer.setzeStufe(DungeonGrafikStufe.Mittel);
  assert.equal(bauer.statistik().vertices, vorher);
  // Mittel -> Hoch aendert die Geometrie NICHT (nur den Shader).
  bauer.setzeStufe(DungeonGrafikStufe.Hoch);
  assert.equal(bauer.statistik().vertices, vorher);
  bauer.dispose();
  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Kriterium (b): Begehbarkeit, ueber die STRECKE gemessen
//    Criterion (b): walkability, measured over DISTANCE
// ─────────────────────────────────────────────────────────────────────────────

let streckeGesamt = 0;
let probenGesamt = 0;
let schaechteGesamt = 0;

for (const seed of SEEDS) {
  const layout = baueLayout(seed);
  const gitter = zellenAufbauen(layout);
  const voll = baueGeometrie(layout, { gitter });
  const index = baueIndex(voll.kollision.map(kollisionsForm));

  const navNach = new Map<string, (typeof voll.nav)[number]>();
  for (const n of voll.nav) navNach.set(`${n.ebene}|${n.z}|${n.x}`, n);

  pruefe(`Seed ${seed}: jede begehbare Zelle wird von einer Kollisionsflaeche getragen`, () => {
    let schaechte = 0;
    for (const n of voll.nav) {
      // Ein Schacht MIT begehbarer Zelle darunter hat absichtlich keine
      // Bodenplatte — er IST die senkrechte Oeffnung (`hatBodenPlatte`), und
      // `nachUnten` sagt genau das. Ihn hier einzufordern hiesse, ein Loch als
      // Fehler zu melden, das der Grundriss ausdruecklich will.
      // A shaft WITH a walkable cell below deliberately has no floor slab — it
      // IS the vertical opening, and `nachUnten` says so.
      if (n.nachUnten) {
        schaechte++;
        const drunter = oberkante(index, n.mitte.x, n.mitte.z, n.mitte.y - 1e-6);
        assert.ok(drunter !== null, `Schacht ${n.x}/${n.z}/${n.ebene} fuehrt ins Bodenlose`);
        continue;
      }
      const y = oberkante(index, n.mitte.x, n.mitte.z, n.mitte.y + 1e-6);
      assert.ok(y !== null, `Zelle ${n.x}/${n.z}/${n.ebene} traegt nichts — Sturz durch den Boden`);
      assert.ok(
        Math.abs(y! - n.mitte.y) < 1e-6,
        `Zelle ${n.x}/${n.z}/${n.ebene}: Boden bei ${y!} statt ${n.mitte.y}`
      );
    }
    schaechteGesamt += schaechte;
  });

  pruefe(`Seed ${seed}: Gang ueber alle offenen Kanten — kein Sturz, kein Haenger`, () => {
    let strecke = 0;
    let proben = 0;
    for (const n of voll.nav) {
      for (const kante of KANTEN) {
        if ((n.offeneKanten & kante) === 0) continue;
        const p = nachbarZelle(n.x, n.z, kante);
        const ziel = navNach.get(`${n.ebene}|${p.z}|${p.x}`);
        if (ziel === undefined) continue;
        // Nur einmal je Kantenpaar laufen — sonst misst sich jede Strecke
        // doppelt und der Streckenwert waere kein Streckenwert.
        // Walk every edge pair only once, else the distance is counted twice.
        if (ziel.x < n.x || (ziel.x === n.x && ziel.z < n.z)) continue;
        // Ein Schacht ist ein gewolltes Loch — dort SOLL man fallen. Ihn in die
        // Sturzpruefung zu nehmen hiesse, den Grundriss gegen sich selbst zu
        // pruefen.
        // A shaft is a wanted hole — you are SUPPOSED to fall there.
        if (n.nachUnten || ziel.nachUnten) continue;
        const laenge = Math.hypot(ziel.mitte.x - n.mitte.x, ziel.mitte.z - n.mitte.z);
        const schritte = Math.max(1, Math.round(laenge / SCHRITT_M));
        for (let i = 0; i <= schritte; i++) {
          const t = i / schritte;
          const x = n.mitte.x + (ziel.mitte.x - n.mitte.x) * t;
          const z = n.mitte.z + (ziel.mitte.z - n.mitte.z) * t;
          const erwartet = n.mitte.y + (ziel.mitte.y - n.mitte.y) * t;
          proben++;
          const boden = oberkante(index, x, z, erwartet + HOEHEN_SCHRITT_M);
          assert.ok(boden !== null, `Sturz bei ${x.toFixed(2)}/${z.toFixed(2)} (Ebene ${n.ebene})`);
          assert.ok(
            Math.abs(boden! - erwartet) <= HOEHEN_SCHRITT_M + 1e-6,
            `Bodenversatz ${(boden! - erwartet).toFixed(3)} m bei ${x.toFixed(2)}/${z.toFixed(2)}`
          );
          // Haengt der Koerper? Acht Punkte auf dem Figurenumfang, von
          // Stolperhoehe bis Kopfhoehe — nichts darf dort massiv sein.
          // Does the body snag? Eight points around the body's circumference,
          // from stumble height to head height — nothing may be solid there.
          for (let w = 0; w < 8; w++) {
            const winkel = (w * Math.PI) / 4;
            const px = x + Math.cos(winkel) * KOERPER_RADIUS;
            const pz = z + Math.sin(winkel) * KOERPER_RADIUS;
            for (let h = STOLPER_HOEHE; h <= KOERPER_HOEHE; h += 0.5) {
              for (const form of nahe(index, px, pz)) {
                assert.ok(
                  !imKoerper(form, px, boden! + h, pz),
                  `Haenger bei ${px.toFixed(2)}/${(boden! + h).toFixed(2)}/${pz.toFixed(2)}`
                );
              }
            }
          }
        }
        strecke += laenge;
      }
    }
    assert.ok(strecke > 100, `nur ${strecke.toFixed(1)} m gelaufen — das misst nichts`);
    streckeGesamt += strecke;
    probenGesamt += proben;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Rampen: die eine Stelle, an der Optik und Kollision auseinandergehen
//    Ramps: the one place where visuals and collision diverge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Der Generator erzeugt ueber 120 Seeds KEINE einzige Treppenzelle (gemessen).
 * Die Rampenrechnung waere damit ungeprueft — also wird ein Layout von Hand
 * gebaut. Ein Zweig, den kein Test je betritt, ist kein Code, sondern eine
 * Vermutung.
 * The generator produces NOT ONE stair cell over 120 seeds (measured). The ramp
 * maths would then be untested, so a layout is built by hand.
 */
function treppenLayout(neigung: number): DungeonLayout2 {
  const roh = {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    id: 'treppe',
    name: 'Treppenprobe',
    thema: 'steingrab',
    seeds: { architektur: 1, material: 2, deko: 3 },
    raster: { zelleM: 4, ebeneM: 8, hoehenSchrittM: 0.5, blockZellen: 8 },
    grenzen: { minX: 0, maxX: 3, minZ: 0, maxZ: 3, minEbene: 0, maxEbene: 0 },
    eingang: { x: 0, z: 0, ebene: 0, kante: KANTE.Sued },
    stempel: [],
    korrekturen: [
      { x: 1, z: 1, ebene: 0, aendere: { art: ZELLEN_ART.Boden, boden: 0, decke: 12, materialTag: 2 } },
      {
        x: 1,
        z: 2,
        ebene: 0,
        aendere: { art: ZELLEN_ART.Treppe, boden: 0, decke: 12, neigung, materialTag: 2 },
      },
      { x: 1, z: 3, ebene: 0, aendere: { art: ZELLEN_ART.Boden, boden: 4, decke: 12, materialTag: 2 } },
    ],
    tueren: [],
    anker: [],
    pruefsumme: '',
  } as unknown as DungeonLayout2;
  // `layoutPruefsumme` kanonisiert selbst — hier von Hand zu serialisieren
  // waere eine zweite Fassung derselben Regel.
  // `layoutPruefsumme` canonicalises itself.
  return { ...roh, pruefsumme: layoutPruefsumme(roh) };
}

pruefe('Treppe: die Rampenflaeche steigt von der tiefen auf die hohe Bodenhoehe', () => {
  const layout = treppenLayout(KANTE.Nord);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const rampen = voll.kollision.filter((k) => k.form === 'rampe' && (k.steigung ?? 0) > 0);
  assert.equal(rampen.length, 1, `${rampen.length} Rampen statt einer`);
  const form = kollisionsForm(rampen[0]!);
  assert.equal(form.achse, 'x', 'Neigung nach Nord (+z) muss um X kippen');

  const koerper = rampen[0]!;
  const mitteX = koerper.mitte.x;
  const z0 = koerper.mitte.z - koerper.groesse.z / 2 + 0.05;
  const z1 = koerper.mitte.z + koerper.groesse.z / 2 - 0.05;
  const unten = formOberkante(form, mitteX, z0);
  const oben = formOberkante(form, mitteX, z1);
  assert.ok(unten !== null && oben !== null, 'Rampenoberflaeche nicht getroffen');
  const hub = (koerper.steigung ?? 0) * HOEHEN_SCHRITT_M;
  // Die tiefe Seite liegt auf der Bodenoberkante der Ausgangszelle (0 m), die
  // hohe `hub` darueber. Toleranz: die 5 cm Einzug an beiden Enden.
  // The low side sits on the source cell's floor top, the high one `hub` above.
  assert.ok(Math.abs(unten!) < 0.06, `tiefe Seite bei ${unten!.toFixed(3)} statt 0`);
  assert.ok(Math.abs(oben! - hub) < 0.06, `hohe Seite bei ${oben!.toFixed(3)} statt ${hub}`);
  // Und monoton dazwischen — eine Rampe, die in der Mitte einknickt, ist keine.
  let vorher = -Infinity;
  for (let z = z0; z <= z1; z += 0.1) {
    const y = formOberkante(form, mitteX, z);
    assert.ok(y !== null, `Loch in der Rampe bei z=${z.toFixed(2)}`);
    assert.ok(y! >= vorher - 1e-9, `Rampe faellt bei z=${z.toFixed(2)}`);
    vorher = y!;
  }
});

pruefe('Treppe: alle vier Neigungsrichtungen steigen in die richtige Richtung', () => {
  for (const [name, kante, achse, vor] of [
    ['Nord', KANTE.Nord, 'x', 1],
    ['Ost', KANTE.Ost, 'z', 1],
    ['Sued', KANTE.Sued, 'x', -1],
    ['West', KANTE.West, 'z', -1],
  ] as const) {
    const layout = treppenLayout(kante);
    const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
    const rampe = voll.kollision.find((k) => k.form === 'rampe' && (k.steigung ?? 0) > 0);
    if (rampe === undefined) continue; // nur Nord hat einen hoeheren Nachbarn
    const form = kollisionsForm(rampe);
    assert.equal(form.achse, achse, `${name}: falsche Kippachse`);
    const laengs = achse === 'x' ? 'z' : 'x';
    const halb = (laengs === 'z' ? rampe.groesse.z : rampe.groesse.x) / 2 - 0.05;
    const punkt = (t: number): number =>
      formOberkante(
        form,
        laengs === 'x' ? rampe.mitte.x + t * halb : rampe.mitte.x,
        laengs === 'z' ? rampe.mitte.z + t * halb : rampe.mitte.z
      )!;
    const anstieg = punkt(vor) - punkt(-vor);
    assert.ok(anstieg > 0, `${name}: steigt in die falsche Richtung (${anstieg.toFixed(3)})`);
  }
});

pruefe('Babylons Quaternion kippt die Rampe genauso wie unsere Rechnung', () => {
  // Der eigentliche Zweifel: `KollisionsForm.winkel` ist eine Zahl, die wir uns
  // ausgedacht haben — was Havok davon sieht, ist eine Babylon-Quaternion. Also
  // wird sie hier mit Babylons EIGENER Matrix auf einen Punkt angewandt und mit
  // `formOberkante` verglichen. Das Vorzeichen einer Drehachse hat sonst kein
  // Symptom ausser einer Treppe, die nach unten fuehrt.
  // The real doubt: `winkel` is a number we invented — what Havok sees is a
  // Babylon quaternion. So it is applied with Babylon's OWN matrix here.
  const layout = treppenLayout(KANTE.Nord);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const rampe = voll.kollision.find((k) => k.form === 'rampe' && (k.steigung ?? 0) > 0)!;
  const form = kollisionsForm(rampe);
  const achse = form.achse === 'x' ? Vector3.Right() : Vector3.Forward();
  const q = Quaternion.RotationAxis(achse, form.winkel);
  const m = new Matrix();
  q.toRotationMatrix(m);
  // Lokale Oberflaechenmitte am „hohen" Ende der Platte.
  const halbLaengs = form.achse === 'x' ? form.halbe.z : form.halbe.x;
  const lokal =
    form.achse === 'x'
      ? new Vector3(0, form.halbe.y, halbLaengs)
      : new Vector3(halbLaengs, form.halbe.y, 0);
  const welt = Vector3.TransformCoordinates(lokal, m).addInPlaceFromFloats(
    form.mitte.x,
    form.mitte.y,
    form.mitte.z
  );
  const nach = formOberkante(form, welt.x, welt.z);
  assert.ok(nach !== null, 'Babylons gedrehter Endpunkt liegt ausserhalb unserer Flaeche');
  assert.ok(
    Math.abs(nach! - welt.y) < 1e-6,
    `Babylon sagt y=${welt.y.toFixed(6)}, unsere Rechnung ${nach!.toFixed(6)}`
  );
  // Und das Ende, das steigen soll, steigt auch: Nord = +z.
  assert.ok(welt.z > form.mitte.z, 'falsches Ende getroffen');
  assert.ok(welt.y > form.mitte.y, 'Babylon kippt die Rampe nach unten');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Kriterium (c): Auf- und Abbau x20 ohne Rest
//    Criterion (c): build and tear down x20 with no residue
// ─────────────────────────────────────────────────────────────────────────────

pruefe('Auf- und Abbau x20 laesst Mesh-, Material- und Texturzahl unveraendert', () => {
  const layout = baueLayout(1234);
  // Aufwaermrunde: Babylons erstes PBR-Material legt szenenweite Hilfstexturen
  // an (Environment-BRDF). Die gehoeren NICHT zum Bauer, und sie kaemen sonst
  // als „Leck" der ersten Runde in die Messung.
  // Warm-up round: Babylon's first PBR material creates scene-wide helper
  // textures. They do NOT belong to the builder.
  const warm = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  warm.baueAlles();
  warm.dispose();

  const vorher = {
    meshes: szene.meshes.length,
    materialien: szene.materials.length,
    texturen: szene.textures.length,
    knoten: szene.transformNodes.length,
  };
  for (let i = 0; i < 20; i++) {
    const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
    bauer.baueAlles();
    assert.ok(szene.meshes.length > vorher.meshes, `Runde ${i}: nichts gebaut`);
    bauer.dispose();
  }
  assert.deepEqual(
    {
      meshes: szene.meshes.length,
      materialien: szene.materials.length,
      texturen: szene.textures.length,
      knoten: szene.transformNodes.length,
    },
    vorher
  );
});

pruefe('zwei Instanzen teilen EIN Material — und die erste raeumt es nicht der zweiten weg', () => {
  const layout = baueLayout(1234);
  const vorherMaterialien = szene.materials.length;
  const a = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  const b = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  a.baueAlles();
  b.baueAlles();
  assert.equal(
    szene.materials.length,
    vorherMaterialien + 1,
    'zwei Materialien statt eines geteilten'
  );
  const meshB = b.wurzel.getChildren()[0] as Mesh;
  const materialB = meshB.material;
  assert.ok(materialB !== null, 'Mesh ohne Material');

  // DIE Falle aus AP6: `mesh.dispose(_, true)` in der ersten Instanz risse das
  // geteilte Material der zweiten mit.
  // THE trap from AP6: `mesh.dispose(_, true)` in the first instance would tear
  // down the second instance's shared material.
  a.dispose();
  assert.equal(szene.materials.length, vorherMaterialien + 1, 'Material zu frueh entsorgt');
  assert.ok(szene.materials.includes(materialB!), 'Material der zweiten Instanz ist weg');
  assert.ok(meshB.material === materialB, 'Mesh der zweiten Instanz hat sein Material verloren');

  b.dispose();
  assert.equal(szene.materials.length, vorherMaterialien, 'Material nach der letzten Instanz noch da');
});

pruefe('verschiedene Material-Seeds bekommen VERSCHIEDENE Materialien', () => {
  // Sonst zeichnete jedes Grab dieselben Risse: der Seed steckt im Uniform.
  // Otherwise every barrow would draw the same cracks: the seed is a uniform.
  const eins = erzeugeLayout(STEINGRAB, { architektur: 1234, material: 1, deko: 1 });
  const zwei = erzeugeLayout(STEINGRAB, { architektur: 1234, material: 2, deko: 1 });
  const vorher = szene.materials.length;
  const a = new DungeonBauer(szene, eins, { arrays: null, physik: false });
  const b = new DungeonBauer(szene, zwei, { arrays: null, physik: false });
  assert.equal(szene.materials.length, vorher + 2);
  a.dispose();
  b.dispose();
  assert.equal(szene.materials.length, vorher);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Ladezusage und Fackeln / ready promise and torches
// ─────────────────────────────────────────────────────────────────────────────

await pruefeAsync('dungeonBereit wird erfuellt, sobald der Spawnblock steht — nicht spaeter', async () => {
  const layout = baueLayout(99);
  const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  assert.equal(bauer.bereit, false, 'vor dem Bau schon bereit');
  bauer.baueSpawnBloecke();
  assert.equal(bauer.bereit, true, 'nach den Spawnbloecken nicht bereit');
  assert.equal(bauer.vollstaendig, false, 'die Spawnbloecke sind schon alles?');
  // Und die Zusage gilt fuer den Ort, an dem der Spieler steht.
  const index = baueIndex(bauer.formen());
  const y = oberkante(index, bauer.spawnPunkt.x, bauer.spawnPunkt.z, bauer.spawnPunkt.y + 1e-6);
  assert.ok(y !== null, 'unter dem Spawnpunkt liegt nichts');
  assert.ok(Math.abs(y! - bauer.spawnPunkt.y) < 1e-6, 'Spawnboden auf falscher Hoehe');
  let erfuellt = false;
  void bauer.dungeonBereit.then(() => {
    erfuellt = true;
  });
  await bauer.dungeonBereit;
  assert.equal(erfuellt, true);
  while (bauer.baueWeiter()) {
    /* leer / empty */
  }
  assert.equal(bauer.vollstaendig, true);
  bauer.dispose();
});

await pruefeAsync('dispose() vor dem Bau laesst dungeonBereit nicht haengen', async () => {
  const bauer = new DungeonBauer(szene, baueLayout(7), { arrays: null, physik: false });
  bauer.dispose();
  await bauer.dungeonBereit;
});

pruefe('Fackeln kommen aus den Deko-Ankern, nicht aus einer eigenen Liste', () => {
  const layout = baueLayout(1234);
  const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  const alle = bauer.lichtquellen(0, 0, 1e9);
  const fackeln = bauer.dekoTeile.filter((t) => t.rolle === 'fackel');
  assert.ok(fackeln.length > 0, 'kein Fackel-Anker im Layout');
  assert.equal(alle.length, fackeln.length, `${alle.length} Quellen zu ${fackeln.length} Fackeln`);
  for (const quelle of alle) {
    assert.ok(quelle.licht.range > 0, 'Lichtquelle ohne Reichweite');
    assert.ok(quelle.licht.color.length === 3, 'Lichtquelle ohne Farbe');
  }
  // Der Radius wirkt: um den Spawn herum sind es weniger als alle.
  const nah = bauer.lichtquellen(bauer.spawnPunkt.x, bauer.spawnPunkt.z, 12);
  assert.ok(nah.length < alle.length, 'der Radius filtert nicht');
  for (const quelle of nah) {
    const d = Math.hypot(quelle.x - bauer.spawnPunkt.x, quelle.z - bauer.spawnPunkt.z);
    assert.ok(d <= 12 + 1e-9, `Quelle ${d.toFixed(2)} m weg trotz Radius 12`);
  }
  bauer.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SSAO-Kalibrierung: die Zahlen aus der GEOMETRIE, nicht aus der Aussenwelt
//    SSAO calibration: the numbers from the GEOMETRY, not from outdoors
// ─────────────────────────────────────────────────────────────────────────────

pruefe('SSAO-maxZ deckt das 99. Perzentil der gemessenen Sichtstrecken', () => {
  const strecken: number[] = [];
  const kantenAbstaende: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const layout = erzeugeLayout(STEINGRAB, { architektur: seed, material: 5, deko: 6 });
    const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
    const nach = new Map<string, (typeof voll.nav)[number]>();
    for (const n of voll.nav) nach.set(`${n.ebene}|${n.z}|${n.x}`, n);
    for (const n of voll.nav) {
      for (const kante of KANTEN) {
        let schritte = 0;
        let x = n.x;
        let z = n.z;
        let hier = n;
        while ((hier.offeneKanten & kante) !== 0 && schritte < 200) {
          const p = nachbarZelle(x, z, kante);
          const weiter = nach.get(`${n.ebene}|${p.z}|${p.x}`);
          if (weiter === undefined) break;
          schritte++;
          x = p.x;
          z = p.z;
          hier = weiter;
        }
        strecken.push(schritte * ZELLE_M);
      }
    }
    for (const stueck of voll.stuecke) {
      for (const wert of stueck.blend.kantenAbstand) kantenAbstaende.push(wert);
    }
  }
  strecken.sort((a, b) => a - b);
  const p99 = strecken[Math.floor(strecken.length * 0.99)]!;
  const median = strecken[Math.floor(strecken.length * 0.5)]!;
  const mittelKante =
    kantenAbstaende.reduce((a, b) => a + b, 0) / Math.max(1, kantenAbstaende.length);
  console.log(
    `       gemessen: ${strecken.length} Sichtlinien, Median ${median} m, p99 ${p99} m, ` +
      `laengste ${strecken[strecken.length - 1]!} m; ${kantenAbstaende.length} Ecken, ` +
      `mittlerer Kantenabstand ${mittelKante.toFixed(3)} m`
  );
  assert.ok(
    DUNGEON_SSAO_MAX_Z >= p99,
    `maxZ ${DUNGEON_SSAO_MAX_Z} unter dem 99. Perzentil ${p99}`
  );
  // Und ausdruecklich NICHT der Aussenwelt-Wert: 1000 ist fuer 4 km kalibriert.
  assert.ok(DUNGEON_SSAO_MAX_Z <= 60, `maxZ ${DUNGEON_SSAO_MAX_Z} ausserhalb des Fensters 30-60 m`);
  assert.ok(DUNGEON_SSAO_MAX_Z >= 30, `maxZ ${DUNGEON_SSAO_MAX_Z} ausserhalb des Fensters 30-60 m`);
  // Der Radius liegt in der Groessenordnung der Fugen, nicht der Raeume.
  assert.ok(
    DUNGEON_SSAO_RADIUS >= mittelKante && DUNGEON_SSAO_RADIUS <= mittelKante * 4,
    `Radius ${DUNGEON_SSAO_RADIUS} passt nicht zum mittleren Kantenabstand ${mittelKante.toFixed(3)}`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Gegenproben — ein Test, der nie rot war, ist kein Test
//    Counter-checks — a test that was never red is no test
// ─────────────────────────────────────────────────────────────────────────────

function mussWerfen(name: string, fn: () => void): void {
  try {
    fn();
  } catch {
    console.log(`  ok   Gegenprobe faerbt rot: ${name}`);
    return;
  }
  rot++;
  console.error(`  ROT  Gegenprobe blieb gruen: ${name}`);
}

mussWerfen('eine um eine Hoehenstufe versetzte Bodenplatte', () => {
  const layout = baueLayout(1234);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const kaputt: KollisionsKoerper[] = voll.kollision.map((k, i) =>
    i === 0 ? { ...k, mitte: { ...k.mitte, y: k.mitte.y - HOEHEN_SCHRITT_M } } : k
  );
  const index = baueIndex(kaputt.map(kollisionsForm));
  for (const n of voll.nav) {
    const y = oberkante(index, n.mitte.x, n.mitte.z, n.mitte.y + 1e-6);
    assert.ok(y !== null && Math.abs(y - n.mitte.y) < 1e-6, 'Bodenversatz');
  }
});

mussWerfen('eine Rampe, deren Kippwinkel das Vorzeichen wechselt', () => {
  const layout = treppenLayout(KANTE.Nord);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const rampe = voll.kollision.find((k) => k.form === 'rampe' && (k.steigung ?? 0) > 0)!;
  const echt = kollisionsForm(rampe);
  const verdreht: KollisionsForm = { ...echt, winkel: -echt.winkel };
  // Genau die Zusicherungen des echten Tests, nur auf die verdrehte Form —
  // sonst prueft die Gegenprobe eine andere Behauptung als der Test.
  // Ein erster Anlauf verglich nur `oben > unten` und blieb GRUEN: an einem
  // Ende liegt die verdrehte Flaeche ausserhalb, `formOberkante` liefert dort
  // `null`, und `zahl > null` ist in JavaScript `zahl > 0`. Ein Vergleich gegen
  // `null` ist keine Pruefung.
  // Exactly the real test's assertions, applied to the tampered shape. A first
  // attempt compared only `oben > unten` and stayed GREEN: at one end the
  // surface lies outside, `formOberkante` returns `null`, and `number > null`
  // is `number > 0` in JavaScript.
  const hub = (rampe.steigung ?? 0) * HOEHEN_SCHRITT_M;
  const z0 = rampe.mitte.z - rampe.groesse.z / 2 + 0.05;
  const z1 = rampe.mitte.z + rampe.groesse.z / 2 - 0.05;
  const unten = formOberkante(verdreht, rampe.mitte.x, z0);
  const oben = formOberkante(verdreht, rampe.mitte.x, z1);
  assert.ok(unten !== null && oben !== null, 'Rampenoberflaeche nicht getroffen');
  assert.ok(Math.abs(unten!) < 0.06, `tiefe Seite bei ${unten!.toFixed(3)} statt 0`);
  assert.ok(Math.abs(oben! - hub) < 0.06, `hohe Seite bei ${oben!.toFixed(3)} statt ${hub}`);
});

mussWerfen('ein Mesh ohne Schichtattribut (der Shader nimmt dann still Ebene 0)', () => {
  const layout = baueLayout(7);
  const bauer = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  bauer.baueAlles();
  const mesh = bauer.wurzel.getChildren()[0] as Mesh;
  mesh.removeVerticesData(DUNGEON_SCHICHT_ATTRIBUT);
  try {
    assert.ok(
      mesh.getVerticesData(DUNGEON_SCHICHT_ATTRIBUT) !== null,
      `${mesh.name}: kein ${DUNGEON_SCHICHT_ATTRIBUT}`
    );
  } finally {
    bauer.dispose();
  }
});

mussWerfen('ein Bauer, der die Zier auf Niedrig NICHT weglaesst', () => {
  const layout = baueLayout(1234);
  const voll = baueGeometrie(layout, { gitter: zellenAufbauen(layout) });
  const zier = voll.stuecke.filter((s) => s.art === 'sims' || s.art === 'kante').length;
  setzeDungeonStufe(DungeonGrafikStufe.Mittel);
  const mittel = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  mittel.baueAlles();
  const vertices = mittel.statistik().vertices;
  mittel.dispose();
  // Absichtlich MITTEL statt Niedrig gebaut — die Erwartung ist die von Niedrig.
  assert.equal(vertices, vertices - zier * VERTICES_JE_QUADER);
});

mussWerfen('ein Material, das die erste Instanz der zweiten wegraeumt', () => {
  const layout = baueLayout(1234);
  const a = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  const b = new DungeonBauer(szene, layout, { arrays: null, physik: false });
  a.baueAlles();
  b.baueAlles();
  const mesh = b.wurzel.getChildren()[0] as Mesh;
  const material = mesh.material!;
  // Genau der verbotene Aufruf — hier ausdruecklich, um zu belegen, dass der
  // Test ihn saehe.
  // Exactly the forbidden call, made on purpose to prove the test would see it.
  material.dispose(true, false);
  try {
    assert.ok(szene.materials.includes(material), 'Material der zweiten Instanz ist weg');
  } finally {
    a.dispose();
    b.dispose();
  }
});

// ─────────────────────────────────────────────────────────────────────────────

console.log(
  `  --   Begehbarkeit: ${streckeGesamt.toFixed(0)} m ueber ${probenGesamt} Proben ` +
    `(Schrittweite ${SCHRITT_M} m, Figurenradius ${KOERPER_RADIUS} m); ` +
    `${schaechteGesamt} Schaechte ausgenommen (gewollte Loecher)`
);

szene.dispose();
engine.dispose();

console.log(rot === 0 ? 'alles gruen' : `${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
