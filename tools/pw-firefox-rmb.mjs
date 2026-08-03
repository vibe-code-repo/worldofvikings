/**
 * Maustasten-Verhalten in Chromium UND Firefox, mit und ohne Pointer-Lock.
 *
 * Hintergrund (siehe engine/InputManager.ts):
 *  - Ein Rechtsklick OHNE Lock meldet je nach Browser nur `contextmenu`
 *    (Chromium) oder zusätzlich `mousedown` (Firefox). Beide Wege müssen die
 *    Taste genau EINMAL registrieren.
 *  - Ein Linksklick OHNE Lock muss das Werkzeug auslösen — auch dann, wenn der
 *    Lock nicht verweigert, sondern vom Spieler mit Esc freigegeben wurde.
 *    Entschieden wird das kurz nach dem Klick: kam bis dahin kein Lock, war es
 *    ein normaler Klick.
 *  - Gecko verlangt `requestPointerLock()` synchron im mousedown-Handler und
 *    verweigert ~1300 ms nach einem erzwungenen Unlock (Mozilla 1284785).
 *
 * Die App selbst lässt sich in Firefox headless nicht laden (kein WebGL, kein
 * SwiftShader-Fallback wie in Chromium), die Event-Ebene schon.
 *
 * Aufruf: node tools/pw-firefox-rmb.mjs [chromium|firefox|beide]
 */
import { chromium, firefox } from 'playwright';

const SEITE = `
<!doctype html><meta charset="utf-8"><title>maus</title>
<style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh;background:#333}</style>
<canvas id="c"></canvas>
<script>
window.__lock = __LOCK__;               // simuliert den Pointer-Lock-Zustand
const canvas = document.getElementById('c');
const roh = [];
const locked = () => window.__lock === true;
const GRACE = 80, SLOP = 5;

let rechts = 0, links = 0;              // wie oft die Logik die Taste übernahm
let lastRightDown = -Infinity, dragging = false, dragMoved = 0;

document.addEventListener('mousedown', (e) => {
  roh.push(['mousedown', e.button]);
  if (!locked()) {
    if (e.button === 0 && e.target === canvas) { dragging = true; dragMoved = 0; }
    return;
  }
  if (e.button === 2) lastRightDown = performance.now();
  if (e.button === 2) rechts++; else if (e.button === 0) links++;
});
document.addEventListener('mousemove', (e) => {
  if (!locked() && dragging) dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
});
document.addEventListener('mouseup', (e) => {
  roh.push(['mouseup', e.button]);
  if (dragging && e.button === 0) {
    dragging = false;
    if (dragMoved <= SLOP) setTimeout(() => { if (!locked()) links++; }, GRACE);
  }
});
document.addEventListener('contextmenu', (e) => {
  roh.push(['contextmenu', e.button]);
  e.preventDefault();
  if (e.target !== canvas) return;
  if (performance.now() - lastRightDown < 200) return;
  rechts++;
});
window.__ergebnis = () => ({ roh, lock: locked(), rechts, links });
</script>`;

async function fall(browser, { lock, taste, ziehen }) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(SEITE.replace('__LOCK__', String(lock)));
  if (ziehen) {
    await page.mouse.move(400, 300);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(400 + i * 20, 300 + i * 10);
    await page.mouse.up();
  } else {
    await page.mouse.click(400, 300, { button: taste });
  }
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => window.__ergebnis());
  await page.close();
  if (r.lock !== lock) throw new Error(`Lock-Zustand kam nicht an (${r.lock} statt ${lock})`);
  return r;
}

async function pruefe(name, typ) {
  const browser = await typ.launch();
  const zeile = (was, ist, soll) => {
    const ok = ist === soll;
    console.log(`  ${was.padEnd(34)} ${ist}× (erwartet ${soll})  ${ok ? '✓' : '✗'}`);
    return ok;
  };
  console.log(`\n${name}`);
  const ok = [];
  const a = await fall(browser, { lock: false, taste: 'right' });
  ok.push(zeile('Rechtsklick ohne Lock', a.rechts, 1));
  const b = await fall(browser, { lock: true, taste: 'right' });
  ok.push(zeile('Rechtsklick mit Lock', b.rechts, 1));
  const c = await fall(browser, { lock: false, taste: 'left' });
  ok.push(zeile('Linksklick ohne Lock (nach Esc)', c.links, 1));
  const d = await fall(browser, { lock: true, taste: 'left' });
  ok.push(zeile('Linksklick mit Lock', d.links, 1));
  const e = await fall(browser, { lock: false, ziehen: true });
  ok.push(zeile('Ziehen ohne Lock = kein Klick', e.links, 0));
  await browser.close();
  return ok.every(Boolean);
}

const welche = process.argv[2] ?? 'beide';
const ergebnisse = [];
if (welche === 'chromium' || welche === 'beide') ergebnisse.push(await pruefe('Chromium', chromium));
if (welche === 'firefox' || welche === 'beide') ergebnisse.push(await pruefe('Firefox', firefox));

const ok = ergebnisse.every(Boolean);
console.log(ok ? '\nERGEBNIS: alle Fälle in allen geprüften Browsern korrekt ✓' : '\nERGEBNIS: Fehler ✗');
process.exit(ok ? 0 : 1);
