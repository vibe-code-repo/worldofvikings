/**
 * Decisive grass render test at one instance:
 *  A) frustumCulled = false           -> culling bug?
 *  B) plain red MeshBasicMaterial     -> material/shader bug?
 * Captures ALL console errors (shader compile errors land there).
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 500));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#connect-btn', { timeout: 15000 });
await page.fill('#player-name', 'PWGT');
await page.click('#connect-btn');
await page.waitForFunction(() => document.getElementById('hud')?.style.display !== 'none', { timeout: 60000 });
console.log('connected');
await page.waitForTimeout(45000);

async function aim() {
  return page.evaluate(() => {
    const r = window.__renderer;
    const p = r.playerMesh.position;
    let target = null, bestD = 1e9, mesh = null;
    r.scene.traverse((o) => {
      if (!(o.isInstancedMesh && o.material?.map?.source?.data?.src?.includes('grass_'))) return;
      const m = new (o.matrixWorld.constructor)();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const d = Math.hypot(m.elements[12] - p.x, m.elements[14] - p.z);
        if (d < bestD) { bestD = d; target = [m.elements[12], m.elements[13], m.elements[14]]; mesh = o; }
      }
    });
    if (!target) return null;
    const origDN = r.updateDayNight.bind(r);
    r.updateDayNight = (_t, d) => origDN(0.42 * d, d);
    r.updatePlayer = () => {};
    r.camera.position.set(target[0] + 2.5, target[1] + 1.2, target[2] + 2.5);
    r.camera.lookAt(target[0], target[1] + 0.3, target[2]);
    return { target, bestD: +bestD.toFixed(1), uuid: mesh.uuid };
  });
}

let t = await aim();
console.log('aim:', JSON.stringify(t));

// A) frustumCulled aus
const a = await page.evaluate((uuid) => {
  const r = window.__renderer;
  let n = 0;
  r.scene.traverse((o) => {
    if (o.isInstancedMesh && o.material?.map?.source?.data?.src?.includes('grass_')) {
      o.frustumCulled = false;
      n++;
      // Bounding-Sphere-Info des Ziels
      if (o.uuid === uuid) {
        o.geometry.computeBoundingSphere();
        window.__bs = {
          center: o.geometry.boundingSphere.center.toArray().map((v) => +v.toFixed(1)),
          radius: +o.geometry.boundingSphere.radius.toFixed(2),
          ownBS: o.boundingSphere ? { center: o.boundingSphere.center.toArray().map((v) => +v.toFixed(1)), radius: +o.boundingSphere.radius.toFixed(1) } : null,
        };
      }
    }
  });
  return { n, bs: window.__bs };
}, t.uuid);
console.log('A) frustumCulled=false on', a.n, 'meshes; boundingSphere:', JSON.stringify(a.bs));
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/gt-nocull.png', timeout: 240000 });
console.log('shot: tools/out/gt-nocull.png');

// B) rotes Basic-Material auf das Ziel-Mesh
await page.evaluate((uuid) => {
  const r = window.__renderer;
  r.scene.traverse((o) => {
    if (o.uuid === uuid) {
      const C = o.material.constructor; // MeshStandardMaterial-Klasse? nein — Basic explizit
      o.material = new (Object.getPrototypeOf(o.material).constructor.prototype.isMeshStandardMaterial
        ? o.material.constructor // Fallback, wird unten ersetzt
        : o.material.constructor)({});
    }
  });
  // sauberer: ueber renderer-scene bekannte three-Instanz — nimm einfach color roh
  r.scene.traverse((o) => {
    if (o.uuid === uuid) {
      // MeshBasicMaterial ueber den Konstruktor einer beliebigen Mesh-Klasse holen geht nicht;
      // stattdessen: bestehendes Material patchen — alphaTest raus, map raus, knallrot.
      const mat = o.material;
      mat.alphaTest = 0;
      mat.map = null;
      mat.color?.setRGB(1, 0, 0);
      mat.onBeforeCompile = () => {};
      mat.needsUpdate = true;
    }
  });
}, t.uuid);
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tools/out/gt-red.png', timeout: 240000 });
console.log('shot: tools/out/gt-red.png');
await browser.close();
