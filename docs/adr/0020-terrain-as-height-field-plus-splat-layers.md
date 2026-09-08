# ADR-0020: Terrain as a height field plus splat layers in the world format

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

The game walks a capsule across a 100 m plane. The world format describes zones
and the prefabs placed in them, and says nothing about the ground. The
world-building material that is being brought in carries twelve terrain tiles as
height fields, together with control maps and surface textures — the village tile
is 300 × 300 m of authored landscape with paths, meadows and rock faces already
painted onto it.

Four things have to be true at once.

**The ground is authored, never generated** (agent rule 16, AGENTS §7). Whatever
goes into the format must be a _reference_ to a file somebody made, not a seed.

**The file is not usable as exported.** The village height field is a regular
513 × 513 grid — 524 288 triangles, 14 MB — and its `TEXCOORD_0` is all zeros,
so every ground texture would sample a single texel. Its vertex order is neither
row-major nor a space-filling curve.

**The ground must also be collision geometry.** The movement system asks a
`GroundQuery` where the floor is (ADR-0014). A tile that is drawn but not
collidable is exactly the failure that looks correct in a screenshot.

**Two facts about the export are not recorded anywhere**: which control-map
channel drives which surface texture, and which way round the control map's axes
are relative to the height field's. Both had to be measured.

## Decision

### 1. `zone.terrain` in the world format, at schema version 2

A zone gains an optional `terrain`:

```json
{
  "heightField": "terrain/terrain-village1-257.glb",
  "position": [0, 0, 0],
  "size": [300, 300],
  "layers": [{ "texture": "textures/terrain-grass-b.png", "tileSize": 2 }],
  "splat": ["textures/village-splat-a.png", "textures/village-splat-b.png"]
}
```

Up to eight layers, one or two RGBA splat maps, `tileSize` in **metres per
repeat** rather than as a repeat count, so resizing a tile does not resize its
gravel. The schema refuses a layer no splat channel can weight and a splat map
that weights nothing, so an impossible ground fails validation instead of
rendering wrong. `pnpm validate:content` additionally checks that every path a
terrain names is declared in `assets/manifest.json`.

The change is additive, so **version 1 files are migrated rather than rejected**:
`packages/world-schema/src/migrations.ts` holds one recorded step per version,
`parseWorldDefinition` reports `migratedFrom`, and nothing on disk is rewritten
by reading it. This is a change of policy from "another version is an error" and
is what keeps agent rule 11 — never change a format silently — a promise rather
than an obstacle.

### 2. The pipeline rebuilds a height field instead of repacking it

`tooling/asset-pipeline/height-field.ts` reads the export as a grid **by vertex
coordinate** — the file's vertex order is measured, not assumed — keeps every
second row and column, and writes positions, normals, UVs and indices from
scratch: 257², 131 072 triangles, 3.5 MB. Normals come from central differences
on the grid, which is exact for a height field and cannot disagree with the
triangle winding; UVs span the tile once, because how often a _texture_ repeats
is the world file's business.

Thinning **samples** rather than averages: every vertex of the thinned tile is a
vertex of the source, so the collision mesh still touches the original surface
wherever it has a vertex.

The result is a second store file (`…-257.glb`) beside the source-fidelity one,
so nothing is replaced. This is the one place the pipeline writes geometry;
`glb.ts` remains explicit that it touches the container only.

### 3. The tile keeps its corner origin; `position` places it

The general import centres a terrain on x/z, because those origins are container
corners rather than authored anchors. A thinned tile does **not**: it keeps the
`0…300 m` span the export gave it, and `terrain.position` is the tile's minimum
corner. The alternative — centring the model and letting `position` be the
midpoint — was rejected because `position` would then mean something different
for terrain than for every entity in the same file.

Babylon's glTF loader converts handedness with a transform on the `__root__` it
creates: a half turn about y **and** a `-1` scale on z. Undoing only the scale
left the tile at `x, z ∈ [-300, 0]` — measured in the browser, not assumed — so
`clearLoaderTransform` clears the whole local transform. An entity's `position`
is written straight onto a node and is never mirrored; ground and entities have
to agree, and this is what makes them agree.

