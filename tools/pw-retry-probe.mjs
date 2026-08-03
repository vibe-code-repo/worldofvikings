/**
 * Retry-probe: proves the placeholder self-healing end-to-end.
 *
 *  1. The FIRST StatueDeer.glb request is aborted (simulated transient
 *     failure — the suspected cause of the user's session-permanent cube).
 *  2. The statue ZDO streams in → placeholder bucket + assetLog entry.
 *  3. Later requests pass; after the 35s retry the bucket must have real
 *     sourceMeshes (statue mesh replaces the cube in place).
 *  4. Bonus after the G2 server restart: creature ZDOs (Deer/Boar) should
 *     appear around the spawn-standing player within ~2 minutes.
 *
 * Run: node tools/pw-retry-probe.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

// getStableHash values (computed via npx tsx on shared/src)
const CREATURE_HASHES = { Deer: 291594142, Boar: -1670867714, Greydwarf: 1126707611 };
let aborted = 0;
let passed = 0;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// Abort only the FIRST StatueDeer fetch — the retry must succeed later
await page.route('**/assets/models/StatueDeer.glb', (route) => {
  if (aborted === 0) {
    aborted++;
    console.log('>> aborting FIRST StatueDeer.glb request (simulated transient failure)');
    route.abort('failed');
  } else {
    passed++;
    console.log(`>> letting StatueDeer.glb request #${aborted + passed} through`);
    route.continue();
  }
});

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWRetry');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — waiting for the statue bucket + first (aborted) load…');

// Record every prefab hash that streams in (creature check)
await page.evaluate((hashes) => {
  window.__creatureHashes = hashes;
  const r = window.__renderer;
  window.__seenPrefabs = new Map();
  const orig = r.updateZDOEntity.bind(r);
  r.updateZDOEntity = (key, hash, pos, rot, scale) => {
    window.__seenPrefabs.set(hash, (window.__seenPrefabs.get(hash) ?? 0) + 1);
    return orig(key, hash, pos, rot, scale);
  };
}, CREATURE_HASHES);

// Wait until the StatueDeer bucket exists and its first load attempt failed
const bucketSeen = await page.waitForFunction(() => {
  const r = window.__renderer;
  for (const [, b] of r.statics.buckets.entries()) {
    if (b.def?.name === 'StatueDeer') return true;
  }
  return false;
}, { timeout: 90000 }).catch(() => null);
console.log('StatueDeer bucket seen:', !!bucketSeen, '| aborted:', aborted);

const afterFail = await page.evaluate(() => {
  const r = window.__renderer;
  for (const [, b] of r.statics.buckets.entries()) {
    if (b.def?.name === 'StatueDeer') {
      return { instances: b.instances.size, sourceMeshes: b.sourceMeshes ? b.sourceMeshes.length : null, loading: b.loading };
    }
  }
  return null;
});
console.log('bucket right after first load attempt:', JSON.stringify(afterFail));

console.log('waiting ~50s for the 35s retry to fire…');
await page.waitForTimeout(50000);

const afterRetry = await page.evaluate(() => {
  const r = window.__renderer;
  const out = { bucket: null, creatures: {}, assetLogEntries: window.__assetLog?.entries?.length ?? null };
  for (const [, b] of r.statics.buckets.entries()) {
    if (b.def?.name === 'StatueDeer') {
      out.bucket = { instances: b.instances.size, sourceMeshes: b.sourceMeshes ? b.sourceMeshes.length : null, loading: b.loading, meshes: b.meshes.length };
    }
  }
  for (const [name, hash] of Object.entries(window.__creatureHashes)) {
    out.creatures[name] = window.__seenPrefabs.get(hash) ?? 0;
  }
  return out;
});
console.log('after retry window:', JSON.stringify(afterRetry, null, 1));

// Freeze camera at statue1 for visual proof
await page.evaluate(() => {
  const r = window.__renderer;
  r.updatePlayer = () => {};
  r.camera.position.set(-11.9 + 10, 45.9 + 5, 60.0 + 10);
  r.camera.lookAt(-11.9, 47.0, 60.0);
});
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tools/out/retry-statue.png', timeout: 180000 });
console.log('shot: tools/out/retry-statue.png');

// Give creatures a little longer if none yet (spawn rolls: 5s @ 0.4/0.35)
let creatureReport = afterRetry.creatures;
if (typeof creatureReport === 'object' && Object.values(creatureReport).every((n) => n === 0)) {
  console.log('no creatures yet — waiting another 90s for spawn rolls…');
  await page.waitForTimeout(90000);
  creatureReport = await page.evaluate(() => {
    const out = {};
    if (window.__creatureHashes) {
      for (const [name, hash] of Object.entries(window.__creatureHashes)) {
        out[name] = window.__seenPrefabs.get(hash) ?? 0;
      }
    }
    return out;
  });
}
console.log('creatures seen (ZDO creates):', JSON.stringify(creatureReport));
console.log('StatueDeer requests: aborted =', aborted, ', passed =', passed);

await browser.close();
