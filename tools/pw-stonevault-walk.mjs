#!/usr/bin/env node
/**
 * Begehung eines StoneVault-Dungeons auf play.dev — mit eigenem Testcharakter,
 * echten Tastendrücken und Beweisbildern. Misst, ob die Figur eine Treppe
 * hochkommt: Der Testcharakter läuft vom Spawn aus in eine vorgegebene
 * Richtung, und das Skript liest die erreichte Höhe (`player.position.y`).
 * Walk-through of a StoneVault dungeon on play.dev with an own test
 * character, real key presses and proof shots; measures whether the figure
 * climbs a staircase (reached `position.y`).
 *
 *   node tools/pw-stonevault-walk.mjs <dungeonId> [yawGrad=0] [sekunden=8] [ziel-y]
 *
 * Anmeldung wie in pw-dungeon2-playdev.mjs (formgerechtes, ungültig
 * signiertes Token → der Server würfelt eine frische Identität; kein Konto,
 * kein Passwort). Basic-Auth über `httpCredentials`, NICHT in der Adresse
 * (sonst kein Havok, s. dort). Je Lauf ein eigener Name.
 *
 * Bilder landen unter ~/.cache/wov-stonevault-walk/<dungeonId>-*.png.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-walk`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const [dungeonId, yawGradRoh = '0', sekundenRoh = '8', zielYRoh] = process.argv.slice(2);
if (!dungeonId) {
  console.error('Aufruf: node tools/pw-stonevault-walk.mjs <dungeonId> [yawGrad] [sekunden] [ziel-y]');
  process.exit(2);
}
const yaw = (Number(yawGradRoh) * Math.PI) / 180;
const sekunden = Number(sekundenRoh);
const zielY = zielYRoh === undefined ? null : Number(zielYRoh);

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
const kontext = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: { username: BENUTZER, password: PASSWORT },
});
const seite = await kontext.newPage();
const fehler = [];
const vierNullVier = [];
seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
seite.on('pageerror', (f) => fehler.push(String(f)));
// Welche Datei fehlt? Der HUD-Zähler „assets-fehler" nennt keinen Namen.
seite.on('response', (r) => { if (r.status() === 404) vierNullVier.push(r.url()); });
await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());

const name = `Walk${Date.now().toString(36).slice(-5)}`;
mkdirSync(ORDNER, { recursive: true });
await seite.goto(`${HOST}/?name=${name}&dungeon=${dungeonId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
// Kit-Teile laden lassen (Thin-Instances + Steinmaterial).
await seite.waitForTimeout(10_000);

// Belichtung NUR fürs Beweisbild: Ein Testcharakter trägt keine Fackel, und
// die Innen-Umgebung „Caves" hat 0,1 Grundlicht — auf dem Bild wäre sonst
// nichts zu beurteilen. Das ist die Bildverarbeitung der Szene, kein
// Eingriff in Material oder Licht (WOV_HELL=1 → keine Anhebung).
// Exposure for the proof shot only; a test character carries no torch.
const belichtung = Number(process.env.WOV_HELL ?? '6');
await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, belichtung);

const lage = () => seite.evaluate(() => {
  const p = window.__dbg.player;
  return { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2) };
});
const start = await lage();
await seite.screenshot({ path: `${ORDNER}/${dungeonId}-0-spawn.png` });

// Blickrichtung setzen (bleibt, s. pw-dungeon2-playdev.mjs), dann laufen.
await seite.evaluate((y) => {
  const p = window.__dbg.player;
  p._yaw = y; p._figurYaw = y; p._pitch = -0.1;
}, yaw);
await seite.mouse.click(800, 450);
await seite.keyboard.down('KeyW');
let maxY = start.y;
const spur = [];
const t0 = Date.now();
while (Date.now() - t0 < sekunden * 1000) {
  await seite.waitForTimeout(500);
  const l = await lage();
  spur.push(l);
  if (l.y > maxY) maxY = l.y;
}
await seite.keyboard.up('KeyW');
await seite.waitForTimeout(800);
const ende = await lage();
await seite.screenshot({ path: `${ORDNER}/${dungeonId}-1-ende.png` });

// Umsehen: drei Blicke (links, rechts, zurück).
let i = 2;
for (const d of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
  await seite.evaluate(([y]) => { const p = window.__dbg.player; p._yaw = y; p._figurYaw = y; }, [yaw + d]);
  await seite.waitForTimeout(700);
  await seite.screenshot({ path: `${ORDNER}/${dungeonId}-${i++}-blick.png` });
}

console.log(`Dungeon ${dungeonId}, Name ${name}, yaw ${yawGradRoh}°, ${sekunden}s`);
console.log(`  Start ${JSON.stringify(start)} → Ende ${JSON.stringify(ende)}, max y ${maxY.toFixed(2)}`);
console.log(`  Spur: ${spur.map((l) => `${l.x},${l.z}|${l.y}`).join('  ')}`);
if (fehler.length) console.log(`  Konsolenfehler: ${fehler.length} (erste: ${fehler[0].slice(0, 200)})`);
if (vierNullVier.length) console.log(`  404: ${[...new Set(vierNullVier)].join(', ')}`);
let rc = 0;
if (zielY !== null) {
  const ok = maxY >= zielY - 0.05;
  console.log(`  Ziel-Höhe ${zielY}: ${ok ? 'ERREICHT' : 'NICHT erreicht'}`);
  rc = ok ? 0 : 1;
}
await kontext.close();
await browser.close();
process.exit(rc);
