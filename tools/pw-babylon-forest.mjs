/**
 * Findet Black-Forest-Koordinaten im laufenden Client (worldgen im Browser)
 * und macht davon direkt einen Screenshot. Aufruf: node tools/pw-babylon-forest.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5273/?t=0.5&offline', { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);

const pos = await page.evaluate(() => {
  const world = window.__dbg.terrain['world'];
  const geo = world.geo;
  // Biome enum: BlackForest = 8
  for (let r = 150; r < 6000; r += 64) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a * Math.PI) / 8) * r);
      const z = Math.round(Math.sin((a * Math.PI) / 8) * r);
      if (geo.getBiome(x, z) === 8) return { x, z };
    }
  }
  return null;
});
console.log('blackforest at:', JSON.stringify(pos));
await browser.close();

if (pos) {
  const b2 = await chromium.launch();
  const p2 = await b2.newPage({ viewport: { width: 1600, height: 900 } });
  p2.on('pageerror', (err) => console.log('[pageerror]', err.message));
  const errors = [];
  p2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await p2.goto(`http://localhost:5273/?t=0.5&pos=${pos.x},${pos.z}`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(35000);
  await p2.screenshot({ path: 'out/p2-blackforest.png' });
  console.log('SHOT: out/p2-blackforest.png');
  for (const e of errors.slice(0, 5)) console.log('[err]', e);
  await b2.close();
}
