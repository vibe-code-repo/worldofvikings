/**
 * Flimmern der Schatten messen statt es zu beschreiben.
 *
 * ── Zwei Anläufe, und warum der erste nichts taugte ──────────────────
 * Gemeldet wurde: die Schatten flackern — bei der Spielfigur wie bei der
 * Vegetation, und im Laub sieht es aus, als flimmere es innerhalb der
 * Baumtextur.
 *
 * Der erste Entwurf zählte, wie viele Bildpunkte sich von einem Bild zum
 * nächsten ÄNDERN. Das war unbrauchbar, aus zwei Gründen:
 *
 *  1. **Es misst überwiegend legitime Bewegung.** Ein Grashalm, der sich
 *     im Wind neigt, ändert seine Bildpunkte — das ist kein Artefakt. Der
 *     gesuchte Effekt ging darin unter; die Unterschiede zwischen den
 *     Zuständen lagen im Zehntelbereich.
 *  2. **Die Windstärke schwankt über den Lauf.** Das Wettersystem ändert
 *     Richtung und Böigkeit fortlaufend; nacheinander gemessene Zustände
 *     sehen also verschiedenen Wind. Derselbe Zustand kam über drei
 *     Sitzungen auf 4,51 / 2,23 / 1,55 %.
 *
 * Beides ist hier behoben:
 *
 *  · **Der Wind wird eingefroren** (`EnvMan.SetDebugWind` über
 *    `__vb.setWind`), Richtung und Böigkeit fest, nach JEDEM
 *    Zustandswechsel neu gesetzt. Erst damit sind zwei Zustände
 *    vergleichbar.
 *  · **Gemessen wird ZAPPELN, nicht Änderung.** Je Bildpunkt wird das
 *    Vorzeichen der Helligkeitsänderung von Bild zu Bild verfolgt. Eine
 *    sich neigende Blattkante wird über mehrere Bilder monoton heller
 *    oder dunkler — das Vorzeichen bleibt. Flimmern springt hin und her.
 *    Gezählt wird der Anteil der Bildpunkte, deren Vorzeichen in
 *    mindestens `--quote` der Schritte wechselt.
 *
 * Das ist der Unterschied zwischen „hier bewegt sich etwas" und „hier
 * kann sich das Bild nicht entscheiden".
 *
 * Aufruf:
 *   node tools/pw-schatten-flimmern.mjs --url http://localhost:5275
 *   node tools/pw-schatten-flimmern.mjs --bilder 120 --runden 3
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};

const URL_ZIEL = arg('url', 'http://localhost:5275');
const OUT = arg('out', 'mess/schatten-flimmern.json');
const BILDER = Number(arg('bilder', 100));
const RUNDEN = Number(arg('runden', 2));
const START_X = Number(arg('x', -16900));
const START_Z = Number(arg('z', -5350));
const SPIELER = arg('spieler', 'FlimmerBot');
/** Helligkeitsschwelle (Summe über RGB, 0..765), ab der ein Schritt zählt. */
const SCHWELLE = Number(arg('schwelle', 9));
/** Ab welchem Anteil gewechselter Vorzeichen ein Bildpunkt als zappelnd gilt. */
const ZAPPEL_QUOTE = Number(arg('quote', 0.35));
/** Fester Wind: Richtung in Grad, Böigkeit 0..1. */
const WIND_GRAD = Number(arg('windgrad', 135));
const WIND_STAERKE = Number(arg('windstaerke', 0.8));

const browser = await chromium.launch({
  headless: false,
  args: ['--ozone-platform=x11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
         '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message.slice(0, 300)));

await page.goto(`${URL_ZIEL}/?t=0.35`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl?.getParameter(gl.RENDERER) ?? null);
});
console.log(`[flimmern] GPU: ${gpu}`);
if (!gpu || /swiftshader|llvmpipe|software/i.test(gpu)) {
  console.error('[flimmern] ABBRUCH: Kein Hardware-Renderer.');
  await browser.close();
  process.exit(2);
}

await page.waitForSelector('#connect-btn', { timeout: 30_000 });
await page.fill('#player-name', SPIELER);
await page.uncheck('#offline-toggle').catch(() => {});
await page.click('#connect-btn');
try {
  await page.waitForFunction(
    () => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.scene?.activeCamera),
    { timeout: 180_000 }
  );
} catch {
  console.error('[flimmern] ABBRUCH: Welt kam nicht hoch.');
  for (const z of seitenfehler.slice(0, 8)) console.error('  ' + z);
  await browser.close();
  process.exit(3);
}
await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});
await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [START_X, START_Z]);
await page.waitForTimeout(13_000);

