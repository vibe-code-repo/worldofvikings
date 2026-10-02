#!/usr/bin/env node
/*
  Holt drei Pflanzenmodelle aus dem Modell-Export in das Store-Labor:
  `assets/store-lab/vegetation/<id>.glb` plus ihre Textur unter
  `assets/store-lab/vegetation/textures/`.

  ── Warum es dieses Werkzeug gibt ────────────────────────────────────
  `store-vegetation-aufbereiten.mjs` bereitet den Store-Bestand auf und
  baut seinen Zielordner bei jedem Lauf neu auf; ein Modell, das gar
  nicht im Store liegt, hat dort keinen Platz. Diese drei (zwei Blumen,
  ein Farn) liegen nur im Export. Sie kommen deshalb hier herein, mit
  demselben Ergebnis wie dort: ein Material je Textur, `alphaMode: MASK`,
  zweiseitig, Bild als Datei NEBEN dem Modell (`textures/…`, relativ zur
  GLB), Geometrie bitgleich.

  Der Export liefert die Textur EINGEBETTET (bufferView). Sie wird
  unverändert herausgeschrieben (die PNG-Bytes sind die des Exports,
  Hash gleich) und der bufferView aus dem BIN-Block genommen. Der Rest
  des BIN wird bufferView-weise neu gepackt, nie byteweise.

  ── Die Materialnamen-Tabelle ────────────────────────────────────────
  Der Export nennt die Materialien nach dem Ursprungsprogramm
  (die Schlüssel der Tabelle unten). Im Labor heissen sie nach ihrer
  Rolle (wie `laub` beim Strauch): `blume`, `farn`. Ein Material, das
  nicht in der Tabelle steht, ist ein Befund und der Lauf wird rot.

  ── Was in `tools/store-lab-katalog.json` steht, und wer sie schreibt ─
  Die Messwerte (Hüllbox, Dreiecke, Grösse, Hash, Textur-Hash). Diese
  Datei ist EINGECHECKT, `assets/store-lab/` nicht: `store-prefabs.mjs`
  trägt die Modelle daraus in Katalog und Registry ein und läuft damit
  auf jedem Rechner zum selben Ergebnis, auch ohne die Binärdateien.

  Der ROLLOUT SCHREIBT SIE NIE (und auch keine `shared/src/store*.ts`):
  Ein Lauf auf DEV, der getrackte Dateien ändert, macht den Baum
  schmutzig, und `wov-update.sh` bricht danach in der Sauberkeitsprüfung
  ab. `pflanzenHolen()` VERGLEICHT deshalb nur. Weicht ein Modell von der
  Liste ab (Mike hat eine Datei gültig ersetzt, oder sie ist beschädigt),
  wird es NICHT gebaut und der Lauf warnt laut: „Messliste neu erzeugen
  per PR". Die Liste ändert nur der ausdrückliche Schalter
  `--messliste-schreiben` (von Hand, für Bauer und PR), und nur, wenn alle
  drei Dateien gültig sind.

  ── Was geprüft wird, bevor etwas gebaut wird ────────────────────────
  GLB-Kopf, Gesamtlänge, Längen beider Chunks, bufferViews und Accessoren
  im Bereich, Positionen endlich und innerhalb ihrer Hüllbox, und das
  eingebettete PNG Chunk für Chunk (Länge, CRC, IHDR zuerst, IEND zuletzt,
  keine Reste dahinter). Eine abgeschnittene oder beschädigte Datei wird
  übersprungen, nie gebaut.

  ── Woher die Ausgangsdateien kommen, und wer dieses Werkzeug ruft ──
  Die rohen Export-GLBs liegen im Asset-Speicher: `assets/store/
  vegetation-export/<id>.glb` (Mike kopiert sie dorthin, Liste im Bericht
  Grauklamm K1). Der Ort lässt sich mit `WOV_EXPORT_MODELLE` überstimmen.
  Gross- und Kleinschreibung des Dateinamens ist egal; eine Datei mit
  anderem Namen (etwa Unterstrich statt Bindestrich) wird mit einem
  Hinweis auf den erwarteten Namen übersprungen.

  `store-vegetation-aufbereiten.mjs` ruft `pflanzenHolen()` am Ende
  SELBST auf, weil es `assets/store-lab/vegetation/` bei jedem Lauf neu
  aufbaut: Die Rollout-Kette (`tools/wov-update.sh` 5b: `npm run
  store:aufbereiten`) braucht so keinen zweiten Schritt.

  ── Der Rollout bricht NIE ab ────────────────────────────────────────
  Fehlt der Ordner, ist er leer, ist er nur teilweise gefüllt, ist eine
  Datei beschädigt oder weicht die Messliste ab: WARNUNG, das Gültige
  wird gebaut, Code 0. Die Prefabs bleiben registriert, ihre Dateien
  fehlen dann nur im Labor.

  Aufruf:
    node tools/store-pflanzen-quellen.mjs                        (wie im Rollout)
    node tools/store-pflanzen-quellen.mjs --messliste-schreiben  (Liste neu erzeugen)

  Brings three plant models from the model export into assets/store-lab/
  and compares them with the tracked tools/store-lab-katalog.json (written only with --messliste-schreiben).
*/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLE = process.env.WOV_EXPORT_MODELLE ?? join(WURZEL, 'assets/store/vegetation-export');
const ZIEL = join(WURZEL, 'assets/store-lab/vegetation');
const KATALOG = join(WURZEL, 'tools/store-lab-katalog.json');

