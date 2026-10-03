/**
 * GD1: the 29 raw items live in shared/data/gegenstaende.json (baked in), the format knows build tables, terrain
 * hits and own models. Proves, with numbers:
 *  [1] the file holds exactly the 29 base ids in order and every field of every item equals the literal table below
 *      (written from the code of before the move: German names byte for byte, values, recipes, levels, grips);
 *  [2] the six recipes in the file order of the old craft list; REZEPTE is empty; ITEM_STUFEN keeps only the 2 leather pieces;
 *  [3] the new format fields: bautafel / terrain / modell.eigen are read, refused when wrong, written and read back;
 *  [4] the base stock cannot go away: an empty, broken or reduced working copy still leaves all 29, an own entry
 *      with a base id replaces the base entry, a different spelling of a base id is refused;
 *  [5] no key `inhalt.gegenstand.*` in de.json / en.json (it would silently win against the mask);
 *  [6] an old save (inventory and chest with all 29 names) loads with the same stacks, 0 kept, 0 repaired.
 *
 * Run: npx tsx shared/test/gd1-grundbestand.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRUNDBESTAND, GRUNDBESTAND_IDS, ITEMS_BY_NAME, ITEM_DEFS, ITEM_STUFEN, Inventory, replaceDataItems, REZEPTE, findItem,
  datenRezepte, mitGrundbestand, packContainer, setzeUnbekannteVerwahren, unpackContainer, type SavedItemStack,
} from '../src/index.js';
import {
  BAUTAFELN, TERRAIN_OPS, gegenstandZuItem, leseGegenstandsDatei, pruefeEintrag, schreibeGegenstandsDatei,
  wendeGegenstandsDatenAn, istGrundItem, type GegenstandsEintrag,
} from '../src/items/gegenstandsDaten.js';
import { inhaltText } from '../src/texte.js';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}${detail ? ` — ${detail}` : ''}`);
  }
};
const json = (v: unknown): string => JSON.stringify(v);

interface Soll {
  de: string; en: string; typ: number; modell: string | null; bautafel: string | null; terrain: string | null;
  stapel: number; gewicht: number; werte: Record<string, number> | null; ernte: Record<string, number> | null;
  stufe: string; halt: Array<number | null>; griff: unknown[]; symbol: string; rezept: Array<[string, number]> | null;
}
/** Written from the items as they were in code before the move (ITEM_DEFS_ROH, REZEPTE, ITEM_STUFEN); not derived from the file. */
const SOLL: Record<string, Soll> = {
  Hammer: {"de": "Hammer", "en": "Hammer", "typ": 19, "modell": null, "bautafel": "Hammer", "terrain": null, "stapel": 1, "gewicht": 2, "werte": null, "ernte": null, "stufe": "1/common", "halt": [100, 1, 5], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "hammer", "rezept": [["Wood", 3], ["Stone", 2]]},
  Club: {"de": "Keule", "en": "Club", "typ": 14, "modell": null, "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 12}, "ernte": null, "stufe": "2/common", "halt": [100, 1, 6], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "club", "rezept": [["Wood", 6]]},
  AxeFlint: {"de": "Feuersteinaxt", "en": "Flint Axe", "typ": 14, "modell": null, "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 2.5, "werte": {"damage": 15}, "ernte": {"baum": 1}, "stufe": "5/common", "halt": [200, 1, 8], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "axe_flint", "rezept": [["Wood", 4], ["Flint", 6]]},
  Hoe: {"de": "Hacke (Hoe)", "en": "Hoe", "typ": 19, "modell": null, "bautafel": "Hoe", "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 2}, "ernte": null, "stufe": "1/common", "halt": [200, 1, 5], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "hoe", "rezept": [["Wood", 5], ["Stone", 2]]},
  PickaxeAntler: {"de": "Geweihspitzhacke", "en": "Antler Pickaxe", "typ": 14, "modell": null, "bautafel": null, "terrain": "digg", "stapel": 1, "gewicht": 3, "werte": {"damage": 8}, "ernte": {"fels": 1}, "stufe": "2/common", "halt": [100, 1, 4], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "pickaxe_antler", "rezept": [["Wood", 10], ["Stone", 6]]},
  Cultivator: {"de": "Pflug", "en": "Cultivator", "typ": 19, "modell": null, "bautafel": "Cultivator", "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 2}, "ernte": null, "stufe": "1/common", "halt": [200, 1, 5], "griff": [[0, -0.05, 0.12], [-1.9, 0, 0], null, null], "symbol": "cultivator_bronze", "rezept": [["Wood", 5], ["Flint", 2]]},
  Messer: {"de": "Sax (Messer)", "en": "Seax (Knife)", "typ": 19, "modell": "Messer", "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 0.6, "werte": null, "ernte": null, "stufe": "1/common", "halt": [120, 1, 3], "griff": [[0.036, 0.135, 0], [1.5708, 0, 1.5708], null, null], "symbol": "messer", "rezept": null},
  Wood: {"de": "Holz", "en": "Wood", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 2, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "wood", "rezept": null},
  Stone: {"de": "Stein", "en": "Stone", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 2, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "stone", "rezept": null},
  Flint: {"de": "Feuerstein", "en": "Flint", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "flint", "rezept": null},
  Resin: {"de": "Harz", "en": "Resin", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "resin", "rezept": null},
  Raspberry: {"de": "Himbeeren", "en": "Raspberries", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "raspberry", "rezept": null},
  Blueberries: {"de": "Blaubeeren", "en": "Blueberries", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "blueberries", "rezept": null},
  Mushroom: {"de": "Pilz", "en": "Mushroom", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "mushroom", "rezept": null},
  Thistle: {"de": "Distel", "en": "Thistle", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "thistle", "rezept": null},
  Dandelion: {"de": "Löwenzahn", "en": "Dandelion", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "dandelion", "rezept": null},
  Carrot: {"de": "Karotte", "en": "Carrot", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "carrot", "rezept": null},
  RawMeat: {"de": "Rohes Fleisch", "en": "Raw Meat", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "raw_meat", "rezept": null},
  Entrails: {"de": "Gedärme", "en": "Entrails", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "entrails", "rezept": null},
  Coins: {"de": "Münzen", "en": "Coins", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "coins", "rezept": null},
  Amber: {"de": "Bernstein", "en": "Amber", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "amber", "rezept": null},
  NeckTail: {"de": "Neck-Schwanz", "en": "Marsh Beast Tail", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 50, "gewicht": 0.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "necktail", "rezept": null},
  TrophyDeer: {"de": "Hirschtrophäe", "en": "Deer Trophy", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 10, "gewicht": 1.5, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "TrophyDeer", "rezept": null},
  CookedMeat: {"de": "Gebratenes Fleisch", "en": "Cooked Meat", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 20, "gewicht": 1, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "necktailgrilled", "rezept": null},
  HardAntler: {"de": "Hartes Geweih", "en": "Hard Antler", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 20, "gewicht": 2, "werte": null, "ernte": null, "stufe": "1/common", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "HardAntler", "rezept": null},
  TrophyEikthyr: {"de": "Eikthyr-Trophäe", "en": "Great Stag Trophy", "typ": 1, "modell": null, "bautafel": null, "terrain": null, "stapel": 5, "gewicht": 2, "werte": null, "ernte": null, "stufe": "10/uncommon", "halt": [null, null, null], "griff": [null, null, null, null], "symbol": "TrophyEikthyr", "rezept": null},
  SwordNorth: {"de": "Nordschwert", "en": "Northern Sword", "typ": 14, "modell": "SwordNorth", "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 12}, "ernte": null, "stufe": "5/common", "halt": [200, 1, 10], "griff": [[0.08, 0.08, 0.035], [0, 3.141592653589793, 1.5707963267948966], null, null], "symbol": "sword_north", "rezept": null},
  Staff: {"de": "Kampfstab", "en": "Battle Staff", "typ": 14, "modell": "Staff", "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 10}, "ernte": null, "stufe": "5/common", "halt": [200, 1, 10], "griff": [[0, 0.08, 0.035], [0, 3.141592653589793, 1.5707963267948966], 0.9, "spear"], "symbol": "staff", "rezept": null},
  Spear: {"de": "Speer", "en": "Spear", "typ": 14, "modell": "Spear", "bautafel": null, "terrain": null, "stapel": 1, "gewicht": 2, "werte": {"damage": 11}, "ernte": null, "stufe": "5/common", "halt": [200, 1, 10], "griff": [[0, 0.08, 0.035], [0, 3.141592653589793, 1.5707963267948966], 0.9, "spear"], "symbol": "spear", "rezept": null},
};
const IDS = Object.keys(SOLL);
const wurzel = resolve(fileURLToPath(import.meta.url), '../../..');
const dateiText = readFileSync(resolve(wurzel, 'shared/data/gegenstaende.json'), 'utf-8');

// ── 1. The file and every field ───────────────────────────────────────
console.log('GD1 — Grundbestand: Datei und Felder');
pruefe(IDS.length === 29 && json(GRUNDBESTAND_IDS) === json(IDS), 'GRUNDBESTAND_IDS = die 29 erwarteten Kennungen in Dateireihenfolge');
pruefe(json(GRUNDBESTAND.map((e) => e.id)) === json(IDS), 'die Datei traegt die 29 Kennungen in derselben Reihenfolge');
const lesung = leseGegenstandsDatei(dateiText);
pruefe(lesung.ok && lesung.eintraege.length === 29 && lesung.verworfen.length === 0 && lesung.unbekannteFelder === 0, 'die Datei besteht den Sanitizer: 29 Eintraege, 0 verworfen, 0 unbekannte Felder');
pruefe(dateiText === schreibeGegenstandsDatei(lesung.eintraege), 'die Datei ist kanonisch (Schreiben(Lesen(Datei)) = Datei)');
let felder = 0;
for (const id of IDS) {
  const s = SOLL[id];
  const it = findItem(id);
  if (!it) { pruefe(false, `${id} fehlt in findItem`); continue; }
  const ok = (b: boolean, was: string, ist: unknown): void => { felder++; pruefe(b, `${id}.${was}`, `ist ${json(ist)}`); };
  ok(it.label === s.de, 'label (de, Byte fuer Byte)', it.label);
  ok(inhaltText(it.textKey ?? '', 'de') === s.de && inhaltText(it.textKey ?? '', 'en') === s.en, 'Anzeigename de/en ueber textKey', [inhaltText(it.textKey ?? '', 'de'), inhaltText(it.textKey ?? '', 'en')]);
  ok(it.textKey === `inhalt.gegenstand.${id}.name`, 'textKey', it.textKey);
  ok(it.itemType === s.typ, 'itemType', it.itemType);
  ok(it.model === s.modell, 'model (eigenes Modell oder null)', it.model);
  ok((it.pieceTable ?? null) === s.bautafel, 'pieceTable', it.pieceTable);
  ok((it.spawnOnHitTerrain ?? null) === s.terrain, 'spawnOnHitTerrain', it.spawnOnHitTerrain);
  ok(it.maxStackSize === s.stapel && it.weight === s.gewicht, 'Stapel und Gewicht', [it.maxStackSize, it.weight]);
  ok(json(it.stats ?? {}) === json(s.werte ?? {}), 'Werte', it.stats);
  ok(json(it.ernte ?? {}) === json(s.ernte ?? {}), 'Ernte', it.ernte);
  ok(`${it.itemLevel}/${it.rarity}` === s.stufe, 'Stufe/Seltenheit', `${it.itemLevel}/${it.rarity}`);
  ok(json([it.maxDurability ?? null, it.useDurabilityDrain ?? null, it.attackStamina ?? null]) === json(s.halt), 'Haltbarkeit/Verbrauch/Ausdauer', [it.maxDurability, it.useDurabilityDrain, it.attackStamina]);
  ok(json([it.holdPosition ?? null, it.holdRotation ?? null, it.holdOffsetStrike ?? null, it.animationSet ?? null]) === json(s.griff), 'Griff (Position, Drehung, Hiebversatz, Satz)', [it.holdPosition, it.holdRotation, it.holdOffsetStrike, it.animationSet]);
  ok(it.icon === s.symbol, 'Symbol', it.icon);
  ok(it.datenItem === true && it.modellSkala === 1, 'Datenitem, Modellskala 1', [it.datenItem, it.modellSkala]);
}
console.log(`  ${felder} Felder von 29 Gegenstaenden geprueft`);
pruefe(ITEMS_BY_NAME.size === 118 && ITEM_DEFS.length === 89, '118 Gegenstaende (89 Kleidung + 29 Grundbestand)');
pruefe(!ITEM_DEFS.some((d) => IDS.includes(d.name)), 'ITEM_DEFS (Code) enthaelt keinen der 29 mehr');
pruefe(IDS.every((n) => istGrundItem(n)) && !istGrundItem('LederBH') && !istGrundItem('Holzaxt'), 'istGrundItem: die 29 ja, Kleidung und Fremde nein');

// ── 2. Recipes and levels ─────────────────────────────────────────────
console.log('GD1 — Rezepte und Stufen');
const rezepte = datenRezepte();
pruefe(json(rezepte.map((r) => r.ergebnis)) === json(['Hammer', 'Club', 'AxeFlint', 'Hoe', 'PickaxeAntler', 'Cultivator']), 'Herstellliste in der Reihenfolge von vorher', rezepte.map((r) => r.ergebnis).join());
pruefe(json(rezepte.map((r) => [r.ergebnis, r.menge, r.zutaten.map((z) => [z.item, z.menge])])) === json(IDS.filter((i) => SOLL[i].rezept).map((i) => [i, 1, SOLL[i].rezept])), 'Mengen und Zutaten der sechs Rezepte');
pruefe(REZEPTE.length === 0, 'REZEPTE ist leer (nur Rueckwaertsname fuer handleCraft)');
pruefe(json(Object.keys(ITEM_STUFEN).sort()) === json(['LederBH', 'LederShorts']), 'ITEM_STUFEN: nur noch die zwei Lederteile (keine zweite Quelle)');

// ── 3. The new fields of the format ───────────────────────────────────
console.log('GD1 — Format: bautafel, terrain, modell.eigen');
pruefe(json([...BAUTAFELN].sort()) === json(['Cultivator', 'Hammer', 'Hoe']) && json([...TERRAIN_OPS]) === json(['digg']), 'Aufzaehlungen: drei Bautafeln, ein Terrain-Vorgang');
const roh = (id: string, zusatz: Record<string, unknown>): Record<string, unknown> => ({
  id, nameSchluessel: `inhalt.gegenstand.${id}.name`, typ: 'werkzeug',
  texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: `${id} en` } }, ...zusatz,
});
const lies = (...e: unknown[]) => leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: e }));
const grund = (r: ReturnType<typeof lies>): string | undefined => r.verworfen[0]?.grund;
const gut = lies(roh('Probe1', { bautafel: 'Hoe', terrain: 'digg', modell: { eigen: 'Messer' } }));
pruefe(gut.eintraege.length === 1 && gut.eintraege[0].bautafel === 'Hoe' && gut.eintraege[0].terrain === 'digg' && gut.eintraege[0].modell.eigen === 'Messer', 'gueltige Felder werden gelesen');
const item = gut.eintraege[0] ? gegenstandZuItem(gut.eintraege[0]) : null;
pruefe(item?.pieceTable === 'Hoe' && item?.spawnOnHitTerrain === 'digg' && item?.model === 'Messer', 'gegenstandZuItem setzt pieceTable, spawnOnHitTerrain und das eigene Modell');
const leer = lies(roh('Probe2', {}));
pruefe(leer.eintraege[0].bautafel === null && leer.eintraege[0].terrain === null && leer.eintraege[0].modell.eigen === null, 'ohne Angabe: null');
const leerItem = gegenstandZuItem(leer.eintraege[0]);
pruefe(!('pieceTable' in leerItem) && !('spawnOnHitTerrain' in leerItem) && leerItem.model === null, 'ohne Angabe setzt gegenstandZuItem nichts davon');
pruefe(grund(lies(roh('Probe3', { bautafel: 'Axt' }))) === 'feld-ungueltig' && grund(lies(roh('Probe4', { bautafel: 5 }))) === 'feld-ungueltig', 'unbekannte Bautafel verwirft den Eintrag');
pruefe(grund(lies(roh('Probe5', { terrain: 'bagger' }))) === 'feld-ungueltig' && grund(lies(roh('Probe6', { terrain: ['digg'] }))) === 'feld-ungueltig', 'unbekannter Terrain-Vorgang verwirft den Eintrag');
pruefe(grund(lies(roh('Probe7', { modell: { eigen: 'GibtEsNicht' } }))) === 'modell-ungueltig' && grund(lies(roh('Probe8', { modell: { eigen: 7 } }))) === 'modell-ungueltig', 'unbekanntes eigenes Modell verwirft den Eintrag');
pruefe(grund(lies(roh('Probe9', { modell: { eigen: 'Messer', upload: 'hochgeladen/U_Messer' } }))) === 'modell-ungueltig', 'eigenes Modell und Upload schliessen sich aus');
pruefe(grund(lies(roh('Probe10', { modell: { eigen: '__proto__' } }))) === 'modell-ungueltig' && lies(roh('Probe11', { bautafel: null, terrain: null, modell: { eigen: null } })).eintraege.length === 1, '__proto__ als Modell verworfen, null ist "nicht gesetzt"');
pruefe(lies(roh('Probe12', { bautafel: 'Hoe', zauber: 1 })).unbekannteFelder === 1, 'Whitelist: weiter genau die unbekannten Felder zaehlen');
const rund = leseGegenstandsDatei(schreibeGegenstandsDatei(gut.eintraege));
pruefe(rund.eintraege.length === 1 && json(rund.eintraege[0]) === json(gut.eintraege[0]), 'Schreiben und Wiederlesen ergibt denselben Eintrag (bautafel, terrain, eigen)');
const text = schreibeGegenstandsDatei(gut.eintraege);
pruefe(text.includes('"bautafel": "Hoe"') && text.includes('"terrain": "digg"') && text.includes('"eigen": "Messer"'), 'der Schreiber nimmt die drei Felder auf');
pruefe(pruefeEintrag(roh('Probe13', { bautafel: 'Axt' }), []).join() === 'feld-ungueltig', 'pruefeEintrag meldet dasselbe wie der Leser');

// ── 4. The base stock cannot go away ──────────────────────────────────
console.log('GD1 — Grundbestand bleibt immer da');
const fuenf = (): string[] => IDS.filter((n) => findItem(n) === undefined);
wendeGegenstandsDatenAn([]);
pruefe(fuenf().length === 0 && ITEMS_BY_NAME.size === 118, 'leere Arbeitskopie: alle 29 bekannt');
wendeGegenstandsDatenAn(leseGegenstandsDatei('{kaputt').eintraege);
pruefe(fuenf().length === 0, 'kaputte Datei (kein JSON): alle 29 bekannt');
wendeGegenstandsDatenAn(leseGegenstandsDatei(JSON.stringify({ version: 99, gegenstaende: [] })).eintraege);
pruefe(fuenf().length === 0, 'falsche Version: alle 29 bekannt');
wendeGegenstandsDatenAn(lies(roh('Nur1', {})).eintraege);
pruefe(fuenf().length === 0 && findItem('Nur1') !== undefined && ITEMS_BY_NAME.size === 119 && datenRezepte().length === 6, 'Arbeitskopie ohne Grundkennungen: 29 + 1 bekannt');
const mit = mitGrundbestand(lies(roh('Nur1', {})).eintraege);
pruefe(mit.length === 30 && json(mit.slice(0, 29).map((e) => e.id)) === json(IDS) && mit[29].id === 'Nur1', 'mitGrundbestand: Grundeintraege zuerst, dann die eigenen');
const grundRoh = (id: string, ueberschreibe: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...(JSON.parse(schreibeGegenstandsDatei([GRUNDBESTAND.find((g) => g.id === id)!])).gegenstaende[0] as Record<string, unknown>), ...ueberschreibe,
});
const ueber = lies(grundRoh('Wood', { ernte: { baum: 3 } })).eintraege;
const mitUeber = mitGrundbestand(ueber);
pruefe(mitUeber.length === 29 && mitUeber.filter((e) => e.id === 'Wood').length === 1 && mitUeber.find((e) => e.id === 'Wood')?.ernte.baum === 3, 'ein Eintrag mit Grundkennung ersetzt den Grundeintrag (kein Doppel)');
wendeGegenstandsDatenAn(ueber);
pruefe(findItem('Wood')?.ernte?.baum === 3 && IDS.filter((n) => n !== 'Wood').every((n) => findItem(n) !== undefined) && ITEMS_BY_NAME.size === 118, 'angewendet: Wood hat die eigenen Werte, die anderen 28 bleiben');
wendeGegenstandsDatenAn([]);
pruefe(findItem('Wood')?.maxStackSize === 50 && json(findItem('Wood')?.ernte) === '{}', 'danach wieder der Grundstand (Wood 50, keine Ernte)');
// Z2: until GD3 the client knows only the baked-in state: every client-relevant field of a base entry is locked.
const sperrFaelle: Array<[string, Record<string, unknown>]> = [
  ['stapel', { stapel: 7 }], ['gewicht', { gewicht: 9 }], ['haltbarkeit', { haltbarkeit: { max: 5 } }], ['symbol', { symbol: 'stone' }],
  ['typ', { typ: 'zweihaendigWaffe' }], ['werte', { werte: { damage: 99 } }], ['itemLevel', { itemLevel: 9 }], ['rarity', { rarity: 'epic' }],
  ['modell', { modell: { skala: 2 } }], ['rezept', { rezept: { menge: 1, zutaten: [{ item: 'Stone', menge: 1 }] } }],
  ['texte', { texte: { 'inhalt.gegenstand.Wood.name': { de: 'Brennholz', en: 'Firewood' } } }],
];
for (const [feld, ueberschreibe] of sperrFaelle) {
  const r = lies(grundRoh('Wood', ueberschreibe));
  pruefe(r.eintraege.length === 0 && grund(r) === 'grundwert-gesperrt', `Grundgegenstand Wood, Feld ${feld} geaendert: grundwert-gesperrt`, grund(r));
}
pruefe(lies(grundRoh('Wood', {})).eintraege.length === 1 && lies(grundRoh('Hoe', { ernte: { fels: 2 } })).eintraege.length === 1, 'unveraendert oder nur ernte: angenommen');
pruefe(pruefeEintrag(grundRoh('Wood', { stapel: 7 }), []).join() === 'grundwert-gesperrt', 'pruefeEintrag meldet dasselbe');
for (const n of ['WOOD', 'WOod', 'AXEFLINT', 'Axeflint', 'MESSER']) {
  pruefe(grund(lies(roh(n, {}))) === 'id-schreibung-code', `${n} neben einem Grundgegenstand: id-schreibung-code`, grund(lies(roh(n, {}))));
}
const zutat = lies(roh('Neu2', { rezept: { menge: 1, zutaten: [{ item: 'Flint', menge: 2 }] } }));
pruefe(zutat.eintraege.length === 1, 'ein Grundgegenstand als Zutat gilt auch ohne eigenen Eintrag in der Datei');
const zwei = lies(roh('Neu3', { rezept: { menge: 1, zutaten: [{ item: 'Nirgends', menge: 2 }] } }));
pruefe(zwei.eintraege.length === 0 && grund(zwei) === 'rezept-zutat-unbekannt', 'eine unbekannte Zutat wird weiter verworfen');

// ── 5. No catalogue key shadows the mask ──────────────────────────────
console.log('GD1 — keine Schluessel inhalt.gegenstand.* in de.json / en.json');
for (const sprache of ['de', 'en']) {
  const katalog = JSON.parse(readFileSync(resolve(wurzel, `shared/data/texte/${sprache}.json`), 'utf-8')) as Record<string, unknown>;
  const treffer = Object.keys(katalog).filter((k) => k.startsWith('inhalt.gegenstand.'));
  pruefe(treffer.length === 0, `${sprache}.json hat keinen Schluessel inhalt.gegenstand.*`, treffer.slice(0, 3).join());
}

// ── 6. An old save loads unchanged ────────────────────────────────────
console.log('GD1 — alter Spielstand');
setzeUnbekannteVerwahren(true);
const gespeichert: SavedItemStack[] = IDS.map((name, i) => ({ name, stack: 1, durability: 1, quality: 1, gridX: i % 8, gridY: Math.floor(i / 8), equipped: false }));
const zustaende: Array<[string, () => void]> = [
  ['mit der Datei', () => wendeGegenstandsDatenAn(GRUNDBESTAND as GegenstandsEintrag[])],
  ['mit leerer Arbeitskopie', () => wendeGegenstandsDatenAn([])],
  ['mit kaputter Arbeitskopie', () => wendeGegenstandsDatenAn(leseGegenstandsDatei('null').eintraege)],
];
for (const [wie, anwenden] of zustaende) {
  anwenden();
  const inv = new Inventory();
  inv.load(gespeichert);
  pruefe(inv.all.length === 29 && inv.verwahrte.length === 0, `Inventar ${wie}: 29 Stapel, 0 verwahrt`, `${inv.all.length} / ${inv.verwahrte.length}`);
  pruefe(json(inv.serialize().map((s) => [s.name, s.stack, s.gridX, s.gridY])) === json(gespeichert.map((s) => [s.name, s.stack, s.gridX, s.gridY])), `Inventar ${wie}: dieselben Stapel an denselben Plaetzen`);
  const truhe = unpackContainer(JSON.stringify(IDS.slice(0, 12).map((n) => [n, 1, null, 1])));
  pruefe(truhe.all.length === 12 && truhe.verwahrte.length === 0, `Truhe ${wie}: 12 Stapel, 0 verwahrt`, `${truhe.all.length} / ${truhe.verwahrte.length}`);
  pruefe(unpackContainer(packContainer(truhe)).all.map((s) => `${s.shared.name}x${s.stack}`).join() === truhe.all.map((s) => `${s.shared.name}x${s.stack}`).join(), `Truhe ${wie}: Rundreise gleich`);
}
setzeUnbekannteVerwahren(false);
wendeGegenstandsDatenAn([]);

// ── 7. The callers read the new source ───────────────────────────────
console.log('GD1 — Aufrufer lesen die neue Quelle');
// Source checks without comments: the craft panel (DOM, no unit test) and the admin command `item give` (fallback).
const ohneKommentare = (pfad: string): string =>
  readFileSync(resolve(wurzel, pfad), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const panel = ohneKommentare('client/src/ui/CraftingPanel.ts');
pruefe(/for \(const r of datenRezepte\(\)\)/.test(panel) && !/\bREZEPTE\b/.test(panel), 'CraftingPanel liest datenRezepte(), nicht REZEPTE');
const spawn = ohneKommentare('server/src/spiel/befehle/Spawn.ts');
pruefe(/\[\.\.\.ITEMS_BY_NAME\.values\(\)\]\.find\(/.test(spawn) && !/\bITEM_DEFS\b/.test(spawn), 'item give faellt auf alle Gegenstaende zurueck (ITEMS_BY_NAME), nicht auf ITEM_DEFS');

// ── 8. replaceDataItems keeps the base stock (attack F2) ──────────────
console.log('GD1 — replaceDataItems laesst den Grundbestand stehen');
replaceDataItems([]);
pruefe(IDS.every((n) => findItem(n) !== undefined) && ITEMS_BY_NAME.size === 118, 'replaceDataItems([]): alle 29 bleiben (118 Gegenstaende)');
const holz = gegenstandZuItem(lies(grundRoh('Wood', { ernte: { baum: 4 } })).eintraege[0]);
replaceDataItems([holz]);
pruefe(findItem('Wood') === holz && ITEMS_BY_NAME.size === 118, 'ein Item mit Grundnamen ersetzt das Grunditem, die anderen 28 bleiben');
replaceDataItems([]);
pruefe(findItem('Wood')?.maxStackSize === 50, 'danach wieder der Grundstand');
wendeGegenstandsDatenAn([]);

console.log(`\n${fehler === 0 ? 'alle' : `${fehler} von`} ${geprueft} Pruefungen ${fehler === 0 ? 'bestanden' : 'FEHLGESCHLAGEN'}`);
process.exit(fehler === 0 ? 0 : 1);
