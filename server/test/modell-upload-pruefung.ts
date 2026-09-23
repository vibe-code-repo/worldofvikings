/**
 * U1 — Wächter über das Prüftor des Editor-Uploads
 * (`shared/src/uploadedModelUpload.ts`, `pruefeUndSpeichereUpload`).
 *
 * ── Was hier bewiesen wird ────────────────────────────────────────────
 * Der eigentliche Auftrag der Karte ist NICHT der Knopf, sondern das
 * Prüftor: eine kaputte oder zu schwere Datei bekommt eine verständliche
 * Ablehnung, statt den Client lahmzulegen — und die Platte bleibt dabei
 * UNVERÄNDERT (kein Halb-Schreiben, kein verwaister Registry-Eintrag).
 * Jeder Fall unten prüft beides: die Antwort UND den Zustand des
 * Ordners danach.
 *
 * ── Der GLB-Baukasten ─────────────────────────────────────────────────
 * Kein Blender, kein Export — ein eigener, absichtlich einfacher
 * glTF-2.0-Binärschreiber (`bauGlb`), der GENAU die Zahlen trifft, die
 * die Prüfung zählt: drei wiederverwendete Ecken, ein Indexpuffer der
 * gewünschten Länge (entartete, aber gültige Dreiecke — die Prüfung
 * zählt Indizes, keine echte Form). Ein Test, der den Schreiber der
 * Prüfung mit derselben Prüfung läse, bewiese nichts; hier liest
 * `pruefeUndSpeichereUpload` mit dem UNABHÄNGIGEN `leseGlb`/
 * `parseGlbChunks` aus `shared/src/kollision/glb.ts`.
 *
 * Rot vor der Umsetzung: `shared/src/uploadedModelUpload.ts` gab es vor
 * dieser Karte nicht — der Import scheitert auf 34ea56d.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  entferneUpload,
  leseRegistry,
  pruefeUndSpeichereUpload,
  platzierungsNutzung,
  type UploadKontext,
} from '@wov/shared/src/uploadedModelUpload.js';
import {
  HUELLBOX_ABLEHNEN_MAX_M,
  HUELLBOX_ABLEHNEN_MIN_M,
  HUELLBOX_HINWEIS_MAX_M,
  MAX_BILD_BYTES,
  MAX_BYTES,
  MAX_DREIECKE,
  MAX_KOLLISIONSNETZ_DREIECKE,
  MAX_MATERIALIEN,
  MAX_MESHES,
  erzwingeName,
  uploadedModelEntry,
  unregisterUploadedPrefab,
} from '@wov/shared/src/uploadedModelRegistry.js';
import { getStableHash } from '@wov/shared/src/hash.js';

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  ok   ${was}`);
  } else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

function tempOrdner(): string {
  return mkdtempSync(join(tmpdir(), 'wov-modell-upload-'));
}

/** Aufräumen — auch was diese Datei am Ende registriert, damit spätere Dateien im Sammellauf sauber starten. */
const aufraeumOrdner: string[] = [];
function neuerOrdner(): string {
  const d = tempOrdner();
  aufraeumOrdner.push(d);
  return d;
}

// ── Der GLB-Baukasten ───────────────────────────────────────────────────
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

interface GlbOptionen {
  dreiecke?: number;
  zusatzMeshes?: number;
  zusatzMaterialien?: number;
  bildBytes?: number | null;
  externeUri?: string | null;
  groesse?: number;
  kollisionsDreiecke?: number;
  abschneiden?: number;
  /** N1: die Hauptprimitive OHNE `indices` — gültiges glTF, Babylon zeichnet POSITION.count/3 Dreiecke. */
  nichtIndiziert?: boolean;
  /** N1: `buffers[0].uri` setzen — eine externe Binärdatei, die nie mitkommt. */
  externerPuffer?: string | null;
  /** N1: `extensionsRequired` am Dokument. */
  erweiterungenErforderlich?: string[];
  /** N1: den `count` des POSITION-Accessors ohne passende Daten überschreiben (Allokations-DoS). */
  positionCountUeberschreiben?: number;
  /** N1: eine Ecke der Hüllbox auf NaN setzen (kaputte Vertexdaten). */
  nanPosition?: boolean;
  /** N2: primitive-`mode` der Hauptprimitive — 4 TRIANGLES (Default), 5 TRIANGLE_STRIP, 6 TRIANGLE_FAN. */
  modus?: number;
  /** N2: Eckenzahl der Kette bei `modus` 5/6 (nicht indiziert, sequentiell) — `count − 2` Dreiecke. */
  stripEcken?: number;
}

/**
 * Ein minimaler, gültiger glTF-2.0-Binärkörper: drei wiederverwendete
 * Ecken (skaliert auf `groesse` — das IST die Hüllbox), ein Indexpuffer
 * mit `dreiecke` Dreiecken (entartet, aber gültig — die Prüfung zählt
 * Indizes, keine Fläche). Optional: mehr Netze/Materialien (nur die
 * Anzahl zählt, nicht die Referenz), ein eingebettetes oder externes
 * Bild, ein `_col`-Netz für die Kollisionsprüfung, ein Abschneiden am
 * Ende (kaputte Datei).
 */
