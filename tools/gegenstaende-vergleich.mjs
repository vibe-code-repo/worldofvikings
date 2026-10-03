/**
 * Witness for "items moved into the data file behave the same" (GD1). Read-only: it writes one JSON file
 * and a report to stdout, nothing else.
 * Zeuge fuer "in die Datendatei gezogene Gegenstaende verhalten sich gleich" (GD1). Nur lesend.
 *
 *   node_modules/.bin/tsx tools/gegenstaende-vergleich.mjs messen <root> <out.json>
 *       <root> = a checkout (or `git archive`) with shared/ and server/; writes the measurement.
 *   node_modules/.bin/tsx tools/gegenstaende-vergleich.mjs vergleichen <alt.json> <neu.json>
 *       compares two measurements (D1-D3, D6); exit code 1 on any red line.
 *
 * Allowed differences (the list below is complete): the new fields `textKey`, `datenItem`, `modellSkala`,
 * an empty `ernte` / `stats` where there was none, `toolTier` 1 -> 0 on four weapons (nobody reads the field)
 * and the English display names (new on purpose).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOOLTIER_AUSNAHMEN = new Set(['AxeFlint', 'SwordNorth', 'Staff', 'Spear']);
/** Source files whose item-name literals are collected (D3: references resolve through `findItem`). */
const VERWEISDATEIEN = [
  'server/src/spiel/Beute.ts',
  'server/src/konto/StarterSet.ts',
  'server/src/WovServer.ts',
  'client/src/main.ts',
  'shared/src/items/PieceTable.ts',
  'shared/src/equipmentSets.ts',
];

