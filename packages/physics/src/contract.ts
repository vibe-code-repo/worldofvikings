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

/**
 * A rotation as a quaternion.
 *
 * Not Euler angles: an Euler triple needs an axis order to mean anything, the
 * renderer and the solver do not have to agree on one, and a body that is
 * rotated in the wrong order is a wall in the wrong place. The caller converts
 * once, with whatever it already uses to place the thing on screen.
 */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** No rotation. */
export const IDENTITY_ROTATION: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

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

/**
 * One collision shape in its own local space, ready to be shared (ADR-0026).
 *
 * The three kinds are the three bargains between cost and truth: a box is one
 * plane test per face, a convex hull follows a silhouette but has no hole in
 * it, and a mesh is every triangle and is the only one an archway can be built
 * from.
 *
 * **Scale is not here on purpose.** A placement carries a position and a
 * rotation and nothing else, because that is what a rigid-body solver can
 * represent exactly. Anything scaled — and a world file scales almost every
 * entity, often unevenly and sometimes negatively — bakes its scale into these
 * coordinates before it gets here, and two entities that differ only in scale
 * are two shapes.
 */
export type StaticShapeDescription =
  | {
      readonly kind: 'box';
      /** Middle of the box in shape space. */
      readonly center: Vec3;
      /** Half the box's size on each axis; never negative. */
      readonly halfExtents: Vec3;
    }
  | {
      readonly kind: 'hull';
      /** Flat `x, y, z` list the hull is wrapped around. */
      readonly positions: Float32Array | readonly number[];
    }
  | {
      readonly kind: 'mesh';
      readonly positions: Float32Array | readonly number[];
      readonly indices: Uint32Array | Uint16Array | readonly number[];
    };

/** Where one copy of a shared shape stands. */
export interface StaticPlacement {
  readonly position: Vec3;
  /** Defaults to {@link IDENTITY_ROTATION}. */
  readonly rotation?: Quat;
}

/**
 * One shape and every place it stands.
 *
 * This is the unit the world builder works in, and the reason it is a *group*
 * rather than a body is cost: the village places 1216 entities from 139 models,
 * and building a collision shape per entity would build the same convex hull
 * eighty times. One shape, eighty bodies pointing at it.
 */
export interface StaticGroup {
  readonly name: string;
  readonly shape: StaticShapeDescription;
  readonly placements: readonly StaticPlacement[];
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
  /**
   * Casts a segment through the `world` layer and reports the first surface.
   *
   * The general form of {@link raycastGround}, which stays its own method
   * because "where is the ground" is the one query gameplay is allowed to ask
   * about what is below it (ADR-0014). This one is for what is *beside*
   * something.
   */
  raycast(from: Vec3, to: Vec3): GroundHit | null;
  addStaticMesh(mesh: StaticMeshData): StaticBody;
  /**
   * Adds one shape at many places, sharing it between them (ADR-0026).
   *
   * The returned handle removes all of them at once, because they arrived as
   * one zone and they leave as one zone.
   */
  addStaticGroup(group: StaticGroup): StaticBody;
  /** Advances the simulation by `deltaSeconds`. */
  step(deltaSeconds: number): void;
  dispose(): void;
}
