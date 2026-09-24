/* eslint-disable @typescript-eslint/no-explicit-any -- rohes glTF-JSON, absichtlich ungetypt */
/**
 * U1-N5 — Wächter: GLB streng lesen und die Reste aus dem Angriff auf U1-N4.
 *
 * Das Prüftor und Babylon müssen DIESELBE Datei sehen. Babylon liest den
 * ersten Chunk und hört an der Kopflänge auf; der frühere `parseGlbChunks`
 * nahm den letzten und ignorierte Kopfversion und Kopflänge (A1). Jede
 * Probe hier baut die Bytes selbst (eigener Schreiber, nicht der des
 * Prüftors) und prüft Antwort UND Platte.
 */
import fs, { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGlbChunks } from '@wov/shared/src/kollision/glb.js';
import { entferneUpload, leseRegistry, pruefeUndSpeichereUpload, type UploadKontext } from '@wov/shared/src/uploadedModelUpload.js';
import { leseRegistryAusText, unregisterUploadedPrefab } from '@wov/shared/src/uploadedModelRegistry.js';

let failures = 0;
function check(bedingung: boolean, was: string): void {
  console.log(`  ${bedingung ? 'ok  ' : 'FAIL'} ${was}`);
  if (!bedingung) failures++;
}
const ordner: string[] = [];
function neuerOrdner(): string {
  const d = mkdtempSync(join(tmpdir(), 'wov-glb-streng-'));
  ordner.push(d);
  return d;
}
function kontext(dir: string): UploadKontext {
  return { erlaubt: true, verzeichnis: dir, hochgeladenVon: 'test@127.0.0.1' };
}

// ── eigener GLB-Schreiber ───────────────────────────────────────────────
const JSON_T = 0x4e4f534a;
const BIN_T = 0x004e4942;
const pad = (b: Uint8Array, f: number): Uint8Array => {
  const r = b.length % 4;
  if (!r) return b;
  const o = new Uint8Array(b.length + 4 - r);
  o.set(b);
  o.fill(f, b.length);
  return o;
};
const jsonBytes = (j: unknown): Uint8Array => pad(new TextEncoder().encode(JSON.stringify(j)), 0x20);
function binUndJson(s = 1): { j: any; bin: Uint8Array } {
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1].map((v) => v * s);
  const bin = new Uint8Array(60);
  const dv = new DataView(bin.buffer);
  pos.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  [0, 1, 2, 0, 2, 3].forEach((v, i) => dv.setUint16(48 + i * 2, v, true));
  const j = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'n0' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [s, s, s] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
    ],
    buffers: [{ byteLength: 60 }],
  };
  return { j, bin };
}
interface Chunk { typ: number; daten: Uint8Array }
function bauRoh(chunks: Chunk[], o: { version?: number; kopf?: (echt: number) => number; rest?: number } = {}): Uint8Array {
  const total = 12 + chunks.reduce((s, c) => s + 8 + c.daten.length, 0) + (o.rest ?? 0);
  const out = new Uint8Array(total);
  const h = new DataView(out.buffer);
  h.setUint32(0, 0x46546c67, true);
  h.setUint32(4, o.version ?? 2, true);
  h.setUint32(8, o.kopf ? o.kopf(total) : total, true);
  let p = 12;
  for (const c of chunks) {
    h.setUint32(p, c.daten.length, true);
    h.setUint32(p + 4, c.typ, true);
    out.set(c.daten, p + 8);
    p += 8 + c.daten.length;
  }
  return out;
}
function bauGlb(mach?: (j: any) => void, s = 1): Uint8Array {
  const { j, bin } = binUndJson(s);
  mach?.(j);
  return bauRoh([{ typ: JSON_T, daten: jsonBytes(j) }, { typ: BIN_T, daten: bin }]);
}
const BOESE = (): any => {
  const { j } = binUndJson(3000);
  (j as any).extensionsUsed = ['KHR_lights_punctual'];
  return j;
};

