#!/usr/bin/env node
// Erzeugt: shared/src/storePrefabs.ts aus assets/store/{manifest,prefabs}.json.
/*
  Die Asset-Brücke: Sie macht aus 670 Dateien unter `assets/store/` etwas,
  das Server UND Client kennen.

  ── Warum ein Generator und keine Handliste ──────────────────────────
  `shared/src/prefabs.ts` ist die WAHRHEIT über das, was es im Spiel gibt
  — der Server öffnet nie eine GLB, er liest diese Tabelle. Der Store
  bringt 569 Prefabs mit; die von Hand einzutragen hiesse, eine
  Maschinenliste abzuschreiben und ab dem ersten neuen Modell falsch zu
  halten. Also wird sie erzeugt.

  ── Was „deterministisch" hier heisst ────────────────────────────────
  Zweiter Lauf = byteidentisch. Kein Zeitstempel, kein Rechnername, keine
  Reihenfolge aus dem Dateisystem: alles ist nach `id` bzw. `name`
  sortiert, Zahlen laufen durch DIESELBE Rundung (`zahl()`). Das ist
  keine Kosmetik — eine erzeugte Datei, die sich bei jedem Lauf ändert,
  macht jeden `git diff` unlesbar, und dann sieht niemand mehr, WAS sich
  geändert hat. `tools/test/store-erzeugung.ts` hält es fest.

  ── Was NICHT hierher gehört ─────────────────────────────────────────
  Die Stellschrauben (Spiegelung, Ordnernamen) und die Typen stehen in
  `shared/src/storeKatalog.ts` — von Hand gepflegt. Stünden sie im Kopf
  der erzeugten Datei, wäre der nächste Lauf ein lautloser Rückbau.

  ── Die Einsortierung steht NICHT hier ───────────────────────────────
  Art, Gruppe und Untergruppe kommen aus `einsortieren()` in
  `client/src/editor/StoreKatalogDaten.ts` — derselben Funktion, mit der
  der Gegenstands-Katalog seine Schubladen baut.

  Bis zur Zusammenführung stand die Regel zweimal da, einmal hier und
  einmal dort, und die beiden waren AUSEINANDER: 477 der 670 Einträge
  landeten in verschiedenen Fächern („Fels" gegen „Felsen", „Fass" gegen
  „Fässer", der Ton als eine Schublade gegen den Ton in vieren). Keine
  der beiden war falsch — sie waren nur nicht dieselbe, und beim Lesen
  fällt das nirgends auf: Jede für sich sieht vollständig aus.

  Genommen wurde die Fassung des Katalogs, weil sie die feinere ist (der
  Ton bekommt seine drei Ebenen statt „Ton/Ton", die Höhenfelder ihre
  Fächer) und weil sie die ist, die ein Mensch zu sehen bekommt. Dass die
  Regel im Client-Ordner liegt und ein Werkzeug sie holt, ist kein
  Bruch der Schichtung, sondern derselbe Griff, den
  `tools/manifest-zuordnung.ts` schon tut: Werkzeuge dürfen den Client
  lesen, der Client nie ein Werkzeug.

  Nur die KENNZEICHEN bleiben hier (`kennzeichenVon`). Der Katalog
  beschriftet damit Knöpfe („Schnee", „Dunkel"), die erzeugte Datei
  führt sie als Daten (`snow`, `dark`, `lod`, `kollision`) — zwei
  Aufgaben, zwei Vokabulare, und `art: 'kollision'` hängt an diesem hier.

  DESHALB `tsx` UND NICHT `node`: Die Regel ist TypeScript.

  Aufruf:
    npx tsx tools/store-prefabs.mjs            (schreibt shared/src/storePrefabs.ts)
    npx tsx tools/store-prefabs.mjs --pruefen  (schreibt nichts, Code 1 bei Abweichung)

  Ohne `assets/store/` bricht der Lauf mit Code 2 ab und sagt, warum —
  der Ordner liegt ausserhalb des Repos (Symlink auf den Asset-Speicher).

  Generates shared/src/storePrefabs.ts from the asset store manifest.
*/
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { einsortieren } from '../client/src/editor/StoreKatalogDaten.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const STORE = join(WURZEL, 'assets/store');
const STORE_LAB = join(WURZEL, 'assets/store-lab');
/*
  ZWEI Ziele, und der Schnitt dazwischen ist kein Ordnungssinn.

  `storePrefabs.ts` traegt, was SERVER UND SPIEL brauchen: die 569
  PrefabDefs, ihre Namen fuer `EIGENE_MODELLE`, die Streusperre. Es haengt
  am Barrel (`shared/src/index.ts`) und damit im Spiel-Bundle.

  `storeKatalogDaten.ts` traegt den KATALOG — 670 Eintraege mit Lizenz,
  Kennzeichen, Huellbox und Kollisionsart. Den liest nur der Editor.
  Solange beides in EINER Datei stand, lud jeder Spieler die 670
  Katalogzeilen mit: Rollup kann aus einem Modul nichts wegwerfen, das
  ueber `export *` erreichbar ist und dessen Nachbar gebraucht wird.
  Gemessen am 08.09.2026 vor dem Schnitt: 670-mal `lizenzstatus` im
  ausgelieferten Spiel-Chunk, 682 KB roh / 118 KB gzip.

  Deshalb steht `storeKatalogDaten.ts` NICHT im Barrel — genauso wenig
  wie `featurePieces.ts`, und aus demselben Grund (siehe Kopf von
  `shared/src/index.ts`). Wer den Katalog will, nennt seinen Pfad.
*/
const ZIEL_PREFABS = join(WURZEL, 'shared/src/storePrefabs.ts');
const ZIEL_KATALOG = join(WURZEL, 'shared/src/storeKatalogDaten.ts');
const DATEI_PREFABS = 'storePrefabs.ts';
const DATEI_KATALOG = 'storeKatalogDaten.ts';

