import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';

/** Where the camera stands, as the game's dev bridge reports it. */
interface CameraDebug {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly desiredDistance: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where the rendered player capsule stands, as the dev bridge reports it. */
interface PlayerDebug {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The game's dev build publishes its frame counter, its camera and its player on
 * `window.__wov`. Typed here rather than with `declare global` so this file
 * stays the only place that knows about the bridge and nothing widens `Window`
 * workspace-wide.
 */
type WovDebugWindow = Window & {
  __wov?: {
    readonly frameId: number;
    readonly camera: CameraDebug | null;
    readonly player: PlayerDebug | null;
    readonly terrainBounds: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    } | null;
    readonly render: {
      readonly drawCalls: number;
      readonly activeMeshes: number;
      readonly triangles: number;
    };
    readonly collision: {
      readonly shapes: number;
      readonly bodies: number;
      readonly triangles: number;
      readonly passable: number;
      readonly undeclared: number;
      readonly failed: readonly string[];
      readonly milliseconds: number;
    } | null;
    groundAt(x: number, z: number): number | null;
    rayHit(
      from: readonly [number, number, number],
      to: readonly [number, number, number],
    ): { x: number; y: number; z: number } | null;
  };
};

/**
 * The editor's dev build publishes its own bridge on `window.__wovEditor`: the
 * frame counter, the backend, and both counts of what is on screen — how many
 * entities the document holds and how many meshes the viewport built for them.
 */
type WovEditorDebugWindow = Window & {
  __wovEditor?: {
    readonly backend: string;
    readonly frameId: number;
    readonly worldId: string;
    readonly zoneId: string | null;
    readonly entityCount: number;
    readonly meshCount: number;
    readonly loadedCount: number;
    /** Entity subtrees whose world matrices are pinned right now (ADR-0049). */
    readonly frozenCount: number;
    readonly selection: readonly string[];
    readonly dirty: boolean;
    readonly undoDepth: number;
    readonly redoDepth: number;
    readonly terrain: { readonly program: string; readonly meshes: number } | null;
  };
};

/**
 * Where the API under test is.
 *
 * `pnpm smoke` runs the API on a port of its own against a throwaway copy of
 * `content/` (see `playwright.config.ts`), so the editor's save test cannot
 * write into the repository and cannot be routed to a developer's own server.
 */
function apiUrl(path: string): string {
  return `${String(test.info().config.metadata['apiUrl'])}${path}`;
}

/** Where the app under test is, as `playwright.config.ts` decided. */
function appUrl(app: 'websiteUrl' | 'gameUrl' | 'assetUrl'): string {
  return String(test.info().config.metadata[app]);
}

/**
 * Opens the game under the light its world file asks for (ADR-0024).
 *
 * It used to open every one of these with `?flat=1`, and the reason was real:
 * headless Chromium rasterises in software by default, and with a 2048² shadow
 * map and an HDR grading chain in front of it a frame took more than a second,
 * so half a second of a held key advanced the simulation by three fixed steps
 * and "it walks" failed for a reason that had nothing to do with walking.
 *
 * That reason is gone. `playwright.config.ts` now asks Chromium for ANGLE on
 * the machine's own driver, and under the shipped profile the whole suite is
 * 4.3 minutes against 3.9 — so the wiring is measured under the light the
 * player will actually see, which is the stronger test of the two.
 *
 * One test still asks for `?flat=1` and says why: counting draw calls means
 * something different when the frame has two passes.
 */
async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`${appUrl('gameUrl')}?${query.replace(/^&/, '')}`);
}

/** The editor's whole debug bridge, or `null` while it is not installed. */
function editorDebug(page: Page): Promise<WovEditorDebugWindow['__wovEditor'] | null> {
  return page.evaluate(() => {
    const bridge = (window as WovEditorDebugWindow).__wovEditor;
    return bridge === undefined ? null : { ...bridge };
  });
}

/** How many entities the *document* holds in the active zone. */
function editorEntityCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.entityCount ?? null);
}

/** How many entity roots the *scene* holds — the independent witness. */
function editorMeshCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.meshCount ?? null);
}

/** The key of the shader the drawn ground compiled, or `null` while it has none. */
function editorTerrainProgram(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as WovEditorDebugWindow).__wovEditor?.terrain?.program ?? null,
  );
}

/** The editor's frame counter, or `null` while its bridge is not installed. */
function editorFrameId(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.frameId ?? null);
}

/** The current frame counter, or `null` while the bridge is not installed. */
function frameId(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.frameId ?? null);
}

/** The live camera, or `null` while the bridge is not installed. */
function cameraDebug(page: Page): Promise<CameraDebug | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.camera ?? null);
}

/** Waits for the bridge and answers the camera the game is rendering with. */
async function liveCamera(page: Page): Promise<CameraDebug> {
  await expect.poll(() => cameraDebug(page), { timeout: 10_000 }).not.toBeNull();
  const camera = await cameraDebug(page);
  if (!camera) {
    throw new Error('the game dev build published no camera');
  }
  return camera;
}

/** The distance in use, or `null` while the bridge is not installed. */
function cameraDistance(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.camera?.distance ?? null);
}

/** The yaw in use, or `null` while the bridge is not installed. */
function cameraYaw(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.camera?.yaw ?? null);
}

/** Where the rendered capsule stands, or `null` while the bridge is absent. */
function playerDebug(page: Page): Promise<PlayerDebug | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.player ?? null);
}

/** Waits for the bridge and answers where the capsule currently stands. */
async function livePlayer(page: Page): Promise<PlayerDebug> {
  await expect.poll(() => playerDebug(page), { timeout: 10_000 }).not.toBeNull();
  const player = await playerDebug(page);
  if (!player) {
    throw new Error('the game dev build published no player');
  }
  return player;
}

test('website shows its marker and links to the game', async ({ page }) => {
  await page.goto(appUrl('websiteUrl'));
  await expect(page.getByTestId('site-marker')).toHaveText('World of Vikings');
  // Either the game this run started, or the published client on a deployment.
  await expect(page.getByTestId('play-link')).toHaveAttribute(
    'href',
    new RegExp(`${appUrl('gameUrl').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|live\\.`),
  );
});

/**
 * Both apps bootstrap through `@wov/engine` (ADR-0006) and report the backend
 * it picked. A machine without a GPU may legitimately end up with no renderer,
 * so the assertion pins the *shape* of the answer rather than demanding
 * success: either a named backend or a stated reason. "Not still starting" on
 * its own would also accept a blank or truncated status.
 */
const RENDERER_STATUS = /^(renderer|viewport) (ready — (webgl2|webgpu)|unavailable: .+)$/;

/**
 * The game's line says more than the editor's: the simulation and the physics
 * backend report into it too, so the shape is pinned only up to the renderer.
 */
