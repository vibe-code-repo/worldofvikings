# @wov/editor-core

**Purpose.** Editor-only logic: the document being edited, the commands that
change it, undo/redo, selection and snapping. **`apps/game` must never import
this package** (spec §10); the rule is enforced by `pnpm lint:boundaries`.

Nothing here imports Babylon.js or React. `apps/editor` owns the canvas and the
panels; this package owns what an edit _is_, so every rule about world data is
tested without a browser (ADR-0016).

## Model

```text
EditorState    = { document, history }
EditorDocument = { world, selection, activeZoneId, dirty }
```

Everything is immutable data. A change is an `EditorCommand` **value**;
`applyCommand` returns a new document plus the command that undoes it, so the
history stores two small commands per step instead of two copies of the world.

Selection and the active zone are view state: changing them never makes the
document dirty and never enters the history. Undo still restores the selection,
because each history entry remembers the view its command was made in.

## Public API

Document — `document.ts`

- `createEmptyWorld(id, name): WorldDefinition`
- `createDocument(world): EditorDocument`
- `findZone(document, zoneId)`, `activeZone(document)`, `findEntity(document, zoneId, entityId)`
- `selectedEntities(document): readonly EntityDefinition[]` (file order)
- `markSaved(document): EditorDocument`
- `serializeDocument(document): SerializeResult` — validates before saving

Commands — `commands.ts`. The constructors return plain data:

- `addEntity(zoneId, entity, { index? })`, `addEntities(zoneId, entries)`
- `removeEntities(zoneId, entityIds)`
- `updateTransform(zoneId, changes)` — in a `TransformPatch` a value sets the
  field, `null` removes it, an absent key leaves it alone
- `duplicateEntities(zoneId, entityIds, { offset? })`
- `renameEntity(zoneId, entityId, nextId)`
- `addZone(zone, { index? })`, `removeZone(zoneId)`, `renameZone(zoneId, name)`
- `setLighting(scope, patches)`, `setLightingField(scope, path, value)` — how a
  world or a zone is lit (ADR-0024, ADR-0033)
- `setTerrain(zoneId, patches)`, `setTerrainField(zoneId, path, value)` — the
  ground of a zone (ADR-0020, ADR-0033)
- `applyCommand(document, command): CommandResult<AppliedCommand>` —
  `{ document, inverse, createdEntityIds }`
- `invertCommand(document, command): CommandResult<EditorCommand>`

A command that cannot be honoured returns `{ ok: false, error }` and changes
nothing; it never throws and never leaves a half-applied document.

Blocks — `blocks.ts`, `patch.ts` (ADR-0033). The lighting profile and the
terrain block are trees of small optional objects, and a panel edits one leaf at
a time, so a `FieldPatch` addresses a field by path: `['sun', 'intensity']`,
`['layers', '2', 'tileSize']`, or `[]` for the whole block. A `null` value
removes a key — a world file distinguishes "no fog block" from "a fog block that
says nothing", and a panel has to be able to produce both.

- `worldLighting()`, `zoneLighting(zoneId)`, `lightingAt(world, scope)`
- `withLighting(world, scope, profile)`, `withTerrain(zone, terrain)`
- `parseLightingBlock(value)`, `parseTerrainBlock(value)`
- `valueAtPath`, `applyFieldPatch`, `applyFieldPatches`, `restorePatch`

Both commands invert by restoring the **whole** block. A patch that created
`sun.intensity` on a world with no lighting cannot be undone by removing that
one key: that would leave `{ "sun": {} }`, which is a different file.

Schema-driven forms — `schema-form.ts`, `world-forms.ts` (ADR-0033).
`describeFields(schema)` turns a Zod object schema into control descriptors
through `z.toJSONSchema`, so `apps/editor` contains no list of field names and a
field added to `@wov/world-schema` reaches the panel by itself.
`LIGHTING_FIELDS`, `TERRAIN_FIELDS` and `PREFAB_COLLISION_FIELDS` are the three
blocks the editor draws. A field is described down to its control: a `#rrggbb`
rule becomes a colour well, an `assetPathOf` annotation becomes an `asset` field
carrying which kind of file it names, and an exclusive minimum is recorded so
whoever invents a starting value does not invent an invalid one.

