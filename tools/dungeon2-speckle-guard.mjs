#!/usr/bin/env node
/**
 * Waechter gegen die Parallax-Sprenkel auf den Dungeon-Waenden (M2, Stufe Hoch).
 *
 * Auf Stufe Hoch zeigte das Mauerwerk farbige Punkte und kurze senkrechte
 * Striche ueber dem Stein — im Beweisbild `dungeon2-voll-vergleich.png`
 * (rechte Haelfte) zu sehen, auf Stufe Mittel nicht. In der Vorschau, aus der
 * Naehe und ohne Grundlicht, ist derselbe Fehler viel groesser: Aus den hellen
 * Fugen werden pechschwarze Keile mit harten Kanten. Beides ist dieselbe
 * Ursache — der Parallax-Versatz schiebt an streifenden Blickwinkeln fast eine
 * ganze Kachel weit.
 * Guard against the parallax speckle on the dungeon walls at tier High. In the
 * game the defect reads as coloured dots and short vertical dashes on distant
 * masonry; in the preview, close up and without ambient light, it is the same
 * cause writ large: bright mortar joints turn into hard-edged pitch black
 * wedges.
 *
 *   node tools/dungeon2-speckle-guard.mjs [--bilder]
 *
 * ── Was gemessen wird, und warum genau das ────────────────────────────
 * Nicht „wie bunt ist das Bild" — daran ist der erste Anlauf gescheitert. Der
 * Fehler und das erwuenschte Bild teilen sich dieselbe Farbwelt (warmes
 * Fackellicht auf braunem Stein), und ein Farbmass hielt Stufe Mittel fuer
 * schlimmer als Stufe Hoch.
 * NOT "how colourful is the image" — the first attempt failed on exactly that:
 * defect and intent share the same palette, and a colour measure rated tier
 * Medium worse than tier High.
 *
 * Gemessen wird stattdessen der UNTERSCHIED, den der Effekt macht, gegen
 * dieselbe Stufe mit demselben Bild ohne ihn (`?parallax=0`). Das ist die
 * einzige Vergleichsgroesse, in der sich nur der Effekt unterscheidet und
 * nicht auch SSAO, Aufloesung und Nachbearbeitung.
 * Measured instead is the DIFFERENCE the effect makes against the SAME tier
 * without it — the only comparison in which nothing else varies.
 *
 * Daraus zwei Zahlen, und beide werden gebraucht:
 *
 *   Umkippanteil  Bildpunkte, deren Helligkeit um mehr als 80 von 255 springt.
 *                 Parallax ist ein Relief-Effekt: er darf Stein verschieben,
 *                 aber er darf keine beleuchtete Fuge in eine schwarze Flaeche
 *                 umkippen. Gemessen: 2,10 % im Fehlerzustand, 0,02 % bei
 *                 einem Zehntel der Tiefe.
 *   Wirkanteil    Bildpunkte, die sich ueberhaupt aendern (>= 2 von 255).
 *                 Ohne diese zweite Zahl waere der Waechter mit einem
 *                 ausgeschalteten Parallax gruen — und genau das ist der
 *                 Fix, den Mike NICHT will (Vault: „Messzellen brauchen
 *                 Zeugen").
 * Two numbers, and both are needed: the FLIP share (pixels whose brightness
 * jumps by more than 80 of 255 — a relief effect may move stone, it may not
 * turn a lit joint into a black surface) and the EFFECT share (pixels that
 * change at all). Without the second number the guard would be green with
 * parallax switched off, which is precisely the fix nobody wants.
 *
 * ── Die Rauschzeile ist keine Zugabe ──────────────────────────────────
 * Zwei Seitenaufrufe zeigen NICHT dasselbe Bild: Die Fackeln flackern, und
 * die Flamme steht beim zweiten Laden in einer anderen Phase. Gemessen sind
 * das rund 8 % Wirkanteil und 0,02 % Umkippanteil, ohne dass sich irgendein
 * Effekt geaendert haette. Die Zeile `rausch` misst genau diesen Abstand —
 * dieselbe Adresse zweimal — und der Wirkanteil des Effekts wird gegen SIE
 * gehalten, nicht gegen null. Eine feste Zahl waere hier eine Erfindung.
 * The noise row is not a garnish: two page loads do not show the same image
 * because the torches flicker. `rausch` measures the same URL twice, and the
 * effect share is judged against IT rather than against zero.
 *
 * ── Warum ohne Grundlicht (`?ambient=0`) ──────────────────────────────
 * Das Beweisbild entstand nachts in einem Grab mit `ambientLicht: 0`. Mit dem
 * Grundlicht der Vorschau (0,55) ueberstrahlt Streulicht die schwarzen Keile,
 * und der Umkippanteil faellt unter die Nachweisgrenze — der Waechter waere
 * dann gruen, obwohl der Fehler dasteht.
 * Without ambient light, because that is the state the proof shot was taken in;
 * with the preview's ambient the black wedges wash out below the detection
 * threshold and the guard would be green with the defect in plain sight.
 *
 * ── Warum die Bildpunkte aus der Leinwand kommen und nicht aus einem PNG ──
 * `page.screenshot()` liefert auch die Meldezeile der Vorschau — schwarzer
 * Text auf hellem Grund waere der groesste Sprung im ganzen Bild. Gelesen wird
 * deshalb NUR die 3D-Leinwand (`preserveDrawingBuffer: true`).
 * The pixels come from the canvas, not from a page screenshot: the preview's
 * status line would dominate the measurement.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const BILDER = argv.includes('--bilder');
const CLIENT_PORT = Number(process.env.DG2_PORT ?? 5299);
const BILD_ORDNER = `${process.env.HOME}/.cache/wov-tripo-test`;
const SEED = Number(process.env.DG2_SEED ?? 2) | 0;

/** ANGLE/Vulkan statt SwiftShader (Vault). / ANGLE/Vulkan, not SwiftShader. */
const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/** Helligkeitssprung, ab dem ein Bildpunkt „umgekippt" ist (0..255). */
/** Brightness jump from which a pixel counts as flipped. */
const UMKIPP_SCHWELLE = Number(process.env.DG2_UMKIPP_SCHWELLE ?? 80);

