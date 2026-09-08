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

  Aufruf:
    node tools/store-prefabs.mjs            (schreibt shared/src/storePrefabs.ts)
    node tools/store-prefabs.mjs --pruefen  (schreibt nichts, Code 1 bei Abweichung)

  Ohne `assets/store/` bricht der Lauf mit Code 2 ab und sagt, warum —
  der Ordner liegt ausserhalb des Repos (Symlink auf den Asset-Speicher).

  Generates shared/src/storePrefabs.ts from the asset store manifest.
*/
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const STORE = join(WURZEL, 'assets/store');
const STORE_LAB = join(WURZEL, 'assets/store-lab');
const ZIEL = join(WURZEL, 'shared/src/storePrefabs.ts');

// ── Übersetzungstabellen ──────────────────────────────────────────────

/*
  Die fünf Schubladen des Fremdbestands. Die Kennung sagt sie selbst:
  `environment-sm-<typ>-<wort>-<nr>`, und `<typ>` ist genau einer davon.

  `generic` und `plant` fehlen hier mit Absicht — es gibt je EIN Modell
  damit (`sm-generic-treedead-01`, `sm-plant-mushrooms-02`), und beide
  sind Vegetation. Sie laufen unten über eine eigene Zeile.
*/
const TYP_GRUPPE = {
  bld: 'Gebäude',
  prop: 'Requisiten',
  item: 'Gegenstände',
  env: 'Umgebung',
  veh: 'Fahrzeuge',
};

