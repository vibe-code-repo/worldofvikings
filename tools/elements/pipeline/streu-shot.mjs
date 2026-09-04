// Hilfsmittel: nimmt die Streu-Probe auf und meldet Seitenfehler und 404er.

import { chromium } from 'playwright';
const PORT = process.env.PORT || 5901;
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 760, height: 500 } });
const errs=[], f404=[];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
p.on('response', r => { if (r.status()>=400) f404.push(r.status()+' '+r.url().split('/').pop()); });
await p.goto(`http://localhost:${PORT}/steingrab.html?segmente=8`, { waitUntil:'networkidle', timeout:60000 });
await p.waitForFunction(() => window.__steingrab && window.__steingrab.kamera, null, { timeout:30000 });
await p.waitForTimeout(1500);
const base = await p.evaluate(() => { const k=window.__steingrab.kamera.position; return {x:k.x,y:k.y}; });
const zs=[6,22,38,54];
for (let i=0;i<zs.length;i++){
  await p.evaluate(({x,y,z})=>{ const k=window.__steingrab.kamera; const V=k.position.constructor; k.position.set(x,y,z); k.setTarget(new V(x,y-0.3,z+40)); }, {x:base.x,y:base.y,z:zs[i]});
  await p.waitForTimeout(450);
  await p.screenshot({ path:`${process.env.HOME}/wov-ai/pipeline-1.0/preview/streu-${i}.png` });
}
await b.close();
console.log('SHOTS OK'); if(errs.length) console.log('ERR', errs.slice(0,6).join(' | ')); if(f404.length) console.log('404', [...new Set(f404)].join(' | '));
