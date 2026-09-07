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
 * The world and the physics backend are started next to the loop and never
 * awaited by it: a 400 kB world file or a 2 MB WASM download delays the village
 * appearing, not the player walking (spec §38). The world arrives from the API
 * (ADR-0022): its zone's ground replaces the placeholder plane as both the
 * picture and the collision geometry, the player is put down on it, and its
 * entities are placed from the prefab catalogue. Nothing here reads
 * `assets/manifest.json` — the catalogue says where each model's bytes are.
 */
import {
  MovementSystem,
  NEUTRAL_INPUT,
  NO_OBSTACLES,
  createMovement,
  createTransform,
  createWorldState,
  flatGround,
  getMovement,
  getTransform,
  toEntityId,
  vec3,
  type GroundQuery,
  type ObstacleQuery,
  type Transform,
  type WorldState,
} from '@wov/gameplay';
import { summarizeAssetSources } from '@wov/asset-system';
import {
  applyWorldSound,
  createAudioEngine,
  freezeMaterialsWhenReady,
  freezeStaticNodes,
  resolveSoundProfile,
  surfaceOfLayer,
  type AudioSystem,
  type TerrainSurfaceProbe,
  type WorldSoundHandle,
} from '@wov/engine';
import type { PhysicsWorld } from '@wov/physics';
import { tokens } from '@wov/ui';
import { isDebugRequested } from '@wov/shared';
import { installDevDebugBridge } from './dev-debug.js';
import type {
  BackdropReadout,
  WovCollisionDebug,
  WovSoundDebug,
  WovTerrainBounds,
} from './dev-debug.js';
import {
  lightingProfiles,
  lookFromQuery,
  resolveGameConfig,
  soundEnabled,
  worldIdFromQuery,
} from './config.js';
import { advanceStride, initialStride, type StrideState } from './footstep-stride.js';
import { clipSource, createZoneSurfaceProbe } from './zone-sound.js';
import type { WorldDefinition, ZoneDefinition } from '@wov/world-schema';
import { createWorldApi } from './world-api.js';
import {
  NO_SOURCES,
  addSources,
  buildZoneCollision,
  loadZoneTerrain,
  placeEntities,
  playableZone,
  spawnFromQuery,
} from './world-scene.js';
import { createGamePhysicsWorld, toStaticMeshData } from './physics-backend.js';
import { physicsGround } from './physics-ground.js';
import { physicsObstacles } from './physics-obstacles.js';
import { attachKeyboardMouse } from './input/keyboard-mouse.js';
import { createFrameStats, formatFrameSample } from './frame-stats.js';
import { createGameLoop } from './loop.js';
import { interpolatePosition } from './render/interpolate.js';
import { createGameScene } from './scene.js';

/** The one entity the keys steer in Phase 1. */
const PLAYER = toEntityId('player');

/**
 * The part of a Babylon mesh the terrain hull is measured from.
 *
 * Declared structurally rather than imported: this file needs three vectors off
 * a bounding box, and importing `Mesh` for a type would be an import of the
 * whole class for nothing.
 */
interface BoundingInfoLike {
  readonly boundingBox: {
    readonly minimumWorld: { x: number; y: number; z: number };
    readonly maximumWorld: { x: number; y: number; z: number };
  };
}

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
 * The two environment variables the client reads, picked out explicitly.
 * `import.meta.env` carries Vite's own keys too, and handing the whole object
 * over would let a typo in `GameEnv` pass unnoticed.
 */
