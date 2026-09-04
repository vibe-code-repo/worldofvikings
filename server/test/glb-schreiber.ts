/**
 * E2 — Wächter über den GLB-Schreiber `server/src/world/dungeon/GlbWriter.ts`.
 *
 * ── Was hier bewiesen wird und warum es nicht selbstverständlich ist ──
 * Der Schreiber macht aus der Quaderliste von E1 eine glTF-2.0-Binärdatei.
 * Er ersetzt damit den Blender-Export — und darf das nur, wenn sein
 * Erzeugnis dem Blender-Erzeugnis in allem gleicht, worauf der Client
 * baut. Drei dieser Eigenschaften sind unsichtbar, solange man nur
 * hinsieht:
 *
 *   (1) DIE VORSPIEGELUNG. Alle Steingrab-Module tragen negatives
 *       signiertes Volumen: die Geometrie ist in x gespiegelt, OHNE dass
 *       die Flächenwicklung mitgedreht wurde; Babylons `__root__`
 *       (scale.x = -1) dreht sie im Spiel zurück. Ein Schreiber, der die
 *       Wicklung „aufräumt", liefert ein Modul, das im Spiel von aussen
 *       sichtbar und von innen unsichtbar ist. Alle fünf Säle sind
 *       punktsymmetrisch — kein einziger Eckpunkt verschöbe sich dabei.
 *       Der einzige Zeuge ist das Vorzeichen des Volumenintegrals.
 *
 *   (2) DIE GESCHLOSSENHEIT. Das Volumenintegral ist nur dann gleich der
 *       Summe der Quadervolumen, wenn jeder Quader wirklich mit sechs
 *       geschlossenen Flächen ausgegeben wird. Eine vergessene Fläche,
 *       ein vertauschter Index, ein doppelt gezähltes Dreieck — alles
 *       ändert den BETRAG, nicht nur das Vorzeichen. Deshalb prüft der
 *       Test beides: Vorzeichen UND Betrag.
 *
 *   (3) DIE ECKENZAHL. 24 Ecken und 36 Indizes je Quader sind kein
 *       Stilmittel, sondern die Bedingung dafür, dass „flach schattiert"
 *       ohne ein einziges Shading-Attribut herauskommt: jede Seitenfläche
 *       bekommt eigene Ecken mit eigener Normale. Genau diese Zahlen
 *       stehen in den ausgelieferten GLBs (24·B / 36·B), und die
 *       Konzeptnotiz leitet sie aus `remove_doubles` ohne Nettowirkung
 *       her — nicht aus einer Schätzung.
 *
 * ── Warum der Test einen EIGENEN GLB-Leser mitbringt ─────────────────
 * Ein Test, der den Schreiber mit dem Schreiber prüft, prüft nichts.
 * Deshalb steht unten ein kleiner, unabhängiger Parser: er kennt nur die
 * glTF-2.0-Spezifikation (Magic, Chunk-Längen, Accessoren, Bufferviews)
 * und keine einzige Annahme des Schreibers. Er liest die geschriebene
 * Datei GENAUSO wie die ausgelieferte `StoneVaultHallLarge.glb` — und
 * damit sind die beiden überhaupt erst vergleichbar.
 *
 * ── Warum Blender hier nicht mitläuft ────────────────────────────────
 * `tools/elements/pruefung/measure-glb.py` (Hüllbox, Ursprung) und
 * `check-mirror.py` (signiertes Volumen) sind die Abnahme-Werkzeuge des
 * Konzepts. Sie brauchen Blender; `wov-dev` hat keins, und der
 * CI-Checkout auch nicht. Ihre Aussagen sind deshalb hier in TypeScript
 * nachgerechnet — dieselbe Formel, dieselben Zahlen (`vol += a·(b×c)/6`
 * je Dreieck; Hüllbox über alle Ecken). Der Blender-Lauf gehört zur
 * einmaligen Abnahme des Meilensteins, nicht in den Sammellauf.
 *
 * Lauf:  npx tsx server/test/glb-schreiber.ts
 *
 * E2 guard over the GLB writer: 24 vertices / 36 indices per box,
 * negative signed volume (pre-mirrored), and equality with the shipped
 * StoneVaultHall*.glb in vertex count, index count and bounding box.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHall, type Box } from '@wov/shared/src/hallenGeometrie.js';
import {
  INDICES_PER_BOX,
  STONE_MATERIAL_NAME,
  VERTICES_PER_BOX,
  encodeGlb,
} from '../src/world/dungeon/GlbWriter.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (condition) {
    console.log(`  OK   ${text}`);
  } else {
    failures++;
    console.error(`  ROT  ${text}`);
  }
};

/** Grosszügiger als der float32-Rundungsfehler, enger als jeder echte Fehler. */
const TOL = 1e-4;

