/**
 * Upload placements must survive a boot with an unreadable upload registry.
 *
 * Bug: with a missing or invalid `registry.json` the server knows no uploaded
 * models. The layout reconciliation spares the ZDOs of their placements
 * ("bleiben unangetastet"), but saveWorld dropped every ZDO whose prefab is
 * unknown (`getByHash(...)?.isPersistent() ?? false`). The next boot with the
 * registry restored spawned a NEW ZDO: id and runtime state were gone.
 *
 * Rule under test: a ZDO of an UNKNOWN prefab is saved as loaded; a KNOWN
 * prefab that is not persistent is still dropped.
 *
 * Ablauf (echter WovServer, Port nie gebunden, Temp-Welt):
 *  1. Boot mit gueltiger Registry: Platzierung wird gespawnt, Zustand gesetzt, gespeichert.
 *  2. Boot mit `{"version":1}` (0 Modelle): Speichern behaelt das ZDO.
 *  3. Boot mit wiederhergestellter Registry: dieselbe id, derselbe Zustand.
 *  4. Registry fehlt (Datei entfernt): dasselbe, gefolgt von erneutem Boot.
 *  5. Gegenprobe: bekanntes, nicht persistentes Prefab wird weiter verworfen.
 *
 * Run: npx tsx server/test/upload-zdos-behalten.ts   (from the repo root)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { LAYOUT_ID_MEMBER, PREFAB_DEFS, PrefabFlag, getStableHash } from '@wov/shared';
import {
  ladeHochgeladeneRegistrierung,
  pruefeUndSpeichereUpload,
  sorgeFuerRegistryDatei,
} from '../../shared/src/uploadedModelUpload.js';
import { createWovServer } from '../src/WovServer.js';
import type { WorldSaveData } from '../src/world/WorldManager.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const BASIS = mkdtempSync(join(tmpdir(), 'upload-zdos-behalten-'));
const WELTEN = join(BASIS, 'welten');
const UPLOADS = join(BASIS, 'up');
const LAYOUT = join(BASIS, 'layout.json');
const REGISTRY = join(UPLOADS, 'registry.json');
const SAVE_FILE = join(WELTEN, 'world.db.zst');
const PLATZIERUNG = 'upload-zdos-behalten-probe';
const ZUSTAND = 'probeZustand';

// ── Ein minimales GLB (1-m-Quadrat), wie es das Upload-Tor annimmt.
function glb(): Uint8Array {
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const bin = new Uint8Array(60);
  const dv = new DataView(bin.buffer);
  pos.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  idx.forEach((v, i) => dv.setUint16(48 + i * 2, v, true));
  const j = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 12 },
    ],
    buffers: [{ byteLength: 60 }],
  };
  let s = JSON.stringify(j);
  while (s.length % 4) s += ' ';
  const jb = new TextEncoder().encode(s);
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const h = new DataView(out.buffer);
  h.setUint32(0, 0x46546c67, true);
  h.setUint32(4, 2, true);
  h.setUint32(8, total, true);
  h.setUint32(12, jb.length, true);
  h.setUint32(16, 0x4e4f534a, true);
  out.set(jb, 20);
  h.setUint32(20 + jb.length, bin.length, true);
  h.setUint32(24 + jb.length, 0x004e4942, true);
  out.set(bin, 28 + jb.length);
  return out;
}

mkdirSync(WELTEN, { recursive: true });
sorgeFuerRegistryDatei(UPLOADS);
const up = pruefeUndSpeichereUpload(
  { erlaubt: true, verzeichnis: UPLOADS, hochgeladenVon: 'test' },
  { bytes: glb(), angezeigterName: 'Zdotest', kollisionswunsch: 'fest' }
);
if (!up.ok) {
  console.error(`FAIL Upload nicht angenommen: ${up.meldung}`);
  process.exit(1);
}
const PREFAB = up.eintrag.name;
const PREFAB_HASH = getStableHash(PREFAB);
const REGISTRY_GUT = readFileSync(REGISTRY, 'utf8');

writeFileSync(
  LAYOUT,
  JSON.stringify({
    version: 1,
    name: 'Upload-ZDOs',
    detailSeed: 'KxSYuZquuw',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [],
      },
    ],
    placements: [{ id: PLATZIERUNG, prefab: PREFAB, x: 20, z: 20 }],
  })
);

// Ein bekanntes Prefab OHNE persistent-Flag fuer die Gegenprobe.
const fluechtig = PREFAB_DEFS.find((d) => (d.flags & PrefabFlag.PERSISTENT) === 0n);
const FLUECHTIG_HASH = getStableHash(fluechtig!.name);
const UNBEKANNT = getStableHash('Kein_Prefab_dieses_Namens_upload-zdos-behalten');

function boot(registry: 'gut' | 'ungueltig' | 'fehlt') {
  if (registry === 'gut') writeFileSync(REGISTRY, REGISTRY_GUT);
  else if (registry === 'ungueltig') writeFileSync(REGISTRY, '{"version":1}');
  else rmSync(REGISTRY, { force: true });
  // Wie main.ts: Registry ZUERST lesen (fehlende Datei = leere Registry), dann der Server.
  const geladen = ladeHochgeladeneRegistrierung(UPLOADS).geladen;
  const server = createWovServer({
    port: 0,
    worldName: 'world',
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    worldsDir: WELTEN,
    kontenDir: join(BASIS, 'konten'),
    forumDir: join(BASIS, 'forum'),
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
  } as Parameters<typeof createWovServer>[0]);
  server.init();
  const probe = () =>
    server.zdos.getAllZDOs().filter((z) => z.prefabHash === PREFAB_HASH && z.getString(LAYOUT_ID_MEMBER) === PLATZIERUNG);
  const gespeichert = (): WorldSaveData =>
    JSON.parse(zstdDecompressSync(readFileSync(SAVE_FILE)).toString('utf-8')) as WorldSaveData;
  return { server, geladen, probe, gespeichert };
}

console.log('=== Upload-ZDOs bleiben beim Speichern erhalten ===');
check('Gegenprobe-Prefab existiert (bekannt, nicht persistent)', fluechtig !== undefined, fluechtig?.name);

// ── [1] gueltige Registry
console.log('\n[1] Boot mit gueltiger Registry:');
const b1 = boot('gut');
check('1: Registry geladen (1 Modell)', b1.geladen === 1, `${b1.geladen}`);
const p1 = b1.probe();
check('1: Platzierung gespawnt (genau 1 ZDO)', p1.length === 1, `${p1.length}`);
const id1 = p1[0]!.zdoid.id;
p1[0]!.setString(ZUSTAND, 'laufzeit-zustand-1');
const fluecht = b1.server.zdos.createZDO(FLUECHTIG_HASH, { x: 5, y: 0, z: 5 });
const muell = b1.server.zdos.createZDO(UNBEKANNT, { x: 6, y: 0, z: 6 });
muell.setString(ZUSTAND, 'unbekannt-1');
b1.server.saveWorld();
const s1 = b1.gespeichert();
const hat = (s: WorldSaveData, hash: number) => s.zdos.some((z) => z.prefab === hash);
check('1: Upload-ZDO gespeichert', hat(s1, PREFAB_HASH));
check('1: bekanntes nicht persistentes ZDO verworfen (Gegenprobe)', !hat(s1, FLUECHTIG_HASH));
check('1: ZDO unbekannten Prefabs gespeichert wie geladen', hat(s1, UNBEKANNT));
// Hash 0 = no prefab at all (leftover of an editor session): never kept.
const null0 = b1.server.zdos.createZDO(0, { x: 7, y: 0, z: 7 });
null0.setString(ZUSTAND, 'hash0');
b1.server.saveWorld();
check('1: ZDO mit Hash 0 nicht gespeichert', !hat(b1.gespeichert(), 0));
check('1: unbekannter Hash != 0 weiter gespeichert (Gegenprobe)', hat(b1.gespeichert(), UNBEKANNT));
check('1: Zahl gespeicherter ZDOs unveraendert durch Hash 0', b1.gespeichert().zdos.length === s1.zdos.length);
b1.server.zdos.destroyZDO(null0.zdoid);
const anzahl1 = s1.zdos.length;
void fluecht;

// ── [2] ungueltige Registry: 0 Modelle
console.log('\n[2] Boot mit {"version":1} (0 Modelle):');
const b2 = boot('ungueltig');
check('2: keine Modelle geladen', b2.geladen === 0, `${b2.geladen}`);
check('2: ZDO aus dem Spielstand geladen', b2.server.zdos.getAllZDOs().some((z) => z.prefabHash === PREFAB_HASH));
b2.server.saveWorld();
const s2 = b2.gespeichert();
check('2: Zahl der gespeicherten ZDOs gleich', s2.zdos.length === anzahl1, `${s2.zdos.length}/${anzahl1}`);
check('2: Upload-ZDO weiter im Spielstand', hat(s2, PREFAB_HASH));

// ── [3] Registry wiederhergestellt
console.log('\n[3] Boot mit wiederhergestellter Registry:');
const b3 = boot('gut');
check('3: Registry geladen (1 Modell)', b3.geladen === 1, `${b3.geladen}`);
const p3 = b3.probe();
check('3: genau 1 Upload-ZDO (kein zweites gespawnt)', p3.length === 1, `${p3.length}`);
check('3: dieselbe ZDO-id', p3[0]?.zdoid.id === id1, `${p3[0]?.zdoid.id}/${id1}`);
check('3: derselbe Zustand', p3[0]?.getString(ZUSTAND) === 'laufzeit-zustand-1');
check(
  '3: Zahl der ZDOs gleich wie nach Boot 1',
  b3.server.zdos.getAllZDOs().length === b1.server.zdos.getAllZDOs().length - 1, // ohne fluecht
  `${b3.server.zdos.getAllZDOs().length}`
);
b3.server.saveWorld();
check('3: Zahl gespeicherter ZDOs gleich', b3.gespeichert().zdos.length === anzahl1);

// ── [4] Registry fehlt
console.log('\n[4] Registry fehlt:');
const b4 = boot('fehlt');
check('4: keine Modelle geladen', b4.geladen === 0, `${b4.geladen}`);
b4.server.saveWorld();
check('4: Zahl gespeicherter ZDOs gleich', b4.gespeichert().zdos.length === anzahl1, `${b4.gespeichert().zdos.length}/${anzahl1}`);
const b5 = boot('gut');
const p5 = b5.probe();
check('4: nach Wiederherstellung dieselbe id', p5.length === 1 && p5[0]!.zdoid.id === id1, `${p5.map((z) => z.zdoid.id)}/${id1}`);
check('4: derselbe Zustand', p5[0]?.getString(ZUSTAND) === 'laufzeit-zustand-1');

// ── Wachstum: Speichern haengt nichts an, Zahl bleibt ueber viele Boots gleich
console.log('\n[5] Kein Wachstum ueber wiederholte Boots ohne Registry:');
for (let i = 0; i < 3; i++) {
  const b = boot('fehlt');
  b.server.saveWorld();
  check(`5: Boot ${i + 1} ohne Registry speichert ${anzahl1}`, b.gespeichert().zdos.length === anzahl1, `${b.gespeichert().zdos.length}`);
}

rmSync(BASIS, { recursive: true, force: true });
check('Temp-Welt entfernt', !existsSync(BASIS));
console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
