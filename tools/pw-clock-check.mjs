/**
 * Clock-check probe: connects and reads the HUD clock twice, 25 s apart.
 * With the 1 Hz TimeSync broadcast (fix live) the in-game time must
 * ADVANCE within a single session (~20 in-game minutes per 25 real s).
 * Before the fix it stayed frozen at the connect-time value.
 *
 * Run: node tools/pw-clock-check.mjs   (dev server + game server running)
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWClock');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });

const readClock = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => /Day \d+,/.test(d.textContent ?? ''));
  const m = (el?.textContent ?? '').match(/Day \d+, \d+:\d+/);
  return m ? m[0] : null;
});

const t1 = await readClock();
await page.waitForTimeout(25000);
const t2 = await readClock();
console.log(`clock at connect : ${t1}`);
console.log(`clock after 25 s : ${t2}`);
console.log(t1 && t2 && t1 !== t2 ? 'PASS — time advances in-session (TimeSync live)' : 'FAIL — clock frozen');
await browser.close();
