/**
 * fps-Benchmark: misst, was ein Spieler beim Sprinten durch die Welt spuert.
 *
 * Roadmap-Paket G12 (Messweg reparieren) — dieses Werkzeug war seit dem
 * Konten- und Ticketweg tot. Es meldete sich ueber einen Verbindungs-
 * bildschirm an (`#connect-btn`, `#player-name`, `#offline-toggle`), den
 * es nicht mehr gibt (`git grep connect-btn client/src` ist leer). Jedes
 * Leistungspaket der Roadmap braucht Vorher-Nachher-Zahlen aus GENAU
 * diesem Werkzeug — ohne einen funktionierenden Messweg gibt es keine.
 *
 * ANMELDUNG (neu, 12.09.2026): Testtoken statt Formular. Die Anmeldung
 * laeuft jetzt ueber ein signiertes Testtoken in localStorage plus
 * `?name=&t=` in der Adresszeile — derselbe Weg, den die Messbibliothek
 * `original-lib.mjs` gegen eine lokale Instanz benutzt. `t` ist die feste
 * Tageszeit (Standard 0.708333 = 17 Uhr): zwei Laeufe muessen dieselbe
 * Beleuchtung sehen, sonst vergleicht man Schattenkosten statt Codestand.
 *
 * WARUM HEADED: Chrome pausiert `requestAnimationFrame` fuer unsichtbare
 * Tabs — Babylons Game-Loop rendert dann keinen einzigen Frame, und ohne
 * echte GPU sind absolute Millisekunden ohnehin nicht auf Spieler-Hardware
 * uebertragbar. Dieses Skript startet deshalb ein SICHTBARES Fenster auf
 * DISPLAY=:0 und prueft die GPU, bevor es misst. Bricht ab, wenn nur ein
 * Software-Renderer da ist (SwiftShader/llvmpipe) — eine solche Messung
 * waere wertlos.
 *
 * STRECKE STATT ZEIT (der Kern des Umbaus): Gemessen wird eine feste
 * SPRINTSTRECKE, kein festes Zeitfenster. Bei fester Zeit laeuft der
 * schnellere Codestand weiter, durchquert mehr NEUES Gelaende und baut
 * dadurch mehr Chunks in derselben Messung — er misst sich also teurer,
 * genau WEIL er schneller ist. Bei fester Strecke sehen beide Staende
 * dieselbe Landschaft. Der Sprint laeuft dazu GERADEAUS in EINER festen
 * Richtung (kein Quadrat, kein Kreis): Wer im Quadrat laeuft, betritt
 * nach der ersten Runde nur noch schon gebaute Zellen und misst dann den
 * eingeschwungenen Zustand statt des laufenden Geländestroms, den ein
 * Spieler beim Erkunden tatsaechlich bezahlt. Start und Richtung stehen
 * fest (Vorgabe s. START_X/START_Z/YAW) und werden im Ergebnis mit der
 * TATSAECHLICH gelaufenen Strecke dokumentiert — sie kann von der
 * angeforderten leicht abweichen (Gelaende, Kollision), und genau das
 * soll sichtbar bleiben statt stillschweigend angenommen zu werden.
 *
 * FLOCK: Zwei gleichzeitige Messlaeufe auf derselben Maschine verfaelschen
 * beide (geteilte GPU/CPU). Dieses Skript nimmt sich deshalb SELBST die
 * Sperre `~/.cache/wov-mess.lock`, indem es sich einmal unter `flock`
 * neu startet — parallele Laeufe blockieren dann, statt sich gegenseitig
 * zu verfaelschen, ohne dass ein Aufrufer daran denken muss.
 *
 * MEHRERE RUNDEN GEGEN DIE SYSTEMLAST: `flock` haelt fremde Messlaeufe
 * fern, aber nicht die Arbeitsmaschine selbst — hier laufen nebenbei
 * Editor, Browser, gelegentlich Blender. Eine EINZELNE 150-m-Strecke traf
 * beim Bauen dieses Werkzeugs zwei Mal denselben Codestand mit p50 17,0
 * und 14,7 ms — 2,3 ms auseinander, mehr als die geforderte 1-ms-Zusage.
 * Die Strecke laeuft deshalb in `--laeufe` Runden (Standard 3) IN DERSELBEN
 * RICHTUNG WEITER (kein Zurueckteleportieren — jede Runde betritt weiter
 * NEUES Gelaende), und das gemeldete `frameZeitMs.p50` ist der MEDIAN der
 * Runden-p50-Werte: Eine einzelne von einer Lastspitze getroffene Runde
 * kippt damit nicht das Gesamtergebnis. p95/p99/Maximum kommen aus dem
 * GEPOOLTEN Bild-für-Bild-Datensatz aller Runden — dort hilft mehr Masse.
 * Die Einzelwerte je Runde bleiben im Ergebnis stehen, damit die Streuung
 * sichtbar bleibt und nicht im Median verschwindet.
 *
 * Aufruf:
 *   node tools/pw-fps-bench.mjs --url http://localhost:5291 --label baseline
 *   node tools/pw-fps-bench.mjs --url ... --strecke 250 --out mess/x.json
 */
