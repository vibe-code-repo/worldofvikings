#!/usr/bin/env node
/**
 * Kostenmessung der Dungeon-2.0-Vollausbau-Effekte (M2): SSAO, Parallax,
 * Godrays, SSR — jeder EINZELN, an derselben Stelle, mit derselben Kamera.
 * Cost measurement of the dungeon 2.0 full build effects, each one SEPARATELY,
 * at the same spot with the same camera.
 *
 *   node tools/pw-dungeon2-effekte.mjs [--sichtbar] [--bilder] [--nur <name>]
 *
 * ── Warum eine eigene Messung und nicht der E2E-Lauf ──────────────────
 * `tools/dungeon2-e2e.mjs` beweist die KETTE (Server → Deskriptor → Client)
 * und misst dabei Ladezeiten. Was ein Effekt im STEHENDEN Bild kostet, sagt er
 * nicht — dafuer braucht es eine feste Kamera, einen fertig gebauten Dungeon
 * und viele Bilder hintereinander. Diese Messung startet deshalb nur Vite und
 * die Vorschau, keinen Spielserver.
 * The e2e run proves the CHAIN and measures load times; what an effect costs in
 * a STANDING image it cannot say. This one starts only Vite and the preview.
 *
 * ── Warum die Kamera steht ────────────────────────────────────────────
 * Die Vault-Notiz „Framezeit: Strecke statt Zeit messen" gilt fuer den
 * Gelaendestrom der Oberwelt: dort baut eine bewegte Kamera Chunks nach, und
 * wer nach ZEIT misst, misst bei schnellerem Code mehr Nachbau. Im Dungeon
 * gibt es keinen Nachbau — er ist vor dem ersten gemessenen Bild vollstaendig
 * gebaut. Eine STEHENDE Kamera ist hier deshalb die sauberere Messung: gleiche
 * Bildschirmflaeche, gleiche Verdecker, gleiche Zahl gezeichneter Dreiecke.
 * Bewegung wuerde nur Rauschen addieren.
 * The vault note "measure distance, not time" applies to the overworld terrain
 * stream. In a dungeon nothing is streamed — a STANDING camera is the cleaner
 * measurement here: same screen area, same occluders, same triangle count.
 *
 * ── Zeugen ────────────────────────────────────────────────────────────
 * Jede Zeile der Tabelle traegt neben der Bildzeit den ZUSTAND, den die Seite
 * selbst meldet (`__dg2.effekte()`): welcher Effekt tatsaechlich haengt. Ohne
 * das misst man einen wirkungslosen Schalter und nennt ihn „kostenlos"
 * (Vault: „Messzellen brauchen Zeugen").
 * Each row carries the state the page itself reports — without it one measures
 * an inert switch and calls it "free".
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SICHTBAR = argv.includes('--sichtbar');
const BILDER = argv.includes('--bilder');
const NUR = argv.includes('--nur') ? argv[argv.indexOf('--nur') + 1] : null;
const CLIENT_PORT = Number(process.env.DG2_PORT ?? 5297);
const BILD_ORDNER = `${process.env.HOME}/.cache/wov-tripo-test`;

/** ANGLE/Vulkan statt SwiftShader (Vault). / ANGLE/Vulkan, not SwiftShader. */
const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  // OHNE die beiden folgenden Flaggen misst dieses Werkzeug NICHTS.
  //
  // Der erste Lauf meldete fuer ALLE elf Varianten exakt 16,70 ms / 59,9 fps,
  // von „Niedrig" bis „Hoch mit allem" — die Bildschirmsynchronisation. Der
  // Browser reicht `requestAnimationFrame` im 60-Hz-Takt aus, und solange ein
  // Bild in weniger als 16,7 ms fertig ist, misst man den Takt und nicht das
  // Bild. Eine Tabelle voller identischer Zahlen sieht dabei nicht nach einem
  // kaputten Messstand aus, sondern nach „die Effekte kosten nichts".
  // WITHOUT the two flags below this tool measures NOTHING: the first run
  // reported exactly 16.70 ms for all eleven variants — the vsync interval. A
  // table of identical numbers does not look like a broken rig, it looks like
  // "the effects are free".
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
];

/**
 * Die Messstelle. Fest verdrahtet statt „irgendwo im Grab": Zwei Laeufe an
 * verschiedenen Stellen sind zwei verschiedene Messungen, und der Unterschied
 * zwischen zwei Effekten waere dann der Unterschied zwischen zwei Blickfeldern.
 * Der Punkt liegt im Gang vor dem Eingang, Blick den Gang hinunter.
 * The measuring spot, hard-wired rather than "somewhere in the barrow": two
 * runs at different places are two different measurements.
 */
