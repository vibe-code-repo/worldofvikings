#!/usr/bin/env node
/**
 * Store-Vegetation aufbereiten: Materialien zusammenlegen, Laub tönen,
 * verlorene Materialzuweisungen aus der Geometrie zurückgewinnen.
 *
 * Liest `assets/store/vegetation/*.glb` (NUR lesend — der Store liegt
 * ausserhalb des Repos und wird nie beschrieben) und schreibt die
 * aufbereiteten Modelle nach `assets/store-lab/vegetation/`. Der Ordner
 * ist erzeugt und steht in `.gitignore`; der Name sagt am Pfad, was die
 * Datei ist.
 *
 *   node tools/store-vegetation-aufbereiten.mjs
 *   node tools/store-vegetation-aufbereiten.mjs --nur-pruefen
 *
 * ── Was gemessen wurde, bevor irgendetwas gesetzt wurde ──────────────
 * Die zwölf Atlanten unter `assets/store/vegetation/textures/`, jeweils
 * der Mittelwert über die DECKENDEN Texel (Alpha >= 128), in sRGB
 * normiert:
 *
 *   Laub      bush-1a2-small-1-dark-…  0.452 / 0.452 / 0.452   GRAU
 *   Nadel 1   pine-1b1-0-1-…           0.581 / 0.581 / 0.581   GRAU
 *   Nadel 2   pine-1b1-1-…             0.462 / 0.462 / 0.462   GRAU
 *   Ahorn     tree-1e1-1-…             0.647 / 0.646 / 0.647   GRAU
 *   Gras      grass-short-clump-1-…    0.342 / 0.420 / 0.214   farbig
 *   Gras rb   …-redblue-…              0.350 / 0.447 / 0.186   farbig
 *   Gras gelb …-yellow-…               0.415 / 0.444 / 0.376   fast grau
 *   Gras Schnee …-snow-…               0.707 / 0.708 / 0.704   GRAU, hell
 *   Rinde Eiche massive-tree-1a1-1-…   0.446 / 0.385 / 0.314   braun
 *   Rinde Nadel pine-1b1-0-…           0.313 / 0.263 / 0.236   braun
 *   Rinde Birke tree-1a3-0-…           0.632 / 0.616 / 0.560   beige
 *   Pilz      sm-plant-mushrooms-02-…  0.334 / 0.292 / 0.235   braun
 *
 * Das bestätigt den Befund aus dem Schwesterprojekt, aber genauer als
 * erwartet: Die LAUB- und NADEL-Atlanten sind Helligkeitsmasken (R = G =
 * B auf die dritte Stelle), die RINDEN- und GRAS-Atlanten dagegen sind
 * farbig. Rinde braucht also keine Tönung, Laub braucht sie zwingend.
 *
 * ── Und der zweite, wichtigere Befund ────────────────────────────────
 * Der Farbton fehlt NICHT überall. Der Store-Export trägt für 29 der 33
 * Laubmaterial-Slots einen `baseColorFactor` — Werte, die messbar
 * hinkommen (Laub 0.46/0.95/0.20 ergibt mit dem Atlas sRGB 0.31/0.43/0.21,
 * ein glaubhaftes Blattgrün). Sie stammen aus dem Original-Material und
 * werden hier deshalb NICHT überschrieben, sondern übernommen.
 *
 * Er fehlt genau dort, wo es am meisten weh tut: In 33 Primitiven zeigt
 * das Material auf `DefaultMaterial` — kein Bild, keine Tönung, kein
 * Alphatest. Das sind die Kronen und Stämme der GRÖSSTEN Bäume
 * (massive-tree, split-tree, branched-tree) und die Stämme von 16
 * abgestorbenen Varianten. Sie rendern heute als weisse, undurchsichtige
 * Rechtecke.
 *
 * ── Wie die verlorene Zuweisung zurückgeholt wird ────────────────────
 * Nicht aus einer Artentabelle — die wäre eine zweite Wahrheit neben der
 * Geometrie und liefe beim nächsten Store-Import still auseinander.
 * Sondern aus dem Bestand selbst, in zwei Schritten:
 *
 *  1. FINGERABDRUCK. Über ALLE 94 Modelle hinweg wird je Primitiv der
 *     SHA1 seiner POSITION-Bytes gebildet. Dieselbe Geometrie kommt in
 *     mehreren Dateien vor (`massive-tree-1a1.glb` und
 *     `massive-tree-1a1-1-dark.glb` teilen sich Stamm UND Krone), und in
 *     einer davon trägt sie oft ein richtiges Material. 19 der 33
 *     DefaultMaterial-Primitive finden so ihren Zwilling — allesamt
 *     Stämme, allesamt `Trunks` oder `Oak_Bark_A 2 Dark`.
 *
 *  2. BAUART. Für die restlichen 14 gibt es keinen Zwilling. Sie werden
 *     an einer Kennzahl unterschieden, die im Bestand trennscharf ist:
 *     VERTICES JE DREIECK. Laubkarten sind unverschweisste Vierecke —
 *     4 Vertices auf 2 Dreiecke, also exakt 2,000. Gemessen über alle
 *     Primitive mit bekanntem Material:
 *
 *         Laub-/Gras-/Nadelkarten   2,000 ohne Ausnahme (n = 68)
 *         Rinde und Stamm           0,65 … 1,85 (n = 108)
 *
 *     12 der 14 liegen bei exakt 2,000 → Krone. Zwei liegen bei 0,964
 *     (`branched-tree-2a1/2a3`, Prim 0) → Stamm.
 *
 * Krone bekommt den Laub-Atlas samt Tönung, Stamm den Eichenrinden-Atlas
 * (den ihre Geschwister massive-tree/split-tree tragen — dieselbe
 * Baumfamilie, derselbe Export).
 *
 * ── Warum Rinde und Laub NICHT in EIN Material gehen ─────────────────
 * `tools/baum-material-zusammenlegen.mjs` kann das für die eigenen Bäume,
 * weil deren UVs im Einheitsquadrat liegen: Man legt zwei Bilder
 * nebeneinander und rechnet die UVs in ihre Hälfte um. Die Store-Modelle
 * KACHELN — die Rinden-UVs laufen von -9,6 bis 8,5 in u und bis 26,4 in
 * v. Ein Atlas mit Wiederholung ist keine Halbierung, sondern eine
 * Unmöglichkeit: Bei u = 3,7 holt der Sampler in einem Atlas die
 * Nachbarhälfte statt der eigenen Kachel.
 *
 * Ohne Blender (UV-Neuwicklung) bleibt es deshalb bei einem Material JE
 * ATLAS. Zusammengelegt wird alles, was sich Bild, Alphamodus, Cutoff,
 * Zweiseitigkeit UND Tönung teilt — nach der Tönung sind das alle
 * Laubmaterialien eines Modells (sie hängen ohnehin am selben Bild und
 * unterschieden sich nur im Namen und in der dritten Nachkommastelle der
 * Tönung). Was bleibt, steht in BERICHT.json: `materialienNachher`.
 *
 * ── Der Binärteil wird nicht angefasst ───────────────────────────────
 * Alle 117 Bilder des Bestands liegen als externe `uri` neben den GLBs,
 * kein einziges als bufferView. Ein Material zu tönen oder ihm ein Bild
 * zu geben ist damit eine reine JSON-Änderung; der BIN-Block wird Byte
 * für Byte übernommen. Das hat zwei Folgen, die beide gewollt sind:
 * Geometrie, Hüllboxen und die `bounds` aus `prefabs.json` bleiben
 * gültig, und der zweite Lauf ist byteidentisch (der Test dazu:
 * `tools/test/store-vegetation.ts`).
 *
 * Ausdrücklich NICHT angefasst, weil es an anderer Stelle schon
 * beantwortet ist (Messprobe Bauer D, `design/store-konventionen.md`):
 * Knotentransformationen (`__root__` trägt die Händigkeitsumrechnung, der
 * Client rechnet sie in `zuMaster()` heraus — eine zweite Spiegelung hier
 * wäre eine doppelte), der Ursprung (257 Modelle reichen unter y = 0, das
 * sind Wurzelanläufe und Absicht) und die Kollision (die kommt nicht aus
 * der GLB, sondern aus `collision.box` in `prefabs.json`).
 *
 * ── Warum die Bilder KOPIERT und nicht verlinkt oder eingebettet werden
 * Die GLBs nennen ihre Texturen relativ (`textures/<name>.png`), und
 * Babylon löst das gegen die rootUrl des Ladeaufrufs auf — also gegen
 * `assets/store-lab/vegetation/`. Ein 404 dort ist kein sichtbarer
 * Fehler: Der Container fällt aus, `instantiate()` liefert stumm `null`.
 * Drei Wege führen daran vorbei, und die Wahl ist begründet:
 *
 *   EINBETTEN   hiesse, den BIN-Block neu zu packen — und damit die
 *               Zusage aufzugeben, dass die Geometrie Byte für Byte
 *               dieselbe bleibt. Ausserdem läge der Laub-Atlas dann 30-mal
 *               in 30 Dateien statt einmal; aus 53 MB würden ~250 MB, und
 *               der Browser lüde dieselbe Textur 30-mal statt sie im
 *               Cache zu finden.
 *   SYMLINK     hält den Ordner klein, aber er ist dann keine
 *               eigenständige Auslieferung mehr: Wer `store-lab/`
 *               kopiert, kopiert einen toten Zeiger, und der Fehler
 *               zeigt sich erst im Browser als stummer Ausfall.
 *   KOPIEREN    zwölf Dateien, 7,2 MB, in Millisekunden geschrieben. Der
 *               Ordner steht für sich, und der Prüfer
 *               (`tools/test/store-vegetation.ts`) kann für JEDES
 *               Material nachsehen, ob sein Bild wirklich daneben liegt.
 *
 * Kopiert wird deshalb, und geprüft wird es auch.
 *
 * ── Wind ─────────────────────────────────────────────────────────────
 * Der Wind hängt am MATERIAL, und `AssetManager.fixupMaterial` hängt ihn
 * an, sobald das Material `alphaMode: MASK` deklariert und der
 * Prefabname nicht nach Bauteil aussieht (`swaysInWind`). Alle
 * `vegetation-*`-Namen kommen durch. Es schwingt also nach dieser
 * Aufbereitung jedes LAUB-, NADEL- und GRAS-Material — und die 14
 * reparierten Kronen schwingen erstmals überhaupt, weil sie vorher
 * OPAQUE waren. Rinde bleibt bewusst still: Ihr Atlas ist voll deckend,
 * fällt durch den Cutout-Test und bekommt keinen Sway.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const QUELLE_STANDARD = 'assets/store/vegetation';
const ZIEL_STANDARD = 'assets/store-lab/vegetation';

const QUELLE = resolve(WURZEL, arg('quelle', QUELLE_STANDARD));
const ZIEL = resolve(WURZEL, arg('ziel', ZIEL_STANDARD));
const NUR_PRUEFEN = flag('nur-pruefen');

// ── Die Bilder, benannt ──────────────────────────────────────────────
//
// Der Store benennt seine Texturen nach dem Modell, in dem sie ZUERST
// vorkamen, plus Inhaltskürzel — `bush-1a2-small-1-dark-0-46087926.png`
// ist der Laub-Atlas ALLER Laubbäume, nicht der eines Busches. Diese
// Zuordnung steht hier einmal, damit der Rest des Werkzeugs über Rollen
// reden kann statt über Dateinamen.
const BILD = {
  laub: 'textures/bush-1a2-small-1-dark-0-46087926.png',
  rindeEiche: 'textures/massive-tree-1a1-1-dark-0-755765f4.png',
  rindeNadel: 'textures/pine-1b1-0-8c80d300.png',
  rindeBirke: 'textures/tree-1a3-0-c6f2bd38.png',
};

/**
 * Die Tönung je Rolle — und die Begründung als Zahl daneben.
 *
 * `wirkung` ist die gemessene Atlasfarbe MAL dem Faktor, in sRGB
 * zurückgerechnet: das, was am Ende auf dem Schirm steht. Sie ist
 * Dokumentation, keine Eingabe; `tools/test/store-vegetation.ts` rechnet
 * sie nach, damit sie nicht still veraltet.
 *
 * Übernommen statt neu erfunden wird überall dort, wo der Store selbst
 * einen Faktor mitbringt: Diese Werte stammen aus dem Original-Material,
 * und die Nachrechnung gibt ihnen recht. Neu gesetzt wird nur, wo gar
 * nichts stand.
 */
