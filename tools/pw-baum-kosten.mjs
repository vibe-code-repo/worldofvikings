/**
 * Was kostet der Wald wirklich? Die Vorfrage zu E10 (Baum-LOD).
 *
 * ── Warum dieses Werkzeug vor der Umsetzung kommt ────────────────────
 * E10 ist als L-Arbeit ueber zwei Systeme beziffert: Dezimierung in
 * `tools/baum-generieren.py` UND Entfernungsklassen mit je eigenem Master
 * im `EntityManager`. Begruendet ist sie mit einer Zaehlung: Baeume sind
 * 64,8 % aller Dreiecke (5,37 Mio. bei 7.952 Instanzen).
 *
 * Dagegen steht eine MESSUNG aus D10, die im Kopf von
 * `AssetManager.verschmelzeNachMaterial()` protokolliert ist:
 *
 *   alle Master, alle Instanzen              11,5 ms/Bild
 *   Instanzen auf 1, Zeichenaufrufe bleiben  12,4 ms/Bild   (unveraendert)
 *   Master ganz aus                           6,0 ms/Bild   (-5,6 ms)
 *
 * Wenn das weiterhin gilt, kostet GEOMETRIE hier nichts und die
 * ZEICHENAUFRUFE alles — und dann ist E10 in seiner geplanten Form ein
 * Minusgeschaeft: Entfernungsklassen VERDREIFACHEN die Zahl der
 * Baum-Master, um Dreiecke zu sparen, die niemand bezahlt.
 *
 * Docs/07-Grafik-Konzept.md sagt zu Stufe 9 selbst: "Vor dem Bau der
 * LOD-Kette gehoert deshalb erst gemessen, ob sie noch noetig ist."
 * Genau das tut diese Datei.
 *
 * ── Die vier Zustaende ───────────────────────────────────────────────
 *   basis        unveraendert
 *   ohneGeo      Baum-Master auf thinInstanceCount = 1
 *                -> Zeichenaufrufe bleiben, die Dreiecke fallen weg.
 *                   Die OBERGRENZE dessen, was Dezimierung je bringen kann.
 *   ohneMaster   Baum-Master abgeschaltet
 *                -> Zeichenaufrufe UND Dreiecke weg. Der Gesamtposten Wald.
 *   dreiStufen   jeder Baum-Master dreifach, Instanzen nach Entfernung
 *                aufgeteilt, GEOMETRIE UNVERAENDERT
 *                -> der Preis der zweiten Haelfte von E10, isoliert.
 *
 * Daraus die Rechnung, um die es geht:
 *   Gewinn durch Dezimierung  <=  (basis - ohneGeo) * Dreiecksanteil
 *   Preis der Aufteilung       =  (dreiStufen - basis)
 * Ist der Preis groesser als der halbe Gewinn, traegt E10 sich nicht.
 *
 * ── Warum im Stand und im Ringtausch ─────────────────────────────────
 * Gemessen wird der stationaere Bildaufwand, nicht die Ruckler beim
 * Zonenbau — dafuer gibt es pw-fps-bench.mjs. Im Stand faellt der
 * Chunk-Bau als Stoergroesse weg, und die Zustaende sind vergleichbar.
 * Jeder Zustand wird MEHRFACH und abwechselnd gemessen (A,B,C,D,A,B,...),
 * weil die Grundlast zwischen Sitzungen und ueber die Zeit erheblich
 * schwankt (siehe die 10,7 gegen 7,3 ms im AssetManager-Kopf). Verglichen
 * wird der Median der Runden, nicht ein Einzellauf.
 *
 * Aufruf:
 *   node tools/pw-baum-kosten.mjs --url http://localhost:5275
 *   node tools/pw-baum-kosten.mjs --runden 4 --sekunden 6
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};

const URL_ZIEL = arg('url', 'http://localhost:5275');
const OUT = arg('out', 'mess/baum-kosten.json');
const RUNDEN = Number(arg('runden', 3));
const SEKUNDEN = Number(arg('sekunden', 6));
const AUFWAERMEN = Number(arg('aufwaermen', 10));
/** Derselbe Messort wie pw-fps-bench.mjs — dichter Bewuchs, vergleichbar. */
const START_X = Number(arg('x', -16900));
const START_Z = Number(arg('z', -5350));
const SPIELER = arg('spieler', 'BaumBot');

