/**
 * Serversteuerung im Editor (Mikes Befund: Neustart-Knopf blieb gesperrt,
 * sobald eine Testwelt lief) — die DOM-freie Entscheidungslogik aus
 * client/src/editor/serverSteuerung.ts.
 *
 * Run:  npx tsx test/editor-serversteuerung.ts    (aus client/)
 */
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
}

// ── karteLiveTestenAktion (Mikes Befund) ─────────────────────────────

console.log('\n[3] karteLiveTestenAktion — Mikes Befund direkt geprueft:');
{
  check('ohne aktive Testwelt: der alte Weg (testwelt-starten)', karteLiveTestenAktion({ testweltAktiv: false }) === 'testwelt-starten');
  check(
    'MIT aktiver Testwelt: server-neustart statt erneutem testwelt-starten (das liefe in den 409 aus /api/testwelt)',
    karteLiveTestenAktion({ testweltAktiv: true }) === 'server-neustart'
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

console.log(fehler === 0 ? '\nAlle Prüfungen grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
