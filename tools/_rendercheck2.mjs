import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 500 } });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
const r = await p.evaluate(async () => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate('Voelva');
  const kam = S.activeCamera;
  // Figur GENAU in Blickrichtung, ohne y zu verbiegen
  const dir = kam.getForwardRay().direction;
  root.position.copyFrom(kam.position.add(dir.scale(5)));
  root.computeWorldMatrix(true);
  const meshes = [];
  const sammle = (n) => { if (n.getTotalVertices?.() > 0) meshes.push(n); (n.getChildren?.()||[]).forEach(sammle); };
  sammle(root);
  const m = meshes[0];
  m.refreshBoundingInfo();
  m.computeWorldMatrix(true);
  S.render();
  const bb = m.getBoundingInfo().boundingBox;
  const info = {
    position: [root.position.x.toFixed(1), root.position.y.toFixed(1), root.position.z.toFixed(1)].join(','),
    kamera: [kam.position.x.toFixed(1), kam.position.y.toFixed(1), kam.position.z.toFixed(1)].join(','),
    bbMinY: bb.minimumWorld.y.toFixed(2), bbMaxY: bb.maximumWorld.y.toFixed(2),
    hoeheWelt: (bb.maximumWorld.y - bb.minimumWorld.y).toFixed(2),
    imFrustum: m.isInFrustum(S.frustumPlanes),
    aktivesMesh: S.getActiveMeshes().data.includes(m),
    alphaMode: m.material?.transparencyMode,
    alphaCutOff: m.material?.alphaCutOff,
    hatAlpha: m.material?.albedoTexture?.hasAlpha,
    backFaceCulling: m.material?.backFaceCulling,
    layerMask: m.layerMask, kamMask: kam.layerMask,
    renderingGroup: m.renderingGroupId,
  };
  await new Promise(r => setTimeout(r, 300));
  const e = S.getEngine(), w = e.getRenderWidth(), h = e.getRenderHeight();
  const roh = await new Promise(ok => {
    const o = S.onAfterRenderObservable.add(async () => { S.onAfterRenderObservable.remove(o); ok(await e.readPixels(0,0,w,h)); });
  });
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(w,h);
  for (let y=0;y<h;y++) img.data.set(roh.subarray((h-1-y)*w*4, (h-1-y)*w*4+w*4), y*w*4);
  ctx.putImageData(img,0,0);
  return { info, png: cv.toDataURL('image/png') };
});
console.log(JSON.stringify(r.info, null, 1));
writeFileSync('/tmp/claude-0/-root-valheim-babylon/5a35adc6-4d2f-4076-90fc-73445079abca/scratchpad/voelva2.png', Buffer.from(r.png.split(',')[1],'base64'));
await b.close();
