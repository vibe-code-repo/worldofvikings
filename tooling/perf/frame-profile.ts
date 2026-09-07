/**
 * The frame-cost measuring rig (`pnpm perf:frame`).
 *
 * It exists because every performance claim in this repository has to be
 * reproducible by someone else, and a number typed into a commit message from a
 * browser tab is not. This starts the same three servers a player would talk
 * to, opens a named view from `views.ts`, waits until the village is *finished*
 * arriving, and then measures four things over the same window:
 *
 * 1. the mean scene-render time of the frames in that window — not the running
 *    average the HUD shows, which is dominated by the ten seconds of loading
 *    that came first (see `windowMean`);
 * 2. draw calls, active meshes and triangles, off Babylon's own counters;
 * 3. a CDP CPU profile, aggregated by function into self and inclusive time;
 * 4. the canvas as raw RGBA, so the next run can prove the picture did not
 *    change (`pixels.ts`).
 *
 * **Why the built bundles and not the dev server.** Vite's dev server serves
 * every Babylon submodule as its own request and its own module record; the
 * built bundle is one file with the tree shaken. The two do not have the same
 * frame cost and only one of them is what a player runs.
 *
 * **Why its own asset store copy.** The measurement reads a few hundred
 * megabytes of models over HTTP for ten seconds; pointing it at the store a
 * developer is importing into would make the measurement depend on what
 * somebody else is doing. `WOV_ASSET_STORE` says which copy.
 *
 * ```bash
 * pnpm perf:frame --label baseline --view square
 * pnpm perf:frame --label frozen  --view square --skip-build
 * pnpm perf:frame --label muted   --view square --skip-build --query mute=1
 * ```
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import {
  formatProfileTable,
  summarizeProfile,
  windowMean,
  type CpuProfile,
} from './profile-summary.js';
import { findView, PERF_VIEWS } from './views.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Where reports land, relative to the repository root.
 *
 * Deliberately not under `test-results/`: Playwright empties that directory at
 * the start of every run, so a baseline measured in the morning is gone the
 * next time somebody types `pnpm smoke` — and gone *silently*, which is the
 * worst way to lose the one number a change is being argued against.
 */
const PERF_OUTPUT_DIR = 'perf-results';

/** Ports of this rig's own, so it can run while `pnpm dev` and `pnpm smoke` do. */
const GAME_PORT = Number.parseInt(process.env['PERF_GAME_PORT'] ?? '5273', 10);
const API_PORT = Number.parseInt(process.env['PERF_API_PORT'] ?? '3273', 10);
const ASSET_PORT = Number.parseInt(process.env['PERF_ASSET_PORT'] ?? '9273', 10);

const gameUrl = `http://localhost:${String(GAME_PORT)}`;
const apiUrl = `http://localhost:${String(API_PORT)}`;
const assetUrl = `http://localhost:${String(ASSET_PORT)}`;

