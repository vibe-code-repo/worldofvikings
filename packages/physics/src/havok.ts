/**
 * `@wov/physics/havok` — the Havok-backed {@link PhysicsWorld} (spec §29).
 *
 * This is the only module in the repository that knows Havok exists. It is a
 * separate entry point so that importing `@wov/physics` (the contract) never
 * drags the ~1 MB WASM module into a bundle; `apps/game` pulls it in with a
 * dynamic `import()` after the scene exists (ADR-0008).
 *
 * WASM loading is injected rather than guessed: browsers hand in a bundled URL
 * via {@link HavokWasmSource.locateWasm}, Node hands in the bytes via
 * {@link HavokWasmSource.wasmBinary}. Nothing here touches `node:fs` or
 * `fetch` itself, so the module stays usable in both.
 */
import HavokPhysics from '@babylonjs/havok';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsEngine as PhysicsEngineV2 } from '@babylonjs/core/Physics/v2/physicsEngine.js';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
// Side effect only: adds `enablePhysics`/`getPhysicsEngine` to Scene.prototype.
// Without it `scene.enablePhysics` is simply undefined (no error at build time).
import '@babylonjs/core/Physics/v2/physicsEngineComponent.js';

import type {
  CharacterController,
  CharacterControllerOptions,
  GroundHit,
  PhysicsWorld,
  RaycastGroundOptions,
  StaticBody,
  StaticMeshData,
  Vec3,
} from './contract.js';
import { physicsLayers } from './contract.js';
import { characterPhysics, defaultGravity, simulationStep } from './defaults.js';

/** The initialised Havok WASM module. */
export type HavokInstance = Awaited<ReturnType<typeof HavokPhysics>>;

export interface HavokWasmSource {
  /**
   * Raw `HavokPhysics.wasm` bytes. Required under Node, where Emscripten's
   * default loader calls `fetch()` on a `file://` URL and fails.
   */
  readonly wasmBinary?: ArrayBuffer | ArrayBufferView;
  /**
   * Resolves the `.wasm` file name to a URL. Browser bundlers pass the asset
   * URL they emitted (Vite: `import url from '.../HavokPhysics.wasm?url'`).
   */
  readonly locateWasm?: (fileName: string) => string;
}

export interface HavokPhysicsWorldOptions extends HavokWasmSource {
  /** World gravity; defaults to {@link defaultGravity}. */
  readonly gravity?: Vec3;
  /** An already-initialised Havok module, so several worlds can share one. */
  readonly instance?: HavokInstance;
}

/**
 * Initialises the Havok WASM module.
 *
 * Exported separately from {@link createHavokPhysicsWorld} so a caller can load
 * the module once (it is expensive) and reuse it for every world it creates.
 */
export async function loadHavok(source: HavokWasmSource = {}): Promise<HavokInstance> {
  const overrides: Record<string, unknown> = {};
  if (source.wasmBinary !== undefined) {
    // Emscripten's typings say `ArrayBuffer`; it accepts any typed array at
    // runtime, which is what `fs.readFile` hands us.
    overrides['wasmBinary'] = source.wasmBinary;
  }
  if (source.locateWasm) {
    const locate = source.locateWasm;
    overrides['locateFile'] = (fileName: string): string => locate(fileName);
  }
  return HavokPhysics(overrides as Parameters<typeof HavokPhysics>[0]);
}

