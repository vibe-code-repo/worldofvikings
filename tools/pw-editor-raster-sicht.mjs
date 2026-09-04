#!/usr/bin/env node
/**
 * G9 — Sichtprobe des Web-Editors auf dem RASTERPFAD.
 *
 * ── Warum es dieses Skript gibt ──────────────────────────────────────
 * Die G9-Tests messen den Grundriss als Datenstruktur: 0 Löcher, keine
 * Öffnung vor einer fremden Wand, dieselbe Plattenmenge wie der
 * Generator. Keine dieser Zahlen sagt, wie das Grab AUSSIEHT — und Mikes
 * Befund war ein optischer („viele Zwischenwände und Bögen, sehr
 * verwinkelt"). Grüne Tests sind kein Fenster; deshalb wird hier ein
 * frisches Dokument im echten Editor erzeugt und fotografiert.
 *
 * Belegt werden drei Dinge, die nur ein Bild belegen kann:
 *  1. Die Kopfzeile meldet „0 offen" — ohne den Fehlalarm, den
 *     `computeOpenConnections` bis G9 zeigte.
 *  2. Im 2D-Grundriss stehen keine Doppelwände MITTEN in einem Raum.
 *  3. In der 3D-Ansicht sind Torbögen sparsam gesetzt.
 *
 * Muster: tools/pw-editor-3d-generieren.mjs (Basic-Auth über
 * httpCredentials, GPU-Flags — ohne sie rendert SwiftShader).
 *
 *   node tools/pw-editor-raster-sicht.mjs [docId=raster-probe] [zellen=40] [zone=32]
 *
 * Bilder: ~/.cache/wov-stonevault-sicht/raster-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const CREDS = {
  username: process.env.WOV_DEV_USER ?? 'Admin',
  password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
};
const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];
const [docId = 'raster-probe', zellenRoh = '40', zoneRoh = '32'] = process.argv.slice(2);
mkdirSync(ORDNER, { recursive: true });

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: CREDS,
});
const seite = await ctx.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push(String(f).slice(0, 200)));
seite.on('console', (m) => {
  if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200));
});

let nr = 0;
const bild = async (tag) => {
  nr++;
  const p = `${ORDNER}/raster-${String(nr).padStart(2, '0')}-${tag}.png`;
  await seite.screenshot({ path: p });
  console.log(`  Bild ${p.split('/').pop()}`);
  return p;
};
// Die Kopfzeile ist die Aussage, um die es geht: „… Räume, … Türen, …
// Deko, N offen". N muss 0 sein.
const kopf = () =>
  seite.evaluate(
    () => document.body.innerText.split('\n').find((z) => /Räume, \d+ Türen/.test(z)) ?? ''
  );
const knopf = (text) =>
  seite.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!b) return false;
    b.click();
    return true;
  }, text);
const setzeFeld = (selector, wert) =>
  seite.evaluate(([sel, v]) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [selector, wert]);

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await seite.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,div')].find(
    (b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3
  );
  b?.click();
});
await seite.waitForTimeout(3000);

// ── 1. Formular ────────────────────────────────────────────────────────
const basisOk = await seite.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^DG_StoneVault/.test(o.textContent.trim()))
  );
  if (!s) return false;
  s.value = [...s.options].find((o) => /^DG_StoneVault/.test(o.textContent.trim())).value;
  s.dispatchEvent(new Event('change'));
  return true;
});
await seite.waitForTimeout(500);
await setzeFeld('input[placeholder^="id,"]', docId);
const haekchen = await seite.evaluate(() => {
  const cb = [...document.querySelectorAll('input[type=checkbox]')].find((c) =>
    c.parentElement?.textContent?.includes('voll generieren')
  );
  if (!cb) return false;
  if (!cb.checked) cb.click();
  return cb.checked;
});
await seite.waitForTimeout(800);
// „Zellen" und „Zone" tragen beide den Platzhalter „Kit-Vorgabe" und
// stehen in dieser Reihenfolge in derselben Zeile — gesucht wird deshalb
// über die BESCHRIFTUNG der Zeile, nicht über den Platzhalter.
const felder = await seite.evaluate(([z, zo]) => {
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const setze = (el, v) => {
    if (!el) return false;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const vorgaben = [...document.querySelectorAll('input[placeholder="Kit-Vorgabe"]')];
  const beschriftung = [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && e.textContent.trim() === 'Zellen')
    .length;
  return {
    beschriftungZellen: beschriftung > 0,
    zellen: setze(vorgaben[0], z),
    zone: setze(vorgaben[1], zo),
    anzahlVorgabefelder: vorgaben.length,
  };
}, [zellenRoh, zoneRoh]);
console.log(`1. Formular: Basis ${basisOk}, „voll generieren" ${haekchen}, ${JSON.stringify(felder)}`);

await knopf('Vorschau');
await seite.waitForTimeout(2500);
const nachVorschau = await kopf();
console.log(`   Vorschau: ${nachVorschau}`);
await bild('vorschau-2d');

await knopf('Anlegen & speichern');
await seite.waitForTimeout(8000);
const gespeichert = await kopf();
console.log(`   gespeichert: ${gespeichert}`);
await bild('gespeichert-2d');

// Der Grundriss noch einmal formatfüllend: „Doppelwand im Raum" ist auf
// dem eingepassten Bild sonst zwei Pixel breit.
await knopf('Einpassen');
await seite.waitForTimeout(1200);
await bild('grundriss-eingepasst');

// ── 2. 3D-Ansicht ──────────────────────────────────────────────────────
const dreiD = await knopf('3D-Ansicht');
await seite.waitForTimeout(20_000);
console.log(`2. 3D-Ansicht: Knopf ${dreiD}`);
await bild('3d');
await seite.mouse.wheel(0, -400);
await seite.waitForTimeout(2500);
await bild('3d-nah');

// ── 3. Die Zahl, um die es geht ────────────────────────────────────────
const offen = /(\d+)\s+offen/.exec(gespeichert)?.[1] ?? '?';
console.log(`3. Kopfzeile meldet ${offen} offen (verlangt: 0)`);
if (fehler.length) console.log(`   Fehler: ${fehler.slice(0, 5).join(' || ')}`);
await browser.close();
process.exit(offen === '0' ? 0 : 1);
