/**
 * Visual probe: connect, fly up at spawn, rotate 360°, screenshot — looking
 * for the user's giant "Stat" boxes near the two StatueDeer positions
 * (61m and 203m from spawn).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = 'C:/Users/Administrator/Modding/pw-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

async function shot(name) {
  try {
    await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
    console.log('shot', name);
  } catch (e) {
    console.log('shot', name, 'FAILED');
  }
}

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.selectOption('#time-of-day', '675');
await page.fill('#player-name', 'PWProbe2');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected, 60s world build…');
await page.waitForTimeout(60000);

// pointer lock + fly + ascend
await page.mouse.click(400, 40);
await page.waitForTimeout(1200);
await page.keyboard.press('z');
await page.waitForTimeout(2000);
await page.keyboard.down('Space');
await page.waitForTimeout(6000);
await page.keyboard.up('Space');
console.log('ascended, rotating…');
await page.waitForTimeout(8000);
await shot('10-statue-look0');

for (let i = 1; i < 4; i++) {
  await page.mouse.move(400, 225);
  await page.mouse.move(700, 225, { steps: 6 }); // ~90° turn
  await page.waitForTimeout(5000);
  await shot(`10-statue-look${i}`);
}

await browser.close();
console.log('DONE');
