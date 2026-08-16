/**
 * G4 smoke test — creature spawning + wander behavior (Phase G2).
 *
 * The SpawnSystem is server-side (the C++ reference has none — in the
 * original architecture the owning Unity client spawns; documented in
 * Bekannte Einschränkungen #26). It runs off the AUTHORED table in
 * shared/spawnData.ts: ring spawns around players with biome/altitude
 * gates, per-player + global caps, wander/flee simulation, 130m despawn,
 * 4 Hz revision-throttled sync, and save-file adoption after restarts.
 *
 * Checks:
 *  1. Zone gate: no generated zone → zero spawns despite many ticks.
 *  2. Ring + biome: first spawns around a Meadows anchor land in the entry
 *     ring (± group scatter) with a matching biome.
 *  3. No water: every spawn sits at/above its minAltitude.
 *  4. Biome gate: deep BlackForest anchor → der BlackForest-Eintrag
 *     spawnt, die beiden Meadows-Eintraege nie (Biom-Masken).
 *  5. Caps: maxPerPlayer and globalMax hold under forced 100% rolls.
 *  6. Despawn: last peer leaves 130m → creatures destroyed (ZDOs gone).
 *  7. Flee: a deer with a peer at 5m gains distance; peer at 100m calms it.
 *  8. Sim guard: peer beyond simRadius (custom radii) → bit-identical pos.
 *  9. Sync throttle: dataRevision advances ~12×/30 ticks active, 0 idle.
 * 10. Determinism: two identical worlds + scripts → identical dumps.
 * 11. Persistence: server A saves spawned creatures; server B adopts them
 *     and despawns the adopted stock correctly.
 * 12. Config gate: worldCreatures:false → no SpawnSystem is constructed.
 *
 * BLOCK A: Geprueft wird die MECHANIK, nicht der Inhalt der
 * Auslieferungstabelle. SPAWN_TABLE ist gegen die Whitelist
 * `EIGENE_MODELLE` gefiltert und damit leer — Deer, Boar und Greydwarf
 * sind Valheim-Modelle. Ein Test, der von dort seine Eintraege zieht,
 * pruefte ab sofort an einer leeren Liste vorbei und waere lautlos gruen.
 * Er faehrt deshalb eine eigene PROBE_TABELLE aus drei Wesen mit eigenem
 * Modell, die die drei Rollen der alten Tabelle 1:1 uebernehmen. Das ist
 * keine Abschwaechung: Ring, Kappen, Flucht, Despawn und Taktdrossel
 * haengen ausschliesslich an den Zahlen des Eintrags, nie am Prefab —
 * und die Zahlen sind die der alten Tabelle. Zusaetzlich muessen die
 * Eintraege jetzt die zweite Verteidigungslinie im SpawnSystem passieren,
 * was der Test damit gleich mitprueft.
 *
 * Run: npx tsx server/test/g4-creatures.ts   (from the repo root)
 */

import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  Biome,
  GeoManager,
  HeightmapProvider,
  XorShiftRandom,
  getStableHash,
  type SpawnEntry,
  type Vector3,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import { SpawnSystem, type SpawnSystemOptions } from '../src/world/SpawnSystem.js';
import { createWovServer } from '../src/WovServer.js';

const SEED_STR = 'KxSYuZquuw';
const SEED = getStableHash(SEED_STR);

/**
 * Drei Probewesen mit eigenem Modell — die Rollen der frueheren
 * Auslieferungstabelle, Zahl fuer Zahl uebernommen:
 *
 *   SCHEU  war Deer       Meadows, flieht, 6.0 m/s Fluchttempo
 *   RUHIG  war Boar       Meadows, bleibt stehen
 *   WALD   war Greydwarf  BlackForest, weiterer Ring
 *
 * Die Namen sagen jetzt, worauf es ankommt: Der Test prueft nicht Rehe,
 * sondern ein fliehendes und ein stehendes Wesen im einen Biom und ein
 * drittes im anderen.
 */
