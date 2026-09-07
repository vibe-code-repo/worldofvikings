# ADR-0049: The editor draws a zone the way the game does

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `perf/editor-scene`

## Context

ADR-0047 built the editor a measuring rig and pointed it at the village. What it
found, with the built bundles in headless Chromium on ANGLE over Vulkan at
1280×720, the whole zone framed with `F` and the camera standing still:

|                             | editor   | the game, same zone |
| --------------------------- | -------- | ------------------- |
| `scene.render`, window mean | 314.6 ms | ~12 ms (ADR-0035)   |
| frames per second           | 2.95     | 61                  |
| draw calls                  | 18 343   | 210 (ADR-0025)      |
| active meshes               | 14 445   | 974                 |
| shadow casters              | 14 440   | 2 423               |

Twenty-six times the frame cost, eighty-seven times the draw calls and six times
the shadow casters, for the same 5 273 entities out of the same world file. None
of that was the editor doing something an editor has to do. Three separate
decisions had each been made once, in passing, and never measured:

1. **Every entity cloned its model.** `assets.instantiate(prefab.asset, { rename })`
   defaults to clones, so ninety copies of one fence were ninety geometries,
   ninety materials' worth of binding and ninety draw calls. The game has asked
   for `{ instanced: true }` since ADR-0025; the editor never did.
2. **Every mesh went into the sun's shadow map**, the 3 473 tufts of scattered
   grass included. The game has had a rule about that since ADR-0027 —
   `castsShadows(prefab)` — and it lived in `apps/game/src/world-scene.ts`,
   where the boundary rules make it unreachable from the editor. So the editor
   had no rule at all.
3. **Nothing was frozen.** ADR-0035 froze the game's placed world and said in as
   many words why the editor does not: "a frozen node in the editor is a prop
   whose gizmo works, whose document updates and whose picture never changes —
   the worst kind of bug, because everything except the screen agrees." That is
   a correct statement about freezing a _whole zone permanently_. It was taken
   as a decision never to freeze anything, and never measured.

The CPU profile of the settled frame agreed with all three, at 200 µs over three
seconds: `(program)` — the driver behind 18 343 draw calls — 39.4 % self,
`_isSynchronized` and `isSynchronized` together 10 % self inside
`_evaluateActiveMeshes` at 14 % inclusive, and the shadow pass 16.9 % inclusive
for 14 440 casters.

## Decision

**The editor places a zone the way the game places it, and unfreezes exactly
what is about to move.**

### One rule about shadows, in one place

`castsShadows` and `SHADOW_CASTER_MINIMUM_HEIGHT` move from
`apps/game/src/world-scene.ts` to `@wov/world-schema`, next to `isBackdrop` and
for the reason that one is there: the game and the editor must not be able to
drift about it. It takes only the two fields it reads — category and bounds — so
a catalogue row, a manifest row or a literal can all ask. Its own tests move with
it; what stays in the game is the pairing test, that a non-caster is always a
thin instance, because that is a statement about how the game draws.

The editor applies it as the game does: a prefab that does not cast goes to
`excludeFromCasting` and still receives, a backdrop goes to `excludeFromShadows`
and is out of the map in both directions (ADR-0031). Editor parity is the point,
not the saving: an author laying out a field of grass under an editor that
shadows every tuft is being shown a dark mat the game will never draw.

The exclusions are remembered by the **viewport**, not by the light rig.
`ViewportHandle.relight` throws the whole rig away and builds another whenever
the open world's lighting profile changes, and everything the editor had told
the old one goes with it. So `viewport.excludeFromShadows` and
`viewport.excludeFromCasting` record what they were given, drop whatever has been
disposed since, and say it again to every rig. That also fixes something nobody
had noticed: the ground was excluded through `viewport.lighting()` directly, so
after any lighting change the height field started drawing itself into its own
shadow map.

### Instances, not clones

`{ instanced: true }`. Babylon falls back to a clone for anything it cannot
instance — transform nodes, skinned meshes, meshes with no vertices — so this is
a request rather than an assertion, and every copy is still a scene node with its
own world matrix that can be picked, selected, framed and dragged. That is the
difference from the thin instances the game scatters vegetation with (ADR-0025),
which are not nodes and could not be selected; thin instances are not available
to an editor for exactly that reason.

Two things had to be said twice for this to be correct:

