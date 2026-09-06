/**
 * Game entry point (Phase 1).
 *
 * Wiring only — every piece it connects is tested on its own:
 *
 * ```text
 * DOM events → keyboard-mouse → binder → InputState
 *                                             ↓
 *                              MovementSystem (@wov/gameplay)
 *                                             ↓
 *                                        WorldState
 *                                             ↓
 *                        interpolatePosition → placeholder capsule
 *                                             ↓
 *                              third-person camera (@wov/engine)
 * ```
 *
 * The direction of that arrow is the rule: state flows into the renderer and
 * never back (spec §25, ADR-0009). No gameplay decision is made in this file,
 * and no editor code may reach it (spec §10, checked by `pnpm lint:boundaries`).
 *
 * There is exactly **one** loop (ADR-0010): `createGameLoop` owns the frame,
 * runs the simulation on a fixed step and calls `renderer.renderFrame()` once
 * per frame. The renderer is therefore created with `autoStart: false` — a
 * second, engine-driven render loop would render frames the simulation never
 * saw.
 *
 * The environment probe and the physics backend are started next to the loop and
 * never awaited by it: a slow model or a 2 MB WASM download delays the barrel
 * and the collision, not the player walking (spec §38). The terrain probe joins
 * the same sequence: once the ground is loaded it replaces the placeholder plane
 * as both the picture and the collision geometry, and the player is put down on
 * it (ADR-0020).
 */
import {
  MovementSystem,
  NEUTRAL_INPUT,
  createMovement,
  createTransform,
  createWorldState,
  flatGround,
  getTransform,
  toEntityId,
  vec3,
  type GroundQuery,
  type Transform,
  type WorldState,
} from '@wov/gameplay';
import { summarizeAssetSources, summarizePlacement } from '@wov/asset-system';
import type { AssetEnv } from '@wov/asset-system';
import type { PhysicsWorld } from '@wov/physics';
import { tokens } from '@wov/ui';
import { installDevDebugBridge } from './dev-debug.js';
import type { WovTerrainBounds } from './dev-debug.js';
import { loadEnvironment } from './environment.js';
import { VILLAGE_TERRAIN, loadTerrainProbe, spawnFromQuery } from './terrain-probe.js';
import { createGamePhysicsWorld, toStaticMeshData } from './physics-backend.js';
import { physicsGround } from './physics-ground.js';
import { attachKeyboardMouse } from './input/keyboard-mouse.js';
import { createGameLoop } from './loop.js';
import { interpolatePosition } from './render/interpolate.js';
import { createGameScene } from './scene.js';

/** The one entity the keys steer in Phase 1. */
const PLAYER = toEntityId('player');

/**
 * How far above the tallest ground a spawn probe starts, in metres.
 *
 * The village height field reaches 73 m, so a ray that starts at head height
 * would begin under the ground it is looking for. This is the *placement* probe,
 * not the per-step ground query — that one stays at head height on purpose
 * (`physics-ground.ts`), so a roof is never mistaken for a floor.
 */
const SPAWN_PROBE_HEIGHT = 200;

/** The player's components, so a respawn states them once instead of twice. */
function playerSpec(position: { x: number; y: number; z: number }): {
  id: string;
  transform: Transform;
  movement: ReturnType<typeof createMovement>;
  input: typeof NEUTRAL_INPUT;
} {
  return {
    id: PLAYER,
    transform: createTransform(vec3(position.x, position.y, position.z)),
    movement: createMovement(),
    // Present, not absent: the Input component is what tells the movement
    // system this entity follows the keys instead of coasting to a stop.
    input: NEUTRAL_INPUT,
  };
}

/**
 * The one environment variable the asset system reads, picked out explicitly.
 * `import.meta.env` carries Vite's own keys too, and handing the whole object
 * over would let a typo in `AssetEnv` pass unnoticed.
 */
