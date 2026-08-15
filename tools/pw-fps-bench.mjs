/**
 * fps-Benchmark: misst, was ein Spieler beim Sprinten durch die Welt spuert.
 *
 * WARUM HEADED: Die frueheren Messungen liefen in einer unsichtbaren
 * Browser-Pane. Chrome pausiert `requestAnimationFrame` fuer unsichtbare
 * Tabs — Babylons Game-Loop rendert dann keinen einzigen Frame, und ohne
 * echte GPU sind absolute Millisekunden ohnehin nicht auf Spieler-Hardware
 * uebertragbar. Dieses Skript startet deshalb ein SICHTBARES Fenster auf
 * DISPLAY=:0 und prueft die GPU, bevor es misst. Bricht ab, wenn nur ein
 * Software-Renderer da ist — eine Messung auf SwiftShader waere wertlos.
 *
 * WARUM PERZENTILE STATT MITTELWERT: Der Nutzer meldet Framedrops, keine
 * niedrige Durchschnitts-fps. Im Bestand steht dazu schon die Beobachtung
 * "Median 17,1 ms (60 fps), aber 30 % der Frames ueber 25 ms" — der
 * Mittelwert verschweigt genau das, worueber sich jemand beschwert.
 * Gemessen werden deshalb p50/p95/p99, das Maximum und die Zahl der
 * Frames ueber 16,7 / 33 / 50 ms.
 *
 * Die Aufschluesselung nach Teilsystem kommt aus `__vb.profil()`, das der
 * Client schon mitbringt (Summe UND Maximum je Abschnitt).
 *
 * Aufruf:
 *   node tools/pw-fps-bench.mjs --url http://localhost:5280 --label baseline
 *   node tools/pw-fps-bench.mjs --url ... --sekunden 30 --out mess/x.json
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const URL_ZIEL = arg('url', 'http://localhost:5280');
const LABEL = arg('label', 'unbenannt');
const SEKUNDEN = Number(arg('sekunden', 20));
const AUFWAERMEN = Number(arg('aufwaermen', 8));
const OUT = arg('out', `mess/${LABEL}.json`);
/**
 * Fester Messort. Dieselbe Stelle wie in der Framedrop-Untersuchung:
 * dicht bewachsener Wald/Wiese (Rock_4, Beech1, Bush01) in der bau-Welt.
 * Ein fester Ort ist Bedingung fuer Vergleichbarkeit — an einer leeren
 * Kueste misst jeder Fix eine Verbesserung, die es nicht gibt.
 */
const START_X = Number(arg('x', -16900));
const START_Z = Number(arg('z', -5350));
/** Laufrichtung in Radiant. 0 = nach Norden; die Strecke bleibt so gleich. */
const YAW = Number(arg('yaw', 0));

const browser = await chromium.launch({
  headless: false,
  args: [
    // Ohne echte Hardwarebeschleunigung ist die Messung wertlos.
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    // vsync deckelt sonst bei 60 fps und verschluckt genau die Spitzen,
    // die uns interessieren.
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const konsole = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') konsole.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
});
const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message.slice(0, 300)));

console.log(`[bench] ${LABEL} -> ${URL_ZIEL}`);
await page.goto(URL_ZIEL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// ── GPU pruefen, bevor irgendetwas gemessen wird ──────────────────────
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  if (!gl) return { renderer: null, vendor: null };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  };
});
console.log(`[bench] GPU: ${gpu.vendor} / ${gpu.renderer}`);
if (!gpu.renderer || /swiftshader|llvmpipe|software/i.test(gpu.renderer)) {
  console.error('[bench] ABBRUCH: Kein Hardware-Renderer. Messung waere nicht aussagekraeftig.');
  await browser.close();
  process.exit(2);
}

// ── Warten, bis die Welt wirklich steht ───────────────────────────────
// Nicht nur auf __vb warten: Das Handle existiert, bevor Gelaende und
// Instanzen gebaut sind. Gemessen wird erst, wenn der Spieler existiert.
try {
  await page.waitForFunction(
    () => {
      const vb = window.__vb;
      const dbg = window.__dbg;
      return Boolean(vb?.profil && dbg?.player && dbg?.scene?.activeCamera);
    },
    { timeout: 180_000 }
  );
} catch {
  console.error('[bench] ABBRUCH: Welt kam nicht hoch. Konsole:');
  for (const z of konsole.slice(0, 20)) console.error('  ' + z);
  for (const z of seitenfehler.slice(0, 10)) console.error('  [pageerror] ' + z);
  await browser.close();
  process.exit(3);
}
console.log('[bench] Welt steht.');