- **`applyFog` on a backdrop** is an input to the material's defines, and an
  instance shares its source's material. Written on the instance alone it is
  accepted, changes nothing, and the mountains come out fog-grey. It is now
  written on the source mesh as well — the same trap `receiveShadows` has,
  documented in the same words in `@wov/engine`'s lighting rig and in the game's
  `markAsBackdrop`.
- **`Mesh.createInstance` needs a side-effect import.** Without
  `@babylonjs/core/Meshes/instancedMesh.js` it throws. Both apps depended on it
  and both got it by accident, from whichever unrelated Babylon module happened
  to pull it into the bundle first; a unit test against a scene with nothing else
  in it finds that out and a bundle does not. It is now on the list
  `@wov/engine`'s bootstrap guarantees, with a case that calls the feature.

The 5 273 stand-in cubes are instances too: one hidden, unpickable source box
with an instance per entity, instead of 5 273 geometries built and thrown away
again during the load — which is the moment the editor can least afford them.

### A narrow freeze

An entity is frozen (`freezeStaticNodes` on its subtree) **once its model has
landed**, and thawed (`unfreezeStaticNodes`) for exactly as long as one of two
things is true:

- **it is selected.** The selection is precisely the set a gizmo can be attached
  to, and a gizmo writes straight onto the node without telling the reconciler
  until the drag ends — so it is the one place where "about to move" cannot be
  noticed after the fact. The hold is derived from `document.selection` inside
  `apply`, not passed in from React: a selection change replaces the document
  (ADR-0018), so the reconciler already sees every one of them, and a rule
  spread over two modules is a rule that can be forgotten in one.
- **the document is writing to it.** `writeTransform` thaws, writes and freezes
  again at the new place. That order is not optional: `computeWorldMatrix(force)`
  returns early on a frozen node, so a subtree that is "re-frozen" without being
  thawed first keeps the matrix it had.

A zone switch needs no special case, because it disposes every instance first.
A duplicate or a paste needs none either: the new entity is created unfrozen and
frozen when its model arrives, and if it was selected in the same document — which
is what a paste does — the hold keeps it thawed.

The unit test (`scene-sync.freeze.test.ts`, `NullEngine`) does not ask whether a
flag is set. It asks where the geometry is: `absolutePosition` of the mesh under
the entity root after each gesture. Removing the thaw from `writeTransform` makes
it report `[1, 1, 2]` where the document says `[7, 4, -4]`.

## Consequences

Same rig, same machine, same view — the camera and orbit target came out
identical to the last digit in every run, `[160.0, 846.5, −1543.6]` looking at
`[160.0, −137.0, 160.0]`:

```bash
WOV_ASSET_STORE=/home/mike/wov-assets/store \
PERF_EDITOR_PORT=5322 PERF_API_PORT=3321 PERF_ASSET_PORT=9321 \
pnpm perf:editor --label before-1        # then --label after-1
```

| settled frame               | before-1  | after-1     | after-2   |
| --------------------------- | --------- | ----------- | --------- |
| `scene.render`, window mean | 314.6 ms  | **69.9 ms** | 110.9 ms  |
| frames per second           | 2.95      | **11.40**   | 7.05      |
| draw calls                  | 18 343    | **696**     | 696       |
| active meshes               | 14 445    | 14 445      | 14 445    |
| triangles                   | 4 463 553 | 4 419 585   | 4 419 585 |
| shadow casters              | 14 440    | **7 469**   | 7 469     |
| scene textures              | 16        | 16          | 16        |

| gesture                            | before-1  | after-1       | after-2   |
| ---------------------------------- | --------- | ------------- | --------- |
| idle frame before the dial, median | 492 ms    | **127 ms**    | 124 ms    |
| ground dial → next frame, median   | 1 448 ms  | **224 ms**    | 246 ms    |
| blocked during the ten changes     | 38 562 ms | **10 350 ms** | 22 276 ms |
| idle frame before the edit, median | 536 ms    | **73 ms**     | 173 ms    |
| nudge → next frame, median         | 1 464 ms  | **169 ms**    | 216 ms    |
| canvas click, pointerup            | 138 ms    | **60 ms**     | 71 ms     |
| blocked during that click          | 2 481 ms  | **246 ms**    | 281 ms    |

The load is not this decision's subject and improved anyway, because there is
less to build and less for the load path's own O(N²) bookkeeping to walk:
107 539 ms → 53 526 ms (after-1) and 84 333 ms (after-2) to every model on
screen, with the main thread blocked 104 943 ms → 50 820 ms / 81 623 ms. Those
three numbers are the ones ADR-0047 warns move with whatever else the machine is
compiling, so read them as "roughly half", not as a ratio.

