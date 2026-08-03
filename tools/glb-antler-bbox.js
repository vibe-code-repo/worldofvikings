// Einmal-Skript: Geweih-Welt-BBox im Deer.glb.bak-Kontext pruefen.
// Liest mesh[k] POSITION, wendet die Node-Welt-Matrix an, gibt BBox aus.
const fs = require('fs');

const buf = fs.readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binOff = 20 + jsonLen + 8;
const bin = buf.subarray(binOff);

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(ai) {
  const a = json.accessors[ai];
  const bv = json.bufferViews[a.bufferView];
  const T = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    const el = [];
    for (let c = 0; c < n; c++) {
      const dv = new DataView(bin.buffer, bin.byteOffset + o + c * T.BYTES_PER_ELEMENT);
      el.push(a.componentType === 5126 ? dv.getFloat32(0, true) : a.componentType === 5125 ? dv.getUint32(0, true) : a.componentType === 5123 ? dv.getUint16(0, true) : dv.getUint8(0, true));
    }
    out.push(el);
  }
  return out;
}

function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
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
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const parents = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parents[c] = i)));
function world(i) {
  const chain = [];
  for (let j = i; j !== -1; j = parents[j]) chain.unshift(j);
  let m = compose();
  for (const j of chain) m = mul(m, json.nodes[j].matrix || compose(json.nodes[j].translation, json.nodes[j].rotation, json.nodes[j].scale));
  return m;
}
const xform = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];

json.nodes.forEach((n, ni) => {
  if (n.mesh === undefined) return;
  const m = world(ni);
  const pos = readAccessor(json.meshes[n.mesh].primitives[0].attributes.POSITION);
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const v of pos) {
    const w = xform(m, v);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
  }
  console.log(`"${n.name}" Welt-BBox: x ${min[0].toFixed(2)}..${max[0].toFixed(2)}  y ${min[1].toFixed(2)}..${max[1].toFixed(2)}  z ${min[2].toFixed(2)}..${max[2].toFixed(2)}`);
});