import { chromium } from 'playwright';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ── flock: kein paralleler Messlauf ───────────────────────────────────
// Re-exec unter `flock`, statt vom Aufrufer zu verlangen, daran zu
// denken — die Sperre ist damit ein Merkmal des Werkzeugs, nicht der
// Disziplin dessen, der es aufruft.
if (!process.env.WOV_MESSSPERRE_GEHALTEN) {
  const lockDatei = `${process.env.HOME}/.cache/wov-mess.lock`;
  mkdirSync(dirname(lockDatei), { recursive: true });
  try {
    execFileSync(
      'flock',
      [lockDatei, process.execPath, process.argv[1], ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, WOV_MESSSPERRE_GEHALTEN: '1' } }
    );
  } catch (e) {
    process.exit(typeof e.status === 'number' ? e.status : 1);
  }
  process.exit(0);
}

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};

const URL_ZIEL = arg('url', 'http://localhost:5291');
const LABEL = arg('label', 'unbenannt');
/** Laufstrecke in Metern — die Messgroesse, nicht die Zeit. */
const STRECKE = Number(arg('strecke', 200));
/** Messrunden je Sitzung (Median der Runden-p50 gegen Systemlast, s. Kopf). */
const LAEUFE = Math.max(1, Number(arg('laeufe', 3)));
const AUFWAERMEN = Number(arg('aufwaermen', 6));
/**
 * UNGEMESSENE Vorlaufstrecke, GERADEAUS vor der eigentlichen Messung.
 *
 * Ohne sie traf die erste Messrunde direkt den anlaufenden Geländestrom
 * um den Teleportpunkt: In einer Testreihe lag Runde 1 bei p50 35 ms,
 * Runde 5 (dieselbe Sitzung, derselbe Codestand) bei 14,7 ms — eine
 * einmalige Anlaufspitze, keine Eigenschaft des Codes. Der Vorlauf
 * verbraucht diese Spitze, OHNE zurueckzuteleportieren: Die Messrunden
 * beginnen dahinter und liegen damit selbst weiterhin auf frischem,
 * niemals zuvor betretenem Gelände (s. Kopfkommentar „NEUES Gelaende").
 */
const VORLAUF = Number(arg('vorlauf', 60));
const OUT = arg('out', `mess/${LABEL}.json`);
/**
 * Fester Messort und feste Richtung. Vorgabe ist derselbe Referenzort,
 * den andere Leistungsmessungen des Projekts benutzen (dicht bewachsene
 * Zone) — ein fester Ort ist Bedingung fuer Vergleichbarkeit, an einer
 * leeren Kueste misst jeder Fix eine Verbesserung, die es nicht gibt.
 */
