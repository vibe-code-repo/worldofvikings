/**
 * E2E test: F3/F4 (Security-Review) — Identitaet EINGEBAUT, nicht nur die
 * reine Logik aus Identitaet.ts (die deckt f3-identitaet.ts bereits ab).
 *
 * Prueft den VERDRAHTETEN Zustand ueber echte WebSocket-Verbindungen gegen
 * einen laufenden WovServer:
 *
 *  1. Zwei frische Verbindungen OHNE SessionToken bekommen VERSCHIEDENE
 *     userId (altlastUserId) — schliesst Luecke A (vorher: ein leerer/
 *     nicht vorhandener Identitaetsstring ergab fuer JEDEN Client dieselbe
 *     feste userId).
 *  2. Ein Peer, der sich unter einem ANDEREN Namen verbindet, bekommt NICHT
 *     die Position eines zuvor gesehenen, andersnamigen Spielers — die vom
 *     Auftrag geforderte Kernzusicherung ("Zustand eines fremden Namens
 *     NICHT bekommt"). Der GLEICHE Name (Namens-Migrationspfad, siehe
 *     WovServer.ermittleGespeichertenStand) bekommt die Position dagegen
 *     zurueck — das ist die gewollte Komfort-Wiederherstellung, keine
 *     Sicherheitsluecke (Begruendung dort).
 *  3. Ein gueltiges SessionToken liefert bei der naechsten Verbindung
 *     dieselbe userId zurueck (Sitzung bleibt stabil, ohne dass der Client
 *     irgendein Identitaetsfeld schickt).
 *  4. Ein GEFAELSCHTES SessionToken wird verworfen — der Peer bekommt eine
 *     FRISCHE Identitaet, NIE die eines anderen. Schliesst Luecke B: vorher
 *     konnte ein Angreifer die aus dem Chat abgelesene userId eines Opfers
 *     als eigenes userIdStr einreichen und dessen Identitaet uebernehmen —
 *     dieses Feld existiert im neuen Handshake gar nicht mehr, ein
 *     manipuliertes Token ist der naechstbeste Versuch und scheitert an der
 *     HMAC-Signatur.
 *
 * Run: npx tsx server/test/f3-einbau.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-f3-einbau');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const PORT = 2502;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  AdminCommand: 53,
  AdminEvent: 54,
  AuthChallenge: 68,
};

let fehlgeschlagen = 0;
function check(bezeichnung: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  OK: ${bezeichnung}`);
  } else {
    fehlgeschlagen++;
    console.error(`  FEHLER: ${bezeichnung}${detail ? ` (${detail})` : ''}`);
  }
}

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

interface AuthErgebnis {
  ws: WebSocket;
  /** peer.userId (altlastUserId), wie vom Server in PeerInfo geschickt. */
  ownUserId: string;
  /** Das (neu ausgestellte) SessionToken aus PeerInfo. */
  sessionToken: string;
}

/**
 * Kompletter Handshake bis PeerInfo (VersionCheck v2 → AuthChallenge/Nonce
 * → PasswordAuth mit HMAC-Antwort, Name, optionalem SessionToken). Server
 * laeuft ohne Passwort — HMAC-Schluessel ist der leere String.
 */
