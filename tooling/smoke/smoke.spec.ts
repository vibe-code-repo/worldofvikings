import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The game's dev build publishes its frame counter on `window.__wov`. Typed
 * here rather than with `declare global` so this file stays the only place
 * that knows about the bridge and nothing widens `Window` workspace-wide.
 */
type WovDebugWindow = Window & { __wov?: { readonly frameId: number } };

/** The current frame counter, or `null` while the bridge is not installed. */
function frameId(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovDebugWindow).__wov?.frameId ?? null);
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

test('game shows its dev build marker', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.getByTestId('game-marker')).toContainText('World of Vikings');
  await expect(page.getByTestId('game-marker')).toContainText('game dev build');
  await expect(page.getByTestId('game-status')).toHaveText(RENDERER_STATUS);
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
