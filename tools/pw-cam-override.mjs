/**
 * Camera-override probe: connect, freeze the orbit camera (updatePlayer no-op),
 * then place the camera manually at the two StatueDeer spots and above the
 * spawn circle — ground truth for what a healthy client renders there.
 * Also dumps the StatueDeer bucket state and window.__assetLog entries.
 */
import { chromium } from 'playwright';

const SHOTS = [
  // [name, camX, camY, camZ, lookX, lookY, lookZ]
  ['statue1', -11.9 + 10, 45.9 + 5, 60.0 + 10, -11.9, 47.0, 60.0],
  ['statue2', 150.8 + 10, 39.7 + 5, 135.3 + 10, 150.8, 40.7, 135.3],
  ['overview', 0, 140, 50, 0, 25, 0],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() !== 'debug') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWProbe');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected, waiting 45s for ZDO stream…');
await page.waitForTimeout(45000);

// Freeze the orbit camera so we can place it manually
await page.evaluate(() => {
  const r = window.__renderer;
  r.updatePlayer = () => {};
});

for (const [name, cx, cy, cz, lx, ly, lz] of SHOTS) {
  await page.evaluate(([cx, cy, cz, lx, ly, lz]) => {
    const r = window.__renderer;
    r.camera.position.set(cx, cy, cz);
    r.camera.lookAt(lx, ly, lz);
  }, [cx, cy, cz, lx, ly, lz]);
  await page.waitForTimeout(3000); // ≥1 render at ~1 FPS swiftshader
  await page.screenshot({ path: `tools/out/cam-${name}.png`, timeout: 180000 });
  console.log(`shot: cam-${name}.png`);
}

const report = await page.evaluate(() => {
  const r = window.__renderer;
  const out = { statueBuckets: [], assetLog: null };
  for (const [hash, b] of r.statics.buckets.entries()) {
    if (b.def?.name?.startsWith('Statue')) {
      out.statueBuckets.push({
        hash,
        name: b.def?.name,
        instances: b.instances.size,
        sourceMeshes: b.sourceMeshes ? b.sourceMeshes.length : null,
        loading: b.loading,
        meshes: b.meshes.length,
      });
    }
  }
  const log = window.__assetLog;
  out.assetLog = log ? { buffered: log.entries?.length ?? null, entries: log.entries ?? null } : 'no __assetLog';
  return out;
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
