/**
 * Prüft die Store-Labor-Pflanzen (Blumen, Farn): dass die eingecheckte
 * Messliste `tools/store-lab-katalog.json`, die erzeugte Registry und die
 * Übersetzungen zusammenpassen, und dass `store-pflanzen-quellen.mjs` aus
 * einer Export-GLB das Verlangte baut (Material, Alpha MASK, zweiseitig,
 * Bild unverändert daneben, Geometrie unberührt).
 *
 * Läuft ohne Assets (auch im CI): Die Liste ist eingecheckt, die
 * Umbau-Probe baut sich ihre GLB selbst.
 *
 *   npx tsx tools/test/store-lab-katalog.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_PREFAB_DEFS } from '@wov/shared';
import { STORE_KATALOG_NACH_ID } from '@wov/shared/src/storeKatalogDaten.js';
import { repoText } from '@wov/shared/src/texte.js';
// @ts-expect-error — .mjs ohne Typen
import { MATERIALNAMEN, MODELLE, glbLesen, glbSchreiben, umbauen } from '../store-pflanzen-quellen.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface LabEintrag {
  id: string;
  pfad: string;
  prefab: string;
  textKey: string;
  bytes: number;
  hash: string;
  bounds: { min: number[]; max: number[] };
  dreiecke: number;
  material: string;
  alphaModus: string;
  zweiseitig: boolean;
  textur: { datei: string; bytes: number; hash: string };
}
const liste = JSON.parse(readFileSync(join(WURZEL, 'tools/store-lab-katalog.json'), 'utf8')) as {
  eintraege: LabEintrag[];
};

// ── Die Liste deckt genau die Modelle des Werkzeugs ──────────────────
const erwartet = (MODELLE as { id: string }[]).map((m) => `vegetation/${m.id}`).sort();
check(
  'Messliste führt genau die drei Modelle des Werkzeugs',
  JSON.stringify(liste.eintraege.map((e) => e.id).sort()) === JSON.stringify(erwartet),
  liste.eintraege.map((e) => e.id).join(', ')
);

// ── Je Eintrag: Registry, Katalog, Übersetzung ───────────────────────
for (const e of liste.eintraege) {
  const def = STORE_PREFAB_DEFS.find((d) => d.name === e.prefab);
  check(`${e.prefab}: Prefab ist registriert`, def !== undefined);
  check(
    `${e.prefab}: Modellpfad zeigt ins Labor`,
    def?.model === `store-lab/${e.pfad.replace(/\.glb$/, '')}`,
    String(def?.model)
  );
  const k = STORE_KATALOG_NACH_ID.get(e.id);
  check(`${e.id}: Katalogeintrag vorhanden`, k !== undefined);
  check(`${e.id}: Katalog trägt Hash und Grösse der Liste`, k?.hash === e.hash && k?.bytes === e.bytes);
  check(
    `${e.id}: Katalog trägt die Hüllbox der Liste`,
    JSON.stringify(k?.bounds) === JSON.stringify(e.bounds)
  );
  check(`${e.id}: Katalog verweist auf das Prefab`, k?.prefabName === e.prefab);
  check(`${e.id}: Lizenzstatus intern`, k?.lizenzstatus === 'intern');
  check(`${e.id}: Alpha MASK und zweiseitig`, e.alphaModus === 'MASK' && e.zweiseitig === true);
  check(`${e.id}: Materialrolle steht in der Tabelle`, Object.values(MATERIALNAMEN as Record<string, { rolle: string }>).some((m) => m.rolle === e.material));

  const de = repoText(e.textKey, 'de');
  const en = repoText(e.textKey, 'en');
  check(`${e.textKey}: deutscher Text`, typeof de === 'string' && de.length > 0);
  check(`${e.textKey}: englischer Text`, typeof en === 'string' && en.length > 0);
  check(`${e.textKey}: Sprachen unterscheiden sich`, de !== en, `${String(de)} / ${String(en)}`);
  check(`${e.textKey}: Schlüssel gehört zum Prefab`, e.textKey === `inhalt.prefab.${e.prefab.replace(/-/g, "_")}`);
  check(`${e.id}: Texturdatei liegt neben dem Modell`, /^textures\/[a-z0-9-]+\.png$/.test(e.textur.datei));
}

// ── Umbau-Probe mit einer selbstgebauten Export-GLB ──────────────────
function exportGlb(materialName: string): { glb: Buffer; png: Buffer } {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('probe-bild')]);
  const pos = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.from([0, 0, 1, 0, 2, 0, 0, 0]); // 3 Indizes + Pad
  const pngPad = Buffer.alloc((4 - (png.length % 4)) % 4);
  // Das Bild steht ZUERST im BIN (bufferView 0): Nach dem Herausnehmen
  // rutschen die Geometrie-Views um eins, die Accessoren müssen mit.
  const bin = Buffer.concat([png, pngPad, pos, idx]);
  const geo = png.length + pngPad.length;
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: png.length },
      { buffer: 0, byteOffset: geo, byteLength: 36 },
      { buffer: 0, byteOffset: geo + 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: materialName, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
    nodes: [{ name: 'Probe', mesh: 0 }],
    scenes: [{ nodes: [0] }],
  };
  return { glb: glbSchreiben(json, bin), png };
}

const probe = exportGlb('Flowers_A 1');
const r = umbauen(probe.glb, 'flower-probe', 'probe.glb');
const { json: neu, bin: neuBin } = glbLesen(r.glb);
const mat = neu.materials[0];
check('Umbau: Material heisst nach der Rolle', mat.name === 'blume', mat.name);
check('Umbau: alphaMode MASK', mat.alphaMode === 'MASK');
check('Umbau: zweiseitig', mat.doubleSided === true);
check('Umbau: Cutoff 0,5', mat.alphaCutoff === 0.5);
check('Umbau: Bild als Datei neben dem Modell', /^textures\/blume-[0-9a-f]{8}\.png$/.test(neu.images[0].uri), neu.images[0].uri);
check('Umbau: kein eingebettetes Bild mehr', neu.images[0].bufferView === undefined && neu.bufferViews.length === 2);
check('Umbau: Bildbytes unverändert', r.png.equals(probe.png));
check(
  'Umbau: Bildname trägt den Hash der Bildbytes',
  r.bildName === `blume-${createHash('sha256').update(probe.png).digest('hex').slice(0, 8)}`
);
check('Umbau: Dreiecke', r.dreiecke === 1);
check('Umbau: Hüllbox aus den Positionen', JSON.stringify(r.huellbox) === JSON.stringify({ min: [0, 0, 0], max: [1, 1, 0] }));
const posNeu = neuBin.subarray(neu.bufferViews[neu.accessors[0].bufferView].byteOffset, neu.bufferViews[neu.accessors[0].bufferView].byteOffset + 36);
check('Umbau: Geometrie bitgleich', posNeu.length === 36 && posNeu.readFloatLE(12) === 1);
const idxView = neu.bufferViews[neu.accessors[1].bufferView];
check(
  'Umbau: Indexaccessor zeigt auf seinen (verschobenen) bufferView',
  idxView?.byteLength === 6 && neuBin.readUInt16LE(idxView.byteOffset + 2) === 1 && neuBin.readUInt16LE(idxView.byteOffset + 4) === 2,
  JSON.stringify(neu.accessors[1])
);
check('Umbau: Wurzelknoten trägt die Kennung', neu.nodes[neu.scenes[0].nodes[0]].name === 'flower-probe', JSON.stringify(neu.nodes));
check('Umbau: zweiter Lauf byteidentisch', umbauen(probe.glb, 'flower-probe', 'probe.glb').glb.equals(r.glb));

const farn = umbauen(exportGlb('Plant_Leaves_1A3 1').glb, 'fern-probe', 'probe.glb');
const farnMat = glbLesen(farn.glb).json.materials[0];
check('Farn: Rolle farn mit Tönungsfaktor', farnMat.name === 'farn' && farnMat.pbrMetallicRoughness.baseColorFactor?.length === 4);
check('Blume: keine Tönung', mat.pbrMetallicRoughness.baseColorFactor === undefined);

let meldung = '';
try {
  umbauen(exportGlb('Unbekannt 7').glb, 'x', 'probe.glb');
} catch (e) {
  meldung = (e as Error).message;
}
check('Unbekanntes Material wird mit Namen abgewiesen', meldung.includes('unbekanntes Material Unbekannt 7'), meldung);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-lab-katalog: alles grün');
