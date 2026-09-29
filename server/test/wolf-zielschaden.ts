/**
 * Wolf targeted damage (N2): a creature bite damages only the player selected
 * by the wolf AI, not every nearby player inside the old splash radius.
 *
 * The main scenario uses a real WovServer, two real WebSocket players, four
 * real wolves adopted by SpawnSystem, real ticks and PlayerInput rotation
 * packets. Anna and Bernd stand close enough that the old radius damage would
 * hit both players from every wolf. The expected damage is therefore measured
 * as real health loss, not as a callback-only assertion.
 *
 * Run: npx tsx server/test/wolf-zielschaden.ts
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { HEALTH_MEMBER, getStableHash, maxLeben, type Vector3 } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { portVon } from '../../scripts/testport.mjs';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-wolf-zielschaden');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, AdminCommand: 53, AuthChallenge: 68 };
const WOLF_HASH = getStableHash('Wolf');
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let failures = 0;
let seq = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function verbinde(port: number, name: string): Promise<WebSocket> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
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
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

function sendInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(++seq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}

async function rotateBoth(a: WebSocket, b: WebSocket, durationMs: number): Promise<void> {
  const end = Date.now() + durationMs;
  let step = 0;
  while (Date.now() < end) {
    sendInput(a, step % 2 === 0 ? 0 : Math.PI);
    sendInput(b, step % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
    step++;
    await warte(50);
  }
}

async function teleport(ws: WebSocket, peer: { position: Vector3 }, x: number, z: number): Promise<void> {
  sendAdmin(ws, `teleport ${x} ${z}`);
  await warte(350);
  const d = Math.hypot(peer.position.x - x, peer.position.z - z);
  if (d > 1) throw new Error(`teleport to ${x},${z} failed; at ${peer.position.x},${peer.position.z}`);
}

function closeAndWait(ws: WebSocket): Promise<void> {
  return new Promise((resolveClose) => {
    if (ws.readyState === WebSocket.CLOSED) return resolveClose();
    ws.once('close', () => resolveClose());
    ws.close();
  });
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'wolf-zielschaden',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: true,
    worldFeatures: false,
    worldVegetation: false,
  });
  server.start();
  const port = portVon(server);
  const sockets: WebSocket[] = [];
  try {
    const wsAnna = await verbinde(port, 'Anna');
    const wsBernd = await verbinde(port, 'Bernd');
    sockets.push(wsAnna, wsBernd);
    const anna = server.net.getPeers().find((p) => p.name === 'Anna');
    const bernd = server.net.getPeers().find((p) => p.name === 'Bernd');
    if (!anna || !bernd) throw new Error('expected both peers after handshake');

    await teleport(wsAnna, anna, 100, 100);
    await teleport(wsBernd, bernd, 100.9, 100);
    anna.health = 100;
    bernd.health = 100;
    anna.paradeBis = 0;
    bernd.paradeBis = 0;

    const spawns = server.hauptwelt.spawns;
    if (!spawns) throw new Error('worldCreatures=true but no SpawnSystem');
    const realAttack = spawns.onCreatureAttack;
    const targets: string[] = [];
    spawns.onCreatureAttack = (pos, damage, radius, target) => {
      targets.push(target === anna.position ? 'Anna' : target === bernd.position ? 'Bernd' : 'unknown');
      realAttack?.(pos, damage, radius, target);
    };

    function setWolf(x: number, z: number): ZDO {
      const y = server.heightmaps.getGroundHeight(x, z);
      const zdo = server.zdos.createZDO(WOLF_HASH, { x, y, z });
      zdo.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
      return zdo;
    }

    console.log('\n[1] Two nearby players, four wolves, rotating clients: damage follows the selected target only');
    const wolves = [
      setWolf(99.6, 99.8),
      setWolf(99.6, 100.2),
      setWolf(101.3, 99.8),
      setWolf(101.3, 100.2),
    ];
    spawns.adoptPersisted();
    await rotateBoth(wsAnna, wsBernd, 2350);

    const annaDamage = 100 - anna.health;
    const berndDamage = 100 - bernd.health;
    const targetAnna = targets.filter((t) => t === 'Anna').length;
    const targetBernd = targets.filter((t) => t === 'Bernd').length;
    console.log(`      health after first strike wave: Anna ${anna.health}, Bernd ${bernd.health}; targets Anna=${targetAnna}, Bernd=${targetBernd}`);
    check('AI picked two wolves for Anna and two wolves for Bernd', targetAnna === 2 && targetBernd === 2, targets.join(','));
    check('Anna took exactly her two selected wolf bites, not all four nearby wolves', annaDamage === 16, `${annaDamage} damage`);
    check('Bernd took exactly his two selected wolf bites, not all four nearby wolves', berndDamage === 16, `${berndDamage} damage`);

    console.log("\n[2] Death/reset does not splash the selected victim's bite into the nearby player");
    for (const w of wolves.slice(2)) server.zdos.destroyZDO(w.zdoid);
    targets.length = 0;
    anna.health = 8;
    bernd.health = 100;
    await rotateBoth(wsAnna, wsBernd, 2150);
    const deathTargets = targets.filter((t) => t === 'Anna').length;
    check('Anna was bitten after being set to lethal health and reset by the death path', deathTargets >= 1 && anna.health === 100, `targets=${targets.join(',')} AnnaHP=${anna.health}`);
    check('Bernd stayed untouched by Anna-targeted lethal bites while standing inside the old 2.4 m radius', bernd.health === 100, `BerndHP=${bernd.health}`);

    console.log('\n[3] Disconnected target object is not retargeted by radius fallback');
    const staleBerndPosition = bernd.position;
    await closeAndWait(wsBernd);
    await warte(250);
    check('Bernd disappeared from getPeers() after disconnect', !server.net.getPeers().some((p) => p.name === 'Bernd'));
    anna.health = 100;
    (server as unknown as { applyCreatureAttack(pos: Vector3, damage: number, radius: number, weltId: string, target?: Vector3): void })
      .applyCreatureAttack({ x: anna.position.x + 0.4, y: anna.position.y, z: anna.position.z }, 8, 2.4, anna.worldId, staleBerndPosition);
    check('a bite addressed to a disconnected peer does not fall back to the nearby remaining player', anna.health === 100, `AnnaHP=${anna.health}`);

    for (const w of wolves) if (!w.destroyed) server.zdos.destroyZDO(w.zdoid);
    wsAnna.close();
  } finally {
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.close();
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
