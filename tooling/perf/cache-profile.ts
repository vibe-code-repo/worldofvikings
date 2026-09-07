/**
 * What opening the editor twice costs on the wire (`pnpm perf:cache`).
 *
 * The measurement ADR-0052 is argued from. It builds the editor with the debug
 * bridge, starts the API on a throwaway `CONTENT_DIR`, the asset server on the
 * private store and `vite preview` on ports of its own, then opens village1
 * through the File menu twice in the *same* browser context:
 *
 * 1. **cold** — an empty cache, which is what a first visit costs;
 * 2. **warm** — the page reloaded, which is what every visit after it costs.
 *
 * The second number is the one the change is about. Before validators it was
 * the same as the first, to within a rounding error: `cache-control: no-cache`
 * with nothing to revalidate against leaves a browser no choice but to download
 * every byte again.
 *
 * **Why CDP and not `performance.getEntriesByType('resource')`.** A resource
 * entry reports `transferSize: 0` for any cross-origin response without
 * `Timing-Allow-Origin`, and both servers being measured here are cross-origin
 * by construction. The page would report that it downloaded nothing, which is
 * exactly the answer this rig must not be able to give by accident.
 *
 * **Why `Network.responseReceivedExtraInfo` decides the status.**
 * `Network.responseReceived` reports the response the *page* got, which after a
 * successful revalidation is the stored `200` — so a run in which every file
 * answered `304` would be reported as 374 downloads of nothing. The extra-info
 * event carries the status the *network* answered with, and its absence is
 * itself the third answer: the browser never asked.
 *
 * **Why a persistent profile.** `browser.newContext()` is incognito and caches
 * in memory only, with a cap that quietly refuses the largest entries — the 8 MB
 * height field and the backdrop textures were re-downloaded on the warm pass
 * for that reason alone, which is a property of the measuring rig and not of
 * the servers. A profile on disk with a stated `--disk-cache-size` is both more
 * like a visitor's browser and reproducible on another machine.
 *
 * **Why the built bundles.** Same reason as `frame-profile.ts`: the dev server
 * serves modules one request at a time and is not what anybody runs.
 *
 * **Why a throwaway `CONTENT_DIR`.** The editor can save, and a measurement
 * must not be able to write into `content/`.
 *
 * ```bash
 * pnpm perf:cache --label after
 * pnpm perf:cache --label after --skip-build
 * ```
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  formatPass,
  summarizePass,
  type EntityCounts,
  type PassSummary,
  type WireEntry,
} from './cache-summary.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Where reports land. Not under `test-results/`, which Playwright empties. */
const PERF_OUTPUT_DIR = 'perf-results';

/** Ports of this rig's own, so it can run while `pnpm dev` and `pnpm smoke` do. */
const EDITOR_PORT = Number.parseInt(process.env['PERF_EDITOR_PORT'] ?? '5274', 10);
const API_PORT = Number.parseInt(process.env['PERF_API_PORT'] ?? '3274', 10);
const ASSET_PORT = Number.parseInt(process.env['PERF_ASSET_PORT'] ?? '9274', 10);

/**
 * 512 MB, comfortably more than the ~57 MB one village open reads.
 *
 * The point is not the size but that it is written down: a warm pass that
 * re-downloads the height field because the browser refused to store an 8 MB
 * entry is measuring the rig, not the servers.
 */
const DISK_CACHE_BYTES = 512 * 1024 * 1024;

const editorUrl = `http://localhost:${String(EDITOR_PORT)}`;
const apiUrl = `http://localhost:${String(API_PORT)}`;
const assetUrl = `http://localhost:${String(ASSET_PORT)}`;

interface Options {
  readonly label: string;
  readonly worldId: string;
  readonly skipBuild: boolean;
  readonly outDir: string;
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function parseOptions(argv: readonly string[]): Options {
  return {
    label: argument(argv, 'label') ?? 'run',
    worldId: argument(argv, 'world') ?? 'village1',
    skipBuild: argv.includes('--skip-build'),
    outDir: resolve(argument(argv, 'out') ?? join(repoRoot, PERF_OUTPUT_DIR)),
  };
}

function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

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
 * Starts a server in its own process group, so killing it takes vite with it —
 * `pnpm --filter … preview` is a shell, and killing the shell leaves the port
 * held for the next run to fail on.
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
    // Already gone.
  }
}

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) {
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
 * A throwaway copy of `content/`.
 *
 * The editor saves through the API, so a rig that pointed it at the repository
 * would be one misclick away from committing a measurement.
 */
function throwawayContentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wov-cache-content-'));
  for (const folder of ['worlds', 'prefabs']) {
    mkdirSync(join(dir, folder), { recursive: true });
    cpSync(join(repoRoot, 'content', folder), join(dir, folder), { recursive: true });
  }
  return dir;
}

