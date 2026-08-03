/**
 * Liefern die Browser `movementX/Y` auch OHNE Pointer-Lock?
 *
 * Davon hängt die Ersatzsteuerung ab: Wenn der Browser den Lock verweigert
 * (z. B. direkt nach einem Escape-Unlock), dreht der InputManager die Kamera
 * über gedrückt-ziehen — und dafür braucht er dieselben Deltas.
 *
 * Aufruf: node tools/pw-firefox-drag.mjs
 */
import { chromium, firefox } from 'playwright';

const SEITE = `
<!doctype html><meta charset="utf-8"><title>drag</title>
<style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh;background:#333}</style>
<canvas id="c"></canvas>
<script>
let dx = 0, dy = 0, moves = 0;
document.addEventListener('mousemove', (e) => {
  moves++;
  dx += e.movementX; dy += e.movementY;
});
window.__ergebnis = () => ({ dx, dy, moves });
</script>`;

async function pruefe(name, typ) {
  const browser = await typ.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(SEITE);
  await page.mouse.move(200, 200);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(200 + i * 20, 200 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => window.__ergebnis());
  await browser.close();
  const ok = Math.abs(r.dx) > 50 && Math.abs(r.dy) > 20;
  console.log(`${name.padEnd(9)} moves=${r.moves} dx=${r.dx} dy=${r.dy}  ${ok ? '✓ Deltas ohne Lock vorhanden' : '✗ keine brauchbaren Deltas'}`);
  return ok;
}

const ergebnisse = [await pruefe('Chromium', chromium), await pruefe('Firefox', firefox)];
const ok = ergebnisse.every(Boolean);
console.log(ok ? '\nERGEBNIS: Ziehen funktioniert in beiden Browsern ✓' : '\nERGEBNIS: Fehler ✗');
process.exit(ok ? 0 : 1);
