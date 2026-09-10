/**
 * glb.ts — eine `.glb` lesen, ohne Babylon.
 *
 * Der SERVERWEG zu derselben Geometrie, die der Client von Babylon
 * bekommt. Er steht bewusst nicht im Barrel: Der Client braucht ihn nie,
 * und über `export *` läge er in jedem Spiel-Bundle.
 *
 *   import { leseGlb } from '@wov/shared/src/kollision/glb.js';
 *
 * ── Die Falle: der Clientraum ist nicht der Dateiraum ─────────────────
 * Babylons glTF-Lader stellt jedem Modell einen Knoten `__root__` voran,
 * der die Händigkeit umrechnet. GEMESSEN (10.09.2026, NullEngine gegen
 * die rohen Accessorwerte, `shared/test/kollision-glb.ts`): Seine
 * Weltmatrix ist exakt diag(−1, 1, 1, 1) — aus `rotQuat (0,1,0,0)`
 * (180° um y) mal `scaling (1,1,−1)`. Wirkung auf einen Punkt:
 *
 *     Clientraum = (−x, y, z) des Dateiraums
 *
 * Auf drei Vertices von `sm-env-rock-cliff-01` und `tree-1c3` bitgenau
 * nachgerechnet, und die Vertexreihenfolge bleibt dabei erhalten. Das
 * ist dieselbe Umrechnung, die `boundsNachWeltraum()` für die Hüllboxen
 * des Katalogs macht — hier für jeden einzelnen Punkt.
 *
 * Für einen Zylinder ist der Unterschied null, für eine Treppe ist er
 * die ganze Treppe. Deshalb passiert er hier und nicht beim Aufrufer.
 *
 * ── Was gefiltert wird, und warum genau das ──────────────────────────
 * `AssetManager.getMasters()` wirft drei Sorten Netze weg, bevor der
 * Client überhaupt misst. Wer das hier nicht nachbildet, misst eine
 * andere Geometrie als der Client — und das fiele nirgends auf, weil
 * beide Seiten für sich plausible Zahlen liefern:
 *
 *   • `_col`-Netze sind NIE Bild und ERSETZEN die Kollision.
 *   • Trägt eine Datei LOD-Stufen (`lod0…`, `lod1…`), zählt nur `lod0`.
 *   • `DefaultMaterial` ist AssetRippers Platzhalter für „am Renderer
 *     hing kein Material" — im Bild eine weisse Fläche, in 42 Modellen
 *     vorhanden, und im Client abgeschaltet.
 *
 * NICHT nachgebildet ist `fernSchalen()` (verschachtelte Fernstufen ohne
 * `lod`-Namen). Die Erkennung braucht Hüllboxen und Elternketten; die
 * betroffenen Dateien laufen durch `store-vegetation-aufbereiten.mjs`,
 * das die Schalen abträgt — für aufbereitete Vegetation ist das Set
 * leer. Ein Fund davon wäre eine Abweichung im Gleichheitstest.
 *
 * Reads a .glb without Babylon: node hierarchy, POSITION and index
 * accessors, merged, mirrored into client space.
 */

/** Ein zusammengeführtes Netz in Clientkoordinaten. */
export interface GlbNetz {
  positionen: Float32Array;
  indizes: Uint32Array;
}

/** Was in einer GLB steckt, getrennt nach Bild und reiner Kollision. */
export interface GlbInhalt {
  /** Die sichtbaren Netze, zusammengeführt — oder `null`. */
  sicht: GlbNetz | null;
  /** Die `_col`-Netze, zusammengeführt — oder `null`. */
  kollision: GlbNetz | null;
}

/** Wie `NUR_KOLLISION_NAME` im AssetManager. */
const NUR_KOLLISION = /_col(_primitive\d+)?$/i;
const LOD_NAME = /^lod\d/i;
const LOD0_NAME = /^lod0/i;
const PLATZHALTER_MATERIAL = 'DefaultMaterial';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface GlbRoh {
  json: GlTF;
  bin: Uint8Array<ArrayBufferLike>;
}

interface GlTF {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GlTFKnoten[];
  meshes?: { name?: string; primitives: GlTFPrimitive[] }[];
  materials?: { name?: string }[];
  accessors?: GlTFAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}
interface GlTFKnoten {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GlTFPrimitive {
  attributes: { POSITION?: number };
  indices?: number;
  material?: number;
  mode?: number;
}
interface GlTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

/** JSON- und BIN-Chunk aus den Bytes holen. */
function chunks(bytes: Uint8Array): GlbRoh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB (Magic fehlt)');
  let off = 12;
  let json: GlTF | null = null;
  let bin: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  while (off + 8 <= bytes.byteLength) {
    const laenge = dv.getUint32(off, true);
    const art = dv.getUint32(off + 4, true);
    off += 8;
    if (art === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(off, off + laenge))) as GlTF;
    } else if (art === BIN_CHUNK) {
      bin = bytes.subarray(off, off + laenge);
    }
    off += laenge;
  }
  if (json === null) throw new Error('GLB ohne JSON-Chunk');
  return { json, bin };
}

/** Ein VEC3-Float-Accessor, `byteStride` berücksichtigt. */
function lesePositionen(roh: GlbRoh, index: number): Float32Array {
  const a = roh.json.accessors?.[index];
  if (!a || a.type !== 'VEC3' || a.componentType !== 5126) {
    throw new Error(`Accessor ${index}: POSITION muss VEC3/float sein`);
  }
  const out = new Float32Array(a.count * 3);
  if (a.bufferView === undefined) return out;
  const bv = roh.json.bufferViews![a.bufferView]!;
  const dv = new DataView(roh.bin.buffer, roh.bin.byteOffset, roh.bin.byteLength);
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  for (let v = 0; v < a.count; v++) {
    const p = start + v * stride;
    out[v * 3] = dv.getFloat32(p, true);
    out[v * 3 + 1] = dv.getFloat32(p + 4, true);
    out[v * 3 + 2] = dv.getFloat32(p + 8, true);
  }
  return out;
}