/**
 * Woran ein Baum-Master erkannt wird.
 *
 * Die Master tragen den Namen ihres Submeshes aus der GLB (siehe die
 * Diagnose-Aufschluesselung in main.ts): unsere erzeugten Baeume fuehren
 * genau zwei, `tree` (Stamm und Aeste) und `leaves` (Laubkarten) — so
 * heissen Saplings Objekte. MergeMeshes haengt beim Verschmelzen ein
 * Suffix an, deshalb Praefix statt Gleichheit.
 */
const BAUM_MASTER = '^(tree|leaves)';

const browser = await chromium.launch({
  headless: false,
  args: [
    '--ozone-platform=x11',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message.slice(0, 300)));

await page.goto(URL_ZIEL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

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
console.log(`[baum] GPU: ${gpu.vendor} / ${gpu.renderer}`);
if (!gpu.renderer || /swiftshader|llvmpipe|software/i.test(gpu.renderer)) {
  console.error('[baum] ABBRUCH: Kein Hardware-Renderer. Eine Dreiecks-Messung auf einem');
  console.error('       Software-Rasterizer beantwortet genau die falsche Frage —');
  console.error('       dort kostet Geometrie IMMER, auf der GPU womoeglich nichts.');
  await browser.close();
  process.exit(2);
}

await page.waitForSelector('#connect-btn', { timeout: 30_000 });
await page.fill('#player-name', SPIELER);
await page.uncheck('#offline-toggle').catch(() => {});
await page.click('#connect-btn');
console.log('[baum] angemeldet, warte auf Welt ...');

try {
  await page.waitForFunction(
    () => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.scene?.activeCamera),
    { timeout: 180_000 }
  );
} catch {
  console.error('[baum] ABBRUCH: Welt kam nicht hoch.');
  for (const z of seitenfehler.slice(0, 10)) console.error('  [pageerror] ' + z);
  await browser.close();
  process.exit(3);
}

await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

const tpOk = await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [START_X, START_Z]);
if (!tpOk) {
  console.error('[baum] ABBRUCH: Admin-Teleport abgelehnt.');
  await browser.close();
  process.exit(5);
}
await page.waitForTimeout(3000);
console.log(`[baum] Messort ${START_X}/${START_Z}, aufwaermen ${AUFWAERMEN}s ...`);
await page.waitForTimeout(AUFWAERMEN * 1000);

const ort = await page.evaluate(() => {
  const p = window.__dbg.player.position;
  return { x: p.x, y: p.y, z: p.z };
});
const abweichung = Math.hypot(ort.x - START_X, ort.z - START_Z);
if (abweichung > 150) {
  console.error(`[baum] ABBRUCH: ${abweichung.toFixed(0)} m vom Messort entfernt.`);
  await browser.close();
  process.exit(6);
}

// ── Zensus: die Zahlen aus dem E10-Eintrag nachrechnen ────────────────
const zensus = await page.evaluate((muster) => {
  const re = new RegExp(muster, 'i');
  const scene = window.__dbg.scene;
  const gruppen = {};
  for (const m of scene.meshes) {
    const n = m.name ?? '?';
    const inst = m.thinInstanceCount ?? 0;
    if (!m.isEnabled() || !m.isVisible) continue;
    const dreiecke = (m.getTotalIndices?.() ?? 0) / 3;
    if (dreiecke === 0) continue;
    const gruppe = re.test(n)
      ? 'baeume'
      : /^clutter/i.test(n)
        ? 'clutter'
        : /^(zone|terrain|water)/i.test(n)
          ? 'terrain'
          : 'rest';
    const g = (gruppen[gruppe] ??= { master: 0, instanzen: 0, dreiecke: 0 });
    g.master += 1;
    g.instanzen += Math.max(inst, 1);
    g.dreiecke += dreiecke * Math.max(inst, 1);
  }
  return gruppen;
}, BAUM_MASTER);

