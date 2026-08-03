/**
 * Live scene probe: connect, then inspect the StatueDeer bucket state and
 * any large box meshes near the two statue positions.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => { if (m.type() !== 'debug') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWProbe');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected, waiting 60s for ZDO stream…');
await page.waitForTimeout(60000);

const report = await page.evaluate(() => {
  const r = window.__renderer;
  if (!r) return 'no __renderer';
  const out = { buckets: [], bigBoxes: [], statueBucket: null };
  const statics = r.statics;
  if (statics?.buckets) {
    for (const [hash, b] of statics.buckets.entries()) {
      const entry = {
        hash,
        name: b.def?.name,
        instances: b.instances.size,
        sourceMeshes: b.sourceMeshes ? b.sourceMeshes.length : null,
        loading: b.loading,
        meshes: b.meshes.length,
      };
      out.buckets.push(entry);
      if (b.def?.name?.startsWith('Statue')) out.statueBucket = entry;
    }
  }
  // walk scene for box meshes with large bounds
  r.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    if (g?.type !== 'BoxGeometry') return;
    const p = g.parameters ?? {};
    if ((p.height ?? 0) < 3) return;
    out.bigBoxes.push({
      type: o.type,
      count: o.count ?? 1,
      w: p.width, h: p.height, d: p.depth,
      pos: o.isInstancedMesh ? '(instanced)' : `${o.position.x.toFixed(1)},${o.position.y.toFixed(1)},${o.position.z.toFixed(1)}`,
      parentScale: o.parent ? `${o.parent.scale.x.toFixed(2)}` : '?',
    });
  });
  return out;
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