const GAME_STATUS = /^renderer (ready — (webgl2|webgpu)|unavailable: .+)/;

test('game shows its dev build marker', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('game-marker')).toContainText('World of Vikings');
  await expect(page.getByTestId('game-marker')).toContainText('game dev build');
  await expect(page.getByTestId('game-status')).toHaveText(GAME_STATUS);
  // The desktop controls of spec §27 are named on screen (ADR-0010).
  await expect(page.getByTestId('game-controls')).toContainText('WASD');
  await expect(page.getByTestId('game-controls')).toContainText('capture the mouse');
});

/**
 * "The page loaded" is not "the game renders". A marker is still there when the
 * render loop never starts, when it throws on the first frame, or when the tab
 * is never composited — so this test watches the frame counter move.
 *
 * Two witnesses, because either one alone can lie: `window.__wov.frameId` is
 * the counter the renderer hands out, and the frame text inside the marker
 * proves the counter reaches the DOM. Both exist only in the dev build.
 */
test('game keeps rendering frames', async ({ page }) => {
  await openGame(page);

  await expect.poll(() => frameId(page), { timeout: 10_000 }).not.toBeNull();
  const before = await frameId(page);
  expect(before).not.toBeNull();

  await expect
    .poll(() => frameId(page), { timeout: 2_000, intervals: [100, 100, 200, 200, 400] })
    .toBeGreaterThan(before ?? 0);

  await expect(page.getByTestId('game-frame')).toHaveText(/^frame \d+$/);
  await expect(page.getByTestId('game-marker')).toContainText(/frame \d+/);
  // The readout in the corner exists in every build; a number proves that the
  // sampling window closed at least once.
  await expect(page.getByTestId('game-fps')).toHaveText(/^\d+ fps · \d+\.\d ms$/);
});

/**
 * Unit tests pin the camera arithmetic, but they cannot prove that a wheel
 * notch or a mouse drag over the canvas ever reaches it: the pointer-lock and
 * wheel wiring is the one part of the camera with no DOM-free test. So this
 * test drives the real page and watches the numbers the renderer used.
 *
 * The mouse gestures are read either through pointer lock, if the browser
 * grants it, or through the held-button fallback if it does not — the camera
 * has to turn under both, which is exactly why the fallback exists.
 */
/**
 * Waits until the ground has stopped changing under the player *and* the client
 * has finished building the zone.
 *
 * Two separate reasons to wait. The terrain arrives after the first frames and
 * puts the capsule down on it (ADR-0020), so a test that samples a position
 * across that lands sees a teleport rather than what it was measuring. And the
 * zone is built after the terrain is ready: measured on the village, the
 * terrain line appears at about 3.9 s and the world line about 5.9 s later,
 * with the main thread loading models and placing entities in between. A test
 * that presses a key inside that window is measuring a busy tab, not the
 * movement system — which is what it did, moving the capsule 0.18 m in the half
 * second it expected metres from.
 *
 * Either outcome settles each question — the tile loaded or it did not, the
 * zone built or its models failed — so both spellings are waited for.
 */
async function groundSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('game-status')).toContainText(/terrain (ready|unavailable|drawn)/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('game-world')).toContainText(/entities from|unavailable|world "/, {
    timeout: 45_000,
  });
  // The capsule is put down on the tile and the camera eases after it, so the
  // frame in which the status changes is the frame the camera is furthest from
  // where it belongs. Same follow lag the camera-follow test waits out.
  await page.waitForTimeout(600);
}

test('game camera frames the placeholder and answers mouse and wheel', async ({ page }) => {
  await openGame(page);
  await groundSettled(page);
  const opening = await liveCamera(page);
  const standing = await livePlayer(page);

  // Behind the capsule (−z, since it faces +z) and above its feet, at the
  // configured distance. Relative to the *player*, not to the origin: the
  // player is put down on the terrain once it loads (ADR-0020), and a camera
  // pinned to world coordinates would only be testing where the tile is.
  expect(opening.z).toBeLessThan(standing.z);
  expect(opening.y).toBeGreaterThan(standing.y + 1);
  expect(opening.distance).toBeGreaterThan(1);

  const canvas = page.locator('#render-canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('the game has no render canvas');
  }
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;

  await page.mouse.move(centreX, centreY);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => cameraDistance(page), { timeout: 5_000 })
    .toBeGreaterThan(opening.distance + 0.2);

  await page.mouse.down();
  await page.mouse.move(centreX + 240, centreY, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => cameraYaw(page), { timeout: 5_000 }).toBeGreaterThan(opening.yaw + 0.1);
});

/**
 * The one assertion the unit tests cannot make: that the DOM adapter, the
 * fixed-step loop, the movement system and the renderer are wired to each
 * other at all. Every part passes its own tests just as happily while
 * connected to nothing.
 *
 * The position is read off the rendered capsule, not out of the gameplay
 * state, so a simulation that runs without reaching the picture still fails.
 */
test('game walks the player capsule when a key is held', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('game-status')).toContainText('renderer ready');
  await groundSettled(page);

  const start = await livePlayer(page);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');

  const walked = await livePlayer(page);

  // Half a second at the Phase 1 walking speed covers metres, not millimetres.
  expect(Math.hypot(walked.x - start.x, walked.z - start.z)).toBeGreaterThan(0.5);

  // And it stops when the key comes up, rather than drifting on for ever.
  await page.waitForTimeout(400);
  const settled = await livePlayer(page);
  await page.waitForTimeout(300);
  const still = await livePlayer(page);

  expect(Math.hypot(still.x - settled.x, still.z - settled.z)).toBeLessThan(0.01);
});

/**
 * The camera follows the *player*, not the origin.
 *
 * Two chains built these separately: the camera takes a `() => Vector3` and the
 * simulation writes a `Transform`. Both pass their own tests while pointed at
 * nothing, and the failure — walking out of frame — is invisible to every unit
 * test. So: walk, then check the camera came along and still holds its
 * distance.
 */
test('game camera follows the player that walks away', async ({ page }) => {
  await openGame(page);
  await groundSettled(page);
  const startPlayer = await livePlayer(page);
  const startCamera = await liveCamera(page);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  // The camera eases towards the target, so give the follow lag time to land.
  await page.waitForTimeout(500);

  const walkedPlayer = await livePlayer(page);
  const walkedCamera = await liveCamera(page);

  const walked = Math.hypot(walkedPlayer.x - startPlayer.x, walkedPlayer.z - startPlayer.z);
  expect(walked).toBeGreaterThan(0.5);

  const cameraMoved = Math.hypot(walkedCamera.x - startCamera.x, walkedCamera.z - startCamera.z);
  // Not "the camera moved at all": a camera drifting on its own would pass
  // that. It has to have covered most of the distance the player did.
  expect(cameraMoved).toBeGreaterThan(walked * 0.8);

  // And it is still behind the player at its own distance, not stuck to a point
  // the player left behind.
  const gap = Math.hypot(walkedCamera.x - walkedPlayer.x, walkedCamera.z - walkedPlayer.z);
  expect(gap).toBeLessThan(walkedCamera.distance + 0.5);
});

