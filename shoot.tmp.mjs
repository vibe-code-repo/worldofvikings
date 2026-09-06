import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const OUT = '/tmp/claude-1000/-home-mike-Nextcloud-Brain/5dce12bd-e4e0-4e71-9dc9-84a7765b63b4/scratchpad/shots';
const GAME = 'http://localhost:5373';
const shots = JSON.parse(process.argv[2]);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  const t = m.text();
  if (/error|warn|fail|WebGL|shader/i.test(t)) console.log('  [console]', t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));

for (const shot of shots) {
  await page.goto(`${GAME}${shot.query}`);
  await page.waitForFunction(() => window.__wov?.terrainBounds !== null, null, { timeout: 180_000 });
  // Wait until the frame counter has climbed well past the world's arrival, so
  // textures are uploaded and the shadow map has been drawn a few times.
  const start = await page.evaluate(() => window.__wov.frameId);
  await page.waitForFunction((from) => window.__wov.frameId > from + 240, start, { timeout: 180_000 });
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  const info = await page.evaluate(() => ({
    triangles: window.__wov.render.triangles,
    drawCalls: window.__wov.render.drawCalls,
    frameTimeMs: window.__wov.render.frameTimeMs,
    frames: window.__wov.render.frames,
    camera: window.__wov.camera,
    backend: window.__wov.backend,
  }));
  console.log(shot.name, JSON.stringify(info));
}
await browser.close();
