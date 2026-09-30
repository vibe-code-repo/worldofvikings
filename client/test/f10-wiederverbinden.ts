/**
 * F10 — Wiederverbinden nach Serverneustart: die DOM-freie Logik
 * (client/src/net/Wiederverbinden.ts). Rot auf main, weil das Modul dort fehlt.
 *
 * Geprueft mit Zahlen:
 *  - Wartezeiten 1, 2, 4, 8, 16, 32, 60, 60, 60 s (Tabelle),
 *  - erwartete Trennungen ('' , 'restart', 'Server shutting down') wiederholen,
 *    jeder andere Grund (Kick, Bann, Abloesung, falsches Passwort) gibt auf,
 *  - die Ansage verzoegert nur den ERSTEN Versuch, und nur nach oben,
 *  - das Zeitlimit greift (10 min), davor nicht,
 *  - die Steuerung: Sperre an waehrend der Serie, Zaehler im Text laeuft
 *    herunter (8, 7, …), `verbinde` genau einmal je Versuch, Reset bei Erfolg,
 *    Kick bricht ab und gibt die Figur frei.
 *
 * Lauf: npx tsx client/test/f10-wiederverbinden.ts   (aus der Repo-Wurzel)
 */
import {
  WARTE_MAX_MS,
  ZEITLIMIT_MS,
  WiederverbindenSteuerung,
  istErwarteteTrennung,
  naechsterVersuch,
  wartezeitMs,
  type WiederverbindenText,
} from '../src/net/Wiederverbinden';

let fehler = 0;
function pruefe(ok: boolean, text: string): void {
  if (!ok) {
    fehler++;
    console.error(`FEHLER: ${text}`);
  } else console.log(`ok: ${text}`);
}

// ── 1. Tabelle der Wartezeiten ──────────────────────────────────────
const erwartet = [1, 2, 4, 8, 16, 32, 60, 60, 60].map((s) => s * 1000);
const tatsaechlich = erwartet.map((_, i) => wartezeitMs(i));
pruefe(JSON.stringify(tatsaechlich) === JSON.stringify(erwartet), `Wartezeiten ${tatsaechlich.map((m) => m / 1000).join(',')} s`);
pruefe(WARTE_MAX_MS === 60_000, 'Obergrenze 60 s');
pruefe(wartezeitMs(1000) === 60_000, 'auch der 1000. Versuch wartet nur 60 s');

// ── 2. Grund ────────────────────────────────────────────────────────
for (const g of ['', undefined, 'restart', 'Server shutting down']) {
  pruefe(istErwarteteTrennung(g), `Grund ${JSON.stringify(g)} wird wiederholt`);
  const e = naechsterVersuch(g, 0);
  pruefe(!e.aufgeben && e.warteMs === 1000, `Grund ${JSON.stringify(g)}: erster Versuch nach 1000 ms`);
}
for (const g of ['Wrong password', 'Von einer neuen Verbindung abgelöst', 'Kicked by admin', 'Name already in use', 'Handshake fehlgeschlagen']) {
  const e = naechsterVersuch(g, 0);
  pruefe(e.aufgeben && e.warteMs === 0, `Kick "${g}" gibt auf`);
}

// ── 3. Ansage ───────────────────────────────────────────────────────
pruefe(naechsterVersuch('restart', 0, 0, 5000).warteMs === 5000, 'Ansage 5 s verzoegert den ersten Versuch auf 5000 ms');
pruefe(naechsterVersuch('restart', 0, 0, 200).warteMs === 1000, 'Ansage kuerzer als 1 s verkuerzt nie');
pruefe(naechsterVersuch('restart', 1, 0, 5000).warteMs === 2000, 'Ansage gilt nur fuer den ersten Versuch');

// ── 4. Zeitlimit ────────────────────────────────────────────────────
pruefe(ZEITLIMIT_MS === 600_000, 'Zeitlimit 600000 ms');
pruefe(!naechsterVersuch('', 9, ZEITLIMIT_MS - 60_000).aufgeben, 'genau am Limit (Versuch reicht noch hinein): weiter');
pruefe(naechsterVersuch('', 9, ZEITLIMIT_MS - 59_999).aufgeben, 'eine Millisekunde ueber dem Limit: aufgeben');
pruefe(naechsterVersuch('', 0, ZEITLIMIT_MS).aufgeben, 'nach dem Limit aufgeben, auch beim ersten Versuch');

