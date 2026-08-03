/**
 * Renders the new full-name placeholder textures for a few prefab names
 * into a single 2x2 tile image (visual check, no game server needed).
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const NAMES = ['StatueDeer', 'Pickable_Mushroom', 'RaspberryBush', 'rock4_forest'];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

const dataUrl = await page.evaluate(async (names) => {
  const { AssetManager } = await import('/src/engine/AssetManager.ts');
  const am = new AssetManager();
  const tile = document.createElement('canvas');
  tile.width = 512;
  tile.height = 512;
  const tctx = tile.getContext('2d');
  names.forEach((n, i) => {
    const tex = am.getPlaceholder(n);
    tctx.drawImage(tex.image, (i % 2) * 256, Math.floor(i / 2) * 256);
  });
  return tile.toDataURL();
}, NAMES);

writeFileSync('tools/out/placeholders.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('saved tools/out/placeholders.png');
await browser.close();
