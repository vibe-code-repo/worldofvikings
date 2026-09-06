# World editor

> Status: **Phase 3 MVP** — free camera, grid, selection, gizmos, hierarchy,
> inspector, asset browser, open and save through the API. No components, no
> terrain sculpting, no scatter tools yet.

The editor is a **separate application** (`apps/editor`, production
`editor.world-of-vikings.com`) that produces its own bundle. Editor code must
never be part of the game bundle (spec §10); `pnpm lint:boundaries` enforces it.

## Run it

```bash
pnpm dev                        # everything, editor on http://localhost:5174
pnpm --filter @wov/editor dev   # the editor alone
```

The editor needs the API (worlds and prefabs) and the asset server (models).
Both default to their local ports, so a clean clone needs no `.env`; see
`apps/editor/.env.example` for `VITE_API_URL` and `VITE_ASSET_URL`.

## Layout (spec §13)

```text
┌──────────────────────────────────────────────────────────────┐
│ File | Edit | View │ Select Move Rotate Scale │  world  dirty │
├──────────────┬─────────────────────────────┬─────────────────┤
│ Hierarchy    │                             │ Inspector       │
│  zones       │       3D VIEWPORT           │  id, prefab     │
│  entities    │                             │  transform      │
├──────────────┴─────────────────────────────┴─────────────────┤
│ Asset Browser — tabs by category, search, drag into viewport │
├──────────────────────────────────────────────────────────────┤
│ assets: N private, M placeholder │ zone │ selection │ status  │
└──────────────────────────────────────────────────────────────┘
```

## Mouse

| Gesture               | Does                                                    |
| --------------------- | ------------------------------------------------------- |
| Left click            | Select; with a prefab armed, place it where you clicked |
| Shift/Ctrl + click    | Add to or remove from the selection                     |
| Right button drag     | Orbit — and `WASD`/`Q`/`E` fly while it is held         |
| Middle button drag    | Pan (also Shift + right button)                         |
| Wheel                 | Move closer or further away                             |
| Drag from the browser | Drop a prefab straight into the viewport                |

Flying is bound to the held right button on purpose: `W`, `E` and `R` are also
tool shortcuts, and this is what keeps a keystroke from meaning two things.

## Keyboard (spec §14)

```text
Q Select    W Move      E Rotate     R Scale
F Focus selection        Delete Delete selection      Escape Clear
Ctrl+D Duplicate         Ctrl+C / Ctrl+V Copy, paste (this session)
Ctrl+Z Undo              Ctrl+Y or Ctrl+Shift+Z Redo
Ctrl+S Save
```

Shortcuts are ignored while a text field has focus.

## Placing things

Pick a prefab in the asset browser and click in the viewport, or drag the row
onto the canvas. Where it lands:

1. The click ray hits a surface, or the ground plane if it hits nothing.
2. With **View ▸ Snap to grid** on, `x` and `z` are snapped to the step.
3. A ray straight down decides `y` — so a prop dropped over a hill lands on the
   hill, not at zero.

Gizmo drags snap the same way, and a whole drag becomes one undo step.

## Where the world data comes from

The editor never reads or writes files itself. `services/api` serves the
authored content of `CONTENT_DIR` (ADR-0017):

```bash
curl http://localhost:3000/worlds        # { worlds: [{ id, name, zones, updatedAt }], invalid: [] }
curl http://localhost:3000/worlds/example
curl http://localhost:3000/prefabs       # merged catalogues from content/prefabs/
```

Saving is `PUT /worlds/:id` with the world as the body: it is validated against
`@wov/world-schema`, the body's `id` has to match the url, and the file is
written atomically in Prettier's formatting so the result stays a reviewable
diff. A service started with `WORLDS_READ_ONLY=1` answers 403 instead — that is
the switch that keeps editor clients out of official production data (spec §49).

Models come from the asset server. A prefab marked `private` is fetched from the
private store and falls back to its committed placeholder when the store is not
mounted (ADR-0015); the status bar says which happened, in the same words the
game uses.

## How it is put together

**The document is the truth and the scene follows it** (ADR-0018). Every
gesture — a click, a gizmo drag, a number typed into the inspector, a drop out
of the asset browser — becomes an `EditorCommand` against one document held in
one reducer. The viewport reconciles the scene against that document and touches
only the entities that changed, so dragging one prop does not re-instantiate the
zone around it.

| Concern                          | Location                |
| -------------------------------- | ----------------------- |
| React shell, panels, viewport    | `apps/editor`           |
| Camera, grid, gizmos, scene sync | `apps/editor/src/scene` |
| Selection, commands, undo/redo   | `@wov/editor-core`      |
| World and prefab document schema | `@wov/world-schema`     |
| Renderer setup shared with game  | `@wov/engine`           |
| Loading and caching models       | `@wov/asset-system`     |

`@wov/editor-core` holds an `EditorState` — the document
(`{ world, selection, activeZoneId, dirty }`) plus a command history. Every edit
is a command value with an inverse, so undo and redo are pure functions and the
whole model is tested without a browser (ADR-0016). The shell owns the canvas
and the keystrokes; it owns no world rules. See the package README for the API.

## Proving it works

`pnpm smoke` drives the real editor in a real browser: it watches the frame
counter move, opens a world from the API's list, places a prefab out of the
browser, finds it in the hierarchy _and_ in the scene, saves it, reads the file
back through the API, drags the move gizmo with a real mouse, and undoes.

It runs the API on its own port against a throwaway copy of `content/`, so the
save is a real file write and the repository stays clean — and so `pnpm smoke`
can run while `pnpm dev` is up.

## Publishing

The editor never writes production world data directly (spec §36, §49). The
pipeline draft → validate → build → review → publish is designed in Phase 11.
