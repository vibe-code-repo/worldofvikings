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
- `position` / `rotation` / `scale` — `[x, y, z]`, in the units below.
- Objects are strict: unknown fields are an error, not silently dropped.
- Zone ids are unique per world; entity ids are unique per zone.

## The transform, exactly

A world file is written in **Babylon's left-handed, y-up coordinates**. All
three fields are optional in the schema and default to no movement, no turn and
no resize.

| Field      | Unit                   | Meaning                                               |
| ---------- | ---------------------- | ----------------------------------------------------- |
| `position` | metres                 | Where the prefab's origin stands.                     |
| `rotation` | **radians**, **Y-X-Z** | Yaw, then pitch, then roll — `R = Ry(y)·Rx(x)·Rz(z)`. |
| `scale`    | factor                 | Negative components are allowed and meaningful.       |

**Radians and Y-X-Z are not a preference.** `apps/editor` writes these three
numbers straight into a Babylon `TransformNode`, and `TransformNode.rotation` is
Euler yaw-pitch-roll in radians. Writing degrees, or X-Y-Z, would put every
tilted rock in the world at a wrong angle while every upright one still looked
right. Anything producing a world file inverts exactly that product;
`tooling/scripts/scene-import.ts` does, and its test proves the round trip
including the gimbal case.

**A negative scale component mirrors the prefab**, and it is kept rather than
normalised away: a level built from a kit mirrors modules on purpose, and
turning them the right way round would silently redesign the building.

### Coordinates when importing

The modelling export is not internally consistent about x: the **scene bundle's
exporter negated it and the height field's exporter did not**. An importer
therefore mirrors the bundle's transforms on x — `S·M·S` with
`S = diag(-1, 1, 1)`, which is the same thing as negating the position's x and
turning the quaternion `(x, y, z, w)` into `(x, -y, -z, w)` with the scale left
alone.

That is a measurement, not a convention. Against the village height field
(513 × 513 samples over 300 × 300 m):

|              | inside the terrain              | median height above ground | within 3 m of the ground |
| ------------ | ------------------------------- | -------------------------- | ------------------------ |
| mirrored     | 1 216 of 1 216 village entities | +0.61 m                    | 98.3 %                   |
| not mirrored | **0** of 1 216                  | —                          | —                        |

Twelve props sampled evenly across the village sit on average 1.03 m above the
terrain below them, which is what an authored ground-contact origin on sloped
ground looks like.

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
(`tooling/asset-pipeline/terrain-import.ts`). The alternative — centring
the model and letting `position` be the tile's midpoint — was rejected because
it makes `position` a different thing for terrain than for every entity, and
because a corner-anchored tile reads straight off the height field export
(`0…300 m` in both axes stays `0…300 m` in the file). So `position` is the
tile's minimum corner, and `[0, 0, 0]` covers `0…size`.

**Handedness.** Babylon's glTF loader converts right-handed glTF into a
left-handed scene with a transform on the root it creates: a half turn about y
_and_ a `-1` scale on z. Undoing only the scale leaves a `0…300` tile at
`-300…0` — measured in the browser, not assumed — so the terrain renderer clears
the whole transform (`clearLoaderTransform`). `position` and `size` therefore
mean the same thing in the world file as they do in the scene, and the same
thing they mean for an entity, whose `position` the loader never touches.

**Splat channels.** Which channel drives which layer is a property of the map,
not of the format: layer _n_ is weighted by channel _n_ (r, g, b, a of the first
map, then of the second). For the village tile that order was measured — each
channel's weight correlated against the height field's own slope, then three
candidate orders rendered and compared — and is recorded in ADR-0020 and in the
`layers` of `content/worlds/village1.json`, in this order:

| Channel | Coverage | Mean slope | Layer                |
| ------- | -------- | ---------- | -------------------- |
| A.r     | 3.5 %    | 0.60       | `terrain-grass-b`    |
| A.g     | 16.8 %   | 1.01 ↑     | `terrain-rock-a`     |
| A.b     | 57.4 %   | 0.47 ↓     | `terrain-grass-a`    |
| A.a     | 15.3 %   | 0.38 ↓     | `terrain-gravel`     |
| B.r     | 0.1 %    | 3.35 ↑↑    | `terrain-rock-rough` |
| B.g     | 6.8 %    | 0.73       | `terrain-moss`       |

The tile's own mean slope is 0.57 and its 99th percentile 3.30.

A splat map is also stored **turned onto the ground's axes** by the import
(`tooling/asset-pipeline/terrain-import.ts`), so a world file needs no axis
field and a renderer samples it as `uv = (x, z) / size`.

**Who draws it.** The game draws the ground of the zone it opens and hands its
triangles to physics, so the surface the player sees is the surface the player
stands on (ADR-0022). The editor draws it as scenery: visible, and what surface
snapping drops a prop onto, but not selectable and not movable — terrain
editing is a later phase.

**Ground survives a re-import.** `pnpm import:scene` rewrites a world file from
its bundle, and a `terrain` block is not in any bundle: it is carried over from
the file being replaced, per zone id, and named in the run report. Re-running
the importer therefore does not take the ground out from under the placements.

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

## Where an authored world comes from

`content/worlds/village1.json` is not hand-typed. It is imported from a scene
bundle — a single large GLB whose node hierarchy is a whole authored level —
by two commands, in this order (ADR-0021):

```bash
pnpm import:scene-models --scene <bundle.glb> --store <store>   # bundle-only models
pnpm generate:prefabs                                           # then the catalogue
pnpm import:scene --scene <bundle.glb> --world <id> --name <name>
```

An import is a **transcription, not a generator** (AGENTS §7, rule 16): every
number it writes is a measurement of the bundle, two runs produce the same
bytes, and everything it does not recognise is reported by name rather than
dropped. `--zone-root <node>` imports a single named subtree instead of the
default zones, and `--dry-run` reports without writing.

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
