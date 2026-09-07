# ADR-0051: What the editor owed a picture nobody was checking

- **Status:** accepted
- **Date:** 2026-09-08
- **Deciders:** `feat/editor-performance`

## Context

ADR-0048, ADR-0049 and ADR-0050 made the editor draw the village the way the
game draws it: report once a frame, list only the hierarchy rows the panel
shows, instantiate instead of clone, freeze what is not moving, keep grass out
of the shadow map, and reconcile the ground instead of reloading it. Measured
together, that took the load from 86-103 s to 8-9 s and the settled frame from
322 ms to 67-81 ms.

Then three reviews went looking for what those changes had made _wrong_ rather
than slow, with one instruction: break it. They did, in four places, and none of
the four would have failed a single assertion in this repository:

1. Pressing `W`/`E`/`R` during a gizmo drag detached the handle Babylon was
   dragging. Babylon then never fired its drag end, so the viewport stayed "a
   drag is in progress" for the rest of the session and refused every click,
   the gesture never became a command, and the prop stayed drawn a metre from
   where the document had it — with `dirty` false and nothing to undo.
2. Pressing `Escape` during a drag cleared the selection, and the drag end read
   the selection _then_, found no primary, computed no changes and left the
   node where the mouse had put it. ADR-0049's freeze then pinned that wrong
   world matrix, and `frozenCount` — the freeze's own witness — counted it as
   correctly pinned.
3. One click in the Lighting tab and the whole zone stayed lit by a sun that had
   been disposed. Nothing in the panel moved a pixel again for the rest of the
   session, and nothing was logged, because from Babylon's point of view nothing
   was wrong.
4. Switching zone and coming back kept every entity of the zone just left. Two
   round trips on the village added 241 MB, about 25 KB per entity, while every
   counter on the debug bridge stayed byte-identical across all five readings.

The reviews also took the rig apart, and the most uncomfortable finding was not
about the editor at all: its picture evidence was taken at the camera every
_timing_ is taken at — `F` with nothing selected, 1 967 m up, about 4 m to the
pixel, with the village covering 3.5 % of the canvas and a 6 m building a pixel
and a half wide. "mean |Δ| 0.0000 over 290 048 pixels changed", the sentence the
integration leaned on, was a statement about the backdrop shell. Every prop in
the village could have moved and the files would still have compared equal.

## Decision

### The document is the truth, even mid-gesture

Which handles are attached while a drag is live is decided by
`apps/editor/src/scene/gizmo-drag.ts`, a framework-free state machine: a request
made during a drag is remembered and applied at the drag end, so the gesture
always finishes and always commits. The viewport captures the selection and the
primary at drag _start_ rather than reading them at drag end, drops entities the
document lost in the meantime, and — when nothing can be committed at all —
calls the new `SceneSync.restore`, which writes the document's own transform
back onto the node. The reconciler is a diff and cannot see a node moved behind
its back; this is the way back.

### A light rig reaches the meshes the scene cannot see

Babylon keeps "which lights reach this mesh" up to date by walking
`scene.meshes`, in both directions: `Scene.addLight` adds the new light to every
mesh in the scene, `Light.dispose` removes the dead one from every mesh in the
scene. A loaded model is drawn from a `sourceMesh` that lives in its asset
container, so it is in neither walk — and `InstancedMesh` forwards
`lightSources` straight to that source while answering `_removeLightSource` with
nothing at all. `applyLighting` now re-syncs any mesh whose material owner is out
of step with the scene's lights, when the rig is built and when a mesh arrives
later, and `meshesWithStaleLights` publishes the same question as a number that
`pnpm smoke` asserts is zero.

### An exclusion set lets go of what the scene disposed

Both the light rig and the viewport remember which meshes they have taken out of
the shadow map, so that a relight can say it again. Both now drop a mesh the
moment Babylon announces its removal — exact, and cheaper than the amortised
sweep it replaces.

