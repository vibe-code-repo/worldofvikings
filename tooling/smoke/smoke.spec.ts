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
  // The desktop controls of spec §27 are named on screen (ADR-0008).
  await expect(page.getByTestId('game-controls')).toContainText('WASD');
  await expect(page.getByTestId('game-controls')).toContainText('capture the mouse');
});

test('game walks the player capsule when a key is held', async ({ page }) => {
  // The one assertion the unit tests cannot make: that the DOM adapter, the
  // fixed-step loop and the renderer are wired to each other at all. Every part
  // passes its own tests just as happily while connected to nothing.
  await page.goto('http://localhost:5173');
  await expect(page.getByTestId('game-status')).toContainText('renderer ready');

  const capsuleXZ = async (): Promise<readonly [number, number]> =>
    page.evaluate(() => {
      const debug = (
        globalThis as {
          __wovDebug?: { readonly player: { readonly position: { x: number; z: number } } };
        }
      ).__wovDebug;
      if (!debug) {
        throw new Error('the dev build did not publish __wovDebug');
      }
      return [debug.player.position.x, debug.player.position.z] as const;
    });

  const [x0, z0] = await capsuleXZ();

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');

  const [x1, z1] = await capsuleXZ();

  // Half a second at the Phase 1 walking speed covers metres, not millimetres.
  expect(Math.sqrt((x1 - x0) ** 2 + (z1 - z0) ** 2)).toBeGreaterThan(0.5);

  // And it stops when the key comes up, rather than drifting on for ever.
  await page.waitForTimeout(400);
  const [x2, z2] = await capsuleXZ();
  await page.waitForTimeout(300);
  const [x3, z3] = await capsuleXZ();

  expect(Math.sqrt((x3 - x2) ** 2 + (z3 - z2) ** 2)).toBeLessThan(0.01);
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
