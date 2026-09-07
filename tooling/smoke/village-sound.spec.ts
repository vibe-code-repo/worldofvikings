import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The proof that the village's sound profile reaches the audio engine, and that
 * a footstep asks the ground what it landed on (ADR-0052, ADR-0053).
 *
 * Unit tests pin what `resolveSoundProfile` answers, which placements a prefab
 * rule expands to, and what `dominantLayer` picks out of a set of weights. None
 * of them can show any of the three things that actually fail here, and each of
 * those failures is silent:
 *
 * - a browser that never gave the page an audio engine, or never unlocked it,
 *   is a village that looks perfect and makes no sound — and says so nowhere
 *   unless somebody prints it;
 * - a clip path that is right in the world file and wrong in the store loads
 *   the silent stand-in, which is indistinguishable from working;
 * - and the uv fit is the one thing here that can be *wrong* rather than
 *   absent. A probe fitted to the wrong axes still answers a layer for every
 *   point; it just answers the same one everywhere, or the neighbour's. That is
 *   a village where every footstep is gravel, which is exactly the feature not
 *   being there.
 *
 * A headless browser has no output device, so nothing here listens. The three
 * witnesses are counts and answers the page can only have if the path ran:
 *
 * 1. the zone reports a bed, its emitters and its footstep banks, with no clip
 *    failing to load;
 * 2. the splat probe reports itself *fitted* to the village tile;
 * 3. asking that probe across the tile gives **more than one** surface, and the
 *    surfaces it gives are ones the profile has banks for.
 *
 * **Skipped without the store.** The clips, the splat maps and the height field
 * are all private (ADR-0015): a clone without `WOV_ASSET_STORE` would measure a
 * silent plane and pass for the wrong reason.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/** The village square, where the braziers stand. */
const SQUARE = '?world=village1&spawn=166,150';

interface SoundSnapshot {
  readonly status: string;
  readonly ambience: boolean;
  readonly emitters: number;
  readonly banks: number;
  readonly failed: number;
  readonly surfaceMapped: boolean;
  readonly surfaceStatus: string;
}

type WovWindow = Window & {
  __wov?: {
    readonly sound: SoundSnapshot | null;
    surfaceAt(x: number, z: number): string | null;
  };
};

function readSound(page: Page): Promise<SoundSnapshot | null> {
  return page.evaluate(() => {
    const sound = (window as WovWindow).__wov?.sound;
    return sound === undefined || sound === null ? null : { ...sound };
  });
}

/**
 * The surface the probe answers at a grid of points over the whole tile.
 *
 * A grid rather than two hand-picked points: which metre of a 300 m village is
 * gravel and which is grass is authored in a painted image, and a test that
 * named two coordinates would be pinned to that painting rather than to the
 * probe. What matters is that the answer *varies*, and a grid says that without
 * caring where the paths run.
 */
function surfaceGrid(page: Page, step: number): Promise<string[]> {
  return page.evaluate((spacing) => {
    const bridge = (window as WovWindow).__wov;
    const found: string[] = [];
    if (bridge === undefined) {
      return found;
    }
    for (let x = spacing; x < 300; x += spacing) {
      for (let z = spacing; z < 300; z += spacing) {
        const surface = bridge.surfaceAt(x, z);
        if (surface !== null && surface !== '') {
          found.push(surface);
        }
      }
    }
    return found;
  }, step);
}

test.describe('the village sound', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the clips and the splat maps are private');

  test('starts a bed, places its emitters and reads footsteps off the ground', async ({ page }) => {
    // The same budget the other village tests take: where no GPU answers, this
    // is a four-million-triangle scene on a software rasteriser.
    test.setTimeout(360_000);

    const crashed: string[] = [];
    page.on('pageerror', (error) => crashed.push(String(error).slice(0, 300)));

    await page.goto(`${String(test.info().config.metadata['gameUrl'])}${SQUARE}`);
    await expect(page.getByTestId('game-world')).toContainText(/from \d+ models/, {
      timeout: 240_000,
    });
    // The sound row is the marker for this surface, and it is the last thing
    // the zone does — deliberately, so that audio never competes with models.
    await expect(page.getByTestId('game-sound')).toContainText(/emitter\(s\)/, {
      timeout: 240_000,
    });
    expect(crashed, 'the page threw').toEqual([]);

    // ------------------------------------------------------- what is playing
    // One "sound: ", not two: the engine's own status line already carries the
    // prefix, and a readout that stutters is a readout nobody trusts.
    await expect(page.getByTestId('game-sound')).toHaveText(/^sound: (?!sound)/);

    const sound = await readSound(page);
    expect(sound, 'the zone reported no sound at all').not.toBeNull();
    expect(sound?.ambience, 'the village has a bed in its world file').toBe(true);
    // Eleven braziers, two candle groups, one chimney and one forge bench.
    expect(sound?.emitters ?? 0, 'the prefab rules matched no placements').toBeGreaterThanOrEqual(
      15,
    );
    expect(sound?.banks, 'gravel, grass, wood and water').toBe(4);
    // The stand-in loads where a clip does not, so this is the count that tells
    // "the store has the clips" from "the store has one silent WAV".
    expect(sound?.failed, 'a clip did not load').toBe(0);

    // ------------------------------------------------------- what is underfoot
    expect(sound?.surfaceMapped, `splat probe: ${sound?.surfaceStatus ?? '—'}`).toBe(true);

    const surfaces = await surfaceGrid(page, 10);
    expect(surfaces.length, 'the probe answered nowhere on the tile').toBeGreaterThan(100);
    const distinct = new Set(surfaces);
    // The whole feature, in one line: a village whose every footstep is gravel
    // would pass every assertion above this one.
    expect([...distinct].sort(), 'every point on the tile answered the same surface').toEqual([
      'grass',
      'gravel',
    ]);
    // …and neither answer is a rare one: a probe that finds one grass texel in
    // four hundred is a probe that is very nearly always wrong.
    for (const surface of distinct) {
      const share = surfaces.filter((found) => found === surface).length / surfaces.length;
      expect(share, `${surface} covers almost none of the tile`).toBeGreaterThan(0.02);
    }
  });

  test('makes no sound at all under ?mute=1', async ({ page }) => {
    test.setTimeout(360_000);
    await page.goto(`${String(test.info().config.metadata['gameUrl'])}${SQUARE}&mute=1`);
    // The switch the frame measurement is taken against: no engine, no clips,
    // no probe — so a frame under `?mute=1` is the frame this game had before
    // there was any sound in it.
    await expect(page.getByTestId('game-sound')).toContainText('sound: off — ?mute=1', {
      timeout: 240_000,
    });
    expect(await readSound(page)).toBeNull();
  });
});
