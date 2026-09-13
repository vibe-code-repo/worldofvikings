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
for (const set of catalog.sets) {
  for (const part of set.parts) {
    const model = Buffer.from(await (await get('/assets/models/' + part.model)).arrayBuffer());
    assert.equal(model.subarray(0, 4).toString(), 'glTF', part.model);
    assert.equal(model.readUInt32LE(4), 2, part.model);
    assert.equal(model.readUInt32LE(8), model.length, part.model);
    const icon = Buffer.from(await (await get('/assets/sprites/' + part.icon)).arrayBuffer());
    assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', part.icon);
  }
}
console.log('PASS HTTP catalog: 3 sets, 21 GLBs, 21 PNGs; no player login or inventory write');
