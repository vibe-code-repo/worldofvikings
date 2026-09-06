# World format

> Status: **Phase 0** — the minimal schema exists; zones, terrain, prefabs and
> triggers are extended from Phase 4 on.

World data lives in `content/worlds/*.json`, never in TypeScript (ADR-0004).
The authoritative definition is `packages/world-schema`.

## Current shape

```json
{
  "schemaVersion": 1,
  "id": "example",
  "name": "Example World",
  "zones": [
    {
      "id": "village",
      "name": "Village",
      "entities": [
        {
          "id": "barrel_001",
          "prefab": "barrel-01",
          "position": [24.3, 1.2, -56.4],
          "rotation": [0, 2.1, 0],
          "scale": [1.1, 1.1, 1.1]
        }
      ]
    }
  ]
}
```

- `schemaVersion` — the format version. Files with another version are rejected
  with a dedicated error message; they are never silently migrated.
- `id` — lowercase `a-z0-9_-`, must start with a letter or digit.
- `position` / `rotation` / `scale` — `[x, y, z]`, world units (metres).
- Objects are strict: unknown fields are an error, not silently dropped.
- Zone ids are unique per world; entity ids are unique per zone.

## Prefab catalogs

Prefabs live in `content/prefabs/*.json` and are what an entity's `prefab` field
points at (spec §19, ADR-0016). A catalog is a file; a prefab id is unique
across **all** catalogs, because an entity names the id alone.

```json
{
  "schemaVersion": 1,
  "id": "base",
  "prefabs": [
    {
      "id": "barrel-01",
      "name": "Barrel",
      "asset": "environment/kenney-retro-fantasy-kit/detail-barrel.glb",
      "visibility": "public",
      "category": "prop",
      "bounds": { "min": [-0.123, 0, -0.123], "max": [0.123, 0.3, 0.123] }
    }
  ]
}
```

- `asset` — path relative to the asset root, forward slashes, no `..`. The rule
  is stated a second time here instead of imported from `@wov/asset-system`, so
  that content stays validatable without an asset pipeline (ADR-0016).
- `visibility` — `public` (ships in `assets/`) or `private` (private store).
- `placeholder` — required for `private`, forbidden for `public` (ADR-0015).
- `category` — `environment`, `vegetation`, `terrain`, `prop` or `dungeon`; the
  grouping the editor's asset browser uses (spec §13).
- `bounds`, `defaultScale` — optional; `bounds` is copied from the manifest.

`content/prefabs/base.json` is hand-written. `content/prefabs/imported.json` is
generated from the asset manifest by `pnpm generate:prefabs` and committed — it
is authored data derived once, not a runtime generator (ADR-0016).

## Rules

1. Entities reference a **prefab**; geometry is never inlined (spec §19).
2. The world is authored, not generated. Editor scatter tools may randomise, but
   the result is written into the file (spec §11, §12).
3. Never change the format silently. A change means: bump
   `CURRENT_WORLD_SCHEMA_VERSION`, write a migration, document it here.

## Validation

```bash
pnpm validate
```

Checks every file in `content/worlds/` and `content/prefabs/`, and that every
`prefab` an entity references exists in exactly one catalog. Runs in CI.

## Reading and writing

The editor runs in a browser and cannot touch the file system, so world files
are read and written through `services/api` (ADR-0017):

| Route             | Answer                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `GET /worlds`     | `{ worlds: [{ id, name, zones, updatedAt }], invalid: [{ id, errors }] }` |
| `GET /worlds/:id` | The world — 404 unknown, 422 when the stored file fails validation        |
| `PUT /worlds/:id` | Writes it — 201 created, 200 replaced, 400 invalid body, 403 read-only    |

A world id is also the file name, so it must match the identifier rule above;
anything else is refused before a file is touched. `PUT` validates the body with
`parseWorldDefinition`, requires the body's `id` to match the url, and writes
the file atomically (temporary file plus rename) in exactly the formatting
Prettier produces, with the fields in schema order. A saved world is therefore a
normal, reviewable file: `pnpm format:check` stays green and `git diff` shows
only what changed.

`WORLDS_READ_ONLY=1` turns every write into 403. Deployments that carry official
content set it — editor clients never publish into production data directly
(spec §49).

## Planned (not implemented)

`ZoneDefinition` streaming metadata, terrain, spawn points,
triggers, audio zones, quest markers, and the published-world manifest with per
zone versions (spec §36).
