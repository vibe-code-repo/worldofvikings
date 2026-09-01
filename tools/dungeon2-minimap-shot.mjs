// Sicht-Prüfung der Dungeon-Minimap: lädt die Vorschau mit ?minimap=1, hüpft die
// Kamera über ein Raster um den Spawn (deckt den Fog-of-War auf) und macht dann
// einen Vollbild-Screenshot — das DOM-Overlay der Minimap sitzt oben rechts.
//
// Visual check for the dungeon minimap: loads the preview with ?minimap=1, hops
// the camera over a grid around the spawn (reveals the fog of war), then takes a
// full-page screenshot with the minimap overlay in the top-right.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = Number(process.env.DG2_PORT || 5901);
const SEED = Number(process.env.DG2_SEED || 2);
const ORDNER = `${process.env.HOME}/.cache/wov-tripo-test`;
const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const browser = await chromium.launch({ headless: true, args: GPU });
const seite = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await seite.goto(`http://localhost:${PORT}/dungeon2.html?seed=${SEED}&stufe=2&minimap=1`, {
  waitUntil: 'domcontentloaded',
});
await seite.waitForFunction(() => window.__dg2 !== undefined && window.dungeon2Vorschau !== undefined, null, {
  timeout: 120000,
});
await seite.waitForTimeout(4000); // Shader + erste Bilder / shader + first frames

// Kamera über ein Raster um den Spawn hüpfen, damit der Fog-of-War eine Fläche
// aufdeckt. Zwischen den Sprüngen ein paar Bilder warten, damit die
// Minimap-`update()` je Position aufdeckt.
// Hop the camera over a grid around spawn so the fog reveals an area.
const pfad = await seite.evaluate(async () => {
  const { kamera, bauer } = window.dungeon2Vorschau;
  const s = bauer.spawnPunkt;
  const schritte = [];
  for (let dz = -24; dz <= 24; dz += 8) {
    for (let dx = -24; dx <= 24; dx += 8) schritte.push([s.x + dx, s.z + dz]);
  }
  for (const [x, z] of schritte) {
    kamera.position.set(x, s.y + 1.7, z);
    await new Promise((r) => setTimeout(r, 45));
  }
  // Zurück zum Spawn, Blick nach Norden für den Screenshot.
  kamera.position.set(s.x, s.y + 1.7, s.z);
  kamera.rotation.y = 0;
  await new Promise((r) => setTimeout(r, 300));
  return { spawn: { x: s.x, y: s.y, z: s.z }, felder: schritte.length };
});

mkdirSync(ORDNER, { recursive: true });
const datei = `${ORDNER}/dungeon2-minimap.png`;
await seite.screenshot({ path: datei });
await browser.close();
console.log(JSON.stringify({ datei, ...pfad }, null, 2));