**The picture changes, on purpose, in one way.** Mean |Δ| 1.2390/255, max 47/255,
14.68 % of 290 048 pixels, measured by reading the canvas back (`pnpm perf:compare`
on the two `.rgba` files). That is the grass no longer shadowing itself and the
backdrop no longer in the map — the game's picture, which is what an editor is
for. Everything else is identical: after-1 against after-2 is mean |Δ| 0.0000/255
across all 290 048 pixels.

The settled profile after the change says what is left. `_isSynchronized` and
`isSynchronized` are gone from the top twenty entirely — that is the freeze.
`(program)` is down from 39.4 % to 33.4 % self — that is the draw calls. What is
now first is `_evaluateActiveMeshes` at 36.3 % inclusive and 15.8 % self, which is
the walk over 14 445 meshes and not anything inside it, exactly where ADR-0035
left the game.

What this costs:

- **A future mover has to be held.** Anything that moves an entity's node without
  going through `writeTransform` and without that entity being selected would
  move in the document and not on screen. Today the gizmos are the only such
  path and they follow the selection. Anything new — an animation preview, a
  physics drop, a nudge on a whole multi-selection that is not the selection —
  must join the hold, and this ADR is where to say so.
- **A selected entity costs what the whole editor used to cost, for one entity.**
  That is the trade and it is the right way round.
- **A backdrop's `applyFog` and `isPickable` now reach the shared source mesh.**
  Two prefabs naming one GLB where only one of them is a backdrop would fight
  over it. No catalogue does today; a catalogue that did would be a data problem
  the importer should refuse, not a renderer problem.

### What was measured and rejected

- **`freezeMaterialsWhenReady` for the editor.** Not taken, and the number is
  why: the phase it removes is `Material.isReady`, which in the settled profile
  after the change is 1.7 % inclusive (63 ms of 3 714 ms) — about 1.2 ms of a
  70 ms frame, a ceiling of under 2 %. Against that stands a real correctness
  surface: the editor relights whenever a lighting profile changes and rebuilds
  the ground tile on every dial, and `scene.executeWhenReady` would in any case
  fire long before a 50-second load has finished, so it would freeze the grid
  and the sky and almost nothing else. It is the right answer for a placed game
  world and the wrong one here.
- **Thin instances for the editor's vegetation.** They are what makes the game's
  3 473 tufts one draw call, and they are not nodes: an entity drawn as a thin
  instance cannot be picked, cannot carry a gizmo and cannot be framed. The
  editor's whole purpose forbids it. GPU instances give the same geometry sharing
  with a node per copy, and the 18 343 → 696 draw calls above is what that is
  worth without giving anything up.
- **Pinning the instance buffers** (`manualUpdateOfWorldMatrixInstancedBuffer`).
  `_updateInstancedBuffers` is 9.6 % inclusive of the settled frame, so it looks
  like the next thing to take. ADR-0035 measured it on the game, found 1.0 ms and
  found it moved geometry, because Babylon packs the buffer from the copies that
  are visible _this frame_ and a pinned buffer is only correct while the visible
  set does not change. An editor camera moves at least as much as a player.

### Still open

- **`_evaluateActiveMeshes`, 36.3 % inclusive.** It is the walk over 14 445
  meshes, and cutting it means fewer meshes — merging the static props of a
  neighbourhood, or a distance LOD. In the editor that is harder than in the
  game, because every entity has to stay individually selectable. Same conclusion
  as ADR-0035's, one layer further along.
- **Post-processing.** `DefaultRenderingPipeline` and SSAO2 do not appear in the
  settled profile's top twenty at all, so their CPU share is below ~0.9 % self;
  what a CPU profile cannot see is what they cost the GPU, and the rig has no
  GPU-side number. They stay on, because the editor shows the game's picture
  (ADR-0024, ADR-0033). A **View** menu toggle for measuring rather than for
  taste would be the way to answer it, and it is not built here.
- **Picking.** `scene.pick` walks every mesh in the scene; the click is 138 ms →
  60 ms purely because there is less to walk and the bounds are pinned. A
  selection octree for picking only was not measured — ADR-0035 rejected one for
  _rendering_, which is a different question — and would be the next thing to try
  if the click is still the complaint.