// ─────────────────────────────────────────────────────────────────────────
// Ein unabhängiger glTF-2.0-Leser (siehe Kopfkommentar)
// ─────────────────────────────────────────────────────────────────────────
interface GlbInhalt {
  readonly json: any;
  readonly nodeName: string | undefined;
  readonly meshName: string | undefined;
  readonly materialName: string | undefined;
  readonly attributes: Record<string, number>;
  readonly positions: Float32Array;
  readonly normals: Float32Array | null;
  readonly uvs: Float32Array | null;
  readonly indices: number[];
  readonly indexComponentType: number;
  /** min/max, wie sie IM POSITION-Accessor stehen — nicht nachgerechnet. */
  readonly accessorMin: number[];
  readonly accessorMax: number[];
}

const GLB_MAGIC = 0x46546c67; // "glTF" als Little-Endian-uint32
const CT_USHORT = 5123;
const CT_UINT = 5125;
const CT_FLOAT = 5126;

function leseGlb(bytes: Uint8Array): GlbInhalt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('kein GLB (Magic)');
  if (view.getUint32(4, true) !== 2) throw new Error('nicht glTF 2.0');
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error(`Gesamtlänge ${view.getUint32(8, true)} != Datei ${bytes.byteLength}`);
  }
  // Chunk 0 muss JSON sein, Chunk 1 der Binärteil (glTF 2.0, 4.4.3).
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Chunk 0 ist nicht JSON');
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))
  ) as any;
  const binLen = view.getUint32(20 + jsonLen, true);
  if (view.getUint32(24 + jsonLen, true) !== 0x004e4942) throw new Error('Chunk 1 ist nicht BIN');
  const binAb = 28 + jsonLen;
  if (binAb + binLen > bytes.byteLength) throw new Error('BIN-Chunk ragt aus der Datei');

  const accessors = json.accessors as any[];
  const views = json.bufferViews as any[];
  const komponenten: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  const roh = (index: number): { a: any; ab: number; n: number } => {
    const a = accessors[index];
    const v = views[a.bufferView];
    return {
      a,
      ab: binAb + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
      n: a.count * komponenten[a.type as string],
    };
  };
  const leseFloat = (index: number | undefined): Float32Array | null => {
    if (index === undefined) return null;
    const { a, ab, n } = roh(index);
    if (a.componentType !== CT_FLOAT) throw new Error(`Accessor ${index} ist kein FLOAT`);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(ab + i * 4, true);
    return out;
  };

  const prim = json.meshes[0].primitives[0];
  const { a: idxA, ab: idxAb, n: idxN } = roh(prim.indices);
  const indices: number[] = [];
  for (let i = 0; i < idxN; i++) {
    indices.push(
      idxA.componentType === CT_USHORT
        ? view.getUint16(idxAb + i * 2, true)
        : view.getUint32(idxAb + i * 4, true)
    );
  }
  const posA = accessors[prim.attributes.POSITION];
  return {
    json,
    nodeName: json.nodes?.[0]?.name,
    meshName: json.meshes[0].name,
    materialName: prim.material === undefined ? undefined : json.materials[prim.material].name,
    attributes: prim.attributes,
    positions: leseFloat(prim.attributes.POSITION)!,
    normals: leseFloat(prim.attributes.NORMAL),
    uvs: leseFloat(prim.attributes.TEXCOORD_0),
    indices,
    indexComponentType: idxA.componentType,
    accessorMin: posA.min,
    accessorMax: posA.max,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Messungen am gelesenen Inhalt
// ─────────────────────────────────────────────────────────────────────────
/**
 * Das signierte Volumen — Zeile für Zeile dieselbe Rechnung wie
 * `check-mirror.py`: Summe über alle Dreiecke von a·(b×c)/6.
 *
 * Bei geschlossener Fläche mit AUSSEN liegenden Normalen ist es +V, bei
 * vorgespiegelter Geometrie -V. Die Rechnung ist ursprungsabhängig nur
 * bei OFFENEN Flächen — genau deshalb ist der Betrag zugleich der
 * Dichtheitszeuge.
 */
function signiertesVolumen(p: Float32Array, indices: readonly number[]): number {
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const cx = p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1];
    const cy = p[b + 2] * p[c] - p[b] * p[c + 2];
    const cz = p[b] * p[c + 1] - p[b + 1] * p[c];
    vol += (p[a] * cx + p[a + 1] * cy + p[a + 2] * cz) / 6;
  }
  return vol;
}

