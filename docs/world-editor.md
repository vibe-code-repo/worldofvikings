# World editor

> Status: **Phase 0** — React shell with a Babylon.js viewport placeholder. No
> selection, no gizmos, no asset browser yet.

The editor is a **separate application** (`apps/editor`, production
`editor.world-of-vikings.com`) that produces its own bundle. Editor code must
never be part of the game bundle (spec §10); `pnpm lint:boundaries` enforces it.

## Run it

```bash
pnpm --filter @wov/editor dev   # http://localhost:5174
```

## Layout (target, spec §13)

```text
┌──────────────────────────────────────────────────────────────┐
│ File | Edit | View | World | Tools | Build | Play            │
├──────────────┬─────────────────────────────┬─────────────────┤
│ Scene        │                             │ Inspector       │
│ Hierarchy    │       3D VIEWPORT           │ Transform       │
│ World        │                             │ Components      │
├──────────────┴─────────────────────────────┴─────────────────┤
│ Asset Browser                                                │
└──────────────────────────────────────────────────────────────┘
```

Phase 0 renders the menubar, the hierarchy and inspector panels and the viewport;
the asset browser row follows with Phase 3.

## Planned keyboard defaults (spec §14)

```text
Q Select   W Move   E Rotate   R Scale
F Focus selected   Delete Delete   Ctrl+D Duplicate   Ctrl+Z Undo   Ctrl+Y Redo
```

## Where code belongs

| Concern                         | Location            |
| ------------------------------- | ------------------- |
| React shell, panels, viewport   | `apps/editor`       |
| Selection, commands, undo/redo  | `@wov/editor-core`  |
| World document schema           | `@wov/world-schema` |
| Renderer setup shared with game | `@wov/engine`       |

## Publishing

The editor never writes production world data directly (spec §36, §49). The
pipeline draft → validate → build → review → publish is designed in Phase 11.
