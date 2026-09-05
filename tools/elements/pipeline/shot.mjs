// Hilfsmittel: nimmt eine Seite des Vorschau-Servers im Browser auf (Playwright, Vulkan-Flags) und meldet Konsolenfehler.

import { chromium } from 'playwright';
import { aufnahme } from './aufnahmen.mjs';
const PORT = process.env.PORT || 5901;
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu-rasterization'] });
const p = await b.newPage({ viewport: { width: 1100, height: 680 } });
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR '+e.message));
await p.goto(`http://localhost:${PORT}/steingrab.html?segmente=6`, { waitUntil:'networkidle', timeout: 60000 });
await p.waitForTimeout(3500);
await p.screenshot({ path: aufnahme('begehbar.png') });
await b.close();
console.log('SHOT OK'); if (errs.length) console.log('ERRORS:\n'+errs.slice(0,10).join('\n'));