let KAMERA = process.env.DG2_KAMERA ?? null;
const SEED = Number(process.env.DG2_SEED ?? 2) | 0;

/** Aufwaermbilder, dann Messbilder. / Warm-up frames, then measured frames. */
const WARM = Number(process.env.DG2_WARM ?? 180);
const MESSBILDER = Number(process.env.DG2_BILDER ?? 600);

/**
 * Die Messreihe. Jede Zeile ist EINE Adresse; die Namen tauchen so in der
 * Tabelle auf. Reihenfolge: erst die Grundlinien (Stufen wie heute), dann die
 * Effekte einzeln auf der Grundlinie Mittel, zuletzt der Vollausbau.
 * The series. Each row is ONE URL; baselines first, then single effects on top
 * of the Mittel baseline, then the full build.
 */
const REIHE = [
  ['niedrig', 'stufe=0&parallax=0&godrays=0&ssr=0'],
  ['mittel', 'stufe=1&parallax=0&godrays=0&ssr=0'],
  ['hoch-M1', 'stufe=2&parallax=0&godrays=0&ssr=0'],
  ['hoch+parallax1', 'stufe=2&parallax=1&godrays=0&ssr=0'],
  ['hoch+parallax6', 'stufe=2&parallax=6&godrays=0&ssr=0'],
  ['hoch+parallax12', 'stufe=2&parallax=12&godrays=0&ssr=0'],
  ['hoch+godrays', 'stufe=2&parallax=0&godrays=1&ssr=0'],
  ['hoch+ssr-einfach', 'stufe=2&parallax=0&godrays=0&ssr=1'],
  ['hoch+ssr-gbuffer', 'stufe=2&parallax=0&godrays=0&ssr=2'],
  ['hoch+ssr-prepass', 'stufe=2&parallax=0&godrays=0&ssr=3'],
  ['hoch-voll', 'stufe=2'],
];

/**
 * Wie oft die ganze Reihe durchlaufen wird.
 *
 * VERSCHRAENKT, nicht hintereinander — dieselbe Lehre wie in
 * `PostProcessing.setSSAO()`: „die ersten Laeufe werden systematisch schneller,
 * und ein einfaches Vorher/Nachher misst diese Drift mit". Gewertet wird je
 * Variante der MEDIAN ihrer Durchgaenge, nicht der beste und nicht der erste.
 * How often the whole series runs — INTERLEAVED, not one variant after the
 * other: the early runs get systematically faster and a plain before/after
 * would measure that drift. The median across passes is what counts.
 */
const DURCHGAENGE = Number(process.env.DG2_DURCHGAENGE ?? 3);

const kinder = [];
function raeumeAuf() {
  for (const k of kinder) {
    try {
      process.kill(-k.pid, 'SIGKILL');
    } catch {
      /* schon tot / already gone */
    }
  }
  kinder.length = 0;
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    raeumeAuf();
    process.exit(130);
  });
}

