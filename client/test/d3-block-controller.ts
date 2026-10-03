/**
 * D3-K3: the REAL PlayerController while blocking (NullEngine, no Havok: the "before Havok is up" path of
 * `update()` moves the figure straight by `speed * dt`, which is the same speed the physics path uses).
 *
 *  [1] The turn: blocking, the figure turns to the camera, also standing still, at 540 deg/s: after 0.33 s at most
 *      1 deg off at 180 deg. Not blocking: a standing figure does not turn, a walking one follows the walking
 *      direction at 300 deg/s as before.
 *  [2] The speed: sideways for 5 s at block speed against the SERVER step (shared `bewegungsSchritt`, the same
 *      function `Spielerbewegung.schritt` runs): the difference is under 0.1 m. The figure never faces its walking
 *      direction while blocking. Shift neither speeds up nor costs stamina.
 *  [3] The intent that goes to the server keeps the walking direction relative to the camera.
 *
 * Run: npx tsx client/test/d3-block-controller.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { PlayerController } from '../src/player/PlayerController.js';
import { BLOCK_TURN_SPEED } from '../src/player/BlockSteuerung.js';
import { bewegungsSchritt } from '@wov/shared/src/bewegung/schritt.js';
import { ebenerBoden, OHNE_HINDERNISSE } from '@wov/shared/src/bewegung/abfragen.js';
import { SCHRITT_LAENGE } from '@wov/shared/src/bewegung/masse.js';
import { AUSDAUER_REGEL } from '@wov/shared/src/bewegung/ausdauer.js';
import type { InputManager } from '../src/engine/InputManager.js';
import type { ClientWorld } from '../src/world/World.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const grad = (r: number): number => (r * 180) / Math.PI;
const abweichung = (a: number, b: number): number => Math.abs(grad(Math.atan2(Math.sin(a - b), Math.cos(a - b))));

// The rig would load its body over HTTP; there is no server here, so the load fails and the rig stays procedural
// (the controller does not care which body it has).
(SceneLoader as unknown as { ImportMeshAsync: unknown }).ImportMeshAsync = () => Promise.reject(new Error('kein Modell in diesem Test'));
const log = console.log;
const warn = console.warn;
const error = console.error;

/** A keyboard and a mouse the test drives by hand. */
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
  const pc = new PlayerController(scene, ein as unknown as InputManager, welt);
  return { pc, ein };
}

/** Runs `n` frames of `dt`. */
function lauf(pc: PlayerController, n: number, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) pc.update(dt);
}

/** One mouse delta in pixels -> the yaw it makes (the sensitivity is not exported, so it is measured). */
function empfindlichkeit(): number {
  const { pc, ein } = neu();
  ein.dx = 1000;
  pc.update(1 / 60);
  return pc.yaw / 1000;
}
const EMPF = empfindlichkeit();

