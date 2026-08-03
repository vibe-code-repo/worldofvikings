/**
 * Inspiziert Container-Inhalt + instantiateModelsToScene-Ergebnis für Beech1.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (msg) => console.log(`[${msg.type()}]`, msg.text().slice(0, 300)));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5273/?t=0.35&offline', { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);

const result = await page.evaluate(async () => {
  const { assets } = window.__dbg;
  const container = await assets['loadContainer']('Beech1');
  if (!container) return { error: 'container null' };
  const inst = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: false });
  return {
    containerMeshes: container.meshes.map((m) => `${m.name} [${m.getClassName()}] geom=${!!m.geometry} verts=${m.getTotalVertices?.()}`),
    containerTransformNodes: container.transformNodes.map((n) => `${n.name} [${n.getClassName()}]`),
    rootNodes: inst.rootNodes.map((n) => {
      const children = n.getChildMeshes ? n.getChildMeshes().map((c) => `${c.name} [${c.getClassName()}]`) : [];
      return { node: `${n.name} [${n.getClassName()}]`, children };
    }),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
