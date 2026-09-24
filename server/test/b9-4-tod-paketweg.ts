/**
 * B9.4 N1 — death and hit over the REAL packet path (`handleAttack`).
 *
 *  [A] hit: a blow that does not kill a wolf with a `hit` clip writes `hit#n`
 *  [B] die: two players strike at once; one kill, one loot, the body stays for
 *      the clip, is not hittable again (life stays 0), is removed after ~1.25 s
 *  [C] the wolf as shipped (no die clip) is destroyed at once, one loot
 *  [D] an INSTANCE world creature with the same ZDO id as a main-world wolf:
 *      a blow in the instance must not kill or twitch the main-world wolf, and
 *      the loot is paid once
 *  [E] the main-world wolf is DYING: the instance wolf with the same id must
 *      still be hittable (`stirbt` needs the identity check as well)
 *  [F] instance kill first, then a main-world blow on the same id
 *
 * The wolf gets `hit`/`die` only inside this test. Ports are ephemeral.
 *
 * Run: npx tsx server/test/b9-4-tod-paketweg.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import * as Shared from '@wov/shared';
import { HEALTH_MEMBER, SPAWN_TABLE, getStableHash, type SpawnEntry, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-b9-4-tod-paketweg');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const S = Shared as unknown as Record<string, unknown>;
const EINMAL = (S.ANIM_EINMAL_MEMBER as string | undefined) ?? 'animEinmal';
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, InteractResult: 45, Attack: 46, AdminCommand: 53, AuthChallenge: 68 };
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let PORT = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    let auth = false;
    const t = setTimeout(() => fail(new Error('handshake ' + name)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(t);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}
function admin(ws: WebSocket, line: string) {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}
let seq = 0;
async function blicke(ws: WebSocket, yaw: number) {
  for (let t = 0; t < 400; t += 50) {
    const w = new Writer();
    w.writeInt32(++seq); w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(yaw); w.writeFloat32(0); w.writeFloat32(0); w.writeBool(false); w.writeBool(false);
    ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
    await warte(50);
  }
}
function attack(ws: WebSocket, pos: Vector3) {
  const w = new Writer();
  w.writeVector3(pos); w.writeFloat32(0); w.writeString('');
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

const wolfRoh = SPAWN_TABLE.find((e) => e.prefab === 'Wolf')!;
const ruhig = { idleMinSec: 999, idleMaxSec: 999, aggro: false, flees: false } as const;
const mitDie = { ...wolfRoh, ...ruhig, clips: [...(wolfRoh.clips ?? []), 'hit', 'die'], dieSec: 1 } as unknown as SpawnEntry;
const ohneDie = { ...wolfRoh, ...ruhig } as SpawnEntry;
const WOLF = getStableHash('Wolf');

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'b94-tod',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: true, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const spawns = server.spawns!;
  (spawns as unknown as { table: SpawnEntry[] }).table = []; // no random spawns next to the test
  try {
    const a = await verbinde('Anna');
    const b = await verbinde('Bernd');
    const besiegt: Record<string, number> = { Anna: 0, Bernd: 0 };
    for (const [n, ws] of [['Anna', a], ['Bernd', b]] as const) {
      ws.on('message', (d: Buffer) => {
        if (d.readUInt8(0) !== P.InteractResult) return;
        const r = new Reader(Buffer.from(d.subarray(1)));
        r.readBool();
        if (r.readString().includes('besiegt')) besiegt[n]++;
      });
    }
    const pa = server.net.getPeers().find((p) => p.name === 'Anna')!;
    const pb = server.net.getPeers().find((p) => p.name === 'Bernd')!;
    async function platz(x: number, z: number): Promise<Vector3> {
      admin(a, `teleport ${x} ${z}`); admin(b, `teleport ${x} ${z}`);
      await warte(400);
      await Promise.all([blicke(a, 0), blicke(b, 0)]);
      for (const p of [pa, pb]) { p.stamina = 100; p.health = 100; }
      besiegt.Anna = 0; besiegt.Bernd = 0;
      return { ...pa.position };
    }
    function wolf(pos: Vector3, entry: SpawnEntry, hp: number): ZDO {
      const z = server.zdos.createZDO(WOLF, { x: pos.x, y: pos.y, z: pos.z - 1.5 });
      spawns.adoptSingle(z, entry);
      z.setInt(HEALTH_MEMBER, hp);
      return z;
    }
    const sp = spawns as unknown as { stirbt(z: ZDO): boolean };

    console.log('\n[A] a blow that does not kill writes hit#1');
    let m = await platz(300, 300);
    const w0 = wolf(m, mitDie, 30);
    attack(a, m);
    await warte(300);
    check('the wolf lives (life < 30) and is not dying', w0.getInt(HEALTH_MEMBER) < 30 && w0.getInt(HEALTH_MEMBER) > 0 && !w0.destroyed, `life ${w0.getInt(HEALTH_MEMBER)}`);
    check('the hit event is written: hit#1', w0.getString(EINMAL) === 'hit#1', w0.getString(EINMAL) || 'empty');
    server.zdos.destroyZDO(w0.zdoid);

    console.log('\n[B] die: two players strike at once');
    m = await platz(340, 340);
    const w1 = wolf(m, mitDie, 3);
    const t0 = performance.now();
    attack(a, m); attack(b, m); attack(a, m); attack(b, m);
    await warte(300);
    check('exactly one kill message for two players', besiegt.Anna + besiegt.Bernd === 1, `Anna ${besiegt.Anna}, Bernd ${besiegt.Bernd}`);
    check('the body is still there (die clip plays), not destroyed at once', !w1.destroyed);
    check('the die event is written, once: die#1', w1.getString(EINMAL) === 'die#1', w1.getString(EINMAL) || 'empty');
    check('life is 0 and the wolf is dying', w1.getInt(HEALTH_MEMBER) === 0 && sp.stirbt(w1), `life ${w1.getInt(HEALTH_MEMBER)}`);
    for (const p of [pa, pb]) p.stamina = 100;
    attack(a, m); attack(b, m);
    await warte(300);
    check('blows into the dying window do not revive it (life stays 0, event stays die#1)', w1.getInt(HEALTH_MEMBER) === 0 && w1.getString(EINMAL) === 'die#1', `life ${w1.getInt(HEALTH_MEMBER)}, ${w1.getString(EINMAL)}`);
    check('...and pay no second loot', besiegt.Anna + besiegt.Bernd === 1, `${besiegt.Anna + besiegt.Bernd}`);
    let weg = -1;
    while (performance.now() - t0 < 4000) { if (w1.destroyed) { weg = performance.now() - t0; break; } await warte(20); }
    console.log(`      removed ${Math.round(weg)} ms after the first blow`);
    check('the body is removed after the clip (1.0 s + 0.25 s, tolerance for the tick)', weg >= 1000 && weg <= 2000, `${Math.round(weg)} ms`);

    console.log('\n[C] the wolf as shipped (no die clip)');
    m = await platz(380, 380);
    const w2 = wolf(m, ohneDie, 3);
    attack(a, m); attack(b, m);
    await warte(300);
    check('destroyed at once, one kill message, no event', w2.destroyed && besiegt.Anna + besiegt.Bernd === 1 && w2.getString(EINMAL) === '', `${besiegt.Anna + besiegt.Bernd} message(s)`);

    console.log('\n[D] instance world: same ZDO id as a main-world wolf');
    m = await platz(420, 420);
    const haupt = server.zdos.createZDO(WOLF, { x: m.x + 6, y: m.y, z: m.z + 6 });
    spawns.adoptSingle(haupt, mitDie);
    haupt.setInt(HEALTH_MEMBER, 30);
    const welt = server.instanzWeltAnlegen('b94probe');
    const ipos = { x: 5, y: 0, z: 5 };
    const inst = welt.zdos.createZDOWithID(haupt.zdoid, WOLF, { x: ipos.x, y: ipos.y, z: ipos.z - 1.5 }, { x: 0, y: 0, z: 0, w: 1 });
    inst.setInt(HEALTH_MEMBER, 3);
    check('the set-up collides: same id in both worlds', inst.zdoid.toString() === haupt.zdoid.toString() && (inst as unknown) !== (haupt as unknown));
    pa.worldId = 'b94probe';
    pa.position = { ...ipos };
    pa.stamina = 100;
    besiegt.Anna = 0;
    attack(a, ipos);
    await warte(300);
    check('the instance wolf dies (destroyed at once, it has no die clip in its system)', inst.destroyed, `hp ${inst.getInt(HEALTH_MEMBER)}`);
    check('the MAIN-world wolf is untouched: life 30, no event, not dying, alive', haupt.getInt(HEALTH_MEMBER) === 30 && haupt.getString(EINMAL) === '' && !sp.stirbt(haupt) && !haupt.destroyed, `life ${haupt.getInt(HEALTH_MEMBER)}, '${haupt.getString(EINMAL)}'`);
    check('one kill message (loot paid once)', besiegt.Anna === 1, `${besiegt.Anna}`);
    // a non-lethal blow in the instance must not make the main-world wolf twitch
    await warte(1000); // the server limits the blow rate
    const haupt2 = server.zdos.createZDO(WOLF, { x: m.x + 8, y: m.y, z: m.z + 8 });
    spawns.adoptSingle(haupt2, mitDie);
    haupt2.setInt(HEALTH_MEMBER, 30);
    const inst2 = welt.zdos.createZDOWithID(haupt2.zdoid, WOLF, { x: ipos.x, y: ipos.y, z: ipos.z - 1.5 }, { x: 0, y: 0, z: 0, w: 1 });
    inst2.setInt(HEALTH_MEMBER, 30);
    pa.position = { ...ipos };
    pa.stamina = 100;
    attack(a, ipos);
    await warte(300);
    check('a non-lethal blow in the instance hurts the instance wolf...', inst2.getInt(HEALTH_MEMBER) < 30, `life ${inst2.getInt(HEALTH_MEMBER)}`);
    check('...and makes the main-world wolf twitch NOT (no hit event there)', haupt2.getString(EINMAL) === '', `'${haupt2.getString(EINMAL)}'`);
    console.log('\n[E] main-world wolf DYING, instance wolf with the same id');
    welt.zdos.destroyZDO(inst2.zdoid);
    await warte(1000);
    for (const p of [pa, pb]) p.stamina = 100;
    const mB = { ...pb.position };
    const haupt3 = wolf(mB, mitDie, 3);
    const inst3 = welt.zdos.createZDOWithID(haupt3.zdoid, WOLF, { x: ipos.x, y: ipos.y, z: ipos.z - 1.5 }, { x: 0, y: 0, z: 0, w: 1 });
    inst3.setInt(HEALTH_MEMBER, 3);
    besiegt.Anna = 0; besiegt.Bernd = 0;
    await Promise.all([blicke(a, 0), blicke(b, 0)]);
    for (const p of [pa, pb]) p.stamina = 100;
    attack(b, mB);
    await warte(150);
    check('E: main-world wolf is dying (Bernd, main world)', sp.stirbt(haupt3) && !haupt3.destroyed, `hp ${haupt3.getInt(HEALTH_MEMBER)}`);
    pa.position = { ...ipos };
    attack(a, ipos);
    await warte(300);
    check('E: the instance wolf with the same id is hittable in that window (Anna kills it)', inst3.destroyed && besiegt.Anna === 1, `destroyed ${inst3.destroyed}, hp ${inst3.getInt(HEALTH_MEMBER)}, Anna ${besiegt.Anna}, Bernd ${besiegt.Bernd}`);
    check('E: Bernd one kill', besiegt.Bernd === 1, `${besiegt.Bernd}`);
    let weg3 = -1; const t3 = performance.now();
    while (performance.now() - t3 < 3000) { if (haupt3.destroyed) { weg3 = performance.now() - t3; break; } await warte(20); }
    check('E: main-world body goes after the clip', weg3 >= 0, `${Math.round(weg3)} ms`);
    // [F] reverse: instance kill first, then main-world blow on the same id
    console.log('\n[F] instance kill, then the main-world wolf with the same id');
    if (!inst3.destroyed) welt.zdos.destroyZDO(inst3.zdoid);
    await warte(1000);
    for (const p of [pa, pb]) p.stamina = 100;
    const haupt4 = wolf(mB, mitDie, 30);
    const inst4 = welt.zdos.createZDOWithID(haupt4.zdoid, WOLF, { x: ipos.x, y: ipos.y, z: ipos.z - 1.5 }, { x: 0, y: 0, z: 0, w: 1 });
    inst4.setInt(HEALTH_MEMBER, 3);
    besiegt.Anna = 0; besiegt.Bernd = 0;
    await Promise.all([blicke(a, 0), blicke(b, 0)]);
    for (const p of [pa, pb]) p.stamina = 100;
    pa.position = { ...ipos };
    attack(a, ipos);
    await warte(200);
    attack(b, mB);
    await warte(300);
    check('F: instance wolf gone, one kill for Anna', inst4.destroyed && besiegt.Anna === 1, `${inst4.destroyed} ${besiegt.Anna}`);
    check('F: main-world wolf only hurt (hit#1), alive, not dying', !haupt4.destroyed && haupt4.getInt(HEALTH_MEMBER) < 30 && haupt4.getInt(HEALTH_MEMBER) > 0 && haupt4.getString(EINMAL) === 'hit#1' && !sp.stirbt(haupt4), `hp ${haupt4.getInt(HEALTH_MEMBER)} '${haupt4.getString(EINMAL)}'`);
    const spn = spawns as unknown as { creatures: Map<string, { zdo: ZDO }> };
    check('F: SpawnSystem still holds the MAIN wolf under that key', spn.creatures.get(haupt4.zdoid.toString())?.zdo === haupt4);
    a.close(); b.close();
  } finally {
    server.stop();
  }
}

try {
  await main();
} finally {
  // Also after a crash in main(): the folder must not stay behind.
  rmSync(WORLDS_DIR, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
