import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const fehler = [];
p.on('console', m => { if (m.type()==='error') fehler.push(m.text().slice(0,160)); });
p.on('pageerror', e => fehler.push('pageerror: '+e.message.slice(0,160)));
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 120000 });
const r = await p.evaluate(async () => {
  const out = {};
  for (const name of ['Voelva', 'Steinkreis', 'KiPine2']) {
    try {
      const root = await window.__dbg.assets.instantiate(name);
      if (!root) { out[name] = { root: null }; continue; }
      const meshes = [];
      const sammle = (n) => { if (n.getTotalVertices && n.getTotalVertices() > 0) meshes.push(n); (n.getChildren?.()||[]).forEach(sammle); };
      sammle(root);
      out[name] = {
        meshes: meshes.length,
        dreiecke: meshes.reduce((s,m)=>s+m.getTotalIndices()/3,0),
        details: meshes.slice(0,2).map(m => ({
          klasse: m.getClassName(),
          material: m.material?.name ?? null,
          matKlasse: m.material?.getClassName?.() ?? null,
          albedo: m.material?.albedoTexture?.name ?? null,
          albedoBereit: m.material?.albedoTexture?.isReady?.() ?? null,
          metallic: m.material?.metallic ?? null,
        })),
      };
    } catch (e) { out[name] = { fehler: String(e).slice(0,150) }; }
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
if (fehler.length) console.log('\nKonsolenfehler:\n' + fehler.slice(0,6).join('\n'));
await b.close();
