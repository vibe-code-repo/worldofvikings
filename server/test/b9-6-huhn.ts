/**
 * B9.6 — the hen is in the game: it spawns in the meadows, walks with its
 * own clips, never attacks (aggro: false, like the cow), can be hit and
 * killed with one flint-axe strike, and drops loot.
 *
 * Same three levels as B9.2 (server/test/b9-kreaturen-spiel.ts), scoped to
 * one peaceful animal:
 *
 *  [1] Tables: the shipped SPAWN_TABLE, the prefab registry, MAX_LEBEN and
 *      the manifest agree about the hen (size, flags, clips, life). The
 *      registry size is checked against the B9.6 IDLE-pose measurement
 *      (0.255 x 0.325 m), NOT assets/manifest.json's bind pose (0.381 m
 *      wide — wings spread for rigging, folded in the idle pose).
 *  [2] The spawn system with the SHIPPED numbers (only interval and chance
 *      are forced, so the test does not wait): the hen spawns in the
 *      meadows, starts `idle` with 10 HP, the `anim` member follows the
 *      movement (`walk` exactly while it moves), and it never strikes.
 *  [3] The REAL packet path: a WebSocket client on a running server hits a
 *      hen with fist, sword and flint axe; it dies after the counted
 *      number of hits (one with the axe — "ein Schlag mit der Steinaxt
 *      genügt", per the card) and the loot lands in the inventory.
 *
 * Every claim carries the number that proves it. Ports are ephemeral
 * (`portVon`, scripts/testport.mjs).
 *
 * Run: npx tsx server/test/b9-6-huhn.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { readFileSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  ANIM_MEMBER,
  Biome,
  GeoManager,
  HEALTH_MEMBER,
  HeightmapProvider,
  PrefabFlag,
  SPAWN_TABLE,
  XorShiftRandom,
  findPrefabByName,
  getStableHash,
  istEigenesModell,
  maxLeben,
  type SpawnEntry,
  type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { SpawnSystem } from '../src/world/SpawnSystem.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-b9-6-huhn');
rmSync(WORLDS_DIR, { recursive: true, force: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const f = (n: number, k = 2): string => n.toFixed(k);
const dist2d = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

const HUHN_HASH = getStableHash('Huhn');
const eintrag = (name: string): SpawnEntry | undefined => SPAWN_TABLE.find((e) => e.prefab === name);

// ── [1] Tables ───────────────────────────────────────────────────
console.log('\n[1] Tables: spawn table, registry, life, manifest');
{
  const huhn = eintrag('Huhn');
  check('SPAWN_TABLE (as shipped) lists the hen', huhn !== undefined, `${SPAWN_TABLE.length} entries: ${SPAWN_TABLE.map((e) => e.prefab).join(', ')}`);
  check('the hen is on the whitelist', istEigenesModell('Huhn'));
  check('hen never attacks (aggro: false), never flees', huhn?.aggro === false && huhn.flees === false);
  check('hen lives in the meadows', huhn?.biomes === Biome.Meadows);

  const d = findPrefabByName('Huhn');
  check('the player can hit it (ANIMAL_AI)', ((d?.flags ?? 0n) & PrefabFlag.ANIMAL_AI) !== 0n);
  check('it persists (PERSISTENT) and moves by itself (SYNCED_TRANSFORM)', d !== undefined && (d.flags & PrefabFlag.PERSISTENT) !== 0n && (d.flags & PrefabFlag.SYNCED_TRANSFORM) !== 0n);
  check('model is Huhn, first state idle', d?.model === 'Huhn' && d.animation === 'idle');
  // The size is the IDLE pose of B9.6 (deformed mesh), not the manifest (bind
  // pose — wings spread, width 0.381 m instead of the folded 0.168 m).
  check('renderScale = B9.6 idle pose 0.255 x 0.325 (length x height, NOT the manifest bind pose)', d?.renderScale.w === 0.255 && d.renderScale.h === 0.325, JSON.stringify(d?.renderScale));
  check('localScale 1 (the file is in metres, no resize)', d?.localScale.y === 1);

  check('life: hen 10 — below the child (15), the previous smallest entry', maxLeben('Huhn') === 10, `${maxLeben('Huhn')}`);

  // The clips the spawn table promises exist in the shipped model (manifest is tracked in git).
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../assets/manifest.json'), 'utf8')) as {
    modelle: Record<string, { animationen?: { name: string }[]; skins?: number; breite?: number; hoehe?: number; tiefe?: number }>;
  };
  const imModell = (manifest.modelle['Huhn']?.animationen ?? []).map((a) => a.name).sort();
  const soll = [...(huhn?.clips ?? [])].sort();
  check('every listed clip is in the model, none unused', JSON.stringify(imModell) === JSON.stringify(soll), `model ${imModell.join(',')} / entry ${soll.join(',')}`);
  // The client finds the group by substring (`includes`, first hit): no state name
  // may be part of another clip's name, or the wrong clip plays.
  const mehrdeutig = soll.filter((z) => imModell.filter((g) => g.toLowerCase().includes(z)).length !== 1);
  check('each state name matches exactly one clip (substring search of the client)', mehrdeutig.length === 0, mehrdeutig.join(',') || 'unique');
  check('skinned model', (manifest.modelle['Huhn']?.skins ?? 0) === 1);
  check(
    'manifest hoehe/tiefe (idle-like axes) agree with prefabs.ts within 1 cm; breite is the BIND pose and deliberately not used',
    Math.abs((manifest.modelle['Huhn']?.hoehe ?? 0) - 0.325) < 0.01 && Math.abs((manifest.modelle['Huhn']?.tiefe ?? 0) - 0.255) < 0.01,
    `hoehe ${manifest.modelle['Huhn']?.hoehe}, tiefe ${manifest.modelle['Huhn']?.tiefe}, breite(bind) ${manifest.modelle['Huhn']?.breite}`
  );
  check('walk clip speed declared (client couples playback rate to ground speed)', (d?.animationTempo?.walk ?? 0) > 0);
}

// ── [2] Spawn system with the shipped numbers ────────────────────
console.log('\n[2] Spawn system with the shipped numbers (interval and chance forced)');
const SEED = getStableHash('B96huhnSeed');
function buildWorld(rngSeed: number, table: readonly SpawnEntry[]) {
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zones = new ZoneManager(geo, heightmaps, zdos, SEED, { worldFeatures: false, worldVegetation: false });
  const spawns = new SpawnSystem(zdos, geo, heightmaps, zones, { rng: new XorShiftRandom(rngSeed), table });
  return { geo, heightmaps, zdos, zones, spawns };
}
function generateAround(zones: ZoneManager, pos: Vector3): void {
  while (zones.update([pos], 200) > 0) {
    /* drain */
  }
}
/**
 * A point in `biome` from which the spawn ring (15-40 m for the hen) is
 * almost all the same biome and above the waterline — so the forced spawn
 * rolls do not mostly fail on a shore. Deterministic: first hit on a
 * growing ring.
 */