/*
  Das Wort NACH dem Typ ist das Fach: `sm-prop-barrel-03` liegt bei den
  Fässern. Übersetzt sind alle 157 vorkommenden Wörter und nicht nur die
  häufigsten — ein Fach namens „trashbag" zwischen „Truhe" und „Tisch"
  sieht aus wie ein Fehler, und wer es sieht, muss jedes Mal neu prüfen,
  ob es einer ist.

  Wörter ohne Eintrag bleiben unverändert stehen (Grossbuchstabe vorn).
  Das ist der vorgesehene Zustand für alles Neue: lesbar genug, um
  nicht zu stören, und auffällig genug, um ergänzt zu werden.
*/
const WORT = {
  alchemy: 'Alchemie',
  animal: 'Tiere',
  anvil: 'Amboss',
  archway: 'Torbogen',
  arrow: 'Pfeil',
  astroid: 'Felsbrocken',
  bag: 'Beutel',
  barrel: 'Fass',
  basket: 'Korb',
  bathtub: 'Wanne',
  bed: 'Bett',
  bell: 'Glocke',
  bellows: 'Blasebalg',
  bench: 'Bank',
  big: 'Grossform',
  billy: 'Kessel',
  boat: 'Boot',
  bone: 'Knochen',
  bonfire: 'Lagerfeuer',
  book: 'Buch',
  bookcase: 'Bücherregal',
  books: 'Bücher',
  bottle: 'Flasche',
  bowl: 'Schale',
  bracelet: 'Armreif',
  bracket: 'Halterung',
  brazier: 'Feuerschale',
  bread: 'Brot',
  brick: 'Ziegel',
  bricks: 'Ziegel',
  bucket: 'Eimer',
  cabinet: 'Schrank',
  camp: 'Lager',
  candle: 'Kerze',
  candlestick: 'Leuchter',
  cart: 'Karren',
  cauldron: 'Kessel',
  chain: 'Kette',
  chair: 'Stuhl',
  chandelier: 'Kronleuchter',
  cheese: 'Käse',
  chest: 'Truhe',
  chestbottom: 'Truhe',
  chesttop: 'Truhe',
  chopping: 'Hackklotz',
  clay: 'Ton',
  cloud: 'Wolke',
  coins: 'Münzen',
  cow: 'Kuh',
  crate: 'Kiste',
  crystal: 'Kristall',
  cup: 'Becher',
  destroyed: 'Ruinenteile',
  dish: 'Teller',
  dock: 'Steg',
  door: 'Tür',
  dresser: 'Kommode',
  dummy: 'Übungspuppe',
  fabric: 'Stoff',
  fence: 'Zaun',
  fireworks: 'Feuerwerk',
  fish: 'Fisch',
  floor: 'Boden',
  forge: 'Schmiede',
  gallows: 'Galgen',
  garlic: 'Knoblauch',
  gem: 'Edelstein',
  glacier: 'Gletscher',
  goblet: 'Kelch',
  goblin: 'Kobold',
  grass: 'Gras',
  grasspatch: 'Grasfleck',
  grate: 'Gitter',
  grinding: 'Schleifstein',
  ground: 'Boden',
  groundmound: 'Erdhügel',
  hammer: 'Hammer',
  hay: 'Heu',
  hook: 'Haken',
  horn: 'Horn',
  horse: 'Pferd',
  horseshoe: 'Hufeisen',
  house: 'Haus',
  iceberg: 'Eisberg',
  icechunk: 'Eisbrocken',
  ingot: 'Barren',
  ink: 'Tinte',
  jar: 'Krug',
  jug: 'Kanne',
  kettle: 'Kessel',
  ladder: 'Leiter',
  leather: 'Leder',
  lock: 'Schloss',
  lockpick: 'Dietrich',
  log: 'Stamm',
  logs: 'Stämme',
  map: 'Karte',
  metal: 'Metall',
  minetrack: 'Grubenbahn',
  mortar: 'Mörser',
  mug: 'Krug',
  mushroom: 'Pilz',
  mushrooms: 'Pilze',
  obelisk: 'Obelisk',
  onion: 'Zwiebel',
  ore: 'Erz',
  parchment: 'Pergament',
  path: 'Weg',
  pillar: 'Säule',
  pillow: 'Kissen',
  plank: 'Brett',
  plant: 'Pflanze',
  planter: 'Pflanzkasten',
  planterbox: 'Pflanzkasten',
  pole: 'Pfahl',
  poster: 'Aushang',
  pot: 'Topf',
  potion: 'Trank',
  preset: 'Bauwerk',
  pumpkin: 'Kürbis',
  quest: 'Auftrag',
  quiver: 'Köcher',
  railing: 'Geländer',
  ring: 'Ring',
  rock: 'Fels',
  roof: 'Dach',
  rope: 'Seil',
  rubble: 'Geröll',
  rug: 'Teppich',
  rune: 'Rune',
  sack: 'Sack',
  shelf: 'Regal',
  shelves: 'Regale',
  shrooms: 'Pilze',
  sign: 'Schild',
  spike: 'Spiess',
  stairs: 'Treppe',
  start: 'Startpunkt',
  statue: 'Statue',
  stirring: 'Rührstab',
  stone: 'Stein',
  stonewall: 'Steinmauer',
  stool: 'Hocker',
  structure: 'Bauwerk',
  table: 'Tisch',
  tiles: 'Fliesen',
  tongs: 'Zange',
  torchstick: 'Fackel',
  trashbag: 'Abfallsack',
  treedead: 'Totholz',
  vase: 'Vase',
  village: 'Dorf',
  wall: 'Mauer',
  wardrobe: 'Kleiderschrank',
  water: 'Wasser',
  weight: 'Gewicht',
  well: 'Brunnen',
  wheat: 'Weizen',
  wheelbarrow: 'Schubkarre',
  wood: 'Holz',
  workbench: 'Werkbank',
};

