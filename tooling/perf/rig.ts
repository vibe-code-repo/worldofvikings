/**
 * The parts every measuring rig in this folder needs, and none of them is
 * about measuring.
 *
 * `pnpm perf:frame` (`frame-profile.ts`) and `pnpm perf:editor`
 * (`editor-profile.ts`) both have to build the bundles, start three servers on
 * ports of their own, wait for them, open a headless Chromium that is actually
 * using the machine's GPU, and read a canvas back. That scaffolding was written
 * once for the game rig; it is here so the editor rig does not repeat it and,
 * more importantly, so the two rigs cannot drift apart on the parts that make
 * their numbers comparable — the ANGLE flags above all.
 *
 * Nothing here decides anything about a measurement. The arithmetic lives in
 * `profile-summary.ts` and `pixels.ts`, where a unit test can hold it still.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

/** The repository root, from this file's own location. */
export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Where reports land, relative to the repository root.
 *
 * Deliberately not under `test-results/`: Playwright empties that directory at
 * the start of every run, so a baseline measured in the morning is gone the
 * next time somebody types `pnpm smoke` — and gone *silently*, which is the
 * worst way to lose the one number a change is being argued against.
 */
export const PERF_OUTPUT_DIR = 'perf-results';

/** The value after `--name` on a command line, or `undefined`. */
export function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** A finite number after `--name`, or `fallback` when it is missing or junk. */
export function numberArgument(
  argv: readonly string[],
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const parsed = Number.parseFloat(argument(argv, name) ?? '');
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

/** A TCP port from the environment, or the rig's default. */
export function port(name: string, fallback: number): number {
  const configured = process.env[name]?.trim() ?? '';
  if (configured === '') {
    return fallback;
  }
  const parsed = Number.parseInt(configured, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be a TCP port, got: ${configured}`);
  }
  return parsed;
}

export function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Runs a command to completion, inheriting stdio, and throws on failure. */
export function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
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
export function serve(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(command, [...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
}

export function stop(child: ChildProcess): void {
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
export async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
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

/**
 * A throwaway copy of `content/`, for a rig whose API might be written to.
 *
 * The same pattern `tooling/smoke/playwright.config.ts` uses, and for the same
 * reason: the editor can save, and a measurement that leaves a modified world
 * file behind has changed the thing the next measurement measures. The copy
 * lives in the system temporary directory and nothing deletes it — a few
 * megabytes of world JSON is a cheap price for being able to look at what a run
 * wrote.
 */
export function throwawayContentDir(): string {
  const contentDir = mkdtempSync(join(tmpdir(), 'wov-perf-content-'));
  for (const folder of ['worlds', 'prefabs']) {
    mkdirSync(join(contentDir, folder), { recursive: true });
    cpSync(join(repoRoot, 'content', folder), join(contentDir, folder), { recursive: true });
  }
  return contentDir;
}

/**
 * A headless Chromium that renders on the machine's own driver.
 *
 * Headless Chromium rasterises in software unless it is told otherwise, and a
 * village of millions of triangles measured on SwiftShader is a measurement of
 * SwiftShader. The same request `pnpm smoke` makes: where no GPU answers,
 * Chromium falls back to software exactly as before, which is why the rigs
 * report the backend they ended up on.
 */
export function launchPerfBrowser(): Promise<Browser> {
  return chromium.launch({
    args: ['--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
  });
}

/** A canvas read back as raw RGBA. */
export interface CanvasFrame {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/**
 * Reads a canvas back as raw RGBA — everything drawn *into* it and nothing
 * drawn on top of it, because a HUD and a panel are DOM.
 *
 * Base64 rather than an array of numbers: a 1280×720 frame is 3.6 million
 * values, and handing those across the CDP bridge one JSON number at a time
 * takes longer than the measurement it belongs to.
 */
export async function readCanvas(page: Page, selector: string): Promise<CanvasFrame> {
  const frame = await page.evaluate((query: string) => {
    const canvas = document.querySelector<HTMLCanvasElement>(query);
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
  }, selector);
  if (frame === null) {
    throw new Error(`no canvas to read back: ${selector}`);
  }
  return {
    width: frame.width,
    height: frame.height,
    bytes: new Uint8Array(Buffer.from(frame.base64, 'base64')),
  };
}