console.log('\n[1] The turn to the camera');
{
  const { pc, ein } = neu();
  ein.dx = Math.PI / EMPF; // the camera looks 180 deg round
  pc.update(1 / 60);
  check('set-up: the camera is 180 deg away from the figure', abweichung(pc.yaw, pc.figurYaw) > 179.9, `${abweichung(pc.yaw, pc.figurYaw).toFixed(2)} deg`);
  lauf(pc, 30);
  check('not blocking and standing: the figure does not turn (the camera orbits it)', abweichung(pc.yaw, pc.figurYaw) > 179.9);
  pc.setzeBlock(true);
  lauf(pc, 20); // 20 frames of 1/60 = 0.333 s
  check('blocking, standing still: after 0.33 s at most 1 deg off the camera (from 180 deg away)', abweichung(pc.yaw, pc.figurYaw) <= 1, `${abweichung(pc.yaw, pc.figurYaw).toFixed(3)} deg`);
  lauf(pc, 60);
  check('and it stays aligned while the block is held', abweichung(pc.yaw, pc.figurYaw) <= 1e-9, `${abweichung(pc.yaw, pc.figurYaw).toExponential(2)} deg`);
  ein.dx = 0.5 / EMPF; // the camera swings on by 0.5 rad
  pc.update(1 / 60);
  lauf(pc, 6);
  check('the camera turns on, the figure follows at once (0.1 s later: aligned again)', abweichung(pc.yaw, pc.figurYaw) <= 1e-6, `${abweichung(pc.yaw, pc.figurYaw).toFixed(4)} deg`);
}
{
  const { pc, ein } = neu();
  ein.dx = Math.PI / EMPF;
  pc.update(1 / 60);
  pc.setzeBlock(true);
  lauf(pc, 5);
  const nach5 = abweichung(pc.yaw, pc.figurYaw);
  check('half-way in 5 frames: it turned 45 deg at 540 deg/s (135 deg left), no jump', Math.abs(nach5 - 135) < 0.01, `${nach5.toFixed(3)} deg`);
  check('the turn rate is the constant: 540 deg/s', Math.abs(grad(BLOCK_TURN_SPEED) - 540) < 1e-9);
}
{
  // Not blocking: the walking direction turns the figure at 300 deg/s, as before D3.
  const { pc, ein } = neu();
  ein.tasten.add('KeyA'); // walking left of the camera: the figure turns 90 deg to the left
  lauf(pc, 6);
  const grad6 = Math.abs(grad(pc.figurYaw));
  check('walking without block: the figure turns towards the walking direction at 300 deg/s (6 frames = 30 deg)', Math.abs(grad6 - 30) < 0.01, `${grad6.toFixed(3)} deg`);
  pc.setzeBlock(true);
  lauf(pc, 30);
  check('the same walk with the block: the figure faces the CAMERA, not the walking direction', abweichung(pc.yaw, pc.figurYaw) <= 1e-9, `${abweichung(pc.yaw, pc.figurYaw).toFixed(3)} deg`);
  pc.setzeBlock(false);
  lauf(pc, 6);
  check('release while walking: the figure follows the walking direction again (turns away from the camera)', abweichung(pc.yaw, pc.figurYaw) > 20, `${abweichung(pc.yaw, pc.figurYaw).toFixed(2)} deg`);
  lauf(pc, 60);
  check('… and has reached it after a second (90 deg to the left)', Math.abs(abweichung(pc.yaw, pc.figurYaw) - 90) < 1e-6, `${abweichung(pc.yaw, pc.figurYaw).toFixed(3)} deg`);
}

