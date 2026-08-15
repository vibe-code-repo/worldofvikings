#!/usr/bin/env node
/**
 * Test-Runner (Review-Punkt 26): fährt die kuratierte Testliste sequenziell
 * und aggregiert die Exit-Codes — vorher liefen 29 Testdateien nur einzeln
 * von Hand.
 *
 *   npm test              schnelle Kernliste (~2–3 min)
 *   npm test -- --alle    zusätzlich die langen Läufe (Placement, E2E-Wire)
 *
 * NICHT enthalten sind die C++-Golden-Tests (geo-compare, heightmap-compare,
 * geo-map): sie brauchen Referenz-Dumps als Argument und gehören zum
 * eingefrorenen valheim-Übergangspfad.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KERN = [
  // Naht zwischen Kopf- und Rumpfdateien der Weltdaten (Bundle-Schnitt):
  // laeuft in Sekunden und faengt genau den Fehler, den sonst niemand sieht.
  ['shared', 'test/weltdaten-schnitt.ts'],
  ['shared', 'test/worldlayout.ts'],
  ['shared', 'test/region-geo.ts'],
  ['shared', 'test/geo-smoke.ts'],
  ['shared', 'test/dungeon-generator.ts'],
  ['server', 'test/h1-layout.ts'],
  ['server', 'test/h2-routen.ts'],
  ['server', 'test/h3-routen-vorschau.ts'],
  ['server', 'test/h4-graslandflora.ts'],
  ['server', 'test/g2-persistence.ts'],
  ['server', 'test/g4-creatures.ts'],
  ['server', 'test/e2-vegetation.ts'],
];

const LANG = [
  ['server', 'test/g3-streaming.ts'],
  ['server', 'test/g5-dungeons.ts'],
  ['server', 'test/f3-leveling.ts'],
];

const liste = process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN;
let fehler = 0;
const start = Date.now();

for (const [paket, datei] of liste) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${paket}/${datei} … `);
  const lauf = spawnSync('npx', ['tsx', datei], {
    cwd: resolve(WURZEL, paket),
    encoding: 'utf-8',
    timeout: 600_000,
  });
  const dauer = ((Date.now() - t0) / 1000).toFixed(1);
  if (lauf.status === 0) {
    console.log(`OK (${dauer}s)`);
  } else {
    fehler++;
    console.log(`FEHLGESCHLAGEN (${dauer}s)`);
    console.log((lauf.stdout ?? '').split('\n').slice(-15).join('\n'));
    console.log(lauf.stderr ?? '');
  }
}

console.log(
  `\n${liste.length - fehler}/${liste.length} Tests grün in ${((Date.now() - start) / 1000).toFixed(0)}s`
);
process.exit(fehler > 0 ? 1 : 0);
