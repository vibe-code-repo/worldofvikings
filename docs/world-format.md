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
