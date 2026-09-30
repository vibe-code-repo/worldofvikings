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
function baue(verbindeFn?: () => void, aufgegeben?: () => void) {
  let jetzt = 1_000_000;
  let nr = 0;
  let geplant: Geplant[] = [];
  const log = { verbinde: 0, texte: [] as (string | null)[], sperre: { netzGesperrt: false } };
  const s = new WiederverbindenSteuerung({
    verbinde: () => { log.verbinde++; verbindeFn?.(); },
    aufgegeben,
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
  pruefe(log.sperre.netzGesperrt === true, 'Figur ist gesperrt (steht still)');
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
  pruefe(s.anzahlVersuche === 2, 'Transport steht, Server hat noch nicht angenommen: Zaehler bleibt (F1)');
  s.beiAngenommen();
  pruefe(s.anzahlVersuche === 0 && log.sperre.netzGesperrt === false, 'Erfolg: Zaehler 0, Figur frei');
  pruefe(log.texte.at(-1) === null, 'Erfolg: Meldung weg');
  // neue Serie beginnt wieder bei 1 s
  s.beiGetrennt('');
  pruefe(log.texte.at(-1) === 'netz.verloren.versuch|1|1', 'neue Serie beginnt wieder bei 1 s');
}
{
  const { s, log, laufe, offeneTimer } = baue();
  pruefe(s.beiGetrennt('Kicked by admin') === false, 'Kick: kein neuer Versuch');
  pruefe(log.sperre.netzGesperrt === false && offeneTimer() === 0 && log.verbinde === 0, 'Kick: nichts gesperrt, kein Timer, kein Versuch');
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
  pruefe(log.sperre.netzGesperrt === false, 'nach dem Aufgeben ist die Sperre weg');
}


// ── 6. Nachbesserung N1 ─────────────────────────────────────────────
// F1: Server nimmt den Handshake an (Transport steht: beiVerbunden) und schliesst ohne Grund,
// ohne je PeerInfo zu schicken (beiAngenommen fehlt). Auf 3c6bceb3 setzte beiVerbunden die Serie
// zurueck: 2000 Versuche in 2000 s, nie aufgegeben.
{
  const { s, log, laufe } = baue();
  const warten: number[] = [];
  let weiter = true;
  let zyklen = 0;
  let vergangen = 0;
  while (weiter && zyklen < 200 && vergangen < 2 * ZEITLIMIT_MS) {
    weiter = s.beiGetrennt('');
    if (!weiter) break;
    zyklen++;
    warten.push(Number(/\|(\d+)\|/.exec(log.texte.at(-1) ?? '')?.[1]));
    const vorher = log.verbinde;
    while (log.verbinde === vorher) { laufe(1000); vergangen += 1000; }
    s.beiVerbunden(); // Anmeldepaket raus, aber kein PeerInfo
  }
  pruefe(!weiter, `F1: nach Handshake ohne Annahme gibt der Client auf (nach ${zyklen} Versuchen, ${vergangen / 1000} s)`);
  pruefe(vergangen <= ZEITLIMIT_MS, `F1: Gesamtdauer ${vergangen / 1000} s <= 600 s`);
  pruefe(JSON.stringify(warten.slice(0, 8)) === JSON.stringify([1, 2, 4, 8, 16, 32, 60, 60]), `F1: der Backoff waechst trotz Verbindungen: ${warten.slice(0, 8).join(',')} s`);
  pruefe(zyklen === 14, `F1: genau 14 Versuche wie ohne Handshake (${zyklen})`);
}

// F2: verbinde() wirft im Timer.
{
  let aufgegebenZaehler = 0;
  const { s, log, laufe } = baue(() => { throw new Error('WebSocket: ungueltige Adresse'); }, () => void aufgegebenZaehler++);
  const echtesError = console.error;
  console.error = () => undefined; // die erwartete Fehlerzeile nicht ins Protokoll kippen
  pruefe(s.beiGetrennt('') === true, 'F2: erste Trennung: Versuch laeuft');
  laufe(1000);
  pruefe(log.verbinde === 1 && s.anzahlVersuche === 2, `F2: Ausnahme gefangen, Versuch zaehlt als gescheitert (Versuche ${s.anzahlVersuche})`);
  pruefe(log.sperre.netzGesperrt === true && log.texte.at(-1) === 'netz.verloren.versuch|2|2', `F2: naechster Zaehler laeuft (${log.texte.at(-1)})`);
  for (let i = 0; i < 700 && aufgegebenZaehler === 0; i++) laufe(1000);
  pruefe(aufgegebenZaehler === 1, 'F2: nach dem Zeitlimit wird genau einmal aufgegeben (Weg zur Webseite)');
  pruefe(log.sperre.netzGesperrt === false, 'F2: Sperre haengt nicht');
  console.error = echtesError;
  pruefe(log.verbinde === 14, `F2: 14 Versuche bis zum Limit (${log.verbinde})`);
}

// F3: Systemuhr springt um +-1 h; die Standarduhr ist monoton (performance.now).
{
  const echteDatum = Date.now;
  let offset = 0;
  Date.now = () => echteDatum() + offset;
  let geplant: (() => void) | null = null;
  let verbunden = 0;
  const texte: (string | null)[] = [];
  const s = new WiederverbindenSteuerung({
    verbinde: () => void verbunden++,
    zeige: (x) => void texte.push(x),
    uebersetze: (k: WiederverbindenText, v) => `${k}|${v?.sekunden ?? ''}|${v?.versuch ?? ''}`,
    sperre: { netzGesperrt: false },
    setzeTimer: (fn) => { geplant = fn; return 1; },
  });
  s.beiGetrennt('');
  offset = -3_600_000; // Uhr eine Stunde zurueck
  await new Promise((r) => setTimeout(r, 1050));
  (geplant as (() => void) | null)?.();
  pruefe(verbunden === 1, `F3: Uhr -1 h: der Versuch kommt trotzdem nach 1 s (verbunden ${verbunden})`);
  s.beiAngenommen();
  offset = 0;
  s.beiGetrennt('');
  offset = 3_600_000; // Uhr eine Stunde vor: darf kein sofortiges Aufgeben bewirken
  const weiter = s.beiGetrennt('');
  pruefe(weiter === true, 'F3: Uhr +1 h: Serie laeuft weiter statt aufzugeben');
  Date.now = echteDatum;
}

// F4: Tod (InputManager.gesperrt) und Wiederverbindung (netzGesperrt) gleichzeitig, am echten InputManager.
{
  type Handler = (e: Record<string, unknown>) => void;
  const fenster = new Map<string, Handler>();
  const g = globalThis as Record<string, unknown>;
  g.window = { addEventListener: (x: string, f: Handler) => fenster.set(x, f), setTimeout, clearTimeout };
  g.document = { addEventListener: () => undefined, pointerLockElement: null };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test' }, configurable: true });
  const leinwand = { addEventListener: () => undefined, requestPointerLock: () => undefined };
  const { InputManager } = await import('../src/engine/InputManager');
  const input = new InputManager(leinwand as unknown as HTMLCanvasElement);
  input.pointerLocked = true;
  fenster.get('keydown')!({ code: 'KeyW', repeat: false, preventDefault: () => undefined });
  pruefe(input.isDown('KeyW'), 'F4: frei: W gilt');
  input.gesperrt = true; // TodTreffer: tot
  const { s } = (() => {
    const log = { verbinde: 0, texte: [] as (string | null)[] };
    const s = new WiederverbindenSteuerung({
      verbinde: () => void log.verbinde++,
      zeige: (x) => void log.texte.push(x),
      uebersetze: (k) => k,
      sperre: input,
    });
    return { s };
  })();
  s.beiGetrennt('');
  pruefe(!input.isDown('KeyW') && input.gesperrt && input.netzGesperrt, 'F4: tot + getrennt: beide Sperren gesetzt, W gilt nicht');
  s.beiAngenommen();
  pruefe(input.gesperrt === true && input.netzGesperrt === false && !input.isDown('KeyW'), 'F4: nach der Annahme bleibt die Tod-Sperre (W gilt nicht)');
  input.gesperrt = false;
  pruefe(input.isDown('KeyW'), 'F4: nach der Wiederbelebung gilt W wieder');
  s.beiGetrennt('');
  pruefe(!input.isDown('KeyW') && input.netzGesperrt, 'F4: nur getrennt: W gilt nicht');
  s.beiAngenommen();
  pruefe(input.isDown('KeyW') && !input.netzGesperrt, 'F4: nach der Annahme ist die eigene Sperre frei');
}

if (fehler) {
  console.error(`${fehler} Fehler`);
  process.exit(1);
}
console.log('F10-Wiederverbinden: alles gruen');
