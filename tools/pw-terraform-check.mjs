/**
 * Etappe-1-Verifikation: gräbt per Debug-Taste und belegt die Höhenänderung
 * sowohl numerisch (heightmaps) als auch visuell (Screenshot vorher/nachher).
 *
 * Aufruf: node pw-terraform.mjs [url] [outdir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const url = process.argv[2] ?? 'http://localhost:5274/?offline=1&t=0.35';
const outDir = process.argv[3] ?? '/tmp/claude-0/-root-valheim-babylon/c908a284-e68f-40e4-9cf1-4e2877d70dbe/scratchpad';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// ?offline=1 überspringt den Connect-Screen und baut sofort eine lokale Welt.
await page.goto(url, { waitUntil: 'networkidle' });

// Terrain baut mit 2 Chunks/Frame unter SwiftShader — großzügig warten.
await page.waitForFunction(() => window.__dbg?.world != null, { timeout: 120000 });
await page.waitForFunction(() => window.__dbg?.terrain?.ready === true, { timeout: 180000 })
  .catch(() => console.log('WARN: terrain.ready nicht erreicht, mache trotzdem weiter'));
await page.waitForTimeout(2000);

const sample = () => page.evaluate(() => {
  const d = window.__dbg;
  const p = d.player.position;
  // Höhe im Zentrum und 4 m daneben (außerhalb des 1,5-m-Radius).
  return {
    x: p.x, z: p.z, playerY: p.y,
    hCenter: d.world.getGroundHeight(p.x, p.z),
    hOutside: d.world.getGroundHeight(p.x + 4, p.z),
    chunks: d.terrain.chunkCount,
  };
});

const before = await sample();
await page.screenshot({ path: `${outDir}/terraform-before.png`, timeout: 120000 });

// 10× graben. Jeder Schlag ist ein Level auf (Bodenhöhe − 0,5 m), der Spieler
// sinkt also mit — nach 10 Schlägen muss die ±8-m-Grenze greifen.
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(600);

const after = await sample();
await page.screenshot({ path: `${outDir}/terraform-after.png`, timeout: 120000 });

// Und wieder aufschütten, um die Gegenrichtung zu prüfen.
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(600);
const raised = await sample();
await page.screenshot({ path: `${outDir}/terraform-raised.png`, timeout: 120000 });

console.log('vorher :', JSON.stringify(before));
console.log('gegraben:', JSON.stringify(after));
console.log('erhöht :', JSON.stringify(raised));
console.log('');
console.log('Δ Zentrum graben :', (after.hCenter - before.hCenter).toFixed(3), 'm');
console.log('Δ außen  graben :', (after.hOutside - before.hOutside).toFixed(3), 'm  (muss 0 sein)');
console.log('Δ Zentrum heben :', (raised.hCenter - after.hCenter).toFixed(3), 'm');

if (errors.length) {
  console.log('--- console ---');
  for (const e of errors.slice(0, 15)) console.log(e);
} else {
  console.log('keine Konsolenfehler');
}
await browser.close();
