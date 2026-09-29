/**
 * Server message keys reach the client translated (Tod und Treffer N1, B4): the server sends `@tod.bett_verloren`
 * in the message field of InteractResult, `GameI18n.serverMeldung` shows the catalogue text in the game
 * language; plain texts (the older server messages) and unknown keys pass through unchanged.
 *
 * Run: npx tsx client/test/tod-treffer-meldung.ts
 */
import { SERVER_MELDUNG_BETT_VERLOREN } from '@wov/shared';
import de from '../src/i18n/katalog/de.json';
import en from '../src/i18n/katalog/en.json';

(globalThis as { document?: unknown }).document = { documentElement: {} };
const { GameI18n } = await import('../src/i18n/index.js');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const deutsch = new GameI18n('de');
const englisch = new GameI18n('en');
check('the key is in both catalogues', de['tod.bett_verloren'] === 'Dein Schlafplatz ist nicht mehr da' && en['tod.bett_verloren'] === 'Your bed is gone');
check('the server constant is "@" + that key', SERVER_MELDUNG_BETT_VERLOREN === '@tod.bett_verloren');
check('de: the key becomes the German text', deutsch.serverMeldung(SERVER_MELDUNG_BETT_VERLOREN) === de['tod.bett_verloren'], deutsch.serverMeldung(SERVER_MELDUNG_BETT_VERLOREN));
check('en: the key becomes the English text', englisch.serverMeldung(SERVER_MELDUNG_BETT_VERLOREN) === en['tod.bett_verloren'], englisch.serverMeldung(SERVER_MELDUNG_BETT_VERLOREN));
check('a plain server text passes through', englisch.serverMeldung('Du bist gestorben') === 'Du bist gestorben');
check('an unknown key passes through (no crash, no "undefined")', englisch.serverMeldung('@gibt.es.nicht') === '@gibt.es.nicht' && englisch.serverMeldung('@constructor') === '@constructor');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
