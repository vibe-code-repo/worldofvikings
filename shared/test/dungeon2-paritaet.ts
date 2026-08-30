/**
 * Paritaetstest Optik <-> Kollision fuer den Geometrie-Bauer (AP3).
 * Parity test visuals <-> collision for the geometry builder (AP3).
 *
 *   npx tsx test/dungeon2-paritaet.ts
 *
 * Die Uebersetzung von WoCs `rift_wall_render_parity.test.ts` in unsere Welt
 * (`design/ARCHITECTURE.md`, AP3, Pruefkriterium 1):
 * The translation of WoC's `rift_wall_render_parity.test.ts` into our world
 * (`design/ARCHITECTURE.md`, AP3, criterion 1):
 *
 *   Jede gezeichnete Wandflaeche liegt auf Kollision, UND jeder
 *   Wand-Kollisionskoerper ist visuell gedeckt.
 *   Every drawn wall surface lies on collision, AND every wall collision body
 *   is visually covered.
 *
 * Beide Richtungen, weil Luecken symmetrisch sind: es gibt sie als Loch (man
 * sieht eine Wand und laeuft hindurch) und als Ueberhang (man stoesst gegen
 * nichts Sichtbares). Ein Test in nur einer Richtung findet die halbe Klasse.
 * Both directions, because gaps are symmetric: they exist as a hole (you see a
 * wall and walk through it) and as an overhang (you bump into nothing visible).
 * A test in one direction only finds half the class.
 *
 * Verfahren nach ARCHITECTURE: Mittellinien werden abgetastet (Schrittweite
 * 1 m, Enden um 0,15 m eingezogen), gegen aufgeblaehte Koerper geprueft,
 * gesweept ueber >= 50 Seeds und alle Ebenen.
 * Method per ARCHITECTURE: centre lines are sampled (1 m step, ends inset by
 * 0.15 m), checked against inflated bodies, swept over >= 50 seeds and all
 * storeys.
 */

import {
  type LayoutSeeds,
  type RaumStempel,
} from '../src/dungeon2/layout.js';
import { baueGeometrie, type BauStueck, type KollisionsKoerper } from '../src/dungeon2/builder.js';
import { erzeugeLayout } from '../src/dungeon2/generator.js';
import { STEINGRAB, materialTagFuerStempel } from '../src/dungeon2/themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness
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

function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Abtastung und Aufblaehung / sampling and inflation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feste Bauteile — die, die eine Kollision haben MUESSEN. `stufe` und `sims`
 * sind ausdruecklich NICHT dabei: Stufen werden von EINER Rampe gedeckt (die
 * Optik ist gestuft, die Kollision glatt), Simse sind reine Optik und duerfen
 * auf Stufe Niedrig entfallen (Vertragsregel 5).
 * Solid pieces — the ones that MUST have collision. `stufe` and `sims` are
 * explicitly NOT among them: steps are covered by ONE ramp (the visuals are
 * stepped, the collision smooth), ledges are pure visuals and may be dropped on
 * the Low tier (contract rule 5).
 */
const FESTE_ARTEN = new Set<BauStueck['art']>(['boden', 'wand', 'decke', 'tuerrahmen']);

/** Schrittweite der Abtastung in Metern. / Sampling step in metres. */
const SCHRITT_M = 1;
/** Einzug an beiden Enden in Metern. / Inset at both ends in metres. */
const EINZUG_M = 0.15;
/**
 * Aufblaehung des Pruefkoerpers in Metern. Sie ist WINZIG, nicht grosszuegig:
 * sie soll den Punkt genau auf der Flaeche einschliessen, nicht eine Luecke
 * zudecken. Wer hier 5 cm einsetzt, hat einen Test, der 4 cm Luecke uebersieht.
 * Inflation of the test body in metres. It is TINY, not generous: it is meant
 * to include a point exactly on the surface, not to paper over a gap. Whoever
 * puts 5 cm here has a test that misses a 4 cm gap.
 */
const AUFBLAEHUNG_M = 1e-6;

