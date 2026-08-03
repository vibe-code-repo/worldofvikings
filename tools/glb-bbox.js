// Scene-space bbox of a GLB: walks node tree, transforms accessor min/max corners.
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

function matMul(a, b) { // 4x4 col-major
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trsToMat(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1];
}
function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
let meshCount = 0, vertTotal = 0;
function walk(ni, parent) {
  const n = j.nodes[ni];
  const world = matMul(parent, trsToMat(n));
  if (n.mesh !== undefined) {
    for (const p of j.meshes[n.mesh].primitives) {
      const acc = j.accessors[p.attributes.POSITION];
      vertTotal += acc.count; meshCount++;
      if (acc.min && acc.max) {
        for (let c = 0; c < 8; c++) {
          const corner = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
          const w = xform(world, corner);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
        }
      }
    }
  }
  for (const c of n.children || []) walk(c, world);
}
for (const ni of j.scenes[j.scene ?? 0].nodes) walk(ni, I);
const size = hi.map((v, i) => v - lo[i]);
console.log(`${file.split(/[\\/]/).pop()}: meshes=${meshCount} verts=${vertTotal}`);
console.log(`  bbox BxHxT = ${size.map(v => v.toFixed(2)).join(' x ')} m`);
console.log(`  y range: ${lo[1].toFixed(2)} .. ${hi[1].toFixed(2)}`);