### 4. A generated shader, not `MixMaterial`

`MixMaterial` from `@babylonjs/materials` is the obvious candidate: two mix maps,
eight diffuse textures, exactly the shape of the data. It was measured against
the real export and rejected, and the dependency is not added.

- Its blend is a chain of `mix()` in which the fourth and eighth layers are
  weighted by `1.0 - a`, not by `a`. The exported maps hold one weight per layer
  and sum to ~1 across all six channels; the first map's alpha averages 0.15, so
  layer 4 would cover the tile at 85 % strength.
- It refuses to become ready unless _all four_ diffuse slots of a bound mix map
  are set. The village tile has six layers across two maps, and the second map's
  blue and alpha channels are a measured constant 0 — under `1.0 - a`, whatever
  filled slot 8 would cover everything.

Both are properties of its formula, not settings. `packages/engine/src/terrain-shader.ts`
generates the GLSL for the number of layers a tile actually has: a normalised
weighted sum, a fallback to layer 0 where nothing is painted, and the scene's own
sun, fill light and fog read off the scene rather than restated. A two-layer tile
compiles two texture fetches. The generator is Babylon-free, so the strings are
asserted in a unit test.

### 5. Collision through the existing contract

`apps/game` hands the tile's meshes to `PhysicsWorld.addStaticMesh` via the
`toStaticMeshData` bridge that already existed, and only then switches the
placeholder plane off — so there is never a frame in which the player has nothing
to stand on. No new physics concept, no second ground query (ADR-0014).

## The two measurements

**Which channel drives which texture.** Each channel's weight was correlated
against the height field's own slope over all 512² texels:

| Channel | Coverage | Mean slope | Chosen texture  |
| ------- | -------- | ---------- | --------------- |
| A.r     | 3.5 %    | 0.60       | second grass    |
| A.g     | 16.8 %   | 1.01 ↑     | dark rock wall  |
| A.b     | 57.4 %   | 0.47 ↓     | meadow grass    |
| A.a     | 15.3 %   | 0.38 ↓     | gravel and sand |
| B.r     | 0.1 %    | 3.35 ↑↑    | rough rock      |
| B.g     | 6.8 %    | 0.73       | dark moss       |

The tile's mean slope is 0.57 and its 99th percentile 3.30. `A.g` is the only
channel that rises with the ground and `A.a` the only one that clearly falls with
it; `B.r` sits on the top percent of the steepest ground and covers a tenth of a
percent of the tile. Three candidate orders were then rendered and compared —
the naive identity order paints sand over 57 % of a village meadow.

**Which way round the control map is.** The same statistic over all eight ways
to turn or mirror a square map: seven give a mean slope of 0.49–1.56 under the
rough-rock channel, one gives **3.39**. That one is the mirror on the
anti-diagonal, and it was confirmed by two screenshots — at a point the map says
is a gravel path, and at a point it says is a rock face. The turn is applied in
the **import**, so the store holds a map in the obvious convention, a world file
needs no axis field, and the manifest's `origin` records that it happened.

_Amended 2026-09-07 by [ADR-0043](0043-the-village-control-map-was-turned-one-flip-short.md):
the turn is a **quarter turn clockwise**, which is this mirror composed with a
vertical flip. The statistic above is the right statistic and the placement it
picks is the right placement; the composition written into the importer was one
flip short of it, so the village was painted mirrored about the middle of the
tile for as long as this ADR stood. `pnpm validate:assets` now re-measures it on
the stored bytes._

## Consequences

- `CURRENT_WORLD_SCHEMA_VERSION` is 2; version 1 files still load, and a saved
  file is written at version 2.
- Every future format change needs a step in `migrations.ts`, not just a bump.
- `@wov/engine` gains a terrain renderer and no new dependency.
- The game's ground is real terrain with real collision; the base scene's plane
  stays as the stand-in until it loads and is switched off afterwards.
- Layer order and splat orientation are recorded facts about _this_ export. A
  second tile from another source is a second measurement, not an assumption.
- Not decided here: multiple tiles per zone, terrain LOD, streaming, and a
  terrain sculpting tool in the editor. `terrain` is one tile per zone today.
