# ADR-0006: GLB loading, per-URL caching and an asset manifest

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

Phase 1 needs an asset manager (spec §51). Three problems come with it.

**Loading.** Babylon.js does not register any file loader by itself.
`@babylonjs/core` can load a scene, but a `.glb` URL fails at runtime with "no
plugin found" until a plugin from `@babylonjs/loaders` is registered. Nothing at
build time warns about this, and neither does a type error.

**Caching.** A hand-crafted world places the same pine tree a hundred times. One
network request per placement is not a performance detail, it is the difference
between a playable and an unplayable zone (spec §38). Two systems asking for the
same model in the same frame must also not race into two requests.

**Knowing what should be there.** `assets/` is served from a separate host
(§37). A model deleted or replaced without anyone noticing turns into a 404 in a
player's browser, and the failure appears far away from the change that caused
it. Spec §37 also asks for immutable hashed production file names, which needs a
content hash recorded somewhere.

## Decision

**Babylon.js glTF loading lives behind a function type.** `packages/asset-system`
defines `GlbLoader = (url, scene) => Promise<AssetContainer>`. `AssetManager` is
written against that type; `createBabylonGlbLoader()` is the one Babylon.js
implementation, and it registers the glTF 2.0 plugin plus the built-in glTF
extensions explicitly. `babylon-glb-loader.test.ts` asserts the registration
actually happened, because nothing else would notice if it stopped.

**The Babylon.js import is dynamic.** Importing `@wov/asset-system` must not
drag the renderer into Node tooling or into a browser chunk that only wants
`assetUrl`. The loader module is imported on the first real load.

**The cache stores promises, keyed by resolved URL.** A second caller during an
in-flight load gets the same promise instead of a second request. A rejected
load is removed from the cache so a retry is possible; a failure that stayed
cached would turn one flaky request into a permanently missing model.

**`assets/manifest.json` describes `assets/`,** with `path`, `bytes` and a
`sha256-…` `hash` per file, plus a `manifestVersion`. It is validated by a Zod
schema in `packages/asset-system` and checked by `pnpm validate:assets`, which
is part of `pnpm validate` and therefore of `pnpm check`.

## Alternatives considered

| Alternative                                              | Why not                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Babylon's `AssetsManager` / `AssetContainer` cache alone | Neither deduplicates concurrent requests for one URL, and both tie the cache's lifetime to a scene. The manager here is also testable without a renderer, which is what rule 14 asks for.  |
| Import `@babylonjs/loaders` statically                   | Puts the whole loader set into every bundle that touches asset URLs, including Node tooling, for an asset that may never be loaded.                                                        |
| Register OBJ/STL/SPLAT loaders too                       | GLB is the project's model format (§37). A loader that is not registered cannot quietly become a second supported format.                                                                  |
| Cache containers instead of promises                     | The entry only appears after the load finishes, so concurrent callers still start their own requests — exactly the case the cache exists for.                                              |
| Put the manifest schema in `@wov/world-schema`           | The manifest is not world data: it never decides what exists in the game, only which files back it. Keeping it next to the code that resolves asset URLs keeps one concern in one package. |
| Derive the manifest at build time only                   | A committed manifest makes an accidental asset deletion visible in a pull-request diff, and gives CI something to check without a build.                                                   |
| Hash-only manifest, no `bytes`                           | Download budgets (§38) then need the files themselves to check. `bytes` makes a size regression reviewable.                                                                                |

## Consequences

**Positive** — the cache and the manifest are unit-tested without starting a
renderer; a missing or changed asset fails in CI instead of in a browser; the
recorded hash is what immutable production file names are built from later
(`immutableAssetPath`), so turning that on is a deployment change and not a
format change.

**Negative** — `packages/asset-system` now depends on Babylon.js, so it is no
longer usable from a non-renderer context beyond `assetUrl` and the manifest
schema. Contributors must regenerate the manifest (`pnpm validate:assets
--write`) when they add an asset; the failure message says so.

**Follow-ups** — serve the immutable hashed names in production; add Meshopt and
KTX2 handling and a download budget on top of `bytes`; extend the manifest with
per-asset licence data once `docs/asset-licenses.md` has rows (§46).
