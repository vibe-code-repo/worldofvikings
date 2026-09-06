# @wov/asset-system

**Purpose.** Where assets live, how they are loaded, and what should be there.
Keeps asset addressing out of the game and editor code so the same reference
works against `localhost:9000` and the production CDN (spec §37, ADR-0011).

Separable concerns, so the parts that do not need a renderer can be used
without one:

| Module                  | Does                                                  | Needs Babylon.js |
| ----------------------- | ----------------------------------------------------- | ---------------- |
| `url.ts`                | Resolves an asset path to a URL                       | no               |
| `asset-manager.ts`      | Loads, caches and instantiates GLB containers         | types only       |
| `glb-loader.ts`         | The `GlbLoader` port the manager is written against   | types only       |
| `babylon-glb-loader.ts` | Registers Babylon's glTF plugin, implements the port  | at load time     |
| `scene-placement.ts`    | Moves instantiated copies into position               | no               |
| `manifest.ts`           | Zod schema and drift check for `assets/manifest.json` | no               |

Importing this package does **not** import Babylon.js. The Babylon binding is
loaded on the first actual asset load, which keeps the renderer out of Node
tooling and out of the initial browser chunk.

## Two entry points

| Import                       | Contains                                | Used by                |
| ---------------------------- | --------------------------------------- | ---------------------- |
| `@wov/asset-system`          | URLs, loading, caching, placement       | the game, the editor   |
| `@wov/asset-system/manifest` | The manifest schema and its drift check | `pnpm validate:assets` |

The manifest half is separate because it is the only part that needs Zod, and
re-exporting it from the root entry point put 84 kB of Zod into the game's first
chunk for code the game never calls (ADR-0012). The boundary is enforced:
`game-must-not-pull-in-the-manifest-schema` in `.dependency-cruiser.cjs` fails
the build if the game can reach `manifest.ts` again, transitively included.

## Public API

**Addressing**

- `assetUrl(config, assetPath)` — absolute URL for a repository-relative path.
  Rejects empty paths and `..`.
- `resolveAssetSourceConfig(env)` — reads `VITE_ASSET_URL`; falls back to
  `DEFAULT_ASSET_BASE_URL` (`http://localhost:9000`) so a clean clone runs with
  no `.env`. Throws if the variable is set but not an absolute URL.
- Types: `AssetSourceConfig`, `AssetEnv`.

**Loading**

- `new AssetManager({ source, scene, loadContainer? })`
  - `loadGlb(assetPath)` — returns the `AssetContainer`, loading it at most once
    per URL. Concurrent callers share one request.
  - `instantiate(assetPath, { rename?, cloneMaterials?, instanced? })` —
    instantiates a copy from the cached container. `instanced: true` asks
    Babylon for `InstancedMesh` copies, which share geometry _and_ material with
    the container's meshes and are drawn together: 1216 entities from 139 models
    cost 196 draw calls instead of 553 (ADR-0022). Off by default, because a
    caller that means to recolour one copy must not get an instance.
  - `isCached(assetPath)`, `dispose()`.
- `AssetLoadError` — carries `assetPath` **and** the resolved `url`, because a
  wrong `VITE_ASSET_URL` and a missing file are told apart by the URL that was
  actually requested.
- `createBabylonGlbLoader()` — registers Babylon's glTF 2.0 plugin and the
  built-in glTF extensions, then returns a `GlbLoader`. Passing your own
  `loadContainer` is what lets the cache be tested without a renderer.
- Types: `GlbLoader`, `AssetManagerOptions`, `InstantiateOptions`.

**Placement**

- `placeAssets(instantiator, placements)` — instantiates each
  `{ asset, name, position, scale? }` and moves the resulting roots. Placements
  run concurrently, share the cache, and one failure does not cancel the others;
  the result is `{ placed, failures }`, both in input order.
  - `scale` **multiplies** the model's own scaling instead of replacing it,
    because Babylon's glTF loader mirrors the imported root on x to convert
    handedness — assigning would turn the model inside out.
  - Root nodes are narrowed before being moved: Babylon types `rootNodes` as
    `Node[]`, and a `Node` (a light, a camera) has no transform. A placement
    whose roots all lack one fails instead of silently sitting at the origin.
- `summarizePlacement(result)` — the one status line, e.g. `assets: 1 loaded` or
  `assets: 1 loaded, 1 failed (environment/missing.glb)`. It lives here so the
  game and the smoke test cannot spell it differently.
- Types: `AssetPlacement`, `PlacementResult`, `PlacementFailure`,
  `AssetInstantiator`, `InstantiatedNode`, `InstantiatedNodes`, `PlaceableNode`.

**Manifest** (from `@wov/asset-system/manifest`)

- `parseAssetManifest(data)` — validates unknown data. A version 1 document is
  migrated rather than rejected; any other unsupported `manifestVersion` gets its
  own message instead of a wall of field errors.
