/** Regression guard for the website language hand-off to the game. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { de } from '../src/i18n/de.js';
import { en } from '../src/i18n/en.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(HERE, '..', '..');
const main = readFileSync(resolve(repoRoot, 'client/src/main.ts'), 'utf8');
const account = readFileSync(resolve(repoRoot, 'wov-web/src/lib/account.ts'), 'utf8');
const createPage = readFileSync(
  resolve(repoRoot, 'wov-web/src/routes/[lang=lang]/erstellen/+page.svelte'),
  'utf8',
);
const accountPage = readFileSync(
  resolve(repoRoot, 'wov-web/src/routes/[lang=lang]/konto/+page.svelte'),
  'utf8',
);

console.log('\nLoading-screen language hand-off');

assert.deepEqual({
  title: de['loading.title'],
  building: de['loading.building'],
  ready: de['loading.ready'],
}, {
  title: 'Die Welt erwacht…',
  building: 'Gelände wird aufgebaut',
  ready: 'Bereit',
});
assert.deepEqual({
  title: en['loading.title'],
  building: en['loading.building'],
  ready: en['loading.ready'],
}, {
  title: 'The world awakens…',
  building: 'Building the terrain',
  ready: 'Ready',
});
assert.match(account, /searchParams\.set\('lang', language\)/);
// Beide Wege reichen die Sprache seit `enterGame()` (Anmeldung ohne
// Ticket-Sprung) weiter — gleichursprung schreibt sie relativ ins Ziel,
// fremdursprung faellt intern auf `playUrl()` zurueck; beides steckt in
// `enterGame` selbst, s. `assert.match(account, ...)` unten.
assert.match(createPage, /enterGame\(gestade, ticket\.sessionToken, lang, zeit/);
assert.match(accountPage, /enterGame\(shore, ticket\.sessionToken, lang/);
assert.match(account, /spiel\.searchParams\.set\('lang', language\)/);
assert.match(main, /new GameI18n\(ausAdresse\.get\('lang'\)\)/);
assert.match(main, /new LoadingScreen\(i18n\)/);

console.log('  ✓ German and English copy are complete');
console.log('  ✓ both website launch paths pass their URL language to the game');
console.log('  ✓ the game applies that language to its loading screen');
console.log('\nOK');
