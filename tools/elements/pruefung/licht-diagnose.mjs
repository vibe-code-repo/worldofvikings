#!/usr/bin/env node
/**
 * Prüft: welche Lichter ein Grab überhaupt beleuchten — Stärke, Farbe,
 * Abfall, Fackelplätze — dazu Bilder aus den vier Blickrichtungen.
 *
 * What is actually lighting this place? The light state of a barrow as
 * numbers, plus screenshots in the four cardinal directions.
 *
 * ── Warum es diese Sonde gibt ──────────────────────────────────────────
 * „Die Wände sehen glatt aus" und „das Fackellicht verteilt sich nicht
 * realistisch" sind Urteile über ein Bild. Beide haben aber eine Ursache,
 * die man ABLESEN kann, bevor man irgendetwas ändert: welche Lichter in
 * der Szene stehen, mit welcher Stärke, welcher Farbe und welcher
 * Abfallkurve — und wie viele Fackelplätze gerade brennen.
 *
 * Am 05.09.2026 hat genau das den ersten Befund erklärt: Im Grab steht die
 * Sonne auf `intensity 0` (Umgebung `Crypt`, `alwaysDark`), und das einzige
 * verbleibende Licht ist ein `HemisphericLight`. Dessen Beitrag hängt
 * ausschliesslich von `n.y` ab — auf einer SENKRECHTEN Wand ist er für jede
 * Blickrichtung derselbe. Eine Normal-Karte, die die Normale waagerecht
 * auslenkt, ändert daran nichts. Das Relief ist da, es wird nur von nichts
 * beschienen.
 *
 * Aufruf:
 *   node tools/elements/pruefung/licht-diagnose.mjs <dungeonId> [marke] [x] [z] [&query]
 *
 * Umgebung:
 *   WOV_HELL   Belichtung fürs Bild (Vorgabe 1 = wie im Spiel)
 *   WOV_DEV_USER/PASS
 *
 * LÄUFT LOKAL gegen den Tunnel — auf wov-dev startet kein Chromium
 * (Gedächtnis „Messungen laufen lokal").
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = process.env.WOV_HOST ?? 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-licht-diagnose`;
// Ohne ANGLE-Flags rendert SwiftShader (Gedächtnis „Headless Chromium
// braucht die GPU").
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const [dungeonId, marke = 'ist', xArg, zArg, extraQuery = ''] = process.argv.slice(2);
if (!dungeonId) {
  console.error('Aufruf: node tools/elements/pruefung/licht-diagnose.mjs <dungeonId> [marke] [x] [z] [&query]');
  process.exit(2);
}
const ZIEL = xArg !== undefined ? { x: Number(xArg), z: Number(zArg) } : null;
const HELL = Number(process.env.WOV_HELL ?? '1');

function testToken() {
  const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${n}.testlauf`;
}

mkdirSync(ORDNER, { recursive: true });
const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const kontext = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: {
    username: process.env.WOV_DEV_USER ?? 'Admin',
    password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
  },
});
const seite = await kontext.newPage();
const fehler = [];
seite.on('pageerror', (f) => fehler.push(String(f)));
await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await seite.goto(
  `${HOST}/?name=Licht${Date.now().toString(36).slice(-5)}&dungeon=${dungeonId}${extraQuery}`,
  { waitUntil: 'domcontentloaded', timeout: 120_000 }
);
await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await seite.waitForTimeout(12_000);
// Maus fangen, BEVOR der Blick gesetzt wird — der Klick addiert sonst sein
// Delta auf `_yaw` (s. pw-stonevault-walk.mjs).
await seite.mouse.click(800, 450);
await seite.waitForTimeout(400);

if (ZIEL) {
  // Setzen UND nachsehen: Im Grab schreibt der Havok-Koerper `position` im
  // naechsten Bild zurueck. Eine Sonde, die das nicht prueft, meldet eine
  // Stelle, an der sie nie war (s. relief-kontrast.mjs).
  const gehalten = await seite.evaluate(async (z) => {
    const p = window.__dbg.player;
    p.position.x = z.x; p.position.z = z.z;
    await new Promise((r) => setTimeout(r, 900));
    return { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) };
  }, ZIEL);
  const weg = Math.hypot(gehalten.x - ZIEL.x, gehalten.z - ZIEL.z);
  console.log(`Stelle gesetzt (${ZIEL.x}, ${ZIEL.z}) -> gehalten (${gehalten.x}, ${gehalten.z}), ${weg.toFixed(2)} m daneben`);
  await seite.waitForTimeout(600);
}

const zustand = await seite.evaluate(() => {
  const s = window.__dbg.scene;
  const L = window.__dbg.lighting;
  const c3 = (c) => (c ? [+c.r.toFixed(4), +c.g.toFixed(4), +c.b.toFixed(4)] : null);
  const p = window.__dbg.player.position;
  return {
    lichter: s.lights.map((l) => ({
      name: l.name, klasse: l.getClassName(), intensity: +l.intensity.toFixed(4),
      diffuse: c3(l.diffuse), ground: c3(l.groundColor), range: l.range,
      schatten: l.getShadowGenerator?.() ? 'ja' : 'nein',
    })),
    envIntensity: +s.environmentIntensity.toFixed(4),
    daempfung: L.dungeonDaempfung,
    fogDensity: +s.fogDensity.toFixed(5),
    fogColor: c3(s.fogColor),
    exposure: s.imageProcessingConfiguration.exposure,
    fackeln: window.__dbg.fackeln.zustand,
    spieler: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
  };
});
console.log(JSON.stringify(zustand, null, 1));

if (HELL !== 1) {
  await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, HELL);
}
for (const [tag, yaw] of [['nord', 0], ['ost', Math.PI / 2], ['sued', Math.PI], ['west', -Math.PI / 2]]) {
  await seite.evaluate((y) => {
    const p = window.__dbg.player;
    p._yaw = y; p._figurYaw = y; p._pitch = -0.05;
  }, yaw);
  await seite.waitForTimeout(700);
  await seite.screenshot({ path: `${ORDNER}/${dungeonId}-${marke}-${tag}.png` });
}
console.log(`Bilder ${ORDNER}/${dungeonId}-${marke}-*.png`);
if (fehler.length) console.log(`Seitenfehler ${fehler.length}: ${fehler[0].slice(0, 200)}`);
await kontext.close();
await browser.close();
