/** Regression guard for localized gameplay menus and settings tabs. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import de from '../src/i18n/katalog/de.json';
import en from '../src/i18n/katalog/en.json';
import { isGameLocale } from '../src/i18n/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(HERE, '..');
const source = (path: string): string => readFileSync(resolve(clientRoot, path), 'utf8');

console.log('\nIn-game menu localization');

assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
assert.ok(Object.keys(de).length >= 90, 'the central catalogue unexpectedly lost menu ids');

const i18n = source('src/i18n/index.ts');
assert.match(i18n, /const CATALOGUES = \{ de, en \} as const/);
assert.match(i18n, /localStorage\.setItem\(STORAGE_KEY, language\)/);
assert.match(i18n, /url\.searchParams\.set\('lang', language\)/);

const settings = source('src/ui/SettingsPanel.ts');
assert.match(settings, /type TabId = 'general' \| 'graphics' \| 'effects'/);
assert.match(settings, /select\.id = 'game-language'/);
assert.match(settings, /this\.i18n\.setLanguage/);
assert.match(settings, /button\.dataset\.settingsTab = tab/);
assert.match(settings, /general: 'settings\.tab\.general'/);
assert.match(settings, /graphics: 'settings\.tab\.graphics'/);
assert.match(settings, /effects: 'settings\.tab\.effects'/);

const main = source('src/main.ts');
for (const panel of [
  'Hud', 'CraftingPanel', 'CharakterPanel', 'ChatPanel', 'SettingsPanel',
  'InventoryPanel', 'ContainerPanel', 'PieceSelection', 'WorldMap', 'LoadingScreen',
]) {
  assert.match(main, new RegExp(`new ${panel}\\(`));
}
assert.doesNotMatch(main, /type GameLanguage|gameLanguage/);

console.log('  ✓ German and English catalogues have identical ids');
console.log('  ✓ language changes persist and update the URL');
console.log('  ✓ settings expose General, Graphics I and Graphics II');
console.log('  ✓ gameplay menus share the runtime language service');

console.log('\nContent texts (`inhalt.*`) reach the client (M1 point 3a / N1 F4)');

// Wiring: `tInhalt()` reads its key through shared's `inhaltText()`, keyed on
// the currently selected game language, and its parameter type
// (`InhaltSchluessel`, from `@wov/shared`) makes an unknown content key fail
// at typecheck time, not at runtime. `inhaltText()` itself, including the
// example entry in both languages, is exercised directly in
// `shared/test/i18n-katalog.ts` (same call, same fallback behaviour) — a
// second, DOM-dependent instance here would need jsdom for no extra proof,
// since `GameI18n`'s constructor touches `document`/`localStorage`.
assert.match(i18n, /import \{ inhaltText, type InhaltSchluessel \} from '@wov\/shared'/);
assert.match(i18n, /tInhalt\(key: InhaltSchluessel\): string \{\s*return inhaltText\(key, this\.current\);\s*\}/);

// t() itself must stay exactly the client-catalogue lookup it always was —
// the new inhalt.* path is a separate method, not a branch inside t().
assert.match(i18n, /t\(key: TranslationKey, variables: TranslationVars = \{\}\): string \{\s*return CATALOGUES\[this\.current\]\[key\]\.replace/);

console.log('  ✓ tInhalt() exists, is typed on InhaltSchluessel and reads through inhaltText()');
console.log('  ✓ t() itself is untouched');

console.log('\nisGameLocale() hardening against prototype-name inputs (N1 F7)');

// `value in CATALOGUES` used to resolve inherited Object.prototype names
// (`constructor`, `toString`, `__proto__`, `hasOwnProperty`) to `true`,
// which crashed `t()` on `CATALOGUES[that].someKey`. `Object.hasOwn` only
// looks at own properties, so these all become `false` (unknown locale),
// while the two real locales still pass.
assert.equal(isGameLocale('de'), true);
assert.equal(isGameLocale('en'), true);
assert.equal(isGameLocale('fr'), false);
assert.equal(isGameLocale(null), false);
assert.equal(isGameLocale(undefined), false);
assert.equal(isGameLocale('constructor'), false);
assert.equal(isGameLocale('__proto__'), false);
assert.equal(isGameLocale('toString'), false);
assert.equal(isGameLocale('hasOwnProperty'), false);
assert.equal(isGameLocale('valueOf'), false);

console.log('  ✓ real locales pass, prototype-name lookalikes do not');

console.log('\nOK');
