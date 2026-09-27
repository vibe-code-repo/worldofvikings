/**
 * Grundskala in der Server-Kollision (Karte „Editor Upload-Größe",
 * Auftrag Punkt 3) — an der ECHTEN Kette gemessen, wie
 * `server/test/modell-upload-kollision.ts`: `pruefeUndSpeichereUpload` →
 * `KollisionsFormen.formFuer(name)` → `Kollisionswelt.nahfeldAus` →
 * `bewegungsSchritt` (derselbe Bewegungsschritt, den `WovServer` für jeden
 * Spieler rechnet). Kein Mock der Kollision.
 *
 * Zusätzlich: `aendereGrundskala` (Auftrag Punkt 5, „nachträglich
 * ändern") — Registry-Datei UND Laufzeit-Registrierung ändern sich, eine
 * FRISCH gebaute `KollisionsFormen` (wie nach einem Server-Neustart)
 * sieht die neue, skalierte Kollision.
 *
 * Lauf:  npx tsx server/test/upload-grundskala-kollision.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aendereGrundskala, pruefeUndSpeichereUpload } from '@wov/shared/src/uploadedModelUpload.js';
import { grundskalaVon, unregisterUploadedPrefab, uploadedModelEntry } from '@wov/shared/src/uploadedModelRegistry.js';
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

// ── Dasselbe winzige, gültige GLB wie modell-upload-kollision.ts ──────
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

/** Wie weit eine Spielfigur 5 s geradeaus gegen `formen` läuft, ab x=0 Richtung +x. */
function laufeGegen(formen: KollisionsFormen, name: string, wandX: number): number {
  const form = formen.formFuer(name);
  if (form === null) return Number.NaN;
  const zdos = {} as ZDOManager;
  const prefabs = {} as PrefabManager;
  const welt = new Kollisionswelt(zdos, prefabs, () => 0);
  const nah = welt.nahfeldAus([{ form, position: { x: wandX, y: 0, z: 0 } }]);
  let pos = { x: 0, y: 0, z: 0 };
  const schrittSekunden = 1 / 20;
  for (let i = 0; i < Math.round(5 / schrittSekunden); i++) {
    pos = bewegungsSchritt(pos, { x: 1, z: 0, rennt: false }, schrittSekunden, nah, nah);
  }
  return pos.x;
}

const dir = mkdtempSync(join(tmpdir(), 'wov-grundskala-kollision-'));
const hochgeladenDir = join(dir, 'hochgeladen');
mkdirSync(hochgeladenDir, { recursive: true });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