/** Quelldatei im Speicher (`vegetation-export/`) → Kennung im Labor und Prefab. */
export const MODELLE = [
  { quelle: 'flower-1a4.glb', id: 'flower-1a4', textKey: 'inhalt.prefab.vegetation_flower_1a4' },
  { quelle: 'flower-1a12.glb', id: 'flower-1a12', textKey: 'inhalt.prefab.vegetation_flower_1a12' },
  { quelle: 'fern-1a1.glb', id: 'fern-1a1', textKey: 'inhalt.prefab.vegetation_fern_1a1' },
];

/**
 * Materialname im Export → Rolle (= Materialname im Labor) und Tönung.
 *
 * Die Blumenkarte ist farbig und braucht keine Tönung. Die Farnkarte ist
 * wie die Laubkarten eine Helligkeitsmaske (gemessen R = G = B = 0,75 über
 * die deckenden Texel); ohne Faktor rendert sie GRAU. Zum Farn gibt der
 * Export keine Materialdaten her, deshalb gilt hier der Faktor des
 * Laubs `Leaves 2` (Mittel aus Ober- und Unterfarbe, `laubSpitzen.ts`,
 * wie `bush-1a1`): eine Annahme, keine Messung am Original.
 */
export const MATERIALNAMEN = {
  'Flowers_A 1': { rolle: 'blume', faktor: null },
  'Plant_Leaves_1A3 1': { rolle: 'farn', faktor: [0.6695, 0.741, 0.2785, 1] },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const runde = (x) => Math.round(x * 1e4) / 1e4;
const auf4 = (n) => (n + 3) & ~3;

const KOMPONENTEN = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPEN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/**
 * Liest eine GLB STRENG: Kopf, Gesamtlänge, beide Chunk-Längen, bufferViews
 * und Accessoren im Bereich. Wirft bei der ersten Unstimmigkeit.
 */
export function glbLesen(buf) {
  if (buf.length < 28) throw new Error(`zu kurz für eine GLB (${buf.length} B)`);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('keine GLB (Kennung)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('keine GLB-Version 2');
  if (buf.readUInt32LE(8) !== buf.length) {
    throw new Error(`Länge laut Kopf ${buf.readUInt32LE(8)} B, Datei ${buf.length} B (abgeschnitten oder verlängert)`);
  }
  const jsonLaenge = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('erster Chunk ist kein JSON');
  const binKopf = 20 + jsonLaenge;
  if (binKopf + 8 > buf.length) throw new Error('JSON-Chunk reicht über die Datei hinaus');
  const binLaenge = buf.readUInt32LE(binKopf);
  if (buf.readUInt32LE(binKopf + 4) !== 0x004e4942) throw new Error('zweiter Chunk ist kein BIN');
  if (binKopf + 8 + binLaenge !== buf.length) throw new Error('BIN-Chunk endet nicht mit der Datei');
  let json;
  try {
    json = JSON.parse(buf.subarray(20, binKopf).toString('utf8'));
  } catch (e) {
    throw new Error(`JSON nicht lesbar: ${e.message}`);
  }
  const bin = buf.subarray(binKopf + 8, binKopf + 8 + binLaenge);
  if (!Array.isArray(json.bufferViews) || !Array.isArray(json.accessors)) throw new Error('bufferViews/accessors fehlen');
  if ((json.buffers?.[0]?.byteLength ?? Infinity) > bin.length) throw new Error('buffers[0] länger als der BIN-Chunk');
  json.bufferViews.forEach((v, i) => {
    if (!(v.byteLength >= 0) || (v.byteOffset ?? 0) + v.byteLength > bin.length) throw new Error(`bufferView ${i} reicht über den BIN-Chunk hinaus`);
  });
  json.accessors.forEach((a, i) => {
    if (a.bufferView === undefined) return;
    const v = json.bufferViews[a.bufferView];
    const gr = (KOMPONENTEN[a.componentType] ?? NaN) * (TYPEN[a.type] ?? NaN);
    const luecke = v?.byteStride ? v.byteStride - gr : 0;
    if (!v || !(gr > 0) || (a.byteOffset ?? 0) + a.count * gr + (a.count - 1) * luecke > v.byteLength) {
      throw new Error(`Accessor ${i} reicht über seinen bufferView hinaus`);
    }
  });
  return { json, bin };
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Prüft ein PNG Chunk für Chunk: Kennung, IHDR zuerst, Länge und CRC jedes
 * Chunks, IDAT vorhanden, IEND zuletzt und nichts dahinter.
 * Gibt `{ breite, hoehe }` zurück, wirft bei der ersten Unstimmigkeit.
 */
export function pngPruefen(png) {
  if (png.length < 57 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('Bild ist kein PNG');
  }
  let pos = 8;
  let erster = true;
  let idat = false;
  let breite = 0;
  let hoehe = 0;
  for (;;) {
    if (pos + 12 > png.length) throw new Error('PNG abgeschnitten (kein IEND)');
    const laenge = png.readUInt32BE(pos);
    const typ = png.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + laenge > png.length) throw new Error(`PNG abgeschnitten (Chunk ${typ})`);
    if (png.readUInt32BE(pos + 8 + laenge) !== crc32(png.subarray(pos + 4, pos + 8 + laenge))) {
      throw new Error(`PNG beschädigt (Prüfsumme von ${typ})`);
    }
    if (erster) {
      if (typ !== 'IHDR' || laenge !== 13) throw new Error('PNG: IHDR fehlt am Anfang');
      breite = png.readUInt32BE(pos + 8);
      hoehe = png.readUInt32BE(pos + 12);
      if (!(breite > 0 && hoehe > 0 && breite <= 16384 && hoehe <= 16384)) throw new Error(`PNG: unsinnige Grösse ${breite}×${hoehe}`);
      erster = false;
    }
    if (typ === 'IDAT') idat = true;
    pos += 12 + laenge;
    if (typ === 'IEND') {
      if (laenge !== 0) throw new Error('PNG: IEND mit Inhalt');
      if (pos !== png.length) throw new Error('PNG: Reste hinter IEND');
      if (!idat) throw new Error('PNG ohne Bilddaten');
      return { breite, hoehe };
    }
  }
}

/** Positionen endlich und in ihrer Hüllbox, Indizes im Bereich. Wirft sonst. */
function geometriePruefen(json, bin) {
  const prim = json.meshes[0].primitives[0];
  const pos = json.accessors[prim.attributes.POSITION];
  if (!pos?.min || !pos?.max || pos.componentType !== 5126 || pos.type !== 'VEC3') throw new Error('POSITION ohne Hüllbox oder nicht VEC3/FLOAT');
  const v = json.bufferViews[pos.bufferView];
  const schritt = v.byteStride ?? 12;
  for (let i = 0; i < pos.count; i++) {
    const ab = (v.byteOffset ?? 0) + (pos.byteOffset ?? 0) + i * schritt;
    for (let k = 0; k < 3; k++) {
      const x = bin.readFloatLE(ab + k * 4);
      if (!Number.isFinite(x) || x < pos.min[k] - 1e-4 || x > pos.max[k] + 1e-4) throw new Error(`Position ${i} ausserhalb der Hüllbox oder nicht endlich`);
    }
  }
  const ind = json.accessors[prim.indices];
  if (!ind || ind.count % 3 !== 0 || ![5121, 5123, 5125].includes(ind.componentType)) throw new Error('Indizes ungültig');
  const iv = json.bufferViews[ind.bufferView];
  const gr = KOMPONENTEN[ind.componentType];
  for (let i = 0; i < ind.count; i++) {
    const ab = (iv.byteOffset ?? 0) + (ind.byteOffset ?? 0) + i * gr;
    const x = gr === 1 ? bin.readUInt8(ab) : gr === 2 ? bin.readUInt16LE(ab) : bin.readUInt32LE(ab);
    if (x >= pos.count) throw new Error(`Index ${i} verweist hinter die Positionen`);
  }
}

export function glbSchreiben(json, bin) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc(auf4(text.length) - text.length, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc(auf4(bin.length) - bin.length, 0)]);
  const kopf = Buffer.alloc(12);
  kopf.writeUInt32LE(0x46546c67, 0);
  kopf.writeUInt32LE(2, 4);
  kopf.writeUInt32LE(12 + 8 + text.length + 8 + binPad.length, 8);
  const jk = Buffer.alloc(8);
  jk.writeUInt32LE(text.length, 0);
  jk.writeUInt32LE(0x4e4f534a, 4);
  const bk = Buffer.alloc(8);
  bk.writeUInt32LE(binPad.length, 0);
  bk.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([kopf, jk, text, bk, binPad]);
}

