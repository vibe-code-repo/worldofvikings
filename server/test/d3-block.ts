/**
 * D3-K1: the server side of the held block (spiel/Block.ts, PacketType.Block = 89).
 *
 *  [1] The module on a stand-in peer with a fixed clock: begin, the item in the hand, stamina 0, the click series (lock 0.5 s),
 *      holding 2 stamina per second over 5 s, the end at stamina 0, the end by an own swing, reset.
 *  [2] Over the real packet path (one WebSocket player): the packet, a refused begin, and the play test -
 *      a wolf strikes a blocking player from the front (life -30 %, stamina -4), in the parry window (life unchanged),
 *      from behind (full), with 3.9 stamina (break), a swing of her own and her death end the block, a dead
 *      player's Block packet is dropped, block speed (half) and no running while blocking, stamina 2/s.
 *  [3] The messages go through catalogue keys that exist in German and English.
 *
 * Run: npx tsx server/test/d3-block.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, rmSync } from 'fs';
import { PacketType, eingehenderSchaden, npcKampf, type Vector3 } from '@wov/shared';
import { BLOCK_SPERRE_MS } from '@wov/shared/src/kampf/block.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import { blockTakt, beendeBlock, beendeBlockDurchSchlag, blockHalteTakt, blockPaket, blockTrifft, blockZuruecksetzen, darfBlocken, type BlockPeer } from '../src/spiel/Block.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d3-block');
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

// ── [1] the module on a stand-in peer ────────────────────────────────────────────────
interface Gesendet { typ: number; inhalt: string }
function attrappe(waffe = 'SwordNorth'): BlockPeer & { gesendet: Gesendet[] } {
  const gesendet: Gesendet[] = [];
  return {
    blockSeit: 0, blockTaktZeit: 0, blockSperreBis: 0, blockOhneParade: false, stamina: 100, staminaZuletztVerbraucht: 0,
    waffe, flying: false, totBis: 0, blickYaw: 0, position: { x: 0, y: 0, z: 0 },
    gesendet,
    sendPacketWith(typ: PacketType, schreibe: (w: Writer) => void): void {
      const w = new Writer();
      schreibe(w);
      const r = new Reader(w.toBuffer());
      gesendet.push({ typ, inhalt: typ === PacketType.InteractResult ? (r.readBool(), r.readString()) : String(r.readBool()) });
    },
  } as BlockPeer & { gesendet: Gesendet[] };
}
const vorn: { x: number; z: number } = { x: 0, z: -2 };

console.log('\n[1] Spiel/Block.ts on a stand-in peer (fixed clock)');
{
  const p = attrappe('');
  check('fist: darfBlocken is false (the one provisional condition)', !darfBlocken(p) && darfBlocken(attrappe('Axt')));
  blockPaket(p, true, 1000);
  check('without an item in the hand the block is refused: no state, the client is told Block false', p.blockSeit === 0 && p.gesendet.length === 1 && p.gesendet[0]!.typ === PacketType.Block && p.gesendet[0]!.inhalt === 'false', JSON.stringify(p.gesendet));

  const q = attrappe();
  blockPaket(q, true, 1000);
  check('with an item: the block begins (blockSeit = now), with a parry window', q.blockSeit === 1000 && !q.blockOhneParade && q.gesendet.length === 0);
  blockPaket(q, true, 1100);
  check('a second "on" while held does not restart it (blockSeit unchanged)', q.blockSeit === 1000);
  blockPaket(q, false, 1300);
  check('"off": the block ends and the lock runs 0.5 s from the end', q.blockSeit === 0 && q.blockSperreBis === 1300 + BLOCK_SPERRE_MS && q.gesendet.length === 0, `${q.blockSperreBis}`);

  // Click series: no second parry window.
  const k = attrappe();
  blockPaket(k, true, 5000); blockPaket(k, false, 5050); blockPaket(k, true, 5100);
  check('click series: the third packet (50 ms after the end) opens a block WITHOUT parry window', k.blockSeit === 5100 && k.blockOhneParade);
  const tr = blockTrifft(k, vorn, 30, 5110);
  check('a blow 10 ms into that block is no parry (30 % of the damage)', tr.art === 'geblockt' && nah(tr.schaden, 9, 1e-9), JSON.stringify(tr));
  blockPaket(k, false, 5200); blockPaket(k, true, 5699);
  check('a new block 499 ms after the end: still locked', k.blockOhneParade);
  blockPaket(k, false, 5700); blockPaket(k, true, 6200);
  check('a new block exactly 500 ms after the end: the window is back', !k.blockOhneParade);
  blockPaket(k, false, 6300); blockPaket(k, true, 6799);
  check('499 ms after the end of the last one: locked again', k.blockOhneParade);
  const ersteres = attrappe();
  blockPaket(ersteres, true, 100);
  check('the very first block has a window (lock 0 in the past)', !ersteres.blockOhneParade);

  // Stamina 0: refused with the message.
  const m = attrappe();
  m.stamina = 0;
  blockPaket(m, true, 1000);
  check('stamina 0: no block, message "@kampf.zu_erschoepft" and Block false', m.blockSeit === 0 && m.gesendet.some((g) => g.typ === PacketType.InteractResult && g.inhalt === '@kampf.zu_erschoepft') && m.gesendet.some((g) => g.typ === PacketType.Block && g.inhalt === 'false'), JSON.stringify(m.gesendet));
  const f = attrappe(); f.flying = true;
  blockPaket(f, true, 1000);
  check('an admin in flight mode cannot block', f.blockSeit === 0);
  const t = attrappe(); t.totBis = 5000;
  blockPaket(t, true, 1000);
  check('a dead player cannot begin a block', t.blockSeit === 0);

  // Holding: 2/s over 5 s.
  const h = attrappe();
  blockPaket(h, true, 10_000);
  let jetzt = 10_000;
  let blockt = true;
  for (let i = 0; i < 100; i++) { jetzt += 50; blockt = blockHalteTakt(h, jetzt); }
  check('5 s of holding (100 ticks of 50 ms): stamina 90 +- 0.1, still blocking', nah(h.stamina, 90, 0.1) && blockt && h.blockSeit === 10_000, `${h.stamina}`);
  check('every tick sets the stamp of the last drain (no regeneration while held)', h.staminaZuletztVerbraucht === jetzt);
  const g = attrappe();
  blockPaket(g, true, 20_000);
  const erster = blockHalteTakt(g, 20_020);
  check('the first tick pays only the time the block was really held (20 ms, not the 0.5 s since the last packet)', nah(100 - g.stamina, 2 * 0.02, 1e-9) && erster, `${100 - g.stamina}`);

  // Ends at stamina 0.
  const e = attrappe();
  e.stamina = 0.04;
  blockPaket(e, true, 30_000);
  const nochBlockt = blockHalteTakt(e, 30_050);
  check('stamina runs out while held: the block ends, stamina 0, the lock starts, the client is told Block false', !nochBlockt && e.blockSeit === 0 && e.stamina === 0 && e.blockSperreBis === 30_050 + BLOCK_SPERRE_MS && e.gesendet.some((x) => x.typ === PacketType.Block && x.inhalt === 'false'), JSON.stringify(e.gesendet));
  check('no block held: the tick costs nothing and answers false', (() => { const n = attrappe(); return !blockHalteTakt(n, 1000) && n.stamina === 100; })());
  const fl = attrappe();
  blockPaket(fl, true, 1000); fl.flying = true;
  check('flight mode switched on while held: the tick ends the block', !blockHalteTakt(fl, 1050) && fl.blockSeit === 0);

  // B1: the time is billed by the SERVER clock, no cap: a silent client pays too.
  const stumm = attrappe();
  blockPaket(stumm, true, 50_000);
  blockHalteTakt(stumm, 50_050);
  const nachStumm = blockHalteTakt(stumm, 56_050); // 6 s without a packet
  check('B1: 6 s without an input packet cost 12 stamina (not a capped slice): 100 - 0.1 - 12', nah(stumm.stamina, 100 - 0.1 - 12, 1e-9) && nachStumm, `${stumm.stamina}`);
  const lang = attrappe();
  blockPaket(lang, true, 60_000);
  blockHalteTakt(lang, 60_010);
  blockHalteTakt(lang, 90_010); // 30 s of silence
  check('B1: 30 s of silence cost 60 stamina', nah(lang.stamina, 100 - 0.02 - 60, 1e-9), `${lang.stamina}`);
  const treffer = attrappe();
  blockPaket(treffer, true, 70_000);
  const tr1 = blockTrifft(treffer, vorn, 30, 70_000 + 10_000); // nothing sent for 10 s, then a blow
  check('B1: a blow bills the time held first (10 s = 20), then the 4 of the blow: 100 - 24', tr1.art === 'geblockt' && nah(treffer.stamina, 76, 1e-9), `${treffer.stamina}`);
  const leer = attrappe();
  blockPaket(leer, true, 80_000);
  const tr2 = blockTrifft(leer, vorn, 30, 80_000 + 60_000); // 60 s silent: the stamina is gone before the blow
  check('B1: a silent client that held 60 s holds nothing: stamina 0, block ended, the FULL blow', tr2.art === 'keiner' && tr2.schaden === 30 && leer.blockSeit === 0 && leer.stamina === 0, JSON.stringify(tr2));
  const takt = attrappe();
  blockPaket(takt, true, 90_000);
  blockTakt([takt], 90_000 + 4000);
  check('B1: the server tick bills a client that sends nothing (4 s = 8)', nah(takt.stamina, 92, 1e-9) && takt.blockSeit > 0, `${takt.stamina}`);
  blockTakt([takt], 90_000 + 200_000);
  check('B1: ... and ends the block when the stamina is gone, the client is told', takt.blockSeit === 0 && takt.gesendet.some((x) => x.typ === PacketType.Block && x.inhalt === 'false'));

  // B3: the item condition holds for the whole block.
  const hand = attrappe();
  blockPaket(hand, true, 100_000);
  hand.waffe = '';
  check('B3: item put away while held: the tick ends the block', !blockHalteTakt(hand, 100_050) && hand.blockSeit === 0 && hand.gesendet.some((x) => x.typ === PacketType.Block && x.inhalt === 'false'));
  const hand2 = attrappe();
  blockPaket(hand2, true, 110_000);
  hand2.waffe = '';
  const tr3 = blockTrifft(hand2, vorn, 30, 110_500);
  check('B3: item put away while held: the next blow is NOT blocked (full damage, no stamina cost for it) and the block is over', tr3.art === 'keiner' && tr3.schaden === 30 && hand2.blockSeit === 0 && hand2.stamina > 98, JSON.stringify(tr3));

  // An accepted swing of her own ends the block.
  const s = attrappe();
  blockPaket(s, true, 40_000);
  beendeBlockDurchSchlag(s, 40_300);
  check('an own swing ends the block, lock runs, the client is told', s.blockSeit === 0 && s.blockSperreBis === 40_300 + BLOCK_SPERRE_MS && s.gesendet.some((x) => x.typ === PacketType.Block && x.inhalt === 'false'), JSON.stringify(s.gesendet));
  const s2 = attrappe();
  beendeBlockDurchSchlag(s2, 1000);
  check('an own swing without a block changes nothing (no lock, no packet)', s2.blockSperreBis === 0 && s2.gesendet.length === 0);

  // Reset.
  const z = attrappe();
  blockPaket(z, true, 1000); beendeBlock(z, 1100);
  blockZuruecksetzen(z);
  check('reset (death, world change): block, lock and flag are cleared', z.blockSeit === 0 && z.blockSperreBis === 0 && !z.blockOhneParade);

  // Blow of the module: the messages and the state.
  const b = attrappe();
  blockPaket(b, true, 1000);
  const hit = blockTrifft(b, vorn, 10, 1500);
  check('a blow: stamp of the last drain set, stamina 100 - 1 (held 0.5 s, billed first) - 4 = 95, message "@kampf.geblockt"', nah(b.stamina, 95, 1e-9) && b.staminaZuletztVerbraucht === 1500 && b.gesendet.some((x) => x.inhalt === '@kampf.geblockt') && hit.art === 'geblockt');
  const pa = attrappe();
  blockPaket(pa, true, 1000);
  blockTrifft(pa, vorn, 10, 1100);
  check('a parry: message "@kampf.pariert", stamina 100 - 0.2 - 4', nah(pa.stamina, 95.8, 1e-9) && pa.gesendet.some((x) => x.inhalt === '@kampf.pariert'));
  const br = attrappe();
  br.stamina = 3.9; blockPaket(br, true, 1000);
  const bruch = blockTrifft(br, vorn, 10, 1500);
  check('3.9 stamina: break (full damage 10), the block ended, message "@kampf.zu_erschoepft" and Block false', bruch.art === 'bruch' && bruch.schaden === 10 && br.blockSeit === 0 && br.stamina === 0 && br.gesendet.some((x) => x.inhalt === '@kampf.zu_erschoepft') && br.gesendet.some((x) => x.typ === PacketType.Block), JSON.stringify(br.gesendet));
  // A stand-in peer of another test has none of the block fields (undefined): that is "no block", not a block.
  const ohneFelder = { stamina: 100, staminaZuletztVerbraucht: 0, waffe: '', flying: false, totBis: 0, blickYaw: 0, position: { x: 0, y: 0, z: 0 }, sendPacketWith: (): void => undefined } as unknown as BlockPeer;
  check('a peer without the block fields: the tick answers false and costs nothing; a blow is untouched',
    !blockHalteTakt(ohneFelder, 1000) && ohneFelder.stamina === 100 && blockTrifft(ohneFelder, vorn, 10, 1000).art === 'keiner' && !beendeBlock(ohneFelder as never, 1000));
  const kein = attrappe();
  const unber = blockTrifft(kein, vorn, 10, 1500);
  check('no block held: the blow is not touched, no message', unber.art === 'keiner' && unber.schaden === 10 && kein.gesendet.length === 0);
}

// ── [2] over the real packet path ────────────────────────────────────────────────────
interface Socke extends WebSocket {
  meldungen: string[];
  bloecke: boolean[];
  admin: string[];
  effekte: number[];
  treffer: number;
}
function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.meldungen = []; ws.bloecke = []; ws.admin = []; ws.effekte = []; ws.treffer = 0;
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
      } else if (type === PacketType.HitEffect) {
        r.readVector3();
        ws.effekte.push(r.readInt32());
      } else if (type === PacketType.PlayerTreffer) {
        ws.treffer++;
      } else if (type === PacketType.AdminEvent) {
        r.readString();
        r.readBool();
        ws.admin.push(r.readString());
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
const sendBlock = (ws: WebSocket, an: boolean): void => {
  ws.send(Buffer.concat([Buffer.from([PacketType.Block]), new Writer().writeBool(an).toBuffer()]));
};
let seq = 0;
const sendInput = (ws: WebSocket, yaw: number, moveZ: number, rennt: boolean): void => {
  const w = new Writer();
  w.writeInt32(++seq);
  w.writeFloat32(0);
  w.writeFloat32(moveZ);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(rennt);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
};
async function eingaben(ws: WebSocket, yaw: number, dauerMs: number, moveZ = 0, rennt = false): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) { sendInput(ws, yaw, moveZ, rennt); await warte(50); }
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
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'd3-block',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
  };
  const sockets: WebSocket[] = [];
  try {
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna: Peer = server.net.getPeers().find((x) => x.name === 'Anna')!;
    sendAdmin(ws, 'teleport 200 200');
    await warte(350);
    await eingaben(ws, 0, 400); // view along -z
    const von = (dx: number, dz: number): Vector3 => ({ x: anna.position.x + dx, y: anna.position.y, z: anna.position.z + dz });
    const wolf = npcKampf('Wolf').schaden;
    const ruest = anna.werte.armor;

    console.log('\n[2] The Block packet and the play test (a wolf strikes a blocking player)');
    check('the packet type is 89 (Parry 58 stays in the enum, unused)', PacketType.Block === 89 && PacketType.Parry === 58);
    check('start: full life and stamina, no armour (so the numbers below are the plain 30 %)', anna.health === 100 && anna.stamina === 100 && ruest === 0, `armour ${ruest}`);

    anna.waffe = '';
    sendBlock(ws, true);
    await warte(200);
    check('over the wire, bare fist: refused (no state) and the client got Block false', anna.blockSeit === 0 && ws.bloecke.includes(false), JSON.stringify(ws.bloecke));

    ws.bloecke.length = 0;
    anna.waffe = 'SwordNorth';
    sendBlock(ws, true);
    await warte(300); // well past the parry window
    check('with an item: the block is held (blockSeit set by the packet)', anna.blockSeit > 0 && !anna.blockOhneParade && ws.bloecke.length === 0);
    ws.meldungen.length = 0;
    anna.health = 100; anna.stamina = 100;
    zugriff.applyCreatureAttack(von(0, -2), wolf, 2.4, anna.worldId, anna.position);
    const verlust = 100 - anna.health;
    check(`WOLF FROM THE FRONT: life -30 % of the blow (${wolf} -> ${(wolf * 0.3).toFixed(2)}), stamina -4 (plus the time held), the block goes on`,
      nah(verlust, eingehenderSchaden(wolf * 0.3, ruest), 1e-9) && nah(verlust, wolf * 0.3, 1e-9) && anna.stamina < 96 && anna.stamina > 94 && anna.blockSeit > 0, `life ${anna.health}, stamina ${anna.stamina}`);
    await warte(150);
    check('... and the message "@kampf.geblockt" reached the client', ws.meldungen.includes('@kampf.geblockt'), JSON.stringify(ws.meldungen));
    check('... with ONE spark effect (art 2), no blood', ws.effekte.length === 1 && ws.effekte[0] === 2, JSON.stringify(ws.effekte));
    ws.effekte.length = 0;

    // From behind: full.
    anna.health = 100; anna.stamina = 100;
    zugriff.applyCreatureAttack(von(0, 2), wolf, 2.4, anna.worldId, anna.position);
    check('WOLF FROM BEHIND: the full blow, only the time held is billed (no 4 for the blow)', nah(100 - anna.health, eingehenderSchaden(wolf, ruest), 1e-9) && anna.stamina > 98 && anna.stamina <= 100, `life ${anna.health}, stamina ${anna.stamina}`);
    await warte(100);
    check('... with the blood effect (art 1)', ws.effekte.length === 1 && ws.effekte[0] === 1, JSON.stringify(ws.effekte));
    ws.effekte.length = 0;
    // Off to the side (90 degrees): full.
    anna.health = 100;
    zugriff.applyCreatureAttack(von(2, 0), wolf, 2.4, anna.worldId, anna.position);
    check('WOLF FROM THE SIDE (90 degrees): the full blow', nah(100 - anna.health, eingehenderSchaden(wolf, ruest), 1e-9), `life ${anna.health}`);

    // The cone follows the tracked VIEW, not a fixed direction: Anna turns to yaw 2.0 rad (114.6 degrees); the view points along (-sin, -cos).
    const GIER = 2.0;
    await eingaben(ws, GIER, 600);
    anna.health = 100; anna.stamina = 100;
    zugriff.applyCreatureAttack(von(-Math.sin(GIER) * 2, -Math.cos(GIER) * 2), wolf, 2.4, anna.worldId, anna.position);
    check('VIEW TURNED to 2.0 rad: a blow from where she now looks is blocked (30 %)', nah(100 - anna.health, wolf * 0.3, 1e-9), `life ${anna.health}, blickYaw ${anna.blickYaw}`);
    anna.health = 100;
    zugriff.applyCreatureAttack(von(0, -2), wolf, 2.4, anna.worldId, anna.position);
    check('... a blow from the OLD front (-z, now 114.6 degrees off her view) is full', nah(100 - anna.health, eingehenderSchaden(wolf, ruest), 1e-9), `life ${anna.health}`);
    await eingaben(ws, 0, 600);
    anna.stamina = 100;

    // Release, wait out the lock, begin again: parry window.
    sendBlock(ws, false);
    await warte(150);
    check('"off" over the wire: no block, the lock is set', anna.blockSeit === 0 && anna.blockSperreBis > Date.now() - 200);
    await warte(BLOCK_SPERRE_MS + 150);
    anna.health = 100; anna.stamina = 100; ws.meldungen.length = 0;
    sendBlock(ws, true);
    const t0 = Date.now();
    while (anna.blockSeit === 0 && Date.now() - t0 < 1000) await warte(2);
    ws.effekte.length = 0; const flinchVor = ws.treffer;
    zugriff.applyCreatureAttack(von(0, -2), wolf, 2.4, anna.worldId, anna.position);
    const seit = Date.now() - anna.blockSeit;
    check(`PARRY WINDOW (${seit} ms after the begin): life unchanged, the 4 stamina paid, the block goes on`, anna.health === 100 && nah(anna.stamina, 96, 0.2) && anna.blockSeit > 0 && seit < 200, `life ${anna.health}, stamina ${anna.stamina}`);
    await warte(150);
    check('... message "@kampf.pariert"', ws.meldungen.includes('@kampf.pariert'), JSON.stringify(ws.meldungen));
    check('... a parry shows ONE spark (art 2), no blood and no flinch (no PlayerTreffer)', ws.effekte.length === 1 && ws.effekte[0] === 2 && ws.treffer === flinchVor, `${JSON.stringify(ws.effekte)}, flinches ${ws.treffer - flinchVor}`);

    // Click series over the wire.
    sendBlock(ws, false); sendBlock(ws, true); sendBlock(ws, false); sendBlock(ws, true);
    await warte(250);
    anna.health = 100; anna.stamina = 100;
    check('a click series over the wire leaves a block without a parry window', anna.blockSeit > 0 && anna.blockOhneParade);
    zugriff.applyCreatureAttack(von(0, -2), wolf, 2.4, anna.worldId, anna.position);
    check('... and the blow is an ordinary block (30 %), not a parry', nah(100 - anna.health, wolf * 0.3, 1e-9), `life ${anna.health}`);

    // Break.
    await warte(100);
    ws.bloecke.length = 0; ws.meldungen.length = 0;
    anna.health = 100; anna.stamina = 3.9;
    zugriff.applyCreatureAttack(von(0, -2), wolf, 2.4, anna.worldId, anna.position);
    await warte(150);
    check('BLOCK BREAK with stamina 3.9: the full blow, the block is over, stamina 0, the client is told', nah(100 - anna.health, eingehenderSchaden(wolf, ruest), 1e-9) && anna.blockSeit === 0 && anna.stamina === 0 && ws.bloecke.includes(false) && ws.meldungen.includes('@kampf.zu_erschoepft'), `life ${anna.health}, stamina ${anna.stamina}, ${JSON.stringify(ws.meldungen)}`);

    // Own swing ends the block.
    anna.stamina = 100; anna.health = 100;
    await warte(BLOCK_SPERRE_MS + 100);
    sendBlock(ws, true);
    await warte(200);
    check('begin again after the break', anna.blockSeit > 0);
    ws.bloecke.length = 0;
    sendAttack(ws, anna.position, '', 0);
    await warte(250);
    check('OWN SWING ends the block (server side), and the client is told', anna.blockSeit === 0 && ws.bloecke.includes(false), JSON.stringify(ws.bloecke));

    // B1 / B3 over the wire: no input packets at all, the server tick bills; the item put away ends the block.
    console.log('\n[2a] Silent client and the item condition');
    anna.stamina = 100; anna.health = 100; anna.waffe = 'SwordNorth';
    await warte(BLOCK_SPERRE_MS + 100);
    ws.bloecke.length = 0;
    sendBlock(ws, true);
    await warte(100);
    const s0 = anna.stamina;
    await warte(3000); // not one PlayerInput in these 3 s
    check('B1: 3 s of holding with no input packet cost about 6 stamina (server tick)', nah(s0 - anna.stamina, 6, 1.0) && anna.blockSeit > 0, `${(s0 - anna.stamina).toFixed(2)}`);
    anna.waffe = '';
    await warte(400);
    check('B3: the item put away (fist) ends the block by itself, the client is told', anna.blockSeit === 0 && ws.bloecke.includes(false), JSON.stringify(ws.bloecke));
    anna.waffe = 'SwordNorth';
    anna.stamina = 100;

    // Movement while blocking.
    console.log('\n[2b] Block speed, no running, stamina 2 per second');
    anna.stamina = 100;
    const ziel = async (dauer: number, an: boolean, rennt: boolean): Promise<{ weg: number; ausdauer: number; sek: number }> => {
      sendAdmin(ws, 'teleport 300 300');
      await warte(400);
      await eingaben(ws, 0, 150);
      anna.stamina = 100;
      anna.staminaZuletztVerbraucht = Date.now();
      sendBlock(ws, an);
      await warte(150);
      const start = { ...anna.position };
      const t = Date.now();
      await eingaben(ws, 0, dauer, 1, rennt);
      const sek = (Date.now() - t) / 1000;
      const weg = Math.hypot(anna.position.x - start.x, anna.position.z - start.z);
      const ausdauer = anna.stamina;
      sendBlock(ws, false);
      await warte(100);
      return { weg, ausdauer, sek };
    };
    const gehen = await ziel(2000, false, false);
    const block = await ziel(2000, true, false);
    const blockRennen = await ziel(2000, true, true);
    console.log(`      walk ${gehen.weg.toFixed(2)} m in ${gehen.sek.toFixed(2)} s, block ${block.weg.toFixed(2)} m, block+run ${blockRennen.weg.toFixed(2)} m`);
    check('walking without a block: about 4.5 m/s', gehen.weg > 4.5 * gehen.sek * 0.8, `${(gehen.weg / gehen.sek).toFixed(2)} m/s`);
    check('blocking: half the walking speed (ratio 0.5 +- 0.07)', nah(block.weg / gehen.weg, 0.5, 0.07), `${(block.weg / gehen.weg).toFixed(3)}`);
    check('blocking with the run key held: still the same half speed (no running)', nah(blockRennen.weg / gehen.weg, 0.5, 0.07), `${(blockRennen.weg / gehen.weg).toFixed(3)}`);
    check('holding costs 2 per second (2 s: -4 +- 0.8), running adds nothing', nah(100 - block.ausdauer, 2 * block.sek, 0.8) && nah(100 - blockRennen.ausdauer, 2 * blockRennen.sek, 0.8), `${(100 - block.ausdauer).toFixed(2)} / ${(100 - blockRennen.ausdauer).toFixed(2)} in ${block.sek.toFixed(2)} s`);
    check('control: no block, walking: no stamina drain', gehen.ausdauer >= 99.9, `${gehen.ausdauer}`);

    // Death ends the block; a dead player's Block packet is dropped.
    console.log('\n[2c] Death');
    anna.stamina = 100; anna.health = 100;
    await warte(BLOCK_SPERRE_MS + 100);
    sendBlock(ws, true);
    await warte(200);
    check('begin before the death', anna.blockSeit > 0);
    anna.health = 5;
    zugriff.applyCreatureAttack(von(0, 2), wolf, 2.4, anna.worldId, anna.position); // from behind: no block
    await warte(200);
    check('DEATH ends the block and clears the lock', anna.totBis > 0 && anna.blockSeit === 0 && anna.blockSperreBis === 0, `totBis ${anna.totBis}, blockSeit ${anna.blockSeit}`);
    ws.bloecke.length = 0;
    sendBlock(ws, true);
    await warte(200);
    check('a dead player\'s Block packet is dropped (no state, no answer)', anna.blockSeit === 0 && ws.bloecke.length === 0);
    while (anna.totBis > 0) await warte(100);
    await warte(300);
    check('revived: no block', anna.blockSeit === 0 && anna.health === 100);
    // Immediate revival (lying time 0): `stirb` is skipped, `belebeNeu` clears the block.
    server.liegezeitMs = 0;
    anna.stamina = 100; anna.health = 100;
    await warte(100);
    sendBlock(ws, true);
    await warte(200);
    check('begin before the immediate revival', anna.blockSeit > 0);
    anna.health = 5;
    zugriff.applyCreatureAttack(von(0, 2), wolf, 2.4, anna.worldId, anna.position); // from behind: full, lethal
    await warte(200);
    check('IMMEDIATE REVIVAL (no lying time): no block and no lock afterwards', anna.totBis === 0 && anna.health === 100 && anna.blockSeit === 0 && anna.blockSperreBis === 0, `blockSeit ${anna.blockSeit}`);
    server.liegezeitMs = 5000;

    // Inside a dungeon instance the speed rule is the same one (own branch of handlePlayerInput).
    console.log('\n[2d] Block speed inside a dungeon instance');
    sendAdmin(ws, 'dungeon create forestcrypt 4242');
    const t1 = Date.now();
    let dungeonId: string | undefined;
    while (!dungeonId && Date.now() - t1 < 8000) {
      await warte(100);
      dungeonId = ws.admin.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
    }
    if (!dungeonId) throw new Error(`dungeon not created: ${ws.admin.join(' | ')}`);
    sendAdmin(ws, `dungeon enter ${dungeonId}`);
    const t2 = Date.now();
    while (anna.worldId === 'haupt' && Date.now() - t2 < 8000) await warte(100);
    check('Anna is inside the instance', anna.worldId !== 'haupt', anna.worldId);
    await warte(300);
    anna.waffe = 'SwordNorth';
    const imDungeon = async (an: boolean, rennt: boolean): Promise<{ weg: number; sek: number }> => {
      await eingaben(ws, 0, 150);
      anna.stamina = 100;
      anna.staminaZuletztVerbraucht = Date.now();
      sendBlock(ws, an);
      await warte(150);
      const start = { ...anna.position };
      const t = Date.now();
      await eingaben(ws, 0, 1500, 1, rennt);
      const sek = (Date.now() - t) / 1000;
      const weg = Math.hypot(anna.position.x - start.x, anna.position.z - start.z);
      sendBlock(ws, false);
      await warte(100);
      return { weg, sek };
    };
    const dGehen = await imDungeon(false, false);
    const dBlock = await imDungeon(true, true);
    console.log(`      dungeon: walk ${dGehen.weg.toFixed(2)} m, block+run ${dBlock.weg.toFixed(2)} m`);
    check('dungeon: blocking with the run key held is half the walking speed (ratio 0.5 +- 0.07)', dGehen.weg > 4.5 * dGehen.sek * 0.8 && nah(dBlock.weg / dGehen.weg, 0.5, 0.07), `${(dBlock.weg / dGehen.weg).toFixed(3)}`);

    // World change clears the block (the hook is Peer.weltWechselVorbereiten).
    anna.blockSeit = 123; anna.blockSperreBis = 456; anna.blockOhneParade = true;
    anna.weltWechselVorbereiten();
    check('WORLD CHANGE (weltWechselVorbereiten) clears the block state', anna.blockSeit === 0 && anna.blockSperreBis === 0 && !anna.blockOhneParade);
  } finally {
    for (const w of sockets) if (w.readyState === WebSocket.OPEN) w.close();
    server.stop();
  }

  console.log('\n[3] The messages are catalogue keys with a German and an English text');
  const katalog = (sprache: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(__dirname, `../../client/src/i18n/katalog/${sprache}.json`), 'utf8')) as Record<string, string>;
  const de = katalog('de'); const en = katalog('en');
  for (const k of ['kampf.geblockt', 'kampf.pariert', 'kampf.zu_erschoepft']) {
    check(`"${k}": de "${de[k]}", en "${en[k]}"`, !!de[k] && !!en[k] && de[k] !== en[k]);
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    rmSync(resolve(__dirname, 'dungeons', 'd3-block'), { recursive: true, force: true }); // the instance of [2d] writes its file next to the test dirs
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
