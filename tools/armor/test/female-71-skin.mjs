/** Wikingerin 71 Rüstung (2026-09-27): the female armor sets moved from the retired 51-bone legacy body to the
 * game's 71-bone canonical body (bodyProfile wov-female-v1, same rig as the male body). Proves two things real
 * assets alone can prove and the synthetic skin-gate-selftest.mjs cannot:
 * 1. `assets/models/wikingerin/WikingerinKoerper.glb` really is the new 71-bone body (not the old 51-bone one:
 *    the whole point of the card was replacing it), and every female set's item GLBs under `assets/models/<set>/`
 *    carry the exact same skin joints, in the same order, as that real body file -- not synthetic fixtures.
 * 2. `canWearArmor` treats the new profile as wearable and the retired one as not, for the real, shipped
 *    FEMALE_ARMOR_BODY constant (server/test/armor-body-variants.ts already proves this against a synthetic
 *    policy; this one exercises the same claim end-to-end against the real files on disk).
 * Needs assets/models/wikingerin/WikingerinKoerper.glb and assets/models/<set>/<set>_female_*.glb; skipped by
 * scripts/run-tests.mjs's brauchtModelle when they are not present (CI: WOV_OHNE_MODELLE=1).
 * Lauf: node_modules/.bin/tsx tools/armor/test/female-71-skin.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canWearArmor, FEMALE_ARMOR_BODY, RUESTUNG } from '@wov/shared';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bodyPath = join(root, 'assets/models/wikingerin/WikingerinKoerper.glb');

function jointNames(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${path}: not a GLB`);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const skin = json.skins?.[0];
  assert(skin, `${path}: no skin`);
  return skin.joints.map(i => json.nodes[i].name);
}

const bodyJoints = jointNames(bodyPath);
// The whole point of the card: the old body had 51 bones (a different rig); the new one has 71,
// the same skeleton as the male body. This is the assertion that would have been red before the card's export.
assert.equal(bodyJoints.length, 71, `assets/models/wikingerin/WikingerinKoerper.glb: expected the new 71-bone ` +
  `body, found ${bodyJoints.length} bones -- is this still the retired 51-bone one?`);

const families = [...new Set(RUESTUNG.filter(p => p.datei.includes('/') && p.bodyVariant === 'female').map(p => p.datei.split('/')[0]))];
assert(families.length >= 5, `expected at least 5 registered female families, found ${families.length}: ${families.join(', ')}`);

let checked = 0;
for (const family of families) {
  const dir = join(root, 'assets/models', family);
  const parts = RUESTUNG.filter(p => p.datei.startsWith(`${family}/`) && p.bodyVariant === 'female');
  assert(parts.length > 0, `${family}: no registered female parts`);
  for (const part of parts) {
    const item = part.datei.split('/')[1];
    const itemPath = join(dir, `${item}.glb`);
    const itemJoints = jointNames(itemPath);
    assert.deepEqual(itemJoints, bodyJoints,
      `${family}/${item}: skin joints differ from assets/models/wikingerin/WikingerinKoerper.glb (names or order)`);
    checked++;
  }
}
console.log(`PASS: ${checked} female item GLBs across ${families.length} families carry the exact ` +
  `71-joint skin of the real WikingerinKoerper.glb (names and order)`);

// canWearArmor, exercised against the real, shipped policy constant, not a synthetic one: the new profile is
// wearable, the retired one is not (server/test/armor-body-variants.ts proves the same claim synthetically;
// this only additionally pins that FEMALE_ARMOR_BODY itself, as shipped, still says wov-female-v1).
assert.equal(FEMALE_ARMOR_BODY.bodyProfile, 'wov-female-v1',
  'FEMALE_ARMOR_BODY.bodyProfile must be the new profile, not the retired legacy-female-v1');
assert(canWearArmor(FEMALE_ARMOR_BODY, 'wikingerin'), 'the new profile must be wearable by the Wikingerin figure');
assert(!canWearArmor({ ...FEMALE_ARMOR_BODY, bodyProfile: 'legacy-female-v1' }, 'wikingerin'),
  'the retired legacy-female-v1 profile must no longer be wearable, even for the same figure/variant');
console.log('PASS: canWearArmor accepts wov-female-v1 and rejects the retired legacy-female-v1 for the Wikingerin');