test('game loads its world assets over the asset server', async ({ page }) => {
  const badResponses: string[] = [];
  page.on('response', (response) => {
    // A 404 under `/store/` is not a failure: the store lives outside the
    // repository and a clean clone has none, so the private assets fall back to
    // their committed placeholders (ADR-0015). Every *other* non-ok response
    // from the asset server is a real missing file.
    const assetHost = `${appUrl('assetUrl')}/`;
    const isStoreMiss =
      response.url().startsWith(`${assetHost}store/`) && response.status() === 404;
    if (response.url().startsWith(assetHost) && !response.ok() && !isStoreMiss) {
      badResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });

  await openGame(page);

  // Every distinct model of the zone, loaded once and instanced per entity
  // (ADR-0022). A model that fell back to its committed placeholder still
  // counts as loaded — that is the point of the fallback — so this does not
  // depend on the store being mounted. The number is not pinned because it is
  // world data and a re-import may legitimately change it; what is pinned is
  // that there are many of them and that none failed.
  await expect(page.getByTestId('game-assets'), {
    message: 'a failed model reads "…, N failed" and fails here',
  }).toHaveText(/^assets: [1-9]\d{1,} models loaded$/, { timeout: 120_000 });
  // Where the bytes came from, not only how many arrived (ADR-0015). The
  // wording comes from `summarizeAssetSources`, so this and the app cannot
  // drift apart. With a store mounted nothing falls back; without one every
  // private asset does, and both are correct — the point is that it is stated
  // rather than silent.
  await expect(page.getByTestId('game-asset-sources')).toHaveText(
    /^assets: \d+ private, \d+ placeholder$/,
  );
  // The GLB references its texture by a relative path, so a wrongly vendored
  // layout is a second failure mode. Babylon happens to reject the whole load
  // when that file is missing, but a model with an optional side-car would only
  // show up on the wire — so watch the wire too, not just the marker.
  expect(badResponses).toEqual([]);
});

test('game loads the physics backend and collides the ground', async ({ page }) => {
  await openGame(page);
  // Proves the whole chain in a real browser: the dynamic Havok import
  // resolved, the WASM module loaded from the URL Vite emitted, and the base
  // ground became static collision geometry (ADR-0013). Unit tests can prove
  // none of that — the backend does not exist until a browser fetches it.
  await expect(page.getByTestId('game-status')).toContainText('physics ready', {
    timeout: 30_000,
  });
});

/**
 * The ground the player stands on is the authored terrain, and the same tile is
 * what physics collides against (ADR-0020).
 *
 * Three separate claims, because each can be true while the others are not: the
 * tile covers the metres the world file names (a handedness flip breaks exactly
 * this and nothing else), its triangles became collision geometry, and the
 * capsule ended up standing on it rather than falling through.
 *
 * On a clone with no asset store the height field falls back to its committed
 * hull box, which is still a tile of the right size in the right place — so the
 * assertions hold either way and the status line says which one ran.
 */
test('game stands the player on the terrain it draws', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('game-status')).toContainText('terrain ready', {
    timeout: 30_000,
  });

  const bounds = await page.evaluate(() => (window as WovDebugWindow).__wov?.terrainBounds ?? null);
  if (bounds === null) {
    throw new Error('the game dev build published no terrain bounds');
  }
  // 0…300 m in x and z: what `terrain.position` and `terrain.size` say.
  expect(bounds.min[0]).toBeCloseTo(0, 3);
  expect(bounds.min[2]).toBeCloseTo(0, 3);
  expect(bounds.max[0]).toBeCloseTo(300, 3);
  expect(bounds.max[2]).toBeCloseTo(300, 3);

  await expect(page.getByTestId('game-status')).toContainText(/\d+ collision triangles/);

  // The capsule is on the ground the collision query reports, not under it.
  const standing = await livePlayer(page);
  const ground = await page.evaluate(
    ([x, z]) => (window as WovDebugWindow).__wov?.groundAt(x as number, z as number) ?? null,
    [standing.x, standing.z],
  );
  if (ground === null) {
    throw new Error('the collision ground answered nothing under the player');
  }
  expect(Math.abs(standing.y - ground)).toBeLessThan(0.5);
  expect(standing.y).toBeGreaterThan(bounds.min[1] - 0.5);
});

/**
 * The client opens an authored world over the API and builds it (ADR-0022).
 *
 * The claims are separate on purpose, because each can hold while the others do
 * not: the world file arrived and was accepted, its zone's ground is there, its
 * entities reached the scene, and the capsule ended up on the ground rather
 * than under it or a hundred metres above it.
 *
 * The entity count is read off the status line rather than pinned, because it
 * is world data: a re-import or a scatter run may legitimately change it. What
 * is asserted is the shape — more than a thousand of them, from more than one
 * model, with the scattered vegetation among them drawn as thin instances
 * (ADR-0025).
 */
test('game opens the authored village over the API', async ({ page }) => {
  // The one test in this file that wants flat light, and not to go faster: it
  // ends by counting draw calls against meshes, and the shipped profile draws
  // every caster a second time into the shadow map (ADR-0024). Under it the
  // ratio is 543 against 968 — which says nothing about whether the village is
  // instanced, and that is the only thing this count is here to say.
  await openGame(page, '&flat=1');

  await expect(page.getByTestId('game-world')).toHaveText(
    /^world village1 · zone village — \d+ entities from \d+ models(, .+)?$/,
    { timeout: 120_000 },
  );
  const line = (await page.getByTestId('game-world').textContent()) ?? '';
  const [, entities, models] = /— (\d+) entities from (\d+) models/.exec(line) ?? [];
  expect(Number(entities)).toBeGreaterThan(1000);
  expect(Number(models)).toBeGreaterThan(1);
  const [, thin] = /(\d+) of them thin-instanced/.exec(line) ?? [];
  expect(Number(thin)).toBeGreaterThan(1000);

  // The ground of that zone, not the Phase 1 plane.
  await expect(page.getByTestId('game-status')).toContainText(/terrain ready — \d+ collision/);

  // Standing on the terrain the world file names, within a metre of what the
  // collision query answers underneath the capsule.
  const standing = await livePlayer(page);
  const ground = await page.evaluate(
    ([x, z]) => (window as WovDebugWindow).__wov?.groundAt(x as number, z as number) ?? null,
    [standing.x, standing.z],
  );
  if (ground === null) {
    throw new Error('the collision ground answered nothing under the player');
  }
  expect(Math.abs(standing.y - ground)).toBeLessThan(1);

  // Instancing, as a number rather than as a claim: a thousand entities drawn
  // one draw call each would be a thousand. Read off Babylon's own counter.
  const render = await page.evaluate(() => (window as WovDebugWindow).__wov?.render ?? null);
  if (render === null) {
    throw new Error('the game dev build published no render counters');
  }
  expect(render.activeMeshes).toBeGreaterThan(100);
  expect(render.drawCalls).toBeLessThan(render.activeMeshes / 2);
});

