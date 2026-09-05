# @wov/asset-system

**Purpose.** Resolves asset references to URLs and, from Phase 1 on, loads and
caches GLB assets. Keeps asset addressing out of the game and editor code so the
same reference works against `localhost:9000` and the production CDN (spec §37).

**Public API.** `assetUrl(config, assetPath)`, type `AssetSourceConfig`.

**Dependencies.** None yet. Babylon.js loaders will be added in Phase 1.

**Ownership.** Core maintainers.
