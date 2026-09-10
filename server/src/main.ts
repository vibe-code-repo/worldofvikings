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
import { ASSET_WURZEL, KollisionsFormen } from './world/KollisionsFormen.js';

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

/*
  DIE EINE EINHAENGESTELLE.

  Bis hierher sind die beiden Haelften unabhaengig: `KollisionsFormen`
  (server/src/world/KollisionsFormen.ts) WEISS, welche Form ein Prefab
  hat, und `Kollisionswelt` (server/src/world/Kollisionswelt.ts) RECHNET
  damit — kennt aber ohne diese Zeile nur die leere Quelle und laesst die
  Figur wie vor dem Umbau durch jeden Felsen laufen. Beide Seiten sprechen
  denselben Raum (s. shared/src/kollision/form.ts): Formen stehen in
  Clientkoordinaten, lokal zur Instanz, VOR Drehung und Skalierung — die
  legt `Kollisionswelt.baueKoerper` mit derselben Kette an wie
  `composeZdoWorld` im Client.

  Vorgeladen wird HIER und nicht beim ersten Schritt: Eine GLB zu lesen
  dauert Millisekunden, und die faenden sonst mitten im Bewegungsschritt
  statt — als Ruckler fuer genau den Spieler, der zuerst an diesem Fels
  vorbeilaeuft.
*/
const kollisionsFormen = new KollisionsFormen();
const kollisionsStand = kollisionsFormen.vorladen();
server.kollisionswelt.setzeFormQuelle(kollisionsFormen);
console.log(
  `[Kollision] ${kollisionsStand.fest} feste Koerper aus ${kollisionsStand.geladen} Prefabs in ${kollisionsStand.ms} ms`
);
/*
  Null feste Koerper ist der EINE Zustand, den man nicht sieht: Der Server
  laeuft, die Welt sieht normal aus, und erst beim Laufen gegen einen
  Felsen merkt man, dass er keiner ist. Im CI-Checkout ohne `assets/` ist
  das richtig und erwartet — auf einem Server MIT Speicher ist es ein
  Fehler, und dann soll er in der ersten Bildschirmseite stehen.
*/
if (kollisionsStand.fest === 0) {
  console.warn(
    `[Kollision] KEINE Formen — Spieler laufen durch alle Hindernisse. Wurzel: ${ASSET_WURZEL}`
  );
} else if (kollisionsStand.fehlend > 0) {
  console.warn(
    `[Kollision] ${kollisionsStand.fehlend} Modelldatei(en) fehlen, z. B. ${kollisionsFormen.fehlendeDateien.slice(0, 5).join(', ')}`
  );
}

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
