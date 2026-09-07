/**
 * The dev build's debug bridge: a frame counter on `window.__wov` and the same
 * number rendered into the on-screen marker.
 *
 * Why it exists: a loaded page proves nothing about a running renderer. The
 * marker is there whether the render loop ticks, stalls or throws after the
 * first frame. A counter that keeps climbing is the cheapest honest witness,
 * and `pnpm smoke` asserts exactly that. The camera readout is there for the
 * same reason: unit tests prove the camera maths, only a real browser proves
 * that a wheel notch over the canvas reaches it.
 *
 * Why it is dev-only: `window.__wov` is a handle into the running client. It
 * is called behind `import.meta.env.DEV`, which Vite replaces with `false` in
 * a production build, so Rollup drops the branch and this whole module with
 * it. Verify with `pnpm --filter @wov/game build && grep -r __wov dist/` —
 * that must find nothing.
 */
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import type {
  LightingHandle,
  RendererBackend,
  RendererHandle,
  ThirdPersonCameraHandle,
} from '@wov/engine';
import type { ObstacleQuery } from '@wov/gameplay';
import type { PlaceholderTarget } from './placeholder-target.js';

/** Where the camera stands, as plain numbers a test can read out of the page. */
export interface WovCameraDebug {
  yaw: number;
  pitch: number;
  /** The distance in use, after obstacles. */
  distance: number;
  /** The distance the wheel asked for, before obstacles. */
  desiredDistance: number;
  x: number;
  y: number;
  z: number;
}

/** Where the player stands, as plain numbers a test can read out of the page. */
export interface WovPlayerDebug {
  x: number;
  y: number;
  z: number;
  /**
   * The surface the player last ran into, as the raycast reported it
   * (ADR-0038).
   *
   * The one readout that tells "stopped by the house on the left" from "stopped
   * by the fence in front", and the reason it is on the bridge at all: sliding
   * is a claim about a *direction*, and a position on its own cannot check a
   * direction. It is the last face met and not the face met right now — a
   * player standing still runs into nothing — so it keeps its value until the
   * next one. All zeroes until something is first run into.
   */
  normalX: number;
  normalY: number;
  normalZ: number;
  /** How far ahead that surface was, in metres. */
  contactDistance: number;
}

/**
 * Where a ray met collision geometry, and what it met.
 *
 * The normal is here for the same reason it is on `player` (ADR-0038): a test
 * that walks along a house has to be able to say the surface beside the player
 * is a wall and which way it faces, and a hit point alone says neither.
 */
export interface WovRayHit {
  x: number;
  y: number;
  z: number;
  /** Unit surface normal at the hit, as the raycast reported it. */
  normalX: number;
  normalY: number;
  normalZ: number;
  /** Distance from the start of the ray, in metres. */
  distance: number;
}

/** The read-only view other dev tooling (and the smoke test) may rely on. */
export interface WovDebugBridge {
  /** Which engine implementation the renderer ended up on. */
  readonly backend: RendererBackend;
  /** Index of the last rendered frame; `-1` before the first one. */
  readonly frameId: number;
  /** The live camera, or `null` when none was handed to the bridge. */
  readonly camera: WovCameraDebug | null;
  /**
   * Where the rendered player stands, or `null` when none was handed over.
   *
   * It is read off the *mesh*, deliberately: the smoke test has to prove that
   * the simulation reaches the picture, and a number copied straight out of the
   * gameplay state would pass even with the renderer disconnected.
   */
  readonly player: WovPlayerDebug | null;
  /**
   * Height of the collision ground at a point, or `null` where there is none.
   *
   * The same `raycastGround` the movement system's ground query uses, only from
   * high above instead of from the capsule's head — which is what lets a test
   * check the ground somewhere the player is not standing. It answers `null`
   * until the physics world is up.
   */
  groundAt(x: number, z: number): number | null;
  /**
   * Where a straight line first meets collision geometry, or `null` for a clear
   * line.
   *
   * The one way a test can ask about a *hole*: an archway's collision mesh is
   * only right if a line through its opening is clear and a line through its
   * post is not, and no screenshot and no walk can tell those two apart as
   * plainly (ADR-0026).
   */
  rayHit(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
  ): WovRayHit | null;
  /**
   * The world-space hull of the terrain tile, or `null` before it is loaded.
   *
   * Measured off the scene rather than restated from the world file: "the tile
   * covers the metres it says" is the one claim a handedness flip breaks, and a
   * number copied out of the description would agree with itself forever.
   */
  readonly terrainBounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  /**
   * What the last frame cost the renderer.
   *
   * Frames per second in a headless browser say nothing — there is no display
   * to keep up with and the software rasteriser sets the pace. Draw calls and
   * triangles do: they are what a world of 1216 entities is measured in, and
   * they are the numbers that tell instancing from cloning (ADR-0022). Read
   * off Babylon's own counters, not from our bookkeeping.
   */
  readonly render: WovRenderDebug;
  /** What the light rig is doing (ADR-0024), or `null` before it is reported. */
  readonly lighting: WovLightingDebug | null;

