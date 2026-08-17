/**
 * Rinde und Laub eines Baumes in EIN Material legen — halb so viele
 * Thin-Instance-Master.
 *
 * ── Warum ────────────────────────────────────────────────────────────
 * Die E10-Messung (tools/pw-baum-kosten.mjs, 17.08.2026) hat den Kurs
 * dieser Engine geliefert: **rund 0,045 ms je Prefab-Master**,
 * Schattenkaskaden eingerechnet — und **0,00 ms je Dreieck**. Jeder Baum
 * stellt heute zwei Master, weil er zwei Materialien führt: `nadeln`
 * (Laubkarten, alphaMode MASK) und `rinde` (Stamm und Äste, OPAQUE).
 * `AssetManager.verschmelzeNachMaterial()` legt Submeshes nur dann
 * zusammen, wenn sie sich Material UND Vertexattribute teilen; die
 * Attribute stimmen längst überein (POSITION/NORMAL/TEXCOORD_0), am
 * Material scheitert es. Ein gemeinsames Material halbiert also die
 * Baum-Master.
 *
 * ── Warum als GLB-Operation und nicht in baum-generieren.py ──────────
 * Weil das Rezept derzeit nicht läuft. `tools/baeume-bauen.sh` braucht
 * Blender (auf `wov-dev` nicht installiert) und die Quelltexturen
 * `PineTree_01.png`, `Pine_tree_texture_d.png`, `birch_leaf.png` und
 * `birch_bark.png` — die sind mit dem AssetRipper-Export gelöscht worden
 * und existieren nirgends mehr. Die 148 GLBs unter `assets/models` sind
 * der einzige Bestand, und `assets/` liegt nicht im Repo.
 *
 * Diese Datei fasst deshalb die fertigen GLBs an statt sie neu zu
 * erzeugen. Das hat einen Nebengewinn: Die verlorenen Quelltexturen
 * stecken als eingebettete Bilder IN den GLBs und werden mit
 * `--texturen` wieder herausgeschrieben. Die GEOMETRIE bleibt dabei Byte
 * für Byte dieselbe — die in `shared/src/prefabs.ts` eingetragenen
 * `renderScale`-Werte bleiben damit gültig, was bei einem Neulauf von
 * `baeume-bauen.sh` ausdrücklich nicht garantiert wäre.
 *
 * ── Zwei Fälle ───────────────────────────────────────────────────────
 * A) EIN Bild (Fichte, Tanne, Kiefer). Rinde und Nadeln liegen bereits im
 *    selben Atlas, nur in zwei Blender-Materialien. Es genügt, das
 *    Rinden-Submesh auf das Laubmaterial umzuhängen. Keine UV ändert sich.
 *
 * B) ZWEI Bilder (Birke, Eiche). Laub und Rinde kommen aus getrennten
 *    PNGs. Hier entsteht ein kombinierter Atlas (Laub links, Rinde
 *    rechts) und beide UV-Sätze werden in ihre Hälfte umgerechnet.
 *
 * ── Der Alphakanal der Rinde MUSS aufgefüllt werden ──────────────────
 * Das gemeinsame Material ist alpha-getestet (Cutoff 0,5). Rinde, die
 * heute OPAQUE rendert, würde darin ausgestanzt. Gemessen im Rindenfeld:
 *
 *   PineTree_01 (Fichte/Kiefer)   0,00 % unter Alpha 128   unkritisch
 *   Pine_tree_texture_d (Tanne)   4,55 %                   sichtbare Sprenkel
 *   birch_bark (Birke)           26,82 %                   durchlöcherter Stamm
 *   eiche_bark (Eiche)            0,00 %                   unkritisch
 *
 * Deshalb wird im Rindenbereich Alpha hart auf 255 gesetzt. Welcher
 * Bereich das ist, wird NICHT aus einer Artentabelle gelesen, sondern aus
 * den UVs des Rinden-Submesh selbst — und geprüft, dass er sich nicht mit
 * dem Laubbereich überschneidet. Eine Tabelle wäre eine zweite Wahrheit
 * neben der Geometrie und würde beim nächsten geänderten UV-Rechteck
 * still falsch.
 *
 * ── Was sich im Bild ändert ──────────────────────────────────────────
 * Die Rinde läuft danach alpha-getestet (sichtbar wird davon nichts, der
 * Kanal ist aufgefüllt) und bekommt das Wind-Plugin, das am MATERIAL
 * hängt. Die Äste schwingen also mit dem Laub statt stillzustehen. Die
 * Dämpfung dafür ist der Achsabstand (`vbAnsatzDaempfung` in
 * WindPlugin.ts): Stammvertices liegen nahe der Achse und bewegen sich
 * kaum, Astspitzen weit draussen schwingen voll. Beidseitig gezeichnet
 * wurde die Rinde übrigens schon vorher — Blender exportiert sie mit
 * `doubleSided: true`.
 *
 * Aufruf:
 *   node tools/baum-material-zusammenlegen.mjs                 # nur prüfen
 *   node tools/baum-material-zusammenlegen.mjs --schreiben
 *   node tools/baum-material-zusammenlegen.mjs --texturen assets/textures
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const MODELLE = arg('modelle', 'assets/models');
const SICHERUNG = arg('sicherung', 'assets/models-vor-zusammenlegung');
const TEXTUREN = flag('texturen') ? arg('texturen', 'assets/textures') : null;
const SCHREIBEN = flag('schreiben');

/** Name des zusammengelegten Materials. */
const NEUER_NAME = 'baum';
/**
 * Sicherheitsrand um das Rinden-UV-Feld, in Texeln.
 *
 * Bilineare Filterung greift auf Nachbartexel zu; ein Feld, das exakt an
 * der UV-Grenze endet, holt sich beim Vergrössern Alpha von ausserhalb.
 * Zwei Texel decken das ab, ohne in den Laubbereich zu reichen — die
 * Überschneidungsprüfung unten läuft MIT diesem Rand.
 */
