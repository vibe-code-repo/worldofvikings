/** Export the approved v3 armor against the exact running game's skin.
 * Usage: tsx tools/export-ironward.mjs armor.glb body.glb output-directory
 * Source files are read-only. Outputs are seven independent replacement items.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { IRONWARD_PARTS } from '../shared/src/ironward.ts';

const [armorPath, bodyPath, destination] = process.argv.slice(2);
assert(armorPath && bodyPath && destination, 'Expected armor.glb body.glb output-directory');
const clone = v => JSON.parse(JSON.stringify(v));
const hash = b => createHash('sha256').update(b).digest('hex');
function read(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const end = 20 + bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, end).toString());
  assert.equal(bytes.readUInt32LE(end + 4), 0x004e4942);
  return { json, bin: bytes.subarray(end + 8), hash: hash(bytes) };
}
const source = read(armorPath), body = read(bodyPath);
const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function packed(doc, index) {
  const a = doc.json.accessors[index];
  assert(!a.sparse, 'Sparse accessors need an explicit conversion');
  const view = doc.json.bufferViews[a.bufferView];
  const size = componentBytes[a.componentType] * components[a.type];
  const result = Buffer.alloc(a.count * size);
  for (let i = 0; i < a.count; i++) {
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? size);
    doc.bin.copy(result, i * size, start, start + size);
  }
  return result;
}
const canonicalSkin = body.json.skins[0], sourceSkin = source.json.skins[0];
const names = canonicalSkin.joints.map(i => body.json.nodes[i].name);
const oldNames = sourceSkin.joints.map(i => source.json.nodes[i].name);
const remap = oldNames.map(n => names.indexOf(n));
assert(remap.every(i => i >= 0), 'All source joints must exist in the game rig');
assert.equal(new Set(names).size, names.length, 'Ambiguous joint names');
const outDir = resolve(destination);
mkdirSync(outDir, { recursive: true });
const report = { version: 1, sourceSha256: source.hash, bodySha256: body.hash, joints: names, items: [] };
for (const part of IRONWARD_PARTS) {
  const doc = { asset: { version: '2.0', generator: 'WoV Ironward canonical-skin exporter v1' },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let offset = 0, corrected = 0, triangles = 0;
  function addAccessor(input, index, bytes = packed(input, index)) {
    const a = clone(input.json.accessors[index]);
    const pad = (4 - offset % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    a.bufferView = doc.bufferViews.length; a.byteOffset = 0;
    doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    offset += bytes.length; chunks.push(bytes); doc.accessors.push(a);
    return doc.accessors.length - 1;
  }
  // Canonical hierarchy AND bind matrices; name matching alone is insufficient.
  const nodeMap = new Map();
  body.json.nodes.forEach((n, i) => {
    if (n.mesh !== undefined) return;
    nodeMap.set(i, doc.nodes.length); const c = clone(n); delete c.extras; doc.nodes.push(c);
  });
  for (const n of doc.nodes) if (n.children) n.children = n.children.filter(i => nodeMap.has(i)).map(i => nodeMap.get(i));
  doc.scenes[0].nodes = body.json.scenes[body.json.scene ?? 0].nodes.filter(i => nodeMap.has(i)).map(i => nodeMap.get(i));
  const skin = clone(canonicalSkin);
  skin.joints = skin.joints.map(i => nodeMap.get(i));
  if (skin.skeleton !== undefined) skin.skeleton = nodeMap.get(skin.skeleton);
  skin.inverseBindMatrices = addAccessor(body, canonicalSkin.inverseBindMatrices);
  doc.skins.push(skin);
  const materialMap = new Map();
  for (const region of part.regions) {
    const node = source.json.nodes.find(n => n.name === `WoV_Ironward_${region}`);
    assert(node && node.mesh !== undefined, `Missing region ${region}`);
    assert(!node.matrix && !node.translation && !node.rotation && !node.scale, 'Mesh must be in world rest coordinates');
    const mesh = { name: node.name, primitives: [] };
    for (const primitive of source.json.meshes[node.mesh].primitives) {
      assert(!primitive.targets && !primitive.extensions, 'Unexpected geometry extension');
      const p = { attributes: {}, indices: addAccessor(source, primitive.indices) };
      triangles += source.json.accessors[primitive.indices].count / 3;
      const mat = source.json.materials[primitive.material];
      if (!materialMap.has(primitive.material)) {
        materialMap.set(primitive.material, doc.materials.length); doc.materials.push(clone(mat));
      }
      p.material = materialMap.get(primitive.material);
      for (const [semantic, index] of Object.entries(primitive.attributes)) {
        // The approved asset has flat materials, so unused UVs are omitted.
        if (semantic.startsWith('TEXCOORD_')) continue;
        let bytes = packed(source, index);
        if (semantic === 'JOINTS_0') {
          const a = source.json.accessors[index];
          assert([5121, 5123].includes(a.componentType));
          const width = componentBytes[a.componentType];
          const positions = packed(source, primitive.attributes.POSITION);
          for (let v = 0; v < a.count; v++) for (let k = 0; k < 4; k++) {
            const at = (v * 4 + k) * width;
            const old = bytes.readUIntLE(at, width); let joint = remap[old];
            // Neutral source's Hips lining has reversed upper-leg groups.
            // Plates are already correct. Correct only that cloth primitive.
            if (region === 'Hips' && mat.name === 'Ironward_cloth' && /^UpperLeg_[LR]$/.test(oldNames[old])) {
              const expected = names.indexOf(positions.readFloatLE(v * 12) > 0 ? 'UpperLeg_L' : 'UpperLeg_R');
              if (joint !== expected) { joint = expected; corrected++; }
            }
            bytes.writeUIntLE(joint, at, width);
          }
        }
        const copied = addAccessor(source, index, bytes);
        if (semantic.startsWith('JOINTS')) { delete doc.accessors[copied].min; delete doc.accessors[copied].max; }
        p.attributes[semantic] = copied;
      }
      mesh.primitives.push(p);
    }
    doc.scenes[0].nodes.push(doc.nodes.length);
    doc.nodes.push({ name: node.name, mesh: doc.meshes.length, skin: 0, extras: { replaces: region } });
    doc.meshes.push(mesh);
  }
  const bin = Buffer.concat(chunks); doc.buffers.push({ byteLength: bin.length });
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 32), binPad = Buffer.alloc((4 - bin.length % 4) % 4);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPad.length + bin.length + binPad.length, 8);
  header.writeUInt32LE(json.length + jsonPad.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length + binPad.length); binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, json, jsonPad, binHeader, bin, binPad]);
  const file = `${part.item}.glb`;
  assert(![resolve(armorPath), resolve(bodyPath)].includes(join(outDir, file)));
  writeFileSync(join(outDir, file), output);
  report.items.push({ ...part, file, triangles, bytes: output.length, sha256: hash(output), correctedHipJointEntries: corrected });
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.items.map(({ item, triangles, bytes, correctedHipJointEntries }) => ({ item, triangles, bytes, correctedHipJointEntries })), null, 2));
