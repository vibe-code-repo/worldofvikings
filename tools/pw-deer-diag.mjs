/**
 * Deer/placeholder diagnostic probe:
 *  1. finds a G2 deer whose object already carries the real GLB model
 *  2. dumps the deer object's render state (world pos vs ZDO pos,
 *     children, bbox, visibility) and takes a CLOSE shot (4 m)
 *  3. dumps the permanently-placeholder static buckets (def name/model)
 *     plus the matching client assetLog entries (why the load failed)
 *
 * Run: node tools/pw-deer-diag.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

const CREATURE_HASHES = { Deer: 291594142, Boar: -1670867714, Greydwarf: 1126707611 };

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWDeerDiag');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — hooking creatures + daylight override…');

await page.evaluate((hashes) => {
  const r = window.__renderer;
  window.__hashToName = new Map(Object.entries(hashes).map(([n, h]) => [h, n]));
  window.__creaturePos = new Map();
  const orig = r.updateZDOEntity.bind(r);
  r.updateZDOEntity = (key, position, prefabHash, rotation, scale) => {
    const name = window.__hashToName.get(prefabHash);
    if (name) {
      const arr = window.__creaturePos.get(name) ?? [];
      arr.push({ key, ...position });
      while (arr.length > 5) arr.shift();
      window.__creaturePos.set(name, arr);
    }
    return orig(key, position, prefabHash, rotation, scale);
  };
  const origDay = r.updateDayNight.bind(r);
  r.updateDayNight = (_t, len) => origDay(750, len);
}, CREATURE_HASHES);

// ── 1+2: deer with real model → diagnose + close shot ─────────────
let deer = null;
for (let i = 0; i < 24; i++) {
  deer = await page.evaluate(() => {
    const r = window.__renderer;
    const THREE_Box = 'BoxGeometry';
    const arr = window.__creaturePos.get('Deer') ?? [];
    for (let k = arr.length - 1; k >= 0; k--) {
      const d = arr[k];
      const obj = r.zdoMeshes?.get(d.key);
      if (!obj || !obj.children) continue;
      const ph = obj.children.some((c) => c.isMesh && c.geometry?.type === THREE_Box);
      if (ph || obj.children.length === 0) continue;
      // render-state of the deer object
      const worldPos = obj.getWorldPosition(new obj.position.constructor());
      const childInfo = obj.children.map((c) => ({
        type: c.type,
        name: c.name ?? null,
        visible: c.visible,
        children: c.children?.length ?? 0,
      }));
      // approximate size via recursive mesh count + first mesh geometry bbox
      let meshCount = 0;
      let bbox = null;
      obj.traverse((n) => {
        if (n.isMesh) {
          meshCount++;
          if (!bbox && n.geometry) {
            n.geometry.computeBoundingBox?.();
            const b = n.geometry.boundingBox;
            if (b) bbox = { x: +(b.max.x - b.min.x).toFixed(2), y: +(b.max.y - b.min.y).toFixed(2), z: +(b.max.z - b.min.z).toFixed(2) };
          }
        }
      });
      return {
        ...d,
        groupWorld: { x: +worldPos.x.toFixed(2), y: +worldPos.y.toFixed(2), z: +worldPos.z.toFixed(2) },
        groupScale: +obj.scale.x.toFixed(3),
        childInfo,
        meshCount,
        firstMeshBBox: bbox,
      };
    }
    return null;
  });
  if (deer) break;
  await page.waitForTimeout(5000);
}

if (!deer) {
  console.log('no model-carrying deer found within 2 minutes');
} else {
  console.log('deer diagnostic:', JSON.stringify(deer, null, 1));
  // close shot: 4 m out, slightly above, immediately (position is fresh)
  await page.evaluate(([d]) => {
    const r = window.__renderer;
    r.updatePlayer = () => {};
    r.camera.position.set(d.x + 3, d.y + 2, d.z + 3);
    r.camera.lookAt(d.x, d.y + 1, d.z);
  }, [deer]);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tools/out/deer-close.png', timeout: 180000 });
  console.log('shot: tools/out/deer-close.png');
}

// ── 3: permanent placeholder buckets + asset log ──────────────────
const placeholders = await page.evaluate(() => {
  const out = [];
  for (const [key, b] of window.__renderer.statics.buckets.entries()) {
    if (!b.sourceMeshes || b.sourceMeshes.length === 0) {
      out.push({ key, name: b.def?.name ?? null, model: b.def?.model ?? null, instances: b.instances.size, loading: b.loading });
    }
  }
  return out;
});
console.log(`placeholder buckets (${placeholders.length}):`, JSON.stringify(placeholders, null, 1));

const logEntries = await page.evaluate((names) => {
  const log = window.__assetLog?.entries?.() ?? [];
  return log.filter((e) => names.some((n) => n && e.name?.toLowerCase().includes(n))).slice(-30);
}, placeholders.flatMap((p) => [p.name?.toLowerCase() ?? '', p.model?.toLowerCase() ?? '']));
console.log('assetLog entries for those prefabs:', JSON.stringify(logEntries, null, 1));

await browser.close();
