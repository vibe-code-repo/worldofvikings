/**
 * Determinismus-Nachweis fuer die Weltgenerierung.
 *
 * Die Hoehenfunktion lebt in `shared/` und wird von Server UND Client
 * gefahren. Beide muessen dieselbe Welt rechnen — nicht "aehnlich", sondern
 * Bit fuer Bit, sonst steht der Spieler beim Client im Boden, waehrend der
 * Server ihn ueber Grund fuehrt. Jede Umbaumassnahme an der Hoehenfunktion
 * (Memos, vorzerlegte Formen, Reihenfolgen) muss sich deshalb daran messen
 * lassen, dass sie GAR NICHTS am Ergebnis aendert.
 *
 * Der Test schreibt bzw. prueft eine Referenzdatei mit den 65x65-Hoehen
 * mehrerer Zonen aus allen vorkommenden Biomlagen:
 *
 *   npx tsx test/heightmap-determinismus.ts --schreibe   Referenz erzeugen
 *   npx tsx test/heightmap-determinismus.ts              pruefen
 *
 * Die Referenz (test/golden/heightmap-zonen.bin) stammt aus dem Stand VOR
 * der Beschleunigung; ausgewiesen wird der groesste Hoehenunterschied in
 * Metern. Zulaessig ist genau 0.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo } from '../src/worldgen/factory.js';
import { HeightmapProvider, E_WIDTH, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import { getStableHash } from '../src/hash.js';
import { sanitizeWorldLayout } from '../src/worldlayout/index.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const GOLDEN = resolve(HIER, 'golden/heightmap-zonen.bin');

const layoutRoh = JSON.parse(
  readFileSync(resolve(WURZEL, 'server/data/worldlayout.json'), 'utf-8')
) as unknown;
const layout = sanitizeWorldLayout(layoutRoh)!;
const geo = createGeo({
  mode: 'layout',
  worldSeed: getStableHash(layout.detailSeed),
  layout: layoutRoh,
  settings: {
    worldGenVersion: 2,
    disableDistantRivers: false,
    riverAffectsOcean: false,
    ashlandsModernNoise: true,
  },
});

/**
 * Feste Zonenliste statt Zufallsauswahl: Die Referenzdatei muss ueber
 * Laeufe hinweg dieselbe Bedeutung haben. Abgedeckt sind offene See, der
 * Regionen-Kern (Wiesenpolygone, 30 Ecken, mehrere ueberlappend), die
 * Grenzsaeume dazwischen, ein Sockel-Gebiet und die drei Rundregionen
 * (Sumpf, Schwarzwald, Ashlands) — genau die Faelle, in denen sich
 * Regionsfeld, Wasser-Carving und Sockel unterschiedlich verschalten.
 */
const ZONEN: Array<[number, number]> = [
  [0, 0],
  [-201, -204],
  [-204, -201],
  [-205, -200],
  [-203, -203],
  [-206, -205],
  [-198, -207],
  [-131, -206], // Sumpf (-8380, -13160)
  [-275, -92], // Grasland (-17620, -5700)
  [-435, -92], // Schwarzwald (-27820, -5900)
  [86, -128], // Ashlands (5500, -8200)
  [-33, -406], // kleine Rundregion (-2084, -25952)
  [-330, -270], // Deep North (Dreieck)
];

/** Zusaetzlich die Abfrageseite: getGroundHeight auf halben Metern. */
const GRUND_PUNKTE = 4096;

function dump(): Float32Array {
  const p = new HeightmapProvider(geo, {}, 4096);
  const proZone = E_WIDTH * E_WIDTH;
  const out = new Float32Array(ZONEN.length * proZone + GRUND_PUNKTE);
  for (let i = 0; i < ZONEN.length; i++) {
    const hm = p.getZone(ZONEN[i]![0], ZONEN[i]![1]);
    out.set(hm.heights, i * proZone);
  }
  // Abfragepfad separat: halbe Meter treffen bewusst NICHT die Vertices,
  // damit auch das Runden in getGroundHeight mit abgesichert ist.
  const ox = ZONEN[3]![0] * ZONE_UNITS;
  const oz = ZONEN[3]![1] * ZONE_UNITS;
  for (let i = 0; i < GRUND_PUNKTE; i++) {
    const r = Math.floor(i / 64);
    const c = i % 64;
    out[ZONEN.length * proZone + i] = p.getGroundHeight(ox + c * 3.5 - 112, oz + r * 3.5 - 112);
  }
  return out;
}

const jetzt = dump();

if (process.argv.includes('--schreibe')) {
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, Buffer.from(jetzt.buffer, jetzt.byteOffset, jetzt.byteLength));
  console.log(`Referenz geschrieben: ${GOLDEN} (${jetzt.length} Werte)`);
  process.exit(0);
}

if (!existsSync(GOLDEN)) {
  console.error(`FEHLER: Referenz fehlt (${GOLDEN}) — mit --schreibe erzeugen.`);
  process.exit(1);
}

const roh = readFileSync(GOLDEN);
const soll = new Float32Array(roh.buffer, roh.byteOffset, roh.byteLength / 4);
if (soll.length !== jetzt.length) {
  console.error(`FEHLER: Referenz hat ${soll.length} Werte, aktuell ${jetzt.length}.`);
  process.exit(1);
}

let maxDiff = 0;
let maxIndex = -1;
let abweichend = 0;
for (let i = 0; i < soll.length; i++) {
  const d = Math.abs(soll[i]! - jetzt[i]!);
  if (d !== 0) abweichend++;
  if (d > maxDiff) {
    maxDiff = d;
    maxIndex = i;
  }
}

const proZone = E_WIDTH * E_WIDTH;
const ort =
  maxIndex < 0
    ? '—'
    : maxIndex < ZONEN.length * proZone
      ? `Zone (${ZONEN[Math.floor(maxIndex / proZone)]!.join(', ')}), Vertex ${maxIndex % proZone}`
      : `getGroundHeight-Punkt ${maxIndex - ZONEN.length * proZone}`;

console.log(`${soll.length} Hoehenwerte verglichen (${ZONEN.length} Zonen + ${GRUND_PUNKTE} Abfragen)`);
console.log(`abweichende Werte: ${abweichend}`);
console.log(`groesster Hoehenunterschied: ${maxDiff.toExponential(3)} m  bei ${ort}`);

if (maxDiff === 0) {
  console.log('OK — die Welt ist Bit fuer Bit dieselbe.');
  process.exit(0);
}
console.error('FEHLGESCHLAGEN — Server und Client wuerden auseinanderlaufen.');
process.exit(1);
