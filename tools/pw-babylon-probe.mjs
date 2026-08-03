/**
 * Phase-2-Diagnose: Bucket-/Master-Status nach längerer Ladezeit ausgeben.
 * Aufruf: node tools/pw-babylon-probe.mjs [url] [waitSeconds]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5273/?t=0.35';
const waitS = Number(process.argv[3] ?? 30);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[err]', msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(waitS * 1000);

const info = await page.evaluate(() => {
  const dbg = window.__dbg;
  if (!dbg) return { error: 'no __dbg' };
  const { entities, assets, scene } = dbg;
  const buckets = [];
  for (const [hash, b] of entities['buckets']) {
    const masters = entities['masterMeshes'].get(b.prefabName);
    buckets.push({
      hash,
      prefab: b.prefabName,
      instances: b.matrices.length / 16,
      mastersReady: b.mastersReady,
      masterMeshes: masters ? masters.length : 0,
      firstMasterEnabled: masters && masters.length ? masters[0].isEnabled() : null,
      thinCount: masters && masters.length ? masters[0]._thinInstanceDataStorage?.matrixData?.length / 16 : null,
    });
  }
  const totalMeshCount = scene.meshes.length;
  const activeMeshes = scene.getActiveMeshes ? null : null;
  return {
    staticCount: entities.staticCount,
    dynamicCount: entities.dynamicCount,
    bucketCount: buckets.length,
    buckets: buckets.sort((a, b) => b.instances - a.instances).slice(0, 15),
    failedAssets: Object.fromEntries(assets.failed),
    totalMeshCount,
  };
});

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'out/p2-probe.png' });
await browser.close();
