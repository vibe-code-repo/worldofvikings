/**
 * Deer mesh diagnosis: which mesh is which? Paints deer_solid bright red,
 * logs per-mesh node names/materials/world bboxes, screenshot vs. sky.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWDeer');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected');

const info = await page.evaluate(async () => {
  const r = window.__renderer;
  const origDN = r.updateDayNight.bind(r);
  r.updateDayNight = (_t, d) => origDN(0.42 * d, d);
  r.updatePlayer = () => {};
  let sun = null;
  r.scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
  if (sun) {
    const fill = sun.clone();
    fill.position.set(-sun.position.x, sun.position.y * 0.5, -sun.position.z);
    fill.intensity = sun.intensity * 0.8;
    r.scene.add(fill);
  }
  const cam = r.camera.position.clone();
  const model = await r.assets.loadModel('Deer');
  model.position.set(cam.x, cam.y + 40, cam.z - 6);
  model.rotation.y = Math.PI * 0.5; // side view
  r.scene.add(model);
  window.__deer = model;
  model.updateMatrixWorld(true);

  const out = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
      const w = new o.position.constructor(cx, cy, cz).applyMatrix4(o.matrixWorld);
      min[0] = Math.min(min[0], w.x); min[1] = Math.min(min[1], w.y); min[2] = Math.min(min[2], w.z);
      max[0] = Math.max(max[0], w.x); max[1] = Math.max(max[1], w.y); max[2] = Math.max(max[2], w.z);
    }
    // solid material -> bright red for identification
    if (o.material.name === 'deer_solid') o.material.color.setRGB(1, 0, 0);
    out.push({
      node: o.name, mat: o.material.name, verts: o.geometry.attributes.position.count,
      hasUV: !!o.geometry.attributes.uv,
      worldSize: max.map((v, i) => +(v - min[i]).toFixed(2)),
      worldCenter: max.map((v, i) => +((v + min[i]) / 2).toFixed(2)),
    });
  });
  // frame the whole deer, camera level so background = sky
  const c = out.reduce((s, m) => s.map((v, i) => v + m.worldCenter[i] / out.length), [0, 0, 0]);
  r.camera.position.set(c[0] + 0.3, c[1] + 0.2, c[2] + 3.2);
  r.camera.lookAt(c[0], c[1] + 0.25, c[2]);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/deer-mesh-diag.png', timeout: 180000 });
console.log('shot: tools/out/deer-mesh-diag.png');
await browser.close();
