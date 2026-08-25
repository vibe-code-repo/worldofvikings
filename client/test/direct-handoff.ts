/**
 * Regression guard for the account-to-game hand-off.
 *
 * The public website opens the game with a session ticket. The legacy
 * connection panel used to remain visible during the WebSocket handshake,
 * even though no choice was left for the player. It has now been removed:
 * online play requires an account session and failure returns to wov-web.
 *
 * This intentionally checks the shipped HTML and the ordering in main.ts.
 * A DOM test would start the full Babylon client; these are the small,
 * load-bearing invariants that matter before that bundle can even run.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(HERE, '..');
const html = readFileSync(resolve(clientRoot, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(resolve(clientRoot, 'src/main.ts'), 'utf8');

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failures++;
}

console.log('\nDirect account hand-off');

check('the legacy connection screen is absent from the shipped HTML', !html.includes('connect-screen'));
check('the legacy connect button is absent from the shipped HTML', !html.includes('connect-btn'));
check('the legacy character preview is absent from the shipped HTML', !html.includes('vorschau-canvas'));
check('main.ts no longer looks up legacy connection controls', !/getElementById\('(connect-screen|connect-btn|player-name|server-url)'\)/.test(main));
check(
  'an online visit without an account session returns to wov-web',
  main.includes('if (!offlineMode && !accountSessionPresent)') &&
    main.includes("new URL('/de/anmelden', 'https://world-of-vikings.com')"),
);
check(
  'a connection failure uses the same website recovery path',
  main.includes('the website that issued the session') &&
    main.includes('window.location.replace(websiteLoginUrl(Boolean(reason)))'),
);

console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
