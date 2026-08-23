/**
 * G7 — Bauen und Abreissen, ueber den ECHTEN Paketpfad (handlePlacePiece/
 * handleRemovePiece).
 *
 * Deckt vom Auftrag (Bauen und Abreissen):
 *  1. Platzieren: Materialkosten SERVERSEITIG abgezogen, ZDO traegt
 *     'spieler'=1.
 *  2. Besitz: der 'besitzer'-Member traegt die userId des Erbauers.
 *  3. Reichweitenpruefung: ein Platzierungsversuch > 8 m von der
 *     SERVER-Position bleibt wirkungslos (kein ZDO, keine Kosten).
 *  4. Abreissen durch Fremde: ein ANDERER Peer reisst ein besessenes Piece
 *     NICHT ab — vollstaendig stumm (keine Antwort, kein Verlust).
 *  5. Abreissen durch den Eigentuemer: ZDO weg, halbe Materialkosten
 *     zurueck.
 *
 * Einziges eigenes Bau-Prefab mit reiner Materialkoste (kein Terrain-
 * Effekt wie bau_kipine): GrabMenhir (bau_menhir), 12 Stone. Beide sind
 * gegen die EIGENE_MODELLE-Whitelist gefiltert und liegen deshalb allein
 * in BAU_PREFABS (server/src/items/PieceTable.ts).
 *
 * Neulinge bekommen serverseitig 30 Stone Startausruestung (WovServer.ts,
 * START) — der Test liest die Bestandszahl deshalb IMMER per countOf()
 * gegen den vorherigen Stand, statt einen absoluten Wert anzunehmen.
 *
 * Run: npx tsx server/test/g7-bauen.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { getStableHash, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-bauen');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2511;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  InteractResult: 45,
  PlacePiece: 55,
  RemovePiece: 56,
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

function verbinde(name: string, port: number): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
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

const IDENTITAET: import('@wov/shared').Quaternion = { x: 0, y: 0, z: 0, w: 1 };

function sendPlacePiece(ws: WebSocket, prefabHash: number, pos: Vector3): void {
  const w = new Writer();
  w.writeInt32(prefabHash);
  w.writeVector3(pos);
  w.writeQuaternion(IDENTITAET);
  ws.send(Buffer.concat([Buffer.from([P.PlacePiece]), w.toBuffer()]));
}

function sendRemovePiece(ws: WebSocket, pos: Vector3): void {
  const w = new Writer();
  w.writeVector3(pos);
  ws.send(Buffer.concat([Buffer.from([P.RemovePiece]), w.toBuffer()]));
}

interface InteractResultMsg {
  ok: boolean;
  message: string;
  itemName: string;
  amount: number;
}

function hoereAufInteractResult(ws: WebSocket, log: InteractResultMsg[]): void {
  ws.on('message', (data: Buffer) => {
    const type = data.readUInt8(0);
    if (type !== P.InteractResult) return;
    const reader = new Reader(Buffer.from(data.subarray(1)));
    log.push({
      ok: reader.readBool(),
      message: reader.readString(),
      itemName: reader.readString(),
      amount: reader.readInt32(),
    });
  });
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g7-bauen', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const menhirHash = getStableHash('GrabMenhir');

    const bauerWs = await verbinde('Bauer', PORT);
    const bauerLog: InteractResultMsg[] = [];
    hoereAufInteractResult(bauerWs, bauerLog);

    sendAdmin(bauerWs, 'teleport 200 200');
    await warte(200);
    const bauer = server.net.getPeers().find((p) => p.name === 'Bauer');
    if (!bauer) throw new Error('Bauer nicht gefunden');

    const stoneVorPlatzieren = bauer.inventar.countOf('Stone');
    const bautenVorPlatzieren = bauer.bautenAnzahl;
    const platzPos: Vector3 = { x: bauer.position.x + 3, y: bauer.position.y, z: bauer.position.z };

    // ── [1+2] Platzieren, Kosten, Besitzer ────────────────────────
    console.log('\n[1+2] Platzieren — Materialkosten und Besitzer:');
    sendPlacePiece(bauerWs, menhirHash, platzPos);
    await warte(300);

    const antwortBau = bauerLog.at(-1);
    check('Platzieren bestaetigt', !!antwortBau?.ok && antwortBau.message.includes('gebaut'), JSON.stringify(antwortBau));
    check(
      '12 Stone abgezogen',
      bauer.inventar.countOf('Stone') === stoneVorPlatzieren - 12,
      `${stoneVorPlatzieren} → ${bauer.inventar.countOf('Stone')}`
    );
    check('bautenAnzahl erhoeht', bauer.bautenAnzahl === bautenVorPlatzieren + 1, `${bauer.bautenAnzahl}`);

    const gebaut = server.zdos.getZDOByPrefab(menhirHash)[0];
    check('ZDO wurde angelegt', gebaut !== undefined);
    check('ZDO traegt spieler=1', gebaut?.getInt('spieler') === 1);
    check(
      "'besitzer'-Member traegt die userId des Erbauers",
      gebaut?.getString('besitzer') === bauer.userId.toString(),
      `besitzer="${gebaut?.getString('besitzer')}" userId=${bauer.userId}`
    );
    if (!gebaut) throw new Error('kein Piece angelegt — Test kann nicht fortfahren');
    const gebautZdoid = gebaut.zdoid;

    // ── [3] Reichweitenpruefung beim Platzieren ───────────────────
    console.log('\n[3] Reichweitenpruefung beim Platzieren:');
    const stoneVorFern = bauer.inventar.countOf('Stone');
    const fernPos: Vector3 = { x: bauer.position.x + 50, y: bauer.position.y, z: bauer.position.z };
    sendPlacePiece(bauerWs, menhirHash, fernPos);
    await warte(300);
    const antwortFern = bauerLog.at(-1);
    check(
      'zu weit weg abgelehnt',
      !!antwortFern && !antwortFern.ok && antwortFern.message.includes('weit'),
      JSON.stringify(antwortFern)
    );
    check(
      'kein zweites ZDO, keine weiteren Kosten',
      server.zdos.getZDOByPrefab(menhirHash).length === 1 && bauer.inventar.countOf('Stone') === stoneVorFern
    );

    // ── [4] Abreissen durch Fremde ─────────────────────────────────
    console.log('\n[4] Abreissen durch Fremde — bleibt wirkungslos:');
    const fremderWs = await verbinde('Fremder', PORT);
    const fremderLog: InteractResultMsg[] = [];
    hoereAufInteractResult(fremderWs, fremderLog);
    sendAdmin(fremderWs, `teleport ${(bauer.position.x + 3).toFixed(0)} ${bauer.position.z.toFixed(0)}`);
    await warte(200);
    const fremder = server.net.getPeers().find((p) => p.name === 'Fremder');
    if (!fremder) throw new Error('Fremder nicht gefunden');
    const stoneFremderVorher = fremder.inventar.countOf('Stone');

    sendRemovePiece(fremderWs, gebaut.position);
    await warte(300);
    check('ZDO ueberlebt den fremden Abrissversuch', server.zdos.getZDO(gebautZdoid) !== undefined);
    check('keine Antwort an den Fremden (stiller No-Op)', fremderLog.length === 0, JSON.stringify(fremderLog));
    check(
      'Fremder bekommt keine Materialien gutgeschrieben',
      fremder.inventar.countOf('Stone') === stoneFremderVorher,
      `${stoneFremderVorher} → ${fremder.inventar.countOf('Stone')}`
    );

    // ── [5] Abreissen durch den Eigentuemer ────────────────────────
    console.log('\n[5] Abreissen durch den Eigentuemer — halbe Kosten zurueck:');
    const stoneVorAbriss = bauer.inventar.countOf('Stone');
    const bautenVorAbriss = bauer.bautenAnzahl;
    bauerLog.length = 0;
    sendRemovePiece(bauerWs, gebaut.position);
    await warte(300);
    check('ZDO durch den Eigentuemer entfernt', server.zdos.getZDO(gebautZdoid) === undefined);
    check(
      'halbe Materialkosten (6 Stone) zurueck',
      bauer.inventar.countOf('Stone') === stoneVorAbriss + 6,
      `${stoneVorAbriss} → ${bauer.inventar.countOf('Stone')}`
    );
    check('bautenAnzahl verringert', bauer.bautenAnzahl === bautenVorAbriss - 1, `${bauer.bautenAnzahl}`);
    const abrissMsg = bauerLog.at(-1);
    check(
      'Abriss-Rueckmeldung nennt Stone',
      !!abrissMsg?.ok && abrissMsg.itemName === 'Stone' && abrissMsg.amount === 6,
      JSON.stringify(abrissMsg)
    );

    console.log(
      failures === 0 ? '\n=== G7 Bauen: ALL PASSED ===' : `\n=== G7 Bauen: ${failures} FAILURES ===`
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
