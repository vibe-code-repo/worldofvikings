/**
 * Vergleichs-Screenshots für das HD-Clutter (Settings.hdClutter).
 *
 * Läuft denselben Spawn zweimal — einmal mit Originaltexturen, einmal mit den
 * HD-Vorlagen — bei fixierter Tageszeit (?t=…), damit sich nur das Gras
 * unterscheidet. Die Einstellung wird vor dem ersten Skript der Seite in den
 * localStorage geschrieben, weil GrassClutter die Texturen beim Laden wählt.
 *
 * SwiftShader rendert hier softwareseitig und ist entsprechend langsam: es
 * wird auf ZUSTÄNDE gewartet (Konsolenzeile, gezählte Frames), nie auf Uhrzeit.
 *
 *   node tools/pw-hd-gras-vergleich.mjs [url] [--out screenshots]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

// `offline=1` überspringt den Verbinden-Bildschirm und baut die Welt lokal
// (main.ts) — ohne das steht der Lauf in der Maske und knipst ein Formular.
//
// `t` ist ein ANTEIL des Tages (Lighting.timeOfDay, 0..1), keine Stunde:
// t=12 landete bei „zeit 288.0h" und mitten in der Nacht. 0.5 ist Mittag.
//
// `pos` setzt den Spieler auf eine Wiese des Standard-Seeds (KxSYuZquuw,
// mit GeoManager.getBiome gesucht) — der Spawn bei 0,0 steht auf Sand, wo
// überhaupt kein Gras wächst und der Vergleich nichts zeigen würde.
const URL_BASE = process.argv[2]?.startsWith('http')
  ? process.argv[2]
  : 'http://localhost:5273/?offline=1&t=0.5&pos=200,0';
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : 'screenshots';
mkdirSync(OUT, { recursive: true });

const STORAGE_KEY = 'valheim-babylon-settings-v1';
const LOAD_MARKER = '[GrassClutter] clutter system loaded';

async function lauf(hd, datei) {
  // Eigener Browser je Lauf: beim gemeinsamen Browser riss der zweite
  // newPage() den Kontext des ersten mit ("Failed to find browser context"),
  // und ein Absturz hätte beide Bilder gekostet.
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  // Kleiner Ausschnitt mit Absicht: SwiftShader rendert in Software, und die
  // Kosten wachsen mit der Pixelzahl. 1100×620 mit Gras im Bild liess
  // page.screenshot() nicht mehr fertig werden; 640×360 ist ein Drittel davon.
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  let clutterGeladen = false;
  const fehler = [];
  page.on('console', (m) => {
    if (m.text().includes(LOAD_MARKER)) clutterGeladen = true;
    if (m.type() === 'error') fehler.push(m.text());
  });
  page.on('pageerror', (e) => fehler.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) fehler.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.addInitScript(
    ([key, wert]) => {
      const alt = JSON.parse(localStorage.getItem(key) ?? '{}');
      // Schatten AUS: Mit den CSM-Defines übersetzt SwiftShader das
      // Terrain-NodeMaterial nicht mehr ("Unable to compile effect"), und
      // dann fehlt im Bild der komplette Boden. Auf echter Grafik ist das
      // kein Thema — hier geht es nur darum, das Gras sichtbar zu bekommen.
      localStorage.setItem(
        key,
        JSON.stringify({ ...alt, hdClutter: wert, grassDensity: 3, shadowQuality: 0 })
      );
    },
    [STORAGE_KEY, hd]
  );

  console.log(`\n── Lauf hdClutter=${hd} ──`);
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Am DOM warten, nicht an Konsolenzeilen: Unter SwiftShader lädt Vite die
  // Module so langsam, dass die Seite beim Knipsen noch im Verbinden-Fenster
  // stand (Uhrzeit-Auswahl noch leer). Der sichtbare Zustand lügt nicht.
  await page.waitForFunction(
    () => {
      const cs = document.getElementById('connect-screen');
      const weg = !cs || cs.hidden || getComputedStyle(cs).display === 'none';
      const c = document.querySelector('canvas');
      return weg && c && c.clientWidth > 100;
    },
    null,
    { timeout: 900000, polling: 2000 }
  );

  // Der Ladeschirm ("Die Welt erwacht…") liegt VOR der Szene und nimmt sich
  // selbst aus dem DOM, sobald das Gelände steht (LoadingScreen.ts). Die
  // Chunk-Zahl im HUD allein genügt nicht: Das HUD existiert schon während
  // des Ladens, weshalb ein früherer Lauf den Ladebalken fotografiert hat.
  await page.waitForFunction(
    () => {
      const t = document.body.innerText || '';
      if (t.includes('Die Welt erwacht')) return false;
      const m = t.match(/chunks\s+(\d+)/);
      return m !== null && Number(m[1]) >= 40;
    },
    null,
    { timeout: 900000, polling: 3000 }
  );
  if (!clutterGeladen) console.log('  (Clutter-Meldung noch nicht gesehen)');

  // Zellen baut update() über viele Frames auf (CELLS_PER_FRAME = 3); einen
  // Zustand dafür gibt die Seite nicht nach aussen.
  //
  // Die Zahl ist bewusst klein: Auf diesem Host läuft die Systemuhr rund
  // 15× langsamer als die Wanduhr, und Playwright misst in Systemzeit —
  // 60000 hier hiess eine Viertelstunde reales Warten.
  await page.waitForTimeout(5000);

  const ziel = `${OUT}/${datei}`;
  // `animations: 'disabled'` — sonst wartet Playwright auf ein Ende der
  // CSS-Animationen im HUD, das in einer Dauerschleife nie kommt.
  await page.screenshot({ path: ziel, timeout: 120000, animations: 'disabled' });
  console.log(`  → ${ziel}`);
  if (fehler.length) console.log('  Fehler:', [...new Set(fehler)].slice(0, 5).join(' | '));
  await page.close();
  await browser.close();
}

// Ohne Argument beide Läufe; `--nur hd` / `--nur orig` für einen einzelnen,
// damit ein Fehlschlag nicht den schon gelungenen Lauf wiederholen muss.
const nurIdx = process.argv.indexOf('--nur');
const nur = nurIdx > -1 ? process.argv[nurIdx + 1] : null;
if (nur !== 'hd') await lauf(false, 'gras-original.png');
if (nur !== 'orig') await lauf(true, 'gras-hd.png');
console.log('\nfertig');
