/**
 * `@wov/physics` — the physics contract (spec §29).
 *
 * This entry point is intentionally free of Babylon.js and Havok, so importing
 * it costs nothing at runtime and gameplay code cannot reach the backend. The
 * Havok implementation is a separate entry point, `@wov/physics/havok`, which
 * `apps/game` loads with a dynamic `import()` (ADR-0013).
 */
export type {
  CapsuleShape,
  CharacterController,
  CharacterControllerOptions,
  GroundHit,
  PhysicsLayer,
  PhysicsWorld,
  Quat,
  RaycastGroundOptions,
  StaticBody,
  StaticGroup,
  StaticMeshData,
  StaticPlacement,
  StaticShapeDescription,
  Vec3,
} from './contract.js';
export { IDENTITY_ROTATION, physicsLayers } from './contract.js';
export { characterPhysics, defaultGravity, simulationStep } from './defaults.js';
