import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The village comes up, under the light its world file asks for (ADR-0029).
 *
 * This is the test that was missing when the client stopped on the village a
 * few frames in: the frame counter stood at four, `window.__wov.render` was all
 * zeros, the status line still said `collision: loading…`, and the console
 * carried `Unable to compile effect … fragment: rgbdDecode`. Nothing threw,
 * nothing failed to load, and every unit test and every `?flat=1` smoke test
 * stayed green — because `?flat=1` replaces the world's profile with a flat
 * noon that never puts a PBR material in front of the shader compiler, and the
 * BRDF look-up table that pulls `Shaders/rgbdDecode.fragment.js` in is only
 * asked for under the real one.
 *
 * So four witnesses, in the order they fail:
 *
 * 1. **no shader is refused.** `Unable to compile effect` and
 *    `FRAGMENT SHADER ERROR` are console errors Babylon writes while carrying
 *    on, so a test that only looked at the picture would see a village with one
 *    material missing and call it a pass.
 * 2. **frames keep coming.** More than sixty of them: the failure left four.
 * 3. **the village is drawn.** More than a hundred draw calls, so a frame
 *    counter climbing over an empty scene cannot pass this.
 * 4. **collision finishes.** The status line stops saying `loading…` and
 *    reports its bodies — the build runs after the first frames, so a client
 *    that dies early never gets here.
 *
 * The `?flat=1` tests stay where they are: they are the fast wiring check, and
 * this is the one that stands in front of the shader compiler.
 *
 * **Skipped without the store.** The village's models are private (ADR-0015);
 * a clone without `WOV_ASSET_STORE` would measure an empty plane.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/** The village square, under the world's own lighting profile — no `?flat=1`. */
const SQUARE = '?world=village1&spawn=166,150';

/** What Babylon says when an effect will not compile, in any of its wordings. */
const SHADER_REFUSED = /Unable to compile effect|FRAGMENT SHADER ERROR|VERTEX SHADER ERROR/i;

type WovDebugWindow = Window & {
  __wov?: {
    readonly render: {
      readonly drawCalls: number;
      readonly frames: number;
      readonly triangles: number;
    };
  };
};

/** The render counters, or `null` while the dev bridge is not installed yet. */
function renderCounters(
  page: Page,
): Promise<{ drawCalls: number; frames: number; triangles: number } | null> {
  return page.evaluate(() => {
    const bridge = (window as WovDebugWindow).__wov;
    return bridge === undefined ? null : { ...bridge.render };
  });
}

test.describe('the village under its own light', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the village models are private');

  test('renders, compiles every shader and finishes its collision', async ({ page }) => {
    /*
     * Generous, and on purpose. Where no GPU answers, Chromium falls back to
     * SwiftShader (see `playwright.config.ts`), and the village is 3.9 M
     * triangles: measured there, the first frames take about twenty seconds and
     * the collision build about forty. The test is about whether the client
     * comes up at all, so it must not fail on a machine that is merely slow.
     */
    test.setTimeout(360_000);

    const refused: string[] = [];
    page.on('console', (message) => {
      if (SHADER_REFUSED.test(message.text())) {
        refused.push(message.text().slice(0, 300));
      }
    });
    const crashed: string[] = [];
    page.on('pageerror', (error) => crashed.push(String(error).slice(0, 300)));

    await page.goto(`${String(test.info().config.metadata['gameUrl'])}${SQUARE}`);

    // The world arrives first — everything after this is about the picture.
    await expect(page.getByTestId('game-world')).toContainText(/from \d+ models/, {
      timeout: 240_000,
    });

    // ------------------------------------------------------ every shader compiled
    //
    // Asserted before the counters, because this is the cause and the counters
    // are the symptom: a report that says "0 frames" tells nobody why.
    expect(refused, 'Babylon refused to compile an effect').toEqual([]);
    expect(crashed, 'the page threw').toEqual([]);

    // ------------------------------------------------------------- frames, drawn
    await expect
      .poll(async () => (await renderCounters(page))?.frames ?? 0, { timeout: 180_000 })
      .toBeGreaterThan(60);

    const counters = await renderCounters(page);
    // A hundred draw calls is far below the ~540 measured on the square and far
    // above the ~10 a client that only drew the terrain tile would report.
    expect(counters?.drawCalls, 'the village was not drawn').toBeGreaterThan(100);

    // ------------------------------------------------------- collision finished
    await expect(page.getByTestId('game-collision')).toContainText(/\d+ bodies from \d+ shapes/, {
      timeout: 180_000,
    });

    // Still nothing refused after the whole zone is up: the materials that
    // arrive last are the ones the first frames never asked to compile.
    expect(refused, 'Babylon refused to compile an effect while the zone filled in').toEqual([]);

    test.info().annotations.push({
      type: 'render',
      description:
        `${String(counters?.frames)} frames, ${String(counters?.drawCalls)} draw calls, ` +
        `${String(counters?.triangles)} triangles`,
    });
  });
});
