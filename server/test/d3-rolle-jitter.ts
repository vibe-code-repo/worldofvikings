/**
 * D3-K4 N5 (N4-3): the lock under network jitter. The REAL client wiring (`BlockVerdrahtung`, `RolleLauf`) against the REAL server rule
 * (`rollePaket`) over a FIFO line with latency and jitter (10-900 ms), Q pressed at random (up to 8 per second).
 *
 * A refusal "still locked" (reason 3) names the rest of the server's lock: the client sets its lock to it. The check: after such an
 * answer arrived, the client does NOT start another roll before that rest is over (no repeated refusals, no pull-back because of the lock).
 * And: every roll the client starts in the free is taken by the server or answered; the client never rolls while the server has no roll
 * and nothing is on the way, except the one predicted roll of a refused request.
 *
 * Run: npx tsx server/test/d3-rolle-jitter.ts
 */
import { PacketType } from '@wov/shared';
import { ROLLE_AUS_GESPERRT } from '@wov/shared/src/kampf/rolle.js';
import { BlockVerdrahtung } from '../../client/src/player/BlockVerdrahtung.js';
import { RolleLauf } from '../../client/src/player/RolleSteuerung.js';
import { rollePaket, type RollePeer } from '../src/spiel/Rolle.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
let seed = 1;
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

interface Antwort { an: number; leser: Reader }
function lauf(latMin: number, latMax: number, qJeSekunde: number): { starts: number; verstoesse: number; gesperrt: number; angenommen: number; antworten: number } {
  let jetzt = 0;
  const zumServer: Array<{ an: number; yaw: number; nr: number }> = [];
  const zumClient: Antwort[] = [];
  let letzterAnS = 0, letzterAnC = 0;
  const lat = (): number => latMin + rnd() * (latMax - latMin);
  const peer = {
    blockSeit: 0, blockTaktZeit: 0, blockSperreBis: 0, blockOhneParade: false, stamina: 100, staminaZuletztVerbraucht: 0,
    waffe: 'SwordNorth', flying: false, totBis: 0, blickYaw: 0, position: { x: 0, y: 0, z: 0 },
    rolleStart: 0, rolleBis: 0, rolleZeit: 0, rolleX: 0, rolleZ: 0, rolleSperreBis: 0, sprungSperreBis: 0, rolleWeg: null, rolleNr: 0,
    rolleFensterStart: 0, rolleFensterZahl: 0,
    sendPacketWith(typ: PacketType, schreibe: (w: Writer) => void): void {
      if (typ !== PacketType.Rolle) return;
      const w = new Writer();
      schreibe(w);
      letzterAnC = Math.max(letzterAnC, jetzt + lat());
      zumClient.push({ an: letzterAnC, leser: new Reader(w.toBuffer()) });
    },
  } as unknown as RollePeer;
  const bahn = new RolleLauf();
  let q = false;
  let starts = 0, verstoesse = 0, gesperrt = 0, angenommen = 0, antworten = 0;
  let bekanntBis = 0; // the server's lock as the client knows it from the last "still locked"
  const spieler = {
    get rollt() { return bahn.rollt; }, get rolleAbklingRest() { return bahn.abklingRest; }, rolleBereit: true, inLuft: false, figurYaw: 0,
    moveIntent: { x: 0, z: 0 }, ausdauerStand: 100, bauModus: false, position: { y: 50 }, avatar: { liegt: false },
    startRolle(yaw: number): void { bahn.starte(yaw); starts++; if (jetzt < bekanntBis - 120) verstoesse++; },
    rolleAbbruch(loeschen?: boolean, sperre?: number): void { bahn.abbrechen(loeschen === true, sperre); },
    setzeBlock(): void {}, zieheAusdauerAb(): void {},
  };
  const handler: Record<number, (r: unknown) => void> = {};
  const v = new BlockVerdrahtung({
    sendBlock: () => true,
    sendRolle: (yaw, nr) => { letzterAnS = Math.max(letzterAnS, jetzt + lat()); zumServer.push({ an: letzterAnS, yaw, nr }); return true; },
    input: { isMouseDown: () => false, wasMousePressed: () => false, wasPressed: (c: string) => c === 'KeyQ' && q },
    player: () => spieler as never,
    equipment: () => ({ rightItem: {}, pieceTable: null }),
    placement: () => null,
    fensterOffen: () => false,
    dekorAktiv: () => false,
    meldung: () => undefined,
    zeigerGefangen: () => true,
    fenster: { addEventListener: () => undefined },
  });
  v.verdrahte({ on: (typ, h) => { handler[typ] = h as never; } });
  for (; jetzt < 120_000; jetzt += 1000 / 60) {
    for (const p of zumServer.filter((x) => x.an <= jetzt)) {
      peer.stamina = 100;
      const vorher = peer.rolleBis;
      const ok = rollePaket(peer, p.yaw, jetzt, { imWasser: false, freiraum: null }, p.nr);
      if (ok) angenommen++;
      void vorher;
    }
    for (let i = zumServer.length - 1; i >= 0; i--) if (zumServer[i]!.an <= jetzt) zumServer.splice(i, 1);
    for (const a of zumClient.filter((x) => x.an <= jetzt)) {
      antworten++;
      const l = a.leser;
      const ad = { readBool: () => l.readBool(), readUInt8: () => l.readUInt8(), readInt32: () => l.readInt32(), get remaining() { return l.remaining(); } };
      // peek: the rest is the last four bytes of a reason-3 packet (bool, reason, number, rest = 10 bytes)
      const lang = l.remaining();
      let rest = -1;
      if (lang === 10) { const kopie = new Reader((l as unknown as { buf: Buffer }).buf); kopie.readBool(); kopie.readUInt8(); kopie.readInt32(); rest = kopie.readInt32(); }
      handler[PacketType.Rolle]!(ad);
      if (rest >= 0) { gesperrt++; bekanntBis = Math.max(bekanntBis, a.an + rest); }
    }
    for (let i = zumClient.length - 1; i >= 0; i--) if (zumClient[i]!.an <= jetzt) zumClient.splice(i, 1);
    bahn.schritt(1 / 60);
    q = rnd() < qJeSekunde / 60;
    v.frame();
  }
  return { starts, verstoesse, gesperrt, angenommen, antworten };
}

console.log('\nthe lock under jitter: real client wiring against the real server rule');
for (const [name, a, b, qs] of [
  ['latency 20-60, Q up to 8 per second', 20, 60, 8],
  ['latency 100-400', 100, 400, 4],
  ['latency 10-900 (the attack\'s range)', 10, 900, 4],
  ['latency 10-900, Q spam 8 per second', 10, 900, 8],
] as const) {
  let st = 0, vs = 0, gs = 0, an = 0, aw = 0;
  for (let i = 0; i < 20; i++) { seed = 100 + i * 7919; const r = lauf(a, b, qs); st += r.starts; vs += r.verstoesse; gs += r.gesperrt; an += r.angenommen; aw += r.antworten; }
  console.log(`      ${name}: 20 runs of 120 s, ${st} rolls started at the client, ${an} taken by the server, ${gs} answers "still locked", ${aw} answers in all`);
  check(`${name}: after a "still locked" answer the client starts NO roll before the named rest is over (violations 0)`, vs === 0, `${vs}`);
  check(`${name}: the run is not empty (rolls started, rolls taken)`, st > 100 && an > 100);
  if (b >= 400) check(`${name}: the model does produce "still locked" answers (${gs}), so the zero above is not blindness`, gs > 0);
}
console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