/**
 * Baut aus der Export-GLB die Labor-GLB.
 * Rückgabe: { glb, png, huellbox, dreiecke, material }.
 */
export function umbauen(buf, id, dateiname) {
  let gelesen;
  try {
    gelesen = glbLesen(buf);
  } catch (e) {
    throw new Error(`${dateiname}: ${e.message}`);
  }
  const { json, bin } = gelesen;
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) {
    throw new Error(`${dateiname}: erwartet ein Mesh mit einem Primitiv`);
  }
  if (json.materials.length !== 1 || json.images.length !== 1) {
    throw new Error(`${dateiname}: erwartet ein Material und ein Bild`);
  }
  for (const n of json.nodes) {
    if (n.matrix || n.translation || n.rotation || n.scale) {
      throw new Error(`${dateiname}: Knoten mit Transformation — Huellbox waere nicht dateigleich`);
    }
  }
  const eintrag = MATERIALNAMEN[json.materials[0].name];
  if (!eintrag) throw new Error(`${dateiname}: unbekanntes Material ${json.materials[0].name}`);

  const { rolle, faktor } = eintrag;

  // Das eingebettete Bild: bufferView der Bildes, unverändert herausgeschrieben.
  const bildView = json.bufferViews[json.images[0].bufferView];
  const png = Buffer.from(bin.subarray(bildView.byteOffset ?? 0, (bildView.byteOffset ?? 0) + bildView.byteLength));
  try {
    pngPruefen(png);
    geometriePruefen(json, bin);
  } catch (e) {
    throw new Error(`${dateiname}: ${e.message}`);
  }
  const bildName = `${rolle}-${sha256(png).slice(0, 8)}`;

  // bufferViews ohne das Bild, in alter Reihenfolge, neu gepackt.
  const behalten = [];
  json.bufferViews.forEach((bv, i) => {
    if (i !== json.images[0].bufferView) behalten.push(i);
  });
  const neuIndex = new Map(behalten.map((alt, neu) => [alt, neu]));
  const teile = [];
  let versatz = 0;
  const neueViews = behalten.map((alt) => {
    const bv = json.bufferViews[alt];
    const von = bv.byteOffset ?? 0;
    const stueck = bin.subarray(von, von + bv.byteLength);
    versatz = auf4(versatz);
    const neu = { ...bv, byteOffset: versatz };
    teile.push([versatz, stueck]);
    versatz += stueck.length;
    return neu;
  });
  const neuBin = Buffer.alloc(auf4(versatz));
  for (const [ab, stueck] of teile) stueck.copy(neuBin, ab);
  for (const acc of json.accessors) {
    if (acc.bufferView !== undefined) acc.bufferView = neuIndex.get(acc.bufferView);
  }

  const prim = json.meshes[0].primitives[0];
  const pos = json.accessors[prim.attributes.POSITION];
  const dreiecke = json.accessors[prim.indices].count / 3;

  const ausgabe = {
    asset: { version: '2.0', generator: 'tools/store-pflanzen-quellen.mjs' },
    buffers: [{ byteLength: neuBin.length }],
    bufferViews: neueViews,
    accessors: json.accessors,
    materials: [
      {
        name: rolle,
        pbrMetallicRoughness: {
          metallicFactor: 0,
          roughnessFactor: 1,
          ...(faktor ? { baseColorFactor: faktor } : {}),
          baseColorTexture: { index: 0 },
        },
        doubleSided: true,
        alphaMode: 'MASK',
        alphaCutoff: 0.5,
      },
    ],
    images: [{ uri: `textures/${bildName}.png`, name: bildName }],
    textures: [{ source: 0 }],
    meshes: json.meshes,
    nodes: [{ name: json.nodes[0].name, mesh: 0 }, { name: id, children: [0] }],
    scenes: [{ nodes: [1] }],
    scene: 0,
  };
  return {
    glb: glbSchreiben(ausgabe, neuBin),
    png,
    bildName,
    huellbox: { min: pos.min.map(runde), max: pos.max.map(runde) },
    dreiecke,
    material: rolle,
  };
}

