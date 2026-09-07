/**
 * The editor's measuring rig (`pnpm perf:editor`).
 *
 * The counterpart of `pnpm perf:frame` (`frame-profile.ts`), and it exists for
 * the same reason with a different subject: the game rig answers "what does one
 * frame of this village cost the player", and this one answers "what does
 * *working on* that village cost the author". Those are different questions.
 * Opening `village1` in the editor was reported at about seventy seconds with
 * the main thread blocked for most of it, and after that the frame counter
 * barely moves — none of which the game rig can see, because none of it happens
 * in the game.
 *
 * Four scenarios, all on the same page in the same browser session:
 *
 * 1. `load` — open `village1` through the File menu and time the three
 *    milestones (the document, the models, the textures), the long tasks the
 *    main thread spent blocked while it happened, and a CPU profile of the
 *    whole load. Then frame the zone, let it settle, and measure the frame:
 *    `scene.render` over a window, draw calls, active meshes, triangles, shadow
 *    casters, and a second CPU profile of the settled frames.
 * 2. `dial` — turn one ground dial ten times and time each change to the next
 *    rendered frame. This is the gesture the author called unusable, and it is
 *    the ground edit that must never rebuild the tile (ADR-0050).
 * 3. `rebuild` — flip the facet switch four times and time each toggle to the
 *    tile on screen carrying the new shader key. The ground edit that *must*
 *    rebuild, so the two halves of ADR-0050 have a number each.
 * 4. `edit` — select an entity, nudge it five times, and click the canvas once.
 *    This is the "is it fluid" number.
 *
 * **Why the built bundles.** Same as the game rig: Vite's dev server serves
 * every Babylon submodule as its own request and its own module record, and the
 * built bundle is one file with the tree shaken. Staging serves the built
 * bundles, which is what the author measured. The build is made with
 * `WOV_DEBUG_BRIDGE=1` (see `infrastructure/deployment/staging-build.sh`), so
 * the bridge is compiled in and still needs `?debug=1` to publish itself
 * (ADR-0030).
 *
 * **Why the timings come from inside the page.** The complaint is that the main
 * thread is blocked, and a probe from outside cannot time a thread that is not
 * answering — the author's own `page.evaluate` timed out. So the rig installs
 * accessors on the bridge's counters before the click and lets the *page* stamp
 * each milestone with `performance.now()`; the numbers are read back afterwards,
 * when the thread is free again.
 *
 * **Why the API gets a throwaway `CONTENT_DIR`.** The editor can save. A
 * measurement that leaves a modified world file behind has changed the thing the
 * next measurement measures.
 *
 * **Two cameras, and only one of them is for the picture.** Every timing is
 * taken where `F` with nothing selected puts the camera: over the whole zone,
 * because that view contains all of it and nothing is culled away from the
 * frame being timed. For the village that is 1 967 m up and about 4 m to the
 * pixel, where the entities cover 3.5 % of the canvas and a 6 m building is a
 * pixel and a half — so a canvas taken there cannot witness anything about the
 * props at all. Each scenario therefore also leaves a `<label>.editor.<name>.
 * close.rgba` taken with one building framed, and that is the file a "the
 * picture did not change" claim belongs to.
 *
 * **Whose servers answered.** The rig serves whatever is in `apps/editor/dist`,
 * and that bundle carries the API and asset URLs it was *built* with. With
 * `--skip-build`, after another worktree or another rig run built it on other
 * ports, the page fetches its worlds and its models from somebody else's
 * servers. So the origins the page used are recorded in the report and checked
 * against the ones this run started, and a run that does not finish still
 * writes `<label>.editor.partial.json` saying how far it got.
 *
 * ```bash
 * WOV_ASSET_STORE=/path/to/store pnpm perf:editor --label baseline
 * WOV_ASSET_STORE=/path/to/store pnpm perf:editor --label after --scenario dial --skip-build
 * ```
 */
import { type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Browser, CDPSession, Page } from '@playwright/test';
import {
  DIAL_CHANGES,
  EDITOR_WORLD_ID,
  EDIT_ENTITY_ID,
  EDIT_NUDGES,
  EDIT_NUDGE_METRES,
  REBUILD_TOGGLES,
  dialValueAt,
  parseScenarios,
  type DialReport,
  type EditReport,
  type EditorCounters,
  type EditorPerfReport,
  type EditorScenarioId,
  type LoadReport,
  type LongTaskReport,
  type ProfileReport,
  type RebuildReport,
  type SettledFrameReport,
  type WorkingFrameReport,
} from './editor-scenarios.js';
import { aggregateLongTasks, summariseDurations, type LongTaskEntry } from './long-tasks.js';
import {
  formatProfileTable,
  summarizeProfile,
  windowMean,
  type CpuProfile,
  type ProfileRow,
} from './profile-summary.js';
import {
  argument,
  launchPerfBrowser,
  numberArgument,
  PERF_OUTPUT_DIR,
  port,
  readCanvas,
  repoRoot,
  run,
  say,
  serve,
  stop,
  throwawayContentDir,
  waitForServer,
} from './rig.js';

/** Ports of this rig's own, so it can run while `pnpm dev` and `pnpm smoke` do. */
const EDITOR_PORT = port('PERF_EDITOR_PORT', 5274);
const API_PORT = port('PERF_API_PORT', 3273);
const ASSET_PORT = port('PERF_ASSET_PORT', 9273);

const editorUrl = `http://localhost:${String(EDITOR_PORT)}`;
const apiUrl = `http://localhost:${String(API_PORT)}`;
const assetUrl = `http://localhost:${String(ASSET_PORT)}`;

/**
 * How long the load may take before the rig gives up.
 *
 * Generous on purpose: the measurement under way is of something that took
 * seventy seconds, and a timeout tight enough to be "safe" would turn a slow
 * baseline into a failed run with no number in it.
 */
const LOAD_TIMEOUT_MS = 600_000;

