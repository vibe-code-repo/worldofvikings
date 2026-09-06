import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { decodePng } from '../asset-pipeline/png.js';

/**
 * The proof that the material bindings reach the screen (ADR-0019).
 *
 * Unit tests pin what the importer writes into a GLB. They cannot show that
 * Babylon.js resolves `images[].uri: "textures/x.png"` against the model's own
 * URL, that the asset server answers that request with a CORS header, or that
 * the result is a textured model rather than a grey one — which is the whole
 * point of the change, and the thing that quietly failed first: Babylon rejects
 * any URI containing `..` before it requests anything, so the models loaded,
 * drew, counted as "not a placeholder" and were grey.
 *
 * Three witnesses, because each one alone can lie:
 *
 * 1. the store answered `200` for every `…/textures/*.png`, with CORS;
 * 2. the *scene* reports the texture files it finished loading — a request that
 *    arrives is not a texture that got bound;
 * 3. the pixels of the framed building are brown, not white.
 *
 * **Skipped without the store.** These models live in the private asset store
 * (ADR-0015), so a clone without `WOV_ASSET_STORE` cannot run this and must not
 * fail because of it. The rest of `pnpm smoke` still runs.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/**
 * One model per case the binding has to get right, and the texture each must
 * end up wearing.
 *
 * The file names are the model that first needed a texture plus its slot and
 * the content hash (ADR-0019), which is why a building and a rock name the same
 * file: they share one atlas, and the rock is first in the sorted walk.
 *
 * `colourful` is asserted only for the shelter, and that is a statement about
 * the source art rather than about the pipeline: the flat-shaded building
 * atlas is brown, the rock's corner of the same atlas is a neutral grey, and
 * the leaf atlases are luminance masks whose green lived in a material colour
 * the export dropped (ADR-0019). A "must be colourful" rule would be measuring
 * the artwork, not the binding.
 */
const SUBJECTS = [
  {
    entity: 'shelter',
    prefab: 'environment-sm-bld-preset-shelter-02-optimized',
    what: 'a building',
    texture: 'sm-env-rock-03-1-0-2a217835.png',
    colourful: true,
    position: [0, 0, 0],
  },
  {
    entity: 'rock',
    prefab: 'environment-sm-env-rock-01',
    what: 'a rock',
    texture: 'sm-env-rock-03-1-0-2a217835.png',
    colourful: false,
    position: [20, 0, 0],
  },
  {
    entity: 'bush',
    prefab: 'vegetation-bush-1a2',
    what: 'a bush with alpha-cut leaves',
    texture: 'bush-1a2-small-1-dark-0-46087926.png',
    colourful: false,
    position: [40, 0, 0],
  },
] as const;

const WORLD = {
  schemaVersion: 1,
  id: 'textureproof',
  name: 'Texture Proof',
  zones: [
    {
      id: 'stage',
      name: 'Stage',
      entities: SUBJECTS.map((subject) => ({
        id: subject.entity,
        prefab: subject.prefab,
        position: subject.position,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      })),
    },
  ],
};

type WovEditorDebugWindow = Window & {
  __wovEditor?: {
    readonly loadedCount: number;
    readonly loadedTextures: readonly string[];
  };
};

function loadedCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.loadedCount ?? null);
}

function loadedTextures(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as WovEditorDebugWindow).__wovEditor?.loadedTextures ?? []),
  ]);
}

/**
 * What the lit pixels of a screenshot look like: how many there are, how bright
 * they are, and how many are coloured rather than neutral.
 *
 * Background pixels are excluded by brightness, so an empty viewport reports
 * zero samples instead of inheriting the theme. "Coloured" is a spread between
 * the strongest and weakest channel — the difference between the brown thatch
 * of a textured building and the flat white of one drawing with no base colour
 * at all, which is what a rejected texture URI leaves behind.
 */
