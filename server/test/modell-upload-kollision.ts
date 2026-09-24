/**
 * U1 — Kollision eines hochgeladenen Modells, an der ECHTEN
 * Server-Kollisionskette gemessen: `KollisionsFormen` (leitet die Form
 * ab, wie beim Serverstart) → `Kollisionswelt.nahfeldAus` →
 * `bewegungsSchritt` (derselbe Bewegungsschritt, den `WovServer` für
 * jeden Spieler rechnet). Kein Mock der Kollision — dieselben drei
 * Funktionen, die auf dem echten Spielserver stehen.
 *
 * Muster wortgleich zu `server/test/kollision-schritt.ts` Abschnitt [A]
 * ("Formen ohne ZDO"): `nahfeldAus` nimmt fertige Formen samt Position,
 * kein ZDO, keine Welt. Neu ist NUR, woher die Form kommt — nicht aus
 * einer Kiste() im Test, sondern aus `KollisionsFormen.formFuer(name)`
 * für ein per `pruefeUndSpeichereUpload` ECHT geschriebenes, ECHT
 * registriertes Upload-Prefab.
 *
 * ── Was das beweist (Karte, Abschnitt 4 „Kollision") ─────────────────
 *   „fest": Voreinstellung ist eine Kiste aus der gemessenen Hüllbox —
 *   eine Figur, die dagegenläuft, hält davor.
 *   „durchlässig": `KollisionsFormen.formFuer(...)` liefert `null` —
 *   dieselbe Funktion, mit der der echte Spielserver bei jedem Schritt
 *   fragt, ob ein Prefab überhaupt einen Körper hat.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pruefeUndSpeichereUpload } from '@wov/shared/src/uploadedModelUpload.js';
import { unregisterUploadedPrefab } from '@wov/shared/src/uploadedModelRegistry.js';
import { bewegungsSchritt } from '@wov/shared/src/bewegung/schritt.js';
import { GEH_TEMPO } from '@wov/shared/src/bewegung/masse.js';

import { KollisionsFormen } from '../src/world/KollisionsFormen.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import type { ZDOManager } from '../src/zdo/ZDOManager.js';
import type { PrefabManager } from '../src/prefab/PrefabManager.js';

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

// ── Ein winziges, gültiges GLB — genug für die Prüfung (Hüllbox aus drei Ecken). ──
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function bauGlb(groesse: number): Uint8Array {
  const positionen = new Float32Array([0, 0, 0, groesse, 0, 0, 0, groesse, groesse]);
  const posBytes = Buffer.from(positionen.buffer, positionen.byteOffset, positionen.byteLength);
  const indizes = new Uint32Array([0, 1, 2]);
  const idxBytes = Buffer.from(indizes.buffer, indizes.byteOffset, indizes.byteLength);
  const bin = Buffer.concat([posBytes, idxBytes]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Sicht', mesh: 0 }],
    meshes: [{ name: 'Sicht', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
    materials: [{ name: 'M0' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  let binBuf = bin;
  binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4, 0)]);
  const jsonChunk = Buffer.concat([u32le(jsonBuf.length), u32le(0x4e4f534a), jsonBuf]);
  const binChunk = Buffer.concat([u32le(binBuf.length), u32le(0x004e4942), binBuf]);
  const kopf = Buffer.concat([u32le(0x46546c67), u32le(2), u32le(12 + jsonChunk.length + binChunk.length)]);
  const voll = Buffer.concat([kopf, jsonChunk, binChunk]);
  return new Uint8Array(voll.buffer, voll.byteOffset, voll.byteLength);
}

const dir = mkdtempSync(join(tmpdir(), 'wov-modell-kollision-'));
const hochgeladenDir = join(dir, 'hochgeladen');
mkdirSync(hochgeladenDir, { recursive: true });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

console.log('\n1. Voreinstellung „fest": Kiste aus der gemessenen Hüllbox\n');

const festAntwort = pruefeUndSpeichereUpload(
  { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
  { bytes: bauGlb(2), angezeigterName: 'Kollisionskiste', kollisionswunsch: 'fest' }
);
check(festAntwort.ok, `Upload 'fest' angenommen (${festAntwort.ok ? festAntwort.eintrag.name : festAntwort.meldung})`);

if (festAntwort.ok) {
  const name = festAntwort.eintrag.name;
  // `dir` ist der ASSET-Wurzel-Parameter von KollisionsFormen — genau der Ordner,
  // unter dem `hochgeladen/<name>.glb` liegt (dieselbe Rechnung wie ASSET_WURZEL).
  const formen = new KollisionsFormen(dir);
  const form = formen.formFuer(name);
  check(form !== null, 'KollisionsFormen.formFuer(...) liefert einen Körper (nicht null)');
  check(form?.art === 'kiste', `Form ist eine Kiste, nicht Netz/Kapsel (art=${form?.art})`);

  if (form) {
    const zdos = {} as ZDOManager;
    const prefabs = {} as PrefabManager;
    const eben = new Kollisionswelt(zdos, prefabs, () => 0);
    const nah = eben.nahfeldAus([{ form, position: { x: 7, y: 0, z: 0 } }]);

    let pos = { x: 0, y: 0, z: 0 };
    const schrittSekunden = 1 / 20;
    for (let i = 0; i < Math.round(5 / schrittSekunden); i++) {
      pos = bewegungsSchritt(pos, { x: 1, z: 0, rennt: false }, schrittSekunden, nah, nah);
    }
    // Die Hüllbox ist 2 m breit; `leseGlb` spiegelt x (Babylon-Clientraum,
    // s. Kopf von shared/src/kollision/glb.ts), aus lokal x=[0,2] wird also
    // x=[-2,0] — an Weltposition x=7 verschoben steht die nahe Flanke bei
    // x=5, nicht bei 7. Genau DAS ist der Punkt dieses Tests: Die echte
    // Kette (inklusive Spiegelung) entscheidet, nicht eine Annahme im Test.
    check(
      pos.x > 3.5 && pos.x < 5.1,
      `5 s geradeaus gegen das hochgeladene Modell: hält davor (x=${pos.x.toFixed(3)}, Flanke bei 5)`
    );
    check(
      pos.x < 5 * GEH_TEMPO,
      `... und kommt deutlich weniger weit als die freien ${(5 * GEH_TEMPO).toFixed(2)} m ohne Hindernis`
    );
  }
  unregisterUploadedPrefab(name);
}

console.log('\n2. Kollisionswunsch „durchlässig": kein Körper\n');

const durchlaessigAntwort = pruefeUndSpeichereUpload(
  { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
  { bytes: bauGlb(2), angezeigterName: 'Deko Ohne Koerper', kollisionswunsch: 'durchlaessig' }
);
check(durchlaessigAntwort.ok, `Upload 'durchlaessig' angenommen (${durchlaessigAntwort.ok ? durchlaessigAntwort.eintrag.name : durchlaessigAntwort.meldung})`);

if (durchlaessigAntwort.ok) {
  const name = durchlaessigAntwort.eintrag.name;
  const formen = new KollisionsFormen(dir);
  const form = formen.formFuer(name);
  check(form === null, `KollisionsFormen.formFuer(...) liefert KEINEN Körper (art=${form === null ? 'null' : (form as { art: string }).art})`);

  const zdos = {} as ZDOManager;
  const prefabs = {} as PrefabManager;
  const eben = new Kollisionswelt(zdos, prefabs, () => 0);
  // Ohne Form nichts ins Nahfeld zu geben ist der Normalfall auf dem
  // echten Server (formFuer === null heisst: gar nicht erst einbauen) —
  // die Gegenprobe hier ist deshalb ein LEERES Nahfeld, nicht eines mit
  // der (nicht vorhandenen) Form.
  const nah = eben.nahfeldAus([]);
  let pos = { x: 0, y: 0, z: 0 };
  const schrittSekunden = 1 / 20;
  for (let i = 0; i < Math.round(5 / schrittSekunden); i++) {
    pos = bewegungsSchritt(pos, { x: 1, z: 0, rennt: false }, schrittSekunden, nah, nah);
  }
  check(
    Math.abs(pos.x - 5 * GEH_TEMPO) < 1e-6,
    `5 s geradeaus ohne Hindernis: läuft die vollen ${(5 * GEH_TEMPO).toFixed(2)} m (x=${pos.x.toFixed(3)}) — „durchlässig" bremst nicht`
  );
  unregisterUploadedPrefab(name);
}

console.log(failures === 0 ? '\nU1-Kollision: alles grün.\n' : `\nU1-Kollision: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