function findeAnker(
  geo: { getBiome(x: number, z: number): Biome },
  hm: { getGroundHeight(x: number, z: number): number },
  biome: Biome,
  ringe: readonly number[]
): Vector3 {
  for (let r = 100; r < 8000; r += 50) {
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (geo.getBiome(x, z) !== biome) continue;
      let n = 0;
      let gut = 0;
      for (const rr of ringe) {
        for (let b = 0; b < Math.PI * 2; b += Math.PI / 8) {
          n++;
          const px = x + Math.cos(b) * rr;
          const pz = z + Math.sin(b) * rr;
          if ((geo.getBiome(px, pz) & biome) !== 0 && hm.getGroundHeight(px, pz) >= 30.5) gut++;
        }
      }
      if (gut / n >= 0.95) return { x, y: 0, z };
    }
  }
  throw new Error(`no suitable ${Biome[biome]} anchor found`);
}
const gezwungen = (): SpawnEntry[] => SPAWN_TABLE.map((e) => ({ ...e, spawnIntervalSec: 0.5, spawnChance: 1 }));

let wiese: Vector3;
{
  const w = buildWorld(5, gezwungen());
  wiese = findeAnker(w.geo, w.heightmaps, Biome.Meadows, [15, 25, 35, 40]);
  console.log(`      meadows anchor (${f(wiese.x, 0)}, ${f(wiese.z, 0)})`);
}

