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

No third-party assets are bundled in Phase 0. Every asset added later must be
listed in `docs/asset-licenses.md` with source, author, license, usage rights and
modification status (spec §46).
