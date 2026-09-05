# Assets

> Status: **Phase 1** — folders, the local asset server, the loading/caching
> asset manager, scene placement and the manifest check exist. The first
> licensed asset (a CC0 barrel from Kenney's Retro Fantasy Kit) is loaded by the
> game and asserted by `pnpm smoke`.

## Where assets live

`assets/` in this repository during development, served by the local asset server
at http://localhost:9000 (`pnpm dev:assets`). In production the same paths are
served from `assets.world-of-vikings.com` (spec §37).

Code never hardcodes a host: it resolves references through
`@wov/asset-system` with `VITE_ASSET_URL`.

## Loading them

`@wov/asset-system` owns loading too. `AssetManager.loadGlb(path)` loads a GLB
into a Babylon `AssetContainer` and caches it per resolved URL, so placing the
same model a hundred times costs one request; `instantiate(path)` makes the
copies and `placeAssets(manager, placements)` moves them where they belong.
Babylon.js registers no file loader by itself, so the glTF plugin is registered
explicitly and the registration is covered by a test. See ADR-0011, ADR-0012 and
the package README.

The manifest schema sits behind its own entry point, `@wov/asset-system/manifest`
— it is the only part that needs Zod, and the game does not read the manifest.

## The manifest

`assets/manifest.json` records every file in `assets/` with its size and a
SHA-256 hash. `pnpm validate:assets` (part of `pnpm validate` and `pnpm check`)
fails when the folder and the manifest disagree, so a deleted or replaced asset
is caught in CI rather than in a player's browser. Regenerate it with
`pnpm validate:assets --write` after changing anything under `assets/`.

The hash is also what immutable, cache-forever production file names will be
built from (`immutableAssetPath`, §37). Nothing serves those names yet.

## Formats

| Kind     | Format          | Notes                                   |
| -------- | --------------- | --------------------------------------- |
| Models   | GLB             | Meshopt compression where it helps      |
| Textures | KTX2, PNG, WebP | Modest sizes; atlases where appropriate |
| Audio    | OGG             |                                         |
| UI art   | PNG / SVG       |                                         |

## Art direction (spec §23)

Modern stylized low-poly fantasy: chunky simplified geometry, large polygonal
surfaces, readable silhouettes, subtle hand-painted look. No photorealism, no
scanned materials, no micro detail.

## Performance rules (spec §38)

Instancing and thin instances, LOD, frustum culling, object pooling, async
loading, zone streaming, limited dynamic lights, selective shadows. Target:
60 FPS on a typical modern desktop.

## Contribution rules (spec §46)

Every asset must document **source, author, license, usage rights and
modification status** in `docs/asset-licenses.md`. Never commit ripped game
assets, unknown-license files or anything without redistribution rights.
AI-generated assets need their provenance documented too.

Third-party files are vendored byte-identically, keeping the source layout, in a
folder named after the kit; a `README.md` next to them holds the full provenance
record and `THIRD_PARTY_NOTICES.md` the per-kit credit (ADR-0012). "Modified: no"
should stay a claim that `sha256sum` can settle.
