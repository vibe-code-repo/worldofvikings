/**
 * Server entry point.
 * 1:1 port of the C++ reference server's entry point: switch into the
 * data directory, build the server, start it.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWovServer } from './WovServer.js';
import { leseServerKonfig } from './ServerKonfig.js';
import { instanzName } from '@wov/shared/src/instanz.js';
import { ladeModulRegistrierung } from './world/dungeon/ModuleBuild.js';

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
console.log('║   Autoritativer TypeScript-Server        ║');
console.log('╚══════════════════════════════════════════╝');
console.log();

const config = leseServerKonfig(DATA_DIR, INSTANZ);

/*
  E5: Zur Laufzeit gebaute Saele aus assets/generiert/modul-registry.json
  in die Nachschlagewerke eintragen — VOR createWovServer, und das ist
  keine Stilfrage.

  Zwei Stellen KOPIEREN die Prefab-Registry, statt sie zu befragen:
  `PrefabManager` zieht beim Bauen einmal ueber `PREFAB_DEFS`, und der
  Editor-Katalog leitet sein `MIT_MODELL` beim Import daraus ab. Ein
  `registerModule` NACH dem Serveraufbau traegt in alle sechs Karten ein
  und bleibt trotzdem unsichtbar — ohne Meldung, weil nichts
  fehlschlaegt.

  Ablehnungen werden LAUT: Die Registry ist eine Textdatei neben den
  GLBs, die ein Mensch bearbeiten kann. Ein still uebergangener Eintrag
  waere ein Raum, den ein gespeichertes Dokument beim naechsten Speichern
  verliert (sanitizeDungeonDocument verwirft Unbekanntes wortlos).
*/
const modulStand = ladeModulRegistrierung(config.generiertDir);
if (modulStand.geladen > 0) {
  console.log(`[Modulbau] ${modulStand.geladen} gebaute Module registriert`);
}
for (const zeile of modulStand.warnungen) console.warn(`[Modulbau] ${zeile}`);
for (const zeile of modulStand.meldungen) console.error(`[Modulbau] abgelehnt: ${zeile}`);

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

// Start the server
server.start();