// ── Hilfen ────────────────────────────────────────────────────────────

/**
 * EINE Rundung für alle Zahlen der erzeugten Datei.
 *
 * Vier Nachkommastellen, weil das Store-Manifest seine Hüllboxen genau
 * so führt — mehr wäre erfunden. Wichtig ist nicht die Stellenzahl,
 * sondern dass JEDE Zahl durch dieselbe Funktion läuft: `0.30000000000000004`
 * an einer Stelle und `0.3` an der nächsten wäre ein Unterschied, den
 * niemand beabsichtigt hat.
 */
function zahl(v) {
  const gerundet = Math.round(v * 1e4) / 1e4;
  // -0 gibt es in JSON, aber nicht in einem lesbaren Quelltext.
  return Object.is(gerundet, -0) ? 0 : gerundet;
}

function tsText(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `environment/sm-prop-barrel-03.glb` → `environment/sm-prop-barrel-03` */
function ohneEndung(pfad) {
  return pfad.replace(/\.[^./]+$/, '');
}

/**
 * Die Kennzeichen einer Variante — was dieses Modell von der Grundform
 * unterscheidet.
 *
 * Sie stehen im Dateinamen und sonst nirgends: `-snow` (Winterfassung),
 * `-dark` (dunkleres Laub), `-lod-N` (gröbere Fernstufe),
 * `-collision` (reines Kollisionsnetz ohne Bild). Ohne dieses Feld
 * unterscheidet sich `bush-1a2-small-1-snow` von `bush-1a2-small` nur
 * durch sechs Zeichen im Namen — und eine Streuung, die zufällig die
 * Winterfassung erwischt, sieht wie ein Fehler in der Jahreszeit aus.
 */
function kennzeichenVon(stamm) {
  const aus = [];
  if (/(^|-)snow($|-)/.test(stamm)) aus.push('snow');
  if (/(^|-)dark($|-)/.test(stamm)) aus.push('dark');
  if (/(^|-)lod(-\d+)?($|-)/.test(stamm)) aus.push('lod');
  if (KOLLISIONSNAME.test(stamm)) aus.push('kollision');
  return aus;
}

/**
 * Woran man eine Kollisionsdatei erkennt — der Dateiname, und sonst
 * nichts.
 *
 * Bauer Ds Messprobe (08.09.2026) hat alle 581 Store-GLBs geöffnet und
 * darin KEINEN einzigen `_col`-Knoten gefunden. Die `_col`-Konvention
 * des Altbestands (`AssetManager.NUR_KOLLISION_NAME`) greift hier also
 * nicht: Kollisionsgeometrie ist im Speicher immer eine eigene Datei.
 * Das Muster ist absichtlich weiter als der heutige Bestand (`-col`,
 * `_collision`, …) — es kostet nichts und fängt die nächste Schreibweise.
 */
const KOLLISIONSNAME = /(^|[-_])col(lision)?([-_.]|$)/i;

/** `…-collision.glb` → `…` (der Modellstamm, den die Datei beschreibt). */
function modellStammZuKollision(stamm) {
  return stamm.replace(/[-_]col(lision)?$/i, '');
}

// ── Einlesen ──────────────────────────────────────────────────────────

function lies(pfad) {
  return JSON.parse(readFileSync(pfad, 'utf8'));
}

if (!existsSync(STORE)) {
  console.error(
    `assets/store fehlt (${STORE}) — der Asset-Speicher liegt ausserhalb des Repos.\n` +
      'Anlegen mit:  ln -s /home/mike/wov-assets/store assets/store'
  );
  process.exit(2);
}

const manifest = lies(join(STORE, 'manifest.json'));
const prefabQuelle = lies(join(STORE, 'prefabs.json'));

/*
  NUR was wirklich auf der Platte liegt.

  Das Manifest führt 1255 Einträge, von denen 585 auf `placeholders/…`
  zeigen — Platzhalter des anderen Projekts, die es hier nie gab. Ein
  Prefab, dessen GLB fehlt, wäre im Client ein 404 und im Spawn-Editor
  eine tote Zeile; beides fällt erst auf, wenn jemand es anklickt.
*/
const vorhanden = manifest.assets.filter((a) => existsSync(join(STORE, a.path)));
const manifestNachPfad = new Map(vorhanden.map((a) => [a.path, a]));

/**
 * Der Modellpfad, den `PrefabDef.model` trägt.
 *
 * Vegetation darf aus `assets/store-lab/` kommen — dort legt Bauer B die
 * abgeleiteten Fassungen ab (zusammengelegte Materialien, getöntes Laub).
 * Gefragt wird die PLATTE und nicht eine Liste: Was dort liegt, gewinnt.
 * Damit wächst der Katalog mit Bs Arbeit mit, ohne dass jemand zwei
 * Dateien gleichzeitig ändern muss.
 */
function modellPfad(assetPfad) {
  const stamm = ohneEndung(assetPfad);
  if (assetPfad.startsWith('vegetation/')) {
    const abgeleitet = join(STORE_LAB, `${stamm}.glb`);
    if (existsSync(abgeleitet)) return `store-lab/${stamm}`;
  }
  return `store/${stamm}`;
}

/**
 * Die nachgemessene Hüllbox der aufbereiteten Vegetation.
 *
 * `prefabs.json` beschreibt den STORE. Seit `store-vegetation-aufbereiten.mjs`
 * die verschachtelten LOD-Schalen abträgt, ist die aufbereitete Datei
 * nicht mehr dieselbe Geometrie — bei neun Modellen wandert die Hüllbox.
 * Meist um Millimeter (die Fernstufe reicht ein paar Zehntel tiefer),
 * beim Grasbüschel um sechs Zentimeter in z, weil dessen Fernstufe
 * tatsächlich WEITER reicht als die Nahstufe.
 *
 * Wo eine aufbereitete Datei existiert, gilt deshalb ihre eigene
 * Nachmessung aus BERICHT.json und nicht mehr `bounds`. Für alles andere
 * (Umgebung, Requisiten, Gelände) bleibt `prefabs.json` die Quelle — dort
 * wird nichts abgetragen, und die Messprobe hat die Werte auf allen 581
 * Dateien bitgenau bestätigt (`design/store-konventionen.md` §3.4).
 *
 * Fehlt der Bericht, wird NICHT geraten: dann gilt `bounds`, und der Lauf
 * sagt es auf der Konsole. Ein stiller Rückfall auf die alte Zahl wäre
 * ein Platzhalterkasten, der neben seinem Modell steht.
 */
const BERICHT_PFAD = join(STORE_LAB, 'vegetation', 'BERICHT.json');
const aufbereiteteHuellen = existsSync(BERICHT_PFAD)
  ? new Map(
      Object.entries(lies(BERICHT_PFAD).modelle).map(([n, m]) => [`vegetation/${n}`, m.huellbox])
    )
  : new Map();

/** Breite und Höhe für `renderScale`, aus der Quelle, die für dieses Modell gilt. */
function masse(assetPfad, bounds) {
  const eigen = aufbereiteteHuellen.get(ohneEndung(assetPfad));
  const b = eigen ?? bounds;
  return {
    breite: Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]),
    hoehe: b.max[1] - b.min[1],
    aus: eigen ? 'store-lab' : 'prefabs.json',
  };
}

