/**
 * Spielerliste und Chat verraten Konto-Kennung und Position — Befunde B1/B2
 * der Prüfung zu #112 (Berichte/2026-09-27 Besitzer-Kennung — Prüfung.md).
 *
 * Echte WebSocket-Clients (Handshake, dann Rohbytes der Antwortpakete mit
 * einem STRENGEN Leser gelesen: `Reader.remaining()` muss nach dem Lesen
 * aller erwarteten Felder exakt 0 sein — ein Feld, das der Fix vergisst zu
 * streichen, faellt so auf, auch wenn kein einzelner check() danach sucht).
 *
 *  [B1] PlayerList (alle 2 s, an ALLE Peers, weltweit): traegt nur noch
 *       Name + Ping. Kein userId-, kein Positionsfeld mehr auf dem Draht,
 *       auch nicht fuer einen 5 km entfernten Fremden in einer anderen Welt.
 *  [B2] Chat: das erste Feld (frueher `senderId` = userId) ist fuer JEDEN
 *       Empfaenger derselbe wertlose Platzhalter, nie die echte userId des
 *       Senders. Name, Typ, Text und Position (vom Client ohnehin nicht
 *       ausgewertet, aber nicht Teil dieser Karte) bleiben unveraendert.
 *
 * Run: npx tsx server/test/spielerliste-privat.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { ChatMsgType, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-spielerliste-privat');
const WORLDS_DIR = resolve(TMP, 'welten');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ChatMessage: 42,
  AuthChallenge: 68,
  PlayerList: 50,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};
/** Kurze Nachfrist, in der ein UNERWUENSCHTES Paket noch ankaeme (Absenz laesst sich nur so zeigen). */
const NACHFRIST_MS = 200;

interface Klient {
  ws: WebSocket;
  playerListRaw: Buffer[];
  chatRaw: Buffer[];
}

function verbinde(port: number, name: string): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, playerListRaw: [], chatRaw: [] };
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const body = Buffer.from(data.subarray(1));
      const r = new Reader(body);
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(k);
      } else if (type === P.PlayerList) {
        k.playerListRaw.push(body);
      } else if (type === P.ChatMessage) {
        k.chatRaw.push(body);
      }
    });
    ws.on('error', reject);
  });
}

