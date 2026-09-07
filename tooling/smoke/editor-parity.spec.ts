/**
 * Editor parity (ADR-0033): the four things that were script-only, done through
 * the editor's own surface.
 *
 * Every claim here is checked on the *other* side of the wire. Pressing a
 * button and seeing the panel update proves the panel; what these tests want to
 * know is whether the file on disk changed, which is what the game will read
 * tomorrow. So each one drives the user interface and then reads the API back:
 * the world file for the light, the catalogue file for the collision shape, the
 * world list for the import.
 *
 * The two exceptions are the undo test — whose whole point is that nothing
 * reached the disk — and the layer reorder it follows, which is asserted in the
 * panel because the order *is* what the panel shows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { decodePng } from '../asset-pipeline/png.js';

/**
 * Mean luminance of a frame, 0 for black and 1 for white.
 *
 * The whole frame, because the frames it is given are screenshots of the
 * *canvas* and nothing else: every pixel in one is something the renderer drew
 * under the profile being measured, and there is no panel in the picture to
 * dilute the number.
 */
function meanLuminance(png: Buffer): number {
  const { width, height, channels, data } = decodePng(png);
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? red;
      const blue = data[index + 2] ?? red;
      sum += (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    }
  }
  return sum / (width * height);
}

/** Where the API under test is (see `playwright.config.ts`). */
function apiUrl(path: string): string {
  return `${String(test.info().config.metadata['apiUrl'])}${path}`;
}

/** The editor's dev bridge, for the counts a panel cannot be trusted about. */
type WovEditorDebugWindow = Window & {
  __wovEditor?: {
    readonly entityCount: number;
    readonly worldId: string;
    readonly loadedCount: number;
    readonly undoDepth: number;
  };
};

function editorEntityCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.entityCount ?? null);
}

/** How many entities show their real model rather than the stand-in cube. */
function editorLoadedCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.loadedCount ?? null);
}

function editorUndoDepth(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.undoDepth ?? null);
}

/** Opens the editor and waits for a renderer, which every panel test needs. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor-viewport-status')).toHaveText(
    /^viewport ready — (webgl2|webgpu)$/,
  );
}

async function openWorld(page: Page, worldId: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-open-${worldId}`).click();
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-save').click();
  await expect(page.getByTestId('editor-dirty')).toHaveText('saved');
}

/**
 * (1) The light of a world, changed in the panel and written to the file.
 *
 * The example world has no `lighting` block at all, which is the harder case:
 * the panel has to *create* one, and undo has to be able to get back to a world
 * that had none.
 */
test('editor sets the lighting of a world and saves it into the file', async ({
  page,
  request,
}) => {
  await openEditor(page);
  await openWorld(page, 'example');
  await expect(page.getByTestId('hierarchy-entity-barrel_001')).toBeVisible();

  await page.getByTestId('right-tab-lighting').click();
  await expect(page.getByTestId('lighting-scope-hint')).toContainText('Example World');

  // A preset is one command over the whole profile — and it opens every group,
  // because the fields it wrote now exist.
  await page.getByTestId('lighting-preset-evening').click();
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');

  // One field, typed rather than dragged, so the assertion is an exact number.
  const intensity = page.getByTestId('lighting-sun-intensity-input');
  await intensity.fill('3.75');
  await intensity.blur();

  const fogEnd = page.getByTestId('lighting-fog-end-input');
  await fogEnd.fill('250');
  await fogEnd.blur();

  await save(page);

  const saved = await request.get(apiUrl('/worlds/example'));
  expect(saved.status()).toBe(200);
  const world = await saved.json();
  expect(world.lighting.sun.intensity).toBe(3.75);
  expect(world.lighting.fog.end).toBe(250);
  // The rest of the preset went with it — a preset writes a whole look, not one
  // field (ADR-0024).
  expect(world.lighting.shadows.mapSize).toBe(2048);
  expect(world.lighting.postProcessing.toneMapping).toBe('aces');
});

/**
 * (2) The order of the terrain layers, changed and taken back.
 *
 * Order is not decoration: the splat map's colour channels weight the layers in
 * exactly this order, so moving a layer up changes which channel paints it
 * (ADR-0020). The world is seeded through the API rather than built by hand in
 * the panel, because what is under test is the *reorder and its undo*, not a
 * way of typing six texture paths.
 */
