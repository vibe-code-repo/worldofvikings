/**
 * D5 — the model table of loot, against the files on disk (needs assets; skipped in CI without them).
 *
 * For every item name that can lie on the ground: prefab with ITEM_DROP (own or neutral), and the model the client would load
 * (own model, or the fallback chest) exists as a `.glb` under `assets/models`. Prints the table name -> prefab -> model.
 *
 * Run: npx tsx client/test/d5-beute-modelle.ts   (from the repo root)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BEUTE_RUECKFALL_MODELL, ITEM_DEFS, PrefabFlag, beuteDarstellung, beutePrefabFuer, findPrefabByName } from '@wov/shared';

const wurzel = resolve(import.meta.dirname, '../..');
let fehler = 0;
const zeilen: string[] = [];
const gruppen = new Map<string, string[]>();
for (const it of ITEM_DEFS) {
  const p = beutePrefabFuer(it.name);
  const def = findPrefabByName(p);
  const dar = def ? beuteDarstellung(def) : null;
  const datei = dar ? resolve(wurzel, 'assets/models', `${dar.modell}.glb`) : '';
  const ok = !!def && (def.flags & PrefabFlag.ITEM_DROP) !== 0n && !!dar && existsSync(datei);
  if (!ok) { fehler++; console.log(`  FAIL  ${it.name}: prefab ${p}, model ${dar?.modell}, file ${datei}`); }
  const schluessel = `${p} -> ${dar?.modell} x${dar?.skala}`;
  gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), it.name]);
}
for (const [k, v] of gruppen) zeilen.push(`${k}: ${v.length} items (${v.slice(0, 6).join(', ')}${v.length > 6 ? ', ...' : ''})`);
// Z5 (N2): the real file. Bounding box of the fallback chest from the .glb itself (node tree with its transforms, POSITION
// accessor min/max: the same method as tools/asset-manifest.mjs), then the loot scale against it, and against the tracked manifest.
type Mat = number[];
const mul = (a: Mat, b: Mat): Mat => { const o = new Array<number>(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!; return o; };
const trs = (n: { matrix?: Mat; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat => {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]; const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1]; const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = qx! + qx!, y2 = qy! + qy!, z2 = qz! + qz!;
  const xx = qx! * x2, xy = qx! * y2, xz = qx! * z2, yy = qy! * y2, yz = qy! * z2, zz = qz! * z2, wx = qw! * x2, wy = qw! * y2, wz = qw! * z2;
  return [(1 - (yy + zz)) * sx!, (xy + wz) * sx!, (xz - wy) * sx!, 0, (xy - wz) * sy!, (1 - (xx + zz)) * sy!, (yz + wx) * sy!, 0, (xz + wy) * sz!, (yz - wx) * sz!, (1 - (xx + yy)) * sz!, 0, tx!, ty!, tz!, 1];
};
{
  const pfad = resolve(wurzel, 'assets/models', `${BEUTE_RUECKFALL_MODELL}.glb`);
  if (!existsSync(pfad)) {
    console.log(`  SKIP  ${pfad} is missing (no assets here)`);
  } else {
    const buf = readFileSync(pfad);
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as { nodes: Array<{ mesh?: number; children?: number[]; matrix?: Mat; translation?: number[]; rotation?: number[]; scale?: number[] }>; meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>; accessors: Array<{ min?: number[]; max?: number[] }>; scenes?: Array<{ nodes: number[] }>; scene?: number };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const geh = (ni: number, eltern: Mat): void => {
      const n = json.nodes[ni]!; const w = mul(eltern, trs(n));
      if (n.mesh !== undefined) for (const pr of json.meshes[n.mesh]!.primitives) {
        const a = json.accessors[pr.attributes.POSITION]!;
        for (let c = 0; c < 8; c++) {
          const e = [c & 1 ? a.max![0]! : a.min![0]!, c & 2 ? a.max![1]! : a.min![1]!, c & 4 ? a.max![2]! : a.min![2]!];
          const q = [w[0]! * e[0]! + w[4]! * e[1]! + w[8]! * e[2]! + w[12]!, w[1]! * e[0]! + w[5]! * e[1]! + w[9]! * e[2]! + w[13]!, w[2]! * e[0]! + w[6]! * e[1]! + w[10]! * e[2]! + w[14]!];
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, q[k]!); hi[k] = Math.max(hi[k]!, q[k]!); }
        }
      }
      for (const c of n.children ?? []) geh(c, w);
    };
    for (const ni of json.scenes?.[json.scene ?? 0]?.nodes ?? []) geh(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const skala = beuteDarstellung({ model: null }).skala;
    const kante = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
    console.log(`  chest box ${(hi[0]! - lo[0]!).toFixed(3)} x ${(hi[1]! - lo[1]!).toFixed(3)} x ${(hi[2]! - lo[2]!).toFixed(3)} m, min y ${lo[1]!.toFixed(3)}, scale ${skala}`);
    const z5 = (ok: boolean, text: string): void => { if (!ok) fehler++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`); };
    z5(lo[1]! * skala >= -0.02, `Z5: at the loot scale the chest does not sink into the ground (min y ${lo[1]!.toFixed(3)} x ${skala} >= -0.02 m)`);
    z5(kante * skala >= 0.25 && kante * skala <= 0.6, `Z5: the longest edge at the loot scale is ${(kante * skala).toFixed(3)} m (0.25 to 0.6)`);
    const m = (JSON.parse(readFileSync(resolve(wurzel, 'assets/manifest.json'), 'utf8')) as { modelle: Record<string, { huelle: { min: number[]; max: number[] } }> }).modelle[BEUTE_RUECKFALL_MODELL]!.huelle;
    z5([0, 1, 2].every((k) => Math.abs(m.min[k]! - lo[k]!) < 0.002 && Math.abs(m.max[k]! - hi[k]!) < 0.002), 'Z5: the tracked manifest (what the CI test uses) says the same as the file');
  }
}
console.log(zeilen.join('\n'));
console.log(`  ${ITEM_DEFS.length} item names checked`);
console.log(fehler === 0 ? '\nd5-beute-modelle: OK' : `\nd5-beute-modelle: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
