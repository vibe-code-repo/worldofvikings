/**
 * Death and hit reaction of a player, over the REAL packet path (card "Tod und Treffer sichtbar").
 *
 * Two real WebSocket players in one server: Anna (the victim) and Bernd (a bystander who only watches).
 * Measured over the wire, not read from a callback:
 *  [1] A blow from the front that does not kill sends Anna `PlayerTreffer` with the right clip index
 *      (8 directions of the rule are in shared/test/tod-treffer.ts; here the real view yaw from the packets
 *      decides), and Bernd's ZDO sync carries `animEinmal` = `treffer_vorn_links#1`; a second blow from behind
 *      right counts up (`#2`, `treffer_hinten_rechts`).
 *  [2] A lethal blow from the front: Anna gets `PlayerTod` (tod_hinten, 5000 ms) and is dead for 5 s: health 0,
 *      a further blow does nothing (no HitEffect, no damage), her `Attack` hurts nobody (the creature keeps its
 *      health; alive she does hurt it), her `PlayerInput` does not move her. Bernd's ZDO sync carries
 *      `tod_hinten#3` and the lying pose (`anim`).
 *  [3] After the lying time (measured 5.0 s +-) the server revives her by itself although her client never answers
 *      (an old client): full health, a Teleport packet, back at the start point, `anim` idle for everybody.
 *  [4] A lethal blow from behind: tod_vorn; and with `liegezeitMs = 0` the old behaviour (get up at once) stays.
 *  [5] Creatures let go: a real NPC (Furloc, through the AggroSystem tick) standing next to her strikes her while
 *      she lives (control) and not once while she lies dead.
 *
 * Run: npx tsx server/test/tod-treffer.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  HEALTH_MEMBER, PacketType, TOD_LIEGEZEIT_MS, TOD_CLIPS, TREFFER_CLIPS, getStableHash, maxLeben, type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-tod-treffer');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, Attack: 46, AdminCommand: 53, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A player's socket with a log of everything the server sent that this test cares about. */
