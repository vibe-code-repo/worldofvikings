# World format

> Status: **Phase 0** — the minimal schema exists; zones, terrain, prefabs and
> triggers are extended from Phase 4 on.

World data lives in `content/worlds/*.json`, never in TypeScript (ADR-0004).
The authoritative definition is `packages/world-schema`.

## Current shape

```json
{
  "schemaVersion": 2,
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
      ],
      "terrain": {
        "heightField": "terrain/village-257.glb",
        "position": [0, 0, 0],
        "size": [300, 300],
        "layers": [
          { "texture": "textures/terrain-grass-a.png", "tileSize": 2 },
          { "texture": "textures/terrain-rock-a.png", "tileSize": 2 }
        ],
        "splat": ["textures/village-splat-a.png"]
      }
    }
  ]
}
```

- `schemaVersion` — the format version. A version this build has a recorded
  migration from is read through it and reported; anything else is rejected
  with a dedicated error message. Nothing on disk is rewritten by reading.
- `id` — lowercase `a-z0-9_-`, must start with a letter or digit.
- `position` / `rotation` / `scale` — `[x, y, z]`, world units (metres).
- Rotations are Euler angles in radians, applied in Babylon's **YXZ** order.
- Objects are strict: unknown fields are an error, not silently dropped.
- Zone ids are unique per world; entity ids are unique per zone.

## Terrain (schemaVersion 2, ADR-0020)

`zone.terrain` is optional: a zone without ground — an interior, a dungeon
level, a zone still being blocked out — simply has no `terrain`.

| Field         | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `heightField` | Asset path of the height field model, e.g. `terrain/village-257.glb`.      |
| `position`    | Where the model's **own origin** lands in world space, `[x, y, z]` m.      |
| `size`        | `[width, depth]` of the tile in metres, along x and z.                     |
| `layers`      | Up to 8 ground textures, each with its `tileSize` in metres.               |
| `splat`       | One or two RGBA weight maps: the first weights layers 1–4, the second 5–8. |

Rules the schema enforces:

- More than one layer needs a splat map; a splat map needs at least one layer.
- `layers.length <= splat.length * 4`. Two RGBA maps carry eight weights and no
  more, which is also the renderer's limit (`MixMaterial`, ADR-0020).
- No layers at all is legal and means one flat colour — useful while blocking
  out, and the honest fallback when a splat map is missing.
- `tileSize` is metres per repeat, not a repeat count. The renderer computes the
  UV scale as `size / tileSize`, so a 2 m gravel texture stays 2 m of gravel
  when the tile is resized.
- `pnpm validate:content` additionally checks that every path a terrain names
  exists in `assets/manifest.json`.

**Where the tile sits.** The asset pipeline writes height fields with their
local origin at the tile's minimum corner and does **not** centre them
(`tooling/asset-pipeline/decimate-height-field.ts`). The alternative — centring
the model and letting `position` be the tile's midpoint — was rejected because
it makes `position` a different thing for terrain than for every entity, and
because a corner-anchored tile reads straight off the height field export
(`0…300 m` in both axes stays `0…300 m` in the file). So `position` is the
tile's minimum corner, and `[0, 0, 0]` covers `0…size`.

**Handedness.** Babylon's glTF loader converts right-handed glTF to a
left-handed scene by scaling the loaded root by `-1` on x. A tile whose file
spans `0…300` therefore covers `-300…0` in Babylon world x. The terrain
renderer undoes that on the tile it creates, so `position` and `size` mean the
same thing in the world file as they do in the scene — measured, not assumed:
see `packages/engine/src/terrain.ts` and ADR-0020.

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
   `CURRENT_WORLD_SCHEMA_VERSION`, add a step to
   `packages/world-schema/src/migrations.ts`, and document it here.
4. Terrain is a _reference_ to an authored height field, never a generator: no
   seed, no noise function, no vertex ever enters a world file (agent rule 16).

## Migrations

| From | To  | Change                                                 |
| ---- | --- | ------------------------------------------------------ |
| 1    | 2   | Zones gained the optional `terrain` object (ADR-0020). |

`parseWorldDefinition` migrates a known older version forward in memory and
sets `migratedFrom` on the result, so the reader can say so. The file on disk
keeps its old version until someone saves it through the API, which writes the
current one — a migration is reported, never silent (agent rule 11).

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
