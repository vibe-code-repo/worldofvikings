# Architecture Decision Records

Every architectural decision is recorded here (agent rule 15), numbered and
immutable: a decision that changes gets a **new** ADR that supersedes the old
one; the old file stays.

Copy `template.md` to `NNNN-short-title.md` and open a PR together with the
change it describes.

| ADR                                                                     | Title                                                       | Status   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-monorepo-with-pnpm-workspaces.md)                           | Monorepo with pnpm workspaces                               | accepted |
| [0002](0002-babylonjs-as-engine.md)                                     | Babylon.js as rendering engine                              | accepted |
| [0003](0003-separate-game-and-editor-apps.md)                           | Game and editor are separate applications                   | accepted |
| [0004](0004-world-data-outside-code-validated-with-zod.md)              | World data lives outside the code and is validated with Zod | accepted |
| [0005](0005-fastify-for-the-api.md)                                     | Fastify for the API service                                 | accepted |
| [0006](0006-engine-package-owns-babylon-bootstrap.md)                   | The engine package owns the Babylon.js bootstrap            | accepted |
| [0007](0007-engine-package-provides-the-base-scene.md)                  | The engine package provides the base scene, as an opt-in    | accepted |
| [0008](0008-third-person-camera-lives-in-the-engine-package.md)         | The third-person camera lives in the engine package         | accepted |
| [0009](0009-gameplay-state-is-plain-data-systems-are-pure-functions.md) | Gameplay state is plain data, systems are pure functions    | accepted |
| [0010](0010-the-device-edge-and-the-frame-loop-live-in-apps-game.md)    | The device edge and the frame loop live in apps/game        | accepted |
| [0011](0011-asset-loading-caching-and-manifest.md)                      | GLB loading, per-URL caching and an asset manifest          | accepted |
| [0012](0012-vendoring-third-party-assets.md)                            | Vendoring third-party assets, and two asset-system entries  | accepted |
