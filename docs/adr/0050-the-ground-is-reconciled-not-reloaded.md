# ADR-0050: The ground is reconciled, not reloaded

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `perf/editor-terrain`

## Context

The editor draws a zone's ground from `zone.terrain` and follows the document
(ADR-0018): every gesture becomes a command, the command produces a new
document, and the viewport reconciles against it. The Zone tab's `Surface` half
turns a layer's metalness, smoothness and bump strength through
`updateTerrainSurface`, the same command `pnpm terrain-surface` dispatches
(ADR-0032, ADR-0033).

`apps/editor/src/scene/zone-terrain.ts` decided whether the drawn ground was
still current with one key:

```ts
`${name}|${JSON.stringify(terrain)}`;
```

One string for the whole block, so _any_ difference at all meant: dispose the
tile, re-instantiate the height field, generate and compile a shader program,
create fourteen `Texture` objects and rebind the shadow map. Every keystroke in
a metalness box did that, and so did every step of any slider that might have
been put there.

Measured with `pnpm perf:editor --scenario dial` on `village1` (the `dial`
scenario writes ten alternating values into `ground-metallic-0` with the native
value setter and a bubbling `input` event, and times each one to the next
rendered frame), the two runs taken before any of this reported medians of
1464 ms and 763 ms per keystroke against idle frames of 307 ms and 253 ms —
three to five ordinary frames of work for a number that ends up in a `vec3`. The
author's word for it was _unusable_.

Two further facts came out of those runs and shaped the decision:

- the terrain program key did **not** change across the ten metalness changes
  (`wovTerrain6x2s4f2048n111111` before and after), and `scene.textures` stayed
  at 16 with the tile's own list at 14 — so the rebuild was not leaking and not
  even compiling anything new. It was pure waste;
- the same rebuild path is the only one there is, so the gestures that genuinely
  _do_ need a new program — ticking `flatNormals`, swapping a layer texture —
  paid for re-instantiating a 3.5 MB height field they had not changed.

The game (`apps/game/src/world-scene.ts`) calls the same `createTerrain` and
never has this problem: it builds one tile and never edits it.

## Decision

**A terrain block is three things, and the editor tells them apart.**
`apps/editor/src/scene/terrain-keys.ts` reduces a block to three keys, coarsest
first, and `terrainChange` answers with the cheapest thing that brings the
picture up to date:

| answer     | what changed                                                                               | what it costs    |
| ---------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `none`     | nothing — the same ground stated again, which is every gizmo drag                          | a string compare |
| `uniform`  | `tileSize`, `normalScale`, `metallic`, `smoothness`                                        | a uniform write  |
| `material` | a layer texture, a normal-map path, a splat map, `flatNormals`, `position`, `size`, colour | a new material   |
| `reload`   | `heightField` — or the zone itself                                                         | a model to fetch |

`heightSamples` is in none of them: it is the regular-grid copy `pnpm scatter`
samples, and no renderer reads it.

The split is where it is — its own module, free of Babylon and of React — because
it is the part that can be wrong without anything noticing. A field in the wrong
bucket is either a dial that rebuilds the world or, far worse, a texture swap
that silently does nothing, and the two are one string apart.
`terrain-keys.test.ts` names every field and the answer it must produce.

**`TerrainHandle` grows the two cheaper operations** (`packages/engine/src/terrain.ts`):

- `update(surface)` writes `uLayerScale{i}`, `uLayerSurface{i}` and `uBaseColor`
  into the program the tile already carries. No mesh, no texture, no compile. It
  goes through `applyTerrainUniforms`, which is also what `createTerrainMaterial`
  uses, so a tile _built_ at metalness 0.4 and a tile _turned_ to 0.4 cannot
  drift apart. An update whose layer count disagrees with the tile's throws
  rather than applying part of itself.
- `rebuildMaterial(options)` builds a new material over the height field that is
  already loaded, then disposes the old one. The order is the point: while the
  old textures are still alive, Babylon answers a `new Texture(url)` for an
  unchanged URL out of its own cache, so only the images that really changed are
  fetched and decoded again — and the height field, the expensive part, is never
  re-instantiated for a change that did not touch it.

`createTerrain`'s existing behaviour and signature are unchanged, which is what
keeps the game working: `apps/game/src/world-scene.ts` calls neither of the two
new methods.

**The Surface dials are sliders.** Each of `metallic`, `smoothness` and
`normalScale` is now a range slider beside the number box that was already
there, the same pair `SchemaFields` draws for any bounded number. The slider
dispatches with a `coalesceKey`, so a whole drag is one history entry rather
than fifty (`terrainDrag`/`lightingDrag` already did this). Both halves go
through `updateTerrainSurface`: parity with `pnpm terrain-surface` (ADR-0032) is
not weakened, and the box keeps the plain `ground-<field>-<index>` test id the
smoke suite fills and the rig types into.

## Consequences

Measured back to back on this machine, `t-before-2` immediately followed by
`t-after-1`, with

