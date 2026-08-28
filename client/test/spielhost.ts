/**
 * Führt `spielHost()` gegen die WIRKLICHEN Namen.
 *
 * Die erste Fassung dieser Ableitung war ein Ausdruck im Klick-Handler und
 * riet falsch: Aus `editor.dev.world-of-vikings.com` machte sie
 * `dev.world-of-vikings.com`, und den Host gibt es nicht. Aufgefallen ist
 * das erst, als jemand darauf klickte.
 *
 * Erreichbarkeit gemessen am 28.08.2026 mit curl:
 *   dev.world-of-vikings.com         keine Antwort
 *   play.dev.world-of-vikings.com    200
 *   editor.dev.world-of-vikings.com  302
 */
import { spielHost } from '../src/editor/DungeonKatalog';

const FAELLE: [string, string, string][] = [
  // Editor auf dev → Spiel auf dev.
  ['editor.dev.world-of-vikings.com', 'play.dev.world-of-vikings.com', 'dev'],
  // Editor auf live → Spiel auf live (nginx-live.conf: beide Namen, ein nginx).
  ['editor.world-of-vikings.com', 'play.world-of-vikings.com', 'live'],
  // Der Editor wird auch unter dem SPIEL-Namen ausgeliefert
  // (deploy/npm-play-dev.conf, /editor.html). Dann bleibt alles, wie es ist.
  ['play.dev.world-of-vikings.com', 'play.dev.world-of-vikings.com', 'Editor am Spielnamen'],
  ['play.world-of-vikings.com', 'play.world-of-vikings.com', 'dito, live'],
  // Durch den Tunnel misst Mike lokal — der Name darf nicht angefasst werden.
  ['localhost:5274', 'localhost:5274', 'Tunnel'],
  ['127.0.0.1:5274', '127.0.0.1:5274', 'Tunnel, numerisch'],
  // Kein Praefix-Halbwissen: `editorial.` faengt zwar mit „editor" an,
  // ist aber kein Praefix `editor.` — der Punkt gehoert dazu.
  ['editorial.world-of-vikings.com', 'editorial.world-of-vikings.com', 'kein Praefix'],
];

let fehler = 0;
for (const [ein, soll, was] of FAELLE) {
  const ist = spielHost(ein);
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${was}: ${ein} → ${ist}${ok ? '' : ` (erwartet ${soll})`}`);
}

console.log(fehler === 0 ? '\nAlle Namen richtig übersetzt.' : `\n${fehler} falsch.`);
process.exit(fehler > 0 ? 1 : 0);
