import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const modell = process.argv[2] ?? 'Voelva';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 520 } });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
await p.waitForTimeout(3000);
const setup = await p.evaluate(async (name) => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate(name);
  if (!root) return { fehler: 'instantiate null' };
  window.__test = { root };
  const ms = []; const f = (n) => { if (n.getTotalVertices?.() > 0) ms.push(n); (n.getChildren?.()||[]).forEach(f); };
  f(root); window.__test.mesh = ms[0];
  // Eigene Kamera, damit der Blick garantiert auf dem Modell liegt
  const bb = ms[0].getBoundingInfo().boundingBox;
  const h = bb.maximumWorld.y - bb.minimumWorld.y;
  const mitte = bb.centerWorld.clone();
  const cam = new (S.activeCamera.constructor)('pruef', mitte.add(new BABYLON.Vector3(0, 0, -h * 2.6)), S);
  cam.setTarget(mitte); cam.minZ = 0.05;
  window.__test.altCam = S.activeCamera; S.activeCamera = cam;
  return { hoehe: h.toFixed(2), meshName: ms[0].name };
}, modell).catch(e => ({ fehler: String(e).slice(0,120) }));
console.log('Setup:', JSON.stringify(setup));
if (!setup.fehler) {
  await p.waitForTimeout(6000);   // Shader kompilieren lassen
  const r = await p.evaluate(async () => {
    const S = window.__dbg.scene, m = window.__test.mesh;
    const info = { matReady: m.material.isReady(m), meshReady: m.isReady(true) };
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
  console.log(JSON.stringify(r.info));
  writeFileSync(`/tmp/claude-0/-root-valheim-babylon/5a35adc6-4d2f-4076-90fc-73445079abca/scratchpad/pruef_${modell}.png`, Buffer.from(r.png.split(',')[1],'base64'));
}
await b.close();