function toVector3(value: Vec3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function toVec3(value: Vector3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

/** Builds an invisible Babylon mesh from raw triangles for the mesh collider. */
function buildColliderMesh(data: StaticMeshData, scene: Scene): Mesh {
  const mesh = new BabylonMesh(`physics:${data.name}`, scene);
  mesh.isVisible = false;
  mesh.isPickable = false;

  const vertexData = new VertexData();
  vertexData.positions = Array.from(data.positions);
  vertexData.indices = Array.from(data.indices);
  vertexData.normals = [];
  VertexData.ComputeNormals(vertexData.positions, vertexData.indices, vertexData.normals);
  vertexData.applyToMesh(mesh);
  return mesh;
}

class HavokCharacterController implements CharacterController {
  readonly #aggregate: PhysicsAggregate;
  readonly #node: TransformNode;
  readonly #groundProbeDistance: number;
  readonly #world: HavokPhysicsWorld;
  #disposed = false;

  constructor(
    world: HavokPhysicsWorld,
    scene: Scene,
    readonly capsule: { readonly radius: number; readonly height: number },
    options: CharacterControllerOptions,
  ) {
    this.#world = world;
    this.#groundProbeDistance = options.groundProbeDistance ?? characterPhysics.groundProbeDistance;

    const node = new TransformNode(`character:${Date.now()}`, scene);
    node.position = toVector3(options.position);
    // A body without a rotation quaternion cannot receive physics rotations.
    node.rotationQuaternion = Quaternion.Identity();
    this.#node = node;

    const halfSpan = capsule.height / 2 - capsule.radius;
    this.#aggregate = new PhysicsAggregate(
      node,
      PhysicsShapeType.CAPSULE,
      {
        mass: options.mass ?? characterPhysics.mass,
        radius: capsule.radius,
        pointA: new Vector3(0, -halfSpan, 0),
        pointB: new Vector3(0, halfSpan, 0),
        friction: characterPhysics.friction,
        restitution: characterPhysics.restitution,
      },
      scene,
    );
    this.#aggregate.shape.filterMembershipMask = physicsLayers.character;
    // Zero inertia keeps the capsule upright: a character turns because the
    // gameplay system says so, never because it tripped over a pebble.
    this.#aggregate.body.setMassProperties({ inertia: Vector3.ZeroReadOnly });
  }

  getPosition(): Vec3 {
    return toVec3(this.#node.position);
  }

  setPosition(position: Vec3): void {
    this.#node.position = toVector3(position);
    this.#node.computeWorldMatrix(true);
    // Moving the transform node alone is not a teleport: Havok owns the body's
    // transform and writes its own value back on the next step, so the capsule
    // would snap straight back. Switching the pre-step on makes that step read
    // the node and hard-set the body (`PhysicsPrestepType.TELEPORT`);
    // `finishTeleport` switches it off again so the solver stays in charge.
    // `setTargetTransform` is *not* the way here — it sets a velocity towards
    // the target, which flings the body instead of moving it.
    this.#aggregate.body.disablePreStep = false;
    this.#aggregate.body.setLinearVelocity(Vector3.Zero());
    this.#aggregate.body.setAngularVelocity(Vector3.Zero());
    this.#world.scheduleTeleport(this);
  }

  /** Internal: the world reports that the pending teleport has been applied. */
  finishTeleport(): void {
    if (!this.#disposed) {
      this.#aggregate.body.disablePreStep = true;
    }
  }

  getLinearVelocity(): Vec3 {
    const velocity = new Vector3();
    this.#aggregate.body.getLinearVelocityToRef(velocity);
    return toVec3(velocity);
  }

  setLinearVelocity(velocity: Vec3): void {
    this.#aggregate.body.setLinearVelocity(toVector3(velocity));
  }

  isGrounded(): boolean {
    const feetDistance = this.capsule.height / 2;
    const hit = this.#world.raycastGround(this.getPosition(), {
      maxDistance: feetDistance + this.#groundProbeDistance,
    });
    return hit !== null;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#aggregate.dispose();
    this.#node.dispose();
    this.#world.forgetCharacter(this);
  }
}

class HavokPhysicsWorld implements PhysicsWorld {
  readonly #scene: Scene;
  readonly #engine: PhysicsEngineV2;
  readonly #plugin: HavokPlugin;
  readonly #statics = new Set<StaticBody>();
  readonly #characters = new Set<HavokCharacterController>();
  readonly #pendingTeleports = new Set<HavokCharacterController>();
  readonly #rayResult = new PhysicsRaycastResult();
  #disposed = false;

  constructor(
    scene: Scene,
    engine: PhysicsEngineV2,
    plugin: HavokPlugin,
    readonly gravity: Vec3,
  ) {
    this.#scene = scene;
    this.#engine = engine;
    this.#plugin = plugin;
  }