const assetEnv: AssetEnv = { VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL };

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');
const controls = document.querySelector<HTMLElement>('[data-testid="game-controls"]');
const assetStatus = document.querySelector<HTMLElement>('[data-testid="game-assets"]');
const assetSources = document.querySelector<HTMLElement>('[data-testid="game-asset-sources"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [marker, status, controls, assetStatus, assetSources]) {
  if (element) {
    element.style.background = tokens.colorSurface;
    element.style.borderRadius = tokens.radius;
  }
}
if (marker) {
  marker.style.color = tokens.colorAccent;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(text: string): void {
  if (status) {
    status.textContent = text;
  }
}

function setAssetStatus(text: string): void {
  if (assetStatus) {
    assetStatus.textContent = text;
  }
}

/**
 * Says how many assets came out of the private store and how many fell back to
 * a committed placeholder (ADR-0015). Printed even when both are zero: a line
 * that goes quiet when the store is missing hides the one thing it is for.
 */
function setAssetSources(text: string): void {
  if (assetSources) {
    assetSources.textContent = text;
  }
}

/**
 * Brings the client up.
 *
 * Asynchronous because `createRenderer` may have to initialise WebGPU before
 * it can hand back a scene (ADR-0006).
 */
async function start(canvas: HTMLCanvasElement): Promise<void> {
  const { renderer, base, camera, player } = await createGameScene(canvas, {
    // The game loop below drives the frames; see the module comment.
    render: { resolutionScale: 1, autoStart: false },
  });

  // The device edge (ADR-0010) owns keys and mouse buttons. Look and zoom stay
  // with the camera's own input (ADR-0008), which also carries the drag-look
  // fallback for browsers that refuse pointer lock — hence `ownsLook: false`,
  // so the mouse is not read twice and pointer lock is not requested twice.
  const input = attachKeyboardMouse({
    keys: window,
    pointer: canvas,
    lockOwner: document,
    ownsLook: false,
  });

  // One entity, standing on the Phase 1 plane until the terrain arrives.
  let world: WorldState = createWorldState([playerSpec({ x: 0, y: 0, z: 0 })]);

  /**
   * The ground the movement system adheres to.
   *
   * A flat plane until physics is up, and the collision geometry afterwards —
   * see `startPhysics` below. Starting flat rather than waiting is what keeps
   * the player walking during the backend's ~2 MB download.
   */
  let ground: GroundQuery = flatGround(0);

  /** Set once the backend is up; `null` while it loads, and after a failure. */
  let physics: PhysicsWorld | null = null;
  /** What the status line says about the renderer and the simulation. */
  let baseStatus = '';

  // The state the previous step ended in, kept so a frame between two steps can
  // be interpolated instead of snapped.
  let previous: Transform = getTransform(world, PLAYER) ?? createTransform();

  const loop = createGameLoop({
    scheduler: {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => {
        window.cancelAnimationFrame(handle);
      },
    },

    step(fixedDelta) {
      previous = getTransform(world, PLAYER) ?? previous;
      // Sampling once per step is what consumes the edge-triggered actions: a
      // click fires in the first step of a frame and not again in the next.
      // The camera's own yaw is the frame the axes are rotated into, so "W"
      // means "away from the camera" whichever way the player turned it.
      world = MovementSystem.update(world, input.sample(camera.state.yaw), fixedDelta, ground);
      // Physics advances on the same fixed step as gameplay, not on the frame:
      // the simulation must not run faster on a 144 Hz display (ADR-0013).
      physics?.step(fixedDelta);
    },

    render(alpha) {
      const current = getTransform(world, PLAYER);
      if (current) {
        const position = interpolatePosition(previous, current, alpha);
        // The placeholder's root sits at the feet, exactly like the gameplay
        // transform, so the position is copied across without an offset.
        player.root.position.set(position.x, position.y, position.z);
      }
      // The camera updates on the scene's before-render hook, so it reads the
      // position written just above — this frame's, not the previous one's.
      renderer.renderFrame();
    },
  });

  loop.start();
  baseStatus = `renderer ready — ${renderer.backend} · simulation 60 Hz`;
  setStatus(baseStatus);

  /** Set in the dev build only; see the note on `installDevDebugBridge`. */
  let debugBridge: { reportTerrainBounds(bounds: WovTerrainBounds): void } | null = null;
  if (import.meta.env.DEV) {
    // Vite replaces the condition with `false` when building for production,
    // so Rollup drops this call and `./dev-debug.js` with it.
    debugBridge = installDevDebugBridge(renderer, marker, {
      camera,
      player,
      // Reads the live world through a closure rather than a captured value:
      // the physics world does not exist yet when the bridge is installed.
      groundAt: (x, z) => probeGround(x, z),
    });
  }

  /**
   * The collision height at a point, probed from above the tallest ground.
   *
   * Used to put the player down on the terrain and, in the dev build, to check
   * the collision mesh against the height field it came from. It is the same
   * `raycastGround` the movement system's query uses (ADR-0014: one ground
   * query), only from a placement height rather than from the capsule's head.
   */
  function probeGround(x: number, z: number): number | null {
    const hit = physics?.raycastGround(
      { x, y: SPAWN_PROBE_HEIGHT, z },
      { maxDistance: SPAWN_PROBE_HEIGHT * 2 },
    );
    return hit ? hit.point.y : null;
  }

  /**
   * Brings the physics world up and hands it the ground.
   *
   * Nothing here names Havok: the backend is loaded lazily behind
   * `createGamePhysicsWorld` (ADR-0013), and everything below talks to the
   * `PhysicsWorld` contract. Once it is up, the movement system stops asking a
   * hard-coded plane where the ground is and asks the collision geometry.
   */
  async function startPhysics(): Promise<PhysicsWorld | null> {
    try {
      const created = await createGamePhysicsWorld(renderer.scene);
      created.addStaticMesh(toStaticMeshData(base.ground));
      // From here the movement system stops adhering to a hard-coded plane and
      // starts asking the collision geometry where the ground is.
      ground = physicsGround(created, () => getTransform(world, PLAYER)?.position.y ?? 0);
      physics = created;
      setStatus(`${baseStatus} · physics ready — ground is collision geometry`);
      return created;
    } catch (error) {
      // A missing backend must not stop the game: the flat plane keeps the
      // player walking, and the status line says what was lost.
      setStatus(`${baseStatus} · physics unavailable: ${describe(error)}`);
      return null;
    }
  }

  /**
   * Loads the terrain probe and lets the authored ground take over.
   *
   * Order matters and is the whole point: the tile becomes collision geometry
   * *before* the placeholder plane is switched off, so there is never a frame in
   * which the player has nothing to stand on. Only then is the capsule put down
   * on the terrain — teleporting first would drop it through a floor that does
   * not exist yet.
   *
   * The physics world is awaited rather than raced: a tile that is drawn but not
   * collidable is exactly the failure that looks fine in a screenshot.
   */
  async function startTerrain(): Promise<void> {
    const world3d = await startPhysics();
    const query = new URLSearchParams(window.location.search);
    let loaded;
    try {
      loaded = await loadTerrainProbe(
        renderer.scene,
        assetEnv,
        VILLAGE_TERRAIN,
        query.get('terrain-layers'),
      );
    } catch (error) {
      setStatus(`${baseStatus} · terrain unavailable: ${describe(error)}`);
      return;
    }

    if (debugBridge !== null) {
      const hull = loaded.terrain.meshes.reduce<{
        min: [number, number, number];
        max: [number, number, number];
      } | null>((box, mesh) => {
        const info = mesh.getBoundingInfo().boundingBox;
        if (box === null) {
          return {
            min: [info.minimumWorld.x, info.minimumWorld.y, info.minimumWorld.z],
            max: [info.maximumWorld.x, info.maximumWorld.y, info.maximumWorld.z],
          };
        }
        return {
          min: [
            Math.min(box.min[0], info.minimumWorld.x),
            Math.min(box.min[1], info.minimumWorld.y),
            Math.min(box.min[2], info.minimumWorld.z),
          ],
          max: [
            Math.max(box.max[0], info.maximumWorld.x),
            Math.max(box.max[1], info.maximumWorld.y),
            Math.max(box.max[2], info.maximumWorld.z),
          ],
        };
      }, null);
      if (hull !== null) {
        debugBridge.reportTerrainBounds(hull);
      }
    }

    const triangles = loaded.terrain.meshes.reduce(
      (total, mesh) => total + (mesh.getIndices()?.length ?? 0) / 3,
      0,
    );

    if (world3d === null) {
      setStatus(`${baseStatus} · terrain drawn, but nothing to collide with`);
      return;
    }

    for (const mesh of loaded.terrain.meshes) {
      world3d.addStaticMesh(toStaticMeshData(mesh));
    }
    // The authored ground has taken over; the Phase 1 plane would now fight it
    // for pixels and answer ground queries a hundred metres below it.
    base.ground.setEnabled(false);

    const [spawnX, spawnZ] = spawnFromQuery(query.get('terrain-spawn'), VILLAGE_TERRAIN.size);
    const spawnY = probeGround(spawnX, spawnZ);
    if (spawnY !== null) {
      world = createWorldState([playerSpec({ x: spawnX, y: spawnY, z: spawnZ })]);
      previous = getTransform(world, PLAYER) ?? previous;
    }

    setStatus(
      `${baseStatus} · terrain ready — ${String(Math.round(triangles))} collision triangles` +
        (loaded.fromPlaceholder ? ' (placeholder tile: no asset store)' : ''),
    );
  }

  void startTerrain();

  // Started after the loop and deliberately not awaited: a slow model delays
  // the barrel appearing, not the scene showing up (spec §38).
  void loadEnvironment(renderer.scene, assetEnv).then(
    (result) => {
      setAssetStatus(summarizePlacement(result.placement));
      setAssetSources(summarizeAssetSources(result.sources));
      for (const failure of result.placement.failures) {
        console.error(`asset "${failure.placement.asset}" could not be placed`, failure.error);
      }
    },
    (error: unknown) => {
      setAssetStatus(`assets: loader unavailable — ${describe(error)}`);
      setAssetSources('assets: source unknown');
    },
  );
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
  setAssetStatus('assets: no scene to load into');
  setAssetSources('assets: no scene to load into');
} else {
  void start(canvas).catch((error: unknown) => {
    // A failing bootstrap must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${describe(error)}`);
  });
}
