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
import { PacketType, WATER_LEVEL, eingehenderSchaden, npcKampf, type Vector3 } from '@wov/shared';
import {
  ROLLE_ABKLINGZEIT_MS, ROLLE_AUS_ABGELEHNT, ROLLE_AUS_BEENDET, ROLLE_AUS_GESPERRT, ROLLE_PAKETE_JE_SEKUNDE, ROLLE_SPERRE_TOLERANZ_MS, ROLLE_BEWEGUNG_MS, ROLLE_BEWEGUNG_S, ROLLE_DAUER_MS, ROLLE_TEMPO, ROLLE_WEG_M, SPRUNG_AUSDAUER, rolleWegAnteil,
} from '@wov/shared/src/kampf/rolle.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import { rolleScheibe } from '@wov/shared/src/kampf/rolle.js';
import { ROLLE_SCHRITTE, Spielerbewegung, neuerRolleWeg } from '../src/world/Spielerbewegung.js';
import type { KollisionsForm, Vek3 } from '@wov/shared/src/kollision/form.js';
import { blockPaket } from '../src/spiel/Block.js';
import { rolleBeenden, rolleDrossel, rolleLaeuft, rollePaket, rolleTakt, rolleUnverwundbar, rolleZuruecksetzen, sprungKosten, type RollePeer } from '../src/spiel/Rolle.js';

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
interface Gesendet { typ: number; inhalt: string; grund: number; nr: number; rest: number }
type Attrappe = RollePeer & { gesendet: Gesendet[] };
function attrappe(): Attrappe {
  const gesendet: Gesendet[] = [];
  return {
    blockSeit: 0, blockTaktZeit: 0, blockSperreBis: 0, blockOhneParade: false, stamina: 100, staminaZuletztVerbraucht: 0,
    waffe: 'SwordNorth', flying: false, totBis: 0, blickYaw: 0, position: { x: 0, y: 0, z: 0 },
    rolleStart: 0, rolleBis: 0, rolleZeit: 0, rolleX: 0, rolleZ: 0, rolleSperreBis: 0, sprungSperreBis: 0, rolleWeg: null, rolleNr: 0, rolleFensterStart: 0, rolleFensterZahl: 0,
    gesendet,
    sendPacketWith(typ: PacketType, schreibe: (w: Writer) => void): void {
      const w = new Writer();
      schreibe(w);
      const r = new Reader(w.toBuffer());
      const inhalt = typ === PacketType.InteractResult ? (r.readBool(), r.readString()) : String(r.readBool());
      // `Rolle=false`: the reason byte and the roll number follow (-1 = absent)
      const grund = typ === PacketType.Rolle && r.remaining() >= 1 ? r.readUInt8() : -1;
      const nr = typ === PacketType.Rolle && r.remaining() >= 4 ? r.readInt32() : -1;
      const rest = typ === PacketType.Rolle && r.remaining() >= 4 ? r.readInt32() : -1;
      gesendet.push({ typ, inhalt, grund, nr, rest });
    },
  } as Attrappe;
}
const frei = { imWasser: false, freiraum: null };
const rolleAus = (p: Attrappe): number => p.gesendet.filter((g) => g.typ === PacketType.Rolle && g.inhalt === 'false').length;
const zustand = (p: Attrappe): string => `${p.rolleStart}/${p.rolleBis}/${p.rolleZeit}/${p.rolleSperreBis}/${p.stamina}`;

