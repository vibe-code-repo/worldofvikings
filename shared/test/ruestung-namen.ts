/**
 * Armor names go through translation keys (card "Ruestungsnamen ueber Schluessel").
 *
 *  1. every set and every armor part has a `textKey` that follows the schema:
 *       - part of a set with a male/female variant: `inhalt.item.<family>_<key>`
 *       - part of a set without a variant:          `inhalt.item.<part id>`
 *       - set:                                      `inhalt.set.<family>`
 *     with only [a-z0-9_] after the prefix
 *  2. every key exists in shared/data/texte/de.json AND en.json with a non-empty text
 *  3. male and female piece of the same family and key share ONE key
 *  4. no orphan `inhalt.item.*` / `inhalt.set.*` key without a part or set
 *     (the example entry `inhalt.item.beispiel` is the only exception)
 *  5. the item definitions and the set catalog carry the same keys as the registry
 *
 * Run: npx tsx shared/test/ruestung-namen.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EQUIPMENT_SETS, equipmentSetCatalog } from '../src/equipmentSets.js';
import { findItem } from '../src/items/itemDefs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '..', 'data', 'texte');
const katalog = (sprache: string): Record<string, string> => JSON.parse(readFileSync(resolve(DATA, `${sprache}.json`), 'utf8'));
const de = katalog('de');
const en = katalog('en');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); failures++; }
}

const familyOf = (setId: string) => setId.replace(/_(male|female)$/, '');
const SCHEMA = /^inhalt\.(item|set)\.[a-z0-9_]+$/;
const erwartet = new Set<string>();
const jeFamilieUndKey = new Map<string, Set<string>>();

for (const set of EQUIPMENT_SETS) {
  const family = familyOf(set.id);
  const hasVariant = set.id !== family;
  const setKey = `inhalt.set.${family}`;
  erwartet.add(setKey);
  check(`${set.id}: set textKey = ${setKey}`, (set as { textKey?: string }).textKey === setKey, String((set as { textKey?: string }).textKey));
  for (const part of set.parts) {
    const key = hasVariant ? part.id.slice(`${set.id}_`.length) : part.id.slice(`${family}_`.length);
    const soll = hasVariant ? `inhalt.item.${family}_${key}` : `inhalt.item.${part.id}`;
    const ist = (part as { textKey?: string }).textKey;
    erwartet.add(soll);
    check(`${part.id}: textKey = ${soll}`, ist === soll, String(ist));
    check(`${part.id}: textKey matches the schema`, typeof ist === 'string' && SCHEMA.test(ist), String(ist));
    const gruppe = jeFamilieUndKey.get(`${family}/${key}`) ?? new Set<string>();
    gruppe.add(String(ist));
    jeFamilieUndKey.set(`${family}/${key}`, gruppe);
    const item = findItem(part.item);
    check(`${part.id}: item definition carries the same textKey`, item?.textKey === ist, String(item?.textKey));
  }
}

for (const [gruppe, keys] of jeFamilieUndKey) check(`${gruppe}: one key for male and female`, keys.size === 1, [...keys].join(' | '));

for (const key of erwartet) {
  check(`${key}: text in de`, typeof de[key] === 'string' && de[key].trim() !== '');
  check(`${key}: text in en`, typeof en[key] === 'string' && en[key].trim() !== '');
}

// F1: no German text in en.json. Same text in de and en is only allowed for proper names (listed, with reason);
// en must contain no umlaut or sharp s.
const GLEICHE_EIGENNAMEN: ReadonlyMap<string, string> = new Map([
  ['inhalt.set.ironward', 'invented proper name, identical in both languages'],
  ['inhalt.set.seidraven', 'invented proper name, identical in both languages'],
]);
for (const key of erwartet) {
  if (de[key] === en[key]) check(`${key}: identical de/en text is a listed proper name`, GLEICHE_EIGENNAMEN.has(key), en[key]);
  check(`${key}: en text has no umlaut or sharp s`, !/[äöüÄÖÜß]/.test(en[key] ?? ''), en[key]);
}
for (const key of GLEICHE_EIGENNAMEN.keys()) check(`${key}: listed proper name is really identical`, de[key] === en[key]);

for (const [name, katalogInhalt] of [['de', de], ['en', en]] as const) {
  const verwaist = Object.keys(katalogInhalt).filter(k => /^inhalt\.(item|set)\./.test(k) && k !== 'inhalt.item.beispiel' && !erwartet.has(k));
  check(`${name}.json: no orphan inhalt.item.*/inhalt.set.* key`, verwaist.length === 0, verwaist.join(', '));
}

const setKatalog = equipmentSetCatalog().sets;
check('set catalog: every set and part carries its textKey', setKatalog.every((s, i) =>
  (s as { textKey?: string }).textKey === (EQUIPMENT_SETS[i] as { textKey?: string }).textKey
  && s.parts.every((p, j) => (p as { textKey?: string }).textKey === (EQUIPMENT_SETS[i]!.parts[j] as { textKey?: string }).textKey && !!(p as { textKey?: string }).textKey)));

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS armor names: every set and part has a schema-conform key with a de and en text, no orphans');