/** How long the textures have to stay still before the load counts as finished. */
const TEXTURE_QUIET_MS = 2_000;

/**
 * How long the picture is left alone after the camera moves.
 *
 * Shorter than the settled window, because nothing is being *timed* here: the
 * grading chain and the shadow map need a few frames after a camera move, and
 * this is what keeps a canvas comparison from photographing the settling.
 */
const WORKING_SETTLE_MS = 2_500;

interface Options {
  readonly label: string;
  readonly scenarios: readonly EditorScenarioId[];
  /** Seconds the settled-frame window and its profiler run for. */
  readonly seconds: number;
  /** Seconds to let the picture settle after framing the zone. */
  readonly settleSeconds: number;
  /** Sampling interval for the load profile, microseconds. */
  readonly loadSamplingUs: number;
  /** Sampling interval for the settled-frame profile, microseconds. */
  readonly frameSamplingUs: number;
  readonly skipBuild: boolean;
  readonly outDir: string;
}

function parseOptions(argv: readonly string[]): Options {
  return {
    label: argument(argv, 'label') ?? 'run',
    scenarios: parseScenarios(argument(argv, 'scenario')),
    seconds: numberArgument(argv, 'seconds', 3) || 3,
    settleSeconds: numberArgument(argv, 'settle', 3),
    // Coarser than the game rig's 200 µs: this profile covers a minute or more
    // rather than three seconds, and a 200 µs profile of that is hundreds of
    // thousands of samples to move across the CDP bridge.
    loadSamplingUs: numberArgument(argv, 'load-sampling', 1_000) || 1_000,
    frameSamplingUs: numberArgument(argv, 'frame-sampling', 200) || 200,
    skipBuild: argv.includes('--skip-build'),
    outDir: resolve(argument(argv, 'out') ?? join(repoRoot, PERF_OUTPUT_DIR)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}

// --- what the page publishes, as this script sees it -------------------------

/**
 * The part of the editor's debug bridge this rig reads.
 *
 * Restated here rather than imported from `apps/editor`: `tooling/` must not
 * depend on an app's source (`pnpm lint:boundaries`), and the bridge is a
 * published shape — a field that disappears from it should break this script
 * loudly rather than quietly report a zero.
 */
interface EditorBridgeShape {
  readonly backend: string;
  readonly frameId: number;
  readonly zoneId: string | null;
  readonly entityCount: number;
  readonly loadedCount: number;
  readonly loadedTextures: readonly string[];
  readonly selection: readonly string[];
  readonly terrain: {
    readonly program: string;
    readonly meshes: number;
    readonly textures: number;
  } | null;
  readonly render: {
    readonly drawCalls: number;
    readonly activeMeshes: number;
    readonly triangles: number;
    readonly frameTimeMs: number;
    readonly frames: number;
    readonly shadowCasters: number;
    readonly sceneTextures: number;
  };
  readonly camera: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly targetX: number;
    readonly targetY: number;
    readonly targetZ: number;
  } | null;
}

/** What the rig installs on the page, beside the editor's own bridge. */
interface PerfProbe {
  /** `performance.now()` of the first click after the probe was installed. */
  t0: number | null;
  /** Milestone name to `performance.now()`, stamped by the page itself. */
  marks: Record<string, number>;
  longTasks: LongTaskEntry[];
  longTasksSupported: boolean;
  /** The largest `loadedTextures.length` seen, and when it was last raised. */
  textureCount: number;
}

interface ProbeWindow {
  readonly __wovEditor?: EditorBridgeShape | undefined;
  __wovPerf?: PerfProbe | undefined;
}

/** Where the canvas-click measurement leaves its two stamps. */
interface ClickWindow {
  __wovClick?: { entered: number | null; left: number | null } | undefined;
}

/** One reading of the render counters, with the page clock it was taken at. */
interface CounterSample extends EditorCounters {
  readonly frameTimeMs: number;
  readonly frames: number;
  /** `performance.now()` in the page when the counters were read. */
  readonly now: number;
}

async function readCounters(page: Page): Promise<CounterSample> {
  return page.evaluate(() => {
    const render = (window as unknown as ProbeWindow).__wovEditor?.render;
    return {
      now: performance.now(),
      frameTimeMs: render?.frameTimeMs ?? 0,
      frames: render?.frames ?? 0,
      drawCalls: render?.drawCalls ?? 0,
      activeMeshes: render?.activeMeshes ?? 0,
      triangles: render?.triangles ?? 0,
      shadowCasters: render?.shadowCasters ?? 0,
      sceneTextures: render?.sceneTextures ?? 0,
    };
  });
}

/**
 * Installs the page-side probe: a long-task observer, a click stamp, and
 * accessors on the bridge counters that record when each milestone was reached.
 *
 * The accessors are the load measurement. `publishEditorDebug` writes the bridge
 * with `Object.assign`, which goes through a setter, so redefining
 * `entityCount`, `loadedCount` and `loadedTextures` as accessors lets the page
 * stamp the exact moment each one landed — without a poll, and therefore without
 * needing a main thread that is free enough to answer one.
 */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe: PerfProbe = {
      t0: null,
      marks: {},
      longTasks: [],
      longTasksSupported: false,
      textureCount: 0,
    };
    (window as unknown as ProbeWindow).__wovPerf = probe;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      probe.longTasksSupported = true;
    } catch {
      // Chromium without the Long Tasks API; the report says so.
    }

    document.addEventListener(
      'click',
      () => {
        probe.t0 ??= performance.now();
      },
      { capture: true },
    );

    const bridge = (window as unknown as ProbeWindow).__wovEditor;
    if (bridge === undefined) {
      throw new Error(
        'no __wovEditor bridge: is this a build with WOV_DEBUG_BRIDGE=1, on ?debug=1',
      );
    }
    const store: Record<string, unknown> = {
      entityCount: bridge.entityCount,
      loadedCount: bridge.loadedCount,
      loadedTextures: bridge.loadedTextures,
    };
    const mark = (name: string): void => {
      probe.marks[name] = performance.now();
    };
    const watch = (key: 'entityCount' | 'loadedCount' | 'loadedTextures'): void => {
      Object.defineProperty(bridge, key, {
        configurable: true,
        enumerable: true,
        get: () => store[key],
        set: (value: unknown) => {
          store[key] = value;
          if (key === 'loadedTextures') {
            const length = Array.isArray(value) ? value.length : 0;
            if (length > probe.textureCount) {
              probe.textureCount = length;
              mark('textures');
            }
            return;
          }
          const count = typeof value === 'number' ? value : 0;
          if (key === 'entityCount' && count > 0 && probe.marks['document'] === undefined) {
            mark('document');
          }
          if (key === 'loadedCount' && probe.marks['models'] === undefined) {
            const entities = typeof store['entityCount'] === 'number' ? store['entityCount'] : 0;
            if (entities > 0 && count >= entities) {
              // The *first* time every entity shows its model, and never again:
              // the same publish runs on every later texture that lands, and
              // taking the last one would report the end of the texture phase
              // under the models' name — measured, they came out identical.
              mark('models');
            }
          }
        },
      });
    };
    watch('entityCount');
    watch('loadedCount');
    watch('loadedTextures');
  });
}