console.log('\n[1] spiel/Rolle.ts on a stand-in peer (fixed clock)');
{
  // N4: the reason byte and the roll number of `Rolle=false`
  const p = attrappe();
  rollePaket(p, 0, 10_000, frei, 41);
  check('an accepted roll keeps the number the client gave it', p.rolleNr === 41);
  rollePaket(p, 0, 10_100, frei, 42);
  const abl = p.gesendet.at(-1)!;
  check('REFUSED (a roll runs): `Rolle=false`, reason 3 (still locked), the number of the refused REQUEST (42), the running roll keeps 41', abl.typ === PacketType.Rolle && abl.inhalt === 'false' && abl.grund === ROLLE_AUS_GESPERRT && abl.nr === 42 && p.rolleNr === 41, JSON.stringify(abl));
  p.gesendet.length = 0;
  rolleBeenden(p, 10_300);
  const ende = p.gesendet.at(-1)!;
  check('ENDED (teleport, world change, flight): reason 2 (ended), the number of the roll that ran (41)', ende.grund === ROLLE_AUS_BEENDET && ende.nr === 41, JSON.stringify(ende));
  const q = attrappe();
  q.stamina = 5;
  rollePaket(q, 0, 1000, frei, 9);
  check('a refusal for too little stamina: reason 1, the number 9', q.gesendet.at(-1)!.grund === ROLLE_AUS_ABGELEHNT && q.gesendet.at(-1)!.nr === 9);
  const r = attrappe();
  rollePaket(r, 0, 1000, frei, 5);
  r.gesendet.length = 0;
  rolleZuruecksetzen(r, 1200);
  check('death or revival during a roll: reason 2, the number 5', r.gesendet.at(-1)!.grund === ROLLE_AUS_BEENDET && r.gesendet.at(-1)!.nr === 5);
  const alt = attrappe();
  rollePaket(alt, 0, 1000, frei);
  check('a request without a number (an older client) is number 0', alt.rolleNr === 0);
}
{
  // N4-3: refused because of the lock: reason 3 and the rest in ms (the jitter tolerance taken off)
  const p = attrappe();
  rollePaket(p, 0, 10_000, frei, 1); // rolls until 10875, the lock until 11375
  p.gesendet.length = 0;
  rollePaket(p, 0, 10_100, frei, 2);
  const a = p.gesendet.at(-1)!;
  check('STILL ROLLING: reason 3 (still locked), the number 2, the rest = lock end - tolerance - now = 11375 - 100 - 10100 = 1175 ms', a.grund === ROLLE_AUS_GESPERRT && a.nr === 2 && a.rest === 11_375 - ROLLE_SPERRE_TOLERANZ_MS - 10_100, JSON.stringify(a));
  rollePaket(p, 0, 11_000, frei, 3);
  const b = p.gesendet.at(-1)!;
  check('IN THE LOCK AFTER THE ROLL: reason 3, the number 3, the rest 275 ms', b.grund === ROLLE_AUS_GESPERRT && b.nr === 3 && b.rest === 275, JSON.stringify(b));
  const bruch = attrappe();
  rollePaket(bruch, 0, 10_000, frei, 1);
  rollePaket(bruch, 0, 11_274.5, frei, 2);
  check('a fractional clock (11274.5): the rest is rounded UP to a whole millisecond (1), the Int32 does not throw or truncate to 0', bruch.gesendet.at(-1)!.grund === ROLLE_AUS_GESPERRT && bruch.gesendet.at(-1)!.rest === 1, JSON.stringify(bruch.gesendet.at(-1)));
  rollePaket(bruch, 0, 11_273.5, frei, 3);
  check('a fractional clock (11273.5, 1.5 ms left): the rest is 2 (rounded up, not cut to 1)', bruch.gesendet.at(-1)!.rest === 2, JSON.stringify(bruch.gesendet.at(-1)));
  rollePaket(p, 0, 11_274, frei, 4);
  check('101 ms before the lock ends: still locked with the rest 1 ms (never 0 or negative)', p.gesendet.at(-1)!.grund === ROLLE_AUS_GESPERRT && p.gesendet.at(-1)!.rest === 1, JSON.stringify(p.gesendet.at(-1)));
  check('the client may try again after that rest: at lock end - tolerance the roll is taken (stamina 80)', rollePaket(p, 0, 11_275, frei, 5) && p.stamina === 80);
  const q = attrappe();
  q.stamina = 5;
  rollePaket(q, 0, 1000, frei, 6);
  check('too little stamina: reason 1 (refused), no rest bytes', q.gesendet.at(-1)!.grund === ROLLE_AUS_ABGELEHNT && q.gesendet.at(-1)!.rest === -1);
  for (const [name, setze] of [['dead', (x: Attrappe) => { x.totBis = 9e9; }], ['flying', (x: Attrappe) => { x.flying = true; }]] as const) {
    const z = attrappe();
    setze(z);
    rollePaket(z, 0, 1000, frei, 7);
    check(`${name}: reason 1 (refused), not "locked"`, z.gesendet.at(-1)!.grund === ROLLE_AUS_ABGELEHNT && z.gesendet.at(-1)!.rest === -1);
  }
  const w = attrappe();
  rollePaket(w, 0, 1000, { imWasser: false, freiraum: () => 0 }, 8);
  check('a wall (no room): reason 1 (refused), no rest', w.gesendet.at(-1)!.grund === ROLLE_AUS_ABGELEHNT && w.gesendet.at(-1)!.rest === -1);
  const e = attrappe();
  rollePaket(e, 0, 1000, frei, 9);
  e.gesendet.length = 0;
  rolleBeenden(e, 1200);
  check('ended: reason 2, no rest bytes', e.gesendet.at(-1)!.grund === ROLLE_AUS_BEENDET && e.gesendet.at(-1)!.rest === -1);
}
{
  // N4-2: the throttle per peer: ten packets in a window of one second are looked at, the rest is dropped
  const p = attrappe();
  let ja = 0;
  for (let i = 0; i < 2000; i++) if (rolleDrossel(p, 50_000 + i * 0.1)) ja++; // 2000 packets in 200 ms
  check(`a flood of 2000 packets in 200 ms: exactly ${ROLLE_PAKETE_JE_SEKUNDE} are looked at`, ja === ROLLE_PAKETE_JE_SEKUNDE, String(ja));
  check('the 1000 ms window: a packet 999 ms after its start is still throttled, at 1000 ms a new window opens', !rolleDrossel(p, 50_000 + 999) && rolleDrossel(p, 50_000 + 1000));
  const q = attrappe();
  let nach = 0;
  for (let i = 0; i < 10; i++) if (rolleDrossel(q, 1000 + i * 100)) nach++;
  check('normal use is not hit: one packet every 100 ms (ten per second) all pass', nach === 10);
  check('the 11th within the same second does not', !rolleDrossel(q, 1999));
  const r = attrappe();
  for (let i = 0; i < 12; i++) rolleDrossel(r, 9000 + i); // the window is full
  check('a full window blocks (12 packets: the 11th and 12th were dropped)', !rolleDrossel(r, 9500));
  check('a clock that jumped back opens a new window (no lock-out for the rest of the old second)', rolleDrossel(r, 100));
}
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
  const sperre = rollePaket(p, 0, 11_274, frei);
  check('101 ms before the lock ends (11375): refused', !sperre && p.stamina === 90 && rolleAus(p) === 2);
  const danach = rollePaket(p, 0, 11_275, frei);
  check('100 ms before the lock ends (jitter tolerance): accepted again (stamina 80)', danach && p.stamina === 80 && p.rolleStart === 11_275);
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
  check('... and the begin (5) and the held time (1) were paid before the 10 (stamina 100 - 5 - 1 - 10)', nah(p.stamina, 84, 1e-9), `${p.stamina}`);
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
  const mitte = rolleTakt(p, 30_850); // inside the clip (875): the movement follows the curve of the clip and ends with it
  check('at 850 ms: rolling, the movement so far is the share of the curve at 0.85 s', mitte.rollt && nah(mitte.dt, rolleWegAnteil(0.85) * ROLLE_BEWEGUNG_S, 1e-12), `${mitte.dt}`);
  const spaet = rolleTakt(p, 30_874);
  check('at 874 ms: still rolling, the rest of the path up to there', spaet.rollt && nah(spaet.dt, (rolleWegAnteil(0.874) - rolleWegAnteil(0.85)) * ROLLE_BEWEGUNG_S, 1e-12) && spaet.dt > 0);
  const nachClip = rolleTakt(p, 30_875);
  check('a packet at the end of the clip (875 ms) still gets the remainder of the path, and the roll is over for the tick after it', nachClip.rollt && nachClip.dt > 0 && !rolleTakt(p, 30_876).rollt);
  check('the whole movement of this roll is 0.8333 s at the speed of the roll', nah(mitte.dt + spaet.dt + nachClip.dt, ROLLE_BEWEGUNG_S, 1e-12), `${mitte.dt + spaet.dt + nachClip.dt}`);
}
{
  const p = attrappe();
  rollePaket(p, 0, 1000, frei);
  p.gesendet.length = 0;
  rolleZuruecksetzen(p, 1500);
  check('reset (death, revival): no roll, no lock, no jump lock; a roll that ran is announced (Rolle false)', p.rolleBis === 0 && p.rolleSperreBis === 0 && p.rolleStart === 0 && rolleAus(p) === 1 && p.sprungSperreBis === 0);
  rolleZuruecksetzen(p, 1600);
  check('a reset without a roll sends nothing', rolleAus(p) === 1);
  // N1-2 / N1-4: ending a roll (teleport, world change, flight) keeps the locks and speaks only when a roll really ran
  const b = attrappe();
  sprungKosten(b, true, 400); // a jump lock before the roll, 400 + 800 = 1200
  rollePaket(b, 0, 1000, frei);
  b.gesendet.length = 0;
  const sperre = b.rolleSperreBis;
  rolleBeenden(b, 1400);
  check('rolleBeenden in the middle of a roll: the roll is over (state, path), the client is told once', b.rolleBis === 0 && b.rolleStart === 0 && b.rolleZeit === 0 && b.rolleWeg === null && rolleAus(b) === 1);
  check('... but the roll lock (until 2375) and the jump lock (until 1200) STAY: no cooldown freed by a teleport', b.rolleSperreBis === sperre && sperre === 1000 + ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS && b.sprungSperreBis === 1200);
  const stB = b.stamina;
  check('... and a new roll right after is refused by the lock (stamina unchanged)', !rollePaket(b, 0, 1500, frei) && b.stamina === stB);
  const c = attrappe();
  rollePaket(c, 0, 1000, frei);
  c.gesendet.length = 0;
  rolleBeenden(c, 1875);
  check('rolleBeenden exactly at the end of the clip (1875): no roll ran any more: nothing is sent, the state is cleared', rolleAus(c) === 0 && c.rolleBis === 0 && c.rolleWeg === null);
  const d = attrappe();
  rollePaket(d, 0, 1000, frei);
  d.gesendet.length = 0;
  rolleBeenden(d, 1874);
  check('rolleBeenden 1 ms before the end of the clip: the client is told', rolleAus(d) === 1);
  const q = attrappe();
  q.rolleBis = 5000; q.rolleStart = 1000; q.rolleZeit = 1000; // a roll without its path state (a stand-in): the tick does not move anything
  check('a running roll without a path state gives no movement (the tick needs the state)', !rolleTakt(q, 2000).rollt);
  const e = attrappe();
  rolleBeenden(e, 5000);
  check('rolleBeenden without any roll ever: nothing sent', rolleAus(e) === 0);
  rollePaket(e, 0, 10_000, frei);
  e.gesendet.length = 0;
  rolleBeenden(e, 60_000);
  check('rolleBeenden long after a roll: nothing sent (a teleport or flight a minute later says nothing)', rolleAus(e) === 0 && e.rolleSperreBis > 0);
  rolleZuruecksetzen(e, 70_000);
  check('rolleZuruecksetzen long after a roll: nothing sent either, the locks are cleared', rolleAus(e) === 0 && e.rolleSperreBis === 0);
  const sp = attrappe();
  sprungKosten(sp, true, 1000);
  check('(set-up) a billed jump set its lock', sp.sprungSperreBis === 1800);
  rolleZuruecksetzen(sp);
  check('a reset (death, world change) also clears the jump lock', sp.sprungSperreBis === 0);
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

{
  // F2: the jitter tolerance, and what it does to a chain of rolls (the spam probe of the attack).
  const rand = attrappe();
  rollePaket(rand, 0, 50_000, frei);
  const ende = rand.rolleSperreBis; // 51375
  const zu = attrappe(); zu.rolleSperreBis = ende; zu.stamina = 100;
  check('boundary: lock end - 101 ms refused, - 100 ms accepted (one peer each)', !rollePaket(zu, 0, ende - 101, frei) && rollePaket(zu, 0, ende - 100, frei));
  const spam = attrappe();
  const starts: number[] = [];
  let letzteStart = -1;
  for (let t = 100_000; t < 120_000; t += 5) {
    spam.stamina = 100; // the stamina is not the limit of the probe
    if (rollePaket(spam, 0, t, frei) && spam.rolleStart !== letzteStart) { letzteStart = spam.rolleStart; starts.push(t); }
  }
  const abstaende = starts.slice(1).map((s, i) => s - starts[i]);
  const kleinster = Math.min(...abstaende);
  let unverwundbar = 0;
  for (let t = starts[0]; t < starts[starts.length - 1]; t += 1) {
    if (starts.some((s) => t >= s && t < s + ROLLE_DAUER_MS)) unverwundbar++;
  }
  const anteil = unverwundbar / (starts[starts.length - 1] - starts[0]);
  console.log(`      spam every 5 ms over 20 s: ${starts.length} rolls, smallest gap ${kleinster} ms, invulnerable share ${(anteil * 100).toFixed(1)} % (limit 875/1275 = ${(875 / 12.75).toFixed(1)} %)`);
  check('SPAM: rolls at most every 875 + 400 = 1275 ms (smallest gap >= 1275)', kleinster >= ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS - 100, `${kleinster} ms`);
  check('SPAM: the invulnerable share stays at 875/1275 (68.6 %) plus one packet rhythm, not more', anteil <= 875 / 1275 + 0.01, `${(anteil * 100).toFixed(2)} %`);
}
{
  // F3: one path state (step grid + slope memory) per roll (set on accept, handed out by the tick, gone with the reset).
  const p = attrappe();
  check('(set-up) no path state before a roll', p.rolleWeg === null && !rolleTakt(p, 1000).rollt);
  rollePaket(p, 0, 1000, frei);
  const weg = p.rolleWeg;
  check('a roll sets one path state', weg !== null);
  {
    const t1 = rolleTakt(p, 1100);
    const t2 = rolleTakt(p, 1200);
    check('every tick of the roll hands out the SAME path state', t1.rollt && t2.rollt && t1.weg === weg && t2.weg === weg);
  }
  rolleZuruecksetzen(p, 1300);
  check('the reset drops it, no tick moves afterwards', p.rolleWeg === null && !rolleTakt(p, 1300).rollt);
  rollePaket(p, 0, 5000, frei);
  check('the next roll gets a fresh one', p.rolleWeg !== null && p.rolleWeg !== weg);
}
{
  // F4: a jump flag during a roll is not billed (the client sends none there).
  const p = attrappe();
  rollePaket(p, 0, 1000, frei); // stamina 90, rolling until 1875
  check('jump flag during the roll (at 1000, 1500, 1874): not billed, no lock', !sprungKosten(p, true, 1000) && !sprungKosten(p, true, 1500) && !sprungKosten(p, true, 1874) && p.stamina === 90 && p.sprungSperreBis === 0);
  check('jump flag when the roll is over (1875): billed again', sprungKosten(p, true, 1875) && p.stamina === 85 && p.sprungSperreBis === 1875 + 800);
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
    const lauf = neuerRolleWeg();
    let rest = ROLLE_BEWEGUNG_MS / 1000;
    while (rest > 1e-12) {
      const dt = Math.min(takt / 1000, rest);
      pos = sb.rollSchritt(w, dx, dz, dt, lauf);
      w.position = pos;
      rest -= dt;
    }
    return pos;
  };
  // Z1: the path driven in slices of the CURVE (rolleScheibe -> rollSchritt with the path state) lags the analytic curve
  // by at most one sub-step (~0.1 m) at every packet and ends at 4.853 m.
  for (const takt of [16, 50, 100, 333]) {
    const lauf = neuerRolleWeg();
    const w = { position: { x: 0, y: 0, z: 0 } };
    const s0 = 10_000;
    let zeit = s0;
    let maxAbw = 0;
    for (let t = s0; t <= s0 + 1200; t += takt) {
      const sc = rolleScheibe(s0, zeit, t);
      zeit = sc.bis;
      w.position = offen.rollSchritt(w, 0, -1, sc.dt, lauf);
      const soll = rolleWegAnteil(Math.min(t - s0, ROLLE_DAUER_MS) / 1000) * ROLLE_WEG_M;
      maxAbw = Math.max(maxAbw, soll - Math.hypot(w.position.x, w.position.z));
    }
    const ende = Math.hypot(w.position.x, w.position.z);
    check(`curve, packets every ${takt} ms: the server path stays within 0.1 m behind the analytic curve (max ${maxAbw.toFixed(3)} m) and ends at 4.853 m (${ende.toFixed(3)})`, maxAbw < 0.1 && maxAbw > -1e-6 && nah(ende, ROLLE_WEG_M, 0.01));
  }
  {
    // the path state: the slices end exactly where the preview ends, never ahead of the curve, all steps taken
    const fahreLauf = (sb: Spielerbewegung, dx: number, dz: number, takt: number, lauf = neuerRolleWeg()): { pos: Vek3; lauf: ReturnType<typeof neuerRolleWeg>; vorn: number; hinten: number } => {
      const s0 = 10_000;
      let zeit = s0;
      const w = { position: { x: 0, y: 0, z: 0 } };
      let vorn = 0;
      let hinten = 0;
      const zeiten: number[] = [];
      for (let t = s0; t < s0 + 1200; t += takt) zeiten.push(t);
      zeiten.push(s0 + 1200);
      for (const t of zeiten) {
        const sc = rolleScheibe(s0, zeit, t);
        zeit = sc.bis;
        w.position = sb.rollSchritt(w, dx, dz, sc.dt, lauf);
        const soll = rolleWegAnteil(Math.min(t - s0, ROLLE_DAUER_MS) / 1000) * ROLLE_WEG_M;
        const ist = Math.hypot(w.position.x, w.position.z);
        vorn = Math.max(vorn, ist - soll);
        hinten = Math.max(hinten, soll - ist);
      }
      return { pos: w.position, lauf, vorn, hinten };
    };
    for (const takt of [7, 16, 33, 50, 100, 333, 1200]) {
      const r = fahreLauf(offen, 0, -1, takt);
      const ende = Math.hypot(r.pos.x, r.pos.z);
      check(`path state, packets every ${takt} ms: ends exactly at the preview (${ende.toFixed(4)} vs ${dist.toFixed(4)}), all ${ROLLE_SCHRITTE} steps taken, never ahead of the curve (${r.vorn.toExponential(1)}), at most 0.1 m behind (${r.hinten.toFixed(3)})`,
        Math.abs(ende - dist) < 1e-9 && r.lauf.getan === ROLLE_SCHRITTE && Math.abs(r.lauf.rest) < 1e-9 && r.vorn < 1e-9 && r.hinten < 0.1);
    }
    {
      // a call with more time than the roll has left cannot move the figure beyond the path (the cap of the steps), and the
      // near field asked for the collision reaches as far as the steps of the call will go
      const z2 = createWovServer({ port: 0, worldSeed: 'KxSYuZquuw', worldFeatures: false });
      z2.init();
      const kw = new Kollisionswelt(z2.zdos, z2.prefabs, () => 0);
      const leer = kw.nahfeldAus([]);
      const gefragt: number[] = [];
      (kw as unknown as { nahfeld: (p: unknown, weg: number) => unknown }).nahfeld = (_p, weg) => { gefragt.push(weg); return leer; };
      const sb2 = new Spielerbewegung(kw);
      const w2 = { position: { x: 0, y: 0, z: 0 } };
      const l2 = neuerRolleWeg();
      const nach = sb2.rollSchritt(w2, 0, -1, 0.4, l2);
      const teilWeg = ROLLE_TEMPO * (ROLLE_BEWEGUNG_S / ROLLE_SCHRITTE);
      check('a slice of 0.4 s at the roll speed asks the collision for at least the steps it will go (reach >= 2.3 m)', gefragt.length === 1 && gefragt[0]! >= ROLLE_TEMPO * 0.4 - teilWeg, gefragt.join());
      check('... and moves the figure 2.3 m (the steps due)', Math.abs(Math.hypot(nach.x, nach.z) - Math.floor(0.4 / (ROLLE_BEWEGUNG_S / ROLLE_SCHRITTE)) * teilWeg) < 1e-9, `${Math.hypot(nach.x, nach.z).toFixed(3)}`);
      w2.position = nach;
      const viel = sb2.rollSchritt(w2, 0, -1, 10, l2);
      check('a call with 10 s of roll time: the cap of the steps holds the figure at the 4.853 m of the path', Math.abs(Math.hypot(viel.x, viel.z) - ROLLE_WEG_M) < 1e-9 && l2.getan === ROLLE_SCHRITTE, `${Math.hypot(viel.x, viel.z).toFixed(3)} m, ${l2.getan} steps`);
    }
    for (const takt of [16, 100, 400]) {
      const dick2 = fahreLauf(weltMit([{ form: kiste({ x: -50, y: -1, z: -0.1 }, { x: 50, y: 4, z: 0.1 }), position: { x: 0, y: 0, z: -2 } }]), 0, -1, takt);
      check(`path state, a 20 cm thin wall in 1.9 m, packets every ${takt} ms: the slice does not jump over it (z > -1.6)`, dick2.pos.z > -1.6, `z ${dick2.pos.z.toFixed(3)}`);
      const w1 = fahreLauf(wand(1), 0, -1, takt);
      check(`path state, a wall 1 m in front, packets every ${takt} ms: the roll stops before it (z > -0.7)`, w1.pos.z > -0.7 && w1.pos.z <= 0, `z ${w1.pos.z.toFixed(3)}`);
    }
  }
  for (const takt of [16, 50, 100]) {
    const e = gehe(offen, 0, -1, takt);
    check(`free: ${takt} ms packets cover the same 4.853 m as the preview (+- 0.02)`, nah(horizontal(e, start), dist, 0.02), `${horizontal(e, start).toFixed(4)} m`);
  }
  const vorWand = gehe(wand(1), 0, -1, 50);
  check('a wall 1 m in front: the roll driven in packets stops before it (z > -0.7), no tunnelling', vorWand.z > -0.7 && vorWand.z <= 0, `z ${vorWand.z.toFixed(3)}`);
  const dick = gehe(weltMit([{ form: kiste({ x: -50, y: -1, z: -0.1 }, { x: 50, y: 4, z: 0.1 }), position: { x: 0, y: 0, z: -2 } }]), 0, -1, 400);
  check('a 20 cm thin wall in 1.9 m, packets of 400 ms (the slice is 2.3 m long): the slice does not jump over it', dick.z > -1.6, `z ${dick.z.toFixed(3)}`);
}

