import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import { readGlb } from '@wov/content-build';
import { heightAtOnTile, readHeightGrid } from '../asset-pipeline/height-field.js';

/**
 * Where the three parts of the village's look meet (ADR-0024, ADR-0025, ADR-0026).
 *
 * Each of them has its own proof: the shadow map reaches the pixels
 * (`lighting.spec.ts`), the scatter tool plants a field (`smoke.spec.ts`), the
 * village stops the player (`smoke.spec.ts`). None of those says what happens
 * when all three are in one frame, and that is where the cheap mistakes live:
 *
 * - a field of thousands of thin instances is drawn into the shadow map a
 *   second time every frame, and every tuft shadows the tufts around it;
 * - or the fix for that is a blunt exclusion, and the grass stops taking the
 *   shadow of the house it stands beside — which looks like grass painted on
 *   top of the picture;
 * - or the vegetation the scatter planted collides, and a meadow becomes a
 *   wall the player cannot walk through.
 *
 * All three fail *silently*: nothing throws, nothing is logged, and every unit
 * test still passes. So this is measured on pixels and on the client's own
 * counters, in a world small enough to load in seconds.
 *
 * **Skipped without the store.** The grass and the wall are private models
 * (ADR-0015); a clone without `WOV_ASSET_STORE` would measure an empty plane.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;
const store = (process.env['WOV_ASSET_STORE'] ?? '').trim();

/** The ground the fixture stands on: the village tile, without the village. */
const TERRAIN = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', 'fixtures', 'worlds', 'village-terrain.json'),
      'utf8',
    ),
  ) as { zones: { terrain: { heightField: string; position: number[]; size: number[] } }[] }
).zones[0]!.terrain;

/**
 * A wall, and a field of grass in and out of its shadow.
 *
 * The sun points along +x with no z in it, so the wall's shadow falls across
 * the near half of the field and misses the far half. That is what makes a
 * single frame enough: the lit grass and the shaded grass are the same model,
 * the same instance buffer and the same material, side by side.
 */
const WALL_X = 150;
const WALL_Z = 150;

const LIGHTING = {
  sun: { direction: [1, -0.5, 0], color: '#ffd2a1', intensity: 2.3 },
  ambient: { skyColor: '#8fb3d8', groundColor: '#4a4032', intensity: 0.62 },
  sky: { enabled: true },
  // Off, both of them: this test is about which pixels the shadow map darkens,
  // and fog and a grade would put a second thing between the sun and the answer.
  fog: { enabled: false },
  shadows: { enabled: true, mapSize: 2048, distance: 60, darkness: 0.25 },
  postProcessing: { enabled: false },
};

function fixtureWorlds(): { field: unknown; wallOnly: unknown } {
  const glb = readGlb(readFileSync(join(store, TERRAIN.heightField)));
  const grid = readHeightGrid(glb, TERRAIN.heightField);
  const groundAt = (x: number, z: number): number =>
    (TERRAIN.position[1] ?? 0) +
    heightAtOnTile(
      grid,
      x,
      z,
      [TERRAIN.position[0] ?? 0, TERRAIN.position[1] ?? 0, TERRAIN.position[2] ?? 0],
      [TERRAIN.size[0] ?? 0, TERRAIN.size[1] ?? 0],
    );

  const wall = [
    {
      id: 'wall',
      prefab: 'environment-sm-prop-spike-wall-03',
      position: [WALL_X, groundAt(WALL_X, WALL_Z), WALL_Z],
      rotation: [0, Math.PI / 2, 0],
      scale: [1, 2, 1],
    },
  ];
  const grass = Array.from({ length: 600 }, (_unused, index) => {
    const x = WALL_X + 1 + Math.floor(index / 20) * 0.4;
    const z = WALL_Z - 4 + (index % 20) * 0.4;
    return {
      id: `grass-${String(index)}`,
      prefab: 'vegetation-grass-short-clump-1',
      position: [x, groundAt(x, z), z],
      scale: [2.5, 2.5, 2.5],
    };
  });

  const world = (id: string, entities: unknown[]): unknown => ({
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id,
    name: id,
    lighting: LIGHTING,
    zones: [{ id: 'stage', name: 'Stage', entities, terrain: TERRAIN }],
  });
  return {
    field: world('grassfield', [...wall, ...grass]),
    wallOnly: world('wallonly', wall),
  };
}

interface Reported {
  readonly shadowCasters: number;
  readonly passable: number;
  readonly bodies: number;
  readonly undeclared: number;
  readonly worldLine: string;
}

type WovWindow = Window & {
  __wov?: {
    readonly lighting: { readonly shadowCasters: number } | null;
    readonly collision: {
      readonly bodies: number;
      readonly passable: number;
      readonly undeclared: number;
    } | null;
  };
};

/** Every pixel of a canvas, as one flat RGBA array read out of the page. */
async function canvasPixels(page: Page): Promise<Uint8ClampedArray> {
  const values = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) {
      throw new Error('the game has no canvas');
    }
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (context === null) {
      throw new Error('no 2d context to copy the frame into');
    }
    context.drawImage(canvas, 0, 0);
    return [...context.getImageData(0, 0, copy.width, copy.height).data];
  });
  return Uint8ClampedArray.from(values);
}

function luminance(rgba: Uint8ClampedArray, at: number): number {
  return 0.2126 * (rgba[at] ?? 0) + 0.7152 * (rgba[at + 1] ?? 0) + 0.0722 * (rgba[at + 2] ?? 0);
}