interface Kasten {
  readonly mitte: { readonly x: number; readonly y: number; readonly z: number };
  readonly groesse: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Punkte auf den drei Mittellinien eines Quaders: je Achse eine Linie durch die
 * Mitte, in `SCHRITT_M` abgetastet, an beiden Enden um `EINZUG_M` eingezogen.
 * Die Mittellinien sind der richtige Zeuge, weil eine Wandflaeche, die auf
 * Kollision liegt, es auch in ihrer Mitte tut — und ein Loch in der Mitte ist
 * genau das, was man nicht sieht, bis man hindurchfaellt.
 * Points on the three centre lines of a box: one line per axis through the
 * centre, sampled at `SCHRITT_M`, inset at both ends by `EINZUG_M`. The centre
 * lines are the right witness, because a wall face that lies on collision does
 * so in its middle as well — and a hole in the middle is exactly what you do
 * not see until you fall through it.
 */
function mittellinienPunkte(k: Kasten): { x: number; y: number; z: number }[] {
  const punkte: { x: number; y: number; z: number }[] = [];
  const achsen: readonly ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (const achse of achsen) {
    const laenge = k.groesse[achse];
    const halb = laenge / 2 - EINZUG_M;
    if (halb <= 0) {
      punkte.push({ x: k.mitte.x, y: k.mitte.y, z: k.mitte.z });
      continue;
    }
    const schritte = Math.max(1, Math.ceil((halb * 2) / SCHRITT_M));
    for (let i = 0; i <= schritte; i++) {
      const t = -halb + (halb * 2 * i) / schritte;
      punkte.push({
        x: k.mitte.x + (achse === 'x' ? t : 0),
        y: k.mitte.y + (achse === 'y' ? t : 0),
        z: k.mitte.z + (achse === 'z' ? t : 0),
      });
    }
  }
  return punkte;
}

const RASTER_M = 4;

function baueIndex(kaesten: readonly Kasten[]): Map<string, Kasten[]> {
  const index = new Map<string, Kasten[]>();
  for (const k of kaesten) {
    const x0 = Math.floor((k.mitte.x - k.groesse.x / 2 - AUFBLAEHUNG_M) / RASTER_M);
    const x1 = Math.floor((k.mitte.x + k.groesse.x / 2 + AUFBLAEHUNG_M) / RASTER_M);
    const y0 = Math.floor((k.mitte.y - k.groesse.y / 2 - AUFBLAEHUNG_M) / RASTER_M);
    const y1 = Math.floor((k.mitte.y + k.groesse.y / 2 + AUFBLAEHUNG_M) / RASTER_M);
    const z0 = Math.floor((k.mitte.z - k.groesse.z / 2 - AUFBLAEHUNG_M) / RASTER_M);
    const z1 = Math.floor((k.mitte.z + k.groesse.z / 2 + AUFBLAEHUNG_M) / RASTER_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const schluessel = `${x}|${y}|${z}`;
          const liste = index.get(schluessel);
          if (liste === undefined) index.set(schluessel, [k]);
          else liste.push(k);
        }
      }
    }
  }
  return index;
}