function bauGlb(optionen: GlbOptionen = {}): Uint8Array {
  const {
    dreiecke = 1,
    zusatzMeshes = 0,
    zusatzMaterialien = 0,
    bildBytes = null,
    externeUri = null,
    groesse = 1,
    kollisionsDreiecke = 0,
    abschneiden = 0,
    nichtIndiziert = false,
    externerPuffer = null,
    erweiterungenErforderlich = [],
    positionCountUeberschreiben = null,
    nanPosition = false,
    modus = 4,
    stripEcken = 5,
  } = optionen as GlbOptionen & { positionCountUeberschreiben?: number | null };

  // N2: TRIANGLE_STRIP/TRIANGLE_FAN (modus 5/6) — wie `nichtIndiziert`
  // keine `indices`, aber eine fortlaufende Eckenkette statt Dreier-Gruppen
  // (eine Kette aus `stripEcken` unterscheidbaren, aber harmlosen Punkten;
  // die genaue Form ist irrelevant, nur die ANZAHL zählt für das Tor).
  const istStripOderFan = modus === 5 || modus === 6;
  const keineIndizes = nichtIndiziert || istStripOderFan;

  // Nicht indiziert: POSITION trägt selbst `dreiecke * 3` Ecken (drei
  // wiederholte Basisecken je Dreieck) — kein Indexpuffer nötig, Babylon
  // zeichnet trotzdem `POSITION.count / 3` Dreiecke (mode 4, TRIANGLES).
  const eckenJeDreieck = [0, 0, 0, groesse, 0, 0, 0, groesse, groesse];
  const positionenRoh = istStripOderFan
    ? Array.from({ length: stripEcken }, (_, i) => [i * 0.1 * groesse, (i % 2) * groesse, 0]).flat()
    : nichtIndiziert
      ? Array.from({ length: dreiecke }, () => eckenJeDreieck).flat()
      : eckenJeDreieck;
  if (nanPosition) positionenRoh[0] = NaN;
  const positionen = new Float32Array(positionenRoh);
  const posBytes = Buffer.from(positionen.buffer, positionen.byteOffset, positionen.byteLength);

  const indizes = new Uint32Array(keineIndizes ? 0 : dreiecke * 3);
  for (let i = 0; i < (keineIndizes ? 0 : dreiecke); i++) {
    indizes[i * 3] = 0;
    indizes[i * 3 + 1] = 1;
    indizes[i * 3 + 2] = 2;
  }
  const idxBytes = Buffer.from(indizes.buffer, indizes.byteOffset, indizes.byteLength);

  const teile: Buffer[] = [posBytes, idxBytes];
  const posOffset = 0;
  const idxOffset = posBytes.length;

  let colOffset = -1;
  let colBytes = Buffer.alloc(0);
  if (kollisionsDreiecke > 0) {
    const colIdx = new Uint32Array(kollisionsDreiecke * 3);
    for (let i = 0; i < kollisionsDreiecke; i++) {
      colIdx[i * 3] = 0;
      colIdx[i * 3 + 1] = 1;
      colIdx[i * 3 + 2] = 2;
    }
    colBytes = Buffer.from(colIdx.buffer, colIdx.byteOffset, colIdx.byteLength);
    colOffset = teile.reduce((a, p) => a + p.length, 0);
    teile.push(colBytes);
  }

  let bildOffset = -1;
  if (bildBytes !== null) {
    bildOffset = teile.reduce((a, p) => a + p.length, 0);
    teile.push(Buffer.alloc(bildBytes, 0xff));
  }

  const bin = Buffer.concat(teile);

  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [
    { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length },
  ];
  let colBufferViewIdx = -1;
  if (kollisionsDreiecke > 0) {
    colBufferViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: colOffset, byteLength: colBytes.length });
  }
  let bildBufferViewIdx = -1;
  if (bildBytes !== null) {
    bildBufferViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: bildOffset, byteLength: bildBytes });
  }

  const accessors: Record<string, unknown>[] = [
    {
      bufferView: 0,
      componentType: 5126,
      count: positionCountUeberschreiben ?? positionen.length / 3,
      type: 'VEC3',
    },
    { bufferView: 1, componentType: 5125, count: dreiecke * 3, type: 'SCALAR' },
  ];
  let colAccessorIdx = -1;
  if (kollisionsDreiecke > 0) {
    colAccessorIdx = accessors.length;
    accessors.push({ bufferView: colBufferViewIdx, componentType: 5125, count: kollisionsDreiecke * 3, type: 'SCALAR' });
  }

  const materialien: { name: string }[] = [{ name: 'Material0' }];
  for (let i = 0; i < zusatzMaterialien; i++) materialien.push({ name: `Zusatz${i}` });

  const hauptPrimitive: Record<string, unknown> = { attributes: { POSITION: 0 }, material: 0, mode: modus };
  if (!keineIndizes) hauptPrimitive.indices = 1;
  const meshes: Record<string, unknown>[] = [{ name: 'Sicht', primitives: [hauptPrimitive] }];
  for (let i = 0; i < zusatzMeshes; i++) {
    meshes.push({ name: `Zusatz${i}`, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] });
  }
  let colMeshIdx = -1;
  if (kollisionsDreiecke > 0) {
    colMeshIdx = meshes.length;
    meshes.push({ name: 'Kollision', primitives: [{ attributes: { POSITION: 0 }, indices: colAccessorIdx, mode: 4 }] });
  }

  const nodes: Record<string, unknown>[] = [{ name: 'Sicht', mesh: 0 }];
  const sceneNodes = [0];
  if (kollisionsDreiecke > 0) {
    nodes.push({ name: 'Sicht_col', mesh: colMeshIdx });
    sceneNodes.push(1);
  }

  let images: Record<string, unknown>[] | undefined;
  if (bildBytes !== null) images = [{ mimeType: 'image/png', bufferView: bildBufferViewIdx }];
  else if (externeUri !== null) images = [{ uri: externeUri }];

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes,
    materials: materialien,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length, ...(externerPuffer !== null ? { uri: externerPuffer } : {}) }],
    ...(images ? { images } : {}),
    ...(erweiterungenErforderlich.length > 0 ? { extensionsRequired: erweiterungenErforderlich } : {}),
  };

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  let binBuf = bin;
  const binPad = (4 - (binBuf.length % 4)) % 4;
  if (binPad > 0) binBuf = Buffer.concat([binBuf, Buffer.alloc(binPad, 0)]);

  const jsonChunk = Buffer.concat([u32le(jsonBuf.length), u32le(0x4e4f534a), jsonBuf]);
  const binChunk = Buffer.concat([u32le(binBuf.length), u32le(0x004e4942), binBuf]);
  const kopf = Buffer.concat([u32le(0x46546c67), u32le(2), u32le(12 + jsonChunk.length + binChunk.length)]);

  let voll = Buffer.concat([kopf, jsonChunk, binChunk]);
  if (abschneiden > 0) voll = voll.subarray(0, Math.max(0, voll.length - abschneiden));
  return new Uint8Array(voll.buffer, voll.byteOffset, voll.byteLength);
}

