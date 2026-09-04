/**
 * G10 — Sondierung der Kantenerklärung gegen den ECHTEN Rumpf.
 *
 * ── Warum es dieses Werkzeug gibt ────────────────────────────────────
 * Die Konzeptnotiz führt unter „Risiken" den Punkt „Zwei Wahrheiten über
 * dieselbe Wand": `RoomDef.gridEdges` ist eine ERKLÄRUNG über das GLB,
 * keine Messung an ihm. Ändert sich die Geometrie, ohne dass jemand die
 * Erklärung nachzieht, bleibt jede Zählung grün und trotzdem steht im
 * Grab eine Wand vor einer Öffnung. Als Gegenmittel nennt die Notiz
 * ausdrücklich „eine Sondierung gegen den echten (ungeschrumpften)
 * Rumpf" — das ist dieses Werkzeug.
 *
 * Es liest die Modul-GLBs, rechnet ihre Eckpunkte in die Pose um, in der
 * der CLIENT sie zeigt, und fragt je Zellkante: Steht dort Stein?
 *
 * ── Warum die x-Spiegelung mitgerechnet wird ─────────────────────────
 * `make-stonevault.py` negiert am Ende jedes Moduls die x-Achse („alle
 * Steingrab-Module haben negatives Signed Volume … der Client dreht das
 * über Babylons `__root__` (scale.x = −1) wieder gerade"). Im GLB steht
 * die Geometrie also gespiegelt, in der SZENE nicht. Wer die Kanten am
 * rohen GLB misst, misst folglich die falsche Seite — und genau darum
 * geht es hier: Die Erklärung im Kit muss zur SZENE passen, denn dort
 * läuft die Figur.
 *
 * ── Was gemessen wird: das DURCHGANGSFENSTER ─────────────────────────
 * Nicht „steht dort irgendwo Stein" — das ist an jeder Kante der Fall,
 * weil Boden, Decke und die Stirnseiten der Nachbarwände bis an die
 * Zellkante reichen. Gemessen wird der Quader, den eine Figur beim
 * Durchgehen einnimmt: der Streifen 0,70 … 1,00 vom Zellmittelpunkt in
 * Kantenrichtung, ±0,40 quer dazu (die Öffnung ist 1,40 breit) und
 * 1,00 … 2,50 über dem Boden — über der Bodenplatte, unter der Decke,
 * und ausserhalb der Reliefkanten, die an jeder Ecke sitzen.
 *
 * Damit hat die Sonde nur ZWEI Antworten: „Durchgang" (nichts im
 * Fenster) und „versperrt". Sie versucht gar nicht erst, `wall` und
 * `wallPartial` nachzubilden — für die Frage des Meilensteins („kommt
 * die Figur durch?") sind beide dasselbe, und eine Sonde, die drei
 * Zustände raten muss, misst am Ende ihre eigene Schwelle.
 *
 * Aufruf: `npx tsx tools/stonevault-kantensonde.ts [kit=DG_StoneVault] [--roh]`
 * (`--roh` misst OHNE die x-Spiegelung — der Vergleich zeigt, dass die
 * Abweichung genau die Spiegelung ist und kein Zufall.)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTIONS, gridModuleFromRoomDef, type Direction, type EdgeState } from '../shared/src/dungeonRasterModul.js';
import type { RoomDef } from '../shared/src/dungeons.js';
import { holeKit } from './messe-stonevault-logik.js';

/*
  Am MODUL festgemacht, nicht am Arbeitsverzeichnis: `scripts/run-tests.mjs`
  startet jeden Test mit cwd im Paketordner (hier `tools/`), ein relativer
  Pfad fände die Modelle dort nicht — und die Sonde meldete „GLB fehlt"
  statt zu messen.
*/
const MODELL_ORDNER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets/models');
/** Der Streifen, in dem die eingebauten Innenwände stehen (`make-stonevault.py`). */
const STREIFEN_VON = 0.7;
const STREIFEN_BIS = 1.0;
/** Halbe Breite des Durchgangsfensters (die Öffnung misst 1,40 m). */
const FENSTER_QUER = 0.4;
/** Höhenfenster über dem Zellboden: über der Bodenplatte, unter der Decke. */
const HOEHE_VON = 1.0;
const HOEHE_BIS = 2.5;
/** Ab wie vielen Eckpunkten im Fenster gilt die Kante als versperrt. */
const PUNKTE_GRENZE = 4;

interface Punkt {
  x: number;
  y: number;
  z: number;
}

