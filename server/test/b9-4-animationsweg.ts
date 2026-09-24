/**
 * B9.4 — the animation path completed and secured.
 *
 *  [1] A wrongly configured `clips` list fails LOUDLY where the table is built
 *      (no `idle`, empty list, unknown or unusable clip) — no animal that
 *      stands still on the client, no state written that the model lacks.
 *  [2] Two writers on one ZDO are refused (SpawnSystem against RoutenLaeufer /
 *      AggroSystem), with a message naming both — no flipping between states.
 *  [3] `attack` is an event per blow (`animEinmal` = `attack#n`): one event per
 *      swing that really happened, counted against the damage callback.
 *  [4] `hit` and `die` reach the client as events; a slain creature keeps its
 *      body for the clip's length and is then removed; the shipped wolf, whose
 *      `die` is deliberately off, is destroyed at once as before.
 *  [5] The clip names of the shipped models against the manifest and against
 *      the client's group search (exactly one group per state).
 *
 * Every claim carries the number that proves it. Ports: none (no server).
 * New symbols are reached through namespace imports, so the same file runs on
 * the state before the change and fails there instead of crashing.
 *
 * Run: npx tsx server/test/b9-4-animationsweg.ts   (from the repo root)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as Shared from '@wov/shared';
import {
  ANIM_MEMBER,
  Biome,
  GeoManager,
  HEALTH_MEMBER,
  HeightmapProvider,
  SPAWN_TABLE,
  XorShiftRandom,
  getStableHash,
  type RouteDef,
  type SpawnEntry,
  type Vector3,
} from '@wov/shared';
import { SpawnSystem } from '../src/world/SpawnSystem.js';
import { RoutenLaeufer } from '../src/world/RoutenLaeufer.js';
import { AggroSystem } from '../src/world/AggroSystem.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The new members/functions, looked up by name (undefined on the old state).
const S = Shared as unknown as Record<string, unknown>;
const EINMAL: string = (S.ANIM_EINMAL_MEMBER as string | undefined) ?? 'animEinmal';
type WaehleGruppeFn = (namen: readonly string[], wunsch: string) => { art: string; index?: number; treffer?: string[] };
const waehleGruppe = S.waehleGruppe as WaehleGruppeFn | undefined;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
/** Runs `fn`; returns the message it threw, or null. */
function wirft(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const KUH = SPAWN_TABLE.find((e) => e.prefab === 'Kuh')!;
const WOLF = SPAWN_TABLE.find((e) => e.prefab === 'Wolf')!;
const WOLF_HASH = getStableHash('Wolf');
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
      for (const rr of [1, 5, 10]) {
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

/** One creature `ring` metres from `peer`, everything else quiet. */
function einzelnes(basis: SpawnEntry, peer: Vector3, ring: number, ueberschreibe: Partial<SpawnEntry> = {}) {
  const tabelle: SpawnEntry[] = [
    { ...basis, spawnIntervalSec: 0.5, spawnChance: 1, ringMin: ring, ringMax: ring + 0.3, groupSizeMin: 1, groupSizeMax: 1, maxPerPlayer: 1, globalMax: 1, ...ueberschreibe },
  ];
  const w = buildWorld(31, tabelle);
  generateAround(w.zones, peer);
  const hash = getStableHash(basis.prefab);
  let zdo: ZDO | undefined;
  for (let i = 0; i < 400 && !zdo; i++) {
    w.spawns.update(0.1, [peer]);
    zdo = w.zdos.getZDOByPrefab(hash)[0];
  }
  if (!zdo) throw new Error(`${basis.prefab} did not spawn at ring ${ring}`);
  return { ...w, zdo };
}

const wald = (() => {
  const w = buildWorld(5, []);
  return findeAnker(w.geo, w.heightmaps, Biome.BlackForest);
})();
console.log(`black-forest anchor (${wald.x.toFixed(0)}, ${wald.z.toFixed(0)})`);

// ── [1] Wrong clip lists fail loudly ─────────────────────────────
console.log('\n[1] A wrongly configured clips list fails loudly at construction');
{
  const mit = (clips: unknown, extra: Partial<SpawnEntry> = {}): SpawnEntry =>
    ({ ...WOLF, clips: clips as SpawnEntry['clips'], ...extra });
  const bau = (e: SpawnEntry): string | null => wirft(() => buildWorld(1, [e]));

  const ohneIdle = bau(mit(['walk', 'run']));
  check("B1: clips without 'idle' is refused (the old code wrote 'idle' that the model lacks)", ohneIdle !== null && /idle/.test(ohneIdle), ohneIdle ?? 'no error');
  const leer = bau(mit([]));
  check('B2: clips: [] is refused (the old code took it for "has clips" and wrote idle)', leer !== null && /empty/.test(leer), leer ?? 'no error');
  const unbekannt = bau(mit(['idle', 'fly']));
  check('an unknown clip name is refused', unbekannt !== null && /fly/.test(unbekannt), unbekannt ?? 'no error');
  const doppelt = bau(mit(['idle', 'walk', 'walk']));
  check('a name listed twice is refused', doppelt !== null && /twice/.test(doppelt), doppelt ?? 'no error');
  const dieOhneDauer = bau(mit(['idle', 'walk', 'die']));
  check("'die' without dieSec is refused (the server cannot know how long to keep the body)", dieOhneDauer !== null && /dieSec/.test(dieOhneDauer), dieOhneDauer ?? 'no error');
  const gut = bau(mit(['idle', 'walk', 'run', 'attack', 'hit', 'die'], { dieSec: 1 }));
  check('a complete list with dieSec builds', gut === null, gut ?? 'ok');
  check('the shipped table builds (Kuh and Wolf unchanged)', wirft(() => buildWorld(1, SPAWN_TABLE)) === null);

  // adoptSingle: bosses and layout NPCs come in with synthetic entries.
  const w = buildWorld(2, []);
  const zdo = w.zdos.createZDO(WOLF_HASH, { x: 0, y: 40, z: 0 });
  const meldung = wirft(() => w.spawns.adoptSingle(zdo, mit(['walk'])));
  check('adoptSingle refuses a list without idle as well', meldung !== null && /idle/.test(meldung), meldung ?? 'no error');
  check('...and the refused ZDO was NOT taken (no creature registered)', w.spawns.creatureCount === 0, `${w.spawns.creatureCount}`);
}

// ── [2] Two writers on one ZDO ───────────────────────────────────
console.log('\n[2] Two writers on one ZDO are refused (B3)');
{
  const route: RouteDef = { id: 'kreis', points: [[0, 0], [20, 0]], mode: 'loop', speed: 2 };
  const peer = [{ x: 0, y: 40, z: 0 }];
  const boden = (): number => 40;

  // Wolf adopted by the SpawnSystem, then given a route as well.
  const w = buildWorld(3, [WOLF]);
  const wolf = w.zdos.createZDO(WOLF_HASH, { x: 0, y: 40, z: 0 });
  w.spawns.adoptSingle(wolf, WOLF);
  const laeufer = new RoutenLaeufer(w.zdos, boden);
  const m1 = wirft(() => laeufer.registriere(wolf, route));
  check("route registration on a ZDO the spawn system writes is refused", m1 !== null, m1 ?? 'no error');
  check('...and the message names both writers', m1 !== null && /kreatur/.test(m1) && /npc/.test(m1), m1 ?? '');
  check('...the route walker did not take it', laeufer.npcCount === 0, `${laeufer.npcCount}`);

  // The measured symptom of the old code: 27 changes in 6 s. Both systems alive on one ZDO.
  const folge: string[] = [];
  const w2 = buildWorld(4, [WOLF]);
  const wolf2 = w2.zdos.createZDO(WOLF_HASH, { x: 0, y: 40, z: 0 });
  w2.spawns.adoptSingle(wolf2, WOLF);
  const l2 = new RoutenLaeufer(w2.zdos, boden);
  try {
    l2.registriere(wolf2, route);
  } catch {
    /* new state: refused */
  }
  let letzte = '';
  for (let i = 0; i < 60; i++) {
    w2.spawns.update(0.1, peer);
    l2.update(0.1, peer);
    const a = wolf2.getString(ANIM_MEMBER);
    if (a !== letzte) {
      folge.push(a);
      letzte = a;
    }
  }
  console.log(`      6 s with both systems alive: ${folge.length} changes of anim (${folge.join(' ')})`);
  check('6 s with both systems alive: at most 3 changes (old code: the two flip-flop)', folge.length <= 3, `${folge.length}`);

  // Released first: the hand-over works.
  w.spawns.entlasse(wolf);
  const m2 = wirft(() => laeufer.registriere(wolf, route));
  check('after entlasse() the route may take the ZDO', m2 === null && laeufer.npcCount === 1, m2 ?? 'ok');

  // Reverse order: route first, then the spawn system.
  const w3 = buildWorld(5, [WOLF]);
  const wolf3 = w3.zdos.createZDO(WOLF_HASH, { x: 0, y: 40, z: 0 });
  const l3 = new RoutenLaeufer(w3.zdos, boden);
  l3.registriere(wolf3, route);
  const m3 = wirft(() => w3.spawns.adoptSingle(wolf3, WOLF));
  check('reverse order (route first, then spawn adoption) is refused too', m3 !== null && /npc/.test(m3), m3 ?? 'no error');

  // A NO-clips entry (NPC_1) never writes `anim`, so it may share (the layout does this today).
  const NPC = getStableHash('NPC_1');
  const w4 = buildWorld(6, []);
  const npc = w4.zdos.createZDO(NPC, { x: 0, y: 40, z: 0 });
  const l4 = new RoutenLaeufer(w4.zdos, boden);
  l4.registriere(npc, route);
  const keinClips: SpawnEntry = { ...WOLF, prefab: 'NPC_1', clips: undefined };
  const m4 = wirft(() => w4.spawns.adoptSingle(npc, keinClips));
  check('an entry without clips writes no `anim` and may share the ZDO (layout NPC_1 keeps working)', m4 === null, m4 ?? 'ok');

  // The AggroSystem against a spawn-owned ZDO: reported once, not driven.
  const w5 = buildWorld(7, [WOLF]);
  const boss = w5.zdos.createZDO(getStableHash('Surtr'), { x: 0, y: 40, z: 0 });
  w5.spawns.adoptSingle(boss, { ...WOLF, prefab: 'Surtr' });
  const aggro = new AggroSystem(w5.zdos, (h) => (h === getStableHash('Surtr') ? 'Surtr' : undefined), boden);
  const fehlerZeilen: string[] = [];
  const alt = console.error;
  console.error = (...a: unknown[]) => void fehlerZeilen.push(a.join(' '));
  for (let i = 0; i < 20; i++) aggro.update(0.3, [{ x: 3, y: 40, z: 0 }]);
  console.error = alt;
  check('AggroSystem does not drive a ZDO the spawn system writes (aggroCount 0)', aggro.aggroCount === 0, `${aggro.aggroCount}`);
  check('...and says so, once', fehlerZeilen.length === 1 && /kreatur/.test(fehlerZeilen[0] ?? ''), `${fehlerZeilen.length} line(s)`);
}

// ── [3] attack as an event per blow ──────────────────────────────
console.log('\n[3] attack is one event per blow (animEinmal = attack#n)');
{
  const w = buildWorld(9, []);
  const ankerHoehe = w.heightmaps.getGroundHeight(wald.x, wald.z);
  const peer = { x: wald.x, y: ankerHoehe, z: wald.z };
  const { spawns, zdo } = einzelnes(WOLF, peer, 1.2);
  let schlaege = 0;
  spawns.onCreatureAttack = () => {
    schlaege++;
  };
  const werte: string[] = [];
  let letzter = zdo.getString(EINMAL);
  for (let i = 0; i < 90; i++) {
    spawns.update(0.1, [peer]);
    const v = zdo.getString(EINMAL);
    if (v !== letzter) {
      werte.push(v);
      letzter = v;
    }
  }
  console.log(`      9 s next to the wolf: ${schlaege} blows, events ${werte.join(' ')}`);
  check('the wolf stands next to the player and strikes (blows counted at the damage callback)', schlaege >= 3, `${schlaege}`);
  check('exactly one event per blow', werte.length === schlaege, `${werte.length} events / ${schlaege} blows`);
  check('the events count up attack#1, attack#2, ...', werte.every((v, i) => v === `attack#${i + 1}`), werte.join(' '));

  const kuh = einzelnes(KUH, { x: wald.x, y: ankerHoehe, z: wald.z }, 1.2, { biomes: Biome.BlackForest, minAltitude: 30.5 });
  for (let i = 0; i < 90; i++) kuh.spawns.update(0.1, [peer]);
  check('a cow (no attack clip) never writes an event', kuh.zdo.getString(EINMAL) === '', kuh.zdo.getString(EINMAL) || 'empty');

  // The AggroSystem (fighting NPCs) writes the same event at each swing.
  const w2 = buildWorld(11, []);
  const surtr = w2.zdos.createZDO(getStableHash('Surtr'), { x: 0, y: 40, z: 0 });
  const aggro = new AggroSystem(w2.zdos, (h) => (h === getStableHash('Surtr') ? 'Surtr' : undefined), () => 40);
  let hiebe = 0;
  aggro.onSchlag = () => {
    hiebe++;
  };
  const ev2: string[] = [];
  let l2 = surtr.getString(EINMAL);
  for (let i = 0; i < 400; i++) {
    aggro.update(0.05, [{ x: 0, y: 40, z: 2 }]);
    const v = surtr.getString(EINMAL);
    if (v !== l2) {
      ev2.push(v);
      l2 = v;
    }
  }
  console.log(`      Surtr 20 s: ${hiebe} blows, events ${ev2.join(' ')}`);
  check('Surtr: one event per blow, counted', hiebe >= 2 && ev2.length === hiebe && ev2.every((v, i) => v === `attack#${i + 1}`), `${ev2.length} events / ${hiebe} blows`);
}

// ── [4] hit and die ──────────────────────────────────────────────
console.log('\n[4] hit and die reach the client; the body stays for the clip, then goes');
{
  const w0 = buildWorld(13, []);
  const peer = { x: wald.x, y: w0.heightmaps.getGroundHeight(wald.x, wald.z), z: wald.z };
  const VOLL = ['idle', 'walk', 'run', 'attack', 'hit', 'die'] as unknown as SpawnEntry['clips'];

  const { spawns, zdos, zdo } = einzelnes({ ...WOLF, clips: VOLL, dieSec: 1.0 }, peer, 30);
  const treffer = (spawns as unknown as { treffer?: (z: ZDO) => boolean }).treffer;
  const sterbe = (spawns as unknown as { sterbe?: (z: ZDO) => boolean }).sterbe;
  const stirbt = (spawns as unknown as { stirbt?: (z: ZDO) => boolean }).stirbt;

  check('hit: a creature that lists the clip plays it', treffer?.call(spawns, zdo) === true);
  check('hit: the event member reads hit#1', zdo.getString(EINMAL) === 'hit#1', zdo.getString(EINMAL));
  treffer?.call(spawns, zdo);
  check('hit: the second hit counts up (hit#2) although the clip name is the same', zdo.getString(EINMAL) === 'hit#2', zdo.getString(EINMAL));

  const lebenVorher = zdo.getInt(HEALTH_MEMBER);
  check('die: the killing blow starts the clip and tells the caller NOT to destroy', sterbe?.call(spawns, zdo) === true);
  check('die: the event member reads die#3 (counter continues)', zdo.getString(EINMAL) === 'die#3', zdo.getString(EINMAL));
  check('die: life is 0 and the creature is marked dying', zdo.getInt(HEALTH_MEMBER) === 0 && stirbt?.call(spawns, zdo) === true, `life ${lebenVorher} -> ${zdo.getInt(HEALTH_MEMBER)}`);
  check('die: a second killing blow is not a second death', sterbe?.call(spawns, zdo) === false);
  check('die: no hit clip on a dying creature', treffer?.call(spawns, zdo) === false);

  const start = { ...zdo.position };
  let vergangen = 0;
  let nochDa = 0;
  while (!zdo.destroyed && vergangen < 5) {
    spawns.update(0.05, [peer]);
    vergangen += 0.05;
    if (!zdo.destroyed) nochDa = vergangen;
  }
  console.log(`      kill -> removal: last seen at ${nochDa.toFixed(2)} s, gone at ${vergangen.toFixed(2)} s (dieSec 1.0)`);
  check('die: the body is still there after the clip length (1.0 s)', nochDa >= 1.0, `${nochDa.toFixed(2)} s`);
  check('die: and is removed shortly after (within 1.5 s)', zdo.destroyed && vergangen <= 1.5, `${vergangen.toFixed(2)} s`);
  check('die: the body did not move while it died', Math.hypot(zdo.position.x - start.x, zdo.position.z - start.z) < 1e-9);
  check('die: nothing left in the creature map', spawns.creatureCount === 0, `${spawns.creatureCount}`);
  void zdos;

  // The wolf as shipped: `die` is off (ground position 7.9 cm under the floor) → destroyed at once.
  const liefer = einzelnes(WOLF, peer, 30);
  const ls = liefer.spawns as unknown as { sterbe?: (z: ZDO) => boolean; treffer?: (z: ZDO) => boolean };
  check('the shipped wolf has no die clip: sterbe() is false, the caller destroys at once', ls.sterbe?.call(liefer.spawns, liefer.zdo) === false);
  check('the shipped wolf has no hit clip: treffer() writes nothing', ls.treffer?.call(liefer.spawns, liefer.zdo) === false && liefer.zdo.getString(EINMAL) === '');
  check("the shipped wolf's clips do not list die", !(WOLF.clips ?? []).includes('die' as never), (WOLF.clips ?? []).join(','));
}

// ── [5] Clip names against the manifest and the client's search ──
console.log('\n[5] Shipped clips against the manifest and the client group search');
{
  check('waehleGruppe exists (shared)', waehleGruppe !== undefined);
  if (waehleGruppe) {
    const npc = ['Run_02', 'Running', 'Walking'];
    const r = waehleGruppe(npc, 'run');
    check("B4: 'run' on npc_1_walk (Run_02 and Running) is AMBIGUOUS, not the first hit", r.art === 'mehrdeutig' && (r.treffer ?? []).length === 2, JSON.stringify(r));
    check("'walk' on npc_1_walk finds Walking", waehleGruppe(npc, 'walk').art === 'teil');
    check("'idle' on npc_1_walk finds nothing (the designed freeze of a walker without idle)", waehleGruppe(npc, 'idle').art === 'fehlt');
    check('an exact name wins over a longer one that contains it', waehleGruppe(['walk2', 'walk'], 'walk').index === 1);
  }
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../assets/manifest.json'), 'utf8')) as {
    modelle: Record<string, { animationen?: { name: string }[] }>;
  };
  for (const e of SPAWN_TABLE) {
    const namen = (manifest.modelle[e.prefab]?.animationen ?? []).map((a) => a.name);
    for (const c of e.clips ?? []) {
      const wahl = waehleGruppe?.(namen, c);
      check(`${e.prefab}: state '${c}' resolves to exactly one group (${namen.join(',')})`, wahl !== undefined && (wahl.art === 'exakt' || wahl.art === 'teil'), JSON.stringify(wahl));
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
