#!/usr/bin/env node
/**
 * glb-anim-probe — wertet die Animationen einer GLB aus und zeigt, was die
 * Knochen tatsächlich tun.
 *
 * Gedacht als Gegenprobe für tools/mixamo-to-avatar.mjs: Nach dem Einbau
 * eines Clips muss die Figur sich noch so bewegen wie in der Quelle. Statt
 * das im Bild zu beurteilen, rechnet dieses Werkzeug die Vorwärtskinematik
 * selbst und gibt messbare Größen aus — Schrittweite der Füße, Ausschlag
 * der Hände, Höhe der Hüfte. Ein kaputtes Retargeting fällt daran sofort
 * auf: Füße, die sich nicht bewegen, oder Gliedmaßen, die durch den Boden
 * schlagen.
 *
 *   node tools/glb-anim-probe.mjs assets/models/PlayerAvatar.glb [clip]
 */
import fs from 'node:fs';

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function leseGlb(datei) {
  const buf = fs.readFileSync(datei);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), typ = buf.readUInt32LE(off + 4);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (typ === 0x4e4f534a) json = JSON.parse(d.toString('utf8'));
    else if (typ === 0x004e4942) bin = d;
    off += 8 + len;
  }
  return { json, bin };
}

function accessor({ json, bin }, i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const T = CT[a.componentType];
  const n = NC[a.type];
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  // Kopieren statt Sicht: der Binärteil ist nicht zwingend 4-Byte-ausgerichtet.
  const roh = bin.subarray(start, start + a.count * n * T.BYTES_PER_ELEMENT);
  return new T(new Uint8Array(roh).buffer, 0, a.count * n);
}

// ── Quaternion-/Matrixrechnung (nur was gebraucht wird) ────────────────
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
/** Dreht v um die Einheitsquaternion q. */
const qRot = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) {
    const r = a.map((v, i) => v + (bb[i] - v) * t);
    const l = Math.hypot(...r);
    return r.map((v) => v / l);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
  return a.map((v, i) => v * w1 + bb[i] * w2);
};

const datei = process.argv[2];
const wunsch = process.argv[3];
const glb = leseGlb(datei);
const { json } = glb;

const eltern = new Map();
json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => eltern.set(c, i)));
const idxVon = new Map();
json.nodes.forEach((n, i) => { if (n.name && !idxVon.has(n.name)) idxVon.set(n.name, i); });

/** Ruhepose je Knoten. */
const ruhe = json.nodes.map((n) => ({
  t: n.translation ?? [0, 0, 0],
  r: n.rotation ?? [0, 0, 0, 1],
  s: n.scale ?? [1, 1, 1],
}));

/** Sampelt eine Animation zum Zeitpunkt t: liefert lokale TRS je Knoten. */
function poseZu(anim, zeit) {
  const pose = ruhe.map((r) => ({ t: [...r.t], r: [...r.r] }));
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const zeiten = accessor(glb, s.input);
    const werte = accessor(glb, s.output);
    const n = ch.target.path === 'rotation' ? 4 : 3;
    // Keyframe-Paar suchen (die Clips sind kurz, lineare Suche genügt).
    let i = 0;
    while (i < zeiten.length - 2 && zeiten[i + 1] < zeit) i++;
    const t0 = zeiten[i], t1 = zeiten[Math.min(i + 1, zeiten.length - 1)];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (zeit - t0) / (t1 - t0))) : 0;
    const a = Array.from(werte.slice(i * n, i * n + n));
    const b = Array.from(werte.slice((i + 1) * n, (i + 1) * n + n));
    if (b.length < n) { if (ch.target.path === 'rotation') pose[ch.target.node].r = a; else if (ch.target.path === 'translation') pose[ch.target.node].t = a; continue; }
    if (ch.target.path === 'rotation') pose[ch.target.node].r = slerp(a, b, f);
    else if (ch.target.path === 'translation') pose[ch.target.node].t = a.map((v, k) => v + (b[k] - v) * f);
  }
  return pose;
}

/** Weltposition eines Knotens per Vorwärtskinematik. */
function weltPos(pose, idx) {
  const kette = [];
  for (let i = idx; i !== undefined; i = eltern.get(i)) kette.unshift(i);
  let p = [0, 0, 0], q = [0, 0, 0, 1];
  for (const i of kette) {
    p = p.map((v, k) => v + qRot(q, pose[i].t)[k]);
    q = qMul(q, pose[i].r);
  }
  return p;
}

const PROBEN = ['L_Foot', 'R_Foot', 'L_Hand', 'R_Hand', 'Head', 'Hip'];
console.log(`${datei}\n${json.animations?.length ?? 0} Clips, ${json.nodes.length} Nodes\n`);

for (const anim of json.animations ?? []) {
  if (wunsch && anim.name !== wunsch) continue;
  let dauer = 0;
  for (const s of anim.samplers) {
    const z = accessor(glb, s.input);
    dauer = Math.max(dauer, z[z.length - 1]);
  }
  const SCHRITTE = 16;
  const spur = new Map(PROBEN.map((n) => [n, []]));
  for (let k = 0; k < SCHRITTE; k++) {
    const pose = poseZu(anim, (k / SCHRITTE) * dauer);
    for (const name of PROBEN) {
      const i = idxVon.get(name);
      if (i !== undefined) spur.get(name).push(weltPos(pose, i));
    }
  }
  console.log(`── "${anim.name}"  ${dauer.toFixed(2)} s, ${anim.channels.length} Kanäle`);
  for (const [name, punkte] of spur) {
    if (!punkte.length) { console.log(`   ${name.padEnd(8)} —`); continue; }
    const min = [0, 1, 2].map((a) => Math.min(...punkte.map((p) => p[a])));
    const max = [0, 1, 2].map((a) => Math.max(...punkte.map((p) => p[a])));
    const spanne = [0, 1, 2].map((a) => max[a] - min[a]);
    console.log(`   ${name.padEnd(8)} Ausschlag x/y/z: ` +
      spanne.map((v) => v.toFixed(3)).join(' / ') +
      `   Höhe ${min[1].toFixed(3)}…${max[1].toFixed(3)}`);
  }
  console.log();
}
