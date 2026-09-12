/**
 * G7 — Handshake-Fehlerpfade, ueber den ECHTEN NetManager.
 *
 * f3-einbau.ts und g6-dungeon-e2e.ts pruefen bereits den ERFOLGSPFAD
 * (Identitaet, SessionToken, Dungeon-E2E). Dieser Test deckt die
 * FEHLERPFADE ab, die bisher ungetestet waren:
 *
 *  1. Falsches Passwort → Disconnect ("Wrong password"), Socket schliesst.
 *  2. Veraltete Client-Version → Disconnect ("veraltet"), Socket schliesst.
 *  3. Abgeschnittenes Paket (Laenge angekuendigt, Bytes fehlen) → Reader
 *     wirft, NetManager faengt es (try/catch um handlePacket) und trennt
 *     NUR diese eine Verbindung — der Server-PROZESS bleibt am Leben und
 *     nimmt danach ganz normal neue, wohlgeformte Verbindungen an.
 *  4. Paket vor der Anmeldung (PlayerInput, bevor PasswordAuth akzeptiert
 *     wurde) → wird still verworfen, OHNE die Verbindung zu trennen; der
 *     Handshake laesst sich danach normal zu Ende fuehren.
 *
 * Run: npx tsx server/test/g7-handshake-fehler.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-handshake-fehler');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT_KEIN_PW = 2515; // eigener Server ohne Passwort (Tests 2-4)
const PORT_MIT_PW = 2516; // eigener Server MIT Passwort (Test 1)

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  Disconnect: 4,
  PlayerInput: 40,
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

interface ErgebnisFalschesPw {
  disconnectReason: string | null;
  closeCode: number;
  closed: boolean;
}

/** Test 1: falsches Passwort — kompletter Handshake bis PasswordAuth mit der FALSCHEN Antwort. */
function verbindeMitFalschemPasswort(port: number): Promise<ErgebnisFalschesPw> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let disconnectReason: string | null = null;
    const timeout = setTimeout(() => reject(new Error('Timeout (falsches Passwort)')), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        const nonce = reader.readString();
        // korrekt BERECHNET, aber gegen das FALSCHE Passwort — echte
        // Produktivfunktion, nicht nachgebaut (F4-Lehre).
        const antwort = antwortBerechnen(nonce, 'falsches-passwort');
        const w = new Writer();
        w.writeString(antwort);
        w.writeString('Eindringling');
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.Disconnect) {
        disconnectReason = reader.readString();
      }
    });
    ws.on('close', (code: number) => {
      clearTimeout(timeout);
      resolvePromise({ disconnectReason, closeCode: code, closed: true });
    });
    ws.on('error', reject);
  });
}

interface ErgebnisVersion {
  disconnectReason: string | null;
  closed: boolean;
}

/** Test 2: veraltete Client-Version im VersionCheck-Antwortpaket. */
function verbindeMitAlterVersion(port: number): Promise<ErgebnisVersion> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let disconnectReason: string | null = null;
    const timeout = setTimeout(() => reject(new Error('Timeout (alte Version)')), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(1).toBuffer()])); // v1 statt v2
      } else if (type === P.Disconnect) {
        const reader = new Reader(Buffer.from(data.subarray(1)));
        disconnectReason = reader.readString();
      }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      resolvePromise({ disconnectReason, closed: true });
    });
    ws.on('error', reject);
  });
}

/** Vollstaendiger, korrekter Handshake — fuer Test 3 (Server ueberlebt) und Test 4 (Recovery). */
function verbinde(port: number, name: string, vorAuthPaket?: (ws: WebSocket) => void): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let versionGesendet = false;
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        if (versionGesendet) return;
        versionGesendet = true;
        // Genau HIER, VOR der Antwort auf VersionCheck: der fruehstmoegliche
        // Zeitpunkt fuer ein Paket "vor der Anmeldung".
        vorAuthPaket?.(ws);
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
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