const RAND_TEXEL = 2;

// ── GLB lesen und schreiben ──────────────────────────────────────────

function glbLesen(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('kein GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

/**
 * GLB neu schreiben — der Binärteil wird aus den bufferViews neu
 * zusammengesetzt.
 *
 * `ersatz` bildet bufferView-Index auf neue Bytes ab. Alles andere wird
 * Byte für Byte übernommen, in der ursprünglichen Reihenfolge. Die
 * Offsets werden dabei neu vergeben (4-Byte-Ausrichtung, weil Float-
 * Accessoren sie verlangen) — deshalb dürfen Accessoren nur mit
 * `byteOffset = 0` auf ersetzte Views zeigen, was `pruefeAufbau()` sicherstellt.
 */
function glbSchreiben(pfad, json, bin, ersatz) {
  const teile = [];
  let offset = 0;
  for (const [i, bv] of json.bufferViews.entries()) {
    const daten = ersatz.get(i) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      teile.push(Buffer.alloc(pad));
      offset += pad;
    }
    bv.byteOffset = offset;
    bv.byteLength = daten.length;
    teile.push(Buffer.from(daten));
    offset += daten.length;
  }
  const neuerBin = Buffer.concat(teile);
  json.buffers = [{ byteLength: neuerBin.length }];

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (neuerBin.length % 4)) % 4;
  const binBuf = binPad > 0 ? Buffer.concat([neuerBin, Buffer.alloc(binPad)]) : neuerBin;

  const kopf = Buffer.alloc(12);
  kopf.writeUInt32LE(0x46546c67, 0);
  kopf.writeUInt32LE(2, 4);
  kopf.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonKopf = Buffer.alloc(8);
  jsonKopf.writeUInt32LE(jsonBuf.length, 0);
  jsonKopf.writeUInt32LE(0x4e4f534a, 4);
  const binKopf = Buffer.alloc(8);
  binKopf.writeUInt32LE(binBuf.length, 0);
  binKopf.writeUInt32LE(0x004e4942, 4);

  writeFileSync(pfad, Buffer.concat([kopf, jsonKopf, jsonBuf, binKopf, binBuf]));
}