/**
 * A client that cannot reach its API says so, in the line the world belongs in.
 *
 * The failure this pins is the silent one: an empty green plane with a happy
 * "renderer ready" underneath it, which looks like a world that is still
 * loading and is in fact a world that will never arrive.
 */
test('game says which API it could not reach', async ({ page }) => {
  await page.goto(`${appUrl('gameUrl')}?world=no-such-world`);
  await expect(page.getByTestId('game-world')).toContainText(/world "no-such-world"/, {
    timeout: 60_000,
  });
  // Still a running client, not a blank page.
  await expect(page.getByTestId('game-status')).toContainText('renderer ready');
});

test('editor shows its shell and a live viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-marker')).toContainText('world editor dev build');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(RENDERER_STATUS);
});

/**
 * Same reason as the game's frame test: a mounted canvas is not a running
 * render loop. It is worth its own test in the editor because the loop died
 * here in a specific, invisible way — React StrictMode mounted the viewport
 * twice, two Babylon engines bound themselves to one canvas, and the first
 * one's teardown took the second one's WebGL context with it.
 *
 * Two witnesses again: the counter on the bridge, and the same number in the
 * DOM. Backend and counter are both published so a stalled loop names itself.
 */
test('editor keeps rendering frames', async ({ page }) => {
  await page.goto('/');

  await expect.poll(() => editorFrameId(page), { timeout: 10_000 }).not.toBeNull();
  const before = await editorFrameId(page);
  expect(before).not.toBeNull();

  await expect
    .poll(() => editorFrameId(page), { timeout: 5_000, intervals: [100, 100, 200, 200, 400] })
    .toBeGreaterThan(before ?? 0);

  await expect(page.getByTestId('editor-frame')).toHaveText(/^frame \d+$/);
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
});

/**
 * The one claim the unit tests cannot make: that the document, the API, the
 * asset catalogue and the Babylon scene are wired to each other at all.
 *
 * Every part passes its own tests while connected to nothing — the reducer
 * applies commands to a document nobody renders, the reconciler diffs entity
 * lists nobody produced, the client parses answers nobody asked for. So this
 * walks the whole path an author walks, and checks *both* sides of every step:
 * the row in the hierarchy and the mesh in the scene, the document's entity
 * count and the scene's own count of entity roots.
 *
 * It runs against a throwaway `CONTENT_DIR`, so saving is a real `PUT` to a
 * real file and the repository stays clean.
 */
test('editor opens a world, places a prefab, saves it and undoes', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );

  // (b) the world list comes from the API, and opening one loads it.
  await page.getByTestId('menu-file').click();
  await expect(page.getByTestId('menu-file-worlds')).toContainText('Example World');
  await page.getByTestId('menu-open-example').click();

  await expect(page.getByTestId('hierarchy-zone-village')).toContainText('Village');
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();
  await expect.poll(() => editorEntityCount(page)).toBe(1);
  // The mesh is the independent witness: a hierarchy row proves the document
  // changed, not that anything reached the scene.
  await expect.poll(() => editorMeshCount(page)).toBe(1);

  // The world's one barrel stands 60 m from the origin, so `F` is what brings
  // it into view — and the click below has to land on the ground, not on it.
  await page.getByTestId('editor-canvas').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('KeyF');

  // (c) pick a prefab in the browser and click it into the viewport.
  await page.getByTestId('assets-search').fill('Barrel');
  await page.getByTestId('asset-barrel-01').click();
  await expect(page.getByTestId('editor-placing')).toHaveText('click to place barrel-01');

  const canvas = page.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('the editor has no viewport canvas');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);

  await expect.poll(() => editorEntityCount(page)).toBe(2);
  await expect.poll(() => editorMeshCount(page)).toBe(2);

  const placed = await editorDebug(page);
  const newId = placed?.selection.at(-1);
  expect(newId).toBeDefined();
  expect(newId).toMatch(/^barrel-01_\d+$/);
  // The same entity in the other two places it has to exist: the hierarchy and
  // the inspector.
  await expect(page.getByTestId(`hierarchy-entity-${String(newId)}`)).toBeVisible();
  await expect(page.getByTestId('inspector-prefab')).toHaveText('barrel-01');
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');

  // (d) save, and read the file back through the API rather than believing the
  // button.
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-save').click();
  await expect(page.getByTestId('editor-notice')).toContainText('"example"');
  await expect(page.getByTestId('editor-dirty')).toHaveText('saved');

  const saved = await request.get(apiUrl('/worlds/example'));
  expect(saved.status()).toBe(200);
  const world = await saved.json();
  expect(world.zones[0].entities).toHaveLength(2);
  expect(world.zones[0].entities.map((each: { id: string }) => each.id)).toContain(newId);

  // (e) undo takes the entity out of the document *and* out of the scene.
  // Escape first: the prefab is still armed, and a click in the viewport to
  // move focus would place a second barrel instead of doing nothing.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor-placing')).toHaveText('click to select');
  await page.keyboard.press('Control+z');

  await expect.poll(() => editorEntityCount(page)).toBe(1);
  await expect.poll(() => editorMeshCount(page)).toBe(1);
  await expect(page.getByTestId(`hierarchy-entity-${String(newId)}`)).toHaveCount(0);
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');
});

/**
 * The keyboard of spec §14, and the one collision in it.
 *
 * `W`, `E` and `R` are tool shortcuts *and* camera flying keys; they fly only
 * while the right mouse button is held. Nothing in a unit test can prove which
 * of the two a real keystroke reaches.
 */
/**
 * The imported village, in the viewport (ADR-0021).
 *
 * The importer's own report is a count of what it *wrote*; this is the only
 * check that the file it wrote opens. It is worth a test of its own because
 * scale is where this file differs from every other one in `content/`: 1 580
 * entities across three zones, against the example world's one barrel. A
 * reconciler that is quadratic in the entity count, a hierarchy that renders
 * every row eagerly or a catalogue lookup that is a linear scan all pass the
 * example world and fall over here.
 *
 * Both witnesses again, and both must clear a thousand: the document's entity
 * count for the active zone and the scene's own count of entity roots.
 */
