# ADR-0029: One Babylon.js module, one import specifier

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** game-client and engine owners

## Context

After the look pass the game client stopped on the village a few frames in: the
frame counter stood at four or five, `window.__wov.render` was all zeros, the
status line still said `collision: loading…`, and the only thing on screen was
the terrain tile. The console carried one error:

```text
Unable to compile effect … fragment: rgbdDecode
```

and the fragment source Babylon printed was the client's own `index.html`.

The path into it is short. A PBR material asks for the environment BRDF
look-up table; `Misc/brdfTextureTools` hands it to
`RGBDTextureTools.ExpandRGBDTexture`, which does

```js
await import('../Shaders/rgbdDecode.fragment.js');
new PostProcess('rgbdDecode', 'rgbdDecode', …);
```

The imported module registers its source in `ShaderStore.ShadersStore`, and the
post-process reads it back out of `ShaderStore`. When the two are not the same
`ShaderStore` object, the look-up misses, Babylon falls back to fetching
`rgbdDecode.fragment.fx` over XHR, the Vite dev server answers any unknown path
with `index.html`, and the effect fails to compile. Babylon's render loop is
inside that failure, so the client stops.

Two `ShaderStore` objects can exist because of how the Vite dev server serves
pre-bundled dependencies. Every module under `node_modules/.vite/deps/` is
served with its internal imports rewritten to carry the optimiser's **current**
browser hash:

```js
// /node_modules/.vite/deps/@babylonjs_core_Engines_shaderStore__js.js?v=6e801c89
import { ShaderStore } from '/node_modules/.vite/deps/chunk-B3WCDVX3.js?v=de9e7c09';
```

Two URLs that differ only in `?v=` are two ES modules to the browser, and
`ShaderStore` is a module-level singleton. So if the optimiser re-runs while a
page is live — which is what happens when a dependency is discovered late — a
module the page imports **after** that point pulls a second copy of the chunk
that defines `ShaderStore`. `rgbdDecode.fragment.js` is the one Babylon module
this client imports lazily, seconds into the session, which is why it is the one
that broke.

What made late discovery possible here is that the same Babylon module was
spelled two ways across the workspace. Vite's optimiser keys its entries by the
written specifier, not by the resolved file, so
`@babylonjs/core/Maths/math.vector` and `@babylonjs/core/Maths/math.vector.js`
become two entries. The dependency metadata in this worktree carried both forms
for three modules (`Maths/math.vector`, `Meshes/mesh`, `Meshes/transformNode`),
45 entries where 42 modules were meant. Thirteen files in `apps/` imported
Babylon submodules without the extension; every file under `packages/` already
used it. As long as the set of specifiers the scanner finds and the set the
browser asks for cannot be shown to be the same set, no reasoning about when the
optimiser re-runs is worth anything.

The look pass is what surfaced it rather than what caused it: `?flat=1` skips
the lighting rig, and the smoke suite ran everything under `?flat=1`, so no
automated run had ever asked a PBR material for its BRDF table.

## Decision

**Every deep Babylon.js import is written with its `.js` extension, and ESLint
rejects the other spelling.**

- All thirteen files were rewritten; the workspace now has one specifier per
  module.
- `@typescript-eslint/no-restricted-imports` in `eslint.config.js` matches
  `^@babylonjs/[^/]+/(?!.*(\.js$|\?)).*$`. Package roots (`@babylonjs/havok`)
  and asset queries (`…/HavokPhysics.wasm?url`) are not deep source imports and
  are left alone. The rule is the typescript-eslint variant so that
  `import type` is covered too — a type-only import still creates an optimiser
  entry, because the scanner reads the text before TypeScript is stripped.
- A smoke test opens the village **under the real lighting profile** and fails
  on `Unable to compile effect` / `FRAGMENT SHADER ERROR`, on a frame counter
  that does not pass 60, on fewer than 100 draw calls, or on collision that
  never reports ready (`tooling/smoke/village-light.spec.ts`). The `?flat=1`
  tests stay: they are the fast wiring check, and this is the one that stands in
  front of the shader compiler.

## No Vite configuration change

Both candidates were measured on this worktree rather than added on suspicion
(agent rule 12).

- **`resolve.dedupe: ['@babylonjs/core', '@babylonjs/loaders']`** — not needed.
  `apps/game`, `apps/editor`, `packages/engine`, `packages/asset-system` and
  `packages/physics` all resolve `@babylonjs/core` to the same physical
  directory under `node_modules/.pnpm/@babylonjs+core@8.56.2/`. There is one
  copy on disk; `dedupe` would have nothing to collapse. It becomes worth adding
  the day a second `@babylonjs/core` version enters the lockfile.
- **`optimizeDeps.include`** — not needed. With the specifiers made uniform, a
  cold start (`rm -rf apps/game/node_modules/.vite`) pre-bundles 42 entries with
  no duplicate forms, and a full village load afterwards adds none: the browser
  hash on every `chunk-*` request in the page is the same value, and the server
  logs no re-optimisation. Listing the entries by hand would freeze that set
  into a config file that goes stale the next time an import moves, for no
  measured gain.

If a dependency ever is discovered late anyway, the symptom is the one this ADR
is about, and the smoke test above is what reports it.

## Alternatives considered

- **Import `@babylonjs/core` as a whole instead of by submodule.** It removes
  the ambiguity by removing the choice, and it removes tree-shaking with it: the
  full engine is roughly 4 MB. The client imports submodules on purpose
  (ADR-0002, ADR-0006).
- **Register `rgbdDecodePixelShader` into `ShaderStore` ourselves at start-up.**
  It would have cleared this one error and left the mechanism in place; the next
  lazily imported Babylon module would fail the same way, and nothing would say
  why.
- **Pin the dev server's dependency cache, or disable `optimizeDeps`.** Turning
  the optimiser off costs a browser several thousand module requests per load,
  and it treats the dev server as the problem when the problem is that one
  module had two names.
- **A dependency-cruiser rule instead of an ESLint rule.** Boundaries are what
  `lint:boundaries` is for; this is a rule about how a specifier is spelled, and
  it belongs where the other spelling rules live.