/** Everything the page-side probe collected. */
interface ProbeReadout {
  readonly t0: number | null;
  readonly marks: Record<string, number>;
  readonly longTasks: readonly LongTaskEntry[];
  readonly longTasksSupported: boolean;
  readonly now: number;
}

async function readProbe(page: Page): Promise<ProbeReadout> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__wovPerf;
    return {
      t0: probe?.t0 ?? null,
      marks: { ...(probe?.marks ?? {}) },
      longTasks: [...(probe?.longTasks ?? [])],
      longTasksSupported: probe?.longTasksSupported ?? false,
      now: performance.now(),
    };
  });
}

function longTaskReport(
  readout: ProbeReadout,
  window_?: { from: number; to: number },
): LongTaskReport {
  return {
    supported: readout.longTasksSupported,
    ...aggregateLongTasks(readout.longTasks, window_),
  };
}

/** A CDP profile, taken over whatever the callback does. */
async function profileWhile<T>(
  client: CDPSession,
  samplingIntervalUs: number,
  work: () => Promise<T>,
): Promise<{ result: T; report: ProfileReport }> {
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: samplingIntervalUs });
  await client.send('Profiler.start');
  let result: T;
  let stopped: { profile: CpuProfile } | null = null;
  try {
    result = await work();
  } finally {
    // Stopped whatever happened, or the next profile starts on a profiler that
    // is still running and reports the union of the two.
    stopped = (await client.send('Profiler.stop').catch(() => null)) as {
      profile: CpuProfile;
    } | null;
    await client.send('Profiler.disable').catch(() => undefined);
  }
  const summary = summarizeProfile(stopped?.profile ?? { nodes: [] });
  return {
    result,
    report: {
      samples: summary.samples,
      totalMs: summary.totalMs,
      samplingIntervalUs,
      top: summary.rows.slice(0, 20),
      topSelf: [...summary.rows].sort(bySelfTime).slice(0, 20),
    },
  };
}

function bySelfTime(left: ProfileRow, right: ProfileRow): number {
  return right.selfMs - left.selfMs || left.name.localeCompare(right.name);
}

// --- scenario 1: load --------------------------------------------------------

/**
 * Waits until the bridge answers a predicate, without assuming the main thread
 * is free.
 *
 * `page.waitForFunction` polls with `requestAnimationFrame`, which a blocked
 * thread does not run — the poll simply resumes afterwards, which is what makes
 * it usable here and why every *timing* comes from the page-side marks instead.
 */
async function waitForDocument(page: Page): Promise<void> {
  await page.waitForFunction(
    () => ((window as unknown as ProbeWindow).__wovEditor?.entityCount ?? 0) > 0,
    undefined,
    { timeout: LOAD_TIMEOUT_MS, polling: 250 },
  );
}

async function waitForModels(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const bridge = (window as unknown as ProbeWindow).__wovEditor;
      return (
        bridge !== undefined && bridge.entityCount > 0 && bridge.loadedCount >= bridge.entityCount
      );
    },
    undefined,
    { timeout: LOAD_TIMEOUT_MS, polling: 250 },
  );
}