const START_X = Number(arg('x', 10077));
const START_Z = Number(arg('z', -18723));
/** Laufrichtung in Radiant. 0 = nach Norden, GERADEAUS bis zum Streckenende. */
const YAW = Number(arg('yaw', 0));
/** Feste Tageszeit (0..1). 0.708333 = 17 Uhr — dieselbe Beleuchtung je Lauf. */
const TIME = arg('t', '0.708333');
/** Spielername fuer die Messung — bewusst NICHT ein echter Spielername. */
const SPIELER = arg('spieler', `BenchBot${Date.now().toString(36).slice(-4)}`);
/** Notbremse gegen endloses Laufen (Wand, Wasser, Kollisionsfalle). */
const SICHERHEIT_S = Number(arg('sicherheit', Math.max(60, (STRECKE + VORLAUF) * 1.2)));

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

function commitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim();
  } catch {
    return 'unbekannt';
  }
}

const browser = await chromium.launch({
  headless: false,
  args: [
    // MUSS X11 sein. Unter Wayland startet Chromium zwar, meldet sich aber
    // nie ueber Playwrights --remote-debugging-pipe zurueck — der Start
    // laeuft dann stumm in den Timeout. Mit erzwungenem X11-Backend kommt
    // die Verbindung sofort, und ANGLE greift auf die echte GPU durch.
    '--ozone-platform=x11',
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
const kontext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await kontext.newPage();

const konsole = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') konsole.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
});
const seitenfehler = [];
page.on('pageerror', (e) => seitenfehler.push(e.message.slice(0, 300)));
const fehlanfragen = [];
page.on('response', (r) => {
  if (r.status() >= 400) fehlanfragen.push(`${r.status()} ${r.url()}`);
});
page.on('requestfailed', (r) => {
  fehlanfragen.push(`FAIL ${r.url()} (${r.failure()?.errorText ?? '?'})`);
});

console.log(`[bench] ${LABEL} -> ${URL_ZIEL}`);

// ── Testtoken VOR der ersten Navigation einbetten ─────────────────────
// (s. Notiz „Browser-Basic-Auth eingebettete Zugangsdaten"-Familie: was
// erst nach dem ersten Laden gesetzt wird, greift nicht rechtzeitig.)
await page.addInitScript(([t]) => localStorage.setItem('wov-session-token', t), [testToken()]);

await page.goto(`${URL_ZIEL}/?name=${SPIELER}&t=${TIME}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

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
try {
  await page.waitForFunction(
    () => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.scene?.activeCamera),
    undefined,
    { timeout: 180_000 }
  );
} catch {
  console.error('[bench] ABBRUCH: Welt kam nicht hoch.');
  console.error('  Fehlanfragen: ' + fehlanfragen.slice(0, 15).join('\n    '));
  console.error('  Konsole: ' + konsole.slice(0, 15).join('\n    '));
  await browser.close();
  process.exit(3);
}
// Ladebildschirm haengt am Gelaende — erst dann teleportieren.
await page.waitForFunction(() => window.__dbg?.terrain?.ready !== false, undefined, { timeout: 120_000 }).catch(() => {});
console.log('[bench] Welt steht.');

// Fenster fokussieren, sonst kommen die Tastaturereignisse nicht an.
await page.bringToFront();
// Mausfang VOR dem Blick, sonst greift keine Kamerasteuerung.
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

// ── An den Messort ────────────────────────────────────────────────────
//
// ES MUSS DER ADMIN-BEFEHL SEIN, nicht `__vb.teleport()`.
//
// `__vb.teleport()` ruft `player.debugTeleport()` — rein clientseitig. Der
// Server ist autoritativ und schnappt die Position im naechsten Tick
// zurueck. `__vb.admin('teleport x z')` geht ueber den Server und haelt.
const tpOk = await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [START_X, START_Z]);
if (!tpOk) {
  console.error('[bench] ABBRUCH: Admin-Teleport abgelehnt (keine Verbindung oder keine Adminrechte).');
  await browser.close();
  process.exit(5);
}
await page.waitForTimeout(3000);
// Gierwinkel bleibt clientseitig — der wird vom Server nicht korrigiert.
await page.evaluate(([yaw]) => {
  const p = window.__dbg.player.position;
  window.__vb.teleport(p.x, p.z, yaw);
}, [YAW]);

console.log(`[bench] Messort ${START_X}/${START_Z}, Richtung ${YAW} rad, aufwaermen ${AUFWAERMEN}s ...`);
await page.waitForTimeout(AUFWAERMEN * 1000);

// Ankunft PRUEFEN, nicht annehmen — ein stillschweigend wirkungsloser
// Teleport ist sonst nicht erkennbar, solange niemand die Position
// nachrechnet (Lehre aus dem 15.08.2026-Messfehler: 55 m unter Wasser
// gemessen, ohne dass es jemand bemerkte).
const angekommen = await page.evaluate(() => {
  const q = window.__dbg.player.position;
  return { x: q.x, y: q.y, z: q.z };
});
const abstand = Math.hypot(angekommen.x - START_X, angekommen.z - START_Z);
if (abstand > 150) {
  console.error(
    `[bench] ABBRUCH: Spieler steht ${abstand.toFixed(0)} m vom Messort entfernt ` +
      `(${angekommen.x.toFixed(0)}/${angekommen.z.toFixed(0)}), erwartet ${START_X}/${START_Z}.`
  );
  await browser.close();
  process.exit(6);
}
console.log(`[bench] am Messort, y=${angekommen.y.toFixed(1)}, Abweichung ${abstand.toFixed(0)} m`);

// ── UNGEMESSENER Vorlauf, GERADEAUS — verbraucht die Anlaufspitze ─────
// (s. Begruendung bei VORLAUF oben). Kein Zurueckteleportieren danach:
// die Messrunden schliessen direkt an, weiter auf frischem Gelaende.
if (VORLAUF > 0) {
  console.log(`[bench] Vorlauf ${VORLAUF} m (ungemessen) ...`);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const beginnVorlauf = Date.now();
  let sVorlauf = 0;
  let letztePosVorlauf = angekommen;
  while (sVorlauf < VORLAUF) {
    await page.waitForTimeout(200);
    const jetzt = await page.evaluate(() => {
      const p = window.__dbg.player.position;
      return { x: p.x, z: p.z };
    });
    sVorlauf += Math.hypot(jetzt.x - letztePosVorlauf.x, jetzt.z - letztePosVorlauf.z);
    letztePosVorlauf = jetzt;
    if ((Date.now() - beginnVorlauf) / 1000 > Math.max(30, VORLAUF * 1.2)) {
      console.warn(`[bench] Notbremse im Vorlauf — nur ${sVorlauf.toFixed(1)} m statt ${VORLAUF} m.`);
      break;
    }
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  console.log(`[bench] Vorlauf fertig: ${sVorlauf.toFixed(1)} m.`);
}

// ── Frame-Rekorder starten (laeuft ueber ALLE Runden durch) ───────────
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

/**
 * Eine Runde geradeaus laufen, bis `ziel` Meter seit Rundenbeginn
 * zurueckgelegt sind. KEIN Zurueckteleportieren zwischen Runden — die
 * naechste Runde startet exakt dort, wo die vorige endete, und betritt
 * damit garantiert weiter NEUES Gelaende (s. Kopfkommentar).
 *
 * Gibt die rohen Bildabstaende DIESER Runde zurueck (erster Wert
 * verworfen — er traegt die Restzeit der Wartepause vor der Runde, keine
 * echte Bilddauer) sowie das Teilsystemprofil, das GENAU diese Runde
 * misst (`__vb.profil()` liest und leert — deshalb vor jeder Runde
 * einmal aufgerufen, um den vorigen Stand zu verwerfen).
 */
async function runde(ziel) {
  await page.evaluate(() => window.__vb.profil());
  const abVorher = await page.evaluate(() => window.__bench.zeiten.length);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const beginn = Date.now();
  let s = 0;
  let letztePos = await page.evaluate(() => {
    const p = window.__dbg.player.position;
    return { x: p.x, z: p.z };
  });
  while (s < ziel) {
    await page.waitForTimeout(200);
    const jetzt = await page.evaluate(() => {
      const p = window.__dbg.player.position;
      return { x: p.x, z: p.z };
    });
    s += Math.hypot(jetzt.x - letztePos.x, jetzt.z - letztePos.z);
    letztePos = jetzt;
    if ((Date.now() - beginn) / 1000 > SICHERHEIT_S / LAEUFE) {
      console.warn(`[bench]   Notbremse in dieser Runde — nur ${s.toFixed(1)} m statt ${ziel.toFixed(1)} m.`);
      break;
    }
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const teilProfil = await page.evaluate(() => window.__vb.profil());
  const bilder = (await page.evaluate((v) => window.__bench.zeiten.slice(v), abVorher)).slice(1);
  return { strecke: s, dauerS: (Date.now() - beginn) / 1000, teilProfil, bilder };
}

// ── Der Sprint ueber die feste Strecke, GERADEAUS, in LAEUFE Runden ──
console.log(`[bench] Sprint ${STRECKE} m in Richtung ${YAW} rad, ${LAEUFE} Runde(n) ...`);
const runden = [];
let strecke = 0;
let dauerSprintS = 0;
const bilderGepoolt = [];
for (let r = 0; r < LAEUFE; r++) {
  const ziel = STRECKE / LAEUFE;
  const m = await runde(ziel);
  strecke += m.strecke;
  dauerSprintS += m.dauerS;
  bilderGepoolt.push(...m.bilder);
  const sortiert = [...m.bilder].sort((a, b) => a - b);
  const p50Runde = sortiert.length > 0 ? sortiert[Math.floor(sortiert.length * 0.5)] : NaN;
  runden.push({
    strecke: +m.strecke.toFixed(1),
    dauerS: +m.dauerS.toFixed(1),
    bilder: sortiert.length,
    p50: +p50Runde.toFixed(2),
    teilProfil: m.teilProfil,
  });
  console.log(`[bench]   Runde ${r + 1}: ${m.strecke.toFixed(1)} m, p50 ${p50Runde.toFixed(1)} ms, ${sortiert.length} Bilder`);
}

const roh = await page.evaluate(() => {
  window.__bench.laeuft = false;
  const scene = window.__dbg.scene;
  return {
    endPos: (() => {
      const q = window.__dbg.player.position;
      return { x: q.x, y: q.y, z: q.z };
    })(),
    aktiveMeshes: scene.getActiveMeshes().length,
    gesamtMeshes: scene.meshes.length,
    materialien: scene.materials.length,
  };
});

await browser.close();

// ── Auswertung ────────────────────────────────────────────────────────
if (bilderGepoolt.length < 20 * LAEUFE) {
  console.error(`[bench] ABBRUCH: nur ${bilderGepoolt.length} Bilder aufgezeichnet.`);
  process.exit(4);
}
// p95/p99/Maximum aus dem GEPOOLTEN Bild-fuer-Bild-Datensatz aller Runden
// (mehr Masse hilft der Schaetzung der Ausreisser). p50 dagegen ist der
// MEDIAN der RUNDEN-p50-Werte (s. Kopfkommentar) — robuster gegen eine
// einzelne von einer Lastspitze getroffene Runde.
const t = bilderGepoolt.slice().sort((a, b) => a - b);
const p = (q) => t[Math.min(t.length - 1, Math.floor(t.length * q))];
const ueber = (ms) => t.filter((x) => x > ms).length;
const rundenP50Sortiert = runden.map((r) => r.p50).sort((a, b) => a - b);
const p50Median = rundenP50Sortiert[Math.floor(rundenP50Sortiert.length / 2)];

/**
 * Teilsystem-Zeiten AUFS BILD gerechnet, ueber ALLE Runden zusammen:
 * `__vb.profil()` liefert je Abschnitt Summe/Maximum/Bilderzahl SEIT DEM
 * LETZTEN AUFRUF — hier also je Runde. Summe und Bilderzahl addieren sich
 * über die Runden, das Maximum ist das Maximum der Runden-Maxima; erst
 * danach wird durch die Gesamtbilderzahl geteilt.
 */
const teilsysteme = {};
for (const runde_ of runden) {
  for (const [name, m] of Object.entries(runde_.teilProfil ?? {})) {
    if (!m || typeof m !== 'object' || !('summe' in m) || !('max' in m) || !('n' in m)) continue;
    const e = (teilsysteme[name] ??= { summe: 0, max: 0, n: 0 });
    e.summe += m.summe;
    e.n += m.n;
    if (m.max > e.max) e.max = m.max;
  }
}
for (const name of Object.keys(teilsysteme)) {
  const e = teilsysteme[name];
  teilsysteme[name] = {
    mittelMsProBild: e.n > 0 ? +(e.summe / e.n).toFixed(3) : 0,
    maxMs: +Number(e.max).toFixed(2),
    bilder: e.n,
  };
}

const letzteRunde = runden[runden.length - 1];

const ergebnis = {
  label: LABEL,
  zeitpunkt: new Date().toISOString(),
  commit: commitHash(),
  gpu: gpu.renderer,
  aufloesung: '1600x900',
  uhrzeit: TIME,
  messort: { x: START_X, z: START_Z, yaw: YAW },
  endPosition: roh.endPos,
  strecke: { angefordert: STRECKE, gelaufen: +strecke.toFixed(1), dauerS: +dauerSprintS.toFixed(1), laeufe: LAEUFE, vorlauf: VORLAUF },
  runden: runden.map(({ teilProfil, ...rest }) => rest),
  frames: t.length,
  frameZeitMs: {
    p50: +p50Median.toFixed(2),
    p95: +p(0.95).toFixed(2),
    p99: +p(0.99).toFixed(2),
    max: +t[t.length - 1].toFixed(2),
  },
  ausreisser: {
    ueber16_7ms: ueber(16.7),
    ueber33ms: ueber(33),
    ueber50ms: ueber(50),
    anteilUeber16_7: +((ueber(16.7) / t.length) * 100).toFixed(2),
    anteilUeber33: +((ueber(33) / t.length) * 100).toFixed(2),
    anteilUeber50: +((ueber(50) / t.length) * 100).toFixed(2),
  },
  teilsysteme,
  zeichenaufrufeProBild: letzteRunde.teilProfil?.zeichenaufrufeProBild ?? -1,
  aktiveMeshes: roh.aktiveMeshes,
  gesamtMeshes: roh.gesamtMeshes,
  aktivNachTyp: letzteRunde.teilProfil?.aktivNachTyp ?? null,
  materialien: roh.materialien,
  schattenwerfer: letzteRunde.teilProfil?.schattenwerfer ?? -1,
  schattenKaskaden: letzteRunde.teilProfil?.schattenKaskaden ?? -1,
  fehlanfragen: fehlanfragen.slice(0, 30),
  konsolenfehler: konsole.slice(0, 30),
  seitenfehler: seitenfehler.slice(0, 10),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(ergebnis, null, 2));

console.log('');
console.log(`  Strecke                 : ${ergebnis.strecke.gelaufen} m von ${STRECKE} m angefordert (${LAEUFE} Runden), in ${ergebnis.strecke.dauerS} s`);
console.log(`  Frame-Zeit p50/p95/p99  : ${ergebnis.frameZeitMs.p50} / ${ergebnis.frameZeitMs.p95} / ${ergebnis.frameZeitMs.p99} ms`);
console.log(`  Maximum                 : ${ergebnis.frameZeitMs.max} ms`);
console.log(
  `  Frames >16,7/33/50ms    : ${ergebnis.ausreisser.ueber16_7ms} / ${ergebnis.ausreisser.ueber33ms} / ` +
    `${ergebnis.ausreisser.ueber50ms} von ${t.length}`
);
console.log(`  Draw Calls je Bild      : ${ergebnis.zeichenaufrufeProBild}`);
console.log(`  aktive Meshes           : ${ergebnis.aktiveMeshes} von ${ergebnis.gesamtMeshes}`);
console.log(`  Materialien             : ${ergebnis.materialien}`);
console.log(`  Schattenwerfer          : ${ergebnis.schattenwerfer} x ${ergebnis.schattenKaskaden} Kaskaden`);
console.log(`  Teilsysteme (avg/max ms je Bild): ${JSON.stringify(teilsysteme)}`);
console.log(`  Commit ${ergebnis.commit} | GPU ${ergebnis.gpu} | ${ergebnis.aufloesung} | t=${TIME}`);
console.log(`  -> ${OUT}`);
