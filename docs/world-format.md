# World format

> Status: **Phase 0** — the minimal schema exists; zones, terrain, prefabs and
> triggers are extended from Phase 4 on.

World data lives in `content/worlds/*.json`, never in TypeScript (ADR-0004).
The authoritative definition is `packages/world-schema`.

## Current shape

```json
{
  "schemaVersion": 3,
  "id": "example",
  "name": "Example World",
  "lighting": {
    "sun": { "direction": [0.58, -0.45, 0.68], "color": "#ffd2a1", "intensity": 2.3 },
    "fog": { "enabled": true, "start": 80, "end": 1700, "color": "#b4c0cc" }
  },
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
- `lighting` is optional on the world and on a zone (schemaVersion 3, ADR-0024).
- `sound` is optional on the world and on a zone (schemaVersion 5, ADR-0062).

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

## Lighting (schemaVersion 3, ADR-0024)

`lighting` says how a world — or one zone of it — is lit. It is optional, and
optional all the way down: every group and every field inside it may be left
out, and what is left out comes from `defaultLightingProfile` in `@wov/engine`.
A world file that says nothing about light still opens, lit; a file that says
`{"fog": {"end": 180}}` changes one distance and nothing else.

A zone's profile overrides the world's **group by group and field by field**, so
an interior can be dark under a world that is not, keeping the same sun.

| Group            | Fields                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `sun`            | `direction` (the direction light _travels_), `color`, `intensity`                     |
| `ambient`        | `skyColor`, `groundColor`, `intensity` — the hemispheric fill                         |
| `sky`            | `enabled`, `zenithColor`, `horizonColor`, `sunColor`, `sunSpread`, `groundReflection` |
| `fog`            | `enabled`, `start`, `end` in metres, `color` (defaults to the sky's horizon)          |
|                  | `end` also decides whether the painted distance hazes: a backdrop takes the fog only  |
|                  | when the fog reaches past it, so a short `end` cannot flatten the horizon (ADR-0034)  |
| `shadows`        | `enabled`, `mapSize`, `distance`, `bias`, `normalBias`, `darkness`, `filter`          |
| `postProcessing` | `enabled`, `fxaa`, `toneMapping`, `exposure`, `contrast`, `bloom`, `vignette`, `ssao` |

Colours are `#rrggbb`. `mapSize` is a power of two from 256 to 4096.
`toneMapping` is one of `none`, `standard`, `aces`, `neutral`; `shadows.filter`
one of `none`, `poisson`, `pcf`. `shadows.darkness` is 0 for black shade and 1
for no shadow at all — Babylon's convention, and the ground's shader uses the
same one.

Two fields are worth a sentence because they are the ones that decide how a
scene reads:

- `shadows.distance` is the edge length in metres of the square the shadow map
  covers, centred on the player. `mapSize / distance` is the ground each shadow
  texel covers, and that — not the resolution alone — is what decides whether a
  fence post has a shadow or a smudge. The village uses 2048 over 120 m.
- `ambient.intensity` against `sun.intensity` is the difference between evening
  and noon. A bright fill puts light back into the shade as fast as the sun digs
  it out, which is what makes a scene look flat however warm the sun is.

`?flat=1` on the game's URL replaces the world's profile with a flat-noon one
(no shadows, no sky, no fog, no grading), so a screenshot can be compared
against the same frame with no rig at all.

## Sound (schemaVersion 5, ADR-0062)

`sound` says how a world — or one zone of it — sounds. Like `lighting` it is
optional all the way down, and what is left out comes from
`defaultSoundProfile` in `@wov/engine`. Unlike lighting, the default is
**silence**: a scene has to be lit by something or it is a black frame, but a
scene that names no clips has nothing to play, and inventing a wind loop for
every world that never asked for one would be the renderer deciding what the
game sounds like.

A zone's profile overrides the world's group by group and field by field. The
two _lists_ — `emitters` and `footsteps.banks` — replace whole rather than
merging, so `"emitters": []` on a zone is how a zone says "none of the world's".

| Group          | Fields                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `master`       | `volume`, `muted` — authored silence, not the same thing as `?mute=1`                             |
| `ambience`     | `enabled`, `clip`, `volume`, `fadeSeconds`, `loopStart`, `loopEnd` — one non-spatial bed          |
| `footsteps`    | `enabled`, `volume`, `strideWalk`, `strideSprint`, `minInterval`, `pitchJitter`, `layerSurfaces`, |
|                | `defaultSurface`, `banks` — a bank is `{ surface, clips[], volume? }`                             |
| `emitters`     | a list; see below                                                                                 |
| `cullDistance` | metres past which a placed sound is paused rather than kept running                               |

