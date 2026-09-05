# AGENTS.md

The contract for coding agents working in this repository. It is the single
source of truth for agents; `CLAUDE.md` only points here. Human contributors:
read `CONTRIBUTING.md` — the rules are the same, this file just states them in
the form an agent needs.

## 1. What this project is

World of Vikings is an open-source, browser-based third-person action RPG with a
**hand-crafted** world plus a separate browser world editor. Babylon.js,
TypeScript, Vite; React only in the editor. The world is never procedurally
generated.

Current state: **Phase 0 (repository bootstrap)**. No gameplay exists yet.

## 2. Folder responsibilities

| Path                    | Owns                                        | Never contains                |
| ----------------------- | ------------------------------------------- | ----------------------------- |
| `apps/website`          | Public site, Play link                      | Game or editor logic          |
| `apps/game`             | Game client bootstrap and HUD               | Editor code, world data       |
| `apps/editor`           | React editor shell, panels, viewport        | Game-only logic               |
| `services/api`          | HTTP service                                | Gameplay rules                |
| `packages/shared`       | Framework-free helpers                      | Any dependency                |
| `packages/world-schema` | Zod schemas + versioning for world data     | Babylon.js, React             |
| `packages/asset-system` | Asset URL resolution, later loading/caching | Gameplay                      |
| `packages/engine`       | Shared renderer layer                       | Gameplay state                |
| `packages/gameplay`     | Gameplay state and systems                  | Any renderer import           |
| `packages/editor-core`  | Editor-only logic                           | Anything the game needs       |
| `packages/ui`           | Framework-free UI tokens/helpers            | React components              |
| `content/`              | Authored JSON game data                     | TypeScript                    |
| `assets/`               | Binary assets                               | Code                          |
| `tooling/`              | Scripts, validators, smoke tests            | Shipped code                  |
| `infrastructure/`       | Deployment scaffolding (empty in Phase 0)   | Anything needed for local dev |
| `docs/`                 | Architecture, formats, ADRs                 | Generated output              |

## 3. Commands

Every command is non-interactive and ends with a meaningful exit code.

```bash
pnpm install     # also builds the shared packages (prepare)
pnpm dev         # website 5172, game 5173, editor 5174, api 3000, assets 9000
pnpm build       # packages, then apps and services
pnpm typecheck   # strict TypeScript, including test files
pnpm lint        # ESLint + architecture boundaries
pnpm lint:boundaries
pnpm format      # Prettier write
pnpm format:check
pnpm test        # Vitest
pnpm validate    # content/ against @wov/world-schema
pnpm check       # typecheck + lint + format:check + test + validate
pnpm smoke       # Playwright: every app started, marker asserted
```

Single workspace: `pnpm --filter @wov/game <script>`.

## 4. How to prove something runs

Do not claim an app works. Prove it:

```bash
npx playwright install chromium   # once per machine
pnpm smoke
```

`pnpm smoke` starts the real dev servers and asserts, per app, a visible marker
in the DOM plus `/health` for the API and the asset server. If you changed
something visible and did not run the smoke test, say so explicitly instead of
implying it passed.

Add a marker (`data-testid`) and a smoke assertion for every new visible surface.

## 5. Definition of Done

A change is done when **all** of these hold:

1. `pnpm check` passes.
2. `pnpm build` passes.
3. `pnpm smoke` passes if anything visible changed.
4. New reusable logic has a test; a bug fix has a test that failed before it.
5. New or changed architecture is recorded in an ADR under `docs/adr/`.
6. New dependencies are justified in the package README or an ADR.
7. Nothing generated is committed (`dist/`, `node_modules/`, `playwright-report/`,
   `test-results/`, `coverage/`).
8. A clean clone still works: `corepack enable && pnpm install && pnpm dev`.
9. Package READMEs still describe reality (purpose, public API, dependencies,
   ownership).

## 6. The 20 rules (spec §52)

1. Do not implement the entire project in one step.
2. Keep every phase runnable.
3. Prefer small, understandable modules.
4. Avoid giant classes.
5. Use strict TypeScript.
6. Prefer composition over inheritance.
7. Separate rendering from gameplay state.
8. Separate editor-only code from game code.
9. Keep world data outside TypeScript source code.
10. Validate external data.
11. Never silently change data formats.
12. Do not add dependencies without a clear reason.
13. Keep browser performance in mind.
14. Add tests for reusable logic.
15. Document architectural decisions.
16. Do not introduce procedural world generation.
17. Editor convenience randomization is allowed only when results are persisted.
18. Do not require proprietary tools for normal contribution.
19. Do not require production credentials for local development.
20. A clean clone must remain easy to start.

## 7. Hard prohibitions

- **No procedural world generation.** Ever. Scatter tools persist their output.
- **No editor code in the game bundle.** `apps/game` must not import
  `apps/editor` or `@wov/editor-core`.
- **No Babylon.js or React in `packages/world-schema`**, no renderer in
  `packages/gameplay`.
- **No world data in TypeScript.** It belongs in `content/` with a
  `schemaVersion`.
- **No silent format changes.** Bump `CURRENT_WORLD_SCHEMA_VERSION` and write a
  migration.
- **No secrets committed.** Only `.env.example` with non-secret local defaults.
- **No `any`, no unexplained `@ts-ignore`.**
- **No generated files committed.**
- **No new dependency without a stated reason.**
- **No assets without a license row** in `docs/asset-licenses.md`.
- **Do not weaken a check to make it pass** — not the lint config, not a boundary
  rule, not a test. Fix the cause or explain why the rule is wrong.
- **Do not touch `main` directly.** Work on a branch, open a PR.

## 8. Commit messages

Conventional Commits, English subject and body, one focused change per commit.
Add a one-line German summary and the co-author trailer:

```text
feat(world-schema): reject unknown schema versions explicitly

An unsupported schemaVersion now fails with a dedicated message instead of a
field-level error, so contributors see the version problem first.

DE: Unbekannte schemaVersion wird jetzt mit eigener Meldung abgelehnt.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

## 9. Working style

- Read `docs/architecture.md` and the relevant ADR before changing structure.
- Start with the failing test (red first), then make it green.
- Keep the change small enough to review in one sitting.
- If a task needs a decision that is not written down, write the ADR — do not
  decide silently in code.
- When you are unsure whether something is in scope, say so in the PR instead of
  expanding the change.