async function openVillage(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-open-${EDITOR_WORLD_ID}`).click({ timeout: 30_000 });
}

/** The three load milestones, plus the frame that is left once it settles. */
async function measureLoad(
  page: Page,
  client: CDPSession,
  options: Options,
): Promise<{ load: LoadReport; probe: ProbeReadout }> {
  say(`opening ${EDITOR_WORLD_ID} through the File menu`);
  const { result: probe, report: loadProfile } = await profileWhile(
    client,
    options.loadSamplingUs,
    async () => {
      await openVillage(page);
      // The document first: React has the world, the hierarchy has its rows.
      await waitForDocument(page);
      say('  document in; waiting for the models');
      await waitForModels(page);
      say('  models in; waiting for the textures to go quiet');
      // Quiet, not complete: nothing publishes "every texture has arrived", so
      // the honest end of the load is the last time the count grew, confirmed by
      // two seconds in which it did not grow again.
      for (;;) {
        const readout = await readProbe(page);
        const last = readout.marks['textures'] ?? 0;
        if (readout.now - last > TEXTURE_QUIET_MS) {
          break;
        }
        await sleep(TEXTURE_QUIET_MS / 2);
      }
      return readProbe(page);
    },
  );

  const t0 = probe.t0;
  const since = (mark: string): number | null => {
    const at = probe.marks[mark];
    return at === undefined || t0 === null ? null : at - t0;
  };
  const lastMark = Math.max(...Object.values(probe.marks), t0 ?? 0);
  const bridge = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return {
      entityCount: it?.entityCount ?? 0,
      loadedCount: it?.loadedCount ?? 0,
      textures: it?.loadedTextures.length ?? 0,
    };
  });

  const settled = await measureSettledFrame(page, client, options);
  return {
    probe,
    load: {
      documentMs: since('document'),
      modelsMs: since('models'),
      texturesMs: since('textures'),
      entityCount: bridge.entityCount,
      loadedCount: bridge.loadedCount,
      loadedTextureCount: bridge.textures,
      longTasks: longTaskReport(probe, { from: t0 ?? 0, to: lastMark }),
      profile: loadProfile,
      settled,
      // Filled in by the caller: the close frame is taken after this returns,
      // so that the camera it needs is only moved once every timing is in.
      working: null,
    },
  };
}

/**
 * Frames the zone, lets it settle and measures the frames that follow.
 *
 * The camera is put where `F` with nothing selected puts it — the editor's own
 * "frame everything", over the hull of the loaded entities. That is
 * reproducible *because* the rig waits for every model first: the hull of 5273
 * loaded models is the same hull every run, while the hull of a zone that is
 * still half stand-in cubes is not. The position it ended up at is written into
 * the report, so two runs can be checked against each other rather than assumed
 * equal.
 */
async function measureSettledFrame(
  page: Page,
  client: CDPSession,
  options: Options,
): Promise<SettledFrameReport> {
  // Nothing selected: `F` then frames the whole zone.
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyF');
  say(`framed the zone; settling ${String(options.settleSeconds)} s`);
  await sleep(options.settleSeconds * 1_000);

  // The frame window first, with no profiler attached. Measured the other way
  // round the sampling profiler roughly halved the frame rate of a page this
  // heavy — 2.2 fps against 3.1 — and a frame rate measured under a profiler is
  // a frame rate nobody has.
  const before = await readCounters(page);
  await sleep(options.seconds * 1_000);
  const after = await readCounters(page);
  const { report: profile } = await profileWhile(client, options.frameSamplingUs, async () => {
    await sleep(options.seconds * 1_000);
  });
  const camera = await page.evaluate(() => {
    const at = (window as unknown as ProbeWindow).__wovEditor?.camera;
    return {
      position: [at?.x ?? 0, at?.y ?? 0, at?.z ?? 0] as [number, number, number],
      target: [at?.targetX ?? 0, at?.targetY ?? 0, at?.targetZ ?? 0] as [number, number, number],
    };
  });

  const frames = after.frames - before.frames;
  // The wall clock between the two readings, not the sleep it was asked for:
  // enabling, stopping and serialising a CPU profile of a page this heavy takes
  // more than a second of its own, and dividing by the nominal three seconds
  // reported a frame rate the run never had — measured at 6.0 fps against an
  // actual 3.7 on the first baseline.
  const elapsedSeconds = (after.now - before.now) / 1_000;
  return {
    seconds: options.seconds,
    elapsedSeconds,
    frames,
    framesPerSecond: elapsedSeconds > 0 ? frames / elapsedSeconds : 0,
    sceneRenderMs: windowMean(before, after),
    counters: {
      drawCalls: after.drawCalls,
      activeMeshes: after.activeMeshes,
      triangles: after.triangles,
      shadowCasters: after.shadowCasters,
      sceneTextures: after.sceneTextures,
    },
    camera: camera.position,
    cameraTarget: camera.target,
    profile,
  };
}

// --- the gesture both editing scenarios are built from -----------------------

/**
 * Writes a value into a `data-testid` input the way a keystroke would, and
 * reports how long it took until the viewport drew the next frame.
 *
 * All of it inside one `page.evaluate`, deliberately: a change dispatched from
 * Node and a frame counted from Node are two round trips whose latency would be
 * added to every measurement. React's controlled inputs listen for `input`, and
 * the native value setter plus a bubbling `input` event is the same path a typed
 * character takes.
 *
 * @returns `null` when no frame arrived within the budget — a stall that long is
 * a result, and a made-up number would hide it.
 */
async function changeInput(page: Page, testId: string, value: string): Promise<number | null> {
  return page.evaluate(
    async ([id, next, budget]: [string, string, number]) => {
      const element = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
      if (element === null) {
        throw new Error(`no input with data-testid="${id}"`);
      }
      const bridge = (window as unknown as ProbeWindow).__wovEditor;
      const frameBefore = bridge?.frameId ?? -1;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.bind(element);
      const started = performance.now();
      setter?.(next);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      for (;;) {
        if ((bridge?.frameId ?? -1) > frameBefore) {
          return performance.now() - started;
        }
        if (performance.now() - started > budget) {
          return null;
        }
        await new Promise((wake) => requestAnimationFrame(() => wake(undefined)));
      }
    },
    [testId, value, 60_000] as [string, string, number],
  );
}

/**
 * How long the viewport takes to draw a frame when nothing is being edited.
 *
 * The floor under every latency in the two editing scenarios, and without it
 * they cannot be read: "890 ms from the input to the next frame" is a stall if
 * frames are 16 ms apart and is *two ordinary frames* if they are 450 ms apart.
 * Both scenarios measure it immediately before their gestures, in the same
 * page, so the comparison is with the frame rate that run actually had.
 *
 * The first interval is dropped: it starts wherever the sample happened to
 * begin inside a frame, not at a frame boundary.
 */
async function measureFrameInterval(page: Page, samples: number): Promise<number[]> {
  const intervals = await page.evaluate(async (count: number) => {
    const bridge = (window as unknown as ProbeWindow).__wovEditor;
    const measured: number[] = [];
    let seen = bridge?.frameId ?? -1;
    let last = performance.now();
    const deadline = last + 60_000;
    while (measured.length < count && performance.now() < deadline) {
      const current = bridge?.frameId ?? -1;
      if (current > seen) {
        seen = current;
        const now = performance.now();
        measured.push(now - last);
        last = now;
      } else {
        await new Promise((wake) => requestAnimationFrame(() => wake(undefined)));
      }
    }
    return measured;
  }, samples + 1);
  return intervals.slice(1);
}

// --- scenario 2: dial --------------------------------------------------------

async function measureDial(page: Page): Promise<DialReport> {
  await page.getByTestId('right-tab-zone').click();
  await page.getByTestId('ground-metallic-0').waitFor({ timeout: 60_000 });

  const before = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return {
      program: it?.terrain?.program ?? null,
      terrainTextures: it?.terrain?.textures ?? null,
      sceneTextures: it?.render.sceneTextures ?? 0,
    };
  });
  const idle = await measureFrameInterval(page, 4);
  const started = (await readProbe(page)).now;

  const latencies: number[] = [];
  for (let index = 0; index < DIAL_CHANGES; index += 1) {
    const value = dialValueAt(index);
    const took = await changeInput(page, 'ground-metallic-0', String(value));
    say(`  metallic ${String(value)} → ${took === null ? 'no frame' : `${took.toFixed(0)} ms`}`);
    if (took !== null) {
      latencies.push(took);
    }
  }

  const finished = await readProbe(page);
  const after = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return {
      program: it?.terrain?.program ?? null,
      terrainTextures: it?.terrain?.textures ?? null,
      sceneTextures: it?.render.sceneTextures ?? 0,
    };
  });

  return {
    changes: DIAL_CHANGES,
    idleFrameMs: summariseDurations(idle),
    toNextFrameMs: latencies,
    summary: summariseDurations(latencies),
    longTasks: longTaskReport(finished, { from: started, to: finished.now }),
    programBefore: before.program,
    programAfter: after.program,
    programChanged: before.program !== after.program,
    sceneTexturesBefore: before.sceneTextures,
    sceneTexturesAfter: after.sceneTextures,
    terrainTexturesBefore: before.terrainTextures,
    terrainTexturesAfter: after.terrainTextures,
  };
}

// --- scenario 3: rebuild -----------------------------------------------------

/**
 * Flips the facet switch and waits for the tile on screen to carry the new
 * program.
 *
 * The witness is `terrain.program` off the material, not the checkbox and not
 * the document: a command that reaches the document while the viewport keeps
 * its old tile leaves every other number in this report unchanged. Timed inside
 * the page for the same reason `changeInput` is — the thread being measured is
 * the one that would have to answer a round trip.
 */
async function toggleFacets(
  page: Page,
): Promise<{ ms: number | null; program: string | null; meshes: number | null }> {
  return page.evaluate(
    async ([id, budget]: [string, number]) => {
      const element = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
      if (element === null) {
        throw new Error(`no input with data-testid="${id}"`);
      }
      const bridge = (window as unknown as ProbeWindow).__wovEditor;
      const before = bridge?.terrain?.program ?? null;
      const started = performance.now();
      element.click();
      for (;;) {
        const tile = bridge?.terrain ?? null;
        const program = tile?.program ?? null;
        if (program !== before) {
          return {
            ms: performance.now() - started,
            program,
            meshes: tile?.meshes ?? null,
          };
        }
        if (performance.now() - started > budget) {
          return { ms: null, program, meshes: tile?.meshes ?? null };
        }
        await new Promise((wake) => requestAnimationFrame(() => wake(undefined)));
      }
    },
    ['ground-flatNormals', 120_000] as [string, number],
  );
}

async function measureRebuild(page: Page): Promise<RebuildReport> {
  await page.getByTestId('right-tab-zone').click();
  await page.getByTestId('ground-flatNormals').waitFor({ timeout: 60_000 });

  const before = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return {
      terrainTextures: it?.terrain?.textures ?? null,
      terrainMeshes: it?.terrain?.meshes ?? null,
      sceneTextures: it?.render.sceneTextures ?? 0,
    };
  });
  const idle = await measureFrameInterval(page, 4);
  const started = (await readProbe(page)).now;

  const latencies: (number | null)[] = [];
  const programs: (string | null)[] = [];
  for (let index = 0; index < REBUILD_TOGGLES; index += 1) {
    const step = await toggleFacets(page);
    say(
      `  flatNormals #${String(index + 1)} → ` +
        `${step.ms === null ? 'no new tile' : `${step.ms.toFixed(0)} ms`} (${step.program ?? 'none'})`,
    );
    latencies.push(step.ms);
    programs.push(step.program);
  }

  const finished = await readProbe(page);
  const after = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return {
      terrainTextures: it?.terrain?.textures ?? null,
      terrainMeshes: it?.terrain?.meshes ?? null,
      sceneTextures: it?.render.sceneTextures ?? 0,
    };
  });

  return {
    toggles: REBUILD_TOGGLES,
    idleFrameMs: summariseDurations(idle),
    toNewProgramMs: latencies,
    summary: summariseDurations(latencies.filter((each): each is number => each !== null)),
    longTasks: longTaskReport(finished, { from: started, to: finished.now }),
    programs,
    sceneTexturesBefore: before.sceneTextures,
    sceneTexturesAfter: after.sceneTextures,
    terrainTexturesBefore: before.terrainTextures,
    terrainTexturesAfter: after.terrainTextures,
    terrainMeshesBefore: before.terrainMeshes,
    terrainMeshesAfter: after.terrainMeshes,
  };
}

