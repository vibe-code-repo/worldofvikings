/**
 * G7 — Kampf, ueber den ECHTEN Paketpfad (handleAttack/handleHarvest).
 *
 * A2 (Security-Review) haelt bereits die reine Funktion gepruefteWaffe fest
 * (server/test/a2-waffe-inventar.ts). Dieser Test prueft denselben Effekt
 * EINGEBAUT: ein echter WebSocket-Client, ein echter Handshake, echte
 * Attack-Pakete durch NetManager.handlePacket (inkl. Drossel) hindurch bis
 * WovServer.handleAttack — keine der hier geprueften Regeln wird im Test
 * nachgebaut, nur ihr WIRKUNGSABDRUCK auf Peer/ZDO wird gelesen.
 *
 * Deckt vom Auftrag (Kampf):
 *  1. Schaden aus dem Inventar: Faust < Axt (besessen) UND eine im Paket
 *     genannte, aber NICHT besessene Waffe faellt exakt auf Faustschaden
 *     zurueck (A2 im Draht, nicht nur in der reinen Funktion).
 *  2. Ausdauerverbrauch: < 8 Punkte verweigert den Schlag komplett (kein
 *     Abzug, kein Treffer); genug Punkte kostet exakt 8.
 *  3. Reichweite: ein Angriff auf eine Position > NAHKAMPF_REICHWEITE (8 m)
 *     von der SERVER-Position aus bleibt wirkungslos — keine Ausdauer, kein
 *     Treffer.
 *  4. Cooldown ueber die Drossel: zwei Attack-Pakete ohne Pause — nur EINS
 *     zaehlt (STANDARD_DROSSEL: Attack-Eimergroesse 1). Der naechste Schlag
 *     nach der Fuellzeit (350 ms) zaehlt wieder normal — legitimes,
 *     langsameres Spielen wird NICHT abgewuergt.
 *  5. Tod und Beute: eine Kreatur mit garantiertem Drop (Boar → RawMeat,
 *     Chance 1) stirbt nach genug Treffern, das Item landet im
 *     Server-Inventar, und die letzte InteractResult traegt die Beute.
 *
 * Run: npx tsx server/test/g7-kampf.ts   (from the repo root)
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
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-kampf');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2510;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  InteractResult: 45,
  Attack: 46,
  AdminCommand: 53,
  AdminEvent: 54,
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

function sendAttack(ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

interface InteractResultMsg {
  ok: boolean;
  message: string;
  itemName: string;
  amount: number;
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'g7-kampf', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const ws = await verbinde('Kaempfer');
    const interactLog: InteractResultMsg[] = [];
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      if (type !== P.InteractResult) return;
      const reader = new Reader(Buffer.from(data.subarray(1)));
      interactLog.push({
        ok: reader.readBool(),
        message: reader.readString(),
        itemName: reader.readString(),
        amount: reader.readInt32(),
      });
    });

    sendAdmin(ws, 'teleport 0 0');
    await warte(200);
    const peer = server.net.getPeers().find((p) => p.name === 'Kaempfer');
    if (!peer) throw new Error('Peer nicht gefunden');
    // AxeFlint gehoert ohnehin zur Server-Startausruestung jedes Neulings
    // (WovServer.ts, START-Liste) — Club NICHT, das ist die Grundlage fuer
    // den Fallback-Nachweis in [1].

    const skeletonHash = getStableHash('Skeleton');
    const boarHash = getStableHash('Boar');
    const hp = (zdo: ZDO): number => zdo.getInt(HEALTH_MEMBER);

    // ── [1] Schaden aus dem Inventar ──────────────────────────────
    console.log('\n[1] Schaden nur fuer besessene Waffen (A2 im Draht):');
    const skelA = server.zdos.createZDO(skeletonHash, { x: 3, y: 0, z: 3 });
    const skelB = server.zdos.createZDO(skeletonHash, { x: -3, y: 0, z: -3 });
    const skelC = server.zdos.createZDO(skeletonHash, { x: 3, y: 0, z: -3 });

    sendAttack(ws, skelA.position, ''); // Faust
    await warte(400);
    sendAttack(ws, skelB.position, 'AxeFlint'); // besessene Waffe
    await warte(400);
    sendAttack(ws, skelC.position, 'Club'); // NICHT besessen → Faust
    await warte(400);

    const faustSchaden = 20 - hp(skelA);
    const axtSchaden = 20 - hp(skelB);
    const fallbackSchaden = 20 - hp(skelC);
    check('Faustschlag traf', faustSchaden > 0, `${faustSchaden}`);
    check('Axt macht mehr Schaden als Faust', axtSchaden > faustSchaden, `Axt=${axtSchaden} Faust=${faustSchaden}`);
    check(
      'nicht besessene Waffe im Paket faellt exakt auf Faustschaden zurueck',
      fallbackSchaden === faustSchaden,
      `Fallback=${fallbackSchaden} Faust=${faustSchaden}`
    );

    // ── [2] Ausdauerverbrauch ──────────────────────────────────────
    console.log('\n[2] Ausdauerverbrauch:');
    const skelStam = server.zdos.createZDO(skeletonHash, { x: 0, y: 0, z: -6 });
    peer.stamina = 5;
    sendAttack(ws, skelStam.position, '');
    await warte(400);
    check('< 8 Ausdauer: kein Treffer', hp(skelStam) === 0, `hp=${hp(skelStam)}`);
    check('< 8 Ausdauer: kein Abzug', peer.stamina === 5, `stamina=${peer.stamina}`);

    peer.stamina = 100;
    sendAttack(ws, skelStam.position, '');
    await warte(400);
    check('genug Ausdauer: Treffer', hp(skelStam) === 20 - faustSchaden, `hp=${hp(skelStam)}`);
    check('genug Ausdauer: Abzug exakt 8', peer.stamina === 92, `stamina=${peer.stamina}`);

    // ── [3] Reichweite ───────────────────────────────────────────
    console.log('\n[3] Reichweite (Server-Position massgeblich):');
    const skelFern = server.zdos.createZDO(skeletonHash, { x: 5000, y: 0, z: 5000 });
    sendAttack(ws, skelFern.position, '');
    await warte(400);
    check('ausser Reichweite: kein Treffer', hp(skelFern) === 0, `hp=${hp(skelFern)}`);
    check('ausser Reichweite: keine Ausdauer verbraucht', peer.stamina === 92, `stamina=${peer.stamina}`);

    // ── [4] Cooldown ueber die Drossel ────────────────────────────
    console.log('\n[4] Cooldown ueber die Drossel (Attack-Eimergroesse 1):');
    const skelBurst = server.zdos.createZDO(skeletonHash, { x: 6, y: 0, z: 0 });
    sendAttack(ws, skelBurst.position, ''); // sollte zaehlen
    sendAttack(ws, skelBurst.position, ''); // sollte von der Drossel verworfen werden
    await warte(350);
    check(
      'Stossangriff: nur EIN Treffer zaehlt',
      hp(skelBurst) === 20 - faustSchaden,
      `hp=${hp(skelBurst)} (erwartet ${20 - faustSchaden})`
    );
    check('Stossangriff: nur EIN Ausdauerabzug', peer.stamina === 84, `stamina=${peer.stamina}`);

    await warte(400); // Fuellzeit abwarten — Eimer wieder voll
    sendAttack(ws, skelBurst.position, ''); // legitimer Folgeschlag, langsamer getaktet
    await warte(300);
    check(
      'legitimer Folgeschlag NACH der Fuellzeit zaehlt normal',
      hp(skelBurst) === 20 - 2 * faustSchaden,
      `hp=${hp(skelBurst)} (erwartet ${20 - 2 * faustSchaden})`
    );

    // ── [5] Tod und Beute ────────────────────────────────────────
    console.log('\n[5] Tod und Beute (Boar → garantiert RawMeat):');
    const boar = server.zdos.createZDO(boarHash, { x: 0, y: 0, z: 6 });
    const boarZdoid = boar.zdoid;
    const rawMeatVorher = peer.inventar.countOf('RawMeat');
    let tot = false;
    for (let i = 0; i < 8 && !tot; i++) {
      await warte(400);
      sendAttack(ws, boar.position, 'AxeFlint');
      await warte(250);
      tot = server.zdos.getZDO(boarZdoid) === undefined;
    }
    check('Boar stirbt nach genug Treffern', tot);
    const rawMeatNachher = peer.inventar.countOf('RawMeat');
    check(
      'RawMeat im Server-Inventar gelandet',
      rawMeatNachher > rawMeatVorher,
      `${rawMeatVorher} → ${rawMeatNachher}`
    );
    const beuteMsg = interactLog.at(-1);
    check(
      'letzte InteractResult meldet die Beute',
      !!beuteMsg && beuteMsg.ok && beuteMsg.itemName === 'RawMeat' && beuteMsg.amount > 0,
      JSON.stringify(beuteMsg)
    );

    console.log(
      failures === 0 ? '\n=== G7 Kampf: ALL PASSED ===' : `\n=== G7 Kampf: ${failures} FAILURES ===`
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
