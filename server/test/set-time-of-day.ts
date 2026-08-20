/**
 * E2E test: SetTimeOfDay packet.
 *
 * 1. Admin-Peer (everyoneAdmin: true, Server-Default): Anfrage geht durch,
 *    TimeSync broadcastet die gewuenschte Zeit.
 * 2. Nicht-Admin-Peer (everyoneAdmin: false — A3-Review): Anfrage wird
 *    abgelehnt. Vorher liess handleSetTimeOfDay JEDEN authentifizierten
 *    Spieler die Weltzeit fuer ALLE umstellen; die Ablehnung muss jetzt
 *    per InteractResult zurueckgemeldet werden statt still zu verpuffen,
 *    und es darf KEIN TimeSync mit der angefragten Zeit rausgehen.
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Eigenes Verzeichnis statt data/worlds (Default) — sonst landet bei jedem
// Testlauf ein world.db.zst neben Mikes echtem dev.db.zst (siehe g2-persistence.ts).
const WORLDS_DIR = resolve(__dirname, 'tmp-set-time-of-day');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const P = {
  VersionCheck: 1,
  PeerInfo: 3,
  TimeSync: 30,
  PasswordAuth: 2,
  SetTimeOfDay: 33,
  InteractResult: 45,
  // F4 (Security-Review): Nonce/HMAC-Passwort-Handshake.
  AuthChallenge: 68,
};

function writeString(v: string): number[] {
  const enc = new TextEncoder().encode(v);
  let zigzag = ((enc.length << 1) ^ (enc.length >> 31)) >>> 0;
  const out: number[] = [];
  do {
    const b = zigzag & 0x7f;
    zigzag >>>= 7;
    out.push(zigzag ? b | 0x80 : b);
  } while (zigzag);
  return [...out, ...enc];
}

function readVarInt(view: DataView, pos: number): [number, number] {
  let result = 0, shift = 0, byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [((result >>> 1) ^ -(result & 1)), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

/**
 * Handshake bis zur Auth — identisch fuer beide Faelle, nur der Callback
 * je Pakettyp unterscheidet sich.
 *
 * F3/F4 (Security-Review): VersionCheck v2, dann AuthChallenge (Nonce) ↔
 * PasswordAuth (HMAC-SHA256(key=Passwort='', data=Nonce), Name, leeres
 * SessionToken — der Server vergibt bei leerem/ungueltigem Token eine
 * frische Identitaet, ein frei gewaehltes userId-Feld gibt es nicht mehr).
 */
function verbinde(port: number, onPacket: (type: number, view: DataView) => void): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'nodebuffer';
  let authSent = false;

  ws.on('message', (data: Buffer) => {
    const type = data.readUInt8(0);
    const view = new DataView(data.buffer, data.byteOffset + 1, data.length - 1);

    if (type === P.VersionCheck) {
      const pkt = Buffer.alloc(5);
      pkt.writeUInt8(P.VersionCheck, 0);
      pkt.writeInt32LE(2, 1);
      ws.send(pkt);
    } else if (type === P.AuthChallenge) {
      if (!authSent) {
        authSent = true;
        const [nonce] = readString(view, 0);
        const antwort = antwortBerechnen(nonce, '');   // NICHT selbst nachbauen:
        // Eine eigene createHmac-Zeile hier hat am 20.08.2026 genau den
        // Fehler verdeckt, den sie haette finden sollen — der Browser
        // lehnt einen leeren HMAC-Schluessel ab, der Test rechnete
        // trotzdem munter mit ''. Der Test benutzt jetzt dieselbe
        // Funktion wie der echte Client-Pfad.
        const payload = [...writeString(antwort), ...writeString('Tester'), ...writeString('')];
        ws.send(Buffer.from([P.PasswordAuth, ...payload]));
      }
    } else {
      onPacket(type, view);
    }
  });
  return ws;
}