const TOENUNG = {
  // Blattgrün. Der Store-Wert, in 21 Materialien der häufigste.
  //   Atlas 0.452 grau → sRGB 0.31 / 0.43 / 0.21
  laub: [0.46, 0.95, 0.2, 1],
  // Dieselbe Karte im Schatten — der Store-Wert der `… Dark`-Materialien.
  //   Atlas 0.452 grau → sRGB 0.30 / 0.40 / 0.20
  laubDunkel: [0.4, 0.78, 0.18, 1],
  // Schnee: so hell wie glTF es zulässt (Faktoren sind auf 1 gedeckelt),
  // mit einem kühlen Stich. Mehr als 0.45 sRGB gibt der graue Laub-Atlas
  // nicht her — ein wirklich weisser Winterbusch bräuchte eine eigene
  // Textur. Steht als offener Punkt im Bericht.
  laubSchnee: [0.94, 0.97, 1.0, 1],
  // Nadeln, Store-Wert.  Atlas 0.581 → sRGB 0.31 / 0.45 / 0.30
  nadeln: [0.26, 0.58, 0.24, 1],
  // Ahorn, Store-Wert.   Atlas 0.647 → sRGB 0.52 / 0.64 / 0.30
  ahorn: [0.62, 1.0, 0.2, 1],
  // Gras, Store-Wert (der Atlas ist bereits farbig).
  gras: [0.85, 1.0, 0.6, 1],
  // Herbstgras: Der `-yellow`-Atlas ist mit 0.415/0.444/0.376 fast grau
  // und trug KEINEN Faktor — ohne Tönung ist er ein schmutziger Fleck.
  //   → sRGB 0.41 / 0.41 / 0.26, Strohfarbe.
  grasGelb: [1.0, 0.86, 0.45, 1],
};

