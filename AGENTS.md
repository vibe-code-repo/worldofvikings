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
picks the world, `?spawn=x,z` where to stand, `?look=yaw[,pitch]` where to aim,
and `?flat=1`, `?shadows=off`, `?shafts=off`, `?shadowFocus=` and `?mute=1` take
the light and the sound apart for a measurement.

The village zone is 5273 entities from 145 models, 4032 of them scattered
vegetation drawn as thin instances (ADR-0025). Its ground is one adaptive tile
whose six layers carry a normal map, a metallic value and a smoothness, and it
reflects the same sky the dome draws (ADR-0032). Behind it stand two painted
mountain shells and 23 clouds, which are a prefab category of their own: never
scattered onto, never picked, never in the shadow map (ADR-0031). It is lit the
way its world file says (ADR-0024): a low evening sun with one following 2048²
shadow map that snaps to its own texels so its edges hold still while the player
walks (ADR-0039), a gradient sky, a cool haze that thickens
exponentially with distance and puts the ground on the same curve as the houses
standing on it, so the range recedes instead of standing dark behind it
(ADR-0034, ADR-0041), a graded frame whose chroma is pulled back by the profile's
own `saturation`, so the village reads matte rather than oversaturated
(ADR-0040) — and shafts of light past the clouds when the player looks at the
sun, gated on the angle to it so that a frame the sun is not in pays nothing at
all for them (ADR-0042). Grass takes that shadow without casting one
(ADR-0027). It sounds the way its world file says (ADR-0062): a wind-and-crows
bed, a fire on every brazier, candle group and chimney, the forge, three animal
one-shots on random intervals, and footsteps whose surface comes from the splat
layer under the player's feet rather than from a constant (ADR-0063) — all of
it authored and audible in the editor, not only in the game. Every entity collides against the shape its prefab declares
(ADR-0026) — 1145 bodies from 210 shared shapes, with 4128 tufts and bushes
deliberately walk-through. A move that meets one of them is dropped onto that
surface's plane rather than thrown away, so walking at a house is walking along
it, and backing out of whatever was walked into always works (ADR-0038). There
is no character model, no combat and no zone streaming.

Two further zones stand in the same world file and are never drawn, because the
client renders the one zone that has ground under it: `interiors` (164 entities)
and `surroundings` (177, among them a ring of 100 cliffs). The ring stays out of
the village until there is ground outside the village tile for it to lean on —
17 of the 100 hang between 3.8 m and 27.2 m above everything this repository
has. That is measured, not assumed, and `pnpm seating` re-measures it
(ADR-0037).

The editor opens and saves worlds through `services/api` (ADR-0017), places
prefabs from the generated catalogue (ADR-0016), and edits them with selection,
move/rotate/scale gizmos, grid and surface snapping and an undo history. It
draws the active zone's ground as scenery a prop can be dropped onto, but not as
something that can be selected or moved. Its one rule is ADR-0018: **the
document is the truth and the scene follows it** — every gesture becomes a
command, and the viewport reconciles. It scatters prefabs over a region as one
undoable command whose output is ordinary entities (ADR-0025), also available as
`pnpm scatter`. Its right-hand column is five inspectors behind five tabs, drawn
from the schemas rather than from a list of field names, so a field added to
`@wov/world-schema` appears with its own range and its own asset picker and
nothing in `apps/editor` changes (ADR-0033). The Zone tab holds the ground: the
`Surface` half turns a layer's metallic, smoothness and bump strength through
the same command `pnpm terrain-surface` uses, and the half below it edits the
rest of the terrain block; which field belongs to which half is the schema's
answer, so no number is offered twice (ADR-0032, ADR-0033). The scene import and
the prefab catalogue run from the **World** menu as well as from the command
line, and a re-import from either keeps the ground, the light and every entity
the bundle never described — a scattered field, a prop dropped by hand — so
re-importing the village reproduces its world file byte for byte (ADR-0036).
There is no component system and no terrain sculpting yet.

**Editor parity (ADR-0033).** Anything a script writes, the editor can write, by
calling the same code. Five right-hand inspectors edit the lighting profile of a
world or a zone, its sound profile, the terrain block and its layer order, and a
prefab's collision shape; an emitter is placed on a selected entity from the
Entity tab and the **Sound** tab's `listen` switch plays the open zone through
the same `applyWorldSound` the game calls (ADR-0062); the **World** menu runs
the scene import and the prefab-catalogue
generator through the API. The panels contain no list of field names — they are
drawn from the Zod schemas, so a field added to `@wov/world-schema` appears in
the editor by itself. A prefab correction goes into `content/prefabs/overrides.json`,
never into the generated `imported.json`. When you add something a script can do
and the editor cannot, that is a gap to close in the same change, not later.

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
pnpm import:backdrop --source <export> --store <store>       # see ADR-0031
pnpm import:audio --source <export> --store <store>          # see ADR-0064
pnpm import:scene --scene <bundle> --world <id> --name <n>   # see ADR-0021, ADR-0028
pnpm scatter --world <id> --zone <id> --region … --prefab … --density … --seed …
                 # one scatter run into a world file (ADR-0025)
pnpm terrain-surface --world <id> --zone <id> --layer <n> --metallic … --smoothness …
                 # a ground layer's surface, through the editor's own command (ADR-0032)
pnpm seating --world <id> --zone <id> [--prefab <substring>]
                 # how far a zone's placements stand above their ground (ADR-0037)
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
