/**
 * E2E test: dungeon enter/leave over the wire.
 *
 * Boots the server on a test port, handshakes a fake client, then:
 *  1. AdminCommand "dungeon create forestcrypt 4242" → AdminEvent with the
 *     new document id.
 *  2. AdminCommand "dungeon enter <id>" → Teleport packet into the
 *     instance band (x = DUNGEON_INSTANCE_X_BASE) with inDungeon=true and
 *     an interior environment name.
 *  3. ZDOSync soon after delivers the materialized room-shell ZDOs at
 *     band coordinates (interest management follows the teleported peer).
 *  4. AdminCommand "dungeon leave" → Teleport back (inDungeon=false,
 *     overworld coordinates).
 *
 * Run: npx tsx server/test/g6-dungeon-e2e.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DUNGEON_INSTANCE_BAND_MIN, getStableHash } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
// F4-Lehre (siehe Kopfkommentar scripts/run-tests.mjs / CLAUDE.md): die
// Handshake-Antwort MUSS ueber die Produktivfunktion laufen, nicht ueber
// eine eigene HMAC-Zeile. Der Test baute bislang createHmac('sha256', '')
// direkt nach — bei leerem Passwort ersetzt antwortBerechnen den leeren
// Schluessel aber durch HANDSHAKE_LEERPASSWORT_SCHLUESSEL (Identitaet.ts,
// spiegelt client/src/net/GameSocket.ts). Die Nachbau-Zeile lieferte daher
// eine falsche Antwort, der Server verwarf sie (Wrong password) und der
// Test hing bis zum 30s-Timeout in Phase 'create' — nie in der
// ZDOSync-Stelle, die eigentlich geprueft werden sollte.
import { antwortBerechnen } from '../src/net/Identitaet.js';
// D6-Lehre (dieselbe Regel, zweites Vorkommen in dieser Datei): das
// ZDOSync-Drahtformat hat seit D6 zwei Satzarten (VOLLSTAND/DELTA, ein
// Flagbyte VOR der userId, prefabHash und das zweite Flagbyte nur beim
// Vollstand) — der Test parste das Paket bisher von Hand nach einem
// ÄLTEREN, flacheren Format nach (kein Flagbyte, prefabHash immer
// vorhanden) und stürzte prompt mit "Invalid typed array length" ab,
// sobald der erste echte Satz ankam. Fix: den ECHTEN Client-Parser
// verwenden, exakt wie server/test/d6-zdo-delta.ts es vormacht.
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-g6');
const PORT = 2498;
const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ZDOSync: 10,
  Teleport: 43,
  AdminCommand: 53,
  AdminEvent: 54,
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
  let result = 0,
    shift = 0,
    byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [(result >>> 1) ^ -(result & 1), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

function sendAdmin(ws: WebSocket, line: string): void {
  ws.send(Buffer.from([P.AdminCommand, ...writeString(line)]));
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'),
    saveIntervalMs: 3600_000,
  });
  server.start();

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';

  let authSent = false;
  let dungeonId: string | null = null;
  let phase: 'create' | 'enter' | 'zdos' | 'leave' | 'done' = 'create';
  let roomShellSeen = false;
  const roomShellCandidates = new Set<number>();
  // Wie ein echter Client: EIN Spiegel für die ganze Verbindung, sonst
  // verwirft parseZDOSync jedes Delta als "ohne Vollstand" (siehe
  // ZDOSync.ts deltaLueckeGemeldet-Warnung).
  const spiegel = new ZDOSpiegel();

  const done = new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timeout in phase '${phase}' (roomShellSeen=${roomShellSeen})`)),
      30000
    );

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
          const antwort = antwortBerechnen(nonce, '');
          const payload = [...writeString(antwort), ...writeString('Tester'), ...writeString('')];
          ws.send(Buffer.from([P.PasswordAuth, ...payload]));
          // Handshake fertig → Phase 1
          setTimeout(() => sendAdmin(ws, 'dungeon create forestcrypt 4242'), 500);
        }
      } else if (type === P.AdminEvent) {
        let pos = 0;
        let cmd: string, msg: string;
        [cmd, pos] = readString(view, pos);
        pos += 1; // active bool
        [msg] = readString(view, pos);
        console.log(`AdminEvent [${phase}]: ${msg}`);

        if (phase === 'create') {
          const m = msg.match(/Dungeon erzeugt: (\S+)/);
          if (!m) return reject(new Error(`create failed: ${msg}`));
          dungeonId = m[1]!;
          phase = 'enter';
          sendAdmin(ws, `dungeon enter ${dungeonId}`);
        }
      } else if (type === P.Teleport) {
        const x = view.getFloat32(0, true);
        const y = view.getFloat32(4, true);
        const z = view.getFloat32(8, true);
        const inDungeon = view.getUint8(12) !== 0;
        let pos = 13;
        let id: string, env: string;
        [id, pos] = readString(view, pos);
        [env] = readString(view, pos);
        console.log(
          `Teleport: (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}) inDungeon=${inDungeon} id='${id}' env='${env}'`
        );

        if (phase === 'enter') {
          if (!inDungeon || x < DUNGEON_INSTANCE_BAND_MIN) {
            return reject(new Error('enter teleport not in instance band'));
          }
          if (id !== dungeonId) return reject(new Error(`teleport id mismatch: ${id}`));
          if (env !== 'Crypt') return reject(new Error(`unexpected env: ${env}`));
          phase = 'zdos';
          // ZDOSync-Interesse folgt der neuen Position — kurz warten.
          setTimeout(() => {
            if (!roomShellSeen) return reject(new Error('no room-shell ZDOs synced in band'));
            phase = 'leave';
            sendAdmin(ws, 'dungeon leave');
          }, 2000);
        } else if (phase === 'leave') {
          if (inDungeon || x > DUNGEON_INSTANCE_BAND_MIN) {
            return reject(new Error('leave teleport still in band'));
          }
          clearTimeout(timeout);
          phase = 'done';
          resolvePromise();
        }
      } else if (type === P.ZDOSync) {
        // Echter Client-Parser statt Nachbau (s. Importkommentar oben).
        // Läuft auch ausserhalb von Phase 'zdos' mit — ein Vollstand vor
        // dem Dungeon-Eintritt füllt den Spiegel, sonst würfe das erste
        // Delta danach die "ohne Vollstand"-Warnung.
        const reader = new BinaryReader(data.buffer, data.byteOffset + 1);
        const { updates } = parseZDOSync(reader, 'Tester', spiegel);
        if (phase === 'zdos') {
          for (const u of updates) {
            if (u.position.x > DUNGEON_INSTANCE_BAND_MIN && roomShellCandidates.has(u.prefabHash)) {
              roomShellSeen = true;
            }
          }
        }
      }
    });
    ws.on('error', reject);
  });

  // Raum-Hashes des ForestCrypt-Kits als Erkennungsmenge
  const { DUNGEONS } = await import('@wov/shared');
  for (const r of DUNGEONS.find((d) => d.name === 'DG_ForestCrypt')!.rooms) {
    roomShellCandidates.add(getStableHash(r.name));
  }

  try {
    await done;
    console.log('PASS: dungeon create/enter/zdos/leave roundtrip ok');
  } catch (err) {
    console.error('FAIL:', err);
    process.exitCode = 1;
  } finally {
    ws.close();
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}

main();