test.describe('grass, shadow and collision in one frame', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the grass and the wall are private');

  test('scattered grass takes shadow, casts none, and stops nobody', async ({
    context,
    request,
  }) => {
    // Three loads of a two-model world; generous because the terrain tile is
    // 131 072 triangles and decodes before anything can be measured.
    test.setTimeout(300_000);
    const api = String(test.info().config.metadata['apiUrl']);
    const gameUrl = String(test.info().config.metadata['gameUrl']);
    const { field, wallOnly } = fixtureWorlds();

    for (const [id, world] of [
      ['grassfield', field],
      ['wallonly', wallOnly],
    ] as const) {
      const written = await request.put(`${api}/worlds/${id}`, { data: world });
      expect(written.status(), await written.text()).toBeLessThan(300);
    }

    const reported = new Map<string, Reported>();

    /** Opens one world on a page of its own and reads its frame and counters. */
    const photograph = async (query: string, name: string): Promise<Uint8ClampedArray> => {
      const page = await context.newPage();
      try {
        await page.goto(`${gameUrl}${query}`);
        await expect(page.getByTestId('game-world')).toContainText(/from \d+ models/, {
          timeout: 180_000,
        });
        // The thin-instance buffers upload and the camera eases in after the
        // count lands; the pixels are read from a settled frame.
        await page.waitForTimeout(6_000);
        const counters = await page.evaluate(() => {
          const bridge = (window as WovWindow).__wov;
          return {
            shadowCasters: bridge?.lighting?.shadowCasters ?? -1,
            bodies: bridge?.collision?.bodies ?? -1,
            passable: bridge?.collision?.passable ?? -1,
            undeclared: bridge?.collision?.undeclared ?? -1,
          };
        });
        reported.set(name, {
          ...counters,
          worldLine: (await page.getByTestId('game-world').textContent()) ?? '',
        });
        await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
        return await canvasPixels(page);
      } finally {
        await page.close();
      }
    };

    const spawn = `${String(WALL_X + 6)},${String(WALL_Z - 7)}`;
    const lit = await photograph(`?world=grassfield&spawn=${spawn}`, 'grass-shadowed');
    const unshadowed = await photograph(
      `?world=grassfield&spawn=${spawn}&shadows=off`,
      'grass-unshadowed',
    );
    await photograph(`?world=wallonly&spawn=${spawn}`, 'wall-only');

    const withGrass = reported.get('grass-shadowed');
    const withoutGrass = reported.get('wall-only');

    // ---------------------------------------------------------- casts nothing
    //
    // Exact, not approximate: the same scene with and without 600 tufts has the
    // same number of casters in the shadow map, so not one of them is drawn
    // into it. A count that merely *rose a little* would be a field that casts
    // and a test that shrugged.
    expect(withGrass?.worldLine).toContain('600 of them thin-instanced vegetation');
    expect(withGrass?.worldLine).toContain('taking shadow without casting');
    expect(withGrass?.shadowCasters, 'the 600 tufts of grass were drawn into the shadow map').toBe(
      withoutGrass?.shadowCasters,
    );
    expect(withoutGrass?.shadowCasters, 'the wall casts nothing either').toBeGreaterThan(0);

    // --------------------------------------------------------- takes it anyway
    //
    // "Grass" is decided on the frame *without* shadows, so what is being
    // measured cannot change which pixels are counted. Green-dominant is enough
    // to tell a tuft from the wall, the ground and the sky in this fixture.
    let grass = 0;
    let darker = 0;
    let brighter = 0;
    for (let at = 0; at < unshadowed.length; at += 4) {
      const red = unshadowed[at] ?? 0;
      const green = unshadowed[at + 1] ?? 0;
      const blue = unshadowed[at + 2] ?? 0;
      if (!(green > red * 1.25 && green > blue * 1.5 && green > 45)) {
        continue;
      }
      grass += 1;
      const difference = luminance(lit, at) - luminance(unshadowed, at);
      if (difference < -8) {
        darker += 1;
      } else if (difference > 8) {
        brighter += 1;
      }
    }

    test.info().annotations.push({
      type: 'pixels',
      description:
        `${String(grass)} grass pixels, ${((darker / grass) * 100).toFixed(1)}% darkened by ` +
        `the wall's shadow, ${String(brighter)} brightened; casters ` +
        `${String(withGrass?.shadowCasters)} with the field and ` +
        `${String(withoutGrass?.shadowCasters)} without it`,
    });

    expect(grass, 'no grass in the frame to measure').toBeGreaterThan(2_000);
    // Far below the ~38 % measured, because this is the check that shading
    // reaches the tufts at all — not a check on where the wall happens to fall.
    expect(darker / grass, 'the wall shadowed no grass').toBeGreaterThan(0.05);
    // Shade can only take light away. A tuft that ignored the shadow map would
    // show zero of both; one lit *by* it would show this.
    expect(brighter, 'the shadow map made grass brighter').toBeLessThan(grass * 0.01);

    // ------------------------------------------------------- and stops nobody
    //
    // The scatter tool plants ordinary entities (ADR-0025) and every entity is
    // asked what it collides against (ADR-0026). Grass answers "nothing" — so a
    // field of it must add bodies to the world at a rate of exactly zero.
    expect(withGrass?.passable, 'the grass field is not walk-through').toBe(600);
    expect(withGrass?.undeclared, 'something in the fixture has no collision answer').toBe(0);
    expect(withGrass?.bodies, 'the grass field put bodies in the physics world').toBe(
      withoutGrass?.bodies,
    );
  });
});
