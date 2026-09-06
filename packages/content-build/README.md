# @wov/content-build

The content build steps, as functions instead of scripts.

## Purpose

Two jobs turn source material into files under `content/`:

- **scene import** — read an authored scene bundle and write
  `content/worlds/<id>.json` (ADR-0021, ADR-0028);
- **prefab catalogue generation** — read `assets/manifest.json` and write
  `content/prefabs/imported.json` (ADR-0016, ADR-0026).

Both used to live only in `tooling/scripts/`, which made them things a person
with a terminal could do and the editor could not. ADR-0033 closes that gap:
the decisions moved here, `tooling/` kept the command line around them, and
`services/api` runs the same functions for the editor's **World** menu.

Nothing here prints. Every entry point answers a result value — the world or
the catalogue, plus a report of numbers and lists — and the caller renders it
as a terminal report or as a panel.

## Public API

| Export                                                  | What it does                                    |
| ------------------------------------------------------- | ----------------------------------------------- |
| `importSceneBundle(options)`                            | bundle → `<contentDir>/worlds/<id>.json`        |
| `generatePrefabCatalog(options)`                        | manifest → `<contentDir>/prefabs/imported.json` |
| `readGlb` / `writeGlb` / `worldBounds` / `nodeMatrix` … | binary glTF, with `node:` built-ins only        |
| `measureTrunkBox` / `roundBounds`                       | a tree's collision box, measured on the model   |
| `scanScene` / `decompose` / `carryOverAuthoredBlocks`   | the scene-import rules, as pure functions       |
| `buildImportedCatalog` / `prefabCollisionFor` …         | the catalogue rules, as pure functions          |
| `loadPrefabStems`                                       | `content/prefabs/` indexed by store file name   |

## Dependencies

`@wov/world-schema` (what a world and a prefab catalogue are) and
`@wov/asset-system/manifest` (what the asset manifest is). Node built-ins are
allowed: this package reads and writes files, and both of its callers are Node.

**No Babylon.js and no React.** Nothing here draws, and the package must stay
loadable inside a Fastify request.

## Ownership

Changes to the import rules belong here and are covered by the tests next to
them. The command-line wrappers are `tooling/scripts/import-scene.ts` and
`tooling/scripts/generate-prefabs.ts`; the HTTP wrapper is
`services/api/src/actions-routes.ts`. A rule added to one of those three
instead of to this package is the bug ADR-0033 exists to prevent.
