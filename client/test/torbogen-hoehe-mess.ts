/**
 * MESSWERKZEUG, kein Test. Wie hoch ist die Oeffnung des Torbogens?
 *
 * `environment-sm-prop-archway-01` ist das einzige Store-Prefab mit einer
 * echten OEFFNUNG und `art: 'mesh'` (Kollision aus der Modellgeometrie
 * selbst, s. STORE_KOLLISIONSNETZ) — also das einzige, an dem eine
 * gewachsene Kapsel ueberhaupt anstossen kann.
 *
 * Gemessen wird mit senkrechten Strahlen durch das Netz: an jeder
 * Rasterstelle die Dreiecke sammeln, die der Strahl schneidet, und aus den
 * Schnitthoehen die groesste LUECKE unter dem ersten Deckendreieck lesen.
 * Der tiefste Punkt des Bogens ueber dem Durchgang ist die Antwort.
 *
 * Aufruf:  npx tsx client/test/torbogen-hoehe-mess.ts [pfad.glb]
 * (braucht `~/wov-assets/store` — das liegt ausserhalb des Repos.)
 */
import { readFileSync } from 'node:fs';

const PFAD = process.argv[2] ?? '/home/mike/wov-assets/store/environment/sm-prop-archway-01.glb';
const buf = readFileSync(PFAD);
// ── GLB lesen (Kopf 12 B, dann Chunks: JSON, BIN) ────────────────────
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('kein GLB');
let off = 12;
/* Das glTF-JSON ist Fremdformat; hier wird nur gelesen, was gebraucht
   wird. Ein Typ dafuer waere eine zweite Spezifikation. */
type GltfJson = {
  scene?: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{
    mesh?: number; children?: number[]; matrix?: number[];
    translation?: number[]; rotation?: number[]; scale?: number[];
  }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number }> }>;
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>;
  bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
};
let json: GltfJson | null = null;
let bin: Buffer | null = null;
while (off < buf.length) {
  const laenge = buf.readUInt32LE(off);
  const art = buf.readUInt32LE(off + 4);
  const daten = buf.subarray(off + 8, off + 8 + laenge);
  if (art === 0x4e4f534a) json = JSON.parse(daten.toString('utf8')) as GltfJson;
  else if (art === 0x004e4942) bin = daten;
  off += 8 + laenge + ((4 - (laenge % 4)) % 4);
}
if (!json || !bin) throw new Error('JSON- oder BIN-Chunk fehlt');

const KOMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as const;
const ZAHL = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;
function lies(idx: number): number[] {
  const a = json!.accessors[idx]!;
  const bv = json!.bufferViews[a.bufferView]!;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = ZAHL[a.type as keyof typeof ZAHL];
  const gr = KOMP[a.componentType as keyof typeof KOMP];
  const schritt = bv.byteStride ?? n * gr;
  const raus: number[] = [];
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const p = start + i * schritt + k * gr;
      raus.push(
        a.componentType === 5126 ? bin!.readFloatLE(p)
        : a.componentType === 5125 ? bin!.readUInt32LE(p)
        : a.componentType === 5123 ? bin!.readUInt16LE(p)
        : a.componentType === 5122 ? bin!.readInt16LE(p)
        : a.componentType === 5121 ? bin!.readUInt8(p)
        : bin!.readInt8(p)
      );
    }
  }
  return raus;
}

