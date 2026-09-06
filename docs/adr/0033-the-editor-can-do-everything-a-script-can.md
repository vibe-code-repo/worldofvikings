# ADR-0033: The editor can do everything a script can

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** World of Vikings maintainers

## Context

The world is authored, not generated (agent rule 16), and the editor is where it
is supposed to be authored. But four things had crept into `tooling/scripts/`
and stayed there, so the only way to do them was a terminal and a text editor:

| What                                                        | How it was done                                  | Where it is written |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------- |
| The lighting profile of a world or a zone                   | edited by hand in the JSON                       | ADR-0024            |
| The terrain block of a zone                                 | written by the terrain import, then by hand      | ADR-0020            |
| A prefab's collision shape                                  | decided by `generate:prefabs`, corrected by hand | ADR-0026            |
| Importing a scene bundle; regenerating the prefab catalogue | `pnpm import:scene`, `pnpm generate:prefabs`     | ADR-0021, ADR-0016  |

Each of them is world data the editor already _draws_. That is the specific
failure worth naming: the viewport showed the evening the file asked for and had
no control that could change it, and the ground it drew was a block nobody could
edit without leaving the editor. An author cannot judge a light without moving
it, and cannot judge a ground texture without swapping it.

Two further pressures made this the moment:

- The terrain work now in flight adds `normalMap`, `normalScale`, `metallic` and
  `smoothness` to a terrain layer. A hand-written panel would need a matching
  edit for every one, and the failure when somebody forgets is silent — the
  field exists in the file, the game reads it, the editor does not show it.
- A prefab's collision shape lives in `content/prefabs/imported.json`, which
  `generate:prefabs` rewrites **whole**. Any correction saved there is reverted
  by the next regeneration with no error and no diff anybody reads, and what
  gets lost is a wall the player then walks through.

## Decision

**Anything a script writes, the editor can write, by calling the same code.**

Four parts:

1. **The blocks become commands.** `setLighting` and `setTerrain` in
   `@wov/editor-core` address one field of a block by path, validate the result
   against the same schema the file is validated with, and invert by restoring
   the whole block. Undo, redo, dirty state and `PUT /worlds/:id` are then the
   ones that already existed (ADR-0018).
2. **The panels are derived from the schemas.** `describeFields` turns a Zod
   schema into control descriptors through `z.toJSONSchema` — Zod's own public
   description of itself — and `SchemaFields` in `apps/editor` is the only place
   that knows what a control looks like. There is no list of field names in the
   editor. A field added to `@wov/world-schema` appears in the panel on the next
   reload, with its own type and range.

   That includes which fields are **asset paths**. `assetPathOf('texture')` in
   `@wov/world-schema` annotates a path field with the kind of file it names,
   through Zod's `.meta()`, which `z.toJSONSchema` copies out verbatim;
   `describeFields` turns it into a control of kind `asset`, and the panel
   attaches the manifest's entries of that kind. The alternative was a list in
   `apps/editor` saying "`heightField`, `texture` and `splat` are paths", which
   is exactly the drift this decision exists to prevent — and the terrain work
   in flight adds a `normalMap`. The control stays a text field with a list
   attached rather than becoming a dropdown: a world may name an asset no
   manifest lists, and a control that hid that value would make the world
   uneditable.

3. **A prefab correction goes into an overlay catalogue.** The editor writes
   `content/prefabs/overrides.json` through the new `PUT /prefabs/:catalog`, and
   `services/api` applies that one file _last_, replacing rather than clashing.
   `generate:prefabs` never touches it. A hand-written catalogue is edited in
   place, because nothing regenerates it.
4. **The two build steps move into a package and get an HTTP door.** The scene
   import and the catalogue generator are `importSceneBundle` and
   `generatePrefabCatalog` in the new `@wov/content-build`. `tooling/scripts/`
   is the command line around them; `POST /actions/import-scene` and
   `POST /actions/generate-prefabs` are the editor's **World** menu. Both callers
   run the same function and get the same report.

### Why the actions are on the API, and why that is safe

Both steps read files: a scene bundle that is 150 MB in the real export, the
asset manifest, and the private asset store — a tree's collision box is measured
on the model (ADR-0026). None of that is reachable from a browser tab, and
shipping a glTF parser and a trunk measurement into the editor bundle to work on
uploads would be a second implementation of what this decision just merged.

The scene import therefore takes a _file path from a browser_, which is the
shape of every directory-traversal hole there is. The guard is an allow-list and
not a filter (`services/api/src/import-paths.ts`):

- without `WOV_IMPORT_DIR` the action answers **501** and reads nothing, so a
  deployment nobody configured for imports cannot be talked into reading a disk;
- the request names a path **relative to** that directory — an absolute path is
  refused rather than joined, because `join('/import', '/etc/passwd')` lands
  inside and `resolve` does not;
- the resolved path is then checked to still be inside the directory, which is
  what catches `../`;
- it must end in `.glb`;
- and the world id goes through the same `isContentId` guard every other write
  does, so it can only ever become `<CONTENT_DIR>/worlds/<id>.json`.

