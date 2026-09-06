/**
 * `@wov/physics/havok` — the Havok-backed {@link PhysicsWorld} (spec §29).
 *
 * This is the only module in the repository that knows Havok exists. It is a
 * separate entry point so that importing `@wov/physics` (the contract) never
 * drags the ~1 MB WASM module into a bundle; `apps/game` pulls it in with a
 * dynamic `import()` after the scene exists (ADR-0013).
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
import {
  PhysicsMotionType,
  PhysicsShapeType,
} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody.js';
import {
  PhysicsShape,
  PhysicsShapeBox,
  PhysicsShapeConvexHull,
  PhysicsShapeMesh,
} from '@babylonjs/core/Physics/v2/physicsShape.js';
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
  Quat,
  RaycastGroundOptions,
  StaticBody,
  StaticGroup,
  StaticMeshData,
  StaticShapeDescription,
  Vec3,
} from './contract.js';
import { IDENTITY_ROTATION, physicsLayers } from './contract.js';
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

/**
 * A degenerate triangle list covering every point exactly once.
 *
 * `PhysicsShapeConvexHull` reads its points off a mesh's vertex buffer, and a
 * mesh without indices has no vertex buffer to read. The triangles are never
 * collided against — the hull is — so they only have to name every point.
 */
function trianglesOverPoints(count: number): Uint32Array {
  const indices = new Uint32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    indices[index * 3] = index;
    indices[index * 3 + 1] = index;
    indices[index * 3 + 2] = index;
  }
  return indices;
}

function toQuaternion(value: Quat): Quaternion {
  return new Quaternion(value.x, value.y, value.z, value.w);
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
    const maxDistance = options.maxDistance ?? characterPhysics.groundRayLength;
    return this.raycast(origin, { x: origin.x, y: origin.y - maxDistance, z: origin.z });
  }

  raycast(from: Vec3, to: Vec3): GroundHit | null {
    // A query against a torn-down world has no answer, and the Havok plugin
    // would dereference its freed state. Report "nothing there" instead.
    if (this.#disposed) {
      return null;
    }
    this.#engine.raycastToRef(toVector3(from), toVector3(to), this.#rayResult, {
      collideWith: physicsLayers.world,
    });
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
   * One shape, one body per placement (ADR-0026).
   *
   * The shape is built once and handed to every body: that is the difference
   * between 220 convex hulls and 1216 of them for the same village. Each body
   * gets its own transform node carrying **position and rotation only** — a
   * node with a scale on it would ask Havok to represent something a rigid
   * transform cannot, so the scale is already in the shape's coordinates by the
   * time it arrives here.
   */
  addStaticGroup(group: StaticGroup): StaticBody {
    this.#assertAlive('add static geometry');
    const built = this.#buildShape(group.name, group.shape);
    built.shape.filterMembershipMask = physicsLayers.world;

    const bodies: PhysicsBody[] = [];
    const nodes: TransformNode[] = [];
    for (const [index, placement] of group.placements.entries()) {
      const node = new TransformNode(`physics:${group.name}:${String(index)}`, this.#scene);
      node.position = toVector3(placement.position);
      node.rotationQuaternion = toQuaternion(placement.rotation ?? IDENTITY_ROTATION);
      node.computeWorldMatrix(true);

      const physicsBody = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.#scene);
      physicsBody.shape = built.shape;
      bodies.push(physicsBody);
      nodes.push(node);
    }

    let disposed = false;
    const body: StaticBody = {
      name: group.name,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        for (const physicsBody of bodies) {
          physicsBody.dispose();
        }
        built.shape.dispose();
        built.mesh?.dispose();
        for (const node of nodes) {
          node.dispose();
        }
        this.#statics.delete(body);
      },
    };
    this.#statics.add(body);
    return body;
  }

  /**
   * Turns a shape description into a Havok shape.
   *
   * The hull and the mesh kinds go through a throwaway Babylon mesh, because
   * that is the only thing `PhysicsShapeConvexHull` and `PhysicsShapeMesh`
   * accept. It is returned alongside the shape so it can be disposed with it —
   * Havok keeps its own copy of the triangles, but the Babylon mesh would sit
   * in the scene forever otherwise.
   */
  #buildShape(
    name: string,
    description: StaticShapeDescription,
  ): { shape: PhysicsShape; mesh?: Mesh } {
    if (description.kind === 'box') {
      const shape = new PhysicsShapeBox(
        toVector3(description.center),
        Quaternion.Identity(),
        new Vector3(
          Math.abs(description.halfExtents.x) * 2,
          Math.abs(description.halfExtents.y) * 2,
          Math.abs(description.halfExtents.z) * 2,
        ),
        this.#scene,
      );
      return { shape };
    }

    const indices =
      description.kind === 'mesh'
        ? description.indices
        : // A convex hull only needs the points, but Babylon reads the topology
          // off a mesh, so the points are handed over as a strip of triangles.
          trianglesOverPoints(description.positions.length / 3);
    const mesh = buildColliderMesh(
      { name, positions: description.positions, indices },
      this.#scene,
    );
    const shape =
      description.kind === 'mesh'
        ? new PhysicsShapeMesh(mesh, this.#scene)
        : new PhysicsShapeConvexHull(mesh, this.#scene);
    return { shape, mesh };
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
 * Works headless on `NullEngine` — see `havok.test.ts` and ADR-0013.
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
