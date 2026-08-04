import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 500 } });
const logs = [];
p.on('console', m => { const t=m.text(); if(/shader|error|fail|warn/i.test(t)) logs.push(m.type()+': '+t.slice(0,200)); });
p.on('pageerror', e => logs.push('pageerror: '+e.message.slice(0,200)));
// Vite-HMR kann die Seite nach einer Dateiänderung neu laden — dann stirbt
// der Ausführungskontext mitten im Warten. Deshalb mit Wiederholung.
let bereit = false;
for (let versuch = 0; versuch < 5 && !bereit; versuch++) {
  try {
    await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    await p.waitForFunction(() => window.__dbg?.assets != null, { timeout: 90000 });
    bereit = true;
  } catch (e) { console.log('Versuch', versuch + 1, 'fehlgeschlagen:', String(e).slice(0, 80)); }
}
if (!bereit) { console.log('Client nicht erreichbar'); await b.close(); process.exit(1); }
const r = await p.evaluate(async () => {
  const d = window.__dbg, S = d.scene;
  const root = await d.assets.instantiate('Voelva');
  const meshes = []; const sammle = (n) => { if (n.getTotalVertices?.() > 0) meshes.push(n); (n.getChildren?.()||[]).forEach(sammle); };
  sammle(root);
  const m = meshes[0], mat = m.material;
  const vorher = { isReady: mat.isReady(m), meshReady: m.isReady(true) };
  // Mehrere Frames rendern — Shader kompilieren asynchron
  for (let i = 0; i < 30; i++) { S.render(); await new Promise(r => setTimeout(r, 60)); }
  const eff = mat.getEffect?.();
  return {
    vorher,
    nachher: { isReady: mat.isReady(m), meshReady: m.isReady(true) },
    effekt: eff ? { name: eff.name?.fragment ?? '?', bereit: eff.isReady(), fehler: eff.getCompilationError?.()?.slice(0,300) ?? null } : 'kein Effekt',
    texturen: {
      albedo: mat.albedoTexture ? { bereit: mat.albedoTexture.isReady(), groesse: mat.albedoTexture.getSize() } : null,
      metallic: mat.metallicTexture ? { bereit: mat.metallicTexture.isReady(), groesse: mat.metallicTexture.getSize() } : null,
      bump: mat.bumpTexture ? { bereit: mat.bumpTexture.isReady(), groesse: mat.bumpTexture.getSize() } : null,
    },
    maxTextur: S.getEngine().getCaps().maxTextureSize,
  };
});
console.log(JSON.stringify(r, null, 1));
if (logs.length) console.log('\n--- Logs ---\n' + logs.slice(0,10).join('\n'));
await b.close();
