/**
 * Texture-check probe v2: loads the fixed creature GLBs (Deer, Boar_fixed,
 * greydwarf_fixed) through the game's AssetManager, places them on a sky
 * platform with a fill light, and takes one CLOSE-UP screenshot per model
 * (others hidden) plus a lineup shot.
 *
 * Run: node tools/pw-texture-check.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWTex');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — building sky lineup…');

await page.evaluate(async () => {
  const r = window.__renderer;
  const origDN = r.updateDayNight.bind(r);
  r.updateDayNight = (_t, d) => origDN(0.42 * d, d);
  r.updatePlayer = () => {};

  // fill light opposite the sun so backsides are readable
  let sun = null;
  r.scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
  if (sun) {
    const fill = sun.clone();
    fill.position.set(-sun.position.x, sun.position.y * 0.5, -sun.position.z);
    fill.intensity = sun.intensity * 0.8;
    r.scene.add(fill);
  }

  const cam = r.camera.position.clone();
  window.__lineup = [];
  const names = ['Deer_fixed', 'Boar_fixed', 'greydwarf_fixed'];
  for (let i = 0; i < names.length; i++) {
    const model = await r.assets.loadModel(names[i]);
    model.position.set(cam.x + (i - 1) * 3, cam.y + 40, cam.z - 6);
    r.scene.add(model);
    window.__lineup.push({ name: names[i], model });
  }
  window.__camBase = cam;
});

for (const [i, name] of ['Deer_fixed', 'Boar_fixed', 'greydwarf_fixed'].entries()) {
  try {
    await page.evaluate((idx) => {
      const r = window.__renderer;
      window.__lineup.forEach((e, j) => (e.model.visible = j === idx));
      const e = window.__lineup[idx];
      e.model.rotation.y = Math.PI * 0.25; // 3/4 view
      e.model.updateMatrixWorld(true);
      // world bbox without THREE namespace (Vector3 via instance constructor)
      const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
      e.model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const cx of [bb.min.x, bb.max.x])
          for (const cy of [bb.min.y, bb.max.y])
            for (const cz of [bb.min.z, bb.max.z]) {
              const w = new o.position.constructor(cx, cy, cz).applyMatrix4(o.matrixWorld);
              min[0] = Math.min(min[0], w.x); min[1] = Math.min(min[1], w.y); min[2] = Math.min(min[2], w.z);
              max[0] = Math.max(max[0], w.x); max[1] = Math.max(max[1], w.y); max[2] = Math.max(max[2], w.z);
            }
      });
      const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      const d = size * 2.0 + 0.5;
      r.camera.position.set(c[0] + d * 0.5, c[1] + d * 0.25, c[2] + d * 0.85);
      r.camera.lookAt(c[0], c[1], c[2]);
    }, i);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `tools/out/tex-${name}.png`, timeout: 180000 });
    console.log(`shot: tools/out/tex-${name}.png`);
  } catch (err) {
    console.log(`FAILED ${name}: ${err.message.split('\n')[0]}`);
  }
}
await browser.close();