console.log('\n[2] The speed: client and server agree');
{
  // The server side of 5 s: 20 Hz packets with the same intent, each run as fixed 1/60 steps of the shared step.
  const server = (mx: number, mz: number, rennt: boolean, blockt: boolean): { x: number; z: number } => {
    let z = { x: 0, y: 0, z: 0 };
    const boden = ebenerBoden(0);
    for (let i = 0; i < 300; i++) z = bewegungsSchritt(z, { x: mx, z: mz, rennt, blockt }, SCHRITT_LAENGE, boden, OHNE_HINDERNISSE);
    return { x: z.x, z: z.z };
  };
  for (const [name, tasten] of [['sideways (A)', ['KeyA']], ['sideways (D)', ['KeyD']], ['backwards (S)', ['KeyS']], ['forwards (W)', ['KeyW']], ['diagonal (W+A)', ['KeyW', 'KeyA']]] as const) {
    const { pc, ein } = neu();
    for (const t of tasten) ein.tasten.add(t);
    pc.setzeBlock(true);
    const absicht = { x: 0, z: 0 };
    for (let i = 0; i < 300; i++) {
      pc.update(1 / 60);
      absicht.x = pc.moveIntent.x;
      absicht.z = pc.moveIntent.z;
    }
    const s = server(absicht.x, absicht.z, false, true);
    const abstand = Math.hypot(pc.position.x - s.x, pc.position.z - s.z);
    const weg = Math.hypot(pc.position.x, pc.position.z);
    check(`${name}, 5 s: client and server step end less than 0.1 m apart`, abstand < 0.1, `${abstand.toFixed(5)} m; client ${weg.toFixed(3)} m = ${(weg / 5).toFixed(3)} m/s`);
    check(`${name}, 5 s: the way is 11.25 m (2.25 m/s)`, Math.abs(weg - 11.25) < 0.05, `${weg.toFixed(3)} m`);
    const ohne = server(absicht.x, absicht.z, false, false);
    check(`${name}: without the block factor the server would have gone twice as far (the test sees the factor)`, Math.hypot(ohne.x, ohne.z) > 1.9 * weg, `${Math.hypot(ohne.x, ohne.z).toFixed(2)} m`);
  }
  // Shift: no running while blocking, no stamina cost.
  const { pc, ein } = neu();
  ein.tasten.add('KeyA');
  ein.tasten.add('ShiftLeft');
  pc.setzeBlock(true);
  lauf(pc, 300);
  const weg = Math.hypot(pc.position.x, pc.position.z);
  check('Shift while blocking: still 2.25 m/s (no running)', Math.abs(weg - 11.25) < 0.05, `${weg.toFixed(3)} m`);
  check('Shift while blocking: no stamina spent', pc.ausdauerStand === AUSDAUER_REGEL.max, `${pc.ausdauerStand}`);
  const { pc: lauf2, ein: ein2 } = neu();
  ein2.tasten.add('KeyA');
  ein2.tasten.add('ShiftLeft');
  lauf(lauf2, 60);
  check('control: the same keys without the block run at 7.5 m/s and cost stamina', Math.abs(Math.hypot(lauf2.position.x, lauf2.position.z) - 7.5) < 0.05 && lauf2.ausdauerStand < AUSDAUER_REGEL.max, `${Math.hypot(lauf2.position.x, lauf2.position.z).toFixed(3)} m, stamina ${lauf2.ausdauerStand.toFixed(1)}`);
  const { pc: geh, ein: ein3 } = neu();
  ein3.tasten.add('KeyA');
  lauf(geh, 60);
  check('control: without the block, walking is 4.5 m/s', Math.abs(Math.hypot(geh.position.x, geh.position.z) - 4.5) < 0.05, `${Math.hypot(geh.position.x, geh.position.z).toFixed(3)} m`);
  // The speed follows what really happens (`running`), not what the key asks: with no stamina left Shift does not run.
  const { pc: leer, ein: ein4 } = neu();
  ein4.tasten.add('KeyA');
  ein4.tasten.add('ShiftLeft');
  for (let i = 0; i < 60; i++) {
    leer.setzeServerAusdauer(0); // the server's value keeps it empty
    leer.update(1 / 60);
  }
  check('control: Shift with no stamina left walks at 4.5 m/s (the speed follows `running`, not the key)', Math.abs(Math.hypot(leer.position.x, leer.position.z) - 4.5) < 0.05, `${Math.hypot(leer.position.x, leer.position.z).toFixed(3)} m`);
}

console.log('\n[2a] The predicted stamina: a one-off charge');
{
  // The stamina rule reads the wall clock (`Date.now()`), so the test drives a fake one.
  const echt = Date.now;
  let uhr = 1_000_000;
  Date.now = () => uhr;
  const takt = (pc: PlayerController, sekunden: number): void => { for (let i = 0; i < Math.round(sekunden * 60); i++) { uhr += 1000 / 60; pc.update(1 / 60); } };
  try {
    const { pc } = neu();
    pc.zieheAusdauerAb(5);
    check('charge 5: 100 -> 95', pc.ausdauerStand === 95, `${pc.ausdauerStand}`);
    takt(pc, 1.0);
    check('no regeneration in the first second (the server stamps the last use too, regeneration starts after 1.5 s)', pc.ausdauerStand === 95, `${pc.ausdauerStand}`);
    takt(pc, 3.0);
    check('regenerates afterwards', pc.ausdauerStand > 95, `${pc.ausdauerStand.toFixed(2)}`);
    pc.setzeServerAusdauer(3);
    pc.zieheAusdauerAb(5);
    check('never below 0', pc.ausdauerStand === 0, `${pc.ausdauerStand}`);
  } finally {
    Date.now = echt;
  }
}

