# Architecture Decision Records

Every architectural decision is recorded here (agent rule 15), numbered and
immutable: a decision that changes gets a **new** ADR that supersedes the old
one; the old file stays.

Copy `template.md` to `NNNN-short-title.md` and open a PR together with the
change it describes.

| ADR                                                                           | Title                                                             | Status   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-with-pnpm-workspaces.md)                                 | Monorepo with pnpm workspaces                                     | accepted |
| [0002](0002-babylonjs-as-engine.md)                                           | Babylon.js as rendering engine                                    | accepted |
| [0003](0003-separate-game-and-editor-apps.md)                                 | Game and editor are separate applications                         | accepted |
| [0004](0004-world-data-outside-code-validated-with-zod.md)                    | World data lives outside the code and is validated with Zod       | accepted |
| [0005](0005-fastify-for-the-api.md)                                           | Fastify for the API service                                       | accepted |
| [0006](0006-engine-package-owns-babylon-bootstrap.md)                         | The engine package owns the Babylon.js bootstrap                  | accepted |
| [0007](0007-engine-package-provides-the-base-scene.md)                        | The engine package provides the base scene, as an opt-in          | accepted |
| [0008](0008-third-person-camera-lives-in-the-engine-package.md)               | The third-person camera lives in the engine package               | accepted |
| [0009](0009-gameplay-state-is-plain-data-systems-are-pure-functions.md)       | Gameplay state is plain data, systems are pure functions          | accepted |
| [0010](0010-the-device-edge-and-the-frame-loop-live-in-apps-game.md)          | The device edge and the frame loop live in apps/game              | accepted |
| [0011](0011-asset-loading-caching-and-manifest.md)                            | GLB loading, per-URL caching and an asset manifest                | accepted |
| [0012](0012-vendoring-third-party-assets.md)                                  | Vendoring third-party assets, and two asset-system entries        | accepted |
| [0013](0013-physics-behind-an-interface-with-havok.md)                        | Physics behind an interface, implemented with Havok               | accepted |
| [0014](0014-one-loop-one-device-edge-one-ground.md)                           | One loop, one device edge, one ground                             | accepted |
| [0015](0015-private-asset-store-with-repository-placeholders.md)              | A private asset store, with placeholders in the repository        | accepted |
| [0016](0016-prefab-catalog-editor-document-and-command-history.md)            | Generated prefab catalog, editor document and command history     | accepted |
| [0017](0017-world-files-are-read-and-written-through-the-api.md)              | World files are read and written through the API                  | accepted |
| [0018](0018-editor-viewport-derives-the-scene-from-the-document.md)           | The editor viewport derives the scene from the document           | accepted |
| [0019](0019-material-bindings-and-shared-texture-files-in-the-asset-store.md) | Material bindings and shared texture files in the asset store     | accepted |
| [0020](0020-terrain-as-height-field-plus-splat-layers.md)                     | Terrain as a height field plus splat layers in the world format   | accepted |
| [0021](0021-authored-worlds-are-imported-from-scene-bundles.md)               | Authored worlds are imported from scene bundles                   | accepted |
| [0022](0022-the-game-loads-its-world-from-the-api.md)                         | The game loads its world from the API, and instances its entities | accepted |
| [0023](0023-the-store-is-a-second-source-of-truth-for-the-manifest.md)        | The private store is a second source of truth for the manifest    | accepted |
| [0024](0024-lighting-as-world-data-with-one-shadow-map.md)                    | Lighting is world data, drawn with one following shadow map       | accepted |
| [0025](0025-scatter-is-an-editor-command-whose-result-is-persisted.md)        | Scatter is an editor command whose result is persisted            | accepted |
| [0026](0026-entities-carry-a-collision-shape.md)                              | Entities carry a collision shape, decided at import time          | accepted |
| [0027](0027-small-vegetation-receives-shadow-but-does-not-cast.md)            | Small vegetation receives shadow but does not cast it             | accepted |
| [0028](0028-the-scene-import-carries-authored-blocks-forward.md)              | The scene import carries authored blocks forward                  | accepted |
| [0029](0029-one-babylon-module-one-specifier.md)                              | One Babylon.js module, one import specifier                       | accepted |
| [0030](0030-staging-serves-built-bundles.md)                                  | Staging serves built bundles, not a development server            | accepted |
| [0031](0031-the-backdrop-is-its-own-prefab-category.md)                       | The backdrop is its own prefab category                           | accepted |
| [0032](0032-terrain-layers-carry-a-surface.md)                                | Terrain layers carry a surface, and the ground reflects the sky   | accepted |
| [0033](0033-the-editor-can-do-everything-a-script-can.md)                     | The editor can do everything a script can                         | accepted |
| [0034](0034-the-backdrop-takes-a-fog-that-reaches-past-it.md)                 | The backdrop takes a fog that reaches past it                     | accepted |
| [0035](0035-the-static-world-is-frozen.md)                                    | The static world is frozen                                        | accepted |
| [0036](0036-a-re-import-keeps-the-entities-the-bundle-never-had.md)           | A re-import keeps the entities the bundle never had               | accepted |
| [0037](0037-the-cliff-ring-stays-out-of-the-village.md)                       | The cliff ring stays out of the village                           | accepted |
| [0038](0038-a-blocked-move-slides-along-the-face-it-met.md)                   | A blocked move slides along the face it met                       | accepted |
| [0062](0062-sound-is-world-data-applied-by-one-function.md)                   | Sound is world data, applied by one function both clients call    | accepted |
| [0063](0063-a-footstep-asks-the-splat-map-what-it-landed-on.md)               | A footstep asks the splat map what it landed on                   | accepted |
| [0064](0064-audio-is-an-asset-kind-with-one-silent-placeholder.md)            | Audio is an asset kind, behind one silent placeholder             | accepted |
| [0065](0065-sound-has-one-owner-and-an-explicit-autoplay-state.md)            | Sound has one owner, and an explicit autoplay state               | accepted |
