/**
 * Grafik-Regressionsmessung: die Kennzahlen, mit denen
 * Docs/07-Grafik-Konzept.md argumentiert, aus der laufenden Szene.
 *
 * Aufruf:
 *   node tools/pw-grafik-messung.mjs [bild.png] [tagesfraktion]
 *
 * ── Warum nicht `page.screenshot()` ──────────────────────────────────
 * Headless läuft die Szene unter SwiftShader mit rund 1 fps. Playwrights
 * Screenshot-Pfad läuft dabei zuverlässig ins Timeout (gemessen: 180 s
 * reichen nicht), und selbst wenn er durchkommt, liegt der Ladebildschirm
 * als DOM-Overlay über dem Bild — die erste Fassung dieses Skripts hat
 * dessen Farbverlauf statt der Wiese gemessen.
 *
 * Stattdessen wird der WebGL-Framebuffer direkt über `engine.readPixels()`
 * gelesen — dasselbe Vorgehen wie in `pw-sky-verify.mjs` ("messen statt
 * schauen"). Das ist um Größenordnungen schneller, und DOM-Overlays sind
 * dabei per Konstruktion unsichtbar.
 *
 * Zwei Fallstricke von `readPixels`, beide unten behandelt:
 *  · Die Zeilen laufen BOTTOM-UP. Ein Bildausschnitt, der in
 *    Bildschirmkoordinaten von oben gezählt wird, muss gespiegelt werden.
 *  · Ohne `preserveDrawingBuffer` ist der Puffer nur unmittelbar nach dem
 *    Zeichnen gültig — der Aufruf hängt deshalb in
 *    `onAfterRenderObservable`.
 *
 * Feste Rahmenbedingungen, damit zwei Läufe vergleichbar sind: derselbe
 * Seed (`?offline=1`), dieselbe Tageszeit (Standard 0.5 = Mittag),
 * dieselbe Auflösung, derselbe Ausschnitt.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const out = process.argv[2] ?? 'out/grafik-messung.png';
const t = process.argv[3] ?? '0.5';
const url = `http://localhost:5273/?offline=1&t=${t}`;

/** Bildausschnitt für die Bodenmessung, in BILDSCHIRM-Koordinaten. */
const BODEN = { x0: 300, y0: 700, x1: 1600, y1: 950 };
const VIEWPORT = { width: 1906, height: 994 };

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: VIEWPORT });

const shaderFehler = [];
const sonstige = [];
page.on('console', (m) => {
  const txt = m.text();
  // Der eine Fehler, der bei Schatten-Arbeiten zählt: schlägt die
  // Übersetzung des Terrain-Materials fehl, verliert der Boden seine
  // Textur und jede Farbmessung darunter ist wertlos.
  if (/SHADER ERROR|no matching overloaded/i.test(txt)) shaderFehler.push(txt);
  else if (m.type() === 'error') sonstige.push(txt);
});
page.on('pageerror', (e) => sonstige.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__dbg?.world != null, { timeout: 120000 });

// Zustandsbasiert warten und den Fortschritt melden, damit ein hängender
// Lauf erkennbar ist statt stumm ins Timeout zu laufen.
let letzter = -1;
for (let i = 0; i < 60; i++) {
  const p = await page.evaluate(() => ({
    fertig: (window.__dbg?.terrain?.loadProgress ?? 0) >= 1,
    fortschritt: window.__dbg?.terrain?.loadProgress ?? 0,
  }));
  if (p.fertig) break;
  const proz = Math.round(p.fortschritt * 100);
  if (proz !== letzter) { console.log(`  Gelände ${proz} %`); letzter = proz; }
  await page.waitForTimeout(5000);
}
// Clutter und die lazy geladenen Prefab-GLBs haben keinen abfragbaren
// Zustand — dafür die einzige feste Pause im Ablauf.
await page.waitForTimeout(15000);