function versuche(bytes: Uint8Array, name: string): { ok: boolean; meldung: string; platte: number } {
  const dir = neuerOrdner();
  const a = pruefeUndSpeichereUpload(kontext(dir), { bytes, angezeigterName: name, kollisionswunsch: 'fest' });
  if (a.ok) unregisterUploadedPrefab(a.eintrag.name);
  return { ok: a.ok, meldung: a.ok ? '' : a.meldung, platte: readdirSync(dir).filter((f) => f.endsWith('.glb')).length };
}
function abgelehnt(was: string, bytes: Uint8Array, muster: RegExp): void {
  const r = versuche(bytes, 'Streng');
  check(!r.ok && muster.test(r.meldung) && r.platte === 0, `${was} → abgelehnt (${r.ok ? 'ANGENOMMEN' : r.meldung.slice(0, 90)}), Platte leer`);
}

console.log('\n1. Grundfall: eine ordentliche GLB geht weiter durch\n');
{
  const r = versuche(bauGlb(), 'Sauber');
  check(r.ok && r.platte === 1, 'normale GLB angenommen');
  check(parseGlbChunks(bauGlb()).bin.byteLength === 60, 'parseGlbChunks: BIN gelesen');
  const nurJson = bauRoh([{ typ: JSON_T, daten: jsonBytes(binUndJson().j) }]);
  check(parseGlbChunks(nurJson).bin.byteLength === 0, 'JSON ohne BIN bleibt lesbar');
}

console.log('\n2. A1 — Tor und Babylon lesen dieselben Chunks\n');
{
  const { j: sauber, bin } = binUndJson(1);
  const boese = BOESE();
  // (a) v2: [JSON böse][BIN][JSON sauber], Kopflänge endet nach BIN
  const a = bauRoh([{ typ: JSON_T, daten: jsonBytes(boese) }, { typ: BIN_T, daten: bin }, { typ: JSON_T, daten: jsonBytes(sauber) }], {
    kopf: (t) => t - 8 - jsonBytes(sauber).length,
  });
  abgelehnt('A1a: [JSON böse][BIN][JSON sauber], Kopflänge kürzer', a, /Kopflänge/);
  // dasselbe mit ehrlicher Kopflänge: dritter Chunk
  abgelehnt('A1a′: dieselbe Folge mit Kopflänge = Dateilänge', bauRoh([{ typ: JSON_T, daten: jsonBytes(boese) }, { typ: BIN_T, daten: bin }, { typ: JSON_T, daten: jsonBytes(sauber) }]), /weiterer Chunk/);
  // (b) zweiter BIN hinter der Kopflänge
  const b = bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }, { typ: BIN_T, daten: bin }], { kopf: (t) => t - 8 - bin.length });
  abgelehnt('A1b: zweiter BIN hinter der Kopflänge', b, /Kopflänge/);
  abgelehnt('A1b′: zweiter BIN bei ehrlicher Kopflänge', bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }, { typ: BIN_T, daten: bin }]), /weiterer Chunk/);
  // (c) Kopfversion 1
  abgelehnt('A1c: Kopfversion 1', bauRoh([{ typ: 0, daten: jsonBytes(boese) }, { typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }], { version: 1 }), /Version 1/);
  abgelehnt('Kopfversion 3', bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }], { version: 3 }), /Version 3/);
  // weitere Formen
  abgelehnt('Kopflänge zu groß', bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }], { kopf: (t) => t + 4 }), /Kopflänge/);
  abgelehnt('erster Chunk ist BIN', bauRoh([{ typ: BIN_T, daten: bin }, { typ: JSON_T, daten: jsonBytes(sauber) }]), /erste Chunk muss der JSON/);
  abgelehnt('Restbytes hinter dem BIN (Kopflänge deckt sie)', bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }], { rest: 3 }), /Chunk-Kopf/);
  abgelehnt('fremder zweiter Chunk (Typ 0)', bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: 0, daten: bin }]), /weiterer Chunk/);
  // Länge nicht 4-ausgerichtet: JSON-Chunk mit 1 Byte Überlänge
  const unger = bauRoh([{ typ: JSON_T, daten: new Uint8Array([...new TextEncoder().encode(JSON.stringify(sauber)), 0x20].slice(0, Math.max(1, jsonBytes(sauber).length - 1))) }, { typ: BIN_T, daten: bin }]);
  abgelehnt('JSON-Chunk nicht 4-Byte-ausgerichtet', unger, /4-Byte/);
  // Chunk-Länge ragt über das Ende
  const lang = bauRoh([{ typ: JSON_T, daten: jsonBytes(sauber) }, { typ: BIN_T, daten: bin }]);
  new DataView(lang.buffer).setUint32(12 + 8 + jsonBytes(sauber).length, 1_000_000, true);
  abgelehnt('BIN-Länge ragt über das Dateiende', lang, /Dateiende/);
  abgelehnt('Datei kürzer als der Kopf', new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]), /Kopf unvollständig/);
}