const SCHEU: SpawnEntry = {
  prefab: 'FurlocFischer',
  biomes: Biome.Meadows,
  maxPerPlayer: 4,
  countRadius: 120,
  globalMax: 40,
  spawnIntervalSec: 5,
  spawnChance: 0.4,
  groupSizeMin: 1,
  groupSizeMax: 2,
  groupRadius: 6,
  ringMin: 35,
  ringMax: 80,
  minAltitude: 30.5,
  walkSpeed: 1.5,
  runSpeed: 6.0,
  wanderRadius: 20,
  idleMinSec: 2,
  idleMaxSec: 6,
  flees: true,
  fleeDistance: 10,
  calmDistance: 40,
};
const RUHIG: SpawnEntry = {
  prefab: 'FurlocKind',
  biomes: Biome.Meadows,
  maxPerPlayer: 3,
  countRadius: 120,
  globalMax: 30,
  spawnIntervalSec: 6,
  spawnChance: 0.35,
  groupSizeMin: 1,
  groupSizeMax: 2,
  groupRadius: 5,
  ringMin: 35,
  ringMax: 80,
  minAltitude: 30.5,
  walkSpeed: 1.2,
  runSpeed: 5.0,
  wanderRadius: 15,
  idleMinSec: 3,
  idleMaxSec: 8,
  flees: false,
  fleeDistance: 0,
  calmDistance: 0,
};
const WALD: SpawnEntry = {
  prefab: 'FurlocKrieger',
  biomes: Biome.BlackForest,
  maxPerPlayer: 5,
  countRadius: 130,
  globalMax: 50,
  spawnIntervalSec: 5,
  spawnChance: 0.35,
  groupSizeMin: 1,
  groupSizeMax: 2,
  groupRadius: 8,
  ringMin: 40,
  ringMax: 85,
  minAltitude: 30.5,
  walkSpeed: 1.6,
  runSpeed: 5.5,
  wanderRadius: 25,
  idleMinSec: 2,
  idleMaxSec: 5,
  flees: false,
  fleeDistance: 0,
  calmDistance: 0,
};
const PROBE_TABELLE: readonly SpawnEntry[] = [SCHEU, RUHIG, WALD];

const SCHEU_HASH = getStableHash(SCHEU.prefab);
const RUHIG_HASH = getStableHash(RUHIG.prefab);
const WALD_HASH = getStableHash(WALD.prefab);

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g4-worlds');
const WORLDS_DIR_C = resolve(__dirname, 'tmp-g4-worlds-c');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── Helpers ──────────────────────────────────────────────────────

interface CreatureStateLike {
  zdo: ZDO;
  entry: SpawnEntry;
  home: Vector3;
  mode: string;
}
interface SpawnInternals {
  creatures: Map<string, CreatureStateLike>;
}
const internals = (s: SpawnSystem): SpawnInternals => s as unknown as SpawnInternals;

function buildWorld(rngSeed: number, options: SpawnSystemOptions = {}) {
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  // no features/foliage — zone generation only marks + builds heightmaps,
  // keeping ZDO counts creature-only and the test fast
  const zones = new ZoneManager(geo, heightmaps, zdos, SEED, {
    worldFeatures: false,
    worldVegetation: false,
  });
  const spawns = new SpawnSystem(zdos, geo, heightmaps, zones, {
    rng: new XorShiftRandom(rngSeed),
    ...options,
  });
  return { geo, heightmaps, zdos, zones, spawns };
}

/** Forced-roll variant of the probe table (biome masks unchanged). */
function forcedTable(overrides: Partial<SpawnEntry> = {}): SpawnEntry[] {
  return PROBE_TABELLE.map((e) => ({
    ...e,
    spawnIntervalSec: 0.5,
    spawnChance: 1,
    ...overrides,
  }));
}

function tick(s: SpawnSystem, n: number, pos: Vector3, dt = 0.1): void {
  for (let i = 0; i < n; i++) s.update(dt, [pos]);
}

/** Generate every queued zone around pos (drain until no progress). */
function generateAround(zones: ZoneManager, pos: Vector3): void {
  while (zones.update([pos], 200) > 0) {
    /* drain */
  }
}

/** Tick until a creature appears (bounded); returns whether one spawned. */
function tickUntilSpawn(s: SpawnSystem, pos: Vector3, maxTicks = 2000): boolean {
  for (let i = 0; i < maxTicks; i++) {
    s.update(0.1, [pos]);
    if (s.creatureCount > 0) return true;
  }
  return false;
}

/** Find a point whose `clearance`-neighborhood is uniformly one biome. */
function findDeepBiomePoint(geo: GeoManager, biome: Biome, clearance: number): Vector3 {
  for (let r = 200; r < 8000; r += 50) {
    for (let a = 0; a < Math.PI * 2; a += 0.25) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (geo.getBiome(x, z) !== biome) continue;
      let deep = true;
      for (let b = 0; b < Math.PI * 2; b += Math.PI / 4) {
        if (geo.getBiome(x + Math.cos(b) * clearance, z + Math.sin(b) * clearance) !== biome) {
          deep = false;
          break;
        }
      }
      if (deep) return { x, y: 0, z };
    }
  }
  throw new Error(`no deep ${Biome[biome]} point found`);
}