/**
 * Erlaubter Umkippanteil in Prozent. Gemessen wurde 2,10 % im Fehlerzustand
 * und 0,02 % bei einem Zehntel der Parallaxtiefe; 0,30 % liegt eine
 * Zehnerpotenz unter dem Fehler und eine ueber dem gesunden Zustand.
 * Allowed flip share in per cent — a measurement, not a taste.
 */
const UMKIPP_GRENZE = Number(process.env.DG2_UMKIPP_GRENZE ?? 0.3);

/**
 * Wie viel mehr als das Flackerrauschen der Effekt aendern muss. Drei ist
 * kein Geschmack, sondern der Abstand, den die Messung hergibt: Rauschen rund
 * 8 %, der schwaechste noch sinnvolle Parallax (ein Zehntel der Tiefe) 13,7 %,
 * der Vollausbau 69 %.
 * How many times the flicker noise the effect must exceed.
 */
const WIRK_FAKTOR = Number(process.env.DG2_WIRK_FAKTOR ?? 3);

/**
 * Die Messreihe: je Zeile ein Name, die Adresse MIT Effekt und die Adresse
 * OHNE ihn. Die Zeile `mittel` ist der Gegenbeweis — dort darf sich nichts
 * unterscheiden, weil die Stufe Mittel gar keinen Parallax kennt.
 * The series: per row a name, the URL WITH the effect and the one WITHOUT.
 * The `mittel` row is the counter-proof — nothing may differ there.
 */
const REIHE = [
  ['rausch', 'stufe=2&ambient=0', 'stufe=2&ambient=0'],
  ['hoch-voll', 'stufe=2&ambient=0', 'stufe=2&ambient=0&parallax=0'],
  ['mittel', 'stufe=1&ambient=0', 'stufe=1&ambient=0&parallax=0'],
];

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
 * Ein Bild holen: Leinwand in eine Hilfsleinwand, Bildpunkte heraus, dazu der
 * Zeuge, welche Effekte tatsaechlich haengen.
 * Grab one frame from the canvas plus the witness of which effects are live.
 */
