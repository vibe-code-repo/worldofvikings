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
 *  2. shared/src/metrik.ts — formatierePrometheus() gegen einen von Hand
 *     gebauten Schnappschuss, nicht gegen einen von Metriken.ts erzeugten:
 *     Ein Fehler in der Formatierung soll sichtbar bleiben, auch wenn die
 *     Erhebung zufaellig dieselben Zahlen liefert wie erwartet.
 *
 * Lauf: npx tsx test/g12-metriken.ts   (aus server/)
 */

import { erfasseTick, erfasseSyncBytes, schliesseSekundeAb } from '../src/Metriken.js';
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
  };
  const text = formatierePrometheus(schnappschuss, 1_000); // jetzt VOR zeitMs
  check('2k. negatives Alter wird bei 0 gekappt', text.split('\n').includes('wov_metriken_alter_sekunden 0'), true);
}

console.log(
  failures === 0 ? '\n=== G12 Metriken: ALL PASSED ===' : `\n=== G12 Metriken: ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