console.log('\n[2b] Build mode and the air');
{
  // N4: build mode (editor test flight) is no block, even if the flag is set: the figure does not turn to the camera.
  const { pc, ein } = neu();
  ein.dx = Math.PI / EMPF;
  pc.update(1 / 60);
  pc.setBauModus(true);
  pc.setzeBlock(true);
  lauf(pc, 30);
  const rig = pc.avatar as unknown as { blockAn: boolean };
  check('build mode: the figure does not turn to the camera although the block flag is set', abweichung(pc.yaw, pc.figurYaw) > 179, `${abweichung(pc.yaw, pc.figurYaw).toFixed(1)} deg`);
  check('build mode: the rig is told "no block"', rig.blockAn === false);
  pc.setBauModus(false);
  lauf(pc, 21);
  check('back out of build mode the same flag blocks again (turns to the camera)', abweichung(pc.yaw, pc.figurYaw) <= 1, `${abweichung(pc.yaw, pc.figurYaw).toFixed(2)} deg`);
}
{
  // N18: the block speed holds in the air too. The server has no jump physics (it walks along the ground at the packet's
  // speed), so a different speed in the air would pull the client away from the server at every jump.
  const { pc, ein } = neu();
  ein.tasten.add('KeyA');
  pc.setzeBlock(true);
  (pc as unknown as { inDerLuft: boolean }).inDerLuft = true;
  lauf(pc, 60);
  check('blocking while in the air: still 2.25 m/s horizontally', Math.abs(Math.hypot(pc.position.x, pc.position.z) - 2.25) < 0.05, `${Math.hypot(pc.position.x, pc.position.z).toFixed(3)} m in 1 s`);
  const { pc: frei, ein: ein2 } = neu();
  ein2.tasten.add('KeyA');
  (frei as unknown as { inDerLuft: boolean }).inDerLuft = true;
  lauf(frei, 60);
  check('(control) walking in the air without the block: 4.5 m/s', Math.abs(Math.hypot(frei.position.x, frei.position.z) - 4.5) < 0.05, `${Math.hypot(frei.position.x, frei.position.z).toFixed(3)} m`);
}

console.log('\n[3] What goes to the rig and to the server');
{
  // The rig is told the block and the direction relative to the view (it picks the clip from it).
  const richtung = (tasten: string[], blockt: boolean): { blockt: boolean; richtung: string } => {
    const { pc, ein } = neu();
    for (const t of tasten) ein.tasten.add(t);
    pc.setzeBlock(blockt);
    lauf(pc, 3);
    const rig = pc.avatar as unknown as { blockAn: boolean; blockRichtung: string };
    return { blockt: rig.blockAn, richtung: rig.blockRichtung };
  };
  const faelle: Array<[string[], string]> = [[[], 'steht'], [['KeyW'], 'vor'], [['KeyW', 'KeyA'], 'vor'], [['KeyS'], 'rueck'], [['KeyS', 'KeyD'], 'rueck'], [['KeyA'], 'seit'], [['KeyD'], 'seit']];
  for (const [tasten, soll] of faelle) {
    const r = richtung(tasten, true);
    check(`blocking with ${tasten.join('+') || 'no key'}: the rig is told block on, direction "${soll}"`, r.blockt && r.richtung === soll, `${r.blockt} ${r.richtung}`);
  }
  check('not blocking: the rig is told block off', richtung(['KeyW'], false).blockt === false);
}
{
  const { pc, ein } = neu();
  ein.tasten.add('KeyA');
  pc.setzeBlock(true);
  lauf(pc, 30);
  const i = pc.moveIntent;
  // yaw = 0: A is "left of the camera" = world +x (forward = -z, right = -x)
  check('sideways with the block: the intent is the walking direction relative to the camera (unit vector, left)', Math.abs(Math.hypot(i.x, i.z) - 1) < 1e-9 && i.x > 0.99 && Math.abs(i.z) < 1e-9, `${i.x.toFixed(3)}, ${i.z.toFixed(3)}`);
  check('the yaw that goes with it is the camera yaw, which the figure follows', abweichung(pc.yaw, pc.figurYaw) <= 1e-9);
}

console.log = log;
console.warn = warn;
console.error = error;
if (failures) {
  console.error(`\n${failures} FAIL`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
process.exit(0);