// --- scenario 4: edit --------------------------------------------------------

async function measureEdit(page: Page): Promise<EditReport> {
  const startedAt = (await readProbe(page)).now;
  await page.getByTestId('right-tab-entity').click();
  const row = page.getByTestId(`hierarchy-entity-${EDIT_ENTITY_ID}`);
  await row.click({ timeout: 60_000 });
  const selected = await page.evaluate(
    (id: string) => (window as unknown as ProbeWindow).__wovEditor?.selection.includes(id) ?? false,
    EDIT_ENTITY_ID,
  );
  if (!selected) {
    say(`  warning: clicking the row did not select ${EDIT_ENTITY_ID}`);
  }

  const idle = await measureFrameInterval(page, 4);
  const startX = Number(await page.getByTestId('inspector-position-x').inputValue());
  const latencies: number[] = [];
  for (let index = 0; index < EDIT_NUDGES; index += 1) {
    const next = startX + EDIT_NUDGE_METRES * (index + 1);
    const took = await changeInput(page, 'inspector-position-x', next.toFixed(3));
    say(`  x = ${next.toFixed(3)} → ${took === null ? 'no frame' : `${took.toFixed(0)} ms`}`);
    if (took !== null) {
      latencies.push(took);
    }
  }
  const afterNudges = (await readProbe(page)).now;

  const click = await measureCanvasClick(page);
  const readout = await readProbe(page);
  say(
    `  canvas click: pointerup ${click.pointerUpMs === null ? 'n/a' : `${click.pointerUpMs.toFixed(0)} ms`}`,
  );
  return {
    entityId: EDIT_ENTITY_ID,
    selected,
    idleFrameMs: summariseDurations(idle),
    toNextFrameMs: latencies,
    summary: summariseDurations(latencies),
    longTasks: longTaskReport(readout, { from: startedAt, to: afterNudges }),
    pointerUpMs: click.pointerUpMs,
    clickLongTasks: longTaskReport(readout, { from: click.from, to: readout.now }),
  };
}