function kontext(dir: string, aenderung: Partial<UploadKontext> = {}): UploadKontext {
  return { erlaubt: true, verzeichnis: dir, hochgeladenVon: 'test@127.0.0.1', ...aenderung };
}

/** Anzahl `.glb`-Dateien + registry.json im Ordner — der Zeuge für „Platte unverändert". */
function plattenStand(dir: string): { dateien: number; registryEintraege: number } {
  const dateien = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.glb')).length : 0;
  const registryEintraege = existsSync(dir) ? leseRegistry(dir).modelle.length : 0;
  return { dateien, registryEintraege };
}

console.log('\n1. Acht (und mehr) abgelehnte Fälle — Antwort UND unveränderte Platte\n');

// ── Fall 1: kein GLB ─────────────────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    angezeigterName: 'Kaputt1',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `kein GLB: abgelehnt (Antwort: ${antwort.ok ? 'OK' : antwort.meldung})`);
  check(!antwort.ok && /GLB/.test(antwort.meldung), 'kein GLB: Meldung nennt GLB/Magic');
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'kein GLB: Platte unverändert');
}

// ── Fall 2: abgeschnittene Datei ─────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const voll = bauGlb({ dreiecke: 4, abschneiden: 24 });
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: voll,
    angezeigterName: 'Abgeschnitten',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `abgeschnitten: abgelehnt (Antwort: ${antwort.ok ? 'OK' : antwort.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'abgeschnitten: Platte unverändert');
}

// ── Fall 3: zu groß ───────────────────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const riesig = new Uint8Array(MAX_BYTES + 1);
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: riesig,
    angezeigterName: 'ZuGross',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `zu groß (${riesig.byteLength} > ${MAX_BYTES}): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  check(!antwort.ok && antwort.meldung.includes(String(MAX_BYTES)), 'zu groß: Meldung nennt die Grenze in Zahlen');
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'zu groß: Platte unverändert');
}

// ── Fall 4: zu viele Dreiecke ─────────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const glb = bauGlb({ dreiecke: MAX_DREIECKE + 1 });
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: glb,
    angezeigterName: 'ZuVieleDreiecke',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `zu viele Dreiecke (${MAX_DREIECKE + 1} > ${MAX_DREIECKE}): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'zu viele Dreiecke: Platte unverändert');
}

// ── Fall 5: Name mit Pfadanteil ───────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const glb = bauGlb();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: glb,
    angezeigterName: '../../../etc/passwd',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `Name mit Pfadanteil: abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'Pfadanteil: Platte unverändert (kein Ausbruch aus dem Zielordner, weil vor dem Schreiben abgelehnt)');
}

// ── Fall 6: Name schon vergeben ────────────────────────────────────────
{
  const dir = neuerOrdner();
  const erster = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb(),
    angezeigterName: 'Doppelt',
    kollisionswunsch: 'fest',
  });
  check(erster.ok, `Name schon vergeben: erster Upload geht durch (${erster.ok ? erster.eintrag.name : erster.meldung})`);
  const vor = plattenStand(dir);
  const zweiter = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ groesse: 2 }),
    angezeigterName: 'Doppelt',
    kollisionswunsch: 'fest',
  });
  check(!zweiter.ok, `Name schon vergeben: zweiter Upload mit demselben Namen abgelehnt (${zweiter.ok ? 'OK' : zweiter.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'Namenskollision: Platte danach unverändert (erster Eintrag steht noch)');
  if (erster.ok) unregisterUploadedPrefab(erster.eintrag.name);
}

// ── Fall 7: absurd große Hüllbox ───────────────────────────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const glb = bauGlb({ groesse: HUELLBOX_ABLEHNEN_MAX_M + 1 });
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: glb,
    angezeigterName: 'Riesig',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `absurd große Hüllbox (${HUELLBOX_ABLEHNEN_MAX_M + 1} m): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'Riesenhüllbox: Platte unverändert');
}

// ── Fall 7b: entartete (zu kleine) Hüllbox ──────────────────────────────
{
  const dir = neuerOrdner();
  const glb = bauGlb({ groesse: HUELLBOX_ABLEHNEN_MIN_M / 2 });
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: glb,
    angezeigterName: 'Winzig',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `entartete Hüllbox (${HUELLBOX_ABLEHNEN_MIN_M / 2} m): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}

// ── Fall 8: Uploads auf dieser Instanz nicht erlaubt ───────────────────
{
  const dir = neuerOrdner();
  const vor = plattenStand(dir);
  const antwort = pruefeUndSpeichereUpload(kontext(dir, { erlaubt: false }), {
    bytes: bauGlb(),
    angezeigterName: 'Gesperrt',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `Uploads ausgeschaltet/live: abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'Uploads ausgeschaltet: Platte unverändert');
}