console.log('\n3. A2 — extensionsRequired ⊆ extensionsUsed\n');
{
  abgelehnt('Required [unlit] ohne Used', bauGlb((j) => (j.extensionsRequired = ['KHR_materials_unlit'])), /extensionsUsed/);
  abgelehnt('Required [unlit], Used [clearcoat]', bauGlb((j) => { j.extensionsRequired = ['KHR_materials_unlit']; j.extensionsUsed = ['KHR_materials_clearcoat']; }), /extensionsUsed/);
  const ok = versuche(bauGlb((j) => { j.extensionsRequired = ['KHR_materials_unlit']; j.extensionsUsed = ['KHR_materials_unlit']; }), 'Beides');
  check(ok.ok, 'Required ⊆ Used wird angenommen');
}

console.log('\n4. Info — nicht-endliche Zahlen in Erweiterungen\n');
{
  const mat = (ext: string, wert: string): Uint8Array => {
    const { j, bin } = binUndJson(1);
    (j as any).extensionsUsed = [ext];
    (j as any).materials = [{ extensions: { [ext]: 'X' } }];
    (j as any).meshes[0].primitives[0].material = 0;
    const text = JSON.stringify(j).replace('"X"', wert);
    const b = pad(new TextEncoder().encode(text), 0x20);
    return bauRoh([{ typ: JSON_T, daten: b }, { typ: BIN_T, daten: bin }]);
  };
  abgelehnt('emissive_strength 1e999', mat('KHR_materials_emissive_strength', '{"emissiveStrength":1e999}'), /nicht-endlich/);
  abgelehnt('texture_transform scale 1e999', mat('KHR_texture_transform', '{"scale":[1e999,1]}'), /nicht-endlich/);
  abgelehnt('texture_transform rotation -1e999', mat('KHR_texture_transform', '{"rotation":-1e999}'), /nicht-endlich/);
  const ok = versuche(mat('KHR_materials_emissive_strength', '{"emissiveStrength":2.5}'), 'Endlich');
  check(ok.ok, 'endliche Leuchtstärke bleibt erlaubt');
}

console.log('\n5. A3 — Registry vorhanden, aber ohne gültige modelle-Liste: Upload lehnt ab, überschreibt nie\n');
{
  const formen: [string, string][] = [
    ['{"version":1}', 'ohne Liste'],
    ['null', 'null'],
    ['[]', 'Liste statt Objekt'],
    ['{"version":1,"modelle":{}}', 'modelle als Objekt'],
    ['{"version":1,"modelle":"x"}', 'modelle als Text'],
    ['7', 'Zahl'],
  ];
  for (const [text, was] of formen) {
    const dir = neuerOrdner();
    const alt = pruefeUndSpeichereUpload(kontext(dir), { bytes: bauGlb(), angezeigterName: 'Alt', kollisionswunsch: 'fest' });
    check(alt.ok, `(${was}) Vorbereitung: Alt hochgeladen`);
    if (!alt.ok) continue;
    unregisterUploadedPrefab(alt.eintrag.name);
    const datei = join(dir, `${alt.eintrag.name}.glb`);
    const vorher = readFileSync(datei);
    writeFileSync(join(dir, 'registry.json'), text);
    const neu = pruefeUndSpeichereUpload(kontext(dir), { bytes: bauGlb(undefined, 400), angezeigterName: 'Alt', kollisionswunsch: 'fest' });
    if (neu.ok) unregisterUploadedPrefab(neu.eintrag.name);
    check(!neu.ok, `(${was}) Upload abgelehnt`);
    check(readFileSync(datei).equals(vorher), `(${was}) die vorhandene .glb ist unverändert`);
    check(readFileSync(join(dir, 'registry.json'), 'utf8') === text, `(${was}) registry.json unberührt`);
    const ent = entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei: join(dir, 'welt.json') }, alt.eintrag.name, true);
    check(!ent.ok && existsSync(datei), `(${was}) auch das Entfernen fasst nichts an`);
  }
  // echte Waise bei GÜLTIGER Registry darf weiter ersetzt werden
  const dir = neuerOrdner();
  writeFileSync(join(dir, 'registry.json'), '{"version":1,"modelle":[]}');
  writeFileSync(join(dir, 'U_Waise.glb'), 'alt');
  const w = pruefeUndSpeichereUpload(kontext(dir), { bytes: bauGlb(), angezeigterName: 'Waise', kollisionswunsch: 'fest' });
  if (w.ok) unregisterUploadedPrefab(w.eintrag.name);
  check(w.ok && readFileSync(join(dir, 'U_Waise.glb')).length > 3, 'Waise bei gültiger (leerer) Registry wird ersetzt');
}

