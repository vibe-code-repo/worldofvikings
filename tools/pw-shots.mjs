/**
 * Playwright smoke/screenshot harness for the Valheim browser client.
 * SwiftShader (software WebGL) is SLOW (~1 fps) and the server kicks idle
 * clients — so the flow is defensive: reconnect when the connect screen
 * reappears, every step wrapped so later shots still happen.
 *
 * Run: node tools/pw-shots.mjs   (from valheim-browser root)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = 'C:/Users/Administrator/Modding/pw-shots';
mkdirSync(OUT, { recursive: true });
const SHOT_TIMEOUT = 180000;

const logs = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });

page.on('console', (msg) => {
  const line = `[console.${msg.type()}] ${msg.text()}`;
  logs.push(line);
  if (msg.type() === 'error') console.log(line);
});
page.on('pageerror', (err) => {
  logs.push(`[pageerror] ${err.message}`);
  console.log(`[pageerror] ${err.message}`);
});
page.on('requestfailed', (req) => {
  logs.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
  console.log(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
});
page.on('response', (res) => {
  if (res.status() >= 400) {
    logs.push(`[http ${res.status()}] ${res.url()}`);
    console.log(`[http ${res.status()}] ${res.url()}`);
  }
});

async function shot(name) {
  try {
    await page.screenshot({ path: `${OUT}/${name}.png`, timeout: SHOT_TIMEOUT });
    console.log(`shot ${name}`);
  } catch (e) {
    console.log(`shot ${name} FAILED: ${e.message.split('\n')[0]}`);
  }
}

const connectScreenVisible = () =>
  page.evaluate(() => {
    const el = document.getElementById('connect-screen');
    return el && getComputedStyle(el).display !== 'none';
  });

async function ensureConnected() {
  if (await connectScreenVisible()) {
    console.log('(re)connecting…');
    await page.click('#connect-btn');
    await page.waitForFunction(
      () => document.getElementById('hud')?.style.display !== 'none',
      { timeout: 60000 }
    );
    await page.waitForTimeout(3000);
  }
}

console.log('== open http://localhost:3000 ==');
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.selectOption('#time-of-day', '675');
await page.fill('#player-name', 'PWScout');
await page.click('#connect-btn');
console.log('== connect clicked, waiting for HUD ==');
await page.waitForFunction(
  () => document.getElementById('hud')?.style.display !== 'none',
  { timeout: 60000 }
);

console.log('== waiting 75s for world build ==');
await page.waitForTimeout(75000);
await shot('01-spawn');

// Fly up (reconnect first if the server kicked us during the slow build)
try {
  await ensureConnected();
  await page.mouse.click(400, 40); // pointer lock, away from center panel
  await page.waitForTimeout(1500);
  await page.keyboard.press('z');
  await page.waitForTimeout(2500);
  const flyOn = await page.evaluate(
    () => document.getElementById('fly-indicator')?.style.display !== 'none'
  );
  console.log('fly indicator on:', flyOn);

  console.log('== ascend (Space 8s) ==');
  await page.keyboard.down('Space');
  await page.waitForTimeout(8000);
  await page.keyboard.up('Space');
  await page.waitForTimeout(15000);
  await shot('02-air');

  console.log('== ascend more (Space 8s) ==');
  await ensureConnected();
  await page.mouse.click(400, 40);
  await page.waitForTimeout(800);
  await page.keyboard.down('Space');
  await page.waitForTimeout(8000);
  await page.keyboard.up('Space');
  await page.waitForTimeout(15000);
  await shot('03-high');

  // Turn around (pointer-lock deltas) and look again
  await page.mouse.move(400, 225);
  await page.mouse.move(760, 225, { steps: 8 });
  await page.waitForTimeout(6000);
  await shot('04-high-back');
} catch (e) {
  console.log('fly sequence aborted:', e.message.split('\n')[0]);
  await shot('99-aborted');
}

const hud = await page.evaluate(() => ({
  fps: document.getElementById('fps-counter')?.textContent,
  time: document.getElementById('world-time')?.textContent,
  players: document.getElementById('player-count')?.textContent,
})).catch(() => null);
console.log('HUD:', JSON.stringify(hud));

const errors = logs.filter((l) => l.includes('error') || l.includes('http 4') || l.includes('failed'));
console.log(`\n== ${errors.length} error lines ==`);
for (const e of errors.slice(0, 40)) console.log(e);

await browser.close();
console.log('DONE');
