/**
 * Creature-probe (fixed): hook updateZDOEntity with the CORRECT signature
 * (key, position, prefabHash, rotation?, scale?) and wait for G2 spawns
 * around the spawn-standing player. On the first Deer/Boar sighting the
 * camera freezes at the creature's last position for a screenshot.
 *
 * Run: node tools/pw-creature-probe.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

// getStableHash values (computed via npx tsx on shared/src)
const CREATURE_HASHES = { Deer: 291594142, Boar: -1670867714, Greydwarf: 1126707611 };

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWCreatures');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected — installing correct ZDO hook (hash = arg #3)…');

await page.evaluate((hashes) => {
  const r = window.__renderer;
  window.__creatureHashes = hashes;
  window.__hashToName = new Map(Object.entries(hashes).map(([n, h]) => [h, n]));
  window.__seenPrefabs = new Map(); // hash → count
  window.__creaturePos = new Map(); // name → [{x,y,z}, ...] (last 5)
  const orig = r.updateZDOEntity.bind(r);
  r.updateZDOEntity = (key, position, prefabHash, rotation, scale) => {
    window.__seenPrefabs.set(prefabHash, (window.__seenPrefabs.get(prefabHash) ?? 0) + 1);
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

// Poll up to 3 minutes for the first creature
let sighting = null;
for (let i = 0; i < 36; i++) {
  await page.waitForTimeout(5000);
  sighting = await page.evaluate(() => {
    const out = { counts: {}, total: window.__seenPrefabs.size, sample: null };
    for (const [name] of Object.entries(window.__creatureHashes)) {
      const arr = window.__creaturePos.get(name);
      out.counts[name] = arr?.length ?? 0;
      if (arr?.length && !out.sample) out.sample = { name, ...arr[arr.length - 1] };
    }
    return out;
  });
  if (i % 6 === 0 || sighting.sample) {
    console.log(`t+${(i + 1) * 5}s:`, JSON.stringify(sighting.counts), `uniqueHashes=${sighting.total}`);
  }
  if (sighting.sample) break;
}

if (!sighting?.sample) {
  console.log('NO creatures seen within 3 minutes — dump top hashes:');
  const top = await page.evaluate(() =>
    [...window.__seenPrefabs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  );
  console.log(JSON.stringify(top));
  await browser.close();
  process.exit(1);
}

console.log('SIGHTING:', JSON.stringify(sighting.sample));

// Freeze camera near the creature and take a screenshot
const p = sighting.sample;
await page.evaluate(([px, py, pz]) => {
  const r = window.__renderer;
  r.updatePlayer = () => {};
  r.camera.position.set(px + 8, py + 5, pz + 8);
  r.camera.lookAt(px, py + 1, pz);
}, [p.x, p.y, p.z]);
await page.waitForTimeout(4000); // ≥2 frames at ~1 FPS
await page.screenshot({ path: 'tools/out/creature-live.png', timeout: 180000 });
console.log('shot: tools/out/creature-live.png');

const final = await page.evaluate(() => {
  const out = { counts: {}, zdoMeshes: window.__renderer.zdoMeshes.size };
  for (const [name] of Object.entries(window.__creatureHashes)) {
    out.counts[name] = window.__creaturePos.get(name)?.length ?? 0;
  }
  return out;
});
console.log('final:', JSON.stringify(final));
await browser.close();
