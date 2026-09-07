import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The player walks along the village's walls instead of sticking to them
 * (ADR-0036).
 *
 * The unit tests prove the solver: a move that meets a face keeps the part of
 * itself that ran along that face. They cannot prove that the *village* is
 * walkable, because the shape of a village is not a shape a test can write
 * down — it is 1145 collision bodies at angles nobody chose on purpose, and
 * every failure this file exists for looked exactly like a working game from
 * the outside. So these four walks are measured against the collision geometry
 * the client actually built.
 *
 * The numbers in the comments are what the same walks measured on the commit
 * before ADR-0036, on this machine, with the private asset store mounted. They
 * are there so a threshold can be read as "further than it used to get" rather
 * than as a number somebody liked.
 *
 * **Skipped without the store.** The village's models are private (ADR-0015);
 * a clone without `WOV_ASSET_STORE` would walk around an empty plane and pass
 * every one of these for the wrong reason.
 */
const storeConfigured = (process.env['WOV_ASSET_STORE'] ?? '').trim().length > 0;

/** Half the player's body, in metres — `DEFAULT_MOVEMENT_TUNING.radius`. */
const BODY_RADIUS = 0.4;

interface RayHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly distance: number;
}

interface PlayerReadout {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly contactDistance: number;
}

type WovDebugWindow = Window & {
  __wov?: {
    readonly collision: unknown;
    readonly player: PlayerReadout | null;
    rayHit(
      from: readonly [number, number, number],
      to: readonly [number, number, number],
    ): RayHit | null;
  };
};

/** Where the rendered player stands, and what it last ran into. */
function readPlayer(page: Page): Promise<PlayerReadout> {
  return page.evaluate(() => {
    const at = (window as WovDebugWindow).__wov?.player;
    return at === null || at === undefined
      ? {
          x: 0,
          y: 0,
          z: 0,
          normalX: 0,
          normalY: 0,
          normalZ: 0,
          contactDistance: 0,
        }
      : {
          x: at.x,
          y: at.y,
          z: at.z,
          normalX: at.normalX,
          normalY: at.normalY,
          normalZ: at.normalZ,
          contactDistance: at.contactDistance,
        };
  });
}

/**
 * Opens the village at a spawn point and waits until it is finished arriving.
 *
 * The collision report is the last thing the client publishes, so a bridge that
 * has one is a client whose bodies are built — which is the only state in which
 * a walk measures anything.
 */
async function standAt(page: Page, query: string): Promise<PlayerReadout> {
  await page.goto(`${String(test.info().config.metadata['gameUrl'])}/?world=village1&${query}`);
  await expect(page.getByTestId('game-collision')).toContainText(/\d+ bodies from \d+ shapes/, {
    timeout: 240_000,
  });
  await page.waitForFunction(() => (window as WovDebugWindow).__wov?.player != null, undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(1_500);
  return readPlayer(page);
}

/**
 * Holds a key and reports the **path** walked, not the displacement.
 *
 * The path is the claim under test: a player who slides along a wall and comes
 * back has still walked, and a player who is wedged has not. Sampled ten times
 * a second, which is far coarser than the 60 Hz simulation and therefore
 * under-reports rather than flatters.
 */
async function hold(page: Page, key: string, seconds: number): Promise<number> {
  let last = await readPlayer(page);
  let path = 0;
  await page.keyboard.down(key);
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = await readPlayer(page);
    path += Math.hypot(now.x - last.x, now.z - last.z);
    last = now;
  }
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
  return path;
}

/** How far the collision geometry is from the player in a direction, at knee height. */
function reach(
  page: Page,
  direction: readonly [number, number],
  metres: number,
): Promise<number | null> {
  return page.evaluate(
    ([dx, dz, far]) => {
      const bridge = (window as WovDebugWindow).__wov;
      const at = bridge?.player;
      if (bridge === undefined || at === null || at === undefined) {
        return null;
      }
      const hit = bridge.rayHit(
        [at.x, at.y + 0.5, at.z],
        [at.x + (dx ?? 0) * (far ?? 0), at.y + 0.5, at.z + (dz ?? 0) * (far ?? 0)],
      );
      return hit === null ? null : hit.distance;
    },
    [direction[0], direction[1], metres],
  );
}

