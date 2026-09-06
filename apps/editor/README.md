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
| `api/client.ts`      | `GET /worlds`, `GET /worlds/:id`, `PUT /worlds/:id`, `GET /prefabs` |
| `config.ts`          | `VITE_API_URL` and `VITE_ASSET_URL`, with local defaults            |
| `panels/`            | Menu bar, hierarchy, inspector, asset browser                       |
| `scene/`             | Everything Babylon (see below)                                      |
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
| —                                              | `zone-terrain.ts` — the ground    |

The active zone's `terrain` block is drawn as scenery (ADR-0020, ADR-0022): it
is what surface snapping drops a prop onto, and it carries no entity id, so
clicking it selects nothing and no gizmo can move it. Terrain editing is a later
phase.

`SceneSync.meshCount()` counts entity **roots** — exactly one per entity, so it
is comparable to the document's `entityCount` without arithmetic. A loaded GLB
brings its own intermediate nodes under that root, and those are not entities.

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
