/**
 * The editor's debug bridge: `window.__wovEditor`.
 *
 * Same reason as the game's (`apps/game/src/dev-debug.ts`): a rendered panel
 * proves nothing about a running renderer, and a row in the hierarchy proves
 * nothing about a mesh in the scene. The bridge reports both sides of every
 * claim the smoke test makes — how many entities the *document* holds and how
 * many meshes the *scene* holds — so a viewport that quietly stopped deriving
 * itself from the document fails a test instead of looking fine.
 *
 * Only the *publishing* is dev-only. `installEditorDebugBridge` is called
 * behind `import.meta.env.DEV`, which Vite replaces with `false` in a
 * production build, so a shipped editor never puts a handle to its own state on
 * `window`. `publishEditorDebug` is called from the render loop and from React
 * on every document change and is deliberately *not* guarded at each call site:
 * it returns immediately when no bridge was installed, and thirty guards around
 * one branch would be thirty places to forget one.
 *
 * The game does drop its whole bridge module (`apps/game/src/dev-debug.ts`),
 * because there the DEV branch wraps the only call. The difference is
 * intentional: this module survives into the production bundle as a few hundred
 * bytes of no-op, and the frame budget is untouched either way.
 */

/** The read-only view `pnpm smoke` and other dev tooling may rely on. */
export interface WovEditorDebug {
  /** Which engine implementation the renderer ended up on. */
  readonly backend: string;
  /** Index of the last rendered frame; `-1` before the first one. */
  readonly frameId: number;
  /** Id of the world in the editor. */
  readonly worldId: string;
  /** The zone the viewport is editing, or `null` for a world without zones. */
  readonly zoneId: string | null;
  /** Entities in the active zone, as the *document* counts them. */
  readonly entityCount: number;
  /** Root meshes the viewport built for them, as the *scene* counts them. */
  readonly meshCount: number;
  /**
   * How many of those show their real model instead of the stand-in cube.
   *
   * Anything that measures the picture — framing an entity, aiming at a gizmo —
   * has to wait for this, because a 1 m cube and a 25 cm barrel are not framed
   * from the same distance.
   */
  readonly loadedCount: number;
  /**
   * File names of the textures the scene has finished loading.
   *
   * A model draws with or without its base colour, so `loadedCount` alone
   * cannot tell a textured viewport from a grey one (ADR-0019).
   */
  readonly loadedTextures: readonly string[];
  /** Selected entity ids, in the order they were picked. */
  readonly selection: readonly string[];
  /** Whether the world differs from the last saved file. */
  readonly dirty: boolean;
  /** How many undo and redo steps are available. */
  readonly undoDepth: number;
  readonly redoDepth: number;
  /**
   * The ground the viewport is actually drawing, or `null` when it has none.
   *
   * The surface numbers a world file states are not enough to prove the ground
   * changed: a panel can dispatch a command that reaches the document and never
   * the scene. `program` is the key of the compiled shader the tile ended up
   * with (`terrain.ts`), which encodes the layer count, the splat count, the
   * normal-map mask and whether the ground is facetted — so a facetted tile and
   * a smooth one are two different strings, read off the material rather than
   * restated from the document (ADR-0032).
   */
  readonly terrain: {
    readonly program: string;
    readonly meshes: number;
    readonly textures: number;
  } | null;
  /**
   * The painted backdrop, as the meshes report it.
   *
   * The game asserts the same pair in `tooling/smoke/village-backdrop.spec.ts`.
   * It is here because the editor got the answer wrong for as long as nobody
   * looked: it refused fog on every backdrop mesh, so the range stood dark and
   * green behind a hazed ground and an author had no way to see the picture the
   * game would draw (ADR-0033, ADR-0041).
   */
  readonly backdrop: { readonly meshes: number; readonly fogged: number };
}

declare global {
  interface Window {
    /** Present in the dev build only — see `apps/editor/src/dev-debug.ts`. */
    __wovEditor?: WovEditorDebug;
  }
}

const initial: WovEditorDebug = {
  backend: 'starting',
  frameId: -1,
  worldId: '',
  zoneId: null,
  entityCount: 0,
  meshCount: 0,
  loadedCount: 0,
  loadedTextures: [],
  selection: [],
  dirty: false,
  undoDepth: 0,
  redoDepth: 0,
  terrain: null,
  backdrop: { meshes: 0, fogged: 0 },
};

// One mutable record behind the exported functions. The bridge is written from
// the render loop *and* from React, and a fresh object per frame would make
// `window.__wovEditor` a moving target for anything holding a reference.
let bridge: { -readonly [K in keyof WovEditorDebug]: WovEditorDebug[K] } = { ...initial };

/** Publishes the bridge on `window`. Safe to call more than once. */
export function installEditorDebugBridge(): void {
  bridge = { ...initial };
  window.__wovEditor = bridge;
}

/** Updates the fields given and leaves the rest alone. */
export function publishEditorDebug(patch: Partial<WovEditorDebug>): void {
  if (window.__wovEditor === undefined) {
    return;
  }
  Object.assign(bridge, patch);
}
