/**
 * Deer close-up probe: finds a G2 deer carrying the real GLB model,
 * freezes its rendered object (matrixAutoUpdate=false), then takes
 * FIVE shots from different angles (4 cardinal + steep top-down) —
 * at ~1 FPS SwiftShader with a wandering target and tree/placeholder
 * occlusion, one of the angles is guaranteed a clear line of sight.
 *
 * Run: node tools/pw-deer-shot.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

const DEER_HASH = 291594142;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWDeerShot');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — hooking deer + daylight override…');

// Let the asset burst settle first: fresh sessions render StoneRock & co.
// as oversized placeholder boxes for the first seconds (until load/retry
// lands) — they occlude and shadow the deer. Wait until nearly all
// buckets carry real meshes (poll 5s, max 2.5 min).
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    let total = 0, ph = 0;
    for (const [, b] of window.__renderer.statics.buckets.entries()) {
      total++;
      if (!b.sourceMeshes || b.sourceMeshes.length === 0) ph++;
    }
    return { total, ph };
  });
  if (i % 3 === 0 || s.ph <= Math.max(2, s.total * 0.1)) console.log(`settle t+${i * 5}s: buckets=${s.total} placeholder=${s.ph}`);
  if (s.total > 0 && s.ph <= Math.max(2, s.total * 0.1)) break;
  await page.waitForTimeout(5000);
}

await page.evaluate((deerHash) => {
  const r = window.__renderer;
  window.__deerKeys = new Set();
  const orig = r.updateZDOEntity.bind(r);
  r.updateZDOEntity = (key, position, prefabHash, rotation, scale) => {
    if (prefabHash === deerHash) window.__deerKeys.add(key);
    return orig(key, position, prefabHash, rotation, scale);
  };
  const origDay = r.updateDayNight.bind(r);
  r.updateDayNight = (_t, len) => origDay(750, len);
}, DEER_HASH);

// Wait for a deer whose placeholder was already swapped for the model
let key = null;
for (let i = 0; i < 24; i++) {
  key = await page.evaluate(() => {
    const r = window.__renderer;
    for (const k of window.__deerKeys) {
      const obj = r.zdoMeshes?.get(k);
      if (!obj || !obj.children) continue;
      const ph = obj.children.some((c) => c.isMesh && c.geometry?.type === 'BoxGeometry');
      if (!ph && obj.children.length > 0) return k;
    }
    return null;
  });
  if (key) break;
  await page.waitForTimeout(5000);
}
if (!key) {
  console.log('no model-carrying deer within 2 minutes');
  await browser.close();
  process.exit(1);
}
console.log('deer key:', key);

// Freeze + report live world position
const pos = await page.evaluate((k) => {
  const r = window.__renderer;
  const obj = r.zdoMeshes.get(k);
  obj.updateMatrixWorld(true);
  const p = obj.getWorldPosition(new obj.position.constructor());
  obj.matrixAutoUpdate = false;
  r.updatePlayer = () => {};
  return { x: p.x, y: p.y, z: p.z };
}, key);
console.log('deer frozen at', JSON.stringify(pos));

const angles = [
  ['N', 0, 2.5, -4], ['S', 0, 2.5, 4], ['E', 4, 2.5, 0], ['W', -4, 2.5, 0],
  ['top', 0.5, 6, 0.5],
];
for (const [name, dx, dy, dz] of angles) {
  await page.evaluate(([px, py, pz, dx, dy, dz]) => {
    const r = window.__renderer;
    r.camera.position.set(px + dx, py + dy, pz + dz);
    r.camera.lookAt(px, py + 0.8, pz);
  }, [pos.x, pos.y, pos.z, dx, dy, dz]);
  await page.waitForTimeout(3000); // ≥2 frames at ~1 FPS
  await page.screenshot({ path: `tools/out/deer-${name}.png`, timeout: 180000 });
  console.log(`shot: tools/out/deer-${name}.png`);
}

await browser.close();
