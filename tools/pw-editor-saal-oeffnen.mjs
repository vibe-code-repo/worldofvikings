#!/usr/bin/env node
/**
 * Prüft: ein Grab mit einem zur Laufzeit gebauten Saal lässt sich WIEDER
 * ÖFFNEN, ohne dabei einen Raum zu verlieren (E8-Befund).
 * Checks that a tomb containing a runtime-built hall can be RE-OPENED
 * without losing a room.
 *
 *   node tools/pw-editor-saal-oeffnen.mjs [docId=saal-e8-oeffnen] [breite=4] [tiefe=3] [raster=2]
 *
 * ── Warum dieser Lauf neben pw-editor-saal-bauen.mjs steht ───────────
 * Jener geht vorwärts: bauen, anfügen, speichern, betreten. Der Weg
 * ZURÜCK — Seite neu laden, Dokument aus dem Katalog öffnen — kam darin
 * nicht vor, und genau dort sass der Fehler: `GET /api/dungeons/:id`
 * ging durch `sanitizeDungeonDocument`, ohne dass der Betriebsdienst je
 * die Modul-Registry gelesen hätte. Der gebaute Saal fiel WORTLOS heraus;
 * aus 18 Räumen wurden 17, der Grundriss hatte ein Loch mit vierzehn
 * offenen Kanten, und ein Speichern danach hätte den Verlust
 * festgeschrieben. Kein Test hat das gesehen, weil kein Test das Grab je
 * ein zweites Mal geöffnet hat.
 *
 * Der Zeuge ist deshalb eine ZAHL NACH DEM ÖFFNEN und nicht nach dem
 * Speichern: 18 Räume, 0 offen. Vor dem Fix stand dort 17 und 14.
 *
 * ── Er läuft LOKAL, nicht auf wov-dev ────────────────────────────────
 * Auf `wov-dev` startet kein Chromium (Gedächtnis „Messungen laufen
 * lokal").
 *
 * Bilder: ~/.cache/wov-stonevault-sicht/saal-oeffnen-*.png
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
const [docId = 'saal-e8-oeffnen', breite = '4', tiefe = '3', raster = '2'] = process.argv.slice(2);
const modulName = `Gen_StoneVaultHall${breite}x${tiefe}${raster === '2' ? '' : `r${raster}`}`;

mkdirSync(ORDNER, { recursive: true });
let nr = 0;
const befunde = [];
const merke = (ok, was, zusatz = '') => {
  befunde.push({ ok, was, zusatz });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
};

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: CREDS });
const seite = await ctx.newPage();
const seitenfehler = [];
seite.on('pageerror', (f) => seitenfehler.push(String(f).slice(0, 200)));

const bild = async (tag) => {
  nr++;
  const p = `${ORDNER}/saal-oeffnen-${String(nr).padStart(2, '0')}-${tag}.png`;
  await seite.screenshot({ path: p });
  console.log(`  Bild ${p}`);
  return p;
};
// Anfang der Beschriftung, nicht der ganze Text: „Speichern *" heisst so,
// solange etwas ansteht (s. pw-editor-saal-bauen.mjs).
const knopf = (text) =>
  seite.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
    if (!b) return false;
    b.click();
    return true;
  }, text);
const oeffneDungeons = async () => {
  await seite.evaluate(() => {
    const b = [...document.querySelectorAll('button,a,div')].find(
      (b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3
    );
    b?.click();
  });
  await seite.waitForTimeout(3000);
};
const neuLaden = async () => {
  await seite.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await seite.waitForTimeout(8000);
  await oeffneDungeons();
};
/** Die Kopfzeile des offenen Dokuments — „N Räume, N Türen, N Deko, N offen". */
const kopfzeile = () =>
  seite.evaluate(
    () =>
      document.body.innerText
        .split('\n')
        .find((z) => /^\d+ Räume, \d+ Türen, \d+ Deko, \d+ offen$/.test(z.trim()))
        ?.trim() ?? ''
  );

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await oeffneDungeons();

// ── 1. Saal bauen ────────────────────────────────────────────────────
const gefuellt = await seite.evaluate(([b, t, r]) => {
  const setzeWert = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const zahlen = [...document.querySelectorAll('input[type=number]')];
  if (zahlen.length < 3) return { fehler: `nur ${zahlen.length} Zahlenfelder` };
  setzeWert(zahlen[0], b);
  setzeWert(zahlen[1], t);
  setzeWert(zahlen[2], '1');
  const rw = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^Raster /.test(o.textContent))
  );
  if (!rw) return { fehler: 'keine Rasterauswahl' };
  rw.value = r;
  rw.dispatchEvent(new Event('change'));
  return { ok: true };
}, [breite, tiefe, raster]);
merke(gefuellt.ok === true, 'Breite, Tiefe, Raster und Gewicht gesetzt', JSON.stringify(gefuellt));

await knopf('Saal bauen');
await seite.waitForTimeout(12_000);
const gebaut = await seite.evaluate(() =>
  document.body.innerText
    .split('\n')
    .filter((z) => /Gebaut|abgelehnt|schon|nicht eingeschaltet/.test(z))
    .map((z) => z.trim())
    .join(' | ')
);
merke(/Gebaut/.test(gebaut), `${modulName} gebaut`, gebaut);
await bild('gebaut');

// ── 2. Dokument anlegen und den Saal anfügen ─────────────────────────
//
// Neu laden dazwischen: Der Katalog des Editors entsteht beim Aufbau der
// Seite, die Registry wird davor geholt (`ladeModulRegistrierung`).
await neuLaden();

