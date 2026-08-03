// Einmal-Skript: Welt-Transforms der 5 Geweih-Nodes im originalen Deer.glb.bak
// (Node-Tree traversieren, TRS akkumulieren, ohne three.js — reine Mat4-Mathe).
const fs = require('fs');

const buf = fs.readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

// minimal mat4 (column-major wie glTF)
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
function mul(a, b) { // a*b, column-major
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function nodeLocal(n) {
  if (n.matrix) return n.matrix;
  return compose(n.translation, n.rotation, n.scale);
}

const parents = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parents[c] = i)));

function world(i) {
  const chain = [];
  for (let j = i; j !== -1; j = parents[j]) chain.unshift(j);
  let m = compose();
  for (const j of chain) m = mul(m, nodeLocal(json.nodes[j]));
  return m;
}

json.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const m = world(i);
  // Spalten: X/Y/Z-Achse + Translation
  console.log(`"${n.name}"`);
  console.log(`  T = [${m[12].toFixed(4)}, ${m[13].toFixed(4)}, ${m[14].toFixed(4)}]`);
  const len = (c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]).toFixed(4);
  console.log(`  scale ~ [${len(0)}, ${len(1)}, ${len(2)}]`);
  console.log(`  Y-Achse = [${m[4].toFixed(3)}, ${m[5].toFixed(3)}, ${m[6].toFixed(3)}]`);
});
// Kopf-Knochen-Kandidaten: Namen mit "head"/"neck"
console.log('--- Knotennamen (head/neck/root) ---');
json.nodes.forEach((n, i) => {
  if (/head|neck|root|deer/i.test(n.name || '')) {
    const m = world(i);
    console.log(`"${n.name}" (node ${i}) T=[${m[12].toFixed(3)}, ${m[13].toFixed(3)}, ${m[14].toFixed(3)}]`);
  }
});
