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
 *  [8] A full / nearly full / empty inventory: the loot (and a world item) is only taken for the part that was given.
 *  [9] Foreign loot nearer than own loot does not block the pick-up of the own piece.
 *  [10] A guest without token who reconnects (new identity): the rule is the key of the buildings; exclusive time ends after 2 min.
 *  [11] The owner key is not sent to any client (wire probe on the stranger).
 *  [13] Harvest, refund of a torn-down piece, craft and cooking at a full inventory: what cannot be handed over lies on the
 *       ground (harvest, refund) or the action is refused and nothing is taken (craft, cooking).
 *  [14] The room question `passtNachEntnahme` equals the real remove + addItem on 3,000 random inventories, about half of them with kept raw stacks.
 *  [15] Every creature and item of the loot tables has a name key in both catalogues.
 *  [12] Damage rules: overkill does not count, the tie goes to the first to hit, the killing blow counts, the tally goes at death /
 *       despawn / after 10 min.
 *
 * The time of the 2 min / 5 min windows is wound forward through the test hook `beuteAmBoden.vorspulen`.
 * Ports are ephemeral (`portVon`, scripts/testport.mjs).
 *
 * Run: npx tsx server/test/d5-beute.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { readFileSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HEALTH_MEMBER, Inventory, PIECES, findItem, getStableHash, maxLeben, PacketType, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer, type WovServer } from '../src/WovServer.js';
import { BEUTE_EXKLUSIV_MS as EXKLUSIV_IM_CODE, BEUTE_LEBEN_MS as LEBEN_IM_CODE, BEUTE_BESITZER, BEUTE_ITEM, BEUTE_MENGE, BEUTE_FREI_AB, BEUTE_ABLAUF, SERVER_MELDUNG_BEUTE_FREMD, passtNachEntnahme } from '../src/spiel/BeuteAmBoden.js';
import { ZWEIT_DROPS, wuerfleDrop } from '../src/spiel/Beute.js';
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
  /** every packet this client received (for the wire probe of the owner key) */
  roh: Buffer[];
}

