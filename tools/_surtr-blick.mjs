// Misst im laufenden Client den Winkel zwischen Surtrs Blickrichtung und
// der Bewegungsrichtung, die die Engine aus einer Route ableitet.
//
// Anker ist das SCHWERT: In Blender liegt seine Spitze (nach der
// Blickdrehung) 0,52 rechts und 0,35 VOR der Koerperachse. Findet man sie
// im Spiel an derselben Stelle relativ zur Bewegungsrichtung, stimmt die
// Blickrichtung; jede Abweichung ist genau der gesuchte Winkel.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 420, height: 300 } });
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await p.goto('http://localhost:5274/?offline=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__dbg?.assets != null, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);

const r = await p.evaluate(async () => {
  const d = window.__dbg;
  const root = await d.assets.instantiate('Surtr', 'walk');
  if (!root) return { fehler: 'kein Modell' };
  const rohSkalierung = [root.scaling.x, root.scaling.y, root.scaling.z];
  // Genau wie der EntityManager: localScale 9 auf die Wurzel
  root.scaling.set(9, 9, 9);
  const meshes = [];
  const f = (x) => { if (x.getTotalVertices?.() > 0) meshes.push(x); (x.getChildren?.() || []).forEach(f); };
  f(root);

  const V = root.position.constructor;
  const proben = [];
  // yaw wie in shared/worldlayout/routenlauf.ts: yaw = atan2(dx, dz)
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [0.6, 0.8], [-0.8, 0.6], [0.3, -0.95]]) {
    const yaw = Math.atan2(dx, dz);
    if (!root.rotationQuaternion) root.rotationQuaternion = V.Zero().toQuaternion ? V.Zero().toQuaternion() : null;
    const Q = root.rotationQuaternion.constructor;
    root.rotationQuaternion = new Q(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    root.computeWorldMatrix(true);
    // Schwertspitze: der Punkt mit dem groessten waagerechten Abstand zur
    // Koerperachse im Hoehenband 0,15..0,55 der Figur.
    let hoch = -Infinity, tief = Infinity;
    const punkte = [];
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const pos = m.getVerticesData('position');
      const wm = m.getWorldMatrix();
      for (let i = 0; i < pos.length; i += 3) {
        const v = V.TransformCoordinates(new V(pos[i], pos[i + 1], pos[i + 2]), wm);
        punkte.push(v);
        if (v.y > hoch) hoch = v.y;
        if (v.y < tief) tief = v.y;
      }
    }
    const h = hoch - tief;
    let best = null, bestR = -1;
    for (const v of punkte) {
      const t = (v.y - tief) / h;
      if (t < 0.15 || t > 0.55) continue;
      const rr = Math.hypot(v.x - root.position.x, v.z - root.position.z);
      if (rr > bestR) { bestR = rr; best = v; }
    }
    // In den Modellraum zurueckdrehen: um -yaw um die Hochachse
    // Um -yaw zurueckdrehen: Drehung um Y mit Winkel a bildet
    // (x,z) auf (x cos a + z sin a, -x sin a + z cos a) ab.
    const ox = best.x - root.position.x, oz = best.z - root.position.z;
    const seite = ox * Math.cos(yaw) - oz * Math.sin(yaw);   // Modell-X
    const vorn = ox * Math.sin(yaw) + oz * Math.cos(yaw);    // Modell-Z
    proben.push({
      dir: [dx, dz], yawGrad: +(yaw * 180 / Math.PI).toFixed(1),
      spitzeWelt: [+best.x.toFixed(2), +best.y.toFixed(2), +best.z.toFixed(2)],
      vorn: +vorn.toFixed(3), seite: +seite.toFixed(3),
      // Blender-Referenz: Die Spitze liegt im Modellraum bei (-0,519 / +0,348),
      // also -56,2 Grad von der Modellvorderachse. Weicht der gemessene
      // Winkel davon ab, ist genau das der Blickfehler.
      winkelZurBewegung: +(Math.atan2(seite, vorn) * 180 / Math.PI).toFixed(1),
      blickfehler: +((Math.atan2(seite, vorn) * 180 / Math.PI) + 56.2).toFixed(1),
      hoehe: +h.toFixed(2), tiefsterPunkt: +(tief - root.position.y).toFixed(3),
    });
  }
  return { rohSkalierung, proben };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
