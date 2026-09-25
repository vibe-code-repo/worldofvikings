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
 *   • `DefaultMaterial` ist der Platzhalter des Extraktions-Exports für „am Renderer
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

/**
 * `GlbRoh`/`GlTF` und {@link parseGlbChunks} sind exportiert, damit ein
 * zweiter Leser (die Upload-Prüfung, `server/src/world/ModelUpload.ts`)
 * dieselbe Chunk-Aufteilung benutzt statt sie ein zweites Mal
 * nachzubauen — genau die Art Kopie, deren zwei Fassungen beim nächsten
 * Umbau auseinanderlaufen, ohne dass ein Test es sähe.
 */
export interface GlbRoh {
  json: GlTF;
  bin: Uint8Array<ArrayBufferLike>;
}

export interface GlTF {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GlTFKnoten[];
  meshes?: { name?: string; primitives: GlTFPrimitive[] }[];
  materials?: { name?: string }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  accessors?: GlTFAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  /** `uri` hier heisst „externe Binärdatei" — die Upload-Prüfung lässt nur den eingebetteten BIN-Chunk zu. */
  buffers?: { byteLength: number; uri?: string }[];
  /** Erweiterungen, ohne die der Leser nicht das Richtige zeichnet (Draco, Meshopt, …) — die Upload-Prüfung lehnt jede ab. */
  extensionsRequired?: string[];
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

/**
 * JSON- und BIN-Chunk aus den Bytes holen — STRENG.
 *
 * Babylon liest den ERSTEN Chunk als JSON und hört an der Kopflänge auf.
 * Ein Leser, der den letzten Chunk nimmt oder die Kopfzeile ignoriert,
 * prüft dann eine andere Datei, als der Client lädt (U1-N4-Angriff, A1).
 * Deshalb gilt genau ein Aufbau: Version 2, Kopflänge = Dateilänge, erster
 * Chunk JSON, höchstens ein BIN direkt danach, sonst nichts; Chunk-Längen
 * im Rahmen und durch 4 teilbar. Alles andere wirft mit klarer Meldung.
 */
export function parseGlbChunks(bytes: Uint8Array): GlbRoh {
  if (bytes.byteLength < 12) throw new Error('keine GLB (Kopf unvollständig)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB (Magic fehlt)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB-Version ${version} wird nicht unterstützt (nur Version 2)`);
  const gesamt = dv.getUint32(8, true);
  if (gesamt !== bytes.byteLength) {
    throw new Error(`GLB-Kopflänge (${gesamt} Byte) passt nicht zur Dateilänge (${bytes.byteLength} Byte)`);
  }
  let off = 12;
  let json: GlTF | null = null;
  let bin: Uint8Array<ArrayBufferLike> | null = null;
  let nr = 0;
  while (off < bytes.byteLength) {
    if (off + 8 > bytes.byteLength) throw new Error('GLB: Chunk-Kopf ragt über das Dateiende');
    const laenge = dv.getUint32(off, true);
    const art = dv.getUint32(off + 4, true);
    off += 8;
    if (laenge % 4 !== 0) throw new Error(`GLB: Chunk ${nr} ist nicht 4-Byte-ausgerichtet (Länge ${laenge})`);
    if (laenge > bytes.byteLength - off) throw new Error(`GLB: Chunk ${nr} ragt über das Dateiende`);
    if (nr === 0) {
      if (art !== JSON_CHUNK) throw new Error('GLB: der erste Chunk muss der JSON-Chunk sein');
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(off, off + laenge))) as GlTF;
    } else if (nr === 1 && art === BIN_CHUNK) {
      bin = bytes.subarray(off, off + laenge);
    } else {
      throw new Error(`GLB: unerwarteter weiterer Chunk (Nr. ${nr}) — erlaubt sind ein JSON-Chunk und höchstens ein BIN-Chunk direkt danach`);
    }
    off += laenge;
    nr++;
  }
  if (json === null) throw new Error('GLB ohne JSON-Chunk');
  return { json, bin: bin ?? new Uint8Array(0) };
}

