/**
 * Server entry point.
 * 1:1 port of Main.cpp from Valhalla2.0 C++.
 *
 * C++ reference:
 *   int main(int argc, char** argv) {
 *     std::filesystem::current_path("./data/");
 *     Valhalla()->Start();
 *     return 0;
 *   }
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWovServer } from './WovServer.js';
import { leseServerKonfig } from './ServerKonfig.js';
import { instanzName } from '@wov/shared/src/instanz.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');

/**
 * Welche Umgebung dieser Prozess bedient — aus WOV_INSTANZ, sonst 'dev'.
 * Bestimmt Weltdatei UND Spielstandnamen; die Begruendung, warum das nicht
 * mehr in server.yml steht, haengt im Kopf von shared/src/instanz.ts.
 */
const INSTANZ = instanzName();

// A14 (21.08.2026): Das Lesen von server.yml liegt in ServerKonfig.ts,
// nicht mehr hier. Grund steht im Kopf jener Datei: main.ts startet beim
// Import einen Weltserver und ist deshalb fuer keinen Test erreichbar --
// die Leseschicht war damit ungeprueft, und genau darin konnte ein nie
// gelesener Schluessel monatelang unbemerkt bleiben.

// Letzte Verteidigungslinie: unbehandelte Fehler loggen statt den
// Weltserver kommentarlos sterben zu lassen (systemd startet zwar neu,
// aber der Placement-Boot kostet Minuten — und wir wollen den Stack sehen).
process.on('uncaughtException', (err) => {
  console.error('[Main] Unbehandelter Fehler:', err.stack ?? err.message);
});
process.on('unhandledRejection', (grund) => {
  console.error('[Main] Unbehandelte Promise-Ablehnung:', grund);
});

// ── Main ─────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════╗');
console.log('║   World of Vikings Server (WoV TS)       ║');
console.log('║   Basis: 1:1-Port von Valhalla2.0 C++    ║');
console.log('╚══════════════════════════════════════════╝');
console.log();

const config = leseServerKonfig(DATA_DIR, INSTANZ);
const server = createWovServer(config);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Main] Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

// Start the server (C++ Valhalla()->Start())
server.start();