function huellbox(p: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return { min, max };
}

const volumenSumme = (boxes: readonly Box[]): number =>
  boxes.reduce((s, b) => s + b.sx * b.sy * b.sz, 0);

const nahe = (a: number, b: number, tol = TOL): boolean => Math.abs(a - b) <= tol;
const nahe3 = (a: readonly number[], b: readonly number[], tol = TOL): boolean =>
  a.length === b.length && a.every((v, i) => nahe(v, b[i], tol));

// ─────────────────────────────────────────────────────────────────────────
// 1. Ein einzelner Quader — die kleinste Aussage, die alles enthält
// ─────────────────────────────────────────────────────────────────────────
console.log('\nE2 — GLB-Schreiber (server/src/world/dungeon/GlbWriter.ts)\n');
console.log('1. Ein Quader');

/* Bewusst unsymmetrisch in allen drei Achsen und nicht im Ursprung: ein
   vertauschtes Achsenpaar oder eine vergessene y/z-Drehung fiele an einem
   Würfel im Ursprung nicht auf. */
const EINZEL: Box = { cx: 0.7, cy: -1.3, cz: 2.1, sx: 1, sy: 2, sz: 3 };
const einzel = leseGlb(encodeGlb([EINZEL], { name: 'Gen_Probe' }));

check(einzel.positions.length / 3 === VERTICES_PER_BOX, `${VERTICES_PER_BOX} Ecken je Quader`);
check(einzel.indices.length === INDICES_PER_BOX, `${INDICES_PER_BOX} Indizes je Quader`);
check(einzel.nodeName === 'Gen_Probe' && einzel.meshName === 'Gen_Probe', 'Knoten- und Meshname');
check(einzel.materialName === STONE_MATERIAL_NAME, `Material heisst ${STONE_MATERIAL_NAME}`);
check(einzel.normals !== null, 'NORMAL ist da');
check(einzel.uvs === null, 'TEXCOORD_0 ist NICHT da (Vorgabe: triplanar braucht keins)');
check(
  einzel.json.nodes[0].translation === undefined &&
    einzel.json.nodes[0].rotation === undefined &&
    einzel.json.nodes[0].scale === undefined,
  'Knoten ohne Transformation — Ursprung ist der Bauraum-Ursprung'
);
check(einzel.indexComponentType === CT_USHORT, 'Indextyp UNSIGNED_SHORT bei 24 Ecken');

/*
  Achsenumrechnung: der Bauraum ist Blender-Z-up, die Datei glTF-Y-up.
  gltf = (bx, bz, -by). Für den Probequader heisst das:
    x   0,7 ± 0,5   ->  [ 0,20 ;  1,20]
    y   2,1 ± 1,5   ->  [ 0,60 ;  3,60]
    z  -(-1,3 ± 1)  ->  [ 0,30 ;  2,30]
*/
const einzelBox = huellbox(einzel.positions);
check(
  nahe3(einzelBox.min, [0.2, 0.6, 0.3]) && nahe3(einzelBox.max, [1.2, 3.6, 2.3]),
  `Hüllbox nach Y-up gedreht: ${einzelBox.min.map((v) => v.toFixed(2)).join('/')} .. ` +
    `${einzelBox.max.map((v) => v.toFixed(2)).join('/')}`
);
check(
  nahe3(einzel.accessorMin, einzelBox.min) && nahe3(einzel.accessorMax, einzelBox.max),
  'POSITION-Accessor nennt min/max und sie stimmen (glTF 2.0 verlangt sie)'
);

