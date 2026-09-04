// Hilfsmittel: fährt die Steingrab-Seite mit WASD ab und meldet Seitenfehler.

import { chromium } from 'playwright';
const PORT = process.env.PORT || 5901;
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:${PORT}/steingrab.html?segmente=6`, { waitUntil:'networkidle', timeout: 60000 });
await p.waitForFunction(() => window.__steingrab && window.__steingrab.kamera, null, { timeout: 30000 });
const pos0 = await p.evaluate(() => { const k=window.__steingrab.kamera.position; return {x:k.x,y:k.y,z:k.z}; });
// Canvas fokussieren und W halten
await p.click('#leinwand');
await p.keyboard.down('w');
await p.waitForTimeout(1200);
await p.keyboard.up('w');
const pos1 = await p.evaluate(() => { const k=window.__steingrab.kamera.position; return {x:k.x,y:k.y,z:k.z}; });
const d = Math.hypot(pos1.x-pos0.x, pos1.y-pos0.y, pos1.z-pos0.z);
await p.screenshot({ path: `${process.env.HOME}/wov-ai/pipeline-1.0/preview/nach-w.png` });
await b.close();
console.log('pos0', JSON.stringify(pos0)); console.log('pos1', JSON.stringify(pos1));
console.log('DISTANZ', d.toFixed(3), d > 0.5 ? 'WASD OK' : 'WASD BEWEGT NICHT');
if (errs.length) console.log('ERRORS', errs.join(' | '));