const gesamtDreiecke = Object.values(zensus).reduce((s, g) => s + g.dreiecke, 0);
console.log('[baum] Zensus der sichtbaren Geometrie:');
for (const [name, g] of Object.entries(zensus)) {
  console.log(
    `  ${name.padEnd(8)} ${String(Math.round(g.dreiecke)).padStart(9)} Dreiecke  ` +
      `${((g.dreiecke / gesamtDreiecke) * 100).toFixed(1).padStart(5)} %  ` +
      `${String(g.instanzen).padStart(6)} Instanzen auf ${g.master} Mastern`
  );
}

// ── Die Zustands-Schalter in die Seite legen ─────────────────────────
//
// Alles laeuft ueber EINEN Einstieg, der vorher immer sauber zuruecksetzt.
// Ein Zustand, der Reste des vorigen mitschleppt, misst eine Mischung —
// und die faellt bei Zahlen in dieser Groessenordnung nicht auf.
await page.evaluate((muster) => {
  const re = new RegExp(muster, 'i');
  const scene = window.__dbg.scene;
  const baumMaster = () => scene.meshes.filter((m) => re.test(m.name ?? ''));

  /** Urzustand je Master, damit jeder Zustand von derselben Basis startet. */
  const urzustand = new Map();
  for (const m of baumMaster()) {
    urzustand.set(m, {
      an: m.isEnabled(),
      anzahl: m.thinInstanceCount ?? 0,
      puffer: m.thinInstanceCount > 0 ? m.thinInstanceGetWorldMatrices().length : 0,
    });
  }

  /** Klone der Stufen 2 und 3 — nur im Zustand `dreiStufen` belegt. */
  let klone = [];

  const aufraeumen = () => {
    for (const k of klone) k.dispose(false, false);
    klone = [];
    for (const [m, u] of urzustand) {
      m.setEnabled(u.an);
      if (u.anzahl > 0) m.thinInstanceCount = u.anzahl;
    }
  };

  window.__baum = {
    zustaende: ['basis', 'ohneGeo', 'ohneMaster', 'dreiStufen'],
    setze(name) {
      aufraeumen();
      if (name === 'basis') return { master: baumMaster().length };
      if (name === 'ohneGeo') {
        // Zeichenaufrufe bleiben stehen, die Geometrie faellt weg.
        for (const m of baumMaster()) if ((m.thinInstanceCount ?? 0) > 0) m.thinInstanceCount = 1;
        return { master: baumMaster().length };
      }
      if (name === 'ohneMaster') {
        for (const m of baumMaster()) m.setEnabled(false);
        return { master: 0 };
      }
      if (name === 'dreiStufen') {
        // Entfernungsklassen SIMULIEREN: dieselbe Geometrie, aber drei
        // Master je Baum-Submesh, deren Instanzen nach Kameraabstand
        // aufgeteilt sind. Genau die Struktur, die E10 im EntityManager
        // vorsieht — nur ohne die Dezimierung, damit der PREIS der
        // Aufteilung allein gemessen wird.
        const kam = scene.activeCamera.position;
        const GRENZEN = [70, 150];
        for (const m of baumMaster()) {
          const n = m.thinInstanceCount ?? 0;
          if (n === 0) continue;
          const mats = m.thinInstanceGetWorldMatrices();
          const eimer = [[], [], []];
          for (let i = 0; i < n; i++) {
            const w = mats[i].m;
            const d = Math.hypot(w[12] - kam.x, w[14] - kam.z);
            eimer[d < GRENZEN[0] ? 0 : d < GRENZEN[1] ? 1 : 2].push(i);
          }
          const ziele = [m];
          for (let s = 1; s < 3; s++) {
            const k = m.clone(`${m.name}_stufe${s}`, null, true);
            k.isPickable = false;
            klone.push(k);
            ziele.push(k);
          }
          for (let s = 0; s < 3; s++) {
            const idx = eimer[s];
            const daten = new Float32Array(idx.length * 16);
            for (let k = 0; k < idx.length; k++) mats[idx[k]].copyToArray(daten, k * 16);
            ziele[s].thinInstanceSetBuffer('matrix', idx.length > 0 ? daten : null, 16, false);
            ziele[s].setEnabled(idx.length > 0);
          }
        }
        return { master: baumMaster().length };
      }
      throw new Error(`unbekannter Zustand ${name}`);
    },
    aufraeumen,
  };
}, BAUM_MASTER);

