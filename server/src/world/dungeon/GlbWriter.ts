/**
 * Ein glTF-2.0-Binärschreiber für Quaderlisten — der Blender-Ersatz.
 *
 * ── Warum ein eigener Schreiber und kein Exporter ────────────────────
 * Das Projekt hat den Präzedenzfall samt Begründung: `tools/clutter-
 * meshes.py` schreibt GLB direkt, weil „ein Exporter Vertices
 * zusammenlegen und umsortieren dürfte" (`tools/README.md`). Genau
 * darauf steht hier alles: Die Steingrab-Module sind in x VORGESPIEGELT
 * — die Geometrie ist gespiegelt, die Flächenwicklung nicht. Im Spiel
 * dreht Babylons `__root__` (scale.x = -1) das zurück. Ein Exporter, der
 * Normalen „repariert" oder Ecken verschmilzt, nähme genau die
 * Eigenschaft weg, an der die Module hängen — ohne einen einzigen
 * Eckpunkt zu verschieben und ohne eine Warnung. `three`s GLTFExporter
 * liefe in Node ausserdem nur mit Browser-Attrappen
 * (`tools/test-glb-parse.ts`) und wäre eine zweite Wahrheit über die
 * Normalen.
 *
 * ── 24 Ecken und 36 Indizes je Quader ────────────────────────────────
 * Nicht 8 und 36. Jede der sechs Seitenflächen bekommt eigene Ecken mit
 * eigener Normale — das IST „flach schattiert", ohne ein einziges
 * Shading-Attribut in der Datei. Die ausgelieferten GLBs tragen dieselben
 * Zahlen (24·B Ecken, 12·B Dreiecke, gegen alle fünf Säle exakt geprüft);
 * `remove_doubles` hat dort nachweislich null Nettowirkung, weil flach
 * schattierte Quader beim Export ohnehin wieder getrennt werden.
 *
 * ── Die Normale kommt aus der Wicklung, nicht daneben ────────────────
 * Blender berechnet die Normalen NACH dem x-Negieren aus den Flächen —
 * sie zeigen deshalb im gespiegelten Raum nach INNEN. Wer sie statt
 * dessen „nach aussen" hinschriebe, legte zwei sich widersprechende
 * Wahrheiten in eine Datei: das Licht folgte der Normale, die Kollision
 * der Wicklung. Deshalb steht unten `flaechenNormale()` und keine
 * Vorzeichentabelle.
 *
 * ── Achsen ───────────────────────────────────────────────────────────
 * Gebaut wird in Blender-Z-up (`shared/src/hallenGeometrie.ts`),
 * ausgeliefert wird glTF-Y-up. Die Umrechnung ist dieselbe, die Blenders
 * Exporter macht:  gltf = (bx, bz, -by).
 *
 * ── Was diese Datei NICHT tut ────────────────────────────────────────
 * Sie schreibt keine Datei. Sie liefert die Bytes; wohin die gehören,
 * entscheidet der Aufrufer (`assets/generiert/`, NICHT `assets/models/` —
 * dort ist `assets/manifest.json` getrackt und der Manifest-Test würde
 * rot). So bleibt der Schreiber prüfbar, ohne dass ein Test Dateien
 * hinterlässt.
 *
 * Writes glTF 2.0 binary from an axis-aligned box list: 24 vertices and
 * 36 indices per box, normals derived from the winding (which keeps the
 * pre-mirrored, inward-facing state the kit relies on), Z-up -> Y-up.
 */
import { BOX_QUADS, boxVertices, type Box, type Vec3 } from '@wov/shared/src/hallenGeometrie.js';

/** Vier eigene Ecken je Seitenfläche — siehe Kopfkommentar. */
export const VERTICES_PER_BOX = 24;
/** Zwei Dreiecke je Seitenfläche. */
export const INDICES_PER_BOX = 36;

/**
 * Der Materialname der Kit-Module. Beliebig für das Bild — im Spiel
 * ersetzt `DungeonSteinMaterial` das Material anhand der Weltnormale —,
 * aber nicht beliebig für den Vergleich mit dem Blender-Erzeugnis.
 */
export const STONE_MATERIAL_NAME = 'StoneVaultStone';

export interface GlbOptions {
  /** Knoten- und Meshname in der Datei. Im Spiel der Modulname. */
  readonly name: string;
  /** Materialname; Vorgabe `STONE_MATERIAL_NAME`. */
  readonly materialName?: string;
  /**
   * TEXCOORD_0 mitschreiben. Vorgabe AUS, und das ist ein Befund:
   * `DungeonSteinMaterial` mischt seine sechs Steintexturen TRIPLANAR aus
   * `vPositionW` und `normalW` (`stTri()`), es liest keine
   * UV-Koordinate. Auch die fünf ausgelieferten Säle tragen keine. Der
   * Schalter ist für ein späteres Modul mit gewöhnlichem Material da —
   * dann als Meter-Kastenprojektion (1 m = 1 UV-Einheit).
   */
  readonly uvs?: boolean;
}

