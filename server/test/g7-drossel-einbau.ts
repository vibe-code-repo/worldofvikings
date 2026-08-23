/**
 * G7 — Rate-Limits IM ECHTEN PAKETPFAD (NetManager.handlePacket → Drossel).
 *
 * a4-drossel.ts haelt bereits die REINE Token-Bucket-Logik fest (Drossel.ts
 * isoliert, Zeit als Parameter). Dieser Test prueft den EINBAU: echte
 * WebSocket-Pakete durch den echten Server, mit der echten Systemuhr.
 * Zwei Fragen, gleich wichtig:
 *
 *  1. Greift die Drossel ueberhaupt im echten Paketpfad? (PlacePiece:
 *     eimergroesse 8 — ein Stoss von 9 laesst genau 8 durch, keinen mehr.)
 *  2. Wuergt sie legitimes Spielen ab? DAS ist die Zelle, die am
 *     wichtigsten ist:
 *     a) PlayerInput bei der ECHTEN Client-Sendefrequenz (20 Hz,
 *        client/src/main.ts INPUT_SEND_RATE_MS) ueber eine volle Sekunde
 *        — die Fuellrate liegt bewusst darueber (25/s), das darf NIE
 *        auch nur ein einziges Paket verwerfen.
 *     b) Ein normal getakteter Spieler, der nach einem Stoss (s.o.) mit
 *        vernuenftigem Abstand weiterbaut, kommt sofort wieder durch,
 *        sobald der Eimer nachgefuellt hat — kein dauerhafter Bann.
 *     c) Angriffe im menschlichen Tempo (400 ms Abstand, das Attack-Limit
 *        braucht nur 350 ms Fuellzeit) treffen JEDES Mal, keine Luecke.
 *
 * Run: npx tsx server/test/g7-drossel-einbau.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { getStableHash, findItem, HEALTH_MEMBER, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-drossel-einbau');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2514;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerInput: 40,
  InteractResult: 45,
  Attack: 46,
  PlacePiece: 55,
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

function sendAttack(ws: WebSocket, pos: Vector3, waffe = ''): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(0);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

const IDENTITAET: import('@wov/shared').Quaternion = { x: 0, y: 0, z: 0, w: 1 };
function sendPlacePiece(ws: WebSocket, prefabHash: number, pos: Vector3): void {
  const w = new Writer();
  w.writeInt32(prefabHash);
  w.writeVector3(pos);
  w.writeQuaternion(IDENTITAET);
  ws.send(Buffer.concat([Buffer.from([P.PlacePiece]), w.toBuffer()]));
}

function sendPlayerInput(ws: WebSocket, seq: number): void {
  const w = new Writer();
  w.writeInt32(seq);
  w.writeFloat32(0); // moveX — bewusst reglos: nur die Drosselung zaehlt hier, nicht die Bewegung
  w.writeFloat32(0); // moveZ
  w.writeFloat32(0); // lookYaw
  w.writeFloat32(0); // lookPitch
  w.writeFloat32(0); // moveY
  w.writeBool(false); // running
  w.writeBool(false); // jumping
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g7-drossel-einbau', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const ws = await verbinde('Spieler');
    sendAdmin(ws, 'teleport 0 0');
    await warte(200);
    const peer = server.net.getPeers().find((p) => p.name === 'Spieler');
    if (!peer) throw new Error('Peer nicht gefunden');

    // ── [1] Greift die Drossel ueberhaupt? (PlacePiece, Eimer 8) ────
    console.log('\n[1] PlacePiece: Stoss von 9 auf einen Schlag — Eimergroesse ist 8:');
    const menhirHash = getStableHash('GrabMenhir');
    peer.inventar.addItem(findItem('Stone')!, 200); // 9 × 12 Stone reichlich abdecken
    const bauPos: Vector3 = { x: peer.position.x + 2, y: peer.position.y, z: peer.position.z };
    const stoneVorStoss = peer.inventar.countOf('Stone');

    for (let i = 0; i < 9; i++) sendPlacePiece(ws, menhirHash, bauPos); // ohne jede Pause
    await warte(350);

    const zdosNachStoss = server.zdos.getZDOByPrefab(menhirHash).length;
    check(
      'genau 8 von 9 gehen durch (Eimergroesse), nicht mehr',
      zdosNachStoss === 8,
      `${zdosNachStoss}/9`
    );
    check(
      'Materialkosten passen zu genau 8 Platzierungen',
      peer.inventar.countOf('Stone') === stoneVorStoss - 8 * 12,
      `${stoneVorStoss} → ${peer.inventar.countOf('Stone')}`
    );

    // ── [1b] Kein dauerhafter Bann — nach der Fuellzeit geht's weiter ─
    console.log('\n[1b] Nach der Fuellzeit (250 ms/Token) zaehlt der naechste Klick wieder:');
    await warte(300); // >= 250 ms seit dem Stoss: mindestens 1 Token nachgefuellt
    sendPlacePiece(ws, menhirHash, bauPos);
    await warte(250);
    check(
      'legitimer Klick NACH der Fuellzeit kommt durch',
      server.zdos.getZDOByPrefab(menhirHash).length === 9,
      `${server.zdos.getZDOByPrefab(menhirHash).length}/9`
    );

    // ── [2a] PlayerInput bei der ECHTEN Client-Frequenz (20 Hz) ─────
    console.log('\n[2a] PlayerInput bei 20 Hz ueber 1 s — darf KEIN Paket verlieren (die wichtigste Zelle):');
    const charZdo = server.zdos.getZDO(peer.characterID);
    if (!charZdo) throw new Error('Charakter-ZDO fehlt');
    const revVorher = charZdo.revision.dataRevision;
    const ANZAHL_INPUTS = 20;
    for (let i = 1; i <= ANZAHL_INPUTS; i++) {
      sendPlayerInput(ws, i);
      await warte(50); // client/src/main.ts INPUT_SEND_RATE_MS — die ECHTE Spielfrequenz
    }
    await warte(150);
    const revNachher = charZdo.revision.dataRevision;
    check(
      'alle 20 PlayerInput-Pakete bei 20 Hz verarbeitet (jedes revidiert die Charakter-ZDO)',
      revNachher - revVorher === ANZAHL_INPUTS,
      `Δ=${revNachher - revVorher}/${ANZAHL_INPUTS}`
    );

    // ── [2c] Angriffe im menschlichen Tempo — jeder trifft ──────────
    console.log('\n[2c] Angriffe alle 400 ms (> 350 ms Fuellzeit) — treffen JEDES Mal:');
    const skelHash = getStableHash('Skeleton');
    const ziele = [
      server.zdos.createZDO(skelHash, { x: 3, y: 0, z: 3 }),
      server.zdos.createZDO(skelHash, { x: -3, y: 0, z: 3 }),
      server.zdos.createZDO(skelHash, { x: 3, y: 0, z: -3 }),
    ];
    for (const ziel of ziele) {
      await warte(400);
      sendAttack(ws, ziel.position, '');
      await warte(200);
    }
    const treffer = ziele.filter((z) => z.getInt(HEALTH_MEMBER) > 0 && z.getInt(HEALTH_MEMBER) < 20).length;
    check(
      'alle 3 im Menschentempo gefuehrten Schlaege trafen (keiner von der Drossel verworfen)',
      treffer === 3,
      `${treffer}/3 (HP: ${ziele.map((z) => z.getInt(HEALTH_MEMBER)).join(', ')})`
    );

    console.log(
      failures === 0 ? '\n=== G7 Rate-Limits: ALL PASSED ===' : `\n=== G7 Rate-Limits: ${failures} FAILURES ===`
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