  createCharacterController(options: CharacterControllerOptions): CharacterController {
    this.#assertAlive('create a character controller');
    const capsule = options.capsule ?? characterPhysics.capsule;
    const controller = new HavokCharacterController(this, this.#scene, capsule, options);
    this.#characters.add(controller);
    return controller;
  }

  raycastGround(origin: Vec3, options: RaycastGroundOptions = {}): GroundHit | null {
    // A query against a torn-down world has no answer, and the Havok plugin
    // would dereference its freed state. Report "nothing there" instead.
    if (this.#disposed) {
      return null;
    }
    const maxDistance = options.maxDistance ?? characterPhysics.groundRayLength;
    const from = toVector3(origin);
    const to = new Vector3(origin.x, origin.y - maxDistance, origin.z);
    this.#engine.raycastToRef(from, to, this.#rayResult, { collideWith: physicsLayers.world });
    if (!this.#rayResult.hasHit) {
      return null;
    }
    return {
      point: toVec3(this.#rayResult.hitPointWorld),
      normal: toVec3(this.#rayResult.hitNormalWorld),
      distance: this.#rayResult.hitDistance,
    };
  }

  addStaticMesh(mesh: StaticMeshData): StaticBody {
    this.#assertAlive('add static geometry');
    const colliderMesh = buildColliderMesh(mesh, this.#scene);
    const aggregate = new PhysicsAggregate(
      colliderMesh,
      PhysicsShapeType.MESH,
      { mass: 0, mesh: colliderMesh },
      this.#scene,
    );
    aggregate.shape.filterMembershipMask = physicsLayers.world;

    let disposed = false;
    const body: StaticBody = {
      name: mesh.name,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        aggregate.dispose();
        colliderMesh.dispose();
        this.#statics.delete(body);
      },
    };
    this.#statics.add(body);
    return body;
  }

  /**
   * Advances the simulation, split into fixed substeps.
   *
   * A frame is never handed to the solver in one piece: a long frame is cut
   * into slices of at most `simulationStep.maxSubStepSeconds` so a fast-moving
   * capsule cannot skip through a wall, and the number of slices is capped so a
   * stall is dropped rather than paid back over the following frames
   * (`simulationStep.maxSubSteps`, spec §38).
   *
   * `NaN`, `Infinity` and negative deltas are ignored. Handing `NaN` to Havok
   * turns every position in the world into `NaN` permanently — there is no
   * recovering from it, so it must never reach the solver.
   */
  step(deltaSeconds: number): void {
    if (this.#disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    const { maxSubStepSeconds, maxSubSteps } = simulationStep;
    const substeps = Math.min(Math.ceil(deltaSeconds / maxSubStepSeconds), maxSubSteps);
    const substepSeconds = Math.min(deltaSeconds / substeps, maxSubStepSeconds);
    for (let index = 0; index < substeps; index += 1) {
      this.#engine._step(substepSeconds);
    }
    // The first substep consumed the pending teleports; hand the bodies back to
    // the solver so they are simulated again instead of being driven by nodes.
    for (const controller of this.#pendingTeleports) {
      controller.finishTeleport();
    }
    this.#pendingTeleports.clear();
  }

  /** Internal: a controller asks for a hard teleport on the next step. */
  scheduleTeleport(controller: HavokCharacterController): void {
    this.#pendingTeleports.add(controller);
  }

  /** Fails loudly rather than handing out a body that will never simulate. */
  #assertAlive(action: string): void {
    if (this.#disposed) {
      throw new Error(`Cannot ${action}: this physics world was disposed.`);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const character of [...this.#characters]) {
      character.dispose();
    }
    for (const body of [...this.#statics]) {
      body.dispose();
    }
    this.#plugin.dispose();
    this.#scene.disablePhysicsEngine();
  }

  /** Internal: a controller tells the world it is gone. */
  forgetCharacter(controller: HavokCharacterController): void {
    this.#characters.delete(controller);
    this.#pendingTeleports.delete(controller);
  }
}

/**
 * Creates a Havok-backed physics world for an existing Babylon scene.
 *
 * The world owns stepping: `scene.physicsEnabled` is switched off so the render
 * loop cannot advance the simulation behind the game loop's back. Call
 * {@link PhysicsWorld.step} with the fixed timestep the game decides on.
 *
 * Works headless on `NullEngine` — see `havok.test.ts` and ADR-0008.
 */
export async function createHavokPhysicsWorld(
  scene: Scene,
  options: HavokPhysicsWorldOptions = {},
): Promise<PhysicsWorld> {
  const instance = options.instance ?? (await loadHavok(options));
  const gravity = options.gravity ?? defaultGravity;
  const plugin = new HavokPlugin(true, instance);

  if (!scene.enablePhysics(toVector3(gravity), plugin)) {
    throw new Error('Havok physics could not be enabled for this scene.');
  }
  const engine = scene.getPhysicsEngine();
  if (!(engine instanceof PhysicsEngineV2)) {
    throw new Error('Expected the Babylon physics engine v2 after enabling Havok.');
  }
  // The game loop steps physics explicitly; Babylon must not step it as well.
  scene.physicsEnabled = false;

  return new HavokPhysicsWorld(scene, engine, plugin, gravity);
}
