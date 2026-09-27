/**
 * Wolfsbalance (27.09.2026) — regression test for the two fixes from the
 * Wolfsbalance card:
 *
 *  [1] Chase speed lower than the shipped 5.5 m/s, because the run clip's
 *      playback rate hit its cap (CLIP_RATE_MAX 4 x clip tempo 1.42 = 5.68
 *      m/s) often enough to slide the feet p90 ~11-14 % of the time
 *      (B9.2 in-game measurement, real GPU-rendered samples). This test
 *      replays those same 20 samples, scaled to the SHIPPED runSpeed, and
 *      checks the rescaled p90 sliding stays under 3 %. On the old 5.5 m/s
 *      it does not — this is why the test is red on the pre-fix code.
 *
 *  [2] At most MAX_GLEICHZEITIGE_ANGREIFER (SpawnSystem.ts) wolves may
 *      strike the SAME player at once, however many cluster nearby: the
 *      Befund measured three wolves doing 24 damage together in 9 s. This
 *      pins three wolves within striking distance of one peer and checks
 *      that only two ever land a hit at a time, and that the third takes
 *      the freed slot once one of the two active attackers dies.
 *
 * Both wolves in [2] start already inside the 1.7 m strike distance, so
 * they never call moveStep — the ground height at their fixed positions is
 * irrelevant, no zone generation or biome anchor is needed.
 *
 * Run: npx tsx server/test/wolf-rudel-begrenzung.ts   (from the repo root)
 */
import {
  GeoManager,
  HeightmapProvider,
  XorShiftRandom,
  getStableHash,
  HEALTH_MEMBER,
  SPAWN_TABLE,
  maxLeben,
  type SpawnEntry,
  type Vector3,
} from '@wov/shared';
import { SpawnSystem } from '../src/world/SpawnSystem.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const f = (n: number, k = 2): string => n.toFixed(k);

function eintrag(name: string): SpawnEntry {
  const e = SPAWN_TABLE.find((x) => x.prefab === name);
  if (!e) throw new Error(`${name} not in SPAWN_TABLE`);
  return e;
}

// ── [1] Foot sliding: real B9.2 samples, rescaled to the shipped speed ──
console.log('\n[1] Wolf chase speed vs. foot sliding (real GPU trace, rescaled)');
{
  // The 20 real "run" samples from the B9.2 in-game measurement (GPU,
  // AMD RX 7900 XT via Playwright on mike-pc): the client's own smoothed
  // ground speed (`ist`, m/s) while the wolf chased at the ORIGINAL
  // runSpeed of 5.5 m/s. Source: Berichte/b9-2-kreaturen-spiel/spielprobe/
  // reihe-wolf-jagd.json (reports live outside this repo's tracked code,
  // so the numbers are copied here rather than read from that file).
  const ORIGINAL_RUNSPEED = 5.5;
  const CLIP_TEMPO_RUN = 1.42; // Wolf.animationTempo.run (prefabs.ts) — model unchanged
  const CLIP_RATE_MAX = 4; // client/src/entities/clipTempo.ts
  const istSamplesAt5_5 = [
    0.80785590684367, 1.664673151138794, 2.001552343295516, 4.904135512328698,
    4.157683795047085, 2.630424680921951, 5.835346212885991, 5.836795460648346,
    6.42027596868407, 4.37410355129447, 6.4292797214662984, 5.4800512848828244,
    6.183347720420951, 5.910811845314324, 3.8324721127019727, 6.368918789075956,
    5.1206739134849295, 6.610568376482463, 5.302880528801359, 4.257664248985621,
  ];

  // The interpolation math (client/src/entities/EntityManager.ts,
  // koppleClipTempo + clipTempo.ts) is linear in speed for a fixed
  // network/render timing pattern: a slower wolf covers a shorter distance
  // per tick, but the same jitter shape. Rescaling the recorded `ist`
  // values by (shipped / 5.5) therefore gives an honest sliding estimate
  // for the new speed without a fresh GPU session.
  const clipRate = (ist: number, clipTempo: number): number =>
    Math.min(CLIP_RATE_MAX, Math.max(0, ist / clipTempo));
  const rutschenProzent = (ist: number): number => {
    if (!(ist > 0)) return 0;
    const rate = clipRate(ist, CLIP_TEMPO_RUN);
    return Math.max(0, (ist - rate * CLIP_TEMPO_RUN) / ist) * 100;
  };
  const percentile = (sortedAsc: readonly number[], p: number): number =>
    sortedAsc[Math.max(0, Math.ceil(p * sortedAsc.length) - 1)];

  const shipped = eintrag('Wolf').runSpeed;
  const scale = shipped / ORIGINAL_RUNSPEED;
  const werte = istSamplesAt5_5.map((ist) => rutschenProzent(ist * scale)).sort((a, b) => a - b);
  const p90 = percentile(werte, 0.9);
  const p50 = percentile(werte, 0.5);

  check(
    `wolf run speed ${shipped} m/s: rescaled p90 foot-sliding under 3 % (was ~11-14 % measured at 5.5)`,
    p90 < 3,
    `p50 ${f(p50, 1)} %, p90 ${f(p90, 1)} %`
  );
  check('wolf run speed still faster than a walking player (4.5 m/s, WovServer.ts)', shipped > 4.5, `${shipped} m/s`);
  check('wolf run speed still slower than a sprinting player (7.5 m/s)', shipped < 7.5, `${shipped} m/s`);
}

