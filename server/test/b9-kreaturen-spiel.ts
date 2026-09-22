/**
 * B9.2 — cow and wolf are in the game: they spawn, move with their clips,
 * can be hit and killed, and drop loot. The cow never attacks.
 *
 * Two levels, on purpose:
 *
 *  [1] Tables: the shipped SPAWN_TABLE, the prefab registry, MAX_LEBEN and the
 *      manifest agree about cow and wolf (size, flags, clips, life).
 *  [2] The spawn system with the SHIPPED numbers (only interval and chance are
 *      forced, so the test does not wait): the cow spawns in the meadows and
 *      the wolf in the black forest, both start `idle` with 30 HP, the `anim`
 *      member follows the movement (`walk` exactly while the animal moves),
 *      the wolf chases as `run` at its run speed and strikes as `attack`, and
 *      a cow one metre from the player does no damage while the wolf does.
 *  [3] The REAL packet path: a WebSocket client on a running server hits a cow
 *      and a wolf with fist, sword and axe, they die after the counted number
 *      of hits, and the loot lands in the inventory.
 *
 * Every claim carries the number that proves it. Ports are ephemeral
 * (`portVon`, scripts/testport.mjs).
 *
 * Run: npx tsx server/test/b9-kreaturen-spiel.ts   (from the repo root)
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
  findItem,
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
const WORLDS_DIR = resolve(__dirname, 'tmp-b9-kreaturen-spiel');
rmSync(WORLDS_DIR, { recursive: true, force: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const f = (n: number, k = 2): string => n.toFixed(k);
const dist2d = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

const KUH_HASH = getStableHash('Kuh');
const WOLF_HASH = getStableHash('Wolf');
const eintrag = (name: string): SpawnEntry | undefined => SPAWN_TABLE.find((e) => e.prefab === name);

// ── [1] Tables ───────────────────────────────────────────────────
console.log('\n[1] Tables: spawn table, registry, life, manifest');
{
  const kuh = eintrag('Kuh');
  const wolf = eintrag('Wolf');
  check('SPAWN_TABLE (as shipped) lists the cow', kuh !== undefined, `${SPAWN_TABLE.length} entries: ${SPAWN_TABLE.map((e) => e.prefab).join(', ')}`);
  check('SPAWN_TABLE (as shipped) lists the wolf', wolf !== undefined);
  check('cow and wolf are on the whitelist', istEigenesModell('Kuh') && istEigenesModell('Wolf'));
  check('cow never attacks (aggro: false), never flees', kuh?.aggro === false && kuh.flees === false);
  check('wolf attacks (aggro not switched off), does not flee', wolf !== undefined && wolf.aggro !== false && wolf.flees === false);
  check('cow lives in the meadows, wolf in the black forest', kuh?.biomes === Biome.Meadows && wolf?.biomes === Biome.BlackForest);

  const dKuh = findPrefabByName('Kuh');
  const dWolf = findPrefabByName('Wolf');
  const treffbar = PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI;
  check('cow: the player can hit it (ANIMAL_AI)', ((dKuh?.flags ?? 0n) & PrefabFlag.ANIMAL_AI) !== 0n);
  check('wolf: the player can hit it (MONSTER_AI)', ((dWolf?.flags ?? 0n) & PrefabFlag.MONSTER_AI) !== 0n);
  check(
    'both are creatures for handleAttack (ANIMAL_AI or MONSTER_AI) and persist (PERSISTENT)',
    [dKuh, dWolf].every((d) => d !== undefined && (d.flags & treffbar) !== 0n && (d.flags & PrefabFlag.PERSISTENT) !== 0n)
  );
  check('both move by themselves (SYNCED_TRANSFORM), so the client takes the dynamic path', [dKuh, dWolf].every((d) => ((d?.flags ?? 0n) & PrefabFlag.SYNCED_TRANSFORM) !== 0n));
  check('models are Kuh / Wolf, first state idle', dKuh?.model === 'Kuh' && dWolf?.model === 'Wolf' && dKuh.animation === 'idle' && dWolf.animation === 'idle');
  // The sizes are the IDLE pose of B9.0 (deformed mesh), not the manifest (bind pose).
  check('cow renderScale = B9.0 idle pose 2.897 x 1.530', dKuh?.renderScale.w === 2.897 && dKuh.renderScale.h === 1.53, JSON.stringify(dKuh?.renderScale));
  check('wolf renderScale = B9.0 idle pose 1.230 x 1.019', dWolf?.renderScale.w === 1.23 && dWolf.renderScale.h === 1.019, JSON.stringify(dWolf?.renderScale));
  check('localScale 1 (the files are in metres, the wolf is shrunk inside the file)', dKuh?.localScale.y === 1 && dWolf?.localScale.y === 1);

  check('life: cow 30 (boar), wolf 30 (greydwarf) — not the default 20', maxLeben('Kuh') === 30 && maxLeben('Wolf') === 30, `${maxLeben('Kuh')} / ${maxLeben('Wolf')}`);

  // The clips the spawn table promises exist in the shipped model (manifest is tracked in git).
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../assets/manifest.json'), 'utf8')) as {
    modelle: Record<string, { animationen?: { name: string }[]; skins?: number }>;
  };
  for (const [name, e] of [['Kuh', kuh], ['Wolf', wolf]] as const) {
    const imModell = (manifest.modelle[name]?.animationen ?? []).map((a) => a.name).sort();
    const soll = [...(e?.clips ?? [])].sort();
    // The wolf's `die` clip is in the file but deliberately NOT listed: it sinks
    // 7.9 cm below the ground (B9.0) and a dying creature is destroyed at once.
    const ungenutzt = imModell.filter((c) => !soll.includes(c as never));
    check(
      `${name}: every listed clip is in the model; the only unused one is the wolf's die`,
      soll.every((c) => imModell.includes(c)) && JSON.stringify(ungenutzt) === JSON.stringify(name === 'Wolf' ? ['die'] : []),
      `model ${imModell.join(',')} / entry ${soll.join(',')}`
    );
    // The client finds the group by substring (`includes`, first hit): no state name
    // may be part of another clip's name, or the wrong clip plays.
    const mehrdeutig = soll.filter((z) => imModell.filter((g) => g.toLowerCase().includes(z)).length !== 1);
    check(`${name}: each state name matches exactly one clip (substring search of the client)`, mehrdeutig.length === 0, mehrdeutig.join(',') || 'unique');
    check(`${name}: skinned model`, (manifest.modelle[name]?.skins ?? 0) === 1);
  }
  // Every clip state that can be written has a clip speed the client couples to.
  check('cow: walk clip speed declared', (dKuh?.animationTempo?.walk ?? 0) > 0);
  check('wolf: walk and run clip speeds declared', (dWolf?.animationTempo?.walk ?? 0) > 0 && (dWolf?.animationTempo?.run ?? 0) > 0);
}

// ── [2] Spawn system with the shipped numbers ────────────────────
console.log('\n[2] Spawn system with the shipped numbers (interval and chance forced)');
const SEED = getStableHash('KxSYuZquuw');
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
 * A point in `biome` from which the spawn ring (40-100 m) is almost all the same
 * biome and above the waterline — so the forced spawn rolls do not mostly fail
 * on a shore. Deterministic: first hit on a growing ring.
 */