console.log('\n[2a] Spawning: the hen in the meadows');
{
  const m = buildWorld(21, gezwungen());
  generateAround(m.zones, wiese);
  for (let i = 0; i < 600; i++) m.spawns.update(0.1, [wiese]);
  const huehner = m.zdos.getZDOByPrefab(HUHN_HASH);
  check('meadows: hens spawn', huehner.length > 0, `${huehner.length}`);
  check('hen cap holds (maxPerPlayer 5 within 60 m, a group of 4 may overshoot by 3)', huehner.length <= 5 + 3, `${huehner.length}`);
  check('hens start with 10 HP', huehner.length > 0 && huehner.every((z) => z.getInt(HEALTH_MEMBER) === 10), huehner.map((z) => z.getInt(HEALTH_MEMBER)).join(','));
  const ersteAnim = huehner.map((z) => z.getString(ANIM_MEMBER));
  check('hens are written `idle` at spawn or already `walk` (never empty)', ersteAnim.every((a) => a === 'idle' || a === 'walk'), ersteAnim.join(','));
  check('no water spawns (y >= minAltitude 30.5)', huehner.every((z) => z.position.y >= 30.5));
}

/**
 * One hen next to a fixed peer, everything else quiet: a table with the
 * shipped numbers of the hen's entry, the ring squeezed to `ring` metres
 * and group size 1. Returns the world and the creature.
 */
function einzelnes(peer: Vector3, ring: number, ueberschreibe: Partial<SpawnEntry> = {}) {
  const basis = eintrag('Huhn')!;
  const tabelle: SpawnEntry[] = [
    { ...basis, spawnIntervalSec: 0.5, spawnChance: 1, ringMin: ring, ringMax: ring + 0.5, groupSizeMin: 1, groupSizeMax: 1, maxPerPlayer: 1, globalMax: 1, ...ueberschreibe },
  ];
  const w = buildWorld(31, tabelle);
  generateAround(w.zones, peer);
  let zdo: ZDO | undefined;
  for (let i = 0; i < 400 && !zdo; i++) {
    w.spawns.update(0.1, [peer]);
    zdo = w.zdos.getZDOByPrefab(HUHN_HASH)[0];
  }
  if (!zdo) throw new Error('Huhn did not spawn');
  return { ...w, zdo };
}

console.log("\n[2b] The `anim` member follows the movement; the hen walks at its walk speed");
{
  const peer = { ...wiese };
  const { spawns, zdo } = einzelnes(peer, 20);
  const walk = eintrag('Huhn')!.walkSpeed;
  let letzte = { ...zdo.position };
  let walkTicks = 0;
  let idleTicks = 0;
  let bewegtOhneWalk = 0;
  let walkOhneBewegung = 0;
  const geschw: number[] = [];
  const zustaende = new Set<string>();
  for (let i = 0; i < 3000; i++) {
    spawns.update(0.1, [peer]);
    const a = zdo.getString(ANIM_MEMBER);
    zustaende.add(a);
    const d = dist2d(zdo.position, letzte);
    if (d > 1e-9) {
      if (a !== 'walk') bewegtOhneWalk++;
      geschw.push(d / 0.1);
    } else if (a === 'walk') {
      walkOhneBewegung++;
    }
    if (a === 'walk') walkTicks++;
    if (a === 'idle') idleTicks++;
    letzte = { ...zdo.position };
  }
  const mittel = geschw.reduce((s, g) => s + g, 0) / Math.max(1, geschw.length);
  console.log(`      300 s simulated: ${walkTicks} walk ticks, ${idleTicks} idle ticks, states seen: ${[...zustaende].join(',')}`);
  check('the hen both stands and walks', walkTicks > 100 && idleTicks > 100, `walk ${walkTicks}, idle ${idleTicks}`);
  check('only idle and walk ever appear (no run, no attack)', [...zustaende].every((z) => z === 'idle' || z === 'walk'), [...zustaende].join(','));
  check('it moves ONLY while `anim` says walk', bewegtOhneWalk === 0, `${bewegtOhneWalk} moving ticks without walk`);
  check('`anim` says walk only while it moves (allowing the turn-around tick)', walkOhneBewegung <= 30, `${walkOhneBewegung} of ${walkTicks} walk ticks without movement`);
  check(`ground speed while walking = walkSpeed ${walk} m/s (mean of ${geschw.length} steps)`, Math.abs(mittel - walk) < 0.05, `${f(mittel, 3)} m/s`);
}