test('editor reorders the terrain layers of a zone, and one undo puts them back', async ({
  page,
  request,
}) => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/worlds/village-terrain.json'), 'utf8'),
  );
  const seeded = await request.put(apiUrl(`/worlds/${String(fixture.id)}`), { data: fixture });
  expect(seeded.status()).toBeLessThan(300);

  await openEditor(page);
  await openWorld(page, String(fixture.id));

  await page.getByTestId('right-tab-zone').click();
  const order = page.getByTestId('zone-terrain-layer-order');
  const before = (await order.textContent()) ?? '';
  const layers = before.split(' | ');
  expect(layers.length).toBeGreaterThan(1);

  await page.getByTestId('terrain-layers-0-down').click();
  const swapped = [layers[1], layers[0], ...layers.slice(2)].join(' | ');
  await expect(order).toHaveText(swapped);
  await expect(page.getByTestId('editor-dirty')).toHaveText('unsaved changes');

  // The file is untouched until somebody saves — the reorder is a document edit
  // like any other.
  const untouched = await (await request.get(apiUrl(`/worlds/${String(fixture.id)}`))).json();
  expect(untouched.zones[0].terrain.layers[0].texture).toBe(layers[0]);

  await page.keyboard.press('Control+z');
  await expect(order).toHaveText(before);
});

/**
 * (2b) A ground texture picked from the store, not typed.
 *
 * The panel does not decide which fields are asset paths — the schema says so
 * (`assetPathOf` in `@wov/world-schema`), `describeFields` carries it, and this
 * is where that ends up: the layer's texture and the splat maps are text fields
 * with the manifest's own images attached, and the height field with its
 * terrain models. The test asserts the *list*, because a picker with nothing in
 * it looks exactly like a text box.
 */
test('editor offers the asset store for a terrain path, and takes the choice', async ({
  page,
  request,
}) => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/worlds/village-terrain.json'), 'utf8'),
  ) as { id: string };
  const worldId = `${fixture.id}-picker`;
  const seeded = await request.put(apiUrl(`/worlds/${worldId}`), {
    data: { ...fixture, id: worldId, name: 'Terrain Picker Fixture' },
  });
  expect(seeded.status()).toBeLessThan(300);

  await openEditor(page);
  await openWorld(page, worldId);
  await page.getByTestId('right-tab-zone').click();

  // The manifest is read the first time this tab is opened, not on start-up.
  await expect(page.getByTestId('zone-terrain-catalog-hint')).toContainText(
    /\d+ height field\(s\) and \d+ texture\(s\)/,
  );

  // Every path field in the block is a picker, and each one offers its own
  // kind: terrain models for the height field, images for a texture.
  const values = (testId: string): Promise<string[]> =>
    page
      .getByTestId(testId)
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));

  const heightFields = await values('terrain-heightField-options');
  expect(heightFields).toContain('terrain/terrain-village1-257.glb');
  expect(heightFields.every((path) => path.endsWith('.glb'))).toBe(true);

  const textures = await values('terrain-layers-0-texture-options');
  expect(textures).toContain('textures/terrain-moss.png');
  expect(textures.every((path) => /\.(png|jpg|jpeg)$/.test(path))).toBe(true);
  // The splat maps are paths too, and they used to be the field this panel
  // forgot: a scalar list entry was drawn as a bare text box.
  expect(await values('terrain-splat-0-options')).toEqual(textures);

  // And choosing one is an ordinary edit: the document takes it and the panel
  // shows it. A texture the fixture does not already use, so the assertion
  // cannot pass by accident.
  const order = page.getByTestId('zone-terrain-layer-order');
  const before = (await order.textContent()) ?? '';
  const chosen = textures.find((path) => !before.includes(path));
  expect(chosen).toBeDefined();
  await page.getByTestId('terrain-layers-0-texture-input').fill(String(chosen));
  await expect(order).toHaveText([String(chosen), ...before.split(' | ').slice(1)].join(' | '));

  await save(page);
  const saved = await (await request.get(apiUrl(`/worlds/${worldId}`))).json();
  expect(saved.zones[0].terrain.layers[0].texture).toBe(chosen);
});