console.log('\n6. A4 — leseRegistryAusText verwirft Nicht-Objekt-Einträge für alle Leser\n');
{
  const gut = { name: 'U_Gut' };
  const st = leseRegistryAusText(JSON.stringify({ version: 1, modelle: [null, 5, 'x', [1], gut, {}] }));
  check(st.modelle.length === 2, 'null, Zahl, Text, Liste verworfen; Objekte bleiben');
  let warf = false;
  try {
    st.modelle.map((m) => m.name);
  } catch {
    warf = true;
  }
  check(!warf, '.map((m) => m.name) wirft nicht mehr (MCP-/Client-/Admin-Leser)');
  check(leseRegistryAusText('null').modelle.length === 0 && leseRegistryAusText('kaputt').modelle.length === 0, 'null/kaputt bleibt eine leere Registry');
}

console.log('\n7. Info — scheitert auch das zweite DELETE im Halbzustand, bleibt es „teilweise“\n');
{
  const dir = neuerOrdner();
  const layoutDatei = join(dir, 'welt.json');
  const erster = pruefeUndSpeichereUpload(kontext(dir), { bytes: bauGlb(), angezeigterName: 'Halb', kollisionswunsch: 'fest' });
  check(erster.ok, 'Vorbereitung: Upload angenommen');
  if (erster.ok) {
    const name = erster.eintrag.name;
    const EIO = (): never => { throw Object.assign(new Error('EIO /geheim'), { code: 'EIO' }); };
    const echtRename = fs.renameSync;
    const echtWrite = fs.writeFileSync;
    const orig = { renameSync: fs.renameSync, writeFileSync: fs.writeFileSync };
    const halb = (): ReturnType<typeof entferneUpload> => {
      Object.assign(fs, {
        writeFileSync: (p: string, ...r: unknown[]) => (String(p).endsWith('registry.json.neu') ? EIO() : (echtWrite as (...a: unknown[]) => unknown)(p, ...r)),
        renameSync: (von: string, nach: string) => (String(von).includes('/entfernt/') ? EIO() : echtRename(von, nach)),
      });
      syncBuiltinESMExports();
      try {
        return entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei }, name, true);
      } finally {
        Object.assign(fs, orig);
        syncBuiltinESMExports();
      }
    };
    const a1 = halb();
    check(!a1.ok && /teilweise/.test((a1 as { meldung: string }).meldung), 'erstes DELETE (Doppelausfall): teilweise');
    const a2 = halb();
    const m2 = !a2.ok && 'meldung' in a2 ? a2.meldung : '';
    check(!a2.ok && /teilweise/.test(m2) && !/nichts wurde entfernt/.test(m2), `zweites DELETE scheitert am Registry-Schreiben: weiter „teilweise“ (${m2.slice(0, 70)})`);
    check(!m2.includes('/geheim') && !m2.includes(dir), 'ohne Pfad');
    const a3 = entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei }, name, true);
    check(a3.ok && leseRegistry(dir).modelle.length === 0, 'das dritte DELETE räumt auf');
  }
}

for (const d of ordner) rmSync(d, { recursive: true, force: true });
console.log(failures === 0 ? '\nU1-N5: alles grün.\n' : `\nU1-N5: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