// ── glTF-Konstanten (Spezifikation 2.0) ─────────────────────────────────
const GLB_MAGIC = 0x46546c67; // "glTF" als Little-Endian-uint32
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const COMPONENT_USHORT = 5123;
const COMPONENT_UINT = 5125;
const COMPONENT_FLOAT = 5126;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

/**
 * Über 65 535 Ecken passt kein UNSIGNED_SHORT mehr. Der Deckel des
 * Konzepts (13 000 Dreiecke je Modul) liegt weit darunter — aber ein
 * stiller Überlauf wäre ein Modul, das ohne Fehlermeldung falsch
 * aussieht, und das ist teurer als ein `if`.
 */
const USHORT_MAX_VERTICES = 65536;

/** Bauraum (Blender, z oben) → Datei (glTF, y oben). */
function toGltf(p: Vec3): [number, number, number] {
  return [p.x, p.z, -p.y];
}

/**
 * Die Normale einer Fläche AUS ihrer Wicklung — der einzige Weg, der
 * die Vorspiegelung nicht lautlos verliert (siehe Kopfkommentar).
 */
function flaechenNormale(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[]
): [number, number, number] {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: [number, number, number] = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const laenge = Math.hypot(n[0], n[1], n[2]);
  if (laenge < 1e-12) {
    throw new Error('Entartete Fläche: Quader mit Kantenlänge 0 lässt sich nicht schreiben');
  }
  return [n[0] / laenge, n[1] / laenge, n[2] / laenge];
}

/** Auf das nächste Vielfache von 4 aufrunden (glTF verlangt 4-Byte-Ausrichtung). */
const auf4 = (n: number): number => (n + 3) & ~3;

/**
 * Eine Quaderliste als glTF-2.0-Binärdatei.
 *
 * Die Reihenfolge der Quader und die der Ecken innerhalb eines Quaders
 * bleibt unangetastet — sie kommt aus `hallenGeometrie.ts` und damit aus
 * dem Python. Wer hier sortierte, machte aus einem reproduzierbaren
 * Erzeugnis ein ähnliches.
 */
