/**
 * Etappe-3-Verifikation: Hotbar, Ausrüsten (Modell in der Hand) und das
 * Inventar-Overlay inklusive Drag & Drop.
 *
 * Aufruf: node tools/pw-inventory-check.mjs [url] [outdir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const url = process.argv[2] ?? 'http://localhost:5274/?offline=1&t=0.35';
const outDir = process.argv[3] ?? '/tmp/claude-0/-root-valheim-babylon/c908a284-e68f-40e4-9cf1-4e2877d70dbe/scratchpad';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// 404s auf Icons/Modelle würden sonst still bleiben.
page.on('response', (r) => {
  if (r.status() >= 400 && /\/assets\//.test(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__dbg?.world != null, { timeout: 120000 });
await page.waitForTimeout(8000);

const hotbarSlots = await page.evaluate(() =>
  document.querySelectorAll('img[src^="/assets/sprites/"]').length
);
console.log('Hotbar-Icons im DOM:', hotbarSlots);

// Hotbar-Slot 1 ausrüsten (Hoe). Der Rig muss danach ein Kind an handR haben.
// Das GLB wird dabei erst geladen und fixupMaterial liest Texturpixel zurück —
// unter SwiftShader dauert das mehrere Sekunden, deshalb auf die Bedingung
// warten statt auf eine feste Zeit.
await page.keyboard.press('Digit1');
await page
  .waitForFunction(() => window.__dbg.player.avatar.handR.getChildren().length > 0, { timeout: 60000 })
  .catch(() => console.log('WARN: Werkzeug erschien nicht in der Hand'));
const equipped = await page.evaluate(() => {
  const rig = window.__dbg.player.avatar;
  return {
    handChildren: rig.handR.getChildren().length,
    heldName: rig.handR.getChildren()[0]?.name ?? null,
  };
});
console.log('nach Digit1:', JSON.stringify(equipped));

await page.screenshot({ path: `${outDir}/inv-equipped.png`, timeout: 120000 });

// Inventar öffnen
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
const gridCells = await page.evaluate(() => document.querySelectorAll('[data-x][data-y]').length);
console.log('Inventar-Zellen:', gridCells, '(erwartet 32)');
await page.screenshot({ path: `${outDir}/inv-open.png`, timeout: 120000 });

// Drag & Drop: erstes belegtes Feld auf ein leeres Feld ziehen.
// Wichtig: moveTo() löst ein Neu-Rendern aus, das ALLE Zellen ersetzt — der
// Zielzustand muss deshalb über einen frischen Query geprüft werden, nicht
// über die alte DOM-Referenz.
const moved = await page.evaluate(async () => {
  const cells = [...document.querySelectorAll('[data-x][data-y]')];
  const from = cells.find((c) => c.querySelector('img'));
  const to = cells.find((c) => !c.querySelector('img'));
  if (!from || !to) return { ok: false, reason: 'kein Quell-/Zielfeld' };
  const src = { x: from.dataset.x, y: from.dataset.y };
  const dst = { x: to.dataset.x, y: to.dataset.y };
  const fb = from.getBoundingClientRect();
  const tb = to.getBoundingClientRect();
  const opts = (r) => ({ clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true });
  from.dispatchEvent(new PointerEvent('pointerdown', opts(fb)));
  document.dispatchEvent(new PointerEvent('pointermove', opts(tb)));
  document.dispatchEvent(new PointerEvent('pointerup', opts(tb)));
  await new Promise((r) => setTimeout(r, 300));

  const q = (p) => document.querySelector(`[data-x="${p.x}"][data-y="${p.y}"]`);
  return {
    ok: true,
    von: `${src.x},${src.y}`,
    nach: `${dst.x},${dst.y}`,
    zielBelegt: !!q(dst)?.querySelector('img'),
    quelleLeer: !q(src)?.querySelector('img'),
  };
});
console.log('Drag & Drop:', JSON.stringify(moved));
await page.screenshot({ path: `${outDir}/inv-dragged.png`, timeout: 120000 });

// Inventar zu, Ladeblende abwarten — erst dann ist der Avatar mit dem
// Werkzeug in der Hand überhaupt zu sehen.
await page.keyboard.press('Tab');
await page.waitForTimeout(1000);
await page
  .waitForFunction(() => window.__dbg?.terrain?.ready === true, { timeout: 180000 })
  .catch(() => console.log('WARN: terrain.ready nicht erreicht'));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/inv-ingame.png`, timeout: 120000 });

console.log('');
if (errors.length) {
  console.log('--- Fehler ---');
  for (const e of errors.slice(0, 15)) console.log(e);
} else {
  console.log('keine Fehler, keine Asset-404er');
}
await browser.close();