function sendSetTimeOfDay(ws: WebSocket, seconds: number): void {
  const pkt = Buffer.alloc(9);
  pkt.writeUInt8(P.SetTimeOfDay, 0);
  pkt.writeDoubleLE(seconds, 1);
  ws.send(pkt);
}

/** Admin darf: Anfrage geht durch, TimeSync broadcastet die neue Zeit. */
async function testAdminDarf(): Promise<void> {
  const PORT = 2499;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR }); // Default everyoneAdmin: true
  server.start();

  let initialTimeOfDay: number | null = null;
  let ws!: WebSocket;

  const done = new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for TimeSync broadcast')), 8000);
    ws = verbinde(PORT, (type, view) => {
      if (type !== P.TimeSync) return;
      const timeOfDay = view.getFloat64(8, true);
      if (initialTimeOfDay === null) {
        initialTimeOfDay = timeOfDay;
        console.log(`  [admin] initial TimeSync: timeOfDay=${timeOfDay.toFixed(0)}`);
        sendSetTimeOfDay(ws, 1530);
      } else {
        console.log(`  [admin] after set TimeSync: timeOfDay=${timeOfDay.toFixed(0)}`);
        clearTimeout(timeout);
        if (Math.abs(timeOfDay - 1530) < 2) resolvePromise();
        else reject(new Error(`expected timeOfDay≈1530, got ${timeOfDay}`));
      }
    });
    ws.on('error', reject);
  });

  try {
    await done;
    console.log('PASS: Admin — SetTimeOfDay broadcast mit angefragter Zeit');
  } finally {
    ws.close();
    server.stop();
  }
}

/** Nicht-Admin darf nicht: Ablehnung per InteractResult, kein TimeSync mit der angefragten Zeit. */
async function testNichtAdminDarfNicht(): Promise<void> {
  const PORT = 2500;
  // Eigener worldName — sonst laedt dieser Server den Spielstand, den
  // testAdminDarf() gerade erst gespeichert hat (gleiches WORLDS_DIR).
  const server = createWovServer({ port: PORT, everyoneAdmin: false, worldsDir: WORLDS_DIR, worldName: 'ohne-rechte' });
  server.start();

  let sawInteractResult = false;
  let timeSyncCount = 0;
  let ws!: WebSocket;

  const done = new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for InteractResult rejection')), 8000);
    ws = verbinde(PORT, (type, view) => {
      if (type === P.TimeSync) {
        timeSyncCount++;
        const timeOfDay = view.getFloat64(8, true);
        if (timeSyncCount === 1) {
          console.log(`  [nicht-admin] initial TimeSync: timeOfDay=${timeOfDay.toFixed(0)}`);
          sendSetTimeOfDay(ws, 1530);
        } else if (Math.abs(timeOfDay - 1530) < 2) {
          clearTimeout(timeout);
          reject(new Error('SetTimeOfDay wurde trotz fehlender Admin-Berechtigung uebernommen (broadcastete TimeSync≈1530)'));
        }
        return;
      }
      if (type !== P.InteractResult) return;
      const ok = view.getUint8(0) !== 0;
      const [message] = readString(view, 1);
      console.log(`  [nicht-admin] InteractResult ok=${ok} message="${message}"`);
      sawInteractResult = true;
      clearTimeout(timeout);
      if (ok) return reject(new Error('InteractResult meldete ok=true — Ablehnung erwartet'));
      if (!message.includes('Keine Berechtigung')) {
        return reject(new Error(`Ablehnungsmeldung fehlt/unerwartet: "${message}"`));
      }
      resolvePromise();
    });
    ws.on('error', reject);
  });

  try {
    await done;
    if (!sawInteractResult) throw new Error('kein InteractResult erhalten');
    console.log('PASS: Nicht-Admin — SetTimeOfDay abgelehnt, kein stiller Fehlschlag');
  } finally {
    ws.close();
    server.stop();
  }
}

async function main(): Promise<void> {
  try {
    await testAdminDarf();
    await testNichtAdminDarfNicht();
  } catch (err) {
    console.error('FAIL:', err);
    process.exitCode = 1;
  } finally {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}

main();