/**
 * Rollen, die aus freigestellten KARTEN bestehen.
 *
 * Sie brauchen `alphaMode: MASK` und `doubleSided` — und bekommen genau
 * deshalb im Client den Wind (siehe Kopfkommentar). Alles andere
 * (Rinde, Pilzhut) ist ein Körper mit deckender Textur.
 *
 * `grasBunt` und `grasSchnee` stehen hier mit drin, obwohl sie keine
 * Tönung bekommen: Karte sein und getönt werden sind zwei verschiedene
 * Fragen. Ihre Atlanten sind bereits farbig beziehungsweise absichtlich
 * hell — ein Faktor könnte darauf nur DÄMPFEN (glTF deckelt ihn auf 1),
 * und gedämpfter Schnee ist kein Gewinn, sondern Matsch.
 */
const KARTEN_ROLLEN = new Set([
  'laub',
  'laubDunkel',
  'laubSchnee',
  'nadeln',
  'ahorn',
  'gras',
  'grasGelb',
  'grasBunt',
  'grasSchnee',
]);

// ── GLB lesen und schreiben ──────────────────────────────────────────

function glbLesen(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${pfad}: kein GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

/**
 * GLB schreiben, Binärteil unverändert.
 *
 * Anders als in `baum-material-zusammenlegen.mjs` werden hier KEINE
 * bufferViews neu gepackt — dieses Werkzeug ändert ausschliesslich den
 * JSON-Teil. Der BIN-Block geht Byte für Byte durch, samt seiner
 * Ausrichtung; nur die JSON-Länge und damit der Dateikopf ändern sich.
 */
function glbSchreiben(pfad, json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = binPad > 0 ? Buffer.concat([bin, Buffer.alloc(binPad)]) : Buffer.from(bin);

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

// ── Geometrie befragen ───────────────────────────────────────────────

/** Rohbytes eines Accessors — Grundlage des Fingerabdrucks. */
function accessorBytes(json, bin, index) {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const komponenten = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const breite = acc.componentType === 5123 || acc.componentType === 5122 ? 2 : 4;
  return bin.subarray(start, start + acc.count * komponenten * breite);
}

const fingerabdruck = (json, bin, prim) =>
  createHash('sha1').update(accessorBytes(json, bin, prim.attributes.POSITION)).digest('hex');

const dreiecke = (json, prim) =>
  prim.indices !== undefined
    ? json.accessors[prim.indices].count / 3
    : json.accessors[prim.attributes.POSITION].count / 3;

/**
 * Vertices je Dreieck — die Kennzahl, an der Karte und Körper
 * auseinanderfallen (siehe Kopfkommentar, Schritt 2).
 */
const vertexDichte = (json, prim) =>
  json.accessors[prim.attributes.POSITION].count / dreiecke(json, prim);

/** Hüllbox eines Modells über alle Primitive, aus den Accessor-Grenzen. */
function huellbox(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc.min || !acc.max) continue;
      for (let i = 0; i < 3; i++) {
        if (acc.min[i] < min[i]) min[i] = acc.min[i];
        if (acc.max[i] > max[i]) max[i] = acc.max[i];
      }
    }
  }
  return { min: min.map(runde), max: max.map(runde) };
}

