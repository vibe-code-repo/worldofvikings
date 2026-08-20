/**
 * A5 (Schlusskontrolle Paket 2): Deckel fuer offene, nie authentifizierte
 * Verbindungen (NetManager.MAX_PENDING_CONNECTIONS).
 *
 * Vorher zaehlte die "Server voll"-Pruefung ausschliesslich onlinePeers
 * (erst nach Auth befuellt) — ein Angreifer konnte beliebig viele Sockets
 * offen halten, ohne je PasswordAuth zu senden, und den Pre-Auth-Timeout
 * (10s) durch periodisches Ping endlos hinauszoegern. Der Test haelt fest:
 * bis zum Deckel bleiben Sockets offen, ab dem Deckel wird sofort mit
 * Code 1000 / "Too many pending connections" getrennt — VOR jedem
 * VersionCheck/PasswordAuth, also unabhaengig vom Passwort.
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { createWovServer } from '../src/WovServer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-verbindungsdeckel');
rmSync(WORLDS_DIR, { recursive: true, force: true });

// Muss mit NetManager.ts (MAX_PENDING_CONNECTIONS) uebereinstimmen.
const DECKEL = 50;
const PORT = 2501;

function warteAufOeffnen(ws: WebSocket): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    ws.on('open', () => resolvePromise());
    ws.on('error', reject);
  });
}

/**
 * Der WS-Handshake ('open' auf Client-Seite) ist bereits abgeschlossen,
 * BEVOR unser 'connection'-Callback im Server ueberhaupt laeuft — ein
 * 'open' beim Client beweist also nichts ueber den Deckel. Massgeblich
 * ist, ob direkt danach ein 'close' mit dem Deckel-Grund folgt.
 */
function warteAufSchliessenOderGnadenfrist(ws: WebSocket, gnadenfristMs: number): Promise<{ geschlossen: boolean; code?: number; reason?: string }> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ geschlossen: false }), gnadenfristMs);
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      clearTimeout(timer);
      resolvePromise({ geschlossen: true, code, reason: reasonBuf.toString() });
    });
  });
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'verbindungsdeckel' });
  server.start();

  const offeneSockets: WebSocket[] = [];
  try {
    // Alle DECKEL Verbindungen GLEICHZEITIG oeffnen, ohne je ein Paket zu
    // senden.
    //
    // Die erste Fassung oeffnete sie nacheinander und gab jeder 200 ms
    // Gnadenfrist. Das dauerte in Summe rund zehn Sekunden und lief damit
    // genau in den 10-s-Timeout, den der Server auf nicht angemeldete
    // Verbindungen legt: Die zuerst geoeffneten Sockets fielen wieder aus
    // connectedPeers heraus, der Deckel war beim 51. Versuch gar nicht mehr
    // voll, und der Test meldete faelschlich "Deckel greift nicht".
    // Einzeln lief er knapp durch, in der vollen Suite (langsamer) nicht
    // mehr — gemessen am 19.08.2026.
    const sockets = await Promise.all(
      Array.from({ length: DECKEL }, async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
        await warteAufOeffnen(ws);
        return ws;
      })
    );
    offeneSockets.push(...sockets);

    // Kurz warten und dann den Zustand ABFRAGEN statt auf ein close-Ereignis
    // zu lauschen: Wer schon vor dem Anmelden des Lauschers geschlossen
    // wurde, loeste keines mehr aus und waere unbemerkt geblieben.
    await new Promise((f) => setTimeout(f, 300));
    const vorzeitig = sockets.findIndex((ws) => ws.readyState !== WebSocket.OPEN);
    if (vorzeitig >= 0) {
      throw new Error(`Verbindung ${vorzeitig + 1}/${DECKEL} wurde vorzeitig getrennt — Deckel greift zu frueh`);
    }
    console.log(`  ${DECKEL} unauthentifizierte Verbindungen bleiben offen`);

    // Die (DECKEL + 1)-te Verbindung muss sofort abgewiesen werden.
    const ueberzaehlig = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await warteAufOeffnen(ueberzaehlig);
    const ergebnis = await warteAufSchliessenOderGnadenfrist(ueberzaehlig, 2000);
    if (!ergebnis.geschlossen) {
      throw new Error('Verbindung Nr. 51 blieb offen — Deckel greift nicht');
    }
    if (ergebnis.code !== 1000 || !ergebnis.reason?.includes('Too many pending connections')) {
      throw new Error(`unerwarteter Trennungsgrund: code=${ergebnis.code} reason="${ergebnis.reason}"`);
    }
    console.log(`  Verbindung Nr. 51 sofort getrennt: code=${ergebnis.code} reason="${ergebnis.reason}"`);

    console.log('PASS: Deckel fuer unauthentifizierte Verbindungen greift exakt am konfigurierten Limit');
  } finally {
    for (const ws of offeneSockets) ws.close();
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
}

// Ausdruecklich beenden, wie g4-creatures.ts. Der Testserver haelt nach
// server.stop() noch Handles offen (Welt-Tick und Speichertakt), der Prozess
// endet daher von selbst NIE — und ein haengender Test blockiert die gesamte
// Suite, was schlimmer ist als ein fehlschlagender. Gemessen am 19.08.2026:
// Der Lauf meldete PASS und "Server stopped" und stand danach still, bis er
// nach zehn Minuten von aussen abgeraeumt wurde.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