- `compareManifestWithFiles(listed, found)` → `{ missing, unlisted, changed }`,
  `isManifestInSync(comparison)`, `formatManifestReport(comparison)`. It compares
  two lists and knows nothing about visibility — pass it one half at a time.
- `selectByVisibility(entries, 'public' | 'private')` — the repository half and
  the store half, which are checked against different things.
- `findMissingPlaceholders(entries, repositoryPaths)` — private assets whose
  stand-in is not committed. This is the check that keeps a clone runnable with
  no access to the store (ADR-0015).
- `assetIdFromPath(path)` — the deterministic id for a path:
  `environment/SM_Env_Rock_03.glb` → `environment/sm-env-rock-03`.
- `isIndexedAssetFile(path)` — which files under `assets/` belong in the
  manifest (not the manifest itself, not Markdown, not dot files).
- `immutableAssetPath(entry)` — `environment/tree.glb` + `sha256-a1b2c3d4…` →
  `environment/tree.a1b2c3d4.glb`, for cache-forever production names (§37).
  Nothing serves these yet; the hash is recorded so enabling them later is a
  deployment change, not a format change.
- `AssetManifestSchema`, `AssetEntrySchema`, `AssetPathSchema`,
  `AssetHashSchema`, `AssetIdSchema`, `AssetKindSchema`,
  `AssetVisibilitySchema`, `AssetBoundsSchema`, `ASSET_KINDS`,
  `UNDETERMINED_LICENSE`, `CURRENT_ASSET_MANIFEST_VERSION`,
  `ASSET_MANIFEST_FILE_NAME`, `ASSET_HASH_PREFIX`.
- Types: `AssetManifest`, `AssetEntry`, `AssetKind`, `AssetVisibility`,
  `AssetBounds`, `AssetManifestParseResult`, `ManifestComparison`,
  `AssetMismatch`.

## Usage

```ts
import { AssetManager, placeAssets, resolveAssetSourceConfig } from '@wov/asset-system';

const assets = new AssetManager({
  source: resolveAssetSourceConfig({ VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL }),
  scene,
});

// One request, however many trees.
const result = await placeAssets(
  assets,
  zone.trees.map((tree, index) => ({
    asset: 'environment/pine_tree_01.glb',
    name: `pine-${index}`,
    position: tree.position,
  })),
);
```

## The manifest

`assets/manifest.json` lists every file the game may download — with its size, a
SHA-256 hash, where it came from, and whether the bytes are in this repository at
all (version 2, ADR-0015):

```json
{
  "manifestVersion": 2,
  "generatedAt": "2026-09-06T00:00:00.000Z",
  "assets": [
    {
      "id": "vegetation/pine-1b1",
      "path": "vegetation/pine-1b1.glb",
      "kind": "prefab",
      "bytes": 1245184,
      "hash": "sha256-…",
      "bounds": { "min": [-2.1, 0, -2.1], "max": [2.1, 11.4, 2.1] },
      "origin": "Origin kept as authored: ground-contact point, geometry may extend below y=0, 18432 triangles.",
      "source": "private asset collection — vegetation set",
      "author": "unconfirmed — third-party commercial pack, licence review open",
      "license": "NOASSERTION",
      "redistributable": false,
      "visibility": "private",
      "placeholder": "placeholders/vegetation/pine-1b1.glb"
    }
  ]
}
```

A `public` asset is served from `assets/` in this repository. A `private` one is
served from the asset store (`WOV_ASSET_STORE`, `/store/…` on the asset server);
the repository holds only its `placeholder`, a box with the same hull, so a clone
without store access still runs and says so.

After adding, replacing or deleting an asset:

```bash
pnpm validate:assets           # check — fails on drift, part of `pnpm check`
pnpm validate:assets --write   # regenerate from assets/
```

`--write` only rewrites when the asset list really changed, so it does not put a
fresh `generatedAt` into every pull request.

## Dependencies

| Package              | Why                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@babylonjs/core`    | `AssetContainer`, `Scene` and the scene loader registry. Already the project's engine (ADR-0002). Types are imported as types; the runtime import is dynamic.                                                                  |
| `@babylonjs/loaders` | Babylon registers no file loader by itself — a `.glb` URL fails at runtime with "no plugin found" until the glTF 2.0 plugin from this package is registered (ADR-0011).                                                        |
| `zod`                | The manifest is external data and must be validated (agent rule 10). Same choice and reasoning as `@wov/world-schema` (ADR-0004): one declaration yields schema and type. Reachable only through `@wov/asset-system/manifest`. |

## Ownership

Core maintainers. The manifest format is versioned: a change needs a
`CURRENT_ASSET_MANIFEST_VERSION` bump and a documented migration, never a silent
rewrite (agent rule 11).