const HOLE_BILD = () => {
  const leinwand = document.getElementById('leinwand');
  const hilfs = document.createElement('canvas');
  hilfs.width = leinwand.width;
  hilfs.height = leinwand.height;
  const ctx = hilfs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(leinwand, 0, 0);
  const bild = ctx.getImageData(0, 0, hilfs.width, hilfs.height);
  return {
    breite: hilfs.width,
    hoehe: hilfs.height,
    // Nur die Helligkeit reist zurueck nach Node — ein Viertel der Datenmenge,
    // und der Vergleich braucht nichts anderes.
    // Only luminance travels back to Node.
    licht: Array.from({ length: hilfs.width * hilfs.height }, (_unbenutzt, i) => {
      const p = i * 4;
      return Math.round(
        bild.data[p] * 0.299 + bild.data[p + 1] * 0.587 + bild.data[p + 2] * 0.114
      );
    }),
    png: hilfs.toDataURL('image/png'),
    effekte: window.__dg2.effekte(),
  };
};

async function bild(seite, query, kamera) {
  const url = `http://localhost:${CLIENT_PORT}/dungeon2.html?seed=${SEED}&${kamera}&${query}`;
  await seite.goto(url, { waitUntil: 'domcontentloaded' });
  await seite.waitForFunction(() => window.__dg2 !== undefined, null, { timeout: 120000 });
  // Shader-Uebersetzung abwarten: Ein halb uebersetztes Material zeigt keine
  // Waende und damit auch keinen Fehler.
  // Wait for shader compilation — a half compiled material shows no walls.
  await seite.waitForTimeout(4000);
  return seite.evaluate(HOLE_BILD);
}

function speichere(name, datenUrl) {
  mkdirSync(BILD_ORDNER, { recursive: true });
  writeFileSync(
    `${BILD_ORDNER}/dungeon2-sprenkel-${name}.png`,
    Buffer.from(datenUrl.split(',')[1], 'base64')
  );
}