{
  // F3: at the limit of the slope the roll driven in slices with ONE slope memory agrees with the preview.
  const gradHoehe = (grad: number) => { const k = Math.tan((grad * Math.PI) / 180); return (_x: number, zz: number): number => -zz * k; };
  const fahreHang = (sb: Spielerbewegung, dx: number, dz: number, takt: number, h: (x: number, z: number) => number, lauf = neuerRolleWeg()): number => {
    let pos = { x: 0, y: h(0, 0), z: 0 };
    const w = { position: pos };
    let rest = ROLLE_BEWEGUNG_MS / 1000;
    while (rest > 1e-12) {
      const dt = Math.min(takt / 1000, rest);
      pos = sb.rollSchritt(w, dx, dz, dt, lauf);
      w.position = pos;
      rest -= dt;
    }
    return Math.hypot(pos.x, pos.z);
  };
  const frei80 = (weg: number): boolean => weg >= ROLLE_WEG_M * 0.8;
  for (const grad of [58, 60, 62]) {
    const h = gradHoehe(grad);
    // a sloped ground needs its own world: the height function replaces the flat one
    const z2 = createWovServer({ port: 0, worldSeed: 'KxSYuZquuw', worldFeatures: false });
    z2.init();
    const kw = new Kollisionswelt(z2.zdos, z2.prefabs, h as never);
    const nah2 = kw.nahfeldAus([]);
    (kw as unknown as { nahfeld: () => unknown }).nahfeld = () => nah2;
    const hang = new Spielerbewegung(kw);
    const vor = hang.rolleVorschau({ x: 0, y: 0, z: 0 }, 0, -1);
    const takte = [7, 16, 33, 50, 100, 833];
    const laeufe = takte.map(() => neuerRolleWeg());
    const wege = takte.map((t, i) => fahreHang(hang, 0, -1, t, h, laeufe[i]));
    const alleGleich = wege.every((w) => frei80(w) === frei80(vor));
    const abweichung = Math.max(...wege.map((w) => Math.abs(w - vor)));
    console.log(`      ${grad} deg: preview ${vor.toFixed(2)} m, driven ${wege.map((w) => w.toFixed(2)).join(' ')} (max deviation ${abweichung.toFixed(3)} m)`);
    check(`${grad} deg slope: the decision of the preview (free/refused) holds for every slice length of the driven path`, alleGleich);
    check(`${grad} deg slope: the driven path equals the preview EXACTLY (same steps, same slope memory): max deviation < 1e-6 m`, abweichung < 1e-6, `${abweichung.toExponential(2)} m`);
    check(`${grad} deg slope: every driven roll took all ${ROLLE_SCHRITTE} steps and used the slope memory of its path state`, laeufe.every((l) => l.getan === ROLLE_SCHRITTE && Math.abs(l.rest) < 1e-9 && (grad >= 60 ? l.hang.gueltig : true)), laeufe.map((l) => `${l.getan}/${l.hang.gueltig}`).join(' '));
    // the numbers measured on the state with one memory: 58 deg free (4.853), 60 deg free (4.077), 62 deg refused (0)
    check(`${grad} deg slope: the preview is ${grad === 58 ? '4.853' : grad === 60 ? '4.077' : '0'} m (a fresh memory per step would give 3.979 at 60 deg)`, Math.abs(vor - (grad === 58 ? 4.853 : grad === 60 ? 4.077 : 0)) < 0.005, `${vor.toFixed(3)}`);
    // the old way (a fresh memory per call) is what the attack found: not part of the check, it is the mutant A28
  }
}

