# @wov/physics

**Purpose.** The physics layer for the game (spec §29): player collision, ground
detection and world collision. It exists so that nothing above it has to know
which physics engine is underneath — see ADR-0013.

The package has two entry points, and the split is the whole point:

| Entry point          | Contains                                     | Who imports it           |
| -------------------- | -------------------------------------------- | ------------------------ |
| `@wov/physics`       | Types and tuning data. No Babylon, no Havok. | gameplay, systems, tests |
| `@wov/physics/havok` | The Havok backend. ~2 MB of WASM behind it.  | `apps/game`, dynamically |

`pnpm lint:boundaries` fails the build if the contract entry point reaches for a
backend, or if anything except the backend file imports `@babylonjs/havok`.

**Public API.**

- `PhysicsWorld` — `createCharacterController(options)`, `raycastGround(origin, options?)`,
  `raycast(from, to)`, `addStaticMesh(mesh)`, `addStaticGroup(group)`,
  `step(deltaSeconds)`, `dispose()`, `gravity`.
- `CharacterController` — `getPosition()`, `setPosition()`, `getLinearVelocity()`,
  `setLinearVelocity()`, `isGrounded()`, `dispose()`, `capsule`.
- `StaticBody`, `StaticMeshData`, `StaticGroup`, `StaticPlacement`,
  `StaticShapeDescription`, `GroundHit`, `CapsuleShape`, `Quat`, `Vec3`,
  `IDENTITY_ROTATION`, `physicsLayers`.

**One shape, many placements.** `addStaticGroup` is how a world's entities are
collided against (ADR-0026): a shape — `box`, `hull` or `mesh` — is built once
and every placement gets a body pointing at it. A placement carries a position
and a rotation and nothing else, because that is what a rigid-body solver can
represent exactly; **scale is baked into the shape's coordinates by the caller**,
so two entities that differ only in scale are two shapes and a mirrored entity
is a mirrored shape.

- Tuning data: `characterPhysics` (capsule radius 0.4 m, height 1.8 m, mass,
  friction, restitution, ground probe), `defaultGravity`, `simulationStep`.
- From `@wov/physics/havok`: `createHavokPhysicsWorld(scene, options?)` and
  `loadHavok(source?)`.

**Loading the WASM module.** `loadHavok` never guesses where `HavokPhysics.wasm`
is — the caller injects it, because the answer differs per environment:

```ts
// Browser, bundled by Vite (this is what apps/game does):
import wasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
const world = await createHavokPhysicsWorld(scene, { locateWasm: () => wasmUrl });

// Node, e.g. a test: Emscripten's default loader would fetch() a file:// URL
// and fail, so hand it the bytes instead.
const bytes = await readFile(require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'));
const world = await createHavokPhysicsWorld(scene, { wasmBinary: bytes });
```

Pass `instance` instead if you already loaded the module and want several worlds
to share it.

**Stepping.** The world does not step itself: `scene.physicsEnabled` is switched
off at creation so Babylon's render loop cannot advance the simulation behind the
game loop's back. Call `step(deltaSeconds)` once per frame. It splits the frame
into substeps of at most `simulationStep.maxSubStepSeconds` and caps their number
at `simulationStep.maxSubSteps`, so a long stall is dropped rather than paid back
over the following frames. Non-finite and negative deltas are ignored — handing
`NaN` to Havok turns every position in the world into `NaN` for good.

**Coordinates.** A character's position is the **centre** of its capsule, not its
feet. A 1.8 m capsule resting on a floor at `y = 0` reports `y = 0.9`.

**Dependencies.** `@babylonjs/core` and `@babylonjs/havok`, both used only by
`src/havok.ts` — justified in ADR-0013. `src/contract.ts` and `src/defaults.ts`
have no dependencies at all.

**Tests.** `pnpm test` runs the backend headless on Babylon's `NullEngine`: no
browser, no GPU. `src/havok.test.ts` is the proof that the capsule falls, stops,
and that the ground ray finds the floor.

**Ownership.** Core maintainers.
