/**
 * Serversteuerung im Editor (Mikes Befund: Neustart-Knopf blieb gesperrt,
 * sobald eine Testwelt lief) — die DOM-freie Entscheidungslogik aus
 * client/src/editor/serverSteuerung.ts, dazu (Abschnitt [5], Nachbesserung
 * N1 29.09.) die Verdrahtung in editorMain.ts selbst auf dem Syntaxbaum:
 * Der Angriff fand zwei Stellen, an denen die reinen Funktionen zwar
 * richtig sind, aber NICHT tatsaechlich benutzt werden (M10 liveKnopf.
 * disabled wieder an die Testwelt gekoppelt, M11 der aktive Zweig ruft
 * wieder testweltSchalten('starten') statt ('erneuern')) — beides blieb
 * mit den bisherigen Tests unbemerkt gruen.
 *
 * Run:  npx tsx test/editor-serversteuerung.ts    (aus client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import {
  karteLiveTestenAktion,
  neustartOptionen,
  serverKnoepfeZustand,
  serverStatusAnzeige,
} from '../src/editor/serverSteuerung';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

// ── serverKnoepfeZustand ─────────────────────────────────────────────

console.log('\n[1] serverKnoepfeZustand:');
{
  const laeuft = serverKnoepfeZustand({ dienstAktiv: true, aktionLaeuft: false });
  check('laeuft: Neustart benutzbar', laeuft.neustartBenutzbar);
  check('laeuft: Stoppen sichtbar und benutzbar', laeuft.stoppenSichtbar && laeuft.stoppenBenutzbar);
  check('laeuft: Starten nicht sichtbar', !laeuft.startenSichtbar && !laeuft.startenBenutzbar);

  const gestoppt = serverKnoepfeZustand({ dienstAktiv: false, aktionLaeuft: false });
  check('gestoppt: Neustart benutzbar (Mikes Befund — immer benutzbar ausser waehrend einer Aktion)', gestoppt.neustartBenutzbar);
  check('gestoppt: Stoppen nicht sichtbar', !gestoppt.stoppenSichtbar && !gestoppt.stoppenBenutzbar);
  check('gestoppt: Starten sichtbar und benutzbar', gestoppt.startenSichtbar && gestoppt.startenBenutzbar);

  const unbekannt = serverKnoepfeZustand({ dienstAktiv: null, aktionLaeuft: false });
  check('unbekannt: wie gestoppt behandelt (Fail-Safe, wie Boolean(stand?.aktiv) in testweltKnoepfeAktualisieren)', !unbekannt.stoppenSichtbar && unbekannt.startenSichtbar);

  const waehrendAktion = serverKnoepfeZustand({ dienstAktiv: true, aktionLaeuft: true });
  check('waehrend einer laufenden Aktion: Neustart NICHT benutzbar', !waehrendAktion.neustartBenutzbar);
  check('waehrend einer laufenden Aktion: Stoppen sichtbar, aber nicht benutzbar', waehrendAktion.stoppenSichtbar && !waehrendAktion.stoppenBenutzbar);

  const gestopptWaehrendAktion = serverKnoepfeZustand({ dienstAktiv: false, aktionLaeuft: true });
  check('gestoppt waehrend einer laufenden Aktion: Starten sichtbar, aber nicht benutzbar', gestopptWaehrendAktion.startenSichtbar && !gestopptWaehrendAktion.startenBenutzbar);
}

// ── serverStatusAnzeige ──────────────────────────────────────────────

console.log('\n[2] serverStatusAnzeige:');
{
  check('kein Zustand -> unbekannt', serverStatusAnzeige(null).art === 'unbekannt');
  const laeuft = serverStatusAnzeige({ aktiv: true, seit: 'Mon 2026-09-29 00:09:40 UTC' });
  check('aktiv -> laeuft mit seit-Text', laeuft.art === 'laeuft' && laeuft.art === 'laeuft' && laeuft.seit === 'Mon 2026-09-29 00:09:40 UTC');
  const laeuftOhneSeit = serverStatusAnzeige({ aktiv: true, seit: null });
  check('aktiv ohne seit -> "?" statt null', laeuftOhneSeit.art === 'laeuft' && laeuftOhneSeit.seit === '?');
  check('nicht aktiv -> gestoppt', serverStatusAnzeige({ aktiv: false, seit: null }).art === 'gestoppt');

  // B5 (Angriffsbefund): activating/deactivating/Abfragefehler duerfen
  // NICHT als "gestoppt" erscheinen.
  check(
    'roh=activating, aktiv=false -> wechselt (NICHT gestoppt)',
    serverStatusAnzeige({ aktiv: false, seit: null, roh: 'activating' }).art === 'wechselt'
  );
  check(
    'roh=deactivating, aktiv=true -> wechselt (NICHT laeuft)',
    serverStatusAnzeige({ aktiv: true, seit: '2026', roh: 'deactivating' }).art === 'wechselt'
  );
  check(
    'roh=unbekannt (Abfragefehler) -> unbekannt (NICHT gestoppt)',
    serverStatusAnzeige({ aktiv: false, seit: null, roh: 'unbekannt' }).art === 'unbekannt'
  );
  check(
    'roh=active -> weiterhin laeuft wie gehabt',
    serverStatusAnzeige({ aktiv: true, seit: '2026', roh: 'active' }).art === 'laeuft'
  );
}

// ── karteLiveTestenAktion (Mikes Befund) ─────────────────────────────

console.log('\n[3] karteLiveTestenAktion — Mikes Befund direkt geprueft:');
{
  check('ohne aktive Testwelt: der alte Weg (testwelt-starten)', karteLiveTestenAktion({ testweltAktiv: false }) === 'testwelt-starten');
  check(
    'MIT aktiver Testwelt: testwelt-erneuern statt erneutem testwelt-starten (das liefe in den 409 aus /api/testwelt) UND statt server-neustart (laedt den ALTEN Testwelt-Spielstand wieder, Nachbesserung N1)',
    karteLiveTestenAktion({ testweltAktiv: true }) === 'testwelt-erneuern'
  );
}

// ── neustartOptionen ──────────────────────────────────────────────────

console.log('\n[4] neustartOptionen (Schmutz-Merker aus faerbeSpeicherKnopf):');
{
  check('ohne ungespeicherte Aenderungen: nur Abbrechen/Neustarten, keine Speichern-Option', neustartOptionen(false).join(',') === 'ab,nur-neustart');
  check(
    'MIT ungespeicherten Aenderungen: dritte Option "erst speichern, dann neu starten" dazwischen',
    neustartOptionen(true).join(',') === 'ab,speichern-neustart,nur-neustart'
  );
}

// ── Quelltext: Verdrahtung in editorMain.ts (Syntaxbaum) ───────────────
//
// B3 (Angriffsbefund): Die reinen Funktionen oben waren schon richtig,
// aber NICHT nachweislich benutzt — zwei Mutationen im echten
// editorMain.ts blieben mit den bisherigen Tests unbemerkt gruen:
//  M10: liveKnopf.disabled wieder an "aktiv" gekoppelt (Mikes
//       urspruenglicher Befund kaeme zurueck).
//  M11: der aktive Zweig von karteLiveTesten() ruft wieder
//       testweltSchalten('starten') statt ('erneuern') (liefe in den 409
//       bzw. laeadt den alten Testwelt-Spielstand — B1).
// Muster wie client/test/welt-zuruecksetzen.ts (Syntaxbaum statt Text:
// Zeilenumbrueche, Anfuehrungszeichen, Kommentare und Hilfsvariablen
// aendern nichts).

const HIER = dirname(fileURLToPath(import.meta.url));
function quelle(datei: string): ts.SourceFile {
  const pfad = resolve(HIER, datei);
  return ts.createSourceFile(pfad, readFileSync(pfad, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function alle<T extends ts.Node>(wurzel: ts.Node, passt: (n: ts.Node) => n is T): T[] {
  const treffer: T[] = [];
  const geh = (n: ts.Node): void => {
    if (passt(n)) treffer.push(n);
    ts.forEachChild(n, geh);
  };
  geh(wurzel);
  return treffer;
}
const istAufruf = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n);
const aufrufName = (c: ts.CallExpression): string => c.expression.getText().replace(/\s+/g, '');
const funktion = (sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined =>
  alle(sf, (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n)).find((f) => f.name?.text === name);

console.log('\n[5] Quelltext: Verdrahtung in editorMain.ts (Syntaxbaum) — Mutationen M10/M11 aus dem Angriff:');
{
  const main = quelle('../src/editor/editorMain.ts');

  const testweltKnoepfe = funktion(main, 'testweltKnoepfeAktualisieren');
  check('editorMain hat testweltKnoepfeAktualisieren', testweltKnoepfe !== undefined);
  if (testweltKnoepfe) {
    const zuweisungen = alle(
      testweltKnoepfe,
      (n): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ).filter((b) => b.left.getText() === 'liveKnopf.disabled');
    check('genau eine Zuweisung an liveKnopf.disabled', zuweisungen.length === 1, `n=${zuweisungen.length}`);
    check(
      'liveKnopf.disabled = false (M10: NICHT mehr an "aktiv" gekoppelt — Mikes urspruenglicher Befund)',
      zuweisungen.length === 1 && zuweisungen[0]!.right.kind === ts.SyntaxKind.FalseKeyword,
      zuweisungen[0]?.right.getText()
    );
  }

  const karteLiveTestenFn = funktion(main, 'karteLiveTesten');
  check('editorMain hat karteLiveTesten', karteLiveTestenFn !== undefined);
  if (karteLiveTestenFn) {
    const ifs = alle(karteLiveTestenFn, (n): n is ts.IfStatement => ts.isIfStatement(n)).filter((i) =>
      alle(i.expression, istAufruf).some((c) => aufrufName(c) === 'karteLiveTestenAktion')
    );
    check('genau ein if fragt karteLiveTestenAktion(...) ab', ifs.length === 1, `n=${ifs.length}`);
    const aktiverZweig = ifs[0]?.thenStatement;
    const vergleichtErneuern = ifs[0]
      ? alle(ifs[0].expression, (n): n is ts.StringLiteral => ts.isStringLiteralLike(n)).some((s) => s.text === 'testwelt-erneuern')
      : false;
    check('der Vergleich prueft auf "testwelt-erneuern"', vergleichtErneuern);
    const ruftErneuern = aktiverZweig
      ? alle(aktiverZweig, istAufruf).some(
          (c) =>
            aufrufName(c) === 'testweltSchalten' &&
            c.arguments[0] !== undefined &&
            ts.isStringLiteralLike(c.arguments[0]) &&
            (c.arguments[0] as ts.StringLiteral).text === 'erneuern'
        )
      : false;
    check(
      "im aktiven Zweig ruft karteLiveTesten testweltSchalten('erneuern') (M11: NICHT mehr testweltSchalten('starten') oder serverAktionAusfuehren('neustart'))",
      ruftErneuern
    );
  }
}

console.log(fehler === 0 ? '\nAlle Prüfungen grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
