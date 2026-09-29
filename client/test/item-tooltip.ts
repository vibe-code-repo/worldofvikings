/**
 * Item tooltip content (client/src/ui/itemTooltipInhalt.ts), pure, read from the real catalogues.
 *
 * Proves, with the real item definitions and the real de/en catalogues:
 *  1. Flint axe: name white, common, weapon, item level 5, damage 15, weight; Ironward chest: blue, rare, slot "Hemd",
 *     level 10, armor 11, +3 strength, +1 vitality; wood: no level, no values; Plainhide tunic: armor 3 and no primary values.
 *  2. de and en both; the two texts differ; no unreplaced placeholder.
 *  3. Completeness: EVERY item definition renders in both languages, every translation key it needs exists in both catalogues.
 *  4. Comparison with the worn part: colors and signs, also for a value the worn part has and the new one lacks.
 *  5. Only tools, weapons and wearables show a level; food, trophies, materials never.
 *
 * Run: npx tsx client/test/item-tooltip.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_DEFS, findItem, RARITY_IDS, STAT_IDS, ESSEN } from '@wov/shared';
import {
  tooltipInhalt, zeigtItemLevel, RARITY_FARBEN, FARBE_PLUS, FARBE_MINUS, type Uebersetzer, type TooltipInhalt,
} from '../src/ui/itemTooltipInhalt';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const lade = (l: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'i18n', 'katalog', `${l}.json`), 'utf8'));
const KATALOG = { de: lade('de'), en: lade('en') };
const benutzt = new Set<string>();

/** Same replacement rule as GameI18n.t; a missing key throws instead of hiding the gap. */
function uebersetzer(l: 'de' | 'en'): Uebersetzer {
  return (key, vars = {}) => {
    benutzt.add(key);
    const text = KATALOG[l][key];
    if (text === undefined) throw new Error(`fehlender Schluessel ${l}:${key}`);
    return text.replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
  };
}
const item = (name: string) => { const d = findItem(name); if (!d) throw new Error(`Item ${name}`); return d; };
const texte = (i: TooltipInhalt): string[] => i.zeilen.map((z) => z.zusatz ? `${z.text} ${z.zusatz.text}` : z.text);
const art = (i: TooltipInhalt, a: string) => i.zeilen.filter((z) => z.art === a);

console.log('\n[1] axe, Ironward chest, wood, Plainhide tunic (de)');
const de = uebersetzer('de');
const axt = tooltipInhalt(item('AxeFlint'), de);
check('axe: name + white', axt.name === item('AxeFlint').label && axt.nameFarbe === '#ffffff');
check('axe: lines in order', texte(axt).slice(0, 4).join('|') === 'Gewöhnlich|Waffe|Itemlevel 5|Schaden 15' && texte(axt)[4] === 'Gewicht 2.5', texte(axt).join(' | '));
check('axe: damage 15, level 5, weight line', texte(axt).includes('Schaden 15') && texte(axt).includes('Itemlevel 5') && art(axt, 'gewicht').length === 1);
const brustDef = ITEM_DEFS.find((d) => d.ruestungsteil === 'ironward_brust')!;
const brust = tooltipInhalt(brustDef, de);
check('ironward chest: rare, blue', texte(brust)[0] === 'Selten' && brust.nameFarbe === RARITY_FARBEN.rare && RARITY_FARBEN.rare === '#4a9eff');
check('ironward chest: slot Hemd, level 10', texte(brust)[1] === 'Hemd' && texte(brust)[2] === 'Itemlevel 10', texte(brust).join(' | '));
check('ironward chest: armor 11, +3 Stärke, +1 Vitalität', ['Rüstung 11', '+3 Stärke', '+1 Vitalität'].every((z) => texte(brust).includes(z)), texte(brust).join(' | '));
check('ironward chest: no agility, no damage', !texte(brust).some((z) => z.includes('Beweglichkeit') || z.includes('Schaden')));
const holz = tooltipInhalt(item('Wood'), de);
check('wood: common, Material, no level, no values', texte(holz)[0] === 'Gewöhnlich' && texte(holz)[1] === 'Material' && art(holz, 'itemlevel').length === 0 && art(holz, 'wert').length === 0, texte(holz).join(' | '));
const weste = tooltipInhalt(ITEM_DEFS.find((d) => d.ruestungsteil === 'plainhide_male_vest')!, de);
check('plainhide tunic: common, level 1, armor 3, no primary values', texte(weste).includes('Rüstung 3') && texte(weste).includes('Itemlevel 1') && art(weste, 'wert').length === 1 && weste.nameFarbe === '#ffffff', texte(weste).join(' | '));

console.log('\n[2] english');
const en = uebersetzer('en');
const axtEn = tooltipInhalt(item('AxeFlint'), en);
const brustEn = tooltipInhalt(brustDef, en);
check('axe en', ['Common', 'Weapon', 'Item level 5', 'Damage 15'].every((z) => texte(axtEn).includes(z)), texte(axtEn).join(' | '));
check('chest en', ['Rare', 'Hemd', 'Item level 10', 'Armor 11', '+3 Strength', '+1 Vitality'].filter((z) => z !== 'Hemd').every((z) => texte(brustEn).includes(z)), texte(brustEn).join(' | '));
check('de and en differ (rarity, type, values)', texte(axt)[0] !== texte(axtEn)[0] && texte(axt)[1] !== texte(axtEn)[1] && texte(brust)[3] !== texte(brustEn)[3]);
check('no unreplaced placeholder anywhere', ITEM_DEFS.every((d) => [de, en].every((t) => !tooltipInhalt(d, t).zeilen.some((z) => z.text.includes('{')))));

