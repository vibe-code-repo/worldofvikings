/**
 * Data items (#152) in the item tooltip: a real entry read with `leseGegenstandsDatei`, turned into an item with
 * `gegenstandZuItem` and registered with `wendeGegenstandsDatenAn`.
 *
 * Proves:
 *  1. `anzeigeName` gives the DATA text in de and en (through the text layer behind the repo catalogue); before
 *     the registration it is the key itself (control that the layer is what does it).
 *  2. The tooltip shows the level and rarity of the entry (7 / rare, blue, "Itemlevel 7"); an entry without
 *     values got the sanitiser default 1 / common.
 *  3. `loeseStufe` accepts exactly the values a real data item carries (source "eigen").
 *  4. A data item WITHOUT values, or with values out of range, does not crash the tooltip: 1 / common.
 *
 * Run: npx tsx client/test/item-tooltip-daten.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findItem, loeseStufe, anzeigeName, type ItemShared } from '@wov/shared';
import { leseGegenstandsDatei, gegenstandZuItem, wendeGegenstandsDatenAn } from '../../shared/src/items/gegenstandsDaten';
import { tooltipInhalt, RARITY_FARBEN, type Uebersetzer } from '../src/ui/itemTooltipInhalt';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const HERE = dirname(fileURLToPath(import.meta.url));
const katalog = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'i18n', 'katalog', `${l}.json`), 'utf8'));
const KAT = { de: katalog('de'), en: katalog('en') };
const uebersetzer = (l: 'de' | 'en'): Uebersetzer => (key, vars = {}) => {
  const text = KAT[l][key];
  if (text === undefined) throw new Error(`fehlender Schluessel ${l}:${key}`);
  return text.replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
};
const texte = (i: ReturnType<typeof tooltipInhalt>): string[] => i.zeilen.map((z) => z.text);

const axt = findItem('AxeFlint')!;
const holzaxt = {
  id: 'Holzaxt', nameSchluessel: 'inhalt.gegenstand.Holzaxt.name', beschreibungSchluessel: 'inhalt.gegenstand.Holzaxt.beschreibung',
  typ: 'zweihaendigWaffe', slot: 'hand',
  modell: { upload: 'hochgeladen/U_Holzaxt', skala: 0.6, haltePosition: [...axt.holdPosition!], halteRotation: [...axt.holdRotation!], hiebVersatz: 0, animationsSatz: axt.animationSet ?? 'sword' },
  symbol: null, stapel: 1, gewicht: 2, werte: { damage: 10 }, ernte: { baum: 1 }, haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 },
  itemLevel: 7, rarity: 'rare',
  texte: {
    'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' },
    'inhalt.gegenstand.Holzaxt.beschreibung': { de: 'Eine einfache Axt aus Holz.', en: 'A plain axe made of wood.' },
  },
};
const brett = {
  id: 'Brett', nameSchluessel: 'inhalt.gegenstand.Brett.name', typ: 'material',
  texte: { 'inhalt.gegenstand.Brett.name': { de: 'Brett', en: 'Plank' } },
};
const lesung = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [holzaxt, brett] }));
check('the file reads: 2 entries, none rejected', lesung.eintraege.length === 2 && lesung.verworfen.length === 0, JSON.stringify(lesung.verworfen));
const itemAxt = gegenstandZuItem(lesung.eintraege[0]);
const itemBrett = gegenstandZuItem(lesung.eintraege[1]);

console.log('\n[1] name from the data text');
check('control, before the registration: the key itself', anzeigeName(itemAxt, 'en') === 'inhalt.gegenstand.Holzaxt.name');
wendeGegenstandsDatenAn(lesung.eintraege);
try {
  check('de: Holzaxt', anzeigeName(itemAxt, 'de') === 'Holzaxt');
  check('en: Wooden axe', anzeigeName(itemAxt, 'en') === 'Wooden axe');
  check('en of the plank: Plank; de: Brett', anzeigeName(itemBrett, 'en') === 'Plank' && anzeigeName(itemBrett, 'de') === 'Brett');
  check('the tooltip name follows the language', tooltipInhalt(itemAxt, uebersetzer('de'), { sprache: 'de' }).name === 'Holzaxt' && tooltipInhalt(itemAxt, uebersetzer('en'), { sprache: 'en' }).name === 'Wooden axe');

  console.log('\n[2] level and rarity from the entry');
  const t = tooltipInhalt(itemAxt, uebersetzer('en'), { sprache: 'en' });
  check('axe entry: Rare, blue, weapon, Item level 7, Damage 10', texte(t)[0] === 'Rare' && t.nameFarbe === RARITY_FARBEN.rare && texte(t).includes('Weapon') && texte(t).includes('Item level 7') && texte(t).includes('Damage 10'), texte(t).join(' | '));
  const b = tooltipInhalt(itemBrett, uebersetzer('de'), { sprache: 'de' });
  check('plank entry without values: Gewöhnlich, white, material, no level', texte(b)[0] === 'Gewöhnlich' && b.nameFarbe === RARITY_FARBEN.common && texte(b)[1] === 'Material' && !b.zeilen.some((z) => z.art === 'itemlevel'), texte(b).join(' | '));
  check('the item carries the sanitiser default 1 / common', itemBrett.itemLevel === 1 && itemBrett.rarity === 'common');

  console.log('\n[3] loeseStufe with a real data item');
  const l = loeseStufe(itemAxt, itemAxt);
  check('taken as "eigen": 7 / rare', l.quelle === 'eigen' && l.stufe.itemLevel === 7 && l.stufe.rarity === 'rare');
  check('the plank: "eigen" 1 / common', loeseStufe(itemBrett, itemBrett).quelle === 'eigen');

  console.log('\n[4] a data item without or with wrong values does not crash the tooltip');
  const ohne = { ...itemAxt, itemLevel: undefined, rarity: undefined } as unknown as ItemShared;
  let geworfen = ''; let t0 = tooltipInhalt(itemAxt, uebersetzer('de'));
  try { t0 = tooltipInhalt(ohne, uebersetzer('de'), { sprache: 'de' }); } catch (e) { geworfen = (e as Error).message; }
  check('no values: no crash, Gewöhnlich, Itemlevel 1', geworfen === '' && texte(t0)[0] === 'Gewöhnlich' && texte(t0).includes('Itemlevel 1') && t0.nameFarbe === RARITY_FARBEN.common, geworfen || texte(t0).join(' | '));
  for (const [name, wert] of [['level 500', { itemLevel: 500, rarity: 'epic' }], ['level 0', { itemLevel: 0, rarity: 'epic' }], ['rarity mythic', { itemLevel: 5, rarity: 'mythic' }], ['level 1e300', { itemLevel: 1e300, rarity: 'rare' }]] as const) {
    let w = ''; let tt = t0;
    try { tt = tooltipInhalt({ ...itemAxt, ...wert } as unknown as ItemShared, uebersetzer('de'), { sprache: 'de' }); } catch (e) { w = (e as Error).message; }
    check(`${name}: no crash, falls back to 1 / common`, w === '' && texte(tt)[0] === 'Gewöhnlich' && texte(tt).includes('Itemlevel 1'), w || texte(tt).join(' | '));
  }
  check('a code item is unchanged by this (axe: 5 / common)', texte(tooltipInhalt(axt, uebersetzer('de'))).includes('Itemlevel 5'));
} finally {
  wendeGegenstandsDatenAn([]);
}
check('cleaned up: the data items are gone', findItem('Holzaxt') === undefined && anzeigeName(itemAxt, 'en') === 'inhalt.gegenstand.Holzaxt.name');

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