/** Ein SCALAR-Index-Accessor — ubyte, ushort oder uint. */
function leseIndizes(roh: GlbRoh, index: number): Uint32Array {
  const a = roh.json.accessors?.[index];
  if (!a || a.type !== 'SCALAR') throw new Error(`Accessor ${index}: indices muss SCALAR sein`);
  const out = new Uint32Array(a.count);
  if (a.bufferView === undefined) return out;
  const bv = roh.json.bufferViews![a.bufferView]!;
  const dv = new DataView(roh.bin.buffer, roh.bin.byteOffset, roh.bin.byteLength);
  const breite = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? breite;
  for (let i = 0; i < a.count; i++) {
    const p = start + i * stride;
    out[i] = breite === 1 ? dv.getUint8(p) : breite === 2 ? dv.getUint16(p, true) : dv.getUint32(p, true);
  }
  return out;
}

/**
 * Die Matrix eines Knotens, spaltenweise wie in glTF.
 *
 * Kein `Math.pow`, kein `atan2` — die Quaternion wird von Hand
 * ausmultipliziert (s. Kopf von `formen.ts`).
 */
function knotenMatrix(n: GlTFKnoten): number[] {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const x = r[0]!;
  const y = r[1]!;
  const z = r[2]!;
  const w = r[3]!;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
  for (let c = 0; c < 3; c++) for (let r2 = 0; r2 < 3; r2++) m[c * 4 + r2]! *= s[c]!;
  return m;
}

function malMatrix(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/**
 * Babylons `__root__`: die Weltmatrix, die der glTF-Lader jedem Modell
 * voranstellt. Gemessen als diag(−1, 1, 1, 1) — s. Kopf.
 */
const CLIENTRAUM = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface Teil {
  name: string;
  material: string | null;
  positionen: Float32Array;
  indizes: Uint32Array;
  matrix: number[];
}

/** Alle Netze der Datei, Hierarchie und Spiegelung bereits eingerechnet. */
function teile(roh: GlbRoh): Teil[] {
  const aus: Teil[] = [];
  const szene = roh.json.scenes?.[roh.json.scene ?? 0];
  const wurzeln = szene?.nodes ?? [];
  const lauf = (idx: number, eltern: readonly number[]): void => {
    const n = roh.json.nodes?.[idx];
    if (!n) return;
    const m = malMatrix(eltern, knotenMatrix(n));
    if (n.mesh !== undefined) {
      const mesh = roh.json.meshes?.[n.mesh];
      const primitive = mesh?.primitives ?? [];
      for (let i = 0; i < primitive.length; i++) {
        const prim = primitive[i]!;
        // mode 4 = TRIANGLES; alles andere ist keine Fläche, gegen die
        // man laufen kann (Linien, Punkte, Strips liefert der Export nicht).
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (prim.attributes.POSITION === undefined) continue;
        // Babylon hängt bei mehreren Primitiven `_primitiveN` an den
        // Knotennamen — dasselbe hier, damit `_col` gleich greift.
        const basisName = n.name ?? mesh?.name ?? `mesh${n.mesh}`;
        aus.push({
          name: primitive.length > 1 ? `${basisName}_primitive${i}` : basisName,
          material:
            prim.material === undefined ? null : (roh.json.materials?.[prim.material]?.name ?? null),
          positionen: lesePositionen(roh, prim.attributes.POSITION),
          indizes: prim.indices === undefined ? new Uint32Array(0) : leseIndizes(roh, prim.indices),
          matrix: m,
        });
      }
    }
    for (const k of n.children ?? []) lauf(k, m);
  };
  for (const w of wurzeln) lauf(w, CLIENTRAUM);
  return aus;
}

/** Mehrere Teile zu EINEM Netz zusammenlegen, Matrizen eingerechnet. */
function zusammenlegen(liste: readonly Teil[]): GlbNetz | null {
  let ecken = 0;
  let dreiecke = 0;
  for (const t of liste) {
    ecken += t.positionen.length;
    dreiecke += t.indizes.length;
  }
  if (ecken === 0) return null;
  const positionen = new Float32Array(ecken);
  const indizes = new Uint32Array(dreiecke);
  let p = 0;
  let q = 0;
  for (const t of liste) {
    const e = t.matrix;
    const basis = p / 3;
    for (let v = 0; v < t.positionen.length; v += 3) {
      const x = t.positionen[v]!;
      const y = t.positionen[v + 1]!;
      const z = t.positionen[v + 2]!;
      positionen[p++] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      positionen[p++] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      positionen[p++] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    for (let k = 0; k < t.indizes.length; k++) indizes[q++] = basis + t.indizes[k]!;
  }
  return { positionen, indizes };
}

/**
 * Eine GLB lesen — Sichtnetz und Kollisionsnetz, je zusammengeführt und
 * in Clientkoordinaten.
 */
export function leseGlb(bytes: Uint8Array): GlbInhalt {
  const alle = teile(chunks(bytes));
  const kollision = alle.filter((t) => NUR_KOLLISION.test(t.name));
  const rest = alle.filter((t) => !NUR_KOLLISION.test(t.name));
  const hatLods = rest.some((t) => LOD_NAME.test(t.name));
  const sicht = rest.filter(
    (t) =>
      (!hatLods || LOD0_NAME.test(t.name)) && t.material !== PLATZHALTER_MATERIAL
  );
  return { sicht: zusammenlegen(sicht), kollision: zusammenlegen(kollision) };
}
