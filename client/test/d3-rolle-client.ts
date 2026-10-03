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
 *      The roll follows the curve of the clip (`rolleWegAnteil`: 85 % of the path in the first 0.375 s) and runs on REAL
 *      time: at 144, 60, 20, 5 and 3 frames per second the figure stands on the curve and the roll ends after 875 ms.
 *  [5] `BlockVerdrahtung` with the key: Q sends `Rolle` once with the yaw and HIDES a held block (the server ends it when
 *      it accepts the roll; a refused roll leaves it: the block is back without a new `Block(true)` and without 5 more
 *      stamina), the offline test flight (no line) neither rolls nor takes the key, the refused cases send nothing, the
 *      server's `Rolle=false` and a teleport stop the roll.
 *  [5a] `Rolle=false` with a reason (refused: no lock, Q at once; ended: the lock stays; no reason byte: ended) and the roll
 *      number (a late answer to an older roll does not touch the newer one).
 *  [6] The wire: `sendRolle` = [90, Float32 yaw, Int32 roll number], false without a line.
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
import { Vector3 } from '@babylonjs/core/Maths/math';
import { CharacterSupportedState } from '@babylonjs/core/Physics/v2/characterController';
import { PlayerController } from '../src/player/PlayerController.js';
import { BlockSteuerung, blockSperre, type BlockUmfeld } from '../src/player/BlockSteuerung.js';
import { RolleLauf, ROLLE_SPERREN, SprungMeldung, rolleRichtungYaw, rolleSperre, type RolleUmfeld } from '../src/player/RolleSteuerung.js';
import { BlockVerdrahtung, type BlockQuellen } from '../src/player/BlockVerdrahtung.js';
import { Abgleicher } from '../src/net/Positionsverlauf.js';
import { GameSocket } from '../src/net/GameSocket.js';
import { ROLLE_AUS_ABGELEHNT, ROLLE_AUS_BEENDET, ROLLE_AUS_GESPERRT, ROLLE_ABKLINGZEIT_MS, ROLLE_AUSDAUER, ROLLE_BEWEGUNG_S, ROLLE_DAUER_MS, ROLLE_TEMPO, ROLLE_WEG_M, rolleRichtung, rolleWegAnteil } from '@wov/shared/src/kampf/rolle.js';
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
  check('abbrechen (N2-1) ends the roll in the middle of the clip but the lock stays as the server holds it: the rest of the clip (0.875 s) plus 0.5 s', !l.rollt && nah(l.abklingRest, ROLLE_DAUER_MS / 1000 + ROLLE_ABKLINGZEIT_MS / 1000, 1e-9), `${l.abklingRest}`);
  l.abbrechen();
  check('abbrechen again (no roll running): the lock is not touched', nah(l.abklingRest, 1.375, 1e-9));
  l.abbrechen(true);
  check('abbrechen(true) (death, revival: the server clears the locks) clears it', l.abklingRest === 0);
  const m = new RolleLauf();
  m.starte(0);
  for (let i = 0; i < 6; i++) m.schritt(0.1); // 0.6 s into the clip
  m.abbrechen();
  check('cut at 0.6 s: the lock is the 0.275 s left of the clip + 0.5 s (the server counts from the end of the clip)', nah(m.abklingRest, 0.275 + 0.5, 1e-9), `${m.abklingRest}`);
  const n = new RolleLauf();
  n.starte(0);
  for (let i = 0; i < 56; i++) n.schritt(1 / 60); // 0.933 s: the clip is over, 0.442 s of lock left
  const rest = n.abklingRest;
  n.abbrechen();
  check('a teleport after the clip: the running lock stays exactly (no roll, nothing reset)', rest > 0.4 && n.abklingRest === rest, `${rest} -> ${n.abklingRest}`);
  check('no roll: no movement', new RolleLauf().schritt(1).bewegt === 0);
}

// ── [3] the real controller ───────────────────────────────────────────────
console.log('\n[3] The real PlayerController');
class Eingabe {
  readonly tasten = new Set<string>();
  dx = 0;
  isDown(code: string): boolean { return this.tasten.has(code); }
  readonly flanken = new Set<string>();
  wasPressed(code: string): boolean { const r = this.flanken.has(code); this.flanken.delete(code); return r; }
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
  pc.update(1 / 60);
  check('one frame later the figure faces the roll direction at once (no turning rate: yaw 0 here)', pc.figurYaw === 0);
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
  // Z1 + Z3: the roll follows the curve of the clip and runs on REAL time: frames clamped to 0.1 s (main.ts) do not stretch it.
  for (const fps of [144, 60, 20, 5, 3]) {
    const { pc } = neu();
    pc.update(1 / 60);
    const z0 = pc.position.z;
    pc.startRolle(0);
    const echt = 1 / fps;
    let t = 0;
    let maxAbw = 0;
    let endeBei = -1;
    for (let i = 0; i < Math.ceil(2.5 * fps); i++) {
      pc.update(Math.min(echt, 0.1), echt);
      t += echt;
      maxAbw = Math.max(maxAbw, Math.abs(z0 - pc.position.z - rolleWegAnteil(t) * ROLLE_WEG_M));
      if (!pc.rollt && endeBei < 0) endeBei = t;
    }
    check(`${fps} fps: after every frame the figure stands on the curve of the clip within 0.05 m (max ${maxAbw.toFixed(4)} m)`, maxAbw < 0.05);
    check(`${fps} fps: the roll ends after 875 ms of real time (within one frame): ${endeBei.toFixed(3)} s`, endeBei >= ROLLE_DAUER_MS / 1000 - 1e-9 && endeBei <= ROLLE_DAUER_MS / 1000 + echt + 1e-9);
    check(`${fps} fps: the whole path is 4.853 m (+- 0.05)`, nah(z0 - pc.position.z, ROLLE_WEG_M, 0.05), `${(z0 - pc.position.z).toFixed(3)}`);
  }
  // the curve itself: 85 % of the path after 0.375 s, not the 45 % of a constant speed
  const { pc } = neu();
  pc.update(1 / 60);
  const z0 = pc.position.z;
  pc.startRolle(0);
  for (let i = 0; i < 23; i++) pc.update(1 / 60, 1 / 60); // 0.3833 s
  const anteil = (z0 - pc.position.z) / ROLLE_WEG_M;
  check('after 0.383 s the figure has covered about 85 % of the path (the front-loaded clip), not 45 %', anteil > 0.84 && anteil < 0.88, `${(anteil * 100).toFixed(1)} %`);
  // the old clamp: the same roll at 3 fps with the clamped frame time as the roll clock would take 3 s (the error of Z3)
  const { pc: alt } = neu();
  alt.update(1 / 60);
  alt.startRolle(0);
  let frames = 0;
  while (alt.rollt && frames < 100) { alt.update(0.1, 0.1); frames++; }
  check('(control) with the clamped time as the roll clock (echteDt = dt = 0.1) the roll ends after 9 frames, i.e. 0.9 s at 10 fps; the real-time clock is what keeps a 3 fps roll at 875 ms', frames === 9, `${frames} frames`);
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
  check('frozen (dungeon loading): the roll ends, the lock mirrors the server (it holds the roll): about 1.3 s', !pc.rollt && pc.rolleAbklingRest > 1.2, `${pc.rolleAbklingRest}`);
  const b = neu().pc;
  b.update(1 / 60);
  b.startRolle(0);
  b.setBauModus(true);
  b.update(1 / 60);
  check('build mode: the roll ends, the lock stays too', !b.rollt && b.rolleAbklingRest > 1.2, `${b.rolleAbklingRest}`);
  const r = neu().pc;
  r.update(1 / 60);
  r.startRolle(0);
  r.rolleAbbruch();
  check('rolleAbbruch (a teleport or the server ended it) at the first frame: no roll, the lock mirrors the server (about 1.37 s) and the table refuses Q', !r.rollt && r.rolleAbklingRest > 1.3 && rolleSperre({ ...ok, abklingRest: r.rolleAbklingRest }) === 'abklingzeit', `${r.rolleAbklingRest}`);
  // N2-1: a roll over, then a teleport: Q at once must not start a roll at the client
  const t = neu().pc;
  t.update(1 / 60);
  t.startRolle(0);
  lauf(t, 0.95, 1 / 60);
  const vorher = t.rolleAbklingRest;
  t.rolleAbbruch(); // the Teleport handler
  check('TELEPORT after the clip: the client lock stands (Q right after it is refused by the table, no predicted roll, no pull-back)', !t.rollt && t.rolleAbklingRest === vorher && vorher > 0.3 && rolleSperre({ ...ok, abklingRest: t.rolleAbklingRest }) === 'abklingzeit', `${vorher} -> ${t.rolleAbklingRest}`);
  // death: the controller aborts with a cleared lock (the server clears it too)
  const d = neu().pc;
  d.update(1 / 60);
  d.startRolle(0);
  d.update(1 / 60);
  Object.defineProperty(d.avatar, 'liegt', { get: () => true });
  d.update(1 / 60);
  check('dead during a roll: the roll ends and the lock is cleared (the server clears it at death)', !d.rollt && d.rolleAbklingRest === 0, `${d.rolleAbklingRest}`);
}

