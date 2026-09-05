/**
 * The physics contract (spec §29).
 *
 * Everything in this file is framework-free on purpose: no Babylon.js, no
 * Havok, no DOM. Gameplay code talks to {@link PhysicsWorld} and therefore
 * never sees the backend — the Havok implementation lives behind the separate
 * `@wov/physics/havok` entry point (ADR-0013).
 */

/** A point or direction in world space, in metres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Collision layers as a bit mask.
 *
 * Ground queries only look at `world`, so a character never detects itself as
 * ground and dynamic props never fake a floor.
 */
export const physicsLayers = Object.freeze({
  /** Static level geometry: terrain, buildings, dungeon walls. */
  world: 1,
  /** Player and NPC capsules. */
  character: 2,
});

export type PhysicsLayer = (typeof physicsLayers)[keyof typeof physicsLayers];

/** An upright capsule, measured in metres. `height` includes both caps. */
export interface CapsuleShape {
  readonly radius: number;
  readonly height: number;
}

/** Everything the world needs to spawn a character body. */
export interface CharacterControllerOptions {
  /** Spawn position of the capsule **centre**, not its feet. */
  readonly position: Vec3;
  /** Capsule dimensions; defaults to `characterPhysics.capsule`. */
  readonly capsule?: CapsuleShape;
  /** Body mass in kilograms; defaults to `characterPhysics.mass`. */
  readonly mass?: number;
  /** How far below the feet a surface still counts as ground, in metres. */
  readonly groundProbeDistance?: number;
}

/**
 * A player or NPC body.
 *
 * The controller owns no gameplay state — it is the physical representation a
 * gameplay system reads from and writes to (spec §25).
 */
export interface CharacterController {
  /** The capsule this controller was created with. */
  readonly capsule: CapsuleShape;
  /** Current position of the capsule centre. */
  getPosition(): Vec3;
  /** Teleports the capsule centre and clears its velocity. */
  setPosition(position: Vec3): void;
  getLinearVelocity(): Vec3;
  setLinearVelocity(velocity: Vec3): void;
  /** True while a `world`-layer surface is within reach of the feet. */
  isGrounded(): boolean;
  /** Removes the body from the simulation. */
  dispose(): void;
}

/**
 * Static collision geometry as raw triangles.
 *
 * Deliberately *not* a Babylon mesh: the contract stays renderer-free, so the
 * same data can come from a loaded glTF, from `content/` or from a test.
 * `positions` is a flat x,y,z list in world space; `indices` are triangles.
 */
export interface StaticMeshData {
  readonly name: string;
  readonly positions: Float32Array | readonly number[];
  readonly indices: Uint32Array | Uint16Array | readonly number[];
}

/** Handle to a piece of static geometry, so a zone can be unloaded again. */
export interface StaticBody {
  readonly name: string;
  dispose(): void;
}

/** What a downward ground query found. */
export interface GroundHit {
  /** Where the ray met the surface. */
  readonly point: Vec3;
  /** Surface normal at the hit point. */
  readonly normal: Vec3;
  /** Distance from the ray origin to the hit point, in metres. */
  readonly distance: number;
}

export interface RaycastGroundOptions {
  /** How far down to look; defaults to `characterPhysics.groundRayLength`. */
  readonly maxDistance?: number;
}

/**
 * The only physics surface gameplay is allowed to know about.
 *
 * Implementations are created by a backend factory (currently
 * `createHavokPhysicsWorld` from `@wov/physics/havok`). Stepping is explicit:
 * the game loop decides when time advances, not the renderer.
 */
export interface PhysicsWorld {
  readonly gravity: Vec3;
  createCharacterController(options: CharacterControllerOptions): CharacterController;
  /** Casts straight down from `origin`, hitting only the `world` layer. */
  raycastGround(origin: Vec3, options?: RaycastGroundOptions): GroundHit | null;
  addStaticMesh(mesh: StaticMeshData): StaticBody;
  /** Advances the simulation by `deltaSeconds`. */
  step(deltaSeconds: number): void;
  dispose(): void;
}