// ── Hauptlauf ────────────────────────────────────────────────────────

const WARNUNG = '[pflanzen-quellen] WARNUNG:';
const HINWEIS_LISTE =
  'Messliste neu erzeugen per PR: node tools/store-pflanzen-quellen.mjs --messliste-schreiben (Bauer, nicht im Rollout)';

function eintragVon(m, r) {
  return {
    id: `vegetation/${m.id}`,
    pfad: `vegetation/${m.id}.glb`,
    prefab: `vegetation-${m.id}`,
    textKey: m.textKey,
    bytes: r.glb.length,
    hash: `sha256-${sha256(r.glb)}`,
    bounds: r.huellbox,
    dreiecke: r.dreiecke,
    material: r.material,
    alphaModus: 'MASK',
    zweiseitig: true,
    textur: { datei: `textures/${r.bildName}.png`, bytes: r.png.length, hash: `sha256-${sha256(r.png)}` },
  };
}

/**
 * Baut die gültigen Modelle aus `quelle` nach `ziel` und VERGLEICHT sie mit der
 * Messliste `katalog`. Wirft im Normalfall NIE; Probleme sind Warnungen
 * (siehe Kopfkommentar). Nur mit `messlisteSchreiben` wird die Liste
 * geschrieben, und nur, wenn alle drei Modelle gültig sind (sonst Fehler).
 * Gibt die Zahl der gebauten Modelle zurück.
 */