function starte(name, cmd, args, verzeichnis) {
  const kind = spawn(cmd, args, {
    cwd: verzeichnis,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const zeilen = [];
  const sammle = (puffer) => {
    for (const z of puffer.toString().split('\n')) {
      if (!z.trim()) continue;
      zeilen.push(z);
      if (process.env.DG2_LAUT) console.log(`[${name}] ${z}`);
    }
  };
  kind.stdout.on('data', sammle);
  kind.stderr.on('data', sammle);
  kinder.push(kind);
  return { kind, zeilen };
}

function warteAufZeile(prozess, muster, sekunden = 90) {
  return new Promise((auf, ab) => {
    const bis = Date.now() + sekunden * 1000;
    const takt = setInterval(() => {
      const treffer = prozess.zeilen.find((z) => muster.test(z));
      if (treffer) {
        clearInterval(takt);
        auf(treffer);
      } else if (Date.now() > bis) {
        clearInterval(takt);
        ab(new Error(`Zeitüberschreitung: ${muster}\n${prozess.zeilen.slice(-20).join('\n')}`));
      }
    }, 250);
  });
}

/**
 * Eine Messung: Seite laden, warten bis gebaut, aufwaermen, dann die Dauer je
 * Bild sammeln. Gemessen wird die Zeit ZWISCHEN zwei `requestAnimationFrame`-
 * Rueckrufen, nicht `scene.render()` allein: Was den Spieler stoert, ist der
 * Abstand zwischen zwei fertigen Bildern, und darin steckt auch, was der
 * Browser hinter Babylon noch tut.
 * One measurement: load, wait until built, warm up, then collect per-frame
 * durations — the gap between two finished frames, not `scene.render()` alone.
 */
async function miss(seite, name, query) {
  const url = `http://localhost:${CLIENT_PORT}/dungeon2.html?seed=${SEED}&${KAMERA}&${query}`;
  await seite.goto(url, { waitUntil: 'domcontentloaded' });
  await seite.waitForFunction(() => (window).__dg2 !== undefined, null, { timeout: 120000 });
  // Shader-Uebersetzung abwarten: Der erste Bildaufbau mit einem neuen Define
  // uebersetzt, und diese Zeit gehoert nicht in die Bildzeit.
  // Wait for shader compilation — that time does not belong in the frame time.
  await seite.waitForTimeout(3000);

  const ergebnis = await seite.evaluate(
    async ([warm, anzahl]) => {
      const dauern = [];
      let vorher = 0;
      let gezaehlt = 0;
      await new Promise((fertig) => {
        const takt = (t) => {
          if (vorher !== 0) {
            gezaehlt += 1;
            if (gezaehlt > warm) dauern.push(t - vorher);
          }
          vorher = t;
          if (dauern.length >= anzahl) {
            fertig();
            return;
          }
          requestAnimationFrame(takt);
        };
        requestAnimationFrame(takt);
      });
      dauern.sort((a, b) => a - b);
      const bei = (p) => dauern[Math.min(dauern.length - 1, Math.floor(dauern.length * p))];
      const summe = dauern.reduce((a, b) => a + b, 0);
      return {
        n: dauern.length,
        mittel: summe / dauern.length,
        p50: bei(0.5),
        p95: bei(0.95),
        effekte: (window).__dg2.effekte(),
      };
    },
    [WARM, MESSBILDER]
  );
  if (BILDER) {
    mkdirSync(BILD_ORDNER, { recursive: true });
    await seite.screenshot({ path: `${BILD_ORDNER}/dungeon2-mess-${name}.png` });
  }
  return ergebnis;
}

async function main() {
  const vite = starte(
    'vite',
    resolve(WURZEL, 'node_modules/.bin/vite'),
    ['--port', String(CLIENT_PORT)],
    resolve(WURZEL, 'client')
  );
  await warteAufZeile(vite, /Local:|localhost:/, 120);

  const browser = await chromium.launch({ headless: !SICHTBAR, args: GPU_FLAGS });
  // 1920x1080 und nicht 1280x720: Bei 720p lagen alle Bildzeiten unter 2 ms,
  // und `performance.now()` ist in Chromium auf 100 µs gerundet — die halbe
  // Tabelle unterschied sich dann um einen einzigen Messschritt. Ein
  // Bildschirmfuellender Effekt kostet ausserdem mit der Flaeche; auf der
  // Aufloesung zu sparen heisst, den Effekt kleinzurechnen.
  // 1920x1080, not 1280x720: at 720p every frame time was under 2 ms and
  // `performance.now()` is rounded to 100 µs in Chromium, so half the table
  // differed by a single measuring step. A full-screen effect also costs with
  // the area.
  const seite = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const fehlerZeilen = [];
  seite.on('console', (m) => {
    if (m.type() === 'error') fehlerZeilen.push(m.text());
  });
  seite.on('pageerror', (f) => fehlerZeilen.push(String(f)));

  // Der Renderer-String zuerst: steht dort SwiftShader, sind alle folgenden
  // Zahlen die einer Software-Rasterisierung.
  // The renderer string first — SwiftShader would invalidate everything below.
  await seite.goto(`http://localhost:${CLIENT_PORT}/dungeon2.html?seed=${SEED}&arrays=0`, {
    waitUntil: 'domcontentloaded',
  });
  await seite.waitForFunction(() => (window).__dg2 !== undefined, null, { timeout: 120000 });
  const renderer = await seite.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unbekannt';
  });
  console.log(`Renderer: ${renderer}`);
  if (/swiftshader|llvmpipe/i.test(renderer)) {
    console.error('SwiftShader — die Zahlen unten waeren wertlos. Abbruch.');
    process.exitCode = 1;
    return;
  }

  // Die Messstelle: der Lichtschacht, der dem Spawnpunkt am naechsten liegt,
  // aus 7 m Abstand und mit Blick darauf. Nicht „irgendwo im Gang": Ohne einen
  // Schacht im Bild misst die Godray-Zeile die Kosten eines Effekts, der sich
  // gerade abgeschaltet hat — und meldete sie als „kostenlos".
  // The spot: the shaft mouth nearest the spawn point, seen from 7 m. Without a
  // shaft in frame the godray row would measure a self-disabled effect.
  if (KAMERA === null) {
    const pose = await seite.evaluate(() => {
      const b = (window).__dg2.bauer;
      const s = b.spawnPunkt;
      // Ausdruecklich nur echte SCHAECHTE, nie der Eingang: Der Eingang liegt
      // am Rand des Grabes, und sechs Meter davor steht die Kamera im Freien
      // vor der Aussenwand. Gemessen wuerde dann eine Wand, kein Dungeon.
      // Deliberately only real SHAFTS, never the entrance: it sits at the edge
      // of the barrow, and six metres in front of it the camera stands outside.
      const schaechte = b.lichtschaechte.filter((l) => l.art === 'schacht');
      if (schaechte.length === 0) return null;
      let beste = schaechte[0];
      let bestQ = Infinity;
      for (const l of schaechte) {
        const q = (l.mitte.x - s.x) ** 2 + (l.mitte.z - s.z) ** 2;
        if (q < bestQ) { bestQ = q; beste = l; }
      }
      return { m: beste.mitte, art: beste.art, boden: beste.boden };
    });
    if (pose === null) {
      console.error(`Seed ${SEED} hat keinen Lichtschacht — mit DG2_SEED einen anderen waehlen.`);
      process.exitCode = 1;
      return;
    }
    // Augenhoehe ueber dem BODEN DES RAUMES UNTER DER MUENDUNG, sechs Meter
    // davor, Blick hinauf. Die Hoehe kommt aus `Lichtschacht.boden` und nicht
    // vom Spawnpunkt: Der erste Lauf setzte die Kamera auf Spawnhoehe vor einen
    // Schacht im Stockwerk darueber und mass 0,4 ms — die Bildzeit einer
    // Kamera IM FELS. Eine Messreihe, in der jeder Effekt 0 % kostet, ist so
    // entstanden, und sie sah aus wie ein Erfolg.
    // Eye height above the FLOOR OF THE ROOM BELOW THE MOUTH: the first run put
    // the camera at spawn height in front of a shaft one storey up and measured
    // 0.4 ms — the frame time of a camera INSIDE ROCK. That is how a series in
    // which every effect costs 0 % came about, and it looked like a success.
    const ABSTAND_M = 12;
    const px = pose.m.x;
    const pz = pose.m.z - ABSTAND_M;
    const py = pose.boden + 1.7;
    // Gezielt wird NICHT auf die Muendung, sondern auf 45 % der Schachthoehe.
    // Auf die Muendung selbst zu zielen hiesse bei einem 15-Meter-Schacht aus
    // sechs Metern Abstand: Blick 67 Grad nach oben — man sieht die Decke und
    // sonst nichts, und misst eine Bildflaeche aus zwei Wandplatten.
    // The aim point is 45 % of the shaft height, not the mouth: aiming at the
    // mouth of a 15 m shaft from six metres means looking 67 degrees up — one
    // sees the ceiling and measures a screen made of two wall slabs.
    const ziel = pose.boden + (pose.m.y - pose.boden) * 0.45;
    const neigung = -Math.atan2(ziel - py, ABSTAND_M) * (180 / Math.PI);
    KAMERA = `px=${px.toFixed(2)}&py=${py.toFixed(2)}&pz=${pz.toFixed(2)}&blick=0&neigung=${neigung.toFixed(1)}`;
    console.log(`Messstelle: ${pose.art} bei (${pose.m.x}, ${pose.m.y}, ${pose.m.z}) — ${KAMERA}`);
  }

  const gesammelt = new Map();
  const auswahl = REIHE.filter(([name]) => NUR === null || name.includes(NUR));
  for (let durchgang = 1; durchgang <= DURCHGAENGE; durchgang++) {
    for (const [name, query] of auswahl) {
      const r = await miss(seite, name, query);
      if (!gesammelt.has(name)) gesammelt.set(name, []);
      gesammelt.get(name).push(r);
      console.log(
        `[${durchgang}/${DURCHGAENGE}] ${name.padEnd(18)} p50 ${r.p50.toFixed(2)} ms ` +
          `(${(1000 / r.p50).toFixed(1)} fps) p95 ${r.p95.toFixed(2)} ms  ${JSON.stringify(r.effekte)}`
      );
    }
  }

  const median = (werte) => {
    const s = [...werte].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const zusammen = new Map();
  for (const [name, laeufe] of gesammelt) {
    zusammen.set(name, {
      // Der MITTELWERT traegt den Vergleich, nicht der Median.
      //
      // `performance.now()` ist in Chromium auf 100 µs gerundet. Bei einer
      // Bildzeit um 1,8 ms ist ein Median deshalb ein Vielfaches von 0,1 ms —
      // die feinste Stufe, die er ueberhaupt annehmen kann, sind 5,6 %. Ein
      // Effekt, der 3 % kostet, erscheint darin als 0 % oder als 5,6 %, je
      // nachdem, wo die Grenze gerade liegt; zwei Laeufe derselben Sache
      // widersprechen sich dann scheinbar. Der Mittelwert ueber 400 Bilder
      // mittelt die Rundung heraus.
      // The MEAN carries the comparison: `performance.now()` is rounded to
      // 100 µs, so at ~1.8 ms a median can only take steps of 5.6 %.
      mittel: median(laeufe.map((r) => r.mittel)),
      p50: median(laeufe.map((r) => r.p50)),
      p95: median(laeufe.map((r) => r.p95)),
      spanne: [Math.min(...laeufe.map((r) => r.mittel)), Math.max(...laeufe.map((r) => r.mittel))],
      effekte: laeufe[laeufe.length - 1].effekte,
    });
  }

  const grund = zusammen.get('mittel');
  const hochM1 = zusammen.get('hoch-M1');
  console.log('\n| Variante | Mittel ms | fps | p50 ms | p95 ms | Spanne Mittel | ggü. Mittel | ggü. Hoch-M1 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [name, r] of zusammen) {
    const zu = (b) => (b ? `${(((r.mittel - b.mittel) / b.mittel) * 100).toFixed(1)} %` : '—');
    console.log(
      `| ${name} | ${r.mittel.toFixed(3)} | ${(1000 / r.mittel).toFixed(0)} | ${r.p50.toFixed(2)} | ` +
        `${r.p95.toFixed(2)} | ${r.spanne[0].toFixed(3)}–${r.spanne[1].toFixed(3)} | ${zu(grund)} | ${zu(hochM1)} |`
    );
  }
  console.log('\nZeugen je Variante:');
  for (const [name, r] of zusammen) console.log(`  ${name}: ${JSON.stringify(r.effekte)}`);

  // ── Leckprobe: zehnmal Hoch <-> Mittel ────────────────────────────────
  // Der Auftrag verlangt „Stufe wechselbar zur Laufzeit ohne Leck". Das ist
  // keine Frage des Aussehens: Ein VolumetricLightScattering laesst seine
  // Verdeckungspassage in `camera.customRenderTargets` liegen, wenn man sich
  // auf Babylons `dispose(camera)` verlaesst — der Effekt waere weg, die
  // Kosten blieben, und nach zehn Wechseln liefe die Szene zehnmal zusaetzlich
  // durch die ganze Geometrie. Die Probe zaehlt danach nach.
  // Leak probe: ten tier switches. Babylon's `dispose(camera)` leaves the VLS
  // occlusion pass in `camera.customRenderTargets` — the effect gone, the cost
  // staying. This counts afterwards.
  await seite.goto(`http://localhost:${CLIENT_PORT}/dungeon2.html?seed=${SEED}&${KAMERA}&stufe=2`, {
    waitUntil: 'domcontentloaded',
  });
  await seite.waitForFunction(() => (window).__dg2 !== undefined, null, { timeout: 120000 });
  await seite.waitForTimeout(2000);
  const leck = await seite.evaluate(async () => {
    const dg = (window).__dg2;
    const zaehle = () => dg.atmosphaere.werte();
    const vorher = zaehle();
    for (let i = 0; i < 10; i++) {
      dg.stufe(1);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      dg.stufe(2);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await new Promise((r) => setTimeout(r, 500));
    return { vorher, nachher: zaehle() };
  });
  console.log('\nLeckprobe (10x Hoch<->Mittel):');
  console.log(`  vorher : ${JSON.stringify(leck.vorher.godrays)} ssr=${JSON.stringify(leck.vorher.ssr)}`);
  console.log(`  nachher: ${JSON.stringify(leck.nachher.godrays)} ssr=${JSON.stringify(leck.nachher.ssr)}`);
  const dicht = leck.nachher.godrays.passagen <= 1;
  console.log(`  ${dicht ? 'DICHT' : 'LECK'} — Verdeckungspassagen an der Kamera: ${leck.nachher.godrays.passagen}`);
  if (!dicht) process.exitCode = 1;
  if (fehlerZeilen.length > 0) {
    console.log(`\nKonsolenfehler (${fehlerZeilen.length}):`);
    for (const z of fehlerZeilen.slice(0, 20)) console.log(`  ${z}`);
  }
  await browser.close();
}

try {
  await main();
} finally {
  raeumeAuf();
}
