/** Canonical-skin exporter: attachments and replacements, on tiny synthetic GLBs.
 * tsx tools/test/armor-export-attachment.mjs
 * No Blender, no assets, no network. An item whose `regions` are empty exports
 * the geometry named by `sourceRegions` and marks it `extras.attachment`
 * (the Wildwarden crown); it must not carry `extras.replaces`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tsx = join(root, 'node_modules/.bin/tsx');
const exporter = join(root, 'tools/export-ironward.mjs');

function glb(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const out = Buffer.alloc(28 + jsonChunk.length + binChunk.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20);
  const at = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, at); out.writeUInt32LE(0x004e4942, at + 4); binChunk.copy(out, at + 8);
  return out;
}
function parse(path) {
  const bytes = readFileSync(path), end = 20 + bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, end).toString());
}
/** Buffer views with 4-byte alignment; returns the views and the joined binary. */
function pack(parts) {
  const views = [], chunks = []; let offset = 0;
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.length });
    chunks.push(part, Buffer.alloc((4 - part.length % 4) % 4)); offset += part.length + (4 - part.length % 4) % 4;
  }
  return { views, bin: Buffer.concat(chunks) };
}
const floats = values => Buffer.from(new Float32Array(values).buffer);
const joints = ['Root', 'Hips', 'Neck'];
const jointNodes = () => joints.map((name, i) => ({ name, ...(i < 2 ? { children: [i + 1] } : {}) }));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// The game body: three joints and their bind matrices.
const bodyPack = pack([floats([...identity, ...identity, ...identity])]);
const body = glb({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: jointNodes(),
  skins: [{ joints: [0, 1, 2], skeleton: 0, inverseBindMatrices: 0 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'MAT4' }],
  bufferViews: bodyPack.views, buffers: [{ byteLength: bodyPack.bin.length }],
}, bodyPack.bin);

// The authored armor: one triangle, exposed as a crown node and a torso node.
const armorPack = pack([
  floats([0, 1.7, 0, .1, 1.7, 0, 0, 1.8, 0]),
  Buffer.from(new Uint16Array([0, 1, 2]).buffer),
  Buffer.from(new Uint8Array([2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0])),
  floats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  floats([...identity, ...identity, ...identity]),
]);
const armor = glb({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 3, 4] }],
  extensionsUsed: ['KHR_materials_emissive_strength'],
  nodes: [...jointNodes(), { name: 'WoV_Test_Crown', mesh: 0, skin: 0 }, { name: 'WoV_Test_Torso', mesh: 0, skin: 0 }],
  skins: [{ joints: [0, 1, 2], skeleton: 0, inverseBindMatrices: 4 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1, material: 0 }] }],
  materials: [{ name: 'Test_flat', pbrMetallicRoughness: { baseColorFactor: [.4, .3, .2, 1] },
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 1.7, 0], max: [.1, 1.8, 0] },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    { bufferView: 2, componentType: 5121, count: 3, type: 'VEC4' },
    { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    { bufferView: 4, componentType: 5126, count: 3, type: 'MAT4' },
  ],
  bufferViews: armorPack.views, buffers: [{ byteLength: armorPack.bin.length }],
}, armorPack.bin);

const scratch = mkdtempSync(join(tmpdir(), 'wov-armor-export-'));
try {
  writeFileSync(join(scratch, 'body.glb'), body);
  writeFileSync(join(scratch, 'armor.glb'), armor);
  const run = (name, parts) => {
    const equipment = { name: 'Test', prefix: 'WoV_Test_', hipsAlreadyFixed: true,
      bodyVariant: 'male', bodyProfile: 'wov-male-v1', parts };
    writeFileSync(join(scratch, `${name}.json`), JSON.stringify(equipment));
    const result = spawnSync(tsx, [exporter, join(scratch, 'armor.glb'), join(scratch, 'body.glb'),
      join(scratch, name), join(scratch, `${name}.json`)], { cwd: root, encoding: 'utf8' });
    return { ...result, dir: join(scratch, name) };
  };

  // 1. A crown that hides nothing next to a vest that replaces the torso.
  const good = run('good', [
    { item: 'test_crown', regions: [], sourceRegions: ['Crown'] },
    { item: 'test_vest', regions: ['Torso'] },
  ]);
  assert.equal(good.status, 0, `exporter failed:\n${good.stderr}`);
  const crown = parse(join(good.dir, 'test_crown.glb')), vest = parse(join(good.dir, 'test_vest.glb'));
  const crownNodes = crown.nodes.filter(n => n.mesh !== undefined), vestNodes = vest.nodes.filter(n => n.mesh !== undefined);
  assert.equal(crownNodes.length, 1, 'The crown item must export its Crown geometry');
  assert.equal(crownNodes[0].name, 'WoV_Test_Crown');
  assert.equal(crownNodes[0].extras.attachment, true, 'An item without replaced regions is an attachment');
  assert(!('replaces' in crownNodes[0].extras), 'An attachment must not name a replaced region');
  assert.equal(vestNodes.length, 1);
  assert.equal(vestNodes[0].extras.replaces, 'Torso');
  assert(!('attachment' in vestNodes[0].extras), 'A replacement is not an attachment');
  for (const [node, item] of [[crownNodes[0], 'test_crown'], [vestNodes[0], 'test_vest']]) {
    assert.equal(node.extras.itemId, item);
    assert.equal(node.extras.bodyVariant, 'male');
    assert.equal(node.extras.bodyProfile, 'wov-male-v1');
  }
  // What the exporter already promised for material extensions stays true.
  assert.deepEqual(crown.extensionsUsed, ['KHR_materials_emissive_strength']);
  assert.equal(crown.skins[0].joints.length, joints.length, 'Canonical skin must be carried over');
  const manifest = JSON.parse(readFileSync(join(good.dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.items.map(i => [i.item, i.regions.length, i.triangles]), [['test_crown', 0, 1], ['test_vest', 1, 1]]);

  // 2. Inconsistent equipment definitions must fail before anything is written.
  const noGeometry = run('nogeometry', [{ item: 'test_crown', regions: [] }]);
  assert.notEqual(noGeometry.status, 0);
  assert.match(noGeometry.stderr, /Every item needs export geometry/);
  const hiddenWithoutGeometry = run('hidden', [{ item: 'test_crown', regions: ['Head'], sourceRegions: ['Crown'] }]);
  assert.notEqual(hiddenWithoutGeometry.status, 0);
  assert.match(hiddenWithoutGeometry.stderr, /Every replaced region must have matching export geometry/);

  // 3. No source region may belong to two items (or twice to one): the same mesh would be drawn twice.
  const sharedSource = run('sharedsource', [
    { item: 'test_vest', regions: ['Torso'] },
    { item: 'test_crown', regions: [], sourceRegions: ['Torso'] },
  ]);
  assert.notEqual(sharedSource.status, 0);
  assert.match(sharedSource.stderr, /Source regions must belong to one item only: Torso/);
  assert(!existsSync(sharedSource.dir), 'A rejected definition must not write anything');
  const twiceInOne = run('twice', [{ item: 'test_crown', regions: [], sourceRegions: ['Crown', 'Crown'] }]);
  assert.notEqual(twiceInOne.status, 0);
  assert.match(twiceInOne.stderr, /Source regions must belong to one item only: Crown/);
  console.log('PASS canonical-skin exporter: crown exported as attachment (1 node, no replaces), vest replaces Torso, 4 invalid definitions rejected');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