async function main() {
  const vite = starte(
    'vite',
    resolve(WURZEL, 'node_modules/.bin/vite'),
    ['--port', String(CLIENT_PORT)],
    resolve(WURZEL, 'client')
  );
  await warteAufZeile(vite, /Local:|localhost:/, 120);

  const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
  const seite = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const fehlerZeilen = [];
  seite.on('console', (m) => {
    // Die 404 der fehlenden Deko-GLBs dieser Maschine sind bekannt und gehoeren
    // nicht zum Material. / The known missing decor GLBs of this machine.
    if (m.type() === 'error' && !/404|Not Found/.test(m.text())) fehlerZeilen.push(m.text());
  });
  seite.on('pageerror', (f) => fehlerZeilen.push(String(f)));

  await seite.goto(`http://localhost:${CLIENT_PORT}/dungeon2.html?seed=${SEED}&arrays=0`, {
    waitUntil: 'domcontentloaded',
  });
  await seite.waitForFunction(() => window.__dg2 !== undefined, null, { timeout: 120000 });
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
    raeumeAuf();
    await browser.close();
    return;
  }

  // Dieselbe Kamera wie `tools/pw-dungeon2-effekte.mjs`: der dem Spawnpunkt
  // naechste Lichtschacht, 12 m davor, Blick auf 45 % der Schachthoehe. Eine
  // andere Kamera ist eine andere Messung.
  // The same camera as the cost measurement — a different camera is a
  // different measurement.
  let KAMERA = process.env.DG2_KAMERA ?? null;
  if (KAMERA === null) {
    const pose = await seite.evaluate(() => {
      const b = window.__dg2.bauer;
      const s = b.spawnPunkt;
      const schaechte = b.lichtschaechte.filter((l) => l.art === 'schacht');
      if (schaechte.length === 0) return null;
      let beste = schaechte[0];
      let bestQ = Infinity;
      for (const l of schaechte) {
        const q = (l.mitte.x - s.x) ** 2 + (l.mitte.z - s.z) ** 2;
        if (q < bestQ) {
          bestQ = q;
          beste = l;
        }
      }
      return { m: beste.mitte, boden: beste.boden };
    });
    if (pose === null) {
      console.error(`Seed ${SEED} hat keinen Lichtschacht.`);
      process.exitCode = 1;
      raeumeAuf();
      await browser.close();
      return;
    }
    const ABSTAND_M = 12;
    const py = pose.boden + 1.7;
    const ziel = pose.boden + (pose.m.y - pose.boden) * 0.45;
    const neigung = -Math.atan2(ziel - py, ABSTAND_M) * (180 / Math.PI);
    KAMERA =
      `px=${pose.m.x.toFixed(2)}&py=${py.toFixed(2)}&pz=${(pose.m.z - ABSTAND_M).toFixed(2)}` +
      `&blick=0&neigung=${neigung.toFixed(1)}`;
  }
  console.log(`Kamera: ${KAMERA}`);
  console.log(
    `Umkippschwelle ${UMKIPP_SCHWELLE}/255 · erlaubt ${UMKIPP_GRENZE} % · ` +
      `Wirkung mindestens das ${WIRK_FAKTOR}-fache des Flackerrauschens\n`
  );

  const zeilen = [];
  for (const [name, mitQuery, ohneQuery] of REIHE) {
    const mit = await bild(seite, mitQuery, KAMERA);
    const ohne = await bild(seite, ohneQuery, KAMERA);
    if (mit.licht.length !== ohne.licht.length) throw new Error('Bildgroessen unterscheiden sich');
    let umkipp = 0;
    let wirkung = 0;
    for (let i = 0; i < mit.licht.length; i++) {
      const d = Math.abs(mit.licht[i] - ohne.licht[i]);
      if (d >= 2) wirkung++;
      if (d > UMKIPP_SCHWELLE) umkipp++;
    }
    const n = mit.licht.length;
    const r = {
      umkippProzent: (umkipp / n) * 100,
      wirkProzent: (wirkung / n) * 100,
      effekte: mit.effekte,
    };
    zeilen.push([name, r]);
    if (BILDER) {
      speichere(`${name}-mit`, mit.png);
      speichere(`${name}-ohne`, ohne.png);
    }
    const p = r.effekte?.parallax;
    console.log(
      `${name.padEnd(12)} umgekippt ${r.umkippProzent.toFixed(3).padStart(7)} %  ` +
        `gewirkt ${r.wirkProzent.toFixed(2).padStart(6)} %  ` +
        `parallax=${p?.erlaubt ? p.schritte : 'aus'}`
    );
  }
  await browser.close();
  raeumeAuf();

  if (fehlerZeilen.length > 0) {
    console.log(`\nKonsolenfehler (${fehlerZeilen.length}):`);
    for (const z of fehlerZeilen.slice(0, 10)) console.log(`  ${z}`);
  }

  const voll = zeilen.find(([n]) => n === 'hoch-voll')[1];
  const mittel = zeilen.find(([n]) => n === 'mittel')[1];
  const rausch = zeilen.find(([n]) => n === 'rausch')[1];
  const wirkGrenze = rausch.wirkProzent * WIRK_FAKTOR;
  const klagen = [];
  if (voll.umkippProzent > UMKIPP_GRENZE) {
    klagen.push(
      `Stufe Hoch kippt ${voll.umkippProzent.toFixed(3)} % der Bildpunkte um ` +
        `(erlaubt ${UMKIPP_GRENZE} %) — die Sprenkel sind da.`
    );
  }
  if (voll.wirkProzent < wirkGrenze) {
    klagen.push(
      `Parallax aendert nur ${voll.wirkProzent.toFixed(2)} % der Bildpunkte, das ` +
        `Flackern allein schon ${rausch.wirkProzent.toFixed(2)} % ` +
        `(gefordert ${wirkGrenze.toFixed(2)} %) — der Effekt ist praktisch aus.`
    );
  }
  // Die Stufe Mittel kennt den Parallax-Zweig nicht; was sich zwischen ihren
  // beiden Aufnahmen unterscheidet, darf nur das Flackern sein.
  // Tier Medium does not know the branch; only the flicker may differ.
  if (mittel.umkippProzent > UMKIPP_GRENZE) {
    klagen.push(
      `Stufe Mittel kippt ${mittel.umkippProzent.toFixed(3)} % um — sie soll den ` +
        `Zweig gar nicht kennen.`
    );
  }
  if (klagen.length > 0) {
    console.error('\nROT:');
    for (const k of klagen) console.error(`  ${k}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nGRÜN: Stufe Hoch kippt ${voll.umkippProzent.toFixed(3)} % um und wirkt auf ` +
        `${voll.wirkProzent.toFixed(2)} % der Bildpunkte.`
    );
  }
}

main().catch((f) => {
  console.error(f);
  raeumeAuf();
  process.exit(1);
});
