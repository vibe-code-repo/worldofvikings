import assert from 'node:assert/strict';
import { VILLAGE_REGION, VILLAGE_VEGETATION } from '../../shared/src/villageBiome.js';
import { EIGENE_FLORA } from '../../shared/src/flora.js';
import { findEnvironment, evaluateEnv } from '../../shared/src/environment.js';
import { LOOK_VORGABE, pruefeLook, sichtweite } from '../../shared/src/lookProfil.js';
import { sanitizeWorldLayout } from '../../shared/src/worldlayout/sanitize.js';
import { REGION_VORLAGEN, wendeVorlageAn } from '../src/editor/regionsWerkzeuge.js';
import { fogVisibilityDistance } from '../src/engine/fogVisibility.js';
import { GrassClutter } from '../src/engine/GrassClutter.js';
import { ClutterWindPlugin } from '../src/engine/ClutterWindPlugin.js';

assert.equal(new Set(VILLAGE_VEGETATION).size, VILLAGE_VEGETATION.length);
for (const name of VILLAGE_VEGETATION) {
  assert.ok(EIGENE_FLORA.some(f => f.prefabName === name), 'Missing scatter entry: ' + name);
}
const preset = REGION_VORLAGEN.find(p => p.id === 'village-grove')!;
const source = { id: 'village', biome: 'grassland' as const, shape: { kind: 'circle' as const, x: 0, z: 0, radius: 1500 }, edgeFalloff: 300 };
const applied = wendeVorlageAn(source, preset);
const saved = sanitizeWorldLayout({version: 1, name: 'Village proof', detailSeed: 'village', continents: [], regions: [applied]});
assert.ok(saved);
assert.deepEqual(saved.regions[0].vegetation, [...VILLAGE_VEGETATION]);
assert.equal(saved.regions[0].forestDensity, VILLAGE_REGION.forestDensity);
const env = findEnvironment('Village')!;
assert.ok(env);
const noon = evaluateEnv(env, .5);
assert.ok(Math.abs(noon.fogDensity - .015) < 1e-6);
assert.ok(Math.abs(noon.sunColor.g - .883333) < .001);
for (const t of [0, .25, .5, .75, 1]) {
  const e = evaluateEnv(env,t);
  assert.ok(Number.isFinite(e.lightIntensity) && e.lightIntensity >= 0);
}
assert.deepEqual(pruefeLook(LOOK_VORGABE), []);
assert.equal(fogVisibilityDistance(false, 2, .15, 0, 0), Infinity);
assert.equal(fogVisibilityDistance(true, 0, .15, 0, 0), Infinity);
assert.equal(fogVisibilityDistance(true, 3, .15, 4000, 20000), 18400);
assert.ok(Math.abs(fogVisibilityDistance(true, 2, .015, 0, 300) - 101.161809) < .0001);
assert.ok(Math.abs(fogVisibilityDistance(true, 1, .015, 0, 300) - 153.505673) < .0001);
assert.equal(fogVisibilityDistance(true, 2, 0, 0, 300), Infinity);
// GrassClutter.update() must take its vanish distance from the scene fog MODE via
// sichtweite(), not from the density alone: linear fog has no density, and a stale
// density value must neither shorten nor lengthen the grass there. Card 0.13.
const grassScene = { fogEnabled: true, fogMode: 2, fogDensity: 0, fogStart: 0, fogEnd: 300 };
const grass = Object.create(GrassClutter.prototype) as unknown as {
  scene: typeof grassScene; quality: number; ready: boolean; time: number; update(dt: number, density: number): void;
};
grass.scene = grassScene; grass.ready = false; grass.time = 0;
const QUALITY_SCALE = [0.7, 0.95, 1.25, 1.6];
const grassScale = (quality: number, enabled: boolean, mode: number, density: number, start: number, end: number) => {
  Object.assign(grassScene, { fogEnabled: enabled, fogMode: mode, fogStart: start, fogEnd: end });
  grass.quality = quality;
  grass.update(0, density);
  return ClutterWindPlugin.distanceScale;
};
// the cap: 90 % fog distance x 1.2 over the 35 m reference fade, between 0.6 and the quality scale
const grassExpected = (quality: number, visibility: number) => Math.max(0.6, Math.min(QUALITY_SCALE[quality], visibility * 1.2 / 35));
// linear 4000/20000 with a stale weather density of 0.15: the grass keeps the quality range
assert.equal(grassScale(3, true, 3, .15, 4000, 20000), 1.6);
assert.equal(grassScale(0, true, 3, .15, 4000, 20000), .7);
// linear 0/20 (90 % fog at 18 m) and density 0: the fog shortens the grass, the density is not asked
assert.ok(Math.abs(grassScale(3, true, 3, 0, 0, 20) - grassExpected(3, sichtweite('linear', 0, .1, 0, 20))) < 1e-9);
assert.ok(Math.abs(grassScale(3, true, 3, 0, 0, 20) - 18 * 1.2 / 35) < 1e-9);
// exp and exp2 keep their own curves: same density, different range
assert.ok(Math.abs(grassScale(3, true, 1, .05, 0, 300) - grassExpected(3, sichtweite('exp', .05, .1))) < 1e-9);
assert.ok(grassScale(3, true, 1, .05, 0, 300) > 1.5 && grassScale(3, true, 1, .05, 0, 300) < 1.6);
assert.equal(grassScale(3, true, 2, .15, 0, 300), .6);
// fog off: no shortening whatever density the weather still carries
assert.equal(grassScale(3, false, 2, .15, 0, 300), 1.6);
assert.equal(grassScale(2, true, 0, .15, 0, 300), 1.25);
// a look-profile change at run time (same object, next frame) is followed at once
assert.equal(grassScale(3, true, 2, .15, 0, 300), .6);
assert.equal(grassScale(3, true, 3, .15, 4000, 20000), 1.6);
// end <= start counts as no fog
assert.equal(grassScale(3, true, 3, .15, 4000, 20), 1.6);
assert.equal(grassScale(3, true, 3, .15, 50, 800), 1.6);
assert.equal(grassScale(3, true, 2, .15, 50, 800), .6);
console.log('PASS: village palette, editor save round trip, daytime source values, fog modes, grass range follows the fog mode');
