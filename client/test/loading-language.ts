/** Regression guard for the website language hand-off to the game. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOADING_SCREEN_TEXT } from '../src/ui/LoadingScreen.js';

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

assert.deepEqual(LOADING_SCREEN_TEXT.de, {
  title: 'Die Welt erwacht…',
  building: 'Gelände wird aufgebaut',
  ready: 'Bereit',
});
assert.deepEqual(LOADING_SCREEN_TEXT.en, {
  title: 'The world awakens…',
  building: 'Building the terrain',
  ready: 'Ready',
});
assert.match(account, /searchParams\.set\('lang', language\)/);
assert.match(createPage, /playUrl\(gestade, ticket\.sessionToken, lang, zeit\)/);
assert.match(accountPage, /playUrl\(shore, ticket\.sessionToken, lang\)/);
assert.match(main, /new LoadingScreen\(gameLanguage\)/);

console.log('  ✓ German and English copy are complete');
console.log('  ✓ both website launch paths pass their URL language to the game');
console.log('  ✓ the game applies that language to its loading screen');
console.log('\nOK');
