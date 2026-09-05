import { expect, test } from '@playwright/test';

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