const runde = (x) => Math.round(x * 10000) / 10000;

// ── Rollen ───────────────────────────────────────────────────────────

/**
 * Welche Rolle spielt dieses Material?
 *
 * Gefragt wird die DATEI, nicht eine Namensliste: das Bild, auf das das
 * Material zeigt, und sein Alphamodus. Der Materialname geht nur dort
 * ein, wo die Datei zwei Dinge nicht unterscheiden kann — die drei
 * Grasvarianten hängen an drei verschiedenen Bildern, aber `… Dark` und
 * `… Snow` sind Spielarten desselben Laub-Atlas.
 */
function rolleVonMaterial(json, mat, dateiname) {
  const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
  if (ti === undefined) return null; // DefaultMaterial — wird aus der Geometrie geholt
  return bildRolle(json.images[json.textures[ti].source].uri, mat.name, dateiname);
}

/** Rolle aus einer Bild-URI. Die einzige Stelle, die Dateinamen liest. */
function bildRolle(uri, matName, dateiname) {
  if (uri === BILD.laub) return laubRolle(matName, dateiname);
  if (uri === BILD.rindeEiche || uri === BILD.rindeNadel || uri === BILD.rindeBirke) return 'rinde';
  if (uri.includes('grass-short-clump-snow')) return 'grasSchnee';
  if (uri.includes('grass-short-clump-yellow')) return 'grasGelb';
  if (uri.includes('grass-short-clump-redblue')) return 'grasBunt';
  if (uri.includes('grass-short-clump')) return 'gras';
  if (uri.includes('pine-1b1-0-1') || uri.includes('pine-1b1-1')) return 'nadeln';
  if (uri.includes('tree-1e1-1')) return 'ahorn';
  if (uri.includes('mushrooms')) return 'pilz';
  throw new Error(`${dateiname}: unbekanntes Bild ${uri}`);
}