function findeAnker(
  geo: { getBiome(x: number, z: number): Biome },
  hm: { getGroundHeight(x: number, z: number): number },
  biome: Biome
): Vector3 {
  for (let r = 100; r < 8000; r += 50) {
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (geo.getBiome(x, z) !== biome) continue;
      let n = 0;
      let gut = 0;
      for (const rr of [40, 60, 80, 100]) {
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
let wald: Vector3;
{
  const w = buildWorld(5, gezwungen());
  wiese = findeAnker(w.geo, w.heightmaps, Biome.Meadows);
  wald = findeAnker(w.geo, w.heightmaps, Biome.BlackForest);
  console.log(`      meadows anchor (${f(wiese.x, 0)}, ${f(wiese.z, 0)}), black-forest anchor (${f(wald.x, 0)}, ${f(wald.z, 0)})`);
}

console.log('\n[2a] Spawning: the cow in the meadows, the wolf in the black forest');
{
  const m = buildWorld(21, gezwungen());
  generateAround(m.zones, wiese);
  for (let i = 0; i < 600; i++) m.spawns.update(0.1, [wiese]);
  const kuehe = m.zdos.getZDOByPrefab(KUH_HASH);
  const woelfe = m.zdos.getZDOByPrefab(WOLF_HASH);
  check('meadows: cows spawn', kuehe.length > 0, `${kuehe.length}`);
  check('meadows: no wolves', woelfe.length === 0, `${woelfe.length}`);
  check('meadows: cow cap holds (maxPerPlayer 3 within 120 m, a group may overshoot by its size - 1)', kuehe.length <= 3 + 1, `${kuehe.length}`);
  check('cows start with 30 HP', kuehe.length > 0 && kuehe.every((z) => z.getInt(HEALTH_MEMBER) === 30), kuehe.map((z) => z.getInt(HEALTH_MEMBER)).join(','));
  const ersteAnim = kuehe.map((z) => z.getString(ANIM_MEMBER));
  check('cows are written `idle` at spawn or already `walk` (never empty)', ersteAnim.every((a) => a === 'idle' || a === 'walk'), ersteAnim.join(','));

  const w2 = buildWorld(22, gezwungen());
  generateAround(w2.zones, wald);
  for (let i = 0; i < 600; i++) w2.spawns.update(0.1, [wald]);
  const woelfe2 = w2.zdos.getZDOByPrefab(WOLF_HASH);
  check('black forest: wolves spawn', woelfe2.length > 0, `${woelfe2.length}`);
  check('black forest: no cows', w2.zdos.getZDOByPrefab(KUH_HASH).length === 0);
  check('black forest: wolf cap holds (maxPerPlayer 3 within 130 m, a group of 2 may overshoot by 1)', woelfe2.length >= 1 && woelfe2.length <= 3 + 1, `${woelfe2.length}`);
  check('wolves start with 30 HP', woelfe2.length > 0 && woelfe2.every((z) => z.getInt(HEALTH_MEMBER) === 30));
  check('no water spawns (y >= minAltitude 30.5)', [...kuehe, ...woelfe2].every((z) => z.position.y >= 30.5));
}

/**
 * One creature next to a fixed peer, everything else quiet: a table with the
 * shipped numbers of ONE entry, the ring squeezed to `ring` metres and group
 * size 1. Returns the world and the creature.
 */
function einzelnes(name: 'Kuh' | 'Wolf', peer: Vector3, ring: number, ueberschreibe: Partial<SpawnEntry> = {}) {
  const basis = eintrag(name)!;
  const tabelle: SpawnEntry[] = [
    { ...basis, spawnIntervalSec: 0.5, spawnChance: 1, ringMin: ring, ringMax: ring + 0.5, groupSizeMin: 1, groupSizeMax: 1, maxPerPlayer: 1, globalMax: 1, ...ueberschreibe },
  ];
  const w = buildWorld(31, tabelle);
  generateAround(w.zones, peer);
  let zdo: ZDO | undefined;
  for (let i = 0; i < 400 && !zdo; i++) {
    w.spawns.update(0.1, [peer]);
    zdo = w.zdos.getZDOByPrefab(getStableHash(name))[0];
  }
  if (!zdo) throw new Error(`${name} did not spawn at ring ${ring}`);
  return { ...w, zdo };
}

console.log('\n[2b] The `anim` member follows the movement; the cow walks at its walk speed');
{
  const peer = { ...wiese };
  const { spawns, zdo } = einzelnes('Kuh', peer, 60);
  const walk = eintrag('Kuh')!.walkSpeed;
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
  check('the cow both stands and walks', walkTicks > 100 && idleTicks > 100, `walk ${walkTicks}, idle ${idleTicks}`);
  check('only idle and walk ever appear for the cow (no run, no attack)', [...zustaende].every((z) => z === 'idle' || z === 'walk'), [...zustaende].join(','));
  check('it moves ONLY while `anim` says walk', bewegtOhneWalk === 0, `${bewegtOhneWalk} moving ticks without walk`);
  check('`anim` says walk only while it moves (allowing the turn-around tick)', walkOhneBewegung <= 30, `${walkOhneBewegung} of ${walkTicks} walk ticks without movement`);
  check(`ground speed while walking = walkSpeed ${walk} m/s (mean of ${geschw.length} steps)`, Math.abs(mittel - walk) < 0.05, `${f(mittel, 3)} m/s`);
}

console.log('\n[2c] The cow does not attack; the wolf does (peer one metre / ten metres away)');
{
  // COW: pinned next to the peer (no wandering away), 60 s of simulated time.
  const peer = { ...wiese };
  const kuh = einzelnes('Kuh', peer, 1, { wanderRadius: 0, idleMinSec: 999, idleMaxSec: 999 });
  const abstand0 = dist2d(kuh.zdo.position, peer);
  let schlaegeKuh = 0;
  kuh.spawns.onCreatureAttack = () => {
    schlaegeKuh++;
  };
  let minAbstand = abstand0;
  for (let i = 0; i < 600; i++) {
    kuh.spawns.update(0.1, [peer]);
    minAbstand = Math.min(minAbstand, dist2d(kuh.zdo.position, peer));
  }
  check('cow: stands 1 m from the peer for 60 s (closest ' + f(minAbstand) + ' m, inside the 2.4 m strike radius)', minAbstand <= 2.4, `start ${f(abstand0)} m`);
  check('cow: 0 strikes in 60 s (a wolf-like creature would strike ~30 times)', schlaegeKuh === 0, `${schlaegeKuh} strikes`);
  check('cow: HP untouched (30)', kuh.zdo.getInt(HEALTH_MEMBER) === 30);

  // WOLF: 10 m away, chases at run speed, then strikes.
  const peerW = { ...wald };
  const wolf = einzelnes('Wolf', peerW, 10);
  const treffer: { t: number; schaden: number; radius: number }[] = [];
  let simT = 0;
  wolf.spawns.onCreatureAttack = (_p, schaden, radius) => {
    treffer.push({ t: simT, schaden, radius });
  };
  const anfang = dist2d(wolf.zdo.position, peerW);
  let ankunft = -1;
  const animAufDemWeg = new Set<string>();
  const animImAngriff = new Set<string>();
  let letzterAbstand = anfang;
  const schritte: number[] = [];
  for (let i = 0; i < 400; i++) {
    wolf.spawns.update(0.05, [peerW]);
    simT += 0.05;
    const d = dist2d(wolf.zdo.position, peerW);
    if (d > 1.7 + 1e-6) {
      animAufDemWeg.add(wolf.zdo.getString(ANIM_MEMBER));
      if (letzterAbstand - d > 1e-9) schritte.push((letzterAbstand - d) / 0.05);
    } else {
      // The state is written from the distance BEFORE the step, so the first tick
      // inside the strike distance still says `run` (one tick, 50 ms here).
      if (ankunft >= 0) animImAngriff.add(wolf.zdo.getString(ANIM_MEMBER));
      if (ankunft < 0) ankunft = simT;
    }
    letzterAbstand = d;
  }
  const lauf = eintrag('Wolf')!.runSpeed;
  const meanSchritt = schritte.reduce((s, x) => s + x, 0) / Math.max(1, schritte.length);
  console.log(`      wolf: start ${f(anfang)} m, arrived after ${f(ankunft)} s, anim on the way [${[...animAufDemWeg]}], anim when striking [${[...animImAngriff]}]`);
  check('wolf: starts ~10 m away and closes to the strike distance 1.7 m', anfang > 9 && anfang < 11.5 && dist2d(wolf.zdo.position, peerW) <= 1.7 + 1e-6, `${f(anfang)} m -> ${f(dist2d(wolf.zdo.position, peerW))} m`);
  check(`wolf: chases at run speed ${lauf} m/s`, Math.abs(meanSchritt - lauf) < 0.1, `${f(meanSchritt, 3)} m/s over ${schritte.length} steps`);
  check('wolf: plays `run` while chasing', animAufDemWeg.size === 1 && animAufDemWeg.has('run'), [...animAufDemWeg].join(','));
  check('wolf: plays `attack` once in range', animImAngriff.size === 1 && animImAngriff.has('attack'), [...animImAngriff].join(','));
  check('wolf: strikes with 8 damage in 2.4 m (the creature numbers of the game)', treffer.length > 0 && treffer.every((t) => t.schaden === 8 && t.radius === 2.4), `${treffer.length} strikes`);
  const luecken = treffer.slice(1).map((t, i) => t.t - treffer[i].t);
  check('wolf: one strike every 2 s', luecken.length >= 4 && luecken.every((l) => Math.abs(l - 2) < 0.11), luecken.map((l) => f(l)).join(', '));
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
const jetzt = (): number => performance.now();

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
    worldName: 'b9-kreaturen-spiel',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    // The spawn system must run: it moves the animals and makes the wolf strike.
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
    const schwert = findItem('SwordNorth');
    if (!schwert) throw new Error('SwordNorth not in the item table');
    peer.inventar.addItem(schwert, 1);

    const geoAnker = { wiese: findeAnker(server.geo, server.heightmaps, Biome.Meadows), wald: findeAnker(server.geo, server.heightmaps, Biome.BlackForest) };

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
    /** Place an animal like the layout does and hand it to the spawn system. */
    function setze(name: 'Kuh' | 'Wolf', pos: Vector3): ZDO {
      const y = server.heightmaps.getGroundHeight(pos.x, pos.z);
      const zdo = server.zdos.createZDO(getStableHash(name), { x: pos.x, y, z: pos.z });
      zdo.setInt(HEALTH_MEMBER, maxLeben(name));
      spawns!.adoptPersisted();
      return zdo;
    }
    const vorn = (von: Vector3, abstand: number): Vector3 => ({ x: von.x, y: von.y, z: von.z - abstand });
    const beute = (): number => peer!.inventar.countOf('RawMeat');

    /** Hit with `waffe` until the animal is gone; returns the hits, the HP after each and the loot. */
    async function erschlage(zdo: ZDO, mitte: Vector3, waffe: string, halteFest = false): Promise<{ schlaege: number; hpReihe: number[]; fleisch: number; meldung: string }> {
      const fleischVorher = beute();
      const hpReihe: number[] = [zdo.getInt(HEALTH_MEMBER)];
      let schlaege = 0;
      while (!zdo.destroyed && schlaege < 12) {
        peer!.stamina = 100;
        // A cow wanders off between two hits; the test counts hits, it does not chase: put it back in front of the player before every hit.
        if (halteFest) server.zdos.updateZDOZone(zdo, { ...vorn(mitte, 2), y: zdo.position.y });
        await blicke(ws, 0, 100);
        sendAttack(ws, mitte, waffe, 0);
        schlaege++;
        await warte(420);
        hpReihe.push(zdo.destroyed ? 0 : zdo.getInt(HEALTH_MEMBER));
      }
      await warte(150);
      return { schlaege, hpReihe, fleisch: beute() - fleischVorher, meldung: meldungen.filter((m) => m.includes('besiegt')).slice(-1)[0] ?? '' };
    }

    // [3a] Cow: standing next to a player does nothing to the player.
    console.log('\n[3a] Cow next to the player: no damage (real server tick)');
    let mitte = await neuerPlatz(geoAnker.wiese);
    const ruhekuh = setze('Kuh', vorn(mitte, 1.2));
    const hp0 = peer.health;
    let naheMs = 0;
    const ende = jetzt() + 15_000;
    let letzt = jetzt();
    let animGesehen = new Set<string>();
    while (jetzt() < ende) {
      // Keep the cow at 1.2 m so that the whole window counts as "standing next to it".
      if (dist2d(ruhekuh.position, mitte) > 1.8) server.zdos.updateZDOZone(ruhekuh, { ...vorn(mitte, 1.2), y: ruhekuh.position.y });
      if (dist2d(ruhekuh.position, mitte) <= 2.4) naheMs += jetzt() - letzt;
      animGesehen.add(ruhekuh.getString(ANIM_MEMBER));
      letzt = jetzt();
      await warte(50);
    }
    check(
      `cow within the 2.4 m strike radius for ${f(naheMs / 1000, 1)} s of 15 s: player HP ${hp0} -> ${peer.health}`,
      naheMs > 12_000 && peer.health === hp0 && ruhekuh.getInt(HEALTH_MEMBER) === 30,
      `HP ${peer.health}`
    );
    check('cow: anim member only idle/walk on the real server', [...animGesehen].every((a) => a === 'idle' || a === 'walk'), [...animGesehen].join(','));
    server.zdos.destroyZDO(ruhekuh.zdoid);

    // [3b] Cow: kills with fist, sword, axe.
    console.log('\n[3b] Cow: hits to kill and loot');
    for (const [waffe, schaden] of [['AxeFlint', 15], ['SwordNorth', 12], ['', 4]] as const) {
      mitte = await neuerPlatz(geoAnker.wiese);
      const kuh = setze('Kuh', vorn(mitte, 2));
      const r = await erschlage(kuh, mitte, waffe, true);
      const soll = Math.ceil(30 / schaden);
      check(`cow, ${waffe === '' ? 'fist' : waffe} (${schaden}): dead after ${soll} hits`, r.schlaege === soll && kuh.destroyed, `hits ${r.schlaege}, HP ${r.hpReihe.join(' -> ')}`);
      check(`cow, ${waffe === '' ? 'fist' : waffe}: loot 2-3 RawMeat in the inventory and in the message`, r.fleisch >= 2 && r.fleisch <= 3 && r.meldung === `Kuh besiegt — ${r.fleisch}× RawMeat`, `${r.fleisch}× / "${r.meldung}"`);
    }

    // [3c] Wolf: strikes back, dies, drops.
    console.log('\n[3c] Wolf: strikes, is hit, dies, drops');
    mitte = await neuerPlatz(geoAnker.wald);
    const wolf = setze('Wolf', vorn(mitte, 8));
    const hpReihe: { t: number; hp: number }[] = [];
    const t0 = jetzt();
    let ankunftMs = -1;
    const animSicht = new Set<string>();
    while (jetzt() - t0 < 7_500) {
      hpReihe.push({ t: jetzt() - t0, hp: peer.health });
      animSicht.add(wolf.getString(ANIM_MEMBER));
      if (ankunftMs < 0 && dist2d(wolf.position, mitte) <= 1.75) ankunftMs = jetzt() - t0;
      await warte(10);
    }
    const abzuege: number[] = [];
    for (let i = 1; i < hpReihe.length; i++) {
      const d = hpReihe[i - 1].hp - hpReihe[i].hp;
      if (d > 0) abzuege.push(d);
    }
    check(`wolf ran the 8 m in ${f(ankunftMs / 1000, 2)} s (8 m at 5.5 m/s = 1.5 s incl. the 20 m aggro start)`, ankunftMs > 0 && ankunftMs < 3000, `${f(ankunftMs / 1000, 2)} s`);
    check('wolf strikes: every strike takes exactly 8 HP, at least two in 7.5 s', abzuege.length >= 2 && abzuege.every((d) => d === 8), `strikes ${abzuege.join(',')}, HP 100 -> ${peer.health}`);
    check('wolf anim member on the real server: run then attack', animSicht.has('run') && animSicht.has('attack'), [...animSicht].join(','));
    const gegen = await erschlage(wolf, mitte, 'AxeFlint');
    check('wolf, flint axe: dead after 2 hits', gegen.schlaege === 2 && wolf.destroyed, `hits ${gegen.schlaege}, HP ${gegen.hpReihe.join(' -> ')}`);
    check('wolf: loot 1-2 RawMeat', gegen.fleisch >= 1 && gegen.fleisch <= 2 && gegen.meldung === `Wolf besiegt — ${gegen.fleisch}× RawMeat`, `${gegen.fleisch}× / "${gegen.meldung}"`);

    mitte = await neuerPlatz(geoAnker.wald);
    const wolf2 = setze('Wolf', vorn(mitte, 3));
    await warte(1200);
    const faust = await erschlage(wolf2, mitte, '');
    check('wolf, fist (4): dead after 8 hits', faust.schlaege === 8 && wolf2.destroyed, `hits ${faust.schlaege}, HP ${faust.hpReihe.join(' -> ')}`);
    mitte = await neuerPlatz(geoAnker.wald);
    const wolf3 = setze('Wolf', vorn(mitte, 3));
    await warte(1200);
    const schw = await erschlage(wolf3, mitte, 'SwordNorth');
    check('wolf, north sword (12): dead after 3 hits', schw.schlaege === 3 && wolf3.destroyed, `hits ${schw.schlaege}, HP ${schw.hpReihe.join(' -> ')}`);
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
