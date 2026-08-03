/**
 * Phase-1-Baseline: Screenshot des Babylon-Clients.
 * Aufruf: node tools/pw-babylon-shot.mjs [url] [outfile]
 * Voraussetzung: npm run dev:client läuft (Port 5273).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const url = process.argv[2] ?? 'http://localhost:5273/?t=0.35';
const out = process.argv[3] ?? new URL('../out/p1-baseline.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`${msg.type()}: ${msg.text()}`);
  else console.log('[console]', msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
// Terrain baut sich mit 2 Chunks/Frame auf (81 Chunks) und ~55 Prefab-GLBs
// laden lazily — unter SwiftShader (headless) dauert das spürbar länger.
await page.waitForTimeout(Number(process.argv[4] ?? 35000));
await page.screenshot({ path: out });
console.log('SHOT:', out);
if (errors.length) {
  console.log('--- console errors/warnings ---');
  for (const e of errors.slice(0, 20)) console.log(e);
}
await browser.close();