async function neuerSpieler(server: WovServer, port: number, name: string): Promise<Spieler> {
  const ws = await verbinde(port, name);
  const meldungen: Spieler['meldungen'] = [];
  const roh: Buffer[] = [];
  ws.on('message', (data: Buffer) => {
    roh.push(Buffer.from(data));
    if (data.readUInt8(0) !== P.InteractResult) return;
    const r = new Reader(Buffer.from(data.subarray(1)));
    meldungen.push({ ok: r.readBool(), text: r.readString() });
  });
  const peer = server.net.getPeers().find((p) => p.name === name);
  if (!peer) throw new Error(`peer ${name} not found`);
  return { name, ws, peer, meldungen, roh };
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
    check('the kill message names the creature (catalogue key with the parameter kreatur)', alice.meldungen.some((m) => m.ok && m.text === '@beute.besiegt|{"kreatur":"Kuh"}'), JSON.stringify(alice.meldungen));
    const beute1 = lootZDOs();
    check('exactly one loot ZDO (cow: RawMeat, always)', beute1.length === 1, `${beute1.length} loot ZDO(s)`);
    const b1 = beute1[0];
    const menge1 = b1?.getInt(BEUTE_MENGE) ?? 0;
    check('loot is RawMeat, amount 2-3 (table), prefab = the item prefab', b1?.getString(BEUTE_ITEM) === 'RawMeat' && menge1 >= 2 && menge1 <= 3 && b1.prefabHash === getStableHash('RawMeat'), `${b1?.getString(BEUTE_ITEM)} x${menge1}`);
    check('loot lies at the position of the cow (< 0.01 m)', !!b1 && Math.hypot(b1.position.x - kuhPos.x, b1.position.z - kuhPos.z) < 0.01, b1 ? `${b1.position.x.toFixed(2)},${b1.position.z.toFixed(2)} vs ${kuhPos.x.toFixed(2)},${kuhPos.z.toFixed(2)}` : 'none');
    check('inventory RawMeat did not rise by the kill', fleisch(alice) === fleischVorher, `${fleischVorher} -> ${fleisch(alice)}`);
    check('owner member = Alice (the only attacker)', b1?.getString(BEUTE_BESITZER) === alice.peer.userId.toString() && alice.peer.userId.toString() !== '', `"${b1?.getString(BEUTE_BESITZER)}"`);
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
    boden.tick(); // the server tick flips the window member that darfAufheben reads (no wait for the 30 Hz loop)
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
    check('owner = Alice (19 > 11), although Bob landed the killing blow', b3?.getString(BEUTE_BESITZER) === alice.peer.userId.toString(), `owner "${b3?.getString(BEUTE_BESITZER)}", Alice "${alice.peer.userId.toString()}", Bob "${bob.peer.userId.toString()}"`);
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

    // ── [8] F1: a full inventory does not destroy the loot ───────
    console.log('\n[8] Pick-up with a full / a nearly full / an empty inventory');
    const STEIN = findItem('Stone')!;
    const FLEISCH = findItem('RawMeat')!;
    const leere = (s: Spieler): void => {
      for (const it of [...s.peer.inventar.all]) s.peer.inventar.removeItem(it, it.stack);
    };
    const fuelleMitStein = (s: Spieler): void => {
      while (s.peer.inventar.addItem(STEIN, 50) === 0) {
        /* until nothing fits any more */
      }
    };
    const legeBeute = (besitzer: Spieler | null, item: string, menge: number, x: number, z: number): ZDO => {
      const vorher = new Set(lootZDOs());
      const tot = server.zdos.createZDO(KUH, { x, y: server.heightmaps.getGroundHeight(x, z), z });
      if (besitzer) boden.schaden(tot, besitzer.peer.userId.toString(), 5);
      boden.legeAb(server.zdos, tot, [{ name: item, amount: menge }]);
      server.zdos.destroyZDO(tot.zdoid);
      const neu = lootZDOs().find((l) => !vorher.has(l));
      if (!neu) throw new Error('loot was not laid');
      return neu;
    };
    const hatMeldung = (s: Spieler, text: string): boolean => s.meldungen.some((m) => m.text === text);
    await platz(alice, 100, 100);
    await platz(bob, 140, 140);

    leere(alice);
    fuelleMitStein(alice);
    const voll = legeBeute(alice, 'RawMeat', 3, 100.5, 98);
    check('full inventory: no RawMeat fits', alice.peer.inventar.addItem(FLEISCH, 1) === 1 && fleisch(alice) === 0);
    await hebeAuf(alice, voll);
    check('full: the loot stays on the ground with amount 3', !voll.destroyed && voll.getInt(BEUTE_MENGE) === 3, `destroyed ${voll.destroyed}, amount ${voll.getInt(BEUTE_MENGE)}`);
    check('full: inventory has no RawMeat', fleisch(alice) === 0, `${fleisch(alice)}`);
    check('full: the player gets the catalogue key "inventory full", no success', alice.meldungen.some((m) => !m.ok && m.text === '@inventory.full') && !alice.meldungen.some((m) => m.text.startsWith('@beute.aufgesammelt')), JSON.stringify(alice.meldungen));
    server.zdos.destroyZDO(voll.zdoid); // the next cases must not find this piece first

    leere(alice);
    alice.peer.inventar.addItem(FLEISCH, FLEISCH.maxStackSize - 1);
    fuelleMitStein(alice);
    const teil = legeBeute(alice, 'RawMeat', 3, 100.5, 98);
    await hebeAuf(alice, teil);
    check(`partial (room for 1 of 3): inventory RawMeat ${FLEISCH.maxStackSize - 1} -> ${FLEISCH.maxStackSize}`, fleisch(alice) === FLEISCH.maxStackSize, `${fleisch(alice)}`);
    check('partial: the loot stays with the remaining amount 2', !teil.destroyed && teil.getInt(BEUTE_MENGE) === 2, `destroyed ${teil.destroyed}, amount ${teil.getInt(BEUTE_MENGE)}`);
    check('partial: the message says what was taken and what stayed lying there (1 taken, 2 left)', alice.meldungen.some((m) => m.ok && m.text === '@beute.aufgesammelt_teil|{"item":"RawMeat","menge":1,"rest":2}'), JSON.stringify(alice.meldungen));
    await hebeAuf(alice, teil);
    check('second try with nothing fitting: still 2 lying there, "inventory full"', !teil.destroyed && teil.getInt(BEUTE_MENGE) === 2 && fleisch(alice) === FLEISCH.maxStackSize && alice.meldungen.some((m) => !m.ok && m.text === '@inventory.full'));
    leere(alice);
    await hebeAuf(alice, teil);
    check('with room again the rest 2 is picked up, the ZDO is gone', teil.destroyed && fleisch(alice) === 2, `${fleisch(alice)}`);

    leere(alice);
    const leer = legeBeute(alice, 'RawMeat', 3, 100.5, 98);
    await hebeAuf(alice, leer);
    check('empty inventory: all 3 picked up, ZDO gone', leer.destroyed && fleisch(alice) === 3 && alice.meldungen.some((m) => m.ok && m.text === '@beute.aufgesammelt|{"item":"RawMeat","menge":3}'), `${fleisch(alice)} ${JSON.stringify(alice.meldungen)}`);

    // The same code path serves the world pick-ups (a boss trophy lying around): it must not vanish either.
    leere(alice);
    fuelleMitStein(alice);
    const troph = server.zdos.createZDO(getStableHash('TrophyEikthyr'), { x: 100.5, y: server.heightmaps.getGroundHeight(100.5, 98), z: 98 });
    await hebeAuf(alice, troph);
    check('TrophyEikthyr (world item) with a full inventory stays on the ground', !troph.destroyed && alice.peer.inventar.countOf('TrophyEikthyr') === 0 && alice.meldungen.some((m) => !m.ok && m.text === '@inventory.full'), `destroyed ${troph.destroyed}`);
    leere(alice);
    await hebeAuf(alice, troph);
    check('TrophyEikthyr with room is picked up', troph.destroyed && alice.peer.inventar.countOf('TrophyEikthyr') === 1);
    leere(alice);
    boden.vorspulen(BEUTE_LEBEN_MS + 1000);
    await warte(1200);
    check('clean up: the loot that stayed lying around is gone', lootZDOs().length === 0, `${lootZDOs().length}`);

    // ── [9] F6: foreign loot does not block the next piece ───────
    console.log('\n[9] Foreign loot 1 m away, own loot 2 m away');
    await platz(alice, 100, 100);
    const fremdNah = legeBeute(bob, 'RawMeat', 2, 101, 100);
    const eigenFern = legeBeute(alice, 'RawMeat', 3, 102, 100);
    await hebeAuf(alice, { position: { x: 100, y: fremdNah.position.y, z: 100 }, prefabHash: fremdNah.prefabHash } as ZDO);
    check('Alice gets her own piece (3), the nearer foreign one is skipped', eigenFern.destroyed && fleisch(alice) === 3 && !fremdNah.destroyed, `own destroyed ${eigenFern.destroyed}, RawMeat ${fleisch(alice)}, foreign destroyed ${fremdNah.destroyed}`);
    await hebeAuf(alice, { position: { x: 100, y: fremdNah.position.y, z: 100 }, prefabHash: fremdNah.prefabHash } as ZDO);
    check('only the foreign piece is left: refused with the "foreign" key, not "nothing there"', hatMeldung(alice, SERVER_MELDUNG_BEUTE_FREMD) && !fremdNah.destroyed && fleisch(alice) === 3, JSON.stringify(alice.meldungen));
    boden.vorspulen(BEUTE_EXKLUSIV_MS + 1000);
    boden.tick(); // the server tick flips the window member that darfAufheben reads (no wait for the 30 Hz loop)
    await hebeAuf(alice, { position: { x: 100, y: fremdNah.position.y, z: 100 }, prefabHash: fremdNah.prefabHash } as ZDO);
    check('after the 2 minutes the foreign piece is hers too', fremdNah.destroyed && fleisch(alice) === 5, `${fleisch(alice)}`);
    leere(alice);

    // ── [10] F3: a guest without token who reconnects ────────────
    console.log('\n[10] Guest without token reconnects (new identity): rule = same key as the buildings, exclusive time ends after 2 min');
    {
      const gast1 = await neuerSpieler(server, PORT, 'Gast');
      await platz(gast1, 120, 120);
      const alteKennung = gast1.peer.userId.toString();
      const gbeute = legeBeute(gast1, 'RawMeat', 2, 120, 118);
      check('the loot carries the owner key = userId (the key of `besitzer`)', gbeute.getString(BEUTE_BESITZER) === alteKennung, `"${gbeute.getString(BEUTE_BESITZER)}"`);
      gast1.ws.close();
      await warte(600);
      const gast2 = await neuerSpieler(server, PORT, 'Gast');
      await platz(gast2, 120, 120);
      check('premise: the reconnected guest has a NEW userId', gast2.peer.userId.toString() !== alteKennung, `${alteKennung} -> ${gast2.peer.userId}`);
      await hebeAuf(gast2, gbeute);
      check('after the reconnect the old loot is foreign: refused, stays', hatMeldung(gast2, SERVER_MELDUNG_BEUTE_FREMD) && !gbeute.destroyed && fleisch(gast2) === 0);
      boden.vorspulen(BEUTE_EXKLUSIV_MS + 1000);
      boden.tick(); // the server tick flips the window member that darfAufheben reads (no wait for the 30 Hz loop)
      await hebeAuf(gast2, gbeute);
      check('after the exclusive time the same guest (new identity) picks it up', gbeute.destroyed && fleisch(gast2) === 2, `${fleisch(gast2)}`);
      gast2.ws.close();
      await warte(300);
    }

    // ── [11] F2: the owner key does not go to any client ─────────
    console.log('\n[11] The owner key is not sent to clients');
    {
      await platz(alice, 100, 100);
      await platz(bob, 101, 100);
      const geheim = legeBeute(alice, 'RawMeat', 2, 100.5, 98);
      const besitzerKennung = geheim.getString(BEUTE_BESITZER);
      const hash = getStableHash(BEUTE_BESITZER);
      check('the member exists on the ZDO (the server still decides by it)', geheim.hasMember(hash) && besitzerKennung === alice.peer.userId.toString());
      // On the wire: everything Bob and Alice receive during the next seconds must not contain the key.
      bob.roh.length = 0;
      alice.roh.length = 0;
      geheim.setInt(BEUTE_MENGE, 3);
      geheim.revision.reviseData();
      geheim.dirty = true;
      for (let t = 0; t < 1500; t += 100) {
        sendInput(bob.ws, 0);
        sendInput(alice.ws, 0);
        await warte(100);
      }
      const bytes = Buffer.from(besitzerKennung, 'utf8');
      check('wire: Bob received packets (the sync ran)', bob.roh.length > 5, `${bob.roh.length} packets`);
      check('wire: no packet to Bob contains the owner key', !Buffer.concat(bob.roh).includes(bytes));
      // (Alice's own packets legitimately carry her userId as the owner of her figure, so the wire probe is Bob's.)
      check('wire: the sync did carry this loot ZDO to Bob (its item name "RawMeat" is in the packets)', Buffer.concat(bob.roh).includes(Buffer.from('RawMeat', 'utf8')));
      boden.vorspulen(BEUTE_LEBEN_MS + 1000);
      await warte(1200);
    }

    // ── [12] F4: the damage rules (overkill, tie, killing blow, tally cleanup, decay) ──
    console.log('\n[12] Damage rules');
    {
      // Overkill and tie: Alice 15 (axe), Bob 4+4+4 (hp 3 left) and an axe that kills (15, but only 3 count): 15 each.
      await platz(alice, 100, 100);
      await platz(bob, 101, 100);
      for (const s of [alice, bob]) s.peer.inventar.addItem(findItem('AxeFlint')!, 1); // the weapon must be in the inventory
      const zKuh = setzeKuh();
      await schlage(alice, 'AxeFlint');
      await schlage(bob, '');
      await schlage(bob, '');
      await schlage(bob, '');
      check('cow at 3 HP', zKuh.getInt(HEALTH_MEMBER) === 3, `HP ${zKuh.getInt(HEALTH_MEMBER)}`);
      await schlage(bob, 'AxeFlint');
      const bGleich = lootZDOs()[0];
      check('cow dead', zKuh.destroyed && !!bGleich);
      check('overkill does not count and the tie goes to the first to hit: owner = Alice (15 : 15, not 15 : 27)', bGleich?.getString(BEUTE_BESITZER) === alice.peer.userId.toString(), `owner "${bGleich?.getString(BEUTE_BESITZER)}", Alice "${alice.peer.userId}", Bob "${bob.peer.userId}"`);
      boden.vorspulen(BEUTE_LEBEN_MS + 1000);
      await warte(1200);

      // Killing blow counts: Alice 12 (3 fists), Bob 8 (2 fists) + the killing axe blow (10 left) = 18.
      const zKuh2 = setzeKuh();
      await schlage(alice, '');
      await schlage(alice, '');
      await schlage(alice, '');
      await schlage(bob, '');
      await schlage(bob, '');
      check('cow at 10 HP', zKuh2.getInt(HEALTH_MEMBER) === 10, `HP ${zKuh2.getInt(HEALTH_MEMBER)}`);
      await schlage(bob, 'AxeFlint');
      const bTod = lootZDOs()[0];
      check('the killing blow counts: owner = Bob (8 + 10 = 18 against 12)', zKuh2.destroyed && bTod?.getString(BEUTE_BESITZER) === bob.peer.userId.toString(), `owner "${bTod?.getString(BEUTE_BESITZER)}", Bob "${bob.peer.userId}"`);
      boden.vorspulen(BEUTE_LEBEN_MS + 1000);
      await warte(1200);
    }
    {
      // The tie rule is "first to hit", not the order of the keys and not the last to hit (unit level, both orders).
      const basis = boden.anzahlAnteile;
      const z1 = server.zdos.createZDO(KUH, { x: 30, y: 0, z: 30 });
      boden.schaden(z1, '111', 10);
      boden.schaden(z1, '222', 10);
      check('tie 10 : 10, "111" hit first: owner 111', boden.besitzer(z1) === '111');
      const z2 = server.zdos.createZDO(KUH, { x: 30, y: 0, z: 30 });
      boden.schaden(z2, '222', 10);
      boden.schaden(z2, '111', 10);
      boden.schaden(z2, '222', 0);
      check('tie 10 : 10, "222" hit first: owner 222 (first to hit, not key order)', boden.besitzer(z2) === '222');

      // The tally is gone right after the death (synchronously, before any tick can clean it).
      const vor = basis + 2;
      const z3 = server.zdos.createZDO(KUH, { x: 30, y: 0, z: 30 });
      boden.schaden(z3, '111', 5);
      check('a hit makes a tally', boden.anzahlAnteile === vor + 1, `${vor} -> ${boden.anzahlAnteile}`);
      server.zdos.destroyZDO(z1.zdoid);
      server.zdos.destroyZDO(z2.zdoid);
      boden.legeAb(server.zdos, z3, [{ name: 'RawMeat', amount: 1 }]);
      check('the death (legeAb) removes the tally at once, not with some later tick', boden.anzahlAnteile === vor, `${boden.anzahlAnteile}`);

      // A creature despawned without dying: the tick removes the tally.
      const z4 = server.zdos.createZDO(KUH, { x: 30, y: 0, z: 30 });
      boden.schaden(z4, '111', 5);
      server.zdos.destroyZDO(z4.zdoid);
      boden.vorspulen(1500);
      await warte(1200);
      check('despawn without death: the tick removes the tally (and those of the destroyed test creatures)', boden.anzahlAnteile === basis, `${boden.anzahlAnteile} (basis ${basis})`);

      // Decay: a living creature that got no more hits for 10 min loses its tally (the number is written out).
      const z5 = server.zdos.createZDO(KUH, { x: 30, y: 0, z: 30 });
      const vorDecay = basis;
      boden.schaden(z5, '111', 5);
      boden.vorspulen(590_000);
      await warte(1200);
      check('after 590 s without a hit the tally is still there', boden.anzahlAnteile === vorDecay + 1, `${boden.anzahlAnteile - vorDecay}`);
      boden.vorspulen(20_000);
      await warte(1200);
      check('after 610 s without a hit the tally is gone (the creature is alive)', !z5.destroyed && boden.anzahlAnteile === vorDecay, `${boden.anzahlAnteile - vorDecay}`);
      check('a hit again renews the clock: the tally of z5 is back and owner-able', (boden.schaden(z5, '333', 5), boden.besitzer(z5) === '333'));
      server.zdos.destroyZDO(z5.zdoid);
      boden.vorspulen(1500);
      await warte(1200);
    }

    // ── [13] Harvest, refund, craft, cooking: nothing vanishes at a full inventory ──
    const sendCraft = (s: Spieler, ergebnis: string): void => {
      const w = new Writer();
      w.writeString(ergebnis);
      s.ws.send(Buffer.concat([Buffer.from([PacketType.Craft]), w.toBuffer()]));
    };
    const sendAbriss = (s: Spieler, pos: Vector3): void => {
      const w = new Writer();
      w.writeVector3(pos);
      s.ws.send(Buffer.concat([Buffer.from([PacketType.RemovePiece]), w.toBuffer()]));
    };
    const fuelleVoll = (s: Spieler, vorweg: Array<[string, number]> = []): void => {
      leere(s);
      for (const [n, m] of vorweg) s.peer.inventar.addItem(findItem(n)!, m);
      fuelleMitStein(s);
    };
    const neueBeute = (vorher: Set<ZDO>): ZDO[] => lootZDOs().filter((l) => !vorher.has(l));

    console.log('\n[13a] Harvest with a full inventory: the yield lies on the ground, free for anybody');
    {
      await platz(alice, 100, 100);
      await platz(bob, 101, 100);
      fuelleVoll(alice, [['AxeFlint', 1]]);
      const baum = server.zdos.createZDO(getStableHash('Beech_small1'), { x: 102, y: server.heightmaps.getGroundHeight(102, 100), z: 100 });
      baum.setInt(HEALTH_MEMBER, 1);
      const vorher = new Set(lootZDOs());
      alice.meldungen.length = 0;
      await schlage(alice, 'AxeFlint');
      const holz = neueBeute(vorher).filter((l) => l.getString(BEUTE_ITEM) === 'Wood');
      const menge = holz[0]?.getInt(BEUTE_MENGE) ?? 0;
      check('the tree is felled', baum.destroyed);
      check('the Wood yield (6-10) lies on the ground as one piece without an owner', holz.length === 1 && menge >= 6 && menge <= 10 && holz[0]!.getString(BEUTE_BESITZER) === '', `${holz.length} piece(s), ${menge}×`);
      check('the piece lies at the player (< 1 m)', !!holz[0] && Math.hypot(holz[0].position.x - alice.peer.position.x, holz[0].position.z - alice.peer.position.z) < 1);
      check('the inventory got no Wood, the player is told "inventory full, N × Wood left behind"', alice.peer.inventar.countOf('Wood') === 0 && hatMeldung(alice, `@inventory.full_rest|{"item":"Wood","rest":${menge}}`), JSON.stringify(alice.meldungen));
      const holzBob = bob.peer.inventar.countOf('Wood');
      await hebeAuf(bob, holz[0]!);
      check('anybody can pick it up at once (Bob, a stranger)', holz[0]!.destroyed && bob.peer.inventar.countOf('Wood') === holzBob + menge, `${holzBob} -> ${bob.peer.inventar.countOf('Wood')}`);
      leere(alice);
      leere(bob);
    }

    console.log('\n[13b] Refund of a torn-down building piece at a full inventory');
    {
      await platz(alice, 100, 100);
      const teilDef = Object.values(PIECES).find((p) => p.bauPrefab && (p.resources ?? []).some((r) => Math.floor(r.amount / 2) > 0))!;
      const erwartet = (teilDef.resources ?? []).map((r) => ({ item: r.item, menge: Math.floor(r.amount / 2) })).filter((r) => r.menge > 0);
      fuelleVoll(alice);
      const stein0 = alice.peer.inventar.countOf('Stone');
      const stueck = server.zdos.createZDO(getStableHash(teilDef.bauPrefab!), { x: 102, y: server.heightmaps.getGroundHeight(102, 100), z: 100 });
      stueck.setInt('spieler', 1);
      stueck.setString('besitzer', alice.peer.userId.toString());
      const vorher = new Set(lootZDOs());
      alice.meldungen.length = 0;
      sendAbriss(alice, stueck.position);
      // poll instead of a fixed sleep (one run in four missed the 400 ms under load), then let the refund packets arrive
      for (let t = 0; t < 4000 && !stueck.destroyed; t += 50) await warte(50);
      await warte(300);
      const gelegt = neueBeute(vorher);
      const summe = (item: string): number => gelegt.filter((l) => l.getString(BEUTE_ITEM) === item).reduce((a, l) => a + l.getInt(BEUTE_MENGE), 0);
      check(`the piece "${teilDef.name}" is torn down`, stueck.destroyed);
      for (const r of erwartet) {
        // the inventory is full of full Stone stacks: nothing of any refund item fits
        check(`refund ${r.menge}× ${r.item} lies on the ground, free (none of it vanished)`, summe(r.item) === r.menge, `${summe(r.item)}`);
      }
      check('every refund piece has no owner', gelegt.length > 0 && gelegt.every((l) => l.getString(BEUTE_BESITZER) === ''));
      check('the inventory did not grow, the player is told "inventory full"', alice.peer.inventar.countOf('Stone') === stein0 && alice.meldungen.some((m) => m.text.startsWith('@inventory.full_rest|')), JSON.stringify(alice.meldungen));
      leere(alice);
      boden.vorspulen(BEUTE_LEBEN_MS + 1000);
      await warte(1200);
    }

    console.log('\n[13c] Craft with a full inventory: refused, the ingredients stay; when the ingredients free the room, it is made');
    {
      fuelleVoll(alice, [['Wood', 12]]);
      alice.meldungen.length = 0;
      sendCraft(alice, 'Club'); // 6 Wood -> Club (1 slot); Wood 12 leaves a stack behind, so no slot is free
      await warte(300);
      check('craft refused with "inventory full"', alice.meldungen.some((m) => !m.ok && m.text === '@inventory.full'), JSON.stringify(alice.meldungen));
      check('the ingredients stay (Wood 12), no Club', alice.peer.inventar.countOf('Wood') === 12 && alice.peer.inventar.countOf('Club') === 0, `Wood ${alice.peer.inventar.countOf('Wood')}, Club ${alice.peer.inventar.countOf('Club')}`);
      fuelleVoll(alice, [['Wood', 6]]);
      alice.meldungen.length = 0;
      sendCraft(alice, 'Club'); // the 6 Wood are a whole stack: taking them out frees the slot for the Club
      await warte(300);
      check('when the ingredients free a slot the Club is made', alice.peer.inventar.countOf('Club') === 1 && alice.peer.inventar.countOf('Wood') === 0 && alice.meldungen.some((m) => m.ok && /Hergestellt/.test(m.text)), `Club ${alice.peer.inventar.countOf('Club')}, Wood ${alice.peer.inventar.countOf('Wood')}`);
      leere(alice);
    }

    console.log('\n[13d] Cooking with a full inventory: refused, the raw meat stays');
    {
      await platz(alice, 100, 100);
      const feuer = server.zdos.createZDO(getStableHash('fire_pit'), { x: 101, y: server.heightmaps.getGroundHeight(101, 100), z: 100 });
      fuelleVoll(alice, [['RawMeat', 5]]);
      await hebeAuf(alice, feuer);
      check('cooking refused with "inventory full"', alice.meldungen.some((m) => !m.ok && m.text === '@inventory.full'), JSON.stringify(alice.meldungen));
      check('the raw meat stays (5), no cooked meat', fleisch(alice) === 5 && alice.peer.inventar.countOf('CookedMeat') === 0, `raw ${fleisch(alice)}, cooked ${alice.peer.inventar.countOf('CookedMeat')}`);
      fuelleVoll(alice, [['RawMeat', 1]]);
      await hebeAuf(alice, feuer);
      check('the last raw meat frees its slot: it is cooked', fleisch(alice) === 0 && alice.peer.inventar.countOf('CookedMeat') === 1, `raw ${fleisch(alice)}, cooked ${alice.peer.inventar.countOf('CookedMeat')}`);
      leere(alice);
      server.zdos.destroyZDO(feuer.zdoid);
    }

    // ── [14] N1-b: the room question (`passtNachEntnahme`) against the real remove + addItem ──
    console.log('\n[14] passtNachEntnahme against the real removeByName + addItem on 3,000 random inventories');
    {
      let s = 987654321;
      const zufall = (): number => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const ganz = (n: number): number => Math.floor(zufall() * n);
      const NAMEN = ['Stone', 'Wood', 'RawMeat', 'CookedMeat', 'AxeFlint', 'Club', 'TrophyEikthyr', 'Flint'];
      // the same inventory twice from one recipe: one for the function (which copies), one for the real sequence
      // `roh`: kept raw stacks (a data item nobody knows at the moment, an unusable known one) on cells of their own, put in
      // BEFORE the stacks like a login does; they take cells from the grid, which the real addItem respects
      const baue = (rezept: Array<[string, number, number]>, roh: Array<[string, number, number, number]> = []): Inventory => {
        const inv = new Inventory();
        for (const [n, menge, x, y] of roh) inv.verwahreStapel({ name: n, stack: menge, durability: 0, quality: 1, gridX: x, gridY: y, equipped: false });
        for (const [n, menge, qualitaet] of rezept) inv.addItem(findItem(n)!, menge, qualitaet);
        return inv;
      };
      let passt = 0;
      let passtNicht = 0;
      let abweichungen = 0;
      let mitRoh = 0;
      let erstes = '';
      for (let i = 0; i < 3000; i++) {
        const rezept: Array<[string, number, number]> = [];
        const dichte = zufall();
        for (let k = 0; k < 4 + ganz(Math.round(40 * dichte) + 1); k++) rezept.push([NAMEN[ganz(NAMEN.length)]!, 1 + ganz(60), 1 + ganz(2)]);
        const entfernen = Array.from({ length: ganz(4) }, () => ({ item: NAMEN[ganz(NAMEN.length)]!, menge: 1 + ganz(30) }));
        const ergebnis = NAMEN[ganz(NAMEN.length)]!;
        const menge = 1 + ganz(6);
        const roh: Array<[string, number, number, number]> = [];
        if (zufall() < 0.5) for (let k = 0, n = 1 + ganz(Math.round(30 * dichte) + 1); k < n; k++) roh.push([zufall() < 0.7 ? 'DatenAxtUnbekannt' : 'Wood', zufall() < 0.7 ? 1 + ganz(9) : 0, ganz(8), ganz(4)]);
        if (roh.length > 0) mitRoh++;
        const antwort = passtNachEntnahme(baue(rezept, roh), entfernen, ergebnis, menge);
        const echt = baue(rezept, roh);
        for (const z of entfernen) echt.removeByName(z.item, z.menge);
        const wirklich = echt.addItem(findItem(ergebnis)!, menge) === 0;
        if (antwort !== wirklich) {
          abweichungen++;
          if (!erstes) erstes = JSON.stringify({ rezept, roh, entfernen, ergebnis, menge, antwort, wirklich });
        }
        if (wirklich) passt++;
        else passtNicht++;
      }
      check(`3000 inventories: the answer equals the real addItem in every case`, abweichungen === 0, `${abweichungen} deviation(s) ${erstes}`);
      check('about half of the inventories held kept raw stacks (the generator covers them)', mitRoh > 1200 && mitRoh < 1800, `${mitRoh} of 3000`);
      check('both outcomes occurred (the comparison is not one-sided)', passt > 300 && passtNicht > 300, `fits ${passt}, does not fit ${passtNicht}`);
    }

    // ── [15] Names in the messages: every creature and item of the drop tables has a name in both catalogues ──
    console.log('\n[15] Name keys of the creatures and items in the loot tables (de and en)');
    {
      const katalog = (sprache: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, `../../client/src/i18n/katalog/${sprache}.json`), 'utf8'));
      const de = katalog('de');
      const en = katalog('en');
      const kreaturen = ['Eikthyr', 'Greyling', 'Greydwarf', 'Boar', 'Deer', 'Kuh', 'Wolf', 'Huhn', 'Neck', 'Skeleton', 'Draugr'];
      const dinge = new Set<string>(['CookedMeat', 'Amber', 'Flint', 'Mushroom', 'Blueberries', 'Raspberry', 'Thistle', 'Dandelion', 'Carrot']);
      for (const k of kreaturen) {
        for (let i = 0; i < 300; i++) {
          const d = wuerfleDrop(k);
          if (d) dinge.add(d.name);
        }
        const z = ZWEIT_DROPS[k];
        if (z) dinge.add(z[0]);
      }
      const fehlt = [...kreaturen, ...dinge].filter((n) => !de[`beute.name.${n}`] || !en[`beute.name.${n}`]);
      check(`${kreaturen.length} creatures and ${dinge.size} items all have beute.name.* in de and en`, fehlt.length === 0, `missing: ${fehlt.join(', ')}`);
    }

    // ── [6] Restart: no loot back, the saved chest is ────────────
    console.log('\n[6] Restart: loot is not saved (no doubling), a chest is');
    const truhe = server.zdos.createZDO(getStableHash('piece_chest_wood'), { x: 60, y: 0, z: 60 });
    truhe.setInt('kontrolle', 7);
    alice.peer.inventar.addItem(findItem('AxeFlint')!, 1); // [8]-[13] emptied her inventory
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