{
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(1.2);
  pc.update(1 / 60);
  check('a roll along yaw 1.2: the figure faces 1.2 after the first frame (not after the turning rate of 300 deg/s)', nah(pc.figurYaw, 1.2, 1e-12), `${pc.figurYaw}`);
}

{
  // What the controller tells the figure while it rolls (the clip, the speed, the run cycle as the fallback).
  const { pc } = neu();
  pc.update(1 / 60);
  const letzte: { speed: number; rennt: boolean; luft: boolean }[] = [];
  const orig = pc.avatar.update.bind(pc.avatar);
  pc.avatar.update = (dt: number, speed: number, maxSpeed: number, rennt = false, luft = false): void => { letzte.push({ speed, rennt, luft }); orig(dt, speed, maxSpeed, rennt, luft); };
  pc.update(1 / 60);
  check('(control) standing: the figure is told speed 0, no run, no air', letzte.at(-1)!.speed === 0 && !letzte.at(-1)!.rennt && !letzte.at(-1)!.luft);
  pc.startRolle(0);
  pc.update(1 / 60);
  check('rolling: the figure is told the roll speed (5.82 m/s) and the run cycle (the fallback without the clip), not "in the air"', nah(letzte.at(-1)!.speed, ROLLE_TEMPO, 1e-9) && letzte.at(-1)!.rennt && !letzte.at(-1)!.luft, JSON.stringify(letzte.at(-1)));
  // a roll stops a block, and no block starts during it (the table row and the wiring)
  check('the block table has the row "rolle" (a roll forbids a block)', blockSperre({ rechtsGedrueckt: true, rechtsFlanke: true, zeigerGefangen: true, fensterOffen: false, dekorPlatzieren: false, baumodus: false, bauteilGewaehlt: false, bauwerkzeug: false, gegenstandInHand: true, tot: false, imWasser: false, ausdauer: 100, rollt: true }) === 'rolle');
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
  // The jump through the controller's physics branch, with a stand-in capsule (the Havok body is not available here): the
  // decision (stamina, lock, roll) and the flag of the packet are the real code.
  class Kapsel {
    p = new Vector3(0, 1, 0);
    v = Vector3.Zero();
    checkSupport(): { supportedState: CharacterSupportedState } { return { supportedState: CharacterSupportedState.SUPPORTED }; }
    getVelocity(): Vector3 { return this.v.clone(); }
    setVelocity(v: Vector3): void { this.v = v.clone(); }
    integrate(dt: number): void { this.p.addInPlace(this.v.scale(dt)); }
    getPosition(): Vector3 { return this.p.clone(); }
    setPosition(x: Vector3): void { this.p.copyFrom(x); }
  }
  const mitKapsel = (): { pc: PlayerController; ein: Eingabe } => {
    const r = neu();
    r.pc.update(1 / 60);
    (r.pc as unknown as { controller: unknown }).controller = new Kapsel();
    return r;
  };
  const springen = (r: { pc: PlayerController; ein: Eingabe }): boolean => { r.ein.flanken.add('Space'); r.pc.update(1 / 60); return r.pc.nimmSprung(); };
  const { pc, ein } = mitKapsel();
  check('jump 1 (stamina 100): reported once, stamina 95, in the air', springen({ pc, ein }) === true && nah(pc.ausdauerStand, 95, 0.2) && pc.inLuft, `${pc.ausdauerStand}`);
  check('... the next packet carries no second flag', pc.nimmSprung() === false);
  let t = 1 / 60;
  while (pc.inLuft && t < 2) { pc.update(1 / 60); t += 1 / 60; }
  check('(set-up) the figure landed before the server\'s lock (0.8 s) ran out', !pc.inLuft && t < 0.8, `landed after ${t.toFixed(2)} s`);
  while (t < 0.7) { pc.update(1 / 60); t += 1 / 60; }
  const stamina2 = pc.ausdauerStand;
  check('jump 2 at ~0.7 s (inside the lock of 0.8 s): none, nothing reported, stamina unchanged', springen({ pc, ein }) === false && pc.ausdauerStand === stamina2 && !pc.inLuft, `${pc.ausdauerStand}`);
  while (t < 0.85) { pc.update(1 / 60); t += 1 / 60; }
  check('jump 3 at ~0.85 s (past the lock): reported once, stamina 5 less', springen({ pc, ein }) === true && nah(pc.ausdauerStand, stamina2 - 5, 0.2) && pc.nimmSprung() === false, `${pc.ausdauerStand}`);
  const arm = mitKapsel();
  arm.pc.setzeServerAusdauer(4.7); // regenerates 0.23 in the frame: still under 5
  const s49 = springen(arm);
  check('stamina 4.7: no jump, nothing reported', s49 === false && !arm.pc.inLuft && arm.pc.ausdauerStand > 4.6, `${s49}, air ${arm.pc.inLuft}, stamina ${arm.pc.ausdauerStand}`);
  const rollend = mitKapsel();
  rollend.pc.startRolle(0);
  check('during a roll: no jump', springen(rollend) === false && !rollend.pc.inLuft);
  // a space press while nothing is possible is not kept for later (landing, regeneration)
  const spaeter = mitKapsel();
  spaeter.pc.setzeServerAusdauer(4);
  springen(spaeter);
  spaeter.pc.setzeServerAusdauer(100);
  for (let i = 0; i < 10; i++) spaeter.pc.update(1 / 60);
  check('a refused jump press is not saved: with stamina back later nothing happens by itself', spaeter.pc.nimmSprung() === false && !spaeter.pc.inLuft);
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
  check('main.ts: BlockVerdrahtung gets the roll source `sendRolle` (and the message source of K3)', ['sendRolle', 'meldung'].every((k) => eigenschaften.has(k)), [...eigenschaften].join());
  let angriffsBedingung = '';
  const sucheAngriff = (n: ts.Node): void => {
    if (ts.isIfStatement(n) && n.expression.getText(sf).includes('wasMousePressed(0)')) angriffsBedingung = n.expression.getText(sf);
    ts.forEachChild(n, sucheAngriff);
  };
  sucheAngriff(sf);
  check('main.ts: the swing condition (left click) contains `!player.rollt` (no swing during a roll)', /!player\.rollt/.test(angriffsBedingung), angriffsBedingung.slice(0, 80));
  // Z3: the frame time of the controller is clamped to 0.1 s; the roll must get the REAL time as the second argument.
  const updates: string[] = [];
  const sucheUpdate = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'player!.update') updates.push(n.arguments.map((a) => a.getText(sf)).join(' | '));
    ts.forEachChild(n, sucheUpdate);
  };
  sucheUpdate(sf);
  check('main.ts: `player!.update(dt, engine.getDeltaTime() / 1000)` once: the roll clock gets the real frame time (Z3)', updates.length === 1 && /^dt \| engine\.getDeltaTime\(\) \/ 1000$/.test(updates[0]!), updates.join(' || '));
  // N1-1: the position reconciliation gets the roll flag (a roll runs or its lock) as the fifth argument.
  const meldungen: string[] = [];
  const sucheMeldung = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'abgleicher.serverMeldung') meldungen.push(n.arguments.map((a) => a.getText(sf)).join(' | '));
    ts.forEachChild(n, sucheMeldung);
  };
  sucheMeldung(sf);
  check('main.ts: `abgleicher.serverMeldung(…, player.rollt || player.rolleAbklingRest > 0)`: the higher threshold holds during a roll and its lock (N1-1)', meldungen.length === 1 && /\| player\.rollt \|\| player\.rolleAbklingRest > 0$/.test(meldungen[0]!), meldungen.join(' || '));
  check('main.ts: one sendPlayerInput call, its 7th argument (jumping) is `player.nimmSprung()`, no literal `false`', aufrufe.length === 1 && letztes === 'player.nimmSprung()', `${aufrufe.length} calls, 7th: ${letztes}`);
}