**A stride is metres, not seconds.** A footstep clock that ticks in time keeps
playing while the player stands against a wall and speeds up downhill;
`minInterval` is only the floor underneath, so that the collision solver pushing
the capsule along a wall (ADR-0038) cannot become a burst.

**`layerSurfaces` is parallel to `terrain.layers`,** one surface id per layer in
layer order. The village's six layers — gravel, rock, grass, gravel, rough rock,
moss — map onto two banks: `["gravel", "gravel", "grass", "gravel", "gravel",
"grass"]`. `pnpm validate:content` checks the length against the terrain, and
ADR-0062 records moving the field onto the layer itself as a follow-up.

**An emitter carries exactly one of `prefab`, `entity` or `position`:**

| Field                        | Meaning                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `id`                         | names it in a readout; unique within the profile                     |
| `prefab`                     | a _rule_: every entity of the zone placed from this prefab sounds    |
| `entity`                     | one named placement                                                  |
| `position`                   | a point, with no object behind it                                    |
| `clip`, `variants`           | what it plays; one of them is chosen per start                       |
| `loop`                       | defaults to true unless `intervalSeconds` is given                   |
| `intervalSeconds`            | `[min, max]` of silence between plays of a one-shot                  |
| `volume`                     | its own gain, under the master's                                     |
| `minDistance`, `maxDistance` | metres; `maxDistance` is honoured by the `linear` model only         |
| `rolloff`, `distanceModel`   | how it fades — `linear`, `inverse` (the default) or `exponential`    |
| `panning`                    | `equalpower` (the default) or `HRTF`                                 |
| `maxCount`                   | the most placements a `prefab` rule may sound at once; 64 by default |

A rule is the shape the village uses: eleven braziers are one emitter, and a
twelfth dropped into the square is audible without anyone editing the block.

`pnpm validate:content` additionally checks that every clip a profile names is
in `assets/manifest.json`, that every surface it names has a bank, and that
every emitter points at a prefab or an entity that exists.

`?mute=1` on the game's URL never creates the audio engine at all, which is what
makes "sound costs nothing in the frame" a measurement rather than a hope.

## Terrain (schemaVersion 2, ADR-0020; surface fields at 4, ADR-0032)

`zone.terrain` is optional: a zone without ground — an interior, a dungeon
level, a zone still being blocked out — simply has no `terrain`.

| Field           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `heightField`   | Asset path of the height field model, e.g. `terrain/village-257.glb`.      |
| `position`      | Where the model's **own origin** lands in world space, `[x, y, z]` m.      |
| `size`          | `[width, depth]` of the tile in metres, along x and z.                     |
| `heightSamples` | Optional: a regular-grid copy of the same ground, for offline tools.       |
| `layers`        | Up to 8 ground textures, each with its `tileSize` in metres.               |
| `splat`         | One or two RGBA weight maps: the first weights layers 1–4, the second 5–8. |
| `flatNormals`   | Optional: draw the ground facetted. Default off.                           |

Each layer may also carry a surface (ADR-0032), all four fields optional:

| Field         | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `normalMap`   | Asset path of a tangent-space normal map, tiled like the colour texture.  |
| `normalScale` | 0…8, how hard it tilts the surface. Needs a `normalMap`; 1 is as painted. |
| `metallic`    | 0…1, how much of this layer is reflected sky rather than its own colour.  |
| `smoothness`  | 0…1, how sharp that reflection is. The opposite end of roughness.         |

Rules the schema enforces:

- More than one layer needs a splat map; a splat map needs at least one layer.
- `layers.length <= splat.length * 4`. Two RGBA maps carry eight weights and no
  more, which is also the renderer's limit (`MixMaterial`, ADR-0020).
- No layers at all is legal and means one flat colour — useful while blocking
  out, and the honest fallback when a splat map is missing.
- `tileSize` is metres per repeat, not a repeat count. The renderer computes the
  UV scale as `size / tileSize`, so a 2 m gravel texture stays 2 m of gravel
  when the tile is resized.
- `pnpm validate:content` additionally checks that every path a terrain names —
  the height field, the samples copy, every texture **and every normal map** —
  exists in `assets/manifest.json`.
- `normalScale` without a `normalMap` is refused: a strength for a map that is
  not there does nothing, and a number that does nothing is one someone trusts.
- All five new fields default to what the renderer did before them, so a
  version 3 file is a version 4 file whose ground is plain diffuse.

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
map, then of the second). For the village tile the order was measured again in
ADR-0032, on the dominant channel of every texel of the 512² map, and one entry
changed — what was read as a second grass is the layer the village paths are
painted with:

| Channel | Area   | Mean slope | Mean height | corr(slope) | Layer                 |
| ------- | ------ | ---------- | ----------- | ----------- | --------------------- |
| A.r     | 1.3 %  | 8.0°       | 13.2 m      | −0.02       | `terrain-gravel-path` |
| A.g     | 15.6 % | 42.0°      | 30.2 m      | +0.38       | `terrain-rock-a`      |
| A.b     | 65.8 % | 20.5°      | 20.3 m      | −0.27       | `terrain-grass-a`     |
| A.a     | 10.9 % | 12.8°      | 12.0 m      | −0.23       | `terrain-gravel`      |
| B.r     | 0.15 % | 73.3°      | 40.7 m      | +0.12       | `terrain-rock-rough`  |
| B.g     | 6.3 %  | 32.6°      | 23.6 m      | +0.16       | `terrain-moss`        |

A.r follows the paths and not the grass: sampled at the placed entities it
carries 0.131 mean weight under the stone-and-brick path props and 0.161 under
the wooden ones, against 0.039 under the bushes.

A splat map is also stored **turned onto the ground's axes** by the import
(`tooling/asset-pipeline/terrain-import.ts`), so a world file needs no axis
field and a renderer samples it as `uv = (x, z) / size`. That placement was
re-measured in ADR-0032 against all eight ways of laying a square map over the
tile — mean |r| against slope 0.195, against 0.09–0.13 for the other seven — and
it is the one the import already produced.

**Why `heightSamples`.** The village's drawn tile is adaptive: coarse where the
ground is gentle, at the source resolution past 35° (ADR-0032). Its vertices are
therefore not `rows × columns` and it cannot be read as a height grid at all.
`pnpm scatter` needs a grid to interpolate between, so the world names one
instead of an offline tool guessing which file to read. Absent means the height
field is itself a grid, which is what it was through version 3.

**Do the placements touch it?** `pnpm seating --world <id> --zone <id>
[--prefab <substring>]` measures every placement of a zone against the ground of
the zone that has one — the smallest gap between the model's own vertices and
the surface under them, reported against both the raster and the drawn tile. It
writes nothing. It exists because a zone with no ground of its own is exactly
where the question comes up: the game draws one zone, so "may these be moved
into it?" is a question about numbers, and it has been answered wrongly twice
from a screenshot and from a bounding box (ADR-0037).

**Changing a layer's surface.** `pnpm terrain-surface --world <id> --zone <id>
--layer <n> --metallic <0…1>` and the editor's ground panel are the same
`updateTerrainSurface` command from `@wov/editor-core` (ADR-0032). Neither can
add a layer or change a texture: those have an asset and an import behind them.

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
      "bounds": { "min": [-0.123, 0, -0.123], "max": [0.123, 0.3, 0.123] },
      "collision": { "kind": "box" }
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
- `collision` — optional; what the player bumps into (ADR-0026).
  - `kind` — `none`, `box`, `hull` or `mesh`. `mesh` is the only one with a hole
    in it, which is why an archway and the ground use it and nothing else does.
  - `asset` — a separate low-triangle collider model (`path`, `visibility`,
    `placeholder`), only with `kind: "mesh"`. Named in full rather than derived
    from the prefab's own asset, because where the bytes live is not a thing to
    guess (ADR-0015).
  - `box` — an explicit box in the **model file's** space, the same space as
    `bounds`, only with `kind: "box"`. A tree's `bounds` are its crown, so the
    importer measures the trunk and writes it here instead.
  - Absent means _undecided_, and a reader treats it as `none` — the behaviour
    before the field existed. It is never read as "work a shape out yourself".

`content/prefabs/base.json` is hand-written. `content/prefabs/imported.json` is
generated from the asset manifest by `pnpm generate:prefabs` and committed — it
is authored data derived once, not a runtime generator (ADR-0016).

`content/prefabs/overrides.json` is the **overlay**: the one catalogue that may
redefine a prefab another catalogue already declares, and the one the API
applies last (ADR-0033). It exists because `imported.json` is rewritten _whole_
on every regeneration, so a collision shape corrected in the editor cannot be
saved there — it would be reverted with no error and no diff anybody reads, and
what would be lost is a wall the player then walks through. Everywhere else the
old rule holds: the first definition of an id wins and a second one is reported
as a clash. An override entry is a **complete** prefab, not a diff: the format
has no partial form, so a diff could not be validated as it is written.

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

| Route                   | Answer                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `GET /worlds`           | `{ worlds: [{ id, name, zones, updatedAt }], invalid: [{ id, errors }] }` |
| `GET /worlds/:id`       | The world — 404 unknown, 422 when the stored file fails validation        |
| `PUT /worlds/:id`       | Writes it — 201 created, 200 replaced, 400 invalid body, 403 read-only    |
| `GET /prefabs/:catalog` | One catalogue file — 404 unknown, 422 when the stored file is invalid     |
| `PUT /prefabs/:catalog` | Writes one catalogue, with the same codes and the same guards             |

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