/** What the command line asked for. */
interface Options {
  readonly label: string;
  readonly viewId: string;
  /** Seconds the profiler and the frame window run for. */
  readonly seconds: number;
  /** Seconds to let the frame rate settle after the village is complete. */
  readonly settleSeconds: number;
  readonly skipBuild: boolean;
  /**
   * Extra query parameters appended to the view's own, without the `?`.
   *
   * A view fixes the camera, which is what makes two runs comparable; a switch
   * being measured is not part of the camera. `--query mute=1` is what lets the
   * same view be measured with the audio path on and off, which is the only way
   * "sound costs nothing in the frame" is a measurement rather than a hope.
   */
  readonly extraQuery: string;
  readonly outDir: string;
  /** Metres to walk before the second shadow reading; 0 skips the test. */
  readonly moveMetres: number;
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function parseOptions(argv: readonly string[]): Options {
  const seconds = Number.parseFloat(argument(argv, 'seconds') ?? '3');
  const settle = Number.parseFloat(argument(argv, 'settle') ?? '3');
  const move = Number.parseFloat(argument(argv, 'move') ?? '30');
  return {
    label: argument(argv, 'label') ?? 'run',
    viewId: argument(argv, 'view') ?? 'square',
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 3,
    settleSeconds: Number.isFinite(settle) && settle >= 0 ? settle : 3,
    skipBuild: argv.includes('--skip-build'),
    extraQuery: (argument(argv, 'query') ?? '').replace(/^[?&]/, ''),
    outDir: resolve(argument(argv, 'out') ?? join(repoRoot, PERF_OUTPUT_DIR)),
    moveMetres: Number.isFinite(move) && move >= 0 ? move : 30,
  };
}

function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Runs a command to completion, inheriting stdio, and throws on failure. */
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} ${args.join(' ')} exited with ${String(code)}`));
      }
    });
  });
}

/**
 * Starts a server in its own process group.
 *
 * The group is the point: `pnpm --filter … preview` is a shell that starts
 * vite, and killing the shell leaves vite holding the port — which the next run
 * then fails on with `--strictPort`, several minutes after the run that leaked
 * it finished.
 */
function serve(command: string, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, [...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone; nothing to clean up.
  }
}

/** Polls a URL until it answers or the budget runs out. */
async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`server did not answer within ${String(timeoutMs)} ms: ${url}`);
    }
    await new Promise((wake) => setTimeout(wake, 250));
  }
}

/** The bridge readings one sample takes. */
interface BridgeSample {
  readonly frameTimeMs: number;
  readonly frames: number;
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly triangles: number;
  readonly shadowCasters: number;
}

/**
 * The part of the client's debug bridge this rig reads.
 *
 * Restated here rather than imported from `apps/game`: `tooling/` must not
 * depend on an app's source (`pnpm lint:boundaries`), and the bridge is a
 * published shape — a field that disappears from it should break this script
 * loudly, which is what the `?? 0` fallbacks below deliberately do not hide,
 * because a missing bridge is caught by `waitForVillage` first.
 */
interface DebugBridgeShape {
  readonly render: {
    readonly frameTimeMs: number;
    readonly frames: number;
    readonly drawCalls: number;
    readonly activeMeshes: number;
    readonly triangles: number;
  };
  readonly lighting: {
    readonly shadowCasters: number;
    readonly sun: { readonly x: number; readonly y: number; readonly z: number };
  } | null;
  readonly player: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly collision: unknown;
}

/** The window the client publishes its bridge on, as this script sees it. */
interface BridgeWindow {
  readonly __wov?: DebugBridgeShape | undefined;
}

async function readBridge(page: Page): Promise<BridgeSample> {
  return page.evaluate(() => {
    const bridge = (window as unknown as BridgeWindow).__wov;
    return {
      frameTimeMs: bridge?.render.frameTimeMs ?? 0,
      frames: bridge?.render.frames ?? 0,
      drawCalls: bridge?.render.drawCalls ?? 0,
      activeMeshes: bridge?.render.activeMeshes ?? 0,
      triangles: bridge?.render.triangles ?? 0,
      shadowCasters: bridge?.lighting?.shadowCasters ?? 0,
    };
  });
}

/**
 * Waits until the village has finished arriving.
 *
 * The collision report is the last thing the client publishes (`main.ts`), so a
 * bridge that has one is a client that has loaded its models, built its bodies
 * and stopped allocating. Measuring before that is measuring a page that is
 * still loading, which is the single easiest way to produce a performance
 * number that means nothing.
 */
async function waitForVillage(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as BridgeWindow).__wov?.collision != null,
    undefined,
    { timeout: 180_000 },
  );
}

/**
 * Reads the canvas back as raw RGBA — the HUD excluded, because the HUD is DOM
 * drawn on top of the canvas rather than into it.
 *
 * Base64 rather than an array of numbers: a 1280×720 frame is 3.6 million
 * values, and handing those across the CDP bridge one JSON number at a time
 * takes longer than the measurement it belongs to.
 */
async function readCanvas(
  page: Page,
): Promise<{ width: number; height: number; bytes: Uint8Array }> {
  const frame = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
    if (canvas === null) {
      return null;
    }
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (context === null) {
      return null;
    }
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < data.length; index += chunk) {
      binary += String.fromCharCode(...data.subarray(index, index + chunk));
    }
    return { width: copy.width, height: copy.height, base64: btoa(binary) };
  });
  if (frame === null) {
    throw new Error('no render canvas to read back');
  }
  return {
    width: frame.width,
    height: frame.height,
    bytes: new Uint8Array(Buffer.from(frame.base64, 'base64')),
  };
}

/**
 * Where the shadow map is centred and how many casters it drew.
 *
 * The sun is parked `shadows.distance` metres behind the focus point
 * (`packages/engine/src/lighting.ts`), so the sun's own position is the
 * measurable witness that `focusShadows` still moves the map: nothing else in
 * the scene says where the box is.
 */
async function readShadowFocus(
  page: Page,
): Promise<{ sun: [number, number, number]; player: [number, number, number]; casters: number }> {
  const read = await page.evaluate(() => {
    const bridge = (window as unknown as BridgeWindow).__wov;
    const sun = bridge?.lighting?.sun;
    return {
      sunX: sun?.x ?? 0,
      sunY: sun?.y ?? 0,
      sunZ: sun?.z ?? 0,
      playerX: bridge?.player?.x ?? 0,
      playerY: bridge?.player?.y ?? 0,
      playerZ: bridge?.player?.z ?? 0,
      casters: bridge?.lighting?.shadowCasters ?? 0,
    };
  });
  return {
    sun: [read.sunX, read.sunY, read.sunZ],
    player: [read.playerX, read.playerY, read.playerZ],
    casters: read.casters,
  };
}

/**
 * Walks the player away from where it stands, and reports how far it got.
 *
 * Four directions rather than one, because the village is full: the spawn point
 * on the square has a wall three metres north of it, and a test that only ever
 * held `w` would report "walked 3 m" and quietly stop proving anything about a
 * shadow map that has to keep up over thirty. Each direction is given a few
 * seconds and the walk stops at the first one that gets far enough.
 *
 * The distance is straight-line displacement from the starting point, not the
 * path walked: the claim under test is "the map is centred somewhere else now",
 * and a player who walks in a circle has not moved.
 */
async function walk(page: Page, metres: number): Promise<number> {
  const where = (): Promise<{ x: number; z: number }> =>
    page.evaluate(() => {
      const at = (window as unknown as BridgeWindow).__wov?.player;
      return { x: at?.x ?? 0, z: at?.z ?? 0 };
    });
  const from = await where();
  let travelled = 0;
  for (const key of ['w', 'a', 's', 'd']) {
    await page.keyboard.down(key);
    const deadline = Date.now() + 8_000;
    let stalled = 0;
    let last = await where();
    while (travelled < metres && Date.now() < deadline) {
      await new Promise((wake) => setTimeout(wake, 200));
      const at = await where();
      travelled = Math.max(travelled, Math.hypot(at.x - from.x, at.z - from.z));
      // Stalling is measured on the step just taken, not on the displacement
      // from the start: a player strafing past its own starting point is moving
      // at full speed while its distance from that point barely changes.
      stalled = Math.hypot(at.x - last.x, at.z - last.z) < 0.05 ? stalled + 1 : 0;
      last = at;
      // Five readings without a step is a wall, not a slow walk.
      if (stalled >= 5) {
        break;
      }
    }
    await page.keyboard.up(key);
    if (travelled >= metres) {
      break;
    }
  }
  return travelled;
}

async function measure(options: Options, page: Page): Promise<Record<string, unknown>> {
  const view = findView(options.viewId);
  if (view === undefined) {
    throw new Error(
      `unknown view "${options.viewId}"; known: ${PERF_VIEWS.map((one) => one.id).join(', ')}`,
    );
  }

  const query =
    options.extraQuery === ''
      ? view.query
      : `${view.query}${view.query.includes('?') ? '&' : '?'}${options.extraQuery}`;
  say(`opening ${gameUrl}${query} — ${view.description}`);
  await page.goto(`${gameUrl}${query}`, { waitUntil: 'load' });
  await waitForVillage(page);
  say('village complete; settling');
  await new Promise((wake) => setTimeout(wake, options.settleSeconds * 1000));

  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 200 });

  const before = await readBridge(page);
  await client.send('Profiler.start');
  await new Promise((wake) => setTimeout(wake, options.seconds * 1000));
  const stopped = (await client.send('Profiler.stop')) as unknown as { profile: CpuProfile };
  const after = await readBridge(page);
  await client.send('Profiler.disable');

  const summary = summarizeProfile(stopped.profile);
  const sceneRenderMs = windowMean(before, after);
  const canvas = await readCanvas(page);

  // The shadow map has to keep following the player, which is a claim about
  // movement and cannot be made from a still frame.
  const shadowBefore = await readShadowFocus(page);
  let shadowAfter = shadowBefore;
  let travelled = 0;
  if (options.moveMetres > 0) {
    travelled = await walk(page, options.moveMetres);
    shadowAfter = await readShadowFocus(page);
  }

  const frames = after.frames - before.frames;
  return {
    label: options.label,
    view: view.id,
    query,
    viewDescription: view.description,
    url: `${gameUrl}${query}`,
    takenAt: new Date().toISOString(),
    window: {
      seconds: options.seconds,
      frames,
      framesPerSecond: frames / options.seconds,
      sceneRenderMs,
    },
    counters: {
      drawCalls: after.drawCalls,
      activeMeshes: after.activeMeshes,
      triangles: after.triangles,
      shadowCasters: after.shadowCasters,
    },
    profile: {
      samples: summary.samples,
      totalMs: summary.totalMs,
      top: summary.rows.slice(0, 20),
    },
    frame: { width: canvas.width, height: canvas.height },
    shadowFollow: {
      metresWalked: travelled,
      playerBefore: shadowBefore.player,
      playerAfter: shadowAfter.player,
      sunBefore: shadowBefore.sun,
      sunAfter: shadowAfter.sun,
      sunMoved: Math.hypot(
        shadowAfter.sun[0] - shadowBefore.sun[0],
        shadowAfter.sun[2] - shadowBefore.sun[2],
      ),
      castersAfter: shadowAfter.casters,
    },
    __pixels: canvas.bytes,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const servers: ChildProcess[] = [];
  let browser: Browser | undefined;

  const buildEnv: NodeJS.ProcessEnv = {
    WOV_DEBUG_BRIDGE: '1',
    VITE_API_URL: apiUrl,
    VITE_ASSET_URL: assetUrl,
  };

  try {
    if (!options.skipBuild) {
      say('building the packages and the game with the debug bridge');
      await run('pnpm', ['run', 'build:packages'], buildEnv);
      await run('pnpm', ['--filter', '@wov/game', 'build'], buildEnv);
    }

    say('starting api, assets and the preview server');
    servers.push(
      serve('pnpm', ['--filter', '@wov/api', 'dev'], {
        API_PORT: String(API_PORT),
        // Read-only: a measurement must not be able to write world data.
        WORLDS_READ_ONLY: '1',
        API_CORS_ORIGINS: gameUrl,
      }),
      serve('pnpm', ['run', 'dev:assets'], { ASSET_PORT: String(ASSET_PORT) }),
      serve(
        'pnpm',
        ['--filter', '@wov/game', 'preview', '--port', String(GAME_PORT), '--strictPort'],
        {},
      ),
    );
    await Promise.all([
      waitForServer(`${apiUrl}/health`),
      waitForServer(`${assetUrl}/health`),
      waitForServer(gameUrl),
    ]);

    browser = await chromium.launch({
      // Headless Chromium rasterises in software unless it is told otherwise,
      // and a village of 3.9 M triangles measured on SwiftShader is a
      // measurement of SwiftShader. Same request `pnpm smoke` makes.
      args: ['--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const report = await measure(options, page);

    const pixels = report['__pixels'] as Uint8Array;
    delete report['__pixels'];

    await mkdir(options.outDir, { recursive: true });
    const stem = join(options.outDir, `${options.label}.${options.viewId}`);
    await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(`${stem}.rgba`, pixels);
    await page.screenshot({ path: `${stem}.png` });

    const window_ = report['window'] as { sceneRenderMs: number | null; framesPerSecond: number };
    const counters = report['counters'] as { drawCalls: number; activeMeshes: number };
    say('');
    say(`${options.label} · ${options.viewId}`);
    say(
      `  scene.render ${window_.sceneRenderMs?.toFixed(2) ?? 'n/a'} ms · ` +
        `${window_.framesPerSecond.toFixed(1)} fps · ` +
        `${String(counters.drawCalls)} draw calls · ` +
        `${String(counters.activeMeshes)} active meshes`,
    );
    say('');
    say(
      formatProfileTable(
        {
          totalMs: (report['profile'] as { totalMs: number }).totalMs,
          samples: (report['profile'] as { samples: number }).samples,
          rows: (report['profile'] as { top: never[] }).top,
        },
        20,
      ),
    );
    say('');
    say(`written to ${stem}.json, .rgba and .png`);
  } finally {
    await browser?.close();
    for (const server of servers) {
      stop(server);
    }
  }
}

await main();
