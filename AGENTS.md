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

Current state: **Phase 4 (the authored world is on screen)** for the game,
**Phase 3 MVP** for the editor.

The game client opens a world through `services/api`, draws that zone's ground
from its height field and splat layers (ADR-0020), places its entities from the
prefab catalogue as GPU instances, and stands a placeholder capsule on the
terrain with a third-person camera and a physics world (ADR-0022). `?world=`
picks the world, `?spawn=x,z` where to stand, `?flat=1` and `?shadows=off` take
the light apart for a measurement.

The village zone is 5248 entities from 140 models, 4032 of them scattered
vegetation drawn as thin instances (ADR-0025). It is lit the way its world file
says (ADR-0024): a low evening sun with one following 2048² shadow map, a
gradient sky, fog and a graded frame. Grass takes that shadow without casting
one (ADR-0027). Every entity collides against the shape its prefab declares
(ADR-0026) — 1145 bodies from 210 shared shapes, with 4103 tufts and bushes
deliberately walk-through. There is no character model, no combat and no zone
streaming.

The editor opens and saves worlds through `services/api` (ADR-0017), places
prefabs from the generated catalogue (ADR-0016), and edits them with selection,
move/rotate/scale gizmos, grid and surface snapping and an undo history. It
draws the active zone's ground as scenery a prop can be dropped onto, but not as
something that can be selected or moved. Its one rule is ADR-0018: **the
document is the truth and the scene follows it** — every gesture becomes a
command, and the viewport reconciles. It scatters prefabs over a region as one
undoable command whose output is ordinary entities (ADR-0025), also available as
`pnpm scatter`. There is no component system and no terrain sculpting yet.

The client has exactly one loop, one device edge and one ground query — read
[ADR-0014](docs/adr/0014-one-loop-one-device-edge-one-ground.md) before adding a
second of any of them.

## 2. Folder responsibilities

| Path                     | Owns                                            | Never contains                   |
| ------------------------ | ----------------------------------------------- | -------------------------------- |
| `apps/website`           | Public site, Play link                          | Game or editor logic             |
| `apps/game`              | Game client bootstrap, world loading, HUD       | Editor code, authored world data |
| `apps/editor`            | React editor shell, panels, viewport            | Game-only logic, world rules     |
| `services/api`           | HTTP service                                    | Gameplay rules                   |
| `packages/shared`        | Framework-free helpers                          | Any dependency                   |
| `packages/world-schema`  | Zod schemas + versioning for world data         | Babylon.js, React                |
| `packages/asset-system`  | Asset URLs, GLB loading/caching, manifest       | Gameplay                         |
| `packages/content-build` | Scene import and prefab catalogue, as functions | Babylon.js, React, a CLI         |
| `packages/engine`        | Shared renderer layer                           | Gameplay state                   |
| `packages/physics`       | Physics contract + Havok backend                | Gameplay rules                   |
| `packages/gameplay`      | Gameplay state and systems                      | Any renderer import              |
| `packages/editor-core`   | Editor-only logic                               | Anything the game needs          |
| `packages/ui`            | Framework-free UI tokens/helpers                | React components                 |
| `content/`               | Authored JSON game data                         | TypeScript                       |
| `assets/`                | Public binary assets + placeholders             | Anything unlicensed              |
| `tooling/`               | Scripts, validators, smoke tests                | Shipped code                     |
| `infrastructure/`        | Deployment scaffolding (empty in Phase 1)       | Anything needed for local dev    |
| `docs/`                  | Architecture, formats, ADRs                     | Generated output                 |

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
pnpm validate    # validate:content + validate:assets
pnpm validate:content         # content/ against @wov/world-schema
pnpm validate:assets          # manifest against assets/, placeholders and the store
pnpm validate:assets --write  # re-measure sizes and hashes (never invents provenance)
pnpm import:world-assets --source <export> --store <store>   # see ADR-0015
pnpm import:scene-models --scene <bundle> --store <store>    # see ADR-0021
pnpm import:scene --scene <bundle> --world <id> --name <n>   # see ADR-0021, ADR-0028
pnpm scatter --world <id> --zone <id> --region … --prefab … --density … --seed …
                 # one scatter run into a world file (ADR-0025)
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
in the DOM plus `/health` for the API and the asset server. It also drives the
editor end to end — open a world, place a prefab, drag the gizmo, save, undo —
against an API on its own port with a throwaway `CONTENT_DIR`, so it writes real
files without touching the repository and can run while `pnpm dev` is up.

It asks Chromium for ANGLE on the machine's own driver: headless Chromium
rasterises in software otherwise, and a village of 3.9 M triangles a frame runs
at about 0.2 fps there, which fails tests for reasons that have nothing to do
with what they assert. The flags are a request — where no GPU answers, Chromium
falls back to software as before. Set `SMOKE_WEBSITE_PORT`, `SMOKE_GAME_PORT`,
`SMOKE_ASSET_PORT`, `SMOKE_API_PORT` and `SMOKE_EDITOR_PORT` when another
checkout is already running the suite.

If you changed something visible and did not run the smoke test, say so
explicitly instead of implying it passed.

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
   `test-results/`, `coverage/`). The one exception is `assets/placeholders/`,
   which exists so a clone that cannot run the generator still runs (ADR-0015).
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
- **No physics backend outside its two owners.** Only
  `packages/physics/src/havok.ts` and `apps/game/src/physics-backend.ts` may name
  `@babylonjs/havok` or `@wov/physics/havok`; everything else uses the
  `PhysicsWorld` contract (ADR-0008).
- **No world data in TypeScript.** It belongs in `content/` with a
  `schemaVersion`.
- **No silent format changes.** Bump `CURRENT_WORLD_SCHEMA_VERSION` and write a
  migration.
- **No secrets committed.** Only `.env.example` with non-secret local defaults.
- **No `any`, no unexplained `@ts-ignore`.**
- **No generated files committed.**
- **No new dependency without a stated reason.**
- **No assets without provenance.** `source`, `author`, `license`,
  `redistributable` and `origin` are manifest fields and the schema rejects a
  blank one; `docs/asset-licenses.md` carries the per-set summary. Anything
  whose redistribution rights are unsettled goes into the private asset store as
  `visibility: private`, never into `assets/` (ADR-0015).
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
