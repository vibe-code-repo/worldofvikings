#!/usr/bin/env node
/**
 * Prüft: ob der Normal-Kanal des Steinmaterials im Streiflicht wirklich
 * Relief macht — als HELLIGKEITSSTREUUNG einer Wandfläche, zweimal dieselbe
 * Stelle, einmal mit und einmal ohne Kanal (F1).
 * Measures the brightness spread of one wall in grazing light, with and
 * without the normal channel.
 *
 * ── Warum eine Zahl und kein Blick ─────────────────────────────────────
 * „Sieht plastischer aus" ist ein Urteil über zwei Bilder, die man nicht
 * nebeneinander hat. Eine Normal-Map ändert die Silhouette nicht (deshalb
 * kommt 3b danach); was sie ändert, ist die VERTEILUNG der Helligkeit auf
 * einer Fläche, die vorher gleichmässig war. Genau das misst dieses Skript.
 *
 * ── Warum zwei Adressen und nicht zwei Baustände ───────────────────────
 * `?relief=0` schaltet den Kanal in `DungeonSteinMaterial.ts` ab, ohne sonst
 * etwas zu ändern. Zwei Baustände zu vergleichen hiesse zwei Programme zu
 * vergleichen — Übersetzer, Texturcache und Zufallszahlen inbegriffen.
 *
 * ── Warum die RELATIVE Streuung (σ/µ) ──────────────────────────────────
 * Das Fackellicht flackert (`FackelLicht.ts`). Flackern verschiebt die
 * mittlere Helligkeit µ eines Bildes, nicht aber das Verhältnis σ/µ einer
 * Fläche. Die absolute Streuung wäre damit eine Zufallszahl, die relative
 * nicht.
 *
 * ── Zeugen, nicht nur Zahlen ───────────────────────────────────────────
 * Zwei Dinge werden mitgemessen, weil ein wirkungsloser Schalter sonst wie
 * ein wirkungsloses Relief aussieht (Gedächtnis „Messzellen brauchen
 * Zeugen"): (1) die HTTP-Antwort auf jede `*_normal.png` — 200 heisst Karte
 * da, 404 heisst Rückfall aufs heutige Verhalten, und beides ist eine gültige
 * Auskunft; (2) die `#define STEIN_NORMAL*` im übersetzten Shader, aus den
 * Effekten der Szene gelesen. Ohne (2) misst man womöglich zweimal denselben
 * Shader und nennt den Unterschied Rauschen.
 *
 * ── Zwei Kanäle (Mass D, 05.09.2026) ──────────────────────────────────
 * `--kanal=relief` (Vorgabe) misst die Normal-Karte im Streiflicht;
 * `--kanal=cavity` misst die gebackene Verschattung im Netz — die wirkt
 * OHNE Licht und wird deshalb im Grab `hell-probe` ohne Fackel gemessen.
 *
 * Aufruf:
 *   node tools/elements/pruefung/relief-kontrast.mjs [--kanal=relief|cavity] <dungeonId> [x] [z] [yawGrad]
 *
 * `x`/`z` sind KEIN Teleport. Die Sonde setzt die Stelle und sieht nach, ob
 * sie gehalten hat; im Grab tut sie das nicht (der Havok-Koerper schreibt
 * `player.position` im naechsten Bild zurueck), und dann bricht der Lauf mit
 * einer Meldung ab, statt still am Eingang zu messen. Eine andere Stelle wird
 * ERLAUFEN — `tools/pw-stonevault-walk.mjs --tour`.
 *
 * Umgebung:
 *   WOV_RELIEF_FAKTOR   geforderter Faktor σ/µ(an) ÷ σ/µ(aus), Vorgabe 1.25
 *   WOV_RELIEF_MIN      geforderte relative Streuung mit Kanal, Vorgabe 0.06
 *   WOV_RELIEF_FELD     Messrechteck x0,y0,x1,y1 im Bild, Vorgabe 400,250,1200,650
 *   WOV_HELL            Belichtung, Vorgabe 6
 *   WOV_DEV_USER/PASS   Basic-Auth des Dev-Hosts
 *
 * Bilder: ~/.cache/wov-relief-kontrast/<dungeonId>-relief-{aus,an}.png
 *
 * LÄUFT LOKAL auf Mikes Maschine gegen den Tunnel, nicht auf wov-dev — dort
 * startet kein Chromium (Gedächtnis „Messungen laufen lokal").
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { decode } from '../../lib/png.mjs';

const HOST = process.env.WOV_HOST ?? 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-relief-kontrast`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';
// Ohne ANGLE-Flags rendert SwiftShader, und dann misst man die CPU
// (Gedächtnis „Headless Chromium braucht die GPU").
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

// ── Zwei Kanäle, eine Messung (Mass D, 05.09.2026) ─────────────────────
// `--kanal=relief` misst die Normal-Karte, `--kanal=cavity` die gebackene
// Verschattung im Netz. Beide beantworten dieselbe Frage — „zeigt sich das
// Relief auf einer Fläche, die vorher gleichmässig war?" — und beide
// beantworten sie über EINEN Adressparameter, damit zwei Läufe dasselbe
// Programm vergleichen und nicht zwei Baustände.
//
// Unterschiedlich ist nur der ZEUGE. Beim Normal-Kanal ist es `#define
// STEIN_NORMAL_WAND` im übersetzten Shader; bei der Verschattung ist es
// `#define VERTEXCOLOR` — den setzt Babylon genau dann, wenn das gezeichnete
// Netz wirklich ein COLOR_0 mitbringt. Ohne diesen Zeugen wäre ein Kit, das
// die Farbschicht beim Verschmelzen verloren hat, von einem wirkungslosen
// Shader nicht zu unterscheiden (Gedächtnis „Messzellen brauchen Zeugen").
const ARGV = process.argv.slice(2);
const kanalArg = ARGV.find((a) => a.startsWith('--kanal='));
const KANAL = kanalArg ? kanalArg.slice('--kanal='.length) : 'relief';
if (KANAL !== 'relief' && KANAL !== 'cavity') {
  console.error(`Unbekannter Kanal "${KANAL}" — erlaubt sind relief und cavity.`);
  process.exit(2);
}
const KANAELE = {
  // `param` ist der Adressparameter, `zeuge` das Define, das im ÜBERSETZTEN
  // Shader stehen muss, wenn der Kanal an ist.
  relief: { param: 'relief', zeuge: '#define STEIN_NORMAL_WAND', vorwurf: 'fehlt <albedo>_normal.png?' },
  cavity: { param: 'cavity', zeuge: '#define VERTEXCOLOR', vorwurf: 'trägt das Netz kein COLOR_0? (fels-cavity.mjs)' },
}[KANAL];

const [dungeonId, xArg, zArg, yawArg = '0'] = ARGV.filter((a) => !a.startsWith('--'));
if (!dungeonId) {
  console.error('Aufruf: node tools/elements/pruefung/relief-kontrast.mjs [--kanal=relief|cavity] <dungeonId> [x] [z] [yawGrad]');
  process.exit(2);
}
const ZIEL = xArg !== undefined ? { x: Number(xArg), z: Number(zArg) } : null;
const YAW = (Number(yawArg) * Math.PI) / 180;
const FAKTOR = Number(process.env.WOV_RELIEF_FAKTOR ?? '1.25');
const MIN = Number(process.env.WOV_RELIEF_MIN ?? '0.06');
const FELD = (process.env.WOV_RELIEF_FELD ?? '400,250,1200,650').split(',').map(Number);
const BELICHTUNG = Number(process.env.WOV_HELL ?? '6');
// Bildpunkte unter dieser Helligkeit sind Loch oder Schatten, nicht Wand.
const DUNKEL = 8;

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

/** Relative Helligkeitsstreuung im Messrechteck eines PNG. */
function streuung(pfad) {
  const { w, h, ch, data } = decode(pfad);
  const [x0, y0, x1, y1] = FELD;
  const werte = [];
  let dunkel = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const o = (y * w + x) * ch;
      // Rec.601-Helligkeit; Graustufen-PNG hat nur einen Kanal.
      const l = ch >= 3 ? 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] : data[o];
      if (l < DUNKEL) { dunkel++; continue; }
      werte.push(l);
    }
  }
  const n = werte.length;
  if (n === 0) return { n: 0, dunkelAnteil: 1, mittel: 0, sigma: 0, relativ: 0 };
  const mittel = werte.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(werte.reduce((a, b) => a + (b - mittel) ** 2, 0) / n);
  return { n, dunkelAnteil: dunkel / (dunkel + n), mittel, sigma, relativ: sigma / mittel };
}

