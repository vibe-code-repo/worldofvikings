#!/usr/bin/env node
/**
 * Browser-Prüfung der Web-Editor-Vorhaben A (3D-Ansicht) und B (Generieren):
 * (1) „voll generieren" + Vorschau + Neu würfeln + Anlegen & speichern → Dokument mode generated,
 * (2) 3D-Ansicht einschalten, Bild, Instanzen/Marken zählen, Raum per Klick wählen,
 * (3) als Testcharakter betreten und fotografieren.
 * Browser check of the editor's 3D view and in-browser generation.
 *
 *   node tools/pw-editor-3d-generieren.mjs [docId=gen-probe] [raeume=12] [zone=32]
 *
 * Basic-Auth über httpCredentials. Bilder: ~/.cache/wov-stonevault-sicht/editor3d-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const HOST_SPIEL = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const CREDS = { username: process.env.WOV_DEV_USER ?? 'Admin', password: process.env.WOV_DEV_PASS ?? '!T3mp12345' };
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const [docId = 'gen-probe', raeumeRoh = '12', zoneRoh = '32'] = process.argv.slice(2);
mkdirSync(ORDNER, { recursive: true });

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const seite = await ctx.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push(String(f).slice(0, 200)));
seite.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
let nr = 0;
const bild = async (tag) => { nr++; const p = `${ORDNER}/editor3d-${String(nr).padStart(2, '0')}-${tag}.png`; await seite.screenshot({ path: p }); console.log(`  Bild ${p.split('/').pop()}`); };
const kopf = () => seite.evaluate(() => document.body.innerText.split('\n').find((z) => /Räume, \d+ Türen/.test(z)) ?? '');
const knopf = (text) => seite.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t); if (!b) return false; b.click(); return true; }, text);
const setzeFeld = (selector, wert) => seite.evaluate(([sel, v]) => { const el = document.querySelector(sel); if (!el) return false; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [selector, wert]);

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await seite.evaluate(() => { const b = [...document.querySelectorAll('button,a,div')].find((b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3); b?.click(); });
await seite.waitForTimeout(3000);

// ── 1. Generieren ──────────────────────────────────────────────────────
const basisOk = await seite.evaluate(() => { const s = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /^DG_StoneVault/.test(o.textContent.trim()))); if (!s) return false; s.value = [...s.options].find((o) => /^DG_StoneVault/.test(o.textContent.trim())).value; s.dispatchEvent(new Event('change')); return true; });
await setzeFeld('input[placeholder^="id,"]', docId);
// Häkchen „voll generieren"
const haekchen = await seite.evaluate(() => { const lab = [...document.querySelectorAll('label,div,span')].find((l) => l.textContent.trim().startsWith('voll generieren')); const cb = lab?.querySelector('input[type=checkbox]') ?? [...document.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.textContent?.includes('voll generieren')); if (!cb) return false; if (!cb.checked) cb.click(); return cb.checked; });
await seite.waitForTimeout(500);
const felder = await seite.evaluate(([r, z]) => {
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const setze = (el, v) => { if (!el) return false; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  const inputs = [...document.querySelectorAll('input')];
  const raeume = inputs.find((i) => /R.ume/.test(i.placeholder) || /R.ume/.test(i.previousElementSibling?.textContent ?? '') || /R.ume/.test(i.parentElement?.textContent ?? ''));
  const zone = inputs.find((i) => /^Zone/.test(i.placeholder) || /Zone/.test(i.parentElement?.textContent ?? '') && i !== raeume);
  return { raeume: setze(raeume, r), zone: setze(zone, z), platzhalter: inputs.map((i) => i.placeholder).filter(Boolean) };
}, [raeumeRoh, zoneRoh]);
console.log(`1. Formular: basis ${basisOk}, voll ${haekchen}, Felder ${JSON.stringify(felder)}`);
await knopf('Vorschau'); await seite.waitForTimeout(1500);
const nachVorschau = await kopf();
await bild('vorschau');
await knopf('Neu würfeln'); await seite.waitForTimeout(1500);
const nachWurf = await kopf();
console.log(`   Vorschau: ${nachVorschau} | Neu würfeln: ${nachWurf}`);
await knopf('Anlegen & speichern'); await seite.waitForTimeout(7000);
console.log(`   gespeichert: ${await kopf()}`);
await bild('gespeichert-2d');

// ── 2. 3D-Ansicht ──────────────────────────────────────────────────────
const dreiD = await knopf('3D-Ansicht');
await seite.waitForTimeout(15_000);
console.log(`2. 3D-Ansicht: Knopf ${dreiD}`);
await bild('3d');
const zaehlung = await seite.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, sichtbar: getComputedStyle(c).display !== 'none' }));
  return { canvases: c };
});
console.log(`   Canvases: ${JSON.stringify(zaehlung)}`);
// Klick in die Mitte der 3D-Ansicht: trifft hoffentlich einen Raum → Auswahl in der Seitenleiste.
await seite.mouse.click(1000, 450); await seite.waitForTimeout(800);
const auswahl = await seite.evaluate(() => document.body.innerText.split('\n').find((z) => /^Gewählt|Raum \d+|gewählt/i.test(z)) ?? '');
console.log(`   nach Klick: ${auswahl}`);
await bild('3d-nach-klick');
await knopf('2D-Grundriss'); await seite.waitForTimeout(800);
await bild('zurueck-2d');
if (fehler.length) console.log(`  Fehler: ${fehler.slice(0, 4).join(' || ')}`);
await ctx.close();

// ── 3. Betreten ────────────────────────────────────────────────────────
function testToken() { const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return `${n}.testlauf`; }
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const spiel = await ctx2.newPage();
await spiel.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await spiel.goto(`${HOST_SPIEL}/?name=Gen${Date.now().toString(36).slice(-4)}&dungeon=${docId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await spiel.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await spiel.waitForTimeout(10_000);
const kit = await spiel.evaluate(() => { let n = 0; for (const b of window.__dbg.entities.buckets.values()) if (String(b.prefabName).startsWith('StoneVault')) n += (b.matrices?.length ?? 0) / 16; return n; });
await spiel.evaluate(() => { window.__dbg.scene.imageProcessingConfiguration.exposure = 5; });
await spiel.mouse.click(800, 450); await spiel.waitForTimeout(400);
await spiel.evaluate(() => { const p = window.__dbg.player; p._yaw = 0; p._figurYaw = 0; p._pitch = -0.1; });
await spiel.keyboard.down('KeyW'); await spiel.waitForTimeout(1500); await spiel.keyboard.up('KeyW'); await spiel.waitForTimeout(600);
nr++; await spiel.screenshot({ path: `${ORDNER}/editor3d-${String(nr).padStart(2, '0')}-im-spiel.png` });
console.log(`3. Betreten ${docId}: Kit-Instanzen ${kit}, Bild editor3d-${String(nr).padStart(2, '0')}-im-spiel.png`);
await browser.close();