function warteAufSchliessenOderGnadenfrist(ws: WebSocket, ms: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    if (ws.readyState === WebSocket.CLOSED) return resolvePromise(true);
    const timer = setTimeout(() => resolvePromise(false), ms);
    ws.on('close', () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

async function main(): Promise<void> {
  const serverOhnePw = createWovServer({
    port: PORT_KEIN_PW,
    worldsDir: resolve(WORLDS_DIR, 'ohne-pw'),
    kontenDir: resolve(WORLDS_DIR, 'ohne-pw', 'konten'),
    worldName: 'g7-handshake-ohne-pw',
    saveIntervalMs: 3600_000,
  });
  const serverMitPw = createWovServer({
    port: PORT_MIT_PW,
    worldsDir: resolve(WORLDS_DIR, 'mit-pw'),
    kontenDir: resolve(WORLDS_DIR, 'mit-pw', 'konten'),
    worldName: 'g7-handshake-mit-pw',
    password: 'geheim',
    saveIntervalMs: 3600_000,
  });
  serverOhnePw.start();
  serverMitPw.start();

  try {
    // ── [1] Falsches Passwort ────────────────────────────────────
    console.log('\n[1] Falsches Passwort:');
    const r1 = await verbindeMitFalschemPasswort(PORT_MIT_PW);
    check('Verbindung wird getrennt', r1.closed);
    check(
      'Disconnect-Grund nennt das Passwort',
      !!r1.disconnectReason && /password/i.test(r1.disconnectReason),
      `"${r1.disconnectReason}"`
    );
    check('kein Peer online geblieben', serverMitPw.net.peerCount === 0, `${serverMitPw.net.peerCount}`);

    // ── [2] Veraltete Client-Version ──────────────────────────────
    console.log('\n[2] Veraltete Client-Version (v1 statt v2):');
    const r2 = await verbindeMitAlterVersion(PORT_KEIN_PW);
    check('Verbindung wird getrennt', r2.closed);
    check(
      'Disconnect-Grund nennt die veraltete Version',
      !!r2.disconnectReason && /veraltet/i.test(r2.disconnectReason),
      `"${r2.disconnectReason}"`
    );

    // ── [3] Abgeschnittenes Paket ──────────────────────────────────
    console.log('\n[3] Abgeschnittenes Paket — Server-Prozess ueberlebt:');
    const wsKaputt = new WebSocket(`ws://127.0.0.1:${PORT_KEIN_PW}`);
    wsKaputt.binaryType = 'nodebuffer';
    await new Promise<void>((res, rej) => {
      wsKaputt.on('open', () => res());
      wsKaputt.on('error', rej);
    });
    // PasswordAuth-Typ + eine Laenge, die 1.000.000 String-Bytes ankuendigt,
    // OHNE dass ein einziges davon folgt — Reader.readString() wirft beim
    // checkOffset(1_000_000), NetManager faengt es (try/catch, s. Kopf-
    // kommentar von NetManager.ts) und trennt NUR diese Verbindung.
    const kaputtesPaket = Buffer.concat([
      Buffer.from([P.PasswordAuth]),
      new Writer().writeVarInt(1_000_000).toBuffer(),
    ]);
    wsKaputt.send(kaputtesPaket);
    const getrennt = await warteAufSchliessenOderGnadenfrist(wsKaputt, 3000);
    check('kaputte Verbindung wird getrennt statt den Prozess zu crashen', getrennt);

    // Beweis, dass der Server-PROZESS ueberlebt hat: eine neue, wohlgeformte
    // Verbindung meldet sich danach ganz normal an.
    const wsHeil = await verbinde(PORT_KEIN_PW, 'Ueberlebender');
    check('Server nimmt danach normal neue Verbindungen an', wsHeil.readyState === WebSocket.OPEN);
    wsHeil.close();
    await warte(200);

    // ── [4] Paket vor der Anmeldung ─────────────────────────────────
    console.log('\n[4] Paket vor der Anmeldung — verworfen, Verbindung bleibt offen:');
    let vorAuthGesendet = false;
    const wsVorAuth = await verbinde(PORT_KEIN_PW, 'Vorwitzig', (ws) => {
      // PlayerInput, BEVOR ueberhaupt auf VersionCheck geantwortet wurde —
      // der fruehstmoegliche "Paket vor der Anmeldung"-Zeitpunkt.
      const w = new Writer();
      w.writeInt32(1).writeFloat32(0).writeFloat32(0).writeFloat32(0).writeFloat32(0).writeFloat32(0);
      w.writeBool(false).writeBool(false);
      ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
      vorAuthGesendet = true;
    });
    check('Vor-Auth-Paket wurde tatsaechlich geschickt', vorAuthGesendet);
    check(
      'Handshake laeuft trotzdem bis zum Ende durch (PeerInfo empfangen)',
      wsVorAuth.readyState === WebSocket.OPEN
    );
    check(
      'Peer ist normal online (nicht getrennt)',
      serverOhnePw.net.getPeers().some((p) => p.name === 'Vorwitzig')
    );
    wsVorAuth.close();

    console.log(
      failures === 0 ? '\n=== G7 Handshake-Fehlerpfade: ALL PASSED ===' : `\n=== G7 Handshake-Fehlerpfade: ${failures} FAILURES ===`
    );
  } finally {
    serverOhnePw.stop();
    serverMitPw.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
