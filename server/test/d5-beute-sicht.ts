/**
 * D5 N2 — what a client learns of the owner of loot, and that loot never lingers as a ghost.
 *
 * Real server, real WebSocket clients, the real client parser (`parseZDOSync`), like `g7-zdo-interessen.ts`.
 *
 *  [1] Z1: loot of Alice reaches Bob as "foreign" (`beuteFremd`) and Alice as "mine"; the owner key itself is not on the wire
 *      (the member `beute_besitzer`), the tag member is. Loot without an owner is foreign to nobody.
 *  [2] Z1: when the exclusive window is over, the server flips `beute_exklusiv` to 0 (a delta) and Bob's client sees "not foreign"
 *      without any clock of its own.
 *  [3] Z2: the destroy of a loot ZDO reaches a player who is far outside the interest window (the list goes to every peer of the
 *      world, not to those who see the piece). So a client never keeps a loot target that the server has already removed.
 *  [4] The registry half without a socket: members at `legeAb` / `legeHin`, the flip in `tick`, nothing for ownerless loot.
 *
 * Run: npx tsx server/test/d5-beute-sicht.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { BEUTE_EXKLUSIV_MS, BEUTE_LEBEN_MS, beuteBesitzerTag, getStableHash } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { BEUTE_BESITZER, BEUTE_BESITZER_TAG, BEUTE_EXKLUSIV, BeuteAmBoden } from '../src/spiel/BeuteAmBoden.js';
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

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
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

/** One client: the real parser, the last update of every key, every destroyed key, the raw packets. */
interface Klient {
  ws: WebSocket;
  eigene: string;
  zuletzt: Map<string, ZDOEntityUpdate>;
  zerstoert: Set<string>;
  roh: Buffer[];
}
async function klient(server: ReturnType<typeof createWovServer>, name: string): Promise<Klient> {
  const ws = await verbinde(name);
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

/** The wire bytes of a member header: hash, type tag. */
const kopf = (name: string, typ: number): Buffer => {
  const w = new Writer(8);
  w.writeInt32(getStableHash(name));
  w.writeUInt8(typ);
  return w.toBuffer();
};

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
    check('owned loot: exclusive 1 and the tag of the owner key', mit.getInt(BEUTE_EXKLUSIV) === 1 && mit.getInt(BEUTE_BESITZER_TAG) === beuteBesitzerTag('4711'), `${mit.getInt(BEUTE_EXKLUSIV)} / ${mit.getInt(BEUTE_BESITZER_TAG)}`);
    check('the tag differs from the tag of another key', mit.getInt(BEUTE_BESITZER_TAG) !== beuteBesitzerTag('4712'));
    check('ownerless loot carries neither member', !ohne.hasMember(getStableHash(BEUTE_EXKLUSIV)) && !ohne.hasMember(getStableHash(BEUTE_BESITZER_TAG)));
    const revVorher = mit.revision.dataRevision;
    boden.tick();
    check('before the window ends the tick leaves exclusive at 1 (and the revision alone)', mit.getInt(BEUTE_EXKLUSIV) === 1 && mit.revision.dataRevision === revVorher);
    boden.vorspulen(BEUTE_EXKLUSIV_MS - 5000); // the wall clock runs on a little between the calls: keep a margin
    boden.tick();
    check('5 s before the end: still exclusive', mit.getInt(BEUTE_EXKLUSIV) === 1);
    boden.vorspulen(6000);
    boden.tick();
    check('after the window the tick flips exclusive to 0 and revises the data (a delta goes out)', mit.getInt(BEUTE_EXKLUSIV) === 0 && mit.revision.dataRevision > revVorher && mit.dirty);
    check('the tag stays (the client needs nothing more)', mit.getInt(BEUTE_BESITZER_TAG) === beuteBesitzerTag('4711'));
    check('the server decision is unchanged: the owner member is still there', mit.getString(BEUTE_BESITZER) === '4711');
    const rev2 = mit.revision.dataRevision;
    boden.vorspulen(1000);
    boden.tick();
    check('flipped once, not at every tick', mit.revision.dataRevision === rev2);
    check('ownerless loot is untouched by the flip (no member appears)', !ohne.hasMember(getStableHash(BEUTE_EXKLUSIV)));
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
    check('Alice: her loot is not foreign', a1?.beuteFremd === false && a1.beuteExklusiv === 1, `${a1?.beuteFremd} / ${a1?.beuteExklusiv}`);
    check('Bob: the same loot is foreign', b1?.beuteFremd === true && b1.beuteExklusiv === 1, `${b1?.beuteFremd} / ${b1?.beuteExklusiv}`);
    check('Bob got the tag of Alice (the hash, which he can compare)', b1?.beuteTag === beuteBesitzerTag(alice.eigene), String(b1?.beuteTag));
    check('ownerless loot is foreign to nobody', bob.zuletzt.get(holzSchluessel)?.beuteFremd === false && alice.zuletzt.get(holzSchluessel)?.beuteFremd === false);
    const bobBytes = Buffer.concat(bob.roh);
    check('wire: the owner member `beute_besitzer` (string) never reached Bob', !bobBytes.includes(kopf(BEUTE_BESITZER, 5)));
    check('wire: the exclusive and tag members did reach Bob', bobBytes.includes(kopf(BEUTE_EXKLUSIV, 3)) && bobBytes.includes(kopf(BEUTE_BESITZER_TAG, 3)));

    console.log('\n[2] The window ends');
    bob.zerstoert.clear();
    boden.vorspulen(BEUTE_EXKLUSIV_MS + 1000);
    const ok2 = await bis(() => bob.zuletzt.get(schluessel)?.beuteFremd === false, 3000);
    check('Bob: after the window the same piece is not foreign any more (delta from the server, no client clock)', ok2 && bob.zuletzt.get(schluessel)?.beuteExklusiv === 0, `${bob.zuletzt.get(schluessel)?.beuteFremd}`);
    check('Alice: unchanged, not foreign', alice.zuletzt.get(schluessel)?.beuteFremd === false);

    console.log('\n[3] Destroy reaches a player outside the window');
    sendAdmin(bob.ws, 'teleport 3000 3000');
    await warte(600);
    bob.zerstoert.clear();
    alice.zerstoert.clear();
    check('premise: Bob is far away (more than 256 m): the piece is outside his window', Math.hypot(server.net.getPeers().find((p) => p.name === 'Bob')!.position.x - 0, server.net.getPeers().find((p) => p.name === 'Bob')!.position.z - 2) > 1000);
    boden.vorspulen(BEUTE_LEBEN_MS);
    const ok3 = await bis(() => bob.zerstoert.has(schluessel) && alice.zerstoert.has(schluessel), 4000);
    check('the loot is destroyed on the server', stueck.destroyed);
    check('Bob, 4 km away, still got the destroy of the piece (so his client forgets the target)', ok3 && bob.zerstoert.has(schluessel), [...bob.zerstoert].join(','));
    check('Alice, standing next to it, got it too', alice.zerstoert.has(schluessel));

    alice.ws.close();
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
