import { expect, test } from '@playwright/test';

test('website shows its marker and links to the game', async ({ page }) => {
  await page.goto('http://localhost:5172');
  await expect(page.getByTestId('site-marker')).toHaveText('World of Vikings');
  await expect(page.getByTestId('play-link')).toHaveAttribute('href', /5173|live\./);
});

test('game shows its dev build marker', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.getByTestId('game-marker')).toContainText('World of Vikings');
  await expect(page.getByTestId('game-marker')).toContainText('game dev build');
  // The renderer may be unavailable on a headless machine without a GPU; the
  // status line must still report what happened instead of staying blank.
  await expect(page.getByTestId('game-status')).not.toHaveText('starting…');
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

test('editor shows its shell and viewport placeholder', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await expect(page.getByTestId('editor-marker')).toContainText('world editor dev build');
  await expect(page.getByTestId('editor-viewport-status')).not.toHaveText('starting…');
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
