/**
 * Combat core K1: item attributes act in the server, over the REAL packet path.
 *
 * Three real WebSocket players at the same time, each with different gear, one server:
 *   Anna  = full Crowshade set  (armor 40, agility 10, strength 5)
 *   Bernd = full Ironward set   (armor 40, strength 10, vitality 5)
 *   Clara = no gear             (everything as before this change)
 * The gear goes on through the real SetAussehen packet (the set parts come from `item give`), so
 * `peer.ruestung` changes exactly the way it does in the game and `peer.werte` follows.
 *
 * Measured, not asserted from a callback:
 *  [1] Sums: `peer.werte` per player, computed from the worn parts; a player in another set has other sums.
 *  [2] Armor: a creature blow of 8 (applyCreatureAttack) costs Clara 8, Anna and Bernd exactly 4 (8*40/80);
 *      a real wolf bite next to Anna costs her 4 per bite. A parried blow costs nothing (armor is not applied first).
 *  [3] Vitality: maximum health 100 / 100 / 110; the health share sent to the client is `health / max * 100`;
 *      taking the gear off clamps health back to 100.
 *  [4] Agility: one swing costs Clara 8 and Bernd 8 stamina, Anna 6.4 (8 * (1 - 10 * 0.02)).
 *  [5] Strength: a creature takes weapon damage * (1 + strength * 0.01) rounded (Axe 15: Clara 15, Anna 16, Bernd 17;
 *      Sword 12: Bernd 13, fist 4: Bernd 4); a tree takes the plain weapon damage from everyone (harvest unchanged).
 *  [6] Two players, two sets, at the same time: each has his own numbers (no shared state), also right after
 *      the other one changed his gear.
 *
 * Run: npx tsx server/test/kampf-attribute.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  HEALTH_MEMBER, PacketType, SET_TEILE, getStableHash, maxLeben, ruestungZu, REGLER, type Vector3, ESSEN, eingehenderSchaden, lebenNachSchaden,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-kampf-attribute');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, Attack: 46, AdminCommand: 53, Parry: 58, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nah = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

interface Spieler { ws: WebSocket; peer: Peer; healthProzent: () => number; anzahl: () => number }

function verbinde(name: string): Promise<WebSocket & { _prozent?: number; _anzahl?: number }> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as WebSocket & { _prozent?: number; _anzahl?: number };
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
      } else if (type === PacketType.PlayerState) {
        ws._prozent = r.readFloat32();
        ws._anzahl = (ws._anzahl ?? 0) + 1;
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

/** Puts the parts of a set on through the real SetAussehen packet (keys = appearance slots). */
async function ziehAn(s: Spieler, ids: readonly string[]): Promise<void> {
  const teile = Object.fromEntries(ids.map((id) => [ruestungZu(id)!.slot, id]));
  const { oberkoerper = '', beine = '', ...extra } = teile;
  const w = new Writer();
  w.writeString(s.peer.frisur);
  w.writeString(oberkoerper);
  w.writeString(beine);
  w.writeString(s.peer.haarfarbe);
  w.writeString(s.peer.augenfarbe);
  w.writeString(JSON.stringify(extra));
  s.ws.send(Buffer.concat([Buffer.from([PacketType.SetAussehen]), w.toBuffer()]));
  await warte(250);
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'kampf-attribute',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  server.liegezeitMs = 0; // these checks are about the numbers of a death, not about the lying time (tod-treffer.ts)
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
    maxHealth(peer: Peer): number;
    sendPlayerState(peer: Peer): void;
    gebeItem(peer: Peer, name: string, amount: number): void;
    inventarSync(peer: Peer): void;
  };
  const sockets: WebSocket[] = [];
  try {
    const wsA = await verbinde('Anna'); const wsB = await verbinde('Bernd'); const wsC = await verbinde('Clara');
    sockets.push(wsA, wsB, wsC);
    const hole = (n: string): Peer => {
      const p = server.net.getPeers().find((x) => x.name === n);
      if (!p) throw new Error(`peer ${n} missing`);
      return p;
    };
    const mk = (ws: WebSocket & { _prozent?: number; _anzahl?: number }, n: string): Spieler => ({ ws, peer: hole(n), healthProzent: () => ws._prozent ?? NaN, anzahl: () => ws._anzahl ?? 0 });
    const anna = mk(wsA, 'Anna'); const bernd = mk(wsB, 'Bernd'); const clara = mk(wsC, 'Clara');
    const alle = [anna, bernd, clara];

    // Far apart, so no player's creature ever reaches another one.
    const platz = async (s: Spieler, x: number, z: number): Promise<Vector3> => {
      sendAdmin(s.ws, `teleport ${x} ${z}`);
      await warte(350);
      if (Math.hypot(s.peer.position.x - x, s.peer.position.z - z) > 1) throw new Error(`teleport ${s.peer.name} failed`);
      return s.peer.position;
    };
    await platz(anna, 200, 200); await platz(bernd, 400, 200); await platz(clara, 600, 200);

    const setDaten = (familie: string, geschlecht: 'male' | 'female' | '') =>
      SET_TEILE.filter((t) => t.familie === familie && (geschlecht === '' || t.id.includes(`_${geschlecht}_`)));
    const kro = setDaten('crowshade', 'male'); const iro = setDaten('ironward', '');
    check('sets found (7 + 7 parts)', kro.length === 7 && iro.length === 7);
    // `gebeItem` is the server's ONE way to hand out loot (chat commands are rate limited and drop a burst).
    // The starter inventory already holds the axe and the sword.
    const gib = (s: Spieler, name: string): void => zugriff.gebeItem(s.peer, name, 1);
    for (const t of kro) gib(anna, t.item);
    for (const t of iro) gib(bernd, t.item);
    await warte(500);
    check('all three are the male body (the sets fit)', alle.every((s) => s.peer.figur === 'wikinger'), alle.map((s) => s.peer.figur).join(','));
    check('gear is in the server inventory', kro.every((t) => anna.peer.inventar.countOf(t.item) === 1) && iro.every((t) => bernd.peer.inventar.countOf(t.item) === 1));

    // ── [1] Sums ────────────────────────────────────────────────
    console.log('\n[1] Sums follow the worn parts (real SetAussehen packet)');
    check('before: nobody has values', alle.every((s) => s.peer.werte.armor === 0 && s.peer.werte.strength === 0));
    await ziehAn(anna, kro.map((t) => t.id));
    await ziehAn(bernd, iro.map((t) => t.id));
    const wa = anna.peer.werte; const wb = bernd.peer.werte; const wc = clara.peer.werte;
    console.log(`      Anna ${JSON.stringify(wa)}\n      Bernd ${JSON.stringify(wb)}\n      Clara ${JSON.stringify(wc)}`);
    check('Anna: armor 40, agility 10, strength 5, vitality 0', wa.armor === 40 && wa.agility === 10 && wa.strength === 5 && wa.vitality === 0);
    check('Bernd: armor 40, strength 10, vitality 5, agility 0', wb.armor === 40 && wb.strength === 10 && wb.vitality === 5 && wb.agility === 0);
    check('Clara (no gear): all zero', wc.armor === 0 && wc.strength === 0 && wc.vitality === 0 && wc.agility === 0);

    // ── [2] Armor ───────────────────────────────────────────────
    console.log('\n[2] Armor: creature blow 8 -> 8*K/(K+R)');
    for (const s of alle) s.peer.blockSeit = 0;
    const biss = (s: Spieler, schaden = 8): number => {
      s.peer.health = 100;
      zugriff.applyCreatureAttack({ ...s.peer.position }, schaden, 2.4, s.peer.worldId, s.peer.position);
      return 100 - s.peer.health;
    };
    check('Clara loses exactly 8 (bit-identical to before)', biss(clara) === 8);
    check('Anna (armor 40 = K) loses exactly 4', biss(anna) === 4);
    check('Bernd (armor 40 = K) loses exactly 4', biss(bernd) === 4);
    check('blow of 3 with armor 40: 1.5, not below 1', nah(biss(anna, 3), 1.5));
    check('blow of 1 stays 1 (minimum 1)', nah(biss(anna, 1), 1));
    // Plainhide-like partial armor: take the class set off except chest+legs (armor 19).
    await ziehAn(bernd, iro.filter((t) => t.key === 'ironward_brust' || t.key === 'ironward_hose').map((t) => t.id));
    check('Bernd with chest+legs only: armor 19', bernd.peer.werte.armor === 19, `${bernd.peer.werte.armor}`);
    check('... loses 8*40/59', nah(biss(bernd), 8 * 40 / 59), `${biss(bernd)}`);
    await ziehAn(bernd, iro.map((t) => t.id));
    // Block: armor is applied AFTER the block (a parried blow does nothing at all). Anna faces -z, the blow comes from the front.
    anna.peer.health = 100; anna.peer.stamina = 100; anna.peer.blickYaw = 0;
    anna.peer.blockSeit = Date.now(); anna.peer.blockOhneParade = false;
    zugriff.applyCreatureAttack({ x: anna.peer.position.x, y: anna.peer.position.y, z: anna.peer.position.z - 2 }, 8, 2.4, anna.peer.worldId, anna.peer.position);
    check('parried blow: no damage at all, the block is still held, 4 stamina paid', anna.peer.health === 100 && anna.peer.blockSeit > 0 && anna.peer.stamina === 96, `${anna.peer.health} ${anna.peer.blockSeit} ${anna.peer.stamina}`);
    anna.peer.blockSeit = 0;
    // The real tick path: a Furloc warrior (damage 8) hunts the player, the blow arrives through AggroSystem
    // -> applyCreatureAttack. Counted blows x expected loss per blow = measured health loss.
    {
      const schlaege: number[] = [];
      const echt = server.aggro.onSchlag;
      server.aggro.onSchlag = (pos, schaden, radius) => { schlaege.push(schaden); echt?.(pos, schaden, radius); };
      const FURLOC_HASH = getStableHash('FurlocKrieger');
      for (const [s, erwartet] of [[clara, 8], [anna, 4]] as const) {
        s.peer.health = 100; s.peer.blockSeit = 0; schlaege.length = 0;
        const p0 = s.peer.position;
        const npc = server.zdos.createZDO(FURLOC_HASH, { x: p0.x, y: p0.y, z: p0.z - 2 });
        npc.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
        await warte(4500);
        if (!npc.destroyed) server.zdos.destroyZDO(npc.zdoid);
        const verlust = 100 - s.peer.health;
        check(`${s.peer.name}: ${schlaege.length} real NPC blows of ${schlaege[0]} cost exactly ${erwartet} each`,
          schlaege.length >= 1 && schlaege.every((x) => x === 8) && nah(verlust, erwartet * schlaege.length), `${verlust} = ${schlaege.length} x ${erwartet}`);
      }
      server.aggro.onSchlag = echt;
    }

    // ── [3] Vitality ────────────────────────────────────────────
    console.log('\n[3] Vitality: maximum health 100 + 5*2');
    check('maximum health Anna 100, Bernd 110, Clara 100',
      zugriff.maxHealth(anna.peer) === 100 && zugriff.maxHealth(bernd.peer) === 100 + 5 * REGLER.v && zugriff.maxHealth(clara.peer) === 100,
      `${zugriff.maxHealth(anna.peer)} / ${zugriff.maxHealth(bernd.peer)} / ${zugriff.maxHealth(clara.peer)}`);
    bernd.peer.health = 55; zugriff.sendPlayerState(bernd.peer); await warte(150);
    check('client gets a percentage of the NEW maximum: 55 / 110 = 50 %', nah(bernd.healthProzent(), 50, 1e-4), `${bernd.healthProzent()}`);
    clara.peer.health = 55; zugriff.sendPlayerState(clara.peer); await warte(150);
    check('Clara: 55 / 100 = 55 %', nah(clara.healthProzent(), 55, 1e-4), `${clara.healthProzent()}`);
    bernd.peer.health = 110;
    await ziehAn(bernd, []);
    check('gear off: maximum back to 100 and health clamped 110 -> 100', zugriff.maxHealth(bernd.peer) === 100 && bernd.peer.health === 100, `${bernd.peer.health}`);
    await ziehAn(bernd, iro.map((t) => t.id));
    check('gear on again: maximum 110, health stays 100 (no free heal)', zugriff.maxHealth(bernd.peer) === 110 && bernd.peer.health === 100);
    // Death path: respawn at the (gear) maximum; a wolf-sized blow kills at 8 health.
    bernd.peer.health = 3; bernd.peer.blockSeit = 0;
    zugriff.applyCreatureAttack({ ...bernd.peer.position }, 8, 2.4, bernd.peer.worldId, bernd.peer.position);
    check('lethal blow: back to full health of the gear maximum (110)', bernd.peer.health === 110, `${bernd.peer.health}`);
    await platz(bernd, 400, 200);

    // ── [4] Agility ─────────────────────────────────────────────
    console.log('\n[4] Agility: swing cost 8 * (1 - 10 * 0.02)');
    async function schlagKosten(s: Spieler): Promise<number> {
      const mitte = await platz(s, s.peer.position.x, s.peer.position.z);
      await blicke(s.ws);
      s.peer.stamina = 100;
      sendAttack(s.ws, mitte, 'AxeFlint');
      await warte(120);
      return 100 - s.peer.stamina;
    }
    const kc = await schlagKosten(clara); const kb = await schlagKosten(bernd); const ka = await schlagKosten(anna);
    console.log(`      cost Clara ${kc}, Bernd ${kb}, Anna ${ka}`);
    check('Clara pays 8 (bit-identical)', kc === 8);
    check('Bernd (no agility) pays 8', kb === 8);
    check('Anna (agility 10) pays 6.4', nah(ka, 6.4, 1e-4), `${ka}`);

    // ── [5] Strength ────────────────────────────────────────────
    console.log('\n[5] Strength: creature damage * (1 + S*0.01), harvest unchanged');
    const FURLOC = getStableHash('FurlocKrieger');
    async function schlageWesen(s: Spieler, waffe: string): Promise<number> {
      const mitte = await platz(s, s.peer.position.x, s.peer.position.z);
      const ziel: ZDO = server.zdos.createZDO(FURLOC, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      ziel.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
      await blicke(s.ws);
      s.peer.stamina = 100;
      sendAttack(s.ws, mitte, waffe);
      await warte(450);
      const hp = ziel.destroyed ? -1 : ziel.getInt(HEALTH_MEMBER);
      if (!ziel.destroyed) server.zdos.destroyZDO(ziel.zdoid);
      return maxLeben('FurlocKrieger') - hp;
    }
    const axt = [await schlageWesen(clara, 'AxeFlint'), await schlageWesen(anna, 'AxeFlint'), await schlageWesen(bernd, 'AxeFlint')];
    console.log(`      Axe 15: Clara ${axt[0]}, Anna ${axt[1]}, Bernd ${axt[2]}`);
    check('Axe 15: Clara 15 (unchanged), Anna 16 (strength 5), Bernd 17 (strength 10)', axt[0] === 15 && axt[1] === 16 && axt[2] === 17);
    const schwert = [await schlageWesen(clara, 'SwordNorth'), await schlageWesen(bernd, 'SwordNorth')];
    check('Sword 12: Clara 12, Bernd 13', schwert[0] === 12 && schwert[1] === 13, schwert.join(','));
    const faust = [await schlageWesen(clara, ''), await schlageWesen(bernd, '')];
    check('Fist 4: Clara 4, Bernd 4 (4.4 rounds down)', faust[0] === 4 && faust[1] === 4, faust.join(','));
    const BAUM = getStableHash('Beech_small1');
    async function faelleBaum(s: Spieler): Promise<number> {
      const mitte = await platz(s, s.peer.position.x, s.peer.position.z);
      const baum = server.zdos.createZDO(BAUM, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      baum.setInt(HEALTH_MEMBER, 60);
      await blicke(s.ws);
      s.peer.stamina = 100;
      sendAttack(s.ws, mitte, 'AxeFlint');
      await warte(300);
      const hp = baum.getInt(HEALTH_MEMBER);
      if (!baum.destroyed) server.zdos.destroyZDO(baum.zdoid);
      return 60 - hp;
    }
    const baum = [await faelleBaum(clara), await faelleBaum(anna), await faelleBaum(bernd)];
    check('Tree with Axe: everyone takes exactly 15 off (harvest ignores strength)', baum.every((d) => d === 15), baum.join(','));

    // ── [6] No shared state ─────────────────────────────────────
    console.log('\n[6] Two players, two sets, at the same time');
    for (const s of alle) { s.peer.blockSeit = 0; s.peer.health = 100; }
    const vorher = [JSON.stringify(anna.peer.werte), JSON.stringify(bernd.peer.werte)];
    const gleichzeitig = [biss(anna), biss(bernd), biss(clara)];
    check('bites at the same moment: 4 / 4 / 8', gleichzeitig.join() === '4,4,8', gleichzeitig.join(','));
    await ziehAn(anna, []);
    check('Anna takes her gear off: her sums are zero, Bernd\'s are untouched',
      anna.peer.werte.armor === 0 && JSON.stringify(bernd.peer.werte) === vorher[1] && bernd.peer.werte.armor === 40);
    check('Anna now loses 8, Bernd still 4', biss(anna) === 8 && biss(bernd) === 4);
    check('sums are one object per peer, not shared', anna.peer.werte !== bernd.peer.werte && bernd.peer.werte !== clara.peer.werte);
    void vorher;

    // ══ N1 ═══════════════════════════════════════════════════════
    const sendPaket = (s: Spieler, typ: number, text: string): void => {
      const w = new Writer();
      w.writeString(text);
      s.ws.send(Buffer.concat([Buffer.from([typ]), w.toBuffer()]));
    };
    const iroIds = iro.map((t) => t.id);
    const krIds = kro.map((t) => t.id);

    console.log('\n[7] N1/B1: the client health display follows the maximum, one packet per change');
    await ziehAn(bernd, []);
    bernd.peer.health = 100;
    (bernd.ws as { _prozent?: number })._prozent = NaN;
    let n0 = bernd.anzahl();
    await ziehAn(bernd, iroIds);
    check('put on Ironward at full health (100/110): client shows 90.91 % within 250 ms', nah(bernd.healthProzent(), 100 / 110 * 100, 1e-3), `${bernd.healthProzent()}`);
    check('... with exactly ONE PlayerState packet', bernd.anzahl() - n0 === 1, `${bernd.anzahl() - n0} packets`);
    n0 = bernd.anzahl();
    await ziehAn(bernd, []);
    check('take it off without capping (health 100, max 100): client shows 100 %', nah(bernd.healthProzent(), 100, 1e-3) && bernd.anzahl() - n0 === 1, `${bernd.healthProzent()} %, ${bernd.anzahl() - n0} packets`);
    n0 = anna.anzahl();
    await ziehAn(anna, krIds);
    check('Crowshade (no vitality): maximum unchanged -> no packet at all', anna.anzahl() - n0 === 0, `${anna.anzahl() - n0}`);
    await ziehAn(bernd, iroIds);

    console.log('\n[8] N1/T1-T4: health rules that only gear + food + death together show');
    // T1: gear leaves the inventory -> inventarSync drops the parts and caps health.
    bernd.peer.health = 110;
    for (const t of iro) bernd.peer.inventar.removeByName(t.item, 1);
    zugriff.inventarSync(bernd.peer);
    check('T1 items gone: inventarSync drops the parts (armor 0) and caps health 110 -> 100', bernd.peer.werte.armor === 0 && bernd.peer.health === 100, `armor ${bernd.peer.werte.armor}, health ${bernd.peer.health}`);
    for (const t of iro) gib(bernd, t.item);
    await ziehAn(bernd, iroIds);
    // T2: the food buff runs out -> health is capped to the GEAR maximum (110), not to 100.
    bernd.peer.foodBonus = 20; bernd.peer.foodBis = Date.now() + 400; bernd.peer.health = 125;
    await warte(2500);
    check('T2 food ends: health 125 -> 110 (gear maximum), buff cleared', bernd.peer.health === 110 && bernd.peer.foodBis === 0, `health ${bernd.peer.health}`);
    // T3: eating heals up to the gear maximum + food bonus.
    bernd.peer.health = 105;
    gib(bernd, 'CookedMeat');
    sendPaket(bernd, PacketType.Eat, 'CookedMeat');
    await warte(300);
    const b30 = ESSEN.CookedMeat!.bonus;
    check(`T3 eating (+10, max 110+${b30}): health 105 -> 115 (not capped at 100)`, bernd.peer.health === 115, `${bernd.peer.health}`);
    // T4: death restores the gear maximum WITHOUT the food bonus (food still active here).
    check('T4 precondition: food is active', bernd.peer.foodBis > Date.now() && zugriff.maxHealth(bernd.peer) === 110 + b30);
    bernd.peer.health = 3; bernd.peer.blockSeit = 0;
    zugriff.applyCreatureAttack({ ...bernd.peer.position }, 8, 2.4, bernd.peer.worldId, bernd.peer.position);
    check('T4 death with food active: health 110 (gear maximum), not 140', bernd.peer.health === 110, `${bernd.peer.health}`);
    bernd.peer.foodBis = 0; bernd.peer.foodBonus = 0; bernd.peer.health = 100;
    await platz(bernd, 400, 200);

    console.log('\n[9] N1/B3: float residue after many armored blows is death');
    // Review example H=120 / R16: Waldhueter chest + mantle (armor 11 + 5 = 16, vitality 4 -> 108) plus a food bonus of 12.
    const wild = ['wildwarden_vest', 'wildwarden_mantle'].map((id) => SET_TEILE.find((t) => t.id === id)!);
    for (const t of wild) gib(bernd, t.item);
    await ziehAn(bernd, wild.map((t) => t.id));
    bernd.peer.foodBonus = 12; bernd.peer.foodBis = Date.now() + 120_000;
    const max9 = zugriff.maxHealth(bernd.peer);
    check('setup: armor 16, maximum 120', bernd.peer.werte.armor === 16 && max9 === 120, `armor ${bernd.peer.werte.armor}, max ${max9}`);
    const dR = eingehenderSchaden(8, 16);
    let alt = 120; let altN = 0;
    while (alt > 0 && altN < 500) { alt = Math.max(0, alt - dR); altN++; }
    let neu = 120; let neuN = 0;
    while (neu > 0 && neuN < 500) { neu = lebenNachSchaden(neu, dR); neuN++; }
    check(`arithmetic: the old code needs ${altN} blows, the rule ${neuN}`, neuN === 21 && altN === 22);
    bernd.peer.health = 120; bernd.peer.blockSeit = 0;
    let gebissen = 0; let tot = false; let vorTod = 0;
    while (!tot && gebissen < 60) {
      vorTod = bernd.peer.health;
      zugriff.applyCreatureAttack({ ...bernd.peer.position }, 8, 2.4, bernd.peer.worldId, bernd.peer.position);
      gebissen++;
      tot = bernd.peer.health === 108; // the death path resets to the gear maximum without food
    }
    check('the 21st blow kills (death path ran, health reset to 108), not the 22nd', tot && gebissen === 21, `${gebissen} blows, health ${bernd.peer.health}, before the last blow ${vorTod}`);
    bernd.peer.foodBis = 0; bernd.peer.foodBonus = 0; bernd.peer.health = 100;
    await platz(bernd, 400, 200);
    await ziehAn(bernd, iroIds);

    console.log('\n[10] N1/B2: switching the body drops parts that do not fit, values follow');
    await ziehAn(anna, krIds);
    check('precondition: Anna wears male Crowshade (armor 40)', anna.peer.werte.armor === 40);
    sendPaket(anna, PacketType.SetFigur, 'wikingerin');
    await warte(300);
    check('after SetFigur wikingerin: figure changed, male parts gone, armor/agility/strength 0',
      anna.peer.figur === 'wikingerin' && !krIds.some((id) => anna.peer.ruestung.includes(id)) && anna.peer.werte.armor === 0 && anna.peer.werte.agility === 0 && anna.peer.werte.strength === 0,
      `figur ${anna.peer.figur}, ruestung "${anna.peer.ruestung}", armor ${anna.peer.werte.armor}`);
    sendPaket(anna, PacketType.SetFigur, 'wikinger');
    await warte(300);
    check('and back: figure wikinger again, nothing worn', anna.peer.figur === 'wikinger' && anna.peer.werte.armor === 0);
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
