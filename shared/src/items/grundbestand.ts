/**
 * The base stock: the 29 items that used to be code (tools, weapons, materials), baked in from
 * shared/data/gegenstaende.json. Importing this module (or `gegenstandsDaten.ts`, which does the work at its end)
 * applies them, so `findItem`, `ITEMS_BY_NAME`, the text layer and `datenRezepte()` know them everywhere without a
 * server round trip. Der eingebackene Grundbestand; die Arbeit steht am Ende von gegenstandsDaten.ts.
 */
export { GRUNDBESTAND, GRUNDBESTAND_IDS, grundbestandEintraege, istGrundItem, mitGrundbestand } from './gegenstandsDaten.js';