/** What is known about one request while it is still running. */
interface PendingRequest {
  url: string;
  /** The status the page saw — after a revalidation, the stored `200`. */
  pageStatus: number;
  /** The status the network answered with, when the request reached it. */
  wireStatus: number | undefined;
  /** Chromium said it answered this from its own store. */
  fromDiskCache: boolean;
  bytes: number;
}

/**
 * Collects `Network.*` events for one pass.
 *
 * Three events rather than one, because "the browser did not download this" has
 * two completely different causes that a single event cannot tell apart:
 * `responseReceivedExtraInfo` fires only when the request reached the network
 * and carries the status it got there, so its absence means the browser
 * answered out of its own cache and its `304` means it asked and was told
 * nothing changed.
 */
class WireLog {
  private readonly open = new Map<string, PendingRequest>();
  private readonly done: WireEntry[] = [];

  received(id: string, url: string, status: number, fromDiskCache: boolean): void {
    const held = this.open.get(id);
    if (held === undefined) {
      this.open.set(id, {
        url,
        pageStatus: status,
        wireStatus: undefined,
        fromDiskCache,
        bytes: 0,
      });
      return;
    }
    held.url = url;
    held.pageStatus = status;
    held.fromDiskCache = fromDiskCache;
  }

  /** The status the network answered with; may arrive before or after the response. */
  wireStatus(id: string, status: number): void {
    const held = this.open.get(id);
    if (held === undefined) {
      this.open.set(id, {
        url: '',
        pageStatus: status,
        wireStatus: status,
        fromDiskCache: false,
        bytes: 0,
      });
      return;
    }
    held.wireStatus = status;
  }

  finished(id: string, encodedBytes: number): void {
    const held = this.open.get(id);
    if (held === undefined) {
      return;
    }
    held.bytes = encodedBytes;
    this.done.push(toEntry(held));
    this.open.delete(id);
  }

  failed(id: string): void {
    const held = this.open.get(id);
    if (held !== undefined) {
      this.done.push(toEntry(held));
      this.open.delete(id);
    }
  }

  /** Everything finished, plus anything still in flight — it cost its bytes too. */
  entries(): readonly WireEntry[] {
    return [...this.done, ...[...this.open.values()].map(toEntry)];
  }

  reset(): void {
    this.open.clear();
    this.done.length = 0;
  }
}

function toEntry(request: PendingRequest): WireEntry {
  const reachedTheNetwork = request.wireStatus !== undefined;
  return {
    url: request.url,
    status: request.wireStatus ?? request.pageStatus,
    bytes: request.bytes,
    fromCache: request.fromDiskCache || !reachedTheNetwork,
  };
}

/** The part of the editor's debug bridge this rig reads (`apps/editor/src/dev-debug.ts`). */
interface EditorBridgeShape {
  readonly entityCount: number;
  readonly loadedCount: number;
}
interface BridgeWindow {
  readonly __wovEditor?: EditorBridgeShape | undefined;
}

async function readBridge(page: Page): Promise<EntityCounts> {
  return page.evaluate(() => {
    const bridge = (window as unknown as BridgeWindow).__wovEditor;
    return { entityCount: bridge?.entityCount ?? 0, loadedCount: bridge?.loadedCount ?? 0 };
  });
}

/**
 * Opens a world through the File menu and waits until every entity shows its
 * model rather than the stand-in cube.
 *
 * `loadedCount === entityCount` is the only honest finish line: a viewport full
 * of cubes has made every request for the *world* and none for the models, and
 * a rig that stopped at the first frame would report a fraction of the bytes.
 */