interface Socke extends WebSocket {
  tod: Array<{ clip: number; ms: number; zeit: number }>;
  treffer: number[];
  teleports: number[];
  hitEffects: number;
  zdoSync: Buffer[];
  prozent: number;
}

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.tod = []; ws.treffer = []; ws.teleports = []; ws.hitEffects = 0; ws.zdoSync = []; ws.prozent = NaN;
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
      } else if (type === PacketType.PlayerState) {
        ws.prozent = r.readFloat32();
      } else if (type === PacketType.PlayerTod) {
        ws.tod.push({ clip: r.readInt32(), ms: r.readInt32(), zeit: Date.now() });
      } else if (type === PacketType.PlayerTreffer) {
        ws.treffer.push(r.readInt32());
      } else if (type === PacketType.Teleport) {
        ws.teleports.push(Date.now());
      } else if (type === PacketType.HitEffect) {
        ws.hitEffects++;
      } else if (type === PacketType.ZDOSync) {
        ws.zdoSync.push(Buffer.from(data));
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
let seq = 0;
const sendInput = (ws: WebSocket, yaw: number, moveZ = 0): void => {
  const w = new Writer();
  w.writeInt32(++seq);
  w.writeFloat32(0);
  w.writeFloat32(moveZ);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
};
async function blicke(ws: WebSocket, yaw = 0, dauerMs = 400, moveZ = 0): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) { sendInput(ws, yaw, moveZ); await warte(50); }
}
const sendAttack = (ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void => {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
};
const zdoEnthaelt = (ws: Socke, text: string): boolean => ws.zdoSync.some((b) => b.includes(Buffer.from(text, 'latin1')));

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'tod-treffer',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
  };
  const sockets: WebSocket[] = [];
  try {
    const wsA = await verbinde('Anna'); const wsB = await verbinde('Bernd');
    sockets.push(wsA, wsB);
    const hole = (n: string): Peer => {
      const p = server.net.getPeers().find((x) => x.name === n);
      if (!p) throw new Error(`peer ${n} missing`);
      return p;
    };
    const anna = hole('Anna'); const bernd = hole('Bernd');
    check('the default lying time is the shared constant (5000 ms)', server.liegezeitMs === TOD_LIEGEZEIT_MS && TOD_LIEGEZEIT_MS === 5000);
    const platz = async (ws: WebSocket, p: Peer, x: number, z: number): Promise<Vector3> => {
      sendAdmin(ws, `teleport ${x} ${z}`);
      await warte(350);
      if (Math.hypot(p.position.x - x, p.position.z - z) > 1) throw new Error(`teleport ${p.name} failed`);
      return p.position;
    };
    await platz(wsA, anna, 200, 200);
    await platz(wsB, bernd, 206, 200);
    await blicke(wsA, 0); // yaw 0: the view points along (0, -1): "front" is smaller z, "left" is larger x
    const start = { ...anna.position };
    const von = (dx: number, dz: number): Vector3 => ({ x: anna.position.x + dx, y: anna.position.y, z: anna.position.z + dz });
    const schlag = (dx: number, dz: number, dmg: number): void => {
      zugriff.applyCreatureAttack(von(dx, dz), dmg, 2.4, anna.worldId, anna.position);
    };
    const charZdo = () => server.zdos.getZDO(anna.characterID)!;

    // ── [1] hit reaction ───────────────────────────────────────
    console.log('\n[1] A blow that does not kill: the flinch, for the victim and for the bystander');
    anna.health = 100; anna.blockSeit = 0;
    schlag(2, -2, 8); // front left
    await warte(400);
    check('Anna got PlayerTreffer with the front-left clip', wsA.treffer.length === 1 && TREFFER_CLIPS[wsA.treffer[0]!] === 'treffer_vorn_links', `${wsA.treffer.map((i) => TREFFER_CLIPS[i])}`);
    check('health went down by the blow (100 -> 92) and Anna is alive', anna.health === 92 && !(anna.totBis > 0), `${anna.health}`);
    check('character ZDO carries animEinmal = treffer_vorn_links#1', charZdo().getString('animEinmal') === 'treffer_vorn_links#1', charZdo().getString('animEinmal'));
    check('Bernd\'s ZDO sync (over the wire) carries treffer_vorn_links#1', zdoEnthaelt(wsB as Socke, 'treffer_vorn_links#1'));
    check('the blood packet HitEffect reached Anna too', wsA.hitEffects >= 1, `${wsA.hitEffects}`);
    schlag(-2, 2, 8); // behind right
    await warte(400);
    check('second blow from behind right: clip treffer_hinten_rechts, counter #2',
      TREFFER_CLIPS[wsA.treffer[1]!] === 'treffer_hinten_rechts' && charZdo().getString('animEinmal') === 'treffer_hinten_rechts#2', charZdo().getString('animEinmal'));
    check('Bernd sees #2 as well', zdoEnthaelt(wsB as Socke, 'treffer_hinten_rechts#2'));
    check('no death packet so far', wsA.tod.length === 0 && wsB.tod.length === 0);

    // ── [2] death from the front ───────────────────────────────
    console.log('\n[2] A lethal blow from the front: Anna lies dead for the lying time');
    const WOLF = getStableHash('Wolf');
    // A creature with health next to Anna: her Attack must not hurt it while she is dead (control: it does while she lives).
    const ziel = server.zdos.createZDO(WOLF, { x: anna.position.x, y: anna.position.y, z: anna.position.z - 2 });
    ziel.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
    anna.stamina = 100;
    sendAttack(wsA, anna.position, '');
    await warte(300);
    const hpLebend = ziel.getInt(HEALTH_MEMBER);
    check('control: alive, her fist hurts the creature', hpLebend < maxLeben('Wolf'), `${maxLeben('Wolf')} -> ${hpLebend}`);

    anna.health = 5;
    const treffer0 = wsA.treffer.length;
    const t0 = Date.now();
    schlag(1, -2, 8); // from the front
    await warte(300);
    check('Anna is dead: health 0, totBis in the future', anna.health === 0 && anna.totBis > Date.now(), `${anna.health}, ${anna.totBis - Date.now()} ms left`);
    check('PlayerTod arrived once: tod_hinten (struck from the front, thrown backwards), 5000 ms', wsA.tod.length === 1 && TOD_CLIPS[wsA.tod[0]!.clip] === 'tod_hinten' && wsA.tod[0]!.ms === 5000, JSON.stringify(wsA.tod));
    check('the deadly blow sent no PlayerTreffer', wsA.treffer.length === treffer0);
    check('character ZDO: anim = tod_hinten (lying pose for late arrivals), animEinmal tod_hinten#3', charZdo().getString('anim') === 'tod_hinten' && charZdo().getString('animEinmal') === 'tod_hinten#3', `${charZdo().getString('anim')} / ${charZdo().getString('animEinmal')}`);
    check('Bernd sees tod_hinten#3 over the wire', zdoEnthaelt(wsB as Socke, 'tod_hinten#3'));
    check('her client is told health 0 %', wsA.prozent === 0, `${wsA.prozent}`);

    const effekte = wsA.hitEffects;
    schlag(1, -2, 8);
    schlag(0, 1, 50);
    await warte(300);
    check('dead: two more blows change nothing (health 0, no HitEffect, no new packet)', anna.health === 0 && wsA.hitEffects === effekte && wsA.tod.length === 1 && wsA.treffer.length === treffer0, `${anna.health}, effects ${wsA.hitEffects - effekte}`);

    const hp1 = ziel.getInt(HEALTH_MEMBER);
    anna.stamina = 100;
    sendAttack(wsA, anna.position, '');
    sendAttack(wsA, anna.position, 'SwordNorth');
    await warte(300);
    check('dead: her Attack packets are ignored (creature keeps its health, stamina untouched)', ziel.getInt(HEALTH_MEMBER) === hp1 && anna.stamina === 100, `${hp1} -> ${ziel.getInt(HEALTH_MEMBER)}, stamina ${anna.stamina}`);
    const lage = { ...anna.position };
    await blicke(wsA, 0, 400, 1); // walk forward
    check('dead: her PlayerInput does not move her', Math.hypot(anna.position.x - lage.x, anna.position.z - lage.z) < 1e-6, `${Math.hypot(anna.position.x - lage.x, anna.position.z - lage.z)} m`);
    const berndLage = { ...bernd.position };
    await blicke(wsB, 0, 500, 1);
    check('control: Bernd (alive) does move with the same packets', Math.hypot(bernd.position.x - berndLage.x, bernd.position.z - berndLage.z) > 0.5, `${Math.hypot(bernd.position.x - berndLage.x, bernd.position.z - berndLage.z).toFixed(2)} m`);
    server.zdos.destroyZDO(ziel.zdoid);

    // ── [3] revival by the server ──────────────────────────────
    console.log('\n[3] The server revives her after the lying time — her client never answered');
    check('still dead (well inside the lying time)', anna.totBis > 0 && anna.health === 0, `${Date.now() - t0} ms since the blow`);
    while (anna.totBis > 0 && Date.now() - t0 < 9000) await warte(50);
    const liegeGemessen = Date.now() - wsA.tod[0]!.zeit;
    check('revived after 5.0 s (4.9 - 5.6 s measured from PlayerTod)', anna.totBis === 0 && liegeGemessen >= 4900 && liegeGemessen <= 5600, `${liegeGemessen} ms`);
    await warte(300);
    check('full health and stamina, a Teleport packet came', anna.health === 100 && anna.stamina === 100 && wsA.teleports.length >= 1 && wsA.prozent === 100, `${anna.health}, teleports ${wsA.teleports.length}, ${wsA.prozent} %`);
    check('back at the start point (no bed): not where she died', Math.hypot(anna.position.x - start.x, anna.position.z - start.z) > 5, `died at ${start.x},${start.z}; now ${anna.position.x.toFixed(1)},${anna.position.z.toFixed(1)}`);
    check('the lying pose is gone for everybody: anim = idle', charZdo().getString('anim') === 'idle');
    check('she can be hurt again', (() => { anna.blockSeit = 0; const h = anna.health; zugriff.applyCreatureAttack({ ...anna.position }, 8, 2.4, anna.worldId, anna.position); return anna.health === h - 8; })());

    // ── [4] from behind, and the switch to the old behaviour ───
    console.log('\n[4] From behind: tod_vorn; lying time 0 = get up at once (old behaviour)');
    await platz(wsA, anna, 200, 200);
    await blicke(wsA, 0);
    anna.health = 5; anna.blockSeit = 0;
    schlag(-1, 2, 8);
    await warte(300);
    check('struck from behind: tod_vorn (falls forward)', wsA.tod.length === 2 && TOD_CLIPS[wsA.tod[1]!.clip] === 'tod_vorn', JSON.stringify(wsA.tod[1]));
    server.liegezeitMs = 0;
    anna.totBis = Date.now() + 10; // revive on the next tick, without waiting 5 s
    await warte(400);
    check('revived', anna.totBis === 0 && anna.health === 100);
    anna.health = 5; anna.blockSeit = 0;
    const tod0 = wsA.tod.length;
    schlag(0, -2, 8);
    check('liegezeitMs = 0: alive again at once, no PlayerTod packet', anna.health === 100 && anna.totBis === 0 && wsA.tod.length === tod0, `${anna.health}`);
    server.liegezeitMs = TOD_LIEGEZEIT_MS;

    // ── [5] creatures let go ───────────────────────────────────
    console.log('\n[5] A real NPC next to her: strikes while she lives, lets go while she lies');
    await platz(wsB, bernd, 600, 200); // far away, so Bernd is nobody's target here
    await platz(wsA, anna, 200, 200);
    await blicke(wsA, 0);
    const schlaege: number[] = [];
    const echt = server.aggro.onSchlag;
    server.aggro.onSchlag = (pos, schaden, radius) => { schlaege.push(Date.now()); echt?.(pos, schaden, radius); };
    const FURLOC = getStableHash('FurlocKrieger');
    const npcNeben = () => {
      const npc = server.zdos.createZDO(FURLOC, { x: anna.position.x, y: anna.position.y, z: anna.position.z - 2 });
      npc.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
      return npc;
    };
    anna.health = 100; anna.blockSeit = 0;
    const npc1 = npcNeben();
    await warte(4800);
    server.zdos.destroyZDO(npc1.zdoid);
    check('control (alive): the NPC struck her at least once and she lost health', schlaege.length >= 1 && anna.health < 100, `${schlaege.length} strikes, health ${anna.health}`);
    server.liegezeitMs = 10_000; // long enough to watch the NPC for a while
    anna.health = 5; anna.blockSeit = 0;
    schlag(0, -2, 8);
    await warte(250); // the blood packet of the killing blow is still on its way
    check('she lies dead now', anna.totBis > 0 && anna.health === 0);
    schlaege.length = 0;
    const effekte5 = wsA.hitEffects;
    const npc2 = npcNeben();
    await warte(4800);
    server.zdos.destroyZDO(npc2.zdoid);
    check('dead: the NPC next to her does not strike at all in 4.8 s (she is no target)', schlaege.length === 0 && wsA.hitEffects === effekte5 && anna.health === 0, `${schlaege.length} strikes, ${wsA.hitEffects - effekte5} effects`);
    server.aggro.onSchlag = echt;
    anna.totBis = Date.now() + 10;
    await warte(300);
    server.liegezeitMs = TOD_LIEGEZEIT_MS;
    check('revived again', anna.totBis === 0 && anna.health === 100);
  } finally {
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.close();
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