/**
 * (3) A prefab's collision shape, corrected in the editor and written to a
 * catalogue file.
 *
 * The prefab comes from the *generated* catalogue, so the correction must not
 * land there: `generate:prefabs` rewrites that file whole, and a shape saved
 * into it would be reverted with no error and no diff. It goes into
 * `overrides.json`, which the API applies last (ADR-0033).
 */
test('editor corrects a collision shape into the overrides catalogue', async ({
  page,
  request,
}) => {
  const prefabId = 'environment-sm-item-bag-large';

  await openEditor(page);
  await page.getByTestId('assets-search').fill('Bag Large');
  await page.getByTestId(`asset-${prefabId}`).click();

  await page.getByTestId('right-tab-prefab').click();
  await expect(page.getByTestId('prefab-inspector-id')).toHaveText(prefabId);
  await expect(page.getByTestId('prefab-inspector-catalog')).toHaveText('imported');
  // The panel says where the correction will go before it is made.
  await expect(page.getByTestId('prefab-inspector-target')).toHaveText('saves into overrides.json');

  await page.getByTestId('prefab-collision-kind-input').selectOption('hull');
  await page.getByTestId('prefab-inspector-save').click();
  await expect(page.getByTestId('editor-notice')).toContainText('overrides.json');

  // The file, not the panel.
  const overrides = await request.get(apiUrl('/prefabs/overrides'));
  expect(overrides.status()).toBe(200);
  const catalog = await overrides.json();
  expect(catalog.id).toBe('overrides');
  const entry = catalog.prefabs.find((each: { id: string }) => each.id === prefabId);
  expect(entry.collision).toEqual({ kind: 'hull' });

  // And the merged catalogue the game reads now answers with the correction,
  // from the overlay rather than from the generated file.
  const merged = await (await request.get(apiUrl('/prefabs'))).json();
  const shown = merged.prefabs.find((each: { id: string }) => each.id === prefabId);
  expect(shown.collision).toEqual({ kind: 'hull' });
  expect(shown.catalog).toBe('overrides');
  // The generated catalogue was not touched.
  const generated = await (await request.get(apiUrl('/prefabs/imported'))).json();
  const original = generated.prefabs.find((each: { id: string }) => each.id === prefabId);
  expect(original.collision).toEqual({ kind: 'box' });
});

/**
 * (4) The scene import, from the editor's own menu.
 *
 * The bundle is the committed 752-byte fixture, so this runs on a clone with no
 * private asset store — and it is the real importer: the same
 * `importSceneBundle` `pnpm import:scene` calls, matching bundle node names
 * against the same prefab catalogues (ADR-0021, ADR-0033).
 */
