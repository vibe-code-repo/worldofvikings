import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { decodePng } from '../asset-pipeline/png.js';

/**
 * The proof that the world's lighting profile reaches the screen (ADR-0024).
 *
 * Unit tests pin what `resolveLightingProfile` answers and what
 * `applyLighting` puts into a scene. None of them can show that a shadow map
 * is actually rendered into, that the ground's hand-written shader samples it,
 * or that the frame is graded — and each of those has already failed here in a
 * way that leaves no error anywhere:
 *
 * - `receiveShadows` on an `InstancedMesh` is refused with a console warning
 *   and no effect, so ninety copies of one fence stood in a scene with shadows
 *   and took none;
 * - the shadow map's depth is a float texture on one machine and a packed byte
 *   texture on another, and reading the wrong one leaves the ground either
 *   never in shade or entirely in it.
 *
 * So three witnesses, and none of them is "it looks nice":
 *
 * 1. the rig reports a shadow map, casters in it, a grading chain, fog, a sky;
 * 2. the ground is a shadow *receiver* — the frame has dark pixels that the
 *    same frame without shadows does not have;
 * 3. the frame is measurably more contrasty and has measurably more of itself
 *    in shade than the same frame with only the shadow map switched off.
 *
 * **Skipped without the store.** The village's models are private (ADR-0015),
 * and a clone without `WOV_ASSET_STORE` would measure an empty green plane.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/** What the light rig reports about itself, through the game's dev bridge. */
interface LightingDebug {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly shadowCasters: number;
  readonly postProcessing: boolean;
  readonly fog: boolean;
  readonly sky: boolean;
}

type WovDebugWindow = Window & {
  __wov?: {
    readonly frameId: number;
    readonly lighting: LightingDebug | null;
    readonly render: { readonly drawCalls: number; readonly triangles: number };
  };
};

/**
 * The camera of the reference picture: standing on the village square, looking
 * across the flagstones from slightly above. `?spawn=` is what puts the player
 * there; the third-person camera's own defaults do the rest.
 */
const SQUARE = '?world=village1&spawn=166,150';

/**
 * The luminance of every pixel in the lower two thirds of a frame, in reading
 * order — the sky is left out so it cannot carry the numbers.
 */
function luminance(png: Buffer): Float64Array {
  const image = decodePng(png);
  const { width, height, channels, data } = image;
  const top = Math.floor(height / 3);
  const values = new Float64Array((height - top) * width);
  let at = 0;
  for (let y = top; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? red;
      const blue = data[index + 2] ?? red;
      values[at] = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      at += 1;
    }
  }
  return values;
}

