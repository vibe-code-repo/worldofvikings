# World editor

> Status: **Phase 3 MVP** — free camera, grid, selection, gizmos, hierarchy,
> inspector, asset browser, a scatter panel, open and save through the API. No
> components, no terrain sculpting yet.

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
│ Asset Browser — tabs, search, drag  │ Scatter — region, mix, │
│                                     │ density, seed, preview │
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

## Scattering things

The scatter panel plants many copies of a prefab over a region in one gesture
(ADR-0025). What it produces is **ordinary entities**: they land in the document,
they are in the world file after a save, and they can be selected, moved and
deleted one at a time afterwards. The seed is how the same field is produced
twice, not how it is stored — the world is never generated at play time (agent
rules 16 and 17).

1. Set the region: type `x0, z0, x1, z1`, or press **pick corner 1** / **pick
   corner 2** and click the ground in the viewport.
2. Choose a prefab in the asset browser and press **add** — once per prefab.
   The weight next to each one decides how often it is drawn relative to the
   others.
3. Set the density (instances per 100 m² of _usable_ ground), the seed, the
   minimum distance and the scale and yaw ranges.
4. The line above the button says how much ground is usable and how many
   instances that comes to. Press **Scatter**.

The whole field is a single history entry: one Ctrl+Z takes it all back. Running
the same seed into the same zone twice is refused rather than doubling the
field, because the ids carry the seed (`<prefab>_s<seed>_<n>`).

### The same tool from the command line

`pnpm scatter` calls the same function without the editor, which is how a run in
a pull request can be reproduced:

```bash
pnpm scatter --world village1 --zone village --region x0,z0,x1,z1 \
  --prefab <id>[:weight][,<id>[:weight]…] --density <per 100 m²> --seed <n> \
  [--scale low,high] [--yaw low,high] [--min-distance m] [--maximum n] \
  [--polygon x,z x,z x,z] [--exclude x0,z0,x1,z1]… \
  [--keep-out <prefab substring>,…] [--keep-out-margin m] [--dry-run]
```

`--keep-out` derives keep-out rectangles from the hull boxes of the entities
already in the zone, so grass keeps out of the houses and off the paving without
anyone typing their coordinates. Heights come from the zone's own height field
in the asset store; set `WOV_ASSET_STORE` or `--store` when it is not at the
default path.

### The runs that dressed `village1`

Three runs, in this order. They append to `content/worlds/village1.json`; re-run
them after any `pnpm import:scene`, which rewrites that file from the bundle and
therefore drops them. The ground and the lighting block survive that rewrite
(ADR-0028); the scattered entities are the one thing that does not, because
entities are what the import replaces.

```bash
# 3 473 tufts of grass over the village, off the buildings and the paving
pnpm scatter --world village1 --zone village --region 118,100,215,212 \
  --prefab grass-short-clump-1 --density 40 --seed 7 --min-distance 0.55 \
  --scale 1.0,2.0 --keep-out-margin 0.3 \
  --keep-out sm-bld,-floor,path-wood,path-brick,path-rock,ground-planks,wood-platform,-tiles-,roof-sm,-dock-

# 466 bushes in the scatter area around the village, the village itself excluded
pnpm scatter --world village1 --zone village --region 50,50,250,250 \
  --exclude 118,100,215,212 --density 1.6 --seed 11 --min-distance 2.5 \
  --scale 0.8,1.4 \
  --prefab bush-1a1:4,bush-1a2:3,bush-1a3:2,large-bush-1a1:1,large-bush-1a5:1

# 93 small bushes in the gaps between the houses
pnpm scatter --world village1 --zone village --region 118,100,215,212 \
  --prefab bush-1a1-small:3,bush-1a2-small:2,bush-1a3:1 --density 1.6 --seed 13 \
  --min-distance 3.5 --scale 0.7,1.15 --keep-out-margin 0.6 \
  --keep-out sm-bld,-floor,path-wood,path-brick,path-rock,ground-planks,wood-platform,-tiles-,roof-sm,-dock-,sm-prop-,sm-env-stonewall,sm-veh
```

The regions come from the mapping of the source scene: the first covers the
village itself, the second the scatter area the level carries around it (the
four tree stamps and the detail area overlap inside it), the third the small
decorative patches between the houses.

**In the game, vegetation is drawn as thin instances** — one mesh with a matrix
buffer, no scene node, not pickable. In the editor it stays one node per entity,
because there every tuft has to be selectable. Grass takes the sun's shadow but
is not drawn into the shadow map (ADR-0027), and vegetation collides against
nothing (ADR-0026), so a scattered field costs no physics bodies: 4 103 of
`village1`'s 5 248 entities are walk-through.

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