mkdirSync(ORDNER, { recursive: true });
const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });

/**
 * Eine Sitzung mit gegebener Reliefstärke: betreten, hinstellen, ein Bild.
 * Jedes Szenario bekommt eine EIGENE Sitzung und einen eigenen Charakter —
 * ein zweites `dungeon enter` in derselben Sitzung zieht die Figur beim
 * Losgehen weg (Gedächtnis „Serverposition kennt keine Wände").
 */
async function messung(stellung, marke) {
  const kontext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    httpCredentials: { username: BENUTZER, password: PASSWORT },
  });
  const seite = await kontext.newPage();
  const fehler = [];
  const normalAntworten = [];
  seite.on('pageerror', (f) => fehler.push(String(f)));
  seite.on('response', (r) => {
    if (/_normal\.png(\?|$)/.test(r.url())) normalAntworten.push(`${r.status()} ${r.url().split('/').pop()}`);
  });
  await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
  const name = `Relief${Date.now().toString(36).slice(-5)}`;
  await seite.goto(`${HOST}/?name=${name}&dungeon=${dungeonId}&${KANAELE.param}=${stellung}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000,
  });
  await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
  await seite.waitForTimeout(10_000);
  await seite.evaluate((e) => { window.__dbg.scene.imageProcessingConfiguration.exposure = e; }, BELICHTUNG);

  // Maus fangen, BEVOR der Blick gesetzt wird — der Klick addiert sonst sein
  // Delta auf `_yaw` (s. pw-stonevault-walk.mjs).
  await seite.mouse.click(800, 450);
  await seite.waitForTimeout(400);
  if (ZIEL) {
    // Setzen — und NACHSEHEN, ob es gehalten hat.
    //
    // `player.position` ist im Grab keine Anschrift, sondern eine Kopie:
    // Der Zeichenschritt schreibt sie aus dem Havok-Koerper zurueck. Am
    // 05.09.2026 gemessen (200-ms-Abtastung ueber sechs Sekunden): Der
    // Sprung nach (−10, 5) war im NAECHSTEN Bild wieder auf dem
    // Eingangspunkt. Ohne diese Pruefung meldet die Sonde brav eine
    // Stelle, an der sie nie war — und misst am Eingang, waehrend im
    // Bericht der Saal steht.
    const gehalten = await seite.evaluate(async (z) => {
      const p = window.__dbg.player;
      p.position.x = z.x; p.position.z = z.z;
      await new Promise((r) => setTimeout(r, 600));
      return { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) };
    }, ZIEL);
    const weg = Math.hypot(gehalten.x - ZIEL.x, gehalten.z - ZIEL.z);
    if (weg > 0.5) {
      await kontext.close();
      await browser.close();
      console.error(
        `Die Figur bleibt nicht bei (${ZIEL.x}, ${ZIEL.z}) — sie steht nach 600 ms bei ` +
          `(${gehalten.x}, ${gehalten.z}), ${weg.toFixed(1)} m daneben.\n` +
          'Eine Stelle im Grab wird ERLAUFEN, nicht gesetzt: ' +
          'tools/pw-stonevault-walk.mjs --tour. Ohne Argument misst diese Sonde am Eingang.'
      );
      process.exit(2);
    }
    await seite.waitForTimeout(600);
  }
  await seite.evaluate((y) => {
    const p = window.__dbg.player;
    p._yaw = y; p._figurYaw = y; p._pitch = -0.05;
  }, YAW);
  await seite.waitForTimeout(1500);

  // Zeuge 2: Was steht wirklich im übersetzten Shader?
  const defines = await seite.evaluate(() => {
    const gefunden = new Set();
    for (const m of window.__dbg.scene.meshes) {
      for (const sm of m.subMeshes ?? []) {
        const d = sm.effect?.defines;
        if (!d || !d.includes('STEIN_KIT')) continue;
        for (const z of d.split('\n')) {
          // VERTEXCOLOR/VERTEXALPHA gehören dazu, seit die Verschattung im
          // Netz steckt: Sie sind der Zeuge dafür, dass die Farbschicht das
          // Verschmelzen im AssetManager überlebt hat.
          if (/^#define (STEIN_|VERTEXCOLOR|VERTEXALPHA)/.test(z.trim())) gefunden.add(z.trim());
        }
      }
    }
    return [...gefunden].sort();
  });

  const pfad = `${ORDNER}/${dungeonId}-${KANAL}-${marke}.png`;
  await seite.screenshot({ path: pfad });
  const lage = await seite.evaluate(() => {
    const p = window.__dbg.player.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
  });
  await kontext.close();
  return { pfad, defines, normalAntworten, fehler, lage, ...streuung(pfad) };
}

const aus = await messung(0, 'aus');
const an = await messung(1, 'an');
await browser.close();

for (const [marke, m] of [['aus', aus], ['an', an]]) {
  console.log(`${KANAELE.param}=${marke}  Bild ${m.pfad}`);
  console.log(`  Stelle ${JSON.stringify(m.lage)}  Feld ${FELD.join(',')}  Punkte ${m.n}  dunkel ${(m.dunkelAnteil * 100).toFixed(1)}%`);
  console.log(`  Helligkeit ø${m.mittel.toFixed(2)}  Streuung σ${m.sigma.toFixed(2)}  relativ ${m.relativ.toFixed(4)}`);
  console.log(`  Normal-Karten: ${m.normalAntworten.length ? m.normalAntworten.join(', ') : 'keine Anfrage'}`);
  console.log(`  Defines: ${m.defines.length ? m.defines.join(' ') : 'keine gefunden'}`);
  if (m.fehler.length) console.log(`  Seitenfehler ${m.fehler.length}: ${m.fehler[0].slice(0, 200)}`);
}

const faktor = aus.relativ > 0 ? an.relativ / aus.relativ : Infinity;
console.log(`\nFaktor σ/µ (an ÷ aus) = ${faktor.toFixed(3)}  — gefordert ≥ ${FAKTOR}`);
console.log(`Relative Streuung mit Kanal = ${an.relativ.toFixed(4)}  — gefordert ≥ ${MIN}`);

// Die Sonde entscheidet NICHT selbst, dass ein leerer Lauf ein Bestehen ist:
// ein schwarzes oder leeres Messfeld ist rot, nicht grün (Muster
// `brauchtModelle()` in scripts/run-tests.mjs).
const gruende = [];
if (an.n < 10_000) gruende.push(`Messfeld fast leer (${an.n} Punkte) — steht die Figur vor einer Wand?`);
if (an.dunkelAnteil > 0.6) gruende.push(`Messfeld zu ${(an.dunkelAnteil * 100).toFixed(0)}% dunkel — Belichtung oder Stelle prüfen`);
if (!an.defines.includes(KANAELE.zeuge)) gruende.push(`kein ${KANAELE.zeuge.replace('#define ', '')} im übersetzten Shader — ${KANAELE.vorwurf}`);
// Der Gegenzeuge nur für den Normal-Kanal: `?relief=0` lädt die Karten
// gar nicht erst und lässt die Defines weg. `?cavity=0` KANN das nicht —
// VERTEXCOLOR hängt am Netz, nicht am Schalter; dort ist die Stärke im
// Uniform 0, und genau das ist die A/B-Stellung.
if (KANAL === 'relief' && aus.defines.includes('#define STEIN_NORMAL')) {
  gruende.push('relief=0 hat den Kanal trotzdem an — der Schalter wirkt nicht');
}
// Ein Fels-Kit im Alpha-Blend-Pfad wäre kein Messfehler, sondern ein
// Schaden (Sortierung, kein Tiefenschreiben) — s. entschaerfeVertexAlpha.
if (an.defines.includes('#define VERTEXALPHA')) {
  gruende.push('VERTEXALPHA im Shader — entschaerfeVertexAlpha hat nicht gegriffen');
}
if (faktor < FAKTOR) gruende.push(`Faktor ${faktor.toFixed(3)} unter der Schwelle ${FAKTOR}`);
if (an.relativ < MIN) gruende.push(`relative Streuung ${an.relativ.toFixed(4)} unter ${MIN}`);

if (gruende.length) {
  console.log('\nROT:');
  for (const g of gruende) console.log(`  - ${g}`);
  process.exit(1);
}
console.log(
  KANAL === 'cavity'
    ? '\nGRUEN: die gebackene Verschattung ist ohne Licht messbar.'
    : '\nGRUEN: der Normal-Kanal ist im Streiflicht messbar.'
);