// ── [5] the key in the wiring ─────────────────────────────────────────────
console.log('\n[5] BlockVerdrahtung with the key Q');
interface Spiel {
  q: boolean; rechts: boolean; flanke: boolean; online: boolean; gesendet: Array<string>; meldungen: string[];
  gefangen: boolean; ausdauer: number; rollt: boolean; inLuft: boolean; abkling: number; bereit: boolean; liegt: boolean; y: number;
  starts: number[]; abbrueche: number; fenster: boolean; abzuege: number; blockPose: boolean[]; nrs: number[]; loeschen: boolean[]; sperren: Array<number | undefined>;
}
function neuesSpiel(): { v: BlockVerdrahtung; spiel: Spiel } {
  const spiel: Spiel = { q: false, rechts: false, flanke: false, online: true, gesendet: [], meldungen: [], gefangen: true, ausdauer: 100, rollt: false, inLuft: false, abkling: 0, bereit: true, liegt: false, y: 50, starts: [], abbrueche: 0, fenster: false, abzuege: 0, blockPose: [], nrs: [], loeschen: [], sperren: [] };
  const q: BlockQuellen = {
    sendBlock: (an) => { spiel.gesendet.push(`block:${an}`); },
    sendRolle: (yaw, nr) => { if (!spiel.online) return false; spiel.gesendet.push(`rolle:${yaw.toFixed(3)}`); spiel.nrs.push(nr); return true; },
    meldung: (t) => spiel.meldungen.push(t),
    input: { isMouseDown: (b) => b === 2 && spiel.rechts, wasMousePressed: (b) => b === 2 && spiel.flanke, wasPressed: (c) => c === 'KeyQ' && spiel.q },
    player: () => ({
      setzeBlock: (an: boolean) => { spiel.blockPose.push(an); }, zieheAusdauerAb: () => { spiel.abzuege++; }, bauModus: false,
      get position() { return { y: spiel.y }; }, get avatar() { return { liegt: spiel.liegt }; },
      get rollt() { return spiel.rollt; }, get rolleAbklingRest() { return spiel.abkling; }, get rolleBereit() { return spiel.bereit; },
      get inLuft() { return spiel.inLuft; }, get ausdauerStand() { return spiel.ausdauer; }, figurYaw: 0.25,
      moveIntent: { x: -1, z: 0 },
      startRolle: (yaw: number) => spiel.starts.push(yaw), rolleAbbruch: (loeschen?: boolean, sperre?: number) => { spiel.abbrueche++; spiel.loeschen.push(loeschen === true); spiel.sperren.push(sperre); },
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
/** A server `Rolle` packet as the handler reads it: bool false, then (null = absent) the reason byte and the roll number. */
const rolleAus = (grund: number | null, nr: number | null, restMs: number | null = null): { readBool(): boolean; readonly remaining: number; readUInt8(): number; readInt32(): number } => {
  let rest = 1 + (grund === null ? 0 : 1) + (nr === null ? 0 : 4) + (restMs === null ? 0 : 4);
  const zahlen = [nr, restMs];
  return { readBool: () => { rest -= 1; return false; }, get remaining() { return rest; }, readUInt8: () => { rest -= 1; return grund!; }, readInt32: () => { rest -= 4; return zahlen.shift()!; } };
};
const verdrahtet = (v: BlockVerdrahtung): Record<number, (r: { readBool(): boolean }) => void> => {
  const h: Record<number, (r: { readBool(): boolean }) => void> = {};
  v.verdrahte({ on: (typ, f) => { h[typ] = f as never; } });
  return h;
};
const sekunde = (v: BlockVerdrahtung, spiel: Spiel, n = 1): void => { for (let i = 0; i < n; i++) v.frame(); void spiel; };
{
  // Z2: Q hides the block, it does not end it. The server ends it when it ACCEPTS the roll.
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  check('(set-up) blocking: Block(true) sent once, 5 stamina charged once', v.blockt && spiel.gesendet.join() === 'block:true' && spiel.abzuege === 1);
  taste(v, spiel);
  spiel.rollt = true; // the controller began the predicted roll
  check('Q while blocking: only the roll goes out (NO Block(false) from the client), the figure shows no block', spiel.gesendet.join() === `block:true,rolle:${(Math.PI / 2).toFixed(3)}` && !v.blockt && spiel.blockPose.at(-1) === false, spiel.gesendet.join());
  sekunde(v, spiel, 5);
  check('during the predicted roll with the button held: no new block, nothing sent, no stamina', !v.blockt && spiel.gesendet.length === 2 && spiel.abzuege === 1, spiel.gesendet.join());
  h[PacketType.Block]!({ readBool: () => false }); // the server accepted the roll and ended the block
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  check('ACCEPTED: the roll is over, the button is still held: no block back (a fresh press is needed), nothing sent, no stamina', !v.blockt && spiel.gesendet.length === 2 && spiel.abzuege === 1, spiel.gesendet.join());
  check('... and the next release sends the one idempotent Block(false) of the uncertain state (as after any server `Block=false`), no other packet', (() => { spiel.rechts = false; v.frame(); return spiel.gesendet.join() === `block:true,rolle:${(Math.PI / 2).toFixed(3)},block:false`; })(), spiel.gesendet.join());
}
{
  // Z2: an accepted roll of which no Block=false ever arrives (the server held no block): the block must NOT come back after the roll.
  const { v, spiel } = neuesSpiel();
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false; // the roll is over, nothing was refused, nothing was said about the block
  sekunde(v, spiel, 3);
  check('an accepted roll (no Rolle=false): when it is over the hidden block does not come back by itself, nothing sent', !v.blockt && spiel.gesendet.length === 2 && spiel.abzuege === 1, spiel.gesendet.join());
}
{
  // Z2: Block=false in the middle of the predicted roll, then a release: exactly ONE more Block(false) (the uncertain state's), not two.
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Block]!({ readBool: () => false });
  spiel.rechts = false;
  sekunde(v, spiel, 4);
  spiel.rollt = false;
  sekunde(v, spiel, 4);
  check('Block=false during the roll, release during the roll: exactly one Block(false) afterwards (no second one from a forgotten hidden state)', spiel.gesendet.filter((g) => g === 'block:false').length === 1, spiel.gesendet.join());
}
{
  // Z2: a refused roll leaves the block where it was (wall, rock, water edge, jitter: only the server knows).
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 2);
  check('(set-up) the block is hidden during the predicted roll', !v.blockt && spiel.gesendet.join() === `block:true,rolle:${(Math.PI / 2).toFixed(3)}`);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0)); // the server refused the roll
  spiel.rollt = false; // the controller stops the predicted roll (`rolleAbbruch`)
  v.frame();
  check('REFUSED: the block stands again (the button is held), WITHOUT a new Block(true) and WITHOUT 5 more stamina', v.blockt && spiel.gesendet.length === 2 && spiel.abzuege === 1 && spiel.blockPose.at(-1) === true, `${spiel.gesendet.join()} charged ${spiel.abzuege}`);
  spiel.rechts = false;
  sekunde(v, spiel, 4);
  check('... and the release ends it as usual: exactly one Block(false) (no second one from a stale uncertain state, 4 frames later)', !v.blockt && spiel.gesendet.at(-1) === 'block:false' && spiel.gesendet.filter((g) => g === 'block:false').length === 1, spiel.gesendet.join());
}
{
  // Z2: refused, but the button was released while the roll was predicted: the server still holds the block, so it gets Block(false).
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  spiel.rechts = false;
  v.frame();
  check('the button released during the predicted roll: Block(false) goes out (the server may still hold the block)', spiel.gesendet.at(-1) === 'block:false' && !v.blockt, spiel.gesendet.join());
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rollt = false;
  spiel.rechts = true;
  v.frame();
  check('... and a late Rolle=false then brings no block back (the button is up in the game: it is held again here only as a level, no fresh press)', !v.blockt && spiel.abzuege === 1);
}
{
  // Z2: a window or death while the block is hidden ends it for good (the other rows still apply).
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  spiel.fenster = true;
  v.frame();
  check('a window opens while the block is hidden: Block(false) goes out, the block is gone', spiel.gesendet.at(-1) === 'block:false' && !v.blockt);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rollt = false; spiel.fenster = false;
  v.frame();
  check('... and the refusal does not bring it back', !v.blockt && spiel.abzuege === 1);
}
{
  // Z2: a teleport (reset) drops a hidden block, nothing comes back.
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  h[PacketType.Teleport]!({ readBool: () => false });
  spiel.rollt = false;
  v.frame();
  check('Rolle=false followed by a teleport: the reset wins, no block comes back', !v.blockt);
}
{
  const { v, spiel } = neuesSpiel();
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  spiel.online = false;
  taste(v, spiel);
  check('Q while blocking without a line: no roll, the block stays (nothing is hidden)', v.blockt && spiel.starts.length === 0);
}
{
  const { v, spiel } = neuesSpiel();
  spiel.rollt = true;
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  check('a press of the right button during a roll starts no block (the wiring hands `rollt` to the table)', !v.blockt && spiel.gesendet.length === 0, spiel.gesendet.join());
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
  check('stamina 9: nothing sent, the HUD message is the catalogue key `@kampf.zu_erschoepft` (translated by the game)', spiel.gesendet.length === 0 && spiel.meldungen.join() === '@kampf.zu_erschoepft', spiel.meldungen.join());
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

{
  // N1-3: the server refused the roll, but `Rolle=false` arrives only AFTER the predicted roll ended: the server still holds the
  // block, the client shows none: the release must send one Block(false) (harmless if the server has none).
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false; // the predicted roll is over, no answer yet
  sekunde(v, spiel, 3);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0)); // the late refusal
  sekunde(v, spiel, 2);
  check('late `Rolle=false` (N2-2), the button still held: the block is shown again (the server holds it), NO new Block(true), NO new stamina', v.blockt && spiel.gesendet.join() === `block:true,rolle:${(Math.PI / 2).toFixed(3)}` && spiel.abzuege === 1 && spiel.blockPose.at(-1) === true, spiel.gesendet.join());
  spiel.rechts = false;
  sekunde(v, spiel, 4);
  check('... and the RELEASE then ends it with exactly one Block(false)', !v.blockt && spiel.gesendet.at(-1) === 'block:false' && spiel.gesendet.filter((g) => g === 'block:false').length === 1, spiel.gesendet.join());
}
{
  // N2-2: the button was released BEFORE the late refusal: Block(false) went out at the release; the late `Rolle=false` brings nothing back.
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  spiel.rechts = false;
  sekunde(v, spiel, 2);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rechts = true; // held again without a fresh press
  sekunde(v, spiel, 3);
  check('release first, late `Rolle=false` after it: one Block(false) at the release, no block comes back (a held button needs a fresh press)', !v.blockt && spiel.gesendet.filter((g) => g === 'block:false').length === 1 && spiel.abzuege === 1, spiel.gesendet.join());
}
{
  // N2-2: a late `Rolle=false` of a LATER roll must not bring back a block that an earlier accepted roll ended (no stale `spaetOffen`).
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Block]!({ readBool: () => false }); // the first roll was accepted
  sekunde(v, spiel, 3);
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  spiel.rechts = false; sekunde(v, spiel, 2);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false; // a fresh block
  check('(set-up) a new block after the accepted roll', v.blockt);
  spiel.rechts = false; sekunde(v, spiel, 2);
  taste(v, spiel); // a second roll, no block held
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rollt = false;
  spiel.rechts = true;
  sekunde(v, spiel, 3);
  check('a refusal of a roll without any block held brings no block', !v.blockt);
}
/** A hidden block whose roll ended without an answer: the state of N2-2 (the server may still hold the block). */
const stilleRolle = (): { v: BlockVerdrahtung; spiel: Spiel; h: ReturnType<typeof verdrahtet> } => {
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  return { v, spiel, h };
};
{
  // N2-2: the button goes up in the same frame as the late refusal arrives: nothing is shown, the release's Block(false) went out.
  const { v, spiel, h } = stilleRolle();
  const posen = spiel.blockPose.length;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rechts = false;
  sekunde(v, spiel, 3);
  check('late `Rolle=false`, the button released in the same frame: the block is never shown (not even for a frame), one Block(false)', !v.blockt && !spiel.blockPose.slice(posen).includes(true) && spiel.gesendet.filter((g) => g === 'block:false').length === 1, spiel.gesendet.join());
}
{
  // N2-2: a window is open when the late refusal arrives: the block does not come back (the table forbids it), also not after the window closes
  const { v, spiel, h } = stilleRolle();
  spiel.fenster = true;
  const posen = spiel.blockPose.length;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  sekunde(v, spiel, 3);
  spiel.fenster = false;
  sekunde(v, spiel, 3);
  check('late `Rolle=false` while a window is open: the block is never shown (and not after it closes: a fresh press is needed), nothing sent but the first Block(true)', !v.blockt && !spiel.blockPose.slice(posen).includes(true) && spiel.gesendet.filter((g) => g.startsWith('block')).join() === 'block:true', spiel.gesendet.join());
}
{
  // a second roll starts before any answer: a refusal then does not bring the first roll's block back
  const { v, spiel, h } = stilleRolle();
  taste(v, spiel); // roll 2 (no block shown)
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  check('a new roll resets the memory of the old one: its refusal brings no block back', !v.blockt && spiel.abzuege === 1, spiel.gesendet.join());
}
{
  // Block=false arrives late (the server ended the block after all), then a Rolle=false: no block back
  const { v, spiel, h } = stilleRolle();
  h[PacketType.Block]!({ readBool: () => false });
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  sekunde(v, spiel, 3);
  check('Block=false then Rolle=false late: the block is gone and stays gone', !v.blockt && spiel.abzuege === 1);
}
{
  // a teleport (reset) between: a late Rolle=false afterwards brings no block back
  const { v, spiel, h } = stilleRolle();
  h[PacketType.Teleport]!({ readBool: () => false });
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1) ?? 0));
  sekunde(v, spiel, 3);
  check('teleport, then a late Rolle=false: no block back', !v.blockt && spiel.abzuege === 1);
}
{
  // The same with the roll that ended for another reason before the answer (the dungeon wait: the controller aborts it).
  const { v, spiel } = neuesSpiel();
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  spiel.rollt = true;
  sekunde(v, spiel, 2);
  spiel.rollt = false; // aborted by the controller, no `Rolle=false` at all
  sekunde(v, spiel, 2);
  spiel.rechts = false;
  v.frame();
  check('the roll ended without an answer, then the release: one Block(false) (harmless if the server ended the block with an accepted roll)', spiel.gesendet.at(-1) === 'block:false' && spiel.gesendet.filter((g) => g === 'block:false').length === 1, spiel.gesendet.join());
}

