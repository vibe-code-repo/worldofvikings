/**
 * D3-K4: the server side of the dodge roll (spiel/Rolle.ts, PacketType.Rolle = 90) and the jump bill.
 *
 *  [1] The module on a stand-in peer with a fixed clock: accept (stamina -10, state, block ended), each reason of a
 *      refusal (nothing changes, the client is told), the lock of 0.5 s, the slices of movement, reset, the jump bill
 *      (three jump flags in one second pay two).
 *  [2] The path against the REAL collision (`Spielerbewegung` over a test world of boxes): a free roll covers 4.853 m,
 *      a wall in 1 m refuses it, a wall beyond the path does not, a wall at 45 degrees (sliding) refuses it, the path
 *      driven in 50 ms slices equals the preview, and no slice passes through a wall.
 *  [3] Over the real packet path (one WebSocket player): the free roll (path 4.85 +- 0.1 m, stamina -10, WASD ignored),
 *      the wolf hits at 0.1 s, clip length - 0.05 s (no damage) and clip length + 0.05 s (full damage), a roll out of
 *      a block (the client gets Block false), the lock over the wire, a swing during the roll is dropped, a wall in
 *      front of her (refused, stamina unchanged, the client gets Rolle false and the message), a dead player's
 *      packet, three jumps in one second.
 *  [4] The messages are catalogue keys that exist in German and English.
 *
 * Run: npx tsx server/test/d3-rolle.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, rmSync } from 'fs';
import { PacketType, eingehenderSchaden, npcKampf, type Vector3 } from '@wov/shared';
import {
  ROLLE_ABKLINGZEIT_MS, ROLLE_AUSDAUER, ROLLE_BEWEGUNG_MS, ROLLE_DAUER_MS, ROLLE_WEG_M, SPRUNG_AUSDAUER,
} from '@wov/shared/src/kampf/rolle.js';
import { SCHRITT_LAENGE } from '@wov/shared/src/bewegung/masse.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import { Spielerbewegung } from '../src/world/Spielerbewegung.js';
import type { KollisionsForm, Vek3 } from '@wov/shared/src/kollision/form.js';
import { blockPaket } from '../src/spiel/Block.js';
import { rolleLaeuft, rollePaket, rolleTakt, rolleUnverwundbar, rolleZuruecksetzen, sprungKosten, type RollePeer } from '../src/spiel/Rolle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d3-rolle');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, Attack: 46, AdminCommand: 53, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nah = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

// ── [1] the module on a stand-in peer ────────────────────────────────────
interface Gesendet { typ: number; inhalt: string }
type Attrappe = RollePeer & { gesendet: Gesendet[] };
function attrappe(): Attrappe {
  const gesendet: Gesendet[] = [];
  return {
    blockSeit: 0, blockTaktZeit: 0, blockSperreBis: 0, blockOhneParade: false, stamina: 100, staminaZuletztVerbraucht: 0,
    waffe: 'SwordNorth', flying: false, totBis: 0, blickYaw: 0, position: { x: 0, y: 0, z: 0 },
    rolleStart: 0, rolleBis: 0, rolleZeit: 0, rolleX: 0, rolleZ: 0, rolleSperreBis: 0, sprungSperreBis: 0,
    gesendet,
    sendPacketWith(typ: PacketType, schreibe: (w: Writer) => void): void {
      const w = new Writer();
      schreibe(w);
      const r = new Reader(w.toBuffer());
      gesendet.push({ typ, inhalt: typ === PacketType.InteractResult ? (r.readBool(), r.readString()) : String(r.readBool()) });
    },
  } as Attrappe;
}
const frei = { imWasser: false, freiraum: null };
const rolleAus = (p: Attrappe): number => p.gesendet.filter((g) => g.typ === PacketType.Rolle && g.inhalt === 'false').length;
const zustand = (p: Attrappe): string => `${p.rolleStart}/${p.rolleBis}/${p.rolleZeit}/${p.rolleSperreBis}/${p.stamina}`;

console.log('\n[1] spiel/Rolle.ts on a stand-in peer (fixed clock)');
{
  const p = attrappe();
  const ok = rollePaket(p, 0, 10_000, frei);
  check('accepted: stamina 100 - 10, stamp of the drain, roll from 10000 to 10875', ok && p.stamina === 90 && p.staminaZuletztVerbraucht === 10_000 && p.rolleStart === 10_000 && p.rolleBis === 10_000 + ROLLE_DAUER_MS && p.rolleZeit === 10_000);
  check('the direction is (0, -1) for yaw 0, a unit vector', nah(p.rolleX, 0, 1e-12) && nah(p.rolleZ, -1, 1e-12));
  check('the lock runs 0.5 s after the end (until 11375)', p.rolleSperreBis === 10_000 + ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
  check('nothing was sent to the client on success', p.gesendet.length === 0);
  check('rolleLaeuft: true at 10874, false at 10875', rolleLaeuft(p, 10_874) && !rolleLaeuft(p, 10_875));
  check('invulnerable the whole clip: 10000, 10100, 10825, 10874 yes; 10875, 10925 no', [10_000, 10_100, 10_825, 10_874].every((t) => rolleUnverwundbar(p, t)) && ![10_875, 10_925].some((t) => rolleUnverwundbar(p, t)));
  const zweite = rollePaket(p, 0, 10_100, frei);
  check('a second roll during the first: refused, nothing changes', !zweite && p.stamina === 90 && p.rolleStart === 10_000 && rolleAus(p) === 1);
  const sperre = rollePaket(p, 0, 11_374, frei);
  check('1 ms before the lock ends: refused', !sperre && p.stamina === 90 && rolleAus(p) === 2);
  const danach = rollePaket(p, 0, 11_375, frei);
  check('exactly when the lock ends: accepted again (stamina 80)', danach && p.stamina === 80 && p.rolleStart === 11_375);
}
{
  // Each reason: nothing changes but the message to the client.
  const faelle: Array<[string, (p: Attrappe) => void, Partial<{ imWasser: boolean }>, number, string | null]> = [
    ['dead', (p) => { p.totBis = 99_999; }, {}, 0, null],
    ['flight mode (admin)', (p) => { p.flying = true; }, {}, 0, null],
    ['in the water', () => undefined, { imWasser: true }, 0, null],
    ['stamina 9.99', (p) => { p.stamina = 9.99; }, {}, 0, '@kampf.zu_erschoepft'],
    ['NaN direction', () => undefined, {}, Number.NaN, null],
    ['infinite direction', () => undefined, {}, Infinity, null],
  ];
  for (const [name, setze, umfeld, yaw, text] of faelle) {
    const p = attrappe();
    setze(p);
    const vorher = zustand(p);
    const ok = rollePaket(p, yaw, 5000, { ...frei, ...umfeld });
    check(`refused (${name}): no state, no cost, the client is told (Rolle false)${text ? ' and gets ' + text : ''}`,
      !ok && zustand(p) === vorher && rolleAus(p) === 1 && (text === null ? !p.gesendet.some((g) => g.typ === PacketType.InteractResult) : p.gesendet.some((g) => g.inhalt === text)), JSON.stringify(p.gesendet));
  }
  const g10 = attrappe();
  g10.stamina = 10;
  check('stamina exactly 10: accepted, stamina 0', rollePaket(g10, 0, 5000, frei) && g10.stamina === 0);
}
{
  // The block ends, the client is told.
  const p = attrappe();
  blockPaket(p, true, 1000);
  check('(set-up) a block is held', p.blockSeit === 1000);
  rollePaket(p, 0, 1500, frei);
  check('a roll out of a block: the block is over (blockSeit 0), the lock runs, the client got Block false',
    p.blockSeit === 0 && p.blockSperreBis === 1500 + 500 && p.gesendet.some((g) => g.typ === PacketType.Block && g.inhalt === 'false'), JSON.stringify(p.gesendet));
  check('... and the held time was paid before the 10 (stamina 100 - 1 - 10)', nah(p.stamina, 89, 1e-9), `${p.stamina}`);
  blockPaket(p, true, 1600);
  check('no block during the roll: refused, the client is told again, no state', p.blockSeit === 0 && p.gesendet.filter((g) => g.typ === PacketType.Block).length === 2);
  blockPaket(p, true, 1500 + ROLLE_DAUER_MS + 1);
  check('after the roll the block can begin again', p.blockSeit === 1500 + ROLLE_DAUER_MS + 1);
}
{
  // The slices of movement.
  for (const takt of [10, 50, 100, 333, 1000]) {
    const p = attrappe();
    rollePaket(p, 0, 20_000, frei);
    let summe = 0;
    let rollteNoch = 0;
    for (let t = 20_000; t <= 22_500; t += takt) {
      const r = rolleTakt(p, t);
      summe += r.dt;
      if (r.rollt) rollteNoch++;
    }
    check(`packets every ${takt} ms: the movement adds up to 0.8333 s`, nah(summe, ROLLE_BEWEGUNG_MS / 1000, 1e-9), `${summe}`);
    check(`packets every ${takt} ms: the tick says "rolling" only while there is movement or the clip runs`, rollteNoch >= 1 && !rolleTakt(p, 23_000).rollt);
  }
  const p = attrappe();
  check('no roll: no movement from the tick', !rolleTakt(p, 1000).rollt);
  rollePaket(p, 0, 30_000, frei);
  const mitte = rolleTakt(p, 30_850); // after the movement time (833 ms), inside the clip (875)
  check('at 850 ms: still "rolling" (the clip runs), the remaining 17 ms of movement are paid', mitte.rollt && nah(mitte.dt, (ROLLE_BEWEGUNG_MS - 0) / 1000, 1e-9), `${mitte.dt}`);
  const spaet = rolleTakt(p, 30_860);
  check('the next packet in the clip: rolling, no more movement', spaet.rollt && spaet.dt === 0);
  check('after the clip: not rolling', !rolleTakt(p, 30_875).rollt);
}
{
  const p = attrappe();
  rollePaket(p, 0, 1000, frei);
  p.gesendet.length = 0;
  rolleZuruecksetzen(p);
  check('reset (death, world change): no roll, no lock, no jump lock; a roll that ran is announced (Rolle false)', p.rolleBis === 0 && p.rolleSperreBis === 0 && p.rolleStart === 0 && rolleAus(p) === 1 && p.sprungSperreBis === 0);
  rolleZuruecksetzen(p);
  check('a reset without a roll sends nothing', rolleAus(p) === 1);
  const ohne = { rolleStart: undefined, rolleBis: undefined, rolleSperreBis: undefined, stamina: 100, sendPacketWith: () => undefined } as unknown as RollePeer;
  check('a peer without the roll fields (a stand-in of another test): no roll, no invulnerability', !rolleLaeuft(ohne, 1) && !rolleUnverwundbar(ohne, 1));
}
{
  const p = attrappe();
  check('jump flag false: nothing billed', !sprungKosten(p, false, 1000) && p.stamina === 100);
  check('jump at 0: billed (stamina 95), lock to 800', sprungKosten(p, true, 1000) && p.stamina === 95 && p.sprungSperreBis === 1800);
  check('jump at 400 ms: not billed', !sprungKosten(p, true, 1400) && p.stamina === 95);
  check('jump at 900 ms: billed (stamina 90)', sprungKosten(p, true, 1900) && p.stamina === 90 && p.sprungSperreBis === 2700);
  check('every billed jump sets the stamp of the drain (no regeneration right after)', p.staminaZuletztVerbraucht === 1900);
  const arm = attrappe();
  arm.stamina = 4.9;
  check('stamina 4.9: no jump billed, no lock', !sprungKosten(arm, true, 1000) && arm.stamina === 4.9 && arm.sprungSperreBis === 0);
}

// ── [2] the path against the real collision ──────────────────────────────
console.log('\n[2] The path against the real collision');
const kiste = (min: Vek3, max: Vek3): KollisionsForm => ({ art: 'kiste', min, max });
function weltMit(formen: Array<{ form: KollisionsForm; position: Vek3 }>, hoehe = 0): Spielerbewegung {
  const z = createWovServer({ port: 0, worldSeed: 'KxSYuZquuw', worldFeatures: false });
  z.init();
  const kw = new Kollisionswelt(z.zdos, z.prefabs, () => hoehe); // flat ground at the player's height
  const nah2 = kw.nahfeldAus(formen);
  (kw as unknown as { nahfeld: () => unknown }).nahfeld = () => nah2;
  return new Spielerbewegung(kw);
}
const horizontal = (a: Vek3, b: Vek3): number => Math.hypot(a.x - b.x, a.z - b.z);
{
  const start = { x: 0, y: 0, z: 0 };
  const offen = weltMit([]);
  const dist = offen.rolleVorschau(start, 0, -1);
  check('free ground: the roll covers 4.853 m (+- 0.01)', nah(dist, ROLLE_WEG_M, 0.01), `${dist.toFixed(4)} m`);
  const schraeg = offen.rolleVorschau(start, Math.SQRT1_2, -Math.SQRT1_2);
  check('free ground, diagonal: the same path', nah(schraeg, ROLLE_WEG_M, 0.01), `${schraeg.toFixed(4)} m`);

  // A wall (thick, long) whose face is `abstand` metres in front of the player (towards -z).
  const wand = (abstand: number): Spielerbewegung => weltMit([{ form: kiste({ x: -50, y: -1, z: -2 }, { x: 50, y: 4, z: 2 }), position: { x: 0, y: 0, z: -(abstand + 2) } }]);
  const w1 = wand(1).rolleVorschau(start, 0, -1);
  check('a wall 1 m in front: the preview is short of 80 % (rolls only ~0.6 m, the body radius 0.4 keeps it off)', w1 < 1 && w1 < 3.88, `${w1.toFixed(3)} m`);
  const w6 = wand(6).rolleVorschau(start, 0, -1);
  check('a wall 6 m in front: the full path (4.853 m)', nah(w6, ROLLE_WEG_M, 0.01), `${w6.toFixed(3)} m`);
  const w4 = wand(4.4).rolleVorschau(start, 0, -1);
  check('a wall 4.4 m in front: 4.0 m of path, above the 80 % (3.88 m): free', w4 > 3.88 && w4 < 4.853, `${w4.toFixed(3)} m`);
  const w3 = wand(4.2).rolleVorschau(start, 0, -1);
  check('a wall 4.2 m in front: 3.8 m of path, below 80 %: refused', w3 < 3.88, `${w3.toFixed(3)} m`);
  const gleit = wand(1).rolleVorschau(start, Math.SQRT1_2, -Math.SQRT1_2);
  check('a wall at 45 degrees (the figure slides along it): about 3.4 m, below 80 %', gleit < 3.88 && gleit > 2, `${gleit.toFixed(3)} m`);
  const flach = wand(1).rolleVorschau(start, Math.sin(1.22), -Math.cos(1.22));
  check('a glancing wall (the path 20 degrees off the wall): the slide keeps most of the path (>80 %, free)', flach > 3.88, `${flach.toFixed(3)} m`);
  const hinten = wand(1).rolleVorschau(start, 0, 1);
  check('rolling AWAY from the wall: the full path', nah(hinten, ROLLE_WEG_M, 0.01), `${hinten.toFixed(3)} m`);

  // Driving the path in 50 ms packets equals the preview; no packet passes the wall.
  const gehe = (sb: Spielerbewegung, dx: number, dz: number, takt: number): { x: number; y: number; z: number } => {
    let pos = { x: 0, y: 0, z: 0 };
    const w = { position: pos };
    let rest = ROLLE_BEWEGUNG_MS / 1000;
    while (rest > 1e-12) {
      const dt = Math.min(takt / 1000, rest);
      pos = sb.rollSchritt(w, dx, dz, dt);
      w.position = pos;
      rest -= dt;
    }
    return pos;
  };
  for (const takt of [16, 50, 100]) {
    const e = gehe(offen, 0, -1, takt);
    check(`free: ${takt} ms packets cover the same 4.853 m as the preview (+- 0.02)`, nah(horizontal(e, start), dist, 0.02), `${horizontal(e, start).toFixed(4)} m`);
  }
  const vorWand = gehe(wand(1), 0, -1, 50);
  check('a wall 1 m in front: the roll driven in packets stops before it (z > -0.7), no tunnelling', vorWand.z > -0.7 && vorWand.z <= 0, `z ${vorWand.z.toFixed(3)}`);
  const dick = gehe(weltMit([{ form: kiste({ x: -50, y: -1, z: -0.1 }, { x: 50, y: 4, z: 0.1 }), position: { x: 0, y: 0, z: -2 } }]), 0, -1, 400);
  check('a 20 cm thin wall in 1.9 m, packets of 400 ms (the slice is 2.3 m long): the slice does not jump over it', dick.z > -1.6, `z ${dick.z.toFixed(3)}`);
  check('one slice never exceeds tempo * dt (the step is chopped below 1/60 s)', SCHRITT_LAENGE > 0);
}

// ── [3] over the real packet path ────────────────────────────────────────
interface Socke extends WebSocket {
  meldungen: string[]; bloecke: boolean[]; rollen: boolean[]; treffer: number;
}
function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.meldungen = []; ws.bloecke = []; ws.rollen = []; ws.treffer = 0;
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
      } else if (type === PacketType.InteractResult) {
        r.readBool();
        ws.meldungen.push(r.readString());
      } else if (type === PacketType.Block) {
        ws.bloecke.push(r.readBool());
      } else if (type === PacketType.Rolle) {
        ws.rollen.push(r.readBool());
      } else if (type === PacketType.PlayerTreffer) {
        ws.treffer++;
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
const sendRolle = (ws: WebSocket, yaw: number): void => {
  ws.send(Buffer.concat([Buffer.from([PacketType.Rolle]), new Writer().writeFloat32(yaw).toBuffer()]));
};
const sendBlock = (ws: WebSocket, an: boolean): void => {
  ws.send(Buffer.concat([Buffer.from([PacketType.Block]), new Writer().writeBool(an).toBuffer()]));
};
let seq = 0;
const sendInput = (ws: WebSocket, yaw: number, moveX: number, moveZ: number, rennt: boolean, springt = false): void => {
  const w = new Writer();
  w.writeInt32(++seq);
  w.writeFloat32(moveX);
  w.writeFloat32(moveZ);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(rennt);
  w.writeBool(springt);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
};
async function eingaben(ws: WebSocket, yaw: number, dauerMs: number, moveX = 0, moveZ = 0): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) { sendInput(ws, yaw, moveX, moveZ, false); await warte(50); }
}
const sendAttack = (ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void => {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'd3-rolle',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
    spielerbewegung: Spielerbewegung;
  };
  const sockets: WebSocket[] = [];
  try {
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna: Peer = server.net.getPeers().find((x) => x.name === 'Anna')!;
    sendAdmin(ws, 'teleport 200 200');
    await warte(350);
    await eingaben(ws, 0, 400);
    const wolf = npcKampf('Wolf').schaden;
    const ruest = anna.werte.armor;

    console.log('\n[3] The Rolle packet and the play test');
    check('the packet type is 90', PacketType.Rolle === 90);
    check('start: full life and stamina, no armour', anna.health === 100 && anna.stamina === 100 && ruest === 0, `armour ${ruest}`);

    // ── the free roll ──
    const von = { x: anna.position.x, y: anna.position.y, z: anna.position.z };
    sendRolle(ws, 0);
    await warte(60);
    check('the roll begins: state set, stamina -10 at once', anna.rolleBis > 0 && nah(anna.stamina, 90, 0.5), `stamina ${anna.stamina}, rolleBis ${anna.rolleBis}`);
    const t0 = anna.rolleStart;
    // WASD (full right + back) must not matter while the roll runs
    // packets up to ~860 ms into the roll (past the 833 ms of movement, inside the 875 ms of the clip), none after it
    for (let t = 0; t <= 800; t += 50) { sendInput(ws, 0, 1, 1, true); await warte(50); }
    await warte(100);
    const weg = Math.hypot(anna.position.x - von.x, anna.position.z - von.z);
    check('THE FREE ROLL: 4.85 +- 0.1 m along -z, the running WASD of the packets ignored', nah(weg, ROLLE_WEG_M, 0.1) && nah(anna.position.x, von.x, 0.05) && anna.position.z < von.z - 4.7, `${weg.toFixed(3)} m, x ${(anna.position.x - von.x).toFixed(3)}, z ${(anna.position.z - von.z).toFixed(3)}`);
    check('stamina -10 (not more: running does not cost during the roll)', nah(anna.stamina, 90, 1), `${anna.stamina}`);
    check('the roll is over (the clip + the packets): rolleBis passed, no client message', !rolleLaeuft(anna, Date.now()) && ws.rollen.length === 0, JSON.stringify(ws.rollen));
    check('(timing) the roll ran its clip length', anna.rolleBis - t0 === ROLLE_DAUER_MS);

    // ── the lock over the wire ──
    await warte(600); // past the lock (0.5 s after the clip)
    anna.stamina = 100;
    sendRolle(ws, 0);
    await warte(60);
    const t1 = anna.rolleStart;
    check('a second roll ~1.4 s after the first (past the lock 0.5 s): accepted', anna.rolleBis > Date.now() && t1 > t0 + 1300, `${t1 - t0} ms later`);
    await warte(ROLLE_DAUER_MS + 20);
    check('(set-up) the second roll is over, the lock runs', !rolleLaeuft(anna, Date.now()) && Date.now() < anna.rolleSperreBis);
    ws.rollen.length = 0;
    const staminaVorher = anna.stamina;
    sendRolle(ws, 0);
    await warte(100);
    check('a roll in the lock: refused, nothing changes, the client got Rolle false', anna.rolleStart === t1 && anna.stamina >= staminaVorher && ws.rollen.join() === 'false', `${JSON.stringify(ws.rollen)}, stamina ${anna.stamina}`);
    await warte(ROLLE_ABKLINGZEIT_MS + 100);

    // ── the wolf ──
    anna.health = 100; anna.stamina = 100;
    ws.meldungen.length = 0;
    const von2 = (dx: number, dz: number): Vector3 => ({ x: anna.position.x + dx, y: anna.position.y, z: anna.position.z + dz });
    sendRolle(ws, 0);
    const warteBis = async (ms: number): Promise<number> => {
      while (Date.now() - anna.rolleStart < ms) await warte(1);
      return Date.now() - anna.rolleStart;
    };
    await warte(30);
    const e1 = await warteBis(100);
    zugriff.applyCreatureAttack(von2(0, -2), wolf, 2.4, anna.worldId, anna.position);
    check(`WOLF at ${e1} ms into the roll: no damage`, anna.health === 100, `life ${anna.health}`);
    const e2 = await warteBis(ROLLE_DAUER_MS - 50);
    zugriff.applyCreatureAttack(von2(0, -2), wolf, 2.4, anna.worldId, anna.position);
    check(`WOLF at ${e2} ms (clip length - 50): no damage`, e2 < ROLLE_DAUER_MS && anna.health === 100, `life ${anna.health}`);
    await warte(100);
    check('... and the messages "@kampf.ausgewichen" reached the client (one per blow)', ws.meldungen.filter((m) => m === '@kampf.ausgewichen').length === 2, JSON.stringify(ws.meldungen));
    const e3 = await warteBis(ROLLE_DAUER_MS + 50);
    zugriff.applyCreatureAttack(von2(0, -2), wolf, 2.4, anna.worldId, anna.position);
    check(`WOLF at ${e3} ms (clip length + 50): the full blow`, e3 >= ROLLE_DAUER_MS && nah(100 - anna.health, eingehenderSchaden(wolf, ruest), 1e-9), `life ${anna.health}`);
    await warte(ROLLE_ABKLINGZEIT_MS + 200);

    // ── a roll out of a block ──
    anna.health = 100; anna.stamina = 100; anna.waffe = 'SwordNorth';
    ws.bloecke.length = 0;
    sendBlock(ws, true);
    await warte(250);
    check('(set-up) the block is held', anna.blockSeit > 0 && ws.bloecke.length === 0);
    sendRolle(ws, 0);
    await warte(100);
    check('ROLL OUT OF THE BLOCK: the block is over and the client got Block false (the roll began)', anna.blockSeit === 0 && ws.bloecke.join() === 'false' && anna.rolleBis > Date.now() - 100, `${JSON.stringify(ws.bloecke)}`);
    sendBlock(ws, true);
    await warte(100);
    check('no block during the roll: the packet is refused (Block false again)', anna.blockSeit === 0 && ws.bloecke.join() === 'false,false', JSON.stringify(ws.bloecke));
    // a swing during the roll is dropped (it would cost stamina and end nothing)
    const st = anna.stamina;
    sendAttack(ws, anna.position, 'SwordNorth', 0);
    await warte(80);
    check('a swing during the roll is dropped: no stamina spent', nah(anna.stamina, st, 0.3), `${st} -> ${anna.stamina}`);
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);

    // ── the wall in front of her ──
    anna.health = 100; anna.stamina = 100; ws.rollen.length = 0; ws.meldungen.length = 0;
    const echte = zugriff.spielerbewegung;
    zugriff.spielerbewegung = weltMit([{ form: kiste({ x: -50, y: -1, z: -2 }, { x: 50, y: 4, z: 2 }), position: { x: anna.position.x, y: anna.position.y, z: anna.position.z - 3 } }], anna.position.y);
    const start = anna.rolleStart;
    sendRolle(ws, 0);
    await warte(150);
    check('A WALL 1 m IN FRONT: the roll is refused, stamina unchanged (100), no roll state', anna.stamina === 100 && anna.rolleStart === start && ws.rollen.join() === 'false', `stamina ${anna.stamina}, ${JSON.stringify(ws.rollen)}`);
    check('... the client got the message "@kampf.rolle_blockiert"', ws.meldungen.includes('@kampf.rolle_blockiert'), JSON.stringify(ws.meldungen));
    sendRolle(ws, Math.PI);
    await warte(150);
    check('rolling AWAY from that wall (yaw 180 degrees) is allowed', anna.stamina === 90 && anna.rolleStart > start);
    zugriff.spielerbewegung = echte;
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);

    // ── dead ──
    anna.stamina = 100;
    anna.totBis = Date.now() + 5000;
    const sd = anna.rolleStart;
    sendRolle(ws, 0);
    await warte(100);
    check('a dead player\'s Rolle packet is dropped', anna.rolleStart === sd && anna.stamina === 100);
    anna.totBis = 0;

    // ── death and change of world end the roll ──
    anna.stamina = 100; anna.sprungSperreBis = 0;
    sendRolle(ws, 0);
    await warte(100);
    check('(set-up) a roll runs', rolleLaeuft(anna, Date.now()));
    ws.rollen.length = 0;
    (server as unknown as { stirb(p: Peer, clip: string): void }).stirb(anna, 'tod_vorn');
    await warte(100);
    check('DEATH during a roll: no roll, no lock, the client got Rolle false', anna.rolleBis === 0 && anna.rolleSperreBis === 0 && ws.rollen.join() === 'false', JSON.stringify(ws.rollen));
    anna.totBis = 0; anna.health = 100; anna.stamina = 100;
    sendRolle(ws, 0);
    await warte(100);
    check('(set-up) a roll runs again', rolleLaeuft(anna, Date.now()));
    anna.weltWechselVorbereiten();
    check('WORLD CHANGE (weltWechselVorbereiten) ends the roll and clears the lock', anna.rolleBis === 0 && anna.rolleSperreBis === 0 && anna.rolleStart === 0);
    await warte(100);

    // ── the jump ──
    anna.stamina = 100; anna.sprungSperreBis = 0; anna.staminaZuletztVerbraucht = 0;
    // a simpler schedule: packets at 0, 400, 900 ms with the jump flag
    anna.stamina = 100; anna.sprungSperreBis = 0;
    const tt = Date.now();
    sendInput(ws, 0, 0, 0, false, true);
    await warte(400 - (Date.now() - tt));
    sendInput(ws, 0, 0, 0, false, true);
    await warte(900 - (Date.now() - tt));
    sendInput(ws, 0, 0, 0, false, true);
    await warte(100);
    check('THREE JUMPS in 1 s (at 0, 0.4, 0.9 s): two are billed (10 stamina), the one inside the lock is free', nah(anna.stamina, 100 - 2 * SPRUNG_AUSDAUER, 0.6), `stamina ${anna.stamina}`);
    check('... and the lock of the last one is set', anna.sprungSperreBis > Date.now());
    anna.stamina = 3; anna.sprungSperreBis = 0;
    sendInput(ws, 0, 0, 0, false, true);
    await warte(100);
    check('a jump without the 5 stamina is not billed (stamina stays, no lock)', anna.stamina >= 3 && anna.stamina < 5 && anna.sprungSperreBis === 0, `${anna.stamina}`);
    anna.stamina = 100;
    for (let i = 0; i < 4; i++) { sendInput(ws, 0, 0, 0, false, false); await warte(50); }
    check('no jump flag: nothing billed', anna.stamina >= 100 - 0.01);
  } finally {
    for (const s of sockets) s.close();
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }

  // ── [4] the messages ──
  console.log('\n[4] The messages are catalogue keys');
  const lies = (f: string): Record<string, string> => JSON.parse(readFileSync(resolve(__dirname, '../../client/src/i18n/katalog', f), 'utf-8')) as Record<string, string>;
  const de = lies('de.json');
  const en = lies('en.json');
  for (const k of ['kampf.ausgewichen', 'kampf.rolle_blockiert', 'kampf.zu_erschoepft']) check(`"${k}" exists in de and en`, !!de[k] && !!en[k] && de[k] !== en[k], `${de[k]} / ${en[k]}`);

  console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