function verbindeUndAuth(port: number, name: string, sessionToken = ''): Promise<AuthErgebnis> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);

    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const view = new DataView(data.buffer, data.byteOffset + 1, data.length - 1);

      if (type === P.VersionCheck) {
        const pkt = Buffer.alloc(5);
        pkt.writeUInt8(P.VersionCheck, 0);
        pkt.writeInt32LE(2, 1);
        ws.send(pkt);
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const [nonce] = readString(view, 0);
        const antwort = antwortBerechnen(nonce, '');   // NICHT selbst nachbauen:
        // Eine eigene createHmac-Zeile hier hat am 20.08.2026 genau den
        // Fehler verdeckt, den sie haette finden sollen — der Browser
        // lehnt einen leeren HMAC-Schluessel ab, der Test rechnete
        // trotzdem munter mit ''. Der Test benutzt jetzt dieselbe
        // Funktion wie der echte Client-Pfad.
        const payload = [
          ...writeString(antwort),
          ...writeString(name),
          ...writeString(sessionToken),
        ];
        ws.send(Buffer.from([P.PasswordAuth, ...payload]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        let pos = 0;
        let ownUserId: string, token: string;
        [, pos] = readString(view, pos); // Anzeigename (Echo)
        [ownUserId, pos] = readString(view, pos);
        [, pos] = readString(view, pos); // serverName
        [token] = readString(view, pos);
        resolvePromise({ ws, ownUserId, sessionToken: token });
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  ws.send(Buffer.from([P.AdminCommand, ...writeString(line)]));
}

function schliesseUndWarte(ws: WebSocket): Promise<void> {
  return new Promise((res) => {
    ws.on('close', () => res());
    ws.close();
  });
}

function warte(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'f3-einbau' });
  server.start();

  try {
    // ── 1+2: kein Token, unterschiedliche Namen ──────────────────────
    console.log('\n[1] Erik: frische Identitaet, an eine Position teleportiert:');
    const erik1 = await verbindeUndAuth(PORT, 'Erik');
    sendAdmin(erik1.ws, 'teleport 4200 1300');
    await warte(400);
    const peerErik1 = server.net.getPeers().find((p) => p.name === 'Erik');
    check('Erik online mit erwarteter Position', peerErik1 !== undefined &&
      Math.abs(peerErik1.position.x - 4200) < 1 && Math.abs(peerErik1.position.z - 1300) < 1,
      peerErik1 ? `${peerErik1.position.x}, ${peerErik1.position.z}` : 'nicht gefunden');
    await schliesseUndWarte(erik1.ws);
    await warte(200);

    console.log('\n[2] Bjorn (ANDERER Name, kein Token) — darf Eriks Position NICHT bekommen:');
    const bjorn = await verbindeUndAuth(PORT, 'Bjorn');
    await warte(200);
    const peerBjorn = server.net.getPeers().find((p) => p.name === 'Bjorn');
    check(
      'Bjorn NICHT auf Eriks Position (Zustand eines fremden Namens NICHT uebernommen)',
      peerBjorn !== undefined &&
        !(Math.abs(peerBjorn.position.x - 4200) < 1 && Math.abs(peerBjorn.position.z - 1300) < 1),
      peerBjorn ? `${peerBjorn.position.x}, ${peerBjorn.position.z}` : 'nicht gefunden'
    );
    check(
      'Bjorn hat eine ANDERE userId als Erik (keine feste/geteilte Identitaet bei fehlendem Token — Luecke A)',
      peerBjorn !== undefined && bjorn.ownUserId !== erik1.ownUserId && bjorn.ownUserId !== '0',
      `Erik=${erik1.ownUserId} Bjorn=${bjorn.ownUserId}`
    );
    await schliesseUndWarte(bjorn.ws);
    await warte(200);

    console.log('\n[3] Erik verbindet sich WIEDER unter demselben Namen (kein Token) — Migrationspfad:');
    const erik2 = await verbindeUndAuth(PORT, 'Erik');
    await warte(200);
    const peerErik2 = server.net.getPeers().find((p) => p.name === 'Erik');
    check(
      'Erik bekommt seine eigene Position zurueck (Namens-Migration)',
      peerErik2 !== undefined &&
        Math.abs(peerErik2.position.x - 4200) < 1 && Math.abs(peerErik2.position.z - 1300) < 1,
      peerErik2 ? `${peerErik2.position.x}, ${peerErik2.position.z}` : 'nicht gefunden'
    );
    check(
      'Erik bekommt trotzdem eine FRISCHE userId ohne Token (kein fester Wiederholungswert)',
      erik2.ownUserId !== erik1.ownUserId,
      `erste=${erik1.ownUserId} zweite=${erik2.ownUserId}`
    );
    const erikToken = erik2.sessionToken;
    await schliesseUndWarte(erik2.ws);
    await warte(200);

    // ── 3: gueltiges Token → stabile Identitaet ──────────────────────
    console.log('\n[4] Erik verbindet sich MIT seinem SessionToken — dieselbe userId:');
    check('Token wurde ausgestellt', erikToken.length > 0);
    const erik3 = await verbindeUndAuth(PORT, 'Erik', erikToken);
    check(
      'userId bleibt stabil mit gueltigem Token',
      erik3.ownUserId === erik2.ownUserId,
      `mit Token=${erik3.ownUserId} vorher=${erik2.ownUserId}`
    );
    await schliesseUndWarte(erik3.ws);
    await warte(200);

    // ── 4: gefaelschtes Token → NICHT uebernommen ────────────────────
    console.log('\n[5] Ivar verbindet sich mit einem MANIPULIERTEN Token — bekommt Eriks Identitaet NICHT:');
    const faelschung = erikToken.slice(0, -4) + (erikToken.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    const ivar = await verbindeUndAuth(PORT, 'Ivar', faelschung);
    check(
      'gefaelschtes Token wird verworfen — Ivar bekommt NICHT Eriks userId',
      ivar.ownUserId !== erik2.ownUserId,
      `Ivar=${ivar.ownUserId} Erik=${erik2.ownUserId}`
    );
    await schliesseUndWarte(ivar.ws);

    if (fehlgeschlagen === 0) {
      console.log('\nPASS: F3/F4 verdrahtet — keine geteilte/uebernehmbare Identitaet, Migrationspfad intakt');
    } else {
      throw new Error(`${fehlgeschlagen} Pruefung(en) fehlgeschlagen`);
    }
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
}

// Ausdruecklich beenden (Muster server/test/g4-creatures.ts,
// verbindungsdeckel.ts): server.stop() raeumt Timer nicht restlos weg,
// ein haengender Test blockiert sonst die gesamte Suite.
main()
  .then(() => process.exit(fehlgeschlagen > 0 ? 1 : 0))
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
