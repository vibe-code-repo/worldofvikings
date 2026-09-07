# @wov/editor

Standalone world editor (production: `editor.world-of-vikings.com`, access
restricted — spec §48). It edits the JSON in `content/worlds/` through
`services/api`; it never touches a file itself.

- Dev: `pnpm --filter @wov/editor dev` → http://localhost:5174
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)
- Controls and keyboard: [`docs/world-editor.md`](../../docs/world-editor.md)

## The one rule

**The document is the truth and the scene follows it** (ADR-0018). Every
gesture — a click, a gizmo drag, a number typed into the inspector, a drop out
of the asset browser — becomes an `EditorCommand` against one `EditorSession`
held in one reducer. Nothing edits the Babylon scene directly, which is why a
gizmo drag undoes with the same Ctrl+Z as a Delete key.

## Layout of `src/`

| Path                 | Owns                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `EditorShell.tsx`    | The session, the keyboard, and what the panels are wired to         |
| `EditorViewport.tsx` | The canvas: scene reconciliation, picking, gizmo commits, drops     |
| `state/store.ts`     | The reducer around `@wov/editor-core`, plus clipboard and errors    |
| `api/client.ts`      | Worlds, prefab catalogues, and the two content actions              |
| `api/assets.ts`      | The asset manifest, indexed by kind for the zone inspector's picker |
| `config.ts`          | `VITE_API_URL` and `VITE_ASSET_URL`, with local defaults            |
| `keyboard.ts`        | Whether the focused element keeps a keystroke or the shell gets it  |
| `panels/`            | Menu bar, hierarchy, the four right-hand inspectors, asset browser  |
| `scene/`             | Everything Babylon (see below)                                      |
| `coalesce.ts`        | Many asks, one run before the next frame — see below                |
| `dev-debug.ts`       | `window.__wovEditor`, the dev-only bridge `pnpm smoke` reads        |

`scene/` keeps the arithmetic separate from the bindings, so the rules are
testable without a GPU:

| Pure                                           | Babylon binding                   |
| ---------------------------------------------- | --------------------------------- |
| `editor-camera-math.ts` — orbit, pan, fly, `F` | `editor-camera.ts`, `viewport.ts` |
| `grid-lines.ts` — spacing and axes             | `grid.ts`                         |
| `entity-diff.ts` — what changed in a zone      | `scene-sync.ts`                   |
| `gizmo-commit.ts` — a drag as one command      | `gizmos.ts`                       |
| `picking.ts` — ray to the ground plane         | `picking.ts` (the scene picks)    |
| `prefab-index.ts` — catalogue by id, category  | —                                 |
| `selection-outline.ts` — the twelve box edges  | `selection-outline.ts`            |
| `terrain-keys.ts` — what a ground edit changed | `zone-terrain.ts` — the ground    |
| `panels/list-window.ts` — which rows to render | `panels/Hierarchy.tsx`            |

The ground panel (`panels/GroundPanel.tsx`, ADR-0032) is where a layer's
metallic, smoothness and bump strength are turned, and where facetted ground is
switched on. Each dial is a slider beside a number box; both dispatch
`updateTerrainSurface`, the same command `pnpm terrain-surface` builds — the
editor cannot fall behind a script that way — and a whole slider drag folds into
one undo entry. Turning a dial writes a **uniform** into the program the tile
already carries instead of rebuilding the tile, which is what makes dragging one
possible at all (ADR-0050): `scene/terrain-keys.ts` decides, field by field,
whether an edit is a uniform, a new material over the loaded height field, or a
reload.

The active zone's `terrain` block is drawn as scenery (ADR-0020, ADR-0022): it
is what surface snapping drops a prop onto, and it carries no entity id, so
clicking it selects nothing and no gizmo can move it. Terrain **sculpting** is
still a later phase — the height field is referenced, not edited — but the block
itself is editable in the Zone inspector (ADR-0033).

## The panels are drawn from the schemas

The Lighting, Zone and Prefab inspectors contain no list of field names.
`describeFields` in `@wov/editor-core` turns a Zod schema into control
descriptors and `panels/SchemaFields.tsx` is the only place that knows what a
control looks like, so a field added to `@wov/world-schema` appears here on the
next reload with its own type and range and nothing in this app changes
(ADR-0033). That covers the pickers too: a path field annotated with
`assetPathOf` in the schema is drawn as a text field with the asset store's
entries of that kind attached, which is why the height field, every layer
texture and every splat map can be chosen rather than typed.

Two consequences worth knowing:

- A slider is **one command per step**, because the viewport relights and
  redraws from the document and there is no path that paints without editing it.
  The history folds the steps of one drag into one undo entry
  (`HistoryEntry.coalesceKey`).
- A **prefab** correction is not in the undo history. The history belongs to the
  open world document; a prefab catalogue is a different file other worlds read,
  so the Prefab inspector has an explicit Save and says which file it writes.

`SceneSync.meshCount()` counts entity **roots** — exactly one per entity, so it
is comparable to the document's `entityCount` without arithmetic. A loaded GLB
brings its own intermediate nodes under that root, and those are not entities.

## How a zone reaches the screen

Opening the village is 5273 entities, and three decisions about _how_ they land
are the difference between three frames a second and the game's cost
(ADR-0048, ADR-0049, ADR-0050):

- **Instances, not clones.** `scene-sync.ts` instantiates a model with
  `instanced: true`, so ninety copies of one fence share one geometry and one
  material and still have ninety nodes — each pickable, each movable, which is
  what an editor needs and what the thin instances the game scatters vegetation
  with (ADR-0025) cannot give.
- **A narrow freeze.** An entity's world matrices are pinned once its model has
  landed and thawed again for exactly as long as it is selected or is being
  written to. The hold is the document's `selection`, derived inside `apply()`
  _before_ the diff's early return, because a click that changes nothing but the
  selection is precisely the gesture that must thaw a prop.
  `SceneSync.frozenCount()` is the witness, published on the debug bridge and
  asserted by `pnpm smoke`.
- **The game's shadow rule.** `castsShadows` from `@wov/world-schema` keeps
  grass and painted distance out of the sun's map (ADR-0027, ADR-0031), so the
  author is shown the light the game draws.

And one about _when_ the viewport talks back. `scene-sync.ts` reports once per
loaded model **and** once per loaded texture — about ten thousand times for the
village — and each report used to walk the whole zone three times and set React
state in the shell. `coalesce.ts` folds those asks into one run before the next
frame, the walks sit behind `isEditorDebugInstalled()`, and the hierarchy renders
the rows it shows rather than one `<li>` per entity (`panels/list-window.ts`).

## Where code belongs

The editor produces an independent bundle (spec §10). Shared logic belongs in
`@wov/engine`, `@wov/world-schema` or `@wov/asset-system`; editor-only _rules_
belong in `@wov/editor-core` (commands, undo, selection, snapping, id
generation), and only the canvas and the panels belong here.

## Proving a change

Add a `data-testid` and a `pnpm smoke` assertion for every new visible surface.
The smoke suite runs the editor against an API on its own port with a throwaway
`CONTENT_DIR`, so it can save real files without touching the repository.

## Dependencies

`react`, `react-dom` (editor UI, spec §2.1), `@babylonjs/core` (imported by
submodule, ADR-0006), `@vitejs/plugin-react`, `vite`, plus `@wov/asset-system`,
`@wov/editor-core`, `@wov/engine`, `@wov/ui` and `@wov/world-schema`.

No gizmo, dropdown, drag-and-drop or HTTP library: the handles come from
Babylon, the menus are `<details>` elements, dragging is the platform's own, and
the four API calls are `fetch`.