test('editor opens the imported village with more than a thousand entities', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );

  await page.getByTestId('menu-file').click();
  await expect(page.getByTestId('menu-file-worlds')).toContainText('Village One');
  await page.getByTestId('menu-open-village1').click();

  await expect(page.getByTestId('editor-world-name')).toHaveText('Village One');
  // The three zones the bundle is split into.
  await expect(page.getByTestId('hierarchy-zone-village')).toContainText('Village');
  await expect(page.getByTestId('hierarchy-zone-interiors')).toContainText('Village Interiors');
  await expect(page.getByTestId('hierarchy-zone-surroundings')).toContainText('Surroundings');

  await expect.poll(() => editorEntityCount(page), { timeout: 60_000 }).toBeGreaterThan(1000);
  // One root per entity, not one per node of the loaded model: the two counts
  // are the same number seen from the document and from the scene, so they are
  // compared to each other rather than to a threshold.
  const documented = await editorEntityCount(page);
  await expect.poll(() => editorMeshCount(page), { timeout: 60_000 }).toBe(documented);

  // The first row the panel drew, whatever the world file happens to start
  // with — the test is about the list, not about a particular entity.
  const first = await page
    .getByTestId('hierarchy-entities')
    .locator('> li > button')
    .first()
    .getAttribute('data-testid')
    .then((id) => id?.replace('hierarchy-entity-', ''));
  expect(first).toBeTruthy();

  /*
   * The hierarchy lists the rows it shows, not one per entity (ADR-0048).
   *
   * Counted rather than asserted against a number of pixels: the zone has more
   * than five thousand entities and a 15 rem column shows some tens of them,
   * so anything under a few hundred rendered rows is a window and five
   * thousand is the eager list this replaced. The bound is loose on purpose —
   * it is about the order of magnitude, not about the overscan.
   */
  const rows = page.getByTestId('hierarchy-entities').locator('> li > button');
  expect(await rows.count()).toBeLessThan(300);

  /*
   * And selecting from somewhere else brings the row into view.
   *
   * The half of a windowed list that silently does not work: outside the
   * window the row does not exist, so a selection made anywhere but in the
   * list itself would leave the hierarchy looking as if nothing happened.
   * Ctrl+D duplicates the entity selected above and selects the copy, which is
   * appended — five thousand rows below whatever the panel is showing.
   */
  await page.getByTestId(`hierarchy-entity-${String(first)}`).click();
  await page.keyboard.press('Control+d');
  const copied = (await editorDebug(page))?.selection.at(-1);
  expect(copied).toBeDefined();
  expect(copied).not.toBe(first);
  await expect(page.getByTestId(`hierarchy-entity-${String(copied)}`)).toBeVisible();

  // Still rendering afterwards: a viewport that built the zone and then died is
  // not a viewport that opened it.
  const before = await editorFrameId(page);
  await expect
    .poll(() => editorFrameId(page), { timeout: 15_000, intervals: [200, 200, 400, 800] })
    .toBeGreaterThan(before ?? 0);
});

/**
 * The scatter panel (ADR-0025), end to end.
 *
 * Everything about a scatter is easy to get right in a unit test and easy to
 * get wrong in the shell: the panel can preview a count it never passes on, the
 * command can reach the document without reaching the scene, and undo can take
 * back one instance out of three hundred. So all three are read here — the
 * preview, the document's entity count and the scene's own mesh count — and the
 * scatter is undone again with a single Ctrl+Z.
 */
test('editor scatters a field of prefabs as one undoable command', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-open-example').click();
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();

  // The world this opens is whatever the save test left behind, so the delta is
  // what is asserted, never the total.
  const before = await editorEntityCount(page);
  expect(before).not.toBeNull();

  await page.getByTestId('assets-search').fill('Barrel');
  await page.getByTestId('asset-barrel-01').click();
  await page.getByTestId('scatter-add-prefab').click();
  await expect(page.getByTestId('scatter-prefab-list')).toContainText('barrel-01');

  // A 20 m x 20 m patch at 5 per 100 m² is twenty barrels, and the panel has to
  // say so before the button is pressed.
  for (const [field, value] of [
    ['scatter-x0', '0'],
    ['scatter-z0', '0'],
    ['scatter-x1', '20'],
    ['scatter-z1', '20'],
  ] as const) {
    await page.getByTestId(field).fill(value);
  }
  await page.getByTestId('scatter-density').fill('5');
  await page.getByTestId('scatter-seed').fill('3');
  await expect(page.getByTestId('scatter-preview')).toHaveText('400 m² usable · 20 instances');

  await page.getByTestId('scatter-run').click();
  await expect.poll(() => editorEntityCount(page)).toBe((before ?? 0) + 20);
  await expect.poll(() => editorMeshCount(page)).toBe((before ?? 0) + 20);
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');
  // The ids say which run each instance came from (`<prefab>_s<seed>_<n>`).
  await expect(page.getByTestId('hierarchy-entity-barrel-01_s3_0001')).toBeVisible();

  // One command, so one undo takes the whole field back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorEntityCount(page)).toBe(before);
  await expect.poll(() => editorMeshCount(page)).toBe(before);
});

/**
 * The ground panel, end to end — the editor half of ADR-0032's parity rule.
 *
 * `pnpm terrain-surface` writes the same fields through the same
 * `updateTerrainSurface` command, and a unit test already proves that command
 * patches a document correctly. What no unit test can prove is that the panel
 * is wired to it and that the *viewport* follows: a checkbox that dispatches
 * into nothing, or a command that reaches the document while the tile on screen
 * keeps its old material, both leave every test green and the editor useless.
 *
 * So the witness is the tile's own compiled shader key, read off the material
 * in the scene. Facetted ground is a different program from smooth ground
 * (`terrain.ts`), so the string has to change when the box is ticked and change
 * back on undo.
 */
test('editor changes the ground’s surface and the viewport follows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-open-village1').click();
  await expect(page.getByTestId('editor-world-name')).toHaveText('Village One');

  // The village zone is the one with ground; the panel says so for the others.
  await expect.poll(() => editorTerrainProgram(page), { timeout: 120_000 }).not.toBeNull();
  const smooth = await editorTerrainProgram(page);

  // The ground lives in the Zone inspector, one tab along. It was its own panel
  // standing beside the terrain one until the two were folded together, and a
  // test that still opened on it would be testing a layout nobody ships.
  await page.getByTestId('right-tab-zone').click();

  // Every layer of the village tile is listed, with its three dials.
  await expect(page.getByTestId('ground-layer-0')).toBeVisible();
  await expect(page.getByTestId('ground-metallic-1')).toHaveValue('0.85');

  // A number typed into the panel reaches the document.
  await page.getByTestId('ground-metallic-1').fill('0.4');
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');

  // The slider beside it writes the same field through the same command, and
  // the box follows — the two are one dial, not two (ADR-0050).
  await page.getByTestId('ground-metallic-1-slider').fill('0.6');
  await expect(page.getByTestId('ground-metallic-1')).toHaveValue('0.6');

  // …and the switch reaches the picture: a facetted tile is a different program.
  await page.getByTestId('ground-flatNormals').check();
  await expect.poll(() => editorTerrainProgram(page), { timeout: 60_000 }).not.toBe(smooth);
  const facetted = await editorTerrainProgram(page);
  expect(facetted).toContain('f');

  // Three edits, three undos, and the ground is the one the world file
  // describes. The whole slider drag is one of those three: a gesture folded
  // into one history entry, the way the lighting sliders already were.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorTerrainProgram(page), { timeout: 60_000 }).toBe(smooth);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('ground-metallic-1')).toHaveValue('0.4');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('ground-metallic-1')).toHaveValue('0.85');
});