/** Frame-Zeiten ueber `dauer` Sekunden sammeln. */
async function messen(dauer) {
  await page.evaluate(() => {
    const s = { zeiten: [], laeuft: true, letzte: performance.now() };
    window.__mess = s;
    const tick = () => {
      if (!s.laeuft) return;
      const jetzt = performance.now();
      s.zeiten.push(jetzt - s.letzte);
      s.letzte = jetzt;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__vb.profil();
  });
  await page.waitForTimeout(dauer * 1000);
  return page.evaluate(() => {
    window.__mess.laeuft = false;
    // Die erste halbe Sekunde faellt weg: Der Zustandswechsel loest
    // Shader-Uebersetzungen und Pufferuploads aus, die nicht zum
    // stationaeren Bildaufwand gehoeren.
    const z = window.__mess.zeiten.slice(30).sort((a, b) => a - b);
    const p = (q) => z[Math.min(z.length - 1, Math.floor(z.length * q))] ?? -1;
    const profil = window.__vb.profil();
    return {
      n: z.length,
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      mittel: z.reduce((a, b) => a + b, 0) / (z.length || 1),
      zeichenaufrufe: profil.zeichenaufrufeProBild,
      aktiveMeshes: profil.aktiveMeshes,
      schattenwerfer: profil.schattenwerfer,
    };
  });
}

/**
 * Nur bestimmte Zustaende fahren, z. B. `--zustaende basis`.
 *
 * Fuer den paarweisen A/B zweier ASSET-Staende: dort interessiert nur
 * `basis`, und die drei anderen Zustaende wuerden die Sitzung unnoetig
 * verlaengern — je laenger sie dauert, desto mehr Grundlast-Drift steckt
 * im Vergleich.
 */
const ZUSTAENDE = arg('zustaende', 'basis,ohneGeo,ohneMaster,dreiStufen').split(',');
const laeufe = {};
for (const z of ZUSTAENDE) laeufe[z] = [];

for (let runde = 1; runde <= RUNDEN; runde++) {
  for (const zustand of ZUSTAENDE) {
    const info = await page.evaluate((z) => window.__baum.setze(z), zustand);
    // Einen Moment setzen lassen, bevor der Rekorder laeuft.
    await page.waitForTimeout(800);
    const m = await messen(SEKUNDEN);
    laeufe[zustand].push(m);
    console.log(
      `  Runde ${runde}  ${zustand.padEnd(11)} p50 ${m.p50.toFixed(2)} ms  ` +
        `p95 ${m.p95.toFixed(2)}  Zeichenaufrufe ${m.zeichenaufrufe}  ` +
        `aktive Meshes ${m.aktiveMeshes}  Master ${info.master}`
    );
  }
}

await page.evaluate(() => window.__baum.aufraeumen());

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const ergebnis = {};
for (const z of ZUSTAENDE) {
  ergebnis[z] = {
    p50: +median(laeufe[z].map((l) => l.p50)).toFixed(3),
    p95: +median(laeufe[z].map((l) => l.p95)).toFixed(3),
    p99: +median(laeufe[z].map((l) => l.p99)).toFixed(3),
    zeichenaufrufe: Math.round(median(laeufe[z].map((l) => l.zeichenaufrufe))),
    aktiveMeshes: Math.round(median(laeufe[z].map((l) => l.aktiveMeshes))),
    schattenwerfer: Math.round(median(laeufe[z].map((l) => l.schattenwerfer))),
  };
}

if (ZUSTAENDE.length < 4) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ gpu, ort, runden: RUNDEN, zensus, ergebnis, laeufe }, null, 2));
  console.log(`\n[baum] Teilmessung (${ZUSTAENDE.join(',')}) geschrieben: ${OUT}`);
  await browser.close();
  process.exit(0);
}

