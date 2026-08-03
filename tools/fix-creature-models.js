// fix-creature-models.js — rettet Kreaturen-Modelle aus dem AssetRipper-Export.
//
// Hintergrund (Analyse 2026-07-25): die PrefabHierarchyObject-GLBs der Kreaturen
// haben ALLE kein eingebettetes Material ("Default-Material" ohne Textur), und
// fuer Boar/Greydwarf fehlt der Koerper komplett (nur Fangzaehne bzw. 2 Quads).
// Dieses Skript
//   1) injiziert diffuse+normal PNGs in Deer.glb (Backup: .bak),
//      Meshes ohne UV bekommen ein eigenes Uni-Material,
//   2) baut Deer_fixed.glb / Boar_fixed.glb / greydwarf_fixed.glb aus den
//      Bind-Space-Quellmeshes (Z-up -> Y-up gebacken, Skalierung gebacken,
//      JOINTS/WEIGHTS entfernt, Textur injiziert). Quellen bleiben unveraendert.
//      (Deer.glb selbst enthaelt nur die Geweihe — der Koerper kommt aus
//      "Deer 003.glb".)
//
// Aufruf: node tools/fix-creature-models.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS = path.join(ROOT, '..', 'valheim_browser_assets', 'models');
const EXPORT = path.join(ROOT, 'tools', 'assetripper', 'export', 'Assets');
const MALBERS = path.join(EXPORT, '3rd party', 'Malbers Animations', 'Animals Packs', '01 Forest Pack');

