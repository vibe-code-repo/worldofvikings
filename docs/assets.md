# Assets

> Status: **Phase 0** — folders and the local asset server exist; no assets yet.

## Where assets live

`assets/` in this repository during development, served by the local asset server
at http://localhost:9000 (`pnpm dev:assets`). In production the same paths are
served from `assets.world-of-vikings.com` (spec §37).

Code never hardcodes a host: it resolves references through
`@wov/asset-system` with `VITE_ASSET_URL`.

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
