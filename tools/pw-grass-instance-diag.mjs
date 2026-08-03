/**
 * Grass instance deep-dive: find the grass instances nearest to the player,
 * report their world positions vs. terrain height + geometry size, then put
 * the camera right next to one for a screenshot.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWGI');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected');
await page.waitForTimeout(20000);

const info = await page.evaluate(() => {
  const r = window.__renderer;
  const p = r.playerMesh.position;
  const out = { player: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), meshes: [] };
  r.scene.traverse((o) => {
    if (!(o.isInstancedMesh && o.material?.map?.source?.data?.src?.includes('grass_'))) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    // naechste Instanz zum Spieler finden
    const m = new (o.matrixWorld.constructor)();
    let best = null, bestD = 1e9;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      const dx = m.elements[12] - p.x, dz = m.elements[14] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = [m.elements[12], m.elements[13], m.elements[14]]; }
    }
    out.meshes.push({
      count: o.count,
      visible: o.visible,
      geoSize: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map((v) => +v.toFixed(3)),
      geoY: [bb.min.y, bb.max.y].map((v) => +v.toFixed(3)),
      nearest: best.map((v) => +v.toFixed(2)),
      nearestDist: +bestD.toFixed(1),
      terrainHthere: +r.getTerrainHeight(best[0], best[2]).toFixed(2),
      matAlphaTest: o.material.alphaTest,
      matColor: o.material.color.getHexString(),
      texSize: [o.material.map.image?.width, o.material.map.image?.height],
    });
  });
  // Kamera neben die naechste Instanz des ersten Meshs
  if (out.meshes.length) {
    const t = out.meshes[0].nearest;
    const origDN = r.updateDayNight.bind(r);
    r.updateDayNight = (_t, d) => origDN(0.42 * d, d);
    r.updatePlayer = () => {};
    r.camera.position.set(t[0] + 1.8, t[1] + 1.0, t[2] + 1.8);
    r.camera.lookAt(t[0], t[1] + 0.3, t[2]);
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/gw-grass-close.png', timeout: 120000 });
console.log('shot: tools/out/gw-grass-close.png');
await browser.close();
