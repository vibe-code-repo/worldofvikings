/**
 * D3-K4: the dodge roll (key Q) and the jump report on the client.
 *
 *  [1] The conflict table of the key: one row at a time forbids it, the rest of the matrix allows it; the order.
 *  [2] The clock of a roll (`RolleLauf`): the movement time adds up to 0.8333 s at any frame rate, the clip ends at
 *      875 ms, the lock of 0.5 s runs after it.
 *  [3] The REAL PlayerController (NullEngine, plain path): a roll goes 4.853 m along the walking direction (without
 *      input: along the facing), WASD is ignored while it runs, stamina -10, Shift costs nothing, no jump during it,
 *      the lock holds; the client path and the server path (shared step, the way `Spielerbewegung.rolleVorschau` runs
 *      it) end less than 0.1 m apart at 60 and at 20 frames per second, in six directions.
 *  [4] The jump report (`SprungMeldung`): once per jump, lock 0.8 s, 5 stamina, none in a roll; and `main.ts` puts
 *      `player.nimmSprung()` in the jump slot of the input packet instead of `false` (checked on the syntax tree).
 *  [5] `BlockVerdrahtung` with the key: Q sends `Rolle` once with the yaw, ends a held block first, the offline
 *      test flight (no line) neither rolls nor takes the key, the refused cases send nothing, the server's `Rolle=false`
 *      and a teleport stop the roll.
 *  [6] The wire: `sendRolle` = [90, Float32 yaw], false without a line.
 *
 * Run: npx tsx client/test/d3-rolle-client.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { PacketType } from '@wov/shared';
import { PlayerController } from '../src/player/PlayerController.js';
import { RolleLauf, ROLLE_SPERREN, SprungMeldung, rolleRichtungYaw, rolleSperre, type RolleUmfeld } from '../src/player/RolleSteuerung.js';
import { BlockVerdrahtung, type BlockQuellen } from '../src/player/BlockVerdrahtung.js';
import { GameSocket } from '../src/net/GameSocket.js';
import { ROLLE_ABKLINGZEIT_MS, ROLLE_AUSDAUER, ROLLE_BEWEGUNG_S, ROLLE_DAUER_MS, ROLLE_WEG_M, rolleRichtung } from '@wov/shared/src/kampf/rolle.js';
import { bewegungsSchritt } from '@wov/shared/src/bewegung/schritt.js';
import { ebenerBoden, OHNE_HINDERNISSE } from '@wov/shared/src/bewegung/abfragen.js';
import { AUSDAUER_REGEL } from '@wov/shared/src/bewegung/ausdauer.js';
import type { InputManager } from '../src/engine/InputManager.js';
import type { ClientWorld } from '../src/world/World.js';

const HIER = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const nah = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

(SceneLoader as unknown as { ImportMeshAsync: unknown }).ImportMeshAsync = () => Promise.reject(new Error('kein Modell in diesem Test'));

// ── [1] the table ─────────────────────────────────────────────────────────
console.log('\n[1] The conflict table of the key');
const ok: RolleUmfeld = {
  qFlanke: true, zeigerGefangen: true, fensterOffen: false, dekorPlatzieren: false, baumodus: false, tot: false, imWasser: false,
  inLuft: false, nichtBereit: false, rollt: false, abklingRest: 0, ausdauer: 100,
};
{
  check('the free matrix allows the roll', rolleSperre(ok) === null);
  const faelle: Array<[string, Partial<RolleUmfeld>]> = [
    ['tot', { tot: true }], ['baumodus', { baumodus: true }], ['zeiger-frei', { zeigerGefangen: false }],
    ['fenster-offen', { fensterOffen: true }], ['dekor-platzieren', { dekorPlatzieren: true }], ['nicht-bereit', { nichtBereit: true }],
    ['laeuft', { rollt: true }], ['abklingzeit', { abklingRest: 0.01 }], ['wasser', { imWasser: true }], ['luft', { inLuft: true }],
    ['ausdauer', { ausdauer: 9.99 }],
  ];
  for (const [id, aenderung] of faelle) check(`row "${id}" forbids the roll (and only it)`, rolleSperre({ ...ok, ...aenderung }) === id, String(rolleSperre({ ...ok, ...aenderung })));
  check('the table has exactly these rows (a new row needs a case here)', ROLLE_SPERREN.map((z) => z.id).join() === faelle.map((f) => f[0]).join(), ROLLE_SPERREN.map((z) => z.id).join());
  check('stamina 10 allows it', rolleSperre({ ...ok, ausdauer: 10 }) === null);
  check('order: dead beats the rest', rolleSperre({ ...ok, tot: true, baumodus: true, ausdauer: 0 }) === 'tot');
  check('free hand needed? no: the table has no row for the hand (the roll needs no item)', !ROLLE_SPERREN.some((z) => /hand|item/.test(z.id)));
  check('direction: with input the walking direction, without it the facing of the figure', nah(rolleRichtungYaw(-1, 0, 0.3), Math.atan2(1, 0)) && rolleRichtungYaw(0, 0, 0.3) === 0.3);
}

// ── [2] the clock ─────────────────────────────────────────────────────────
console.log('\n[2] The clock of a roll');
{
  for (const fps of [120, 60, 30, 10]) {
    const l = new RolleLauf();
    l.starte(0);
    let bewegt = 0;
    let t = 0;
    let endeBei = -1;
    for (let i = 0; i < fps * 2; i++) {
      bewegt += l.schritt(1 / fps).bewegt;
      t += 1 / fps;
      if (!l.rollt && endeBei < 0) endeBei = t;
    }
    check(`${fps} fps: the movement adds up to ${(ROLLE_BEWEGUNG_S).toFixed(4)} s`, nah(bewegt, ROLLE_BEWEGUNG_S, 1e-9), `${bewegt}`);
    check(`${fps} fps: the roll ends at the clip length 875 ms (within one frame)`, endeBei >= 0.875 - 1e-9 && endeBei <= 0.875 + 1 / fps + 1e-9, `${endeBei}`);
  }
  const l = new RolleLauf();
  l.starte(0);
  for (let i = 0; i < 52; i++) l.schritt(1 / 60); // 0.8667 s
  check('0.8667 s: still rolling', l.rollt);
  l.schritt(1 / 60); // 0.8833 s
  check('0.8833 s: over, the lock 0.5 s minus the 8 ms that passed', !l.rollt && nah(l.abklingRest, 0.5 - (53 / 60 - 0.875), 1e-9), `${l.abklingRest}`);
  for (let i = 0; i < 29; i++) l.schritt(1 / 60);
  check('the lock holds for 0.5 s after the clip and then lets go', l.abklingRest > 0 && (l.schritt(1 / 60), l.abklingRest === 0));
  l.starte(1);
  l.abbrechen();
  check('abbrechen ends the roll without a lock', !l.rollt && l.abklingRest === 0);
  check('no roll: no movement', new RolleLauf().schritt(1).bewegt === 0);
}

// ── [3] the real controller ───────────────────────────────────────────────
console.log('\n[3] The real PlayerController');
class Eingabe {
  readonly tasten = new Set<string>();
  dx = 0;
  isDown(code: string): boolean { return this.tasten.has(code); }
  wasPressed(): boolean { return false; }
  consumeMouseDelta(): [number, number] { const r: [number, number] = [this.dx, 0]; this.dx = 0; return r; }
  consumeWheel(): number { return 0; }
}
function neu(): { pc: PlayerController; ein: Eingabe } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const ein = new Eingabe();
  const welt = { getGroundHeight: () => 0 } as unknown as ClientWorld;
  return { pc: new PlayerController(scene, ein as unknown as InputManager, welt), ein };
}
const lauf = (pc: PlayerController, sek: number, dt: number): void => { for (let i = 0; i < Math.round(sek / dt); i++) pc.update(dt); };
{
  const { pc } = neu();
  pc.update(1 / 60);
  check('the key can roll: bereit, no roll, no lock, full stamina', pc.rolleBereit && !pc.rollt && pc.rolleAbklingRest === 0 && pc.ausdauerStand === AUSDAUER_REGEL.max);
  const x0 = pc.position.x;
  const z0 = pc.position.z;
  pc.startRolle(0);
  check('startRolle: stamina -10 at once, rolling, the figure faces the roll', pc.rollt && nah(pc.ausdauerStand, AUSDAUER_REGEL.max - ROLLE_AUSDAUER, 0.2) && pc.figurYaw === 0, `${pc.ausdauerStand}`);
  lauf(pc, ROLLE_DAUER_MS / 1000 + 0.05, 1 / 60);
  const weg = Math.hypot(pc.position.x - x0, pc.position.z - z0);
  check('a roll goes 4.853 m (+- 0.05)', nah(weg, ROLLE_WEG_M, 0.05), `${weg.toFixed(4)} m`);
  check('... along -z (yaw 0 = the view direction)', pc.position.z - z0 < -4.8 && Math.abs(pc.position.x - x0) < 1e-6);
  check('the roll is over after the clip and the lock runs', !pc.rollt && pc.rolleAbklingRest > 0 && pc.rolleAbklingRest <= ROLLE_ABKLINGZEIT_MS / 1000, `${pc.rolleAbklingRest}`);
  const rig = pc.avatar as unknown as { rolleAn: boolean };
  check('the rig is told "no roll" afterwards', rig.rolleAn === false);
}
{
  // WASD is ignored, Shift costs nothing, no jump, the figure keeps the roll direction.
  const { pc, ein } = neu();
  pc.update(1 / 60);
  pc.startRolle(Math.PI / 2); // along -x
  const rig = pc.avatar as unknown as { rolleAn: boolean };
  ein.tasten.add('KeyD');
  ein.tasten.add('KeyW');
  ein.tasten.add('ShiftLeft');
  pc.update(1 / 60);
  check('the rig is told "roll" while it runs', rig.rolleAn === true);
  lauf(pc, 0.8, 1 / 60);
  check('WASD (D+W+Shift) did not change the path: all of it along -x', pc.position.x < -4.7 && Math.abs(pc.position.z) < 1e-6, `x ${pc.position.x.toFixed(3)} z ${pc.position.z.toFixed(3)}`);
  check('the intent that goes to the server is the roll direction, not running', nah(pc.moveIntent.x, -1, 1e-9) && Math.abs(pc.moveIntent.z) < 1e-9 && !pc.moveIntent.running, JSON.stringify(pc.moveIntent));
  check('Shift during the roll costs nothing beyond the 10', pc.ausdauerStand > AUSDAUER_REGEL.max - ROLLE_AUSDAUER - 0.5, `${pc.ausdauerStand}`);
  check('the figure faced the roll direction all along (the walking keys do not turn it)', nah(pc.figurYaw, Math.PI / 2, 1e-9), `${pc.figurYaw}`);
}
{
  // Client and server end less than 0.1 m apart.
  const boden = ebenerBoden(0);
  const server = (yaw: number): { x: number; z: number } => {
    const r = rolleRichtung(yaw);
    const n = Math.ceil(ROLLE_BEWEGUNG_S * 60 - 1e-9);
    let z = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) z = bewegungsSchritt(z, { x: r.x, z: r.z, rennt: false, blockt: false, rollt: true }, ROLLE_BEWEGUNG_S / n, boden, OHNE_HINDERNISSE);
    return z;
  };
  for (const yaw of [0, 1, -1, 2, 3, -2.5]) {
    for (const dt of [1 / 60, 1 / 20]) {
      const { pc } = neu();
      pc.update(1 / 60);
      pc.startRolle(yaw);
      lauf(pc, 1, dt);
      const s = server(yaw);
      const abstand = Math.hypot(pc.position.x - s.x, pc.position.z - s.z);
      check(`yaw ${yaw}, ${Math.round(1 / dt)} fps: client and server end ${abstand.toFixed(4)} m apart (< 0.1)`, abstand < 0.1);
    }
  }
}
{
  // Without input the roll goes along the facing; the lock refuses nothing here (the table does that), the controller only rolls.
  const { pc, ein } = neu();
  ein.tasten.add('KeyA');
  lauf(pc, 0.4, 1 / 60); // the figure turns towards its walking direction
  const yaw = pc.figurYaw;
  check('(set-up) the figure faces its walking direction, not 0', Math.abs(yaw) > 0.3, `${yaw}`);
  check('direction rule: no input -> the facing', rolleRichtungYaw(0, 0, yaw) === yaw);
}
{
  // A roll cannot run on in build mode, frozen or dead.
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(0);
  pc.frozen = true;
  pc.update(1 / 60);
  check('frozen (dungeon loading): the roll ends', !pc.rollt);
  const b = neu().pc;
  b.update(1 / 60);
  b.startRolle(0);
  b.setBauModus(true);
  b.update(1 / 60);
  check('build mode: the roll ends', !b.rollt);
  const r = neu().pc;
  r.update(1 / 60);
  r.startRolle(0);
  r.rolleAbbruch();
  check('rolleAbbruch (server refused it): no roll and no lock', !r.rollt && r.rolleAbklingRest === 0);
}

// ── [4] the jump report ───────────────────────────────────────────────────
console.log('\n[4] The jump report');
{
  const s = new SprungMeldung();
  check('no jump: the flag is false', s.nimm() === false);
  check('allowed with stamina 5 (not 4.99), not in a roll', s.erlaubt(5, false) && !s.erlaubt(4.99, false) && !s.erlaubt(100, true));
  const nach = s.springe(100);
  check('a jump costs 5 stamina', nach === 95);
  check('the flag is reported ONCE (true, then false)', s.nimm() === true && s.nimm() === false);
  check('inside the lock (0.8 s) a second jump is not allowed', !s.erlaubt(95, false));
  s.schritt(0.79);
  check('0.79 s later: still locked', !s.erlaubt(95, false));
  s.schritt(0.011);
  check('0.801 s later: allowed again', s.erlaubt(95, false));
  s.springe(95);
  s.springe(90); // a second jump before the packet: still one flag
  check('two jumps before one packet are one flag (the server bills one lock anyway)', s.nimm() === true && s.nimm() === false);
  const { pc } = neu();
  check('the controller offers the flag: false without a jump', pc.nimmSprung() === false && typeof pc.nimmSprung === 'function');
}
{
  const quelle = readFileSync(resolve(HIER, '../src/main.ts'), 'utf-8');
  const sf = ts.createSourceFile('main.ts', quelle, ts.ScriptTarget.Latest, true);
  const aufrufe: ts.CallExpression[] = [];
  const geh = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'sendPlayerInput') aufrufe.push(n);
    ts.forEachChild(n, geh);
  };
  geh(sf);
  const letztes = aufrufe[0]?.arguments[6]?.getText(sf) ?? '';
  // the rest of the wiring in main.ts: the roll hooks, the swing lock
  const eigenschaften = new Set<string>();
  const sucheQuellen = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && n.expression.getText(sf) === 'BlockVerdrahtung' && n.arguments?.[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of n.arguments[0].properties) if (p.name) eigenschaften.add(p.name.getText(sf));
    }
    ts.forEachChild(n, sucheQuellen);
  };
  sucheQuellen(sf);
  check('main.ts: BlockVerdrahtung gets the roll sources (sendRolle, meldung, serverText)', ['sendRolle', 'meldung', 'serverText'].every((k) => eigenschaften.has(k)), [...eigenschaften].join());
  let angriffsBedingung = '';
  const sucheAngriff = (n: ts.Node): void => {
    if (ts.isIfStatement(n) && n.expression.getText(sf).includes('wasMousePressed(0)')) angriffsBedingung = n.expression.getText(sf);
    ts.forEachChild(n, sucheAngriff);
  };
  sucheAngriff(sf);
  check('main.ts: the swing condition (left click) contains `!player.rollt` (no swing during a roll)', /!player\.rollt/.test(angriffsBedingung), angriffsBedingung.slice(0, 80));
  check('main.ts: one sendPlayerInput call, its 7th argument (jumping) is `player.nimmSprung()`, no literal `false`', aufrufe.length === 1 && letztes === 'player.nimmSprung()', `${aufrufe.length} calls, 7th: ${letztes}`);
}

// ── [5] the key in the wiring ─────────────────────────────────────────────
console.log('\n[5] BlockVerdrahtung with the key Q');
interface Spiel {
  q: boolean; rechts: boolean; flanke: boolean; online: boolean; gesendet: Array<string>; meldungen: string[];
  gefangen: boolean; ausdauer: number; rollt: boolean; inLuft: boolean; abkling: number; bereit: boolean; liegt: boolean; y: number;
  starts: number[]; abbrueche: number; fenster: boolean;
}
function neuesSpiel(): { v: BlockVerdrahtung; spiel: Spiel } {
  const spiel: Spiel = { q: false, rechts: false, flanke: false, online: true, gesendet: [], meldungen: [], gefangen: true, ausdauer: 100, rollt: false, inLuft: false, abkling: 0, bereit: true, liegt: false, y: 50, starts: [], abbrueche: 0, fenster: false };
  const q: BlockQuellen = {
    sendBlock: (an) => { spiel.gesendet.push(`block:${an}`); },
    sendRolle: (yaw) => { if (!spiel.online) return false; spiel.gesendet.push(`rolle:${yaw.toFixed(3)}`); return true; },
    meldung: (t) => spiel.meldungen.push(t),
    serverText: (k) => `T(${k})`,
    input: { isMouseDown: (b) => b === 2 && spiel.rechts, wasMousePressed: (b) => b === 2 && spiel.flanke, wasPressed: (c) => c === 'KeyQ' && spiel.q },
    player: () => ({
      setzeBlock: () => undefined, bauModus: false,
      get position() { return { y: spiel.y }; }, get avatar() { return { liegt: spiel.liegt }; },
      get rollt() { return spiel.rollt; }, get rolleAbklingRest() { return spiel.abkling; }, get rolleBereit() { return spiel.bereit; },
      get inLuft() { return spiel.inLuft; }, get ausdauerStand() { return spiel.ausdauer; }, figurYaw: 0.25,
      moveIntent: { x: -1, z: 0 },
      startRolle: (yaw: number) => spiel.starts.push(yaw), rolleAbbruch: () => { spiel.abbrueche++; },
    }),
    equipment: () => ({ rightItem: {}, pieceTable: null }),
    placement: () => null,
    fensterOffen: () => spiel.fenster,
    dekorAktiv: () => false,
    zeigerGefangen: () => spiel.gefangen,
    fenster: { addEventListener: () => undefined },
  };
  return { v: new BlockVerdrahtung(q), spiel };
}
const taste = (v: BlockVerdrahtung, spiel: Spiel): void => { spiel.q = true; v.frame(); spiel.q = false; };
{
  const { v, spiel } = neuesSpiel();
  taste(v, spiel);
  check('Q: one `Rolle` with the walking direction (A = -x: yaw = atan2(1, 0)), the controller starts it once', spiel.gesendet.join() === `rolle:${(Math.PI / 2).toFixed(3)}` && spiel.starts.length === 1 && nah(spiel.starts[0]!, Math.PI / 2, 1e-9), spiel.gesendet.join());
  v.frame();
  check('no key press, no second roll', spiel.gesendet.length === 1);
}
{
  const { v, spiel } = neuesSpiel();
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  check('(set-up) blocking', v.blockt && spiel.gesendet.join() === 'block:true');
  taste(v, spiel);
  check('Q while blocking: the block ends FIRST (Block false), then the roll goes out', spiel.gesendet.join() === `block:true,block:false,rolle:${(Math.PI / 2).toFixed(3)}` && !v.blockt, spiel.gesendet.join());
  v.frame();
  check('the right button is still held: no new block (a fresh press is needed)', !v.blockt && spiel.gesendet.length === 3);
}
{
  const { v, spiel } = neuesSpiel();
  spiel.online = false;
  taste(v, spiel);
  check('offline (the editor test flight): no roll started, nothing sent', spiel.starts.length === 0 && spiel.gesendet.length === 0);
}
{
  const faelle: Array<[string, (s: Spiel) => void]> = [
    ['dead', (s) => { s.liegt = true; }], ['pointer free', (s) => { s.gefangen = false; }], ['window open', (s) => { s.fenster = true; }],
    ['in the air', (s) => { s.inLuft = true; }], ['in the water', (s) => { s.y = -5; }], ['a roll running', (s) => { s.rollt = true; }],
    ['lock', (s) => { s.abkling = 0.2; }], ['not ready', (s) => { s.bereit = false; }],
  ];
  for (const [name, setze] of faelle) {
    const { v, spiel } = neuesSpiel();
    setze(spiel);
    taste(v, spiel);
    check(`refused (${name}): nothing sent, nothing started`, spiel.gesendet.length === 0 && spiel.starts.length === 0, spiel.gesendet.join());
  }
  const { v, spiel } = neuesSpiel();
  spiel.ausdauer = 9;
  taste(v, spiel);
  check('stamina 9: nothing sent, the HUD says "too exhausted" through the catalogue key', spiel.gesendet.length === 0 && spiel.meldungen.join() === 'T(@kampf.zu_erschoepft)', spiel.meldungen.join());
}
{
  const { v, spiel } = neuesSpiel();
  const handler: Record<number, (r: { readBool(): boolean }) => void> = {};
  v.verdrahte({ on: (typ, h) => { handler[typ] = h as never; } });
  handler[PacketType.Rolle]!({ readBool: () => false });
  check('the server\'s `Rolle=false` stops the roll', spiel.abbrueche === 1);
  handler[PacketType.Rolle]!({ readBool: () => true });
  check('`Rolle=true` does not', spiel.abbrueche === 1);
  handler[PacketType.Teleport]!({ readBool: () => false });
  check('a teleport stops the roll too', spiel.abbrueche === 2);
}

// ── [6] the wire ──────────────────────────────────────────────────────────
console.log('\n[6] sendRolle');
{
  const gesendet: number[][] = [];
  const socket = new GameSocket('ws://test.invalid', 'Test');
  (socket as unknown as { ws: unknown }).ws = { readyState: WebSocket.OPEN, send: (b: ArrayBuffer) => gesendet.push([...new Uint8Array(b)]) };
  check('the packet type is 90', PacketType.Rolle === 90);
  check('sendRolle returns true and sends [90, 4 bytes]', socket.sendRolle(1.5) === true && gesendet.length === 1 && gesendet[0]![0] === 90 && gesendet[0]!.length === 5);
  const f = new DataView(new Uint8Array(gesendet[0]!.slice(1)).buffer).getFloat32(0, true);
  check('the 4 bytes are the Float32 yaw (little endian)', nah(f, 1.5, 1e-6), `${f}`);
  const zu = new GameSocket('ws://test.invalid', 'Test');
  check('no line: false, nothing sent', zu.sendRolle(1) === false);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
