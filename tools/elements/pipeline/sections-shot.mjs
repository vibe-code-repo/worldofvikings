// Hilfsmittel: nimmt die Abschnitts-Ansicht auf und meldet Seitenfehler und 404er.

import { chromium } from 'playwright';
import { aufnahme } from './aufnahmen.mjs';
const PORT = process.env.PORT || 5901;
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 760, height: 520 } });
const errs=[], f404=[];
p.on('pageerror', e => errs.push(e.message));
p.on('response', r => { if (r.status()>=400 && /\.glb/.test(r.url())) f404.push(r.status()+' '+r.url().split('/').pop()); });
await p.goto(`http://localhost:${PORT}/steingrab.html?abschnitte=clean,moos,feucht,frost&pro=2`, { waitUntil:'networkidle', timeout:60000 });
await p.waitForFunction(() => window.__steingrab && window.__steingrab.kamera, null, { timeout:30000 });
const base = await p.evaluate(() => { const k=window.__steingrab.kamera.position; return {x:k.x,y:k.y}; });
const namen=['1-clean','2-moos','3-feucht','4-frost'];
const zs=[4,20,36,52];
for (let i=0;i<zs.length;i++){
  await p.evaluate(({x,y,z})=>{ const k=window.__steingrab.kamera; k.position.set(x,y,z); k.setTarget(new (k.getScene().activeCamera.position.constructor)(x,y-0.3,z+40)); }, {x:base.x,y:base.y,z:zs[i]});
  await p.waitForTimeout(500);
  await p.screenshot({ path:aufnahme(`sec-${namen[i]}.png`) });
}
await b.close();
console.log('SHOTS OK'); if(errs.length) console.log('ERR',errs.join('|')); if(f404.length) console.log('404',f404.join('|'));