// ── [3] over the real packet path ────────────────────────────────────────
interface Socke extends WebSocket {
  meldungen: string[]; bloecke: boolean[]; rollen: boolean[]; aus: Array<{ grund: number; nr: number }>; treffer: number; admin: string[];
}
function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.meldungen = []; ws.bloecke = []; ws.rollen = []; ws.aus = []; ws.treffer = 0; ws.admin = [];
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
        ws.aus.push({ grund: r.remaining() >= 1 ? r.readUInt8() : -1, nr: r.remaining() >= 4 ? r.readInt32() : -1 });
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
const sendRolle = (ws: WebSocket, yaw: number, nr: number | null = 0): void => {
  const w = new Writer().writeFloat32(yaw);
  if (nr !== null) w.writeInt32(nr); // null = the packet of an older client: the yaw only
  ws.send(Buffer.concat([Buffer.from([PacketType.Rolle]), w.toBuffer()]));
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
    sendInput(ws, 0, 0, 0, false); // after the clip: the packet that carries the rest of the path (the real client sends 20 per second)
    await warte(80);
    const weg = Math.hypot(anna.position.x - von.x, anna.position.z - von.z);
    check('THE FREE ROLL: 4.85 +- 0.1 m along -z, the running WASD of the packets ignored', nah(weg, ROLLE_WEG_M, 0.1) && nah(anna.position.x, von.x, 0.05) && anna.position.z < von.z - 4.7, `${weg.toFixed(3)} m, x ${(anna.position.x - von.x).toFixed(3)}, z ${(anna.position.z - von.z).toFixed(3)}`);
    check('stamina -10 (not more: running does not cost during the roll)', nah(anna.stamina, 90, 1), `${anna.stamina}`);
    check('the roll is over (the clip + the packets): rolleBis passed, no client message', !rolleLaeuft(anna, Date.now()) && ws.rollen.length === 0, JSON.stringify(ws.rollen));
    check(`the packets drove the path state of the roll through all ${ROLLE_SCHRITTE} steps (the wiring hands it to the movement)`, anna.rolleWeg !== null && anna.rolleWeg.getan === ROLLE_SCHRITTE, `${anna.rolleWeg?.getan}`);
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
    sendRolle(ws, 0, 77);
    await warte(150);
    check('A WALL: the answer is `Rolle=false`, reason 1 (refused), the number 77 of the request', ws.aus.at(-1)?.grund === ROLLE_AUS_ABGELEHNT && ws.aus.at(-1)?.nr === 77, JSON.stringify(ws.aus));
    check('A WALL 1 m IN FRONT: the roll is refused, stamina unchanged (100), no roll state', anna.stamina === 100 && anna.rolleStart === start && ws.rollen.join() === 'false', `stamina ${anna.stamina}, ${JSON.stringify(ws.rollen)}`);
    check('... the client got the message "@kampf.rolle_blockiert"', ws.meldungen.includes('@kampf.rolle_blockiert'), JSON.stringify(ws.meldungen));
    sendRolle(ws, Math.PI, 78);
    await warte(150);
    check('rolling AWAY from that wall (yaw 180 degrees) is allowed', anna.stamina === 90 && anna.rolleStart > start);
    check('... the server keeps the number 78 of this roll', anna.rolleNr === 78);
    zugriff.spielerbewegung = echte;
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);

    // ── the throttle over the wire (N4-2): a flood of Rolle packets is answered at most ten times per second ──
    anna.stamina = 100; anna.rolleSperreBis = 0; anna.rolleBis = 0;
    await warte(1100); // a fresh window
    ws.rollen.length = 0;
    for (let i = 0; i < 300; i++) sendRolle(ws, 0, 1000 + i);
    await warte(600);
    check(`a flood of 300 Rolle packets in one burst: at most ${ROLLE_PAKETE_JE_SEKUNDE} answers or roll starts (${ws.rollen.length} answers), the connection lives`, ws.rollen.length <= ROLLE_PAKETE_JE_SEKUNDE - 1 && ws.readyState === WebSocket.OPEN && server.net.getPeers().includes(anna), `${ws.rollen.length}`);
    check('... the first packet of the burst was taken (a roll runs or ran)', anna.rolleNr === 1000, `${anna.rolleNr}`);
    await warte(1100 + ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
    anna.stamina = 100;
    ws.rollen.length = 0;
    sendRolle(ws, 0, 5000);
    await warte(100);
    check('normal use afterwards (a fresh window): the next roll is taken at once', anna.rolleNr === 5000 && rolleLaeuft(anna, Date.now()));
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);

    // ── a packet of an older client (the yaw only, no number) ──
    anna.stamina = 100; anna.rolleSperreBis = 0;
    sendRolle(ws, 0, null);
    await warte(100);
    check('a Rolle packet WITHOUT a number (an older client, 4 bytes) is accepted with the number 0', rolleLaeuft(anna, Date.now()) && anna.rolleNr === 0 && ws.readyState === WebSocket.OPEN);
    ws.aus.length = 0;
    sendRolle(ws, 0, null);
    await warte(100);
    check('... and its refusal (a roll runs) comes back as reason 3 (still locked) with the number 0', ws.aus.at(-1)?.grund === ROLLE_AUS_GESPERRT && ws.aus.at(-1)?.nr === 0, JSON.stringify(ws.aus));
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);

    // ── in the water ──
    anna.stamina = 100;
    const yTrocken = anna.position.y;
    const rs0 = anna.rolleStart;
    anna.position = { x: anna.position.x, y: WATER_LEVEL - 1, z: anna.position.z };
    ws.rollen.length = 0;
    sendRolle(ws, 0);
    await warte(150);
    check('IN THE WATER (y below the water line): refused, stamina unchanged, the client got Rolle false', anna.stamina === 100 && anna.rolleStart === rs0 && ws.rollen.join() === 'false', `stamina ${anna.stamina}, ${JSON.stringify(ws.rollen)}`);
    anna.position = { x: anna.position.x, y: yTrocken, z: anna.position.z };

    // ── a short packet must not cut the player off ──
    ws.send(Buffer.from([PacketType.Rolle]));
    await warte(150);
    check('a Rolle packet without its yaw is dropped: the player is still connected and nothing changed', ws.readyState === WebSocket.OPEN && server.net.getPeers().includes(anna) && anna.rolleStart === rs0 && anna.stamina === 100);

    // ── dead ──
    anna.stamina = 100;
    anna.totBis = Date.now() + 5000;
    const sd = anna.rolleStart;
    ws.rollen.length = 0;
    sendRolle(ws, 0);
    await warte(100);
    check('a dead player\'s Rolle packet is dropped', anna.rolleStart === sd && anna.stamina === 100);
    check('a dead player\'s Rolle packet is dropped at the gate: not even a Rolle false reply', ws.rollen.length === 0, JSON.stringify(ws.rollen));
    anna.totBis = 0;

    // ── death and change of world end the roll ──
    anna.stamina = 100; anna.sprungSperreBis = 0; anna.rolleSperreBis = 0; // (the locks of the earlier cases are not what is tested here)
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
    const sperreVorher = anna.rolleSperreBis;
    anna.weltWechselVorbereiten(); // (a second call: nothing runs any more, nothing may change)
    check('WORLD CHANGE (weltWechselVorbereiten) ends the roll but KEEPS the lock (no cooldown freed by a portal)', anna.rolleBis === 0 && anna.rolleStart === 0 && anna.rolleWeg === null && anna.rolleSperreBis === sperreVorher && sperreVorher > Date.now());
    await warte(100);

    // ── the immediate-revival path ──
    anna.stamina = 100; anna.totBis = 0; anna.rolleSperreBis = 0;
    sendRolle(ws, 0);
    await warte(100);
    check('(set-up) a roll runs', rolleLaeuft(anna, Date.now()));
    (server as unknown as { belebeNeu(p: Peer, sofort: boolean): void }).belebeNeu(anna, true);
    check('REVIVAL on the immediate path (stirb skipped): the roll is over, no lock', anna.rolleBis === 0 && anna.rolleSperreBis === 0);
    anna.health = 100; anna.stamina = 100;
    await warte(300);

    // ── a teleport ends the roll (F1): the admin command and the portal / return path (teleportPeer) ──
    for (const [wie, mach, ziel] of [
      ['ADMIN COMMAND teleport', (): void => sendAdmin(ws, 'teleport 300 300'), { x: 300, z: 300 }],
      ['PORTAL / teleportPeer', (): void => (server as unknown as { teleportPeer(p: Peer, pos: Vector3, d: string | null): void }).teleportPeer(anna, { x: 250, y: anna.position.y, z: 250 }, null), { x: 250, z: 250 }],
    ] as const) {
      anna.health = 100; anna.stamina = 100; anna.totBis = 0; anna.sprungSperreBis = 0;
      await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
      sendRolle(ws, 0, 55);
      await warte(100);
      check(`(set-up, ${wie}) a roll runs`, rolleLaeuft(anna, Date.now()));
      ws.rollen.length = 0;
      ws.aus.length = 0;
      mach();
      await warte(150);
      check(`${wie}: the client is told reason 2 (ended) with the number 55 of the roll that ran`, ws.aus.at(-1)?.grund === ROLLE_AUS_BEENDET && ws.aus.at(-1)?.nr === 55, JSON.stringify(ws.aus));
      check(`${wie} in the middle of a roll: the roll is over at the server, the client got Rolle false`, anna.rolleBis === 0 && ws.rollen.join() === 'false', JSON.stringify(ws.rollen));
      await eingaben(ws, 0, 700); // the packets would carry the roll on for 0.7 s
      const dx = anna.position.x - ziel.x; const dz = anna.position.z - ziel.z;
      check(`${wie}: no movement along the roll direction after it (stays within 0.5 m of the target)`, Math.hypot(dx, dz) < 0.5, `${dx.toFixed(2)}, ${dz.toFixed(2)}`);
      anna.health = 100;
      zugriff.applyCreatureAttack({ x: anna.position.x, y: anna.position.y, z: anna.position.z - 2 }, wolf, 2.4, anna.worldId, anna.position);
      check(`${wie}: no longer invulnerable (the wolf's blow lands)`, anna.health < 100, `life ${anna.health}`);
      check(`${wie}: the roll lock STAYS (until the end of the clip + 0.5 s of the ended roll)`, anna.rolleSperreBis > 0, `${anna.rolleSperreBis - Date.now()} ms left`);
    }
    {
      // N1-2: after the clip, a teleport, then at once a new roll: the cooldown holds. N1-4: a teleport without a running roll is silent.
      anna.health = 100; anna.stamina = 100; anna.totBis = 0; anna.sprungSperreBis = 0;
      await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
      anna.rolleSperreBis = 0;
      sendRolle(ws, 0);
      await warte(100);
      check('(set-up) the roll before the teleport began', anna.rolleBis > 0 && anna.rolleStart > 0);
      await warte(ROLLE_DAUER_MS - 40); // the clip is over, the lock (0.5 s) runs
      const stamm = anna.rolleStart;
      ws.rollen.length = 0;
      (server as unknown as { teleportPeer(p: Peer, pos: Vector3, d: string | null): void }).teleportPeer(anna, { x: 260, y: anna.position.y, z: 260 }, null);
      await warte(100);
      check('TELEPORT after the clip: no `Rolle=false` (no roll ran), the lock stands', ws.rollen.length === 0 && anna.rolleSperreBis > Date.now(), JSON.stringify(ws.rollen));
      anna.stamina = 100;
      sendRolle(ws, 0);
      await warte(120);
      check('... and a new roll at once is refused (Rolle=false, same roll as before, stamina unchanged)', anna.rolleBis === 0 && ws.rollen.join() === 'false' && anna.stamina >= 100 - 0.5, `${JSON.stringify(ws.rollen)} ${anna.stamina} start ${anna.rolleStart} vs ${stamm}`);
      await warte(ROLLE_ABKLINGZEIT_MS + 300);
      ws.rollen.length = 0;
      (server as unknown as { teleportPeer(p: Peer, pos: Vector3, d: string | null): void }).teleportPeer(anna, { x: 262, y: anna.position.y, z: 262 }, null);
      sendAdmin(ws, 'fly'); await warte(100); sendAdmin(ws, 'fly'); await warte(100);
      check('a teleport and a flight on/off with no roll at all: the client gets no `Rolle=false`', ws.rollen.length === 0, JSON.stringify(ws.rollen));
      // the jump lock stays over a teleport, too
      anna.stamina = 100; anna.sprungSperreBis = 0;
      sendInput(ws, 0, 0, 0, false, true);
      await warte(80);
      const nachSprung = anna.stamina;
      (server as unknown as { teleportPeer(p: Peer, pos: Vector3, d: string | null): void }).teleportPeer(anna, { x: 264, y: anna.position.y, z: 264 }, null);
      sendInput(ws, 0, 0, 0, false, true);
      await warte(120);
      check('JUMP lock over a teleport: the second jump flag 200 ms later is not billed', nah(anna.stamina, nachSprung, 0.6) && anna.sprungSperreBis > Date.now(), `${nachSprung} -> ${anna.stamina}`);
    }

    // ── the admin switches the flight on in the middle of a roll (Z4) ──
    {
      anna.health = 100; anna.stamina = 100; anna.totBis = 0; anna.sprungSperreBis = 0;
      await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
      sendRolle(ws, 0);
      await warte(100);
      check('(set-up, flight) a roll runs', rolleLaeuft(anna, Date.now()) && !anna.flying);
      ws.rollen.length = 0;
      sendAdmin(ws, 'fly');
      await warte(150);
      check('FLIGHT switched on in the middle of a roll: the roll is over at the server, the client got Rolle false', anna.flying && anna.rolleBis === 0 && ws.rollen.join() === 'false', `${anna.flying} ${JSON.stringify(ws.rollen)}`);
      check('... the roll lock stays over the flight, too (no cooldown freed)', anna.rolleSperreBis > Date.now());
      const fz = { x: anna.position.x, z: anna.position.z };
      for (let t = 0; t < 700; t += 50) { sendInput(ws, 0, 0, 0, false); await warte(50); }
      check('... and the rest of the clip does not fly the figure along the roll direction (no input: it stands, within 0.2 m)', Math.hypot(anna.position.x - fz.x, anna.position.z - fz.z) < 0.2, `${Math.hypot(anna.position.x - fz.x, anna.position.z - fz.z).toFixed(2)} m`);
      sendAdmin(ws, 'fly');
      await warte(150);
      check('(clean-up) the flight is off again', !anna.flying);
    }

    // ── a jump flag in a roll is not billed (F4) ──
    anna.health = 100; anna.stamina = 100; anna.sprungSperreBis = 0;
    await warte(ROLLE_DAUER_MS + ROLLE_ABKLINGZEIT_MS);
    sendRolle(ws, 0);
    await warte(60);
    sendInput(ws, 0, 0, 0, false, true);
    await warte(100);
    sendInput(ws, 0, 0, 0, false, true);
    await warte(100);
    check('JUMP FLAGS during the roll (two packets): not billed (stamina 90, no jump lock)', nah(anna.stamina, 90, 0.5) && anna.sprungSperreBis === 0, `stamina ${anna.stamina}, lock ${anna.sprungSperreBis}`);
    await warte(ROLLE_DAUER_MS + 50);
    sendInput(ws, 0, 0, 0, false, true);
    await warte(100);
    check('... the same flag after the roll is billed (stamina 85)', nah(anna.stamina, 85, 0.6) && anna.sprungSperreBis > 0, `stamina ${anna.stamina}`);

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

    // ── inside a dungeon instance: own branch of handlePlayerInput (no collision at the server) ──
    console.log('\n[3b] The roll inside a dungeon instance');
    sendAdmin(ws, 'dungeon create forestcrypt 4242');
    const td = Date.now();
    let dungeonId: string | undefined;
    while (!dungeonId && Date.now() - td < 8000) {
      await warte(100);
      dungeonId = ws.admin.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
    }
    if (!dungeonId) throw new Error(`dungeon not created: ${ws.admin.join(' | ')}`);
    sendAdmin(ws, `dungeon enter ${dungeonId}`);
    const te = Date.now();
    while (anna.worldId === 'haupt' && Date.now() - te < 8000) await warte(100);
    check('Anna is inside the instance', anna.worldId !== 'haupt', anna.worldId);
    await warte(300);
    await eingaben(ws, 0, 200);
    anna.stamina = 100;
    const dv = { x: anna.position.x, z: anna.position.z };
    sendRolle(ws, 0);
    await warte(60);
    check('inside the dungeon the roll is accepted (no free-room check there: the server has no room colliders)', anna.rolleBis > Date.now() - 100 && nah(anna.stamina, 90, 0.5), `stamina ${anna.stamina}`);
    for (let t = 0; t <= 800; t += 50) { sendInput(ws, 0, 1, 1, true); await warte(50); }
    await warte(100);
    sendInput(ws, 0, 0, 0, false);
    await warte(80);
    const dweg = Math.hypot(anna.position.x - dv.x, anna.position.z - dv.z);
    check('DUNGEON ROLL: 4.85 +- 0.1 m along -z, WASD and running of the packets ignored', nah(dweg, ROLLE_WEG_M, 0.1) && nah(anna.position.x, dv.x, 0.05) && anna.position.z < dv.z - 4.7, `${dweg.toFixed(3)} m, x ${(anna.position.x - dv.x).toFixed(3)}, z ${(anna.position.z - dv.z).toFixed(3)}`);
    check('... and the running flag cost nothing during it (stamina 90 +- 1)', nah(anna.stamina, 90, 1), `${anna.stamina}`);
  } finally {
    for (const s of sockets) s.close();
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    rmSync(resolve(__dirname, 'dungeons', 'd3-rolle'), { recursive: true, force: true }); // the instance of [3b] writes its file next to the test dirs
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
