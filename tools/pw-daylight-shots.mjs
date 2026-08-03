/**
 * Daylight probe: forces bright-morning lighting CLIENT-SIDE (wraps
 * renderer.updateDayNight with a fixed 10:00 time-of-day), then shoots
 *  (a) the StatueDeer at the altar (proof the retry healed it visually)
 *  (b) the nearest spawned Deer from the G2 system (visual proof)
 * Night screenshots on SwiftShader are pitch black. Waiting for real
 * daylight is not possible: TimeSync is only sent at connect, so the
 * client clock/lighting stays frozen at its connect-time value (server
 * bug found via this probe — fixed server-side by a 1 Hz TimeSync
 * broadcast; goes live with the next server restart).
 *
 * v2: waits for the asset burst to settle (StatueDeer bucket must have
 * real sourceMeshes; placeholder buckets are counted) before shooting,
 * uses closer camera angles, and verifies the deer's object actually
 * carries a cloned model (not the placeholder) before the deer shot.
 *
 * Run: node tools/pw-daylight-shots.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

const CREATURE_HASHES = { Deer: 291594142, Boar: -1670867714, Greydwarf: 1126707611 };
const STATUE = { x: -11.9, y: 47.0, z: 60.0 };

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWDaylight');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — installing creature hook + lighting override…');

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
}, CREATURE_HASHES);

// Force bright-morning lighting client-side (10:00 ⇒ t = 750/1800).
// The render loop calls renderer.updateDayNight(serverTimeOfDay, …) every
// frame; wrapping the method intercepts every subsequent call.
await page.evaluate(() => {
  const r = window.__renderer;
  const orig = r.updateDayNight.bind(r);
  r.updateDayNight = (_timeOfDay, dayLength) => orig(750, dayLength);
});
console.log('lighting override installed (fixed 10:00)');

const bucketStats = () => page.evaluate(() => {
  const out = { total: 0, placeholder: 0, statue: null };
  for (const [, b] of window.__renderer.statics.buckets.entries()) {
    out.total++;
    if (!b.sourceMeshes || b.sourceMeshes.length === 0) out.placeholder++;
    if (b.def?.name === 'StatueDeer') {
      out.statue = { instances: b.instances.size, sourceMeshes: b.sourceMeshes?.length ?? null };
    }
  }
  return out;
});

// Wait for the asset burst to settle: StatueDeer bucket with real meshes,
// placeholder share shrinking. Poll 5s, max 3 min.
let stats = null;
for (let i = 0; i < 36; i++) {
  stats = await bucketStats();
  if (i % 3 === 0 || stats.statue?.sourceMeshes) {
    console.log(`settle t+${i * 5}s: buckets=${stats.total} placeholder=${stats.placeholder} statue=${JSON.stringify(stats.statue)}`);
  }
  if (stats.statue?.sourceMeshes > 0 && stats.placeholder <= stats.total * 0.2) break;
  await page.waitForTimeout(5000);
}

const shot = async (name, cx, cy, cz, lx, ly, lz, settleMs = 4000) => {
  await page.evaluate(([cx, cy, cz, lx, ly, lz]) => {
    const r = window.__renderer;
    r.updatePlayer = () => {};
    r.camera.position.set(cx, cy, cz);
    r.camera.lookAt(lx, ly, lz);
  }, [cx, cy, cz, lx, ly, lz]);
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `tools/out/day-${name}.png`, timeout: 180000 });
  console.log(`shot: tools/out/day-${name}.png`);
};

// (a) the healed statue at the altar — close-in, inside the leveled
// clearing (trees start at the plateau edge, so stay within ~5 m)
await shot('statue', STATUE.x + 2.5, STATUE.y + 2, STATUE.z + 2.5, STATUE.x, STATUE.y + 1, STATUE.z, 8000);

// (b) nearest deer with a REAL model (not a placeholder), max 2 min wait
let deer = null;
for (let i = 0; i < 24; i++) {
  deer = await page.evaluate(() => {
    const r = window.__renderer;
    const arr = window.__creaturePos.get('Deer') ?? [];
    for (let k = arr.length - 1; k >= 0; k--) {
      const d = arr[k];
      const obj = r.zdoMeshes?.get(d.key);
      if (!obj || !obj.children) continue; // despawned / not yet rendered
      // placeholder = the BoxGeometry mesh from createPlaceholderMesh;
      // the healed state has it replaced by the cloned GLB scene
      const ph = obj.children.some((c) => c.isMesh && c.geometry?.type === 'BoxGeometry');
      return { ...d, children: obj.children.length, hasModel: !ph && obj.children.length > 0, placeholder: ph };
    }
    return null;
  });
  if (deer?.hasModel) break;
  if (deer && i % 4 === 0) console.log('deer seen but still placeholder — waiting…', JSON.stringify(deer));
  await page.waitForTimeout(5000);
}
if (deer) {
  console.log('deer at', JSON.stringify(deer));
  // Freeze the deer's rendered object (matrixAutoUpdate=false) so it can't
  // wander out of the frame between camera placement and shutter — at
  // ~1 FPS SwiftShader that gap is several seconds of walking. Aim at the
  // object's LIVE world position, not the cached ZDO position.
  await page.evaluate(([key]) => {
    const r = window.__renderer;
    const obj = r.zdoMeshes.get(key);
    if (!obj) return null;
    obj.updateMatrixWorld(true);
    const p = obj.getWorldPosition(new obj.position.constructor());
    obj.matrixAutoUpdate = false;
    r.updatePlayer = () => {};
    r.camera.position.set(p.x + 3.5, p.y + 2, p.z + 3.5);
    r.camera.lookAt(p.x, p.y + 0.8, p.z);
  }, [deer.key]);
  await page.waitForTimeout(3500); // ≥2 frames at ~1 FPS
  await page.screenshot({ path: 'tools/out/day-deer.png', timeout: 180000 });
  console.log('shot: tools/out/day-deer.png');
} else {
  console.log('no deer with loaded model within 2 minutes — skipping deer shot');
}

console.log('final buckets:', JSON.stringify(await bucketStats()));
await browser.close();