/** GLB lesen und alle Eckpunkte in glTF-Koordinaten liefern. */
function glbPunkte(pfad: string): Punkt[] {
  const roh = readFileSync(pfad);
  let off = 12;
  let json: {
    meshes: { name?: string; primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number }[];
  } | null = null;
  let bin: Buffer | null = null;
  while (off + 8 <= roh.length) {
    const len = roh.readUInt32LE(off);
    const typ = roh.readUInt32LE(off + 4);
    const daten = roh.subarray(off + 8, off + 8 + len);
    if (typ === 0x4e4f534a) json = JSON.parse(daten.toString('utf8'));
    else bin = daten;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error(`${pfad}: kein GLB`);
  const punkte: Punkt[] = [];
  for (const m of json.meshes) {
    for (const pr of m.primitives) {
      const a = json.accessors[pr.attributes.POSITION];
      const start = (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i = 0; i < a.count; i++) {
        const o = start + i * 12;
        punkte.push({ x: bin.readFloatLE(o), y: bin.readFloatLE(o + 4), z: bin.readFloatLE(o + 8) });
      }
    }
  }
  return punkte;
}

const ACHSE: Record<Direction, { achse: 'x' | 'z'; vz: number } | null> = {
  e: { achse: 'x', vz: 1 },
  w: { achse: 'x', vz: -1 },
  n: { achse: 'z', vz: 1 },
  s: { achse: 'z', vz: -1 },
  up: null,
  down: null,
};

/** Ist das Durchgangsfenster dieser Zellkante frei? */
function gemessen(
  punkte: readonly Punkt[],
  mitte: Punkt,
  d: Direction
): { frei: boolean; punkte: number } {
  const a = ACHSE[d];
  if (!a) return { frei: false, punkte: 0 };
  const quer = a.achse === 'x' ? 'z' : 'x';
  let n = 0;
  for (const p of punkte) {
    const laengs = (p[a.achse] - mitte[a.achse]) * a.vz;
    if (laengs < STREIFEN_VON - 1e-3 || laengs > STREIFEN_BIS + 1e-3) continue;
    if (Math.abs(p[quer] - mitte[quer]) > FENSTER_QUER) continue;
    const h = p.y - mitte.y;
    if (h < HOEHE_VON || h > HOEHE_BIS) continue;
    n++;
  }
  return { frei: n < PUNKTE_GRENZE, punkte: n };
}

const argv = process.argv.slice(2);
const roh = argv.includes('--roh');
const kitName = argv.find((a) => !a.startsWith('--')) ?? 'DG_StoneVault';
const kit = holeKit(kitName);

console.log(
  `Kantensonde ${kitName} — Geometrie ${roh ? 'ROH aus dem GLB' : 'wie in der SZENE (x gespiegelt)'}\n`
);

let abweichungen = 0;
let geprueft = 0;
for (const raum of kit.rooms as readonly RoomDef[]) {
  const pfad = `${MODELL_ORDNER}/${raum.name}.glb`;
  let punkte: Punkt[];
  try {
    punkte = glbPunkte(pfad);
  } catch {
    console.log(`${raum.name}: GLB fehlt (${pfad}) — übersprungen`);
    continue;
  }
  // Der Client kehrt die x-Achse um (`__root__`, scale.x = −1). Ohne
  // diese Zeile misst die Sonde die gespiegelte Seite.
  const szene = roh ? punkte : punkte.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
  const modul = gridModuleFromRoomDef(raum);
  if (modul.endCap) continue;

  const zeilen: string[] = [];
  for (const zelle of modul.cells) {
    for (const d of DIRECTIONS) {
      if (!ACHSE[d]) continue;
      if (zelle.interior[d]) continue;
      geprueft++;
      const soll: EdgeState = zelle.edges[d];
      const ist = gemessen(szene, zelle.localCenter, d);
      // `wallPartial` ist die eine Erklärung, die BEIDES sein darf: Die
      // Treppenflanke deckt die Kante nur teilweise, und ob ihr Keil
      // gerade das Durchgangsfenster erreicht, hängt an der Ebene.
      if (soll === 'wallPartial') continue;
      const passt = soll === 'open' ? ist.frei : !ist.frei;
      if (!passt) {
        abweichungen++;
        zeilen.push(
          `    Zelle (${zelle.ix},${zelle.iz},${zelle.level}) Kante ${d}: erklärt '${soll}', ` +
            `gemessen ${ist.frei ? 'DURCHGANG' : 'VERSPERRT'} (${ist.punkte} Punkte im Fenster)`
        );
      }
    }
  }
  console.log(`${raum.name}: ${zeilen.length === 0 ? 'Erklärung deckt sich mit der Geometrie' : `${zeilen.length} ABWEICHUNG(EN)`}`);
  for (const z of zeilen) console.log(z);
}

console.log(`\n${geprueft} Kanten geprüft, ${abweichungen} Abweichung(en).`);
// Ohne diese Zeile wäre die Sonde grün, sobald KEIN GLB da ist — sie
// hätte dann nichts gemessen und meldete trotzdem „0 Abweichungen".
// Wer sie überspringen will, muss das ausserhalb entscheiden
// (`scripts/run-tests.mjs` prüft die Dateien vorher), nicht hier drin.
if (geprueft === 0) {
  console.log('KEINE Kante geprüft — fehlen die Modell-Dateien? Das ist kein Bestehen.');
  process.exitCode = 1;
} else process.exitCode = abweichungen > 0 ? 1 : 0;