/**
 * N1 (Angriff, Abschnitt „Grenzen des Prüftors"): `count` steht im JSON
 * und ist damit eine Eingabe wie jede andere. Vorher wurde `new
 * Float32Array(a.count * 3)`/`new Uint32Array(a.count)` angelegt, BEVOR
 * irgendetwas geprüft war — ein `count` von z. B. 500 Millionen reservierte
 * mehrere hundert MB, bevor der eigentliche Fehler (zu wenig Bytes im
 * BIN-Chunk) überhaupt zum Zuge kam. Diese Grenze deckelt die Allokation
 * selbst, unabhängig davon, ob überhaupt ein `bufferView` angegeben ist.
 * Weit über jedem sinnvollen Upload-Netz (die Dreiecksgrenze der Prüfung
 * liegt bei 20 000, ein Netz mit 3 Ecken je Dreieck bräuchte höchstens
 * 60 000 Positionen).
 */
const MAX_ACCESSOR_COUNT = 5_000_000;

function pruefeCount(a: { count: unknown }, index: number, bezeichnung: string): number {
  const count = a.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_ACCESSOR_COUNT) {
    throw new Error(`Accessor ${index}: count von '${bezeichnung}' ist ungültig oder unplausibel groß (${String(count)})`);
  }
  return count;
}