/**
 * Laub, dunkles Laub oder Schneelaub?
 *
 * Der Dateiname entscheidet mit, und zwar bewusst VOR dem Materialnamen:
 * In `massive-tree-1a1-1-dark.glb` heisst das Kronenmaterial schlicht
 * `DefaultMaterial`, die Variante steckt allein im Dateinamen. Umgekehrt
 * gibt es kein Modell, das eine helle und eine dunkle Krone zugleich
 * trüge — der Dateiname ist also nie zu grob.
 */
function laubRolle(matName, dateiname) {
  if (/-snow(\.|$)/.test(dateiname) || /snow/i.test(matName)) return 'laubSchnee';
  if (/-dark(\.|$)/.test(dateiname) || /dark/i.test(matName)) return 'laubDunkel';
  return 'laub';
}

// ── Hauptlauf ────────────────────────────────────────────────────────

const dateien = readdirSync(QUELLE)
  .filter((d) => d.endsWith('.glb'))
  .sort();
if (dateien.length === 0) throw new Error(`${QUELLE}: keine GLB gefunden`);

/*
  Vorlauf: der Zwillingsindex.

  Er MUSS über alle Dateien laufen, bevor die erste geschrieben wird —
  `massive-tree-1a1.glb` kommt alphabetisch vor `massive-tree-1a1-1-dark.glb`,
  und genau dort steht das Material, das ihm fehlt.
*/
const zwilling = new Map(); // Fingerabdruck → { uri, mat }
const modelle = new Map(); // Dateiname → { json, bin }
for (const datei of dateien) {
  const { json, bin } = glbLesen(join(QUELLE, datei));
  modelle.set(datei, { json, bin });
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const mat = json.materials[prim.material];
      const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
      if (ti === undefined) continue;
      const abdruck = fingerabdruck(json, bin, prim);
      if (!zwilling.has(abdruck)) {
        zwilling.set(abdruck, { uri: json.images[json.textures[ti].source].uri, mat: mat.name });
      }
    }
  }
}

