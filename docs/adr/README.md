# Architecture Decision Records

Every architectural decision is recorded here (agent rule 15), numbered and
immutable: a decision that changes gets a **new** ADR that supersedes the old
one; the old file stays.

Copy `template.md` to `NNNN-short-title.md` and open a PR together with the
change it describes.

| ADR                                                        | Title                                                       | Status   |
| ---------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-monorepo-with-pnpm-workspaces.md)              | Monorepo with pnpm workspaces                               | accepted |
| [0002](0002-babylonjs-as-engine.md)                        | Babylon.js as rendering engine                              | accepted |
| [0003](0003-separate-game-and-editor-apps.md)              | Game and editor are separate applications                   | accepted |
| [0004](0004-world-data-outside-code-validated-with-zod.md) | World data lives outside the code and is validated with Zod | accepted |
| [0005](0005-fastify-for-the-api.md)                        | Fastify for the API service                                 | accepted |
