/**
 * pw-sky-verify — headless verification of ValheimSky's GLSL.
 *
 * Raw GLSL can't be checked by tsc, so this bundles the real ValheimSky +
 * shared environment model, runs them in Chromium (SwiftShader), and
 * asserts the things that actually matter:
 *
 *   1. the shader COMPILES (Babylon reports no shader error, material
 *      becomes ready)
 *   2. the horizon pixel MATCHES scene fog colour — the entire reason this
 *      dome exists instead of Babylon's Preetham SkyMaterial
 *   3. day / dusk / night produce visibly different skies (uniforms flow)
 *   4. the zenith is darker than the horizon (gradient has the right sign)
 *   5. nothing renders NaN/black-screen
 *
 * Colour readback only — no image diffing, so it is stable on SwiftShader.
 * Screenshots are written next to the report for eyeballing.
 *
 *   node tools/pw-sky-verify.mjs [--keep]
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'tools/out');
const keep = process.argv.includes('--keep');

const ENTRY = `
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math';
import { ValheimSky } from '${join(ROOT, 'client/src/engine/ValheimSky.ts').replace(/\\/g, '/')}';
import { findEnvironment, evaluateEnv, ENV_CLEAR } from '${join(ROOT, 'shared/src/index.ts').replace(/\\/g, '/')}';

const errors = [];
window.__errors = errors;

const canvas = document.getElementById('c');
const engine = new Engine(canvas, false, { preserveDrawingBuffer: true }, false);
const scene = new Scene(engine);
scene.clearColor = new Color4(1, 0, 1, 1); // magenta = "sky did not draw"

const cam = new FreeCamera('cam', Vector3.Zero(), scene);
cam.minZ = 0.1;
cam.maxZ = 10000;
cam.fov = 1.2;

const sky = new ValheimSky(scene, 3000);
const env = findEnvironment(ENV_CLEAR);

window.__probe = async (frac, pitch) => {
  const state = evaluateEnv(env, frac);
  // aim the camera at the given pitch, along the sun azimuth so the sun/glow
  // is in frame for the horizon test
  const az = Math.atan2(state.sunDir.z, state.sunDir.x);
  cam.position.set(0, 0, 0);
  cam.setTarget(new Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)));
  sky.update(state, 0.016);
  scene.render();
  // let the effect finish compiling, then draw again so we sample real pixels
  for (let i = 0; i < 30 && !sky.mesh.material.isReady(sky.mesh); i++) {
    await new Promise((r) => setTimeout(r, 50));
    scene.render();
  }
  scene.render();

  const w = canvas.width, h = canvas.height;
  const px = await engine.readPixels(0, 0, w, h);
  // readPixels is bottom-up RGBA
  // readPixels rows run BOTTOM-UP, so screen-top (fy=0) is the LAST row.
  // Convert fy straight into a bottom-up row index — negating twice (once
  // here and again in the index) silently mirrors the image vertically and
  // makes a correct gradient look inverted.
  const at = (fx, fy) => {
    const x = Math.floor(fx * (w - 1));
    const rowFromBottom = Math.floor((1 - fy) * (h - 1));
    const i = (rowFromBottom * w + x) * 4;
    return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
  };
  let nan = 0, magenta = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (!Number.isFinite(px[i])) nan++;
    if (px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250) magenta++;
  }
  // Bright outliers = stars / sun / moon. Compare each pixel's luminance
  // against the frame median so this works on a dark night sky too.
  const lums = [];
  for (let i = 0; i < px.length; i += 4) {
    lums.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
  }
  const sorted = [...lums].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const brightPixels = lums.filter((l) => l > median + 40).length;
  // Vertical scan for seams. Deliberately OFF-CENTRE: the sun/moon disc is
  // intentionally a sharp edge, and a column through the middle runs
  // straight through it, so scanning at x=0.5 measures the disc rather than
  // the gradient and reports a ~0.9 "seam" that is not a defect.
  const raw = [];
  for (let r = 0; r < h; r++) raw.push(at(0.12, r / (h - 1)));
  // 3-tap median along the column before measuring. Stars (and the sun/moon
  // disc) are intentionally 1-2px spikes and would otherwise register as
  // huge "seams" — a real horizon seam spans many rows and survives the
  // median, a star does not.
  const column = raw.map((_, r) => {
    if (r === 0 || r === raw.length - 1) return raw[r];
    return [0, 1, 2].map((ch) => {
      const t = [raw[r - 1][ch], raw[r][ch], raw[r + 1][ch]].sort((a, b) => a - b);
      return t[1];
    });
  });
  let maxJump = 0, maxJumpAt = 0;
  for (let r = 1; r < column.length; r++) {
    const a = column[r - 1], b = column[r];
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d > maxJump) { maxJump = d; maxJumpAt = r / (h - 1); }
  }

  return {
    ready: sky.mesh.material.isReady(sky.mesh),
    maxJump, maxJumpAt,
    center: at(0.5, 0.5),
    top: at(0.5, 0.02),
    bottom: at(0.5, 0.98),
    nan,
    brightPixels,
    magentaFraction: magenta / (px.length / 4),
    fogColor: [state.fogColor.r, state.fogColor.g, state.fogColor.b],
    fogColorSun: [state.fogColorSun.r, state.fogColorSun.g, state.fogColorSun.b],
    elevation: state.elevation,
    cloudAlpha: state.cloudAlpha,
  };
};

window.__ready = true;
`;

const tmp = mkdtempSync(join(tmpdir(), 'skyverify-'));
const entryPath = join(tmp, 'entry.ts');
writeFileSync(entryPath, ENTRY);

console.log('[sky-verify] bundling…');
await build({
  entryPoints: [entryPath],
  bundle: true,
  outfile: join(tmp, 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  absWorkingDir: ROOT,
  loader: { '.ts': 'ts' },
  // the entry lives in a temp dir, so point bare imports at the project
  nodePaths: [join(ROOT, 'node_modules')],
  logLevel: 'warning',
});

writeFileSync(
  join(tmp, 'index.html'),
  `<!doctype html><meta charset=utf8><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style>
<canvas id=c width=640 height=400></canvas><script src="./bundle.js"></script>`
);

mkdirSync(OUT_DIR, { recursive: true });

// The sandbox ships a pinned Chromium that may not match playwright's
// expected build number, so point at it explicitly instead of downloading.
const CHROMIUM =
  process.env.SKY_VERIFY_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const consoleErrors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /shader|compil|GLSL|WebGL/i.test(t)) consoleErrors.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

await page.goto(`file://${join(tmp, 'index.html')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });

const CASES = [
  { label: 'midday',  frac: 0.5,    pitch: 0.35 },
  { label: 'sunrise', frac: 0.1333, pitch: 0.08 },
  { label: 'sunset',  frac: 0.85,   pitch: 0.08 },
  { label: 'night',   frac: 0.0,    pitch: 0.35 },
  // pitch 0 puts up==0 at the screen centre, which is the ONLY place the
  // "horizon equals fog colour" property can be measured directly.
  { label: 'horizon', frac: 0.5,    pitch: 0.0 },
];

const results = [];
for (const c of CASES) {
  const r = await page.evaluate(([f, p]) => window.__probe(f, p), [c.frac, c.pitch]);
  await page.screenshot({ path: join(OUT_DIR, `sky-${c.label}.png`) });
  results.push({ ...c, ...r });
}

await browser.close();
if (!keep) rmSync(tmp, { recursive: true, force: true });

// ── assertions ──────────────────────────────────────────────────────
const fmt = (a) => `${a.map((v) => v.toFixed(3)).join(', ')}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let failed = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\n[sky-verify] per-case readback');
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(8)} elev=${r.elevation.toFixed(2)} ready=${r.ready}` +
      ` top=[${fmt(r.top)}] centre=[${fmt(r.center)}] bottom=[${fmt(r.bottom)}]` +
      ` fog=[${fmt(r.fogColor)}]`
  );
}

console.log('\n[sky-verify] assertions');
const shaderErrors = consoleErrors.filter((e) => /shader|GLSL|compil/i.test(e));
check(shaderErrors.length === 0, 'shader compiles without errors', shaderErrors.slice(0, 3).join(' | ') || 'none');
check(results.every((r) => r.ready), 'material reports ready in every case');
check(results.every((r) => r.nan === 0), 'no NaN pixels');
check(
  results.every((r) => r.magentaFraction < 0.001),
  'dome covers the screen (clear colour not visible)',
  `max magenta = ${(Math.max(...results.map((r) => r.magentaFraction)) * 100).toFixed(3)}%`
);

// The point of the whole file: horizon must match the fog colour.
const horizonCase = results.find((r) => r.label === 'horizon');
const dHorizon = dist(horizonCase.center, horizonCase.fogColor);
check(
  dHorizon < 0.16,
  'horizon matches scene fog colour (the reason for this dome)',
  `distance ${dHorizon.toFixed(3)} — horizon pixel [${fmt(horizonCase.center)}] vs fog [${fmt(horizonCase.fogColor)}]`
);

// Gradient sign: zenith darker than horizon at midday.
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mid = results.find((r) => r.label === 'midday');
check(
  lum(mid.top) < lum(mid.bottom),
  'zenith darker than horizon (gradient sign)',
  `top ${lum(mid.top).toFixed(3)} < bottom ${lum(mid.bottom).toFixed(3)}`
);

// No hard seam anywhere in a vertical scan (horizon edge, banding).
const worstSeam = results.reduce((w, r) => (r.maxJump > w.maxJump ? r : w), results[0]);
check(
  worstSeam.maxJump < 0.05,
  'no hard seam in vertical scan',
  `worst ${worstSeam.maxJump.toFixed(4)} in ${worstSeam.label} at fy=${worstSeam.maxJumpAt.toFixed(3)}`
);

// Stars must actually render at night — a hash that degenerates at large
// coordinates silently produces an empty sky, which no colour check catches.
const nightCase = results.find((r) => r.label === 'night');
check(
  nightCase.brightPixels > 20,
  'stars visible at night',
  `${nightCase.brightPixels} bright pixels above frame median`
);

// Day/night must actually differ.
const day = results.find((r) => r.label === 'midday');
const night = results.find((r) => r.label === 'night');
check(
  lum(night.center) < lum(day.center) * 0.5,
  'night noticeably darker than day',
  `night ${lum(night.center).toFixed(3)} vs day ${lum(day.center).toFixed(3)}`
);

// Sunset should be warmer (more red than blue) than midday.
const sunset = results.find((r) => r.label === 'sunset');
const warmth = (c) => c[0] - c[2];
check(
  warmth(sunset.center) > warmth(day.center),
  'sunset warmer than midday (fogColorSun reaches the sky)',
  `sunset ${warmth(sunset.center).toFixed(3)} > midday ${warmth(day.center).toFixed(3)}`
);

const other = consoleErrors.filter((e) => !/shader|GLSL|compil/i.test(e));
if (other.length) {
  console.log('\n[sky-verify] other console output:');
  for (const e of other.slice(0, 10)) console.log(`  ${e}`);
}

console.log(`\n[sky-verify] screenshots: ${OUT_DIR}/sky-{midday,sunrise,sunset,night}.png`);
console.log(failed === 0 ? '\n=== SKY VERIFY: ALL PASSED ===' : `\n=== SKY VERIFY: ${failed} FAILED ===`);
process.exit(failed === 0 ? 0 : 1);