if (!NUR_PRUEFEN) {
  // Der Zielordner wird JEDES MAL neu aufgebaut. Ein Modell, das aus dem
  // Store verschwindet, bliebe sonst als Leiche liegen — und die Leiche
  // hat einen Prefab-Eintrag, also auch einen Streueintrag.
  rmSync(ZIEL, { recursive: true, force: true });
  mkdirSync(join(ZIEL, 'textures'), { recursive: true });
  for (const bild of readdirSync(join(QUELLE, 'textures')).sort()) {
    copyFileSync(join(QUELLE, 'textures', bild), join(ZIEL, 'textures', bild));
  }
}

const bericht = { erzeugtVon: 'tools/store-vegetation-aufbereiten.mjs', modelle: {} };
let ausGeometrie = 0;
let ausZwilling = 0;

for (const datei of dateien) {
  const { json, bin } = modelle.get(datei);
  const vorher = json.materials.map((m) => m.name);

  // ── Schritt 1: jedem Primitiv eine Rolle geben ────────────────────
  const rolleJePrim = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const mat = json.materials[prim.material];
      let rolle = rolleVonMaterial(json, mat, datei);
      let quelle = 'Datei';
      if (rolle === null) {
        const gefunden = zwilling.get(fingerabdruck(json, bin, prim));
        if (gefunden) {
          // Der Zwilling nennt das Bild; die Rolle folgt daraus. Der
          // Materialname kommt MIT, weil `-dark`/`-snow` sonst verloren
          // ginge — der Dateiname des Zwillings ist ein anderer.
          rolle = bildRolle(gefunden.uri, gefunden.mat, datei);
          quelle = `Zwilling (${gefunden.mat})`;
          ausZwilling++;
        } else {
          // Kein Zwilling: die Bauart entscheidet (Vertices je Dreieck).
          const karte = vertexDichte(json, prim) === 2;
          rolle = karte ? laubRolle('', datei) : 'rinde';
          quelle = karte ? 'Bauart: Laubkarte (2,00 V/Dreieck)' : 'Bauart: Körper (< 2,00 V/Dreieck)';
          ausGeometrie++;
        }
      }
      rolleJePrim.push({ prim, rolle, quelle, tris: dreiecke(json, prim) });
    }
  }

  // ── Schritt 2: je Rolle EIN Material bauen ────────────────────────
  //
  // Das ist die Zusammenlegung. Zwei Materialien derselben Rolle hängen
  // per Definition am selben Bild und tragen nach der Tönung denselben
  // Faktor — sie zu trennen kostete einen Thin-Instance-Master und
  // brächte nichts.
  const neueMaterialien = [];
  const indexJeSchluessel = new Map();
  for (const eintrag of rolleJePrim) {
    const altBild = bildDesMaterials(json, json.materials[eintrag.prim.material]);
    const uri = altBild ?? standardBild(eintrag.rolle);
    const schluessel = `${eintrag.rolle}|${uri}`;
    if (!indexJeSchluessel.has(schluessel)) {
      indexJeSchluessel.set(schluessel, neueMaterialien.length);
      neueMaterialien.push(baueMaterial(eintrag.rolle, uri));
    }
    eintrag.neuerIndex = indexJeSchluessel.get(schluessel);
  }

  // ── Schritt 3: Bilder, Texturen, Materialien neu setzen ───────────
  const uris = [...new Set(neueMaterialien.map((m) => m.uri))].sort();
  json.images = uris.map((uri) => ({ uri, name: uri.split('/').pop().replace(/\.png$/, '') }));
  json.textures = uris.map((_, i) => ({ source: i }));
  json.materials = neueMaterialien.map((m) => m.material);
  for (const [i, m] of neueMaterialien.entries()) {
    json.materials[i].pbrMetallicRoughness.baseColorTexture = { index: uris.indexOf(m.uri) };
  }
  for (const eintrag of rolleJePrim) eintrag.prim.material = eintrag.neuerIndex;

  pruefeIndizes(json, datei);

  if (!NUR_PRUEFEN) glbSchreiben(join(ZIEL, datei), json, bin);

  bericht.modelle[datei.replace(/\.glb$/, '')] = {
    materialienVorher: vorher,
    materialienNachher: json.materials.map((m) => m.name),
    masterNachher: json.materials.length,
    dreiecke: rolleJePrim.reduce((s, e) => s + e.tris, 0),
    huellbox: huellbox(json),
    primitive: rolleJePrim.map((e) => ({
      dreiecke: e.tris,
      rolle: e.rolle,
      herkunft: e.quelle,
      toenung: TOENUNG[e.rolle] ?? null,
    })),
  };
}