// ── Bonus: zu viele Netze / Materialien / zu großes Bild / externe Textur ─
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ zusatzMeshes: MAX_MESHES }),
    angezeigterName: 'ZuVieleNetze',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `zu viele Netze (${MAX_MESHES + 1} > ${MAX_MESHES}): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ zusatzMaterialien: MAX_MATERIALIEN }),
    angezeigterName: 'ZuVieleMaterialien',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `zu viele Materialien (${MAX_MATERIALIEN + 1} > ${MAX_MATERIALIEN}): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ bildBytes: MAX_BILD_BYTES + 1 }),
    angezeigterName: 'BildZuGross',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `eingebettetes Bild zu groß (${MAX_BILD_BYTES + 1} > ${MAX_BILD_BYTES}): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ externeUri: 'texturen/holz.png' }),
    angezeigterName: 'ExterneTextur',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `externe Bilddatei referenziert: abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}

console.log('\n1b. N1 (Angriff, Abschnitt „Grenzen des Prüftors") — mit echten, präparierten GLBs\n');
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ externerPuffer: 'daten.bin' }),
    angezeigterName: 'ExternerPuffer',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `buffers[0].uri gesetzt (externe Binärdaten): abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ erweiterungenErforderlich: ['KHR_draco_mesh_compression'] }),
    angezeigterName: 'DracoPflicht',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `extensionsRequired: ['KHR_draco_mesh_compression']: abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ positionCountUeberschreiben: 100_000_000 }),
    angezeigterName: 'RiesigesCount',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `POSITION-Accessor mit count=100 000 000 ohne passende Daten: abgelehnt, kein OOM (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  // "Accessor über das Pufferende": ein count, der plausibel aussieht, aber
  // mehr verlangt, als der BIN-Chunk hergibt (ohne den Allokations-Deckel
  // zu reissen) — die Klarheits-Vorabprüfung in glb.ts greift hier, nicht
  // erst ein roher RangeError.
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ positionCountUeberschreiben: 1000 }),
    angezeigterName: 'UeberPufferende',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `POSITION-Accessor mit count=1000 bei nur 3 echten Ecken: abgelehnt (${antwort.ok ? 'OK' : antwort.meldung})`);
  check(!antwort.ok && /Binärteil|beschädigt/.test(antwort.meldung), `Meldung nennt den Binärteil/die Beschädigung (${antwort.ok ? '' : antwort.meldung})`);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ nanPosition: true }),
    angezeigterName: 'NanPosition',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `NaN in den Vertexpositionen: abgelehnt statt stillschweigend durchgelassen (${antwort.ok ? 'OK' : antwort.meldung})`);
}
{
  // Die Gegenprobe: eine nicht indizierte TRIANGLES-Primitive ist GÜLTIG
  // und wird angenommen — mit der RICHTIGEN Dreieckszahl (POSITION.count/3),
  // nicht mit 0 (vorher: `prim.indices === undefined` → leere Indexliste).
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ nichtIndiziert: true, dreiecke: 7 }),
    angezeigterName: 'NichtIndiziert',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `nicht indizierte TRIANGLES-Primitive: ANGENOMMEN (${antwort.ok ? '' : antwort.meldung})`);
  if (antwort.ok) {
    check(antwort.eintrag.dreiecke === 7, `Dreiecke korrekt aus POSITION.count/3 gezählt (${antwort.eintrag.dreiecke}), nicht 0`);
    unregisterUploadedPrefab(antwort.eintrag.name);
  }
}

console.log('\n2. Angenommen, aber mit Hinweis: fehlende Texturen\n');
{
  const dir = neuerOrdner();
  // Ein Material OHNE jedes Bild — genau der Fall, den `fehlendeTexturen` meldet.
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb(),
    angezeigterName: 'OhneTextur',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `fehlende Texturen: ANGENOMMEN (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    check(antwort.eintrag.fehlendeTexturen, 'fehlende Texturen: Eintrag markiert fehlendeTexturen=true');
    check(
      antwort.hinweise.some((h) => /textur/i.test(h)),
      `fehlende Texturen: Hinweis in der Antwort (${JSON.stringify(antwort.hinweise)})`
    );
    unregisterUploadedPrefab(antwort.eintrag.name);
  }
}