### The ground rebuilds when the shadow map changes shape

How a tile reads the shadow map is compiled into its program (ADR-0020): the
map's size, whether depth is a float, whether it can be read at all. Everything
else about a light can change under a tile and be picked up on the next bind.
`TerrainHandle.shadowsMatchScene` answers whether the compiled program still
fits, `zone-terrain.ts` treats a mismatch as a material change, and `bindShadows`
refuses a map whose shape is not the one it was compiled for — so the window
between a relight and the rebuild is an unshadowed ground rather than a wrong
one.

A PCF or PCSS generator is now not a sampleable one at all. Those two render
depth into a depth-stencil texture and hand it to a shader as a comparison
sampler; the ground's program is hand-written GLSL reading an ordinary
`sampler2D`, and the colour attachment it was binding instead is never written
under PCF. A comparison-sampler variant of the terrain program is the right
long-term answer and is a change of its own.

### One drag is one undo step, and two drags are two

The key the history folds on names the gesture — `<control>#<n>`, counted in
`gesture-key.ts` — instead of naming the control. A gesture begins on
`pointerdown` or on a key press that is not an auto-repeat; deliberately not on
`focus`, because a mouse press on a range input fires focus between its own
`input` events and splits one drag into two entries.

### What draws nothing costs nothing

The `__root__` a glTF brings is a `Mesh` doing a transform node's job. Babylon
cannot instance it, so the village has 5 274 of them among its 14 446 meshes,
and every one was walked by `_evaluateActiveMeshes` each frame and pushed into
the sun's render list. They are hidden; both walks ask `isVisible` first, and
nothing that draws is under the flag. The selection outline is excluded from the
shadow map like the grid, and is one updatable mesh for the session rather than
a mesh disposed and rebuilt on every selection change.

### The rig says which camera, and whose servers

Every scenario now also writes `<label>.editor.<name>.close.rgba`, taken with one
fixed building framed, and that is the file a "the picture did not change" claim
belongs to. The load scenario reports the counters at that camera too, because
how many meshes the camera finds worth drawing is a number about the view.

The origins the page fetched from are recorded in the report and asserted
against the servers this run started: the bundle in `apps/editor/dist` carries
the URLs it was _built_ with, so `--skip-build` after another worktree's build
measures another checkout's content. And a run that does not finish writes
`<label>.editor.partial.json` — which milestones it reached, how many models had
landed, which servers answered — instead of discarding ten minutes.

## Measurements

All from `pnpm perf:editor --scenario all` on this machine (load average 1.0-2.5
throughout), built bundles, headless Chromium on ANGLE/Vulkan, 1280x720,
`WOV_ASSET_STORE` mounted, four scenarios in one browser session:

```bash
WOV_ASSET_STORE=/home/mike/wov-assets/store \
PERF_EDITOR_PORT=5382 PERF_API_PORT=3381 PERF_ASSET_PORT=9381 \
pnpm perf:editor --label <label> --scenario all
```

`base` is `a0ed139`, the pristine editor plus the rig; `pre` is `c08b8d8`, the
three merged branches; `fix` is this branch. All six runs used this branch's rig
(checked out over the older trees), so the two cameras are the same two cameras
everywhere.

