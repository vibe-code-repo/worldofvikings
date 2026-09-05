# assets/

Binary game assets: models, textures, animations, audio, UI art. Served locally
by the development asset server on http://localhost:9000 (`pnpm dev:assets`) and
in production from `assets.world-of-vikings.com` (spec §37).

The folders are empty in Phase 0.

**Every contributed asset must document** source, author, license, usage rights
and whether it was modified — see `docs/asset-licenses.md` and spec §46. Assets
without redistribution rights, ripped game assets and unknown-license files are
never merged.

Formats: GLB for models, KTX2/PNG/WebP for textures, OGG for audio. Keep texture
sizes modest — browser performance is a requirement, not an afterthought (§38).