  /**
   * What the zone's entity collision cost and produced, or `null` before it is
   * built (ADR-0026).
   *
   * Reported rather than recomputed: "the player is stopped by a wall" is
   * something a Playwright run proves by walking into one, but "220 shapes
   * carry 1216 bodies" is a number only the builder knows, and a claim about
   * cost that nobody can read is a claim nobody can check.
   */
  readonly collision: WovCollisionDebug | null;

  /**
   * What the painted distance is doing, or `null` before the zone is placed
   * (ADR-0031).
   *
   * Every way a backdrop fails is invisible: `applyFog` written on an
   * `InstancedMesh` instead of on its source is accepted and does nothing, and
   * a shell drawn under this world's fog is a flat band of fog colour that
   * reads as a sky. So the three flags are counted on the meshes themselves,
   * after the fact, rather than assumed from the code that set them.
   */
  readonly backdrop: WovBackdropDebug | null;
}

/**
 * The three flags this reads off one backdrop mesh.
 *
 * Structural, like every other subject of this bridge: a Babylon `AbstractMesh`
 * satisfies it, and so does the object a test writes by hand.
 */
export interface BackdropReadout {
  readonly applyFog: boolean;
  readonly isPickable: boolean;
  readonly receiveShadows: boolean;
  readonly name: string;
  readonly isEnabled: () => boolean;
  readonly isVisible: boolean;
}

/** What the backdrop meshes report about themselves, counted on the meshes. */
export interface WovBackdropDebug {
  /** Meshes of every entity whose prefab is `backdrop`. */
  meshes: number;
  /** How many of them still have fog applied. Must be zero. */
  fogged: number;
  /** How many of them are still pickable. Must be zero. */
  pickable: number;
  /** How many of them still receive shadow. Must be zero. */
  receivingShadow: number;
  /**
   * How many of them the camera actually drew last frame.
   *
   * The number that separates "the models loaded" from "the horizon is on
   * screen". A shell can be in the scene, unfogged and unlit, and still be
   * culled, disabled or facing away — and every one of those looks exactly like
   * an empty sky.
   */
  drawn: number;
}

/** What building the zone's collision cost, as plain numbers a test can read. */
export interface WovCollisionDebug {
  readonly shapes: number;
  readonly bodies: number;
  readonly triangles: number;
  readonly passable: number;
  readonly undeclared: number;
  readonly failed: readonly string[];
  readonly milliseconds: number;
}

/** Per-frame render counters, as plain numbers a test can read out of the page. */
export interface WovRenderDebug {
  /** Draw calls issued for the last rendered frame. */
  drawCalls: number;
  /** Meshes the camera found worth drawing, instances included. */
  activeMeshes: number;
  /** Triangles submitted for the last frame. */
  triangles: number;
  /**
   * Average wall-clock milliseconds a scene render took, over every frame since
   * the page opened.
   *
   * The average, not the last frame: a single frame in a headless browser says
   * nothing — a shader compile, a texture upload or the operating system can
   * own any one of them. It is the number a shadow map or a post-processing
   * chain is paid for in, so it is measured on the same bridge as the draw
   * calls rather than timed from the outside (ADR-0024).
   *
   * Wall clock, not GPU time. `EngineInstrumentation.captureGPUFrameTime`
   * needs the timer-query extension, which this build's engine does not even
   * expose a method for; a number that is not there is better left out than
   * reported as a zero somebody would quote.
   */
  frameTimeMs: number;
  /** Frames the average was taken over. */
  frames: number;
}

/**
 * What the light rig is doing, as plain values a test can read.
 *
 * "The screenshot looks warmer" is not a measurement. These are: whether a
 * shadow map exists and how big it is, whether the grading chain is attached,
 * and how many meshes the shadow pass drew — which is the count that tells a
 * scene that casts shadows from one that merely has a light claiming to.
 */
