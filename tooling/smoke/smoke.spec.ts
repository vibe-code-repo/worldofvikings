import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
  };
};

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
  await page.goto('http://localhost:5172');
  await expect(page.getByTestId('site-marker')).toHaveText('World of Vikings');
  await expect(page.getByTestId('play-link')).toHaveAttribute('href', /5173|live\./);
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
  await page.goto('http://localhost:5173');
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
  await page.goto('http://localhost:5173');

  await expect.poll(() => frameId(page), { timeout: 10_000 }).not.toBeNull();
  const before = await frameId(page);
  expect(before).not.toBeNull();

  await expect
    .poll(() => frameId(page), { timeout: 2_000, intervals: [100, 100, 200, 200, 400] })
    .toBeGreaterThan(before ?? 0);

  await expect(page.getByTestId('game-frame')).toHaveText(/^frame \d+$/);
  await expect(page.getByTestId('game-marker')).toContainText(/frame \d+/);
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
test('game camera frames the placeholder and answers mouse and wheel', async ({ page }) => {
  await page.goto('http://localhost:5173');
  const opening = await liveCamera(page);

  // Behind the capsule (−z, since it faces +z) and above its feet, at the
  // configured distance rather than at the origin.
  expect(opening.z).toBeLessThan(0);
  expect(opening.y).toBeGreaterThan(1);
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
  await page.goto('http://localhost:5173');
  await expect(page.getByTestId('game-status')).toContainText('renderer ready');

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

test('game loads its environment asset over the asset server', async ({ page }) => {
  const badResponses: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes(':9000/') && !response.ok()) {
      badResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });

  await page.goto('http://localhost:5173');

  // The wording comes from `summarizePlacement` in @wov/asset-system, so this
  // and the app cannot drift apart. A failed load reads
  // "assets: 0 loaded, 1 failed (…)" and fails here.
  await expect(page.getByTestId('game-assets')).toHaveText('assets: 1 loaded');
  // The GLB references its texture by a relative path, so a wrongly vendored
  // layout is a second failure mode. Babylon happens to reject the whole load
  // when that file is missing, but a model with an optional side-car would only
  // show up on the wire — so watch the wire too, not just the marker.
  expect(badResponses).toEqual([]);
});

test('game loads the physics backend and collides the ground', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Proves the whole chain in a real browser: the dynamic Havok import
  // resolved, the WASM module loaded from the URL Vite emitted, and the base
  // ground became static collision geometry (ADR-0013). Unit tests can prove
  // none of that — the backend does not exist until a browser fetches it.
  await expect(page.getByTestId('game-status')).toContainText('physics ready', {
    timeout: 30_000,
  });
});

test('editor shows its shell and viewport placeholder', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await expect(page.getByTestId('editor-marker')).toContainText('world editor dev build');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(RENDERER_STATUS);
});

test('api reports healthy', async ({ request }) => {
  const response = await request.get('http://localhost:3000/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'ok',
    service: 'world-of-vikings-api',
  });
});

test('asset server reports healthy', async ({ request }) => {
  const response = await request.get('http://localhost:9000/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ service: 'world-of-vikings-assets' });
});