console.log('\n[2c] The hen never attacks (peer one metre away, 60 s)');
{
  const peer = { ...wiese };
  const huhn = einzelnes(peer, 1, { wanderRadius: 0, idleMinSec: 999, idleMaxSec: 999 });
  const abstand0 = dist2d(huhn.zdo.position, peer);
  let schlaege = 0;
  huhn.spawns.onCreatureAttack = () => {
    schlaege++;
  };
  let minAbstand = abstand0;
  for (let i = 0; i < 600; i++) {
    huhn.spawns.update(0.1, [peer]);
    minAbstand = Math.min(minAbstand, dist2d(huhn.zdo.position, peer));
  }
  check('hen: stands 1 m from the peer for 60 s (closest ' + f(minAbstand) + ' m, inside the 2.4 m strike radius)', minAbstand <= 2.4, `start ${f(abstand0)} m`);
  check('hen: 0 strikes in 60 s (a hostile creature would strike ~30 times)', schlaege === 0, `${schlaege} strikes`);
  check('hen: HP untouched (10)', huhn.zdo.getInt(HEALTH_MEMBER) === 10);
}

// ── [3] The real packet path ─────────────────────────────────────
console.log('\n[3] Real packet path: hit, kill, loot (WebSocket client on a running server)');

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerInput: 40,
  InteractResult: 45,
  Attack: 46,
  AdminCommand: 53,
  AuthChallenge: 68,
};
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function verbinde(port: number, name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`handshake timeout for "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const w = new Writer();
        w.writeString(antwortBerechnen(nonce, ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(ws);
      }
    });
    ws.on('error', reject);
  });
}
function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}
let eingabeSeq = 0;
function sendInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(++eingabeSeq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}
function sendAttack(ws: WebSocket, pos: Vector3, waffe: string, yaw: number): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}
async function blicke(ws: WebSocket, yaw: number, dauerMs = 300): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) {
    sendInput(ws, yaw);
    await warte(50);
  }
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'b9-6-huhn',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    // The spawn system must run, but the hen never strikes: no need to
    // spend the packet path on that (2c above already covers it).
    worldCreatures: true,
    worldFeatures: false,
    worldVegetation: false,
  });
  server.start();
  const PORT = portVon(server);

  try {
    const ws = await verbinde(PORT, 'Jaeger');
    const meldungen: string[] = [];
    ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) !== P.InteractResult) return;
      const reader = new Reader(Buffer.from(data.subarray(1)));
      reader.readBool();
      meldungen.push(reader.readString());
    });
    const peer = server.net.getPeers().find((p) => p.name === 'Jaeger');
    if (!peer) throw new Error('peer not found');
    const spawns = server.spawns;
    if (!spawns) throw new Error('worldCreatures: true, but no spawn system');

    const geoAnker = findeAnker(server.geo, server.heightmaps, Biome.Meadows, [15, 25, 35, 40]);

    async function neuerPlatz(p: Vector3): Promise<Vector3> {
      sendAdmin(ws, `teleport ${Math.round(p.x)} ${Math.round(p.z)}`);
      await warte(300);
      const pp = peer!.position;
      if (Math.hypot(pp.x - Math.round(p.x), pp.z - Math.round(p.z)) > 1) throw new Error('teleport did not take effect');
      peer!.health = 100;
      peer!.stamina = 100;
      peer!.paradeBis = 0;
      meldungen.length = 0;
      return { ...peer!.position };
    }
    /** Place a hen like the layout does and hand it to the spawn system. */
    function setze(pos: Vector3): ZDO {
      const y = server.heightmaps.getGroundHeight(pos.x, pos.z);
      const zdo = server.zdos.createZDO(HUHN_HASH, { x: pos.x, y, z: pos.z });
      zdo.setInt(HEALTH_MEMBER, maxLeben('Huhn'));
      spawns!.adoptPersisted();
      return zdo;
    }
    const vorn = (von: Vector3, abstand: number): Vector3 => ({ x: von.x, y: von.y, z: von.z - abstand });
    const beute = (): number => peer!.inventar.countOf('RawMeat');

    /** Hit with `waffe` until the hen is gone; returns the hits, the HP after each and the loot. */
    async function erschlage(zdo: ZDO, mitte: Vector3, waffe: string): Promise<{ schlaege: number; hpReihe: number[]; fleisch: number; meldung: string }> {
      const fleischVorher = beute();
      const hpReihe: number[] = [zdo.getInt(HEALTH_MEMBER)];
      let schlaege = 0;
      while (!zdo.destroyed && schlaege < 12) {
        peer!.stamina = 100;
        // The hen wanders between hits: put it back in front of the player before every hit.
        server.zdos.updateZDOZone(zdo, { ...vorn(mitte, 2), y: zdo.position.y });
        await blicke(ws, 0, 100);
        sendAttack(ws, mitte, waffe, 0);
        schlaege++;
        await warte(420);
        hpReihe.push(zdo.destroyed ? 0 : zdo.getInt(HEALTH_MEMBER));
      }
      await warte(150);
      return { schlaege, hpReihe, fleisch: beute() - fleischVorher, meldung: meldungen.filter((m) => m.includes('besiegt')).slice(-1)[0] ?? '' };
    }

    // [3a] Hen next to the player: no damage to the player.
    console.log('\n[3a] Hen next to the player: no damage (real server tick)');
    let mitte = await neuerPlatz(geoAnker);
    const ruhehuhn = setze(vorn(mitte, 1.2));
    const hp0 = peer.health;
    let naheMs = 0;
    const ende = performance.now() + 15_000;
    let letzt = performance.now();
    const animGesehen = new Set<string>();
    while (performance.now() < ende) {
      if (dist2d(ruhehuhn.position, mitte) > 1.8) server.zdos.updateZDOZone(ruhehuhn, { ...vorn(mitte, 1.2), y: ruhehuhn.position.y });
      if (dist2d(ruhehuhn.position, mitte) <= 2.4) naheMs += performance.now() - letzt;
      animGesehen.add(ruhehuhn.getString(ANIM_MEMBER));
      letzt = performance.now();
      await warte(50);
    }
    check(
      `hen within the 2.4 m strike radius for ${f(naheMs / 1000, 1)} s of 15 s: player HP ${hp0} -> ${peer.health}`,
      naheMs > 12_000 && peer.health === hp0 && ruhehuhn.getInt(HEALTH_MEMBER) === 10,
      `HP ${peer.health}`
    );
    check('hen: anim member only idle/walk on the real server', [...animGesehen].every((a) => a === 'idle' || a === 'walk'), [...animGesehen].join(','));
    server.zdos.destroyZDO(ruhehuhn.zdoid);

    // [3b] Hen: hits to kill and loot, per weapon.
    console.log('\n[3b] Hen: hits to kill and loot');
    for (const [waffe, schaden] of [['AxeFlint', 15], ['SwordNorth', 12], ['', 4]] as const) {
      mitte = await neuerPlatz(geoAnker);
      const huhn = setze(vorn(mitte, 2));
      const r = await erschlage(huhn, mitte, waffe);
      const soll = Math.ceil(10 / schaden);
      check(`hen, ${waffe === '' ? 'fist' : waffe} (${schaden}): dead after ${soll} hit(s)`, r.schlaege === soll && huhn.destroyed, `hits ${r.schlaege}, HP ${r.hpReihe.join(' -> ')}`);
      check(`hen, ${waffe === '' ? 'fist' : waffe}: loot exactly 1 RawMeat in the inventory and in the message`, r.fleisch === 1 && r.meldung === `Huhn besiegt — 1× RawMeat`, `${r.fleisch}× / "${r.meldung}"`);
    }
    check('flint axe (15 damage >= 10 HP): one hit suffices, per the card', Math.ceil(10 / 15) === 1);
    ws.close();
  } finally {
    server.stop();
  }
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