await page.evaluate(() => {
  const scene = window.__dbg.scene;
  const generator = () => {
    for (const l of scene.lights) {
      const g = l.getShadowGenerator?.();
      if (g) return g;
    }
    return null;
  };
  window.__flimmer = {
    generator,
    setzeRefresh(n) {
      const k = generator()?.getShadowMap?.();
      if (k) k.refreshRate = n;
    },
    schatten(an) { window.__dbg.shadows.setLevel(an ? 3 : 0); },
    sway(baum, gras) { return window.__vb.sway(baum, gras); },
    /**
     * Zappelmass. Streamt über `bilder` Bilder und hält je Bildpunkt nur
     * vier Zahlen — ein Stapel von hundert Vollbildern passt sonst nicht
     * in den Speicher der Seite.
     */
    async messen(bilder, schwelle, quote) {
      const engine = scene.getEngine();
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const naechstes = () =>
        new Promise((fertig) => {
          const obs = scene.onAfterRenderObservable.add(async () => {
            scene.onAfterRenderObservable.remove(obs);
            fertig(new Uint8Array(await engine.readPixels(0, 0, w, h)));
          });
        });
      const n = w * h;
      const letzteHelligkeit = new Float32Array(n);
      const letztesVorzeichen = new Int8Array(n);
      const wechsel = new Uint16Array(n);
      const schritte = new Uint16Array(n);
      let ersteRunde = true;
      for (let b = 0; b < bilder; b++) {
        const px = await naechstes();
        for (let i = 0, p = 0; i < n; i++, p += 4) {
          const hell = px[p] + px[p + 1] + px[p + 2];
          if (!ersteRunde) {
            const d = hell - letzteHelligkeit[i];
            if (Math.abs(d) > schwelle) {
              const vz = d > 0 ? 1 : -1;
              schritte[i]++;
              if (letztesVorzeichen[i] !== 0 && vz !== letztesVorzeichen[i]) wechsel[i]++;
              letztesVorzeichen[i] = vz;
            }
          }
          letzteHelligkeit[i] = hell;
        }
        ersteRunde = false;
      }
      let zappelnd = 0;
      let bewegt = 0;
      for (let i = 0; i < n; i++) {
        // Mindestens ein paar Schritte, sonst ist die Quote Zufall.
        if (schritte[i] < 6) continue;
        bewegt++;
        if (wechsel[i] / schritte[i] >= quote) zappelnd++;
      }
      return {
        bildpunkte: n,
        bewegtAnteil: bewegt / n,
        zappelAnteil: zappelnd / n,
        /** Wie viel der BEWEGUNG ist Zappeln? Das ist die eigentliche Frage. */
        zappelVonBewegt: bewegt > 0 ? zappelnd / bewegt : 0,
      };
    },
  };
});

const ZUSTAENDE = {
  schattenAus: () => page.evaluate(() => { window.__flimmer.schatten(false); window.__flimmer.sway(0.22, 3.0); }),
  basis: () => page.evaluate(() => { window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 3.0); }),
  windAus: () => page.evaluate(() => { window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0, 0); }),
  nurBaumwind: () => page.evaluate(() => { window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 0); }),
  nurBaumwindOhneSchatten: () => page.evaluate(() => { window.__flimmer.schatten(false); window.__flimmer.sway(0.22, 0); }),
  nurGraswind: () => page.evaluate(() => { window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0, 3.0); }),
  jedesBild: () => page.evaluate(() => { window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(1); window.__flimmer.sway(0.22, 3.0); }),

  // ── Woher kommt das Zappeln der Vegetation selbst? ─────────────────
  // Alle drei laufen mit NUR Baumwind, damit die Krone im Vordergrund
  // steht und das Gras die Zahl nicht überdeckt.

  // Der vom Nutzer beschriebene Fall: „der Schatten INNERHALB der
  // Baumtextur". Nimmt man dem Laub den Schattenempfang, verschwindet
  // genau dieser Anteil — der Wurf auf den Boden bleibt.
  baumOhneSchattenempfang: () => page.evaluate(() => {
    window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 0);
    for (const m of window.__dbg.scene.meshes) {
      if (/^(tree|leaves|busch|buschlaub)/i.test(m.name ?? '')) m.receiveShadows = false;
    }
  }),
  // Gegenprobe: Empfang wieder an.
  baumMitSchattenempfang: () => page.evaluate(() => {
    window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 0);
    for (const m of window.__dbg.scene.meshes) {
      if (/^(tree|leaves|busch|buschlaub)/i.test(m.name ?? '')) m.receiveShadows = true;
    }
  }),
  // Die letzte Hypothese: KANTENALIASING. Cutout-Laub hat keine
  // Teildeckung — ein Bildpunkt an einer Blattkante ist entweder Blatt
  // oder Hintergrund, und beim kleinsten Versatz kippt er ganz um. MSAA
  // hilft dagegen nicht (der `discard` verwirft den ganzen Bildpunkt,
  // nicht einzelne Abtastpunkte), Alpha-to-Coverage gibt es in Babylon
  // nur im WebGPU-Pfad. Was bleibt, ist mehr Abtastung: vierfache
  // Bildpunktzahl. Sinkt das Zappeln dadurch stark, ist es Aliasing.
  basisMitVierfachAbtastung: () => page.evaluate(() => {
    window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 3.0);
    window.__dbg.scene.getEngine().setHardwareScalingLevel(0.5);
  }),
  basisEinfachAbtastung: () => page.evaluate(() => {
    window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 3.0);
    window.__dbg.scene.getEngine().setHardwareScalingLevel(1.0);
  }),
  // Mipmaps sind der klassische Verdächtige bei Cutout-Laub: Mit der
  // Entfernung schrumpft die Deckung der Alphamaske, Karten lösen sich
  // auf und kommen zurück. Ohne Mips fällt dieser Mechanismus weg.
  baumOhneMips: () => page.evaluate(() => {
    window.__flimmer.schatten(true); window.__flimmer.setzeRefresh(2); window.__flimmer.sway(0.22, 0);
    for (const m of window.__dbg.scene.meshes) {
      if (/^(tree|leaves|busch|buschlaub)/i.test(m.name ?? '')) m.receiveShadows = true;
    }
    for (const mat of window.__dbg.scene.materials) {
      const t = mat.albedoTexture;
      if (t && mat.transparencyMode === 1) t.updateSamplingMode(2); // BILINEAR, ohne Mip
    }
  }),
};