// ── Hilfen ───────────────────────────────────────────────────────────

const bvBytes = (json, bin, i) => {
  const bv = json.bufferViews[i];
  return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
};

/** UVs eines Primitivs als Float32Array (Kopie). */
function uvLesen(json, bin, prim) {
  const acc = json.accessors[prim.attributes.TEXCOORD_0];
  const roh = bvBytes(json, bin, acc.bufferView);
  return new Float32Array(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength));
}

function uvGrenzen(uv) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    if (uv[i] < u0) u0 = uv[i];
    if (uv[i] > u1) u1 = uv[i];
    if (uv[i + 1] < v0) v0 = uv[i + 1];
    if (uv[i + 1] > v1) v1 = uv[i + 1];
  }
  return { u0, u1, v0, v1 };
}

const ueberschneidet = (a, b) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;

/**
 * Aufbau prüfen, bevor irgendetwas geschrieben wird.
 *
 * Jede Annahme dieses Werkzeugs steht hier als Bedingung. Ein GLB, das
 * eine davon verletzt, wird übersprungen und gemeldet — nicht halb
 * umgebaut.
 */
function pruefeAufbau(json, bin) {
  const fehler = [];
  const meshes = json.meshes ?? [];
  const laub = meshes.find((m) => m.name === 'leaves');
  const holz = meshes.find((m) => m.name === 'tree');
  if (!laub || !holz) return { fehler: ['kein leaves/tree-Paar'] };
  if (laub.primitives.length !== 1 || holz.primitives.length !== 1) {
    fehler.push('mehr als ein Primitiv je Mesh');
  }
  const pLaub = laub.primitives[0];
  const pHolz = holz.primitives[0];
  if (pLaub.material === undefined || pHolz.material === undefined) fehler.push('Primitiv ohne Material');
  if (pLaub.material === pHolz.material) return { fehler: ['bereits zusammengelegt'], schonFertig: true };

  for (const [was, p] of [['leaves', pLaub], ['tree', pHolz]]) {
    const ai = p.attributes.TEXCOORD_0;
    if (ai === undefined) {
      fehler.push(`${was}: keine TEXCOORD_0`);
      continue;
    }
    const acc = json.accessors[ai];
    const bv = json.bufferViews[acc.bufferView];
    if ((acc.byteOffset ?? 0) !== 0) fehler.push(`${was}: UV-Accessor mit Versatz`);
    if (bv.byteStride !== undefined) fehler.push(`${was}: UV-View mit Stride`);
    if (bv.byteLength !== acc.count * 8) fehler.push(`${was}: UV-View nicht exklusiv`);
    if (acc.componentType !== 5126 || acc.type !== 'VEC2') fehler.push(`${was}: UV nicht float VEC2`);
    // Teilt sich ein anderer Accessor diesen View, wäre das Überschreiben fatal.
    const mitnutzer = json.accessors.filter((a) => a.bufferView === acc.bufferView).length;
    if (mitnutzer !== 1) fehler.push(`${was}: UV-View von ${mitnutzer} Accessoren genutzt`);
  }

  const bild = (matIndex) => {
    const t = json.materials[matIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
    return t === undefined ? undefined : json.textures[t]?.source;
  };
  const bLaub = bild(pLaub.material);
  const bHolz = bild(pHolz.material);
  if (bLaub === undefined || bHolz === undefined) fehler.push('Material ohne Basisfarb-Bild');

  return { fehler, pLaub, pHolz, laubMat: pLaub.material, holzMat: pHolz.material, bLaub, bHolz };
}

/** Bild eines GLB als rohe RGBA-Fläche. */
async function bildLesen(json, bin, index) {
  const bv = json.bufferViews[json.images[index].bufferView];
  const roh = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const bild = sharp(Buffer.from(roh)).ensureAlpha();
  const { data, info } = await bild.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const alsPng = (data, w, h) =>
  sharp(data, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();

/**
 * Alpha im angegebenen UV-Feld auf 255 ziehen.
 *
 * glTF zählt v von OBEN (Bildzeile 0 liegt bei v = 0), anders als Blender
 * — deshalb hier keine Spiegelung. Wer sie einbaut, füllt die falsche
 * Bildhälfte auf und wundert sich über einen durchlöcherten Stamm bei
 * gleichzeitig undurchsichtigem Laub.
 */
function alphaAuffuellen(flaeche, feld) {
  const { data, w, h } = flaeche;
  const x0 = Math.max(0, Math.floor(feld.u0 * w) - RAND_TEXEL);
  const x1 = Math.min(w, Math.ceil(feld.u1 * w) + RAND_TEXEL);
  const y0 = Math.max(0, Math.floor(feld.v0 * h) - RAND_TEXEL);
  const y1 = Math.min(h, Math.ceil(feld.v1 * h) + RAND_TEXEL);
  let geaendert = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4 + 3;
      if (data[i] !== 255) {
        data[i] = 255;
        geaendert++;
      }
    }
  }
  return { geaendert, gesamt: Math.max(1, (x1 - x0) * (y1 - y0)) };
}

/** Nicht mehr benutzte Materialien, Texturen und Bilder entfernen. */
function aufraeumen(json) {
  const matGenutzt = new Set();
  for (const m of json.meshes) for (const p of m.primitives) if (p.material !== undefined) matGenutzt.add(p.material);
  const matAlt = [...matGenutzt].sort((a, b) => a - b);
  const matNeu = new Map(matAlt.map((alt, neu) => [alt, neu]));
  json.materials = matAlt.map((i) => json.materials[i]);
  for (const m of json.meshes) for (const p of m.primitives) p.material = matNeu.get(p.material);

  const texGenutzt = new Set();
  for (const mat of json.materials) {
    const t = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t !== undefined) texGenutzt.add(t);
  }
  const texAlt = [...texGenutzt].sort((a, b) => a - b);
  const texNeu = new Map(texAlt.map((alt, neu) => [alt, neu]));
  json.textures = texAlt.map((i) => json.textures[i]);
  for (const mat of json.materials) {
    const bt = mat.pbrMetallicRoughness?.baseColorTexture;
    if (bt) bt.index = texNeu.get(bt.index);
  }

  const bildGenutzt = new Set(json.textures.map((t) => t.source).filter((s) => s !== undefined));
  const bildAlt = [...bildGenutzt].sort((a, b) => a - b);
  const bildNeu = new Map(bildAlt.map((alt, neu) => [alt, neu]));
  json.images = bildAlt.map((i) => json.images[i]);
  for (const t of json.textures) if (t.source !== undefined) t.source = bildNeu.get(t.source);

  // BufferViews bleiben stehen, auch verwaiste: sie neu zu nummerieren
  // hiesse, jeden Accessor mitzuziehen. Ein ungenutzter View kostet nur
  // seine Bytes, und die fallen beim naechsten Lauf ohnehin weg.
}