// ── Prefab-Definitionen ───────────────────────────────────────────────

const defs = [];
const katalog = [];
const fehlend = [];
let ausStoreLab = 0;

const prefabNachAsset = new Map();
for (const p of prefabQuelle.prefabs) {
  if (!manifestNachPfad.has(p.asset)) {
    fehlend.push(`${p.id} → ${p.asset}`);
    continue;
  }
  prefabNachAsset.set(p.asset, p);
}

for (const p of [...prefabNachAsset.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  // Die Masse kommen aus derselben Datei, die auch geladen wird — s.
  // `masse()`: aufbereitete Vegetation misst sich selbst, alles andere
  // steht in `prefabs.json`.
  const { breite, hoehe, aus } = masse(p.asset, p.bounds);
  if (aus === 'store-lab') ausStoreLab++;
  defs.push({
    name: p.id,
    // renderScale ist der PLATZHALTERKASTEN, den der Client zeigt, bis
    // die GLB da ist — nicht die Grösse des Modells. Er muss trotzdem
    // stimmen, sonst springt beim Nachladen die halbe Szene.
    w: zahl(Math.max(0.1, breite)),
    h: zahl(Math.max(0.1, hoehe)),
    model: modellPfad(p.asset),
  });
}

// ── Katalog ───────────────────────────────────────────────────────────

const prefabNachAssetId = new Map();
for (const p of prefabQuelle.prefabs) prefabNachAssetId.set(p.asset, p);

for (const a of vorhanden) {
  const p = prefabNachAssetId.get(a.path);
  /*
    Die EINE Einsortierregel — sie steht im Katalog des Editors, nicht
    hier (siehe Kopf). Sie bekommt genau, was sie liest: Pfad, Sorte aus
    dem Manifest und, falls es dazu ein Prefab gibt, dessen `category`.
  */
  const ordnung = einsortieren({
    id: a.id,
    path: a.path,
    kind: a.kind,
    category: p?.category ?? null,
  });
  const gruppe = ordnung.gruppe;
  const untergruppe = ordnung.untergruppe;
  const kennzeichen = kennzeichenVon(ohneEndung(a.path.split('/').pop() ?? a.path));
  /*
    `art` ist NICHT `kind` aus dem Manifest. Das Manifest sagt, was die
    Datei technisch ist (mesh, prefab, texture, audio, terrain); der
    Katalog sagt, wie man damit umgeht — und da fallen Kulisse und
    Höhenfeld aus `modell` heraus, weil man sie nicht streuen darf.

    Die Regel liefert dafür `art` als Beschriftung („Modelle",
    „Texturen", …); die erzeugte Datei führt sie als Kennung, und sie
    kennt eine Stufe mehr: `kollision`. Ein Kollisionsnetz ist im
    Katalog ein Modell mit eigenem Fach — für den Server ist es etwas,
    das man NIE setzt. Deshalb bleibt diese eine Zeile hier.
  */
  const ART_KENNUNG = {
    Modelle: 'modell',
    Texturen: 'textur',
    Ton: 'ton',
    Höhenfelder: 'terrain',
    Kulisse: 'kulisse',
  };
  const art = kennzeichen.includes('kollision') ? 'kollision' : ART_KENNUNG[ordnung.art];
  if (art === undefined) throw new Error(`${a.path}: unbekannte Art ${ordnung.art}`);

  /*
    Ein Ursprung tief unter dem Modell ist kein Fehler — die Quelle hält
    den Szenenursprung fest, und 335 der 569 Prefabs reichen unter y=0
    (Pfosten, Wurzeln, Fundamente). Verschöbe man sie auf min y = 0,
    stünde jeder Pfahl auf dem Rasen statt darin.

    Drei Dateien sind trotzdem eine Ansage: `sm-item-horn` (−15,2 m),
    `sm-item-bag-large` (−14,9 m) und `sm-item-shrooms` (−8,8 m). Wer so
    ein Modell setzt, sieht am Setzpunkt NICHTS — es hängt zwei
    Stockwerke tiefer. Das Kennzeichen ist die einzige Warnung, die es
    dafür gibt.
  */
  if (a.bounds && a.bounds.min[1] < -1) kennzeichen.push('ursprung-versetzt');

  let kollision;
  if (p?.collision) {
    kollision = { art: p.collision.kind };
    if (p.collision.box) kollision.box = p.collision.box;
    if (p.collision.asset?.path) kollision.netz = p.collision.asset.path;
  }

  /*
    Die eigene Kollisions-GLB — aus dem DATEINAMEN, nicht aus
    `prefabs.json`. Die Quelle nennt nur drei der zwölf
    `…-collision.glb`; neun weitere beschreiben ein Modell, das gar
    nicht im Store liegt. Über den Namen findet man alle, die man finden
    KANN, und die neun Waisen bleiben stumm liegen statt falsch
    verknüpft.
  */
  const kollisionsDatei =
    art === 'modell' && manifestNachPfad.has(`${ohneEndung(a.path)}-collision.glb`)
      ? `${ohneEndung(a.path)}-collision.glb`
      : undefined;

  katalog.push({
    id: a.id,
    pfad: a.path,
    art,
    gruppe,
    untergruppe,
    kennzeichen,
    bytes: a.bytes,
    hash: a.hash,
    bounds: a.bounds,
    kollision,
    kollisionsDatei,
    /*
      Kulissen (bis 594 m) und Höhenfelder (bis 300 m, mit eigenem
      Gelände) bleiben im Katalog, dürfen aber nicht gesetzt oder
      gestreut werden — Bauer Ds Punkt 5. `platzierbar` sagt das an der
      EINZELNEN Zeile; `STORE_NICHT_STREUEN` sagt dasselbe als Menge,
      für Aufrufer, die keinen Katalogeintrag zur Hand haben.
    */
    platzierbar: art === 'kulisse' || art === 'terrain' ? false : undefined,
    // `visibility`/`redistributable` sagen dasselbe in zwei Feldern; der
    // Katalog führt EINE Antwort. Ein Eintrag, bei dem beide auseinander
    // gehen, wird als `intern` behandelt — im Zweifel nicht nach draussen.
    lizenzstatus: a.visibility === 'public' && a.redistributable === true ? 'frei' : 'intern',
    prefabName: p && manifestNachPfad.has(p.asset) ? p.id : undefined,
  });
}

katalog.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

// ── Schreiben ─────────────────────────────────────────────────────────

function boundsText(b) {
  const m = b.min.map(zahl).join(', ');
  const x = b.max.map(zahl).join(', ');
  return `{ min: [${m}], max: [${x}] }`;
}

function defZeile(d) {
  return `  d(${tsText(d.name)}, ${d.w}, ${d.h}, ${tsText(d.model)}),`;
}

function katalogZeile(e) {
  const t = [`id: ${tsText(e.id)}`, `pfad: ${tsText(e.pfad)}`, `art: ${tsText(e.art)}`];
  t.push(`gruppe: ${tsText(e.gruppe)}`, `untergruppe: ${tsText(e.untergruppe)}`);
  if (e.kennzeichen.length > 0) {
    t.push(`kennzeichen: [${e.kennzeichen.map(tsText).join(', ')}]`);
  }
  t.push(`bytes: ${e.bytes}`, `hash: ${tsText(e.hash)}`);
  if (e.bounds) t.push(`bounds: ${boundsText(e.bounds)}`, `boundsRaum: 'datei'`);
  if (e.kollision) {
    const k = [`art: ${tsText(e.kollision.art)}`];
    if (e.kollision.box) k.push(`box: ${boundsText(e.kollision.box)}`);
    if (e.kollision.netz) k.push(`netz: ${tsText(e.kollision.netz)}`);
    t.push(`kollision: { ${k.join(', ')} }`);
  }
  if (e.kollisionsDatei) t.push(`kollisionsDatei: ${tsText(e.kollisionsDatei)}`);
  if (e.platzierbar === false) t.push('platzierbar: false');
  t.push(`lizenzstatus: ${tsText(e.lizenzstatus)}`);
  if (e.prefabName) t.push(`prefabName: ${tsText(e.prefabName)}`);
  return `  { ${t.join(', ')} },`;
}

const gruppen = [...new Set(katalog.map((e) => e.gruppe))].sort();
const nichtStreuen = defs
  .filter((d) => katalog.find((k) => k.prefabName === d.name)?.platzierbar === false)
  .map((d) => d.name);

const kopf = `/**
 * storePrefabs.ts — ERZEUGT, NICHT VON HAND ÄNDERN.
 *
 *   npx tsx tools/store-prefabs.mjs
 *
 * Quelle: assets/store/manifest.json + assets/store/prefabs.json
 * (der Asset-Speicher liegt ausserhalb des Repos, s. Generatorkopf).
 *
 * Der Lauf ist deterministisch: gleiche Quelle → byteidentische Datei.
 * Es steht deshalb KEIN Zeitstempel und KEINE Zahl aus diesem Rechner
 * darin — ein Generat, das sich bei jedem Lauf ändert, macht den
 * nächsten \`git diff\` unlesbar.
 *
 * Typen, Ordnernamen und der Spiegelungs-Schalter stehen von Hand
 * gepflegt in \`storeKatalog.ts\`; hier sind nur die Daten.
 *
 * ── Was hier NICHT steht: der Katalog ────────────────────────────────
 * \`STORE_KATALOG\` (${katalog.length} Einträge mit Lizenz, Kennzeichen,
 * Hüllbox und Kollisionsart) liegt in \`storeKatalogDaten.ts\`. Diese
 * Datei hier hängt am Barrel und damit im SPIEL-Bundle; der Katalog
 * interessiert nur den Editor. Zusammen in einer Datei lud ihn jeder
 * Spieler mit — Rollup kann aus einem Modul nichts wegwerfen, dessen
 * Nachbar gebraucht wird.
 *
 * Generated store registry — do not edit by hand.
 */
import { PrefabFlag } from './types.js';
import type { PrefabDef } from './prefabs.js';
import type { StorePrefabName } from './storeKatalog.js';
import type { Vector3 } from './types.js';

/**
 * Geteilte Instanz wie in \`prefabs.ts\`: Der Wert ist nirgends
 * veränderlich gemeint, und ${defs.length} eigene Objekte dafür wären
 * ${defs.length} Objekte zu viel.
 */
const EINS: Vector3 = { x: 1, y: 1, z: 1 };

/**
 * PERSISTENT und sonst nichts.
 *
 * Dieselbe Wahl wie \`roomPrefabDef()\` in \`prefabs.ts\` trifft, und aus
 * demselben Grund: Ein von Hand gesetztes Deko-Stück muss den Welt-Save
 * überleben, sonst ist es beim nächsten Start weg. Alle anderen Flags
 * beschreiben VERHALTEN (Tier-KI, Truhe, Feuerstelle, Bauteil) — davon
 * hat ein Fremdmodell keins: Es steht da, und das ist alles.
 */
const STATISCH = PrefabFlag.PERSISTENT;

function d(name: string, w: number, h: number, model: string): PrefabDef {
  return { name, flags: STATISCH, localScale: EINS, sprite: null, renderScale: { w, h }, model };
}

/**
 * Die ${defs.length} setzbaren Store-Prefabs.
 *
 * \`name\` ist die \`id\` aus \`prefabs.json\` — sie enthält Bindestriche und
 * kann deshalb mit keinem Namen des Altbestands kollidieren (der ist
 * durchweg CamelCase).
 */
export const STORE_PREFAB_DEFS: readonly PrefabDef[] = [
`;

const teile = [kopf];
teile.push(defs.map(defZeile).join('\n'));
teile.push(`
];

/** Nur die Namen — für \`EIGENE_MODELLE\` und den Spawn-Editor. */
export const STORE_MODELL_NAMEN: readonly StorePrefabName[] = STORE_PREFAB_DEFS.map((p) => p.name);

/**
 * Was NICHT gestreut werden darf: Kulissen und Höhenfelder.
 *
 * Eine Kulisse ist bis zu 594 m breit, ein Höhenfeld bringt sein eigenes
 * Gelände mit. Beide sind gültige Prefabs und sollen setzbar bleiben —
 * aber eine Streufunktion, die sie zwischen die Fässer mischt, setzt
 * einen halben Kilometer Berg in ein Dorf, und das sieht man erst, wenn
 * man sich umdreht.
 */
export const STORE_NICHT_STREUEN: ReadonlySet<StorePrefabName> = new Set([
${nichtStreuen.map((n) => `  ${tsText(n)},`).join('\n')}
]);

`);

const textPrefabs = teile.join('');

// ── Zweites Erzeugnis: der Katalog, nur für den Editor ────────────────

const katalogTeile = [
  `/**
 * storeKatalogDaten.ts — ERZEUGT, NICHT VON HAND ÄNDERN.
 *
 *   npx tsx tools/store-prefabs.mjs
 *
 * Der vollständige Katalog des Asset-Speichers: JEDE Datei, die unter
 * \\\`assets/store/\\\` wirklich liegt — ${katalog.length} Einträge, auch
 * Texturen, Töne und Kollisionsnetze, zu denen es kein Prefab gibt.
 *
 * ── Warum diese Datei NICHT im Barrel steht ──────────────────────────
 * \\\`shared/src/index.ts\\\` exportiert sie mit Absicht nicht, und das ist
 * dieselbe Entscheidung wie bei \\\`featurePieces.ts\\\` (Begründung dort im
 * Kopf): Ein \\\`export *\\\` von hier zöge diese ${katalog.length} Zeilen
 * über jedes Client-Modul, das aus '@wov/shared' importiert, ins
 * SPIEL-Bundle. Genau das war der Zustand bis zum 08.09.2026 — der
 * ausgelieferte Prefab-Chunk trug ${katalog.length}-mal \\\`lizenzstatus\\\`
 * durch die Leitung jedes Spielers, für einen Katalog, den nur der
 * Editor aufschlägt (682 KB roh, 118 KB gzip).
 *
 * Der Bündler kann daran nichts kürzen: Was über \\\`export *\\\` erreichbar
 * ist und in einem Modul steht, dessen Nachbar gebraucht wird, bleibt
 * drin. Der Schnitt muss deshalb in der DATEIAUFTEILUNG liegen.
 *
 * Wer den Katalog braucht, nennt seinen Pfad:
 *
 *   import { STORE_KATALOG } from '@wov/shared/src/storeKatalogDaten.js';
 *
 * Gruppen in diesem Bestand: ${gruppen.join(', ')}.
 *
 * Generated store catalogue — do not edit by hand, editor-only.
 */
import type { StoreEintrag, StorePrefabName } from './storeKatalog.js';

/** Die ${katalog.length} Einträge, nach \\\`id\\\` sortiert. */
export const STORE_KATALOG: readonly StoreEintrag[] = [
`,
];
katalogTeile.push(katalog.map(katalogZeile).join('\n'));
katalogTeile.push(`
];

/** \\\`id\\\` → Katalogeintrag. */
export const STORE_KATALOG_NACH_ID: ReadonlyMap<string, StoreEintrag> = new Map(
  STORE_KATALOG.map((e) => [e.id, e])
);

/** Prefabname → Katalogeintrag (nur die ${defs.length} setzbaren). */
export const STORE_KATALOG_NACH_PREFAB: ReadonlyMap<StorePrefabName, StoreEintrag> = new Map(
  STORE_KATALOG.filter((e) => e.prefabName !== undefined).map((e) => [e.prefabName as string, e])
);
`);

const textKatalog = katalogTeile.join('');

/*
  BEIDE Erzeugnisse werden geprüft, nicht nur eines.

  Vor dem Schnitt gab es eine Datei und damit auch nur eine Frage. Zwei
  Dateien, von denen der Wächter eine ansieht, wären schlechter als eine:
  Der Katalog könnte veralten, ohne dass irgendwo etwas rot würde — und
  er ist genau der Teil, den kein Testlauf sonst anfasst.
*/
const ERZEUGNISSE = [
  { name: DATEI_PREFABS, ziel: ZIEL_PREFABS, text: textPrefabs },
  { name: DATEI_KATALOG, ziel: ZIEL_KATALOG, text: textKatalog },
];

if (process.argv.includes('--pruefen')) {
  const veraltet = ERZEUGNISSE.filter(
    (e) => (existsSync(e.ziel) ? readFileSync(e.ziel, 'utf8') : '') !== e.text
  );
  if (veraltet.length === 0) {
    console.log(`ok   beide Erzeugnisse sind aktuell (${defs.length} Prefabs, ${katalog.length} Katalogzeilen)`);
    process.exit(0);
  }
  for (const e of veraltet) console.error(`FAIL shared/src/${e.name} weicht ab`);
  console.error('npx tsx tools/store-prefabs.mjs erneut laufen lassen');
  process.exit(1);
}

/*
  `--nach <ordner>` schreibt woandershin.

  Nur für `tools/test/store-erzeugung.ts` da, und der Grund ist eine
  Regel und keine Bequemlichkeit: Ein Test darf keine getrackte
  Quelldatei überschreiben. Täte er es, hinterliesse jeder Lauf eine
  Änderung im Arbeitsbaum — bei Gleichstand unsichtbar, bei Abweichung
  aber genau die Datei zerschossen, deren Abweichung er gerade meldet.
  Mit `--nach` legt er zwei Läufe in einen Temp-Ordner und vergleicht
  dort; das Original fasst er nur lesend an.

  Seit dem Schnitt ist das Argument ein ORDNER und keine Datei mehr —
  es entstehen zwei Erzeugnisse, und beide behalten dort ihren Namen.
*/
const nachIndex = process.argv.indexOf('--nach');
const nachOrdner = nachIndex >= 0 ? resolve(process.argv[nachIndex + 1] ?? '') : null;

for (const e of ERZEUGNISSE) {
  const ziel = nachOrdner === null ? e.ziel : join(nachOrdner, e.name);
  writeFileSync(ziel, e.text, 'utf8');
  console.log(`${ziel} geschrieben`);
}
console.log(
  `${defs.length} Prefabs, ${katalog.length} Katalogzeilen, ` +
    `${nichtStreuen.length} nicht streubar, ${gruppen.length} Gruppen (${gruppen.join(', ')})`
);
console.log(
  aufbereiteteHuellen.size === 0
    ? `Hinweis: ${BERICHT_PFAD} fehlt — renderScale kommt für ALLE Prefabs aus prefabs.json ` +
        '(erst `node tools/store-vegetation-aufbereiten.mjs` laufen lassen)'
    : `renderScale: ${ausStoreLab} Prefabs aus der nachgemessenen Hüllbox von store-lab, ` +
        `${defs.length - ausStoreLab} aus prefabs.json`
);
if (fehlend.length > 0) {
  console.log(`Hinweis: ${fehlend.length} Prefab(s) ohne Datei im Store übersprungen — ${fehlend.join(', ')}`);
}
