/**
 * GET /api/server: the number of connected players, read from the game server's
 * metrics snapshot (`peers`). Pure functions of `routen/serverSteuerung.ts`; the
 * file read itself is one line in `main.ts`.
 *
 *  1. A fresh snapshot gives `peers`; missing, unreadable, wrong-typed, negative, stale or
 *     future-dated snapshots give `null` (a stopped server must not show a number).
 *  2. `serverStatusLesen` carries `spieler` only while the service runs; without a source it is `null`.
 *  3. The field is added, nothing else changed (`dienst`, `zustand`, `instanz` stay).
 *
 * Run: npx tsx test/server-steuerung-spieler.ts   (from admin/)
 */
import { METRIK_ALTER_MAX_MS, serverStatusLesen, spielerAusMetriken, type ServerSteuerungUmgebung } from '../src/routen/serverSteuerung.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else console.log(`ok   ${name}`);
}

const JETZT = 5_000_000;
const snap = (zeitMs: unknown, peers: unknown): string => JSON.stringify({ zeitMs, peers, tickAnzahl: 30 });

check('frischer Schnappschuss: peers', spielerAusMetriken(snap(JETZT - 1000, 3), JETZT) === 3);
check('0 Spieler ist eine Zahl, kein null', spielerAusMetriken(snap(JETZT, 0), JETZT) === 0);
check('Datei fehlt → null', spielerAusMetriken(null, JETZT) === null);
check('kein JSON → null', spielerAusMetriken('{kaputt', JETZT) === null);
check('peers fehlt → null', spielerAusMetriken(JSON.stringify({ zeitMs: JETZT }), JETZT) === null);
check('peers als Text → null', spielerAusMetriken(snap(JETZT, '3'), JETZT) === null);
check('peers negativ → null', spielerAusMetriken(snap(JETZT, -1), JETZT) === null);
check('peers gebrochen → null', spielerAusMetriken(snap(JETZT, 1.5), JETZT) === null);
check('zeitMs fehlt → null', spielerAusMetriken(JSON.stringify({ peers: 2 }), JETZT) === null);
check('Schnappschuss genau an der Altersgrenze zählt noch', spielerAusMetriken(snap(JETZT - METRIK_ALTER_MAX_MS, 2), JETZT) === 2);
check('veralteter Schnappschuss (Server aus) → null', spielerAusMetriken(snap(JETZT - METRIK_ALTER_MAX_MS - 1, 2), JETZT) === null);
check('Schnappschuss aus der Zukunft → null', spielerAusMetriken(snap(JETZT + METRIK_ALTER_MAX_MS + 1, 2), JETZT) === null);

function umg(aktiv: boolean, spieler?: () => number | null): ServerSteuerungUmgebung {
  return {
    instanz: 'dev',
    zustand: async () => ({ aktiv, seit: 'x', roh: aktiv ? 'active' : 'inactive' }),
    neustart: async () => {},
    stoppen: async () => {},
    starten: async () => {},
    ...(spieler ? { spieler } : {}),
  };
}

const laeuft = await serverStatusLesen(umg(true, () => 7));
check('laufender Dienst: spieler = 7', (laeuft.daten as { spieler?: unknown }).spieler === 7);
check('Form bleibt: dienst, zustand, instanz', laeuft.code === 200 && (laeuft.daten as { dienst?: string; instanz?: string }).dienst === 'wov-server' && (laeuft.daten as { instanz?: string }).instanz === 'dev' && (laeuft.daten as { zustand?: { aktiv?: boolean } }).zustand?.aktiv === true);
const aus = await serverStatusLesen(umg(false, () => 7));
check('gestoppter Dienst: spieler = null', (aus.daten as { spieler?: unknown }).spieler === null);
const ohne = await serverStatusLesen(umg(true));
check('ohne Quelle: spieler = null', (ohne.daten as { spieler?: unknown }).spieler === null);
const unbekannt = await serverStatusLesen(umg(true, () => null));
check('Quelle ohne Zahl: spieler = null', (unbekannt.daten as { spieler?: unknown }).spieler === null);

process.exit(fehler === 0 ? 0 : 1);
