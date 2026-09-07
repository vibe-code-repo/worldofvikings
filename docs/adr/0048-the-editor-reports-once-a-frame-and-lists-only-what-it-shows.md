# ADR-0048: The editor reports once a frame and lists only what it shows

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `perf/editor-load`

## Context

ADR-0047 gave the editor a measuring rig and a baseline. The first thing it said
about opening `village1` — 5273 entities in one zone, 251 prefabs, 145 distinct
models — was that the load was not spent decoding GLBs. It was spent on
bookkeeping:

| load profile, heaviest self time first | share                            |
| -------------------------------------- | -------------------------------- |
| `Node._getDescendants`                 | 27 % self                        |
| `textureFileName`                      | 12 % self                        |
| `SceneSync.loadedTextures`             | 10 % self, **65-68 % inclusive** |
| the arrow callbacks inside it          | 9 % self                         |
| `AbstractMesh.material` getter         | 7 % self                         |
| `SceneSync.meshCount` → `ownEntityId`  | 4 % self                         |

One function owned two thirds of a load that took between 60 s and 168 s
depending on what else the machine was doing, and the main thread was blocked
for almost all of it — 42 s to 100 s in a _single_ task, so the page did not
answer a click while it happened.

The cause is a loop that is quadratic in the entity count without anything in it
looking expensive. `EditorViewport`'s `report()` was wired to `onSceneChanged`,
which `scene-sync.ts` fires **once per loaded model and once per loaded
texture** — about ten thousand times for `village1`. Every one of those calls
did four walks over the whole zone:

- `sync.meshCount()` filters every transform node in the scene;
- `sync.loadedCount()` counts every instance;
- `sync.loadedTextures()` visits every instance × every child mesh × every
  active texture, and `getChildMeshes` is `Node._getDescendants`;
- `outline.show(sync.boundsOf(selection))`.

It then called `onAssetSources`, which is React state in `EditorShell`, so each
one also re-rendered the whole shell — including a `Hierarchy` that built one
`<button>` per entity: 5273 of them, for the thirty a 15 rem column can show.

None of those numbers is read ten thousand times. `loadedCount` and
`loadedTextures` exist for the debug bridge (ADR-0019, ADR-0047), which a
session only has when it was opened with `?debug=1`; the asset-origins line
changes 145 times, once per distinct model, not once per entity.

## Decision

Three things, all inside `apps/editor`:

1. **The viewport reports once per animation frame**, not once per loaded asset.
   `createCoalescer` (`apps/editor/src/coalesce.ts`) folds any number of
   `schedule()` calls into one `run()` before the next frame, with a 250 ms
   timer as a fallback for a tab that is not painting — `pnpm smoke` polls the
   bridge, and a bridge that stops being written in a background tab would hang
   it. Nothing is lost by folding: a report reads the current state, so the one
   that happens stands for every ask that arrived before it, and a frame always
   follows the last change.

2. **The expensive arguments are computed only when a bridge is installed.** One
   guard, `isEditorDebugInstalled()`, around the whole `publishEditorDebug` call
   in both places that pass a walk of the zone as an argument — not thirty
   guards, which would be thirty places to forget one. `publishEditorDebug`
   itself stays unguarded everywhere else, exactly as `dev-debug.ts` says.
   The asset-origins line is forwarded only when it differs from the last one.

3. **The hierarchy renders only the rows it shows.** The visible slice plus
   twelve rows of margin; the rows above and below are two spacers of exactly
   their height, so the scrollbar, every scroll position and the height of the
   list are unchanged. The arithmetic is framework-free and tested
   (`panels/list-window.ts`), because it is the part that can be wrong in a way
   nothing notices. A zone short enough to fit is rendered whole with both
   spacers collapsed, so the small worlds the smoke tests walk are the DOM they
   always were. The hierarchy, the asset browser and the right-hand column are
   `React.memo`, and the handlers they are given are made once — without that,
   memoising them does nothing.

Two consequences of (3) are visible and deliberate. Spacers of `rows × row
height` need every row to be the same height, so an entity row is one line: a
generated id wrapped to three lines in a 240-pixel column while the next one
took two, and no arithmetic describes that list. And because a row outside the
window does not exist, selecting an entity anywhere else scrolls its row into
view — by the smallest movement that shows it, so it does not reshuffle a list
the author was reading.

Nothing in `apps/editor/src/scene/`, `packages/engine` or
`packages/asset-system` is touched. `loadedTextures()` is still O(entities);
it is just no longer called ten thousand times.

## What it measured

`pnpm perf:editor --scenario all` on `village1`, built bundles, headless
Chromium on ANGLE over Vulkan at 1280×720, the private asset store mounted.
Three pairs, each pair run back to back on the same machine — the branch point
first, this branch second — because the load milestone moves with whatever else
the machine is compiling (ADR-0047).

| pair                  | 1 before | 1 after    | 2 before | 2 after    | 3 before | 3 after    |
| --------------------- | -------- | ---------- | -------- | ---------- | -------- | ---------- |
| document in           | 2 208 ms | 1 639 ms   | 1 367 ms | 2 981 ms   | 2 170 ms | 1 637 ms   |
| every model on screen | 108.1 s  | **25.7 s** | 60.5 s   | **21.5 s** | 74.5 s   | **17.2 s** |
| main thread blocked   | 105.7 s  | **23.4 s** | 58.3 s   | **18.0 s** | 72.0 s   | **14.9 s** |
| longest single task   | 76.7 s   | **11.3 s** | 42.2 s   | **4.6 s**  | 48.6 s   | **4.9 s**  |
| long tasks            | 64       | 55         | 48       | 57         | 68       | 58         |

