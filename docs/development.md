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
pnpm perf:compare test-results/perf/baseline.square.rgba test-results/perf/after.square.rgba
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

## Environment

Every app has a committed `.env.example` with working local defaults. Copy it to
`.env` only if you need to deviate. Local development never requires a secret
(spec §7, §47).

## Editors

`.editorconfig` and Prettier settle formatting. Recommended VS Code extensions:
ESLint, Prettier, EditorConfig.
