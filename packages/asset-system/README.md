# @wov/asset-system

**Purpose.** Where assets live, how they are loaded, and what should be there.
Keeps asset addressing out of the game and editor code so the same reference
works against `localhost:9000` and the production CDN (spec §37, ADR-0006).

Three separable concerns, so the parts that do not need a renderer can be used
without one:

| Module                  | Does                                                  | Needs Babylon.js |
| ----------------------- | ----------------------------------------------------- | ---------------- |
| `url.ts`                | Resolves an asset path to a URL                       | no               |
| `manifest.ts`           | Zod schema and drift check for `assets/manifest.json` | no               |
| `asset-manager.ts`      | Loads, caches and instantiates GLB containers         | types only       |
| `glb-loader.ts`         | The `GlbLoader` port the manager is written against   | types only       |
| `babylon-glb-loader.ts` | Registers Babylon's glTF plugin, implements the port  | at load time     |

Importing this package does **not** import Babylon.js. The Babylon binding is
loaded on the first actual asset load, which keeps the renderer out of Node
tooling and out of the initial browser chunk.

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
  - `instantiate(assetPath, { rename?, cloneMaterials? })` — instantiates a copy
    from the cached container.
  - `isCached(assetPath)`, `dispose()`.
- `AssetLoadError` — carries `assetPath` **and** the resolved `url`, because a
  wrong `VITE_ASSET_URL` and a missing file are told apart by the URL that was
  actually requested.
- `createBabylonGlbLoader()` — registers Babylon's glTF 2.0 plugin and the
  built-in glTF extensions, then returns a `GlbLoader`. Passing your own
  `loadContainer` is what lets the cache be tested without a renderer.
- Types: `GlbLoader`, `AssetManagerOptions`, `InstantiateOptions`.

**Manifest**

- `parseAssetManifest(data)` — validates unknown data; an unsupported
  `manifestVersion` gets its own message instead of a wall of field errors.
- `compareManifestWithFiles(listed, found)` → `{ missing, unlisted, changed }`,
  `isManifestInSync(comparison)`, `formatManifestReport(comparison)`.
- `isIndexedAssetFile(path)` — which files under `assets/` belong in the
  manifest (not the manifest itself, not Markdown, not dot files).
- `immutableAssetPath(entry)` — `environment/tree.glb` + `sha256-a1b2c3d4…` →
  `environment/tree.a1b2c3d4.glb`, for cache-forever production names (§37).
  Nothing serves these yet; the hash is recorded so enabling them later is a
  deployment change, not a format change.
- `AssetManifestSchema`, `AssetEntrySchema`, `AssetPathSchema`,
  `AssetHashSchema`, `CURRENT_ASSET_MANIFEST_VERSION`,
  `ASSET_MANIFEST_FILE_NAME`, `ASSET_HASH_PREFIX`.
- Types: `AssetManifest`, `AssetEntry`, `AssetManifestParseResult`,
  `ManifestComparison`, `AssetMismatch`.

## Usage

```ts
import { AssetManager, resolveAssetSourceConfig } from '@wov/asset-system';

const assets = new AssetManager({
  source: resolveAssetSourceConfig(import.meta.env),
  scene,
});

// One request, however many trees.
for (const placement of zone.trees) {
  const { rootNodes } = await assets.instantiate('environment/pine_tree_01.glb');
  rootNodes[0]?.position.copyFrom(placement);
}
```

## The manifest

`assets/manifest.json` lists every file the game may download, with its size and
a SHA-256 hash:

```json
{
  "manifestVersion": 1,
  "generatedAt": "2026-09-05T21:26:49.403Z",
  "assets": [{ "path": "environment/pine_tree_01.glb", "bytes": 20480, "hash": "sha256-…" }]
}
```

After adding, replacing or deleting an asset:

```bash
pnpm validate:assets           # check — fails on drift, part of `pnpm check`
pnpm validate:assets --write   # regenerate from assets/
```

`--write` only rewrites when the asset list really changed, so it does not put a
fresh `generatedAt` into every pull request.

## Dependencies

| Package              | Why                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@babylonjs/core`    | `AssetContainer`, `Scene` and the scene loader registry. Already the project's engine (ADR-0002). Types are imported as types; the runtime import is dynamic.             |
| `@babylonjs/loaders` | Babylon registers no file loader by itself — a `.glb` URL fails at runtime with "no plugin found" until the glTF 2.0 plugin from this package is registered (ADR-0006).   |
| `zod`                | The manifest is external data and must be validated (agent rule 10). Same choice and reasoning as `@wov/world-schema` (ADR-0004): one declaration yields schema and type. |

## Ownership

Core maintainers. The manifest format is versioned: a change needs a
`CURRENT_ASSET_MANIFEST_VERSION` bump and a documented migration, never a silent
rewrite (agent rule 11).