test('editor imports a scene bundle from the World menu', async ({ page, request }) => {
  await openEditor(page);

  await page.getByTestId('menu-world').click();
  await page.getByTestId('menu-world-import-scene').click();
  await expect(page.getByTestId('content-action-dialog')).toBeVisible();

  await page.getByTestId('import-scene-file').fill('village-fixture.glb');
  await page.getByTestId('import-scene-world').fill('parity-import');
  await page.getByTestId('import-scene-name').fill('Parity Import');
  await page.getByTestId('content-action-run').click();

  // The command's own report, not a "done".
  const report = page.getByTestId('content-action-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('"entities": 2');
  await expect(page.getByTestId('content-action-error')).toHaveCount(0);

  const imported = await request.get(apiUrl('/worlds/parity-import'));
  expect(imported.status()).toBe(200);
  const world = await imported.json();
  expect(world.zones[0].entities).toHaveLength(2);
  // The generated catalogue is present here, so the bundle's unambiguous name
  // is the one that matched — see `tooling/fixtures/make-scene-bundle.ts`.
  expect(world.zones[0].entities[0].prefab).toBe('environment-sm-item-bag-large');

  // And the world the import wrote is one the editor can open.
  await page.getByTestId('content-action-close').click();
  await openWorld(page, 'parity-import');
  await expect(page.getByTestId('editor-world-name')).toHaveText('Parity Import');
  await expect.poll(() => editorEntityCount(page)).toBe(2);
});

/**
 * (4b) A re-import keeps the work the bundle never described (ADR-0036).
 *
 * The failure this pins down had no symptom: `pnpm import:scene` rewrote a
 * world file from the bundle and took every scattered plant with it — 4 032 of
 * them in `village1` — with nothing failing and nothing logged, so the only
 * defence was a document telling the operator to re-run three commands.
 *
 * Everything here goes through the editor's own surface, because that is the
 * parity claim: the same `importSceneBundle`, reached from the **World** menu,
 * has to keep a field the **Scatter** panel planted. The check is on the file
 * the API serves, not on the panel — the panel could be showing a document
 * nobody wrote.
 */
test('a re-import from the World menu keeps a scattered field', async ({ page, request }) => {
  const worldId = 'parity-keep-scatter';

  async function importFixture(): Promise<void> {
    await page.getByTestId('menu-world').click();
    await page.getByTestId('menu-world-import-scene').click();
    await expect(page.getByTestId('content-action-dialog')).toBeVisible();
    await page.getByTestId('import-scene-file').fill('village-fixture.glb');
    await page.getByTestId('import-scene-world').fill(worldId);
    await page.getByTestId('import-scene-name').fill('Parity Keep Scatter');
    await page.getByTestId('content-action-run').click();
    await expect(page.getByTestId('content-action-report')).toBeVisible();
    await expect(page.getByTestId('content-action-error')).toHaveCount(0);
  }

  await openEditor(page);
  await importFixture();
  await page.getByTestId('content-action-close').click();

  // A field of barrels over the two entities the bundle placed.
  await openWorld(page, worldId);
  await expect.poll(() => editorEntityCount(page)).toBe(2);
  await page.getByTestId('assets-search').fill('Barrel');
  await page.getByTestId('asset-barrel-01').click();
  await page.getByTestId('scatter-add-prefab').click();
  for (const [field, value] of [
    ['scatter-x0', '0'],
    ['scatter-z0', '0'],
    ['scatter-x1', '20'],
    ['scatter-z1', '20'],
  ] as const) {
    await page.getByTestId(field).fill(value);
  }
  await page.getByTestId('scatter-density').fill('5');
  await page.getByTestId('scatter-seed').fill('3');
  await page.getByTestId('scatter-run').click();
  await expect.poll(() => editorEntityCount(page)).toBe(22);
  await save(page);

  // The same bundle again, into the same world.
  await importFixture();
  // The report says what it kept, so an operator reads it rather than assumes it.
  await expect(page.getByTestId('content-action-report')).toContainText('"entitiesCarried"');
  await expect(page.getByTestId('content-action-report')).toContainText('"entities": 20');
  await expect(page.getByTestId('content-action-report')).toContainText('"entitiesDropped": 0');
  await page.getByTestId('content-action-close').click();

  const written = await request.get(apiUrl(`/worlds/${worldId}`));
  expect(written.status()).toBe(200);
  const world = await written.json();
  const ids: string[] = world.zones[0].entities.map((each: { id: string }) => each.id);
  expect(ids).toHaveLength(22);
  // The bundle's own two, re-minted by this run and standing first.
  expect(ids.slice(0, 2).every((id) => /_\d{4}$/.test(id))).toBe(true);
  // And the whole field behind them, in the order the previous file had it.
  expect(ids.slice(2)).toEqual(
    Array.from({ length: 20 }, (_, index) => `barrel-01_s3_${String(index + 1).padStart(4, '0')}`),
  );

  // A third import changes nothing at all — the property the village proof is.
  await importFixture();
  await page.getByTestId('content-action-close').click();
  const again = await request.get(apiUrl(`/worlds/${worldId}`));
  expect(await again.json()).toEqual(world);
});

/**
 * (5) The viewport follows the panel.
 *
 * The other four tests prove that a change reaches the file. This one proves
 * the half an author actually works with: that pressing a preset changes the
 * *picture*, immediately, without a save and without a reload. It is the reason
 * the panel produces commands instead of keeping its own copy — `EditorViewport`
 * relights whenever the open world's profile differs from the one it last used
 * (ADR-0018, ADR-0024).
 *
 * Measured, not looked at: three screenshots of the *canvas* under three
 * profiles, compared by mean luminance. Evening is a low warm sun under a
 * gradient sky with a graded frame; the flat preset has no sky, no shadow map
 * and no grade, and the difference between the two is a number.
 *
 * **On the example world, not the village**, and that is the whole reason this
 * test is reliable. The village keeps arriving for a minute after its entity
 * count lands — 140 models decoding, stand-in cubes turning into barrels — and
 * every one of them changes the frame on its own. Measured while writing this:
 * an evening baseline read 0.180, and the *same* evening light read 0.129
 * twenty seconds later, a drift larger than the effect. The example world is
 * one barrel over a grid: once its model is up, nothing moves unless the panel
 * moves it, so a difference in the picture can only have come from the panel.
 *
 * The claim is about the panel and the viewport, and it does not get truer on a
 * bigger scene. What the village proves — that it renders at all, under the
 * light its file asks for — is `village-light.spec.ts` and `lighting.spec.ts`.
 */
test.describe('live preview', () => {
  // Smaller than the default, because every number below is a proportion over a
  // whole frame and a smaller frame measures the same thing for a fraction of
  // the fill cost — but a plausible editor window, not a postage stamp: the
  // work area has four panels beside the viewport and needs room for them.
  test.use({ viewport: { width: 960, height: 640 } });

  test('editor relights the viewport while the lighting panel is used', async ({ page }) => {
    await openEditor(page);
    await openWorld(page, 'example');
    // Its one model on screen, not just its one row in the hierarchy: a
    // stand-in cube and a barrel are not the same picture.
    await expect.poll(() => editorLoadedCount(page), { timeout: 60_000 }).toBe(1);

    // Put the barrel in the picture — a lit object, not only the grid and the
    // sky — and then drop the selection again, because a selection outline is
    // the same bright colour under every light and would only dilute the
    // measurement.
    await page.getByTestId('hierarchy-entity-barrel_001').click();
    await page.keyboard.press('KeyF');
    await page.keyboard.press('Escape');

    // The panel is open in every frame, so the screenshots are also a record of
    // what the author sees while the light changes.
    await page.getByTestId('right-tab-lighting').click();
    await expect(page.getByTestId('lighting-fields')).toBeVisible();

    const canvas = page.getByTestId('editor-canvas');
    const photograph = async (name: string): Promise<number> =>
      meanLuminance(await canvas.screenshot({ path: test.info().outputPath(`${name}.png`) }));

    /**
     * The picture once it has stopped changing by itself.
     *
     * Shots a second apart until two of them agree to within a thousandth,
     * which is far below the effect being measured and above the noise a still
     * frame carries — the post-processing chain and the shadow map both need a
     * few frames after a relight. The last shot is the one kept, so the file on
     * disk is the frame the number came from.
     */
    const settled = async (name: string): Promise<number> => {
      let previous = await photograph(name);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await page.waitForTimeout(1_000);
        const current = await photograph(name);
        if (Math.abs(current - previous) < 0.001) {
          return current;
        }
        previous = current;
      }
      throw new Error(`the viewport never stopped changing (last ${previous.toFixed(3)})`);
    };

    // The example world has no lighting block of its own, so the baseline is a
    // preset too: the comparison is between two profiles, not between a profile
    // and whatever the renderer falls back to.
    await page.getByTestId('lighting-preset-evening').click();
    const evening = await settled('editor-example-evening');

    await page.getByTestId('lighting-preset-flat').click();
    const flat = await settled('editor-example-flat');

    const change = Math.abs(flat - evening);
    test.info().annotations.push({
      type: 'measurement',
      description: `mean luminance ${evening.toFixed(3)} evening against ${flat.toFixed(3)} flat`,
    });
    expect(change).toBeGreaterThan(0.02);

    // And one Ctrl+Z is the old look back — a preset is one command, and the
    // history says so as plainly as the picture does.
    expect(await editorUndoDepth(page)).toBe(2);
    await page.keyboard.press('Control+z');
    await expect.poll(() => editorUndoDepth(page)).toBe(1);
    const back = await settled('editor-example-undone');
    test.info().annotations.push({
      type: 'measurement',
      description: `mean luminance ${back.toFixed(3)} after one undo`,
    });
    expect(Math.abs(back - evening)).toBeLessThan(change / 4);
  });
});
