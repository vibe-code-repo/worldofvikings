/** Fragment-Sampler-Budget der Engine melden (Etappe-5-Vorprüfung). */
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5274/?offline=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__dbg?.scene != null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const caps = window.__dbg.scene.getEngine().getCaps();
  return {
    maxTexturesImageUnits: caps.maxTexturesImageUnits,
    maxCombinedTexturesImageUnits: caps.maxCombinedTexturesImageUnits,
    maxTextureSize: caps.maxTextureSize,
  };
}));
await browser.close();