// ── [5a] the reason and the number of `Rolle=false` (N4) ───────────────────
console.log('\n[5a] Rolle=false with a reason and a roll number');
{
  // a refusal at a wall: Q works again at once, no pull-back
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, spiel.nrs.at(-1)!));
  check('REFUSED (a wall, the reason byte 1, the number of the roll): the controller is told to end the roll AND to clear the lock', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === true);
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(0);
  lauf(pc, 0.15, 1 / 60);
  pc.rolleAbbruch(true); // what the handler does for a refusal
  const ok2: RolleUmfeld = { ...ok, abklingRest: pc.rolleAbklingRest, rollt: pc.rollt };
  check('... the real controller: no roll, no lock: the table lets Q go at once (no pull-back, no wait of 1.3 s)', !pc.rollt && pc.rolleAbklingRest === 0 && rolleSperre(ok2) === null, `${pc.rolleAbklingRest}`);
}
{
  // ended (teleport, world change, flight): the lock stays
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_BEENDET, spiel.nrs.at(-1)!));
  check('ENDED (reason byte 2): the roll ends, the lock is NOT cleared', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === false);
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(0);
  lauf(pc, 0.15, 1 / 60);
  pc.rolleAbbruch(false);
  check('... the real controller keeps the lock (the rest of the clip + 0.5 s): the table refuses Q', !pc.rollt && pc.rolleAbklingRest > 1.2 && rolleSperre({ ...ok, abklingRest: pc.rolleAbklingRest }) === 'abklingzeit', `${pc.rolleAbklingRest}`);
}
{
  // an older packet without the reason byte (and without a number): ended, applies to the current roll
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(null, null));
  check('a packet WITHOUT a reason byte (an older server) counts as ended: roll ends, lock stays', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === false);
  const { v: v2, spiel: s2 } = neuesSpiel();
  const h2 = verdrahtet(v2);
  taste(v2, s2);
  h2[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, null));
  check('a reason without a number: applies to the current roll', s2.abbrueche === 1 && s2.loeschen.at(-1) === true);
  const { v: v3, spiel: s3 } = neuesSpiel();
  const h3 = verdrahtet(v3);
  taste(v3, s3);
  h3[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, 0));
  check('roll number 0 (an older client): applies to the current roll', s3.abbrueche === 1);
}
{
  // N4-1: the Teleport handler of the wiring ends the roll WITHOUT clearing the lock (not only RolleLauf: the wiring itself)
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Teleport]!({ readBool: () => false });
  check('TELEPORT (the wiring, N4-1): the roll is ended with `rolleAbbruch()` and the lock is NOT cleared, no rest given', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === false && spiel.sperren.at(-1) === undefined, JSON.stringify(spiel.loeschen) + JSON.stringify(spiel.sperren));
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(0);
  lauf(pc, 0.95, 1 / 60);
  const rest0 = pc.rolleAbklingRest;
  pc.rolleAbbruch(); // what the handler calls
  check('... and with the real controller the table refuses Q right after the teleport (the lock stands)', rest0 > 0.3 && pc.rolleAbklingRest === rest0 && rolleSperre({ ...ok, abklingRest: pc.rolleAbklingRest }) === 'abklingzeit');
}
{
  // N4-3: refused because the server still holds the lock: the client's lock becomes the rest (reason 3)
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_GESPERRT, spiel.nrs.at(-1)!, 800));
  check('STILL LOCKED (reason 3, rest 800 ms): the roll ends, the lock is not cleared but set to 0.8 s', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === false && spiel.sperren.at(-1) === 0.8, JSON.stringify(spiel.sperren));
  const { pc } = neu();
  pc.update(1 / 60);
  pc.startRolle(0);
  lauf(pc, 0.1, 1 / 60);
  pc.rolleAbbruch(false, 0.8);
  check('... the real controller: no roll, the lock is 0.8 s, the table refuses Q until then (no early retry), and lets it go after', !pc.rollt && nah(pc.rolleAbklingRest, 0.8, 1e-9) && rolleSperre({ ...ok, abklingRest: pc.rolleAbklingRest }) === 'abklingzeit');
  lauf(pc, 0.81, 1 / 60);
  check('... after 0.81 s the lock is over', pc.rolleAbklingRest === 0 && rolleSperre({ ...ok, abklingRest: pc.rolleAbklingRest }) === null);
  const { v: v2, spiel: s2 } = neuesSpiel();
  const h2 = verdrahtet(v2);
  taste(v2, s2);
  h2[PacketType.Rolle]!(rolleAus(ROLLE_AUS_GESPERRT, s2.nrs.at(-1)!, null));
  check('reason 3 without the rest bytes: the rest is 0 (the lock is cleared by the value 0, no crash)', s2.abbrueche === 1 && s2.sperren.at(-1) === 0);
  const { v: v3, spiel: s3 } = neuesSpiel();
  const h3 = verdrahtet(v3);
  taste(v3, s3);
  h3[PacketType.Rolle]!(rolleAus(ROLLE_AUS_GESPERRT, s3.nrs.at(-1)! + 1, 500));
  check('an answer "still locked" with another number is ignored like every other', s3.abbrueche === 0);
  const { v: v4, spiel: s4 } = neuesSpiel();
  const h4 = verdrahtet(v4);
  s4.rechts = true; s4.flanke = true; v4.frame(); s4.flanke = false;
  taste(v4, s4);
  s4.rollt = true;
  h4[PacketType.Rolle]!(rolleAus(ROLLE_AUS_GESPERRT, s4.nrs.at(-1)!, 300));
  s4.rollt = false;
  v4.frame();
  check('"still locked" brings the hidden block back like a refusal (the server kept it), no Block(true), no stamina', v4.blockt && s4.abzuege === 1 && s4.gesendet.filter((g) => g === 'block:true').length === 1);
}
{
  // Q, Q (after the lock), then a LATE answer to the first: it must not stop or mix up the second
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  const nr1 = spiel.nrs.at(-1)!;
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false; // the first predicted roll is over
  sekunde(v, spiel, 3);
  taste(v, spiel); // the second roll (the lock is not part of this fake)
  const nr2 = spiel.nrs.at(-1)!;
  spiel.rollt = true;
  check('(set-up) two rolls with different numbers', spiel.starts.length === 2 && nr2 === nr1 + 1, `${nr1} ${nr2}`);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, nr1)); // the late refusal of the FIRST roll
  check('a late answer to the first roll does not stop the second (no abort, the lock untouched)', spiel.abbrueche === 0 && spiel.loeschen.length === 0);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_BEENDET, nr1));
  check('... neither an "ended" for the first roll', spiel.abbrueche === 0);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, nr2));
  check('the answer to the second roll does apply', spiel.abbrueche === 1 && spiel.loeschen.at(-1) === true);
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, nr2 + 5));
  check('an answer with a number of the future is ignored as well', spiel.abbrueche === 1);
}
{
  // a Q that is not sent (no line) takes no number: the answer to the last roll that WAS sent still applies
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  taste(v, spiel);
  const nr1 = spiel.nrs.at(-1)!;
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false;
  spiel.online = false;
  taste(v, spiel); // not sent
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, nr1));
  check('an unsent Q takes no roll number: the late answer to the last sent roll still applies', spiel.starts.length === 1 && spiel.abbrueche === 1 && spiel.loeschen.at(-1) === true);
}
{
  // the late answer to an old roll also leaves the BLOCK memory of the new roll alone
  const { v, spiel } = neuesSpiel();
  const h = verdrahtet(v);
  spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false;
  taste(v, spiel);
  const nr1 = spiel.nrs.at(-1)!;
  spiel.rollt = true;
  sekunde(v, spiel, 3);
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  taste(v, spiel);
  spiel.rollt = true;
  h[PacketType.Rolle]!(rolleAus(ROLLE_AUS_ABGELEHNT, nr1));
  spiel.rollt = false;
  sekunde(v, spiel, 3);
  check('a late refusal of the first roll brings no block back while the second runs or after it', !v.blockt && spiel.abzuege === 1);
}

