// Reads real POSITION data from a GLB, computes true bbox, renders ASCII projections.
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;

function readPositions(prim) {
  const acc = j.accessors[prim.attributes.POSITION];
  const bv = j.bufferViews[acc.bufferView];
  const stride = bv.byteStride || 12;
  const base = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float32Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    out[i * 3] = buf.readFloatLE(base + i * stride);
    out[i * 3 + 1] = buf.readFloatLE(base + i * stride + 4);
    out[i * 3 + 2] = buf.readFloatLE(base + i * stride + 8);
  }
  return out;
}

let all = [];
for (const m of j.meshes || []) for (const p of m.primitives) {
  if (p.attributes.POSITION !== undefined) all.push(readPositions(p));
}
const n = all.reduce((s, a) => s + a.length / 3, 0);
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const a of all) for (let i = 0; i < a.length; i += 3)
  for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); }
console.log(`${file.split(/[\\/]/).pop()}: ${n} verts (real data)`);
console.log(`  X: ${lo[0].toFixed(3)} .. ${hi[0].toFixed(3)}  (${(hi[0] - lo[0]).toFixed(3)})`);
console.log(`  Y: ${lo[1].toFixed(3)} .. ${hi[1].toFixed(3)}  (${(hi[1] - lo[1]).toFixed(3)})`);
console.log(`  Z: ${lo[2].toFixed(3)} .. ${hi[2].toFixed(3)}  (${(hi[2] - lo[2]).toFixed(3)})`);

function ascii(axisA, axisB, label, W = 70, H = 22) {
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  const rangeA = hi[axisA] - lo[axisA] || 1, rangeB = hi[axisB] - lo[axisB] || 1;
  for (const a of all) for (let i = 0; i < a.length; i += 3) {
    const c = Math.min(W - 1, Math.floor((a[i + axisA] - lo[axisA]) / rangeA * W));
    const r = Math.min(H - 1, Math.floor((1 - (a[i + axisB] - lo[axisB]) / rangeB) * H));
    grid[r][c] = '#';
  }
  console.log(`  ${label}:`);
  for (const row of grid) console.log('  |' + row.join('') + '|');
}
const axes = ['X', 'Y', 'Z'];
ascii(2, 1, `Seitenansicht (${axes[2]}→, ${axes[1]}↑)`);
ascii(0, 2, `Draufsicht (${axes[0]}→, ${axes[2]}↓)`);
