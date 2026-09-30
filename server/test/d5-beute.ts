/**
 * D5 — loot on the ground with an owner (spiel/BeuteAmBoden.ts), over a real WebSocket.
 *
 *  [1] A killed creature leaves its loot on the ground at its position, NOT in the inventory.
 *  [2] The owner picks it up: the inventory rises by exactly the loot amount, the ZDO is gone.
 *  [3] A stranger cannot pick it up for 2 min (the message is the catalogue key `@beute.fremd`), after that he can.
 *  [4] Two attackers: the highest damage share owns the loot, also when the other one lands the killing blow.
 *  [5] Uncollected loot vanishes after the life time (5 min).
 *  [6] After a restart there is no loot on the ground (the save leaves it out), while a chest saved next to it is back.
 *  [7] 1,000 rolls through the real ground path stay within ±3 % of the table probability (seeded dice).
 *
 * The time of the 2 min / 5 min windows is wound forward through the test hook `beuteAmBoden.vorspulen`.
 * Ports are ephemeral (`portVon`, scripts/testport.mjs).
 *
 * Run: npx tsx server/test/d5-beute.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HEALTH_MEMBER, getStableHash, maxLeben, PacketType, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer, type WovServer } from '../src/WovServer.js';
import { BEUTE_EXKLUSIV_MS as EXKLUSIV_IM_CODE, BEUTE_LEBEN_MS as LEBEN_IM_CODE, BEUTE_BESITZER, BEUTE_ITEM, BEUTE_MENGE, BEUTE_FREI_AB, BEUTE_ABLAUF, SERVER_MELDUNG_BEUTE_FREMD } from '../src/spiel/BeuteAmBoden.js';
import { wuerfleDrop } from '../src/spiel/Beute.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d5-beute');
rmSync(WORLDS_DIR, { recursive: true, force: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, InteractResult: 45, Attack: 46, AdminCommand: 53, AuthChallenge: 68 };
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const KUH = getStableHash('Kuh');
// The numbers of the card, written out here on purpose: the test must not follow a changed constant in the code.
const BEUTE_EXKLUSIV_MS = 120_000;
const BEUTE_LEBEN_MS = 300_000;

function verbinde(port: number, name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`handshake timeout for "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const w = new Writer();
        w.writeString(antwortBerechnen(nonce, ''));
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
let eingabeSeq = 0;
function sendInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(++eingabeSeq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}
function sendAttack(ws: WebSocket, pos: Vector3, waffe: string): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(0);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}
function sendInteract(ws: WebSocket, pos: Vector3, prefabHash: number): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeInt32(prefabHash);
  ws.send(Buffer.concat([Buffer.from([PacketType.Interact]), w.toBuffer()]));
}
async function blicke(ws: WebSocket, dauerMs = 150): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) {
    sendInput(ws, 0);
    await warte(50);
  }
}

interface Spieler {
  name: string;
  ws: WebSocket;
  peer: ReturnType<WovServer['net']['getPeers']>[number];
  meldungen: Array<{ ok: boolean; text: string }>;
}

async function neuerSpieler(server: WovServer, port: number, name: string): Promise<Spieler> {
  const ws = await verbinde(port, name);
  const meldungen: Spieler['meldungen'] = [];
  ws.on('message', (data: Buffer) => {
    if (data.readUInt8(0) !== P.InteractResult) return;
    const r = new Reader(Buffer.from(data.subarray(1)));
    meldungen.push({ ok: r.readBool(), text: r.readString() });
  });
  const peer = server.net.getPeers().find((p) => p.name === name);
  if (!peer) throw new Error(`peer ${name} not found`);
  return { name, ws, peer, meldungen };
}

async function main(): Promise<void> {
  const konfig = {
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'd5-beute',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
  };
  const server = createWovServer(konfig);
  server.start();
  const PORT = portVon(server);
  const boden = server.beuteAmBoden;
  const lootZDOs = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => boden.istBeute(z));

  try {
    const alice = await neuerSpieler(server, PORT, 'Alice');
    const bob = await neuerSpieler(server, PORT, 'Bob');
    async function platz(s: Spieler, x: number, z: number): Promise<void> {
      sendAdmin(s.ws, `teleport ${x} ${z}`);
      await warte(300);
      if (Math.hypot(s.peer.position.x - x, s.peer.position.z - z) > 1) throw new Error('teleport did not take effect');
    }
    await platz(alice, 100, 100);
    await platz(bob, 101, 100);
    const mitte = { x: 100.5, z: 100 };
    const setzeKuh = (): ZDO => {
      const y = server.heightmaps.getGroundHeight(mitte.x, mitte.z - 2);
      const zdo = server.zdos.createZDO(KUH, { x: mitte.x, y, z: mitte.z - 2 });
      zdo.setInt(HEALTH_MEMBER, maxLeben('Kuh'));
      return zdo;
    };
    async function schlage(s: Spieler, waffe: string): Promise<void> {
      s.peer.stamina = 100;
      s.peer.health = 100;
      await blicke(s.ws, 100);
      sendAttack(s.ws, s.peer.position, waffe);
      await warte(450);
    }
    async function hebeAuf(s: Spieler, z: ZDO): Promise<void> {
      s.meldungen.length = 0;
      sendInteract(s.ws, z.position, z.prefabHash);
      await warte(250);
    }
    const fleisch = (s: Spieler): number => s.peer.inventar.countOf('RawMeat');

    check('the code constants are 2 min exclusive and 5 min life', EXKLUSIV_IM_CODE === BEUTE_EXKLUSIV_MS && LEBEN_IM_CODE === BEUTE_LEBEN_MS, `${EXKLUSIV_IM_CODE} / ${LEBEN_IM_CODE}`);

    // ── [1] Kill → loot on the ground, not in the inventory ──────
    console.log('\n[1] Kill: loot lies at the corpse, inventory unchanged');
    const kuh1 = setzeKuh();
    const kuhPos = { ...kuh1.position };
    const fleischVorher = fleisch(alice);
    await schlage(alice, 'AxeFlint');
    await schlage(alice, 'AxeFlint');
    check('cow (30 HP) dead after 2 axe hits (15 each)', kuh1.destroyed);
    const beute1 = lootZDOs();
    check('exactly one loot ZDO (cow: RawMeat, always)', beute1.length === 1, `${beute1.length} loot ZDO(s)`);
    const b1 = beute1[0];
    const menge1 = b1?.getInt(BEUTE_MENGE) ?? 0;
    check('loot is RawMeat, amount 2-3 (table), prefab = the item prefab', b1?.getString(BEUTE_ITEM) === 'RawMeat' && menge1 >= 2 && menge1 <= 3 && b1.prefabHash === getStableHash('RawMeat'), `${b1?.getString(BEUTE_ITEM)} x${menge1}`);
    check('loot lies at the position of the cow (< 0.01 m)', !!b1 && Math.hypot(b1.position.x - kuhPos.x, b1.position.z - kuhPos.z) < 0.01, b1 ? `${b1.position.x.toFixed(2)},${b1.position.z.toFixed(2)} vs ${kuhPos.x.toFixed(2)},${kuhPos.z.toFixed(2)}` : 'none');
    check('inventory RawMeat did not rise by the kill', fleisch(alice) === fleischVorher, `${fleischVorher} -> ${fleisch(alice)}`);
    check('owner member = Alice (the only attacker)', b1?.getString(BEUTE_BESITZER) === alice.peer.spielerId && alice.peer.spielerId !== '', `"${b1?.getString(BEUTE_BESITZER)}"`);
    const jetzt0 = boden.jetzt();
    const freiAb = Number(b1?.getLong(BEUTE_FREI_AB) ?? 0n);
    const ablauf = Number(b1?.getLong(BEUTE_ABLAUF) ?? 0n);
    check(`free-for-all after ${BEUTE_EXKLUSIV_MS / 1000} s, destroyed after ${BEUTE_LEBEN_MS / 1000} s`, Math.abs(freiAb - jetzt0 - BEUTE_EXKLUSIV_MS) < 3000 && Math.abs(ablauf - jetzt0 - BEUTE_LEBEN_MS) < 3000, `${Math.round((freiAb - jetzt0) / 1000)} s / ${Math.round((ablauf - jetzt0) / 1000)} s`);

    // ── [3] Stranger: no pick-up for 2 min, then yes ─────────────
    console.log('\n[3] Stranger (Bob) and the 2 minutes');
    await hebeAuf(bob, b1!);
    check('Bob is refused with the catalogue key', bob.meldungen.some((m) => !m.ok && m.text === SERVER_MELDUNG_BEUTE_FREMD), JSON.stringify(bob.meldungen));
    check('Bob: inventory 0, loot ZDO still there', fleisch(bob) === 0 && !b1!.destroyed, `Bob RawMeat ${fleisch(bob)}`);
    boden.vorspulen(BEUTE_EXKLUSIV_MS - 1000);
    await hebeAuf(bob, b1!);
    check('after 119 s Bob is still refused', bob.meldungen.some((m) => !m.ok && m.text === SERVER_MELDUNG_BEUTE_FREMD) && fleisch(bob) === 0 && !b1!.destroyed);

    // ── [2] Owner picks up ───────────────────────────────────────
    console.log('\n[2] Owner (Alice) picks up');
    await hebeAuf(alice, b1!);
    check(`Alice: inventory RawMeat +${menge1} (exactly the loot amount)`, fleisch(alice) === fleischVorher + menge1, `${fleischVorher} -> ${fleisch(alice)}`);
    check('loot ZDO is gone, no loot left', b1!.destroyed && lootZDOs().length === 0);

    console.log('\n[3b] After the 2 minutes everybody can pick up');
    const kuh2 = setzeKuh();
    await schlage(alice, 'AxeFlint');
    await schlage(alice, 'AxeFlint');
    const b2 = lootZDOs()[0];
    const menge2 = b2?.getInt(BEUTE_MENGE) ?? 0;
    boden.vorspulen(BEUTE_EXKLUSIV_MS + 1000);
    await hebeAuf(bob, b2!);
    check(`after 121 s Bob picks up: inventory +${menge2}`, kuh2.destroyed && fleisch(bob) === menge2 && b2!.destroyed, `Bob RawMeat ${fleisch(bob)}`);

    // ── [4] Two attackers: highest damage owns it ────────────────
    console.log('\n[4] Two attackers: Alice 19 damage, Bob 11 and the killing blow');
    const kuh3 = setzeKuh();
    await schlage(alice, 'AxeFlint'); // 30 -> 15
    await schlage(bob, ''); // 15 -> 11
    await schlage(bob, ''); // 11 -> 7
    await schlage(alice, ''); // 7 -> 3
    check('cow at 3 HP before the last hit', kuh3.getInt(HEALTH_MEMBER) === 3, `HP ${kuh3.getInt(HEALTH_MEMBER)}`);
    await schlage(bob, ''); // kills (counts 3, not 4)
    const b3 = lootZDOs()[0];
    check('cow dead, killed by Bob', kuh3.destroyed && !!b3);
    check('owner = Alice (19 > 11), although Bob landed the killing blow', b3?.getString(BEUTE_BESITZER) === alice.peer.spielerId, `owner "${b3?.getString(BEUTE_BESITZER)}", Alice "${alice.peer.spielerId}", Bob "${bob.peer.spielerId}"`);
    await hebeAuf(bob, b3!);
    check('the killer Bob cannot pick it up yet', bob.meldungen.some((m) => !m.ok && m.text === SERVER_MELDUNG_BEUTE_FREMD) && !b3!.destroyed);
    check('no damage tally left after the kill', boden.anzahlAnteile === 0, `${boden.anzahlAnteile}`);

    // ── [5] Life time ────────────────────────────────────────────
    console.log('\n[5] Uncollected loot vanishes');
    check('loot still tracked', boden.anzahlStuecke === 1 && !b3!.destroyed);
    boden.vorspulen(BEUTE_LEBEN_MS - 2000);
    await warte(1200);
    check('at 298 s the loot is still there', !b3!.destroyed && lootZDOs().length === 1);
    boden.vorspulen(3000);
    await warte(1200);
    check('at 301 s the loot is destroyed, nothing tracked', b3!.destroyed && lootZDOs().length === 0 && boden.anzahlStuecke === 0, `tracked ${boden.anzahlStuecke}`);

    // ── [7] Distribution over 1,000 rolls (seeded dice) ──────────
    console.log('\n[7] 1,000 rolls through the real ground path');
    {
      const echt = Math.random;
      let s = 123456789;
      Math.random = (): number => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        // The table values are frozen by beute-daten.ts (Skeleton Coins 0.6, Neck NeckTail 0.75); they are not changed here.
        for (const [kreatur, soll] of [['Skeleton', 0.6], ['Neck', 0.75]] as const) {
          let mit = 0;
          for (let i = 0; i < 1000; i++) {
            const z = server.zdos.createZDO(getStableHash(kreatur), { x: 50, y: 0, z: 50 });
            const n = boden.legeAb(server.zdos, z, [wuerfleDrop(kreatur)]).length;
            if (n > 0) mit++;
          }
          const anteil = mit / 1000;
          check(`${kreatur}: ${mit} of 1000 kills leave loot = ${(anteil * 100).toFixed(1)} % (table ${soll * 100} %, ±3 %)`, Math.abs(anteil - soll) <= 0.03);
        }
        let drei = 0;
        for (let i = 0; i < 1000; i++) {
          const z = server.zdos.createZDO(KUH, { x: 50, y: 0, z: 50 });
          const g = boden.legeAb(server.zdos, z, [wuerfleDrop('Kuh')]);
          if (g[0]?.amount === 3) drei++;
        }
        check(`Kuh amount 3 in ${drei} of 1000 = ${(drei / 10).toFixed(1)} % (2-3 evenly: 50 %, ±3 %)`, Math.abs(drei / 1000 - 0.5) <= 0.03);
      } finally {
        Math.random = echt;
      }
      // Lay 3,000 pieces: wind the clock and let the tick clean them away (the life time also bounds the ZDO count).
      const vorher = lootZDOs().length;
      boden.vorspulen(BEUTE_LEBEN_MS + 1000);
      await warte(1200);
      check(`${vorher} pieces laid, all gone after the life time`, vorher > 1500 && lootZDOs().length === 0, `${vorher} -> ${lootZDOs().length}`);
    }

    // ── [6] Restart: no loot back, the saved chest is ────────────
    console.log('\n[6] Restart: loot is not saved (no doubling), a chest is');
    const truhe = server.zdos.createZDO(getStableHash('piece_chest_wood'), { x: 60, y: 0, z: 60 });
    truhe.setInt('kontrolle', 7);
    const kuh4 = setzeKuh();
    await schlage(alice, 'AxeFlint');
    await schlage(alice, 'AxeFlint');
    check('before the stop: one loot ZDO on the ground', kuh4.destroyed && lootZDOs().length === 1);
    alice.ws.close();
    bob.ws.close();
    await warte(300);
    server.stop();
    const server2 = createWovServer(konfig);
    server2.start();
    try {
      const n2 = server2.zdos.getAllZDOs().filter((z) => server2.beuteAmBoden.istBeute(z)).length;
      const truhen = server2.zdos.getZDOByPrefab(getStableHash('piece_chest_wood')).filter((z) => z.getInt('kontrolle') === 7).length;
      check('after the restart the control chest is back (the save works)', truhen === 1, `${truhen} chest(s)`);
      check('after the restart: 0 loot ZDOs (nothing doubled)', n2 === 0, `${n2} loot ZDO(s)`);
    } finally {
      server2.stop();
    }
    return;
  } finally {
    try {
      server.stop();
    } catch {
      /* already stopped in [6] */
    }
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
