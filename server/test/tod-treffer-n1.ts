/**
 * Death and hit, follow-up N1 (PR #149 review "Tod und Treffer — Prüfung", findings B1-B4), over the REAL
 * packet path: real WebSocket players in one server, real wolves in the world's SpawnSystem.
 *
 *  [1] B1: the dead player stays in the position list for spawning/despawning. Anna dies, Bernd is 212 m away
 *      (outside the 130 m despawn radius): the three wolves beside Anna are all still there afterwards (count
 *      before = after), bite her 0 times while she lies (measured at the SpawnSystem's attack hook, target =
 *      her position) and bite again after the revival. Control: they bite her while she lives.
 *  [2] B1: Anna is the ONLY player and dies: the world's tick counter keeps counting (about 30 per second).
 *  [3] B3: every entry of TOT_GESPERRT, sent by a dead player over the wire, reaches no handler (Interact,
 *      Attack, Parry, TerrainOp, PlacePiece, RemovePiece, Craft, Eat, ContainerAction, AdminCommand); alive
 *      the same packet reaches it (control). Chat and Equip still pass in death, on purpose.
 *  [4] B2: an admin `teleport` of a dead player is refused (position, totBis unchanged, no Teleport packet), she
 *      is revived by the timer as usual (one Teleport packet, totBis 0).
 *  [5] B4: the lost-bed hint after a timed revival arrives as the catalogue key, not as German text.
 *
 * Run: npx tsx server/test/tod-treffer-n1.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { ANIM_MEMBER, HEALTH_MEMBER, PacketType, SERVER_MELDUNG_BETT_VERLOREN, getStableHash, maxLeben, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-tod-treffer-n1');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, AdminCommand: 53, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Socke extends WebSocket {
  teleports: number;
  meldungen: string[];
}

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.teleports = 0;
    ws.meldungen = [];
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
      } else if (type === PacketType.Teleport) {
        ws.teleports++;
      } else if (type === PacketType.InteractResult) {
        r.readBool();
        ws.meldungen.push(r.readString());
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
/** A packet whose body the spied handler never reads: only the type byte matters for the gate. */
const sendLeer = (ws: WebSocket, type: number): void => ws.send(Buffer.from([type, 0, 0, 0, 0, 0, 0, 0, 0]));
const sendInput = (ws: WebSocket, seq: number): void => {
  const w = new Writer();
  w.writeInt32(seq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'tod-treffer-n1',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: true, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
  } & Record<string, unknown>;
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
    const platz = async (ws: WebSocket, p: Peer, x: number, z: number): Promise<void> => {
      sendAdmin(ws, `teleport ${x} ${z}`);
      await warte(350);
      if (Math.hypot(p.position.x - x, p.position.z - z) > 1) throw new Error(`teleport ${p.name} failed`);
    };
    const spawns = server.hauptwelt.spawns;
    if (!spawns) throw new Error('no SpawnSystem');
    const toeten = (): void => {
      anna.health = 5; anna.paradeBis = 0;
      zugriff.applyCreatureAttack({ ...anna.position, x: anna.position.x + 2 }, 500, 2.4, anna.worldId, anna.position);
    };

    // ── [1] wolves stay, no bite while dead, bite again afterwards ──
    console.log('\n[1] Anna dies, Bernd is 212 m away: the wolves beside her stay and let go');
    await platz(wsA, anna, 200, 200);
    await platz(wsB, bernd, 412, 200);
    const WOLF = getStableHash('Wolf');
    const woelfe = ([[2, 0], [-2, 0], [0, 2]] as const).map(([dx, dz]) => {
      const z = server.zdos.createZDO(WOLF, { x: anna.position.x + dx, y: anna.position.y, z: anna.position.z + dz });
      z.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
      return z;
    });
    spawns.adoptPersisted();
    const vorhanden = (): number => woelfe.filter((z) => server.zdos.getZDO(z.zdoid) !== undefined).length;
    let bisse = 0;
    const echt = spawns.onCreatureAttack;
    spawns.onCreatureAttack = (pos, dmg, r, target) => { if (target === anna.position) bisse++; echt?.(pos, dmg, r, target); };
    anna.health = 100; anna.paradeBis = 0;
    await warte(3500);
    check('control (alive): the wolves bite her', bisse >= 1, `${bisse} bites`);
    const vorher = vorhanden();
    server.liegezeitMs = 6000;
    toeten();
    await warte(250);
    check('she lies dead', anna.totBis > 0 && anna.health === 0);
    bisse = 0;
    await warte(4500);
    check('dead, Bernd 212 m away: the wolves are all still there (count before = after)', vorher === 3 && vorhanden() === vorher, `${vorher} -> ${vorhanden()}`);
    check('dead: 0 bites on her in 4.5 s', bisse === 0, `${bisse} bites`);
    anna.totBis = Date.now() + 10;
    await warte(400);
    check('revived', anna.totBis === 0 && anna.health === 100);
    // Back at the start point far from where she died the old wolves are out of every player's range and
    // despawn (as they should); three fresh ones beside her show that biting works again.
    for (const z of woelfe) if (server.zdos.getZDO(z.zdoid)) server.zdos.destroyZDO(z.zdoid);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2]] as const) {
      const z = server.zdos.createZDO(WOLF, { x: anna.position.x + dx, y: anna.position.y, z: anna.position.z + dz });
      z.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
      woelfe.push(z);
    }
    spawns.adoptPersisted();
    anna.health = 100; anna.paradeBis = 0;
    bisse = 0;
    await warte(3500);
    check('after the revival the wolves bite her again', bisse >= 1, `${bisse} bites`);
    spawns.onCreatureAttack = echt;
    for (const z of woelfe) if (server.zdos.getZDO(z.zdoid)) server.zdos.destroyZDO(z.zdoid);
    anna.health = 100;

    // ── [3] every TOT_GESPERRT entry over the wire ─────────────
    console.log('\n[3] A dead player sends every locked packet: none reaches its handler; alive it does');
    const gesperrt: Array<[string, number, string]> = [
      ['Interact', PacketType.Interact, 'handleInteract'], ['Attack', PacketType.Attack, 'handleAttack'],
      ['Parry', PacketType.Parry, 'handleParry'], ['TerrainOp', PacketType.TerrainOp, 'handleTerrainOp'],
      ['PlacePiece', PacketType.PlacePiece, 'handlePlacePiece'], ['RemovePiece', PacketType.RemovePiece, 'handleRemovePiece'],
      ['Craft', PacketType.Craft, 'handleCraft'], ['Eat', PacketType.Eat, 'handleEat'],
      ['ContainerAction', PacketType.ContainerAction, 'handleContainerAction'], ['AdminCommand', PacketType.AdminCommand, 'handleAdminCommand'],
    ];
    const erlaubt: Array<[string, number, string]> = [
      ['ChatMessage', PacketType.ChatMessage, 'handleChatMessage'], ['Equip', PacketType.Equip, 'handleEquip'],
    ];
    const aufrufe = new Map<string, number>();
    for (const [name, , fn] of [...gesperrt, ...erlaubt]) {
      aufrufe.set(name, 0);
      zugriff[fn] = (p: Peer) => { if (p === anna) aufrufe.set(name, aufrufe.get(name)! + 1); };
    }
    for (const [, typ] of [...gesperrt, ...erlaubt]) sendLeer(wsA, typ);
    await warte(300);
    check('control (alive): each of the 12 packets reaches its handler once', [...aufrufe.values()].every((n) => n === 1), JSON.stringify([...aufrufe]));
    for (const k of aufrufe.keys()) aufrufe.set(k, 0);
    server.liegezeitMs = 8000;
    toeten();
    await warte(250);
    for (const [, typ] of [...gesperrt, ...erlaubt]) sendLeer(wsA, typ);
    await warte(300);
    for (const [name] of gesperrt) check(`dead: ${name} reaches no handler`, aufrufe.get(name) === 0, `${aufrufe.get(name)}`);
    for (const [name] of erlaubt) check(`dead: ${name} still passes (no world action)`, aufrufe.get(name) === 1, `${aufrufe.get(name)}`);
    for (const [, , fn] of [...gesperrt, ...erlaubt]) delete zugriff[fn];

    // ── [4] B2: admin teleport of a dead player ────────────────
    console.log('\n[4] An admin teleport of a dead player is refused');
    const lage = { ...anna.position };
    const tele0 = wsA.teleports;
    sendAdmin(wsA, 'teleport 300 300');
    await warte(400);
    check('dead: the teleport did not move her, totBis stays, no Teleport packet',
      Math.hypot(anna.position.x - lage.x, anna.position.z - lage.z) < 1e-6 && anna.totBis > 0 && wsA.teleports === tele0,
      `${Math.hypot(anna.position.x - lage.x, anna.position.z - lage.z).toFixed(2)} m, teleports +${wsA.teleports - tele0}`);
    anna.totBis = Date.now() + 10;
    await warte(400);
    check('the timer revival still gives exactly one Teleport packet and totBis 0', anna.totBis === 0 && wsA.teleports === tele0 + 1, `+${wsA.teleports - tele0}`);
    sendInput(wsA, 999);
    await warte(100);

    // ── [5] B4: the lost-bed hint is a catalogue key ───────────
    console.log('\n[5] The lost-bed hint after a timed revival is a key');
    anna.spawnPoint = { x: 10, y: 0, z: 10 }; // no bed there: the point gets discarded and reported
    server.liegezeitMs = 600;
    wsA.meldungen.length = 0;
    toeten();
    await warte(1600);
    check('the hint arrived as the key, after the death message', wsA.meldungen.includes(SERVER_MELDUNG_BETT_VERLOREN) && wsA.meldungen[0] === 'Du bist gestorben', JSON.stringify(wsA.meldungen));
    check('no German hint text is sent any more', !wsA.meldungen.some((m) => m.includes('Schlafplatz')), JSON.stringify(wsA.meldungen));
    check('the point is discarded, she lives', anna.spawnPoint === null && anna.totBis === 0 && anna.health === 100);

    // ── [2] Anna alone: the world keeps ticking while she lies ─
    console.log('\n[2] Anna is the only player and lies dead: the world tick counter keeps counting');
    wsB.close();
    await warte(600);
    check('Bernd is gone, Anna is the only peer', server.net.getPeers().length === 1);
    let ticks = 0;
    const welt = server.hauptwelt;
    const echtTick = welt.tick.bind(welt);
    welt.tick = (...a: Parameters<typeof welt.tick>) => { ticks++; return echtTick(...a); };
    // A chaser 10 m from her: it runs/strikes while she lives and lets go (idle) once she is the dead only player.
    const jaeger = server.zdos.createZDO(WOLF, { x: anna.position.x + 10, y: anna.position.y, z: anna.position.z });
    jaeger.setInt(HEALTH_MEMBER, maxLeben('Wolf'));
    spawns.adoptPersisted();
    anna.health = 100; anna.paradeBis = 0;
    await warte(1500);
    const animLebend = jaeger.getString(ANIM_MEMBER);
    const lebend = ticks;
    ticks = 0;
    server.liegezeitMs = 8000;
    toeten();
    await warte(2000);
    const animTot = jaeger.getString(ANIM_MEMBER);
    const phaseTot = spawns.kiPhase(jaeger);
    const abstandTot = Math.hypot(jaeger.position.x - anna.position.x, jaeger.position.z - anna.position.z);
    check('control (alive): the chaser runs or strikes', animLebend === 'run' || animLebend === 'attack', animLebend);
    // Gemeint ist: Der Verfolger hat losgelassen und jagt nicht mehr. Seit D4 kehrt der Wolf dann heim (Phase heimkehren, Clip walk)
    // oder steht schon wieder (wandern, idle); weder run noch attack, und er ist nicht in Schlagreichweite des Toten.
    check(
      'dead, alone: the chaser has let go (no run/attack; idle, or walking home)',
      (animTot === 'idle' || animTot === 'walk') && (phaseTot === 'heimkehren' || phaseTot === 'wandern') && abstandTot > 1.7,
      `${animLebend} -> ${animTot}, phase ${phaseTot}, ${abstandTot.toFixed(1)} m from her`
    );
    check('control (alive, 1.5 s): the world ticks', lebend >= 30, `${lebend} ticks`);
    check('dead, alone (2 s): the world ticks on', anna.totBis > 0 && ticks >= 40, `${ticks} ticks in 2 s`);
    welt.tick = echtTick;
    anna.totBis = Date.now() + 10;
    await warte(300);
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