console.log('\n3. Angenommen, mit Hinweis: ungewöhnliche Größe (kein Ablehnungsgrund)\n');
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ groesse: HUELLBOX_HINWEIS_MAX_M + 1 }),
    angezeigterName: 'Grosswarnung',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `500-m-Beispiel der Karte: ANGENOMMEN, nicht abgelehnt (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    check(
      antwort.hinweise.some((h) => /[Gg]röße/.test(h)),
      `Größen-Hinweis vorhanden (${JSON.stringify(antwort.hinweise)})`
    );
    unregisterUploadedPrefab(antwort.eintrag.name);
  }
}

console.log('\n4. Kollision: Voreinstellung Kiste, eigenes Netz nur unter dem Deckel\n');
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ kollisionsDreiecke: 4 }),
    angezeigterName: 'MitKleinemNetz',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `kleines _col-Netz: angenommen (${antwort.ok ? '' : antwort.meldung})`);
  if (antwort.ok) {
    check(antwort.eintrag.hatKollisionsnetz, 'kleines _col-Netz: hatKollisionsnetz=true (wird benutzt)');
    check(!antwort.eintrag.kollisionsnetzAbgelehnt, 'kleines _col-Netz: nicht als abgelehnt markiert');
    unregisterUploadedPrefab(antwort.eintrag.name);
  }
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ kollisionsDreiecke: MAX_KOLLISIONSNETZ_DREIECKE + 1 }),
    angezeigterName: 'MitZuGrossemNetz',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `zu großes _col-Netz: trotzdem angenommen — fällt auf die Kiste zurück (${antwort.ok ? '' : antwort.meldung})`);
  if (antwort.ok) {
    check(antwort.eintrag.kollisionsnetzAbgelehnt, 'zu großes _col-Netz: kollisionsnetzAbgelehnt=true');
    check(!antwort.eintrag.hatKollisionsnetz, 'zu großes _col-Netz: hatKollisionsnetz=false (Kiste gilt)');
    check(
      antwort.hinweise.some((h) => /[Kk]ollisionsnetz/.test(h)),
      'zu großes _col-Netz: Hinweis nennt den Rückfall'
    );
    unregisterUploadedPrefab(antwort.eintrag.name);
  }
}
{
  const dir = neuerOrdner();
  const durchlaessig = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ groesse: 2 }),
    angezeigterName: 'Durchlaessig',
    kollisionswunsch: 'durchlaessig',
  });
  check(durchlaessig.ok && durchlaessig.eintrag.kollisionsart === 'durchlaessig', "Kollisionswunsch 'durchlaessig' wird übernommen");
  if (durchlaessig.ok) unregisterUploadedPrefab(durchlaessig.eintrag.name);
}

console.log('\n5. Erfolgreicher Durchstich: Registry + registrierte Prefab-Sicht stimmen\n');
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ dreiecke: 12, groesse: 1.5 }),
    angezeigterName: 'Musterfass',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `Durchstich-Upload angenommen (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  if (antwort.ok) {
    const eintrag = antwort.eintrag;
    check(eintrag.name.startsWith('U_'), `erzwungener Name trägt das Präfix U_ (${eintrag.name})`);
    check(eintrag.dreiecke === 12, `Dreiecke exakt gemessen (${eintrag.dreiecke})`);
    check(Math.abs(eintrag.breite - 1.5) < 1e-4 && Math.abs(eintrag.hoehe - 1.5) < 1e-4 && Math.abs(eintrag.tiefe - 1.5) < 1e-4, `Hüllbox exakt gemessen (${eintrag.breite}×${eintrag.hoehe}×${eintrag.tiefe})`);
    check(existsSync(join(dir, `${eintrag.name}.glb`)), 'Datei liegt unter dem erzwungenen Namen auf der Platte');
    const registry = leseRegistry(dir);
    check(registry.modelle.length === 1 && registry.modelle[0]?.name === eintrag.name, 'Registry-Datei enthält genau diesen Eintrag');
    check(uploadedModelEntry(eintrag.name)?.name === eintrag.name, 'Im laufenden Prozess sofort registriert (uploadedModelEntry)');

    console.log('\n6. Entfernen: Warnung nennt Zahl und Orte, danach Registry sauber\n');
    // Layoutdatei mit zwei Platzierungen dieses Prefabs simulieren.
    const layoutDatei = join(dir, 'welt.json');
    writeFileSync(
      layoutDatei,
      JSON.stringify({
        placements: [
          { prefab: eintrag.name, x: 10, z: 20 },
          { prefab: eintrag.name, x: -5, z: 7 },
          { prefab: 'AndererName', x: 0, z: 0 },
        ],
      })
    );
    const nutzung = platzierungsNutzung(layoutDatei, eintrag.name);
    check(nutzung.anzahl === 2, `platzierungsNutzung zählt genau 2 (${nutzung.anzahl})`);
    check(
      nutzung.orte.some((o) => o.x === 10 && o.z === 20) && nutzung.orte.some((o) => o.x === -5 && o.z === 7),
      `platzierungsNutzung nennt die Orte (${JSON.stringify(nutzung.orte)})`
    );

    const ohneBestaetigung = entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei }, eintrag.name, false);
    check('brauchtBestaetigung' in ohneBestaetigung && ohneBestaetigung.brauchtBestaetigung, 'ohne Bestätigung: braucht Bestätigung, nichts entfernt');
    check(existsSync(join(dir, `${eintrag.name}.glb`)), 'ohne Bestätigung: Datei liegt noch da');
    check(leseRegistry(dir).modelle.length === 1, 'ohne Bestätigung: Registry unverändert');

    const mitBestaetigung = entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei }, eintrag.name, true);
    check(mitBestaetigung.ok, `mit Bestätigung: entfernt (${mitBestaetigung.ok ? mitBestaetigung.name : (mitBestaetigung as { meldung?: string }).meldung})`);
    check(!existsSync(join(dir, `${eintrag.name}.glb`)), 'mit Bestätigung: Datei nicht mehr am alten Platz');
    check(existsSync(join(dir, 'entfernt')), 'mit Bestätigung: „entfernt“-Ordner angelegt (beiseitegeschoben, nicht gelöscht)');
    const beiseite = readdirSync(join(dir, 'entfernt')).filter((f) => f.startsWith(eintrag.name));
    check(beiseite.length === 1, `mit Bestätigung: genau eine beiseitegeschobene Datei (${beiseite.length})`);
    check(leseRegistry(dir).modelle.length === 0, 'mit Bestätigung: Registry sauber (0 Einträge)');
    check(uploadedModelEntry(eintrag.name) === undefined, 'mit Bestätigung: im Prozess nicht mehr registriert');
  }
}

