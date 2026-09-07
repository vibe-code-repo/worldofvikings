# ADR-0035: The static world is frozen

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `perf/cpu-frame`

## Context

The village is on screen and it costs too much CPU to draw. Measured on the
village square with the built bundles, headless Chromium on ANGLE over Vulkan at
1280×720, with a 200 µs sampling profile over a three-second window:

|                |                     |
| -------------- | ------------------- |
| scene render   | **24.4 ms** a frame |
| frames         | 40.3 per second     |
| draw calls     | 549                 |
| active meshes  | 974                 |
| triangles      | 4.09 M              |
| shadow casters | 2 423               |

The GPU was not the problem — 97 % of the samples were inside `scene.render`,
and the same picture at 549 draw calls is a load a modern card does not notice.
The problem was that the renderer was doing the same three pieces of arithmetic
sixty times a second and getting the same answer every time:

| phase                                  | inclusive share                                         |
| -------------------------------------- | ------------------------------------------------------- |
| `_evaluateActiveMeshes`                | 26 % (`computeWorldMatrix` 18 %, `isSynchronized` 17 %) |
| `isReadyForSubMesh` / `_prepareEffect` | 17 % / 16 %, of which `defines.toString` 8 %            |
| `_renderForShadowMap`                  | 16 %                                                    |

All three have the same cause, and it is not a bug in Babylon. Babylon assumes a
scene changes. It asks every node whether its transform moved, it re-derives
every material's defines before every draw in case one of them changed, and it
re-derives the shadow map's caster list from the scene before every shadow pass
in case a mesh appeared or went away. For a scene of a few dozen movers that is
free. For 5 273 authored props that will never move again it is half the frame
spent proving that nothing happened.

Nothing was marking anything dirty. There was no leak to find. The renderer
simply had not been told what kind of scene this is.

## Decision

**Once a zone has finished arriving, the game tells the renderer that it is
finished.** Three statements, in this order, from `apps/game/src/main.ts`:

1. `freezeStaticNodes(placed.roots)` — every entity root and everything under it
   has its world matrix computed once and pinned, and its meshes stop
   refreshing their bounding boxes. The order is the correctness argument and is
   what the unit test holds still: each node is recomputed with `force`
   immediately before it is frozen, roots before children, so a child can never
   pin a stale parent transform into itself.
2. `freezeMaterialsWhenReady(scene)` — every material stops re-deciding whether
   it can be drawn. It waits for `scene.executeWhenReady` (render targets
   included) rather than freezing at once: a material frozen while its textures
   are still arriving is pinned to "not ready", and the ground would stay grey
   for the life of the page.
3. The sun's shadow map derives its caster list from the scene **when the scene
   changes** rather than on every pass — a mesh added, a mesh removed, or
   something excluded from the map.

The three live in `@wov/engine` as things an app asks for, never inside
`placeEntities`. The editor runs the same placer and its whole purpose is
moving these props; a frozen node there is a prop whose gizmo works, whose
document updates and whose picture never changes, which is the worst kind of
bug because everything except the screen agrees. `unfreezeStaticNodes` is the
way back for anything that later has to move.

The caster list is **refilled in place, not replaced**. That is not tidiness: a
new array on each rebuild changed the picture — patches of self-shadowing
appeared and disappeared on the log walls — and refilling the array Babylon
already hooked makes the frame byte-identical again. It is also what Babylon's
own `prepareRenderList` does.

## Consequences

Same view, same build, same machine:

|                    | scene render | frames  | draw calls | active meshes |
| ------------------ | ------------ | ------- | ---------- | ------------- |
| before             | 24.44 ms     | 40.3 /s | 549        | 974           |
| entities frozen    | 18.78 ms     | 52.0 /s | 549        | 974           |
| materials frozen   | 13.27 ms     | 61.3 /s | 549        | 974           |
| caster list cached | **12.37 ms** | 61.0 /s | 549        | 974           |

The north-east slope goes 15.35 ms → 9.16 ms the same way. `computeWorldMatrix`,
`isSynchronized`, `isReadyForSubMesh`, `_prepareEffect` and `toString` all leave
the profile's top twenty, and 18 % of the frame is now idle — the render loop
waiting for the display instead of the CPU waiting for itself.

**The picture does not change.** Both views are byte-identical to the baseline
across 921 600 pixels (mean |Δ| 0.0000/255), measured by reading the canvas back
rather than screenshotting the page, so the HUD is excluded without a rectangle
anybody has to keep in step with the layout. The shadow map still follows the
player: walking 30.2 m moves the sun 30.2 m with it.

What this costs:

- **A zone change has to say so.** The freeze is a claim about a placed world.
  Zone streaming, when it arrives, must unfreeze or rebuild rather than assume.
- **A prop that starts moving has to be unfrozen first.** A door, a cart, a
  picked-up object: `unfreezeStaticNodes` on its subtree. A frozen prop that is
  moved anyway moves in the document and in the physics world and not on screen.
- **A material change after the freeze does not take.** Everything the light rig
  does to materials — `receiveShadows`, the fog flag on a backdrop's source mesh
  — happens before it, which is why the freeze is the last of the three
  statements and not the first.
- **A mesh made visible again between rebuilds is not added to the caster list**
  until something else changes the scene. Being _hidden_ is safe: Babylon checks
  `isEnabled` and `isVisible` itself when it walks the list. In this client
  nothing is ever switched back on — the one mesh ever disabled is the Phase 1
  plane, once, before the village arrives.

### What was measured and rejected

- **A selection octree** (`scene.createOrUpdateSelectionOctree`, movers in
  `dynamicContent`). The obvious answer to `_evaluateActiveMeshes`, and it made
  the frame _worse_: 12.37 ms → 13.04 ms, with the phase it targeted unchanged
  at 30 %. The village is dense enough that the blocks the frustum touches hold
  most of it, and the 2 km sky box lands in every block it is subdivided into.
  Reverted.
- **Pinning the instance buffers**
  (`manualUpdateOfWorldMatrixInstancedBuffer`). Worth 1.0 ms — and it moved
  geometry: roof timbers along the top of the frame changed (mean |Δ| 0.39/255,
  max 88, 0.76 % of pixels). Babylon packs an instance buffer from the copies
  that are _visible this frame_, so a pinned buffer is only correct while the
  visible set does not change, which for a moving camera is never. Reverted.
- **`renderingManager.maintainStateBetweenFrames`.** It keeps the dispatched
  submesh lists between frames, which means the drawn set only ever grows: after
  a few seconds of turning the camera there is no culling left. It buys CPU by
  spending GPU and by making a documented counter (draw calls) meaningless. Not
  taken.
- **`scene.freezeActiveMeshes`** is not available to this client at all: the
  camera and the player move, which is the one thing it forbids.

### Still open

`_evaluateActiveMeshes` is now the largest single phase at 28 %, and it is the
walk itself rather than anything inside it. Cutting it means fewer meshes —
merging the static props of a neighbourhood into one, or a distance LOD — which
is a change to what is in the scene and not to how it is drawn, so it belongs in
its own decision. The shadow pass is the next 25 %, and it is 2 423 casters
processed one at a time; ADR-0024's measurement that culling them to the shadow
box removes one of them still holds.

`pnpm perf:frame` is the rig all of these numbers come from, and
`pnpm perf:compare` is the pixel comparison. Both are described in
`docs/development.md`.
