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
  type StaticGroup,
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

/** A 1 m cube of triangles centred on the origin, for the hull and mesh kinds. */
const UNIT_CUBE = {
  positions: [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ],
  indices: [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5,
    6, 1, 6, 2,
  ],
};

/** A quarter turn about Y, as a quaternion. */
const QUARTER_TURN_Y = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

/** Casts along +x at `y` and reports how far it got. */
function reach(physics: PhysicsWorld, y: number, toX = 20): number | null {
  const hit = physics.raycast({ x: -20, y, z: 0 }, { x: toX, y, z: 0 });
  return hit ? hit.point.x : null;
}

describe('raycast', () => {
  it('reports the first surface along an arbitrary segment', async () => {
    const physics = await createWorld();
    physics.addStaticGroup({
      name: 'wall',
      shape: { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 2, z: 5 } },
      placements: [{ position: { x: 4, y: 0, z: 0 } }],
    });
    expect(reach(physics, 0)).toBeCloseTo(3.5, 3);
  });

  it('answers nothing when the segment misses everything', async () => {
    const physics = await createWorld();
    physics.addStaticMesh(flatGround);
    expect(physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: 4, z: 0 })).toBeNull();
  });
});

describe('addStaticGroup', () => {
  const boxGroup = (placements: StaticGroup['placements']): StaticGroup => ({
    name: 'box',
    shape: { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 2, z: 5 } },
    placements,
  });

  it('puts one shape down at every placement', async () => {
    const physics = await createWorld();
    physics.addStaticGroup(boxGroup([{ position: { x: 4, y: 0, z: 0 } }]));
    expect(reach(physics, 0)).toBeCloseTo(3.5, 3);
  });

  it('turns a body with its placement rotation', async () => {
    const physics = await createWorld();
    // The box is 1 m thick on x and 10 m long on z. Turned a quarter turn about
    // Y it is 10 m thick on x, so a ray along +x meets it 5 m earlier.
    physics.addStaticGroup(
      boxGroup([{ position: { x: 4, y: 0, z: 0 }, rotation: QUARTER_TURN_Y }]),
    );
    expect(reach(physics, 0)).toBeCloseTo(-1, 3);
  });

  it('takes many placements of one shape', async () => {
    const physics = await createWorld();
    physics.addStaticGroup(
      boxGroup([{ position: { x: 4, y: 0, z: 0 } }, { position: { x: -4, y: 0, z: 0 } }]),
    );
    expect(reach(physics, 0)).toBeCloseTo(-4.5, 3);
  });

  it('removes every body of the group at once', async () => {
    const physics = await createWorld();
    const group = physics.addStaticGroup(
      boxGroup([{ position: { x: 4, y: 0, z: 0 } }, { position: { x: -4, y: 0, z: 0 } }]),
    );
    expect(reach(physics, 0)).not.toBeNull();

    group.dispose();

    expect(reach(physics, 0)).toBeNull();
  });

  it('collides against a convex hull of the points it is given', async () => {
    const physics = await createWorld();
    physics.addStaticGroup({
      name: 'hull',
      shape: { kind: 'hull', positions: UNIT_CUBE.positions },
      placements: [{ position: { x: 4, y: 0, z: 0 } }],
    });
    expect(reach(physics, 0)).toBeCloseTo(3.5, 2);
  });

  it('collides against every triangle of a mesh, hole and all', async () => {
    const physics = await createWorld();
    // Two 1 m cubes 4 m apart, in one shape: a ray between them passes through.
    const positions = [...UNIT_CUBE.positions];
    const indices = [...UNIT_CUBE.indices];
    const offset = UNIT_CUBE.positions.length / 3;
    for (let index = 0; index < offset; index += 1) {
      positions.push(
        (UNIT_CUBE.positions[index * 3] ?? 0) + 4,
        UNIT_CUBE.positions[index * 3 + 1] ?? 0,
        UNIT_CUBE.positions[index * 3 + 2] ?? 0,
      );
    }
    for (const index of UNIT_CUBE.indices) {
      indices.push(index + offset);
    }

    physics.addStaticGroup({
      name: 'two-posts',
      shape: { kind: 'mesh', positions, indices },
      placements: [{ position: { x: 0, y: 0, z: 0 } }],
    });

    // Along x the ray meets the first post.
    expect(reach(physics, 0)).toBeCloseTo(-0.5, 2);
    // Between the two posts, along z, nothing is in the way.
    expect(physics.raycast({ x: 2, y: 0, z: -20 }, { x: 2, y: 0, z: 20 })).toBeNull();
  });

  it('refuses to add geometry to a disposed world', async () => {
    const physics = await createWorld();
    physics.dispose();
    expect(() => physics.addStaticGroup(boxGroup([{ position: { x: 0, y: 0, z: 0 } }]))).toThrow(
      /disposed/,
    );
  });
});