test.describe('walking through the village', () => {
  test.skip(!storeConfigured, 'needs WOV_ASSET_STORE: the village models are private');
  test.setTimeout(360_000);

  /**
   * A wall the village did not build square with the axes.
   *
   * This is the case the old solver could do nothing with: it gave up the whole
   * move, then tried one axis and then the other, and against a wall at neither
   * of those angles all three attempts run into the same wall.
   *
   * Measured over eight seconds on the commit before ADR-0036: 3.12 m, all of it
   * in the first second and then nothing at all. With sliding: 12.71 m, still
   * walking when the key was let go.
   */
  test('walks along an angled wall instead of sticking to it', async ({ page }) => {
    const from = await standAt(page, 'spawn=152,170');
    const path = await hold(page, 'd', 6);
    const to = await readPlayer(page);

    expect(path, 'the player stuck to the wall instead of walking along it').toBeGreaterThan(8);
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(6);
  });

  /**
   * Whatever the player walked into, walking back out of it works.
   *
   * The failure this replaces was not "the player stops at a wall" — that is
   * correct — but "the player stops and can no longer get away", back the way it
   * came included: the probes are cast from around the body, so once the body is
   * touching a wall some of them start inside it, and a ray that starts inside
   * geometry reports a hit whichever way it is aimed.
   *
   * Two walls make a nook a few metres north of this spawn. Pressed into it for
   * four seconds and then reversed, the commit before ADR-0036 covered 7.43 m in
   * eight seconds and stopped after two; with the approach rule, 31.10 m.
   */
  test('always backs out of what it walked into', async ({ page }) => {
    await standAt(page, 'spawn=166,150');
    await hold(page, 'w', 4);
    const wedged = await readPlayer(page);

    const back = await hold(page, 's', 6);
    const out = await readPlayer(page);

    expect(back, 'the player could not get away from what it walked into').toBeGreaterThan(15);
    expect(Math.hypot(out.x - wedged.x, out.z - wedged.z)).toBeGreaterThan(10);
  });

  /**
   * Sliding must not become sinking.
   *
   * The claim is exact rather than approximate: the probes reach one body radius
   * past where the player is going, so a player stopped by a wall stands one
   * radius in front of its face — and the dev bridge says *which* face it was,
   * which is the one thing a position on its own cannot say, and the readout the
   * whole idea of sliding has to be checked against.
   */
  test('stops one radius short of a wall and reports the face that stopped it', async ({
    page,
  }) => {
    // A stone wall runs across the path at z ~ 164, on open level ground.
    await standAt(page, 'spawn=171.95,161.5');
    await hold(page, 'w', 6);
    const stopped = await readPlayer(page);

    // The wall faces the player: a normal in the ground plane, pointing back
    // down the way they walked.
    const flat = Math.hypot(stopped.normalX, stopped.normalZ);
    expect(flat, 'no face was reported').toBeGreaterThan(0.9);
    expect(stopped.normalZ / flat, 'the reported face is not the wall in front').toBeLessThan(-0.9);

    // And the player is outside it, by the clearance the probes keep.
    const ahead = await reach(page, [-stopped.normalX / flat, -stopped.normalZ / flat], 3);
    expect(ahead, 'the wall the player was stopped by is not in front of them').not.toBeNull();
    expect(ahead ?? 0).toBeGreaterThan(BODY_RADIUS - 0.1);
    expect(ahead ?? 0).toBeLessThan(BODY_RADIUS + 0.1);
  });

  /**
   * Sliding must not become grinding.
   *
   * A corner is two faces whose free directions contradict each other, and the
   * temptation is to resolve it into one of them — which walks the body into the
   * other wall a fraction of a millimetre a step, invisibly, until it is inside
   * a house. So the nook the second test reverses out of is leaned on for four
   * more seconds instead, and nothing may move.
   */
  test('holds still in a corner instead of grinding into one of its walls', async ({ page }) => {
    await standAt(page, 'spawn=166,150');
    await hold(page, 'w', 4);
    const wedged = await readPlayer(page);

    const further = await hold(page, 'w', 4);
    const settled = await readPlayer(page);

    expect(further, 'the player kept moving in a corner that should hold it').toBeLessThan(0.5);
    expect(Math.hypot(settled.x - wedged.x, settled.z - wedged.z)).toBeLessThan(0.5);
  });
});