const dist2d = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

// ── [1] Zone gate ────────────────────────────────────────────────
console.log('== 1. zone gate: no generated zones → no spawns ==');
{
  const w = buildWorld(1, { table: forcedTable() });
  const anchor = { x: 0, y: 0, z: 0 };
  tick(w.spawns, 600, anchor); // 60 sim-seconds of forced 100% rolls
  check('zero spawns without generated zones', w.spawns.creatureCount === 0);
}

// ── [2+3] Ring / biome / altitude of first spawns ────────────────
console.log('== 2+3. spawn ring, biome and altitude around a Meadows anchor ==');
const worldA = buildWorld(43, { table: forcedTable() });
{
  const anchor = { x: 0, y: 0, z: 0 };
  generateAround(worldA.zones, anchor);
  const spawned = tickUntilSpawn(worldA.spawns, anchor);
  check('creatures spawn around Meadows anchor', spawned);
  // Snapshot on the spawn tick: creatures start idle, so positions are
  // still the exact spawn points
  let ringOk = spawned;
  let biomeOk = spawned;
  let altitudeOk = spawned;
  for (const c of internals(worldA.spawns).creatures.values()) {
    const e = c.entry;
    const d = dist2d(c.zdo.position, anchor);
    const slack = Math.SQRT2 * e.groupRadius + 0.01;
    if (d < e.ringMin - slack || d > e.ringMax + slack) ringOk = false;
    if ((worldA.geo.getBiome(c.zdo.position.x, c.zdo.position.z) & e.biomes) === 0) biomeOk = false;
    if (c.zdo.position.y < e.minAltitude) altitudeOk = false;
  }
  const n = worldA.spawns.creatureCount;
  check('2. spawns inside the entry ring (± group scatter)', ringOk, `${n} creature(s)`);
  check('2. spawn biome matches the entry mask', biomeOk);
  check('3. no water spawns (y ≥ minAltitude)', altitudeOk);
}

// ── [4] Biome gate: BlackForest ──────────────────────────────────
console.log('== 4. biome gate: deep BlackForest anchor ==');
{
  const w = buildWorld(7, { table: forcedTable() });
  const bf = findDeepBiomePoint(w.geo, Biome.BlackForest, 130);
  generateAround(w.zones, bf);
  tick(w.spawns, 600, bf); // 60 sim-seconds of forced rolls
  const waldwesen = w.zdos.getZDOByPrefab(WALD_HASH).length;
  const scheu = w.zdos.getZDOByPrefab(SCHEU_HASH).length;
  const ruhig = w.zdos.getZDOByPrefab(RUHIG_HASH).length;
  check('BlackForest-Eintrag spawnt im BlackForest', waldwesen > 0, `${waldwesen}`);
  check('kein SCHEU im BlackForest', scheu === 0);
  check('kein RUHIG im BlackForest', ruhig === 0);
}

// ── [5] Caps ─────────────────────────────────────────────────────
console.log('== 5. per-player and global caps ==');
{
  const perPlayer = buildWorld(11, {
    table: [
      { ...SCHEU, spawnIntervalSec: 0.5, spawnChance: 1, groupSizeMin: 1, groupSizeMax: 1, flees: false, maxPerPlayer: 2, globalMax: 50 },
    ],
  });
  const anchor = { x: 0, y: 0, z: 0 };
  generateAround(perPlayer.zones, anchor);
  tick(perPlayer.spawns, 600, anchor);
  check(
    'maxPerPlayer holds under forced rolls',
    perPlayer.spawns.creatureCount === 2,
    `${perPlayer.spawns.creatureCount}/2`
  );

  const global = buildWorld(12, {
    table: [
      { ...SCHEU, spawnIntervalSec: 0.5, spawnChance: 1, groupSizeMin: 1, groupSizeMax: 1, flees: false, maxPerPlayer: 50, globalMax: 1 },
    ],
  });
  generateAround(global.zones, anchor);
  tick(global.spawns, 600, anchor);
  check('globalMax holds under forced rolls', global.spawns.creatureCount === 1, `${global.spawns.creatureCount}/1`);

  // ── [6] Despawn ────────────────────────────────────────────────
  console.log('== 6. despawn when the last peer leaves ==');
  const far = { x: 500, y: 0, z: 500 };
  perPlayer.spawns.update(0.1, [far]);
  check('all creatures despawn beyond 130m', perPlayer.spawns.creatureCount === 0);
  check(
    'creature ZDOs destroyed',
    perPlayer.zdos.getZDOByPrefab(SCHEU_HASH).length === 0,
    `${perPlayer.zdos.totalZDOCount} ZDOs left`
  );
}