// ── [5b] the reconciliation during a roll (N1-1) ──────────────────────────
console.log('\n[5b] Position reconciliation during a roll: the model of the attack on N1 (real Abgleicher, real curve)');
{
  let seed = 99;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const teil = ROLLE_WEG_M / Math.ceil(ROLLE_BEWEGUNG_S / (1 / 60) - 1e-9);
  /** One roll: the client sends an input every 50 ms, the server's path is the curve at the ARRIVAL time of the packet on its own step grid. */
  const lauf = (J: number, inRolle: boolean): { max: number; eingriffe: number } => {
    const L = 40;
    const tQ = rnd() * 50;
    const phase = rnd() * 50;
    const ankunft = (t: number, vor: number): number => Math.max(vor, t + L + rnd() * J);
    let vor = 0;
    const aR = (vor = ankunft(tQ, vor));
    const ab = new Abgleicher();
    let max = 0;
    let seq = 0;
    for (let t = phase; t < tQ + ROLLE_DAUER_MS + 400; t += 50) {
      if (t < tQ) continue;
      seq++;
      const clientPos = rolleWegAnteil((t - tQ) / 1000) * ROLLE_WEG_M;
      ab.merkeEingabe(seq, { x: clientPos, y: 0, z: 0 });
      const a = (vor = ankunft(t, vor));
      const tt = Math.max(0, a - aR) / 1000;
      const serverWeg = Math.floor((rolleWegAnteil(Math.min(tt, ROLLE_DAUER_MS / 1000)) * ROLLE_WEG_M) / teil + 1e-9) * teil;
      max = Math.max(max, Math.abs(serverWeg - clientPos));
      ab.serverMeldung({ x: serverWeg, y: 0, z: 0 }, seq, { x: clientPos, y: 0, z: 0 }, false, inRolle);
    }
    return { max, eingriffe: ab.diagnose.ereignisse };
  };
  for (const J of [0, 50, 80, 120, 200]) {
    seed = 99 + J;
    let ohneFlag = 0, mitFlag = 0, maxDrift = 0;
    const N = 2000;
    const folge: number[] = [];
    for (let i = 0; i < N; i++) folge.push(seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let i = 0; i < N; i++) { seed = folge[i]!; const r = lauf(J, false); if (r.eingriffe > 0) ohneFlag++; maxDrift = Math.max(maxDrift, r.max); }
    for (let i = 0; i < N; i++) { seed = folge[i]!; const r = lauf(J, true); if (r.eingriffe > 0) mitFlag++; }
    console.log(`      jitter ${J} ms: runs with a correction without the flag ${ohneFlag}/${N} (max drift ${maxDrift.toFixed(2)} m), with the flag ${mitFlag}/${N}`);
    check(`jitter ${J} ms, 2000 rolls: with the roll threshold the rate of corrections is 0 (max drift ${maxDrift.toFixed(2)} m < 2.5)`, mitFlag === 0 && maxDrift < 2.5);
    if (J >= 80) check(`jitter ${J} ms: (control) without the flag the model finds corrections (${ohneFlag}), so the zero above is not blindness`, ohneFlag > 100);
  }
  // outside a roll nothing changed: the flag false is the default and gives bit-identical results; the normal threshold is still 1.0 m
  const a1 = new Abgleicher(); const a2 = new Abgleicher();
  let gleich = true;
  seed = 7;
  for (let i = 1; i <= 400; i++) {
    const p = { x: rnd() * 3, y: 0, z: rnd() * 3 };
    a1.merkeEingabe(i, { x: 0, y: 0, z: 0 }); a2.merkeEingabe(i, { x: 0, y: 0, z: 0 });
    a1.serverMeldung(p, i, { x: 0, y: 0, z: 0 }, false);
    a2.serverMeldung(p, i, { x: 0, y: 0, z: 0 }, false, false);
    const b1 = a1.schritt(0.016); const b2 = a2.schritt(0.016);
    if (JSON.stringify(b1) !== JSON.stringify(b2) || JSON.stringify(a1.diagnose) !== JSON.stringify(a2.diagnose)) gleich = false;
  }
  check('outside a roll (flag false or absent): 400 random reports give bit-identical commands and diagnostics', gleich);
  const aus = new Abgleicher();
  aus.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  aus.serverMeldung({ x: 1.2, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false);
  check('outside a roll 1.2 m of drift still corrects (threshold 1.0 m unchanged)', aus.diagnose.ereignisse === 1);
  const ein = new Abgleicher();
  ein.merkeEingabe(1, { x: 0, y: 0, z: 0 });
  ein.serverMeldung({ x: 2.4, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false, true);
  check('during a roll 2.4 m of drift does not correct, ...', ein.diagnose.ereignisse === 0);
  for (const [drift, soll] of [[2.45, 0], [2.49, 0], [2.51, 1]] as const) {
    const g = new Abgleicher();
    g.merkeEingabe(1, { x: 0, y: 0, z: 0 });
    g.serverMeldung({ x: drift, y: 0, z: 0 }, 1, { x: 0, y: 0, z: 0 }, false, true);
    check(`the threshold of a roll is exactly 2.5 m (N2-3): drift ${drift} m ${soll ? 'corrects' : 'does not correct'}`, g.diagnose.ereignisse === soll, String(g.diagnose.ereignisse));
  }
  ein.merkeEingabe(2, { x: 0, y: 0, z: 0 });
  ein.serverMeldung({ x: 2.6, y: 0, z: 0 }, 2, { x: 0, y: 0, z: 0 }, false, true);
  check('... 2.6 m does (a real divergence is still found), and 8 m+ is hard as always', ein.diagnose.ereignisse === 1 && (() => { ein.merkeEingabe(3, { x: 0, y: 0, z: 0 }); ein.serverMeldung({ x: 9, y: 0, z: 0 }, 3, { x: 0, y: 0, z: 0 }, false, true); return ein.diagnose.hart === 1; })());
}

// ── [5c] Block x roll fuzz (the attack's probe E): the real BlockSteuerung against a server model with latency ──
console.log('\n[5c] Block and roll fuzz: 160 runs of 120 s, the display equals the server block at every rest point');
{
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  interface Paket { an: number; was: string; wert?: boolean }
  const fuzz = (o: { latMin: number; latMax: number; verweigern: number; extra?: 'fenster' }): { abw: string[]; ruhe: number } => {
    const abw: string[] = [];
    let ruhe = 0;
    let jetzt = 0;
    let aufC: Paket[] = [];
    let aufS: Paket[] = [];
    let serverBlock = false, serverRolltBis = -1;
    let rollt = false, rolltBis = 0, clientSperreBis = 0;
    const lat = (): number => o.latMin + rnd() * (o.latMax - o.latMin);
    let letzterAnC = 0, letzterAnS = 0;
    const anServer = (was: string, wert?: boolean): void => { letzterAnC = Math.max(letzterAnC, jetzt + lat()); aufC.push({ an: letzterAnC, was, wert }); };
    const anClient = (was: string, wert?: boolean): void => { letzterAnS = Math.max(letzterAnS, jetzt + lat()); aufS.push({ an: letzterAnS, was, wert }); };
    const b = new BlockSteuerung((an) => { anServer('block', an); return true; });
    let rechts = false, flanke = false, qBild = false;
    let letzteAenderung = 0, letztePaket = 0, letzteRolleEnde = 0;
    let extraAn = false;
    for (; jetzt < 120000; jetzt += 1000 / 60) {
      for (const p of aufC.filter((x) => x.an <= jetzt)) {
        letztePaket = jetzt;
        if (p.was === 'block') {
          if (!p.wert) serverBlock = false;
          else if (!serverBlock) { if (jetzt < serverRolltBis || extraAn) anClient('block', false); else serverBlock = true; }
        } else if (p.was === 'rolle') {
          if (jetzt < serverRolltBis || rnd() < o.verweigern) anClient('rolle', false);
          else { if (serverBlock) { serverBlock = false; anClient('block', false); } serverRolltBis = jetzt + 875; }
        }
      }
      aufC = aufC.filter((x) => x.an > jetzt);
      for (const p of aufS.filter((x) => x.an <= jetzt)) {
        letztePaket = jetzt;
        if (p.was === 'block') b.serverBeendet();
        else { b.rolleAbgelehnt(); rollt = false; }
      }
      aufS = aufS.filter((x) => x.an > jetzt);
      if (rnd() < 0.02) { rechts = !rechts; if (rechts) flanke = true; letzteAenderung = jetzt; }
      if (rnd() < 0.01) { qBild = true; letzteAenderung = jetzt; }
      if (o.extra === 'fenster' && rnd() < 0.003) { extraAn = !extraAn; letzteAenderung = jetzt; }
      if (rollt && jetzt >= rolltBis) { rollt = false; letzteRolleEnde = jetzt; clientSperreBis = jetzt + 500; }
      const u: BlockUmfeld = { rechtsGedrueckt: rechts, rechtsFlanke: flanke, zeigerGefangen: true, fensterOffen: o.extra === 'fenster' && extraAn, dekorPlatzieren: false, baumodus: false, bauteilGewaehlt: false, bauwerkzeug: false, gegenstandInHand: true, tot: false, imWasser: false, ausdauer: 100, rollt };
      b.aktualisiere(u);
      flanke = false;
      if (qBild) {
        qBild = false;
        if (!rollt && jetzt >= clientSperreBis && !u.fensterOffen) { anServer('rolle'); b.rolleBeginnt(); rollt = true; rolltBis = jetzt + 875; letzteAenderung = jetzt; }
      }
      if (jetzt - letzteAenderung > 2500 && jetzt - letztePaket > 1500 && aufC.length === 0 && aufS.length === 0 && !rollt && jetzt > serverRolltBis + 100 && jetzt - letzteRolleEnde > 1500 && !(o.extra === 'fenster' && extraAn)) {
        ruhe++;
        if (b.blockt !== serverBlock) abw.push(`t=${jetzt.toFixed(0)}: client shows ${b.blockt}, server holds ${serverBlock}, button ${rechts}`);
        if (!rechts && serverBlock) abw.push(`t=${jetzt.toFixed(0)}: button up, the server holds the block`);
        letzteAenderung = jetzt - 1000;
      }
    }
    return { abw, ruhe };
  };
  let laeufe = 0, schlecht = 0, ruhepunkte = 0;
  const beispiele: string[] = [];
  for (const [name, o] of [
    ['latency 20-60, refused 30 %', { latMin: 20, latMax: 60, verweigern: 0.3 }],
    ['latency 100-400, refused 50 %', { latMin: 100, latMax: 400, verweigern: 0.5 }],
    ['latency 10-900 (beyond the roll), refused 50 %', { latMin: 10, latMax: 900, verweigern: 0.5 }],
    ['window / server-side block lock, latency 30-120', { latMin: 30, latMax: 120, verweigern: 0.4, extra: 'fenster' as const }],
  ] as const) {
    let sl = 0, r = 0;
    for (let i = 0; i < 40; i++) { seed = 1000 + i * 7919; const res = fuzz(o); laeufe++; r += res.ruhe; if (res.abw.length) { sl++; if (beispiele.length < 6) beispiele.push(`${name} run ${i}: ${res.abw[0]}`); } }
    console.log(`      ${name}: 40 runs, ${r} rest points, ${sl} runs with a deviation`);
    schlecht += sl; ruhepunkte += r;
  }
  for (const bsp of beispiele) console.log('      ' + bsp);
  check(`fuzz: ${laeufe} runs of 120 s, ${ruhepunkte} rest points, 0 deviations between the client display and the server block (also beyond a latency of 875 ms)`, laeufe === 160 && schlecht === 0 && ruhepunkte > 250, `${schlecht} bad, ${ruhepunkte} rest points`);
}

// ── [6] the wire ──────────────────────────────────────────────────────────
console.log('\n[6] sendRolle');
{
  const gesendet: number[][] = [];
  const socket = new GameSocket('ws://test.invalid', 'Test');
  (socket as unknown as { ws: unknown }).ws = { readyState: WebSocket.OPEN, send: (b: ArrayBuffer) => gesendet.push([...new Uint8Array(b)]) };
  check('the packet type is 90', PacketType.Rolle === 90);
  check('sendRolle returns true and sends [90, 4 bytes yaw, 4 bytes roll number]', socket.sendRolle(1.5, 7) === true && gesendet.length === 1 && gesendet[0]![0] === 90 && gesendet[0]!.length === 9);
  check('the roll number is the Int32 after the yaw (little endian)', new DataView(new Uint8Array(gesendet[0]!.slice(5)).buffer).getInt32(0, true) === 7);
  const f = new DataView(new Uint8Array(gesendet[0]!.slice(1)).buffer).getFloat32(0, true);
  check('the 4 bytes are the Float32 yaw (little endian)', nah(f, 1.5, 1e-6), `${f}`);
  const zu = new GameSocket('ws://test.invalid', 'Test');
  check('no line: false, nothing sent', zu.sendRolle(1) === false);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