/*
  Vegetation sortiert sich nicht nach dem Typwort, sondern danach, WAS es
  ist: `massive-tree`, `split-tree` und `branched-tree` sind allesamt
  Laubbäume in verschiedenen Wuchsformen, `pine` die einzige Nadelform.
  Wer nach einem Baum sucht, sucht nach „Baum" und nicht nach „split".
*/
const VEGETATION_FACH = {
  tree: 'Laubbäume',
  massive: 'Laubbäume',
  split: 'Laubbäume',
  branched: 'Laubbäume',
  large: 'Büsche',
  bush: 'Büsche',
  small: 'Büsche',
  pine: 'Nadelbäume',
  grass: 'Gras',
  branch: 'Äste',
  plant: 'Pilze',
  generic: 'Totholz',
};

/** Untergruppen der Tonspur — der zweite Pfadabschnitt sagt sie. */
const TON_FACH = {
  footsteps: 'Schritte',
  animals: 'Tiere',
  ambience: 'Umgebung',
  emitters: 'Quellen',
};

/** Boden-Texturen: das Material im Dateinamen. */
const BODEN_FACH = {
  grass: 'Gras',
  gravel: 'Kies',
  moss: 'Moos',
  rock: 'Fels',
  village: 'Mischkarten',
};

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

/** Erster Buchstabe gross — für Wörter ohne Übersetzung. */
function grossVorn(w) {
  return w.length === 0 ? w : w[0].toUpperCase() + w.slice(1);
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

// ── Einsortierung ─────────────────────────────────────────────────────

/**
 * Wohin gehört diese Datei? — die einzige Stelle, die das entscheidet.
 *
 * Gefragt wird mit Pfad UND (falls vorhanden) Prefab-Kennung, denn beide
 * wissen etwas, was der andere nicht weiss: Der Pfad kennt Texturen und
 * Töne, zu denen es kein Prefab gibt; die Kennung kennt `category`,
 * an der Kulisse und Höhenfeld hängen.
 *
 * Reihenfolge der Regeln ist bedeutsam: Texturen und Töne ZUERST, sonst
 * verschluckt die Vegetationsregel `vegetation/textures/tree-1a3-….png`.
 */
function einsortieren(pfad, kategorie) {
  const teile = pfad.split('/');
  const datei = ohneEndung(teile[teile.length - 1]);
  const kennzeichen = kennzeichenVon(datei);

  // (1) Ton.
  if (teile[0] === 'audio') {
    return { gruppe: 'Ton', untergruppe: TON_FACH[teile[1]] ?? grossVorn(teile[1] ?? ''), kennzeichen };
  }

  // (2) Modell-Texturen — jeder `textures`-Ordner INNERHALB eines
  // Modellordners. Die Schreibweise wechselt (`textures`, `Textures`:
  // das Kenney-Kit bringt seine Ordnerstruktur unverändert mit).
  const texturIndex = teile.findIndex((t) => t.toLowerCase() === 'textures');
  if (texturIndex > 0) {
    return {
      gruppe: 'Modell-Texturen',
      untergruppe: teile[0] === 'vegetation' ? 'Vegetation' : 'Umgebung',
      kennzeichen,
    };
  }

  // (3) Boden-Texturen — der eigene Ordner ganz oben.
  if (teile[0] === 'textures') {
    const wort = datei.replace(/^terrain-/, '').split('-')[0] ?? '';
    return { gruppe: 'Boden-Texturen', untergruppe: BODEN_FACH[wort] ?? grossVorn(wort), kennzeichen };
  }

  // (4) Höhenfelder. Sie bringen ihr eigenes Gelände mit und werden nie
  // gestreut — deshalb eine eigene Gruppe und nicht „Umgebung".
  if (kategorie === 'terrain' || teile[0] === 'terrain') {
    return { gruppe: 'Höhenfelder', untergruppe: 'Gelände', kennzeichen };
  }

  /*
    (5) Kulissen: ~600 m breite Bergsilhouetten, die Himmelskuppel — und
    die drei Wolkenbretter. Die Wolken sind mit 8 m klein genug, um wie
    eine Requisite auszusehen, gehören aber in dieselbe Schublade: Sie
    stehen im Himmel und haben auf dem Boden nichts verloren. Die Quelle
    sagt das selbst (`category: backdrop`), und diese Regel glaubt ihr.
  */
  if (kategorie === 'backdrop') {
    let fach = 'Berge';
    if (datei.startsWith('backdrop-sky')) fach = 'Himmel';
    else if (datei.includes('cloud')) fach = 'Wolken';
    return { gruppe: 'Kulisse', untergruppe: fach, kennzeichen };
  }

  // (6) Vegetation.
  if (teile[0] === 'vegetation') {
    const w = datei.split('-');
    // `sm-plant-mushrooms-02` und `sm-generic-treedead-01` tragen das
    // Kennwort an zweiter Stelle, alle anderen an erster.
    const schluessel = w[0] === 'sm' ? (w[1] ?? '') : (w[0] ?? '');
    return {
      gruppe: 'Vegetation',
      untergruppe: VEGETATION_FACH[schluessel] ?? grossVorn(schluessel),
      kennzeichen,
    };
  }

  // (7) Umgebungsbestand: `sm-<typ>-<wort>-<nr>`.
  const w = datei.split('-');
  if (w[0] === 'sm' && TYP_GRUPPE[w[1]]) {
    const wort = w[2] ?? '';
    return { gruppe: TYP_GRUPPE[w[1]], untergruppe: WORT[wort] ?? grossVorn(wort), kennzeichen };
  }
  // `sm-generic-…` / `sm-plant-…` im Umgebungsordner: Vegetation, die
  // dort einsortiert wurde, wo sie gefunden wurde.
  if (w[0] === 'sm' && VEGETATION_FACH[w[1]]) {
    return { gruppe: 'Vegetation', untergruppe: VEGETATION_FACH[w[1]], kennzeichen };
  }

  /*
    (8) Der Rest des Umgebungsordners — Einzelstücke ohne die
    `sm-`-Namensregel VORN (`floor`, `chesttop`, `start-position`,
    `roof-sm-bld-preset-shelter-02`, das Kenney-Kit).

    Zwei Anläufe, in dieser Reihenfolge:
      • Steht `sm-<typ>` irgendwo IM Namen, ist die Gruppe damit gesagt
        — `roof-sm-bld-…` ist das Dach eines Gebäudes und nicht
        „Umgebung, Fach Dach".
      • Sonst gilt das erste Wort, das die Tabelle kennt.
    Findet sich keins, bleibt „Sonstiges". Eine Sammelschublade ist
    ehrlicher als eine erfundene Ordnung — und sie fällt beim Lesen auf.
  */
  const fach = w.find((wort) => WORT[wort]);
  const smIndex = w.indexOf('sm');
  if (smIndex >= 0 && TYP_GRUPPE[w[smIndex + 1]]) {
    return {
      gruppe: TYP_GRUPPE[w[smIndex + 1]],
      untergruppe: fach ? WORT[fach] : (WORT[w[smIndex + 2]] ?? grossVorn(w[smIndex + 2] ?? '')),
      kennzeichen,
    };
  }
  if (fach) return { gruppe: 'Umgebung', untergruppe: WORT[fach], kennzeichen };
  return { gruppe: 'Umgebung', untergruppe: 'Sonstiges', kennzeichen };
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

// ── Prefab-Definitionen ───────────────────────────────────────────────

const defs = [];
const katalog = [];
const fehlend = [];

const prefabNachAsset = new Map();
for (const p of prefabQuelle.prefabs) {
  if (!manifestNachPfad.has(p.asset)) {
    fehlend.push(`${p.id} → ${p.asset}`);
    continue;
  }
  prefabNachAsset.set(p.asset, p);
}

for (const p of [...prefabNachAsset.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const b = p.bounds;
  const breite = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const hoehe = b.max[1] - b.min[1];
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
  const { gruppe, untergruppe, kennzeichen } = einsortieren(a.path, p?.category);
  /*
    `art` ist NICHT `kind` aus dem Manifest. Das Manifest sagt, was die
    Datei technisch ist (mesh, prefab, texture, audio, terrain); der
    Katalog sagt, wie man damit umgeht — und da fallen Kulisse und
    Höhenfeld aus `modell` heraus, weil man sie nicht streuen darf.
  */
  let art;
  if (a.kind === 'texture') art = 'textur';
  else if (a.kind === 'audio') art = 'ton';
  else if (kennzeichen.includes('kollision')) art = 'kollision';
  else if (a.kind === 'terrain' || gruppe === 'Höhenfelder') art = 'terrain';
  else if (gruppe === 'Kulisse') art = 'kulisse';
  else art = 'modell';

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
 *   node tools/store-prefabs.mjs
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
 * Generated store registry — do not edit by hand.
 */
import { PrefabFlag } from './types.js';
import type { PrefabDef } from './prefabs.js';
import type { StoreEintrag, StorePrefabName } from './storeKatalog.js';
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

/**
 * Der vollständige Katalog: JEDE Datei, die unter \`assets/store/\`
 * wirklich liegt — ${katalog.length} Einträge, auch Texturen, Töne und
 * Kollisionsnetze, zu denen es kein Prefab gibt.
 *
 * Gruppen in diesem Bestand: ${gruppen.join(', ')}.
 */
export const STORE_KATALOG: readonly StoreEintrag[] = [
`);
teile.push(katalog.map(katalogZeile).join('\n'));
teile.push(`
];

/** \`id\` → Katalogeintrag. */
export const STORE_KATALOG_NACH_ID: ReadonlyMap<string, StoreEintrag> = new Map(
  STORE_KATALOG.map((e) => [e.id, e])
);

/** Prefabname → Katalogeintrag (nur die ${defs.length} setzbaren). */
export const STORE_KATALOG_NACH_PREFAB: ReadonlyMap<StorePrefabName, StoreEintrag> = new Map(
  STORE_KATALOG.filter((e) => e.prefabName !== undefined).map((e) => [e.prefabName as string, e])
);
`);

const text = teile.join('');

if (process.argv.includes('--pruefen')) {
  const alt = existsSync(ZIEL) ? readFileSync(ZIEL, 'utf8') : '';
  if (alt === text) {
    console.log(`ok   shared/src/storePrefabs.ts ist aktuell (${defs.length} Prefabs, ${katalog.length} Katalogzeilen)`);
    process.exit(0);
  }
  console.error('FAIL shared/src/storePrefabs.ts weicht ab — node tools/store-prefabs.mjs erneut laufen lassen');
  process.exit(1);
}

/*
  `--nach <pfad>` schreibt woandershin.

  Nur für `tools/test/store-erzeugung.ts` da, und der Grund ist eine
  Regel und keine Bequemlichkeit: Ein Test darf keine getrackte
  Quelldatei überschreiben. Täte er es, hinterliesse jeder Lauf eine
  Änderung im Arbeitsbaum — bei Gleichstand unsichtbar, bei Abweichung
  aber genau die Datei zerschossen, deren Abweichung er gerade meldet.
  Mit `--nach` legt er zwei Läufe in einen Temp-Ordner und vergleicht
  dort; das Original fasst er nur lesend an.
*/
const nachIndex = process.argv.indexOf('--nach');
const ziel = nachIndex >= 0 ? resolve(process.argv[nachIndex + 1] ?? '') : ZIEL;

writeFileSync(ziel, text, 'utf8');
console.log(
  `${ziel} geschrieben: ${defs.length} Prefabs, ${katalog.length} Katalogzeilen, ` +
    `${nichtStreuen.length} nicht streubar, ${gruppen.length} Gruppen (${gruppen.join(', ')})`
);
if (fehlend.length > 0) {
  console.log(`Hinweis: ${fehlend.length} Prefab(s) ohne Datei im Store übersprungen — ${fehlend.join(', ')}`);
}