| metric                             | base-a | base-b |  pre-a |  pre-b | fix-a | fix-b |
| ---------------------------------- | -----: | -----: | -----: | -----: | ----: | ----: |
| document in (5273 entities)        |   1030 |   1044 |    350 |    320 |   316 |   316 |
| every model on screen (ms)         | 47 664 | 52 547 |  4 929 |  5 165 | 4 654 | 5 387 |
| main thread blocked (ms)           | 45 343 | 50 227 |  3 171 |  3 413 | 2 961 | 3 076 |
| longest single task (ms)           | 33 394 | 26 588 |  1 376 |  1 363 | 1 338 | 1 361 |
| settled `scene.render` (ms)        |  161.5 |  163.0 |   51.1 |   53.7 |  38.5 |  43.4 |
| settled fps                        |    5.8 |    5.8 |   18.6 |   17.7 |  24.3 |  21.7 |
| draw calls                         | 18 343 | 18 343 |    696 |    696 |   696 |   696 |
| active meshes                      | 14 445 | 14 445 | 14 445 | 14 445 | 9 172 | 9 172 |
| shadow casters                     | 14 440 | 14 440 |  7 469 |  7 469 | 2 196 | 2 196 |
| scene textures                     |     16 |     16 |     16 |     16 |    16 |    16 |
| **one building framed**            |        |        |        |        |       |       |
| `scene.render` (ms)                |  106.9 |  107.4 |   39.6 |   42.0 |  31.0 |  34.0 |
| draw calls                         | 11 824 | 11 824 |    545 |    545 |   545 |   545 |
| active meshes                      |  4 117 |  4 117 |  4 117 |  4 117 | 2 652 | 2 652 |
| **gestures**                       |        |        |        |        |       |       |
| dial: input → frame, median (ms)   |    630 |    624 |     68 |     72 |    57 |    64 |
| dial: idle frame (ms)              |    173 |    173 |     54 |     58 |    43 |    48 |
| rebuild: toggle → program (ms)     |    629 |    618 |     18 |     17 |    18 |    17 |
| edit: nudge → frame, median (ms)   |    634 |    626 |    106 |    105 |    72 |    74 |
| edit: blocked during the nudges    |  8 755 |      — |  2 059 |      — |   279 |     — |
| edit: canvas click, pointerup (ms) |     58 |     59 |     41 |     41 |    42 |    40 |

What this branch is responsible for is the `pre` → `fix` column pair: the
settled frame 51.1 → 38.5 ms and 53.7 → 43.4 ms, the active meshes 14 445 →
9 172 and the shadow casters 7 469 → 2 196 (both byte-identical across runs, both
the hidden `__root__` meshes), the idle frame 54-58 → 43-48 ms, and the nudge
106 → 72 ms against it. The rest of the table is ADR-0048 to ADR-0050 and is
quoted so the phase can be read as a whole.

**The picture.** `npx tsx tooling/perf/compare-frames.ts` between `pre-a` and
`fix-a`, for all four scenarios and both cameras: `mean |Δ| 0.0000-0.0001/255`,
`0.00 % of 290 048 pixels changed` in all eight comparisons. So the caster list
lost 71 % of its entries and the active-mesh walk 36 % of its meshes without a
pixel moving — which is the whole claim about hiding meshes that draw nothing.

At the close camera the _phase_ difference is finally visible where it belongs:
`base-a` against `fix-a` is `mean |Δ| 0.7459/255, max 85, 21.95 % of pixels`
close in, against `1.2388/255, max 47, 14.68 %` at the rig camera — and the far
number is entirely the backdrop shell, which is what ADR-0049's shadow rule was
never about. Run to run at the same code: 0.00 % of pixels at both cameras
(`fix-a` vs `fix-b`, `pre-a` vs `pre-b`, `base-a` vs `base-b`).

**Memory.** The zone-switch leak, measured through CDP with two forced garbage
collections per reading, built bundles:

| step                      |  before |   after |
| ------------------------- | ------: | ------: |
| empty editor              | 11.8 MB | 11.8 MB |
| village loaded            |   200.7 |   193.7 |
| zone `interiors`          |   205.3 |    90.9 |
| back in `village`         |   328.5 |   230.4 |
| after a second round trip |   441.6 |   231.0 |

Before, nothing was ever freed and two round trips added 241 MB. After, the zone
is actually released, the first round trip adds 36.7 MB once (asset containers
filling their cache) and the second adds 0.6 MB.

**The ground and the light**, `terrain.program` read off the debug bridge while
driving the Lighting and Zone tabs on `village1`:

