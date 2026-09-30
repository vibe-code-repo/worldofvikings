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
import ts from 'typescript';
import { websiteLoginUrl } from '../src/net/websiteLogin';

const HERE = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(HERE, '..');
const html = readFileSync(resolve(clientRoot, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(resolve(clientRoot, 'src/main.ts'), 'utf8');

/**
 * Strips `//` and `/* *\/` comments from a TS source string via the real
 * TypeScript scanner, not a text regex — a naive `//`-to-end-of-line regex
 * would also eat the `//` inside a template literal such as
 * `` `${window.location.protocol}//${basis}` ``, which is exactly the line
 * this test needs to see intact (Angriffsbefund M-B / D2: a call hidden in
 * a comment, or a real call left unused next to a hardcoded URL, must both
 * turn this test red — neither is possible without first removing real
 * comments while leaving template-literal text alone).
 *
 * `reScanTemplateToken` is required because the default scanner, once past
 * a template's `${…}` substitution, only sees the closing `}` as an
 * ordinary brace and would otherwise resume "normal" scanning right where
 * the template's own `//` text begins — the brace-depth stack below is
 * exactly what the TypeScript parser itself tracks to know when a `}`
 * closes a substitution instead of an object or block.
 */
function ohneKommentare(quelle: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, quelle);
  const bereiche: Array<[number, number]> = [];
  const vorlagenKlammerStapel: number[] = [];
  let klammerTiefe = 0;

  let token = scanner.scan();
  for (;;) {
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      bereiche.push([scanner.getTokenStart(), scanner.getTextPos()]);
    } else if (token === ts.SyntaxKind.TemplateHead) {
      vorlagenKlammerStapel.push(klammerTiefe);
      klammerTiefe = 0;
    } else if (token === ts.SyntaxKind.OpenBraceToken) {
      klammerTiefe++;
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      if (klammerTiefe === 0 && vorlagenKlammerStapel.length > 0) {
        token = scanner.reScanTemplateToken(false);
        klammerTiefe = vorlagenKlammerStapel.pop() as number;
        if (token === ts.SyntaxKind.TemplateMiddle) {
          vorlagenKlammerStapel.push(klammerTiefe);
          klammerTiefe = 0;
        }
        continue;
      }
      klammerTiefe--;
    }
    token = scanner.scan();
  }

  let ergebnis = '';
  let cursor = 0;
  for (const [start, ende] of bereiche) {
    ergebnis += quelle.slice(cursor, start);
    cursor = ende;
  }
  ergebnis += quelle.slice(cursor);
  return ergebnis;
}

const mainOhneKommentare = ohneKommentare(main);

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
  'an online visit without an account session takes the way back through net/websiteLogin',
  main.includes('if (!offlineMode && !accountSessionPresent)') &&
    main.includes("from './net/websiteLogin'") &&
    mainOhneKommentare.includes('websiteLoginUrlFuer(window.location, i18n.language, expired)') &&
    // main.ts builds no login URL of its own any more (Angriffsbefund DH3).
    !/new URL\(\s*loginPath\s*,/.test(mainOhneKommentare),
);

// Karte D1-R (DH7-DH10): the behaviour of the way back, by running it.
const ws = (protocol: string, host: string, language = 'de', expired = false): URL =>
  websiteLoginUrl({ protocol, host }, language, expired);
check(
  'play.world-of-mmorpg.de:5292 returns to https://world-of-mmorpg.de with the port',
  ws('https:', 'play.world-of-mmorpg.de:5292').origin === 'https://world-of-mmorpg.de:5292',
);
check(
  'play.dev.world-of-mmorpg.de:5292 keeps the DEV shore and the `.de` domain',
  ws('https:', 'play.dev.world-of-mmorpg.de:5292').host === 'dev.world-of-mmorpg.de:5292' &&
    ws('https:', 'play.dev.world-of-mmorpg.de:5292').searchParams.get('shore') === 'dev',
);
check(
  'play.world-of-mmorpg.com returns to .com, play.world-of-mmorpg.de to .de',
  ws('https:', 'play.world-of-mmorpg.com').href === 'https://world-of-mmorpg.com/de/anmelden?shore=live' &&
    ws('https:', 'play.world-of-mmorpg.de', 'en').href === 'https://world-of-mmorpg.de/en/login?shore=live',
);
check(
  'a slot port on 127.0.0.1 stays on its own port (Angriffsbefund N1)',
  ws('http:', '127.0.0.1:5295', 'de', true).href === 'http://127.0.0.1:5295/de/anmelden?shore=live&abgelaufen=1',
);
check(
  'a foreign host falls back to the safe default domain',
  ['evil.example', 'play.evil.example', 'world-of-mmorpg.com.evil.example', 'xworld-of-mmorpg.com.evil.example:1'].every(
    (h) => ws('https:', h).origin === 'https://world-of-mmorpg.com',
  ),
);
check(
  'a host cannot smuggle another target into the URL',
  ['evil.example/x', 'a@evil.example', 'play.a@evil.example', 'evil.example\\@world-of-mmorpg.com', 'x y', 'world-of-mmorpg.com:99999', '', 'world-of-mmorpg.com#x', 'world-of-mmorpg.com?x'].every((h) => {
    const u = ws('https:', h);
    return u.origin === 'https://world-of-mmorpg.com' && u.username === '' && u.pathname === '/de/anmelden';
  }),
);
check(
  'a protocol other than http: is taken as https:',
  ws('javascript:', 'play.world-of-mmorpg.com').protocol === 'https:' && ws('ftp:', 'localhost').protocol === 'https:',
);
check(
  'a connection failure uses the same website recovery path',
  main.includes('the website that issued the session') &&
    main.includes('window.location.replace(websiteLoginUrl(Boolean(reason)))'),
);
check(
  'both ways out go through that one recovery function: the disconnect handler and the give-up after the reconnect limit (F10)',
  main.includes('zurueckZurAnmeldung(reason);') &&
    main.includes('aufgegeben: () => zurueckZurAnmeldung(),') &&
    main.split('window.location.replace(websiteLoginUrl(').length === 2,
);

console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