/** Prüfen, dass nach dem Umbau jeder Index noch auflöst. */
function pruefeIndizes(json) {
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      if (json.materials[p.material] === undefined) throw new Error(`Primitiv zeigt auf Material ${p.material}`);
    }
  }
  for (const mat of json.materials) {
    const t = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t !== undefined && json.textures[t] === undefined) throw new Error(`Material zeigt auf Textur ${t}`);
  }
  for (const t of json.textures) {
    if (t.source !== undefined && json.images[t.source] === undefined) throw new Error(`Textur zeigt auf Bild ${t.source}`);
  }
  for (const im of json.images) {
    if (json.bufferViews[im.bufferView] === undefined) throw new Error(`Bild zeigt auf View ${im.bufferView}`);
  }
}

// ── Hauptlauf ────────────────────────────────────────────────────────

const dateien = readdirSync(MODELLE).filter((d) => d.endsWith('.glb')).sort();
const bericht = { zusammengelegt: [], schonFertig: [], uebersprungen: [] };
const texturenGeschrieben = new Set();

if (SCHREIBEN) mkdirSync(SICHERUNG, { recursive: true });
if (TEXTUREN) mkdirSync(TEXTUREN, { recursive: true });

for (const datei of dateien) {
  const pfad = join(MODELLE, datei);
  let json, bin;
  try {
    ({ json, bin } = glbLesen(pfad));
  } catch (err) {
    bericht.uebersprungen.push([datei, String(err)]);
    continue;
  }

  const pruef = pruefeAufbau(json, bin);
  if (pruef.schonFertig) {
    bericht.schonFertig.push(datei);
    continue;
  }
  if (pruef.fehler.length > 0) {
    bericht.uebersprungen.push([datei, pruef.fehler.join('; ')]);
    continue;
  }

  const { pLaub, pHolz, laubMat, bLaub, bHolz } = pruef;
  const uvLaub = uvLesen(json, bin, pLaub);
  const uvHolz = uvLesen(json, bin, pHolz);
  const gLaub = uvGrenzen(uvLaub);
  const gHolz = uvGrenzen(uvHolz);
  const ersatz = new Map();
  let notiz;

  if (bLaub === bHolz) {
    // ── Fall A: ein gemeinsamer Atlas, nur zwei Materialien ──────────
    if (ueberschneidet(gLaub, gHolz)) {
      bericht.uebersprungen.push([datei, 'Laub- und Rindenfeld überschneiden sich im Atlas']);
      continue;
    }
    const flaeche = await bildLesen(json, bin, bLaub);
    const { geaendert, gesamt } = alphaAuffuellen(flaeche, gHolz);
    ersatz.set(json.images[bLaub].bufferView, await alsPng(flaeche.data, flaeche.w, flaeche.h));
    notiz = `ein Atlas, Alpha aufgefüllt ${((geaendert / gesamt) * 100).toFixed(2)} % des Rindenfelds`;
    if (TEXTUREN && !texturenGeschrieben.has(json.images[bLaub].name)) {
      texturenGeschrieben.add(json.images[bLaub].name);
      writeFileSync(join(TEXTUREN, `${json.images[bLaub].name}.png`), ersatz.get(json.images[bLaub].bufferView));
    }
  } else {
    // ── Fall B: zwei Bilder, kombinierter Atlas ──────────────────────
    if (gLaub.u0 < 0 || gLaub.u1 > 1 || gLaub.v0 < 0 || gLaub.v1 > 1 ||
        gHolz.u0 < 0 || gHolz.u1 > 1 || gHolz.v0 < 0 || gHolz.v1 > 1) {
      bericht.uebersprungen.push([datei, 'UVs ausserhalb [0,1] — Kachelung, Atlas nicht möglich']);
      continue;
    }
    const fLaub = await bildLesen(json, bin, bLaub);
    const fHolz = await bildLesen(json, bin, bHolz);
    const W = fLaub.w + fHolz.w;
    const H = Math.max(fLaub.h, fHolz.h);
    const atlas = Buffer.alloc(W * H * 4);
    const einsetzen = (q, x0) => {
      for (let y = 0; y < q.h; y++) {
        q.data.copy(atlas, (y * W + x0) * 4, y * q.w * 4, (y + 1) * q.w * 4);
      }
    };
    einsetzen(fLaub, 0);
    einsetzen(fHolz, fLaub.w);
    const flaeche = { data: atlas, w: W, h: H };
    // Rindenhälfte vollständig auffüllen — dort steht nur Rinde.
    const { geaendert, gesamt } = alphaAuffuellen(flaeche, {
      u0: fLaub.w / W, u1: 1, v0: 0, v1: fHolz.h / H,
    });
    // UVs in ihre Hälfte umrechnen.
    for (let i = 0; i < uvLaub.length; i += 2) {
      uvLaub[i] = (uvLaub[i] * fLaub.w) / W;
      uvLaub[i + 1] = (uvLaub[i + 1] * fLaub.h) / H;
    }
    for (let i = 0; i < uvHolz.length; i += 2) {
      uvHolz[i] = (fLaub.w + uvHolz[i] * fHolz.w) / W;
      uvHolz[i + 1] = (uvHolz[i + 1] * fHolz.h) / H;
    }
    ersatz.set(json.accessors[pLaub.attributes.TEXCOORD_0].bufferView, Buffer.from(uvLaub.buffer));
    ersatz.set(json.accessors[pHolz.attributes.TEXCOORD_0].bufferView, Buffer.from(uvHolz.buffer));
    const png = await alsPng(atlas, W, H);
    ersatz.set(json.images[bLaub].bufferView, png);
    const name = `${json.images[bLaub].name}_atlas`;
    json.images[bLaub].name = name;
    notiz = `Atlas ${W}x${H} aus ${json.images[bHolz].name}, Alpha aufgefüllt ${((geaendert / gesamt) * 100).toFixed(2)} % der Rindenhälfte`;
    if (TEXTUREN && !texturenGeschrieben.has(name)) {
      texturenGeschrieben.add(name);
      writeFileSync(join(TEXTUREN, `${name}.png`), png);
    }
  }

  // Beide Submeshes auf EIN Material — das ist der eigentliche Zweck.
  pHolz.material = laubMat;
  json.materials[laubMat].name = NEUER_NAME;
  json.materials[laubMat].alphaMode = 'MASK';
  json.materials[laubMat].alphaCutoff = json.materials[laubMat].alphaCutoff ?? 0.5;
  json.materials[laubMat].doubleSided = true;
  aufraeumen(json);
  pruefeIndizes(json);

  bericht.zusammengelegt.push([datei, notiz]);
  if (SCHREIBEN) {
    const sicher = join(SICHERUNG, basename(datei));
    if (!existsSync(sicher)) copyFileSync(pfad, sicher);
    glbSchreiben(pfad, json, bin, ersatz);
  }
}