function gedeckt(index: Map<string, Kasten[]>, p: { x: number; y: number; z: number }): boolean {
  const schluessel = `${Math.floor(p.x / RASTER_M)}|${Math.floor(p.y / RASTER_M)}|${Math.floor(p.z / RASTER_M)}`;
  for (const k of index.get(schluessel) ?? []) {
    if (Math.abs(p.x - k.mitte.x) > k.groesse.x / 2 + AUFBLAEHUNG_M) continue;
    if (Math.abs(p.y - k.mitte.y) > k.groesse.y / 2 + AUFBLAEHUNG_M) continue;
    if (Math.abs(p.z - k.mitte.z) > k.groesse.z / 2 + AUFBLAEHUNG_M) continue;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Der Sweep / the sweep
// ─────────────────────────────────────────────────────────────────────────────

const SEEDS = 50;

let hinFehler = 0;
let herFehler = 0;
let hinProben = 0;
let herProben = 0;
let ersterHin = '';
let ersterHer = '';
const ebenenGesehen = new Set<number>();
let simseGesehen = 0;
let stufenGesehen = 0;
let rampenGesehen = 0;

for (let i = 0; i < SEEDS; i++) {
  const layout = erzeugeLayout(thema, seedsFuer(i));
  const ergebnis = baueGeometrie(layout, { aufbau: materialOptionen });

  for (const s of ergebnis.stuecke) {
    ebenenGesehen.add(s.block.ebene);
    if (s.art === 'sims') simseGesehen++;
    if (s.art === 'stufe') stufenGesehen++;
  }
  for (const k of ergebnis.kollision) if (k.form === 'rampe') rampenGesehen++;

  const feste: BauStueck[] = ergebnis.stuecke.filter((s) => FESTE_ARTEN.has(s.art));
  // Fuer die Rueckrichtung zaehlt ALLE Sichtgeometrie als Deckung: eine Rampe
  // darf von den Stufenquadern gedeckt sein, sie ist ja deren glatte Fassung.
  // For the reverse direction ALL visual geometry counts as coverage: a ramp
  // may be covered by the step boxes, being their smooth version.
  const alleSicht: Kasten[] = [...ergebnis.stuecke];
  const boxen: KollisionsKoerper[] = ergebnis.kollision.filter((k) => k.form === 'box');

  const indexKollision = baueIndex(ergebnis.kollision);
  const indexSicht = baueIndex(alleSicht);

  // Hin: jede gezeichnete feste Flaeche liegt auf Kollision.
  // Forward: every drawn solid surface lies on collision.
  for (const s of feste) {
    for (const p of mittellinienPunkte(s)) {
      hinProben++;
      if (gedeckt(indexKollision, p)) continue;
      hinFehler++;
      if (ersterHin === '') {
        ersterHin = `Seed ${i}, ${s.art} bei (${p.x}, ${p.y}, ${p.z}) ohne Kollision`;
      }
    }
  }

  // Her: jeder Kollisionskoerper ist visuell gedeckt.
  // Reverse: every collision body is visually covered.
  for (const k of boxen) {
    for (const p of mittellinienPunkte(k)) {
      herProben++;
      if (gedeckt(indexSicht, p)) continue;
      herFehler++;
      if (ersterHer === '') {
        ersterHer = `Seed ${i}, Kollisionsbox bei (${p.x}, ${p.y}, ${p.z}) ohne Sichtgeometrie`;
      }
    }
  }
}

pruefe(
  `hin: jede gezeichnete feste Flaeche liegt auf Kollision (${hinProben} Proben, ${SEEDS} Seeds)`,
  hinFehler === 0,
  ersterHin
);
pruefe(
  `her: jeder Kollisionskoerper ist visuell gedeckt (${herProben} Proben, ${SEEDS} Seeds)`,
  herFehler === 0,
  ersterHer
);
pruefe(`der Sweep hat mehr als eine Ebene gesehen (${ebenenGesehen.size})`, ebenenGesehen.size > 1);
pruefe('der Sweep hat genug Proben genommen', hinProben > 100000 && herProben > 100000, `${hinProben}/${herProben}`);

/**
 * Gegenprobe zur Ausnahmeliste: Simse MUESSEN vorkommen, sonst prueft die
 * Ausnahme "Simse haben keine Kollision" nichts. Ein Test, dessen Ausnahme nie
 * greift, ist eine Zeile Text.
 * Counter-check on the exception list: ledges MUST occur, otherwise the
 * exception "ledges have no collision" checks nothing. A test whose exception
 * never fires is a line of prose.
 */
pruefe(`es gab Simse im Sweep (${simseGesehen})`, simseGesehen > 100);
pruefe(
  'Stufen und Rampen: entweder beides oder keines (der Auto-Generator setzt heute keine Treppenzellen)',
  (stufenGesehen === 0) === (rampenGesehen === 0),
  `${stufenGesehen} Stufen, ${rampenGesehen} Rampen`
);

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(
  `dungeon2-paritaet: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot ` +
    `(${SEEDS} Seeds, ${hinProben} Proben hin, ${herProben} Proben her, ${ebenenGesehen.size} Ebenen)`
);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
