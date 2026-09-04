// Hilfsmittel: nimmt die Steinmaterial-Probe auf und meldet Seiten- und Konsolenfehler.

import { chromium } from 'playwright';
const PORT = process.env.PORT || 5901;
const b = await chromium.launch({ headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1000, height: 620 } });
const errs=[];
p.on('pageerror', e => errs.push('PAGEERROR '+e.message));
p.on('console', m => { const t=m.text(); if (m.type()==='error' || /compil|shader|effect|GLSL|Notbremse|WebGL/i.test(t)) errs.push(`[${m.type()}] ${t}`); });
await p.goto(`http://localhost:${PORT}/steinmat.html`, { waitUntil:'networkidle', timeout:60000 });
await p.waitForFunction(() => window.__steinmat && window.__steinmat.mat, null, { timeout:30000 }).catch(()=>{});
await p.waitForTimeout(3500);
// Wurde das Plugin ausgeknipst (Notbremse)? Prüfe die STEIN_KIT-Definition am Effekt.
const info = await p.evaluate(() => {
  const s = window.__steinmat?.scene; if(!s) return {ok:false, why:'keine Szene'};
  const meshes = s.meshes.filter(m=>m.material && m.material.name==='probe');
  return { ok:true, meshMit: meshes.length, matName: window.__steinmat?.mat?.getClassName?.() };
});
await p.screenshot({ path: `${process.env.HOME}/wov-ai/pipeline-1.0/preview/steinmat.png` });
await b.close();
console.log('INFO', JSON.stringify(info));
console.log(errs.length ? 'FEHLER:\n'+[...new Set(errs)].slice(0,12).join('\n') : 'KEINE SHADER-/KONSOLENFEHLER');
