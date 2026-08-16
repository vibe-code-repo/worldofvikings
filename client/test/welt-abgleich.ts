/**
 * Der Wächter gegen den Unfall vom 16.08.2026, 07:36 Uhr.
 *
 * An jenem Morgen hat der Editor die echte Welt — 17 Regionen, 164
 * Platzierungen — durch ein 4-Regionen-Testlayout ersetzt. Niemand hat es
 * gemerkt, bis Stunden später ein Determinismus-Test rot wurde. Gerettet
 * hat die Welt nur, dass sie zufällig auch in einem Git-Commit stand.
 *
 * Die Ursache war nicht der Speichervorgang, sondern das FEHLEN eines
 * Ladewegs: `ladeEntwurf()` las ausschliesslich aus dem localStorage. Der
 * Editor kannte den Stand auf der Platte gar nicht und konnte ihn deshalb
 * auch nicht als abweichend melden. Seit es zwei Weltdateien gibt
 * (welten/dev.json und welten/live.json), waere derselbe Fehler schlimmer:
 * Der localStorage haengt am BROWSER, nicht an der Instanz — derselbe Tab
 * kann den Dev-Entwurf nach live.json schreiben.
 *
 * Geprueft wird hier die Logik, die das jetzt verhindert:
 *
 *  1. `gleich()` erkennt Gleichheit ueber den Sanitizer, nicht ueber
 *     Feldvergleiche von Hand — zwei Dokumente, die sich nur in
 *     Schluesselreihenfolge oder Formatierung unterscheiden, sind gleich.
 *  2. Der Unfall selbst wird als Verlust erkannt, und die Zahlen, an denen
 *     man ihn gesehen haette, stehen in der Gegenueberstellung.
 *  3. Der HEIMTUECKISCHE Fall: eine Region geloescht, eine neue angelegt.
 *     Die Zaehler bleiben identisch (17 = 17) — wer nur Zahlen vergleicht,
 *     sieht nichts. Namentlich aufgeschluesselt faellt es sofort auf.
 *  4. Regionen und Platzierungen erscheinen IMMER in der Tafel, auch wenn
 *     sie uebereinstimmen. Eine Tafel, die bei Gleichheit leer bleibt,
 *     laesst den Nutzer im Zweifel, ob sie ueberhaupt gelaufen ist.
 *
 * Der Test ist DOM-frei und kommt ohne Browser, Assets und GPU aus — das
 * ist die Bedingung, um in der KERN-Liste zu stehen.
 *
 * Lauf:  npx tsx client/test/welt-abgleich.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gleich, kanon, vergleiche, type Unterschied } from '../src/editor/weltdokument';
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

/** Die echte Welt von der Platte — kein Testdatensatz, das Bestandsdokument. */
const echt = sanitizeWorldLayout(
  JSON.parse(readFileSync(resolve(WURZEL, 'server/data/welten/dev.json'), 'utf-8'))
)!;

/** Das Testlayout vom 16.08., nachgebaut: wenige Regionen, keine Platzierungen. */
const unfall: WorldLayout = {
  version: 1,
  name: 'World of Vikings',
  detailSeed: 'wov-alpha',
  continents: [],
  regions: echt.regions.slice(0, 4).map((r) => ({ ...r, placements: undefined })),
  placements: [],
};

function zeile(u: readonly Unterschied[], feld: string): Extract<Unterschied, { art: 'zeile' }> | undefined {
  return u.find((z): z is Extract<Unterschied, { art: 'zeile' }> => z.art === 'zeile' && z.feld === feld);
}

console.log('\n[1] Gleichheit laeuft ueber den Sanitizer');
{
  check('das Bestandsdokument ist sich selbst gleich', gleich(echt, echt));
  // Dieselben Daten, andere Schluesselreihenfolge. Ueber Object.entries
  // umgedreht statt per Spread zusammengesetzt — ein Spread mit doppeltem
  // Schluessel ueberschreibt sich selbst und haette gar nichts umsortiert.
  const umsortiert = JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(echt).reverse()))
  );
  check('Schluesselreihenfolge aendert nichts', gleich(echt, umsortiert));
  check('kanon() ist stabil', kanon(echt) === kanon(umsortiert));
  check('Muell hat keine Kanonform', kanon({ nichts: true }) === null);
  check('Muell ist niemandem gleich', !gleich(echt, { nichts: true }));
}

console.log('\n[2] Der Unfall vom 16.08. wird als Verlust erkannt');
{
  check('Unfall ist NICHT gleich dem Bestand', !gleich(echt, unfall));
  const u = vergleiche(echt, unfall);
  const reg = zeile(u, 'Regionen');
  const pla = zeile(u, 'Platzierungen');
  check('Regionen stehen in der Tafel', reg !== undefined);
  check('… mit den echten Zahlen', reg?.server === '17' && reg?.entwurf === '4',
    `${reg?.server} → ${reg?.entwurf}`);
  check('… und als VERLUST markiert', reg?.schwer === true);
  check('Platzierungen stehen in der Tafel', pla !== undefined);
  check('… und als Verlust markiert', pla?.schwer === true,
    `${pla?.server} → ${pla?.entwurf}`);
  check('mindestens ein Hinweis nennt die fehlenden Regionen',
    u.some((z) => z.art === 'hinweis' && z.schwer));
}

console.log('\n[3] Der heimtueckische Fall: Zaehler gleich, Inhalt anders');
{
  // Eine Region raus, eine neue rein — 17 bleibt 17.
  const getauscht: WorldLayout = {
    ...echt,
    regions: [
      ...echt.regions.slice(1),
      { ...echt.regions[0], id: 'insel-neu' },
    ],
  };
  check('Zaehler sind identisch', getauscht.regions.length === echt.regions.length,
    `${echt.regions.length} = ${getauscht.regions.length}`);
  check('gleich() erkennt die Abweichung trotzdem', !gleich(echt, getauscht));
  const u = vergleiche(echt, getauscht);
  const text = u.map((z) => (z.art === 'hinweis' ? z.text : `${z.feld} ${z.server}/${z.entwurf}`)).join(' | ');
  check('die verschwundene Region wird namentlich genannt',
    text.includes(echt.regions[0].id), echt.regions[0].id);
  check('die neue Region wird namentlich genannt', text.includes('insel-neu'));
}

console.log('\n[4] Die Tafel schweigt nicht bei Gleichheit');
{
  const u = vergleiche(echt, echt);
  check('Regionen stehen auch bei Gleichheit da', zeile(u, 'Regionen') !== undefined);
  check('Platzierungen stehen auch bei Gleichheit da', zeile(u, 'Platzierungen') !== undefined);
  check('nichts davon ist als Verlust markiert',
    u.every((z) => z.schwer === false));
}

console.log(`\n${fehler === 0 ? 'OK' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler === 0 ? 0 : 1);
