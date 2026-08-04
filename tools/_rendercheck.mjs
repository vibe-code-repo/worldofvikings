import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 500 } });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
const r = await p.evaluate(async () => {
  const d = window.__dbg, BJS = d.scene;
  const root = await d.assets.instantiate('Voelva');
  if (!root) return { fehler: 'instantiate gab null' };
  // Vor die Kamera setzen
  const kam = BJS.activeCamera;
  const vor = kam.position.add(kam.getForwardRay().direction.scale(4));
  root.position.copyFrom(vor);
  root.position.y = kam.position.y - 1.2;
  const meshes = [];
  const sammle = (n) => { if (n.getTotalVertices?.() > 0) meshes.push(n); (n.getChildren?.()||[]).forEach(sammle); };
  sammle(root);
  const m = meshes[0];
  const info = {
    klasse: m.getClassName(),
    imSzenenbaum: BJS.meshes.includes(m),
    quellMeshInSzene: m.sourceMesh ? BJS.meshes.includes(m.sourceMesh) : 'n/a',
    quellAktiv: m.sourceMesh ? m.sourceMesh.isEnabled() : 'n/a',
    sichtbar: m.isEnabled() && m.isVisible,
    material: m.material?.name?.slice(0,30),
    albedoBereit: m.material?.albedoTexture?.isReady?.(),
    metallic: m.material?.metallic,
    metallTex: !!m.material?.metallicTexture,
    useMetalBlue: m.material?.useMetallnessFromMetallicTextureBlue,
    useRoughGreen: m.material?.useRoughnessFromMetallicTextureGreen,
  };
  BJS.render();
  await new Promise(r => setTimeout(r, 400));
  const e = BJS.getEngine(), w = e.getRenderWidth(), h = e.getRenderHeight();
  const roh = await new Promise(ok => {
    const o = BJS.onAfterRenderObservable.add(async () => { BJS.onAfterRenderObservable.remove(o); ok(await e.readPixels(0,0,w,h)); });
  });
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(w,h);
  for (let y=0;y<h;y++) img.data.set(roh.subarray((h-1-y)*w*4, (h-1-y)*w*4+w*4), y*w*4);
  ctx.putImageData(img,0,0);
  return { info, png: cv.toDataURL('image/png') };
});
if (r.fehler) console.log(r.fehler);
else {
  console.log(JSON.stringify(r.info, null, 1));
  writeFileSync('/tmp/claude-0/-root-valheim-babylon/5a35adc6-4d2f-4076-90fc-73445079abca/scratchpad/voelva_ingame.png', Buffer.from(r.png.split(',')[1],'base64'));
  console.log('Bild geschrieben');
}
await b.close();