console.log('\n7. N1 (Angriff, Befund B2) — kaputte Registry rollt den Upload zurück statt zu werfen\n');
{
  const dir = neuerOrdner();
  mkdirSync(dir, { recursive: true });
  // Absichtlich kaputtes JSON, GENAU wie im Angriff beschrieben: die Datei
  // liegt schon, BEVOR pruefeUndSpeichereUpload zum ersten Mal reinschreibt.
  writeFileSync(join(dir, 'registry.json'), '{ das ist kein JSON');
  let warf = false;
  let antwort: ReturnType<typeof pruefeUndSpeichereUpload> | null = null;
  try {
    antwort = pruefeUndSpeichereUpload(kontext(dir), {
      bytes: bauGlb(),
      angezeigterName: 'NachKaputt',
      kollisionswunsch: 'fest',
    });
  } catch {
    warf = true;
  }
  check(!warf, 'pruefeUndSpeichereUpload WIRFT NICHT bei kaputter registry.json — Rückgabewert statt Ausnahme');
  check(antwort !== null && !antwort.ok, `stattdessen eine normale Ablehnung (${antwort && !antwort.ok ? antwort.meldung : 'OK?!'})`);
  check(
    !existsSync(join(dir, 'U_NachKaputt.glb')),
    'die .glb wurde NICHT als Datenleiche zurückgelassen — der Name ist wieder frei'
  );
}

console.log('\n8. N1 (Befund B5) — DELETE prüft den Namen gegen NAME_MUSTER, bevor er ein Dateipfad wird\n');
{
  const dir = neuerOrdner();
  const layoutDatei = join(dir, 'welt.json');
  // Eine von Hand verdorbene Registry mit einem Pfadanteil im Namen — genau
  // der Angriffsweg aus dem Bericht (ein Eintrag ausserhalb von
  // assets/hochgeladen/, adressiert über `join(verzeichnis, name + '.glb')`).
  const opferDatei = resolve(dir, '..', 'opfer-ausserhalb.glb');
  writeFileSync(opferDatei, 'sollte niemals angefasst werden');
  const boesesRelativ = '../opfer-ausserhalb';
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'registry.json'),
    JSON.stringify({
      version: 1,
      modelle: [
        {
          name: boesesRelativ,
          anzeigename: 'Opfer',
          bytes: 1, dreiecke: 1, meshes: 1, materialien: 1, bilder: 0, fehlendeTexturen: false,
          breite: 1, hoehe: 1, tiefe: 1, kollisionsart: 'fest',
          hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false,
          hochgeladenVon: 'angreifer', zeitpunkt: new Date(0).toISOString(),
        },
      ],
    })
  );
  const antwort = entferneUpload({ erlaubt: true, verzeichnis: dir, layoutDatei }, boesesRelativ, true);
  check(!antwort.ok, `Name mit Pfadanteil aus der Registry: DELETE lehnt ab (${antwort.ok ? 'OK' : (antwort as { meldung?: string }).meldung})`);
  check(!('brauchtBestaetigung' in antwort), 'kein „braucht Bestätigung" — die Ablehnung kommt VOR jeder Nutzungsprüfung');
  check(existsSync(opferDatei), 'die Datei AUSSERHALB von assets/hochgeladen/ wurde NICHT angefasst');
  check(!antwort.ok && !/opfer-ausserhalb|\.\.\//.test((antwort as { meldung: string }).meldung), 'die Meldung an den Browser nennt keinen absoluten/fremden Pfad');
  rmSync(opferDatei, { force: true });
}

console.log('\n9. N1 (Befund B7) — Namen, die sich nur in Groß-/Kleinschreibung unterscheiden, sind eine Kollision\n');
{
  const dir = neuerOrdner();
  const erster = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb(),
    angezeigterName: 'Farn_Eins',
    kollisionswunsch: 'fest',
  });
  check(erster.ok, `erster Upload 'Farn_Eins' angenommen (${erster.ok ? erster.eintrag.name : erster.meldung})`);
  const zweiter = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ groesse: 2 }),
    angezeigterName: 'farn_eins',
    kollisionswunsch: 'fest',
  });
  check(!zweiter.ok, `zweiter Upload 'farn_eins' (nur Groß-/Kleinschreibung anders): abgelehnt (${zweiter.ok ? 'OK' : zweiter.meldung})`);
  if (erster.ok) unregisterUploadedPrefab(erster.eintrag.name);
}