const baumAnteil = zensus.baeume ? zensus.baeume.dreiecke / gesamtDreiecke : 0;
const geoKosten = ergebnis.basis.p50 - ergebnis.ohneGeo.p50;
const masterKosten = ergebnis.ohneGeo.p50 - ergebnis.ohneMaster.p50;
const aufteilungKosten = ergebnis.dreiStufen.p50 - ergebnis.basis.p50;

console.log('\n── Ergebnis (Median ueber die Runden, p50 der Frame-Zeit) ──');
for (const z of ZUSTAENDE) {
  const e = ergebnis[z];
  console.log(
    `  ${z.padEnd(11)} ${e.p50.toFixed(2)} ms   p95 ${e.p95.toFixed(2)}   ` +
      `${e.zeichenaufrufe} Zeichenaufrufe, ${e.aktiveMeshes} aktive Meshes`
  );
}
console.log('');
console.log(`  Baum-GEOMETRIE kostet      ${geoKosten.toFixed(2)} ms  (basis - ohneGeo)`);
console.log(`  Baum-ZEICHENAUFRUFE kosten ${masterKosten.toFixed(2)} ms  (ohneGeo - ohneMaster)`);
console.log(`  Dreifach-Aufteilung kostet ${aufteilungKosten.toFixed(2)} ms  (dreiStufen - basis)`);
console.log('');
// Eine LOD-Kette entfernt nicht ALLE Baumdreiecke, sondern die der fernen
// Stufen. Bei den unten angesetzten Grenzen liegt der Loewenanteil der
// Instanzen weit weg; mit LOD1 auf ~40 % und LOD2 auf ~16 % der Dreiecke
// ist rund die Haelfte der Baumgeometrie einsparbar — mehr nicht.
const gewinn = geoKosten * 0.5;
console.log(`  Erwarteter Gewinn der Dezimierung (halbe Baumgeometrie): ${gewinn.toFixed(2)} ms`);
console.log(`  Preis der Entfernungsklassen:                            ${aufteilungKosten.toFixed(2)} ms`);
console.log(
  gewinn > aufteilungKosten
    ? '  -> E10 traegt sich: der Gewinn ist groesser als der Preis.'
    : '  -> E10 traegt sich in dieser Form NICHT: die Aufteilung kostet mehr, als die\n' +
        '     Dezimierung einbringt. Ein Weg ohne zusaetzliche Master ist noetig.'
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      gpu,
      ort,
      runden: RUNDEN,
      sekundenJeLauf: SEKUNDEN,
      zensus,
      baumAnteilDreiecke: +(baumAnteil * 100).toFixed(1),
      ergebnis,
      laeufe,
      auswertung: {
        geometrieKostenMs: +geoKosten.toFixed(3),
        zeichenaufrufKostenMs: +masterKosten.toFixed(3),
        aufteilungKostenMs: +aufteilungKosten.toFixed(3),
        traegtSich: gewinn > aufteilungKosten,
      },
      seitenfehler,
    },
    null,
    2
  )
);
console.log(`\n[baum] geschrieben: ${OUT}`);

await browser.close();
