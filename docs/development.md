# Development

> Status: **Phase 1**.

## Requirements

- Node.js 22 (see `.nvmrc` / `.node-version`)
- pnpm via Corepack — `corepack enable` (the exact version is pinned in
  `package.json` → `packageManager`)
- Git

Nothing else. No Docker, no credentials, no production services (spec §5, §19-20
of the agent rules).

> If `corepack` is not on your machine, install it once with
> `npm i -g corepack` (or, without root access to the global npm prefix,
> `npm i -g --prefix ~/.local corepack && corepack enable --install-directory ~/.local/bin`).

## Getting started

```bash
git clone https://github.com/<ORG>/world-of-vikings.git
cd world-of-vikings
corepack enable
pnpm install
pnpm dev
```

`pnpm install` also builds the shared packages (root `prepare` script), so
`pnpm dev` works on a clean clone.

## Local URLs

| Service | URL                                                        |
| ------- | ---------------------------------------------------------- |
| Website | http://localhost:5172                                      |
| Game    | http://localhost:5173                                      |
| Editor  | http://localhost:5174                                      |
| API     | http://localhost:3000/health, http://localhost:3000/worlds |
| Assets  | http://localhost:9000/health                               |

`pnpm smoke` starts its own editor (5184) and API (3100) instead of reusing
these two. The API it starts points at a throwaway copy of `content/`, because
the editor's save test writes real files — so the suite can run while
`pnpm dev` is up, and `git status` stays clean either way.

All ports are `strictPort`: a clash fails loudly instead of silently moving an
app to a different port.

Every smoke port can be moved, which is what two checkouts need to run the suite
at the same time:

```bash
SMOKE_WEBSITE_PORT=5372 SMOKE_GAME_PORT=5373 SMOKE_ASSET_PORT=9400 \
SMOKE_API_PORT=3300 SMOKE_EDITOR_PORT=5384 pnpm smoke
```

Without them, two parallel runs do not fail cleanly: `reuseExistingServer`
cannot tell two differently configured servers apart, so one run's test gets
answered by the other run's API against the other checkout's content.

## Commands