/* Acht verschiedene Orte, jeder dreimal — das ist „flach schattiert". */
const orte = new Set<string>();
for (let i = 0; i < einzel.positions.length; i += 3) {
  orte.add([0, 1, 2].map((k) => einzel.positions[i + k].toFixed(4)).join(','));
}
check(orte.size === 8, `8 verschiedene Eckorte, jeder ${VERTICES_PER_BOX / 8}× (flache Schattierung)`);

/* Sechs Flächen, je vier Ecken mit EINER achsenparallelen Normale. */
const flaechenNormalen = new Set<string>();
let normalenGleich = true;
for (let f = 0; f < 6; f++) {
  const n0 = [0, 1, 2].map((k) => einzel.normals![f * 4 * 3 + k]);
  for (let e = 1; e < 4; e++) {
    for (let k = 0; k < 3; k++) {
      if (!nahe(einzel.normals![(f * 4 + e) * 3 + k], n0[k])) normalenGleich = false;
    }
  }
  flaechenNormalen.add(n0.map((v) => v.toFixed(3)).join(','));
}
check(normalenGleich, 'alle vier Ecken einer Fläche tragen dieselbe Normale');
check(flaechenNormalen.size === 6, '6 verschiedene Flächennormalen');
check(
  [...flaechenNormalen].every((s) => {
    const v = s.split(',').map(Number);
    return nahe(Math.hypot(v[0], v[1], v[2]), 1) && v.filter((c) => Math.abs(c) > 0.5).length === 1;
  }),
  'Normalen sind Einheitsvektoren auf den Achsen'
);

/*
  Die Normale muss aus der WICKLUNG folgen, nicht daneben stehen. Sonst
  hätte die Datei zwei Wahrheiten über dieselbe Fläche — und der Client
  glaubt beim Beleuchten der Normalen, beim Kollidieren aber der Wicklung.
*/
let wicklungPasst = true;
for (let t = 0; t < einzel.indices.length; t += 3) {
  const [ia, ib, ic] = [einzel.indices[t], einzel.indices[t + 1], einzel.indices[t + 2]];
  const p = einzel.positions;
  const e1 = [0, 1, 2].map((k) => p[ib * 3 + k] - p[ia * 3 + k]);
  const e2 = [0, 1, 2].map((k) => p[ic * 3 + k] - p[ia * 3 + k]);
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const laenge = Math.hypot(n[0], n[1], n[2]);
  for (let k = 0; k < 3; k++) {
    if (!nahe(n[k] / laenge, einzel.normals![ia * 3 + k], 1e-3)) wicklungPasst = false;
  }
}
check(wicklungPasst, 'jede Normale ist das Kreuzprodukt der eigenen Wicklung');

/*
  Vorspiegelung, gemessen ohne Volumenintegral: Die Normalen zeigen zum
  Mittelpunkt HIN. Das ist genau der Zustand, den `aufbereiten()`
  hinterlässt — Wicklung unberührt, Geometrie gespiegelt.

  Wichtig für das Verständnis dieser Zeile: die x-Negation der Säle steckt
  NICHT im Schreiber, sondern in `buildHall`. Der Probequader geht roh
  hinein und behält deshalb seinen Ort (glTF-x = +0,7); vorgespiegelt ist
  er trotzdem, weil `boxVertices` die Ecken in der bereits gespiegelten
  Reihenfolge liefert. Genau diese Trennung soll der Test festhalten: der
  Schreiber erfindet keine Spiegelung und nimmt auch keine weg.
*/
const mitteGltf = [EINZEL.cx, EINZEL.cz, -EINZEL.cy];
let alleNachInnen = true;
for (let i = 0; i < VERTICES_PER_BOX; i++) {
  let d = 0;
  for (let k = 0; k < 3; k++) {
    d += einzel.normals![i * 3 + k] * (einzel.positions[i * 3 + k] - mitteGltf[k]);
  }
  if (d >= 0) alleNachInnen = false;
}
check(alleNachInnen, 'alle Normalen zeigen nach INNEN (Vorspiegelung ohne Winding-Flip)');

const einzelVol = signiertesVolumen(einzel.positions, einzel.indices);
check(einzelVol < 0, `signiertes Volumen negativ (${einzelVol.toFixed(4)})`);
check(
  nahe(-einzelVol, volumenSumme([EINZEL]), 1e-3),
  `Betrag = Quadervolumen ${volumenSumme([EINZEL]).toFixed(4)} (Dichtheit)`
);