/**
 * One click in the middle of the canvas with the select tool, timed around the
 * viewport's own `pointerup` listener.
 *
 * Measured with a capture listener on `window` and a bubble listener on
 * `window`: the viewport's handler sits on the canvas in between, so the gap
 * between the two stamps is what the whole pick took — `scene.pick` against
 * every mesh in the zone, and whatever the selection change costs downstream of
 * it. Wrapping the handler itself would need the app's own code to cooperate
 * with the rig, which is the coupling the bridge exists to avoid.
 *
 * The select tool is the editor's default and nothing here changes it, so this
 * is a plain selection click and not a placement.
 */
async function measureCanvasClick(page: Page): Promise<{
  pointerUpMs: number | null;
  from: number;
}> {
  await page.evaluate(() => {
    const stamps: { entered: number | null; left: number | null } = { entered: null, left: null };
    (window as unknown as ClickWindow).__wovClick = stamps;
    window.addEventListener(
      'pointerup',
      () => {
        stamps.entered = performance.now();
      },
      { capture: true, once: true },
    );
    window.addEventListener(
      'pointerup',
      () => {
        stamps.left = performance.now();
      },
      { once: true },
    );
  });

  const box = await page.getByTestId('editor-canvas').boundingBox();
  const from = (await readProbe(page)).now;
  if (box === null) {
    return { pointerUpMs: null, from };
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const stamps = await page.evaluate(() => (window as unknown as ClickWindow).__wovClick ?? null);
  const entered = stamps?.entered ?? null;
  const left = stamps?.left ?? null;
  return { pointerUpMs: entered === null || left === null ? null : left - entered, from };
}

/**
 * Puts the camera where an author works: one building, framed.
 *
 * The rig's own settled frame is taken at `F` over the whole zone, 1 967 m up
 * and about 4 m to the pixel, where the village covers 3.5 % of the canvas.
 * That view is the right one for a frame time and useless as picture evidence,
 * so every scenario also leaves behind a canvas taken from here.
 *
 * Deterministic for the same reason the zone framing is: the hull being framed
 * is one fixed entity's, and the rig has already waited for every model.
 */
async function frameWorkingCamera(page: Page): Promise<boolean> {
  await page.getByTestId('right-tab-entity').click();
  const row = page.getByTestId(`hierarchy-entity-${EDIT_ENTITY_ID}`);
  try {
    await row.click({ timeout: 60_000 });
  } catch {
    say(`  warning: could not frame ${EDIT_ENTITY_ID}; the close frame is the far one`);
    return false;
  }
  await page.keyboard.press('KeyF');
  // Deselected again: a selection outline is the same bright colour under every
  // build and would be the loudest thing in a picture comparison.
  await page.keyboard.press('Escape');
  await sleep(WORKING_SETTLE_MS);
  return true;
}

/** Puts the camera back over the whole zone, where every other number is taken. */
async function frameZoneCamera(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyF');
  await sleep(WORKING_SETTLE_MS);
}

/** Counters and a frame time at whatever camera is current, with no profiler. */
async function measureWorkingFrame(
  page: Page,
  framed: boolean,
  seconds: number,
): Promise<WorkingFrameReport> {
  const before = await readCounters(page);
  await sleep(seconds * 1_000);
  const after = await readCounters(page);
  const camera = await page.evaluate(() => {
    const at = (window as unknown as ProbeWindow).__wovEditor?.camera;
    return {
      position: [at?.x ?? 0, at?.y ?? 0, at?.z ?? 0] as [number, number, number],
      target: [at?.targetX ?? 0, at?.targetY ?? 0, at?.targetZ ?? 0] as [number, number, number],
    };
  });
  const frames = after.frames - before.frames;
  const elapsedSeconds = (after.now - before.now) / 1_000;
  return {
    entityId: EDIT_ENTITY_ID,
    framed,
    seconds,
    elapsedSeconds,
    frames,
    framesPerSecond: elapsedSeconds > 0 ? frames / elapsedSeconds : 0,
    sceneRenderMs: windowMean(before, after),
    counters: {
      drawCalls: after.drawCalls,
      activeMeshes: after.activeMeshes,
      triangles: after.triangles,
      shadowCasters: after.shadowCasters,
      sceneTextures: after.sceneTextures,
    },
    camera: camera.position,
    cameraTarget: camera.target,
  };
}

// --- the run -----------------------------------------------------------------

async function measure(
  options: Options,
  page: Page,
  origins: ReadonlySet<string>,
): Promise<{
  report: EditorPerfReport;
  frames: Map<string, { width: number; height: number; bytes: Uint8Array }>;
}> {
  const url = `${editorUrl}/?debug=1`;
  say(`opening ${url}`);
  // `tsx` runs this file through esbuild with `keepNames`, which rewrites every
  // named function inside a `page.evaluate` body to `__name(fn, "…")` — and
  // `__name` is a helper esbuild puts in the *Node* module, not in the page. So
  // the probe below would die with `ReferenceError: __name is not defined` the
  // moment it declares a helper. A raw string, not a function: a shim written as
  // a function would be transpiled by the same pass it is meant to survive.
  await page.addInitScript({
    content: 'globalThis.__name = globalThis.__name || function (value) { return value; };',
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      /^viewport ready/.test(
        document.querySelector('[data-testid="editor-viewport-status"]')?.textContent ?? '',
      ),
    undefined,
    { timeout: 120_000 },
  );
  await installProbe(page);

  const client = await page.context().newCDPSession(page);
  const frames = new Map<string, { width: number; height: number; bytes: Uint8Array }>();
  const canvas = '[data-testid="editor-canvas"]';

  const { load } = await measureLoad(page, client, options);
  frames.set('load', await readCanvas(page, canvas));

  // The same picture from a camera an author would be at, and the counters
  // that camera changes. Taken once, right after the load, and then the camera
  // goes back over the zone so every timing below is measured at the view the
  // baselines were measured at.
  say('framing one building for the close picture');
  const framed = await frameWorkingCamera(page);
  const working = await measureWorkingFrame(page, framed, options.seconds);
  frames.set('load.close', await readCanvas(page, canvas));
  await frameZoneCamera(page);

  let dial: DialReport | null = null;
  if (options.scenarios.includes('dial')) {
    say('dial: ten ground-metallic changes');
    dial = await measureDial(page);
    frames.set('dial', await readCanvas(page, canvas));
    await frameWorkingCamera(page);
    frames.set('dial.close', await readCanvas(page, canvas));
    await frameZoneCamera(page);
  }

  let rebuild: RebuildReport | null = null;
  if (options.scenarios.includes('rebuild')) {
    say(`rebuild: ${String(REBUILD_TOGGLES)} flatNormals toggles`);
    rebuild = await measureRebuild(page);
    frames.set('rebuild', await readCanvas(page, canvas));
    await frameWorkingCamera(page);
    frames.set('rebuild.close', await readCanvas(page, canvas));
    await frameZoneCamera(page);
  }

  let edit: EditReport | null = null;
  if (options.scenarios.includes('edit')) {
    say(`edit: ${EDIT_ENTITY_ID}`);
    edit = await measureEdit(page);
    frames.set('edit', await readCanvas(page, canvas));
    await frameWorkingCamera(page);
    frames.set('edit.close', await readCanvas(page, canvas));
    await frameZoneCamera(page);
  }

  const identity = await page.evaluate(() => {
    const it = (window as unknown as ProbeWindow).__wovEditor;
    return { backend: it?.backend ?? 'unknown', zoneId: it?.zoneId ?? null };
  });
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };

  return {
    frames,
    report: {
      label: options.label,
      rig: 'editor',
      takenAt: new Date().toISOString(),
      url,
      worldId: EDITOR_WORLD_ID,
      zoneId: identity.zoneId,
      backend: identity.backend,
      scenarios: options.scenarios,
      viewport: { width: viewport.width, height: viewport.height },
      assetStore: process.env['WOV_ASSET_STORE'] ?? null,
      servers: { editorUrl, apiUrl, assetUrl, origins: [...origins].sort() },
      load: { ...load, working },
      dial,
      rebuild,
      edit,
    },
  };
}

/**
 * Refuses a run whose page is not talking to the servers this run started.
 *
 * The bundle in `apps/editor/dist` carries the API and asset URLs it was
 * *built* with, and `--skip-build` serves whatever is there. Another worktree,
 * another branch or an earlier rig run on other ports leaves a bundle that
 * fetches its worlds and its models from somebody else's servers — and the run
 * either dies at the ten-minute model timeout with no report, or finishes and
 * quietly reports a measurement of another checkout's content.
 *
 * Checked against the origins the page really used, not against an environment
 * variable: what the bundle was told at build time is exactly the thing in
 * doubt.
 */
function assertOwnServers(origins: ReadonlySet<string>): void {
  const wanted = [apiUrl, assetUrl];
  const missing = wanted.filter((origin) => !origins.has(origin));
  const strangers = [...origins].filter(
    (origin) => origin !== editorUrl && !wanted.includes(origin) && origin.includes('localhost'),
  );
  if (missing.length === 0 && strangers.length === 0) {
    return;
  }
  throw new Error(
    "the page is not talking to this run's servers: " +
      `expected ${wanted.join(' and ')}` +
      (missing.length > 0 ? `, never reached ${missing.join(' and ')}` : '') +
      (strangers.length > 0 ? `, reached ${strangers.join(' and ')} instead` : '') +
      '. The editor bundle carries the URLs it was built with — drop --skip-build.',
  );
}

function milliseconds(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(0)} ms`;
}

/**
 * Writes what the run knew when it fell over.
 *
 * Not an `EditorPerfReport`: it is deliberately a different file
 * (`<label>.editor.partial.json`) with a different shape, so nothing can mistake
 * a failed run for a measurement. What it carries is what a diagnosis needs and
 * a stack trace does not have — which milestones were reached, how many of the
 * entities had their models, and which servers the page was actually talking
 * to.
 */
async function writePartialReport(
  options: Options,
  page: Page,
  origins: ReadonlySet<string>,
  error: unknown,
): Promise<void> {
  const state = await page
    .evaluate(() => {
      const it = (window as unknown as ProbeWindow).__wovEditor;
      const probe = (window as unknown as ProbeWindow).__wovPerf;
      return {
        zoneId: it?.zoneId ?? null,
        entityCount: it?.entityCount ?? null,
        loadedCount: it?.loadedCount ?? null,
        loadedTextureCount: it?.loadedTextures.length ?? null,
        marks: probe?.marks ?? {},
        longTaskCount: probe?.longTasks.length ?? null,
      };
    })
    .catch(() => null);
  const partial = {
    label: options.label,
    rig: 'editor',
    failed: true,
    takenAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message : String(error),
    servers: { editorUrl, apiUrl, assetUrl, origins: [...origins].sort() },
    state,
  };
  await mkdir(options.outDir, { recursive: true });
  const path = join(options.outDir, `${options.label}.editor.partial.json`);
  await writeFile(path, `${JSON.stringify(partial, null, 2)}\n`);
  say(`the run did not finish; what it knew is in ${path}`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const servers: ChildProcess[] = [];
  let browser: Browser | undefined;

  if ((process.env['WOV_ASSET_STORE'] ?? '').trim() === '') {
    say(
      'WOV_ASSET_STORE is not set: the editor will fall back to placeholder cubes ' +
        'and every number below will be about cubes.',
    );
  }

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

    // The editor can save; never at the repository's content (agent contract).
    const contentDir = throwawayContentDir();
    say(`api content: ${contentDir}`);
    say('starting api, assets and the preview server');
    servers.push(
      serve('pnpm', ['--filter', '@wov/api', 'dev'], {
        API_PORT: String(API_PORT),
        CONTENT_DIR: contentDir,
        API_CORS_ORIGINS: editorUrl,
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

    browser = await launchPerfBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // Every origin the page fetches from, so the run can prove afterwards which
    // servers answered it (`assertOwnServers`).
    const origins = new Set<string>();
    page.on('request', (request) => {
      try {
        origins.add(new URL(request.url()).origin);
      } catch {
        // A `data:` or `blob:` URL; nothing to attribute.
      }
    });

    let report: EditorPerfReport;
    let frames: Map<string, { width: number; height: number; bytes: Uint8Array }>;
    try {
      ({ report, frames } = await measure(options, page, origins));
    } catch (error) {
      // Ten minutes of measurement is too much to throw away because the run
      // did not reach its last milestone. What is known goes to disk first, and
      // then the error is raised — a run that failed and left nothing behind is
      // a run nobody can diagnose.
      await writePartialReport(options, page, origins, error);
      assertOwnServers(origins);
      throw error;
    }
    assertOwnServers(origins);

    await mkdir(options.outDir, { recursive: true });
    const stem = join(options.outDir, `${options.label}.editor`);
    await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
    for (const [scenario, frame] of frames) {
      await writeFile(`${stem}.${scenario}.rgba`, frame.bytes);
    }
    await page.screenshot({ path: `${stem}.png` });

    const load = report.load;
    say('');
    say(`${options.label} · editor · ${report.worldId} · ${report.backend}`);
    say(
      `  load: document ${milliseconds(load.documentMs)} · models ${milliseconds(load.modelsMs)} · ` +
        `textures ${milliseconds(load.texturesMs)}`,
    );
    say(
      `  blocked: ${load.longTasks.totalMs.toFixed(0)} ms in ${String(load.longTasks.count)} long tasks · ` +
        `worst ${load.longTasks.longestMs.toFixed(0)} ms` +
        (load.longTasks.supported ? '' : ' (longtask API unavailable)'),
    );
    const settled = load.settled;
    say(
      `  settled frame: scene.render ${settled.sceneRenderMs?.toFixed(2) ?? 'n/a'} ms · ` +
        `${settled.framesPerSecond.toFixed(1)} fps · ${String(settled.counters.drawCalls)} draw calls · ` +
        `${String(settled.counters.activeMeshes)} active meshes · ` +
        `${String(settled.counters.shadowCasters)} shadow casters`,
    );
    const working = load.working;
    if (working !== null) {
      say(
        `  one building framed: scene.render ${working.sceneRenderMs?.toFixed(2) ?? 'n/a'} ms · ` +
          `${working.framesPerSecond.toFixed(1)} fps · ${String(working.counters.drawCalls)} draw calls · ` +
          `${String(working.counters.activeMeshes)} active meshes` +
          (working.framed ? '' : ' (could not frame it; this is the far view)'),
      );
    }
    if (report.dial !== null) {
      say(
        `  dial: median ${report.dial.summary.medianMs.toFixed(0)} ms · ` +
          `worst ${report.dial.summary.maxMs.toFixed(0)} ms · ` +
          `idle frame ${report.dial.idleFrameMs.medianMs.toFixed(0)} ms · ` +
          `textures ${String(report.dial.sceneTexturesBefore)} → ${String(report.dial.sceneTexturesAfter)}`,
      );
    }
    if (report.rebuild !== null) {
      say(
        `  rebuild: median ${report.rebuild.summary.medianMs.toFixed(0)} ms · ` +
          `worst ${report.rebuild.summary.maxMs.toFixed(0)} ms · ` +
          `idle frame ${report.rebuild.idleFrameMs.medianMs.toFixed(0)} ms · ` +
          `blocked ${report.rebuild.longTasks.totalMs.toFixed(0)} ms · ` +
          `tile meshes ${String(report.rebuild.terrainMeshesBefore)} → ` +
          `${String(report.rebuild.terrainMeshesAfter)} · ` +
          `textures ${String(report.rebuild.sceneTexturesBefore)} → ${String(report.rebuild.sceneTexturesAfter)}`,
      );
    }
    if (report.edit !== null) {
      say(
        `  edit: median ${report.edit.summary.medianMs.toFixed(0)} ms · ` +
          `idle frame ${report.edit.idleFrameMs.medianMs.toFixed(0)} ms · ` +
          `pointerup ${milliseconds(report.edit.pointerUpMs)}`,
      );
    }
    say('');
    say('load profile, heaviest self time first:');
    say(formatProfileTable({ ...load.profile, rows: load.profile.topSelf }, 10));
    say('');
    say('settled frame, heaviest self time first:');
    say(formatProfileTable({ ...settled.profile, rows: settled.profile.topSelf }, 10));
    say('');
    say(`written to ${stem}.json, .png and one .rgba per scenario`);
  } finally {
    await browser?.close();
    for (const server of servers) {
      stop(server);
    }
  }
}

await main();