console.log('\n[3] completeness: every item in both languages, every key present in both catalogues');
let fehler = '';
for (const d of ITEM_DEFS) for (const l of ['de', 'en'] as const) {
  try { const i = tooltipInhalt(d, uebersetzer(l)); if (!i.name || i.zeilen.length < 2) fehler += `${d.name}:${l} leer `; } catch (e) { fehler += `${d.name}:${l} ${(e as Error).message} `; }
}
check(`${ITEM_DEFS.length} items x 2 languages render`, fehler === '', fehler);
const fehlt = [...benutzt].filter((k) => !(k in KATALOG.de) || !(k in KATALOG.en));
check(`${benutzt.size} keys used, none missing in de/en`, fehlt.length === 0, fehlt.join(','));
check('all rarity and stat keys exist', RARITY_IDS.every((r) => `rarity.${r}` in KATALOG.de && `rarity.${r}` in KATALOG.en) && STAT_IDS.every((s) => `stat.${s}` in KATALOG.de && `stat.${s}` in KATALOG.en));
check('every rarity has a color', RARITY_IDS.every((r) => /^#[0-9a-f]{6}$/.test(RARITY_FARBEN[r])) && new Set(Object.values(RARITY_FARBEN)).size === 5);

console.log('\n[4] comparison with the worn part');
const plainWeste = ITEM_DEFS.find((d) => d.ruestungsteil === 'plainhide_male_vest')!;
const auf = tooltipInhalt(brustDef, de, { vergleich: plainWeste.stats ?? {} });
check('chest vs tunic: armor (+8), strength (+3), vitality (+1) green', ['Rüstung 11 (+8)', '+3 Stärke (+3)', '+1 Vitalität (+1)'].every((z) => texte(auf).includes(z)) && auf.zeilen.filter((z) => z.zusatz).every((z) => z.zusatz!.farbe === FARBE_PLUS), texte(auf).join(' | '));
const ab = tooltipInhalt(plainWeste, de, { vergleich: brustDef.stats ?? {} });
check('tunic vs chest: armor 3 (−8) red; lost strength shown as +0 (−3)', texte(ab).includes('Rüstung 3 (−8)') && texte(ab).includes('+0 Stärke (−3)') && ab.zeilen.filter((z) => z.zusatz).every((z) => z.zusatz!.farbe === FARBE_MINUS), texte(ab).join(' | '));
const gleich = tooltipInhalt(brustDef, de, { vergleich: brustDef.stats ?? {} });
check('same part: no difference shown', gleich.zeilen.every((z) => !z.zusatz));
const axtVsSchwert = tooltipInhalt(item('AxeFlint'), de, { vergleich: item('SwordNorth').stats });
check('axe 15 vs sword 12: Schaden 15 (+3)', texte(axtVsSchwert).includes('Schaden 15 (+3)'), texte(axtVsSchwert).join(' | '));
const ohne = tooltipInhalt(brustDef, de);
check('without comparison no difference', ohne.zeilen.every((z) => !z.zusatz));
const mitAktion = tooltipInhalt(brustDef, de, { aktion: 'Klick legt ab' });
check('action is the last, gray line', mitAktion.zeilen.at(-1)?.art === 'aktion' && mitAktion.zeilen.at(-1)?.text === 'Klick legt ab');

console.log('\n[4b] name through textKey (set parts) or label');
const mitKey = { ...item('AxeFlint'), textKey: 'inhalt.item.beispiel' };
check('with textKey: name from the catalogue in the language of the tooltip', tooltipInhalt(mitKey, de, { sprache: 'en' }).name === 'Example text' && tooltipInhalt(mitKey, de, { sprache: 'de' }).name === 'Beispieltext');
check('without textKey: the label, whatever the language', tooltipInhalt(item('AxeFlint'), de, { sprache: 'en' }).name === item('AxeFlint').label);

console.log('\n[5] level only for tools, weapons and wearables');
const material = ITEM_DEFS.filter((d) => d.ausruestung === undefined && d.itemType === 1);
check(`${material.length} materials/food/trophies show no level`, material.length > 15 && material.every((d) => !zeigtItemLevel(d) && art(tooltipInhalt(d, de), 'itemlevel').length === 0));
check('every tool, weapon and wearable shows one', ITEM_DEFS.filter((d) => !material.includes(d)).every((d) => zeigtItemLevel(d) && art(tooltipInhalt(d, de), 'itemlevel').length === 1));
check('food / trophy / eikthyr types', texte(tooltipInhalt(item('CookedMeat'), de))[1] === 'Nahrung' && Object.keys(ESSEN).every((n) => texte(tooltipInhalt(item(n), de))[1] === 'Nahrung') && texte(tooltipInhalt(item('TrophyDeer'), de))[1] === 'Trophäe');
const eik = tooltipInhalt(item('TrophyEikthyr'), de);
check('Eikthyr trophy: uncommon green, no level', texte(eik)[0] === 'Ungewöhnlich' && eik.nameFarbe === '#1eff00' && art(eik, 'itemlevel').length === 0);

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
