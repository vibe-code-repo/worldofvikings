/**
 * Flight-mode ("Testflug") benchmark: what does working on an island cost in the
 * offline editor flight, with the build camera (bird's eye view) and not only at eye level?
 *
 * Testflug = the real game client, offline, with the editor draft as world
 * (`?offline=1&layout=editor`). Every run starts a FRESH browser (cold height-map cache,
 * cold terrain ring, cold vegetation preview), loads the draft into localStorage, spawns at
 * `?pos=x,z` and then plays a fixed script of phases: still, fly 15 m/s, fly 45 m/s, jump to a
 * far site. Everything is measured in the page with the same clock:
 *
 *   - frame intervals (requestAnimationFrame) -> p50/p95/p99/max, share over 16.7/33/50 ms
 *   - draw calls, triangles and instances submitted per frame (all passes, wrapped on the
 *     engine's drawElementsType/drawArraysType)
 *   - terrain window: near chunks inside the ring, far chunks, build queues
 *   - zone streaming: zones built per second, time spent building height maps (`getZone`
 *     path), time spent in the vegetation preview per zone (`streueZone` plus instance set-up),
 *     re-creations of zones the LRU had already dropped, evictions
 *   - memory: JS heap, an estimate of GPU vertex/index/instance buffers
 *   - "time to standing picture": ms from the jump (or from navigation) until the terrain
 *     queues are empty and the preview ring is complete for three frames in a row
 *
 * The counters are attached from OUTSIDE at run time (wrapping instance methods of the height-map
 * provider and the terrain manager, and the vegetation preview via `window.__bewuchs`). The
 * only client hook needed is the query parameter `?bewuchs-messung=1`, which the flight
 * (`client/src/editor/testflug/BewuchsStufe.ts`) answers by exposing the preview as
 * `window.__bewuchs`; the bench adds it to the address itself. Without the parameter the client
 * exposes nothing.
 *
 * Knobs that are only test variants (never product code): `detail` (terrain view/far ring
 * preset 0..3), `window` ({view, far} custom rings), `previewStufe` ('voll' | 'klein' | 'aus':
 * the level switch of the flight, key L; `previewOff: true` is the old spelling of 'aus'),
 * `previewNoPrune` (switches the clean-up of the preview off again = the behaviour before K2.1,
 * for same-window comparisons), `lru` (height-map cache size in zones; the client default is
 * 1024, use 512 for the state before K2.1), `settings` (game settings via `__vb.setze`,
 * e.g. {grassDensity: 0}), `previewNachlauf` (grace period in ms before a zone is released; client default 1000, 0 = none).
 * Clean-up costs are counted per phase (`streaming.cleanup*`). A phase may carry `wiggle: {x0, z0, amp, every}`
 * (hop across a zone edge; `every` frames per side) instead of a key or `auto` speed.
 * A phase may switch the level first: `previewStufe` (then `settleS` seconds pass before it is measured).
 * `--headless-gpu` runs without a desktop session (see HEADLESS_GPU below).
 *
 * GPU LOCK: the script re-executes itself under `flock ~/.cache/wov-mess.lock` and holds it
 * only for the runs of ONE plan file. `--max-min` stops starting new runs after that many
 * minutes (default 8) so blocks stay short; runs with an existing result file are skipped, so
 * the same command resumes where it stopped. Run it as a block, never idle.
 *
 * Usage (on mike-pc, DISPLAY/XAUTHORITY set, Vite reachable on --url):
 *   node pw-testflug-bench.mjs --plan plan.json --world dev.json --out res/ [--url http://127.0.0.1:5293]
 *
 * Plan = JSON array of runs:
 *   { id, site:{x,z,yaw,yaw2}, posture:{bau,hp,boom,pitch}, detail?, window?, previewOff?,
 *     previewRadius?, phases:[{name, s, keys?, from?, settleS?, untilSteady?}], jump:{x,z,yaw} }
 *   posture.hp   = player height above the ground (build mode), posture.boom/pitch = camera boom
 *   yaw follows the game: forward = (-sin yaw, -cos yaw), yaw 0 = towards -z.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (!process.env.WOV_MESSSPERRE_GEHALTEN && !process.argv.includes('--functional')) {
  const lockFile = `${process.env.HOME}/.cache/wov-mess.lock`;
  mkdirSync(dirname(lockFile), { recursive: true });
  try {
    execFileSync('flock', ['-w', '900', lockFile, process.execPath, process.argv[1], ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, WOV_MESSSPERRE_GEHALTEN: '1', WOV_BLOCK_QUEUED_MS: String(Date.now()) },
    });
  } catch (e) {
    process.exit(typeof e.status === 'number' ? e.status : 1);
  }
  process.exit(0);
}

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const URL_BASE = arg('url', 'http://127.0.0.1:5293');
const PLAN = JSON.parse(readFileSync(arg('plan', 'plan.json'), 'utf8'));
const WORLD_JSON = readFileSync(arg('world', 'dev.json'), 'utf8');
const OUT = arg('out', 'res');
const MAX_MIN = Number(arg('max-min', 8));
/** Seconds this block waited for the GPU lock (0 when started without the wrapper). */
const LOCK_WAIT_S = process.env.WOV_BLOCK_QUEUED_MS ? +((Date.now() - Number(process.env.WOV_BLOCK_QUEUED_MS)) / 1000).toFixed(1) : 0;
const TIME_OF_DAY = arg('t', '0.708333');
/** Per-run limit in seconds; default: 150 s cold start + the phases + 60 s (a hung page is then cut off early instead of after 7 min). */
const RUN_TIMEOUT_ARG = arg('run-timeout', '');
const runTimeoutS = (run) => (RUN_TIMEOUT_ARG ? Number(RUN_TIMEOUT_ARG) : run.timeoutS ? run.timeoutS : 150 + run.phases.reduce((n, p) => n + (p.s ?? 0) + (p.settleS ?? 0), 0) + 60);
/** A run that fails (hung page, lost context) is repeated once; both attempts are kept in the result (`attempts`). */
const MAX_ATTEMPTS = Number(arg('attempts', 2));
const ONLY = arg('only', '');
/** Functional check only (headless, software renderer allowed, small window): numbers are NOT valid measurements. */
const FUNCTIONAL = process.argv.includes('--functional');
/**
 * No desktop session (nobody logged in on the measuring PC): run the full Chromium headless with the GPU
 * through ANGLE/EGL (radeonsi) instead of a visible X11 window. Still a hardware renderer (the run
 * refuses software ones); numbers are comparable within one mode, not with the windowed mode.
 */
