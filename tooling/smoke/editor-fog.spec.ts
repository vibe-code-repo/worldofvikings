import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';

/**
 * Editor parity for the fog (ADR-0033, ADR-0041).
 *
 * The game decides per backdrop mesh whether it takes the scene's fog
 * (`backdropTakesFog` in `@wov/engine`, ADR-0034) and asserts the result in
 * `village-backdrop.spec.ts`. The editor used to answer that question with a
 * flat `applyFog = false` on every backdrop mesh, so an author dragging the fog
 * sliders in the Lighting panel watched the ground haze while the mountains
 * stayed dark and green — the exact picture ADR-0034 exists to prevent, shown
 * only on the side of the wire nobody was testing.
 *
 * Both apps now call the one rule. This is the witness on the editor's side,
 * read off the meshes rather than off the panel: a panel that shows the right
 * number and a viewport that draws the wrong picture is precisely the failure.
 *
 * Two shells and no village: the claim is about the rule, and the 5 273-entity
 * village would cost minutes to say the same thing.
 *
 * **Skipped without the store.** The backdrop models are private (ADR-0015), so
 * a clone without `WOV_ASSET_STORE` would measure a placeholder box.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/** The two painted shells, at the distances `village1` stands them. */
const SHELLS = [
  { id: 'range_near', prefab: 'environment-backdrop-mountains-clear', position: [0, -40, 290] },
  { id: 'range_far', prefab: 'environment-backdrop-mountains-snow', position: [0, -60, 900] },
] as const;

function world(fog: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id: 'fogparity',
    name: 'Fog Parity',
    lighting: {
      // Everything but the fog turned down to what the measurement needs: this
      // test reads a flag off a mesh, not a picture off the screen.
      sun: { direction: [-0.45, -1, -0.6], color: '#ffffff', intensity: 1.1 },
      sky: { enabled: false },
      shadows: { enabled: false },
      postProcessing: { enabled: false },
      fog,
    },
    zones: [
      {
        id: 'stage',
        name: 'Stage',
        entities: SHELLS.map((shell) => ({
          id: shell.id,
          prefab: shell.prefab,
          position: shell.position,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        })),
      },
    ],
  };
}

type WovEditorDebugWindow = Window & {
  __wovEditor?: { readonly backdrop: { readonly meshes: number; readonly fogged: number } };
};

function backdrop(page: Page): Promise<{ meshes: number; fogged: number }> {
  return page.evaluate(
    () =>
      (window as WovEditorDebugWindow).__wovEditor?.backdrop ?? {
        meshes: 0,
        fogged: 0,
      },
  );
}

test.describe('the editor hazes the painted range the way the game does', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the backdrop models are private');

  test('every backdrop mesh takes an exponential fog it still reads through', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const api = String(test.info().config.metadata['apiUrl']);
    const body = world({ enabled: true, mode: 'exp', density: 0.0005, color: '#a3afbd' });
    const written = await request.put(`${api}/worlds/fogparity`, { data: body });
    expect(written.status(), await written.text()).toBeLessThan(300);

    await page.goto('/');
    await expect(page.getByTestId('editor-viewport-status')).toHaveText(
      /^viewport ready — (webgl2|webgpu)$/,
    );
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-open-fogparity').click();
    await expect(page.getByTestId('hierarchy-zone-stage')).toContainText('Stage');

    // Both shells on screen, then the flag they carry. Polled on `meshes`
    // first, because a readout of 0 and 0 satisfies "all of them are fogged".
    await expect
      .poll(async () => (await backdrop(page)).meshes, { timeout: 90_000 })
      .toBeGreaterThanOrEqual(SHELLS.length);

    const seen = await backdrop(page);
    test.info().annotations.push({
      type: 'measurement',
      description: `${String(seen.fogged)} of ${String(seen.meshes)} backdrop meshes take the fog`,
    });
    expect(seen.fogged, 'the editor left a backdrop mesh out of the fog').toBe(seen.meshes);
  });
});