/** Bild-URI eines Materials, oder null bei DefaultMaterial. */
function bildDesMaterials(json, mat) {
  const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
  return ti === undefined ? null : json.images[json.textures[ti].source].uri;
}

/** Das Bild, das eine Rolle bekommt, wenn das Material keines mitbringt. */
function standardBild(rolle) {
  if (rolle === 'rinde') return BILD.rindeEiche;
  if (rolle.startsWith('laub')) return BILD.laub;
  throw new Error(`Rolle ${rolle} ohne Bild`);
}

/**
 * Ein Material für eine Rolle.
 *
 * `doubleSided` und `alphaMode: MASK` gehören zusammen und sind bei Laub
 * nicht verhandelbar: Eine Blattkarte ohne Alphatest ist ein Rechteck,
 * eine ohne Zweiseitigkeit verschwindet von hinten. Beides ist zugleich
 * die Bedingung, unter der `AssetManager` den Wind anhängt.
 */
function baueMaterial(rolle, uri) {
  const karte = KARTEN_ROLLEN.has(rolle);
  const material = {
    name: materialName(rolle, uri),
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
    doubleSided: karte,
  };
  if (karte) {
    material.alphaMode = 'MASK';
    material.alphaCutoff = 0.5;
  }
  const toenung = TOENUNG[rolle];
  if (toenung) material.pbrMetallicRoughness.baseColorFactor = [...toenung];
  return { material, uri };
}

