# Development

> Status: **Phase 0**.

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

| Service | URL                          |
| ------- | ---------------------------- |
| Website | http://localhost:5172        |
| Game    | http://localhost:5173        |
| Editor  | http://localhost:5174        |
| API     | http://localhost:3000/health |
| Assets  | http://localhost:9000/health |

All ports are `strictPort`: a clash fails loudly instead of silently moving an
app to a different port.

## Commands

| Command                | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `pnpm dev`             | Starts packages (watch), website, game, editor, API and asset server |
| `pnpm build`           | Builds packages, then all apps and services                          |
| `pnpm typecheck`       | Strict TypeScript across packages, apps, services and tests          |
| `pnpm lint`            | ESLint + architecture boundaries                                     |
| `pnpm lint:boundaries` | dependency-cruiser only                                              |
| `pnpm format`          | Prettier write                                                       |
| `pnpm format:check`    | Prettier check (used by CI)                                          |
| `pnpm test`            | Vitest unit tests                                                    |
| `pnpm validate`        | Validates `content/` against `@wov/world-schema`                     |
| `pnpm check`           | typecheck + lint + format:check + test + validate                    |
| `pnpm smoke`           | Playwright: starts every app and asserts a visible marker            |

Run a single workspace with a filter, e.g. `pnpm --filter @wov/game dev`.

## Smoke tests

```bash
npx playwright install chromium   # once per machine
pnpm smoke
```

`pnpm smoke` starts the real dev servers, opens each app in headless Chromium and
asserts one visible marker per app plus `/health` of the API and asset server.
This is how you prove something runs instead of claiming it does.

## Environment

Every app has a committed `.env.example` with working local defaults. Copy it to
`.env` only if you need to deviate. Local development never requires a secret
(spec §7, §47).

## Editors

`.editorconfig` and Prettier settle formatting. Recommended VS Code extensions:
ESLint, Prettier, EditorConfig.