const anlegen = await seite.evaluate(async ([id]) => {
  const setzeWert = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const basis = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^DG_StoneVault/.test(o.textContent.trim()))
  );
  if (!basis) return { fehler: 'kein Basis-Select' };
  basis.value = [...basis.options].find((o) => /^DG_StoneVault/.test(o.textContent.trim())).value;
  basis.dispatchEvent(new Event('change'));
  const idFeld = document.querySelector('input[placeholder^="id,"]');
  if (!idFeld) return { fehler: 'kein id-Feld' };
  setzeWert(idFeld, id);
  [...document.querySelectorAll('button')].find((b) => /^Anlegen/.test(b.textContent.trim()))?.click();
  return { ok: true };
}, [docId]);
await seite.waitForTimeout(8000);
merke(anlegen.ok === true, `Dokument ${docId} angelegt`, JSON.stringify(anlegen));

const gesetzt = await seite.evaluate(async (name) => {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const selects = [...document.querySelectorAll('select')];
  const raum = selects.find((s) => [...s.options].some((o) => o.textContent.includes(name)));
  if (!raum) return { fehler: `keine Raumwahl mit ${name}` };
  const kante = selects.find((s) => [...s.options].some((o) => /#0\//.test(o.textContent)));
  if (kante) {
    const wahl = [...kante.options].find((o) => !/Eingang/i.test(o.textContent)) ?? kante.options[0];
    kante.value = wahl.value;
    kante.dispatchEvent(new Event('change'));
    await warte(300);
  }
  const raum2 = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.textContent.includes(name))
  );
  raum2.value = [...raum2.options].find((o) => o.textContent.includes(name)).value;
  raum2.dispatchEvent(new Event('change'));
  await warte(300);
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Anfügen')?.click();
  await warte(1000);
  return { ok: true };
}, modulName);
merke(gesetzt.ok === true, 'der gebaute Saal ist angefügt', JSON.stringify(gesetzt));

await knopf('Kanten schließen');
await seite.waitForTimeout(3000);
const vorSpeichern = await kopfzeile();
merke(/, 0 offen$/.test(vorSpeichern), 'vor dem Speichern: keine offene Kante mehr', vorSpeichern);
await bild('kanten-zu');

await knopf('Speichern');
await seite.waitForTimeout(10_000);
// Der bleibende Zeuge ist die Schmutzmarke, nicht die Statuszeile —
// die trägt ihre Meldung nur eine Weile (s. pw-editor-saal-bauen.mjs).
const gespeichert = await seite.evaluate(() => ({
  meldung: document.body.innerText
    .split('\n')
    .filter((z) => /gespeichert|abgelehnt|veraltet/i.test(z))
    .map((z) => z.trim())
    .join(' | '),
  sternchen: [...document.querySelectorAll('button')].some((b) =>
    b.textContent.trim().startsWith('Speichern *')
  ),
  ungespeichert: /Ungespeichert\./.test(document.body.innerText),
}));
merke(
  gespeichert.sternchen === false && gespeichert.ungespeichert === false,
  'gespeichert (die Schmutzmarke ist fort)',
  JSON.stringify(gespeichert)
);
const nachSpeichern = await kopfzeile();
console.log(`  Kopfzeile nach dem Speichern: ${nachSpeichern}`);

// ── 3. DER ZEUGE: neu laden und WIEDER ÖFFNEN ────────────────────────
//
// Hier lief der Betriebsdienst vorher in den stillen Verlust. Die
// Kopfzeile ist die einzige Stelle, an der man ihn sieht — die Datei auf
// der Platte ist heil, der Spielserver liest sie richtig, nur der Weg
// über `/api/dungeons/:id` verlor den Saal.
await neuLaden();
const geoeffnet = await seite.evaluate(async (id) => {
  const wahl = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === id)
  );
  if (!wahl) return { fehler: `${id} steht nicht in der Liste` };
  const zeile = [...wahl.options].find((o) => o.value === id).textContent.trim();
  wahl.value = id;
  wahl.dispatchEvent(new Event('change'));
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Öffnen')?.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { ok: true, zeile };
}, docId);
merke(geoeffnet.ok === true, `${docId} aus dem Katalog geöffnet`, JSON.stringify(geoeffnet));
await seite.waitForTimeout(3000);

const kopf = await kopfzeile();
const meldung = await seite.evaluate(() =>
  document.body.innerText
    .split('\n')
    .filter((z) => /geladen|kennt|unbekannt|fehlgeschlagen/i.test(z))
    .map((z) => z.trim())
    .join(' | ')
);
merke(/^18 Räume/.test(kopf), 'nach dem Öffnen: 18 Räume (vor dem Fix: 17)', kopf);
merke(/, 0 offen$/.test(kopf), 'nach dem Öffnen: 0 offene Kanten (vor dem Fix: 14)', kopf);
console.log(`  Meldung: ${meldung}`);
const beweis = await bild('geoeffnet');

if (seitenfehler.length) console.log(`  Seitenfehler: ${seitenfehler.slice(0, 4).join(' || ')}`);
await browser.close();

const rot = befunde.filter((b) => !b.ok);
console.log(`\n${befunde.length - rot.length}/${befunde.length} grün. Beweisbild: ${beweis}`);
process.exit(rot.length === 0 ? 0 : 1);