export function encodeGlb(boxes: readonly Box[], options: GlbOptions): Uint8Array {
  if (boxes.length === 0) throw new Error('Leere Quaderliste — es gäbe nichts zu schreiben');

  const anzahlEcken = boxes.length * VERTICES_PER_BOX;
  const mitUv = options.uvs === true;

  const positions = new Float32Array(anzahlEcken * 3);
  const normals = new Float32Array(anzahlEcken * 3);
  const uvs = mitUv ? new Float32Array(anzahlEcken * 2) : null;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  let e = 0; // laufender Eckenindex
  for (const box of boxes) {
    const ecken = boxVertices(box).map(toGltf);
    for (const quad of BOX_QUADS) {
      const n = flaechenNormale(ecken[quad[0]], ecken[quad[1]], ecken[quad[2]]);
      /*
        Die UV-Achsen einer achsenparallelen Fläche: die beiden Achsen,
        die NICHT die Normalenachse sind. In Metern, damit das Muster
        über Modulgrenzen läuft — dieselbe Absicht wie beim
        0,5-Kachelmass der Bodenplatten.
      */
      const achse = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
      const uAchse = (achse + 1) % 3;
      const vAchse = (achse + 2) % 3;
      for (const ecke of quad) {
        const p = ecken[ecke];
        positions[e * 3] = p[0];
        positions[e * 3 + 1] = p[1];
        positions[e * 3 + 2] = p[2];
        normals[e * 3] = n[0];
        normals[e * 3 + 1] = n[1];
        normals[e * 3 + 2] = n[2];
        if (uvs) {
          uvs[e * 2] = p[uAchse];
          uvs[e * 2 + 1] = p[vAchse];
        }
        for (let k = 0; k < 3; k++) {
          if (p[k] < min[k]) min[k] = p[k];
          if (p[k] > max[k]) max[k] = p[k];
        }
        e++;
      }
    }
  }

  // Indizes: je Fläche zwei Dreiecke (0,1,2) und (0,2,3) über die vier
  // eigenen Ecken — die Wicklung des Quads bleibt damit erhalten.
  const kurz = anzahlEcken <= USHORT_MAX_VERTICES;
  const anzahlIndizes = boxes.length * INDICES_PER_BOX;
  const indices = kurz ? new Uint16Array(anzahlIndizes) : new Uint32Array(anzahlIndizes);
  for (let f = 0, i = 0; f < boxes.length * 6; f++) {
    const b = f * 4;
    indices[i++] = b;
    indices[i++] = b + 1;
    indices[i++] = b + 2;
    indices[i++] = b;
    indices[i++] = b + 2;
    indices[i++] = b + 3;
  }

  // ── Binärteil zusammensetzen ──────────────────────────────────────────
  const abschnitte: { daten: ArrayBufferView; target: number }[] = [
    { daten: positions, target: TARGET_ARRAY_BUFFER },
    { daten: normals, target: TARGET_ARRAY_BUFFER },
  ];
  if (uvs) abschnitte.push({ daten: uvs, target: TARGET_ARRAY_BUFFER });
  abschnitte.push({ daten: indices, target: TARGET_ELEMENT_ARRAY_BUFFER });

  const bufferViews: Record<string, number>[] = [];
  let offset = 0;
  for (const a of abschnitte) {
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: a.daten.byteLength,
      target: a.target,
    });
    offset = auf4(offset + a.daten.byteLength);
  }
  const binLaenge = offset;
  const bin = new Uint8Array(binLaenge);
  for (let i = 0; i < abschnitte.length; i++) {
    const a = abschnitte[i];
    bin.set(
      new Uint8Array(a.daten.buffer, a.daten.byteOffset, a.daten.byteLength),
      bufferViews[i].byteOffset
    );
  }

  // ── Accessoren und JSON ───────────────────────────────────────────────
  // min/max nur bei POSITION: die Spezifikation verlangt sie dort und
  // nirgends sonst, und Blenders Exporter schreibt sie ebenso nur dort.
  const accessors: Record<string, unknown>[] = [
    {
      bufferView: 0,
      componentType: COMPONENT_FLOAT,
      count: anzahlEcken,
      type: 'VEC3',
      min: [...min],
      max: [...max],
    },
    { bufferView: 1, componentType: COMPONENT_FLOAT, count: anzahlEcken, type: 'VEC3' },
  ];
  const attributes: Record<string, number> = { POSITION: 0, NORMAL: 1 };
  if (uvs) {
    attributes.TEXCOORD_0 = accessors.length;
    accessors.push({
      bufferView: accessors.length,
      componentType: COMPONENT_FLOAT,
      count: anzahlEcken,
      type: 'VEC2',
    });
  }
  const indexAccessor = accessors.length;
  accessors.push({
    bufferView: accessors.length,
    componentType: kurz ? COMPONENT_USHORT : COMPONENT_UINT,
    count: anzahlIndizes,
    type: 'SCALAR',
  });

  const json = {
    asset: { generator: 'World of Vikings GlbWriter', version: '2.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ mesh: 0, name: options.name }],
    materials: [
      {
        /*
          `doubleSided: true` wie bei allen Kit-Modulen. Die Geometrie ist
          vorgespiegelt; ohne beidseitige Flächen entschiede allein die
          Wicklung darüber, ob man den Saal von innen sieht — und das ist
          genau die Eigenschaft, die hier absichtlich verdreht ist.
        */
        doubleSided: true,
        name: options.materialName ?? STONE_MATERIAL_NAME,
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1],
          metallicFactor: 0,
          roughnessFactor: 0.5,
        },
      },
    ],
    meshes: [
      { name: options.name, primitives: [{ attributes, indices: indexAccessor, material: 0 }] },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLaenge }],
  };

  // ── GLB-Hülle ─────────────────────────────────────────────────────────
  // JSON mit Leerzeichen auffüllen, Binärteil mit Nullen — so steht es in
  // der Spezifikation (4.4.3), und Leser, die den Rest mitparsen, sonst
  // stolpern.
  const jsonRoh = new TextEncoder().encode(JSON.stringify(json));
  const jsonLaenge = auf4(jsonRoh.byteLength);
  const jsonChunk = new Uint8Array(jsonLaenge).fill(0x20);
  jsonChunk.set(jsonRoh, 0);

  const gesamt = 12 + 8 + jsonLaenge + 8 + binLaenge;
  const out = new Uint8Array(gesamt);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, gesamt, true);
  view.setUint32(12, jsonLaenge, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonChunk, 20);
  view.setUint32(20 + jsonLaenge, binLaenge, true);
  view.setUint32(24 + jsonLaenge, CHUNK_BIN, true);
  out.set(bin, 28 + jsonLaenge);
  return out;
}
