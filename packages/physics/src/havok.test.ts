/**
 * Integration test for the Havok-backed {@link PhysicsWorld} (spec §29).
 *
 * It runs headless on Babylon's `NullEngine`: no WebGL, no canvas, no browser.
 * The Havok WASM module cannot `fetch()` a `file://` URL under Node, so the
 * bytes are read from disk and handed to the loader as `wasmBinary` — the same
 * escape hatch the Babylon forum recommends for server-side physics
 * (see docs/adr/0008-physics-behind-an-interface-with-havok.md).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  characterPhysics,
  defaultGravity,
  physicsLayers,
  type PhysicsWorld,
  type StaticMeshData,
} from './index.js';
import { createHavokPhysicsWorld, loadHavok, type HavokInstance } from './havok.js';

const STEP_SECONDS = 1 / 60;

/** A flat 20 x 20 m quad at y = 0 — plain triangle data, no Babylon types. */
const flatGround: StaticMeshData = {
  name: 'test-ground',
  positions: [-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10],
  indices: [0, 1, 2, 0, 2, 3],
};

async function readHavokWasm(): Promise<Uint8Array> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'));
}

let instance: HavokInstance;
let engine: NullEngine | undefined;
let world: PhysicsWorld | undefined;

beforeAll(async () => {
  instance = await loadHavok({ wasmBinary: await readHavokWasm() });
}, 30_000);

afterEach(() => {
  world?.dispose();
  engine?.dispose();
  world = undefined;
  engine = undefined;
});

async function createWorld(): Promise<PhysicsWorld> {
  engine = new NullEngine();
  const scene = new Scene(engine);
  world = await createHavokPhysicsWorld(scene, { instance });
  return world;
}

function stepFor(target: PhysicsWorld, seconds: number): void {
  const steps = Math.round(seconds / STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    target.step(STEP_SECONDS);
  }
}

describe('createHavokPhysicsWorld', () => {
  it('reports the configured gravity', async () => {
    const physics = await createWorld();
    expect(physics.gravity).toEqual(defaultGravity);
  });

  it('lets a character capsule fall onto a static mesh and come to rest', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);

    const character = physics.createCharacterController({ position: { x: 0, y: 5, z: 0 } });
    expect(character.capsule).toEqual(characterPhysics.capsule);
    expect(character.isGrounded()).toBe(false);

    stepFor(physics, 5);

    // The capsule origin is its centre, so resting height is half the capsule.
    const restingHeight = characterPhysics.capsule.height / 2;
    expect(character.getPosition().y).toBeCloseTo(restingHeight, 2);
    expect(Math.abs(character.getLinearVelocity().y)).toBeLessThan(0.01);
    expect(character.isGrounded()).toBe(true);
  });

  it('does not let the capsule fall through the ground when dropped from high up', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 40, z: 0 } });

    stepFor(physics, 10);

    expect(character.getPosition().y).toBeGreaterThan(0);
    expect(character.getPosition().y).toBeCloseTo(characterPhysics.capsule.height / 2, 2);
  });

  it('disposes a character controller without disposing the world', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 3, z: 0 } });
    character.dispose();

    expect(() => physics.step(STEP_SECONDS)).not.toThrow();
    expect(physics.raycastGround({ x: 0, y: 3, z: 0 })).not.toBeNull();
  });

  it('refuses to create a controller after the world was disposed', async () => {
    const physics = await createWorld();
    physics.dispose();

    expect(() => physics.createCharacterController({ position: { x: 0, y: 1, z: 0 } })).toThrow(
      /disposed/i,
    );
  });
});

describe('CharacterController.setPosition', () => {
  it('teleports the simulated body, not just its transform node', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 5, z: 0 } });
    stepFor(physics, 5);
    expect(character.isGrounded()).toBe(true);

    character.setPosition({ x: 3, y: 20, z: -2 });

    // Without a real teleport the next step snaps the capsule back to where
    // Havok still believes it is — the resting height above the ground.
    expect(character.isGrounded()).toBe(false);
    stepFor(physics, 0.5);
    const after = character.getPosition();
    expect(after.y).toBeGreaterThan(10);
    expect(after.x).toBeCloseTo(3, 3);
    expect(after.z).toBeCloseTo(-2, 3);
  });

  it('clears the velocity so a falling character does not keep its speed', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 30, z: 0 } });
    stepFor(physics, 2);
    expect(character.getLinearVelocity().y).toBeLessThan(-5);

    character.setPosition({ x: 0, y: 30, z: 0 });

    expect(character.getLinearVelocity().y).toBeCloseTo(0, 4);
  });
});