export interface WovLightingDebug {
  shadows: boolean;
  shadowMapSize: number;
  /** Meshes rendered into the shadow map on the last pass. */
  shadowCasters: number;
  postProcessing: boolean;
  fog: boolean;
  sky: boolean;
  /**
   * Where the sun stands, which is the only readable witness that the shadow
   * box still follows the player.
   *
   * The map covers `shadows.distance` metres around a focus point and the light
   * is parked that far behind it (`@wov/engine`'s `focusShadows`). Nothing else
   * in the scene says where that box is: the generator reports its size, not its
   * centre. So a test that walks thirty metres and reads this twice is the one
   * way to tell a following shadow map from one that was centred once and then
   * left behind — which looks, from a still frame at the spawn point, exactly
   * the same.
   */
  sun: { x: number; y: number; z: number };
}

declare global {
  interface Window {
    /** Present in the dev build only — see `apps/game/src/dev-debug.ts`. */
    __wov?: WovDebugBridge;
  }
}

/** What the bridge may report besides the renderer itself. */
export interface DevDebugSubjects {
  readonly camera?: ThirdPersonCameraHandle;
  readonly player?: PlaceholderTarget;
  /** Answers `groundAt`; the app owns it because the app owns the physics world. */
  readonly groundAt?: (x: number, z: number) => number | null;
  /**
   * The light rig in use, read fresh each frame.
   *
   * A getter rather than the handle: the rig is replaced when the world file
   * arrives (ADR-0024), and a captured handle would keep reporting the numbers
   * of the one that was thrown away.
   */
  readonly lighting?: () => LightingHandle | null;
  /** Answers `rayHit`, for the same reason. */
  readonly rayHit?: (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
  ) => WovRayHit | null;
}

/** The hull the bridge reports for the terrain tile. */
export interface WovTerrainBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Shown until the first frame lands, so `frame <digits>` never lies. */
const NO_FRAME_YET = 'frame …';

/**
 * Publishes the bridge and starts writing the frame counter into `marker`.
 *
 * There is no teardown: the bridge lives as long as the page, and the renderer
 * disposing takes the frame listener with it. A teardown nobody calls would be
 * untested code pretending to be a feature.
 */