const config = resolveGameConfig({
  VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL,
  VITE_API_URL: import.meta.env.VITE_API_URL,
});

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');
const controls = document.querySelector<HTMLElement>('[data-testid="game-controls"]');
const assetStatus = document.querySelector<HTMLElement>('[data-testid="game-assets"]');
const assetSources = document.querySelector<HTMLElement>('[data-testid="game-asset-sources"]');
const worldStatus = document.querySelector<HTMLElement>('[data-testid="game-world"]');
const collisionStatus = document.querySelector<HTMLElement>('[data-testid="game-collision"]');
const soundStatus = document.querySelector<HTMLElement>('[data-testid="game-sound"]');
const frameReadout = document.querySelector<HTMLElement>('[data-testid="game-fps"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [
  marker,
  status,
  controls,
  assetStatus,
  assetSources,
  worldStatus,
  collisionStatus,
  soundStatus,
  frameReadout,
]) {
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
 * Says which world is on screen, or why none is (ADR-0022). It is its own line
 * because "the renderer is up" and "there is a village in front of you" are
 * different claims, and a client with no API reachable must say the second one
 * out loud instead of showing an empty plane.
 */
function setWorldStatus(text: string): void {
  if (worldStatus) {
    worldStatus.textContent = text;
  }
}

/**
 * Says what the player can bump into (ADR-0026).
 *
 * Its own line for the same reason the world has one: "the village is on
 * screen" and "the village is solid" are different claims, and the second one
 * arrives seconds after the first.
 */
function setCollisionStatus(text: string): void {
  if (collisionStatus) {
    collisionStatus.textContent = text;
  }
}

/**
 * Says what can be heard, or why nothing can (ADR-0052).
 *
 * Its own line, like the world's and the collision's, and for the same reason:
 * "the village is on screen" and "the village makes a noise" are different
 * claims arriving seconds apart. It is also the only place a browser's autoplay
 * policy can be reported — a page that has not been clicked has no sound, and
 * that is not a bug to hunt.
 */
function setSoundStatus(text: string): void {
  if (soundStatus) {
    soundStatus.textContent = text;
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
  const scene3d = await createGameScene(canvas, {
    // The game loop below drives the frames; see the module comment.
    render: { resolutionScale: 1, autoStart: false },
    // The diagnostic switches apply from the first frame, not from the one the
    // world file arrives in: `?flat=1` exists so a screenshot can be taken with
    // no rig at all, and a rig built for two seconds and thrown away is still a
    // rig that was paid for.
    lighting: lightingProfiles(window.location.search, []),
    // `?look=yaw[,pitch]`, so a comparison screenshot can be aimed by URL
    // instead of by dragging a mouse (ADR-0032).
    camera: lookFromQuery(window.location.search) ?? {},
  });
  const { renderer, base, camera, player } = scene3d;
  /**
   * The light rig. Replaced once the world file says how it wants to be lit
   * (ADR-0024), so this is read through a variable rather than destructured.
   */
  let lighting = scene3d.lighting();

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

  /**
   * What is beside the player.
   *
   * "Nothing" until the zone's entities have collision bodies — which is what
   * the game did before ADR-0026, and what it still does for the seconds the
   * models take to arrive. The status line says when that changes.
   */
  let obstacles: ObstacleQuery = NO_OBSTACLES;

  /** Set once the backend is up; `null` while it loads, and after a failure. */
  let physics: PhysicsWorld | null = null;
  /** What the status line says about the renderer and the simulation. */
  let baseStatus = '';
  /** Where the ground's bytes came from, kept so both loaders share one line. */
  let terrainSources = NO_SOURCES;

  /**
   * The page's audio engine, once it is up. `null` under `?mute=1`, and until
   * the browser has handed one over.
   */
  let audio: AudioSystem | null = null;
  /** The zone's sound: its bed, its emitters and its footstep banks. */
  let sound: WorldSoundHandle | null = null;
  /** Which splat layer is under a point, once the ground has been fitted. */
  let surface: TerrainSurfaceProbe | null = null;
  /** How far the player has walked since the last footstep. */
  let stride: StrideState = initialStride;
  /** The ground meshes, kept so the splat probe can be fitted against them. */
  let groundMeshes: Parameters<typeof createZoneSurfaceProbe>[0]['meshes'] = [];

  // The state the previous step ended in, kept so a frame between two steps can
  // be interpolated instead of snapped.
  let previous: Transform = getTransform(world, PLAYER) ?? createTransform();

  const frameStats = createFrameStats();
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
      const sampled = input.sample(camera.state.yaw);
      world = MovementSystem.update(world, sampled, fixedDelta, ground, obstacles);
      // Physics advances on the same fixed step as gameplay, not on the frame:
      // the simulation must not run faster on a 144 Hz display (ADR-0013).
      physics?.step(fixedDelta);
      // Footsteps are paced by ground covered, on the fixed step rather than on
      // the frame, for exactly the reason physics is: a 144 Hz display must not
      // make the player walk faster or louder (ADR-0013, ADR-0052).
      stepFootsteps(fixedDelta, sampled.sprint);
    },

    render(alpha) {
      const current = getTransform(world, PLAYER);
      if (current) {
        const position = interpolatePosition(previous, current, alpha);
        // The placeholder's root sits at the feet, exactly like the gameplay
        // transform, so the position is copied across without an offset.
        player.root.position.set(position.x, position.y, position.z);
        // The shadow map covers a box around the player, not the whole tile
        // (ADR-0024), so it has to be told where the player got to. Done here
        // rather than on a scene hook because this is the one place that knows
        // the interpolated position the frame is actually drawn at.
        lighting.focusShadows(position.x, position.y, position.z);
      }
      // The camera updates on the scene's before-render hook, so it reads the
      // position written just above — this frame's, not the previous one's.
      renderer.renderFrame();
      const sample = frameStats.frame(performance.now());
      if (sample && frameReadout) {
        frameReadout.textContent = formatFrameSample(sample);
      }
    },
  });

  loop.start();
  baseStatus = `renderer ready — ${renderer.backend} · simulation 60 Hz`;
  setStatus(baseStatus);

  // Next to the physics backend and never awaited by the loop: an audio engine
  // that has not started should delay sound, not walking (spec §38).
  const audioReady = startAudio();

  /** Set in the dev build only; see the note on `installDevDebugBridge`. */
  let debugBridge: {
    reportTerrainBounds(bounds: WovTerrainBounds): void;
    reportCollision(report: WovCollisionDebug): void;
    reportBackdrop(meshes: readonly BackdropReadout[]): void;
    reportSound(readout: WovSoundDebug, surfaceAt: (x: number, z: number) => string | null): void;
    watchObstacles(query: ObstacleQuery): ObstacleQuery;
  } | null = null;
  // `import.meta.env.DEV` and `__WOV_DEBUG_BRIDGE__` are both build-time
  // literals, so a default `pnpm build` folds this to `false` and Rollup drops
  // the call together with `./dev-debug.js` (ADR-0030).
  if (import.meta.env.DEV || (__WOV_DEBUG_BRIDGE__ && isDebugRequested(window.location.search))) {
    debugBridge = installDevDebugBridge(renderer, marker, {
      camera,
      player,
      // Reads the live world through a closure rather than a captured value:
      // the physics world does not exist yet when the bridge is installed.
      groundAt: (x, z) => probeGround(x, z),
      // Same reason: the rig is replaced when the world file arrives.
      lighting: () => lighting,
      rayHit: (from, to) => {
        const hit = physics?.raycast(
          { x: from[0], y: from[1], z: from[2] },
          { x: to[0], y: to[1], z: to[2] },
        );
        return hit
          ? {
              x: hit.point.x,
              y: hit.point.y,
              z: hit.point.z,
              normalX: hit.normal.x,
              normalY: hit.normal.y,
              normalZ: hit.normal.z,
              distance: hit.distance,
            }
          : null;
      },
    });
  }

  /**
   * Brings the page's audio engine up, and arranges for the first gesture to
   * unlock it.
   *
   * `?mute=1` never creates one at all — see `soundEnabled`. A browser that
   * refuses to give one is reported on the sound line and costs nothing else: a
   * game without sound is a game, and a game that will not start is not.
   *
   * Babylon resumes the context on a pointer gesture of its own, but a player
   * who reaches for WASD before clicking has made a gesture the browser accepts
   * and Babylon is not listening for — so a one-shot `keydown` is added beside
   * it. Both are `once`, because the second unlock of an unlocked engine is a
   * promise that resolves to nothing.
   */
  async function startAudio(): Promise<AudioSystem | null> {
    if (!soundEnabled(window.location.search)) {
      setSoundStatus('sound: off — ?mute=1');
      return null;
    }
    try {
      const system = await createAudioEngine();
      audio = system;
      system.onStateChanged(() => {
        reportSound();
      });
      reportSound();
      const unlock = (): void => {
        void system.unlock();
      };
      window.addEventListener('keydown', unlock, { once: true });
      canvas.addEventListener('pointerdown', unlock, { once: true });
      return system;
    } catch (error) {
      setSoundStatus(`sound unavailable: ${describe(error)}`);
      return null;
    }
  }

  /** One line for the sound row: whether it is audible, and what is in it. */
  function reportSound(): void {
    if (audio === null) {
      return;
    }
    const zone =
      sound === null
        ? 'no zone sound yet'
        : sound.report.replace(/^sound: /, '') +
          (surface === null ? '' : ` · ground ${surface.usable ? 'mapped' : 'unmapped'}`);
    // `statusLine` already begins with "sound: " — it is the one spelling of
    // that answer (`audio-unlock.ts`), and prefixing it again reads as a bug in
    // the very line whose job is to say whether there is a bug.
    setSoundStatus(`${audio.statusLine} — ${zone}`);
  }

  /**
   * Counts the ground the player covered and plays a footstep when a stride is
   * complete.
   *
   * The surface is asked per *step*, not per frame: a splat lookup is two
   * texel reads and an argmax, which is nothing, but doing it sixty times a
   * second to answer a question that is asked four times a second would still
   * be sixty times too often.
   */
  function stepFootsteps(fixedDelta: number, sprinting: boolean): void {
    if (sound === null) {
      return;
    }
    const now = getTransform(world, PLAYER);
    if (now === undefined) {
      return;
    }
    const walked = advanceStride(
      stride,
      {
        from: previous.position,
        to: now.position,
        grounded: getMovement(world, PLAYER)?.grounded ?? false,
        sprinting,
        deltaSeconds: fixedDelta,
      },
      sound.profile.footsteps,
    );
    stride = walked.state;
    if (walked.step) {
      sound.footstep(surfaceUnder(now.position.x, now.position.z));
    }
  }

  /**
   * Which surface the player is standing on, by the splat map's own answer
   * (ADR-0053).
   *
   * Off the tile, or on ground the probe could not be fitted to, is the
   * profile's default surface — a plain footstep rather than a confidently
   * wrong one, and the sound line says which of the two is happening.
   */
  function surfaceUnder(x: number, z: number): string {
    const footsteps = sound?.profile.footsteps;
    if (footsteps === undefined) {
      return '';
    }
    const layer = surface?.layerAt(x, z) ?? null;
    return layer === null ? footsteps.defaultSurface : surfaceOfLayer(footsteps, layer);
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
      // The dev build watches the same query the solver asks, so a walk in the
      // browser can read off which face stopped the player (ADR-0038).
      const probes = physicsObstacles(created);
      obstacles = debugBridge === null ? probes : debugBridge.watchObstacles(probes);
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
   * Loads the world, its ground and its entities (ADR-0022).
   *
   * Order matters and is the whole point:
   *
   * 1. the world file and the prefab catalogue arrive from the API;
   * 2. the physics world comes up;
   * 3. the zone's tile becomes collision geometry **before** the placeholder
   *    plane is switched off, so there is never a frame in which the player has
   *    nothing to stand on;
   * 4. only then is the capsule put down on the terrain — teleporting first
   *    would drop it through a floor that does not exist yet;
   * 5. the entities are placed, which is the slow part and the one nothing else
   *    waits for.
   *
   * The physics world is awaited rather than raced: a tile that is drawn but not
   * collidable is exactly the failure that looks fine in a screenshot.
   */
  async function startWorld(): Promise<void> {
    const api = createWorldApi(config.apiUrl);
    const worldId = worldIdFromQuery(window.location.search);

    let world;
    let prefabs;
    try {
      [world, prefabs] = await Promise.all([api.loadWorld(worldId), api.loadPrefabs()]);
    } catch (error) {
      // The whole world is gone, so this is said where the world belongs and
      // not buried in the renderer's line: a clone with no API running must be
      // told which URL it tried, not left with an empty green plane.
      setWorldStatus(`world "${worldId}" unavailable: ${describe(error)}`);
      setAssetStatus('assets: no world to load');
      setAssetSources('assets: no world to load');
      setCollisionStatus('collision: no world to build it from');
      void startPhysics();
      return;
    }

    const zone = playableZone(world.zones);
    if (zone === undefined) {
      setWorldStatus(`world "${world.id}" has no zone to walk around in`);
      void startPhysics();
      return;
    }
    setWorldStatus(
      `world ${world.id} · zone ${zone.id} — ${String(zone.entities.length)} entities, loading…`,
    );

    // Before the ground and before the entities, in that order and for two
    // reasons: the terrain compiles its shadow lookup against the map that
    // exists when it is built, and every mesh placed afterwards is handed to
    // the rig that is going to light it (ADR-0024).
    lighting = scene3d.relight(
      lightingProfiles(window.location.search, [world.lighting, zone.lighting]),
    );
    // The Phase 1 plane is still on screen at this point and it is 100 m wide:
    // left in the map it would put the whole village in its own shadow.
    lighting.excludeFromShadows([base.ground]);

    const world3d = await startPhysics();

    if (zone.terrain !== undefined) {
      try {
        const ground3d = await loadZoneTerrain(
          renderer.scene,
          config.assets,
          zone.terrain,
          `${world.id}:${zone.id}`,
          lighting.shadows !== null,
        );
        terrainSources = ground3d.sources;
        // Kept for the splat probe: the surface a footstep lands on is fitted
        // against these meshes' own uv attribute (ADR-0053).
        groundMeshes = ground3d.terrain.meshes;
        // The ground receives through its own shader (ADR-0020) and must not
        // cast: a height field in its own shadow map self-shadows every slope
        // it has, and no bias makes a 300 m tile at 7 cm per texel clean.
        lighting.excludeFromShadows(ground3d.terrain.meshes);
        reportTerrainBounds(ground3d.terrain.meshes);

        const triangles = ground3d.terrain.meshes.reduce(
          (total, mesh) => total + (mesh.getIndices()?.length ?? 0) / 3,
          0,
        );

        if (world3d === null) {
          setStatus(`${baseStatus} · terrain drawn, but nothing to collide with`);
        } else {
          for (const mesh of ground3d.terrain.meshes) {
            world3d.addStaticMesh(toStaticMeshData(mesh));
          }
          // The authored ground has taken over; the Phase 1 plane would now
          // fight it for pixels and answer ground queries a hundred metres
          // below it.
          base.ground.setEnabled(false);
          standOn(zone.terrain.position, zone.terrain.size);
          setStatus(
            `${baseStatus} · terrain ready — ${String(Math.round(triangles))} collision triangles`,
          );
        }
      } catch (error) {
        setStatus(`${baseStatus} · terrain unavailable: ${describe(error)}`);
      }
    }

    const placed = await placeEntities({
      scene: renderer.scene,
      source: config.assets,
      zone,
      prefabs,
    });

    // The zone is placed and nothing in it moves again (ADR-0035). Said here
    // rather than inside the placer because it is the *game's* claim: the same
    // `placeEntities` runs behind an editor that has to be able to drag any of
    // these, and the freeze is exactly what would break that.
    //
    // After every await above, and before the first frame that draws them, so
    // the matrices being pinned are the ones the world file asked for.
    const frozen = freezeStaticNodes(placed.roots);

    // Said once, on the meshes the scatter left behind, and not per entity: a
    // tuft of grass takes the shadow of the house beside it and throws none of
    // its own (ADR-0024, ADR-0025). Placed here rather than inside the placer
    // because the light belongs to the app, not to the scene builder.
    lighting.excludeFromCasting(placed.nonCasters);
    // The painted distance is out of the light in both directions: the sun's
    // map covers 120 m around the player and the nearest shell is 290 m away,
    // so a backdrop in it is a 1 188 m caster that stretches the map over the
    // whole world and receives a shadow map it is nowhere near (ADR-0031).
    lighting.excludeFromShadows(placed.backdrop);
    // After the rig, not before: `excludeFromShadows` is what clears
    // `receiveShadows`, and a readout taken first would report the intention
    // rather than the result.
    // Last of the three light statements, because each of them is a material
    // change and a frozen material does not take one (ADR-0035). It waits for
    // the scene to be ready on its own, so the seconds the ground's textures
    // still need are not this call's problem.
    freezeMaterialsWhenReady(renderer.scene);
    debugBridge?.reportBackdrop(placed.backdrop);
    (window as unknown as { __wovBackdrop?: unknown }).__wovBackdrop = placed.backdrop;

    for (const problem of placed.failed) {
      console.error(`[game] a prefab of zone "${zone.id}" did not load — ${problem}`);
    }
    if (placed.unknownPrefabs.length > 0) {
      console.warn(
        `[game] ${String(placed.unknownPrefabs.length)} entities reference a prefab the ` +
          'catalogue does not have',
      );
    }
    setWorldStatus(
      `world ${world.id} · zone ${zone.id} — ` +
        `${String(placed.roots.length + placed.thinInstances)} entities from ` +
        `${String(placed.models)} models` +
        (placed.thinInstances > 0
          ? `, ${String(placed.thinInstances)} of them thin-instanced vegetation`
          : '') +
        (placed.nonCasters.length > 0
          ? `, ${String(placed.nonCasters.length)} mesh(es) taking shadow without casting`
          : '') +
        (placed.failed.length > 0 ? `, ${String(placed.failed.length)} failed` : '') +
        `, ${String(frozen.frozen)} nodes frozen`,
    );
    setAssetStatus(
      `assets: ${String(placed.models)} models loaded` +
        (placed.failed.length > 0 ? `, ${String(placed.failed.length)} failed` : ''),
    );
    setAssetSources(summarizeAssetSources(addSources(terrainSources, placed.sources)));

    // After the models and not awaited: see `startZoneSound`.
    void startZoneSound(world, zone).catch((error: unknown) => {
      setSoundStatus(`sound unavailable: ${describe(error)}`);
    });

    // Last, and after the lines above have been written: the shapes are
    // measured on the models `placeEntities` loaded, so they cannot exist
    // before those models do — but "the village is on screen" is true the
    // moment it is, and must not wait for "the village is solid" to be
    // reported (ADR-0026).
    if (world3d === null) {
      setCollisionStatus('collision: no physics world to build it in');
      return;
    }
    try {
      const collision = await buildZoneCollision({
        physics: world3d,
        manager: placed.manager,
        zone,
        prefabs,
      });
      for (const problem of collision.report.failed) {
        console.error(`[game] a prefab of zone "${zone.id}" has no collision shape — ${problem}`);
      }
      debugBridge?.reportCollision(collision.report);
      setCollisionStatus(
        `collision: ${String(collision.report.bodies)} bodies from ` +
          `${String(collision.report.shapes)} shapes · ` +
          `${String(collision.report.triangles)} triangles · ` +
          `${String(collision.report.passable)} walk-through · ` +
          `built in ${String(collision.report.milliseconds)} ms`,
      );
    } catch (error) {
      setCollisionStatus(`collision unavailable: ${describe(error)}`);
    }
  }

  /**
   * Gives the zone its sound (ADR-0052).
   *
   * Deliberately last and deliberately not awaited by anything the player is
   * waiting for. The village streams hundreds of megabytes of models before it
   * can be walked around in; a megabyte of clips must not be in that queue, and
   * a zone whose audio has not arrived is silent rather than stalled.
   *
   * The order inside is the same rule one level down: the splat maps are
   * decoded first because a footstep with no surface is the one thing here that
   * would be *wrong* rather than merely absent, and the clips are loaded after.
   */
  async function startZoneSound(worldFile: WorldDefinition, zone: ZoneDefinition): Promise<void> {
    const system = await audioReady;
    if (system === null) {
      return;
    }
    // The world's profile, then the zone's on top of it — the same chain and
    // the same precedence `lightingProfiles` uses one screen further up.
    const profile = resolveSoundProfile(worldFile.sound, zone.sound);

    if (groundMeshes.length > 0 && zone.terrain !== undefined) {
      surface = await createZoneSurfaceProbe({
        meshes: groundMeshes,
        splat: zone.terrain.splat ?? [],
        layerCount: zone.terrain.layers?.length ?? 0,
        source: config.assets,
      });
      if (!surface.usable) {
        console.warn(`[game] footsteps fall back to one surface — ${surface.status}`);
      }
    }

    sound = await applyWorldSound(renderer.scene, {
      audio: system,
      profile,
      clipSource: (path) => clipSource(config.assets, path),
      entities: zone.entities.map((entity) => ({
        id: entity.id,
        prefab: entity.prefab,
        position: entity.position,
      })),
      // The emitter follows the node `placeEntities` made for its entity, so a
      // brazier moved in the editor takes its fire with it. A thin-instanced
      // prefab has none by design (ADR-0025) and falls back to its position.
      nodeOf: (entityId) => renderer.scene.getTransformNodeByName(`entity:${entityId}`),
      // The camera, not the capsule: in third person the picture is the
      // camera's, and so are the ears (ADR-0052).
      listener: renderer.scene.activeCamera,
      listenerAt: () => {
        const at = renderer.scene.activeCamera?.globalPosition;
        return at === undefined ? { x: 0, y: 0, z: 0 } : { x: at.x, y: at.y, z: at.z };
      },
    });
    for (const problem of sound.problems) {
      console.warn(`[game] zone "${zone.id}" sound — ${problem}`);
    }
    for (const clip of sound.failed) {
      console.error(`[game] a clip of zone "${zone.id}" did not load — ${clip}`);
    }
    debugBridge?.reportSound(
      {
        status: system.statusLine,
        ambience: sound.ambience,
        emitters: sound.emitters,
        banks: profile.footsteps.banks.length,
        failed: sound.failed.length,
        surfaceMapped: surface?.usable ?? false,
        surfaceStatus: surface?.status ?? 'no ground to fit a probe to',
      },
      (x, z) => surfaceUnder(x, z),
    );
    reportSound();
  }

  /** Publishes the tile's measured hull to the dev bridge, if there is one. */
  function reportTerrainBounds(meshes: readonly { getBoundingInfo(): BoundingInfoLike }[]): void {
    if (debugBridge === null) {
      return;
    }
    let hull: WovTerrainBounds | null = null;
    for (const mesh of meshes) {
      const info = mesh.getBoundingInfo().boundingBox;
      const low = info.minimumWorld;
      const high = info.maximumWorld;
      hull =
        hull === null
          ? { min: [low.x, low.y, low.z], max: [high.x, high.y, high.z] }
          : {
              min: [
                Math.min(hull.min[0], low.x),
                Math.min(hull.min[1], low.y),
                Math.min(hull.min[2], low.z),
              ],
              max: [
                Math.max(hull.max[0], high.x),
                Math.max(hull.max[1], high.y),
                Math.max(hull.max[2], high.z),
              ],
            };
    }
    if (hull !== null) {
      debugBridge.reportTerrainBounds(hull);
    }
  }

  /**
   * Puts the capsule down on the ground, in the middle of the tile.
   *
   * `?spawn=x,z` moves it, in the same metres the world file uses. The village
   * is 300 m across and the things worth looking at — the paths, the cliffs,
   * one particular house — are nowhere near the middle, so a screenshot needs
   * to be able to say where to stand. Anything malformed or outside the tile
   * falls back to the middle rather than dropping the player off the edge.
   */
  function standOn(
    position: readonly [number, number, number],
    size: readonly [number, number],
  ): void {
    const middle: [number, number] = [position[0] + size[0] / 2, position[2] + size[1] / 2];
    const [x, z] = spawnFromQuery(new URLSearchParams(window.location.search).get('spawn'), {
      min: [position[0], position[2]],
      max: [position[0] + size[0], position[2] + size[1]],
      fallback: middle,
    });
    const y = probeGround(x, z);
    if (y !== null) {
      world = createWorldState([playerSpec({ x, y, z })]);
      previous = getTransform(world, PLAYER) ?? previous;
    }
  }

  // Started after the loop and deliberately not awaited: a slow world delays
  // the village appearing, not the scene showing up (spec §38).
  void startWorld().catch((error: unknown) => {
    setWorldStatus(`world unavailable: ${describe(error)}`);
  });
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