/**
 * Der Name des zusammengelegten Materials.
 *
 * Rolle plus Atlas, denn `rinde` allein ist nicht eindeutig: 13 Modelle
 * führen ZWEI Rindenatlanten (Eiche für den Hauptstamm, Nadelholz für die
 * abgebrochenen Nebenstämme). Zwei gleichnamige Materialien in einer
 * Datei sind kein Fehler für den Lader, aber sie machen jede Messung am
 * Material unlesbar — und `EntityManager.verschmelzeNachMaterial()`
 * berichtet über Namen.
 *
 * Kein Name enthält „bark": `AssetManager.isFoliageMaterial()` schliesst
 * genau dieses Wort aus, und ein Rindenmaterial, das den Cutout-Test
 * ohnehin nicht besteht, soll nicht zusätzlich am Namen scheitern —
 * sonst hinge die Erklärung an der falschen Stelle.
 */
function materialName(rolle, uri) {
  if (rolle !== 'rinde') return rolle;
  if (uri === BILD.rindeEiche) return 'rinde-eiche';
  if (uri === BILD.rindeNadel) return 'rinde-nadel';
  if (uri === BILD.rindeBirke) return 'rinde-birke';
  throw new Error(`Rinde mit unbekanntem Atlas: ${uri}`);
}

/** Nach dem Umbau muss jeder Index noch auflösen. */
function pruefeIndizes(json, datei) {
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      if (json.materials[prim.material] === undefined) {
        throw new Error(`${datei}: Primitiv zeigt auf Material ${prim.material}`);
      }
    }
  }
  for (const mat of json.materials) {
    const t = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (t === undefined || json.textures[t] === undefined) {
      throw new Error(`${datei}: Material ${mat.name} ohne auflösbare Textur`);
    }
  }
  for (const tex of json.textures) {
    if (json.images[tex.source] === undefined) throw new Error(`${datei}: Textur ohne Bild`);
  }
}

if (!NUR_PRUEFEN) {
  writeFileSync(join(ZIEL, 'BERICHT.json'), `${JSON.stringify(bericht, null, 2)}\n`);
}

// ── Bericht auf der Konsole ──────────────────────────────────────────
const werte = Object.values(bericht.modelle);
const masterVerteilung = new Map();
for (const m of werte) masterVerteilung.set(m.masterNachher, (masterVerteilung.get(m.masterNachher) ?? 0) + 1);
const vorherSumme = werte.reduce((s, m) => s + m.materialienVorher.length, 0);
const nachherSumme = werte.reduce((s, m) => s + m.masterNachher, 0);

console.log(`${NUR_PRUEFEN ? 'NUR GEPRÜFT' : 'GESCHRIEBEN'} — ${dateien.length} Modelle`);
console.log(`  Quelle ${QUELLE}`);
if (!NUR_PRUEFEN) console.log(`  Ziel   ${ZIEL}`);
console.log(`\nMaterialien: ${vorherSumme} vorher → ${nachherSumme} nachher`);
console.log('Master je Modell nachher:');
for (const [n, anzahl] of [...masterVerteilung].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n} Material${n === 1 ? ' ' : 'ien'}: ${anzahl} Modelle`);
}
console.log(`\nMaterial zurückgewonnen: ${ausZwilling} aus dem Zwilling, ${ausGeometrie} aus der Bauart`);
const rollen = new Map();
for (const m of werte) for (const p of m.primitive) rollen.set(p.rolle, (rollen.get(p.rolle) ?? 0) + 1);
console.log('Primitive je Rolle:');
for (const [r, n] of [...rollen].sort()) {
  console.log(`  ${r.padEnd(12)} ${String(n).padStart(3)}  Tönung ${JSON.stringify(TOENUNG[r] ?? null)}`);
}