const sortiert = (v) => {
  if (Array.isArray(v)) return v.map(sortiert);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortiert(v[k])]));
  return v;
};
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function messen(wurzel, ziel) {
  const root = path.resolve(wurzel);
  const laden = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const shared = await laden('shared/src/index.ts');
  const { ITEMS_BY_NAME, ITEM_DEFS, findItem, REZEPTE, anzeigeName, ESSEN, PIECES } = shared;
  const { datenRezepte } = await laden('shared/src/items/gegenstandsDaten.ts');
  const namen = [...ITEMS_BY_NAME.keys()];
  const items = {};
  for (const n of namen) items[n] = sortiert(JSON.parse(JSON.stringify(findItem(n))));
  const anzeige = {};
  for (const n of namen) anzeige[n] = { de: anzeigeName(findItem(n), 'de'), en: anzeigeName(findItem(n), 'en') };

  const rezeptListe = [...REZEPTE, ...datenRezepte()].map((r) => sortiert({ ergebnis: r.ergebnis, menge: r.menge, zutaten: r.zutaten }));

  // D3: every item name that other code mentions as a quoted literal, per source file
  const namenSet = new Set(namen);
  const verweise = {};
  for (const rel of VERWEISDATEIEN) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const gefunden = new Set();
    for (const m of text.matchAll(/['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) if (namenSet.has(m[1])) gefunden.add(m[1]);
    verweise[rel] = [...gefunden].sort();
  }
  const beute = await laden('server/src/spiel/Beute.ts');
  const baukosten = {};
  for (const [k, p] of Object.entries(PIECES)) baukosten[k] = (p.resources ?? []).map((r) => `${r.item}:${r.amount}`);

  const aufgeloest = {};
  for (const namenListe of Object.values(verweise)) for (const n of namenListe) aufgeloest[n] = hash(items[n]);

  const aus = {
    wurzel: root,
    itemDefsAnzahl: ITEM_DEFS.length,
    itemDefsHash: hash(ITEM_DEFS),
    itemsByNameAnzahl: namen.length,
    reihenfolge: namen,
    items,
    anzeige,
    rezepte: rezeptListe,
    rezeptReihenfolge: rezeptListe.map((r) => r.ergebnis),
    verweise,
    aufgeloest,
    zweitDrops: sortiert(beute.ZWEIT_DROPS),
    baukosten: sortiert(baukosten),
    essen: sortiert(ESSEN),
  };
  fs.writeFileSync(ziel, `${JSON.stringify(aus, null, 1)}\n`);
  console.log(`gemessen: ${aus.itemsByNameAnzahl} Gegenstaende (ITEM_DEFS ${aus.itemDefsAnzahl}), ${rezeptListe.length} Rezepte -> ${ziel}`);
}

function vergleichen(altPfad, neuPfad) {
  const alt = JSON.parse(fs.readFileSync(altPfad, 'utf8'));
  const neu = JSON.parse(fs.readFileSync(neuPfad, 'utf8'));
  let rot = 0;
  const melde = (ok, text) => { console.log(`${ok ? 'OK ' : 'ROT'} ${text}`); if (!ok) rot++; };

  // D1: per item, per field
  const felder = {};
  const feld = (k) => (felder[k] ??= { gleich: 0, erlaubt: 0, rot: 0 });
  const ausnahmen = [];
  let gleichAlle = 0;
  const alleNamen = new Set([...Object.keys(alt.items), ...Object.keys(neu.items)]);
  for (const n of alleNamen) {
    const a = alt.items[n];
    const b = neu.items[n];
    if (!a || !b) { melde(false, `D1 ${n}: nur in ${a ? 'alt' : 'neu'}`); continue; }
    let identisch = true;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = JSON.stringify(a[k]);
      const vb = JSON.stringify(b[k]);
      if (va === vb) { feld(k).gleich++; continue; }
      identisch = false;
      let erlaubt = false;
      if (k === 'textKey' && a[k] === undefined && typeof b[k] === 'string') erlaubt = true;
      else if (k === 'datenItem' && a[k] === undefined && b[k] === true) erlaubt = true;
      else if (k === 'modellSkala' && a[k] === undefined && b[k] === 1) erlaubt = true;
      else if ((k === 'ernte' || k === 'stats') && a[k] === undefined && vb === '{}') erlaubt = true;
      else if (k === 'toolTier' && a[k] === 1 && b[k] === 0 && TOOLTIER_AUSNAHMEN.has(n)) erlaubt = true;
      if (erlaubt) { feld(k).erlaubt++; ausnahmen.push(`${n}.${k}`); } else { feld(k).rot++; melde(false, `D1 ${n}.${k}: alt ${va} / neu ${vb}`); }
    }
    if (identisch) gleichAlle++;
  }
  console.log(`D1 ${Object.keys(alt.items).length} alt / ${Object.keys(neu.items).length} neu Gegenstaende, ${gleichAlle} byte-gleich, Rest nur mit erlaubten Unterschieden oder rot`);
  for (const [k, v] of Object.entries(felder).sort()) console.log(`   Feld ${k.padEnd(18)} gleich ${String(v.gleich).padStart(3)}  erlaubt abweichend ${String(v.erlaubt).padStart(3)}  rot ${v.rot}`);
  melde(Object.keys(alt.items).length === Object.keys(neu.items).length, `D1 gleiche Zahl an Gegenstaenden (${Object.keys(alt.items).length})`);
  melde(JSON.stringify([...Object.keys(alt.items)].sort()) === JSON.stringify([...Object.keys(neu.items)].sort()), 'D1 gleiche Kennungen');
  const reihenfolgeGleich = JSON.stringify(alt.reihenfolge) === JSON.stringify(neu.reihenfolge);
  console.log(`   Karten-Reihenfolge (ITEMS_BY_NAME) ${reihenfolgeGleich ? 'gleich' : 'GEAENDERT (Grundbestand steht nach der Kleidung, Rezept-Gegenstaende zuerst, siehe Bericht)'}`);

  // Display names: de identical, en only new
  const deAbw = Object.keys(alt.anzeige).filter((n) => alt.anzeige[n].de !== neu.anzeige[n]?.de);
  melde(deAbw.length === 0, `D1 deutsche Anzeigenamen gleich (${Object.keys(alt.anzeige).length} geprueft, ${deAbw.length} abweichend ${deAbw.join(',')})`);
  const enNeu = Object.keys(alt.anzeige).filter((n) => alt.anzeige[n].en !== neu.anzeige[n]?.en);
  console.log(`   englische Anzeigenamen neu: ${enNeu.length} (erlaubt: ${enNeu.join(', ')})`);

  // D2: recipes as a set, and the order of the craft list
  const ser = (l) => l.map((r) => JSON.stringify(r)).sort();
  melde(JSON.stringify(ser(alt.rezepte)) === JSON.stringify(ser(neu.rezepte)), `D2 Rezepte als Menge gleich (${alt.rezepte.length} alt / ${neu.rezepte.length} neu)`);
  melde(JSON.stringify(alt.rezeptReihenfolge) === JSON.stringify(neu.rezeptReihenfolge), `D2 Reihenfolge der Herstellliste gleich: ${neu.rezeptReihenfolge.join(', ')}`);

  // D3: references
  for (const rel of Object.keys(alt.verweise)) {
    melde(JSON.stringify(alt.verweise[rel]) === JSON.stringify(neu.verweise[rel]), `D3 Namensverweise in ${rel}: ${alt.verweise[rel].length} alt / ${neu.verweise[rel]?.length} neu`);
  }
  const aufgeloestAbw = Object.keys(alt.aufgeloest).filter((n) => !neu.aufgeloest[n] || (alt.items[n] && JSON.stringify(Object.keys(alt.items[n]).filter((k) => neu.items[n]?.[k] === undefined)) !== '[]'));
  melde(Object.keys(neu.aufgeloest).length === Object.keys(alt.aufgeloest).length && aufgeloestAbw.length === 0,
    `D3 jeder verwiesene Name loest ueber findItem auf: ${Object.keys(alt.aufgeloest).length} alt / ${Object.keys(neu.aufgeloest).length} neu`);
  melde(JSON.stringify(alt.zweitDrops) === JSON.stringify(neu.zweitDrops), `D3 ZWEIT_DROPS gleich (${Object.keys(alt.zweitDrops).length} Eintraege)`);
  melde(JSON.stringify(alt.baukosten) === JSON.stringify(neu.baukosten), `D3 Baukosten aller Bauteile gleich (${Object.keys(alt.baukosten).length} Teile)`);
  melde(JSON.stringify(alt.essen) === JSON.stringify(neu.essen), `D3 ESSEN gleich (${Object.keys(alt.essen).length} Eintraege)`);

  // D6: hash and counts
  console.log(`D6 ITEM_DEFS: alt ${alt.itemDefsAnzahl} Eintraege Hash ${alt.itemDefsHash.slice(0, 12)}; neu ${neu.itemDefsAnzahl} Eintraege Hash ${neu.itemDefsHash.slice(0, 12)}`);
  console.log(`   ITEMS_BY_NAME: alt ${alt.itemsByNameAnzahl} / neu ${neu.itemsByNameAnzahl}`);
  melde(alt.itemsByNameAnzahl === neu.itemsByNameAnzahl, 'D6 Zahl der Gegenstaende gleich');
  console.log(`Ausnahmen (erlaubt): ${ausnahmen.length}`);
  console.log(rot === 0 ? 'ERGEBNIS: gleich (nur erlaubte Unterschiede)' : `ERGEBNIS: ${rot} rote Zeilen`);
  process.exitCode = rot === 0 ? 0 : 1;
}

const [modus, a, b] = process.argv.slice(2);
if (modus === 'messen' && a && b) await messen(a, b);
else if (modus === 'vergleichen' && a && b) vergleichen(a, b);
else { console.error('Aufruf: messen <root> <out.json> | vergleichen <alt.json> <neu.json>'); process.exitCode = 2; }
