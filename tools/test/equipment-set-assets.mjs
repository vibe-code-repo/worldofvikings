/** Read-only HTTP check: no game login, accounts or inventory changes.
 * tsx tools/test/equipment-set-assets.mjs http://127.0.0.1/
 */
import assert from 'node:assert/strict';
import { equipmentSetCatalog } from '../../shared/src/equipmentSets.ts';

const base = new URL(process.argv[2]);
async function get(path) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}
const catalog = await (await get('/assets/equipment-sets.json')).json();
assert.deepEqual(catalog, equipmentSetCatalog(), 'Served catalog must match registered IDs');
const appearance = await (await get('/assets/appearance.json')).json();
assert.deepEqual(appearance.equipmentSets, catalog.sets, 'Character creation must receive the same item policies');
const preview = await (await get('/assets/js/vorschau.js')).text();
assert(preview.includes('hideAppearance'), 'Served preview must include per-item visibility support');
for (const tag of ['bodyVariant', 'bodyProfile', 'legacy-female-v1']) {
  assert(preview.includes(tag), `Served preview must include ${tag}`);
}
let itemCount = 0;
for (const set of catalog.sets) {
  for (const part of set.parts) {
    itemCount++;
    const model = Buffer.from(await (await get('/assets/models/' + part.model)).arrayBuffer());
    assert.equal(model.subarray(0, 4).toString(), 'glTF', part.model);
    assert.equal(model.readUInt32LE(4), 2, part.model);
    assert.equal(model.readUInt32LE(8), model.length, part.model);
    if (['seidraven','emberrage'].includes(set.familyId)) {
      const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString());
      const meshNodes = gltf.nodes.filter(node => node.mesh !== undefined);
      assert(meshNodes.length > 0, `${part.itemId}: renderable mesh nodes`);
      for (const node of meshNodes) {
        assert.equal(node.extras?.itemId, part.itemId);
        assert.equal(node.extras?.bodyVariant, part.bodyVariant);
        assert.equal(node.extras?.bodyProfile, part.bodyProfile);
        assert(part.regions.includes(node.extras?.replaces));
      }
      assert.deepEqual(part.hideAppearance, part.appearanceSlot === 'kopf' ? ['hair', 'beard', 'eyebrows'] : []);
    }
    const icon = Buffer.from(await (await get('/assets/sprites/' + part.icon)).arrayBuffer());
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', part.icon);
    if (set.familyId === 'emberrage') {
      assert.equal(part.vfxProfile, 'emberrage_red');
      const web = Buffer.from(await (await get('/assets/models/' + part.previewModel)).arrayBuffer());
      const doc = JSON.parse(web.subarray(20,20+web.readUInt32LE(12)));
      assert(doc.materials.some(m=>m.name === 'Emberrage_glow'));
      assert.equal(doc.skins[0].joints.length, set.figure === 'wikingerin' ? 63 : 71);
    }
  }
}
console.log(`PASS HTTP catalog and character-creation flags: ${catalog.sets.length} sets, ${itemCount} GLBs, ${itemCount} PNGs, body profiles, visibility tags and current preview; no login or inventory write`);