```bash
WOV_ASSET_STORE=/home/mike/wov-assets/store \
PERF_EDITOR_PORT=5332 PERF_API_PORT=3331 PERF_ASSET_PORT=9331 \
pnpm perf:editor --label <label> --scenario dial,rebuild
```

(built bundles, headless Chromium/ANGLE-Vulkan, 1280x720, the store mounted):

| metric                                         | before       | after        |
| ---------------------------------------------- | ------------ | ------------ |
| dial: input → next frame, median               | 763 ms       | **409 ms**   |
| dial: mean / worst                             | 769 / 882 ms | 421 / 484 ms |
| dial: idle frame, median                       | 253 ms       | 374 ms       |
| dial: latency in idle frames                   | 3.0          | **1.1**      |
| dial: main thread blocked over the ten changes | 7 188 ms     | 4 528 ms     |
| dial: terrain program changed                  | no           | no           |
| dial: tile textures before → after             | 14 → 14      | 14 → 14      |
| rebuild: click → new tile on screen, median    | 877 ms       | **140 ms**   |
| rebuild: mean / worst                          | 868 / 941 ms | 144 / 198 ms |
| rebuild: tile meshes before → after            | 1 → 1        | 1 → 1        |
| rebuild: scene textures before → after         | 16 → 16      | 16 → 16      |
| settled scene.render (context, not a target)   | 186 ms       | 416 ms       |

Two things have to be said about those columns or they will be misread.

**The `after` run was on a busier machine.** Its settled frame cost 416 ms
against the `before` run's 186 ms and its idle frame was 374 ms against 253 ms —
this box was carrying two other builds. Both gestures got faster anyway, and the
honest figure is the ratio to that run's own idle frame: a metalness keystroke
went from three ordinary frames to one. The blocked-thread totals are the
numbers that do **not** survive the difference in frame rate and should not be
compared column to column; the `rebuild` window in particular reports 3 710 ms
before and 14 516 ms after, on a page whose frames were five times as long, and
what it is measuring after the click is the shader compile plus the shell
re-render that both versions pay.

**Turning a dial is not free yet, and what is left is not the ground.** A
uniform write is microseconds; the ~400 ms is the document reaching the viewport
at all — `sync.apply` plus the `loadedTextures()` walk in
`EditorViewport.report`, which runs on every document change and is measured at
65 % of the load. That is the load builder's ground, not this one's.

### The picture

A dial that writes a uniform nobody reads is the failure this repository has
been bitten by before (a define set is not a shader recompiled;
`blockMaterialDirtyMechanism` can swallow `markAllDefinesAsDirty`), so the
uniform path was checked against pixels rather than against its own bookkeeping.
Framed on a building — the ground filling the canvas, not 300 px of it at 846 m
— and every layer's metalness taken to 1 through the panel:

- **in place:** mean |Δ| 10.5484/255, max 142, 34.47 % of the canvas changed.
  The uniform reaches the screen.
- **the same values via a full material rebuild** (the facet switch on and off
  again, which throws the material and the program away and builds new ones):
  mean |Δ| **0.0000**/255, max 0. The in-place update and the rebuild draw the
  same ground, pixel for pixel.

At the rig's own `F`-framed camera the same change is invisible — 846 m of haze
over a tile 300 px wide — by **both** paths, in-place and rebuilt, at exactly
0.0000. So `perf:compare` on the rig's `dial` frames proves nothing either way
about the ground, and the close-up above is what the claim rests on. (The 1.11
mean |Δ| the `before` run shows between its `load` and `dial` frames is the tile
caught mid-rebuild, which is a thing the after version no longer has.)

### The game

`apps/game/src/world-scene.ts` calls `createTerrain` and neither of the new
methods, and `pnpm perf:frame --view square` before and after says so: 549 draw
calls, 974 active meshes, 4 093 763 triangles and 2 423 shadow casters in both,
and a canvas that differs by mean |Δ| 0.0002/255 over 0.00 % of 921 600 pixels —
under the rig's own 2/255 threshold, and the residue of a scene that animates
(the frame times, 21.8 ms and 31.1 ms, are this machine's load, not the change:
the counters are identical).

### Rejected, with the number

- **Making `position` and `size` uniforms too.** Both are reachable without a
  rebuild (`root.position.set`, and `uLayerScale` recomputed from the new size),
  so the split could have been two buckets deeper. Dropped: neither has a
  slider, neither is a gesture anybody repeats, and `material` already keeps the
  loaded height field — so the saving would be one shader compile on a gesture
  that happens once a session, against two more states in a reconciler whose
  whole value is that it is small enough to hold still in a test.
- **Reusing textures through a URL cache of the zone terrain's own.** Measured
  as unnecessary: building the new material before disposing the old one already
  gets it out of Babylon's internal texture cache, and the rebuild's tile
  texture count stays at 14 → 14 with `scene.textures` at 16 → 16 across four
  rebuilds. A second cache would have been a second thing to invalidate.

### What this does not fix

The editor still draws the village at 18 343 draw calls, 14 440 shadow casters
and 2–5 fps. Every ground gesture is still floored by that frame rate, and the
`dial` figure above is a latency measured against it. This ADR moved the ratio,
not the floor.
