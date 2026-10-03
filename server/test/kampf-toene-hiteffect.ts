/**
 * Kampftöne N1: das Paket `HitEffect` sagt jedem Empfänger, ob ER der
 * Angreifer ist (hinten angehängtes Bool). Echter WovServer, zwei echte
 * WebSocket-Spieler: A schlägt eine Kuh, A bekommt „eigen“, B (in der Nähe)
 * „fremd“. Ein Kreaturenbiss auf B hat keinen Angreifer: für beide „fremd“.
 * Das alte Layout (Vektor + art) bleibt der Anfang der Nutzlast.
 *
 * Run: npx tsx server/test/kampf-toene-hiteffect.ts
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { HEALTH_MEMBER, getStableHash, maxLeben } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { portVon } from '../../scripts/testport.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-kampf-toene-hiteffect');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, Attack: 46, AdminCommand: 53, HitEffect: 59, AuthChallenge: 68 };
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Effekt {
  art: number;
  eigen: boolean;
  laenge: number;
}
interface Spieler {
  ws: WebSocket;
  effekte: Effekt[];
}

function verbinde(port: number, name: string): Promise<Spieler> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    const s: Spieler = { ws, effekte: [] };
    let auth = false;
    const timer = setTimeout(() => fail(new Error(`handshake timeout: ${name}`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        const w = new Writer();
        w.writeInt32(2);
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), w.toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(s);
      } else if (type === P.HitEffect) {
        r.readVector3();
        const art = r.readInt32();
        // Nutzlast: Vektor (12) + art (4) [+ Bool]; das Feld nur lesen, wenn es da ist.
        const laenge = data.length - 1;
        s.effekte.push({ art, eigen: laenge > 16 ? r.readBool() : false, laenge });
      }
    });
    ws.on('error', fail);
  });
}

function sendeInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(1);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}

function sendeAttack(ws: WebSocket, x: number, y: number, z: number, waffe: string): void {
  const w = new Writer();
  w.writeFloat32(x);
  w.writeFloat32(y);
  w.writeFloat32(z);
  w.writeFloat32(0);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'kampf-toene-hiteffect',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
  });
  server.start();
  const port = portVon(server);
  const spieler: Spieler[] = [];
  try {
    const a = await verbinde(port, 'Anna');
    const b = await verbinde(port, 'Bernd');
    spieler.push(a, b);
    const pa = server.net.getPeers().find((p) => p.name === 'Anna');
    const pb = server.net.getPeers().find((p) => p.name === 'Bernd');
    if (!pa || !pb) throw new Error('beide Peers erwartet');
    const setze = async (ws: WebSocket, x: number, z: number) => {
      const w = new Writer();
      w.writeString(`teleport ${x} ${z}`);
      ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
      await warte(350);
    };
    await setze(a.ws, 200, 200);
    await setze(b.ws, 210, 200);
    sendeInput(a.ws, 0);
    sendeInput(b.ws, 0);
    await warte(200);

    // Kuh 1,5 m vor Anna (Blick nach -Z bei Yaw 0).
    const y = server.heightmaps.getGroundHeight(200, 198.5);
    const kuh = server.zdos.createZDO(getStableHash('Kuh'), { x: 200, y, z: 198.5 });
    kuh.setInt(HEALTH_MEMBER, maxLeben('Kuh'));

    console.log('\n[1] Anna schlägt eine Kuh, Bernd steht 10 m daneben:');
    sendeAttack(a.ws, pa.position.x, pa.position.y, pa.position.z, 'SwordNorth');
    await warte(500);
    check('Anna bekommt genau einen HitEffect Fleisch', a.effekte.length === 1 && a.effekte[0]!.art === 1, JSON.stringify(a.effekte));
    check('… mit „eigen“ = wahr', a.effekte[0]?.eigen === true);
    check('Bernd bekommt genau einen HitEffect Fleisch', b.effekte.length === 1 && b.effekte[0]!.art === 1, JSON.stringify(b.effekte));
    check('… mit „eigen“ = falsch', b.effekte[0]?.eigen === false);
    check('Nutzlast = 17 Byte (Vektor 12 + art 4 + Bool 1), altes Layout davor unverändert', a.effekte[0]?.laenge === 17 && b.effekte[0]?.laenge === 17, `${a.effekte[0]?.laenge}/${b.effekte[0]?.laenge}`);

    console.log('\n[2] Kreaturenangriff hat keinen Angreifer:');
    a.effekte.length = 0;
    b.effekte.length = 0;
    pb.blockSeit = 0;
    (server as unknown as { applyCreatureAttack(pos: { x: number; y: number; z: number }, damage: number, radius: number, weltId: string, target?: unknown): void })
      .applyCreatureAttack({ x: pb.position.x, y: pb.position.y, z: pb.position.z }, 8, 2.4, pb.worldId, pb.position);
    await warte(300);
    check('Biss auf Bernd: beide sehen art 1, keiner „eigen“', a.effekte.length === 1 && b.effekte.length === 1 && !a.effekte[0]!.eigen && !b.effekte[0]!.eigen, JSON.stringify([a.effekte, b.effekte]));
  } finally {
    for (const s of spieler) if (s.ws.readyState === WebSocket.OPEN) s.ws.close();
    server.stop();
  }
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
