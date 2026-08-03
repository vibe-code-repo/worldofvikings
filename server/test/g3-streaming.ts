/**
 * G3/G-POP smoke test — zone generation queue prioritization (Phase G).
 *
 * The generation queue used to be a plain FIFO: zones enqueued around a
 * player's OLD position were generated before the ones ahead of a fast
 * (flying) player — visible as the world "building up" behind you.
 * Now the queue is culled (stale zones dropped) and sorted nearest-first
 * every tick.
 *
 * Checks:
 *  1. Enqueue around spawn: 81 zones pending, none generated with budget 0.
 *  2. Player teleports 10 zones east: stale zones are culled from queue AND
 *     pending, the new 81-zone ring is enqueued, nearest zone first.
 *  3. A budgeted update actually generates zones (smoke) and keeps
 *     queue/pending consistent.
 *
 * Run: npx tsx server/test/g3-streaming.ts   (from the repo root)
 */

import { GeoManager, HeightmapProvider, getStableHash } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

const SEED = getStableHash('KxSYuZquuw');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface QueueLike {
  queue: { x: number; y: number }[];
  pending: Set<string>;
}

const geo = new GeoManager(SEED, { worldGenVersion: 2 });
const heightmaps = new HeightmapProvider(geo, {
  blendSmoothStep: true,
  bilinearSampling: false,
});
const zdos = new ZDOManager(1n);
const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
const q = zm as unknown as QueueLike;

console.log('== 1. enqueue around spawn (budget 0 → nothing generated) ==');
zm.update([{ x: 0, y: 0, z: 0 }], 0);
check('81 zones queued', q.queue.length === 81, `queue=${q.queue.length}`);
check('pending matches queue', q.pending.size === q.queue.length, `pending=${q.pending.size}`);

console.log('== 2. player teleports 10 zones east → cull + re-sort ==');
zm.update([{ x: 640, y: 0, z: 0 }], 0); // zone (10,0)
const maxCheb = Math.max(
  ...q.queue.map((z) => Math.max(Math.abs(z.x - 10), Math.abs(z.y - 0)))
);
check('stale zones culled (≤5 chebyshev from new pos)', maxCheb <= 5, `max=${maxCheb}`);
check('new ring enqueued (81 zones)', q.queue.length === 81, `queue=${q.queue.length}`);
check(
  'nearest zone first',
  q.queue.length > 0 && q.queue[0].x === 10 && q.queue[0].y === 0,
  q.queue.length > 0 ? `first=(${q.queue[0].x},${q.queue[0].y})` : 'empty'
);
check('pending still consistent', q.pending.size === q.queue.length, `pending=${q.pending.size}`);

console.log('== 3. budgeted update generates zones, keeps sets consistent ==');
const before = q.queue.length;
const generated = zm.update([{ x: 640, y: 0, z: 0 }], 60);
check('zones generated with 60ms budget', generated >= 1, `generated=${generated}`);
check(
  'queue shrank by generated count',
  q.queue.length === before - generated,
  `queue ${before}→${q.queue.length}`
);
check('pending still consistent', q.pending.size === q.queue.length, `pending=${q.pending.size}`);

console.log(failures === 0 ? '\n=== G3: ALL PASSED ===' : `\n=== G3: ${failures} FAILURES ===`);
process.exit(failures === 0 ? 0 : 1);
