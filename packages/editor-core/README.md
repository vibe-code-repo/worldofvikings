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
- `addZone(zone, { index? })`, `removeZone(zoneId)`
- `applyCommand(document, command): CommandResult<AppliedCommand>` —
  `{ document, inverse, createdEntityIds }`
- `invertCommand(document, command): CommandResult<EditorCommand>`

A command that cannot be honoured returns `{ ok: false, error }` and changes
nothing; it never throws and never leaves a half-applied document.

History — `history.ts`

- `createEditorState(world, { historyLimit? }): EditorState`
- `execute(state, command): ExecuteResult`
- `undo(state)`, `redo(state)`, `canUndo(state)`, `canRedo(state)`

Selection — `selection.ts`: `setSelection`, `toggleSelection`, `clearSelection`,
`setActiveZone`.

Ids — `ids.ts`: `entityIdBase(prefabId)`, `nextEntityId(usedIds, prefabId)`,
`nextEntityIds(usedIds, prefabIds)`. Deterministic: `<prefab>_001`, first free
number, never `Math.random` (agent rule 17).

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

`@wov/world-schema` only. Commands validate through its schemas, so the editor
cannot produce a world the game would reject.

**Ownership.** Editor maintainers.