const ergebnis = {};
for (const name of Object.keys(ZUSTAENDE)) ergebnis[name] = [];

for (let runde = 1; runde <= RUNDEN; runde++) {
  for (const [name, setzen] of Object.entries(ZUSTAENDE)) {
    await setzen();
    // Wind NACH jedem Zustandswechsel neu festnageln: setLevel() und
    // andere Eingriffe dürfen ihn nicht wieder freigeben.
    await page.evaluate(([g, s]) => window.__vb.setWind(g, s), [WIND_GRAD, WIND_STAERKE]);
    await page.waitForTimeout(1200);
    const m = await page.evaluate(
      ([b, s, q]) => window.__flimmer.messen(b, s, q),
      [BILDER, SCHWELLE, ZAPPEL_QUOTE]
    );
    ergebnis[name].push(m);
    console.log(
      `  Runde ${runde}  ${name.padEnd(24)} zappelnd ${(m.zappelAnteil * 100).toFixed(3).padStart(7)} %  ` +
        `bewegt ${(m.bewegtAnteil * 100).toFixed(2).padStart(6)} %  ` +
        `Zappelquote ${(m.zappelVonBewegt * 100).toFixed(1)} %`
    );
  }
}

await page.evaluate(() => {
  window.__flimmer.schatten(true);
  window.__flimmer.setzeRefresh(2);
  window.__flimmer.sway(0.22, 3.0);
  window.__vb.resetWind();
});

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const zus = {};
for (const [name, laeufe] of Object.entries(ergebnis)) {
  zus[name] = {
    zappelAnteil: +(median(laeufe.map((l) => l.zappelAnteil)) * 100).toFixed(4),
    bewegtAnteil: +(median(laeufe.map((l) => l.bewegtAnteil)) * 100).toFixed(3),
    zappelVonBewegt: +(median(laeufe.map((l) => l.zappelVonBewegt)) * 100).toFixed(2),
  };
}

console.log('\n── Zappelnde Bildpunkte in % des Bildes (Median der Runden) ──');
for (const [name, z] of Object.entries(zus)) {
  console.log(
    `  ${name.padEnd(24)} ${String(z.zappelAnteil).padStart(8)} %   ` +
      `(bewegt ${z.bewegtAnteil} %, davon zappelnd ${z.zappelVonBewegt} %)`
  );
}
const w = (n) => zus[n]?.zappelAnteil ?? NaN;
console.log('');
console.log(`  Schatten an/aus bei vollem Wind:   ${w('basis')} % gegen ${w('schattenAus')} %`);
console.log(`  Schatten an/aus bei nur BAUMwind:  ${w('nurBaumwind')} % gegen ${w('nurBaumwindOhneSchatten')} %`);
console.log(`  Wind ganz aus (Schatten an):       ${w('windAus')} %`);
console.log(`  refreshRate 1 statt 2:             ${w('jedesBild')} %`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    { gpu, bilder: BILDER, runden: RUNDEN, schwelle: SCHWELLE, quote: ZAPPEL_QUOTE,
      wind: { grad: WIND_GRAD, staerke: WIND_STAERKE }, zusammenfassung: zus, laeufe: ergebnis, seitenfehler },
    null, 2
  )
);
console.log(`\n[flimmern] geschrieben: ${OUT}`);

await browser.close();
