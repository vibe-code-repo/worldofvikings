#!/usr/bin/env node
/**
 * Regressionsprobe: Klicks in der 3D-Ansicht des 1.0-Dungeon-Editors wählen
 * wirklich etwas aus.
 * Regression check: clicks in the editor's 3D view actually select something.
 *
 * WARUM IM BROWSER: Der Bug, den diese Probe bewacht, war ein fehlender
 * Nebenwirkungs-Import (`@babylonjs/core/Culling/ray`). Ohne ihn steht in
 * `Scene.prototype.pick` Babylons Baumschnitt-Attrappe: Sie wirft NICHT,
 * sondern gibt ein leeres `PickingInfo` zurück. Kein NullEngine-Test und kein
 * `tsc` kann das sehen — nur ein echter Klick in einem echten Bündel.
 *
 *   node tools/pw-editor-3d-pick.mjs [docId=gen-probe]
 *
 * Basic-Auth über httpCredentials. Bild: ~/.cache/wov-stonevault-sicht/editor3d-pick-fix.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const CREDS = {
  username: process.env.WOV_DEV_USER ?? 'Admin',
  password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
};
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const [docId = 'gen-probe'] = process.argv.slice(2);
mkdirSync(ORDNER, { recursive: true });

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const seite = await ctx.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push('pageerror: ' + String(f).slice(0, 300)));
seite.on('console', (m) => {
  // Auch Warnungen: Babylons Baumschnitt-Attrappe meldet sich NUR als Warnung.
  if (m.type() === 'error' || m.type() === 'warning') fehler.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
const knopf = (t) =>
  seite.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!b) return false;
    b.click();
    return true;
  }, t);
const status = () =>
  seite.evaluate(() => document.body.innerText.split('\n').find((z) => /Gewählt:|Kein Raum gewählt/.test(z)) ?? '—');

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await seite.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,div')].find(
    (b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3
  );
  b?.click();
});
await seite.waitForTimeout(3000);

const gefunden = await seite.evaluate((id) => {
  const s = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === id));
  if (!s) return false;
  s.value = id;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, docId);
if (!gefunden) throw new Error(`Dokument ${docId} steht nicht in der Liste`);
await knopf('Öffnen');
await seite.waitForTimeout(5000);
console.log('1. geöffnet: ' + (await seite.evaluate(() => document.body.innerText.split('\n').find((z) => /Räume, \d+ Türen/.test(z)) ?? '—')));

if (!(await knopf('3D-Ansicht'))) throw new Error('Knopf „3D-Ansicht" fehlt');
await seite.waitForTimeout(15_000);
console.log('2. 3D-Ansicht an, Status vorher: ' + (await status()));

// Raster über die Canvas, bis ein Klick etwas wählt — die Kamera rahmt frei
// ein, ein einzelner fester Punkt wäre eine Wette auf den Bildausschnitt.
const box = await seite.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')]
    .filter((c) => getComputedStyle(c).display !== 'none')
    .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0))[0];
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
let getroffen = '';
const punkte = [];
for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) {
  for (const fx of [0.5, 0.42, 0.58, 0.35, 0.65]) {
    punkte.push([fx, fy]);
  }
}
for (const [fx, fy] of punkte) {
  await seite.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
  await seite.waitForTimeout(350);
  const s = await status();
  if (/Gewählt: #\d+/.test(s)) {
    getroffen = `${s} (bei ${fx.toFixed(2)}/${fy.toFixed(2)})`;
    break;
  }
}
console.log('3. nach Klick: ' + (getroffen || 'NICHTS GEWÄHLT'));
await seite.screenshot({ path: `${ORDNER}/editor3d-pick-fix.png` });
console.log(`   Bild ${ORDNER}/editor3d-pick-fix.png`);

const rayWarnung = fehler.filter((f) => /Ray needs to be imported/.test(f));
if (rayWarnung.length) console.log('   ACHTUNG Baumschnitt-Attrappe aktiv: ' + rayWarnung[0]);
if (fehler.length) console.log('   Meldungen: ' + fehler.slice(0, 5).join(' || '));

await browser.close();
if (!getroffen || rayWarnung.length) {
  console.log('ERGEBNIS: FEHLGESCHLAGEN');
  process.exit(1);
}
console.log('ERGEBNIS: OK');