test('editor switches tools with Q/W/E/R and deletes with the Delete key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-open-example').click();
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();

  // Counted rather than assumed: the save test above writes into the same
  // throwaway content directory, so the world it opens is the one that test
  // left behind. What this test is about is the delta, not the total.
  const before = await editorEntityCount(page);
  expect(before).not.toBeNull();

  for (const [key, tool] of [
    ['KeyW', 'move'],
    ['KeyE', 'rotate'],
    ['KeyR', 'scale'],
    ['KeyQ', 'select'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByTestId('hierarchy-entity-barrel_001').click();
  await expect(page.getByTestId('editor-selection')).toHaveText('1 selected');

  await page.keyboard.press('Delete');
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toHaveCount(0);
  await expect.poll(() => editorEntityCount(page)).toBe((before ?? 0) - 1);
  await expect.poll(() => editorMeshCount(page)).toBe((before ?? 0) - 1);

  await page.keyboard.press('Control+z');
  await expect.poll(() => editorEntityCount(page)).toBe(before);
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();
});

/**
 * The narrow freeze, and the hold that makes it safe (ADR-0049).
 *
 * The editor pins an entity's world matrices once its model has landed and
 * thaws it again for exactly as long as it is selected. Both halves fail
 * silently. A freeze that stops happening — a lost `freeze` call, a reconciler
 * that rebuilds instead of moving — costs a frame rate nobody attributes to it
 * and no assertion in this suite notices. A *hold* that stops working is worse
 * and quieter still: the gizmo drags, the inspector counts up, the document
 * saves, and the prop does not move on screen, because everything except the
 * picture agrees. `pnpm smoke` already drives a real gizmo (below), but that
 * test would pass just as well with the freeze deleted, so it witnesses
 * nothing about it.
 *
 * So this asserts the rule as an equation instead: with nothing selected every
 * loaded entity is pinned, and selecting one takes exactly one off. It is
 * cheap — the example world, not the village — and it is the assertion a later
 * merge of this file has to keep passing.
 */
test('editor pins a loaded entity and lets the selected one go', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-open-example').click();
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();

  // Only a landed model is pinned: a stand-in cube is about to be replaced, so
  // pinning it would pin a matrix nothing will use. Waiting for the model is
  // therefore what makes the equation below have a right-hand side at all.
  await expect.poll(async () => (await editorDebug(page))?.loadedCount).toBeGreaterThan(0);
  const loaded = (await editorDebug(page))?.loadedCount ?? 0;

  // Nothing selected: everything that has its model is frozen.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await editorDebug(page))?.frozenCount).toBe(loaded);

  // Selecting thaws exactly the selection, and nothing else.
  await page.getByTestId('hierarchy-entity-barrel_001').click();
  await expect(page.getByTestId('editor-selection')).toHaveText('1 selected');
  await expect.poll(async () => (await editorDebug(page))?.frozenCount).toBe(loaded - 1);

  // And letting go pins it again, where it now stands.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await editorDebug(page))?.frozenCount).toBe(loaded);
});

/**
 * The gizmo, driven by a real mouse.
 *
 * `changesFromDrag` is unit-tested and the inspector exercises the same command
 * path, but neither proves that Babylon's handles are attached to the right
 * node, that a drag ends where this app is listening, or that the gesture
 * arrives as *one* history entry instead of one per frame. Only a real drag on
 * a real arrow does.
 *
 * `F` frames the barrel first, which puts the entity origin — and with it the
 * gizmo — at a known place on screen. The grab offsets are a short search along
 * the red +x arrow rather than one magic pixel: the arrow is drawn at a
 * constant screen size, so a handful of offsets covers it without pinning the
 * test to Babylon's exact arrow geometry.
 */
test('editor moves an entity by dragging the move gizmo', async ({ page }) => {
  // Pinned, because this is the one test that aims at a pixel: the gizmo is
  // drawn at a constant screen size, but where the framed entity's origin lands
  // depends on how tall the canvas is.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-open-example').click();

  // Wait for the model itself, not just the entity: `F` frames what is on
  // screen, and a 1 m stand-in cube is framed from a different distance than a
  // 25 cm barrel — which would put the gizmo somewhere else entirely.
  await expect.poll(async () => (await editorDebug(page))?.loadedCount).toBeGreaterThan(0);
  await page.getByTestId('hierarchy-entity-barrel_001').click();
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyW');
  await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');

  const positionX = page.getByTestId('inspector-position-x');
  const before = await positionX.inputValue();
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (!box) {
    throw new Error('the editor has no viewport canvas');
  }
  // The camera looks along +z at the default heading, so world +x is screen
  // right; the entity origin sits below the framed centre, at its base.
  const originX = box.x + box.width / 2;
  const originY = box.y + box.height / 2 + 30;

  let moved = false;
  search: for (const down of [30, 22, 38]) {
    for (const grab of [45, 60, 75]) {
      await page.mouse.move(originX + grab, originY + down - 30);
      await page.mouse.down();
      await page.mouse.move(originX + grab + 140, originY + down - 30, { steps: 12 });
      await page.mouse.up();
      if ((await positionX.inputValue()) !== before) {
        moved = true;
        break search;
      }
    }
  }
  expect(moved, 'dragging the move gizmo changed nothing').toBe(true);

  // Snapping is on by default, so the result is a whole grid step, and the
  // whole gesture is exactly one entry in the history.
  const after = Number((await positionX.inputValue()).replace(',', '.'));
  expect(after).toBeGreaterThan(Number(before.replace(',', '.')));
  expect((after * 2) % 1).toBe(0);
  await expect.poll(async () => (await editorDebug(page))?.undoDepth).toBe(1);
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');

  await page.keyboard.press('Control+z');
  await expect(positionX).toHaveValue(before);
});

