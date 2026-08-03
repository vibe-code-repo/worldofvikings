/**
 * Targeted probe: load StatueDeer.glb in the real browser page and capture
 * the actual GLTFLoader error (console.warn included).
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Load through the app's OWN AssetManager module (vite-transformed, same
// three instance the game uses)
const result = await page.evaluate(async () => {
  try {
    const { AssetManager } = await import('/src/engine/AssetManager.ts');
    const assets = new AssetManager();
    const model = await assets.loadModel('StatueDeer');
    if (!model) return 'loadModel returned NULL (load failed)';
    let meshes = 0;
    model.traverse((o) => { if (o.isMesh) meshes++; });
    return `LOAD OK, ${meshes} meshes`;
  } catch (e) {
    return `EVAL FAIL: ${e.message}`;
  }
});
console.log('RESULT:', result);
await page.waitForTimeout(3000); // let async texture errors flush
await browser.close();
