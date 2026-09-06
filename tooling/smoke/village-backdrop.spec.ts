import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { decodePng } from '../asset-pipeline/png.js';

/**
 * The proof that the painted distance reaches the screen (ADR-0031).
 *
 * Unit tests pin the category, the import, the zone rule and the two flags.
 * None of them can show that the horizon is *drawn*, and every way this fails
 * leaves no error anywhere:
 *
 * - the shells sat in the `surroundings` zone, which the game does not draw at
 *   all — `playableZone` picks the one zone with ground under it, so 100 cliffs
 *   and 23 clouds have been in the world file since the first scene import and
 *   have never once been on screen;
 * - `applyFog` written on an `InstancedMesh` instead of on its source mesh is
 *   accepted and does nothing, and this world's fog ends at 420 m while the
 *   outer shell stands at 594: the horizon then comes out as one flat band of
 *   fog colour, which looks like a sky and is a mountain range that is not
 *   there; and
 * - a shell the surface table left `OPAQUE` walls the world in, sky and all.
 *
 * So two witnesses, and neither of them is "it looks nice":
 *
 * 1. the meshes themselves report no fog, no picking and no shadow — counted on
 *    the meshes after the light rig has had them, not assumed from the code
 *    that set the flags;
 * 2. the horizon band of the frame holds *more than one colour*, which fog, an
 *    empty sky and an opaque wall all fail.
 *
 * **Skipped without the store.** The backdrop models are private (ADR-0015) and
 * a clone without `WOV_ASSET_STORE` would photograph a placeholder box.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/**
 * Standing at the north edge of the village, looking out over the terrain edge.
 *
 * The shells are centred on `(160, 160)` at radii of 297 m and 594 m, so from
 * `z = 240` on a 300 m tile the whole range is ahead of the camera and the
 * village is behind it.
 */
const EDGE = '?world=village1&spawn=160,240';

interface Snapshot {
  readonly camera: { yaw: number; pitch: number } | null;
  readonly render: { frames: number; frameTimeMs: number; drawCalls: number; triangles: number };
  readonly backdrop: {
    meshes: number;
    fogged: number;
    pickable: number;
    receivingShadow: number;
  } | null;
}

type WovWindow = Window & { __wov?: Snapshot };

async function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const bridge = (window as WovWindow).__wov;
    return bridge === undefined
      ? null
      : {
          camera: bridge.camera === null ? null : { ...bridge.camera },
          render: { ...bridge.render },
          backdrop: bridge.backdrop === null ? null : { ...bridge.backdrop },
        };
  });
}

/**
 * Pitches the camera up to its limit, without touching the real mouse.
 *
 * Playwright's `mouse.down` on the canvas is what the game asks pointer lock
 * for, and under lock the `movementX`/`movementY` a headless browser reports
 * bear no relation to the pixels the test moved — measured here: a purely
 * vertical drag turned the camera by half a turn. So the gesture is dispatched
 * as untrusted `PointerEvent`s instead: an untrusted `pointerdown` cannot take
 * pointer lock, which is exactly what leaves the deltas the test's own.
 *
 * The camera's yaw is left alone. It opens at 0, which is +z — straight out of
 * the village from a spawn on the north edge — and turning it would only be a
 * second thing to get wrong.
 */
async function pitchUp(page: Page): Promise<{ yaw: number; pitch: number }> {
  await page.evaluate(() => {
    const canvas = document.querySelector('#render-canvas');
    if (canvas === null) {
      throw new Error('the game has no render canvas');
    }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    // Negative movementY is "look up"; the camera clamps at its own minimum
    // pitch, so overshooting is how the test reaches the limit exactly.
    document.dispatchEvent(
      new PointerEvent('pointermove', { movementX: 0, movementY: -2000, bubbles: true }),
    );
    document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
  });
  await page.waitForTimeout(500);
  return (await snapshot(page))?.camera ?? { yaw: 0, pitch: 0 };
}

/** The luminance of one row of pixels, left to right. */
function luminanceRow(png: Buffer, y: number): number[] {
  const image = decodePng(png);
  const row: number[] = [];
  for (let x = 0; x < image.width; x += 1) {
    const at = (y * image.width + x) * 4;
    row.push(
      0.2126 * (image.data[at] ?? 0) +
        0.7152 * (image.data[at + 1] ?? 0) +
        0.0722 * (image.data[at + 2] ?? 0),
    );
  }
  return row;
}