test('api reports healthy', async ({ request }) => {
  const response = await request.get(apiUrl('/health'));
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'ok',
    service: 'world-of-vikings-api',
  });
});

test('api serves the worlds in content/', async ({ request }) => {
  const response = await request.get(apiUrl('/worlds'));
  expect(response.status()).toBe(200);
  const listing = await response.json();
  expect(listing.invalid).toEqual([]);
  expect(listing.worlds).toContainEqual(
    expect.objectContaining({ id: 'example', name: 'Example World', zones: 1 }),
  );

  const world = await request.get(apiUrl('/worlds/example'));
  expect(world.status()).toBe(200);
  expect(await world.json()).toMatchObject({
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id: 'example',
  });

  const missing = await request.get(apiUrl('/worlds/there-is-no-such-world'));
  expect(missing.status()).toBe(404);
});

test('api serves the merged prefab catalogue', async ({ request }) => {
  const response = await request.get(apiUrl('/prefabs'));
  expect(response.status()).toBe(200);
  const listing = await response.json();
  expect(listing.invalid).toEqual([]);
  // The hand-written catalogue, which is the one the editor's placement test
  // uses: it is public, so it loads on a clone with no private asset store.
  expect(listing.prefabs).toContainEqual(
    expect.objectContaining({ id: 'barrel-01', catalog: 'base', visibility: 'public' }),
  );
});

test('asset server reports healthy', async ({ request }) => {
  const response = await request.get(`${appUrl('assetUrl')}/health`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ service: 'world-of-vikings-assets' });
});

/**
 * The village is solid (ADR-0026).
 *
 * These are the tests unit tests cannot stand in for. `MovementSystem` slides
 * along a wall in a test with a wall made of arithmetic; the physics package
 * builds a shape from triangles a test wrote out by hand. What neither can say
 * is that the *authored* village — 1216 entities, most of them scaled unevenly
 * and 133 of them mirrored — turns into shapes that stand where the models are
 * drawn. Only walking into one says that.
 *
 * Every spawn point below is a place in `content/worlds/village1.json`. `?spawn=`
 * puts the capsule there and the camera opens behind it looking along +z, so
 * holding `W` walks in +z — which is why each site is approached from its −z
 * side and the assertions are about `z`.
 */

/** Where the collision builder's report is, once it has one. */
function collisionReport(
  page: Page,
): Promise<NonNullable<WovDebugWindow['__wov']>['collision'] | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.collision ?? null);
}

/** Opens the village at a spawn point and waits until the world is solid. */
async function standAt(page: Page, spawn: string): Promise<PlayerDebug> {
  await page.goto(`${appUrl('gameUrl')}?spawn=${spawn}`);
  await expect(page.getByTestId('game-collision')).toContainText(/\d+ bodies from \d+ shapes/, {
    timeout: 180_000,
  });
  // The capsule is put down before the bodies are built; give the frame after
  // that a moment so the first sample is where the player actually stands.
  await page.waitForTimeout(600);
  return livePlayer(page);
}

/**
 * Holds `W` until the capsule stops moving, and answers where it stopped.
 *
 * Not "hold for N milliseconds": this browser has no GPU, the village is 1216
 * entities, and the frame rate — and with it how much simulated time a second
 * of wall clock buys — is not something a test may assume. Walking until the
 * position stops changing measures the same thing and does not care.
 */