| step                           | before                        | after                         |
| ------------------------------ | ----------------------------- | ----------------------------- |
| village open (world: poisson)  | `wovTerrain6x2s4f2048n111111` | `wovTerrain6x2s4f2048n111111` |
| Noon preset (pcf)              | `…s4f2048n111111`             | `wovTerrain6x2n111111`        |
| back to Evening (poisson)      | `…s4f2048n111111`             | `…s4f2048n111111`             |
| Flat (shadows off)             | `…s4f2048n111111`             | `wovTerrain6x2n111111`        |
| two ground rebuilds under Flat | `wovTerrain6x2n111111`        | `wovTerrain6x2n111111`        |
| Evening again                  | `wovTerrain6x2n111111`        | `…s4f2048n111111`             |

The last row is the finding: before, the ground stayed compiled without a shadow
lookup while 7 469 casters rendered into a map it never sampled.

**The game is untouched.** `pnpm perf:frame --view square`, baseline against this
branch: 549 draw calls, 974 active meshes, 4 093 763 triangles, 2 423 shadow
casters — identical; `scene.render` 12.71 ms against 12.73 ms; `pnpm perf:compare`
`mean |Δ| 0.0000/255, max 0/255, 0.00 % of 921 600 pixels`, exit 0.

## Consequences

- A gizmo drag now always commits, including one whose selection was cleared or
  whose tool was changed while the mouse was down. `Escape` mid-drag is
  therefore not a cancel — it clears the selection and the gesture still lands.
  That is the honest reading of the gesture and it is new behaviour.
- `SceneSync` gained `restore`; `TerrainHandle` gained `shadowsMatchScene`;
  `SelectionOutline` gained an `onMesh` option; `@wov/engine` exports
  `meshesWithStaleLights`. The debug bridge gained `render.sceneMeshes` and
  `render.staleLightMeshes`, the second of which is sampled about once a second
  rather than every frame, because it is a walk over the whole scene.
- A tile under a PCF or PCSS profile is not shadowed. The two shipped presets
  Evening and Poisson are unaffected; Noon is a PCF profile and its ground is now
  plainly unlit rather than reading a texture the driver rejects.
- The `__root__` meshes are hidden, so anything that counts _visible_ meshes in
  the editor counts 9 172 rather than 14 445 for the village. Nothing reads them
  today; a future feature that expects to find an entity's root among the visible
  meshes will not.
- `_evaluateActiveMeshes` is still the largest single thing in the settled frame
  at 52.9 % inclusive, over 9 172 meshes. That is the same wall ADR-0049 named,
  one layer along: cutting it further means fewer _nodes_, which collides with
  every entity having to stay individually selectable.

## Alternatives considered

- **A comparison-sampler variant of the terrain program**, so a PCF profile keeps
  its ground shadows. Rejected for now on scope: it is a second shadow path
  through hand-written GLSL, and the profile that needs it is one preset that no
  world file uses. Recorded as the follow-up.
- **`setEnabled(false)` on the `__root__` meshes** instead of `isVisible = false`.
  Rejected on behaviour, not measured: `isEnabled` is inherited, so disabling the
  root would hide the model under it.
- **Keeping the selection outline disposable and merely excluding it.** Rejected
  after reading what a disposal costs here: every add and every remove marks the
  light rig's caster list stale, so a selection change made it rebuild that list
  from all 14 446 meshes. A box is always twelve edges, so one updatable mesh
  serves.
- **Ending a slider gesture on the `change` event** rather than beginning it on
  `pointerdown`. Rejected because React does not surface the native `change` on a
  controlled input, and a ref-attached listener for it is more machinery than a
  counter.
- **Making the stale-light check part of the per-frame bridge publish.** Rejected
  on cost: it is a walk over 14 445 meshes, and the rig measures debug builds, so
  a per-frame walk would appear in the very frame times the rig exists to report.
  Sampled once a second instead, and the smoke test waits past one interval
  rather than polling for the value the bridge was born with.