Lighting presets — `lighting-presets.ts`: `LIGHTING_PRESETS`,
`lightingPreset(id)`. Not world data — the value a button writes _into_ a world,
the way `DEFAULT_GRID_STEP` is the grid a session starts on. `evening` is the
village's own profile, so pressing it on the village is a no-op.

Prefab overrides — `prefab-overrides.ts` (ADR-0033): `catalogForEdit(catalog)`,
`editedPrefab(prefab, edit)`, `withPrefab(catalog, prefab)`,
`emptyOverrideCatalog()`. A correction to a _generated_ prefab goes into
`overrides.json`, which the API applies last and `generate:prefabs` never
touches; a hand-written catalogue is edited in place.

History — `history.ts`

- `createEditorState(world, { historyLimit? }): EditorState`
- `execute(state, command, { coalesceKey? }): ExecuteResult`
- `undo(state)`, `redo(state)`, `canUndo(state)`, `canRedo(state)`

`coalesceKey` folds consecutive steps of one gesture into one entry. A slider
dragged across a lighting value produces one command per step — the viewport
relights from the document, so there is no other way to show the change while it
is being made — and fifty of those in the undo stack is not an undo anybody
wants. Only consecutive steps fold; anything in between ends the gesture.

Selection — `selection.ts`: `setSelection`, `toggleSelection`, `clearSelection`,
`setActiveZone`.

Ids — `ids.ts`: `entityIdBase(prefabId)`, `nextEntityId(usedIds, prefabId)`,
`nextEntityIds(usedIds, prefabIds)`. Deterministic: `<prefab>_001`, first free
number, never `Math.random` (agent rule 17).

Ground — `updateTerrainSurface(zoneId, { layers, flatNormals })` in
`commands.ts` (ADR-0032). The one way a terrain layer's `metallic`,
`smoothness` and `normalScale` change, and the one way `flatNormals` is
switched. The editor's ground panel and `pnpm terrain-surface` both dispatch it,
which is what keeps a script and the editor writing the same fields through the
same validation. A patch field that is absent means "leave it alone" and `null`
means "take it out of the file"; the two are different edits. It cannot add a
layer or change a texture — those have an asset and an import behind them.

Scatter — `scatter.ts` (ADR-0025). Planting many copies of a prefab over a
region, as one command whose output is ordinary entities:

- `planScatter(options): CommandResult<ScatterPlan>` — pure, seeded, no
  document; `{ entities, usableArea, requested, crowdedOut }`
- `scatterCommand(zoneId, options): CommandResult<{ command, plan }>` — one
  `addEntities`, so one undo takes the whole field back
- `usableArea(region)`, `insideRegion(region, x, z)` — the rectangle minus the
  polygon minus the keep-outs, measured on an `AREA_PROBES` lattice
- `scatterId(prefab, seed, n)` — `<prefab>_s<seed>_<n>`, zero-padded
- `SCATTER_DENSITY_AREA` (100 m²), `SCATTER_ATTEMPTS`, `SCATTER_MAXIMUM`

Footprints — `footprint.ts`: `footprintOf(entity, prefab, { margin })` and
`footprintsOf(entities, prefabs, patterns, { margin })` — the ground rectangle a
placed entity covers, from the catalogue's hull box and the entity's transform.
It is how a scatter keeps out of the houses and off the paving.

Random — `random.ts`: `createRandom(seed): Random` with `next`, `between` and
`weighted`. Deterministic mulberry32; `Math.random` is used nowhere in this
package (agent rule 17).

Snapping — `snapping.ts`: `gridSnap(value, step)`, `snapPosition`,
`snapRotationAngle(radians, stepDegrees)`, `snapRotation`, plus
`DEFAULT_GRID_STEP` (0.5 m) and `DEFAULT_ROTATION_STEP_DEGREES` (15°). Positions
are rounded back to six decimals so snapping cannot leak `0.30000000000000004`
into a world file; angles are not, because a whole degree count has no short
radian spelling.

## Dependencies

`@wov/world-schema`, and `zod` directly — `describeFields` calls
`z.toJSONSchema` on the schemas that package exports (ADR-0033). Commands
validate through those schemas, so the editor cannot produce a world the game
would reject.

**Ownership.** Editor maintainers.