const ergebnis = await page.evaluate(
  async ({ boden, viewport }) => {
    const d = window.__dbg;
    const engine = d.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();

    // readPixels ist nur direkt nach dem Zeichnen gültig.
    const roh = await new Promise((fertig) => {
      const obs = d.scene.onAfterRenderObservable.add(async () => {
        d.scene.onAfterRenderObservable.remove(obs);
        fertig(await engine.readPixels(0, 0, w, h));
      });
    });

    // Bildschirm- in readPixels-Koordinaten (bottom-up) umrechnen und auf
    // die tatsächliche Renderauflösung skalieren.
    const sx = w / viewport.width;
    const sy = h / viewport.height;
    const x0 = Math.round(boden.x0 * sx);
    const x1 = Math.round(boden.x1 * sx);
    const yTop = Math.round(boden.y0 * sy);
    const yBot = Math.round(boden.y1 * sy);
    const ry0 = h - yBot;
    const ry1 = h - yTop;

    let sr = 0, sg = 0, sb = 0, sSat = 0, sL = 0, sL2 = 0, hell = 0, n = 0;
    const hist = new Uint32Array(256);
    for (let y = ry0; y < ry1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        const r = roh[o], g = roh[o + 1], b = roh[o + 2];
        sr += r; sg += g; sb += b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 0) sSat += (mx - mn) / mx;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sL += l; sL2 += l * l;
        if (l > 128) hell++;
        hist[Math.min(255, Math.round(l))]++;
        n++;
      }
    }
    const mL = sL / n;
    let ent = 0;
    for (const c of hist) if (c > 0) { const p = c / n; ent -= p * Math.log2(p); }

    // Vollbild für den Augenschein: Pixel gespiegelt in ein 2D-Canvas,
    // dann als PNG. Umgeht page.screenshot() vollständig.
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(roh.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);

    const sg2 = d.shadows;
    return {
      png: cv.toDataURL('image/png'),
      messung: {
        r: sr / n, g: sg / n, b: sb / n,
        sat: (sSat / n) * 100,
        lum: mL, sd: Math.sqrt(Math.max(sL2 / n - mL * mL, 0)),
        ent, hell: (hell / n) * 100, n,
      },
      zustand: {
        renderGroesse: `${w}x${h}`,
        chunks: d.terrain?.chunkCount ?? -1,
        ready: d.terrain?.ready === true,
        schatten: sg2?.info ?? '(kein Shadows-Objekt)',
        env: d.lighting?.environmentName ?? '?',
        terrainEmpfaengt: d.scene.meshes
          .filter((m) => m.name.startsWith('terrain'))
          .every((m) => m.receiveShadows === true),
        grasMeshes: d.scene.meshes.filter((m) => m.name.startsWith('clutter')).length,
        grasEmpfaengt: d.scene.meshes
          .filter((m) => m.name.startsWith('clutter'))
          .every((m) => m.receiveShadows === true),
      },
    };
  },
  { boden: BODEN, viewport: VIEWPORT }
);

await browser.close();

writeFileSync(out, Buffer.from(ergebnis.png.split(',')[1], 'base64'));

const z = ergebnis.zustand;
const m = ergebnis.messung;
const f = (v, k = 1) => v.toFixed(k).padStart(5);
console.log(`\nBILD ${out}  (${z.renderGroesse})`);
console.log(`  chunks ${z.chunks}  ready ${z.ready}  env ${z.env}`);
console.log(`  schatten: ${z.schatten}`);
console.log(`  terrain empfängt: ${z.terrainEmpfaengt}   gras empfängt: ${z.grasEmpfaengt} (${z.grasMeshes} Meshes)`);
console.log(`  Shader: ${shaderFehler.length ? '⚠ FEHLER' : 'fehlerfrei übersetzt'}`);
for (const e of shaderFehler.slice(0, 3)) console.log('   ', e.slice(0, 200));

console.log(`\nBoden [${BODEN.x0} ${BODEN.y0} ${BODEN.x1} ${BODEN.y1}] (${m.n} px)`);
console.log(`  RGB      ${f(m.r)} ${f(m.g)} ${f(m.b)}`);
console.log(`  Sättigung${f(m.sat)} %`);
console.log(`  Luminanz ${f(m.lum)}   Streuung sd ${f(m.sd)}`);
console.log(`  Entropie ${f(m.ent, 2)} bit   über 128: ${f(m.hell)} %`);
if (sonstige.length) console.log(`\n  ${sonstige.length} sonstige Konsolenfehler`);
