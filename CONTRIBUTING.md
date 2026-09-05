# Contributing

Thanks for helping build World of Vikings. The guiding question for every
decision in this repository is: _can a new contributor understand the
architecture, start the project locally, make a focused change, test it and
submit a pull request without private knowledge?_ If the answer becomes "no",
that is a bug — please report it.

## Setup

```bash
git clone https://github.com/<ORG>/world-of-vikings.git
cd world-of-vikings
corepack enable
pnpm install
pnpm dev
```

Node.js 22 (`.nvmrc`) and Git are the only requirements. Details:
[`docs/development.md`](docs/development.md).

## Language

Everything in this repository is **English**: code, comments, documentation,
issues, pull requests and commit messages. This is an open-source project with
international contributors.

## Branches

`main` must always be buildable. Work on a feature branch:

```text
feature/editor-terrain-tools
fix/player-camera-collision
docs/world-format
```

Open a pull request into `main`. No direct pushes to `main`.

## Before you open a pull request

```bash
pnpm check    # typecheck + lint + format:check + test + validate
pnpm build
```

Both must pass. For anything visible, also run:

```bash
npx playwright install chromium   # once
pnpm smoke
```

## Pull request requirements (spec §41)

- build passes
- typecheck passes
- lint passes (including the architecture boundary rules)
- tests pass
- no generated files committed (`dist/`, `node_modules/`, `playwright-report/`)
- architecture changes documented — add an ADR under `docs/adr/`
- screenshots or a short video for visual editor changes

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`,
`docs:`, `chore:`, `ci:`, `refactor:`, `test:`, optionally with a scope such as
`feat(editor): …`. Keep commits small and focused: one reviewable step each.

## Architecture rules

These are enforced by `pnpm lint:boundaries` and will fail your PR:

1. `apps/game` must not import `apps/editor` or `@wov/editor-core`.
2. `packages/world-schema` must not import Babylon.js, React or any app.
3. `packages/gameplay` must not import a renderer.
4. `packages/*` must not import `apps/*` or `services/*`.
5. No circular dependencies.

Further rules that reviewers watch for:

- Strict TypeScript. No `any`, no `@ts-ignore` without a comment explaining why.
- Prefer composition over inheritance; keep modules small.
- Gameplay state never lives on a Babylon mesh.
- World data lives in `content/` as versioned JSON, never in TypeScript.
- **Never introduce procedural world generation.** Editor scatter tools may
  randomise, but the result must be written into the world file.
- Add tests for reusable logic.
- Do not add a dependency without a reason stated in the PR — and in the package
  README or an ADR for anything significant.

## Adding a package

1. `packages/<name>/` with `package.json` (name `@wov/<name>`), `tsconfig.json`,
   `src/index.ts` and a `README.md` stating purpose, public API, dependencies and
   ownership.
2. Add a reference in `tsconfig.packages.json`.
3. Add a boundary rule in `.dependency-cruiser.cjs` if the package has one.

## Assets

Every asset needs a row in [`docs/asset-licenses.md`](docs/asset-licenses.md)
with source, author, license, usage rights and modification status. Never submit
ripped game assets or files without redistribution rights.

## Security

Never commit secrets. Report vulnerabilities privately — see
[`SECURITY.md`](SECURITY.md).

## Code of Conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
