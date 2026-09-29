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
  HEALTH_MEMBER, PacketType, SET_TEILE, getStableHash, maxLeben, ruestungZu, REGLER, type Vector3,
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

interface Spieler { ws: WebSocket; peer: Peer; healthProzent: () => number }

function verbinde(name: string): Promise<WebSocket & { _prozent?: number }> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as WebSocket & { _prozent?: number };
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
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
    maxHealth(peer: Peer): number;
    sendPlayerState(peer: Peer): void;
    gebeItem(peer: Peer, name: string, amount: number): void;
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
    const mk = (ws: WebSocket & { _prozent?: number }, n: string): Spieler => ({ ws, peer: hole(n), healthProzent: () => ws._prozent ?? NaN });
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
    for (const s of alle) s.peer.paradeBis = 0;
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
    // Parry: armor is applied AFTER the parry check.
    anna.peer.health = 100; anna.peer.paradeBis = Date.now() + 5000;
    zugriff.applyCreatureAttack({ ...anna.peer.position }, 8, 2.4, anna.peer.worldId, anna.peer.position);
    check('parried blow: no damage at all, parry window used up', anna.peer.health === 100 && anna.peer.paradeBis === 0);
    // The real tick path: a Furloc warrior (damage 8) hunts the player, the blow arrives through AggroSystem
    // -> applyCreatureAttack. Counted blows x expected loss per blow = measured health loss.
    {
      const schlaege: number[] = [];
      const echt = server.aggro.onSchlag;
      server.aggro.onSchlag = (pos, schaden, radius) => { schlaege.push(schaden); echt?.(pos, schaden, radius); };
      const FURLOC_HASH = getStableHash('FurlocKrieger');
      for (const [s, erwartet] of [[clara, 8], [anna, 4]] as const) {
        s.peer.health = 100; s.peer.paradeBis = 0; schlaege.length = 0;
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
    bernd.peer.health = 3; bernd.peer.paradeBis = 0;
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
    for (const s of alle) { s.peer.paradeBis = 0; s.peer.health = 100; }
    const vorher = [JSON.stringify(anna.peer.werte), JSON.stringify(bernd.peer.werte)];
    const gleichzeitig = [biss(anna), biss(bernd), biss(clara)];
    check('bites at the same moment: 4 / 4 / 8', gleichzeitig.join() === '4,4,8', gleichzeitig.join(','));
    await ziehAn(anna, []);
    check('Anna takes her gear off: her sums are zero, Bernd\'s are untouched',
      anna.peer.werte.armor === 0 && JSON.stringify(bernd.peer.werte) === vorher[1] && bernd.peer.werte.armor === 40);
    check('Anna now loses 8, Bernd still 4', biss(anna) === 8 && biss(bernd) === 4);
    check('sums are one object per peer, not shared', anna.peer.werte !== bernd.peer.werte && bernd.peer.werte !== clara.peer.werte);
    void vorher;
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
