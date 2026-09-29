/**
 * Combat core K2a: the server knows the CARRIED weapon, over the REAL packet path.
 *
 * Two real WebSocket players (Anna, Bernd), one server, real Equip / EquipStand / Attack /
 * ContainerAction packets. Damage is measured on a creature's health, not asserted from a callback.
 *
 *  [1] Old client (never sends Equip): the packet name still counts, exactly like before (transition rule).
 *  [2] Equip the axe: a blow whose packet says "SwordNorth" (or nothing) does axe damage, bit-identical to
 *      the axe damage of [1]; the answer is one EquipStand with aufAnfrage = true.
 *  [3] Sword, then unequip: the carried weapon wins over any packet name; no weapon = fist 4.
 *  [4] Rejections: weapon not owned, armor part, material, unknown name, wrong slot: the carried weapon stays,
 *      the client is told the real state.
 *  [5] The weapon leaves the inventory (chest packet, and a drop without sync): it falls off, the client gets
 *      an unasked EquipStand, the next blow is a fist.
 *  [6] Harvest uses the carried weapon (tree needs the axe) and ignores the packet name.
 *  [7] Two players at the same time with different weapons: each his own, the packets swapped on purpose.
 *  [8] The carried weapon is saved and comes back at the next login (and only if the item is still owned).
 *  [9] wirksameWaffe (pure): both branches of the transition rule.
 *  [10] The world snapshot (periodic/shutdown save) carries the weapon.
 *  [11] A rejected Equip also ends the old-client rule.
 *  [12] Flood: the Equip throttle sits in front of the handler.
 *  [13] The real client logic (WaffenAbgleich) against the real server: quick choices, lost answer, chest.
 *
 * Run: npx tsx server/test/kampf-waffe.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { HEALTH_MEMBER, PacketType, getStableHash, maxLeben, SET_TEILE, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer, wirksameWaffe, gepruefteWaffe, waffeTragbar } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { Inventory, findItem, type ItemStack, type AusruestungsSlot } from '@wov/shared';
import { WaffenAbgleich, type WaffenTraeger } from '../../client/src/player/WaffenAbgleich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-kampf-waffe');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, Attack: 46, AdminCommand: 53, AuthChallenge: 68, ContainerAction: 69 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Stand { slot: string; name: string; auf: boolean }
interface Spieler { ws: WebSocket; peer: Peer; stands: Stand[] }
type MitStand = WebSocket & { _stands?: Stand[]; _beiStand?: (s: Stand) => void };

function verbinde(name: string): Promise<MitStand> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as MitStand;
    ws._stands = [];
    ws.binaryType = 'nodebuffer';
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
      } else if (type === PacketType.EquipStand) {
        const st = { slot: r.readString(), name: r.readString(), auf: r.readBool() };
        ws._stands!.push(st);
        ws._beiStand?.(st);
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
const sendInput = (ws: WebSocket, yaw: number): void => {
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
};
async function blicke(ws: WebSocket, yaw = 0, dauerMs = 400): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) { sendInput(ws, yaw); await warte(50); }
}
const sendAttack = (ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void => {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
};
const sendEquip = (ws: WebSocket, slot: string, item: string): void => {
  const w = new Writer();
  w.writeString(slot);
  w.writeString(item);
  ws.send(Buffer.concat([Buffer.from([PacketType.Equip]), w.toBuffer()]));
};
const sendContainer = (ws: WebSocket, id: ZDO['zdoid'], richtung: 0 | 1, item: string, menge: number): void => {
  const w = new Writer();
  w.writeString(id.userId.toString());
  w.writeInt32(id.id);
  w.writeInt32(richtung);
  w.writeString(item);
  w.writeInt32(menge);
  ws.send(Buffer.concat([Buffer.from([P.ContainerAction]), w.toBuffer()]));
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'kampf-waffe',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as { gebeItem(peer: Peer, name: string, amount: number): void };
  const sockets: WebSocket[] = [];
  try {
    const wsA = await verbinde('Anna'); const wsB = await verbinde('Bernd');
    sockets.push(wsA, wsB);
    const hole = (n: string): Peer => {
      const p = server.net.getPeers().find((x) => x.name === n);
      if (!p) throw new Error(`peer ${n} missing`);
      return p;
    };
    const anna: Spieler = { ws: wsA, peer: hole('Anna'), stands: wsA._stands! };
    const bernd: Spieler = { ws: wsB, peer: hole('Bernd'), stands: wsB._stands! };
    await warte(400);

    const platz = async (s: Spieler, x: number, z: number): Promise<Vector3> => {
      sendAdmin(s.ws, `teleport ${x} ${z}`);
      await warte(350);
      if (Math.hypot(s.peer.position.x - x, s.peer.position.z - z) > 1) throw new Error(`teleport ${s.peer.name} failed`);
      return s.peer.position;
    };
    await platz(anna, 200, 200); await platz(bernd, 400, 200);

    const FURLOC = getStableHash('FurlocKrieger');
    /** One blow on a fresh creature; returns the damage the creature took. */
    async function schlageWesen(s: Spieler, paketName: string): Promise<number> {
      const mitte = s.peer.position;
      const ziel: ZDO = server.zdos.createZDO(FURLOC, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      ziel.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
      await blicke(s.ws);
      s.peer.stamina = 100;
      sendAttack(s.ws, mitte, paketName);
      await warte(450);
      const hp = ziel.destroyed ? -1 : ziel.getInt(HEALTH_MEMBER);
      if (!ziel.destroyed) server.zdos.destroyZDO(ziel.zdoid);
      return maxLeben('FurlocKrieger') - hp;
    }
    const BAUM = getStableHash('Beech_small1');
    async function faelleBaum(s: Spieler, paketName: string): Promise<number> {
      const mitte = s.peer.position;
      const baum = server.zdos.createZDO(BAUM, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      baum.setInt(HEALTH_MEMBER, 60);
      await blicke(s.ws);
      s.peer.stamina = 100;
      sendAttack(s.ws, mitte, paketName);
      await warte(350);
      const hp = baum.getInt(HEALTH_MEMBER);
      if (!baum.destroyed) server.zdos.destroyZDO(baum.zdoid);
      return 60 - hp;
    }
    const letzter = (s: Spieler): Stand | undefined => s.stands[s.stands.length - 1];

    // ── [1] Old client ──────────────────────────────────────────
    console.log('\n[1] Old client (no Equip ever): packet name counts, as before');
    check('login: the server told both clients the (empty) carried weapon, unasked',
      anna.stands.length >= 1 && anna.stands[0]!.slot === 'waffe' && anna.stands[0]!.name === '' && !anna.stands[0]!.auf, JSON.stringify(anna.stands));
    check('server side: nothing carried, no Equip seen', anna.peer.waffe === '' && !anna.peer.equipGesehen);
    const alt = [await schlageWesen(anna, 'AxeFlint'), await schlageWesen(anna, 'SwordNorth'), await schlageWesen(anna, '')];
    check('Axe packet 15 / Sword packet 12 / no name 4 (bit-identical to before)', alt.join() === '15,12,4', alt.join(','));
    const fremd = await schlageWesen(anna, 'PickaxeDoesNotExist');
    check('a packet name that is not owned is still a fist (4)', fremd === 4, `${fremd}`);
    const altBaum = [await faelleBaum(anna, 'AxeFlint'), await faelleBaum(anna, '')];
    check('tree: axe packet cuts 15, no name is "too hard" (0)', altBaum.join() === '15,0', altBaum.join(','));

    // ── [2] Axe equipped ────────────────────────────────────────
    console.log('\n[2] Equip the axe: the carried weapon wins over the packet');
    const vorEquip = anna.stands.length;
    sendEquip(anna.ws, 'waffe', 'AxeFlint');
    await warte(250);
    check('exactly one answer, EquipStand(waffe, AxeFlint, aufAnfrage)', anna.stands.length === vorEquip + 1
      && letzter(anna)!.name === 'AxeFlint' && letzter(anna)!.auf === true, JSON.stringify(letzter(anna)));
    check('server side: peer.waffe = AxeFlint, Equip seen, stack marked equipped',
      anna.peer.waffe === 'AxeFlint' && anna.peer.equipGesehen && anna.peer.inventar.all.some((i) => i.shared.name === 'AxeFlint' && i.equipped));
    const axt = [await schlageWesen(anna, 'SwordNorth'), await schlageWesen(anna, ''), await schlageWesen(anna, 'AxeFlint')];
    check('packet says Sword / nothing / Axe: always axe damage 15 (= [1] with the axe in the packet)', axt.join() === '15,15,15' && axt[2] === alt[0], axt.join(','));
    const baumAxt = await faelleBaum(anna, '');
    check('tree with the axe carried and an empty packet: 15 (harvest uses the carried weapon)', baumAxt === 15, `${baumAxt}`);

    // ── [3] Sword, then nothing ─────────────────────────────────
    console.log('\n[3] Sword, then unequip');
    sendEquip(anna.ws, 'waffe', 'SwordNorth'); await warte(250);
    check('answer names the sword', letzter(anna)!.name === 'SwordNorth' && letzter(anna)!.auf === true);
    const schwert = [await schlageWesen(anna, 'AxeFlint'), await schlageWesen(anna, '')];
    check('sword carried: 12 whatever the packet says (= [1] sword)', schwert.join() === '12,12' && schwert[0] === alt[1], schwert.join(','));
    const baumSchwert = await faelleBaum(anna, 'AxeFlint');
    check('sword carried, packet says axe: the tree is NOT cut ("too hard"), 0', baumSchwert === 0, `${baumSchwert}`);
    sendEquip(anna.ws, 'waffe', ''); await warte(250);
    check('unequip: answer empty, peer.waffe empty', letzter(anna)!.name === '' && anna.peer.waffe === '');
    const faust = [await schlageWesen(anna, 'AxeFlint'), await schlageWesen(anna, 'SwordNorth')];
    check('nothing carried (after a Equip): fist 4, the packet name is ignored', faust.join() === '4,4', faust.join(','));

    // ── [4] Rejections ──────────────────────────────────────────
    console.log('\n[4] Rejections keep the carried weapon and tell the client');
    sendEquip(anna.ws, 'waffe', 'AxeFlint'); await warte(200);
    const ruest = SET_TEILE[0]!;
    zugriff.gebeItem(anna.peer, ruest.item, 1);
    await warte(300);
    const nichtBesessen = ['Messer', 'DoesNotExist', ruest.item, 'Wood', 'Stone'];
    for (const name of nichtBesessen) {
      const n = anna.stands.length;
      sendEquip(anna.ws, 'waffe', name); await warte(200);
      check(`Equip "${name}" rejected: one answer, still AxeFlint`,
        anna.stands.length === n + 1 && letzter(anna)!.name === 'AxeFlint' && letzter(anna)!.auf === true && anna.peer.waffe === 'AxeFlint');
    }
    check('"Messer" really is not owned', anna.peer.inventar.countOf('Messer') === 0);
    {
      const n = anna.stands.length;
      sendEquip(anna.ws, 'kopf', 'AxeFlint'); await warte(200);
      check('Equip into another slot: answered, weapon unchanged', anna.stands.length === n + 1 && anna.peer.waffe === 'AxeFlint');
      sendEquip(anna.ws, 'waffe', 'SwordNorth'); await warte(200);
      sendEquip(anna.ws, 'waffe', 'DoesNotExist'); await warte(200);
      check('a rejected Equip does not unequip the previous weapon', anna.peer.waffe === 'SwordNorth');
      sendEquip(anna.ws, 'waffe', 'AxeFlint'); await warte(200);
    }
    const nachAblehnung = await schlageWesen(anna, '');
    check('after all that: axe blow 15', nachAblehnung === 15, `${nachAblehnung}`);

    // ── [5] The weapon leaves the inventory ─────────────────────
    console.log('\n[5] Weapon leaves the inventory: it falls off');
    const truhe = server.prefabs.getByName('piece_chest_wood')!;
    const kiste = server.zdos.createZDO(truhe.hash, { ...anna.peer.position });
    const n5 = anna.stands.length;
    sendContainer(anna.ws, kiste.zdoid, 1, 'AxeFlint', 1);
    await warte(350);
    check('axe is in the chest, not in the inventory', anna.peer.inventar.countOf('AxeFlint') === 0);
    check('carried weapon fell off, client got an unasked EquipStand(empty)',
      anna.peer.waffe === '' && anna.stands.length > n5 && letzter(anna)!.name === '' && letzter(anna)!.auf === false, JSON.stringify(anna.stands.slice(n5)));
    const ohneAxt = await schlageWesen(anna, 'AxeFlint');
    check('next blow with "AxeFlint" in the packet: fist 4', ohneAxt === 4, `${ohneAxt}`);
    sendContainer(anna.ws, kiste.zdoid, 0, 'AxeFlint', 1); await warte(350);
    check('axe taken back: owned again, but NOT carried again by itself', anna.peer.inventar.countOf('AxeFlint') === 1 && anna.peer.waffe === '');
    server.zdos.destroyZDO(kiste.zdoid);
    // A drop without inventarSync: the blow itself catches it.
    sendEquip(anna.ws, 'waffe', 'SwordNorth'); await warte(200);
    anna.peer.inventar.removeByName('SwordNorth', 1);
    const n5b = anna.stands.length;
    const still = await schlageWesen(anna, 'SwordNorth');
    check('sword removed behind the sync: the blow is a fist and the client is told', still === 4 && anna.peer.waffe === '' && anna.stands.length > n5b && letzter(anna)!.name === '', `${still}`);
    zugriff.gebeItem(anna.peer, 'SwordNorth', 1); await warte(300);

    // ── [6] covered above (trees); [7] two players ──────────────
    console.log('\n[7] Two players at the same time, packets swapped on purpose');
    sendEquip(anna.ws, 'waffe', 'AxeFlint'); sendEquip(bernd.ws, 'waffe', 'SwordNorth'); await warte(300);
    const mitteA = anna.peer.position; const mitteB = bernd.peer.position;
    const zA = server.zdos.createZDO(FURLOC, { x: mitteA.x, y: mitteA.y, z: mitteA.z - 2 });
    const zB = server.zdos.createZDO(FURLOC, { x: mitteB.x, y: mitteB.y, z: mitteB.z - 2 });
    zA.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger')); zB.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
    await Promise.all([blicke(anna.ws), blicke(bernd.ws)]);
    anna.peer.stamina = 100; bernd.peer.stamina = 100;
    sendAttack(anna.ws, mitteA, 'SwordNorth'); sendAttack(bernd.ws, mitteB, 'AxeFlint');
    await warte(450);
    const dA = maxLeben('FurlocKrieger') - zA.getInt(HEALTH_MEMBER); const dB = maxLeben('FurlocKrieger') - zB.getInt(HEALTH_MEMBER);
    check('Anna (carries axe, packet says sword) 15; Bernd (carries sword, packet says axe) 12', dA === 15 && dB === 12, `${dA} / ${dB}`);
    server.zdos.destroyZDO(zA.zdoid); server.zdos.destroyZDO(zB.zdoid);
    check('peer state is per player', anna.peer.waffe === 'AxeFlint' && bernd.peer.waffe === 'SwordNorth');

    // ── [8] Saved and restored ──────────────────────────────────
    console.log('\n[8] The carried weapon is saved and comes back at login');
    const alteId = anna.peer.spielerId;
    wsA.close(); await warte(600);
    type Gespeichert = { waffe?: string; inventar: Array<{ name: string; equipped?: boolean }> };
    const gespeichertMap = (server as unknown as { savedPlayers: Map<string, Gespeichert> }).savedPlayers;
    const stand = gespeichertMap.get(alteId)!;
    check('the save file entry carries the weapon', stand.waffe === 'AxeFlint', String(stand.waffe));
    // Guests get a new spielerId at every connect, so the lookup of the saved state is pointed at Anna's entry.
    const lookup = server as unknown as { ermittleGespeichertenStand: () => Gespeichert | undefined };
    async function loginMit(name: string, eintrag: Gespeichert | undefined): Promise<Spieler> {
      lookup.ermittleGespeichertenStand = () => eintrag;
      const ws = await verbinde(name); sockets.push(ws);
      await warte(400);
      return { ws, peer: hole(name), stands: ws._stands! };
    }
    const a2 = await loginMit('Anna2', stand);
    check('relog: peer.waffe = AxeFlint, client told at login (unasked)',
      a2.peer.waffe === 'AxeFlint' && a2.stands.some((x) => x.name === 'AxeFlint' && !x.auf), JSON.stringify(a2.stands));
    check('the new connection has sent no Equip yet (transition rule applies until it does)', !a2.peer.equipGesehen);
    const a2dmg = await (async () => { await platz(a2, 600, 200); return schlageWesen(a2, ''); })();
    check('... and it hits with the restored axe once it sends Equip (15)', (() => { sendEquip(a2.ws, 'waffe', 'AxeFlint'); return true; })() && a2dmg === 4 /* transition: packet name '' = fist */, `${a2dmg}`);
    await warte(250);
    const a2b = await schlageWesen(a2, '');
    check('after its first Equip the restored axe counts with an empty packet: 15', a2b === 15, `${a2b}`);
    const ohneAxtStand: Gespeichert = { ...stand, inventar: stand.inventar.filter((i) => i.name !== 'AxeFlint') };
    const a3 = await loginMit("Anna3", ohneAxtStand);
    check('saved weapon that is no longer owned: not carried, client told empty',
      a3.peer.waffe === '' && a3.stands.every((x) => x.name === ''), JSON.stringify(a3.stands));
    const altstand: Gespeichert = { ...stand, waffe: undefined, inventar: stand.inventar.map((i) => ({ ...i, equipped: i.name === 'SwordNorth' })) };
    const a4 = await loginMit('Anna4', altstand);
    check('old save without the field: the stack marked equipped is taken over (SwordNorth)', a4.peer.waffe === 'SwordNorth', a4.peer.waffe);
    const a5 = await loginMit('Anna5', { ...stand, waffe: undefined, inventar: stand.inventar.map((i) => ({ ...i, equipped: false })) });
    check('old save with nothing marked: fist', a5.peer.waffe === '');
    wsB.close(); await warte(600);
    // ── [10] The periodic / shutdown save carries the weapon ────
    console.log('\n[10] The world snapshot (periodic and shutdown save) carries the weapon');
    {
      const snap = (server as unknown as { momentaufnahme(): { kopf: { players: Array<{ name: string; waffe?: string }> } } }).momentaufnahme();
      const eintrag = snap.kopf.players.find((p) => p.name === 'Anna2');
      check('snapshot entry of the online player Anna2 has waffe = AxeFlint', eintrag?.waffe === 'AxeFlint', JSON.stringify(eintrag?.waffe));
    }

    // ── [11] Any Equip switches the transition rule off ─────────
    console.log('\n[11] A REJECTED Equip also switches the old-client rule off');
    const clara = await (async (): Promise<Spieler> => {
      const ws = await verbinde('Clara'); sockets.push(ws); await warte(400);
      const sp: Spieler = { ws, peer: hole('Clara'), stands: ws._stands! };
      await platz(sp, 800, 200);
      return sp;
    })();
    {
      const vorher = await schlageWesen(clara, 'AxeFlint');
      check('before any Equip: the packet name counts (15)', vorher === 15 && !clara.peer.equipGesehen, `${vorher}`);
      sendEquip(clara.ws, 'waffe', 'Messer'); await warte(250);
      check('a rejected Equip: peer.equipGesehen is set, nothing carried', clara.peer.equipGesehen && clara.peer.waffe === '');
      const nachher = await schlageWesen(clara, 'AxeFlint');
      check('now the packet name is ignored: fist 4', nachher === 4, `${nachher}`);
    }

    // ── [12] The throttle answers nothing beyond the bucket ─────
    console.log('\n[12] Flood: the Equip throttle (bucket 6, 3/s) is really in front of the handler');
    {
      const n = clara.stands.length;
      for (let i = 0; i < 30; i++) sendEquip(clara.ws, 'waffe', i % 2 === 0 ? 'AxeFlint' : 'SwordNorth');
      await warte(500);
      const antworten = clara.stands.length - n;
      check('30 Equip in one go: at most 8 answers (the rest is dropped silently)', antworten >= 1 && antworten <= 8, `${antworten}`);
      sendEquip(clara.ws, 'waffe', ''); await warte(1500);
    }

    // ── [13] The real client logic over the real socket ─────────
    console.log('\n[13] Client logic (WaffenAbgleich) against the real server: flood, lost answer, chest');
    {
      const itemDef = new Map(['AxeFlint', 'SwordNorth'].map((n) => [n, { shared: { name: n } } as unknown as ItemStack]));
      const ws = await verbinde('Dora'); sockets.push(ws); await warte(400);
      const dora: Spieler = { ws, peer: hole('Dora'), stands: ws._stands! };
      await platz(dora, 1000, 200);
      class Hand implements WaffenTraeger {
        hand: ItemStack | null = null;
        private readonly h = new Set<() => void>();
        get rightItem(): ItemStack | null { return this.hand; }
        onChanged(fn: () => void): () => void { this.h.add(fn); return () => this.h.delete(fn); }
        equip(item: ItemStack, _s?: AusruestungsSlot): void { this.hand = item; [...this.h].forEach((f) => f()); }
        unequip(_s?: AusruestungsSlot): void { this.hand = null; [...this.h].forEach((f) => f()); }
        name(): string { return this.hand?.shared.name ?? ''; }
      }
      const hand = new Hand();
      const gesendet: string[] = [];
      const abgleich = new WaffenAbgleich(hand, (n) => itemDef.get(n) ?? null, (sl, n) => { gesendet.push(n); sendEquip(ws, sl, n); }, { ruheMs: 20, fristMs: 500 });
      let roh = false;
      for (const st of ws._stands!) abgleich.stand(st.slot, st.name, st.auf);
      ws._beiStand = (st) => { if (!roh) abgleich.stand(st.slot, st.name, st.auf); };
      await warte(300);
      // (a) 30 quick choices
      const n0 = gesendet.length;
      for (let i = 0; i < 30; i++) { hand.equip(itemDef.get(i % 2 === 0 ? 'AxeFlint' : 'SwordNorth')!); await warte(3); }
      await warte(500);
      const gesendetA = gesendet.length - n0;
      check('30 quick choices: at most 2 Equip sent, the server carries the LAST choice, display = server',
        gesendetA >= 1 && gesendetA <= 2 && dora.peer.waffe === 'SwordNorth' && hand.name() === 'SwordNorth', `${gesendetA} sent, server ${dora.peer.waffe}, display ${hand.name()}`);
      // (b) the weapon goes into a chest: the display follows the server
      const truhe = server.prefabs.getByName('piece_chest_wood')!;
      const kiste = server.zdos.createZDO(truhe.hash, { ...dora.peer.position });
      sendContainer(ws, kiste.zdoid, 1, 'SwordNorth', 1); await warte(400);
      check('sword into the chest: server carries nothing, the display is emptied (= server)', dora.peer.waffe === '' && hand.name() === '', `server "${dora.peer.waffe}", display "${hand.name()}"`);
      sendContainer(ws, kiste.zdoid, 0, 'SwordNorth', 1); await warte(400);
      // (c) the answer to a choice is lost to the throttle: the client retries and ends equal to the server
      roh = true;
      for (let i = 0; i < 10; i++) sendEquip(ws, 'waffe', 'Nope');
      await warte(150);
      roh = false;
      const n1 = gesendet.length;
      hand.equip(itemDef.get('SwordNorth')!);
      await warte(300);
      check('the first Equip was swallowed by the throttle: the server still carries nothing', dora.peer.waffe === '' && gesendet.length === n1 + 1, `server "${dora.peer.waffe}", sent ${gesendet.length - n1}`);
      await warte(1800);
      check('after the expiry the choice was sent again and the display equals the server (SwordNorth)', dora.peer.waffe === 'SwordNorth' && hand.name() === 'SwordNorth' && gesendet.length >= n1 + 2, `server "${dora.peer.waffe}", display "${hand.name()}", sent ${gesendet.length - n1}`);
      // (d) after all that an unasked state still gets through
      sendContainer(ws, kiste.zdoid, 1, 'SwordNorth', 1); await warte(500);
      check('and the chest still empties the display afterwards (= server)', dora.peer.waffe === '' && hand.name() === '', `server "${dora.peer.waffe}", display "${hand.name()}"`);
      abgleich.dispose();
      server.zdos.destroyZDO(kiste.zdoid);
    }

    console.log('\n[9] wirksameWaffe (pure), both branches of the transition rule');
    const inv = new Inventory();
    inv.addItem(findItem('AxeFlint')!, 1); inv.addItem(findItem('SwordNorth')!, 1);
    check('no Equip yet + transition on: the checked packet name', wirksameWaffe(inv, '', false, 'AxeFlint', true) === 'AxeFlint' && wirksameWaffe(inv, '', false, 'Nope', true) === '');
    check('no Equip yet + transition off: the carried weapon only (fist)', wirksameWaffe(inv, '', false, 'AxeFlint', false) === '');
    check('Equip seen: the carried weapon, packet ignored in both modes',
      wirksameWaffe(inv, 'SwordNorth', true, 'AxeFlint', true) === 'SwordNorth' && wirksameWaffe(inv, 'SwordNorth', true, 'AxeFlint', false) === 'SwordNorth');
    check('carried weapon not in the inventory: fist', wirksameWaffe(inv, 'PickaxeAntler', true, 'PickaxeAntler') === '');
    check('waffeTragbar: axe yes; wood, armor part, unknown, empty no',
      waffeTragbar(inv, 'AxeFlint') && !waffeTragbar(inv, 'Wood') && !waffeTragbar(inv, '') && !waffeTragbar(inv, 'Nope'));
    check('gepruefteWaffe unchanged', gepruefteWaffe(inv, 'AxeFlint') === 'AxeFlint' && gepruefteWaffe(inv, 'Nope') === '');
  } finally {
    for (const ws of sockets) try { ws.close(); } catch { /* */ }
    await warte(200);
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
