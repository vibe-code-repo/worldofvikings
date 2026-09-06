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
| `apps/game` entry    | 959 kB   | 232 kB | Always                              |
| `webgpuEngine`       | 223 kB   | 54 kB  | Only on a WebGPU browser (ADR-0006) |
| `glTFLoader`         | 132 kB   | 32 kB  | On the first asset load (ADR-0011)  |
| `havok` binding      | 102 kB   | 26 kB  | On physics start-up (ADR-0013)      |
| `HavokPhysics.wasm`  | 2 095 kB | 658 kB | With it                             |
| `apps/editor` entry  | 1 284 kB | 324 kB | Always                              |
| `apps/website` entry | 1.1 kB   | 0.6 kB | Always                              |

Totals on disk: game 5.2 MB, editor 2.0 MB, website 2.4 kB.

The game entry chunk is over Vite's 500 kB warning and Rollup says so on every
build. It is almost entirely Babylon.js core; splitting it is open work under
ADR-0006, and the number is written down here so a regression is visible rather
than gradual. Everything that _can_ be deferred already is — the four rows
above the editor are separate chunks, not part of the entry.

## Environment

Every app has a committed `.env.example` with working local defaults. Copy it to
`.env` only if you need to deviate. Local development never requires a secret
(spec §7, §47).

## Editors

`.editorconfig` and Prettier settle formatting. Recommended VS Code extensions:
ESLint, Prettier, EditorConfig.
