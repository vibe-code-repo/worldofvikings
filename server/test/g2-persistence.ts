/**
 * G1 smoke test — world persistence (WorldManager save/load roundtrip).
 *
 * Mirrors C++ WorldManager::WriteFileDB/LoadFileDB semantics: worldTime,
 * generated zones and persistent ZDOs survive a restart; player positions
 * roundtrip through the players[] section (character ZDOs are excluded to
 * avoid ghosts). Der Regressionswaechter: Wiederhergestellte Zonen
 * ueberspringen generateZone — zones.update darf sie danach nicht ein
 * zweites Mal streuen, sonst steht nach jedem Neustart alles doppelt.
 *
 * Checks:
 *  1. Server A: generate zone (0,0) (foliage), set worldTime,
 *     inject a player → saveWorld writes a zstd envelope with the C++-shaped
 *     sections (meta/worldTime/zones/players/zdos); re-save rotates .prev.
 *  2. Fresh server B on the same worldsDir: loads worldTime, generated
 *     zones, all persistent ZDOs; saved player state present; zones.update
 *     does NOT regenerate zone (0,0) (keine doppelten ZDOs).
 *  3. Seed mismatch → load refused (fresh world).
 *  4. Corrupt save file → load refused (fresh world).
 *
 * BLOCK A: Der Tempel ist weg, und mit ihm zwei Pruefungen.
 * `FEATURES` ist gegen die Whitelist gefiltert und leer — es gibt keine
 * Location mehr, also weder eine gebuchte Instanz in Zone (0,0) noch den
 * LocationProxy, an dem die Doppelung bisher abgelesen wurde, noch einen
 * F4-Gelaendemodifikator, dessen Wiedereinspielen beim Laden zu pruefen
 * waere. Der Rundlauf selbst haengt an keinem davon: Die Zone traegt
 * weiterhin ihre Vegetations-ZDOs, und die Doppelung zeigt sich daran
 * genauso — schaerfer sogar, weil jetzt auf Vielfachheit statt auf einen
 * einzelnen Proxy geprueft wird.
 *
 * BLOCK A, Schritt 15: Der Test laeuft jetzt im LAYOUT-MODUS.
 * Auch die Vegetationstabelle ist gegen die Whitelist gefiltert, und
 * eigene Flora waechst ausschliesslich dort, wo eine Region sie kuratiert
 * (shared/src/worldgen/streuung.ts). Die Radialwelt, auf der dieser Test
 * bisher lief, traegt damit ueberhaupt keine ZDOs mehr — es gaebe nichts
 * zu speichern und nichts zu laden, und alle Rundlauf-Pruefungen waeren
 * gegen die leere Menge gelaufen und still gruen geblieben.
 *
 * Deshalb schreibt der Test sein EIGENES Weltdokument in das
 * Testverzeichnis: eine kuratierte Graslandinsel um den Nullpunkt. Es
 * liegt bewusst nicht unter server/data/welten — der Rundlauf soll an
 * keinem Dokument haengen, das Mike im Editor veraendert.
 *
 * Run: npx tsx server/test/g2-persistence.ts   (from the repo root)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zstdDecompressSync } from 'node:zlib';
import { GRASLAND_FLORA_NAMEN, TIME_DAY } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { SAVE_FORMAT_VERSION } from '../src/world/WorldManager.js';
import type { SavedPlayer, WorldSaveData } from '../src/world/WorldManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g2-worlds');
const SAVE_FILE = resolve(WORLDS_DIR, 'world.db.zst');
const LAYOUT_FILE = resolve(WORLDS_DIR, 'g2-layout.json');
const SEED = 'KxSYuZquuw';

/**
 * Das Testweltdokument: eine kuratierte Insel um den Nullpunkt.
 *
 * Radius 1600 m, damit Zone (0,0) und ihre Nachbarn vollstaendig
 * innerhalb der Region liegen; `baseLevel` 0.3 hebt sie aus dem Wasser,
 * sonst faellt jede Pflanze durch die `minAltitude`-Pruefung.
 */
