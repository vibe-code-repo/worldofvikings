/**
 * Echter Firefox-Test der laufenden App — nicht simuliert.
 *
 * Firefox HEADLESS hat kein WebGL (anders als Chromium, das auf SwiftShader
 * zurückfällt), die Welt startet dort also nie. Mit einem X-Server (Xvfb) und
 * `headless: false` rendert Firefox über Mesa/llvmpipe und die App läuft.
 *
 * Aufruf:  xvfb-run -a node tools/pw-firefox-app.mjs [url]
 */
import { firefox } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5273/?offline=1';

const browser = await firefox.launch({
  headless: false,
  firefoxUserPrefs: {
    // Software-WebGL erlauben — ohne GPU lehnt Firefox sonst ab.
    'webgl.force-enabled': true,
    'webgl.disabled': false,
    'layers.acceleration.force-enabled': false,
    'gfx.webrender.software': true,
  },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('pageerror', (e) => console.log('[seitenfehler]', String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[konsole]', m.text().slice(0, 160));
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });

let bereit = false;
for (let i = 0; i < 60; i++) {
  bereit = await page.evaluate(() => window.__dbg?.placement != null && window.__dbg?.terrain?.ready === true);
  if (bereit) break;
  if (i % 10 === 0) {
    const s = await page.evaluate(() => ({
      dbg: !!window.__dbg,
      webgl2: (() => {
        try {
          return !!document.createElement('canvas').getContext('webgl2');
        } catch {
          return false;
        }
      })(),
    }));
    console.log(`warte… ${JSON.stringify(s)}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!bereit) {
  console.log('✗ Welt startet nicht — Test abgebrochen');
  await browser.close();
  process.exit(2);
}
console.log('✓ Welt läuft in Firefox');

const zustand = () =>
  page.evaluate(() => ({
    locked: !!document.pointerLockElement,
    debug: window.__dbg.input.debugLine,
    werkzeug: window.__dbg.equipment?.rightItem?.shared?.name ?? null,
    menuOpen: window.__dbg.placement.menuOpen,
    modus: window.__dbg.placement.selectedPiece?.name ?? null,
    ziel: window.__dbg.placement.lastHitDebug != null,
  }));

// 1) Klick ins Bild — holt normalerweise den Pointer-Lock
await page.mouse.click(640, 400);
await page.waitForTimeout(600);
console.log('nach Klick ins Bild:', JSON.stringify(await zustand()));

// 2) Werkzeug ausrüsten
await page.keyboard.press('1');
await page.waitForTimeout(300);
console.log('nach Taste 1      :', JSON.stringify(await zustand()));

// 3) Nach unten schauen, damit ein Ziel in Reichweite liegt
for (let i = 0; i < 8; i++) await page.mouse.move(640, 400 + i * 40);
await page.waitForTimeout(500);
console.log('nach Blick nach unten:', JSON.stringify(await zustand()));

// 4) Terrain-Höhe vor/nach einem echten Linksklick
const vor = await page.evaluate(() => {
  const d = window.__dbg;
  const h = d.placement.lastHitDebug;
  if (!h) return null;
  window.__probe = { x: h.x, z: h.z };
  return d.world.heightmaps.getGroundHeightRaycast(h.x, h.z);
});
if (vor == null) {
  console.log('✗ kein Zielpunkt — Kamera zeigt nicht auf den Boden');
} else {
  await page.mouse.click(640, 700);
  await page.waitForTimeout(700);
  const nach = await page.evaluate(() => {
    const p = window.__probe;
    return window.__dbg.world.heightmaps.getGroundHeightRaycast(p.x, p.z);
  });
  console.log(`Terrain vor ${vor.toFixed(3)} → nach ${nach.toFixed(3)}  ${Math.abs(nach - vor) > 1e-4 ? '✓ Werkzeug wirkt' : '✗ nichts passiert'}`);
}
console.log('Endzustand        :', JSON.stringify(await zustand()));

await browser.close();
