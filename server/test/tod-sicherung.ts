/**
 * Death is saved at once: after the revival the player's state is on disk (card "Folgen Tod und Beute", job 1).
 *
 * One REAL WebSocket player in one server. The 30 s tick of the player save is set to one hour, the world save too, so
 * nothing but the event save of the revival can write the row. Measured, not read from a callback:
 *  [1] Before the death: no event save with the reason `tod`, and no row of this player in the account database.
 *  [2] A lethal blow (real packet path: PlayerTod arrives): while she lies there is still no `tod` save.
 *  [3] After the lying time (the server revives her alone): exactly ONE `sichere(..., 'tod')` call, the database
 *      row of Anna exists NOW (read back through `SpielerSicherung.laden()`), holds the revived position (the start
 *      point, not the place of death) and the counter of written runs went up by one. All within a few seconds, far
 *      from the 3600 s tick.
 *  [4] With `liegezeitMs = 0` (get up at once, `belebeNeu(peer, true)`) the second death is saved too: a second call.
 *
 * Run: npx tsx server/test/tod-sicherung.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { PacketType, TOD_LIEGEZEIT_MS, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-tod-sicherung');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Socke extends WebSocket { tod: number; }

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.tod = 0;
    let auth = false;
    const timer = setTimeout(() => fail(new Error(`handshake timeout: ${name}`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === PacketType.PlayerTod) {
        ws.tod++;
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}

const sendAdmin = (ws: WebSocket, line: string): void => {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'tod-sicherung',
    saveIntervalMs: 3600_000, spielerSicherungMs: 3600_000, everyoneAdmin: true,
    worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
    spielerSicherung: {
      sichere(...args: unknown[]): number;
      laden(): Array<{ name: string; position: Vector3 }>;
      stats(): { laeufe: number };
    };
  };
  // Record every event save with its reason; the real method still runs.
  const gruende: string[] = [];
  const echt = zugriff.spielerSicherung.sichere.bind(zugriff.spielerSicherung);
  zugriff.spielerSicherung.sichere = (...args: unknown[]): number => {
    gruende.push(String(args[1]));
    return echt(...args);
  };
  const anzahl = (g: string): number => gruende.filter((x) => x === g).length;
  const zeile = () => zugriff.spielerSicherung.laden().find((s) => s.name === 'Anna');
  const sockets: WebSocket[] = [];
  try {
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna = server.net.getPeers().find((x) => x.name === 'Anna') as Peer;
    sendAdmin(ws, 'teleport 200 200');
    await warte(400);
    const tod = { x: anna.position.x, z: anna.position.z };
    check('Anna stands at the place of death (200, 200)', Math.hypot(tod.x - 200, tod.z - 200) < 1, `${tod.x}, ${tod.z}`);

    console.log('\n[1] Before the death');
    check('no event save with the reason "tod" yet', anzahl('tod') === 0, gruende.join(','));
    check('no row of Anna in the account database', zeile() === undefined);

    console.log('\n[2] The lethal blow: she lies dead');
    anna.health = 5; anna.paradeBis = 0;
    server.liegezeitMs = 1500;
    zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
    await warte(300);
    check('PlayerTod arrived, Anna is dead', ws.tod === 1 && anna.totBis > 0 && anna.health === 0, `tod ${ws.tod}, totBis ${anna.totBis}`);
    check('while she lies there is no "tod" save yet (it belongs to the revival)', anzahl('tod') === 0 && zeile() === undefined, gruende.join(','));

    console.log('\n[3] The server revives her: the state is saved at once');
    const laeufe0 = zugriff.spielerSicherung.stats().laeufe;
    const t0 = Date.now();
    while (anna.totBis > 0 && Date.now() - t0 < 6000) await warte(25);
    check('revived', anna.totBis === 0 && anna.health > 0, `${anna.health}`);
    check('exactly one event save with the reason "tod"', anzahl('tod') === 1, gruende.join(','));
    const z = zeile();
    check('the row of Anna is in the account database now (tick and world save are one hour away)', z !== undefined);
    check('the row holds the revived position: the start point, not the place of death',
      z !== undefined && Math.hypot(z.position.x - anna.position.x, z.position.z - anna.position.z) < 0.01 && Math.hypot(z.position.x - tod.x, z.position.z - tod.z) > 5,
      z ? `row ${z.position.x.toFixed(1)},${z.position.z.toFixed(1)}; peer ${anna.position.x.toFixed(1)},${anna.position.z.toFixed(1)}; death ${tod.x.toFixed(1)},${tod.z.toFixed(1)}` : 'no row');
    check('one more written run in the save counter', zugriff.spielerSicherung.stats().laeufe === laeufe0 + 1, `${laeufe0} -> ${zugriff.spielerSicherung.stats().laeufe}`);
    check('all of this within seconds, not an hour', Date.now() - t0 < 6000, `${Date.now() - t0} ms`);

    console.log('\n[4] Lying time 0: the immediate revival is saved too');
    sendAdmin(ws, 'teleport 260 200');
    await warte(400);
    server.liegezeitMs = 0;
    anna.health = 5; anna.paradeBis = 0;
    zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
    await warte(300);
    check('alive again at once and a second "tod" save', anna.totBis === 0 && anna.health > 0 && anzahl('tod') === 2, `${anzahl('tod')} saves, ${gruende.join(',')}`);
    server.liegezeitMs = TOD_LIEGEZEIT_MS;
  } finally {
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.close();
    server.stop();
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