async function walkUntilStill(page: Page, budgetMs = 30_000): Promise<PlayerDebug> {
  await page.keyboard.down('KeyW');
  try {
    const deadline = Date.now() + budgetMs;
    let previous = await livePlayer(page);
    let stillFor = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const now = await livePlayer(page);
      stillFor = Math.hypot(now.x - previous.x, now.z - previous.z) < 0.02 ? stillFor + 1 : 0;
      previous = now;
      if (stillFor >= 2) {
        break;
      }
    }
    return previous;
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** Holds `W` until the capsule is past `z`, or until the budget runs out. */
async function walkPast(page: Page, z: number, budgetMs = 30_000): Promise<PlayerDebug> {
  await page.keyboard.down('KeyW');
  try {
    const deadline = Date.now() + budgetMs;
    let at = await livePlayer(page);
    while (at.z < z && Date.now() < deadline) {
      await page.waitForTimeout(500);
      at = await livePlayer(page);
    }
    return at;
  } finally {
    await page.keyboard.up('KeyW');
  }
}

/** Casts a ray through the collision geometry the game built. */
function rayHit(
  page: Page,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): Promise<{ x: number; y: number; z: number } | null> {
  return page.evaluate(
    ([a, b]) =>
      (window as WovDebugWindow).__wov?.rayHit(
        a as [number, number, number],
        b as [number, number, number],
      ) ?? null,
    [from, to],
  );
}

test('game builds one collision shape for many entities', async ({ page }) => {
  await page.goto(appUrl('gameUrl'));
  await expect(page.getByTestId('game-collision')).toContainText(/\d+ bodies from \d+ shapes/, {
    timeout: 180_000,
  });

  const report = await collisionReport(page);
  if (report === null) {
    throw new Error('the game dev build published no collision report');
  }

  // Sharing, as a number rather than as a claim: a body per shape would make
  // these two equal. The village is 1216 entities from 139 models.
  expect(report.bodies).toBeGreaterThan(1000);
  expect(report.shapes).toBeLessThan(report.bodies / 3);
  // Every entity is accounted for: it has a shape, or it says it wants none.
  expect(report.undeclared).toBe(0);
  expect(report.passable).toBeGreaterThan(0);
  expect(report.failed).toEqual([]);
  // Triangles are for the few shapes that need them, not for the whole village.
  expect(report.triangles).toBeLessThan(20_000);
});

/**
 * A wall stops the player.
 *
 * Three claims, because the first one alone would pass with a player that
 * cannot move at all: the capsule covered ground, it stopped short of the wall,
 * and it stayed stopped while the key was still held.
 */
test('game stops the player at a stone wall', async ({ page }) => {
  test.setTimeout(180_000);
  // A stone wall runs across the path at z ≈ 164; the capsule starts 2.5 m
  // short of it on open, level ground.
  const start = await standAt(page, '171.95,161.5');

  const walked = await walkUntilStill(page);
  expect(walked.z - start.z).toBeGreaterThan(1);
  expect(walked.z).toBeLessThan(163.9);

  // Still holding the key changes nothing: it is stopped, not merely slow.
  const pressed = await walkUntilStill(page, 6_000);
  expect(Math.abs(pressed.z - walked.z)).toBeLessThan(0.1);

  // And what stopped it is geometry in front of it, not the edge of the world.
  const knee = pressed.y + 0.5;
  expect(
    await rayHit(page, [pressed.x, knee, pressed.z], [pressed.x, knee, pressed.z + 2]),
  ).not.toBeNull();
});

/**
 * A tree stops the player at its trunk and not at its crown.
 *
 * The one rule a screenshot cannot check and a collision test that only asks
 * "does it collide" would pass either way: this tree's crown is 8.6 m across
 * and its measured trunk is 0.4 m, so the same walk one metre to the side has
 * to go straight through where the crown is.
 */
test('game stops the player at a tree trunk', async ({ page }) => {
  test.setTimeout(180_000);
  const start = await standAt(page, '151.68,134.5');
  const stopped = await walkUntilStill(page);

  expect(stopped.z - start.z).toBeGreaterThan(1);
  // The trunk's near face is at z ≈ 137.1; a 0.4 m body stops in front of it.
  expect(stopped.z).toBeLessThan(136.8);
});

test('game walks the player through the same tree’s crown', async ({ page }) => {
  test.setTimeout(180_000);
  // One metre to the side of that trunk — still deep inside a crown 4.3 m wide,
  // which is what a hull or a bounds box would have collided against.
  await standAt(page, '150.68,135.0');
  const past = await walkPast(page, 139);
  expect(past.z).toBeGreaterThan(139);
});

/**
 * An archway is a hole, not a slab.
 *
 * `collision: mesh` is the only kind with a hole in it, and this is the test
 * that says so: the capsule walks through the opening, and a ray through a post
 * finds geometry where a ray through the opening finds none. A box or a convex
 * hull would fail both halves.
 */
test('game walks the player through an archway', async ({ page }) => {
  test.setTimeout(180_000);
  // The archway stands at z ≈ 114.6, across the path.
  const start = await standAt(page, '172.78,112.3');
  expect(start.z).toBeLessThan(114);

  const walked = await walkPast(page, 116);
  expect(walked.z).toBeGreaterThan(116);

  const height = 10.31 + 1;
  const through = (x: number): Promise<{ x: number; y: number; z: number } | null> =>
    rayHit(page, [x, height, 112.5], [x, height, 116.5]);
  expect(await through(172.78)).toBeNull();
  expect(await through(172.78 - 2.2)).not.toBeNull();
  expect(await through(172.78 + 2.2)).not.toBeNull();
});

/**
 * Every gate in the village is a gate, not a wall with a gate drawn on it.
 *
 * `game walks the player through an archway` above proves one of the nine, by
 * walking through it — which is the strongest evidence there is, and also the
 * reason it only covers one: the camera opens looking along +z, so a held key
 * only walks through a gate that happens to face that way.
 *
 * The other eight are checked the way the player's own obstacle probe checks
 * them. It samples two heights — one step above the feet and one at the chest
 * (`apps/game/src/physics-obstacles.ts`) — and the body it moves is 0.8 m
 * across. So a gate is passable exactly when both of those heights have a clear
 * run wider than that, and that is what this measures, across the opening of
 * every archway the world file places.
 *
 * The failure it stands in front of is not the archway's own shape — that has
 * had `collision: mesh` since ADR-0026 — but a **neighbour**: the palisade and
 * stone-wall runs the gate is set into are collided against as boxes, and a run
 * whose box reaches across the opening bricks the gate up with nothing on
 * screen changing. Measured on this world: the narrowest of the nine leaves
 * 2.5 m clear at both heights, and the posts on either side stay solid.
 */
/**
 * The two heights the player's obstacle probe samples, and how wide the body it
 * moves is — restated from `apps/game/src/physics-obstacles.ts` and
 * `packages/physics/src/defaults.ts`, because `tooling/` may not import the
 * game (`lint:boundaries`). If either moves, this test measures the wrong
 * heights and says a gate is open that the player cannot walk through, so both
 * are asserted against the client's own behaviour by the walk-through test
 * above rather than trusted on their own.
 */
const PROBE_HEIGHTS_METRES = [0.5, 1.4] as const;
/** Capsule radius 0.4 m, so the body is 0.8 m across. */
const PLAYER_BODY = 0.8;

const VILLAGE = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'content', 'worlds', 'village1.json'), 'utf8'),
) as {
  zones: readonly {
    readonly entities: readonly {
      readonly id: string;
      readonly prefab: string;
      readonly position: readonly number[];
      readonly rotation?: readonly number[];
    }[];
  }[];
};

const GATES = (VILLAGE.zones[0]?.entities ?? []).filter((entity) =>
  entity.prefab.includes('archway'),
);

test('game leaves every gate in the village open', async ({ page }) => {
  test.setTimeout(300_000);
  await standAt(page, '166,150');

  expect(GATES.length, 'the village lost its archways').toBe(9);

  const narrowest: { id: string; metres: number }[] = [];
  for (const gate of GATES) {
    const [x = 0, y = 0, z = 0] = gate.position;
    const yaw = gate.rotation?.[1] ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    /*
     * The gate's own frame: `across` runs along the opening, `through` is the
     * way the player goes. Rays are kept inside the arch's own depth so that a
     * building a few metres beyond it cannot be mistaken for a closed gate.
     */
    const at = (across: number, height: number, through: number): [number, number, number] => [
      x + across * cos + through * sin,
      y + height,
      z - across * sin + through * cos,
    ];

    let widest = 0;
    for (const height of PROBE_HEIGHTS_METRES) {
      let run = 0;
      let best = 0;
      for (let across = -2; across <= 2.001; across += 0.25) {
        const blocked =
          (await rayHit(page, at(across, height, -0.9), at(across, height, 0.9))) !== null;
        run = blocked ? 0 : run + 0.25;
        best = Math.max(best, run);
      }
      widest = height === PROBE_HEIGHTS_METRES[0] ? best : Math.min(widest, best);
    }
    narrowest.push({ id: gate.id, metres: widest });

    // Wider than the body, with room to spare: a corridor exactly 0.8 m across
    // is one that a body of exactly 0.8 m gets wedged in.
    expect(widest, `gate ${gate.id} is bricked up`).toBeGreaterThan(PLAYER_BODY + 0.4);

    /*
     * And it is still a gate in something: both edges of the sampled span find
     * geometry at chest height. Without this half a village with no walls left
     * in it would pass every assertion above. Two metres out from the middle,
     * because that is where the archway's own posts stand — its half-width is
     * 2.77 m and the opening between the posts is about 4 m.
     */
    const chest = PROBE_HEIGHTS_METRES[1] ?? 1.4;
    for (const side of [-2, 2]) {
      expect(
        await rayHit(page, at(side, chest, -0.9), at(side, chest, 0.9)),
        `gate ${gate.id} has no post at ${String(side)} m`,
      ).not.toBeNull();
    }
  }

  test.info().annotations.push({
    type: 'gates',
    description: narrowest
      .map((gate) => `${gate.id}: ${gate.metres.toFixed(2)} m clear`)
      .join(', '),
  });
});