console.log('\n1. Grundskala 4 beim Hochladen: Kollisionshülle ist ~4× so breit\n');
{
  const antwort = pruefeUndSpeichereUpload(
    { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
    { bytes: bauGlb(1), angezeigterName: 'Grundskala4Kiste', kollisionswunsch: 'fest', grundskala: 4 }
  );
  check(antwort.ok, `Upload mit grundskala 4 angenommen (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    const name = antwort.eintrag.name;
    check(antwort.eintrag.grundskala === 4, 'Registry-Eintrag trägt grundskala 4');
    const formen = new KollisionsFormen(dir);
    const form = formen.formFuer(name);
    check(form !== null && form.art === 'kiste', 'Form ist eine Kiste (kein null, kein Netz/Kapsel)');
    if (form && form.art === 'kiste') {
      const breite = form.max.x - form.min.x;
      // Rohgröße der GLB ist 1 m (bauGlb(1)); mit Grundskala 4 wird daraus ~4 m.
      check(Math.abs(breite - 4) < 1e-4, `Kollisionshülle ist ${breite.toFixed(4)} m breit (erwartet 4, roh war 1)`);
    }

    // Zeuge in Zahlen wie modell-upload-kollision.ts: 5 s gegen eine Wand
    // bei x=7 — die NAHE Flanke der (jetzt 4 m breiten, gespiegelten) Kiste
    // liegt bei x = 7 - 4 = 3. Wie im Vorbildtest hält die Figur schon VOR
    // der Flanke an (Kapselradius + Schrittgranularität) — dieselbe
    // Toleranzbreite (1,6 m) wie dort, nur um die neue Flanke zentriert.
    const stopX = laufeGegen(formen, name, 7);
    check(stopX > 1.4 && stopX < 3.2, `5 s geradeaus: hält vor der 4-m-Kiste bei x=${stopX.toFixed(3)} (Flanke bei 3)`);
    check(stopX < 5 * GEH_TEMPO, '... und kommt deutlich weniger weit als die freien 5×GEH_TEMPO m');
    unregisterUploadedPrefab(name);
  }
}

console.log('\n2. Gegenprobe: ohne grundskala bleibt die Hülle die ROHE Größe\n');
{
  const antwort = pruefeUndSpeichereUpload(
    { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
    { bytes: bauGlb(1), angezeigterName: 'OhneGrundskalaKiste', kollisionswunsch: 'fest' }
  );
  check(antwort.ok, `Upload ohne grundskala angenommen (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    const name = antwort.eintrag.name;
    check(antwort.eintrag.grundskala === undefined, 'Registry-Eintrag hat kein grundskala-Feld (Voreinstellung)');
    const formen = new KollisionsFormen(dir);
    const form = formen.formFuer(name);
    if (form && form.art === 'kiste') {
      const breite = form.max.x - form.min.x;
      check(Math.abs(breite - 1) < 1e-4, `Kollisionshülle bleibt ${breite.toFixed(4)} m breit (roh, erwartet 1)`);
    }
    unregisterUploadedPrefab(name);
  }
}

console.log('\n3. „Nachträglich ändern" (aendereGrundskala): Registry UND Kollision folgen\n');
{
  const antwort = pruefeUndSpeichereUpload(
    { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
    { bytes: bauGlb(1), angezeigterName: 'NachtraeglichKiste', kollisionswunsch: 'fest' }
  );
  check(antwort.ok, `Upload angenommen (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    const name = antwort.eintrag.name;

    // Vorher: roh, 1 m.
    const vorher = new KollisionsFormen(dir).formFuer(name);
    const vorherBreite = vorher && vorher.art === 'kiste' ? vorher.max.x - vorher.min.x : Number.NaN;
    check(Math.abs(vorherBreite - 1) < 1e-4, `vor der Änderung: ${vorherBreite.toFixed(4)} m (erwartet 1, roh)`);

    const geaendert = aendereGrundskala({ erlaubt: true, verzeichnis: hochgeladenDir }, name, 4);
    check(geaendert.ok, `aendereGrundskala(..., 4) angenommen (${geaendert.ok ? '' : geaendert.meldung})`);
    if (geaendert.ok) {
      check(geaendert.eintrag.grundskala === 4, 'Antwort trägt grundskala 4');
      check(grundskalaVon(uploadedModelEntry(name)!) === 4, 'Laufzeit-Registrierung (uploadedModelEntry) kennt die neue Grundskala SOFORT');

      const aufPlatte = JSON.parse(readFileSync(join(hochgeladenDir, 'registry.json'), 'utf-8')) as {
        modelle: { name: string; grundskala?: number }[];
      };
      const eintragAufPlatte = aufPlatte.modelle.find((m) => m.name === name);
      check(eintragAufPlatte?.grundskala === 4, 'registry.json auf der Platte trägt grundskala 4');

      // „Wie nach einem Server-Neustart": eine FRISCHE KollisionsFormen
      // liest den (jetzt in der Laufzeit-Registrierung geänderten) Eintrag.
      const nachher = new KollisionsFormen(dir).formFuer(name);
      const nachherBreite = nachher && nachher.art === 'kiste' ? nachher.max.x - nachher.min.x : Number.NaN;
      check(Math.abs(nachherBreite - 4) < 1e-4, `nach der Änderung: ${nachherBreite.toFixed(4)} m (erwartet 4)`);
    }
    unregisterUploadedPrefab(name);
  }
}

console.log('\n4. Grenzen: aendereGrundskala lehnt ausserhalb 0,01…100 ab, ändert nichts\n');
{
  const antwort = pruefeUndSpeichereUpload(
    { erlaubt: true, verzeichnis: hochgeladenDir, hochgeladenVon: 'test' },
    { bytes: bauGlb(1), angezeigterName: 'GrenzenKiste', kollisionswunsch: 'fest' }
  );
  if (antwort.ok) {
    const name = antwort.eintrag.name;
    const zuGross = aendereGrundskala({ erlaubt: true, verzeichnis: hochgeladenDir }, name, 100.01);
    check(!zuGross.ok, 'grundskala 100,01 wird abgelehnt');
    const zuKlein = aendereGrundskala({ erlaubt: true, verzeichnis: hochgeladenDir }, name, 0.001);
    check(!zuKlein.ok, 'grundskala 0,001 wird abgelehnt');
    check(grundskalaVon(uploadedModelEntry(name)!) === 1, 'Grundskala bleibt bei 1 — keine der Ablehnungen hat etwas geändert');
    unregisterUploadedPrefab(name);
  }

  // Unbekannter Name: dieselbe „kennt nicht"-Ablehnung wie entferneUpload.
  const unbekannt = aendereGrundskala({ erlaubt: true, verzeichnis: hochgeladenDir }, 'U_GibtEsNicht', 4);
  check(!unbekannt.ok, 'ein unbekannter Name wird abgelehnt, nicht abgestürzt');

  // Instanz-Sperre: erlaubt: false lehnt genau wie beim Hochladen ab.
  const gesperrt = aendereGrundskala({ erlaubt: false, verzeichnis: hochgeladenDir }, 'U_Irgendwas', 4);
  check(!gesperrt.ok, 'erlaubt: false wird abgelehnt (dieselbe Sperre wie beim Hochladen)');
}

console.log(failures === 0 ? '\nGrundskala-Kollision: alles grün.\n' : `\nGrundskala-Kollision: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
