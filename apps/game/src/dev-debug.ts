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
import type { RendererBackend, RendererHandle, ThirdPersonCameraHandle } from '@wov/engine';
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
): { reportTerrainBounds(bounds: WovTerrainBounds): void } {
  const camera = subjects.camera;
  const player = subjects.player;
  // One object, mutated per frame rather than rebuilt: the bridge is dev-only
  // but it still runs inside the frame budget (spec §38).
  const cameraDebug: WovCameraDebug | null = camera
    ? { yaw: 0, pitch: 0, distance: 0, desiredDistance: 0, x: 0, y: 0, z: 0 }
    : null;
  const playerDebug: WovPlayerDebug | null = player ? { x: 0, y: 0, z: 0 } : null;
  const groundAt = subjects.groundAt ?? ((): null => null);
  const bridge: {
    backend: RendererBackend;
    frameId: number;
    camera: WovCameraDebug | null;
    player: WovPlayerDebug | null;
    groundAt: (x: number, z: number) => number | null;
    terrainBounds: WovTerrainBounds | null;
  } = {
    backend: renderer.backend,
    frameId: -1,
    camera: cameraDebug,
    player: playerDebug,
    groundAt,
    terrainBounds: null,
  };
  window.__wov = bridge;

  const frameElement = document.createElement('span');
  frameElement.dataset['testid'] = 'game-frame';
  frameElement.style.marginLeft = '0.6em';
  frameElement.style.opacity = '0.75';
  frameElement.textContent = NO_FRAME_YET;
  marker?.append(frameElement);

  renderer.onFrame((frame) => {
    bridge.frameId = frame.index;
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
    reportTerrainBounds(bounds) {
      bridge.terrainBounds = bounds;
    },
  };
}
