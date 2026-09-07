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
 *
 * The one part that must *not* survive is {@link attachEditorRenderDebug}: it
 * creates a `SceneInstrumentation`, which brackets every `scene.render` with a
 * clock and pulls a Babylon module in behind it. Its only call site is
 * `scene/viewport.ts`, behind `import.meta.env.DEV || __WOV_DEBUG_BRIDGE__` —
 * two build-time literals, so a default build folds the branch away and Rollup
 * shakes the function and its import out with it (ADR-0030, ADR-0047). Verify
 * with `pnpm --filter @wov/editor build && grep -r SceneInstrumentation
 * apps/editor/dist/` — that must find nothing.
 */
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import type { Scene } from '@babylonjs/core/scene.js';

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
   * What the last frame cost the renderer (ADR-0047).
   *
   * The game has had this since ADR-0024 and the editor had nothing: every
   * claim about the editor being slow was somebody's impression of a frame
   * counter that "barely moves". These are the same counters, off Babylon's own
   * instrumentation rather than off our bookkeeping, so the two rigs quote
   * comparable numbers for the same zone.
   *
   * All zeroes until {@link attachEditorRenderDebug} runs, which only a build
   * that carries the bridge does.
   */
  readonly render: WovEditorRenderDebug;
  /**
   * Where the viewport camera stands, or `null` before one is attached.
   *
   * A frame time is a number about a *view*: the village costs several times as
   * much framed from above as it does looking at a wall. `pnpm perf:editor`
   * frames the zone with `F` and writes this into its report, which is what
   * makes two runs comparable rather than merely both being called `load`.
   */
  readonly camera: WovEditorCameraDebug | null;
}

/**
 * Per-frame render counters, mirroring `apps/game/src/dev-debug.ts`.
 *
 * `shadowCasters` sits here rather than in a `lighting` block of its own: the
 * editor's light rig is the game's (ADR-0024) and the one thing a measurement
 * asks of it is how much geometry the shadow pass draws twice.
 */
export interface WovEditorRenderDebug {
  /** Draw calls issued for the last rendered frame. */
  drawCalls: number;
  /** Meshes the camera found worth drawing, instances included. */
  activeMeshes: number;
  /** Triangles submitted for the last frame. */
  triangles: number;
  /**
   * Mean wall-clock milliseconds a `scene.render` took, over every frame since
   * the counters were attached.
   *
   * The running mean, not the last frame — a single frame in a headless browser
   * says nothing. Read together with {@link WovEditorRenderDebug.frames} twice,
   * it yields the mean over the window between the readings (`windowMean` in
   * `tooling/perf/profile-summary.ts`), which is the only average worth quoting
   * for a page that spent its first minute loading.
   */
  frameTimeMs: number;
  /** Frames the mean was taken over. */
  frames: number;
  /** Meshes in the sun's shadow map on the last pass; 0 without shadows. */
  shadowCasters: number;
  /**
   * Textures the scene is holding, `scene.textures.length`.
   *
   * Here because a rebuild is the editor's most expensive gesture and a leaking
   * rebuild is invisible from every other number: turning one ground dial
   * disposes the terrain tile and builds another, and a count that climbs by
   * fourteen every time says the old ones were never released — while the
   * picture, the draw calls and the frame time all look exactly as before.
   */
  sceneTextures: number;
}

/** Where the viewport camera stands and what it orbits, in world metres. */
export interface WovEditorCameraDebug {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
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
  render: {
    drawCalls: 0,
    activeMeshes: 0,
    triangles: 0,
    frameTimeMs: 0,
    frames: 0,
    shadowCasters: 0,
    sceneTextures: 0,
  },
  camera: null,
};

/** A bridge record nothing else holds a reference to. */
function freshBridge(): MutableBridge {
  return { ...initial, render: { ...initial.render } };
}

type MutableBridge = { -readonly [K in keyof WovEditorDebug]: WovEditorDebug[K] };

// One mutable record behind the exported functions. The bridge is written from
// the render loop *and* from React, and a fresh object per frame would make
// `window.__wovEditor` a moving target for anything holding a reference.
let bridge: MutableBridge = freshBridge();

/** Publishes the bridge on `window`. Safe to call more than once. */
export function installEditorDebugBridge(): void {
  bridge = freshBridge();
  window.__wovEditor = bridge;
}

/** Whether a bridge is published — the gate the render counters cost is worth. */
export function isEditorDebugInstalled(): boolean {
  return window.__wovEditor !== undefined;
}

/** Updates the fields given and leaves the rest alone. */
export function publishEditorDebug(patch: Partial<WovEditorDebug>): void {
  if (window.__wovEditor === undefined) {
    return;
  }
  Object.assign(bridge, patch);
}

/** A point the bridge reads off the camera, without importing Babylon's vector. */
interface ReadablePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What {@link attachEditorRenderDebug} needs from the viewport it measures. */
export interface EditorRenderProbe {
  /** The scene the counters belong to. */
  readonly scene: Scene;
  /** Registers a listener that runs after every rendered frame. */
  onFrame(listener: () => void): () => void;
  /**
   * The sun's shadow map, or `null` when the profile turned shadows off.
   *
   * A function and not the map: the rig is replaced whenever the open world's
   * lighting profile changes (`relight` in `scene/viewport.ts`), and a captured
   * handle would keep reporting the casters of one that was thrown away.
   */
  shadowMap(): { readonly renderList?: readonly unknown[] | null } | null;
  /** Where the viewport camera stands and what it orbits. */
  camera(): { readonly position: ReadablePoint; readonly target: ReadablePoint };
}

/**
 * Starts writing per-frame render counters into the bridge, and returns the
 * function that stops again.
 *
 * Call it only behind the build-time flag (`scene/viewport.ts` does): the
 * instrumentation this creates brackets every `scene.render` with a clock, and
 * a shipped editor should not pay for a number nobody reads. With the flag
 * folded to `false` this function has no call site left and Rollup drops it
 * together with `SceneInstrumentation` (ADR-0030).
 *
 * It is a no-op without a published bridge, so a build that *carries* the
 * bridge still costs nothing until somebody opens it with `?debug=1`.
 */
export function attachEditorRenderDebug(probe: EditorRenderProbe): () => void {
  if (!isEditorDebugInstalled()) {
    return () => undefined;
  }
  const instrumentation = new SceneInstrumentation(probe.scene);
  instrumentation.captureFrameTime = true;
  const camera: WovEditorCameraDebug = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0 };
  bridge.camera = camera;

  const unsubscribe = probe.onFrame(() => {
    const render = bridge.render;
    render.frameTimeMs = instrumentation.frameTimeCounter.average;
    render.frames = instrumentation.frameTimeCounter.count;
    render.drawCalls = instrumentation.drawCallsCounter.current;
    render.activeMeshes = probe.scene.getActiveMeshes().length;
    render.triangles = Math.round(probe.scene.getActiveIndices() / 3);
    // The list the pass just drew from, not the one somebody meant to fill.
    render.shadowCasters = probe.shadowMap()?.renderList?.length ?? 0;
    render.sceneTextures = probe.scene.textures.length;
    const view = probe.camera();
    camera.x = view.position.x;
    camera.y = view.position.y;
    camera.z = view.position.z;
    camera.targetX = view.target.x;
    camera.targetY = view.target.y;
    camera.targetZ = view.target.z;
  });

  return () => {
    unsubscribe();
    instrumentation.dispose();
  };
}