const HEADLESS_GPU = process.argv.includes('--headless-gpu');
/** Only the frame recorder is attached (control run for the overhead of the counters). */
const MINIMAL = process.argv.includes('--minimal');
mkdirSync(OUT, { recursive: true });

/** AMD GPU busy percentage from sysfs (foreign load check), null when unavailable. */
function gpuBusy() {
  for (let c = 0; c < 4; c++) {
    try {
      return Number(readFileSync(`/sys/class/drm/card${c}/device/gpu_busy_percent`, 'utf8').trim());
    } catch {
      /* next card */
    }
  }
  return null;
}
/** System-wide CPU counters from /proc/stat (busy, total jiffies) and the 1-minute load average. */
function cpuTimes() {
  try {
    const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
    const idle = f[3] + (f[4] || 0);
    const total = f.reduce((a, b) => a + b, 0);
    return { busy: total - idle, total };
  } catch {
    return null;
  }
}
/** The five biggest CPU consumers right now (foreign load check). */
function topProcs() {
  try {
    return execFileSync('ps', ['-eo', 'pcpu,comm', '--sort=-pcpu', '--no-headers'], { encoding: 'utf8' }).split('\n').slice(0, 6).map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}
const loadAvg = () => {
  try {
    return Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
  } catch {
    return null;
  }
};
/** Resident memory (MB) of everything this process started (browser, GPU process, renderers): the real footprint. */
function childTreeRssMB() {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 3 && !r.some(Number.isNaN));
    const kids = new Map();
    for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push({ pid, rss }); }
    let sum = 0;
    const stack = [process.pid];
    while (stack.length) for (const c of kids.get(stack.pop()) ?? []) { sum += c.rss; stack.push(c.pid); }
    return +(sum / 1024).toFixed(0);
  } catch {
    return null;
  }
}
/**
 * Foreign-load guard: other sessions run their own (software-rendered) browsers on the measuring PC without the GPU
 * lock, and a run made next to them is not comparable. Before a run, wait (up to ~90 s) for the whole machine to be
 * quiet (system CPU below `QUIET_CPU` percent over 3 s); the result records what was seen (`quietBefore`).
 */