// ─────────────────────────────────────────────────────────────────────────
// 2. Ein ganzer Saal
// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. Säle');

/** Die fünf Säle des Kits mit den Quaderzahlen aus der Konzeptnotiz. */
const SAELE = [
  { name: 'StoneVaultHall', cx: 2, cz: 2, raster: 2, boxes: 66 },
  { name: 'StoneVaultHallLarge', cx: 3, cz: 3, raster: 2, boxes: 158 },
  { name: 'StoneVaultHallLong', cx: 2, cz: 4, raster: 2, boxes: 139 },
  { name: 'StoneVaultHallGrand', cx: 4, cz: 4, raster: 4, boxes: 261 },
  { name: 'StoneVaultHallVast', cx: 6, cz: 6, raster: 4, boxes: 590 },
] as const;

for (const s of SAELE) {
  const hall = buildHall(s.cx, s.cz, { raster: s.raster });
  const glb = leseGlb(encodeGlb(hall.boxes, { name: s.name }));
  const vol = signiertesVolumen(glb.positions, glb.indices);
  const bb = huellbox(glb.positions);
  console.log(
    `  ${s.name.padEnd(22)} ${hall.boxes.length} Quader, ` +
      `${glb.positions.length / 3} Ecken, ${glb.indices.length / 3} Dreiecke, ` +
      `Volumen ${vol.toFixed(4)}, y ${bb.min[1].toFixed(2)}…${bb.max[1].toFixed(2)}`
  );
  check(hall.boxes.length === s.boxes, `${s.name}: ${s.boxes} Quader (E1-Zahl)`);
  check(
    glb.positions.length / 3 === VERTICES_PER_BOX * s.boxes &&
      glb.indices.length === INDICES_PER_BOX * s.boxes,
    `${s.name}: ${VERTICES_PER_BOX * s.boxes} Ecken / ${INDICES_PER_BOX * s.boxes} Indizes`
  );
  check(vol < 0, `${s.name}: signiertes Volumen negativ`);
  check(
    nahe(-vol, volumenSumme(hall.boxes), 1e-2),
    `${s.name}: Betrag = Σ Quadervolumen ${volumenSumme(hall.boxes).toFixed(4)}`
  );
  /* Ursprung: Bodenoberkante y = 0, Hüllbox symmetrisch um x/z = 0 — der
     Pivot, den `roomDefFuerSaal` (E3) und der Setzweg voraussetzen. */
  check(
    nahe(bb.min[1], -0.25) && nahe(bb.max[1], 3.75),
    `${s.name}: Höhe -0,25 … 3,75 (Boden- bis Deckenaussenkante)`
  );
  check(
    nahe(bb.min[0], -bb.max[0]) && nahe(bb.min[2], -bb.max[2]),
    `${s.name}: Pivot in der Grundflächenmitte`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Die beiden Schalter: Indexbreite und UVs
// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. Indexbreite und UVs');

/*
  Über 65 535 Ecken passt kein UNSIGNED_SHORT mehr. Der Klemmdeckel des
  Konzepts (13 000 Dreiecke) liegt weit darunter, aber der Schreiber ist
  nicht nur für Säle da — und ein stiller Überlauf wäre ein Modul, das
  ohne Fehlermeldung falsch aussieht. 13x14 Zellen: 3022 Quader,
  72 528 Ecken.
*/
const gross = buildHall(13, 14, { raster: 4 });
const grossGlb = leseGlb(encodeGlb(gross.boxes, { name: 'Gen_Gross' }));
check(
  gross.boxes.length * VERTICES_PER_BOX > 65535,
  `Prüffall hat ${gross.boxes.length * VERTICES_PER_BOX} Ecken (> 65 535)`
);
check(grossGlb.indexComponentType === CT_UINT, 'Indextyp wechselt auf UNSIGNED_INT');
check(
  grossGlb.indices[grossGlb.indices.length - 1] === gross.boxes.length * VERTICES_PER_BOX - 1,
  'der letzte Index zeigt auf die letzte Ecke (kein Überlauf)'
);

/*
  UVs sind für dieses Kit OPTIONAL, und das ist ein Befund, keine
  Bequemlichkeit: `DungeonSteinMaterial` mischt seine sechs Texturen
  TRIPLANAR aus `vPositionW` und `normalW` (`stTri()`), es liest nirgends
  eine UV-Koordinate. Deshalb tragen auch die fünf ausgelieferten Säle
  kein TEXCOORD_0. Der Schalter existiert trotzdem — für ein späteres
  Modul mit gewöhnlichem Material — und muss dann echte Zahlen liefern.
*/
const mitUv = leseGlb(encodeGlb([EINZEL], { name: 'Gen_Probe', uvs: true }));
check(mitUv.uvs !== null, 'uvs: true schreibt TEXCOORD_0');
check(
  mitUv.uvs !== null && mitUv.uvs.length === VERTICES_PER_BOX * 2,
  `TEXCOORD_0 hat ${VERTICES_PER_BOX} Paare`
);
check(
  mitUv.uvs !== null && mitUv.uvs.every((v) => Number.isFinite(v)),
  'TEXCOORD_0 enthält nur endliche Zahlen'
);
check(
  nahe(signiertesVolumen(mitUv.positions, mitUv.indices), einzelVol, 1e-4),
  'der UV-Schalter ändert die Geometrie nicht'
);

// ─────────────────────────────────────────────────────────────────────────
// 4. Gegen das Blender-Erzeugnis (Weiche: assets/ liegt ausserhalb des Repos)
// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. Abgleich mit den ausgelieferten GLBs');

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vorhanden = SAELE.filter((s) => existsSync(resolve(WURZEL, `assets/models/${s.name}.glb`)));

if (vorhanden.length === 0) {
  console.log(
    '  ÜBERSPRUNGEN — assets/models/StoneVaultHall*.glb fehlen ' +
      '(assets/ liegt ausserhalb des Repos)'
  );
} else {
  for (const s of vorhanden) {
    const referenz = leseGlb(readFileSync(resolve(WURZEL, `assets/models/${s.name}.glb`)));
    const eigen = leseGlb(
      encodeGlb(buildHall(s.cx, s.cz, { raster: s.raster }).boxes, { name: s.name })
    );
    const refVol = signiertesVolumen(referenz.positions, referenz.indices);
    const eigVol = signiertesVolumen(eigen.positions, eigen.indices);
    const refBb = huellbox(referenz.positions);
    const eigBb = huellbox(eigen.positions);
    console.log(
      `  ${s.name.padEnd(22)} Blender ${referenz.positions.length / 3} Ecken / ` +
        `${referenz.indices.length / 3} Dreiecke / Volumen ${refVol.toFixed(4)}  ↔  ` +
        `TS ${eigen.positions.length / 3} / ${eigen.indices.length / 3} / ${eigVol.toFixed(4)}`
    );
    check(
      referenz.positions.length === eigen.positions.length,
      `${s.name}: gleiche Eckenzahl wie das Blender-Erzeugnis`
    );
    check(
      referenz.indices.length === eigen.indices.length,
      `${s.name}: gleiche Dreieckszahl`
    );
    /* Das ist die Aussage von measure-glb.py — Hüllbox und Ursprung. */
    check(
      nahe3(refBb.min, eigBb.min, 1e-3) && nahe3(refBb.max, eigBb.max, 1e-3),
      `${s.name}: gleiche Hüllbox ${refBb.min.map((v) => v.toFixed(3)).join('/')} .. ` +
        `${refBb.max.map((v) => v.toFixed(3)).join('/')}`
    );
    /* Das ist die Aussage von check-mirror.py — Vorzeichen UND Betrag. */
    check(
      refVol < 0 && eigVol < 0 && nahe(refVol, eigVol, 1e-2),
      `${s.name}: gleiches signiertes Volumen (${refVol.toFixed(4)} / ${eigVol.toFixed(4)})`
    );
    check(
      referenz.materialName === eigen.materialName && referenz.meshName === eigen.meshName,
      `${s.name}: gleicher Mesh- und Materialname`
    );
    check(
      referenz.attributes.TEXCOORD_0 === undefined && eigen.attributes.TEXCOORD_0 === undefined,
      `${s.name}: beide ohne TEXCOORD_0`
    );
  }
}

console.log(
  failures === 0
    ? '\nE2: alles grün.\n'
    : `\nE2: ${failures} FEHLGESCHLAGEN.\n`
);
process.exit(failures > 0 ? 1 : 0);
