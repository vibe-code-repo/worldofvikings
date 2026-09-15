import assert from 'node:assert/strict';
import { VILLAGE_REGION, VILLAGE_VEGETATION } from '../../shared/src/villageBiome.js';
import { EIGENE_FLORA } from '../../shared/src/flora.js';
import { findEnvironment, evaluateEnv } from '../../shared/src/environment.js';
import { LOOK_VORGABE, pruefeLook } from '../../shared/src/lookProfil.js';
import { sanitizeWorldLayout } from '../../shared/src/worldlayout/sanitize.js';
import { REGION_VORLAGEN, wendeVorlageAn } from '../src/editor/regionsWerkzeuge.js';
import { fogVisibilityDistance } from '../src/engine/fogVisibility.js';

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
console.log('PASS: village palette, editor save round trip, daytime source values, fog modes');
