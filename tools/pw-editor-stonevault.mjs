#!/usr/bin/env node
/**
 * Ende-zu-Ende-Prüfung des Web-Editors (editor.dev, Reiter „Dungeons") für das Modul-Kit:
 * neues StoneVault-Dokument anlegen → Korridor mit gewählter Ausrichtung anfügen → Grundbeleuchtung
 * setzen → speichern → Dokument auf dem Server prüfen → als Testcharakter betreten und fotografieren.
 * End-to-end check of the web editor for the module kit.
 *
 *   node tools/pw-editor-stonevault.mjs [docId=editor-probe] [licht=2.5]
 *
 * Basic-Auth über httpCredentials (nicht in der Adresse). Der Editor speichert über den
 * Spielserver-Socket; auf dev reicht `everyone-admin`, ein Spiel-Login ist nicht nötig.
 * Bilder: ~/.cache/wov-stonevault-sicht/editor-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const HOST_SPIEL = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const CREDS = { username: process.env.WOV_DEV_USER ?? 'Admin', password: process.env.WOV_DEV_PASS ?? '!T3mp12345' };
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const [docId = 'editor-probe', lichtRoh = '2.5'] = process.argv.slice(2);
const licht = Number(lichtRoh);
mkdirSync(ORDNER, { recursive: true });

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const seite = await ctx.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push(String(f).slice(0, 200)));
let bildNr = 0;
const bild = async (tag) => { bildNr++; const p = `${ORDNER}/editor-${String(bildNr).padStart(2, '0')}-${tag}.png`; await seite.screenshot({ path: p }); console.log(`  Bild ${p.split('/').pop()}`); };
const fuss = () => seite.evaluate(() => document.querySelector('footer, [class*=fuss], [class*=status]')?.textContent?.trim().slice(0, 160) ?? document.body.innerText.split('\n').filter((z) => /geladen|gespeichert|angefügt|Fehler|abgelehnt/i.test(z)).slice(-1)[0] ?? '');

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
// Reiter „Dungeons" in der linken Leiste.
await seite.evaluate(() => { const b = [...document.querySelectorAll('button,a,div')].find((b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3); b?.click(); });
await seite.waitForTimeout(3000);

// ── 1. Neu anlegen ─────────────────────────────────────────────────────
const angelegt = await seite.evaluate(async ([id]) => {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const basis = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /^DG_StoneVault/.test(o.textContent.trim())));
  if (!basis) return { fehler: 'kein Basis-Select' };
  basis.value = [...basis.options].find((o) => /^DG_StoneVault/.test(o.textContent.trim())).value;
  basis.dispatchEvent(new Event('change'));
  const idFeld = document.querySelector('input[placeholder^="id,"]');
  const seedFeld = document.querySelector('input[placeholder^="Seed"]');
  if (!idFeld) return { fehler: 'kein id-Feld' };
  const setze = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  setze(idFeld, id);
  if (seedFeld) setze(seedFeld, '7');
  const knopf = [...document.querySelectorAll('button')].find((b) => /^Anlegen/.test(b.textContent.trim()));
  if (!knopf) return { fehler: 'kein Anlegen-Knopf' };
  knopf.click();
  await warte(6000);
  return { ok: true };
}, [docId]);
console.log(`1. Anlegen: ${JSON.stringify(angelegt)} — ${await fuss()}`);
await bild('angelegt');

// ── 2. Korridor mit Ausrichtung anfügen ────────────────────────────────
const angefuegt = await seite.evaluate(async () => {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const selects = [...document.querySelectorAll('select')];
  const conn = selects.find((s) => [...s.options].some((o) => /StoneVaultEntry#0\//.test(o.textContent)));
  if (!conn) return { fehler: 'keine offenen Connectors' };
  // Nord-Kante des Eingangs (Connector 0), wenn vorhanden.
  const nord = [...conn.options].find((o) => /StoneVaultEntry#0\/0/.test(o.textContent)) ?? conn.options[0];
  conn.value = nord.value; conn.dispatchEvent(new Event('change'));
  await warte(200);
  const raum = selects.find((s) => [...s.options].some((o) => /StoneVaultCorridor/.test(o.textContent)));
  if (!raum) return { fehler: 'keine Raumwahl' };
  raum.value = [...raum.options].find((o) => /StoneVaultCorridor/.test(o.textContent)).value;
  raum.dispatchEvent(new Event('change'));
  await warte(200);
  const ausr = selects.find((s) => [...s.options].some((o) => /^automatisch$/.test(o.textContent.trim())));
  const optionen = ausr ? [...ausr.options].map((o) => o.textContent.trim()) : [];
  if (ausr && ausr.options.length > 2) { ausr.selectedIndex = 2; ausr.dispatchEvent(new Event('change')); }
  const knopf = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Anfügen');
  knopf?.click();
  await warte(500);
  return { connector: nord.textContent.trim(), ausrichtungen: optionen, gewaehlt: ausr?.options[ausr.selectedIndex]?.textContent.trim() ?? null };
});
console.log(`2. Anfügen: ${JSON.stringify(angefuegt)} — ${await fuss()}`);
await bild('angefuegt');

// ── 3. Grundbeleuchtung setzen ─────────────────────────────────────────
const lichtGesetzt = await seite.evaluate(async ([wert]) => {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const regler = [...document.querySelectorAll('input[type=range]')].find((r) => Number(r.max) >= 2);
  if (!regler) return { fehler: 'kein Grundbeleuchtungs-Regler' };
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  s.call(regler, String(wert));
  regler.dispatchEvent(new Event('input', { bubbles: true }));
  regler.dispatchEvent(new Event('change', { bubbles: true }));
  await warte(300);
  return { ok: true, min: regler.min, max: regler.max, wert: regler.value };
}, [licht]);
console.log(`3. Grundbeleuchtung: ${JSON.stringify(lichtGesetzt)}`);

// ── 4. Speichern ───────────────────────────────────────────────────────
await seite.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Speichern')?.click(); });
await seite.waitForTimeout(6000);
console.log(`4. Speichern — ${await fuss()}`);
await bild('gespeichert');
if (fehler.length) console.log(`  Seitenfehler: ${fehler.slice(0, 3).join(' || ')}`);
await ctx.close();

// ── 5. Betreten und fotografieren ──────────────────────────────────────
function testToken() {
  const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${n}.testlauf`;
}
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const spiel = await ctx2.newPage();
await spiel.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await spiel.goto(`${HOST_SPIEL}/?name=Ed${Date.now().toString(36).slice(-4)}&dungeon=${docId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await spiel.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await spiel.waitForTimeout(10_000);
const daempfung = await spiel.evaluate(() => window.__dbg.lighting?.dungeonDaempfung ?? null);
const kit = await spiel.evaluate(() => { let n = 0; for (const b of window.__dbg.entities.buckets.values()) if (String(b.prefabName).startsWith('StoneVault')) n += (b.matrices?.length ?? 0) / 16; return n; });
console.log(`5. Betreten ${docId}: Dungeon-Dämpfung im Client = ${daempfung} (erwartet ${licht}), Kit-Instanzen ${kit}`);
// Ohne Belichtungsanhebung fotografieren — das Bild soll die Grundbeleuchtung zeigen, nicht die Sonde.
await spiel.mouse.click(800, 450); await spiel.waitForTimeout(400);
await spiel.evaluate(() => { const p = window.__dbg.player; p._yaw = Math.PI; p._figurYaw = Math.PI; p._pitch = -0.1; });
await spiel.keyboard.down('KeyW'); await spiel.waitForTimeout(700); await spiel.keyboard.up('KeyW'); await spiel.waitForTimeout(600);
bildNr++; await spiel.screenshot({ path: `${ORDNER}/editor-${String(bildNr).padStart(2, '0')}-im-spiel-licht-${lichtRoh}.png` });
console.log(`  Bild editor-${String(bildNr).padStart(2, '0')}-im-spiel-licht-${lichtRoh}.png, Position ${JSON.stringify(await spiel.evaluate(() => { const p = window.__dbg.player.position; return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; }))}`);
await browser.close();