function litPixels(png: Buffer): { sampled: number; colourful: number; brightness: number } {
  const image = decodePng(png);
  const { data, channels } = image;
  let sampled = 0;
  let colourful = 0;
  let total = 0;
  for (let index = 0; index + channels <= data.length; index += channels) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? red;
    const blue = data[index + 2] ?? red;
    const alpha = channels === 4 ? (data[index + 3] ?? 255) : 255;
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    if (alpha < 128 || high < 40) {
      continue;
    }
    sampled += 1;
    total += (red + green + blue) / 3;
    if (high - low > 24) {
      colourful += 1;
    }
  }
  return {
    sampled,
    colourful: sampled === 0 ? 0 : colourful / sampled,
    brightness: sampled === 0 ? 0 : total / sampled,
  };
}

test.describe('textured models in the editor', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: these models are private (ADR-0015)');

  test('loads three private models from the store and draws them textured', async ({
    page,
    request,
  }) => {
    const api = String(test.info().config.metadata['apiUrl']);
    const written = await request.put(`${api}/worlds/${WORLD.id}`, { data: WORLD });
    expect(written.status(), await written.text()).toBeLessThan(300);

    /** Every file the page fetched out of the store, and how it went. */
    const storeResponses: { url: string; status: number; cors: string | undefined }[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/store/')) {
        storeResponses.push({
          url,
          status: response.status(),
          cors: response.headers()['access-control-allow-origin'],
        });
      }
    });

    await page.goto('/');
    await expect(page.getByTestId('editor-viewport-status')).toHaveText(
      /^viewport ready — (webgl2|webgpu)$/,
    );

    await page.getByTestId('menu-file').click();
    await page.getByTestId(`menu-open-${WORLD.id}`).click();
    await expect(page.getByTestId('hierarchy-zone-stage')).toContainText('Stage');
    await expect.poll(() => loadedCount(page), { timeout: 30_000 }).toBe(SUBJECTS.length);

    // The models came out of the store, not out of `assets/placeholders/`. A
    // placeholder is a grey hull box, which would pass a "is it drawing?" test
    // and fail the point of this one.
    await expect(
      page.getByTestId('editor-asset-sources'),
      storeResponses.map((each) => `${String(each.status)} ${each.url}`).join('\n'),
    ).toHaveText(`assets: ${String(SUBJECTS.length)} private, 0 placeholder`);

    for (const subject of SUBJECTS) {
      await page.getByTestId(`hierarchy-entity-${subject.entity}`).click();
      await page.keyboard.press('KeyF');

      // Witness two: the scene finished loading the file this model refers to.
      // Read after the click, because selecting is what republishes the bridge.
      await expect.poll(() => loadedTextures(page), { timeout: 20_000 }).toContain(subject.texture);

      // Framing is animated and the textures decode asynchronously; a settled
      // frame is what the pixels are read from.
      await page.waitForTimeout(1500);

      const shot = await page
        .getByTestId('editor-canvas')
        .screenshot({ path: test.info().outputPath(`${subject.entity}.png`) });
      const { sampled, colourful, brightness } = litPixels(shot);
      test.info().annotations.push({
        type: 'pixels',
        description:
          `${subject.entity} (${subject.what}): ${String(sampled)} lit pixels, ` +
          `${(colourful * 100).toFixed(1)}% coloured, mean brightness ${brightness.toFixed(0)}`,
      });

      expect(sampled, `${subject.entity}: the viewport drew nothing`).toBeGreaterThan(1000);
      if (subject.colourful) {
        // Measured on this model, both ways: 46% of its lit pixels are coloured
        // with the texture, 3.5% without it (the same shelter drawn while
        // Babylon was rejecting the image URI). Brightness does *not* separate
        // the two — 77 against 95 — so it is reported and not asserted.
        expect(
          colourful,
          `${subject.entity} is grey — the base colour texture did not arrive`,
        ).toBeGreaterThan(0.25);
      }
    }

    // Witness one: every texture request is a sibling-relative URI that Babylon
    // resolved against the GLB's own URL, and the asset server answered it with
    // the CORS header a cross-origin WebGL texture needs.
    const textureResponses = storeResponses.filter((each) => each.url.includes('/textures/'));
    expect(textureResponses.length).toBeGreaterThan(0);
    for (const response of textureResponses) {
      expect(response.status, response.url).toBe(200);
      expect(response.cors, response.url).toBe('*');
    }
  });
});
