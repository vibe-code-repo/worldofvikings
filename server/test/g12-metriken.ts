/**
 * G12 — Betriebsmetriken: reine Auswertung, kein Server/Socket.
 *
 * Deckt zwei unabhaengige Teile ab, beide ohne WovServer-Instanz:
 *
 *  1. server/src/Metriken.ts — Zaehler je Tick/Paketversand und der
 *     Sekundenabschluss (auslesen UND zuruecksetzen, s. Kopfkommentar
 *     dort). Modul-Singleton wie Zeitmessung.ts — die Reihenfolge der
 *     Bloecke unten ist deshalb absichtlich: jeder Block liest den
 *     Zustand, den der vorige per `schliesseSekundeAb` zurueckgesetzt hat.
 *
 *  1'. Aufteilung der Tickdauer (Welten/Sync/Rest) und Budget-Abbrueche
 *     (Block 0.12), ebenfalls im Zaehler-Singleton.
 *
 *  1''. MetrikSchreiber (Block 0.12): Tageslog `metriken-<Datum>.jsonl`,
 *     Rotation, 14 Tage Aufbewahrung, Schreibfehler stoeren nicht und
 *     warnen hoechstens einmal je Minute. Das Datum kommt aus `zeitMs`, die
 *     Tests simulieren es also, ohne die Systemuhr anzufassen.
 *
 *  2. shared/src/metrik.ts — formatierePrometheus() gegen einen von Hand
 *     gebauten Schnappschuss, nicht gegen einen von Metriken.ts erzeugten:
 *     Ein Fehler in der Formatierung soll sichtbar bleiben, auch wenn die
 *     Erhebung zufaellig dieselben Zahlen liefert wie erwartet.
 *
 * Lauf: npx tsx test/g12-metriken.ts   (aus server/)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  erfasseTick,
  erfasseSyncBytes,
  erfasseBudgetAbbruch,
  schliesseSekundeAb,
  MetrikSchreiber,
} from '../src/Metriken.js';
import { formatierePrometheus, type MetrikSchnappschuss } from '@wov/shared/src/metrik.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)} (expect ${JSON.stringify(expected)})`);
};

// ── 1a) Kein einziger Tick vor dem Abschluss: keine Division durch 0. ──
{
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1a. tickDauerMsDurchschnitt ohne Ticks', s.tickDauerMsDurchschnitt, 0);
  check('1a. tickDauerMsMax ohne Ticks', s.tickDauerMsMax, 0);
  check('1a. tickAnzahl ohne Ticks', s.tickAnzahl, 0);
}

// ── 1b) Drei Ticks: Durchschnitt und Maximum von Hand nachgerechnet. ──
{
  erfasseTick(2);
  erfasseTick(4);
  erfasseTick(9);
  // Summe 15, n 3 -> Durchschnitt genau 5. Max ist der groesste Einzelwert,
  // nicht die Summe und nicht der letzte Aufruf.
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1b. Durchschnitt (15/3)', s.tickDauerMsDurchschnitt, 5);
  check('1b. Max ist der Ausreisser, nicht der letzte Wert', s.tickDauerMsMax, 9);
  check('1b. drei Ticks gezaehlt', s.tickAnzahl, 3);
}

// ── 1c) Nach dem Abschluss ist der Akkumulator wirklich leer. ──
{
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1c. Durchschnitt nach Reset', s.tickDauerMsDurchschnitt, 0);
  check('1c. Max nach Reset', s.tickDauerMsMax, 0);
  check('1c. Tickzahl nach Reset', s.tickAnzahl, 0);
}

// ── 1d) Sync-Bytes akkumulieren ueber mehrere Aufrufe und werden geleert. ──
{
  erfasseSyncBytes(100);
  erfasseSyncBytes(250);
  const s1 = schliesseSekundeAb(0, 0, 1_000_000);
  check('1d. Bytes aufsummiert (100+250)', s1.syncBytesProSekunde, 350);
  const s2 = schliesseSekundeAb(0, 0, 1_000_000);
  check('1d. Bytes nach Reset leer', s2.syncBytesProSekunde, 0);
}

// ── 1e) zdoAnzahl/peers/zeitMs sind reiner Durchreichewert des Aufrufs. ──
{
  const s = schliesseSekundeAb(248_213, 3, 1_234_567);
  check('1e. zdoAnzahl durchgereicht', s.zdoAnzahl, 248_213);
  check('1e. peers durchgereicht', s.peers, 3);
  check('1e. zeitMs durchgereicht', s.zeitMs, 1_234_567);
}

// ── 1f) Aufteilung: Welten + Sync + Rest ergeben die Gesamtdauer. ──
{
  // (gesamt, welten, sync) je Tick: Rest = gesamt - welten - sync.
  erfasseTick(10, 4, 3); // rest 3
  erfasseTick(6, 0, 2); //  rest 4
  erfasseTick(2, 0, 0); //  rest 2
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1f. Gesamtdurchschnitt (18/3)', s.tickDauerMsDurchschnitt, 6);
  check('1f. Welten-Durchschnitt (4/3)', s.tickWeltenMsDurchschnitt, 1.33);
  check('1f. Welten-Max', s.tickWeltenMsMax, 4);
  check('1f. Sync-Durchschnitt (5/3)', s.tickSyncMsDurchschnitt, 1.67);
  check('1f. Sync-Max', s.tickSyncMsMax, 3);
  check('1f. Rest-Durchschnitt (9/3)', s.tickRestMsDurchschnitt, 3);
  check('1f. Rest-Max ist ein anderer Tick als Welten-Max', s.tickRestMsMax, 4);
  // Die drei Teile ergeben das Ganze bis auf die Rundung auf 0,01 je Wert.
  const summe = s.tickWeltenMsDurchschnitt + s.tickSyncMsDurchschnitt + s.tickRestMsDurchschnitt;
  check('1f. Welten+Sync+Rest = Gesamt (Toleranz 0,015)', Math.abs(summe - s.tickDauerMsDurchschnitt) <= 0.015, true);
}

// ── 1g) Ohne Aufteilung gemeldet (alter Aufruf): alles ist Rest. ──
{
  erfasseTick(5);
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1g. Welten 0', s.tickWeltenMsDurchschnitt, 0);
  check('1g. Sync 0', s.tickSyncMsDurchschnitt, 0);
  check('1g. Rest = Gesamt', s.tickRestMsDurchschnitt, 5);
}

// ── 1h) Ein Rest wird nie negativ (falsch gefuetterter Aufruf). ──
{
  erfasseTick(1, 2, 0);
  const s = schliesseSekundeAb(0, 0, 1_000_000);
  check('1h. Rest bei welten > gesamt bleibt 0', s.tickRestMsDurchschnitt, 0);
  check('1h. Rest-Max bleibt 0', s.tickRestMsMax, 0);
}

// ── 1i) Budget-Abbrueche zaehlen und werden mit der Sekunde geleert. ──
{
  erfasseBudgetAbbruch();
  erfasseBudgetAbbruch();
  erfasseBudgetAbbruch();
  const s1 = schliesseSekundeAb(0, 0, 1_000_000);
  check('1i. drei Abbrueche gezaehlt', s1.zonenBudgetAbbrueche, 3);
  const s2 = schliesseSekundeAb(0, 0, 1_000_000);
  check('1i. nach Reset leer', s2.zonenBudgetAbbrueche, 0);
  check('1i. Aufteilung nach Reset leer', s2.tickWeltenMsMax + s2.tickSyncMsMax + s2.tickRestMsMax, 0);
}

// ── 1j) MetrikSchreiber: Tageslog, Rotation, Aufbewahrung, Schreibfehler. ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-g12-metriken');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const TAG = 86_400_000;
const T0 = Date.UTC(2026, 8, 19, 10, 0, 0); // 2026-09-19 10:00 UTC
const tagName = (zeitMs: number): string => `metriken-${new Date(zeitMs).toISOString().slice(0, 10)}.jsonl`;
const schnapp = (zeitMs: number): MetrikSchnappschuss => {
  erfasseTick(3, 1, 1);
  return schliesseSekundeAb(7, 1, zeitMs);
};
const jsonlDateien = (ordner: string): string[] =>
  readdirSync(ordner)
    .filter((n) => /^metriken-.*\.jsonl$/.test(n))
    .sort();

{
  const ordner = resolve(TMP, 'rotation');
  mkdirSync(ordner);
  const warnungen: string[] = [];
  const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));

  w.schreibe(schnapp(T0));
  w.schreibe(schnapp(T0 + 1000));
  check('1j. Tageslog nach Tagesname angelegt', existsSync(resolve(ordner, 'metriken-2026-09-19.jsonl')), true);
  const zeilen = readFileSync(resolve(ordner, 'metriken-2026-09-19.jsonl'), 'utf-8').split('\n');
  check('1j. zwei Schreibvorgaenge, zwei Zeilen + Endumbruch', zeilen.length === 3 && zeilen[2] === '', true);
  const zeile2 = JSON.parse(zeilen[1]!) as MetrikSchnappschuss;
  check('1j. Zeile ist der Schnappschuss (zeitMs)', zeile2.zeitMs, T0 + 1000);
  check('1j. Zeile traegt die Aufteilung (welten avg)', zeile2.tickWeltenMsDurchschnitt, 1);
  const snapshot = JSON.parse(readFileSync(resolve(ordner, 'metriken.json'), 'utf-8')) as MetrikSchnappschuss;
  check('1j. Schnappschussdatei bleibt der letzte Stand', snapshot.zeitMs, T0 + 1000);
  check('1j. keine .tmp-Reste', existsSync(resolve(ordner, 'metriken.json.tmp')), false);

  // Tageswechsel: neue Datei, die alte bleibt unberuehrt.
  w.schreibe(schnapp(T0 + TAG));
  check('1j. Rotation: neue Datei am naechsten Tag', existsSync(resolve(ordner, 'metriken-2026-09-20.jsonl')), true);
  check(
    '1j. Rotation: alte Datei unveraendert (2 Zeilen)',
    readFileSync(resolve(ordner, 'metriken-2026-09-19.jsonl'), 'utf-8').trim().split('\n').length,
    2
  );
  check('1j. keine Warnung im Normalbetrieb', warnungen.length, 0);
}

{
  // Aufbewahrung: 14 Tage inklusive heute; nur passende Namen werden angefasst.
  const ordner = resolve(TMP, 'aufbewahrung');
  mkdirSync(ordner);
  for (let i = 0; i < 19; i++) writeFileSync(resolve(ordner, tagName(T0 - i * TAG)), '{}\n'); // 09-19 rueckwaerts bis 09-01
  const fremd = ['metriken.json', 'notiz.jsonl', 'metriken-x.jsonl', 'metriken-2026-09-01.jsonl.bak', 'wov-sicherung.log'];
  for (const n of fremd) writeFileSync(resolve(ordner, n), 'x');
  const warnungen: string[] = [];
  const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));

  w.schreibe(schnapp(T0));
  const heute = jsonlDateien(ordner).filter((n) => /^metriken-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  check('1k. genau 14 Tageslogs bleiben (heute + 13)', heute.length, 14);
  check('1k. aeltestes Log ist 13 Tage alt (09-06)', heute[0], 'metriken-2026-09-06.jsonl');
  check('1k. 14 Tage altes Log (09-05) ist geloescht', existsSync(resolve(ordner, 'metriken-2026-09-05.jsonl')), false);
  check(
    '1k. fremde Dateien bleiben',
    fremd.filter((n) => n !== 'metriken.json').every((n) => existsSync(resolve(ordner, n))),
    true
  );

  // Ein Tag spaeter faellt der naechste raus und es bleiben wieder 14.
  w.schreibe(schnapp(T0 + TAG));
  const morgen = jsonlDateien(ordner).filter((n) => /^metriken-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  check('1k. am Folgetag wieder 14 Logs', morgen.length, 14);
  check('1k. 09-06 ist jetzt 14 Tage alt und geloescht', existsSync(resolve(ordner, 'metriken-2026-09-06.jsonl')), false);
  check('1k. 09-07 bleibt', existsSync(resolve(ordner, 'metriken-2026-09-07.jsonl')), true);

  // Mehrere Schreibvorgaenge am selben Tag raeumen nicht erneut auf: ein neu
  // hingelegtes altes Log ueberlebt den zweiten Schreibvorgang desselben Tages.
  writeFileSync(resolve(ordner, 'metriken-2026-08-01.jsonl'), '{}\n');
  w.schreibe(schnapp(T0 + TAG + 1000));
  check('1k. Aufraeumen nur beim Tageswechsel', existsSync(resolve(ordner, 'metriken-2026-08-01.jsonl')), true);
  check('1k. keine Warnung', warnungen.length, 0);
}

{
  // Schreibfehler: das Tageslog kann nicht angehaengt werden (an seinem Namen
  // steht ein Ordner). Der Server laeuft weiter, der Schnappschuss wird
  // trotzdem geschrieben, und die Warnung kommt hoechstens einmal je Minute.
  const ordner = resolve(TMP, 'fehler-jsonl');
  mkdirSync(ordner);
  mkdirSync(resolve(ordner, 'metriken-2026-09-19.jsonl'));
  const warnungen: string[] = [];
  const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));

  let geworfen = false;
  try {
    for (let i = 0; i < 100; i++) w.schreibe(schnapp(T0 + i * 1000)); // 100 s
  } catch {
    geworfen = true;
  }
  check('1l. Schreibfehler wirft nicht', geworfen, false);
  const snap = JSON.parse(readFileSync(resolve(ordner, 'metriken.json'), 'utf-8')) as MetrikSchnappschuss;
  check('1l. Schnappschuss trotzdem aktuell', snap.zeitMs, T0 + 99_000);
  check('1l. 100 Fehlschlaege in 100 s: 2 Warnungen (t=0 und t=60)', warnungen.length, 2);
  check('1l. Warnung nennt das Ziel', warnungen[0]!.includes('jsonl') && warnungen[0]!.includes('metriken-2026-09-19.jsonl'), true);
  check('1l. zweite Warnung zaehlt die 59 unterdrueckten', warnungen[1]!.includes('59 further'), true);

  // Uhr springt zurueck: kein dauerhaftes Verstummen.
  w.schreibe(schnapp(T0 - 3_600_000));
  check('1l. Uhrsprung rueckwaerts warnt wieder', warnungen.length, 3);

  // Fehler behoben: wieder ein normaler Schreibvorgang, keine weitere Warnung.
  rmSync(resolve(ordner, 'metriken-2026-09-19.jsonl'), { recursive: true });
  w.schreibe(schnapp(T0 + 200_000));
  check('1l. nach Behebung wird angehaengt', readFileSync(resolve(ordner, 'metriken-2026-09-19.jsonl'), 'utf-8').split('\n').length, 2);
  check('1l. nach Behebung keine neue Warnung', warnungen.length, 3);
}

{
  // Der Ordner ist weg (Platte abgehaengt): beide Ziele scheitern, jedes wird
  // fuer sich gedrosselt, nichts wirft.
  const ordner = resolve(TMP, 'weg', 'gibt-es-nicht');
  const warnungen: string[] = [];
  const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));
  let geworfen = false;
  try {
    for (let i = 0; i < 59; i++) w.schreibe(schnapp(T0 + i * 1000));
  } catch {
    geworfen = true;
  }
  check('1m. fehlender Ordner wirft nicht', geworfen, false);
  // snapshot + jsonl + prune (listing fails once), each warned once in 59 s.
  check('1m. je Ziel eine Warnung (snapshot, jsonl, prune)', warnungen.length, 3);
}

{
  // Ein Log, das sich nicht loeschen laesst (hier ein alter Ordner mit dem
  // Namen eines Logs), bricht das Aufraeumen nicht ab und wirft nicht.
  const ordner = resolve(TMP, 'unloeschbar');
  mkdirSync(ordner);
  mkdirSync(resolve(ordner, 'metriken-2026-09-01.jsonl'));
  writeFileSync(resolve(ordner, 'metriken-2026-09-02.jsonl'), '{}\n');
  const warnungen: string[] = [];
  const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));
  w.schreibe(schnapp(T0));
  check('1n. loeschbares altes Log wird trotz Fehler davor geloescht', existsSync(resolve(ordner, 'metriken-2026-09-02.jsonl')), false);
  check('1n. Fehler beim Loeschen wird als prune gemeldet', warnungen.length === 1 && warnungen[0]!.includes('prune'), true);
}

{
  // Ein Zeitstempel, der kein Datum ist (NaN, Infinity): `toISOString` wirft.
  // Das ist ein Schreibfehler wie jeder andere — eine Warnung, kein Wurf aus
  // schreibe() (im Server waere das eine Ausnahme im Tick-Timer).
  for (const [name, zeit] of [['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]] as const) {
    const ordner = resolve(TMP, `zeit-ungueltig-${name}`);
    mkdirSync(ordner);
    const warnungen: string[] = [];
    const w = new MetrikSchreiber(resolve(ordner, 'metriken.json'), (t) => warnungen.push(t));
    let geworfen = '';
    try {
      w.schreibe(schnapp(zeit));
    } catch (fehler) {
      geworfen = (fehler as Error).message;
    }
    check(`1o. Zeitstempel ${name} wirft nicht aus schreibe()`, geworfen, '');
    check(`1o. ${name}: Schnappschuss wurde trotzdem geschrieben`, existsSync(resolve(ordner, 'metriken.json')), true);
    check(`1o. ${name}: kein Tageslog fuer ein Datum, das es nicht gibt`, jsonlDateien(ordner).length, 0);
    check(`1o. ${name}: genau eine Warnung, sie nennt das Ziel und die Ursache`, warnungen.length === 1 && warnungen[0]!.includes('jsonl') && warnungen[0]!.includes('Invalid time value'), true);

    // Danach geht es normal weiter: Log wird angelegt, das Aufraeumen laeuft beim ersten gueltigen Tag.
    writeFileSync(resolve(ordner, 'metriken-2026-01-01.jsonl'), '{}\n');
    w.schreibe(schnapp(T0));
    check(`1o. ${name}: danach normaler Schreibvorgang`, jsonlDateien(ordner).includes(tagName(T0)), true);
    check(`1o. ${name}: danach laeuft das Aufraeumen (altes Log weg)`, jsonlDateien(ordner).includes('metriken-2026-01-01.jsonl'), false);
  }
}

rmSync(TMP, { recursive: true, force: true });

// ── 2) formatierePrometheus gegen einen von Hand gebauten Schnappschuss. ──
{
  const schnappschuss: MetrikSchnappschuss = {
    zeitMs: 1_000,
    tickDauerMsDurchschnitt: 3.42,
    tickDauerMsMax: 7.1,
    tickAnzahl: 29,
    zdoAnzahl: 248_213,
    syncBytesProSekunde: 184_320,
    peers: 3,
    tickWeltenMsDurchschnitt: 1.25,
    tickWeltenMsMax: 4.5,
    tickSyncMsDurchschnitt: 0.75,
    tickSyncMsMax: 2.5,
    tickRestMsDurchschnitt: 1.42,
    tickRestMsMax: 2.1,
    zonenBudgetAbbrueche: 4,
  };
  const text = formatierePrometheus(schnappschuss, 3_500);
  const zeilen = text.split('\n');

  check('2a. beginnt mit HELP-Zeile', zeilen[0]!.startsWith('# HELP wov_tick_dauer_ms_avg'), true);
  check('2b. TYPE-Zeile ist gauge', zeilen.includes('# TYPE wov_tick_dauer_ms_avg gauge'), true);
  check('2c. Durchschnitt exakt uebernommen', zeilen.includes('wov_tick_dauer_ms_avg 3.42'), true);
  check('2d. Max exakt uebernommen', zeilen.includes('wov_tick_dauer_ms_max 7.1'), true);
  check('2e. Tickzahl exakt uebernommen', zeilen.includes('wov_tick_anzahl 29'), true);
  check('2f. ZDO-Anzahl exakt uebernommen', zeilen.includes('wov_zdo_anzahl 248213'), true);
  check('2g. Sync-Bytes exakt uebernommen', zeilen.includes('wov_sync_bytes_pro_sekunde 184320'), true);
  check('2h. Peers exakt uebernommen', zeilen.includes('wov_peers 3'), true);
  // Alter: (3500-1000)/1000 = 2.5s.
  check('2i. Alter korrekt berechnet (2,5s)', zeilen.includes('wov_metriken_alter_sekunden 2.5'), true);
  check('2j. endet mit genau einem Zeilenumbruch', text.endsWith('\n') && !text.endsWith('\n\n'), true);
  check('2l. Welten-Durchschnitt uebernommen', zeilen.includes('wov_tick_welten_ms_avg 1.25'), true);
  check('2m. Welten-Max uebernommen', zeilen.includes('wov_tick_welten_ms_max 4.5'), true);
  check('2n. Sync-Durchschnitt uebernommen', zeilen.includes('wov_tick_sync_ms_avg 0.75'), true);
  check('2o. Sync-Max uebernommen', zeilen.includes('wov_tick_sync_ms_max 2.5'), true);
  check('2p. Rest-Durchschnitt uebernommen', zeilen.includes('wov_tick_rest_ms_avg 1.42'), true);
  check('2q. Rest-Max uebernommen', zeilen.includes('wov_tick_rest_ms_max 2.1'), true);
  check('2r. Budget-Abbrueche uebernommen', zeilen.includes('wov_zonen_budget_abbrueche 4'), true);

  // Eine Schnappschussdatei eines aelteren Servers hat die neuen Felder nicht.
  // Der Betriebsdienst darf daraus kein `undefined` in die Ausgabe schreiben.
  const alt = { ...schnappschuss } as Partial<MetrikSchnappschuss>;
  delete alt.tickWeltenMsDurchschnitt;
  delete alt.zonenBudgetAbbrueche;
  const altText = formatierePrometheus(alt as MetrikSchnappschuss, 3_500);
  check('2s. altes Format: kein "undefined" im Text', altText.includes('undefined') || altText.includes('NaN'), false);
  check('2t. altes Format: alte Werte bleiben', altText.split('\n').includes('wov_peers 3'), true);
}

// ── 2k) Verstellte Uhr (Schnappschuss "aus der Zukunft") kappt bei 0. ──
{
  const schnappschuss: MetrikSchnappschuss = {
    zeitMs: 5_000,
    tickDauerMsDurchschnitt: 0,
    tickDauerMsMax: 0,
    tickAnzahl: 0,
    zdoAnzahl: 0,
    syncBytesProSekunde: 0,
    peers: 0,
    tickWeltenMsDurchschnitt: 0,
    tickWeltenMsMax: 0,
    tickSyncMsDurchschnitt: 0,
    tickSyncMsMax: 0,
    tickRestMsDurchschnitt: 0,
    tickRestMsMax: 0,
    zonenBudgetAbbrueche: 0,
  };
  const text = formatierePrometheus(schnappschuss, 1_000); // jetzt VOR zeitMs
  check('2k. negatives Alter wird bei 0 gekappt', text.split('\n').includes('wov_metriken_alter_sekunden 0'), true);
}

console.log(
  failures === 0 ? '\n=== G12 Metriken: ALL PASSED ===' : `\n=== G12 Metriken: ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