A symbolic link that points out of `WOV_IMPORT_DIR` is _not_ caught, and the
operator is told so in the module: it is a directory you control, not a shared
drop box. The catalogue action takes no path at all — the manifest, the assets
and the store are the service's own configuration — and both actions answer 403
under `WORLDS_READ_ONLY`, like every other write (ADR-0017).

## Alternatives considered

| Alternative                                                        | Why not                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-written panels for the lighting profile and the terrain block | 38 lighting fields and a terrain block that is actively growing. The panel would drift behind the schema, and the drift is invisible: the file keeps the field, the editor does not show it.                                            |
| Read Zod's internals instead of `z.toJSONSchema`                   | Works today, breaks on an upgrade, and would put the editor's panels at the mercy of a private field layout. JSON Schema is the documented output and carries exactly what a control needs — type, range, enum, and the colour pattern. |
| Let the editor save into `imported.json`                           | `generate:prefabs` rewrites that file whole. The correction survives until the next asset import and then vanishes with no error — the worst failure mode available.                                                                    |
| A `patch` field on a prefab instead of a full override entry       | The prefab format has no partial form, so a patch could not be validated as it is written, and a reader of `overrides.json` would have to hold the generated file open beside it to know what a prefab is.                              |
| Upload the scene bundle from the browser                           | A 150 MB request, a glTF parser in the editor bundle, and no way to reach the asset store the trunk measurement needs. It would also be a second importer.                                                                              |
| Shell out to `pnpm import:scene` from the API                      | Runs a package manager from an HTTP handler, hands it a path as a command line, and answers with parsed stdout. Every part of that is worse than calling the function.                                                                  |
| Keep the core in `tooling/` and import it from `services/api`      | `tooling/` is scripts, validators and smoke tests and never shipped code (AGENTS.md §2). Importing it into a service would erase that line.                                                                                             |
| Put the lighting presets in `content/`                             | A preset is not the light of any world; it is the value a button writes into one, like `DEFAULT_GRID_STEP` is the grid a session starts on. The moment it is pressed the result is ordinary, persisted world data (agent rule 17).      |
| Name the path fields in `apps/editor` instead of annotating them   | Three field names today, four when the terrain work lands, and nothing fails when one is forgotten: the field is still editable, it just silently loses its list. The annotation lives where the field is declared and moves with it.   |
| Load the asset manifest when the editor starts                     | 874 kB describing 1192 assets, for one panel. It is read the first time the Zone tab is opened, and the panel works without it — a path field with no list is still a path field.                                                       |
| A dropdown instead of a text field with a `datalist`               | A world may name an asset no manifest lists — not yet imported, or served from elsewhere. A dropdown would drop that value on the first edit, which is data loss in a control that looks like a convenience.                            |

## Consequences

**Positive**

- An author can move the sun, swap a ground texture, reorder the splat layers
  and fix a collision shape without leaving the editor — and see the change in
  the viewport, because the viewport already derives itself from the document.
- A schema change reaches the editor by itself. The fields the terrain work adds
  will be editable the day the schema accepts them.
- One implementation of the scene import and of the catalogue generator, with
  the command line and the editor as two doors onto it. `pnpm import:scene`
  writes byte-identical output to before.
- A prefab correction survives `generate:prefabs`.
- The scene import is testable without the private export: a 752-byte fixture
  bundle in `tooling/fixtures/scenes/`.
- A ground texture is chosen from the store rather than typed, and so is a
  height field and a splat map — one annotation per field in the schema, no
  control written for any of them.

**Negative**

- A new package, `@wov/content-build`, and a move of `glb.ts`, `collision.ts`,
  `scene-import.ts`, `prefab-catalog.ts` and `prefab-stems.ts` out of `tooling/`.
  Twenty-seven files changed an import line.
- The API can now write a second kind of file and run two build steps. That is
  more surface, guarded by `WORLDS_READ_ONLY`, `WOV_IMPORT_DIR` and
  `isContentId`, and covered by tests that name the failing cases.
- A prefab correction is **not** in the undo history. The history belongs to the
  open world document (ADR-0018); a catalogue is a different file that other
  worlds read, and one Ctrl+Z that silently rewrites shared content behind three
  other worlds would be worse than a save button. The panel is explicit instead.
- `overrides.json` is a second place a prefab can be defined. `GET /prefabs`
  reports which catalogue every prefab came from, and the inspector shows it.
- The lighting panel dispatches one command per slider step, because there is no
  path that paints without editing the document. The history folds the steps of
  one drag into one entry (`HistoryEntry.coalesceKey`); the alternative was a
  preview that the file could disagree with.
- `@wov/world-schema` now says one thing about a _panel_: which kind of asset a
  path field names. It changes no validation and it is the narrowest place the
  fact can live, but the line between data and presentation is one field thinner
  than it was.

**Follow-ups**

- Terrain _sculpting_ is still not here: the height field is referenced, not
  edited. When it arrives, the ground becomes a document-owned thing reconciled
  like everything else and `zone-terrain.ts` becomes its reconciler.
- `pnpm scatter` and `pnpm import:scene-models` are the two commands that still
  have no editor door. Scatter has a panel that does the same thing through
  `@wov/editor-core`; the model importer writes into the private asset store,
  which is not content and is a different decision.
- The renderer does not yet read `normalMap`, `normalScale`, `metallic` or
  `smoothness`; the editor will show them as soon as the schema does.
