#!/usr/bin/env node
/**
 * Beweisbilder für die LICHTFUGE — dieselbe Stelle, vorher und nachher.
 * Light-seam evidence shots: the same spot before and after the fix.
 *
 * Was es tut: Ein Testcharakter betritt ein Grab, stellt sich auf einen
 * gegebenen Punkt, blickt in die vier Himmelsrichtungen und macht je ein
 * Bild. Zu jedem Bild werden KAMERAPOSE und die hellsten Bildpunkte
 * ausgegeben — Pose, damit sich die Stelle in Blender nachbauen lässt
 * (`~/wov-ai/elements/render-szene.py`), Helligkeit, damit „keine Fuge
 * mehr" eine Zahl ist und kein Eindruck.
 *
 * Warum eine eigene Datei neben `pw-stonevault-walk.mjs`: Dessen Rundblick
 * läuft nur am ENDE einer vollen Begehung (zwei Minuten Lauf), und er
 * meldet die Kamera nicht. Für eine Fuge, die man zehnmal ansieht, ist das
 * der falsche Hebel.
 *
 * Aufruf:
 *   node tools/pw-lichtfuge.mjs <dungeonId> [x] [z] [marke]
 * Bilder: ~/.cache/wov-stonevault-walk/<dungeonId>-fuge-<marke>-<richtung>.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-walk`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const [dungeonId, xArg, zArg, marke = 'vorher'] = process.argv.slice(2);
if (!dungeonId) {
  console.error('Aufruf: node tools/pw-lichtfuge.mjs <dungeonId> [x] [z] [marke]');
  process.exit(2);
}
const ZIEL = xArg !== undefined ? { x: Number(xArg), z: Number(zArg) } : null;

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

mkdirSync(ORDNER, { recursive: true });

const browser = await chromium.launch({ args: GPU_FLAGS });
const kontext = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: { username: BENUTZER, password: PASSWORT },
});
const seite = await kontext.newPage();
await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
const name = `Fuge${Date.now().toString(36).slice(-5)}`;
await seite.goto(`${HOST}/?name=${name}&dungeon=${dungeonId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await seite.waitForTimeout(10_000);
const belichtung = Number(process.env.WOV_HELL ?? '6');
await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, belichtung);

// Maus fangen, BEVOR der Blick gesetzt wird (der Klick addiert sonst sein
// Delta auf `_yaw`, s. pw-stonevault-walk.mjs).
await seite.mouse.click(800, 450);
await seite.waitForTimeout(400);

if (ZIEL) {
  await seite.evaluate((z) => {
    const p = window.__dbg.player;
    p.position.x = z.x;
    p.position.z = z.z;
  }, ZIEL);
  await seite.waitForTimeout(1200);
}

const RICHTUNGEN = [['nord', 0], ['ost', Math.PI / 2], ['sued', Math.PI], ['west', -Math.PI / 2]];
for (const [tag, yaw] of RICHTUNGEN) {
  await seite.evaluate(([yy]) => {
    const p = window.__dbg.player;
    p._yaw = yy; p._figurYaw = yy; p._pitch = -0.1;
  }, [yaw]);
  await seite.waitForTimeout(700);
  const pfad = `${ORDNER}/${dungeonId}-fuge-${marke}-${tag}.png`;
  await seite.screenshot({ path: pfad });
  const info = await seite.evaluate(() => {
    const s = window.__dbg.scene;
    const c = s.activeCamera;
    const ziel = c.getTarget ? c.getTarget() : null;
    const vor = c.getForwardRay ? c.getForwardRay(1).direction : null;
    const p = window.__dbg.player.position;
    return {
      spieler: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) },
      kamera: { x: +c.globalPosition.x.toFixed(3), y: +c.globalPosition.y.toFixed(3), z: +c.globalPosition.z.toFixed(3) },
      blick: vor ? { x: +vor.x.toFixed(4), y: +vor.y.toFixed(4), z: +vor.z.toFixed(4) } : null,
      ziel: ziel ? { x: +ziel.x.toFixed(3), y: +ziel.y.toFixed(3), z: +ziel.z.toFixed(3) } : null,
      fov: +c.fov.toFixed(4),
      seite: s.getEngine().getRenderWidth() / s.getEngine().getRenderHeight(),
    };
  });
  console.log(`${tag}: ${JSON.stringify(info)}\n  Bild ${pfad}`);
}

await kontext.close();
await browser.close();