// Knotenhierarchie -> Weltmatrix (Spaltenweise wie glTF).
function mul(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let z = 0; z < 4; z++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + z]! * b[c * 4 + k]!;
    r[c * 4 + z] = s;
  }
  return r;
}
function knotenMatrix(n: GltfJson['nodes'][number]): number[] {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  for (let c = 0; c < 3; c++) for (let r0 = 0; r0 < 3; r0++) R[c * 4 + r0]! *= s[c]!;
  R[12] = t[0]; R[13] = t[1]; R[14] = t[2];
  return R;
}
const dreiecke: number[][] = [];
function gehe(idx: number, eltern: number[]): void {
  const n = json!.nodes[idx]!;
  const m = mul(eltern, knotenMatrix(n));
  if (n.mesh !== undefined) {
    for (const prim of json!.meshes[n.mesh]!.primitives) {
      if (prim.attributes.POSITION === undefined) continue;
      const pos = lies(prim.attributes.POSITION);
      const idxs = prim.indices !== undefined ? lies(prim.indices) : pos.map((_, i) => i / 3);
      const welt = (i: number): number[] => {
        const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
        return [
          x * m[0]! + y * m[4]! + z * m[8]! + m[12]!,
          x * m[1]! + y * m[5]! + z * m[9]! + m[13]!,
          x * m[2]! + y * m[6]! + z * m[10]! + m[14]!,
        ];
      };
      for (let i = 0; i + 2 < idxs.length; i += 3) {
        dreiecke.push([...welt(idxs[i]!), ...welt(idxs[i + 1]!), ...welt(idxs[i + 2]!)]);
      }
    }
  }
  for (const k of n.children ?? []) gehe(k, m);
}
for (const s of json!.scenes[json!.scene ?? 0]!.nodes) gehe(s, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const d of dreiecke) for (let i = 0; i < 9; i += 3) {
  minX = Math.min(minX, d[i]!); maxX = Math.max(maxX, d[i]!);
  minY = Math.min(minY, d[i + 1]!); maxY = Math.max(maxY, d[i + 1]!);
  minZ = Math.min(minZ, d[i + 2]!); maxZ = Math.max(maxZ, d[i + 2]!);
}
console.log(
  `${PFAD}\n  ${dreiecke.length} Dreiecke, Huellbox ` +
    `x ${minX.toFixed(2)}…${maxX.toFixed(2)}  y ${minY.toFixed(2)}…${maxY.toFixed(2)}  ` +
    `z ${minZ.toFixed(2)}…${maxZ.toFixed(2)}`
);

/** Schnitthoehen eines senkrechten Strahls bei (x,z). */
function treffer(x: number, z: number): number[] {
  const ys: number[] = [];
  for (const d of dreiecke) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = d as unknown as number[];
    // Baryzentrisch in der xz-Ebene.
    const d1 = (bz! - cz!) * (ax! - cx!) + (cx! - bx!) * (az! - cz!);
    if (Math.abs(d1) < 1e-12) continue;
    const l1 = ((bz! - cz!) * (x - cx!) + (cx! - bx!) * (z - cz!)) / d1;
    const l2 = ((cz! - az!) * (x - cx!) + (ax! - cx!) * (z - cz!)) / d1;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    ys.push(l1 * ay! + l2 * by! + l3 * cy!);
  }
  return ys.sort((a, b) => a - b);
}

/*
  Fuer jede Rasterstelle: vom Boden (minY) aufwaerts das erste Dreieck,
  das ueber Fusshoehe liegt. Ist unter ihm nichts, ist die Stelle ein
  DURCHGANG, und der Abstand Boden->Dreieck ist die lichte Hoehe.
*/
const SCHRITT = 0.05;
let besteHoehe = -Infinity, besteStelle = '';
let offen = 0, gesamt = 0;
for (let x = minX + SCHRITT; x < maxX; x += SCHRITT) {
  for (let z = minZ + SCHRITT; z < maxZ; z += SCHRITT) {
    const ys = treffer(x, z);
    gesamt += 1;
    if (ys.length === 0) continue;
    const unterste = ys[0]!;
    // Boden der Stelle: das tiefste Dreieck; darueber die naechste Flaeche.
    const daueber = ys.find((y) => y > unterste + 0.3);
    if (daueber === undefined) continue; // massiver Pfosten, kein Durchgang
    const lichte = daueber - unterste;
    if (lichte < 0.5) continue;
    offen += 1;
    if (lichte > besteHoehe) { besteHoehe = lichte; besteStelle = `${x.toFixed(2)}/${z.toFixed(2)}`; }
  }
}
console.log(
  `  Rasterstellen ${gesamt}, davon mit Luecke ueber dem Boden ${offen}; ` +
    `groesste lichte Hoehe ${besteHoehe === -Infinity ? '—' : `${besteHoehe.toFixed(3)} m bei ${besteStelle}`}`
);

