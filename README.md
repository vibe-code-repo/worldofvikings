# World of Vikings

Open-source, browser-based third-person action RPG with a stylized low-poly
fantasy look — plus its own browser-based world editor. Built with Babylon.js,
TypeScript and Vite.

The world is **hand-crafted in the editor**, never procedurally generated.

> **Status: Phase 1 — player, camera, movement.** The game walks a placeholder
> capsule across a lit ground with a third-person camera behind it: WASD and the
> mouse steer, a Havok physics world says where the ground is, and the first
> licensed model is loaded over the asset server. The editor still renders a
> viewport placeholder and the API still serves `/health`. There is no character
> model, no combat and no authored world yet.
> See [`docs/architecture.md`](docs/architecture.md).

Controls: **WASD** move · **Shift** sprint · **Space** dodge · **E** interact ·
**LMB** attack · **RMB** block · **1–5** quick slots · click the scene to capture
the mouse, **Escape** to release it. The action keys reach the gameplay state and
wait there — nothing consumes them until the combat system.

## Getting started

```bash
git clone https://github.com/<ORG>/world-of-vikings.git
cd world-of-vikings
corepack enable
pnpm install
pnpm dev
```

That is the whole setup. No Docker, no credentials, no production services.
Requirements: **Node.js 22** (see `.nvmrc`) and Git. `corepack enable` installs
the pinned pnpm version; if `corepack` itself is missing, `npm i -g corepack`
once.

`pnpm install` also builds the shared packages (root `prepare` script), so
`pnpm dev` works on a clean clone.

## Local URLs

| Service | URL                          | Workspace         |
| ------- | ---------------------------- | ----------------- |
| Website | http://localhost:5172        | `apps/website`    |
| Game    | http://localhost:5173        | `apps/game`       |
| Editor  | http://localhost:5174        | `apps/editor`     |
| API     | http://localhost:3000/health | `services/api`    |
| Assets  | http://localhost:9000/health | `tooling/scripts` |

## Commands

```bash
pnpm dev         # website + game + editor + API + asset server + package watch
pnpm build       # build packages, then apps and services
pnpm typecheck   # strict TypeScript everywhere
pnpm lint        # ESLint + architecture boundary rules
pnpm format      # Prettier
pnpm test        # Vitest unit tests
pnpm validate    # validate content/ against the world schema and assets/ against the manifest
pnpm check       # typecheck + lint + format:check + test + validate
pnpm smoke       # Playwright: start every app, assert a visible marker
```

Before the first `pnpm smoke`, install the browser once:
`npx playwright install chromium`.

Work on a single workspace with a filter: `pnpm --filter @wov/game dev`.

## Repository structure

```text
world-of-vikings/
├── apps/
│   ├── website/          # world-of-vikings.com — public site, Play link
│   ├── game/             # live.world-of-vikings.com — the game client
│   └── editor/           # editor.world-of-vikings.com — React world editor
├── services/
│   └── api/              # api.world-of-vikings.com — Fastify, /health
├── packages/
│   ├── shared/           # framework-free helpers
│   ├── world-schema/     # Zod schemas + versioning for world data
│   ├── asset-system/     # asset URLs, GLB loading/caching, manifest
│   ├── engine/           # shared renderer layer (Babylon.js from Phase 1)
│   ├── gameplay/         # gameplay state and systems (from Phase 6)
│   ├── editor-core/      # editor-only logic — forbidden in apps/game
│   └── ui/               # framework-free UI tokens/helpers
├── content/              # authored JSON game data (worlds, items, quests, …)
├── assets/               # binary assets, served on :9000 in development
├── tooling/              # asset dev server, validators, Playwright smoke
├── infrastructure/       # docker / nginx / deployment (empty in Phase 1)
├── docs/                 # architecture, world format, editor, assets, ADRs
└── .github/              # CI workflow, issue and PR templates
```

## Architecture in one screen

- **Game and editor are separate applications** with independent bundles. Editor
  code must never reach the game bundle (ADR-0003).
- **World data lives outside the code** as versioned JSON in `content/`,
  validated with Zod through `@wov/world-schema` (ADR-0004).
- **Rendering never owns game state.** Gameplay state is never stored on a
  Babylon mesh.
- Boundaries are **checked by a tool**, not by convention:
  `pnpm lint:boundaries`.

Read [`docs/architecture.md`](docs/architecture.md) next, then the ADRs in
[`docs/adr/`](docs/adr/).

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/development.md`](docs/development.md). Working with a coding agent?
[`AGENTS.md`](AGENTS.md) is the contract agents follow.

## License

Source code: [MIT](LICENSE), © 2026 Mike Kaldig and the World of Vikings
contributors. Third-party software: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
Assets: [`docs/asset-licenses.md`](docs/asset-licenses.md).
