/**
 * Biome light and fog measurement: the same pose under several weather states and fog densities.
 * Messung von Licht und Nebel eines Bioms: dieselbe Pose, mehrere Wetterzustaende und Nebeldichten.
 *
 *   node tools/pw-biom-licht-messung.mjs <outdir> '[["Clear",null],["Glen clear",0.006]]' '[0,2.2]'
 *
 * Recipe (the ADR-0034 way): the WebGL frame buffer is read with `engine.readPixels()` (never
 * `page.screenshot()`: under SwiftShader it runs into the timeout and the loading screen lies over the
 * image); regions are fractions of the frame, rows count from the top. Per region: luma
 * (0.2126 R + 0.7152 G + 0.0722 B on the 0..255 sRGB read-back), mean B-R and mean saturation
 * (max-min)/max. The weather is forced through `Lighting.setEnvironmentByName` and a fixed density
 * through `Lighting.nebelDichteFest` (null = the weather's own), time of day fixed at midday.
 *
 * Environment: BASE = client URL (default http://localhost:5295/play/), WOV_CHROMIUM = path of a
 * Chromium/headless shell (default: the one Playwright knows). Run it under `tools/sperre.sh measure --`
 * when it runs on wov-dev; software rendering (SwiftShader), so only ratios and colours are meaningful.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const OUT = process.argv[2] ?? '/tmp/gk-k5-out';
const VARIANTEN = JSON.parse(process.argv[3] ?? '[["Clear",null],["Glen clear",null]]');
const YAWS = JSON.parse(process.argv[4] ?? '[0]');
const BASE = process.env.BASE ?? 'http://localhost:5295/play/';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.WOV_CHROMIUM ? { executablePath: process.env.WOV_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${BASE}?offline=1&t=0.5&env=Clear`, { waitUntil: 'domcontentloaded' });
console.log('goto done', new Date().toISOString());
await page.waitForFunction(() => window.__dbg?.world != null, { timeout: 240000 });
console.log('world', new Date().toISOString());
for (let i = 0; i < 80; i++) {
  const p = await page.evaluate(() => window.__dbg?.terrain?.loadProgress ?? 0);
  if (p >= 1) break;
  await page.waitForTimeout(3000);
}
console.log('terrain loaded', new Date().toISOString());
await page.waitForTimeout(20000);

const REGIONEN = { himmel: [0.04, 0.2], ferne: [0.6, 0.66], mittel: [0.72, 0.8], nah: [0.9, 1.0] };

const messe = (args) => page.evaluate(async ({ name, dichte, yaw, REGIONEN }) => {
  const d = window.__dbg;
  const L = d.lighting;
  L.paused = true; L.timeOfDay = 0.5;
  L.setEnvironmentByName(name);
  L.nebelDichteFest = dichte;
  L.apply(10); L.apply(0);
  const pl = d.player;
  pl._yaw = yaw; pl._pitch = 0;
  const engine = d.scene.getEngine();
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  // let a few frames render with the new state
  await new Promise((res) => { let n = 0; const o = d.scene.onAfterRenderObservable.add(() => { if (++n >= 4) { d.scene.onAfterRenderObservable.remove(o); res(); } }); });
  const roh = await new Promise((fertig) => {
    const obs = d.scene.onAfterRenderObservable.add(async () => {
      d.scene.onAfterRenderObservable.remove(obs);
      fertig(await engine.readPixels(0, 0, w, h));
    });
  });
  const reg = {};
  for (const [k, [f0, f1]] of Object.entries(REGIONEN)) {
    const y0 = Math.round(f0 * h), y1 = Math.round(f1 * h);
    let sr = 0, sg = 0, sb = 0, sl = 0, ss = 0, sbr = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = Math.round(w * 0.25); x < Math.round(w * 0.75); x++) {
      const o = ((h - 1 - y) * w + x) * 4;
      const r = roh[o], g = roh[o + 1], b = roh[o + 2];
      sr += r; sg += g; sb += b; sl += 0.2126 * r + 0.7152 * g + 0.0722 * b; sbr += b - r;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 0) ss += (mx - mn) / mx; n++;
    }
    reg[k] = { luma: sl / n, bMinusR: sbr / n, sat: ss / n, r: sr / n, g: sg / n, b: sb / n };
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) { const src = (h - 1 - y) * w * 4; img.data.set(roh.subarray(src, src + w * 4), y * w * 4); }
  ctx.putImageData(img, 0, 0);
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return {
    reg, png: cv.toDataURL('image/png'),
    env: L.environmentName, fogDensity: d.scene.fogDensity, fogMode: d.scene.fogMode,
    sonneZuGrund: lum(L.bodenSonne) / lum(L.bodenAmbient),
    sun: L.sun.intensity, amb: L.ambient.intensity,
    pos: [pl.position.x, pl.position.y, pl.position.z],
  };
}, args);

const ergebnisse = [];
for (const yaw of YAWS) {
  for (const [name, dichte] of VARIANTEN) {
    console.log('variant', name, dichte, new Date().toISOString());
    const r = await messe({ name, dichte, yaw, REGIONEN });
    const tag = `${name.replace(/ /g, '_')}_d${dichte ?? 'auto'}_yaw${yaw}`;
    writeFileSync(`${OUT}/${tag}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
    r.tag = tag; r.yaw = yaw; r.dichteParam = dichte;
    ergebnisse.push(r);
    const f = (k) => `${r.reg[k].luma.toFixed(1)}/${r.reg[k].bMinusR.toFixed(1)}/${r.reg[k].sat.toFixed(3)}`;
    console.log(`${tag}  fog ${r.fogDensity.toFixed(5)} mode ${r.fogMode}  himmel ${f('himmel')}  ferne ${f('ferne')}  mittel ${f('mittel')}  nah ${f('nah')}  sonne:grund ${r.sonneZuGrund.toFixed(2)}  ferne/himmel ${(r.reg.ferne.luma / r.reg.himmel.luma).toFixed(2)}`);
  }
}
writeFileSync(`${OUT}/messung.json`, JSON.stringify(ergebnisse, null, 1));
await browser.close();
