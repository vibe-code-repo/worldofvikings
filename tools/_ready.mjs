import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 480 } });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate('Voelva');
  const ms = []; const f = (n) => { if (n.getTotalVertices?.() > 0) ms.push(n); (n.getChildren?.()||[]).forEach(f); };
  f(root);
  const m = ms[0], mat = m.material;
  return {
    matReady: mat.isReady(m),
    meshReady: m.isReady(true),
    maxTex: S.getEngine().getCaps().maxTextureSize,
    albedoGroesse: mat.albedoTexture?.getSize(),
    metallGroesse: mat.metallicTexture?.getSize(),
    bumpGroesse: mat.bumpTexture?.getSize(),
  };
});
console.log(JSON.stringify(r));
await b.close();
