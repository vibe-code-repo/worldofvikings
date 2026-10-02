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
  (`Flowers_A 1`, `Plant_Leaves_1A3 1`). Im Labor heissen sie nach ihrer
  Rolle (wie `laub` beim Strauch): `blume`, `farn`. Ein Material, das
  nicht in der Tabelle steht, ist ein Befund und der Lauf wird rot.

  ── Was nach `tools/store-lab-katalog.json` geht ─────────────────────
  Die Messwerte (Hüllbox, Dreiecke, Grösse, Hash, Textur-Hash). Diese
  Datei ist EINGECHECKT, `assets/store-lab/` nicht: `store-prefabs.mjs`
  trägt die Modelle daraus in Katalog und Registry ein und läuft damit
  auf jedem Rechner zum selben Ergebnis, auch ohne die Binärdateien.

  ── Die Weiche ───────────────────────────────────────────────────────
  Fehlt der Export GANZ (CI, fremder Rechner), meldet der Lauf das und
  endet mit Code 0. Fehlt eine einzelne Datei im vorhandenen Export, ist
  das ein Befund (Code 2).

  Aufruf:
    node tools/store-pflanzen-quellen.mjs

  Ort des Exports: `WOV_EXPORT_MODELLE` (Vorgabe
  `~/wov-assets/Assets/PrefabHierarchyObject`).

  Brings three plant models from the model export into assets/store-lab/
  and writes their measurements to the tracked tools/store-lab-katalog.json.
*/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLE =
  process.env.WOV_EXPORT_MODELLE ?? join(process.env.HOME ?? '', 'wov-assets/Assets/PrefabHierarchyObject');
const ZIEL = join(WURZEL, 'assets/store-lab/vegetation');
const KATALOG = join(WURZEL, 'tools/store-lab-katalog.json');

/** Quelldatei im Export → Kennung im Labor und Prefab. */
export const MODELLE = [
  { quelle: 'Flower_1A4.glb', id: 'flower-1a4', textKey: 'inhalt.prefab.vegetation_flower_1a4' },
  { quelle: 'Flower_1A12.glb', id: 'flower-1a12', textKey: 'inhalt.prefab.vegetation_flower_1a12' },
  { quelle: 'Fern_1A1.glb', id: 'fern-1a1', textKey: 'inhalt.prefab.vegetation_fern_1a1' },
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

export function glbLesen(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('keine GLB');
  const jsonLaenge = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLaenge).toString('utf8'));
  const binKopf = 20 + jsonLaenge;
  const binLaenge = buf.readUInt32LE(binKopf);
  const bin = buf.subarray(binKopf + 8, binKopf + 8 + binLaenge);
  return { json, bin };
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
  const { json, bin } = glbLesen(buf);
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
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${dateiname}: Bild ist kein PNG`);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(QUELLE)) {
    console.log(
      `[pflanzen-quellen] Modell-Export fehlt (${QUELLE}) — übersprungen.\n` +
        '                   Die eingecheckte tools/store-lab-katalog.json bleibt unverändert.'
    );
    process.exit(0);
  }
  const fehlt = MODELLE.filter((m) => !existsSync(join(QUELLE, m.quelle)));
  if (fehlt.length > 0) {
    console.error(
      '[pflanzen-quellen] Der Export ist unvollständig:\n  ' + fehlt.map((m) => join(QUELLE, m.quelle)).join('\n  ')
    );
    process.exit(2);
  }
  mkdirSync(join(ZIEL, 'textures'), { recursive: true });
  const eintraege = [];
  for (const m of MODELLE) {
    const r = umbauen(readFileSync(join(QUELLE, m.quelle)), m.id, m.quelle);
    writeFileSync(join(ZIEL, `${m.id}.glb`), r.glb);
    writeFileSync(join(ZIEL, 'textures', `${r.bildName}.png`), r.png);
    eintraege.push({
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
    });
    console.log(
      `[pflanzen-quellen] ${m.id}.glb  ${r.dreiecke} Dreiecke  ${r.glb.length} B  Material ${r.material}  Bild ${r.bildName}.png`
    );
  }
  eintraege.sort((a, b) => (a.id < b.id ? -1 : 1));
  const neu = `${JSON.stringify({ schemaVersion: 1, eintraege }, null, 2)}\n`;
  if (!existsSync(KATALOG) || readFileSync(KATALOG, 'utf8') !== neu) writeFileSync(KATALOG, neu);
}