const QUIET_CPU = Number(arg('quiet-cpu', 12));
async function waitQuiet() {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const a = cpuTimes();
    await sleep(3000);
    const b = cpuTimes();
    const busy = a && b ? +((100 * (b.busy - a.busy)) / (b.total - a.total)).toFixed(1) : null;
    seen.push(busy);
    if (busy === null || busy < QUIET_CPU) return { quiet: true, seen };
    await sleep(12000);
  }
  return { quiet: false, seen };
}
/** CPU share (percent of one core) of a named foreign process over 2 s, e.g. `llama-server` on the same GPU; null when not running. */
async function foreignCpuPct(name) {
  try {
    const pids = execFileSync('pgrep', ['-x', name], { encoding: 'utf8' }).split('\n').filter(Boolean);
    if (pids.length === 0) return null;
    const ticks = () => pids.reduce((n, pid) => { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return n + Number(f[11]) + Number(f[12]); }, 0);
    const a = ticks();
    await sleep(2000);
    const b = ticks();
    return { pids: pids.length, cpuPct: +(((b - a) / 100 / 2) * 100).toFixed(1) };
  } catch {
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

/** Page-side instrumentation. Runs once per page after the world exists. */
function instrument(minimal) {
  const W = window;
  if (W.__m) return true;
  const dbg = W.__dbg;
  const world = dbg.world;
  const hm = world.heightmaps;
  const terr = dbg.terrain;
  const bew = W.__bewuchs;
  const engine = dbg.scene.getEngine();
  const player = dbg.player;
  const M = (W.__m = {
    hmMs: 0, hmCalls: 0, hmBuilt: 0, hmMax: 0,
    zoneNew: 0, zoneRe: 0, evict: 0, seen: new Set(), lastDel: null,
    chunkBuilds: 0, farBuilds: 0,
    streuMs: 0, streuOnlyMs: 0, streuCalls: 0, streuMax: 0,
    abbauMs: 0, abbauRemoveMs: 0, abbauCalls: 0, abbauPlants: 0, abbauMax: 0,
    dc: 0, tris: 0, inst: 0,
    frames: [], last: performance.now(), series: [],
    hp: null, auto: 0,
    steadyArmed: false, nearRun: 0, fullRun: 0, nearAt: null, fullAt: null,
  });

  const zones = hm.zones;
  if (!minimal) {
  // -- height-map provider: creation time, re-creations, evictions --
  const zoneSet = zones.set.bind(zones);
  const zoneDelete = zones.delete.bind(zones);
  zones.set = (k, v) => {
    if (M.lastDel === k) M.lastDel = null; // LRU touch (delete + set)
    else {
      M.zoneNew++;
      if (M.seen.has(k)) M.zoneRe++;
      else M.seen.add(k);
    }
    return zoneSet(k, v);
  };
  zones.delete = (k) => {
    if (zones.size > hm.maxCachedZones) M.evict++;
    else if (zones.has(k)) M.lastDel = k;
    return zoneDelete(k);
  };
  const viaCache = hm.zoneAusCache.bind(hm);
  hm.zoneAusCache = (x, y) => {
    if (zones.has(`${x},${y}`)) return viaCache(x, y);
    const t = performance.now();
    const r = viaCache(x, y);
    const d = performance.now() - t;
    M.hmMs += d; M.hmCalls++; M.hmBuilt++;
    if (d > M.hmMax) M.hmMax = d;
    return r;
  };
  const viaRows = hm.zoneSchrittweise.bind(hm);
  hm.zoneSchrittweise = (x, y, rows) => {
    if (zones.has(`${x},${y}`)) return viaRows(x, y, rows);
    const t = performance.now();
    const r = viaRows(x, y, rows);
    const d = performance.now() - t;
    M.hmMs += d; M.hmCalls++;
    if (r !== null) M.hmBuilt++;
    if (d > M.hmMax) M.hmMax = d;
    return r;
  };

  // -- terrain manager: chunk builds --
  const chunkSet = terr.chunks.set.bind(terr.chunks);
  terr.chunks.set = (k, v) => { M.chunkBuilds++; return chunkSet(k, v); };
  const farSet = terr.farChunks.set.bind(terr.farChunks);
  terr.farChunks.set = (k, v) => { M.farBuilds++; return farSet(k, v); };

  // -- vegetation preview: time per zone (incl. its height map), variant knobs --
  if (bew) {
    const viaZone = bew.zoneStreuen.bind(bew);
    bew.zoneStreuen = (zx, zy) => {
      const h0 = M.hmMs;
      const t = performance.now();
      viaZone(zx, zy);
      const d = performance.now() - t;
      M.streuMs += d; M.streuOnlyMs += d - (M.hmMs - h0); M.streuCalls++;
      if (d > M.streuMax) M.streuMax = d;
    };
    // clean-up of the preview (K2.1): time per freed zone, split into the `removeZDO` calls and the rest (flush)
    if (typeof bew.zoneAbbauen === 'function') {
      const viaAbbau = bew.zoneAbbauen.bind(bew);
      const ent = bew.ent;
      const viaRemove = ent.removeZDO.bind(ent);
      let inAbbau = false;
      ent.removeZDO = (k) => {
        if (!inAbbau) return viaRemove(k);
        const t = performance.now();
        viaRemove(k);
        M.abbauRemoveMs += performance.now() - t;
      };
      bew.zoneAbbauen = (schluessel) => {
        const plants = (bew.fertig.get(schluessel) ?? []).length;
        const t = performance.now();
        inAbbau = true;
        try { viaAbbau(schluessel); } finally { inAbbau = false; }
        const d = performance.now() - t;
        M.abbauMs += d; M.abbauCalls++; M.abbauPlants += plants;
        if (d > M.abbauMax) M.abbauMax = d;
      };
    }
  }

  // -- engine draw counters (all passes) --
  const drawElements = engine.drawElementsType.bind(engine);
  const drawArrays = engine.drawArraysType.bind(engine);
  engine.drawElementsType = (fm, is, ic, n = 1) => { M.dc++; M.tris += (ic / 3) * (n || 1); M.inst += n || 1; return drawElements(fm, is, ic, n); };
  engine.drawArraysType = (fm, vs, vc, n = 1) => { M.dc++; M.tris += (vc / 3) * (n || 1); M.inst += n || 1; return drawArrays(fm, vs, vc, n); };

  }

  const ringMissing = () => {
    if (!bew || bew.stufe === 'aus') return false;
    const cx = Math.floor(player.position.x / 64 + 0.5), cz = Math.floor(player.position.z / 64 + 0.5);
    const R = bew.stufe === 'klein' ? 1 : 2;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (!bew.fertig.has(`${cx + dx},${cz + dy}`)) return true;
    return bew.warteschlange.length > 0;
  };
  // "near standing": the full near ring is built and the preview ring is complete;
  // "full standing": additionally the far ring queue is empty.
  M.nearOk = () => terr.buildQueue.length === 0 && !ringMissing() && windowState().near >= (2 * terr.viewRadius + 1) ** 2;
  M.fullOk = () => M.nearOk() && terr.teilBau === null && terr.farBuildQueue.length === 0;
  const windowState = () => {
    const cx = Math.floor((player.position.x + 32) / 64), cz = Math.floor((player.position.z + 32) / 64);
    let near = 0;
    for (const c of terr.chunks.values()) if (Math.max(Math.abs(c.zoneX - cx), Math.abs(c.zoneY - cz)) <= terr.viewRadius) near++;
    return { near, want: (2 * terr.viewRadius + 1) ** 2, cx, cz };
  };
  M.windowState = windowState;

  // -- frame recorder, altitude hook, steady detector --
  const tick = () => {
    const now = performance.now();
    const dtMs = now - M.last;
    M.frames.push(dtMs);
    M.last = now;
    if (M.auto && player.bauModus) {
      const dt = Math.min(dtMs / 1000, 0.25);
      player.position.x += -Math.sin(player._yaw) * M.auto * dt;
      player.position.z += -Math.cos(player._yaw) * M.auto * dt;
    }
    if (M.wiggle && player.bauModus) {
      // hop back and forth over a zone edge: `amp` metres either side of (x0, z0), switching every `every` frames
      const w = M.wiggle; w.n++;
      player.position.x = w.x0 + (Math.floor(w.n / w.every) % 2 === 0 ? w.amp : -w.amp);
      player.position.z = w.z0;
    }
    if (M.hp !== null && player.bauModus) {
      player.position.y = world.getGroundHeight(player.position.x, player.position.z) + M.hp;
    }
    if (M.steadyArmed && M.fullAt === null) {
      if (M.nearAt === null) { if (M.nearOk()) { if (++M.nearRun >= 3) M.nearAt = now; } else M.nearRun = 0; }
      if (M.fullOk()) { if (++M.fullRun >= 3) { M.fullAt = now; if (M.nearAt === null) M.nearAt = now; } } else M.fullRun = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // -- 4 Hz time series --
  const camera = dbg.scene.activeCamera;
  setInterval(() => {
    const p = player.position;
    const g = world.getGroundHeight(p.x, p.z);
    const cp = dbg.scene.activeCamera.position;
    M.series.push({
      t: performance.now(), x: p.x, y: p.y, z: p.z, ground: g,
      camH: cp.y - world.getGroundHeight(cp.x, cp.z),
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      cache: hm.cachedZoneCount, near: terr.chunks.size, far: terr.farChunks.size,
      q: terr.buildQueue.length, fq: terr.farBuildQueue.length,
      bewZones: bew ? bew.fertig.size : 0, bewPlants: bew ? bew.anzahl() : 0, hmBuilt: M.hmBuilt, evict: M.evict, recre: M.zoneRe,
    });
  }, 250);
  void camera;
  return true;
}

/** Page-side snapshot: cumulative counters plus the instantaneous state. */
function snapshot(withGpu) {
  const W = window;
  const M = W.__m, dbg = W.__dbg, terr = dbg.terrain, hm = dbg.world.heightmaps, bew = W.__bewuchs;
  const scene = dbg.scene;
  const active = scene.getActiveMeshes();
  let visible = 0, thin = 0;
  for (let i = 0; i < active.length; i++) {
    const m = active.data[i];
    const n = m.hasThinInstances ? m.thinInstanceCount : 1;
    visible += n; if (m.hasThinInstances) thin += n;
  }
  const ws = M.windowState();
  const s = {
    t: performance.now(), fi: M.frames.length, si: M.series.length, x: dbg.player.position.x, z: dbg.player.position.z,
    hmMs: M.hmMs, hmCalls: M.hmCalls, hmBuilt: M.hmBuilt, hmMax: M.hmMax,
    zoneNew: M.zoneNew, zoneRe: M.zoneRe, evict: M.evict,
    chunkBuilds: M.chunkBuilds, farBuilds: M.farBuilds,
    streuMs: M.streuMs, streuOnlyMs: M.streuOnlyMs, streuCalls: M.streuCalls, streuMax: M.streuMax,
    abbauMs: M.abbauMs, abbauRemoveMs: M.abbauRemoveMs, abbauCalls: M.abbauCalls, abbauPlants: M.abbauPlants, abbauMax: M.abbauMax,
    dc: M.dc, tris: M.tris, inst: M.inst,
    heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    cachedZones: hm.cachedZoneCount, maxCached: hm.maxCachedZones,
    nearChunks: terr.chunks.size, nearInWindow: ws.near, nearWant: ws.want, farChunks: terr.farChunks.size,
    buildQueue: terr.buildQueue.length, farQueue: terr.farBuildQueue.length,
    viewRadius: terr.viewRadius, farRadius: terr.farRadius,
    previewZones: bew ? bew.fertig.size : 0, previewPlants: bew ? bew.anzahl() : 0, previewStufe: bew ? bew.stufe : null,
    zoneBytesMB: (() => { let n = 0; for (const h of hm.zones.values()) n += (h.baseHeights?.byteLength ?? 0) + (h.heights?.byteLength ?? 0) + (h.vegMask?.byteLength ?? 0) + (h.oceanDepth?.byteLength ?? 0); return n / 1048576; })(),
    activeMeshes: active.length, visibleObjects: visible, visibleThinInstances: thin,
    totalMeshes: scene.meshes.length,
  };
  if (withGpu) {
    // Rough estimate only (buffer capacities are not exposed): 32 B per vertex of every unique
    // geometry, 64 B per thin instance matrix.
    try {
      const seen = new Set();
      let verts = 0, thinInst = 0;
      for (const m of scene.meshes) {
        const g = m.geometry;
        if (g && !seen.has(g)) { seen.add(g); verts += g.getTotalVertices(); }
        if (m.hasThinInstances) thinInst += m.thinInstanceCount;
      }
      s.gpuMB = { vertexEstimate: (verts * 32) / 1048576, instanceMatrices: (thinInst * 64) / 1048576 };
    } catch (e) {
      s.gpuMB = null;
    }
  }
  return s;
}

function stats(frames) {
  if (frames.length === 0) return null;
  const t = frames.slice().sort((a, b) => a - b);
  const over = (ms) => t.filter((x) => x > ms).length;
  return {
    n: t.length,
    p50: +quantile(t, 0.5).toFixed(2), p95: +quantile(t, 0.95).toFixed(2), p99: +quantile(t, 0.99).toFixed(2),
    max: +t[t.length - 1].toFixed(2), mean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2),
    over16: over(16.7), over33: over(33), over50: over(50),
  };
}

async function executeRun(run) {
  const started = Date.now();
  const quietBefore = QUIET_CPU > 0 ? await waitQuiet() : null;
  const llamaServer = await foreignCpuPct('llama-server');
  const browser = await chromium.launch(HEADLESS_GPU ? {
    channel: 'chromium',
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization',
      '--disable-frame-rate-limit', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info',
    ],
  } : {
    headless: FUNCTIONAL,
    args: [
      '--ozone-platform=x11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
      '--disable-frame-rate-limit', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info',
    ],
  });
  const busy0 = [];
  for (let i = 0; i < 5; i++) { busy0.push(gpuBusy()); await sleep(200); }
  const result = { id: run.id, plan: run, quietBefore, llamaServer, startedAt: new Date().toISOString(), phases: {}, problems: [], gpuBusyBeforeRun: busy0, loadAvgAtStart: loadAvg(), procsAtStart: topProcs() };
  let where = 'start';
  let pageRef = null;
  /** On a hang: ask the debugger where the main thread is (works even when `evaluate` does not return). */
  const stackOfHang = async () => {
    try {
      const cdp = await pageRef.context().newCDPSession(pageRef);
      await cdp.send('Debugger.enable');
      const paused = new Promise((res) => cdp.once('Debugger.paused', res));
      await cdp.send('Debugger.pause');
      const ev = await Promise.race([paused, sleep(8000).then(() => null)]);
      return ev ? ev.callFrames.slice(0, 12).map((f) => `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.location.lineNumber + 1}`) : 'no pause within 8 s';
    } catch (e) {
      return `debugger unavailable: ${String(e).slice(0, 120)}`;
    }
  };
  const timer = setTimeout(async () => {
    console.error(`[bench] ${run.id}: run timeout in ${where}`);
    result.hungIn = where;
    // a dead page never answers the debugger either: give it 15 s, then close the browser regardless
    if (pageRef) { result.hangStack = await Promise.race([stackOfHang(), sleep(15000).then(() => 'debugger did not answer within 15 s (page idle or dead)')]); console.error(`[bench] ${run.id}: main thread at ${JSON.stringify(result.hangStack)}`); }
    void browser.close();
  }, runTimeoutS(run) * 1000);
  try {
    const context = await browser.newContext({ viewport: FUNCTIONAL ? { width: 640, height: 360 } : { width: 1600, height: 900 } });
    const page = await context.newPage();
    pageRef = page;
    const consoleLog = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message.slice(0, 300)}`));
    await page.addInitScript(([doc]) => localStorage.setItem('wov-editor-layout', doc), [WORLD_JSON]);
    const ev = (fn, a) => page.evaluate(fn, a);

    const s = run.site;
    const t0 = Date.now();
    await page.goto(`${URL_BASE}/play/?offline=1&layout=editor&pos=${s.x},${s.z}&t=${TIME_OF_DAY}&bewuchs-messung=1`, { waitUntil: 'commit', timeout: 120_000 });
    await page.waitForFunction(() => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.terrain && window.__dbg?.world), undefined, { timeout: 180_000 });
    result.loadS = +((Date.now() - t0) / 1000).toFixed(1);
    const gpu = await ev(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    result.gpu = gpu;
    if (!FUNCTIONAL && (!gpu || /swiftshader|llvmpipe|software/i.test(gpu))) throw new Error(`no hardware renderer: ${gpu}`);
    const prep = await ev(() => ({
      layout: Boolean(window.__dbg.world.regionGeo),
      bewuchs: Boolean(window.__bewuchs),
      settings: window.__dbg.gameSettings.get(),
    }));
    result.settingsAtStart = prep.settings;
    result.minimal = MINIMAL;
    if (!prep.layout || !prep.bewuchs) throw new Error(`draft not active (layout ${prep.layout}, preview hook ${prep.bewuchs}; the client must answer ?bewuchs-messung=1)`);
    await ev(instrument, MINIMAL);
    await page.bringToFront();
    await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

    // -- knobs (test variants only) --
    await ev((r) => {
      const W = window, M = W.__m, terr = W.__dbg.terrain, bew = W.__bewuchs;
      if (r.detail !== undefined && r.detail !== null) W.__vb.setze('detailQuality', r.detail);
      if (r.window) { terr.viewRadius = r.window.view; terr.farRadius = r.window.far; terr.ringDreckig = true; }
      if (r.lru) W.__dbg.world.heightmaps.maxCachedZones = r.lru;
      for (const [k, v] of Object.entries(r.settings || {})) W.__vb.setze(k, v);
      const stufe = r.previewStufe ?? (r.previewOff ? 'aus' : null);
      if (stufe) bew.setzeStufe(stufe);
      // behaviour before K2.1: nothing is ever released (same-window comparison only)
      if (r.previewNoPrune) bew.abbauSchritt = () => {};
      // grace period in milliseconds before a zone outside the ring is released (client default 1000; 0 = no grace)
      if (r.previewNachlauf !== undefined) bew.nachlaufMs = r.previewNachlauf;
    }, run);

    // -- wait until the picture stands (cold start), measured from navigation --
    const arm = () => ev(() => { const M = window.__m; M.nearRun = 0; M.fullRun = 0; M.nearAt = null; M.fullAt = null; M.steadyArmed = true; });
    const waitSteady = async (maxS) => {
      const t = Date.now();
      while (Date.now() - t < maxS * 1000) {
        const at = await ev(() => ({ near: window.__m.nearAt, full: window.__m.fullAt }));
        if (at.full !== null) return at;
        await sleep(100);
      }
      return await ev(() => ({ near: window.__m.nearAt, full: window.__m.fullAt }));
    };
    where = 'cold start';
    await arm();
    const steady0 = await waitSteady(150);
    // page clock: performance.now() starts at navigation
    result.coldNearS = steady0.near === null ? null : +(steady0.near / 1000).toFixed(1);
    result.coldFullS = steady0.full === null ? null : +(steady0.full / 1000).toFixed(1);
    await ev(() => { window.__m.steadyArmed = false; });

    // -- posture --
    const p = run.posture;
    const settingsAfter = await ev((post) => {
      const W = window, player = W.__dbg.player;
      const yaw = post.yaw ?? 0;
      W.__vb.teleport(post.x, post.z, yaw);
      if (post.bau) {
        player.setBauModus(true);
        W.__m.hp = post.hp;
        player.boomLength = post.boom;
        player._pitch = post.pitch;
      } else {
        W.__m.hp = null;
        player.setBauModus(false);
        if (post.boom) player.boomLength = post.boom;
        if (post.pitch !== undefined) player._pitch = post.pitch;
      }
      return { bau: player.bauModus, boom: player.boomLength, pitch: player._pitch, view: W.__dbg.terrain.viewRadius, far: W.__dbg.terrain.farRadius };
    }, { ...p, x: s.x, z: s.z, yaw: s.yaw });
    result.postureApplied = settingsAfter;
    await sleep(1500);

    // -- phases --
    let gpuDone = false;
    for (const ph of run.phases) {
      where = `phase ${ph.name}`;
      // switch the preview level inside one session (same window for all levels); `settleS` lets the ring build up / clear down first
      if (ph.previewStufe) {
        await ev((st) => window.__bewuchs.setzeStufe(st), ph.previewStufe);
        await sleep((ph.settleS ?? 10) * 1000);
      }
      if (ph.from) {
        await ev(({ x, z, yaw }) => window.__vb.teleport(x, z, yaw), ph.from);
        if (ph.settleS) await sleep(ph.settleS * 1000);
      }
      if (ph.arm) await arm();
      await ev(() => window.__vb.profil()); // reset the per-phase sub-system averages
      const cpuA = cpuTimes();
      const a = await ev(snapshot, false);
      if (ph.auto) await ev((v) => { window.__m.auto = v; }, ph.auto);
      if (ph.wiggle) await ev((w) => { window.__m.wiggle = { ...w, n: 0 }; }, ph.wiggle);
      for (const k of ph.keys ?? []) await page.keyboard.down(k);
      if (ph.keys && ph.keys.length > 0 && !ph.untilSteady) {
        // key events are sometimes lost (focus): check that the player really moves, press again once if not
        await sleep(2500);
        const moved = await ev(([x0, z0]) => { const q = window.__dbg.player.position; return Math.hypot(q.x - x0, q.z - z0); }, [a.x, a.z]);
        if (moved < 1) {
          result.problems.push(`${ph.name}: no movement after 2.5 s, keys pressed again`);
          for (const k of ph.keys.slice().reverse()) await page.keyboard.up(k);
          await page.bringToFront();
          await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});
          for (const k of ph.keys) await page.keyboard.down(k);
        }
      }
      let steadyMs = null, nearStandingMs = null;
      if (ph.untilSteady) {
        const at = await waitSteady(ph.s);
        steadyMs = at.full === null ? null : +(at.full - a.t).toFixed(0);
        nearStandingMs = at.near === null ? null : +(at.near - a.t).toFixed(0);
        if (ph.afterS) await sleep(ph.afterS * 1000);
      } else {
        await sleep(Math.max(0, ph.s * 1000 - (ph.keys && ph.keys.length > 0 ? 2500 : 0)));
      }
      for (const k of (ph.keys ?? []).slice().reverse()) await page.keyboard.up(k);
      if (ph.auto) await ev(() => { window.__m.auto = 0; });
      if (ph.wiggle) await ev(() => { window.__m.wiggle = null; });
      const withGpu = !gpuDone && (ph.gpu === true);
      const b = await ev(snapshot, withGpu);
      const busyDuring = gpuBusy();
      const cpuB = cpuTimes();
      if (withGpu) gpuDone = true;
      const prof = await ev(() => { const r = window.__vb.profil(); return { drawCallsPerFrame: r.zeichenaufrufeProBild, activeMeshes: r.aktiveMeshes, byType: r.aktivNachTyp, sub: Object.fromEntries(['spieler', 'terrain', 'gras', 'entities', 'rest'].map((n) => [n, r[n] && r[n].n ? +(r[n].summe / r[n].n).toFixed(3) : null])) }; });
      const frames = await ev(([i0, i1]) => window.__m.frames.slice(i0, i1), [a.fi + 1, b.fi]);
      const series = await ev(([i0, i1]) => window.__m.series.slice(i0, i1), [a.si, b.si]);
      const dt = (b.t - a.t) / 1000;
      const n = frames.length || 1;
      const dist = series.length > 1 ? Math.hypot(series.at(-1).x - series[0].x, series.at(-1).z - series[0].z) : 0;
      const groundMin = series.length ? Math.min(...series.map((q) => q.ground)) : null;
      const overWater = series.length ? series.filter((q) => q.ground < 31).length / series.length : null;
      const camH = series.length ? series.map((q) => q.camH).sort((x, y) => x - y) : [];
      const heapSeries = series.map((q) => q.heap).filter((h) => h !== null);
      result.phases[ph.name] = {
        seconds: +dt.toFixed(2),
        gpuBusyPercentAtEnd: busyDuring,
        systemCpuBusyPercent: cpuA && cpuB ? +((100 * (cpuB.busy - cpuA.busy)) / (cpuB.total - cpuA.total)).toFixed(1) : null,
        loadAvgAtEnd: loadAvg(),
        frame: stats(frames),
        rawFrames: frames.map((f) => +f.toFixed(1)),
        drawCallsPerFrame: +((b.dc - a.dc) / n).toFixed(0),
        trianglesPerFrameM: +((b.tris - a.tris) / n / 1e6).toFixed(3),
        instancesPerFrame: +((b.inst - a.inst) / n).toFixed(0),
        profile: prof,
        flown: { distanceM: +dist.toFixed(1), meanSpeed: +(dist / dt).toFixed(2), groundMin: groundMin === null ? null : +groundMin.toFixed(1), shareSamplesOverWater: overWater === null ? null : +overWater.toFixed(2), cameraHeightMedian: camH.length ? +camH[Math.floor(camH.length / 2)].toFixed(1) : null, cameraHeightMin: camH.length ? +camH[0].toFixed(1) : null, cameraHeightMax: camH.length ? +camH.at(-1).toFixed(1) : null },
        streaming: {
          zonesBuilt: b.hmBuilt - a.hmBuilt, zonesBuiltPerS: +((b.hmBuilt - a.hmBuilt) / dt).toFixed(2),
          zonesCreatedNew: b.zoneNew - a.zoneNew, recreatedAfterEviction: b.zoneRe - a.zoneRe, evictions: b.evict - a.evict,
          heightMapMs: +(b.hmMs - a.hmMs).toFixed(1), heightMapMsPerZone: b.hmBuilt - a.hmBuilt ? +((b.hmMs - a.hmMs) / (b.hmBuilt - a.hmBuilt)).toFixed(2) : null, heightMapMaxCallMs: +b.hmMax.toFixed(1),
          nearChunkBuilds: b.chunkBuilds - a.chunkBuilds, farChunkBuilds: b.farBuilds - a.farBuilds,
          previewZones: b.streuCalls - a.streuCalls, previewMs: +(b.streuMs - a.streuMs).toFixed(1), previewMsPerZone: b.streuCalls - a.streuCalls ? +((b.streuMs - a.streuMs) / (b.streuCalls - a.streuCalls)).toFixed(2) : null,
          previewScatterOnlyMsPerZone: b.streuCalls - a.streuCalls ? +((b.streuOnlyMs - a.streuOnlyMs) / (b.streuCalls - a.streuCalls)).toFixed(2) : null,
          previewMaxZoneMs: +b.streuMax.toFixed(1),
          cleanupZones: b.abbauCalls - a.abbauCalls, cleanupPlants: b.abbauPlants - a.abbauPlants,
          cleanupMs: +(b.abbauMs - a.abbauMs).toFixed(2), cleanupRemoveZdoMs: +(b.abbauRemoveMs - a.abbauRemoveMs).toFixed(2),
          cleanupMsPerZone: b.abbauCalls - a.abbauCalls ? +((b.abbauMs - a.abbauMs) / (b.abbauCalls - a.abbauCalls)).toFixed(2) : null,
          cleanupMsPerPlant: b.abbauPlants - a.abbauPlants ? +((b.abbauRemoveMs - a.abbauRemoveMs) / (b.abbauPlants - a.abbauPlants)).toFixed(4) : null,
          cleanupMaxZoneMs: +b.abbauMax.toFixed(2),
        },
        state: {
          nearInWindow: b.nearInWindow, nearWant: b.nearWant, nearChunks: b.nearChunks, farChunks: b.farChunks,
          buildQueue: b.buildQueue, farQueue: b.farQueue, viewRadius: b.viewRadius, farRadius: b.farRadius,
          cachedZones: b.cachedZones, maxCached: b.maxCached,
          previewZones: b.previewZones, previewPlants: b.previewPlants, previewStufe: b.previewStufe,
          zoneBufferMB: +b.zoneBytesMB.toFixed(1), zoneBufferStartMB: +a.zoneBytesMB.toFixed(1), chromeRssMB: childTreeRssMB(),
          activeMeshes: b.activeMeshes, visibleObjects: b.visibleObjects, visibleThinInstances: b.visibleThinInstances, totalMeshes: b.totalMeshes,
          heapMB: b.heapMB === null ? null : +b.heapMB.toFixed(1), heapStartMB: a.heapMB === null ? null : +a.heapMB.toFixed(1),
          heapMaxMB: heapSeries.length ? +(Math.max(...heapSeries) / 1048576).toFixed(1) : null,
          gpuMB: b.gpuMB ? Object.fromEntries(Object.entries(b.gpuMB).map(([k, v]) => [k, +v.toFixed(1)])) : undefined,
          startPreviewPlants: a.previewPlants, startCachedZones: a.cachedZones,
        },
        fullStandingMs: steadyMs,
        nearStandingMs,
      };
      console.log(`[bench] ${run.id} ${ph.name}: p50 ${result.phases[ph.name].frame?.p50} p95 ${result.phases[ph.name].frame?.p95} p99 ${result.phases[ph.name].frame?.p99} ms, ${result.phases[ph.name].drawCallsPerFrame} dc, zones/s ${result.phases[ph.name].streaming.zonesBuiltPerS}${ph.untilSteady ? `, near ring standing ${nearStandingMs} ms, full ${steadyMs} ms` : ''}`);
    }
    result.loadAvgAtEnd = loadAvg();
    result.procsAtEnd = topProcs();
    result.console = consoleLog.slice(0, 20);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = String(e && e.message ? e.message : e).slice(0, 500);
    console.error(`[bench] ${run.id}: ${result.error}`);
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => {});
  }
  result.wallS = +((Date.now() - started) / 1000).toFixed(1);
  return result;
}

const t0 = Date.now();
const todo = [];
for (const run of PLAN) {
  if (ONLY && !run.id.includes(ONLY)) continue;
  const file = join(OUT, `${run.id}.json`);
  if (existsSync(file)) continue;
  todo.push(run);
}
console.log(`[bench] lock wait ${LOCK_WAIT_S} s, ${todo.length} of ${PLAN.length} runs to do, block limit ${MAX_MIN} min`);
let done = 0;
let lastRunMin = 0;
for (const run of todo) {
  // never start a run that is expected to overshoot the block limit (the first run always starts)
  if (done > 0 && (Date.now() - t0) / 60000 + lastRunMin > MAX_MIN) { console.log(`[bench] block limit reached, ${todo.length - done} runs left`); break; }
  const tRun = Date.now();
  let r = await executeRun(run);
  const attempts = [r.ok ? 'ok' : `${r.hungIn ?? 'error'}: ${r.error}`];
  for (let a = 1; !r.ok && a < MAX_ATTEMPTS; a++) {
    console.log(`[bench] ${run.id}: attempt ${a} failed (${attempts[a - 1]}), repeating`);
    r = await executeRun(run);
    attempts.push(r.ok ? 'ok' : `${r.hungIn ?? 'error'}: ${r.error}`);
  }
  r.attempts = attempts;
  lastRunMin = (Date.now() - tRun) / 60000;
  r.blockLockWaitS = LOCK_WAIT_S;
  r.blockStartedAt = new Date(t0).toISOString();
  writeFileSync(join(OUT, `${run.id}.json`), JSON.stringify(r));
  done++;
  console.log(`[bench] ${run.id} written (${r.ok ? 'ok' : 'FAILED'}, ${r.wallS} s)`);
}
console.log(`[bench] block done: ${done} runs, ${((Date.now() - t0) / 60000).toFixed(1)} min, ${todo.length - done} left`);