console.log('\n10. N2 (Nachangriff, Befund N-2) — die Hash-Kollision wird VOR dem Schreiben geprüft\n');
{
  // Zwei erzwungene Namen suchen, deren getStableHash kollidiert (32-bittig,
  // per Geburtstagsparadox nach rund 2^16 Versuchen zu erwarten). Ein simpel
  // HOCHGEZÄHLTER Suffix ('HashSuche0', 'HashSuche1', …) taugt dafür NICHT:
  // Die Referenz-Hashfunktion verarbeitet Zeichen paarweise mit lauter
  // UMKEHRBAREN Schritten (Multiplikation mit 33, XOR) — bei GLEICH LANGEM,
  // nur im Suffix wechselndem Namen ist die Abbildung Suffix→Hash dadurch
  // nahezu eine BIJEKTION, keine Streuung wie bei echt zufälligen Namen
  // (gemessen: 0 Kollisionen in 2 000 000 durchnummerierten Namen). Eine
  // eigene, aber DETERMINISTISCHE Zufallsfolge (fester Seed, reproduzierbar)
  // über das ganze Alphabet trifft dagegen zuverlässig in unter 100 000
  // Versuchen (gemessen: 48 130).
  let saat = 1337 >>> 0;
  const naechsteZahl = (): number => {
    saat = (Math.imul(saat, 1103515245) + 12345) >>> 0;
    return saat;
  };
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const zufallsName = (): string => {
    let s = 'Zufall';
    for (let i = 0; i < 12; i++) s += ALPHABET[naechsteZahl() % ALPHABET.length];
    return s;
  };

  const gesehen = new Map<number, string>();
  let kollisionA: string | null = null;
  let kollisionB: string | null = null;
  for (let i = 0; i < 2_000_000 && kollisionB === null; i++) {
    const name = erzwingeName(zufallsName())!;
    const hash = getStableHash(name);
    const vorhanden = gesehen.get(hash);
    if (vorhanden !== undefined && vorhanden !== name) {
      kollisionA = vorhanden;
      kollisionB = name;
    } else {
      gesehen.set(hash, name);
    }
  }
  check(kollisionA !== null && kollisionB !== null, `zwei kollidierende Namen gefunden (${kollisionA} / ${kollisionB})`);

  if (kollisionA !== null && kollisionB !== null) {
    const dir = neuerOrdner();
    // `erzwingeName(zufallsname)` erzeugt 'U_' + unveränderten Kern — als
    // Anzeigename wird der Kern ohne Präfix eingesetzt, damit
    // `pruefeUndSpeichereUpload` (das `erzwingeName` SELBST aufruft) wieder
    // exakt denselben Namen bildet.
    const anzeigenameA = kollisionA.slice('U_'.length);
    const anzeigenameB = kollisionB.slice('U_'.length);
    const erster = pruefeUndSpeichereUpload(kontext(dir), {
      bytes: bauGlb(),
      angezeigterName: anzeigenameA,
      kollisionswunsch: 'fest',
    });
    check(erster.ok && erster.eintrag.name === kollisionA, `erster Upload '${kollisionA}' angenommen (${erster.ok ? erster.eintrag.name : erster.meldung})`);

    const vorZweitem = plattenStand(dir);
    const zweiter = pruefeUndSpeichereUpload(kontext(dir), {
      bytes: bauGlb({ groesse: 3 }),
      angezeigterName: anzeigenameB,
      kollisionswunsch: 'fest',
    });
    check(!zweiter.ok, `zweiter Upload '${kollisionB}' (Hash-Zwilling von '${kollisionA}'): abgelehnt (${zweiter.ok ? 'OK' : zweiter.meldung})`);
    check(!zweiter.ok && /[Hh]ash/.test(zweiter.meldung), `Meldung nennt den Hash-Konflikt (${zweiter.ok ? '' : zweiter.meldung})`);
    const nachZweitem = plattenStand(dir);
    check(
      !existsSync(join(dir, `${kollisionB}.glb`)),
      `die Datei des Hash-Zwillings ('${kollisionB}.glb') wurde NIE geschrieben — die Prüfung lief VOR dem Schreiben, nicht danach mit Rückbau`
    );
    check(
      nachZweitem.dateien === vorZweitem.dateien && nachZweitem.registryEintraege === vorZweitem.registryEintraege,
      'Platte nach der Ablehnung unverändert (kein Datei-/Registry-Leichnam)'
    );

    if (erster.ok) unregisterUploadedPrefab(erster.eintrag.name);
  }
}

console.log('\n11. N2 (Nachangriff, Befund N-3) — Ellipse wird als Satzzeichen entfernt, nicht als Pfadanteil abgelehnt\n');
{
  // 'Kiste…' (U+2026 HORIZONTAL ELLIPSIS) zerlegt NFKD zu DREI Punkten
  // ('...') — das ist Satzzeichen, kein Pfadanteil. Vorher (bf0e116) griff
  // `.includes('..')` hier fälschlich, weil '...' auch '..' enthält.
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb(),
    angezeigterName: 'Kiste…',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `'Kiste…' (Ellipse): ANGENOMMEN statt abgelehnt (${antwort.ok ? antwort.eintrag.name : antwort.meldung})`);
  check(antwort.ok && antwort.eintrag.name === 'U_Kiste', `Ellipse wird wie ein Satzzeichen entfernt → 'U_Kiste' (${antwort.ok ? antwort.eintrag.name : ''})`);
  if (antwort.ok) unregisterUploadedPrefab(antwort.eintrag.name);

  // Der TWO DOT LEADER '‥' (U+2025, NFKD → genau ZWEI Punkte) bleibt
  // dagegen zu Recht ein Pfadanteil (B7-Zwilling von '..') — mit einer
  // Meldung, die ihn jetzt auch NENNT, statt der falschen „es müssen
  // Buchstaben übrig bleiben".
  const zwilling = pruefeUndSpeichereUpload(kontext(neuerOrdner()), {
    bytes: bauGlb(),
    angezeigterName: 'Fass‥Deckel',
    kollisionswunsch: 'fest',
  });
  check(!zwilling.ok, `'Fass‥Deckel' (TWO DOT LEADER, → '..'): weiterhin abgelehnt (${zwilling.ok ? 'OK' : zwilling.meldung})`);
  check(!zwilling.ok && /Pfadanteil/.test(zwilling.meldung), `Meldung nennt den Pfadanteil, nicht „Buchstaben übrig bleiben" (${zwilling.ok ? '' : zwilling.meldung})`);

  // Reine Punkte bleiben abgelehnt (nichts Brauchbares übrig) — mit der
  // unveränderten, dafür zutreffenden Meldung.
  const nurPunkte = pruefeUndSpeichereUpload(kontext(neuerOrdner()), {
    bytes: bauGlb(),
    angezeigterName: '...',
    kollisionswunsch: 'fest',
  });
  check(!nurPunkte.ok, `'...' (nur Punkte, kein Rest): weiterhin abgelehnt (${nurPunkte.ok ? 'OK' : nurPunkte.meldung})`);
  check(!nurPunkte.ok && /Buchstaben/.test(nurPunkte.meldung), `Meldung nennt „Buchstaben übrig bleiben" (kein Pfadanteil erkannt, ${nurPunkte.ok ? '' : nurPunkte.meldung})`);
}