test.describe('the village horizon', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the backdrop models are private');

  test('draws a painted mountain range, out of the fog and out of the light', async ({ page }) => {
    // The same budget the other village test takes, and for the same reason:
    // where no GPU answers this is a 4 M triangle scene on a software rasteriser.
    test.setTimeout(360_000);

    const crashed: string[] = [];
    page.on('pageerror', (error) => crashed.push(String(error).slice(0, 300)));

    await page.goto(`${String(test.info().config.metadata['gameUrl'])}${EDGE}`);
    await expect(page.getByTestId('game-world')).toContainText(/from \d+ models/, {
      timeout: 240_000,
    });
    await expect(page.getByTestId('game-collision')).toContainText(/\d+ bodies from \d+ shapes/, {
      timeout: 240_000,
    });
    expect(crashed, 'the page threw').toEqual([]);

    // ------------------------------------------------- what the meshes report
    const placed = await snapshot(page);
    expect(placed?.backdrop, 'no backdrop was placed in the zone the game draws').not.toBeNull();
    // Two shells: one snowy, one not. The 23 clouds are backdrop too, but they
    // are drawn from three models and their count is not the point here.
    expect(placed?.backdrop?.meshes ?? 0).toBeGreaterThanOrEqual(2);
    // Every one of them takes the fog, because this world's fog reaches past
    // even the outer shell — 1 700 m against a reach of 1 601 m (ADR-0034).
    // Paired with the flat-band measurement further down, this is the whole
    // claim: the range is hazed *and* still a range. Asserting only that it is
    // hazed would pass on a horizon fogged into one grey band, which is the
    // failure ADR-0031 was written against.
    expect(placed?.backdrop?.fogged, 'a backdrop mesh was left out of the fog').toBe(
      placed?.backdrop?.meshes,
    );
    expect(placed?.backdrop?.pickable, 'a backdrop mesh is still pickable').toBe(0);
    expect(placed?.backdrop?.receivingShadow, 'a backdrop mesh still takes shadow').toBe(0);

    // --------------------------------------------------------- what is on screen
    const camera = await pitchUp(page);
    // Straight out of the village, and as high as the camera goes: the shells
    // stand 105 m and 297 m above the player, which is above the top of the
    // frame at the pitch the camera opens with.
    expect(Math.abs(camera.yaw), 'the camera is not looking out of the village').toBeLessThan(0.2);
    expect(camera.pitch, 'the camera never pitched up').toBeLessThan(0);

    const shot = await page.screenshot({ path: test.info().outputPath('village-horizon.png') });
    const image = decodePng(shot);

    // A band in the upper third of the frame, which is where a shell whose rim
    // stands 105 m above the player at 290 m is. Several rows rather than one,
    // because a single row can land entirely inside one cloud.
    const bands = [0.2, 0.26, 0.32, 0.38].map((fraction) => {
      const row = luminanceRow(shot, Math.floor(image.height * fraction));
      return Math.max(...row) - Math.min(...row);
    });

    // The measurement that fails for every way this breaks: fog, empty sky and
    // an opaque wall are each one colour across the frame. Twelve levels out of
    // 255 is far below the ~90 a lit range measures and far above the ~2 a
    // gradient sky varies across one row.
    for (const [index, spread] of bands.entries()) {
      expect(spread, `horizon band ${String(index)} is one flat colour`).toBeGreaterThan(12);
    }

    const counters = await snapshot(page);
    test.info().annotations.push({
      type: 'render',
      description:
        `yaw ${camera.yaw.toFixed(2)}, pitch ${camera.pitch.toFixed(2)} · ` +
        `${String(counters?.render.frames)} frames at ` +
        `${(counters?.render.frameTimeMs ?? 0).toFixed(2)} ms · ` +
        `${String(counters?.render.drawCalls)} draw calls · ` +
        `${String(counters?.render.triangles)} triangles · ` +
        `horizon spread ${bands.map((value) => value.toFixed(0)).join('/')}`,
    });
  });
});
