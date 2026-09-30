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
 *  [5] Lost bed (the point leads to no bed, it is discarded and reported): the save of the revival holds no
 *      bed point any more; it is taken at the very call (the row could look the same by chance).
 *  [6] Death inside a dungeon: the save of the revival holds the revived position outside the dungeon and Anna
 *      is out of the dungeon when it is called.
 *  [7] A throw inside the revival (the save is made to throw) does not stop the tick: a second dead player is
 *      still revived and the server goes on ticking.
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
// `dungeon create` (phase [6]) writes its document next to the worlds folder, under the world name.
const DUNGEONS_DIR = resolve(WORLDS_DIR, '..', 'dungeons', 'tod-sicherung');
rmSync(WORLDS_DIR, { recursive: true, force: true });
rmSync(DUNGEONS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, AdminEvent: 54, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Socke extends WebSocket { tod: number; admin: string[]; }

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.tod = 0;
    ws.admin = [];
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
      } else if (type === P.AdminEvent) {
        r.readString(); r.readBool();
        ws.admin.push(r.readString());
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
  /** What the state held at each 'tod' call (position, bed point) and whether Anna was still in a dungeon. */
  const bei: Array<{ position: Vector3; spawnPoint: Vector3 | null; dungeon: string }> = [];
  const annaPeer = (): Peer | undefined => server.net.getPeers().find((x) => x.name === 'Anna') as Peer | undefined;
  const echt = zugriff.spielerSicherung.sichere.bind(zugriff.spielerSicherung);
  zugriff.spielerSicherung.sichere = (...args: unknown[]): number => {
    gruende.push(String(args[1]));
    if (args[1] === 'tod') {
      const st = (args[0] as Array<{ position: Vector3; spawnPoint?: Vector3 }>)[0];
      bei.push({ position: { ...st!.position }, spawnPoint: st!.spawnPoint ? { ...st!.spawnPoint } : null, dungeon: String(annaPeer()?.dungeonId ?? '') });
    }
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

    console.log('\n[5] Lost bed: the revival save holds no bed point');
    sendAdmin(ws, 'teleport 230 200');
    await warte(400);
    anna.spawnPoint = { x: 10, y: 0, z: 10 }; // no bed there
    const n5 = anzahl('tod');
    anna.health = 5; anna.paradeBis = 0;
    zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
    await warte(300);
    const b5 = bei[bei.length - 1];
    check('revived at once and one more "tod" save', anna.totBis === 0 && anna.health > 0 && anzahl('tod') === n5 + 1, `${anzahl('tod')} saves`);
    check('the bed point is gone from Anna and from the state that was saved', anna.spawnPoint === null && b5 !== undefined && b5.spawnPoint === null, JSON.stringify(b5));
    check('the saved position is the revived one, not the place of death (230, 200)',
      b5 !== undefined && Math.hypot(b5.position.x - anna.position.x, b5.position.z - anna.position.z) < 0.01 && Math.hypot(b5.position.x - 230, b5.position.z - 200) > 5,
      JSON.stringify(b5?.position));

    console.log('\n[6] Death inside a dungeon: saved outside of it');
    sendAdmin(ws, 'dungeon create forestcrypt 4242');
    const t6 = Date.now();
    while (!ws.admin.some((m) => /Dungeon erzeugt: \S+/.test(m)) && Date.now() - t6 < 8000) await warte(25);
    const id = ws.admin.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((m) => m);
    check('a dungeon was created', !!id, ws.admin.join(' | '));
    sendAdmin(ws, `dungeon enter ${id}`);
    const t6b = Date.now();
    while (!anna.dungeonId && Date.now() - t6b < 8000) await warte(25);
    await warte(300);
    const innen = { ...anna.position };
    check('Anna is inside the dungeon (her dungeon id is set)', !!anna.dungeonId && anna.worldId !== server.hauptwelt.id, `${anna.dungeonId}, world ${anna.worldId}, y ${innen.y.toFixed(1)}`);
    const n6 = anzahl('tod');
    anna.health = 5; anna.paradeBis = 0;
    zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
    await warte(500);
    const b6 = bei[bei.length - 1];
    check('revived and one more "tod" save', anna.totBis === 0 && anna.health > 0 && anzahl('tod') === n6 + 1, `${anzahl('tod')} saves`);
    check('Anna was out of the dungeon when the save was called', !anna.dungeonId && b6 !== undefined && b6.dungeon === '', JSON.stringify(b6));
    check('the saved position is the revived one on the surface (not the spot inside the dungeon), and Anna is in the main world again',
      b6 !== undefined && Math.hypot(b6.position.x - anna.position.x, b6.position.z - anna.position.z) < 0.01 && Math.abs(b6.position.y - innen.y) > 1 && anna.worldId === server.hauptwelt.id,
      `${JSON.stringify(b6?.position)} (inside was y ${innen.y.toFixed(1)}), world ${anna.worldId}`);

    console.log('\n[7] A throw inside the revival does not stop the tick');
    const zweite = await verbinde('Bernd');
    sockets.push(zweite);
    const bernd = server.net.getPeers().find((x) => x.name === 'Bernd') as Peer;
    const echtSofort = (server as unknown as { sichereSpielerSofort(p: Peer, g: string): void }).sichereSpielerSofort;
    let geworfen = 0;
    (server as unknown as { sichereSpielerSofort(p: Peer, g: string): void }).sichereSpielerSofort = function (this: unknown, p: Peer, g: string): void {
      if (g === 'tod' && geworfen === 0) { geworfen++; throw new Error('probe: save throws'); }
      echtSofort.call(this, p, g);
    };
    server.liegezeitMs = 800;
    for (const [p, w] of [[anna, ws], [bernd, zweite]] as const) {
      p.health = 5; p.paradeBis = 0;
      zugriff.applyCreatureAttack({ x: p.position.x + 1, y: p.position.y, z: p.position.z - 2 }, 8, 2.4, p.worldId, p.position);
      void w;
    }
    await warte(300);
    check('both lie dead', anna.totBis > 0 && bernd.totBis > 0, `${anna.totBis} / ${bernd.totBis}`);
    const t7 = Date.now();
    while ((anna.totBis > 0 || bernd.totBis > 0) && Date.now() - t7 < 6000) await warte(25);
    check('the save threw once, and both players are up again (the throw did not cut the tick short)', geworfen === 1 && anna.totBis === 0 && bernd.totBis === 0 && anna.health > 0 && bernd.health > 0, `threw ${geworfen}, ${anna.totBis}/${bernd.totBis}`);
    const uhr0 = Date.now();
    await warte(400);
    check('the server still ticks and answers', Date.now() - uhr0 >= 390 && server.net.getPeers().length === 2);
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
    rmSync(DUNGEONS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