// ── Bericht ──────────────────────────────────────────────────────────
console.log(`${SCHREIBEN ? 'GESCHRIEBEN' : 'NUR GEPRÜFT (--schreiben fehlt)'} — ${MODELLE}\n`);
console.log(`zusammengelegt: ${bericht.zusammengelegt.length}`);
for (const [d, n] of bericht.zusammengelegt) console.log(`  ${d.replace('.glb', '').padEnd(18)} ${n}`);
if (bericht.schonFertig.length) {
  console.log(`\nschon zusammengelegt: ${bericht.schonFertig.length}`);
}
console.log(`\nübersprungen: ${bericht.uebersprungen.length}`);
const gruende = new Map();
for (const [d, g] of bericht.uebersprungen) {
  if (!gruende.has(g)) gruende.set(g, []);
  gruende.get(g).push(d.replace('.glb', ''));
}
for (const [g, ds] of gruende) {
  console.log(`  ${g} (${ds.length}): ${ds.slice(0, 6).join(', ')}${ds.length > 6 ? ' …' : ''}`);
}
if (SCHREIBEN) console.log(`\nSicherung der Originale: ${SICHERUNG}`);
if (TEXTUREN) console.log(`Texturen geschrieben nach ${TEXTUREN}: ${[...texturenGeschrieben].join(', ')}`);