function sendChat(ws: WebSocket, typ: number, text: string): void {
  const w = new Writer();
  w.writeInt32(typ);
  w.writeString(text);
  ws.send(Buffer.concat([Buffer.from([P.ChatMessage]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'spielerliste-privat',
    saveIntervalMs: 3600_000,
    everyoneAdmin: false,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
  });
  server.start();
  const PORT = portVon(server);

  try {
    const kA = await verbinde(PORT, 'Anna');
    const kB = await verbinde(PORT, 'Bjoern');
    const peer = (name: string) => {
      const p = server.net.getPeers().find((x) => x.name === name);
      if (!p) throw new Error(`Peer ${name} nicht gefunden`);
      return p;
    };
    const pA = peer('Anna');
    const pB = peer('Bjoern');
    const idA = pA.userId.toString();
    const idB = pB.userId.toString();

    // A steht 5 km entfernt von B, wie im Befund B1 ("B sieht A in 5 km
    // Entfernung mit userId und Position"). Die Welt filtert PlayerList
    // NICHT nach Reichweite oder Welt — genau das macht den Fund aus.
    const zugriff = server as unknown as { teleportPeer(peer: unknown, pos: Vector3, dungeonId: string | null): void };
    zugriff.teleportPeer(pA, { x: 5000, y: 40, z: 5000 }, null);
    await bis(() => Math.abs(pA.position.x - 5000) < 1, 3_000);
    await warte(300);

    // ── [B1] PlayerList ────────────────────────────────────────────
    console.log('\n[B1] PlayerList — keine Kennung, keine Position auf dem Draht:');
    kB.playerListRaw = [];
    // Ein voller Umlauf des 2s-Akkumulators, plus Nachfrist.
    await bis(() => kB.playerListRaw.length > 0, 5_000);
    await warte(NACHFRIST_MS);
    check('B hat mindestens ein PlayerList-Paket bekommen', kB.playerListRaw.length > 0, `${kB.playerListRaw.length}`);
    const paket = kB.playerListRaw[kB.playerListRaw.length - 1]!;

    // Roh-Suche: die userId-Strings von A und B (Ziffernfolgen) duerfen in
    // den Rohbytes gar nicht mehr vorkommen — unabhaengig vom Feldlayout.
    const alsText = paket.toString('latin1');
    check('userId von A steht nirgends im Rohpaket', !alsText.includes(idA), idA);
    check('userId von B steht nirgends im Rohpaket', !alsText.includes(idB), idB);

    // Strenger Leser: exakt Name + Ping je Spieler, danach KEIN Byte mehr
    // uebrig. Ein vergessenes/verschobenes Feld (etwa Position) faellt
    // hier auf, auch ohne dass ein Test explizit danach sucht.
    const r = new Reader(paket);
    const anzahl = r.readInt32();
    const namen: string[] = [];
    for (let i = 0; i < anzahl; i++) {
      namen.push(r.readString());
      r.readInt32(); // ping
    }
    check('Paket ist nach Name+Ping je Spieler exakt zu Ende (kein zusaetzliches Feld)', r.remaining() === 0, `${r.remaining()} Byte(s) uebrig`);
    check('beide Namen kommen an (das reicht fuer eine spaetere Spielerliste im UI)',
      namen.includes('Anna') && namen.includes('Bjoern'), JSON.stringify(namen));
    console.log(`      Spieler im Paket: ${JSON.stringify(namen)}, Rohpaket ${paket.length} Byte(s)`);

    // ── [B2] Chat ──────────────────────────────────────────────────
    console.log('\n[B2] Chat — senderId verraet die Kennung nicht mehr:');
    // A und B nebeneinander stellen, damit die Chat-Reichweite keine Rolle spielt.
    zugriff.teleportPeer(pA, { x: 0, y: 40, z: 0 }, null);
    zugriff.teleportPeer(pB, { x: 2, y: 40, z: 0 }, null);
    await bis(() => Math.abs(pA.position.x) < 1 && Math.abs(pB.position.x - 2) < 1, 3_000);
    await warte(350);

    kB.chatRaw = [];
    kA.chatRaw = [];
    sendChat(kA.ws, ChatMsgType.Normal, 'hallo an B');
    await bis(() => kB.chatRaw.length > 0, 3_000);
    await warte(NACHFRIST_MS);
    check('B hat die Chatnachricht bekommen', kB.chatRaw.length === 1, `${kB.chatRaw.length}`);
    const chatPaket = kB.chatRaw[0]!;
    const chatText = chatPaket.toString('latin1');
    check('userId von A steht nirgends im Chatpaket', !chatText.includes(idA), idA);

    const rc = new Reader(chatPaket);
    const senderId = rc.readString();
    const senderName = rc.readString();
    const chatType = rc.readInt32();
    const text = rc.readString();
    rc.readVector3(); // Position des Absenders — unveraendert, nicht Teil dieser Karte
    check('senderId ist der Platzhalter, nicht die echte userId', senderId === '0', JSON.stringify(senderId));
    check('senderId ist bei A und B (verschiedene userId) derselbe wertlose Wert', senderId !== idA && senderId !== idB, senderId);
    check('senderName kommt weiter unveraendert an (das braucht die Anzeige)', senderName === 'Anna', senderName);
    check('chatType und Text kommen weiter an', chatType === ChatMsgType.Normal && text === 'hallo an B', `${chatType} "${text}"`);
    check('Chatpaket ist nach den fuenf bekannten Feldern exakt zu Ende', rc.remaining() === 0, `${rc.remaining()} Byte(s) uebrig`);
    console.log(`      Chatpaket an B: senderId=${JSON.stringify(senderId)}, senderName=${JSON.stringify(senderName)}, Rohpaket ${chatPaket.length} Byte(s)`);

    // Gegenprobe: A liest die eigene Nachricht (Echo an den Absender)
    // ebenfalls mit dem Platzhalter, nicht mit der eigenen userId.
    check('A sieht bei der eigenen Nachricht ebenfalls den Platzhalter', kA.chatRaw.length === 1, `${kA.chatRaw.length}`);
    if (kA.chatRaw.length === 1) {
      const raEcho = new Reader(kA.chatRaw[0]!);
      const senderIdEcho = raEcho.readString();
      check('Echo an A: senderId ist der Platzhalter', senderIdEcho === '0', JSON.stringify(senderIdEcho));
    }

    kA.ws.close();
    kB.ws.close();
  } finally {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n=== Spielerliste privat: ALLES BESTANDEN ===' : `\n=== Spielerliste privat: ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
