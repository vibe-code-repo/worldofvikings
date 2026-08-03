/**
 * GLB size check — parses GLB files directly (no three/babylon needed) and
 * reports the world-space bounding box (node transforms applied) plus the
 * max node scale found in the hierarchy. Used to verify the fix for the
 * double-transform bug in the babylon client (trees rendered at 2× their
 * natural size because node scale was applied twice).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODELS_DIR = fileURLToPath(new URL('../assets/models/', import.meta.url));

function parseGlb(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const bin = b.slice(binStart);
  return { json, bin };
}

function nodeLocalMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    s[0] * (1 - (yy + zz)), s[0] * (xy - wz), s[0] * (xz + wy), 0,
    s[1] * (xy + wz), s[1] * (1 - (xx + zz)), s[1] * (yz - wx), 0,
    s[2] * (xz - wy), s[2] * (yz + wx), s[2] * (1 - (xx + yy)), 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  return o;
}

function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function measure(path) {
  const { json, bin } = parseGlb(path);
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const acc = json.accessors ?? [];
  const bv = json.bufferViews ?? [];

  function readPositions(ai) {
    const a = acc[ai];
    const v = bv[a.bufferView];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(off + i * 4);
    return out;
  }

  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  let maxNodeScale = 0;
  const scaledNodes = [];

  function walk(i, pm) {
    const n = nodes[i];
    const m = mul(pm, nodeLocalMatrix(n));
    const s = n.scale ? Math.max(...n.scale) : 1;
    if (n.scale && Math.max(...n.scale) > 1.01) {
      scaledNodes.push({ name: n.name, scale: n.scale });
      maxNodeScale = Math.max(maxNodeScale, Math.max(...n.scale));
    }
    if (n.mesh !== undefined) {
      for (const prim of meshes[n.mesh].primitives) {
        const pos = readPositions(prim.attributes.POSITION);
        for (let k = 0; k < pos.length; k += 3) {
          const w = xform(m, [pos[k], pos[k + 1], pos[k + 2]]);
          for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], w[a]);
            max[a] = Math.max(max[a], w[a]);
          }
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  }

  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, I);

  const size = max.map((v, i) => +(v - min[i]).toFixed(2));
  return { size, minY: +min[1].toFixed(2), scaledNodes };
}

const names = process.argv[2]
  ? process.argv.slice(2)
  : ['Beech1', 'Beech_small1', 'Beech_small2', 'FirTree', 'Birch1', 'Oak1', 'Pinetree_01'];

for (const name of names) {
  try {
    const r = measure(`${MODELS_DIR}${name}.glb`);
    console.log(
      `${name.padEnd(14)} W×H×D=${r.size.join(' × ')}  minY=${r.minY}  ` +
        `scaledNodes=${r.scaledNodes.map((s) => `${s.name}[${s.scale.join(',')}]`).join(' ') || 'none'}`
    );
  } catch (e) {
    console.log(`${name.padEnd(14)} ERR ${e.message}`);
  }
}