// ── [7] Flee / calm ──────────────────────────────────────────────
console.log('== 7. fliehendes Wesen weicht einem nahen Spieler aus, beruhigt sich fern ==');
{
  const w = buildWorld(21, {
    table: [
      { ...SCHEU, spawnIntervalSec: 0.5, spawnChance: 1, groupSizeMin: 1, groupSizeMax: 1 },
    ],
  });
  const anchor = { x: 0, y: 0, z: 0 };
  generateAround(w.zones, anchor);
  tickUntilSpawn(w.spawns, anchor);
  const c0 = [...internals(w.spawns).creatures.values()][0];
  const near = { x: c0.zdo.position.x + 5, y: 0, z: c0.zdo.position.z };
  const d0 = dist2d(c0.zdo.position, near);
  tick(w.spawns, 30, near); // 3s flee at 6 m/s (minus deflection)
  const d1 = dist2d(c0.zdo.position, near);
  check('SCHEU gains distance from a close peer', d1 > d0 + 4, `${d0.toFixed(1)}m → ${d1.toFixed(1)}m`);

  const away = { x: c0.zdo.position.x + 100, y: 0, z: c0.zdo.position.z };
  w.spawns.update(0.1, [away]);
  check('SCHEU calms when the peer is beyond calmDistance', c0.mode !== 'flee', `mode=${c0.mode}`);
}

// ── [8+9] Sim guard + sync throttle ──────────────────────────────
console.log('== 8+9. sim guard and 4 Hz revision throttle ==');
{
  const w = buildWorld(31, {
    table: [
      { ...SCHEU, spawnIntervalSec: 0.5, spawnChance: 1, groupSizeMin: 1, groupSizeMax: 1, flees: false },
    ],
    despawnRadius: 500,
    simRadius: 100,
  });
  const anchor = { x: 0, y: 0, z: 0 };
  generateAround(w.zones, anchor);
  tickUntilSpawn(w.spawns, anchor);
  const c0 = [...internals(w.spawns).creatures.values()][0];

  // peer beyond simRadius (100) but inside despawnRadius (500):
  // das Wesen ist ≤88.5m vom Anker, 200m weg sind also immer ≥111.5m
  const far = { x: 200, y: 0, z: 0 };
  const p0 = { ...c0.zdo.position };
  const r0 = c0.zdo.revision.dataRevision;
  tick(w.spawns, 30, far);
  const moved =
    c0.zdo.position.x !== p0.x || c0.zdo.position.y !== p0.y || c0.zdo.position.z !== p0.z;
  check('8. position bit-identical beyond simRadius', !moved);
  w.spawns.update(0.1, []); // no peers at all: same rest path
  check(
    '8. position still bit-identical with zero peers',
    c0.zdo.position.x === p0.x && c0.zdo.position.y === p0.y && c0.zdo.position.z === p0.z
  );
  check('9. no revisions while resting', c0.zdo.revision.dataRevision === r0);

  // peer back inside simRadius → ~12 revises over 30 ticks (3s / 0.25s)
  const nearC = { x: c0.zdo.position.x + 50, y: 0, z: c0.zdo.position.z };
  tick(w.spawns, 30, nearC);
  const delta = c0.zdo.revision.dataRevision - r0;
  check('9. ~4 Hz revisions while simulating', delta >= 9 && delta <= 14, `Δ=${delta}/30 ticks`);
}

// ── [10] Determinism ─────────────────────────────────────────────
console.log('== 10. determinism: same seed + script → same world ==');
{
  const runScript = (rngSeed: number): string => {
    // Ungezwungene Wuerfe aus der Probetabelle — NICHT aus der leeren
    // Auslieferungstabelle: Zwei leere Abzuege waeren gleich und der Test
    // damit lautlos gruen, ohne je einen Wurf verglichen zu haben.
    const w = buildWorld(rngSeed, { table: [...PROBE_TABELLE] });
    const anchor = { x: 0, y: 0, z: 0 };
    generateAround(w.zones, anchor);
    tick(w.spawns, 400, anchor);
    const lines: string[] = [];
    for (const c of internals(w.spawns).creatures.values()) {
      lines.push(
        `${c.entry.prefab}|${c.zdo.position.x}|${c.zdo.position.y}|${c.zdo.position.z}|${c.zdo.revision.dataRevision}|${c.mode}`
      );
    }
    return lines.sort().join('\n');
  };
  const a = runScript(42);
  const b = runScript(42);
  const gezaehlt = a.split('\n').filter(Boolean).length;
  check('Abzug ist nicht leer (sonst vergleicht der Test nichts)', gezaehlt > 0, `${gezaehlt}`);
  check('identical creature dumps', a === b, `${gezaehlt} creatures`);
}