function schreibeLayout(): void {
  mkdirSync(WORLDS_DIR, { recursive: true });
  writeFileSync(
    LAYOUT_FILE,
    JSON.stringify({
      version: 1,
      name: 'G2-Rundlauf',
      detailSeed: SEED,
      continents: [],
      regions: [
        {
          id: 'probe',
          biome: 'grassland',
          shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
          edgeFalloff: 200,
          baseLevel: 0.3,
          vegetation: [...GRASLAND_FLORA_NAMEN],
        },
      ],
    })
  );
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

function makeServer(worldSeed: string) {
  return createWovServer({
    port: 2498, // never bound (init() only, no start()) — kept off the live ports anyway
    worldName: 'world',
    worldSeed,
    // Locations aus (worldFeatures=false): Die Feature-Tabelle ist seit
    // Block A ohnehin leer, der Schalter spart nur den leeren Durchlauf.
    worldFeatures: false,
    worldVegetation: true, // real foliage ZDOs for the roundtrip
    worldsDir: WORLDS_DIR,
    // Ohne Layout keine Kuratierung und damit kein Bewuchs — siehe
    // Kopfkommentar.
    worldMode: 'layout',
    worldLayoutPath: LAYOUT_FILE,
  });
}

console.log('=== G1 persistence smoke test ===');
rmSync(WORLDS_DIR, { recursive: true, force: true });
schreibeLayout();

// ── [1] Server A: build a world state and save it ───────────────
console.log('\n[1] Server A: generate, modify, save:');
const serverA = makeServer(SEED);
serverA.init();

// The real generation path for zone (0,0): mark generated + foliage.
// tryGenerateFeature laeuft mit, obwohl nichts gebucht ist — genau so
// ruft der Server es auch, und der Rundlauf soll den Produktionspfad
// nehmen und nicht einen Sonderweg fuer den Test.
const zonesA = serverA.zones as unknown as {
  generateZone(zone: { x: number; y: number }): boolean;
  tryGenerateFeature(zone: { x: number; y: number }): unknown;
};
check('zone (0,0) generated by production path', zonesA.generateZone({ x: 0, y: 0 }) === true);
zonesA.tryGenerateFeature({ x: 0, y: 0 });
check(
  'keine Location gebucht (Feature-Tabelle leer)',
  serverA.zones.getFeatureInstance({ x: 0, y: 0 }) === undefined
);

// World modifications that must survive the restart
(serverA as unknown as { worldTime: number }).worldTime = 12345.5;
const savedViking: SavedPlayer = {
  name: 'TestViking',
  position: { x: 12.5, y: 37.25, z: -8.75 },
  flying: true,
};
(serverA as unknown as { savedPlayers: Map<string, SavedPlayer> }).savedPlayers.set(
  savedViking.name,
  savedViking
);

const persistentOnA = serverA.zdos
  .getAllZDOs()
  .filter((z) => serverA.prefabs.getByHash(z.prefabHash)?.isPersistent() ?? false).length;
check('A: persistent ZDOs present (foliage)', persistentOnA > 0, `${persistentOnA}`);

serverA.saveWorld();
check('save file written', existsSync(SAVE_FILE), SAVE_FILE);

// Envelope shape (C++ .fwl meta + .db sections, JSON+zstd container)
const envelope = JSON.parse(zstdDecompressSync(readFileSync(SAVE_FILE)).toString('utf-8')) as WorldSaveData;
check(`envelope version ${SAVE_FORMAT_VERSION}`, envelope.version === SAVE_FORMAT_VERSION);
check(
  'meta carries world identity (C++ .fwl)',
  envelope.meta.worldName === 'world' &&
    envelope.meta.worldSeed === SEED &&
    envelope.meta.worldGenVersion === 2
);
check('worldTime saved', envelope.worldTime === 12345.5, `${envelope.worldTime}`);
check(
  'generated zones saved',
  envelope.zones.length === 1 && envelope.zones[0][0] === 0 && envelope.zones[0][1] === 0,
  JSON.stringify(envelope.zones)
);
check(
  'player saved with position + fly state',
  envelope.players.length === 1 &&
    envelope.players[0].name === 'TestViking' &&
    envelope.players[0].flying === true &&
    envelope.players[0].position.x === 12.5 &&
    envelope.players[0].position.y === 37.25 &&
    envelope.players[0].position.z === -8.75
);
check(
  'all persistent ZDOs saved',
  envelope.zdos.length === persistentOnA,
  `${envelope.zdos.length}/${persistentOnA}`
);
check(
  'no Player character ZDO in the save (ghost guard)',
  !envelope.zdos.some((z) => z.prefab === serverA.prefabs.getByName('Player')?.hash)
);

serverA.saveWorld(); // second save → backup rotation
check('previous save rotated to .prev (C++ backup)', existsSync(`${SAVE_FILE}.prev`));

// ── [2] Server B: fresh process, same worldsDir → load ──────────
console.log('\n[2] Server B: fresh server loads the save:');
const serverB = makeServer(SEED);
serverB.init();

check('B: worldTime restored', serverB.getWorldTime() === 12345.5, `${serverB.getWorldTime()}`);
check(
  'B: zone (0,0) restored as generated',
  serverB.zones.isZoneGenerated({ x: 0, y: 0 }) && serverB.zones.generatedZoneCount === 1,
  `${serverB.zones.generatedZoneCount} zone(s)`
);
check(
  'B: all persistent ZDOs restored',
  serverB.zdos.totalZDOCount === persistentOnA,
  `${serverB.zdos.totalZDOCount}/${persistentOnA}`
);
const restoredViking = (
  serverB as unknown as { savedPlayers: Map<string, SavedPlayer> }
).savedPlayers.get('TestViking');
check(
  'B: player state restored',
  restoredViking !== undefined &&
    restoredViking.position.x === 12.5 &&
    restoredViking.position.y === 37.25 &&
    restoredViking.position.z === -8.75 &&
    restoredViking.flying === true
);

// A player standing in zone (0,0) must NOT trigger re-generation:
// zone (0,0)'s loaded ZDOs stay untouched (keine doppelte Vegetation).
// G-POP: the generation queue is now sorted nearest-first, so the 200ms
// budget generates the DIRECT NEIGHBORS of (0,0) first — and their foliage
// groupRadius legitimately spills into ZDO-zone (0,0) (C++-faithful, see
// e2-vegetation). Nachbar-Ueberhang bringt NEUE Eintraege an anderen
// Positionen; eine zweite Streuung von (0,0) waere deterministisch und
// legte jeden geladenen Eintrag ein zweites Mal an derselben Stelle ab.
// Geprueft wird deshalb die VIELFACHHEIT: jede geladene Zeile genau so
// oft wie vorher, zusaetzliche Zeilen erlaubt.
const dumpZone = (): string[] =>
  serverB.zdos
    .getZDOsInZone({ x: 0, y: 0 })
    .map(
      (z) =>
        `${z.prefabHash}|${z.position.x.toFixed(3)},${z.position.y.toFixed(3)},${z.position.z.toFixed(3)}`
    )
    .sort();
const zoneZDOsBefore = dumpZone();
check('B: Zone (0,0) traegt geladene ZDOs', zoneZDOsBefore.length > 0, `${zoneZDOsBefore.length}`);
serverB.zones.update([{ x: 0, y: serverB.getGroundHeight(0, 0), z: 0 }], 200);
const zoneZDOsAfter = dumpZone();
const afterCounts = new Map<string, number>();
for (const line of zoneZDOsAfter) afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
const beforeCounts = new Map<string, number>();
for (const line of zoneZDOsBefore) beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
let unveraendert = true;
let abweichung = '';
for (const [line, n] of beforeCounts) {
  const m = afterCounts.get(line) ?? 0;
  if (m !== n) {
    unveraendert = false;
    abweichung = `${line} ${n}→${m}`;
    break;
  }
}
check(
  'B: zones.update does not re-generate the restored zone',
  unveraendert,
  abweichung ||
    `loaded ZDOs ${zoneZDOsBefore.length} unveraendert in ${zoneZDOsAfter.length} (neighbor spill ok)`
);

// ── [3] Seed mismatch → load refused ─────────────────────────────
console.log('\n[3] Seed mismatch:');
const serverC = makeServer('TotallyDifferentSeed');
serverC.init();
check(
  'C: different seed starts fresh',
  serverC.zdos.totalZDOCount === 0 &&
    !serverC.zones.isZoneGenerated({ x: 0, y: 0 }) &&
    serverC.getWorldTime() === TIME_DAY
);

// ── [4] Corrupt save → load refused ──────────────────────────────
console.log('\n[4] Corrupt save file:');
writeFileSync(SAVE_FILE, Buffer.from('this is not a zstd stream'));
const serverD = makeServer(SEED);
serverD.init();
check(
  'D: corrupt save starts fresh',
  serverD.zdos.totalZDOCount === 0 &&
    !serverD.zones.isZoneGenerated({ x: 0, y: 0 }) &&
    serverD.getWorldTime() === TIME_DAY
);

rmSync(WORLDS_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n=== G1: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== G1: ALL PASSED ===');
