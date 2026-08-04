import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 520 } });
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.evaluate(async () => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate('Voelva');
  const ms = []; const f = (n) => { if (n.getTotalVertices?.() > 0) ms.push(n); (n.getChildren?.()||[]).forEach(f); };
  f(root);
  const kam = S.activeCamera;
  root.position.copyFrom(kam.position.add(kam.getForwardRay().direction.scale(4)));
  root.computeWorldMatrix(true);
  window.__t = { root, mesh: ms[0] };
});
await p.waitForTimeout(8000);   // Shader kompilieren + viele Frames
const r = await p.evaluate(() => {
  const S = window.__dbg.scene, m = window.__t.mesh, mat = m.material;
  const aktiv = S.getActiveMeshes();
  return {
    matReady: mat.isReady(m),
    meshReady: m.isReady(true),
    visibility: m.visibility,
    matAlpha: mat.alpha,
    isVisible: m.isVisible,
    enabled: m.isEnabled(),
    inAktivenMeshes: aktiv.data.slice(0, aktiv.length).includes(m),
    imFrustum: m.isInFrustum(S.frustumPlanes),
    subMeshes: m.subMeshes?.length,
    effektBereit: mat.getEffect?.()?.isReady?.() ?? null,
    effektFehler: mat.getEffect?.()?.getCompilationError?.()?.slice(0, 200) ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
