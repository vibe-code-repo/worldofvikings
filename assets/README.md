# assets/

Binary game assets: models, textures, animations, audio, UI art. Served locally
by the development asset server on http://localhost:9000 (`pnpm dev:assets`) and
in production from `assets.world-of-vikings.com` (spec §37).

The folders are still empty — no assets have been contributed yet.

## manifest.json

`manifest.json` lists every file in this folder with its size and SHA-256 hash.
It is what `pnpm validate:assets` checks, so an asset added, replaced or deleted
without updating it fails CI instead of turning into a 404 in a player's browser
(ADR-0006). Regenerate it whenever you touch this folder:

```bash
pnpm validate:assets --write
```

The manifest itself, Markdown files and dot files (`.gitkeep`, `.DS_Store`) are
not listed — they are not downloaded by the game.

**Every contributed asset must document** source, author, license, usage rights
and whether it was modified — see `docs/asset-licenses.md` and spec §46. Assets
without redistribution rights, ripped game assets and unknown-license files are
never merged.

Formats: GLB for models, KTX2/PNG/WebP for textures, OGG for audio. Keep texture
sizes modest — browser performance is a requirement, not an afterthought (§38).