| Command                 | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`              | Starts packages (watch), website, game, editor, API and asset server       |
| `pnpm build`            | Builds packages, then all apps and services                                |
| `pnpm typecheck`        | Strict TypeScript across packages, apps, services and tests                |
| `pnpm lint`             | ESLint + architecture boundaries                                           |
| `pnpm lint:boundaries`  | dependency-cruiser only                                                    |
| `pnpm format`           | Prettier write                                                             |
| `pnpm format:check`     | Prettier check (used by CI)                                                |
| `pnpm test`             | Vitest unit tests                                                          |
| `pnpm validate`         | Runs `validate:content` and `validate:assets`                              |
| `pnpm validate:content` | Validates `content/` against `@wov/world-schema`                           |
| `pnpm validate:assets`  | Validates `assets/` against `assets/manifest.json` (`--write` regenerates) |
| `pnpm check`            | typecheck + lint + format:check + test + validate                          |
| `pnpm smoke`            | Playwright: starts every app and asserts a visible marker                  |

Run a single workspace with a filter, e.g. `pnpm --filter @wov/game dev`.

## Smoke tests

```bash
npx playwright install chromium   # once per machine
pnpm smoke
```

`pnpm smoke` starts the real dev servers, opens each app in headless Chromium and
asserts one visible marker per app plus `/health` of the API and asset server.
This is how you prove something runs instead of claiming it does.

## Bundle sizes

Checked after `pnpm build` on 2026-09-06. Sizes are the emitted file and its
gzip; the browser downloads the gzip.

| Chunk                | Raw      | Gzip   | When it loads                       |
| -------------------- | -------- | ------ | ----------------------------------- |
| `apps/game` entry    | 1 086 kB | 270 kB | Always                              |
| `webgpuEngine`       | 223 kB   | 54 kB  | Only on a WebGPU browser (ADR-0006) |
| `glTFLoader`         | 132 kB   | 32 kB  | On the first asset load (ADR-0011)  |
| `havok` binding      | 102 kB   | 26 kB  | On physics start-up (ADR-0013)      |
| `HavokPhysics.wasm`  | 2 095 kB | 658 kB | With it                             |
| `apps/editor` entry  | 1 473 kB | 380 kB | Always                              |
| `apps/website` entry | 1.1 kB   | 0.6 kB | Always                              |

Totals on disk: game 5.5 MB, editor 3.9 MB, website 12 kB.

The game entry grew by 35 kB raw / 13 kB gzip with the terrain renderer
(ADR-0020): the shader material, the texture loader and the transform node it
needs were not in the bundle before. `@babylonjs/materials` was _not_ added —
`MixMaterial` was measured against the real splat data and rejected, and the
generated shader is a few kB of strings instead of a package.

It grew by a further 93 kB raw / 26 kB gzip when the client started loading its
world from the API (ADR-0022). That is `@wov/world-schema` and Zod: the client
validates the world file and the prefab catalogue with the same schemas the
service validated them with, rather than trusting a service it does not control
(agent rule 10).

## What the village costs to draw

Measured in the dev build with `window.__wov.render`, standing in the middle of
the village tile at 1280×720, headless Chromium on WebGL2. Frames per second are
not listed on purpose: headless has no display to keep up with, so the number
would say more about the rasteriser than about the scene.

| View                                  | Draw calls | Active meshes | Triangles |
| ------------------------------------- | ---------- | ------------- | --------- |
| 1216 entities, instanced (what ships) | 196        | 1 018         | 509 870   |
| the same view, cloned instead         | 553        | 1 018         | 509 870   |

Same picture, 2.8× the draw calls: 139 models are placed 1216 times, and an
`InstancedMesh` shares its source's geometry and material, so Babylon draws all
copies of one mesh together (ADR-0022). The terrain adds 131 072 collision
triangles, which are not drawn — they are the physics mesh.

Since the scatter runs (ADR-0025) the same zone is 5248 entities. Measured at
one viewpoint (`?world=village1&spawn=165,165`), before and after, on the same
machine:

| View                                  | Entities | Draw calls | Active meshes | Triangles |
| ------------------------------------- | -------- | ---------- | ------------- | --------- |
| before the scatter runs               | 1216     | 118        | 583           | 357 472   |
| 4032 scattered plants, thin-instanced | 5248     | 129        | 558           | 1 762 133 |

Eleven more draw calls for 4032 more plants, because vegetation is drawn as thin
instances: one mesh per plant _model_, whatever the number of copies. The
triangle count is the price that does not go away — the tufts are on screen —
and it is what a future LOD or distance fade has to work on.

With the world's own lighting on top of that (ADR-0024), measured on the village
square at `?world=village1&spawn=166,150`, 1280×720, Chromium on ANGLE over
Vulkan. The frame time is the average over the last five seconds, not over the
whole session, and the machine was running other work — read the ratios, not the
absolute milliseconds:

| The same view, lit                    | Draw calls | Triangles | Frame time |
| ------------------------------------- | ---------- | --------- | ---------- |
| `?flat=1` — one sun, no map, no grade | 195        | 1 890 157 | 13.3 ms    |
| `&shadows=off` — the evening, no map  | 202        | 1 890 169 | 13.5 ms    |
| what ships                            | 539        | 3 937 512 | 28.7 ms    |

The shadow map is the whole difference, and it is bought in geometry rather than
in resolution: the map draws 2 398 casters with no frustum culling, which is
2.05 M triangles against the camera pass's 1.89 M. Grass is not among them
(ADR-0027) — leaving 3 473 tufts out took 34 730 triangles and 0.4 ms off, which
is 0.9 % and the honest size of that saving. What is left to work on is
cascades, or a shorter shadow distance; narrowing the caster list was measured
and rejected in ADR-0024.

### What the CPU costs, and what it stopped costing

The table above is what the _picture_ costs. What the frame cost was a separate
question, and the answer was that the renderer was re-deriving a static world
sixty times a second (ADR-0035). Measured with `pnpm perf:frame` against the
built bundles, headless Chromium on ANGLE over Vulkan at 1280×720, mean scene
render over a three-second window once the village has finished arriving:

|                           | village square | north-east slope |
| ------------------------- | -------------- | ---------------- |
| before                    | 24.44 ms       | 15.35 ms         |
| entity transforms frozen  | 18.78 ms       | 11.12 ms         |
| materials frozen          | 13.27 ms       | 10.16 ms         |
| shadow caster list cached | **12.37 ms**   | **9.16 ms**      |

Draw calls (549 and 369), active meshes (974 and 27) and triangles do not move
across those rows, and both frames are byte-identical to the baseline over
921 600 pixels: this is the same picture drawn for half the CPU. What is left is
`_evaluateActiveMeshes` at 28 % — the walk over the scene rather than anything
inside it — and the shadow pass at 25 %, which is 2 423 casters handled one at a
time. Both need fewer meshes rather than cheaper ones; see ADR-0035.

The game entry chunk is over Vite's 500 kB warning and Rollup says so on every
build. It is almost entirely Babylon.js core; splitting it is open work under
ADR-0006, and the number is written down here so a regression is visible rather
than gradual. Everything that _can_ be deferred already is — the four rows
above the editor are separate chunks, not part of the entry.

## Measuring a frame

`pnpm perf:frame` is the rig every performance claim in this repository has to
come from. It builds the game with the debug bridge (`WOV_DEBUG_BRIDGE=1`),
starts an API, an asset server and `vite preview` on ports of their own, opens
one of the named views in `tooling/perf/views.ts`, waits for the collision
report — the last thing the client publishes, so a bridge that has one is a
client that has stopped loading — and then measures a three-second window:

```bash
WOV_ASSET_STORE=/srv/assets/store pnpm perf:frame --label baseline --view square
WOV_ASSET_STORE=/srv/assets/store pnpm perf:frame --label after --view square --skip-build
pnpm perf:compare perf-results/baseline.square.rgba perf-results/after.square.rgba
```

Four things it does that a browser tab does not:

- **The built bundles, not the dev server.** Vite serves every Babylon submodule
  as its own module record; the built bundle is one tree-shaken file. Only one of
  them is what a player runs, and they do not cost the same.
- **The window's own mean, not the running one.** `window.__wov.render.frameTimeMs`
  is the average over every frame since the page opened, which after ten seconds
  of loading a village is mostly the loading. Two readings and the frame counts
  behind them recover the mean of the frames in between.
- **A CPU profile at 200 µs**, aggregated by function into self and inclusive
  time. Inclusive is what says which _phase_ costs what; self is what a
  micro-optimisation moves.
- **The canvas as raw bytes.** The HUD is DOM on top of the canvas, so reading
  the canvas excludes it without a rectangle anybody has to keep in step with the
  layout. `pnpm perf:compare` reports the mean absolute difference per channel,
  and a change that claims to leave the picture alone stays under 2/255.

It also walks the player and reads the sun's position before and after, because
the shadow map is centred on the player and "it still follows" is a claim about
movement that no still frame can make. The walk needs room: at the square's
spawn the player is stopped by a wall three metres north, so the thirty-metre
version of that test is run on the `slope` view.

## Measuring the editor

`pnpm perf:editor` is the same idea for the other app, and it exists because the
game rig cannot see what an author complains about. Opening `village1` in the
editor takes over a minute with the main thread blocked for most of it, and the
frame after it lands is nothing like the game's — the game draws that zone in
about 12 ms after ADR-0035 and ADR-0025; the editor drew it in 300-400 ms and
draws it in 38-43 ms now. Those two numbers are not a ratio — the game's is a
player's camera at ground level and the editor's is the whole zone from above —
but neither could be argued about at all until both were measured the same way,
which is what this rig is for (ADR-0047, ADR-0051).

```bash
WOV_ASSET_STORE=/srv/assets/store pnpm perf:editor --label baseline
WOV_ASSET_STORE=/srv/assets/store pnpm perf:editor --label after --scenario dial --skip-build
```

Four scenarios, all in one browser session on one page, and one JSON report per
run under `perf-results/` plus a PNG and two `.rgba` per scenario — one at the
camera the timings are taken at and one `…close.rgba` with a single building
framed:

- **`load`** — open `village1` through the File menu and time the document
  (`entityCount`), the models (`loadedCount == entityCount`) and the textures
  (the last time `loadedTextures` grew, confirmed by two quiet seconds), plus the
  long tasks the main thread spent blocked and a CPU profile of the whole load.
  Then `F` with nothing selected frames the zone, and the settled frame is
  measured: `scene.render` over a window, draw calls, active meshes, triangles,
  shadow casters, and a second profile.
- **`dial`** — ten changes to layer 0's metallic in the Zone tab, each timed to
  the next rendered frame, with the terrain program key and the scene's texture
  count before and after, so a rebuild that leaks textures shows up.
- **`rebuild`** — flip the facet switch four times, each timed to the tile on
  screen carrying its new shader key. The ground edit that _must_ rebuild, next
  to the dial, which must not (ADR-0050).
- **`edit`** — select a fixed entity from the hierarchy, nudge its x five times,
  and click the canvas once with the select tool. The click is timed around the
  viewport's own `pointerup` listener, which is where `scene.pick` runs — and
  stops before React commits the selection, so read it as "how long the click
  blocked the handler", not as what the author waits for.

Three things it does that the game rig does not, and each is there because a
measurement went wrong without it:

- **The page stamps its own milestones.** The complaint under measurement is that
  the main thread stops answering, and a probe from outside cannot time a thread
  that is not answering. The rig redefines the bridge's counters as accessors
  before the click, so the page records `performance.now()` at each milestone and
  Node reads them back afterwards.
- **Every latency is reported beside the idle frame time.** "890 ms from the
  input to the next frame" is a stall at 60 fps and two ordinary frames at 2 fps.
  Both editing scenarios measure the frame interval immediately before their
  gestures.
- **The frame window runs without the profiler.** Measured the other way round,
  the sampling profiler roughly halved the frame rate of a page holding the
  village — 2.2 fps against 3.1 — so the counters and the profile are two
  separate windows.
- **Two cameras, and only one of them is for the picture.** Every timing is taken
  where `F` with nothing selected puts the camera, because that view contains the
  whole zone and nothing is culled out of the frame being timed. For the village
  that is 1 967 m up, about 4 m to the pixel, with the entities across 3.5 % of
  the canvas — so a canvas read there says nothing about the props. Each scenario
  therefore also writes a `…close.rgba` with one building framed, and that is the
  file a "the picture did not change" claim belongs to (ADR-0051).
- **It checks whose servers answered.** The bundle in `apps/editor/dist` carries
  the API and asset URLs it was _built_ with, so `--skip-build` after another
  worktree built the editor on other ports measures another checkout's content.
  The origins the page used are recorded in the report and asserted against the
  run's own, and a run that does not finish writes
  `<label>.editor.partial.json` rather than discarding itself.

The load number is the one that moves between runs: measured three times on one
idle-ish machine it came out at 71 s, 96 s and 168 s, because it is dominated by
main-thread work that competes with everything else running. Compare runs
back to back on the same machine, and quote the long-task total beside the
milestone — it moves with it. The settled frame moves too, by rather more than
the counters beside it: one unchanged build at one camera has been measured
between 53 ms and 125 ms, so quote it as a range over at least two runs.

### What the load costs now

Two thirds of that load was bookkeeping, not GLB decoding: the viewport reported
the state of the scene once per loaded model _and_ once per loaded texture, and
each report walked all 5273 entities. Reports are folded into one per frame, the
walks happen only for a session that published the debug bridge, and the
hierarchy renders the rows it shows instead of one button per entity (ADR-0048).
Three back-to-back pairs on this rig, branch point against branch:

| `load`                | before                | after                |
| --------------------- | --------------------- | -------------------- |
| every model on screen | 108.1 / 60.5 / 74.5 s | 25.7 / 21.5 / 17.2 s |
| main thread blocked   | 105.7 / 58.3 / 72.0 s | 23.4 / 18.0 / 14.9 s |
| longest single task   | 76.7 / 42.2 / 48.6 s  | 11.3 / 4.6 / 4.9 s   |

Draw calls, active meshes, triangles, shadow casters, the camera and the canvas
read-back are identical before and after, so this bought nothing from the
picture. What is left of the load is Babylon's clone path under `instantiate`
and the render loop itself.

The settled frame is not comparable on a shared machine: with the counters
byte-identical in all six of those runs, `scene.render` came out anywhere
between 210 ms and 789 ms. Take that number on a quiet machine or not at all.

## Measuring what an editor open costs on the wire

`pnpm perf:cache` is the third measuring rig, and the one ADR-0052 is argued
from. It builds the **editor** with the debug bridge, starts the API on a
throwaway `CONTENT_DIR`, the asset server and `vite preview` on ports of their
own, opens a world through the File menu, waits until `loadedCount ===
entityCount` — every entity showing its model rather than the stand-in cube —
and then reloads the page in the same browser profile and does it again:

```bash
WOV_ASSET_STORE=/srv/assets/store pnpm perf:cache --label after
WOV_ASSET_STORE=/srv/assets/store pnpm perf:cache --label after --skip-build
```

It reports, per pass and per origin: requests, bytes on the wire, how many were
`200`, how many were `304` and how many the browser answered without asking, and
seconds. Three things it does that reading a network panel does not:

- **CDP, not `performance.getEntriesByType('resource')`.** A resource entry
  reports `transferSize: 0` for a cross-origin response without
  `Timing-Allow-Origin`, and both measured servers are cross-origin by
  construction — the page would report that it downloaded nothing.
- **`Network.responseReceivedExtraInfo` decides the status.** The ordinary
  response event reports what the _page_ got, which after a revalidation is the
  stored `200`; the extra-info event carries what the _network_ answered, and its
  absence means the browser never asked at all. Those are three different
  outcomes and the rig counts them apart.
- **A browser profile on disk with a stated `--disk-cache-size`.** An incognito
  context caches in memory only and silently refuses the largest entries, so the
  8 MB height field looked uncacheable when only the rig was.

## Environment

Every app has a committed `.env.example` with working local defaults. Copy it to
`.env` only if you need to deviate. Local development never requires a secret
(spec §7, §47).

## Editors

`.editorconfig` and Prettier settle formatting. Recommended VS Code extensions:
ESLint, Prettier, EditorConfig.