export function installDevDebugBridge(
  renderer: RendererHandle,
  marker: HTMLElement | null,
  subjects: DevDebugSubjects = {},
): {
  reportTerrainBounds(bounds: WovTerrainBounds): void;
  reportCollision(report: WovCollisionDebug): void;
  reportBackdrop(meshes: readonly BackdropReadout[]): void;
  watchObstacles(query: ObstacleQuery): ObstacleQuery;
} {
  const camera = subjects.camera;
  const player = subjects.player;
  // One object, mutated per frame rather than rebuilt: the bridge is dev-only
  // but it still runs inside the frame budget (spec §38).
  const cameraDebug: WovCameraDebug | null = camera
    ? { yaw: 0, pitch: 0, distance: 0, desiredDistance: 0, x: 0, y: 0, z: 0 }
    : null;
  const playerDebug: WovPlayerDebug | null = player
    ? { x: 0, y: 0, z: 0, normalX: 0, normalY: 0, normalZ: 0, contactDistance: 0 }
    : null;
  const readLighting = subjects.lighting;
  const lightingDebug: WovLightingDebug | null = readLighting
    ? {
        shadows: false,
        shadowMapSize: 0,
        shadowCasters: 0,
        postProcessing: false,
        fog: false,
        sky: false,
        sun: { x: 0, y: 0, z: 0 },
      }
    : null;
  const groundAt = subjects.groundAt ?? ((): null => null);
  const rayHit = subjects.rayHit ?? ((): null => null);
  const bridge: {
    backend: RendererBackend;
    frameId: number;
    camera: WovCameraDebug | null;
    player: WovPlayerDebug | null;
    groundAt: (x: number, z: number) => number | null;
    rayHit: (
      from: readonly [number, number, number],
      to: readonly [number, number, number],
    ) => WovRayHit | null;
    terrainBounds: WovTerrainBounds | null;
    render: WovRenderDebug;
    lighting: WovLightingDebug | null;
    collision: WovCollisionDebug | null;
    backdrop: WovBackdropDebug | null;
  } = {
    backend: renderer.backend,
    frameId: -1,
    camera: cameraDebug,
    player: playerDebug,
    groundAt,
    rayHit,
    terrainBounds: null,
    render: {
      drawCalls: 0,
      activeMeshes: 0,
      triangles: 0,
      frameTimeMs: 0,
      frames: 0,
    },
    lighting: lightingDebug,
    collision: null,
    backdrop: null,
  };
  window.__wov = bridge;

  const frameElement = document.createElement('span');
  frameElement.dataset['testid'] = 'game-frame';
  frameElement.style.marginLeft = '0.6em';
  frameElement.style.opacity = '0.75';
  frameElement.textContent = NO_FRAME_YET;
  marker?.append(frameElement);

  // Babylon resets the draw-call counter per frame only while something asks
  // it to; that is all this instrumentation is here for.
  let backdropMeshes: readonly BackdropReadout[] = [];

  const instrumentation = new SceneInstrumentation(renderer.scene);
  instrumentation.captureFrameTime = true;

  renderer.onFrame((frame) => {
    bridge.frameId = frame.index;
    if (bridge.backdrop !== null) {
      const active = new Set(renderer.scene.getActiveMeshes().data.map((mesh) => mesh?.name));
      bridge.backdrop.drawn = backdropMeshes.filter((mesh) => active.has(mesh.name)).length;
    }
    bridge.render.frameTimeMs = instrumentation.frameTimeCounter.average;
    bridge.render.frames = instrumentation.frameTimeCounter.count;
    bridge.render.drawCalls = instrumentation.drawCallsCounter.current;
    bridge.render.activeMeshes = renderer.scene.getActiveMeshes().length;
    bridge.render.triangles = Math.round(renderer.scene.getActiveIndices() / 3);
    if (camera && cameraDebug) {
      const state = camera.state;
      cameraDebug.yaw = state.yaw;
      cameraDebug.pitch = state.pitch;
      cameraDebug.distance = state.distance;
      cameraDebug.desiredDistance = state.desiredDistance;
      cameraDebug.x = camera.camera.position.x;
      cameraDebug.y = camera.camera.position.y;
      cameraDebug.z = camera.camera.position.z;
    }
    if (readLighting && lightingDebug) {
      const rig = readLighting();
      const map = rig?.shadows?.getShadowMap() ?? null;
      lightingDebug.shadows = map !== null;
      lightingDebug.shadowMapSize = map?.getSize().width ?? 0;
      // The list the shadow pass just drew from, not the list somebody meant to
      // fill: it is rebuilt from the scene every pass (ADR-0024), so a zero
      // here is a scene whose casters really are absent.
      lightingDebug.shadowCasters = map?.renderList?.length ?? 0;
      lightingDebug.postProcessing = rig?.pipeline != null;
      lightingDebug.fog = renderer.scene.fogEnabled && renderer.scene.fogMode !== 0;
      lightingDebug.sky = rig?.sky != null;
      const sunAt = rig?.sun.position;
      lightingDebug.sun.x = sunAt?.x ?? 0;
      lightingDebug.sun.y = sunAt?.y ?? 0;
      lightingDebug.sun.z = sunAt?.z ?? 0;
    }
    if (player && playerDebug) {
      const at = player.root.position;
      playerDebug.x = at.x;
      playerDebug.y = at.y;
      playerDebug.z = at.z;
    }
    // One small text write per frame, and only in the dev build: the string
    // changes every frame, so caching it would never hit (spec §38).
    frameElement.textContent = `frame ${frame.index}`;
  });

  return {
    /**
     * The same obstacle query, with the last face it reported written onto the
     * bridge.
     *
     * A decorator rather than a second query: the movement solver has to be
     * asking the *same* thing the game asks, or the readout describes a
     * measurement nobody made. It lives in this module so a production build
     * drops it together with the rest of the bridge (ADR-0030).
     */
    watchObstacles(query) {
      if (playerDebug === null) {
        return query;
      }
      const contact = playerDebug;
      return {
        firstHit(from, to, radius) {
          const hit = query.firstHit(from, to, radius);
          if (hit !== null) {
            contact.normalX = hit.normal.x;
            contact.normalY = hit.normal.y;
            contact.normalZ = hit.normal.z;
            contact.contactDistance = hit.distance;
          }
          return hit;
        },
      };
    },

    reportTerrainBounds(bounds) {
      bridge.terrainBounds = bounds;
    },
    reportCollision(report) {
      bridge.collision = report;
    },
    reportBackdrop(meshes) {
      backdropMeshes = meshes;
      // Read off the meshes rather than off the intention: this is the one
      // number that distinguishes "we set applyFog" from "the material's
      // defines were rebuilt without fog".
      bridge.backdrop = {
        meshes: meshes.length,
        fogged: meshes.filter((mesh) => mesh.applyFog).length,
        pickable: meshes.filter((mesh) => mesh.isPickable).length,
        receivingShadow: meshes.filter((mesh) => mesh.receiveShadows).length,
        drawn: 0,
      };
    },
  };
}
