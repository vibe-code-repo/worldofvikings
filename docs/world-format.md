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
          "id": "tree_001",
          "prefab": "pine_tree_01",
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

Checks every file in `content/worlds/`. Runs in CI.

## Planned (not implemented)

`ZoneDefinition` streaming metadata, terrain, prefab definitions, spawn points,
triggers, audio zones, quest markers, and the published-world manifest with per
zone versions (spec §36).