// ── [2] At most two wolves strike the same player at once ──────────
console.log('\n[2] At most two wolves strike the same player at once (pack cap)');
{
  const SEED = getStableHash('wolf-rudel-begrenzung');
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zones = new ZoneManager(geo, heightmaps, zdos, SEED, { worldFeatures: false, worldVegetation: false });
  // spawnChance 0 / globalMax 0: only the three wolves placed by hand below
  // exist — no natural spawn roll may add a fourth.
  const tabelle: SpawnEntry[] = [{ ...eintrag('Wolf'), spawnChance: 0, globalMax: 0 }];
  const spawns = new SpawnSystem(zdos, geo, heightmaps, zones, { rng: new XorShiftRandom(1), table: tabelle });

  const peer: Vector3 = { x: 0, y: 100, z: 0 };
  const WOLF_HASH = getStableHash('Wolf');
  function platziere(dx: number, dz: number) {
    const pos: Vector3 = { x: peer.x + dx, y: peer.y, z: peer.z + dz };
    const zdo = zdos.createZDO(WOLF_HASH, pos);
    zdo.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
    return zdo;
  }
  // All three start well inside the 1.7 m strike distance and at distinct
  // spots, so a strike's reported position identifies its wolf exactly.
  const NAMEN = ['w1', 'w2', 'w3'] as const;
  const w1 = platziere(0.3, 0);
  const w2 = platziere(-0.3, 0);
  const w3 = platziere(0, 0.3);
  const zdoVon = { w1, w2, w3 } as const;
  spawns.adoptPersisted();

  function wer(pos: Vector3): string {
    for (const n of NAMEN) {
      const z = zdoVon[n];
      if (Math.abs(pos.x - z.position.x) < 1e-6 && Math.abs(pos.z - z.position.z) < 1e-6) return n;
    }
    return '?';
  }
  const treffer: string[] = [];
  spawns.onCreatureAttack = (pos) => treffer.push(wer(pos));

  const DT = 1 / 30; // real server tick (WovServer.ts TICK_MS = 1000/30)
  const VOR_TICKS = 300; // 10 s
  const NACH_TICKS = 360; // 12 s — enough for a freed slot's own 2 s cooldown plus margin

  for (let i = 0; i < VOR_TICKS; i++) spawns.update(DT, [peer]);
  const vor = treffer.slice();
  const distinctVor = new Set(vor);

  check('before any death: exactly two of the three wolves ever land a hit', distinctVor.size === 2, [...distinctVor].join(','));
  check(
    'before any death: about 2 hits/2s (2 engaged wolves), not 3 — the Befund\'s 24 dmg/9s pile-on',
    vor.length >= 8 && vor.length <= 10,
    `${vor.length} hits in 10 s`
  );

  const stillAttacker = [...distinctVor][0] as 'w1' | 'w2' | 'w3';
  const silent = NAMEN.find((n) => !distinctVor.has(n))!;
  zdos.destroyZDO(zdoVon[stillAttacker].zdoid);

  treffer.length = 0;
  for (let i = 0; i < NACH_TICKS; i++) spawns.update(DT, [peer]);
  const nach = treffer.slice();
  const distinctNach = new Set(nach);

  check(`after killing an active attacker (${stillAttacker}): the waiting wolf (${silent}) takes the freed slot`, distinctNach.has(silent), [...distinctNach].join(','));
  check('after the kill: still at most two distinct attackers (the dead one excluded)', distinctNach.size <= 2 && !distinctNach.has(stillAttacker), [...distinctNach].join(','));
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