Between 3.5× and 4.3× on the milestone, 4.5× to 4.8× on the blocked total, and
6.8× to 10× on the longest single task, in every pair and in the same direction.

The load profile says the same thing from the other side. In pair 3's `before`,
`loadedTextures` is 43.0 s inclusive of a 63.8 s profile (67.5 %) with
`_getDescendants` at 27 % self; in the `after` run of the same pair, none of
`loadedTextures`, `_getDescendants`, `textureFileName`, `ownEntityId`,
`getAllPropertyNames` or the material getter appears in the top twenty at all.
What is left is Babylon's own clone path (`getAllPropertyNames` 15 % self,
`DeepCopy` 20 % inclusive, under `instantiate` at 6.3 s) and the render loop
itself at 9.2 s — both outside this change.

Nothing about the picture moved. Every run reported 18 343 draw calls, 14 445
active meshes, 4 463 553 triangles, 14 440 shadow casters, 16 scene textures,
11 loaded texture files, 5273 of 5273 models and the camera at
`[160.0, 846.5, -1543.6]` looking at `[160.0, -137.0, 160.0]`, before and after.
`pnpm perf:compare` on pair 3's canvas read-backs: mean |Δ| 0.0000/255, max 0,
0.00 % of 290 048 pixels changed, for all three scenarios.

The settled frame, the `dial` latency and the `edit` latency are **not**
measurable on this machine today and this change does not claim them. With the
counters byte-identical in all six runs, `scene.render` came out at 309, 240,
366, 506, 210 and 789 ms — a 3.8× spread inside one pair — so the ambient load
of a shared machine is several times larger than anything these numbers could
show. The `dial` and `edit` medians moved in both directions across the three
pairs for the same reason; they are quantised by that frame time (ADR-0047).

## Alternatives considered

| Alternative                                                     | Why not                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Make `loadedTextures()` cheap instead (cache per instance)      | It is in `scene/scene-sync.ts`, which another branch owns. It is also the wrong fix on its own: called ten thousand times, a cheap walk is still ten thousand walks. Cheap _and_ once a frame is better, and the second half is the part worth 4×. |
| Throttle the reports on a fixed timer                           | A timer either reports more often than the page can paint or less often than it paints. The frame is the rate at which a report can be seen at all, and it is self-limiting: as the zone gets heavier, frames get rarer and reports with them.     |
| Guard each expensive argument at its own call site              | `dev-debug.ts` already argues this: thirty guards around one branch are thirty places to forget one. One guard around the call that passes a zone walk as an argument, and `publishEditorDebug` stays a plain no-op everywhere else.               |
| Publish `loadedCount`/`loadedTextures` from `scene-sync` itself | Same owner problem, and it would move a debug concern into the reconciler.                                                                                                                                                                         |
| A virtual-list dependency                                       | A fixed-height window is thirty lines of arithmetic and one layout measurement. A dependency for that is a dependency for nothing (agent rule 12).                                                                                                 |
| `content-visibility: auto` on the rows instead of a window      | It would skip layout and paint for off-screen rows without any JavaScript, but React would still build and reconcile 5273 elements on every render, which is the half that costs.                                                                  |
| Keep rows wrapping and window on measured heights               | A per-row height cache and a running offset table, to keep a list whose rows differ only because a column is 240 px wide. One line per row is what the panel wanted anyway.                                                                        |
| Ellipsis at the end of an id                                    | Generated ids differ in their last characters, so fifteen rows all read `environment-…`. `direction: rtl` keeps the tail, which is the half that identifies the entity, and leaves a short id exactly where it was.                                |

## Consequences

**Positive** — opening the village is three to four times faster and the page
stops being frozen for a minute at a time: the worst single task is 4.6-4.9 s
instead of 42-77 s. Every gesture that changes the document is cheaper too,
because the hierarchy it re-renders is forty rows instead of 5273. A session
without `?debug=1` — which is every author's session — no longer walks the zone
three times per loaded asset at all.

**Negative** — the bridge is now up to one frame behind the scene rather than
exactly current. Anything polling it (`pnpm smoke`, `pnpm perf:editor`) already
polls, so it sees the same values a frame later; anything that read it
synchronously right after a load callback would not, and nothing does. An entity
row is one line and a long id is truncated at the front, with the whole of it on
the row's `title` and in the inspector. The hierarchy scrolls itself when the
selection changes, which is new behaviour, however conventional.

**Follow-ups** — the load is now Babylon's clone path and the render loop. Two
things would take the next bite and both are outside this change: `instantiate`
without `instanced: true` clones a mesh per entity (`scene/scene-sync.ts`,
ADR-0025 already does the instanced version in the game), and the models of one
prefab still land in one uninterrupted microtask chain, which is what is left of
the 4.6-second task — 3473 of the village's entities share a single grass
prefab, so a single container resolving runs 3473 instantiations back to back
with nothing between them for the browser to answer a click in.