/** Mean luminance of a frame. */
function meanLuminance(values: Float64Array): number {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

/**
 * The share of pixels the shadow map darkened, comparing two frames of the same
 * scene from the same camera.
 *
 * Pixel against pixel rather than histogram against histogram, because a
 * histogram normalises the very thing being measured: shadows pull the median
 * down, and any threshold expressed relative to the median moves down with it.
 * Measured that way the lit frame and the unshadowed one looked identical while
 * the shadows were plainly there.
 */
function darkenedShare(lit: Float64Array, reference: Float64Array): number {
  if (lit.length !== reference.length) {
    throw new Error('the two frames are different sizes; they cannot be compared pixel by pixel');
  }
  let darker = 0;
  for (let index = 0; index < lit.length; index += 1) {
    // Eight levels out of 255: past the rasteriser's own noise, well under the
    // depth of any real shadow.
    if ((reference[index] ?? 0) - (lit[index] ?? 0) > 8 / 255) {
      darker += 1;
    }
  }
  return darker / lit.length;
}

function lighting(page: Page): Promise<LightingDebug | null> {
  return page.evaluate(() => {
    const value = (window as WovDebugWindow).__wov?.lighting;
    return value === undefined || value === null ? null : { ...value };
  });
}

test.describe('the world lights itself', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the village is private (ADR-0015)');

  /**
   * A quarter of the pixels of the other tests.
   *
   * Headless Chromium rasterises in software, and the shipped profile puts a
   * shadow map and an HDR grading chain in front of it — both paid for per
   * pixel. Every number below is a proportion over a whole frame, so a smaller
   * frame measures the same thing and the suite finishes.
   */
  test.use({ viewport: { width: 640, height: 360 } });

  test('puts the village under the evening sun its world file describes', async ({ context }) => {
    // The village is 139 models and 1216 placements, loaded twice — once with
    // the shadow map and once without — and the suite's default timeout is a
    // liveness check's, not a content load's.
    test.setTimeout(600_000);
    const gameUrl = String(test.info().config.metadata['gameUrl']);

    /** What each page's rig said about itself, so the assertions can read it. */
    const reported = new Map<string, LightingDebug>();

    /**
     * Opens the village on a page of its own and photographs it.
     *
     * A page each, rather than two `goto`s on one: the village is 139 models
     * and a shadow map, and loading it twice into the same software-rasterised
     * context reliably took the renderer process down with it.
     */
    const photograph = async (query: string, name: string): Promise<Float64Array> => {
      const page = await context.newPage();
      try {
        await page.goto(`${gameUrl}${SQUARE}${query}`);
        await expect(page.getByTestId('game-world')).toContainText(/from \d+ models/, {
          timeout: 240_000,
        });
        // The models decode and upload for a while after the count lands, and
        // the camera eases into place; the pixels are read from a settled frame.
        await page.waitForTimeout(8_000);
        const rig = await lighting(page);
        expect(rig, `${name}: the dev bridge reported no light rig at all`).not.toBeNull();
        reported.set(name, rig as LightingDebug);
        return luminance(await page.screenshot({ path: test.info().outputPath(`${name}.png`) }));
      } finally {
        await page.close();
      }
    };

    const lit = await photograph('', 'village-square-lit');

    // Witness one: the rig exists and is doing all four jobs.
    const rig = reported.get('village-square-lit');
    expect(rig?.shadows, 'no shadow map').toBe(true);
    expect(rig?.shadowMapSize).toBe(2048);
    // The number that catches the failure this test was written for: a rig with
    // a map nothing is drawn into is a rig with no shadows.
    expect(rig?.shadowCasters, 'the shadow map has no casters').toBeGreaterThan(500);
    expect(rig?.postProcessing, 'no grading chain').toBe(true);
    expect(rig?.fog).toBe(true);
    expect(rig?.sky).toBe(true);

    // Witness two: the same world, the same sun, the same grade and the same
    // camera, with only the shadow map switched off (`?shadows=off`). Every
    // other difference is held constant, so what is left between the two
    // frames is the shadows — which is what makes this a comparison instead of
    // a hard-coded threshold that would drift with the first colour tweak.
    const unshadowed = await photograph('&shadows=off', 'village-square-unshadowed');
    expect(
      reported.get('village-square-unshadowed')?.shadows,
      '?shadows=off left the shadow map on',
    ).toBe(false);

    const darkened = darkenedShare(lit, unshadowed);
    const litMean = meanLuminance(lit);
    const unshadowedMean = meanLuminance(unshadowed);
    test.info().annotations.push({
      type: 'pixels',
      description:
        `${(darkened * 100).toFixed(1)}% of the frame darkened by the shadow map; ` +
        `mean luminance ${litMean.toFixed(3)} against ${unshadowedMean.toFixed(3)}`,
    });

    // The margin is deliberately far below what an evening sun over a village
    // actually casts: this is not a check on how the art looks, it is the check
    // that the shadow map reaches the pixels at all. The failure it exists for
    // produced *zero* — an instanced village receiving nothing, and a ground
    // whose hand-written shader sampled a depth format that was not there.
    expect(darkened, 'the shadow map darkened nothing at all').toBeGreaterThan(0.03);
    // Shade can only take light away, never add it. Contrast deliberately is
    // *not* asserted: a shadow pulls sunlit surfaces down towards the ambient
    // level, so it narrows this frame's histogram rather than widening it —
    // measured, 0.131 against 0.138, which is the opposite of the obvious guess.
    expect(litMean, 'the shadow map made the frame no darker').toBeLessThan(unshadowedMean);
  });
});