/*
  Der eigentliche Durchgang. Das Modell bringt KEINEN Boden mit (Huellbox
  y ab 0,00) — die lichte Hoehe ist deshalb der Abstand von y = 0 bis zum
  TIEFSTEN Dreieck ueber dem Boden. Abgetastet wird der Streifen, den eine
  Figur mit KOERPER_RADIUS 0,4 beim Durchschreiten wirklich belegt.
*/
const profil: Array<[number, number]> = [];
for (let x = minX; x <= maxX + 1e-9; x += SCHRITT) {
  let hier = Infinity;
  for (let z = minZ; z <= maxZ + 1e-9; z += SCHRITT) {
    const ys = treffer(x, z).filter((y) => y > 0.02);
    if (ys.length === 0) continue;
    if (ys[0]! < hier) hier = ys[0]!;
  }
  if (hier === Infinity) continue;       // hier steht nichts -> offen bis oben
  profil.push([x, hier]);
}
console.log('  Hoehenprofil der Unterkante (x -> lichte Hoehe, alle 0,10 m):');
{
  let zeile = '';
  for (let i = 0; i < profil.length; i += 2) {
    const [x, h] = profil[i]!;
    zeile += `${x.toFixed(2)}:${h.toFixed(2)}  `;
  }
  console.log('   ' + zeile.trim());
}

/*
  Die eigentliche Frage: Wie breit ist der Korridor, durch den eine Kapsel
  von 0,8 m Breite kommt — mit der ALTEN Hoehe 1,8 und mit der NEUEN 2,0?
  Gemessen als die breiteste zusammenhaengende Spanne in x, in der die
  lichte Hoehe ueber der jeweiligen Kapselhoehe liegt.
*/
function korridor(hoehe: number): { breite: number; von: number; bis: number } {
  let besteBreite = 0, besteVon = 0, besteBis = 0;
  let laufVon: number | null = null;
  for (let i = 0; i < profil.length; i++) {
    const [x, h] = profil[i]!;
    if (h >= hoehe) {
      if (laufVon === null) laufVon = x;
    } else if (laufVon !== null) {
      const b = profil[i - 1]![0] - laufVon;
      if (b > besteBreite) { besteBreite = b; besteVon = laufVon; besteBis = profil[i - 1]![0]; }
      laufVon = null;
    }
  }
  if (laufVon !== null) {
    const b = profil[profil.length - 1]![0] - laufVon;
    if (b > besteBreite) { besteBreite = b; besteVon = laufVon; besteBis = profil[profil.length - 1]![0]; }
  }
  return { breite: besteBreite, von: besteVon, bis: besteBis };
}
for (const h of [1.8, 2.0, 2.1]) {
  const k = korridor(h);
  console.log(
    `  Kapselhoehe ${h.toFixed(2)} m: freier Korridor ${k.breite.toFixed(2)} m breit ` +
      `(x ${k.von.toFixed(2)} … ${k.bis.toFixed(2)}) — Kapsel ist 0,80 m breit, ` +
      `${k.breite >= 0.8 ? 'passt' : 'PASST NICHT'}`
  );
}
const unter21 = profil.filter(([, h]) => h < 2.1);
const unter20 = profil.filter(([, h]) => h < 2.0);
console.log(
  `  Stellen mit lichter Hoehe < 2,10 m: ${unter21.length} von ${profil.length} ` +
    `(x ${unter21.map(([x]) => x.toFixed(2)).join(', ') || '—'})`
);
console.log(
  `  Stellen mit lichter Hoehe < 2,00 m: ${unter20.length} ` +
    `(niedrigste ${unter20.length ? Math.min(...unter20.map(([, h]) => h)).toFixed(3) + ' m' : '—'})`
);
