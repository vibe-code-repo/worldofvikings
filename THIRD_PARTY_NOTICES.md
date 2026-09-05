# Third-party notices

World of Vikings source code is licensed under the MIT License (see `LICENSE`).
It builds on the third-party software listed below, each under its own license.
This file lists direct dependencies; run `pnpm licenses list` for the full
transitive tree.

## Runtime dependencies

| Package              | License    | Used by                    | Why                                  |
| -------------------- | ---------- | -------------------------- | ------------------------------------ |
| `@babylonjs/core`    | Apache-2.0 | `apps/game`, `apps/editor` | Rendering engine (ADR-0002)          |
| `react`, `react-dom` | MIT        | `apps/editor`              | Editor UI (spec §2.1)                |
| `zod`                | MIT        | `packages/world-schema`    | World data validation (ADR-0004)     |
| `fastify`            | MIT        | `services/api`             | HTTP service (ADR-0005)              |
| `@fastify/cors`      | MIT        | `services/api`             | Cross-origin access for the dev apps |

## Development dependencies

| Package                                                               | License    | Why                                                  |
| --------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| `vite`, `@vitejs/plugin-react`                                        | MIT        | Dev server and bundler                               |
| `typescript`                                                          | Apache-2.0 | Language and type checking                           |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` | MIT        | Linting                                              |
| `prettier`                                                            | MIT        | Formatting                                           |
| `vitest`                                                              | MIT        | Unit tests                                           |
| `@playwright/test`                                                    | Apache-2.0 | Smoke tests                                          |
| `dependency-cruiser`                                                  | MIT        | Architecture boundary checks                         |
| `concurrently`                                                        | MIT        | Runs the dev servers with one command                |
| `tsx`                                                                 | MIT        | Runs TypeScript tooling scripts without a build step |
| `@types/node`, `@types/react`, `@types/react-dom`                     | MIT        | Type definitions                                     |

## Assets

| Asset set                                                           | License | Author | Used by     | Why                                        |
| ------------------------------------------------------------------- | ------- | ------ | ----------- | ------------------------------------------ |
| [Retro Fantasy Kit 2.0](https://kenney.nl/assets/retro-fantasy-kit) | CC0 1.0 | Kenney | `apps/game` | First licensed environment asset (Phase 1) |

Kenney's kits are released under [CC0
1.0](https://creativecommons.org/publicdomain/zero/1.0/) and require no
attribution; the credit above is given because Kenney asks for it. The files are
vendored unmodified under
`assets/environment/kenney-retro-fantasy-kit/`, which holds the full provenance
record.

Every asset is additionally listed file by file in `docs/asset-licenses.md` with
source, author, license, usage rights and modification status (spec §46). No
asset is merged without that row.
