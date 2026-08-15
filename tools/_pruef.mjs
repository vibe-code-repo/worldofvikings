import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const name = process.argv[2] ?? 'Surtr';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 520 } });
const logs = [];
p.on('console', m => { const t = m.text(); if (/error|fail|texture|shader/i.test(t)) logs.push(m.type()+': '+t.slice(0,180)); });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.evaluate(async (n) => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate(n);
  const ms = []; const f = (x) => { if (x.getTotalVertices?.() > 0) ms.push(x); (x.getChildren?.()||[]).forEach(f); };
  f(root);
  const kam = S.activeCamera;
  root.position.copyFrom(kam.position.add(kam.getForwardRay().direction.scale(3.5)));
  root.scaling.setAll(2.2);          // Modell ist auf 1 m normiert
  root.computeWorldMatrix(true);
  window.__t = { root, mesh: ms[0] };
}, name);
await p.waitForTimeout(9000);
const r = await p.evaluate(async () => {
  const S = window.__dbg.scene, m = window.__t.mesh, mat = m.material;
  const t = mat.albedoTexture;
  const info = {
    matReady: mat.isReady(m),
    albedo: t ? { name: (t.name||'').slice(0,40), bereit: t.isReady(), groesse: t.getSize(), hatAlpha: t.hasAlpha, koordIndex: t.coordinatesIndex } : null,
    uvSets: m.getVerticesData ? { uv: !!m.getVerticesData('uv'), uv2: !!m.getVerticesData('uv2') } : null,
    albedoColor: mat.albedoColor ? [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] : null,
    metallic: mat.metallic, roughness: mat.roughness,
    unlit: mat.unlit, alpha: mat.alpha, transparency: mat.transparencyMode,
  };
  const e = S.getEngine(), w = e.getRenderWidth(), h = e.getRenderHeight();
  const roh = await new Promise(ok => {
    const o = S.onAfterRenderObservable.add(async () => { S.onAfterRenderObservable.remove(o); ok(await e.readPixels(0,0,w,h)); });
  });
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(w,h);
  for (let y=0;y<h;y++) img.data.set(roh.subarray((h-1-y)*w*4,(h-1-y)*w*4+w*4), y*w*4);
  ctx.putImageData(img,0,0);
  return { info, png: cv.toDataURL('image/png') };
});
console.log(JSON.stringify(r.info, null, 1));
writeFileSync(`/tmp/claude-0/-root-valheim-babylon/5a35adc6-4d2f-4076-90fc-73445079abca/scratchpad/pruef_${name}.png`, Buffer.from(r.png.split(',')[1],'base64'));
if (logs.length) console.log('\nLogs:\n' + logs.slice(0,6).join('\n'));
await b.close();
