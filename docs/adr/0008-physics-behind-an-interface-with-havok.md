# ADR-0008: Physics lives behind an interface, implemented with Havok

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

Phase 1 needs player collision, ground detection and world collision (spec §29).
Three constraints shape the decision:

1. **Gameplay must not know the backend.** Spec §25 puts gameplay state above the
   renderer, and agent rule 7 forbids rendering concerns inside gameplay. A
   physics engine is the same kind of concern: if `packages/gameplay` calls
   `PhysicsAggregate` or `HavokPlugin` directly, every later change to the
   backend becomes a rewrite of the gameplay systems.
2. **The physics WASM module must not be in every bundle.** `@babylonjs/havok`
   ships a ~2 MB WebAssembly module. The editor does not simulate physics, and
   even the game should not pay for it before a world is loaded (spec §38).
3. **Tests must run headless in CI.** Physics behaviour ("does the capsule stop
   on the floor?") is exactly the kind of logic that must be tested, and CI has
   no GPU and no browser.

## Decision

Introduce **`packages/physics`** with two entry points:

- `@wov/physics` — the `PhysicsWorld` contract plus tuning data. Framework-free:
  no Babylon.js, no Havok, no DOM. This is what gameplay imports.
- `@wov/physics/havok` — `createHavokPhysicsWorld(scene, options)`, the only
  module in the repository that imports `@babylonjs/havok`.

`apps/game` loads the backend with a dynamic `import()` from a single file,
`apps/game/src/physics-backend.ts`, so Havok lands in its own chunk. The
boundaries are enforced by `pnpm lint:boundaries`, not by convention.

### Why a separate package instead of `packages/engine`

`packages/engine` is the renderer layer, and `packages/gameplay` may not import
it (existing boundary rule `gameplay-must-not-render`). Gameplay _must_ be able
to import the physics contract — it is how a movement system asks whether the
player is standing on something. Putting the contract in `@wov/engine` would
mean either weakening that rule or duplicating the types. A third package keeps
both rules intact: `@wov/physics` sits below the renderer and below gameplay.

### Capsule parameters are data

Radius 0.4 m and height 1.8 m live in `packages/physics/src/defaults.ts` as a
frozen record (`characterPhysics`), together with mass, friction, restitution,
the ground-probe distance and the substep limits. Rule 9 keeps _world_ data out
of TypeScript; these are engine tuning constants, not authored content, so they
stay in code — but in one named place that a test can pin, never inlined at a
call site.

### WASM loading is injected, never guessed

`loadHavok()` takes either raw bytes (`wasmBinary`) or a URL resolver
(`locateWasm`). The module itself never touches `node:fs` or `fetch`, so the
same code path works in both environments:

```ts
// Browser (apps/game, Vite emits the asset and gives us its URL):
import wasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
await createHavokPhysicsWorld(scene, { locateWasm: () => wasmUrl });

// Node (tests):
await loadHavok({
  wasmBinary: await readFile(require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm')),
});
```

### Evidence that this works headless

Havok is CPU-only, so it does not need a rendering context — Cedric (Babylon
team) in
[_Running NullEngine in node.js to leverage the Havok physics engine_](https://forum.babylonjs.com/t/running-nullengine-in-node-js-to-leverage-the-havok-physics-engine/41424):
Havok can be used without a renderer because it does not use the GPU.

The one thing that does _not_ work under Node is Emscripten's default loader: it
resolves the `.wasm` file with `fetch()`, which fails on a `file://` path. The
fix accepted in that same thread is to read the file and pass it as
`wasmBinary`; RaananW (Babylon team) called passing the binary directly the
right solution for Node. In
[_Using Havok for a headless server_](https://forum.babylonjs.com/t/using-havok-for-a-headless-server/43029)
the same combination is reported running in production, with the caller stepping
the physics engine manually instead of calling `scene.render()` — which is
exactly what `PhysicsWorld.step()` does here.

`packages/physics/src/havok.test.ts` reproduces this on `NullEngine`: a capsule
falls onto a static mesh, comes to rest at half its height, and `raycastGround`
reports the floor. No browser, no GPU, no Playwright.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Call Babylon's physics v2 API directly from gameplay      | Fastest to write, and it welds gameplay to Babylon and Havok. Contradicts spec §25 and makes the "gameplay is renderer-free" boundary unenforceable.                                                                        |
| Put the contract in `packages/engine`                     | Gameplay may not import `@wov/engine` (boundary rule), so the physics contract would be unreachable from the systems that need it.                                                                                          |
| Cannon-es / Ammo.js / Rapier instead of Havok             | Spec §2.1 and §29 name Havok, and it is the plugin Babylon maintains first-class. Rapier is a credible alternative and, because of this ADR, swapping it in means one new file next to `havok.ts` — not a gameplay rewrite. |
| Hand-written sphere/AABB collision, no physics dependency | No new dependency, but triggers, projectiles, hit queries and ragdolls (spec §29) would all have to be written by hand. That is a physics engine with fewer eyes on it.                                                     |
| Load Havok statically in `apps/game`                      | Simpler bundling, but ~2 MB of WASM is fetched before the menu is drawn and it would sit in the same chunk as the bootstrap. A dynamic import costs one `await` and keeps the first paint cheap (spec §38).                 |

## Consequences

**Positive** — gameplay code reads `PhysicsWorld` and never sees Havok; the
backend is one file; physics behaviour is covered by fast headless tests; the
WASM module is a separate chunk that the editor never loads.

**Negative** — one indirection layer to maintain: every capability gameplay needs
(triggers, projectiles, hit queries, ragdolls) must be added to the contract
first, and it is tempting to reach past it under time pressure. The
dependency-cruiser rules exist so that temptation fails the build. The contract
also passes plain `Vec3` records rather than Babylon `Vector3`, which costs a
small conversion per call — deliberate, so the contract stays framework-free.

**Follow-ups** — Phase 2 adds movement on top of `CharacterController`; the
contract will need triggers and shape casts for combat (spec §28) and projectile
queries. When `packages/gameplay` starts using physics, add a boundary rule that
it may import `@wov/physics` but never `@wov/physics/havok`.

## New dependency

`@babylonjs/havok` (^1.3.10, MIT-licensed npm wrapper around the Havok
distribution) — required by spec §2.1/§29 and used only by
`packages/physics/src/havok.ts`. It brings a single transitive dependency,
`@types/emscripten` (types only).