// ── 5. Steuerung ────────────────────────────────────────────────────
interface Geplant { ab: number; fn: () => void; id: number }
function baue() {
  let jetzt = 1_000_000;
  let nr = 0;
  let geplant: Geplant[] = [];
  const log = { verbinde: 0, texte: [] as (string | null)[], sperre: { gesperrt: false } };
  const s = new WiederverbindenSteuerung({
    verbinde: () => void log.verbinde++,
    zeige: (t) => void log.texte.push(t),
    uebersetze: (k: WiederverbindenText, v) => `${k}|${v?.sekunden ?? ''}|${v?.versuch ?? ''}`,
    sperre: log.sperre,
    jetzt: () => jetzt,
    setzeTimer: (fn, ms) => { const id = ++nr; geplant.push({ ab: jetzt + ms, fn, id }); return id; },
    loescheTimer: (h) => { geplant = geplant.filter((g) => g.id !== h); },
  });
  /** Laesst die Uhr `ms` weiterlaufen und feuert dabei faellige Timer der Reihe nach. */
  const laufe = (ms: number): void => {
    const ziel = jetzt + ms;
    for (;;) {
      geplant.sort((a, b) => a.ab - b.ab);
      const n = geplant[0];
      if (!n || n.ab > ziel) break;
      geplant.shift();
      jetzt = Math.max(jetzt, n.ab);
      n.fn();
    }
    jetzt = ziel;
  };
  return { s, log, laufe, offeneTimer: () => geplant.length };
}

{
  const { s, log, laufe } = baue();
  s.ansage(3);
  pruefe(log.texte.at(-1) === 'netz.neustart.ansage||', 'Ansage zeigt den Ansagetext');
  pruefe(s.beiGetrennt('restart') === true, 'Neustart-Trennung: es wird neu verbunden');
  pruefe(log.sperre.gesperrt === true, 'Figur ist gesperrt (steht still)');
  pruefe(log.texte.at(-1) === 'netz.verloren.versuch|3|1', `erster Zaehler nach Ansage: ${log.texte.at(-1)} (3 s, Versuch 1)`);
  laufe(1000);
  pruefe(log.texte.at(-1) === 'netz.verloren.versuch|2|1', `nach 1 s: ${log.texte.at(-1)}`);
  laufe(1999);
  pruefe(log.verbinde === 0, 'nach 2,999 s noch kein Versuch');
  laufe(1);
  pruefe(log.verbinde === 1, 'nach 3 s genau ein Verbindungsversuch');
  // Versuch scheitert (Server noch aus): zweiter Versuch nach 2 s
  pruefe(s.beiGetrennt('') === true && log.texte.at(-1) === 'netz.verloren.versuch|2|2', `zweite Trennung: ${log.texte.at(-1)}`);
  laufe(2000);
  pruefe(log.verbinde === 2, 'zweiter Versuch nach 2 s');
  pruefe(s.anzahlVersuche === 2, 'Zaehler 2');
  s.beiVerbunden();
  pruefe(s.anzahlVersuche === 0 && log.sperre.gesperrt === false, 'Erfolg: Zaehler 0, Figur frei');
  pruefe(log.texte.at(-1) === null, 'Erfolg: Meldung weg');
  // neue Serie beginnt wieder bei 1 s
  s.beiGetrennt('');
  pruefe(log.texte.at(-1) === 'netz.verloren.versuch|1|1', 'neue Serie beginnt wieder bei 1 s');
}
{
  const { s, log, laufe, offeneTimer } = baue();
  pruefe(s.beiGetrennt('Kicked by admin') === false, 'Kick: kein neuer Versuch');
  pruefe(log.sperre.gesperrt === false && offeneTimer() === 0 && log.verbinde === 0, 'Kick: nichts gesperrt, kein Timer, kein Versuch');
  laufe(120_000);
  pruefe(log.verbinde === 0, 'Kick: auch nach 2 min kein Versuch');
}
{
  // ganze Serie durchspielen: alle Versuche scheitern, bis das Zeitlimit greift
  const { s, log, laufe } = baue();
  let zuletzt = true;
  let versuche = 0;
  let vergangen = 0;
  while (zuletzt && versuche < 100) {
    zuletzt = s.beiGetrennt('');
    if (!zuletzt) break;
    versuche++;
    const vorher = log.verbinde;
    let schritt = 0;
    while (log.verbinde === vorher && schritt < 70_000) { laufe(1000); schritt += 1000; vergangen += 1000; }
  }
  pruefe(!zuletzt, `Serie endet von selbst nach ${versuche} Versuchen`);
  pruefe(vergangen <= ZEITLIMIT_MS, `Gesamtdauer ${vergangen / 1000} s <= 600 s`);
  // 1+2+4+8+16+32 = 63 s nach 6 Versuchen, jeder weitere 60 s: Versuch k passt, solange 63 + 60*(k-6) <= 600, also k <= 14.
  pruefe(versuche === 14, `Versuche bis zum Limit: ${versuche} (erwartet 14)`);
  pruefe(log.sperre.gesperrt === false, 'nach dem Aufgeben ist die Sperre weg');
}

if (fehler) {
  console.error(`${fehler} Fehler`);
  process.exit(1);
}
console.log('F10-Wiederverbinden: alles gruen');
