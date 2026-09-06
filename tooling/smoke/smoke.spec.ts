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
    groundAt(x: number, z: number): number | null;
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
    readonly selection: readonly string[];
    readonly dirty: boolean;
    readonly undoDepth: number;
    readonly redoDepth: number;
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
  await page.goto(appUrl('gameUrl'));
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
  await page.goto(appUrl('gameUrl'));

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
/**
 * Waits until the ground has stopped changing under the player.
 *
 * The terrain arrives after the first frames and puts the capsule down on it
 * (ADR-0020), so a test that samples a position before and after that lands sees
 * a teleport rather than what it was measuring. Either outcome settles the
 * question — the tile loaded, or it did not — so both are waited for.
 */
async function groundSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('game-status')).toContainText(/terrain (ready|unavailable|drawn)/, {
    timeout: 30_000,
  });
  // The capsule is put down on the tile and the camera eases after it, so the
  // frame in which the status changes is the frame the camera is furthest from
  // where it belongs. Same follow lag the camera-follow test waits out.
  await page.waitForTimeout(600);
}

test('game camera frames the placeholder and answers mouse and wheel', async ({ page }) => {
  await page.goto(appUrl('gameUrl'));
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
  await page.goto(appUrl('gameUrl'));
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
  await page.goto(appUrl('gameUrl'));
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

test('game loads its environment assets over the asset server', async ({ page }) => {
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

  await page.goto(appUrl('gameUrl'));

  // The wording comes from `summarizePlacement` in @wov/asset-system, so this
  // and the app cannot drift apart. A failed load reads
  // "assets: 0 loaded, 1 failed (…)" and fails here.
  // One vendored asset plus two from the private store. A private asset that
  // fell back to its placeholder still counts as loaded — that is the point of
  // the fallback — so this number does not depend on the store being mounted.
  await expect(page.getByTestId('game-assets')).toHaveText('assets: 3 loaded');
  // Where the bytes came from, not only how many arrived (ADR-0015). The
  // wording comes from `summarizeAssetSources`, so this and the app cannot
  // drift apart either. "2 private" is pinned because that is what the probe
  // asks for; the placeholder count is 0 with a store mounted and 2 without,
  // and both are correct — the point is that it is stated rather than silent.
  await expect(page.getByTestId('game-asset-sources')).toHaveText(
    /^assets: 2 private, [02] placeholder$/,
  );
  // The GLB references its texture by a relative path, so a wrongly vendored
  // layout is a second failure mode. Babylon happens to reject the whole load
  // when that file is missing, but a model with an optional side-car would only
  // show up on the wire — so watch the wire too, not just the marker.
  expect(badResponses).toEqual([]);
});

test('game loads the physics backend and collides the ground', async ({ page }) => {
  await page.goto(appUrl('gameUrl'));
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
  await page.goto(appUrl('gameUrl'));
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
