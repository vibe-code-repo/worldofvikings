/**
 * D3-K4 N1 (T1): the client path of the dodge roll through the REAL physics branch (`stepPhysics`: Havok character
 * controller, `integrate`, slope brake, ground follow, the scaled speed of the last frame), not through the plain path
 * the other client tests use. Real Havok runs under Node when handed the WASM as a buffer.
 *
 *  [1] Free ground: at every frame the figure stands on the curve of the clip (`rolleWegAnteil`) within 0.1 m, at
 *      144, 60, 20, 5 and 3 frames per second (the frame time clamped to 0.1 s like main.ts, the real one for the roll),
 *      and covers 4.853 m (+- 0.05) in total.
 *  [2] The roll ends after 875 ms of REAL time at every frame rate (within one frame), also at 3 and 5 frames per second.
 *  [3] A wall 2.5 m in front: the capsule stops in front of it (no tunnelling at any frame rate), the distance covered is
 *      between 1.5 and 2.5 m.
 *
 * Run: npx tsx client/test/d3-rolle-havok.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import '@babylonjs/core/Physics/physicsEngineComponent';
import HavokPhysics from '@babylonjs/havok';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { ROLLE_DAUER_MS, ROLLE_WEG_M, rolleWegAnteil } from '@wov/shared/src/kampf/rolle.js';
import { PlayerController } from '../src/player/PlayerController.js';
import type { InputManager } from '../src/engine/InputManager.js';
import type { ClientWorld } from '../src/world/World.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
(SceneLoader as unknown as { ImportMeshAsync: unknown }).ImportMeshAsync = () => Promise.reject(new Error('kein Modell in diesem Test'));

const wasm = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))).buffer;
const havok = await HavokPhysics({ wasmBinary: wasm });

class Eingabe {
  isDown(): boolean { return false; }
  wasPressed(): boolean { return false; }
  consumeMouseDelta(): [number, number] { return [0, 0]; }
  consumeWheel(): number { return 0; }
}

/** A controller on a Havok ground (and a wall `wandAbstand` m in front, towards -z), settled for 30 frames. */
function aufbau(wandAbstand: number | null): { pc: PlayerController; scene: Scene } {
  const scene = new Scene(new NullEngine());
  scene.enablePhysics(new Vector3(0, -20, 0), new HavokPlugin(true, havok));
  const boden = MeshBuilder.CreateBox('boden', { width: 400, height: 2, depth: 400 }, scene);
  boden.position.y = -1;
  new PhysicsAggregate(boden, PhysicsShapeType.BOX, { mass: 0 }, scene);
  if (wandAbstand !== null) {
    const wand = MeshBuilder.CreateBox('wand', { width: 40, height: 6, depth: 1 }, scene);
    wand.position.set(0, 3, -(wandAbstand + 0.5));
    new PhysicsAggregate(wand, PhysicsShapeType.BOX, { mass: 0 }, scene);
  }
  const pc = new PlayerController(scene, new Eingabe() as unknown as InputManager, { getGroundHeight: () => 0 } as unknown as ClientWorld);
  pc.update(1 / 60);
  pc.enablePhysics(scene);
  for (let i = 0; i < 30; i++) { pc.update(1 / 60); scene.render(); }
  return { pc, scene };
}

console.log('\n[1] [2] Free ground: the path follows the curve, the roll lasts 875 ms of real time');
for (const fps of [144, 60, 20, 5, 3]) {
  const { pc, scene } = aufbau(null);
  const z0 = pc.position.z;
  const x0 = pc.position.x;
  pc.startRolle(0);
  let t = 0;
  let maxAbw = 0;
  let endeBei = -1;
  const echt = 1 / fps;
  for (let i = 0; i < Math.ceil(2.5 * fps); i++) {
    pc.update(Math.min(echt, 0.1), echt);
    scene.render();
    t += echt;
    maxAbw = Math.max(maxAbw, Math.abs(z0 - pc.position.z - rolleWegAnteil(t) * ROLLE_WEG_M));
    if (!pc.rollt && endeBei < 0) endeBei = t;
  }
  const weg = z0 - pc.position.z;
  check(`${fps} fps: every frame stands on the curve within 0.1 m (max ${maxAbw.toFixed(3)} m)`, maxAbw < 0.1);
  check(`${fps} fps: the roll covers 4.853 m (+- 0.05) along -z, no sideways drift`, Math.abs(weg - ROLLE_WEG_M) < 0.05 && Math.abs(pc.position.x - x0) < 0.02, `${weg.toFixed(3)} m, x ${(pc.position.x - x0).toFixed(3)}`);
  check(`${fps} fps: the roll ends at 875 ms of real time (within one frame), at ${endeBei.toFixed(3)} s`, endeBei >= ROLLE_DAUER_MS / 1000 - 1e-9 && endeBei <= ROLLE_DAUER_MS / 1000 + echt + 1e-9);
}

console.log('\n[3] A wall 2.5 m in front');
for (const fps of [60, 20, 5]) {
  const { pc, scene } = aufbau(2.5);
  const z0 = pc.position.z;
  pc.startRolle(0);
  let minZ = z0;
  for (let i = 0; i < Math.ceil(1.5 * fps); i++) {
    pc.update(Math.min(1 / fps, 0.1), 1 / fps);
    scene.render();
    minZ = Math.min(minZ, pc.position.z);
  }
  const weg = z0 - minZ;
  check(`${fps} fps: the capsule stops in front of the wall (covers 1.5 ... 2.5 m, never through it)`, weg > 1.5 && weg < 2.5, `${weg.toFixed(3)} m`);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
