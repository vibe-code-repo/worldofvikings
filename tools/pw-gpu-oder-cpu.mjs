/**
 * Die entscheidende Frage mit einem Experiment statt mit einem Zaehler:
 * Ist das Spiel GPU- oder CPU-gebunden?
 *
 * VERFAHREN: Dieselbe Szene wird mehrfach gemessen, nur mit
 * unterschiedlicher Renderaufloesung (`engine.setHardwareScalingLevel`).
 * Stufe 4 bedeutet ein Viertel der Kantenlaenge, also **ein Sechzehntel
 * der Bildpunkte** — und damit ungefaehr ein Sechzehntel der
 * Fragment-Shader-Arbeit.
 *
 * Die Auswertung ist einfach:
 *   - Werden die Frames bei Stufe 4 deutlich schneller  -> GPU-gebunden.
 *   - Aendert sich praktisch nichts                     -> CPU-gebunden.
 *
 * Das braucht keine EXT_disjoint_timer_query-Erweiterung (die Chrome aus
 * Sicherheitsgruenden abschaltet) und keine Babylon-Interna. Es ist
 * dieselbe Logik, mit der man in jedem Spiel den Engpass bestimmt.
 *
 * Zusaetzlich wird die Gegenprobe gefahren: Aufloesung HOCH (Stufe 0,5,
 * also vierfache Bildpunktzahl). Steigt die Frame-Zeit dort stark, ist
 * doch GPU-Luft nach unten — bleibt sie flach, ist die GPU gelangweilt.
 *
 * Aufruf:
 *   node tools/pw-gpu-oder-cpu.mjs --url http://localhost:5280
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (n, s) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : s;
};
const URL_ZIEL = arg('url', 'http://localhost:5280');
const OUT = arg('out', 'mess/gpu-oder-cpu.json');
const PRO_STUFE = Number(arg('sekunden', 12));
const START_X = Number(arg('x', -16900));
const START_Z = Number(arg('z', -5350));

/** Kantenteiler. 0,5 = doppelte Kantenlaenge (4x Pixel), 4 = 1/16 Pixel. */
const STUFEN = [0.5, 1, 2, 4];

const browser = await chromium.launch({
  headless: false,
  args: ['--ozone-platform=x11', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto(URL_ZIEL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('#connect-btn', { timeout: 30_000 });
await page.fill('#player-name', 'SkalenBot');
await page.uncheck('#offline-toggle').catch(() => {});
await page.click('#connect-btn');
await page.waitForFunction(() => Boolean(window.__vb?.profil && window.__dbg?.player), { timeout: 180_000 });
await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

const tpOk = await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [START_X, START_Z]);
if (!tpOk) {
  console.error('[skala] ABBRUCH: Admin-Teleport abgelehnt.');
  await browser.close();
  process.exit(5);
}
await page.waitForTimeout(9000);
const abstand = await page.evaluate(([x, z]) => {
  const p = window.__dbg.player.position;
  return Math.hypot(p.x - x, p.z - z);
}, [START_X, START_Z]);
if (abstand > 150) {
  console.error(`[skala] ABBRUCH: ${abstand.toFixed(0)} m vom Messort entfernt.`);
  await browser.close();
  process.exit(6);
}

const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const e = gl?.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?';
});
console.log(`[skala] GPU: ${gpu}`);
console.log(`[skala] am Messort. Je Stufe ${PRO_STUFE}s, im Stehen gemessen (kein Terrain-Nachladen).`);

const ergebnisse = [];
for (const stufe of STUFEN) {
  await page.evaluate((s) => {
    const e = window.__dbg.scene.getEngine();
    e.setHardwareScalingLevel(s);
  }, stufe);
  // Kurz setzen lassen, dann erst messen.
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const s = { zeiten: [], laeuft: true, letzte: performance.now() };
    window.__skala = s;
    const tick = () => {
      if (!s.laeuft) return;
      const j = performance.now();
      s.zeiten.push(j - s.letzte);
      s.letzte = j;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(PRO_STUFE * 1000);
  const roh = await page.evaluate(() => {
    window.__skala.laeuft = false;
    const e = window.__dbg.scene.getEngine();
    return {
      zeiten: window.__skala.zeiten,
      breite: e.getRenderWidth(),
      hoehe: e.getRenderHeight(),
    };
  });

  const t = roh.zeiten.slice(3).sort((a, b) => a - b);
  const p = (q) => t[Math.min(t.length - 1, Math.floor(t.length * q))];
  const mittel = t.reduce((a, b) => a + b, 0) / t.length;
  const r = {
    stufe,
    aufloesung: `${roh.breite}x${roh.hoehe}`,
    bildpunkte: roh.breite * roh.hoehe,
    frames: t.length,
    fpsMedian: +(1000 / p(0.5)).toFixed(1),
    fpsMittel: +(1000 / mittel).toFixed(1),
    p50: +p(0.5).toFixed(2),
    p95: +p(0.95).toFixed(2),
    p99: +p(0.99).toFixed(2),
  };
  ergebnisse.push(r);
  console.log(
    `  Stufe ${String(stufe).padEnd(4)} ${r.aufloesung.padEnd(10)} ` +
      `${String(Math.round(r.bildpunkte / 1000)).padStart(5)} kPixel  ` +
      `fps-Median ${String(r.fpsMedian).padStart(6)}  p50 ${String(r.p50).padStart(5)} ms  p99 ${String(r.p99).padStart(6)} ms`
  );
}

await browser.close();

// ── Auswertung ────────────────────────────────────────────────────────
const hoch = ergebnisse.find((r) => r.stufe === 0.5);
const normal = ergebnisse.find((r) => r.stufe === 1);
const niedrig = ergebnisse.find((r) => r.stufe === 4);

const gewinnRunter = niedrig && normal ? (normal.p50 - niedrig.p50) / normal.p50 : null;
const verlustHoch = hoch && normal ? (hoch.p50 - normal.p50) / normal.p50 : null;

let urteil;
if (gewinnRunter === null) urteil = 'unbestimmt';
else if (gewinnRunter > 0.4) urteil = 'GPU-gebunden';
else if (gewinnRunter < 0.15) urteil = 'CPU-gebunden';
else urteil = 'gemischt';

console.log('');
console.log('── Auswertung ────────────────────────────────────');
console.log(`  Bildpunkte 1/16 (Stufe 4): Frame-Zeit ${gewinnRunter !== null ? (gewinnRunter * 100).toFixed(0) + ' % schneller' : '—'}`);
console.log(`  Bildpunkte 4x  (Stufe 0,5): Frame-Zeit ${verlustHoch !== null ? (verlustHoch * 100).toFixed(0) + ' % langsamer' : '—'}`);
console.log(`  URTEIL: ${urteil}`);
console.log('');
console.log('  Lesart: Waere die GPU der Engpass, muesste ein Sechzehntel der');
console.log('  Bildpunkte die Frame-Zeit drastisch senken. Tut es das nicht,');
console.log('  wartet die GPU auf die CPU — und mehr auf die GPU zu schieben,');
console.log('  hilft dann nichts.');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ gpu, urteil, gewinnRunter, verlustHoch, stufen: ergebnisse }, null, 2));
console.log(`  -> ${OUT}`);
