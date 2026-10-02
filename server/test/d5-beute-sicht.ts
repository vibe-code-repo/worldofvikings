/**
 * D5 N2/N3 — what a client learns of the owner of loot, and that loot never lingers as a ghost.
 *
 * Real server, real WebSocket clients, the real client parser (`parseZDOSync`), like `g7-zdo-interessen.ts`.
 *
 *  [1] Z1/B1: loot of Alice reaches Bob as "foreign" (`beuteFremd`) and Alice as "mine". The member `beute_exklusiv` goes to Bob
 *      and NOT to Alice (the owner); nothing of Alice's identity is in Bob's packets: not her userId as text, not as a number, not
 *      the hash that N2 sent as a tag, and of the members of the loot ZDO exactly the owner key is held back (every member is
 *      checked on the wire). Loot without an owner is foreign to nobody.
 *  [2] Z1: when the exclusive window is over, the server flips `beute_exklusiv` to 0 (a delta) and Bob's client sees "not foreign"
 *      without any clock of its own. The piece is pickable for both.
 *  [5] Reconnect: Alice comes back with her session token (same userId): her piece is still hers (pickable, not foreign), Bob's
 *      view is unchanged. A guest's new identity is another owner (the server refuses and the client was never told otherwise).
 *  [3] Z2: the destroy of a loot ZDO reaches a player who is far outside the interest window (the list goes to every peer of the
 *      world, not to those who see the piece). So a client never keeps a loot target that the server has already removed.
 *  [4] The registry half without a socket: members at `legeAb` / `legeHin`, the flip in `tick`, nothing for ownerless loot; B3: the
 *      flip happens exactly at `beute_frei_ab` (a fixed clock, 1 ms before / on / after, and one tick = 1 s either side), the same
 *      instant at which `darfAufheben` turns true.
 *
 * Run: npx tsx server/test/d5-beute-sicht.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { BEUTE_EXKLUSIV_MS, BEUTE_LEBEN_MS, getStableHash } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { BEUTE_BESITZER, BEUTE_EXKLUSIV, BeuteAmBoden } from '../src/spiel/BeuteAmBoden.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';
import type { ZDOEntityUpdate } from '../../client/src/net/ZDOSync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d5-beute-sicht');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, ZDOSync: 10, AdminCommand: 53, AuthChallenge: 68 };

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};

/** The socket and the session token the server handed out (PeerInfo, 4th field): a second login with it gets the same userId. */
type Verbindung = WebSocket & { token?: string };
function verbinde(name: string, token = ''): Promise<Verbindung> {
  return new Promise((resolvePromise, reject) => {
    const ws: Verbindung = new WebSocket(`ws://127.0.0.1:${PORT}`);
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
        w.writeString(token);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        reader.readString(); reader.readString(); reader.readString(); // name, userId, server name
        ws.token = reader.readString();
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

/** One client: the real parser, the last update of every key, every destroyed key, the raw packets. */
interface Klient {
  ws: Verbindung;
  eigene: string;
  zuletzt: Map<string, ZDOEntityUpdate>;
  zerstoert: Set<string>;
  roh: Buffer[];
}
async function klient(server: ReturnType<typeof createWovServer>, name: string, token = ''): Promise<Klient & { ws: Verbindung }> {
  const ws = await verbinde(name, token);
  const peer = server.net.getPeers().find((p) => p.name === name)!;
  const k: Klient = { ws, eigene: peer.userId.toString(), zuletzt: new Map(), zerstoert: new Set(), roh: [] };
  const spiegel = new ZDOSpiegel();
  ws.on('message', (data: Buffer) => {
    if (data.readUInt8(0) !== P.ZDOSync) return;
    k.roh.push(Buffer.from(data));
    const { updates, destroyed } = parseZDOSync(new BinaryReader(data.buffer, data.byteOffset + 1), k.eigene, spiegel);
    for (const u of updates) k.zuletzt.set(u.key, u);
    for (const d of destroyed) k.zerstoert.add(d);
  });
  return k;
}

async function main(): Promise<void> {
  // [4] registry half, no socket
  console.log('[4] BeuteAmBoden members');
  {
    const raum = new ZDOManager(1n);
    const boden = new BeuteAmBoden();
    const kuh = raum.createZDO(getStableHash('Kuh'), { x: 0, y: 0, z: 0 });
    boden.schaden(kuh, '4711', 10);
    boden.legeAb(raum, kuh, [{ name: 'RawMeat', amount: 1 }]);
    boden.legeHin(raum, { x: 1, y: 0, z: 1 }, [{ name: 'Wood', amount: 1 }]);
    const mit = raum.getZDOByPrefab(getStableHash('RawMeat'))[0]!;
    const ohne = raum.getZDOByPrefab(getStableHash('Wood'))[0]!;
    check('owned loot: exclusive 1', mit.getInt(BEUTE_EXKLUSIV) === 1, `${mit.getInt(BEUTE_EXKLUSIV)}`);
    check('B1: no tag member (nothing derived from the owner key is stored for the client)', !mit.hasMember(getStableHash('beute_besitzer_tag')));
    check('B1: of the members of owned loot only the owner key and the exclusive flag can name the owner, and the flag is just 0/1', [...mit.getMembers().keys()].length === 7, String([...mit.getMembers().keys()].length));
    check('ownerless loot carries no exclusive member', !ohne.hasMember(getStableHash(BEUTE_EXKLUSIV)));
    const revVorher = mit.revision.dataRevision;
    boden.tick();
    check('before the window ends the tick leaves exclusive at 1 (and the revision alone)', mit.getInt(BEUTE_EXKLUSIV) === 1 && mit.revision.dataRevision === revVorher);
    boden.vorspulen(BEUTE_EXKLUSIV_MS - 5000); // the wall clock runs on a little between the calls: keep a margin
    boden.tick();
    check('5 s before the end: still exclusive', mit.getInt(BEUTE_EXKLUSIV) === 1);
    boden.vorspulen(6000);
    boden.tick();
    check('after the window the tick flips exclusive to 0 and revises the data (a delta goes out)', mit.getInt(BEUTE_EXKLUSIV) === 0 && mit.revision.dataRevision > revVorher && mit.dirty);
    check('the server decision is unchanged: the owner member is still there', mit.getString(BEUTE_BESITZER) === '4711');
    const rev2 = mit.revision.dataRevision;
    boden.vorspulen(1000);
    boden.tick();
    check('flipped once, not at every tick', mit.revision.dataRevision === rev2);
    check('ownerless loot is untouched by the flip (no member appears)', !ohne.hasMember(getStableHash(BEUTE_EXKLUSIV)));
  }

  // B3: the flip and the server's decision turn at the SAME instant, `beute_frei_ab`, and not a tick or a millisecond later.
  console.log('[4b] The window ends exactly at beute_frei_ab');
  {
    const T0 = 1_800_000_000_000;
    const probe = (t: number): { exklusiv: number; frei: boolean; fremdFrei: boolean } => {
      const raum = new ZDOManager(1n);
      const boden = new BeuteAmBoden();
      (boden as unknown as { jetzt: () => number }).jetzt = () => T0; // a fixed clock: the wall clock cannot blur the border
      const kuh = raum.createZDO(getStableHash('Kuh'), { x: 0, y: 0, z: 0 });
      boden.schaden(kuh, '4711', 10);
      boden.legeAb(raum, kuh, [{ name: 'RawMeat', amount: 1 }]);
      const z = raum.getZDOByPrefab(getStableHash('RawMeat'))[0]!;
      (boden as unknown as { jetzt: () => number }).jetzt = () => T0 + t;
      boden.tick();
      return { exklusiv: z.getInt(BEUTE_EXKLUSIV), frei: boden.darfAufheben(z, '4712'), fremdFrei: boden.darfAufheben(z, '4711') };
    };
    const E = BEUTE_EXKLUSIV_MS;
    for (const [t, exklusiv, frei, name] of [
      [E - 1000, 1, false, 'one tick (1 s) before the end'],
      [E - 1, 1, false, '1 ms before the end'],
      [E, 0, true, 'exactly at the end'],
      [E + 1, 0, true, '1 ms after the end'],
      [E + 1000, 0, true, 'one tick (1 s) after the end'],
    ] as const) {
      const r = probe(t);
      check(`${name}: the member is ${exklusiv} and a stranger ${frei ? 'may' : 'may not'} pick up`, r.exklusiv === exklusiv && r.frei === frei && r.fremdFrei, JSON.stringify(r));
    }
  }

  // N5-Z2: the server decides from the member the clients see (`beute_exklusiv`), and the member flips at the first tick at or after the end, not once a second.
  console.log('[4c] Server and client read the same state at the end of the window');
  {
    const T0 = 1_800_000_000_000;
    const E = BEUTE_EXKLUSIV_MS;
    const neu = () => {
      const raum = new ZDOManager(1n);
      const boden = new BeuteAmBoden();
      const uhr = { t: T0 };
      (boden as unknown as { jetzt: () => number }).jetzt = () => uhr.t;
      const kuh = raum.createZDO(getStableHash('Kuh'), { x: 0, y: 0, z: 0 });
      boden.schaden(kuh, '4711', 10);
      boden.legeAb(raum, kuh, [{ name: 'RawMeat', amount: 1 }]);
      return { boden, uhr, z: raum.getZDOByPrefab(getStableHash('RawMeat'))[0]! };
    };
    {
      const { boden, uhr, z } = neu();
      uhr.t = T0 + E; // the clock is past the end, no tick yet: the member still says 1, so the server does not free it either
      check('clock at the end, no tick yet: member 1 and a stranger may not yet (same state for both)', z.getInt(BEUTE_EXKLUSIV) === 1 && !boden.darfAufheben(z, '4712'));
      boden.tick();
      check('... after the next tick: member 0 and a stranger may', z.getInt(BEUTE_EXKLUSIV) === 0 && boden.darfAufheben(z, '4712'));
    }
    {
      const { boden, uhr, z } = neu();
      let verschieden = 0;
      let kippt = -1;
      for (let t = E - 40; t <= E + 40; t++) { // every millisecond around the end, a tick each (the real loop ticks every 33 ms)
        uhr.t = T0 + t;
        boden.tick();
        const client = z.getInt(BEUTE_EXKLUSIV) === 0; // what a client reads (not foreign)
        const server = boden.darfAufheben(z, '4712');
        if (client !== server) verschieden++;
        if (client && kippt < 0) kippt = t;
      }
      check('1 ms steps around the end: server and client never judge differently', verschieden === 0, String(verschieden));
      check('... and the member flips at the first tick at or after the end (t = E)', kippt === E, String(kippt - E));
    }
    {
      const { boden, uhr, z } = neu();
      uhr.t = T0 + E - 1;
      boden.tick(); // the once-a-second housekeeping ran 1 ms before the end
      uhr.t = T0 + E;
      boden.tick(); // 1 ms later: the flip must not wait for the next second
      check('a tick 1 ms after another one flips at once (the flip is not throttled to once a second)', z.getInt(BEUTE_EXKLUSIV) === 0 && boden.darfAufheben(z, '4712'));
    }
    {
      const { boden, uhr, z } = neu();
      uhr.t = T0 + E - 1;
      boden.tick();
      check('the owner may at any time, a stranger not before the end', boden.darfAufheben(z, '4711') && !boden.darfAufheben(z, '4712'));
    }
  }

  const server = createWovServer({ port: 0, everyoneAdmin: true, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'd5-beute-sicht', saveIntervalMs: 3600_000 });
  server.start();
  PORT = portVon(server);
  try {
    const alice = await klient(server, 'Alice');
    const bob = await klient(server, 'Bob');
    sendAdmin(alice.ws, 'teleport 0 0');
    sendAdmin(bob.ws, 'teleport 3 0');
    await warte(400);
    const boden = server.beuteAmBoden;
    const kuh = server.zdos.createZDO(getStableHash('Kuh'), { x: 0, y: 0, z: 2 });
    boden.schaden(kuh, alice.eigene, 20);
    boden.legeAb(server.zdos, kuh, [{ name: 'RawMeat', amount: 2 }]);
    const stueck = server.zdos.getZDOByPrefab(getStableHash('RawMeat')).find((z) => boden.istBeute(z))!;
    const frei = boden.legeHin(server.zdos, { x: 1, y: 0, z: 2 }, [{ name: 'Wood', amount: 1 }]);
    const holz = server.zdos.getZDOByPrefab(getStableHash('Wood')).find((z) => boden.istBeute(z))!;
    const schluessel = stueck.zdoid.toString();
    const holzSchluessel = holz.zdoid.toString();

    console.log('\n[1] Foreign / mine on the wire');
    check('premise: a piece was laid and the free piece too', !!stueck && frei.length === 1);
    await bis(() => !!alice.zuletzt.get(schluessel) && !!bob.zuletzt.get(schluessel) && !!bob.zuletzt.get(holzSchluessel), 3000);
    const a1 = alice.zuletzt.get(schluessel);
    const b1 = bob.zuletzt.get(schluessel);
    check('Alice: her loot is not foreign, and she never got the exclusive member at all', a1?.beuteFremd === false && a1.beuteExklusiv === undefined, `${a1?.beuteFremd} / ${a1?.beuteExklusiv}`);
    check('Bob: the same loot is foreign', b1?.beuteFremd === true && b1.beuteExklusiv === 1, `${b1?.beuteFremd} / ${b1?.beuteExklusiv}`);
    check('ownerless loot is foreign to nobody', bob.zuletzt.get(holzSchluessel)?.beuteFremd === false && alice.zuletzt.get(holzSchluessel)?.beuteFremd === false);
    check('server decision: Alice may pick her piece up now, Bob may not', server.beuteAmBoden.darfAufheben(stueck, alice.eigene) && !server.beuteAmBoden.darfAufheben(stueck, bob.eigene));
    // B1, every member of the loot ZDO on the wire: which header (hash + type) reached whom.
    const bobBytes = Buffer.concat(bob.roh);
    const aliceBytes = Buffer.concat(alice.roh);
    const tags = (bytes: Buffer): Record<string, boolean> => {
      const r: Record<string, boolean> = {};
      for (const [hash, m] of stueck.getMembers()) {
        const w = new Writer(8);
        w.writeInt32(hash);
        w.writeUInt8(m.type);
        r[String(hash)] = bytes.includes(w.toBuffer());
      }
      return r;
    };
    const mitglieder = [...stueck.getMembers().keys()];
    const kennt = (name: string): number => mitglieder.find((h) => h === getStableHash(name)) ?? NaN;
    const bobSieht = tags(bobBytes);
    const aliceSieht = tags(aliceBytes);
    const sichtbar = ['beute', 'beute_item', 'beute_menge', 'beute_frei_ab', 'beute_ablauf'];
    check('B1: every member of the loot ZDO is accounted for (7 members)', mitglieder.length === 7 && mitglieder.every((h) => [...sichtbar, 'beute_exklusiv', BEUTE_BESITZER].map(getStableHash).includes(h)), String(mitglieder.length));
    check('B1: Bob received the five plain members and the exclusive flag', sichtbar.every((n) => bobSieht[String(kennt(n))]) && bobSieht[String(kennt(BEUTE_EXKLUSIV))] === true);
    check('B1: Alice received the five plain members but NOT the exclusive flag', sichtbar.every((n) => aliceSieht[String(kennt(n))]) && aliceSieht[String(kennt(BEUTE_EXKLUSIV))] === false);
    check('B1: the owner key `beute_besitzer` reached neither of them', bobSieht[String(kennt(BEUTE_BESITZER))] === false && aliceSieht[String(kennt(BEUTE_BESITZER))] === false);
    check('B1: Bob received exactly those six members and nothing else of this ZDO (no seventh header)', Object.values(bobSieht).filter(Boolean).length === 6);
    // Nothing of Alice's identity in Bob's packets: her userId as text, as a 32-bit number (both byte orders), and the hash that N2 sent as the "tag".
    const userId = alice.eigene;
    const zahl = Number(userId);
    const le = Buffer.alloc(4); le.writeInt32LE(zahl | 0);
    const be = Buffer.alloc(4); be.writeInt32BE(zahl | 0);
    const hashLe = Buffer.alloc(4); hashLe.writeInt32LE(getStableHash(userId));
    const hashBe = Buffer.alloc(4); hashBe.writeInt32BE(getStableHash(userId));
    check('B1: premise: the probe values are real (a userId that is a number)', Number.isInteger(zahl) && zahl > 0);
    check('B1: Alice\'s userId as text is not in any packet Bob got', !bobBytes.includes(Buffer.from(userId)));
    check('B1: Alice\'s userId as a number (little and big endian) is not in any packet Bob got', !bobBytes.includes(le) && !bobBytes.includes(be));
    check('B1: nor the hash of the userId (the N2 tag) in either byte order', !bobBytes.includes(hashLe) && !bobBytes.includes(hashBe));
    check('B1: premise of the search: Alice\'s own packets do carry her key (her character ZDO), so the search can find it', aliceBytes.includes(Buffer.from(userId)));

    // A delta that carries NO member (the piece was pushed): the client must keep the state from the full set it had.
    stueck.position = { x: 0.5, y: 0, z: 2.5 };
    stueck.revision.reviseData();
    stueck.dirty = true;
    const bewegt = await bis(() => bob.zuletzt.get(schluessel)?.position.x === 0.5 && alice.zuletzt.get(schluessel)?.position.x === 0.5, 3000);
    check('a position-only delta reached both clients (premise)', bewegt);
    check('after the position-only delta the loot is still foreign for Bob and mine for Alice (state kept from the full set)', bob.zuletzt.get(schluessel)?.beuteFremd === true && alice.zuletzt.get(schluessel)?.beuteFremd === false && alice.zuletzt.get(schluessel)?.beuteExklusiv === undefined && bob.zuletzt.get(schluessel)?.beuteExklusiv === 1);

    console.log('\n[5] Reconnect with the session token');
    const token = alice.ws.token ?? '';
    check('premise: the server handed Alice a session token', token.length > 10, String(token.length));
    alice.ws.close();
    await bis(() => !server.net.getPeers().some((p) => p.name === 'Alice'), 3000);
    const alice2 = await klient(server, 'Alice', token);
    check('same userId after the reconnect (the owner key still fits)', alice2.eigene === alice.eigene, `${alice2.eigene} / ${alice.eigene}`);
    sendAdmin(alice2.ws, 'teleport 0 0');
    const da = await bis(() => !!alice2.zuletzt.get(schluessel), 4000);
    check('Alice sees her piece again after the reconnect', da);
    check('... and it is still hers: not foreign, no exclusive member sent, the server lets her pick it up', alice2.zuletzt.get(schluessel)?.beuteFremd === false && alice2.zuletzt.get(schluessel)?.beuteExklusiv === undefined && server.beuteAmBoden.darfAufheben(stueck, server.net.getPeers().find((p) => p.name === 'Alice')!.userId.toString()));
    check('... Bob still sees it as foreign', bob.zuletzt.get(schluessel)?.beuteFremd === true);
    check('B1: the reconnect did not hand Bob anything of Alice\'s identity either', !Buffer.concat(bob.roh).includes(Buffer.from(alice.eigene)));

    console.log('\n[2] The window ends');
    bob.zerstoert.clear();
    boden.vorspulen(BEUTE_EXKLUSIV_MS + 1000);
    const ok2 = await bis(() => bob.zuletzt.get(schluessel)?.beuteFremd === false, 3000);
    check('Bob: after the window the same piece is not foreign any more (delta from the server, no client clock)', ok2 && bob.zuletzt.get(schluessel)?.beuteExklusiv === 0, `${bob.zuletzt.get(schluessel)?.beuteFremd}`);
    check('Alice: unchanged, not foreign', alice2.zuletzt.get(schluessel)?.beuteFremd === false && alice2.zuletzt.get(schluessel)?.beuteExklusiv === undefined);
    check('after the window both may pick it up (server decision)', server.beuteAmBoden.darfAufheben(stueck, bob.eigene) && server.beuteAmBoden.darfAufheben(stueck, alice.eigene));

    console.log('\n[3] Destroy reaches a player outside the window');
    sendAdmin(bob.ws, 'teleport 3000 3000');
    await warte(600);
    bob.zerstoert.clear();
    alice2.zerstoert.clear();
    check('premise: Bob is far away (more than 256 m): the piece is outside his window', Math.hypot(server.net.getPeers().find((p) => p.name === 'Bob')!.position.x - 0, server.net.getPeers().find((p) => p.name === 'Bob')!.position.z - 2) > 1000);
    boden.vorspulen(BEUTE_LEBEN_MS);
    const ok3 = await bis(() => bob.zerstoert.has(schluessel) && alice2.zerstoert.has(schluessel), 4000);
    check('the loot is destroyed on the server', stueck.destroyed);
    check('Bob, 4 km away, still got the destroy of the piece (so his client forgets the target)', ok3 && bob.zerstoert.has(schluessel), [...bob.zerstoert].join(','));
    check('Alice, standing next to it, got it too', alice2.zerstoert.has(schluessel));

    alice2.ws.close();
    bob.ws.close();
    console.log(failures === 0 ? '\nd5-beute-sicht: OK' : `\nd5-beute-sicht: ${failures} FAIL`);
  } catch (err) {
    console.error('FAIL:', err);
    failures++;
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}
main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
