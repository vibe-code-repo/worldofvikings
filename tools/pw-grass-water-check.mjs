/**
 * G-VEG/G-WAT live check: does the CURRENT client build grass + water normal
 * map? Reports console load messages, grass chunk/instance counts, water
 * material state, player biome — plus ground close-up + water screenshots.
 *
 * Run: node tools/pw-grass-water-check.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleLines = [];
page.on('console', (m) => {
  const t = m.text();
  if (/GrassClutter|Terrain\]|water|grass/i.test(t)) consoleLines.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWGW');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected');
await page.waitForTimeout(45000); // grass builds ≤1 zone/frame, SwiftShader ~1 FPS (+ drop/rebuild nach Leveling)

const report = await page.evaluate(() => {
  const r = window.__renderer;
  const out = { biome: null, grass: null, water: null, playerPos: null };
  const p = r.playerMesh?.position;
  if (p) out.playerPos = [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)];
  out.biome = r.getBiomeAt(p.x, p.z);

  // Grass: count InstancedMesh with our grass material names / geometry
  let chunks = 0, instances = 0;
  r.scene.traverse((o) => {
    if (o.isInstancedMesh && o.material?.map?.source?.data?.src?.includes('grass_')) {
      chunks++;
      instances += o.count;
    }
  });
  out.grass = { ready: r.grass?.ready ?? 'n/a', chunks, instances };

  // Water: find the two big planes
  const waters = [];
  r.scene.traverse((o) => {
    if (o.isMesh && o.material?.transparent && o.material?.color?.getHex?.() === 0x2a5a7a) {
      waters.push({
        hasNormalMap: !!o.material.normalMap,
        normalMapLoaded: !!(o.material.normalMap?.image?.width),
        normalScale: o.material.normalScale?.toArray?.(),
        opacity: o.material.opacity,
      });
    }
  });
  out.water = waters;
  return out;
});
console.log(JSON.stringify(report, null, 1));
console.log('--- console (grass/water) ---');
consoleLines.forEach((l) => console.log(l));

// Screenshot 1: Bodennahaufnahme (Gras)
await page.evaluate(() => {
  const r = window.__renderer;
  const origDN = r.updateDayNight.bind(r);
  r.updateDayNight = (_t, d) => origDN(0.42 * d, d);
  r.updatePlayer = () => {};
  const p = r.playerMesh.position;
  r.camera.position.set(p.x + 4, p.y + 2.5, p.z + 4);
  r.camera.lookAt(p.x, p.y, p.z);
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/gw-ground.png', timeout: 240000 });
console.log('shot: tools/out/gw-ground.png');

// Screenshot 2: Wasser — Kamera ans Ufer, Richtung Wasserlevel schauen
await page.evaluate(() => {
  const r = window.__renderer;
  const p = r.playerMesh.position;
  // suche Wasser in Laufrichtung: taste nach Westen bis Höhe < 30 (Wasserlevel)
  let wx = p.x, wz = p.z;
  for (let d = 0; d < 400; d += 8) {
    if (r.getTerrainHeight(p.x - d, p.z) < 29.5) { wx = p.x - d; break; }
    if (r.getTerrainHeight(p.x + d, p.z) < 29.5) { wx = p.x + d; break; }
    if (r.getTerrainHeight(p.x, p.z - d) < 29.5) { wz = p.z - d; break; }
    if (r.getTerrainHeight(p.x, p.z + d) < 29.5) { wz = p.z + d; break; }
  }
  r.camera.position.set(wx + 6, 34, wz + 6);
  r.camera.lookAt(wx - 30, 30, wz - 30);
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/gw-water.png', timeout: 240000 });
console.log('shot: tools/out/gw-water.png');
await browser.close();
