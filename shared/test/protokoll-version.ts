/**
 * Handshake version: a world with a biome that older clients do not know demands a newer client.
 * Handshake-Version: Eine Welt mit einem Biom, das aeltere Clients nicht kennen, verlangt einen neueren Client.
 *
 *   npx tsx shared/test/protokoll-version.ts   (from the repo root)
 */
import { BIOM_AB_PROTOKOLLVERSION, PROTOCOL_VERSION, PROTOCOL_VERSION_BASIS, darfLayoutBekommen, mindestProtokollVersion, PROTOKOLL_KOPF, protokollVersionAusKopf, serverVersionFuerMeldung, veraltetMeldung } from '../src/protokollVersion.js';
import { BIOME_BY_NAME, sanitizeWorldLayout } from '../src/worldlayout/index.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else console.log(`ok   ${name}`);
}

const region = (id: string, biome: unknown) => ({ id, biome, shape: { kind: 'circle', x: 0, z: 0, radius: 500 } });

check('base version 2, current version 3', PROTOCOL_VERSION_BASIS === 2 && PROTOCOL_VERSION === 3);
check('world without greyglen: base version', mindestProtokollVersion({ regions: [region('a', 'grassland'), region('b', 'mountain')] }) === 2);
check('world with greyglen: version 3', mindestProtokollVersion({ regions: [region('a', 'grassland'), region('b', 'greyglen')] }) === 3);
check('greyglen in a single region is enough, at any position', mindestProtokollVersion({ regions: [region('a', 'greyglen'), region('b', 'swamp')] }) === 3);
check('garbage layouts stay at the base version', [null, undefined, 5, 'x', {}, { regions: 'x' }, { regions: [null, 3, {}, { biome: 7 }] }].every((l) => mindestProtokollVersion(l) === 2));
check('spelling is exact (no silent match)', mindestProtokollVersion({ regions: [region('a', 'Greyglen'), region('b', ' greyglen')] }) === 2);
check('the current version satisfies every world', [...BIOM_AB_PROTOKOLLVERSION.values()].every((v) => v <= PROTOCOL_VERSION));

// Every biome name the sanitizer knows but the base client does not must demand a newer client.
// The base client knows exactly these eight names (the table before the greyglen bit).
const BASIS_BIOME = ['grassland', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth'];
const neu = [...BIOME_BY_NAME.keys()].filter((n) => !BASIS_BIOME.includes(n));
check('every biome newer than the base client is listed with a version', neu.length > 0 && neu.every((n) => (BIOM_AB_PROTOKOLLVERSION.get(n) ?? 0) > PROTOCOL_VERSION_BASIS), neu.join(','));
check('listed names exist in the sanitizer (no dead entry)', [...BIOM_AB_PROTOKOLLVERSION.keys()].every((n) => BIOME_BY_NAME.has(n as never)));

// The raw check and the sanitizer agree on what a greyglen region is.
const doc = { version: 1, name: 't', detailSeed: 'x', continents: [{ id: 'c', name: 'C' }], regions: [{ ...region('g', 'greyglen'), continentId: 'c', edgeFalloff: 300 }] };
check('a document the sanitizer keeps with greyglen demands version 3', sanitizeWorldLayout(doc)?.regions[0]?.biome === 'greyglen' && mindestProtokollVersion(doc) === 3);

const mitGrau = { regions: [region('g', 'greyglen')] };
check('darfLayoutBekommen: 2 may not have greyglen, 3 may, 2 may have the rest', !darfLayoutBekommen(2, mitGrau) && darfLayoutBekommen(3, mitGrau) && darfLayoutBekommen(2, { regions: [region('a', 'swamp')] }) && !darfLayoutBekommen(1, {}));
check('serverVersionFuerMeldung: too new names the current version, otherwise the minimum', serverVersionFuerMeldung(PROTOCOL_VERSION + 1, 2) === PROTOCOL_VERSION && serverVersionFuerMeldung(1, 2) === 2 && serverVersionFuerMeldung(2, 3) === 3);
const meldung = veraltetMeldung(2, 3);
check('veraltetMeldung: German and English from the catalogue, both with the numbers', meldung === 'Client-Version veraltet (Client v2, Server v3) — bitte Seite neu laden / Client version outdated (client v2, server v3) — please reload the page', meldung);

check('header name', PROTOKOLL_KOPF === 'x-wov-protokoll');
check('protokollVersionAusKopf: plain numbers', protokollVersionAusKopf('3') === 3 && protokollVersionAusKopf(' 3 ') === 3 && protokollVersionAusKopf('2') === 2 && protokollVersionAusKopf('7') === 7);
check('protokollVersionAusKopf: no header, repeated header, garbage and below-base count as the base version (seven digits or more too)',
  [undefined, ['3', '3'], '', 'abc', '3x', '-3', '3.5', '1e1', '1', '0', '9999999'].every((w) => protokollVersionAusKopf(w as never) === 2));

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nprotokoll-version: alle Pruefungen gruen');
