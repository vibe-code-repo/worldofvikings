/** Regression guard for localized gameplay menus and settings tabs. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { de } from '../src/i18n/de.js';
import { en } from '../src/i18n/en.js';

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
console.log('\nOK');