// ── [11] Persistence adoption ────────────────────────────────────
console.log('== 11. persistence: spawned creatures survive a restart ==');
rmSync(WORLDS_DIR, { recursive: true, force: true });
{
  const makeServer = () =>
    createWovServer({
      port: 2499, // never bound (init only, no start)
      worldName: 'world',
      worldSeed: SEED_STR,
      worldFeatures: false,
      worldVegetation: false,
      worldsDir: WORLDS_DIR,
    });

  /**
   * Tabelle im laufenden System austauschen.
   *
   * Die Auslieferungstabelle ist leer (kein Kreaturmodell ist eigener
   * Bau), der vom Server gebaute SpawnSystem wuerfelt also nichts, was
   * gespeichert werden koennte. Geprueft wird hier aber der RUNDLAUF —
   * spawnen, speichern, neu starten, wiederfinden —, und der haengt nicht
   * daran, welche Arten in der Tabelle stehen. Dieselbe Sonde wie beim
   * Zufallsgenerator eine Zeile weiter unten, nur zwei Felder statt
   * einem: `spawnAccums` traegt einen Zaehler je Tabellenzeile und muss
   * zur neuen Laenge passen.
   */
  const setzeTabelle = (sys: SpawnSystem, tabelle: readonly SpawnEntry[]): void => {
    const innen = sys as unknown as {
      table: readonly SpawnEntry[];
      spawnAccums: number[];
    };
    innen.table = tabelle;
    innen.spawnAccums = tabelle.map(() => 0);
  };

  const serverA = makeServer();
  serverA.init();
  check('default config constructs the SpawnSystem', serverA.spawns !== null);
  // deterministic spawn rolls on the server-built system
  (serverA.spawns as unknown as { rng: XorShiftRandom }).rng = new XorShiftRandom(42);
  setzeTabelle(serverA.spawns!, forcedTable());
  const anchor = { x: 0, y: 0, z: 0 };
  generateAround(serverA.zones, anchor);
  let spawnedA = 0;
  for (let i = 0; i < 3000 && serverA.spawns!.creatureCount < 2; i++) {
    serverA.spawns!.update(0.1, [anchor]);
  }
  spawnedA = serverA.spawns!.creatureCount;
  check('A: creatures spawned before save', spawnedA >= 2, `${spawnedA}`);
  serverA.saveWorld();

  const serverB = makeServer();
  serverB.init();
  // init() ruft adoptPersisted mit der AUSLIEFERUNGSTABELLE — die ist
  // leer, also darf nichts adoptiert worden sein. Das ist die neue
  // Wirklichkeit und wird hier ausdruecklich festgehalten, statt sie
  // unter der Sonde verschwinden zu lassen.
  check(
    'B: leere Auslieferungstabelle adoptiert nichts',
    serverB.spawns !== null && serverB.spawns.creatureCount === 0,
    `${serverB.spawns?.creatureCount}`
  );
  setzeTabelle(serverB.spawns!, forcedTable());
  serverB.spawns!.adoptPersisted();
  check(
    'B: persisted creatures adopted after restart',
    serverB.spawns!.creatureCount === spawnedA,
    `${serverB.spawns?.creatureCount}/${spawnedA}`
  );
  serverB.spawns!.update(0.1, [{ x: 5000, y: 0, z: 5000 }]);
  check('B: adopted creatures despawn when far', serverB.spawns!.creatureCount === 0);
}
rmSync(WORLDS_DIR, { recursive: true, force: true });

// ── [12] Config gate ─────────────────────────────────────────────
console.log('== 12. config gate: worldCreatures:false disables the system ==');
rmSync(WORLDS_DIR_C, { recursive: true, force: true });
{
  const serverC = createWovServer({
    port: 2500,
    worldName: 'world',
    worldSeed: SEED_STR,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    worldsDir: WORLDS_DIR_C,
  });
  serverC.init();
  check('no SpawnSystem when disabled', serverC.spawns === null);
}
rmSync(WORLDS_DIR_C, { recursive: true, force: true });

console.log(failures === 0 ? '\n=== G4: ALL PASSED ===' : `\n=== G4: ${failures} FAILURES ===`);
process.exit(failures === 0 ? 0 : 1);
