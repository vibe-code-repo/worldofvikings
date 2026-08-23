/**
 * G7 — ZDO-Interest-Management, ueber den ECHTEN Sync-Pfad (syncZDOs →
 * ZonenFenster → echter Client-Parser).
 *
 * d6-zdo-delta.ts haelt das DRAHTFORMAT fest (Kodierung/Dekodierung eines
 * einzelnen Satzes), g6-dungeon-e2e.ts nutzt das Sichtfenster beilaeufig
 * (Dungeon-Raumschalen tauchen "irgendwann" auf). Dieser Test prueft die
 * AUSWAHL selbst: bekommt ein Peer, was in seiner Naehe liegt (Radius 4
 * Zonen × 64 m = 256 m, WovServer.SICHT_RADIUS_ZONEN), und NICHT, was weit
 * weg liegt — und folgt das Fenster der Spielerposition, wenn er sich
 * bewegt.
 *
 * Der Sync-Handler selbst (syncZDOs) ist privat; dieser Test ruft ihn nie
 * direkt auf, sondern liest ausschliesslich die Pakete, die er ueber den
 * echten WebSocket verschickt — mit dem echten Client-Parser (parseZDOSync/
 * ZDOSpiegel), wie g6/d6 es vormachen.
 *
 * Run: npx tsx server/test/g7-zdo-interessen.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { getStableHash } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-zdo-interessen');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2517;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ZDOSync: 10,
  AdminCommand: 53,
  AuthChallenge: 68,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const antwort = antwortBerechnen(nonce, '');
        const w = new Writer();
        w.writeString(antwort);
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(ws);
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g7-zdo-interessen', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const ws = await verbinde('Beobachter');

    // Echter Client-Zustand + echter Parser (d6/g6-Muster) statt eines
    // handgestrickten Nachbaus des Drahtformats.
    const spiegel = new ZDOSpiegel();
    const gesehen = new Set<string>();
    ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) !== P.ZDOSync) return;
      const reader = new BinaryReader(data.buffer, data.byteOffset + 1);
      const { updates } = parseZDOSync(reader, 'Beobachter', spiegel);
      for (const u of updates) gesehen.add(u.key);
    });

    sendAdmin(ws, 'teleport 0 0');
    await warte(200);

    const kiPineHash = getStableHash('KiPine2');
    const nah = server.zdos.createZDO(kiPineHash, { x: 30, y: 0, z: 30 }); // 42 m, innerhalb 256 m
    const fern = server.zdos.createZDO(kiPineHash, { x: 3000, y: 0, z: 3000 }); // weit ausserhalb

    // ── [1] Nah bekommt der Peer, fern nicht ────────────────────────
    console.log('\n[1] Sichtfenster um (0,0): nah rein, fern raus:');
    await warte(600); // mehrere Sync-Ticks (alle 50 ms) abwarten
    check('nahe ZDO im Sync angekommen', gesehen.has(nah.zdoid.toString()), nah.zdoid.toString());
    check('ferne ZDO NICHT im Sync angekommen', !gesehen.has(fern.zdoid.toString()), fern.zdoid.toString());

    // ── [2] Das Fenster folgt der Spielerposition ──────────────────
    console.log('\n[2] Nach dem Teleport zur vormals fernen ZDO: sie taucht jetzt auf:');
    const nochFerner = server.zdos.createZDO(kiPineHash, { x: 6000, y: 0, z: 3000 }); // >> 256 m von (3000,3000)
    gesehen.clear();
    sendAdmin(ws, 'teleport 3000 3000');
    await warte(600);
    check(
      'die vormals ferne ZDO ist jetzt im Interessensbereich',
      gesehen.has(fern.zdoid.toString()),
      fern.zdoid.toString()
    );
    check(
      'die jetzt ferne (urspruenglich nahe) ZDO bleibt aussen vor',
      !gesehen.has(nah.zdoid.toString()),
      nah.zdoid.toString()
    );
    check(
      'eine dritte, noch weiter entfernte ZDO bleibt ebenfalls aussen vor',
      !gesehen.has(nochFerner.zdoid.toString()),
      nochFerner.zdoid.toString()
    );

    console.log(
      failures === 0 ? '\n=== G7 ZDO-Interessensverwaltung: ALL PASSED ===' : `\n=== G7 ZDO-Interessensverwaltung: ${failures} FAILURES ===`
    );
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