async function openWorld(page: Page, worldId: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-open-${worldId}`).click();
  await page.waitForFunction(
    () => {
      const bridge = (window as unknown as BridgeWindow).__wovEditor;
      return (
        bridge !== undefined && bridge.entityCount > 0 && bridge.loadedCount >= bridge.entityCount
      );
    },
    undefined,
    { timeout: 300_000 },
  );
}

interface PassReport extends PassSummary {
  readonly counts: EntityCounts;
}

async function measure(options: Options, context: BrowserContext): Promise<PassReport[]> {
  const log = new WireLog();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  client.on('Network.responseReceived', (event) => {
    const response = event.response as {
      url: string;
      status: number;
      fromDiskCache?: boolean;
      fromPrefetchCache?: boolean;
    };
    log.received(
      event.requestId,
      response.url,
      response.status,
      response.fromDiskCache === true || response.fromPrefetchCache === true,
    );
  });
  client.on('Network.responseReceivedExtraInfo', (event) => {
    log.wireStatus(event.requestId, (event as unknown as { statusCode: number }).statusCode);
  });
  client.on('Network.loadingFinished', (event) => {
    log.finished(event.requestId, event.encodedDataLength);
  });
  client.on('Network.loadingFailed', (event) => {
    log.failed(event.requestId);
  });

  const reports: PassReport[] = [];

  say(`cold: opening ${editorUrl}/?debug=1 and ${options.worldId}`);
  log.reset();
  let started = Date.now();
  await page.goto(`${editorUrl}/?debug=1`, { waitUntil: 'load' });
  await openWorld(page, options.worldId);
  reports.push({
    ...summarizePass('cold', log.entries(), (Date.now() - started) / 1000),
    counts: await readBridge(page),
  });

  // Same context, same cache, page reloaded from scratch: what a second visit
  // to the same editor costs.
  say('warm: reloading and opening the same world again');
  log.reset();
  started = Date.now();
  await page.reload({ waitUntil: 'load' });
  await openWorld(page, options.worldId);
  reports.push({
    ...summarizePass('warm', log.entries(), (Date.now() - started) / 1000),
    counts: await readBridge(page),
  });

  await page.close();
  return reports;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const contentDir = throwawayContentDir();
  const servers: ChildProcess[] = [];
  let context: BrowserContext | undefined;
  const profileDir = mkdtempSync(join(tmpdir(), 'wov-cache-profile-'));

  const buildEnv: NodeJS.ProcessEnv = {
    WOV_DEBUG_BRIDGE: '1',
    VITE_API_URL: apiUrl,
    VITE_ASSET_URL: assetUrl,
  };

  try {
    if (!options.skipBuild) {
      say('building the packages and the editor with the debug bridge');
      await run('pnpm', ['run', 'build:packages'], buildEnv);
      await run('pnpm', ['--filter', '@wov/editor', 'build'], buildEnv);
    }

    say(`starting api (content copy ${contentDir}), assets and the preview server`);
    servers.push(
      serve('pnpm', ['--filter', '@wov/api', 'dev'], {
        API_PORT: String(API_PORT),
        CONTENT_DIR: contentDir,
        API_CORS_ORIGINS: editorUrl,
        LOG_LEVEL: 'warn',
      }),
      serve('pnpm', ['run', 'dev:assets'], { ASSET_PORT: String(ASSET_PORT) }),
      serve(
        'pnpm',
        ['--filter', '@wov/editor', 'preview', '--port', String(EDITOR_PORT), '--strictPort'],
        {},
      ),
    );
    await Promise.all([
      waitForServer(`${apiUrl}/health`),
      waitForServer(`${assetUrl}/health`),
      waitForServer(editorUrl),
    ]);

    context = await chromium.launchPersistentContext(profileDir, {
      viewport: { width: 1280, height: 800 },
      args: [
        // Same request `pnpm smoke` makes: headless Chromium rasterises in
        // software otherwise, and the editor would spend the measurement window
        // drawing rather than loading.
        '--use-gl=angle',
        '--use-angle=vulkan',
        '--ignore-gpu-blocklist',
        // Stated rather than inherited: Chromium sizes its cache from the free
        // space on the disk and then refuses any entry above a fraction of that,
        // so the same run on two machines would cache a different set of files.
        `--disk-cache-size=${String(DISK_CACHE_BYTES)}`,
      ],
    });
    const reports = await measure(options, context);

    await mkdir(options.outDir, { recursive: true });
    const out = join(options.outDir, `${options.label}.cache.json`);
    await writeFile(
      out,
      `${JSON.stringify({ label: options.label, takenAt: new Date().toISOString(), world: options.worldId, passes: reports }, null, 2)}\n`,
    );

    say('');
    say(options.label);
    for (const report of reports) {
      for (const line of formatPass(report, report.counts)) {
        say(`  ${line}`);
      }
    }
    say('');
    say(`written: ${out}`);
  } finally {
    await context?.close();
    for (const child of servers) {
      stop(child);
    }
    rmSync(profileDir, { recursive: true, force: true });
  }
}

await main();