// ---------- GLB I/O ----------

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${file}`);
  const total = buf.readUInt32LE(8);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  let bin = Buffer.alloc(0);
  const off = 20 + jsonLen;
  if (off < total) {
    const binLen = buf.readUInt32LE(off);
    bin = Buffer.from(buf.subarray(off + 8, off + 8 + binLen));
  }
  return { json, bin, file };
}

function writeGlb(file, json, bin) {
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
  const binBuf = Buffer.concat([bin, binPad]);
  json.buffers[0].byteLength = binBuf.length;
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  const o = 20 + jsonBuf.length;
  out.writeUInt32LE(binBuf.length, o);
  out.writeUInt32LE(0x004e4942, o + 4);
  binBuf.copy(out, o + 8);
  fs.writeFileSync(file, out);
  console.log(`  geschrieben: ${file} (${Math.round(total / 1024)} KB)`);
}

// ---------- Accessor helpers ----------

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readComp(bin, type, off) {
  switch (type) {
    case 5120: return bin.readInt8(off);
    case 5121: return bin.readUInt8(off);
    case 5122: return bin.readInt16LE(off);
    case 5123: return bin.readUInt16LE(off);
    case 5125: return bin.readUInt32LE(off);
    case 5126: return bin.readFloatLE(off);
    default: throw new Error(`componentType ${type}`);
  }
}

function readAccessor(g, idx) {
  const acc = g.json.accessors[idx];
  const bv = g.json.bufferViews[acc.bufferView];
  const compSize = COMP_SIZE[acc.componentType];
  const nComp = TYPE_COUNT[acc.type];
  const stride = bv.byteStride || compSize * nComp;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const data = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    const v = new Array(nComp);
    for (let c = 0; c < nComp; c++) v[c] = readComp(g.bin, acc.componentType, o + c * compSize);
    data[i] = v;
  }
  return { data, componentType: acc.componentType, type: acc.type, count: acc.count };
}

// ---------- Texture injection ----------

function appendImage(g, pngPath) {
  const png = fs.readFileSync(pngPath);
  const pad = (4 - (g.bin.length % 4)) % 4;
  const byteOffset = g.bin.length + pad;
  g.bin = Buffer.concat([g.bin, Buffer.alloc(pad), png]);
  const bufferViews = (g.json.bufferViews ||= []);
  bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length });
  const images = (g.json.images ||= []);
  images.push({ mimeType: 'image/png', bufferView: bufferViews.length - 1, name: path.basename(pngPath, '.png') });
  const textures = (g.json.textures ||= []);
  textures.push({ source: images.length - 1 }); // default sampler = linear/repeat
  return textures.length - 1;
}

function makeTexturedMaterial(g, name, baseTex, normalTex) {
  const mat = {
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: baseTex },
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
  };
  if (normalTex !== undefined) mat.normalTexture = { index: normalTex };
  g.json.materials.push(mat);
  return g.json.materials.length - 1;
}

// ---------- Job 1: Deer.glb — Textur injizieren ----------

function fixDeer() {
  console.log('=== Deer.glb: Textur-Injektion ===');
  const file = path.join(MODELS, 'Deer.glb');
  const bak = file + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  const g = readGlb(file);

  // idempotent: alte Fix-Materialien entfernen waere komplex — stattdessen
  // immer vom Backup ausgehen, wenn es existiert.
  const src = fs.existsSync(bak) ? readGlb(bak) : g;

  const baseTex = appendImage(src, path.join(MALBERS, 'Deer', 'Textures', 'Deer Pixel.png'));
  const normTex = appendImage(src, path.join(MALBERS, 'Deer', 'Textures', 'Deer Pixel_n.png'));
  src.json.materials = [...(src.json.materials || [])];
  const texMat = makeTexturedMaterial(src, 'deer', baseTex, normTex);
  const solidMat = (src.json.materials.push({
    name: 'deer_solid',
    pbrMetallicRoughness: { baseColorFactor: [0.23, 0.16, 0.11, 1], metallicFactor: 0, roughnessFactor: 0.95 },
  }), src.json.materials.length - 1);

  for (const mesh of src.json.meshes) {
    for (const prim of mesh.primitives) {
      prim.material = prim.attributes.TEXCOORD_0 !== undefined ? texMat : solidMat;
    }
  }
  writeGlb(file, src.json, src.bin);
}

// ---------- Jobs 2+3: Boar / Greydwarf — Rebuild aus Bind-Space ----------

function rebuildFromBindSpace({ outName, srcFile, scale, basePng, normalPng, matName, stripDarkColor }) {
  console.log(`=== ${outName}.glb: Rebuild aus ${path.basename(srcFile)} (scale=${scale}) ===`);
  const g = readGlb(srcFile);
  const prim = g.json.meshes[0].primitives[0];
  const A = prim.attributes;

  const pos = readAccessor(g, A.POSITION);
  const nrm = A.NORMAL !== undefined ? readAccessor(g, A.NORMAL) : null;
  const tan = A.TANGENT !== undefined ? readAccessor(g, A.TANGENT) : null;
  const uv = A.TEXCOORD_0 !== undefined ? readAccessor(g, A.TEXCOORD_0) : null;
  if (uv && uv.componentType !== 5126) throw new Error(`TEXCOORD_0 componentType ${uv.componentType} nicht unterstuetzt`);
  let col = A.COLOR_0 !== undefined ? readAccessor(g, A.COLOR_0) : null;
  const idx = prim.indices !== undefined ? readAccessor(g, prim.indices) : null;

  // COLOR_0: bei dunklen Tints entfernen (normalisierte Bytes)
  if (col && stripDarkColor) {
    const norm = col.componentType === 5121 ? 1 / 255 : 1;
    let sum = 0;
    for (const v of col.data) sum += (v[0] + v[1] + v[2]) / 3 * norm;
    const mean = sum / col.count;
    console.log(`  COLOR_0 Mittelwert: ${mean.toFixed(3)}`);
    if (mean < 0.85) { console.log('  -> COLOR_0 wird entfernt (dunkler Tint)'); col = null; }
  } else if (col) {
    col = null; // generell entfernen, ausser explizit geprueft
  }

  // Z-up -> Y-up backen: (x,y,z) -> (s*x, s*z, -s*y)
  const xf = (v) => [scale * v[0], scale * v[2], -scale * v[1]];
  const positions = pos.data.map(xf);
  const normals = nrm ? nrm.data.map(xf) : null;
  const tangents = tan ? tan.data.map((v) => { const t = xf(v); return [t[0], t[1], t[2], v[3]]; }) : null;

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }

  // Bin neu aufbauen
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let binLen = 0;
  function pushFloatArray(flat, type) {
    const b = Buffer.alloc(flat.length * 4);
    flat.forEach((v, i) => b.writeFloatLE(v, i * 4));
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: b.length });
    chunks.push(b); binLen += b.length;
    const acc = { bufferView: bufferViews.length - 1, componentType: 5126, count: flat.length / TYPE_COUNT[type], type };
    accessors.push(acc);
    return accessors.length - 1;
  }
  function pushIndexArray(vals, componentType) {
    const size = COMP_SIZE[componentType];
    const b = Buffer.alloc(vals.length * size);
    vals.forEach((v, i) => { componentType === 5125 ? b.writeUInt32LE(v, i * 4) : b.writeUInt16LE(v, i * 2); });
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: b.length });
    chunks.push(b); binLen += b.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: vals.length, type: 'SCALAR' });
    return accessors.length - 1;
  }

  const attributes = {};
  attributes.POSITION = pushFloatArray(positions.flat(), 'VEC3');
  accessors[attributes.POSITION].min = min; accessors[attributes.POSITION].max = max;
  if (normals) attributes.NORMAL = pushFloatArray(normals.flat(), 'VEC3');
  if (tangents) attributes.TANGENT = pushFloatArray(tangents.flat(), 'VEC4');
  if (uv) attributes.TEXCOORD_0 = pushFloatArray(uv.data.flat(), 'VEC2');
  if (col) {
    const norm = col.componentType === 5121 ? 1 / 255 : 1;
    attributes.COLOR_0 = pushFloatArray(col.data.flat().map((v) => v * norm), 'VEC4');
  }
  let indicesAcc;
  if (idx) {
    indicesAcc = pushIndexArray(idx.data.map((v) => v[0]), idx.componentType);
  } else {
    indicesAcc = pushIndexArray([...Array(pos.count).keys()], 5125);
  }

  const json = {
    asset: { version: '2.0', generator: 'fix-creature-models.js (Bind-Space-Rettung)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: outName, mesh: 0 }],
    meshes: [{ name: outName, primitives: [{ attributes, indices: indicesAcc, material: 0 }] }],
    materials: [],
    bufferViews,
    accessors,
    buffers: [{ byteLength: 0 }],
  };
  const out = { json, bin: Buffer.concat(chunks) };

  const baseTex = appendImage(out, basePng);
  const normTex = normalPng ? appendImage(out, normalPng) : undefined;
  makeTexturedMaterial(out, matName, baseTex, normTex);

  writeGlb(path.join(MODELS, outName + '.glb'), json, out.bin);
  console.log(`  bbox nach Backen: B=${(max[0] - min[0]).toFixed(2)} H=${(max[1] - min[1]).toFixed(2)} T=${(max[2] - min[2]).toFixed(2)} m, y ${min[1].toFixed(2)}..${max[1].toFixed(2)}`);
}

// ---------- Job 5: Geweih in Deer_fixed.glb mergen ----------
//
// Der Koerper aus "Deer 003.glb" enthaelt kein Geweih (das sind im Unity-
// Prefab separate Attach-Meshes unter dem Head-Bone). Das original Deer.glb
// (.bak) enthaelt die 5 Geweih-Varianten samt Node-Transforms in Prefab-Space
// (Y-up, Hirsch ~1,79 m hoch) — derselbe Space wie der gebackene Koerper.
// Wir uebernehmen EINE Variante (Valheim-Hirsche haben grosses Geweih):
// Mesh-Daten mit der Node-Welt-Matrix transformieren und als zweites Mesh
// an Deer_fixed.glb anhaengen (Material "deer" wird geteilt).

function quatToMat4(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function nodeWorldMatrix(json, nodeIdx) {
  const parents = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parents[c] = i)));
  const chain = [];
  for (let j = nodeIdx; j !== -1; j = parents[j]) chain.unshift(j);
  let m = quatToMat4();
  for (const j of chain) {
    const n = json.nodes[j];
    m = mat4Mul(m, n.matrix || quatToMat4(n.translation, n.rotation, n.scale));
  }
  return m;
}
const xfPoint = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];
const xfDir = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

function mergeAntlers({ targetFile, bakFile, nodeName, matName }) {
  console.log(`=== ${path.basename(targetFile)}: Geweih "${nodeName}" mergen ===`);
  const bak = readGlb(bakFile);
  const nodeIdx = bak.json.nodes.findIndex((n) => n.name === nodeName && n.mesh !== undefined);
  if (nodeIdx < 0) throw new Error(`Node "${nodeName}" nicht in ${bakFile}`);
  const M = nodeWorldMatrix(bak.json, nodeIdx);
  const prim = bak.json.meshes[bak.json.nodes[nodeIdx].mesh].primitives[0];
  const A = prim.attributes;

  const pos = readAccessor(bak, A.POSITION).data.map((v) => xfPoint(M, v));
  const nrm = A.NORMAL !== undefined ? readAccessor(bak, A.NORMAL).data.map((v) => xfDir(M, v)) : null;
  const tan = A.TANGENT !== undefined
    ? readAccessor(bak, A.TANGENT).data.map((v) => { const t = xfDir(M, v); return [t[0], t[1], t[2], v[3]]; })
    : null;
  const uv = A.TEXCOORD_0 !== undefined ? readAccessor(bak, A.TEXCOORD_0).data : null;
  const idx = prim.indices !== undefined ? readAccessor(bak, prim.indices) : null;

  const g = readGlb(targetFile);
  const matIdx = g.json.materials.findIndex((m) => m.name === matName);
  if (matIdx < 0) throw new Error(`Material "${matName}" nicht in ${targetFile}`);

  function pushFloatArray(flat, type) {
    const b = Buffer.alloc(flat.length * 4);
    flat.forEach((v, i) => b.writeFloatLE(v, i * 4));
    const pad = (4 - (g.bin.length % 4)) % 4;
    g.bin = Buffer.concat([g.bin, Buffer.alloc(pad), b]);
    g.json.bufferViews.push({ buffer: 0, byteOffset: g.bin.length - b.length, byteLength: b.length });
    g.json.accessors.push({ bufferView: g.json.bufferViews.length - 1, componentType: 5126, count: flat.length / TYPE_COUNT[type], type });
    return g.json.accessors.length - 1;
  }
  function pushIndexArray(vals, componentType) {
    const size = COMP_SIZE[componentType];
    const b = Buffer.alloc(vals.length * size);
    vals.forEach((v, i) => { componentType === 5125 ? b.writeUInt32LE(v, i * 4) : b.writeUInt16LE(v, i * 2); });
    const pad = (4 - (g.bin.length % 4)) % 4;
    g.bin = Buffer.concat([g.bin, Buffer.alloc(pad), b]);
    g.json.bufferViews.push({ buffer: 0, byteOffset: g.bin.length - b.length, byteLength: b.length });
    g.json.accessors.push({ bufferView: g.json.bufferViews.length - 1, componentType, count: vals.length, type: 'SCALAR' });
    return g.json.accessors.length - 1;
  }

  const attributes = {};
  attributes.POSITION = pushFloatArray(pos.flat(), 'VEC3');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pos) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  g.json.accessors[attributes.POSITION].min = min;
  g.json.accessors[attributes.POSITION].max = max;
  if (nrm) attributes.NORMAL = pushFloatArray(nrm.flat(), 'VEC3');
  if (tan) attributes.TANGENT = pushFloatArray(tan.flat(), 'VEC4');
  if (uv) attributes.TEXCOORD_0 = pushFloatArray(uv.flat(), 'VEC2');
  const indicesAcc = idx
    ? pushIndexArray(idx.data.map((v) => v[0]), idx.componentType)
    : pushIndexArray([...Array(pos.length).keys()], 5125);

  g.json.meshes.push({ name: nodeName, primitives: [{ attributes, indices: indicesAcc, material: matIdx }] });
  g.json.nodes.push({ name: nodeName, mesh: g.json.meshes.length - 1 });
  g.json.scenes[g.json.scene || 0].nodes.push(g.json.nodes.length - 1);

  writeGlb(targetFile, g.json, g.bin);
  console.log(`  Geweih-BBox: y ${min[1].toFixed(2)}..${max[1].toFixed(2)}, z ${min[2].toFixed(2)}..${max[2].toFixed(2)} (${pos.length} Verts)`);
}

// ---------- run ----------

fixDeer();

// Job 4: Deer-Koerper — das originale Deer.glb enthaelt NUR die 5 Geweih-Meshes
// (AssetRipper hat den SkinnedMesh-Koerper gedroppt). Quelle "Deer 003.glb" ist
// der komplette Hirsch (inkl. Geweih) im Bind-Space, Z-up, Massstab 1:1.
rebuildFromBindSpace({
  outName: 'Deer_fixed',
  srcFile: path.join(MALBERS, 'Deer', 'Models', 'Deer 003.glb'),
  scale: 1,
  basePng: path.join(MALBERS, 'Deer', 'Textures', 'Deer Pixel.png'),
  normalPng: path.join(MALBERS, 'Deer', 'Textures', 'Deer Pixel_n.png'),
  matName: 'deer',
});

// Geweih-Variante 01 (828 Verts, mit UV) auf den Kopf setzen — Transforms
// kommen aus dem originalen Deer.glb.bak (Prefab-Space == Koerper-Space).
mergeAntlers({
  targetFile: path.join(MODELS, 'Deer_fixed.glb'),
  bakFile: path.join(MODELS, 'Deer.glb.bak'),
  nodeName: 'Antlers 01',
  matName: 'deer',
});

rebuildFromBindSpace({
  outName: 'Boar_fixed',
  srcFile: path.join(MALBERS, 'Boar', 'Models', 'Poly Art Boar_0.glb'),
  scale: 1,
  basePng: path.join(MALBERS, 'Boar', 'Textures', 'Boar_valheim_d.png'),
  normalPng: path.join(MALBERS, 'Boar', 'Textures', 'Boar_valheim_n.png'),
  matName: 'boar',
  stripDarkColor: true,
});

rebuildFromBindSpace({
  outName: 'greydwarf_fixed',
  srcFile: path.join(EXPORT, 'Characters', 'GreyDwarf', 'newmodel', 'Kakari.glb'),
  scale: 60, // 0,021 m Z-up-Rohdaten -> ~1,26 m Greydwarf
  basePng: path.join(EXPORT, 'Characters', 'GreyDwarf', 'Materials', 'greydrawrf_diffuse.png'),
  normalPng: path.join(EXPORT, 'Characters', 'GreyDwarf', 'Materials', 'greydrawrf_diffuse_nrm.png'),
  matName: 'greydwarf',
});

console.log('fertig.');
