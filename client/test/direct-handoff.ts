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
  'an online visit without an account session returns to the CURRENT domain, not a fixed one',
  main.includes('if (!offlineMode && !accountSessionPresent)') &&
    main.includes("i18n.language === 'en' ? '/en/login' : '/de/anmelden'") &&
    // Karte D1-N2 (Angriffsbefund M-B, Rest von M5/D2): beide tragenden
    // Zeilen wörtlich verlangen, in der kommentarfreien Fassung, damit ein
    // Aufruf, der nur im Kommentar steht, oder ein `basis`, das berechnet
    // aber nicht benutzt wird, den Test rot machen — vorher genügte
    // irgendwo im Text vorkommen, das ließ genau diese beiden Mutanten
    // leben.
    mainOhneKommentare.includes('const basis = basisDomainVonSpielHost(window.location.host);') &&
    mainOhneKommentare.includes('new URL(loginPath, `${window.location.protocol}//${basis}`)') &&
    // Jedes andere `new URL(loginPath, …` ausschließen — auch mit fremder
    // Adresse als Template-Literal (Angriffsbefund DH3).
    (mainOhneKommentare.match(/new URL\(\s*loginPath\s*,/g) ?? []).length === 1,
);
check(
  'a connection failure uses the same website recovery path',
  main.includes('the website that issued the session') &&
    main.includes('window.location.replace(websiteLoginUrl(Boolean(reason)))'),
);

console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
