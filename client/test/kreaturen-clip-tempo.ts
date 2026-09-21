/**
 * B9.2 — walk/run clips of cow and wolf follow the ground speed.
 *
 * A clip carries a stride cycle for one ground speed; the server moves the
 * animal at its own numbers. `clipRate` (client/src/entities/clipTempo.ts)
 * closes the gap. This test checks the pure rule and that every animal the
 * spawn table ships has the data the client needs for it.
 *
 * Run: npx tsx client/test/kreaturen-clip-tempo.ts   (from the repo root)
 */
import { SPAWN_TABLE, findPrefabByName } from '@wov/shared';
import { CLIP_RATE_MAX, clipRate } from '../src/entities/clipTempo';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

console.log('\n[1] rule');
check('no clip speed -> plays as authored (1)', clipRate(3, undefined) === 1);
check('clip speed 0 or negative -> 1', clipRate(3, 0) === 1 && clipRate(3, -1) === 1);
check('same speed -> 1', near(clipRate(0.94, 0.94), 1));
check('twice the clip speed -> 2', near(clipRate(1.88, 0.94), 2));
check('standing still -> 0 (planted feet stay planted)', clipRate(0, 0.94) === 0);
check('never negative, never NaN', clipRate(-2, 1) === 0 && Number.isFinite(clipRate(1e9, 1)));
check(`capped at ${CLIP_RATE_MAX}`, clipRate(100, 1) === CLIP_RATE_MAX);

console.log('\n[2] data: every shipped animal with clips has clip speeds for the states it plays');
for (const e of SPAWN_TABLE) {
  if (!e.clips) continue;
  const def = findPrefabByName(e.prefab);
  const tabelle = def?.animationTempo;
  check(`${e.prefab}: prefab declares animationTempo`, tabelle !== undefined);
  if (!tabelle) continue;
  // The states the spawn system can write while the animal moves.
  const bewegt: string[] = ['walk'];
  if (e.flees || (e.aggro !== false && e.flees === false && e.prefab !== 'Kuh')) bewegt.push('run');
  for (const z of bewegt) {
    if (!e.clips.includes(z as never)) continue;
    check(`${e.prefab}: clip speed for '${z}' is a positive number`, (tabelle[z] ?? 0) > 0, `${tabelle[z]}`);
  }
  // The coupled rates stay inside the cap, so the probe can tell a real
  // residual slide from a capped one.
  const walk = clipRate(e.walkSpeed, tabelle.walk);
  check(`${e.prefab}: walk rate at server speed ${e.walkSpeed} m/s`, walk > 0 && walk <= CLIP_RATE_MAX, walk.toFixed(2));
  if (tabelle.run !== undefined && e.aggro !== false) {
    const run = clipRate(e.runSpeed, tabelle.run);
    check(`${e.prefab}: run rate at server speed ${e.runSpeed} m/s`, run > 0 && run <= CLIP_RATE_MAX, run.toFixed(2));
  }
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
