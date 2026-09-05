# ADR-0012: Vendoring third-party assets, and two entry points for `@wov/asset-system`

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

ADR-0011 built the machinery to load assets. This is the first time a real,
third-party licensed asset goes through it, and doing that raised three
questions the machinery did not answer.

**How third-party files are stored.** Spec §45/§46 demand source, author,
license, usage rights and modification status per asset, and forbid anything
that cannot be redistributed. A row in `docs/asset-licenses.md` records that.
What it does not settle is whether the committed file may be edited — and the
first candidate makes the question concrete: Kenney's `detail-barrel.glb` does
not embed its texture. It references `Textures/barrel.png` as a **relative
URI**, resolved by the loader against the GLB's own URL. Repacking the texture
into the GLB, or renaming the folder to match our own naming, both mean editing
a file whose provenance we are asserting.

**Where placement lives.** Loading a GLB leaves an `AssetContainer` in memory.
Something still has to instantiate it and move the copy somewhere. That step is
one line of Babylon.js, and it is exactly the kind of line that gets copied into
every app and then diverges.

**What the game pays for importing the asset system.** `apps/game` now depends
on `@wov/asset-system`. The package's single entry point re-exported the
manifest schema, which is built on Zod. Measured on the production build, that
put **84 kB** (23.8 kB gzipped) of Zod into the game's first chunk for code the
game never calls: 1,068 kB → 984 kB when removed.

## Decision

**Vendor third-party assets byte-identically, keeping the source layout.** The
files are copied out of the downloaded kit without modification, including the
`Textures/` folder the GLB references, into a folder named after the kit
(`assets/environment/kenney-retro-fantasy-kit/`). Each such folder carries a
`README.md` with the full provenance record; `docs/asset-licenses.md` keeps the
per-file summary row and `THIRD_PARTY_NOTICES.md` the per-kit credit.

**Placement is a function in `@wov/asset-system`, not a method on a mesh.**
`placeAssets(instantiator, placements)` instantiates each placement and moves
the roots; `summarizePlacement(result)` renders the one status line the app and
the smoke test share. Both are pure of Babylon.js at runtime.

**`@wov/asset-system` has two entry points.** The root export is the runtime
half — URLs, loading, caching, placement. The manifest schema moved behind
`@wov/asset-system/manifest`, where `pnpm validate:assets` imports it. A
dependency-cruiser rule (`game-must-not-pull-in-the-manifest-schema`, with
`reachable: true`, because the regression is transitive) fails the build if the
game can reach it again.

## Alternatives considered

| Alternative                                                     | Why not                                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repack the texture into a self-contained GLB                    | One file instead of two, but the committed bytes stop matching the source. "Modified: no" is a much cheaper claim to defend than "modified: yes, here is the script". |
| Rename `Textures/` to match our own casing                      | Requires editing the GLB's image URI — the same problem, for cosmetics.                                                                                               |
| Flatten all vendored assets into `assets/environment/`          | Loses the kit boundary, which is the unit a license actually applies to.                                                                                              |
| Put placement in `packages/engine`                              | `engine` holds no Babylon.js code yet, and placement is about assets, not about the render surface. Reconsider when `engine` grows a scene layer.                     |
| Put placement in `apps/game`                                    | The editor will place the same assets in Phase 3. Two copies of the handedness-mirror subtlety below is one copy too many.                                            |
| Leave the manifest in the single entry point and accept the Zod | 84 kB of dead code in the first chunk contradicts spec §38 in the very package whose job is loading cheaply.                                                          |
| Forbid Zod in `apps/game` outright                              | Wrong long-term: from Phase 4 the game validates world data with `@wov/world-schema`, which is Zod. The rule has to name the manifest, not the library.               |

## Consequences

**Positive** — the license question for a vendored asset is answered by
`sha256sum`. Placement is one tested function; its two non-obvious rules (scale
multiplies rather than assigns, so Babylon's handedness mirror on the glTF root
survives; root nodes are narrowed before being moved, because Babylon types
`rootNodes` as `Node[]` and a `Node` has no transform) are covered by tests
instead of living in a comment. The game bundle no longer carries Zod.

**Negative** — a vendored asset can be two files instead of one, and the second
one only fails at runtime, so the smoke test has to watch for 404s from the
asset server rather than trust "the model loaded". Folder names inside a
vendored kit follow the kit's conventions, not ours. `@wov/asset-system` now has
two entry points to keep straight.

**Follow-ups** — the barrel is placed from a constant in
`apps/game/src/environment.ts`; that is a Phase 1 fixture and must give way to
world data from `content/` in Phase 4 (agent rule 9). An asset pipeline that
optimises vendored files (Meshopt, KTX2) will produce _derived_ files: those are
modified, and need their own rows saying so and a recorded recipe.
