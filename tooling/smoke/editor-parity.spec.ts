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

/** Where the API under test is (see `playwright.config.ts`). */
function apiUrl(path: string): string {
  return `${String(test.info().config.metadata['apiUrl'])}${path}`;
}

/** The editor's dev bridge, for the counts a panel cannot be trusted about. */
type WovEditorDebugWindow = Window & {
  __wovEditor?: { readonly entityCount: number; readonly worldId: string };
};

function editorEntityCount(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as WovEditorDebugWindow).__wovEditor?.entityCount ?? null);
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