describe('step', () => {
  it('ignores a non-finite timestep instead of poisoning the simulation', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 5, z: 0 } });

    physics.step(Number.NaN);
    physics.step(Number.POSITIVE_INFINITY);
    physics.step(-1);

    expect(character.getPosition().y).toBeCloseTo(5, 5);
    // The world must still simulate normally afterwards.
    stepFor(physics, 5);
    expect(character.getPosition().y).toBeCloseTo(characterPhysics.capsule.height / 2, 2);
  });

  it('splits a long frame into substeps instead of one huge integration', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 20, z: 0 } });

    // One 0.5 s frame (a stall) must advance about as far as 30 frames at 60 Hz.
    physics.step(0.5);
    const stalled = character.getPosition().y;

    const reference = await createHavokPhysicsWorld(new Scene(new NullEngine()), { instance });
    try {
      reference.addStaticMesh(flatGround);
      const smooth = reference.createCharacterController({ position: { x: 0, y: 20, z: 0 } });
      stepFor(reference, 0.5);
      expect(stalled).toBeCloseTo(smooth.getPosition().y, 1);
    } finally {
      reference.dispose();
    }
  });

  it('caps the number of substeps so a very long stall cannot spiral', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    const character = physics.createCharacterController({ position: { x: 0, y: 200, z: 0 } });

    physics.step(60);

    // 60 s of simulated fall would be far below the ground; the cap keeps the
    // frame cheap and the character near where it was.
    expect(character.getPosition().y).toBeGreaterThan(190);
  });
});

describe('raycastGround', () => {
  it('finds the ground straight below the origin', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);

    const hit = physics.raycastGround({ x: 2, y: 3, z: -1 });

    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(3, 4);
    expect(hit?.point.y).toBeCloseTo(0, 4);
    expect(hit?.point.x).toBeCloseTo(2, 4);
    expect(hit?.normal.y).toBeCloseTo(1, 4);
  });

  it('returns null when there is no ground within reach', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);

    expect(physics.raycastGround({ x: 500, y: 3, z: 500 })).toBeNull();
    expect(physics.raycastGround({ x: 0, y: 3, z: 0 }, { maxDistance: 1 })).toBeNull();
  });

  it('ignores the character capsule and reports the world surface', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    physics.createCharacterController({ position: { x: 0, y: 1, z: 0 } });
    stepFor(physics, 2);

    const hit = physics.raycastGround({ x: 0, y: 3, z: 0 });

    expect(hit?.point.y).toBeCloseTo(0, 3);
    expect(hit?.distance).toBeCloseTo(3, 3);
  });

  it('returns null when the world has no static geometry at all', async () => {
    const physics = await createWorld();
    expect(physics.raycastGround({ x: 0, y: 3, z: 0 })).toBeNull();
  });

  it('returns null instead of crashing once the world was disposed', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    physics.dispose();

    expect(physics.raycastGround({ x: 0, y: 3, z: 0 })).toBeNull();
    expect(() => physics.step(STEP_SECONDS)).not.toThrow();
    expect(() => physics.dispose()).not.toThrow();
  });

  it('stops reporting a static mesh that was disposed', async () => {
    const physics = await createWorld();
    const ground = physics.addStaticMesh(flatGround);
    expect(physics.raycastGround({ x: 0, y: 3, z: 0 })).not.toBeNull();

    ground.dispose();

    expect(physics.raycastGround({ x: 0, y: 3, z: 0 })).toBeNull();
  });
});

describe('collision layers', () => {
  it('keeps the world and character layers distinct', () => {
    expect(physicsLayers.world & physicsLayers.character).toBe(0);
  });
});