// Fenster fokussieren, sonst kommen die Tastaturereignisse nicht an.
await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

// An den festen Messort setzen und dem Gelaende Zeit geben, nachzuladen.
await page.evaluate(([x, z, yaw]) => window.__vb.teleport(x, z, yaw), [START_X, START_Z, YAW]);
console.log(`[bench] Messort ${START_X}/${START_Z}, aufwaermen ${AUFWAERMEN}s ...`);
await page.waitForTimeout(AUFWAERMEN * 1000);

// ── Frame-Rekorder ────────────────────────────────────────────────────
await page.evaluate(() => {
  const s = { zeiten: [], laeuft: true, letzte: performance.now() };
  window.__bench = s;
  const tick = () => {
    if (!s.laeuft) return;
    const jetzt = performance.now();
    s.zeiten.push(jetzt - s.letzte);
    s.letzte = jetzt;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Zaehler im Client zuruecksetzen: profil() liest UND leert.
await page.evaluate(() => window.__vb.profil());

// ── Sprint ────────────────────────────────────────────────────────────
console.log(`[bench] Sprint ${SEKUNDEN}s ...`);
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
await page.waitForTimeout(SEKUNDEN * 1000);
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');

const roh = await page.evaluate(() => {
  window.__bench.laeuft = false;
  return { zeiten: window.__bench.zeiten, profil: window.__vb.profil() };
});

const endPos = await page.evaluate(() => {
  const p = window.__dbg?.player?.position;
  return p ? { x: p.x, y: p.y, z: p.z } : null;
});

await browser.close();

// ── Auswertung ────────────────────────────────────────────────────────
// Die ersten drei Frames verwerfen: Der erste Abstand enthaelt die Zeit
// seit dem Aufsetzen des Rekorders, nicht die eines echten Frames.
const t = roh.zeiten.slice(3).sort((a, b) => a - b);
if (t.length < 30) {
  console.error(`[bench] ABBRUCH: nur ${t.length} Frames aufgezeichnet.`);
  process.exit(4);
}
const p = (q) => t[Math.min(t.length - 1, Math.floor(t.length * q))];
const summe = t.reduce((a, b) => a + b, 0);
const ueber = (ms) => t.filter((x) => x > ms).length;

const ergebnis = {
  label: LABEL,
  url: URL_ZIEL,
  gpu,
  messort: { x: START_X, z: START_Z, yaw: YAW },
  endPosition: endPos,
  sekunden: SEKUNDEN,
  frames: t.length,
  fps: {
    mittel: Number((1000 / (summe / t.length)).toFixed(2)),
    // Aus dem Frame-Zeit-Median, nicht aus dem Mittelwert der fps —
    // der Kehrwert eines Mittelwerts ist nicht der Mittelwert der Kehrwerte.
    median: Number((1000 / p(0.5)).toFixed(2)),
    // Das "gefuehlte Minimum": langsamstes Prozent.
    p1_low: Number((1000 / p(0.99)).toFixed(2)),
  },
  frameZeitMs: {
    p50: Number(p(0.5).toFixed(2)),
    p95: Number(p(0.95).toFixed(2)),
    p99: Number(p(0.99).toFixed(2)),
    max: Number(t[t.length - 1].toFixed(2)),
  },
  ausreisser: {
    ueber16_7ms: ueber(16.7),
    ueber33ms: ueber(33),
    ueber50ms: ueber(50),
    anteilUeber33: Number(((ueber(33) / t.length) * 100).toFixed(2)),
  },
  teilsysteme: roh.profil,
  konsolenfehler: konsole.slice(0, 30),
  seitenfehler: seitenfehler.slice(0, 10),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(ergebnis, null, 2));

console.log('');
console.log(`  fps mittel/median/1%low : ${ergebnis.fps.mittel} / ${ergebnis.fps.median} / ${ergebnis.fps.p1_low}`);
console.log(`  Frame-Zeit p50/p95/p99  : ${ergebnis.frameZeitMs.p50} / ${ergebnis.frameZeitMs.p95} / ${ergebnis.frameZeitMs.p99} ms`);
console.log(`  Maximum                 : ${ergebnis.frameZeitMs.max} ms`);
console.log(`  Frames >33ms            : ${ergebnis.ausreisser.ueber33ms} von ${t.length} (${ergebnis.ausreisser.anteilUeber33} %)`);
console.log(`  Draw Calls / akt. Meshes: ${roh.profil.zeichenaufrufe} / ${roh.profil.aktiveMeshes}`);
console.log(`  -> ${OUT}`);
