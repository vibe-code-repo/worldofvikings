# ADR-0047: The editor has a measuring rig

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `perf/editor-rig`

## Context

The game's frame cost has been a number since ADR-0024 and an argued-about number
since ADR-0035: `pnpm perf:frame` builds the bundles, opens a named view and
reports scene-render time, draw calls, active meshes, triangles and a CPU
profile, and every claim in `docs/development.md` carries the command that
produced it.

The editor had none of that. What it had was an author's report: opening
`village1` (5273 entities in `village`, 251 prefabs, 3473 of them one grass
clump) takes about seventy seconds before every entity shows its model, the page
stops answering while it happens, and afterwards the frame counter barely moves
and the Zone tab's ground dials are unusable. Every one of those is a claim
nobody could check, compare or disprove, and three people were about to start
optimising against them.

The game rig cannot answer any of it. It measures a frame of a client that has
finished loading; the editor's problem is the loading, the blocked main thread
and the latency of a gesture. Those are different measurements on a different
app, and two of them cannot even be taken from outside the page: while the main
thread is blocked, `page.evaluate` does not answer — which is exactly how the
problem was first noticed.

The editor's bridge (`window.__wovEditor`) published counts only — entities,
meshes, loaded models, texture file names, the terrain program key. No frame
time, no draw calls, no shadow casters. The game's bridge has had all of those
since ADR-0024, off Babylon's own instrumentation.

## Decision

The editor gets a measuring rig of its own, `pnpm perf:editor`, built from the
same scaffolding as `pnpm perf:frame`, and the editor's debug bridge gets the
render counters the game's has.

**The bridge** (`apps/editor/src/dev-debug.ts`) gains a `render` block —
`frameTimeMs` (the running mean of `scene.render`, read twice to recover the mean
over a window), `frames`, `drawCalls`, `activeMeshes`, `triangles`,
`shadowCasters` and `sceneTextures` — and a `camera` block with the viewport
camera's position and orbit target. They are written from a `SceneInstrumentation`
attached in `scene/viewport.ts` behind `import.meta.env.DEV || __WOV_DEBUG_BRIDGE__`,
two build-time literals, so a default `pnpm build` folds the branch away and drops
the instrumentation with it (ADR-0030). It is a second no-op when no bridge was
installed, so a debug-capable build opened without `?debug=1` pays nothing.

**The rig** (`tooling/perf/editor-profile.ts`) builds the editor with
`WOV_DEBUG_BRIDGE=1`, starts the API on a throwaway `CONTENT_DIR`, an asset
server and `vite preview`, opens the built editor in headless Chromium with the
same ANGLE request the game rig makes, and runs three named scenarios on
`village1`, writing one JSON object per run:

- `load` — the three milestones (document, models, textures), the main thread's
  long tasks, a CPU profile of the load, then the settled frame after `F` frames
  the zone;
- `dial` — ten changes to layer 0's metallic, each timed to the next rendered
  frame, with the terrain program key and the scene's texture count before and
  after;
- `edit` — select a fixed entity, nudge it five times, click the canvas once.

Three of its choices are decisions rather than mechanics, and each was forced by
a measurement that came out wrong without it:

1. **The page stamps its own milestones.** The rig redefines `entityCount`,
   `loadedCount` and `loadedTextures` on the bridge as accessors before it clicks,
   so the page records `performance.now()` at each milestone and Node reads them
   back once the thread is free. A poll from outside cannot time a thread that is
   not answering.
2. **The frame window runs without the profiler.** Taking both at once, the
   sampling profiler roughly halved the frame rate of a page holding the village
   — 2.2 fps against 3.1 — so the counters and the profile are two windows.
3. **Every gesture latency is reported beside the idle frame time.** At 2 fps,
   "890 ms to the next frame" is two ordinary frames, not a stall. Both editing
   scenarios measure the frame interval immediately before their gestures.

The arithmetic with a decision in it is separated from the browser driving and
unit-tested: `tooling/perf/long-tasks.ts` (clipping long tasks to a window,
summarising latencies) and `tooling/perf/editor-scenarios.ts` (which scenarios a
command line asked for, and the report shape the builders diff on).

`pnpm perf:frame` keeps working exactly as before; the servers, ports, GPU
request and canvas read-back it shared are now `tooling/perf/rig.ts`.

## What it measured

