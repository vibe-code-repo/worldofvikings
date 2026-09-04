#!/usr/bin/env node
/**
 * Browserprobe der drei Komfortstufen der 3D-Ansicht (1.0-Dungeon-Editor):
 * Decke ausblenden, Ebenenfilter, Fokus.
 * Browser check for the three comfort features of the editor's 3D view.
 *
 * WARUM IM BROWSER: Alle drei wirken nur im BILD. Der NullEngine-Test
 * (`client/test/dungeon-vorschau3d.ts`) misst Zustände — `isEnabled()`,
 * `clipPlane.d`, Ziel und Radius der Kamera —, und genau das ist seine
 * Grenze: Ob die Schnittebene tatsächlich die Decke nimmt und nicht den
 * halben Raum, sieht man erst an einem echten Bündel mit echten GLBs.
 * Dieselbe Lehre wie bei `pw-editor-3d-pick.mjs`, dessen Muster diese Probe
 * folgt (dort: Babylons Baumschnitt-Attrappe meldet sich NUR als Warnung).
 *
 *   node tools/pw-editor-3d-komfort.mjs [docId=gen-probe]
 *
 * Basic-Auth über httpCredentials. Bilder in
 * ~/.cache/wov-stonevault-sicht/: editor3d-komfort-decke-aus.png,
 * -decke-an.png, -ebene-3_5.png, -fokus-vorher.png, -fokus.png,
 * -doppelklick.png.
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
const bild = async (name) => {
  await seite.screenshot({ path: `${ORDNER}/editor3d-komfort-${name}.png` });
  return `${ORDNER}/editor3d-komfort-${name}.png`;
};

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
// Grosszügig: Die GLBs des Kits kommen erst beim ersten Bau über die Leitung.
await seite.waitForTimeout(20_000);
console.log('2. 3D-Ansicht an — Bild ' + (await bild('decke-aus')));

// ── Stufe 1: Decke ───────────────────────────────────────────────────────
// Die Vorgabe ist AUS; das Häkchen schaltet sie EIN. Beide Bilder werden
// gemacht, weil erst der Vergleich zeigt, dass der Schnitt die Decke nimmt
// und nicht den halben Raum.
const deckeSchalten = (an) =>
  seite.evaluate((an) => {
    const l = [...document.querySelectorAll('label')].find((l) => /Decke zeigen/.test(l.textContent));
    const k = l?.querySelector('input[type=checkbox]');
    if (!k) return 'FEHLT';
    if (k.checked !== an) k.click();
    return k.checked ? 'an' : 'aus';
  }, an);
const deckeAn = await deckeSchalten(true);
if (deckeAn === 'FEHLT') throw new Error('Schalter „Decke zeigen" fehlt in der Sektion Ansicht');
await seite.waitForTimeout(1500);
console.log(`3. Decke ${deckeAn} — Bild ` + (await bild('decke-an')));
await deckeSchalten(false);
await seite.waitForTimeout(1500);

// ── Stufe 2: Ebenenfilter ────────────────────────────────────────────────
// Dasselbe Auswahlfeld wie im Grundriss (`DungeonKatalog.ts`) — es steht in
// der Seitenleiste und gilt nun für beide Ansichten.
const ebenen = await seite.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^Ebene y = /.test(o.textContent))
  );
  return s ? [...s.options].map((o) => o.value) : null;
});
if (!ebenen) throw new Error('Ebenen-Auswahlfeld fehlt (hat das Dokument mehr als eine Ebene?)');
console.log('4. Ebenen im Feld: ' + JSON.stringify(ebenen));
const gestellt = await seite.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^Ebene y = /.test(o.textContent))
  );
  const o = [...s.options].find((o) => o.value === '3.5');
  if (!o) return null;
  s.value = o.value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return o.textContent;
});
if (!gestellt) throw new Error('Ebene 3,5 steht nicht zur Wahl');
await seite.waitForTimeout(2500);
console.log(`5. „${gestellt}" gewählt — Bild ` + (await bild('ebene-3_5')));

// Zurück auf alle Ebenen: Der Fokus soll auf einem beliebigen Modul landen,
// nicht nur auf einem der wenigen im Obergeschoss.
await seite.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^Ebene y = /.test(o.textContent))
  );
  s.value = '';
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await seite.waitForTimeout(2000);

// ── Stufe 3: Fokus ───────────────────────────────────────────────────────
// Raster über die Canvas wie in `pw-editor-3d-pick.mjs`: Die Kamera rahmt
// frei ein, ein fester Punkt wäre eine Wette auf den Bildausschnitt.
const box = await seite.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')]
    .filter((c) => getComputedStyle(c).display !== 'none')
    .sort((a, b) => Number(getComputedStyle(b).zIndex || 0) - Number(getComputedStyle(a).zIndex || 0))[0];
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
let getroffen = '';
const punkte = [];
for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) for (const fx of [0.5, 0.42, 0.58, 0.35, 0.65]) punkte.push([fx, fy]);
for (const [fx, fy] of punkte) {
  await seite.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
  await seite.waitForTimeout(350);
  const s = await status();
  if (/Gewählt: #\d+/.test(s)) {
    getroffen = `${s} (bei ${fx.toFixed(2)}/${fy.toFixed(2)})`;
    break;
  }
}
if (!getroffen) throw new Error('kein Modul getroffen — der Fokus hätte nichts anzusteuern');
await bild('fokus-vorher');
if (!(await knopf('Fokus'))) throw new Error('Knopf „Fokus" fehlt');
await seite.waitForTimeout(2000);
console.log(`6. Fokus auf ${getroffen} — Bild ` + (await bild('fokus')));

// Doppelklick auf ein Modul = auswählen und hinfahren. Eigener Schritt, weil
// er an einem eigenen Zuhörer hängt (`dblclick`) — der Knopf oben beweist ihn
// nicht mit.
await seite.mouse.dblclick(box.x + box.w * 0.5, box.y + box.h * 0.5);
await seite.waitForTimeout(2000);
const nachDoppel = await status();
console.log(`7. nach Doppelklick: ${nachDoppel} — Bild ` + (await bild('doppelklick')));

const rayWarnung = fehler.filter((f) => /needs to be imported/.test(f));
if (rayWarnung.length) console.log('   ACHTUNG fehlender Nebenwirkungs-Import: ' + rayWarnung[0]);
if (fehler.length) console.log('   Meldungen: ' + fehler.slice(0, 5).join(' || '));

await browser.close();
if (rayWarnung.length) {
  console.log('ERGEBNIS: FEHLGESCHLAGEN');
  process.exit(1);
}
console.log('ERGEBNIS: OK');