export function pflanzenHolen({ quelle = QUELLE, ziel = ZIEL, katalog = KATALOG, messlisteSchreiben = false } = {}) {
  const warn = (text) => console.warn(`${WARNUNG} ${text}`);
  if (!existsSync(quelle)) {
    warn(
      `${quelle} fehlt — Blumen und Farn werden nicht gebaut.\n` +
        '                   Die Prefabs bleiben registriert (tools/store-lab-katalog.json), ihre\n' +
        '                   Dateien fehlen im Labor, bis die Export-GLBs im Speicher liegen.'
    );
    if (messlisteSchreiben) throw new Error('Messliste nicht geschrieben: Quellordner fehlt');
    return 0;
  }
  const namen = new Map(readdirSync(quelle).map((n) => [n.toLowerCase(), n]));
  const gueltig = [];
  const probleme = [];
  for (const m of MODELLE) {
    const echt = namen.get(m.quelle);
    if (!echt) {
      const aehnlich = [...namen.values()].find((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '') === m.quelle.replace(/[^a-z0-9]/g, ''));
      probleme.push(`${m.quelle} fehlt${aehnlich ? ` (gefunden: ${aehnlich} — bitte als ${m.quelle} benennen)` : ''}`);
      continue;
    }
    try {
      const r = umbauen(readFileSync(join(quelle, echt)), m.id, echt);
      gueltig.push({ m, r, eintrag: eintragVon(m, r) });
    } catch (e) {
      probleme.push(`${e.message} — übersprungen`);
    }
  }
  for (const p of probleme) warn(p);
  if (messlisteSchreiben) {
    if (probleme.length > 0) throw new Error(`Messliste nicht geschrieben: ${probleme.join('; ')}`);
  } else if (probleme.length > 0 && gueltig.length === 0) {
    warn('keine gültige Datei im Ordner — nichts gebaut.');
  }

  // Vergleich mit der eingecheckten Liste (nur lesen).
  let alt = null;
  try {
    alt = new Map(JSON.parse(readFileSync(katalog, 'utf8')).eintraege.map((e) => [e.id, e]));
  } catch {
    alt = null;
  }
  const zuBauen = messlisteSchreiben
    ? gueltig
    : gueltig.filter(({ eintrag }) => {
        const soll = alt?.get(eintrag.id);
        if (soll && JSON.stringify(soll) === JSON.stringify(eintrag)) return true;
        warn(`Messliste weicht ab für ${eintrag.id}${soll ? '' : ' (kein Eintrag)'} — Modell NICHT gebaut. ${HINWEIS_LISTE}`);
        return false;
      });

  if (zuBauen.length > 0) mkdirSync(join(ziel, 'textures'), { recursive: true });
  for (const { m, r } of zuBauen) {
    writeFileSync(join(ziel, `${m.id}.glb`), r.glb);
    writeFileSync(join(ziel, 'textures', `${r.bildName}.png`), r.png);
    console.log(
      `[pflanzen-quellen] ${m.id}.glb  ${r.dreiecke} Dreiecke  ${r.glb.length} B  Material ${r.material}  Bild ${r.bildName}.png`
    );
  }
  if (messlisteSchreiben) {
    const eintraege = gueltig.map((g) => g.eintrag).sort((a, b) => (a.id < b.id ? -1 : 1));
    const neu = `${JSON.stringify({ schemaVersion: 1, eintraege }, null, 2)}\n`;
    if (!existsSync(katalog) || readFileSync(katalog, 'utf8') !== neu) writeFileSync(katalog, neu);
  }
  return zuBauen.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schreiben = process.argv.includes('--messliste-schreiben');
  try {
    pflanzenHolen({ messlisteSchreiben: schreiben });
  } catch (e) {
    if (schreiben) {
      console.error(`[pflanzen-quellen] ${e.message}`);
      process.exit(2);
    }
    console.warn(`${WARNUNG} unerwarteter Fehler — ${e.message}`);
  }
}