/** Ein VEC3-Float-Accessor, `byteStride` berücksichtigt. */
function lesePositionen(roh: GlbRoh, index: number): Float32Array {
  const a = roh.json.accessors?.[index];
  if (!a || a.type !== 'VEC3' || a.componentType !== 5126) {
    throw new Error(`Accessor ${index}: POSITION muss VEC3/float sein`);
  }
  const count = pruefeCount(a, index, 'POSITION');
  if (a.bufferView === undefined) return new Float32Array(count * 3);
  const bv = roh.json.bufferViews![a.bufferView]!;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  // Bevor gelesen (und nicht erst beim ersten Zugriff, der als
  // `RangeError` auffiele): passt der behauptete Umfang überhaupt in den
  // BIN-Chunk? Eine klare Meldung statt eines rohen DataView-Fehlers.
  if (count > 0 && start + (count - 1) * stride + 12 > roh.bin.byteLength) {
    throw new Error(`Accessor ${index}: POSITION mit count ${count} passt nicht in den Binärteil (${roh.bin.byteLength} Byte)`);
  }
  const out = new Float32Array(count * 3);
  const dv = new DataView(roh.bin.buffer, roh.bin.byteOffset, roh.bin.byteLength);
  for (let v = 0; v < count; v++) {
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
  const count = pruefeCount(a, index, 'indices');
  if (a.bufferView === undefined) return new Uint32Array(count);
  const bv = roh.json.bufferViews![a.bufferView]!;
  const breite = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? breite;
  if (count > 0 && start + (count - 1) * stride + breite > roh.bin.byteLength) {
    throw new Error(`Accessor ${index}: indices mit count ${count} passt nicht in den Binärteil (${roh.bin.byteLength} Byte)`);
  }
  const out = new Uint32Array(count);
  const dv = new DataView(roh.bin.buffer, roh.bin.byteOffset, roh.bin.byteLength);
  for (let i = 0; i < count; i++) {
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
/** `[0, 1, …, n-1]` — die impliziten Indizes einer nicht indizierten Primitive. */
function sequentielleIndizes(n: number): Uint32Array {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/**
 * TRIANGLE_STRIP (glTF `mode` 5) in eine flache Dreiecksliste entfalten —
 * `count − 2` Dreiecke, wie Babylon sie zeichnet. Dreieck `i` tauscht die
 * ersten beiden Ecken, wenn `i` ungerade ist, sonst hätte jedes zweite
 * Dreieck im Streifen die falsche Wicklung (Rückseite statt Vorderseite).
 *
 * N2 (Nachangriff, Abschnitt „Prüftor"): Vorher zählte JEDE Primitive mit
 * `mode !== 4` als 0 Dreiecke — Streifen und Fächer flossen dann weder in
 * die Dreieckszahl noch in Hüllbox oder Kollision ein, obwohl Babylon sie
 * zeichnet. Ein Modell hätte so unbemerkt mehr sichtbare/begehbare Fläche
 * gehabt, als das Tor gezählt hat.
 */
function indizesAusStrip(strip: Uint32Array): Uint32Array {
  const n = strip.length;
  if (n < 3) return new Uint32Array(0);
  const out = new Uint32Array((n - 2) * 3);
  for (let i = 0; i < n - 2; i++) {
    if (i % 2 === 0) {
      out[i * 3] = strip[i]!;
      out[i * 3 + 1] = strip[i + 1]!;
      out[i * 3 + 2] = strip[i + 2]!;
    } else {
      out[i * 3] = strip[i + 1]!;
      out[i * 3 + 1] = strip[i]!;
      out[i * 3 + 2] = strip[i + 2]!;
    }
  }
  return out;
}

/**
 * TRIANGLE_FAN (glTF `mode` 6) in eine flache Dreiecksliste entfalten —
 * jedes Dreieck teilt sich die erste Ecke des Fächers, `count − 2` Dreiecke.
 */
function indizesAusFan(fan: Uint32Array): Uint32Array {
  const n = fan.length;
  if (n < 3) return new Uint32Array(0);
  const out = new Uint32Array((n - 2) * 3);
  for (let i = 0; i < n - 2; i++) {
    out[i * 3] = fan[0]!;
    out[i * 3 + 1] = fan[i + 1]!;
    out[i * 3 + 2] = fan[i + 2]!;
  }
  return out;
}

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
        // mode 4 = TRIANGLES, 5 = TRIANGLE_STRIP, 6 = TRIANGLE_FAN — die
        // drei Flächenarten, die man begehen kann. Linien und Punkte (0–3)
        // liefert der Export nicht und bleiben aussen vor.
        if (prim.mode !== undefined && prim.mode !== 4 && prim.mode !== 5 && prim.mode !== 6) continue;
        if (prim.attributes.POSITION === undefined) continue;
        // Babylon hängt bei mehreren Primitiven `_primitiveN` an den
        // Knotennamen — dasselbe hier, damit `_col` gleich greift.
        const basisName = n.name ?? mesh?.name ?? `mesh${n.mesh}`;
        const positionen = lesePositionen(roh, prim.attributes.POSITION);
        // N1 (Angriff, Abschnitt „Grenzen des Prüftors"): eine Primitive
        // OHNE `indices` ist gültiges glTF und wird von Babylon gezeichnet
        // (POSITION.count der Reihe nach) — vorher ergab das eine LEERE
        // Indexliste, also 0 gezählte Dreiecke, obwohl sichtbare Fläche da
        // war. `sequentielleIndizes` bildet dieselbe Zählweise wie
        // `tools/asset-manifest.mjs` (`dreiecke()`) nach.
        const rohIndizes =
          prim.indices === undefined ? sequentielleIndizes(positionen.length / 3) : leseIndizes(roh, prim.indices);
        // N2 (Nachangriff, Abschnitt „Prüftor"): Streifen/Fächer erst HIER
        // in eine flache Dreiecksliste entfalten — `rohIndizes` selbst ist
        // bei ihnen keine Gruppe-zu-3-Liste, sondern eine fortlaufende
        // Eckenkette.
        const indizes =
          prim.mode === 5 ? indizesAusStrip(rohIndizes) : prim.mode === 6 ? indizesAusFan(rohIndizes) : rohIndizes;
        aus.push({
          name: primitive.length > 1 ? `${basisName}_primitive${i}` : basisName,
          material:
            prim.material === undefined ? null : (roh.json.materials?.[prim.material]?.name ?? null),
          positionen,
          indizes,
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
  const alle = teile(parseGlbChunks(bytes));
  const kollision = alle.filter((t) => NUR_KOLLISION.test(t.name));
  const rest = alle.filter((t) => !NUR_KOLLISION.test(t.name));
  const hatLods = rest.some((t) => LOD_NAME.test(t.name));
  const sicht = rest.filter(
    (t) =>
      (!hatLods || LOD0_NAME.test(t.name)) && t.material !== PLATZHALTER_MATERIAL
  );
  return { sicht: zusammenlegen(sicht), kollision: zusammenlegen(kollision) };
}
