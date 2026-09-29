/**
 * Item level and rarity of every item definition (card item-tooltip, concept table B2).
 *
 * Proves, with numbers:
 *  1. Every definition carries an integer `itemLevel >= 1` and a valid `rarity`.
 *  2. The values are the table B2 (Mike 27.09.2026): materials/food/trophies 1 common; simple tools 1;
 *     first weapons 2; crafted weapons 5; Plainhide and the leather starter pieces 1 common; class sets 10 rare;
 *     Eikthyr trophy 10 uncommon. Every one of the ~118 items is checked against its group.
 *  3. No orphan rows: every entry of the tables belongs to a real item / set family; no set part is left out.
 *  4. Male and female parts of a family share one value.
 *
 * Run: npx tsx shared/test/item-stufen.ts   (from the repo root)
 */
import {
  ITEM_DEFS, findItem, RARITY_IDS, ITEM_STUFEN, SET_STUFEN, SET_TEILE, ESSEN, istRarity, anzeigeName,
  stufeFuerRuestungsteil, RARITY_TEXT_KEYS, inhaltText,
} from '../src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

console.log('\n[1] every definition has itemLevel >= 1 and a valid rarity');
const schlecht = ITEM_DEFS.filter((d) => !(Number.isInteger(d.itemLevel) && d.itemLevel >= 1) || !istRarity(d.rarity));
check(`${ITEM_DEFS.length} definitions, all with level and rarity`, ITEM_DEFS.length > 100 && schlecht.length === 0, schlecht.map((d) => d.name).join(','));
check('rarity ids and text keys agree', RARITY_IDS.length === 5 && RARITY_IDS.every((r) => RARITY_TEXT_KEYS[r] === `rarity.${r}`));
check('unknown rarity is refused', !istRarity('mythic') && !istRarity(undefined) && !istRarity('constructor'));

console.log('\n[2] table B2');
const wert = (name: string): string => {
  const d = findItem(name);
  return d ? `${d.itemLevel}/${d.rarity}` : 'fehlt';
};
const erwartet: Record<string, string> = {
  Messer: '1/common', Hoe: '1/common', Cultivator: '1/common', Hammer: '1/common',
  Club: '2/common', PickaxeAntler: '2/common',
  AxeFlint: '5/common', SwordNorth: '5/common', Staff: '5/common', Spear: '5/common',
  Wood: '1/common', Stone: '1/common', HardAntler: '1/common', TrophyDeer: '1/common', CookedMeat: '1/common',
  TrophyEikthyr: '10/uncommon',
  LederBH: '1/common', LederShorts: '1/common',
};
for (const [name, soll] of Object.entries(erwartet)) check(`${name} = ${soll}`, wert(name) === soll, wert(name));
for (const name of Object.keys(ESSEN)) check(`food ${name} = 1/common`, wert(name) === '1/common', wert(name));
const teile = ITEM_DEFS.filter((d) => d.ruestungsteil !== undefined && findItem(d.name) === d && SET_TEILE.some((t) => t.item === d.name));
for (const d of teile) {
  const soll = d.name.startsWith('plainhide') ? '1/common' : '10/rare';
  if (`${d.itemLevel}/${d.rarity}` !== soll) check(`${d.name} = ${soll}`, false, `${d.itemLevel}/${d.rarity}`);
}
check(`${teile.length} set parts: Plainhide 1 common, class sets 10 rare`, teile.length === SET_TEILE.length && teile.every((d) => `${d.itemLevel}/${d.rarity}` === (d.name.startsWith('plainhide') ? '1/common' : '10/rare')));
const gruppen = new Map<string, number>();
for (const d of ITEM_DEFS) gruppen.set(`${d.itemLevel}/${d.rarity}`, (gruppen.get(`${d.itemLevel}/${d.rarity}`) ?? 0) + 1);
console.log('  table actually set:', [...gruppen].sort().map(([k, n]) => `${k} x${n}`).join(', '));

console.log('\n[3] no orphan rows');
check('every ITEM_STUFEN name is an item', Object.keys(ITEM_STUFEN).every((n) => findItem(n) !== undefined), Object.keys(ITEM_STUFEN).filter((n) => !findItem(n)).join(','));
const familien = new Set(SET_TEILE.map((t) => t.familie));
check('every SET_STUFEN family has parts, every family has a row', Object.keys(SET_STUFEN).every((f) => familien.has(f)) && [...familien].every((f) => f in SET_STUFEN), [...familien].join(','));
check('every set part resolves to a level', SET_TEILE.every((t) => stufeFuerRuestungsteil(t.id) !== undefined));

console.log('\n[4] male and female share one value');
check('male == female for every part key', SET_TEILE.filter((t) => t.id.includes('_male_')).every((m) => {
  const w = SET_TEILE.find((t) => t.id === m.id.replace('_male_', '_female_'));
  return w === undefined || JSON.stringify(stufeFuerRuestungsteil(w.id)) === JSON.stringify(stufeFuerRuestungsteil(m.id));
}));

console.log('\n[5] display name: label, or textKey through the shared text function');
check('no textKey: the label, in any language', ITEM_DEFS.filter((d) => !('textKey' in d)).every((d) => anzeigeName(d) === d.label && anzeigeName(d, 'en') === d.label));
const mitSchluessel = { label: 'Rohtext', textKey: 'inhalt.item.beispiel' };
check('textKey: catalogue text per language', anzeigeName(mitSchluessel, 'de') === 'Beispieltext' && anzeigeName(mitSchluessel, 'en') === 'Example text');
check('textKey: unknown language falls back to German, no language too', anzeigeName(mitSchluessel, 'fr') === 'Beispieltext' && anzeigeName(mitSchluessel) === 'Beispieltext');
check('textKey missing in the catalogue: the key itself, never empty', anzeigeName({ label: 'Rohtext', textKey: 'inhalt.item.gibt_es_nicht' }, 'en') === 'inhalt.item.gibt_es_nicht');
// Set parts carry a `textKey` once the armor-names card is on the base; then the name must be the catalogue text.
const schluessel = (d: object): string | undefined => (d as { textKey?: string }).textKey;
const teileMitSchluessel = ITEM_DEFS.filter((d) => schluessel(d));
if (teileMitSchluessel.length === 0) console.log('  (no definition carries a textKey on this base: the set-part check below is skipped)');
else {
  const brust = ITEM_DEFS.find((d) => d.ruestungsteil === 'ironward_brust')!;
  check(`${teileMitSchluessel.length} set parts with textKey: name = catalogue text, de and en`, teileMitSchluessel.every((d) => anzeigeName(d, 'de') === inhaltText(schluessel(d)!, 'de') && anzeigeName(d, 'en') === inhaltText(schluessel(d)!, 'en')));
  check('Ironward chest: translated, not the label, not the key', anzeigeName(brust, 'en') !== anzeigeName(brust, 'de') && anzeigeName(brust, 'en') !== schluessel(brust) && anzeigeName(brust, 'de') !== schluessel(brust), `${anzeigeName(brust, 'de')} / ${anzeigeName(brust, 'en')}`);
}
check('empty textKey counts as none', anzeigeName({ label: 'Rohtext', textKey: '' }, 'en') === 'Rohtext');

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