The baseline on this branch, nothing optimised. Two runs, headless Chromium on
ANGLE over Vulkan at 1280×720, built bundles, the private asset store mounted:

|                                             | run 1                    | run 2     |
| ------------------------------------------- | ------------------------ | --------- |
| document in (`entityCount` 5273)            | 2.18 s                   | 2.55 s    |
| every model on screen                       | 95.6 s                   | 168.1 s   |
| main thread blocked during the load         | 93.1 s                   | 163.2 s   |
| longest single task                         | 66.3 s                   | 100.9 s   |
| settled `scene.render`                      | 406.5 ms                 | 316.4 ms  |
| settled frames per second                   | 2.3                      | 3.0       |
| draw calls / active meshes / shadow casters | 18 343 / 14 445 / 14 440 | identical |
| ground dial → next frame (median)           | 1 117 ms                 | 1 253 ms  |
| idle frame beside it                        | 418 ms                   | 356 ms    |
| position nudge → next frame (median)        | 1 485 ms                 | 1 180 ms  |
| canvas click, `pointerup`                   | 156 ms                   | 98 ms     |

The game draws the same zone at 210 draw calls (ADR-0025) and about 12 ms — but
see the correction in ADR-0051 before dividing those two frame times by each
other: the game's is measured at a player's camera at ground level and this one
1 967 m up with the whole zone in the frustum, so the counters compare and the
frame times do not. The rig therefore also reports a frame with one building
framed, and writes a second canvas taken there: the settled camera puts the
village across 3.5 % of the canvas at about 4 m to the pixel, which is a fine
place to time a frame and no place at all to compare a picture. The heaviest self time of the load profile is `_getDescendants` at
27 %, under `loadedTextures` at 65 % inclusive; of the settled frame it is
Babylon's native bucket at 34-39 %, with `_isSynchronized` at 8 % and
`_renderSubMeshForShadowMap` at 16 % inclusive over 14 440 casters. The terrain
program key did not change across ten dial changes and the scene's texture count
did not move, so the dial's cost is not a leak.

## Alternatives considered

| Alternative                                             | Why not                                                                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `pnpm perf:frame` with an `--app editor` flag    | The two rigs share their scaffolding and nothing else: different bridge, different milestones, different scenarios. One script would be two scripts with a switch through it. |
| Measure from Playwright with `expect.poll`              | Cannot time a blocked main thread — the symptom under measurement is precisely that the page stops answering.                                                                 |
| Drive the panels through `page.evaluate` on React state | It would measure a path no author takes. The rig writes the real input with the native setter and a bubbling `input` event, which is the path a keystroke takes.              |
| Put the instrumentation in `EditorViewport.tsx`         | Three other branches are editing that file. `scene/viewport.ts` owns the renderer and takes six lines.                                                                        |
| Leave the counters out of a `WOV_DEBUG_BRIDGE=1` build  | Then staging could not be measured, which is where the report came from.                                                                                                      |

## Consequences

**Positive** — the editor's cost is a number with a command behind it, on the
same counters the game is measured on. A change can be argued for or rejected
with a before and an after, and a rejected idea with a measurement is a result.

**Negative** — the rig takes several minutes per run and holds one Chromium, so
it is not something to run after every edit. The load milestone is dominated by
main-thread work and therefore by whatever else the machine is doing: three runs
on one machine came out at 71 s, 96 s and 168 s. Runs have to be compared back to
back, and the long-task total quoted beside the milestone — it moves with it.

The settled frame moves with the machine too, and by more than this ADR first
said. The counters are steady — `18 343 / 14 445 / 14 440` in every run of the
baseline, and `696 / 9 172 / 2 196` in every run after ADR-0051 — but the frame
_time_ behind them was measured between 53 ms and 125 ms for one unchanged build
at one camera. Quote the settled frame as a range over at least two runs, the way
the load milestone already is, and never read a single pair as an effect.
The `edit` and `dial` latencies are quantised by a frame rate of two to three per
second, which is why the idle frame time is reported beside them.

**Follow-ups** — the rig measures; it does not fix anything. What the profile
says the time goes on is in `docs/development.md` and in the baseline reports
under `perf-results/`. A change that makes the editor faster is expected to quote
this rig's numbers before and after, and to leave the picture alone
(`pnpm perf:compare` reads the `.rgba` files this rig writes, one per scenario).