console.log('\n12. N2 (Nachangriff, Befund N-4) — ein fs-Fehler beim Schreiben trägt keinen Pfad in die Antwort\n');
{
  // Genau die Vorbedingung aus dem Nachangriff: ein VERZEICHNIS liegt unter
  // dem TEMP-Namen ('<name>.glb.neu'), den `pruefeUndSpeichereUpload` selbst
  // beschreiben will — `existsSync(pfad)` (ohne '.neu') sieht das nicht
  // voraus, `writeFileSync(temp, …)` wirft EISDIR mit dem vollen Pfad in
  // der `message`.
  const dir = neuerOrdner();
  mkdirSync(join(dir, 'U_Neuordner.glb.neu'), { recursive: true });
  const vor = plattenStand(dir);
  let warf = false;
  let antwort: ReturnType<typeof pruefeUndSpeichereUpload> | null = null;
  try {
    antwort = pruefeUndSpeichereUpload(kontext(dir), {
      bytes: bauGlb(),
      angezeigterName: 'Neuordner',
      kollisionswunsch: 'fest',
    });
  } catch {
    warf = true;
  }
  check(!warf, 'EISDIR beim Schreiben: pruefeUndSpeichereUpload wirft NICHT — der Dienst bleibt am Leben');
  check(antwort !== null && !antwort.ok, `stattdessen eine normale Ablehnung (${antwort && !antwort.ok ? antwort.meldung : 'OK?!'})`);
  check(
    antwort !== null && !antwort.ok && !antwort.meldung.includes(dir),
    `die Meldung nennt NICHT den absoluten Pfad des Worktrees (${antwort && !antwort.ok ? antwort.meldung : ''})`
  );
  check(
    antwort !== null && !antwort.ok && !/EISDIR|ENOENT|EACCES/.test(antwort.meldung),
    `die Meldung nennt keinen rohen fs-Fehlercode (${antwort && !antwort.ok ? antwort.meldung : ''})`
  );
  const nach = plattenStand(dir);
  check(nach.dateien === vor.dateien && nach.registryEintraege === vor.registryEintraege, 'Platte (abgesehen von der künstlichen Vorbedingung) unverändert — keine registry.json angelegt');
}

console.log('\n13. Prüftor — TRIANGLE_STRIP (mode 5) und TRIANGLE_FAN (mode 6) zählen count−2 Dreiecke, nicht 0\n');
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ modus: 5, stripEcken: 10 }),
    angezeigterName: 'Streifen',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `TRIANGLE_STRIP mit 10 Ecken: ANGENOMMEN (${antwort.ok ? '' : antwort.meldung})`);
  check(antwort.ok && antwort.eintrag.dreiecke === 8, `8 Dreiecke gezählt (10 − 2), nicht 0 (${antwort.ok ? antwort.eintrag.dreiecke : ''})`);
  if (antwort.ok) unregisterUploadedPrefab(antwort.eintrag.name);
}
{
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ modus: 6, stripEcken: 7 }),
    angezeigterName: 'Faecher',
    kollisionswunsch: 'fest',
  });
  check(antwort.ok, `TRIANGLE_FAN mit 7 Ecken: ANGENOMMEN (${antwort.ok ? '' : antwort.meldung})`);
  check(antwort.ok && antwort.eintrag.dreiecke === 5, `5 Dreiecke gezählt (7 − 2), nicht 0 (${antwort.ok ? antwort.eintrag.dreiecke : ''})`);
  if (antwort.ok) unregisterUploadedPrefab(antwort.eintrag.name);
}
{
  // Die Zählung muss auch WIRKEN, nicht nur im Eintrag stehen: ein Streifen
  // über der Dreiecksgrenze wird abgelehnt, genau wie eine TRIANGLES-Datei
  // mit derselben Dreieckszahl es würde.
  const dir = neuerOrdner();
  const antwort = pruefeUndSpeichereUpload(kontext(dir), {
    bytes: bauGlb({ modus: 5, stripEcken: MAX_DREIECKE + 3 }),
    angezeigterName: 'ZuLangerStreifen',
    kollisionswunsch: 'fest',
  });
  check(!antwort.ok, `TRIANGLE_STRIP mit ${MAX_DREIECKE + 1} Dreiecken (über MAX_DREIECKE): abgelehnt (${antwort.ok ? 'OK, faelschlich' : antwort.meldung})`);
}

for (const d of aufraeumOrdner) rmSync(d, { recursive: true, force: true });

console.log(failures === 0 ? '\nU1-Prüftor: alles grün.\n' : `\nU1-Prüftor: ${failures} FEHLGESCHLAGEN.\n`);
process.exit(failures > 0 ? 1 : 0);
