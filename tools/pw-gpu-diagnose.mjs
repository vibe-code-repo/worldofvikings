/**
 * Wohin geht die Frame-Zeit — GPU oder CPU? Und was liegt im VRAM?
 *
 * WARUM DIESES SKRIPT: Die Vermutung "wir lagern zu wenig auf die GPU aus"
 * ist eine Hypothese, keine Messung. Waere die GPU der Engpass, waeren die
 * Frame-Zeiten gleichmaessig hoch. Gemessen wurde aber ein Median von
 * 7,8 ms bei Einzelframes bis 46 ms — die Signatur eines blockierenden
 * CPU-Postens. Dieses Skript trennt beides sauber, statt zu raten.
 *
 * Babylons `SceneInstrumentation` liefert dafuer getrennte Zaehler:
 * gpuFrameTime (echte GPU-Zeit ueber EXT_disjoint_timer_query_webgl2),
 * frameTime, renderTime, activeMeshesEvaluationTime, interFrameTime.
 *
 * VRAM wird geschaetzt, nicht gemessen — WebGL gibt die Belegung nicht
 * heraus. Die Schaetzung summiert Texturen (Breite x Hoehe x Bytes je
 * Texel, plus ein Drittel fuer Mipmaps) und Geometrie (Vertex- und
 * Indexpuffer). Das ist die Untergrenze; Treiberoverhead, Render-Targets
 * und Schattenkarten kommen obendrauf und werden getrennt ausgewiesen.
 *
 * Aufruf:
 *   node tools/pw-gpu-diagnose.mjs --url http://localhost:5280 --out mess/gpu.json
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};

const URL_ZIEL = arg('url', 'http://localhost:5280');
const OUT = arg('out', 'mess/gpu-diagnose.json');
const SEKUNDEN = Number(arg('sekunden', 20));
const AUFWAERMEN = Number(arg('aufwaermen', 8));
const START_X = Number(arg('x', -16900));
const START_Z = Number(arg('z', -5350));
const SPIELER = arg('spieler', 'DiagBot');
const WENDE = Number(arg('wende', 5));
/**
 * Testflug-Modus: so testet Mike wirklich.
 *
 * Der Testflug-Knopf im Editor oeffnet `/?offline=1&layout=editor` — rein
 * clientseitige Weltgenerierung, KEINE Verbindung zum wov-server und
 * damit keine Server-ZDOs. Das ist ein anderer Codepfad als der
 * Online-Modus, und er baut die Welt aus dem Editor-Entwurf.
 *
 * Der Entwurf liegt in `localStorage['wov-editor-layout']` — ein frischer
 * Playwright-Browser hat ihn nicht, dann meldet der Client
 * "[Testflug] Kein Editor-Entwurf in localStorage" und baut still eine
 * ANDERE Welt. Deshalb wird das Weltdokument hier vor dem Seitenaufbau
 * eingespielt.
 */
const TESTFLUG = process.argv.includes('--testflug');
const LAYOUT = arg('layout', '');
/**
 * Vollstaendige Umgebung aus dem echten Browserprofil.
 *
 * Datei mit {"wov-editor-layout": "...", "valheim-babylon-settings-v1":
 * "..."} — ausgelesen aus Firefox' localStorage-Datenbank. Ohne die
 * misst man mit den VOREINSTELLUNGEN, und die sind eine Stufe niedriger
 * als das, was Mike faehrt (Detail/Schatten/Wasser je 3 statt 2, dazu
 * distantShadows an). Gerade waterQuality trifft `bakeShoreRows()`, den
 * dominanten Posten — mit der falschen Stufe misst man das Problem zu
 * klein.
 */
const UMGEBUNG = arg('umgebung', '');

const browser = await chromium.launch({
  headless: false,
  args: [
    // Siehe pw-fps-bench.mjs: unter Wayland meldet sich Chromium nie
    // ueber die Debug-Pipe zurueck.
    '--ozone-platform=x11',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    // Ohne das liefert EXT_disjoint_timer_query_webgl2 nichts: Chrome
    // schaltet die Zeitabfragen aus Sicherheitsgruenden (Timing-Angriffe)
    // standardmaessig ab. Ohne sie gibt es keine echte GPU-Zeit.
    '--enable-webgl-draft-extensions',
    '--disable-features=WebGLTimerQueryRestriction',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const fehlanfragen = [];
page.on('response', (r) => {
  if (r.status() >= 400) fehlanfragen.push(`${r.status()} ${r.url()}`);
});

const ZIEL = TESTFLUG ? `${URL_ZIEL.replace(/\/$/, '')}/?offline=1&layout=editor` : URL_ZIEL;
console.log(`[gpu] ${ZIEL}${TESTFLUG ? '  (Testflug)' : ''}`);

if (UMGEBUNG) {
  const werte = JSON.parse(readFileSync(UMGEBUNG, 'utf8'));
  await page.addInitScript((eintraege) => {
    try {
      for (const [k, v] of Object.entries(eintraege)) if (v != null) localStorage.setItem(k, v);
    } catch {
      /* egal */
    }
  }, werte);
  const e = Object.keys(werte);
  console.log(`[gpu] Umgebung eingespielt: ${e.join(', ')}`);
  try {
    const st = JSON.parse(werte['valheim-babylon-settings-v1'] ?? '{}');
    console.log(
      `[gpu]   Detail ${st.detailQuality} · Schatten ${st.shadowQuality} · Wasser ${st.waterQuality} · ` +
        `Gras ${st.grassDensity} · Renderskala ${st.renderScale} · Fernschatten ${st.distantShadows}`
    );
  } catch {
    /* egal */
  }
} else if (TESTFLUG && LAYOUT) {
  const entwurf = readFileSync(LAYOUT, 'utf8');
  await page.addInitScript((roh) => {
    try {
      localStorage.setItem('wov-editor-layout', roh);
    } catch {
      /* egal — dann meldet der Client es selbst */
    }
  }, entwurf);
  const j = JSON.parse(entwurf);
  console.log(`[gpu] Editor-Entwurf eingespielt: ${(j.regions ?? []).length} Regionen, ${(j.placements ?? []).length} Platzierungen`);
}

await page.goto(ZIEL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

if (!TESTFLUG) {
  // Online: erst durch den Verbindungsbildschirm.
  await page.waitForSelector('#connect-btn', { timeout: 30_000 });
  await page.fill('#player-name', SPIELER);
  await page.uncheck('#offline-toggle').catch(() => {});
  await page.click('#connect-btn');
}
await page.waitForFunction(() => Boolean(window.__vb?.profil && window.__dbg?.player), { timeout: 180_000 });
console.log('[gpu] Welt steht.');

await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

// Serverseitig positionieren — der Client-Teleport ist wirkungslos.
// Online MUSS der Admin-Befehl her (der Server korrigiert die Position
// sonst zurueck). Im Testflug gibt es keinen Server — dort wirkt der
// clientseitige Teleport, und der Admin-Befehl liefe ins Leere.
const tpOk = TESTFLUG
  ? await page.evaluate(([x, z]) => {
      window.__vb.teleport(x, z, 0);
      return true;
    }, [START_X, START_Z])
  : await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [START_X, START_Z]);
if (!tpOk) {
  console.error('[gpu] ABBRUCH: Teleport abgelehnt.');
  await browser.close();
  process.exit(5);
}
await page.waitForTimeout(3000);

// ── Land suchen ───────────────────────────────────────────────────────
//
// Zweiter Anlauf derselben Lehre: Erst lief die ganze Messreihe im
// leeren Ozean, weil der Teleport wirkungslos war. Dann lag der
// Polygon-Schwerpunkt einer Insel im Wasser — ein Mittelwert ueber
// Eckpunkte trifft bei konkaver Form eben nicht das Innere.
//
// Der Wasserspiegel liegt bei 30 m (shared/src/worldgen/Heightmap.ts).
// Statt einen Punkt zu RATEN wird hier ein Raster um das Ziel abgetastet
// und der hoechstgelegene Punkt genommen, der sicher ueber Wasser liegt.
const LAND_MINDESTHOEHE = Number(arg('landhoehe', 34));
const platz = await page.evaluate(
  ([zx, zz, mindest]) => {
    const w = window.__dbg.world;
    if (!w?.getGroundHeight) return null;
    let best = null;
    // Ringweise nach aussen: der naechstgelegene brauchbare Punkt gewinnt.
    for (const r of [0, 64, 128, 192, 256, 384, 512, 768, 1024]) {
      const schritt = r === 0 ? 1 : 8;
      for (let i = 0; i < schritt; i++) {
        const w2 = (i / schritt) * Math.PI * 2;
        const x = zx + Math.cos(w2) * r;
        const z = zz + Math.sin(w2) * r;
        const h = w.getGroundHeight(x, z);
        if (h >= mindest && (!best || h > best.h)) best = { x, z, h, r };
      }
      if (best) break;
    }
    return best;
  },
  [START_X, START_Z, LAND_MINDESTHOEHE]
);

if (!platz) {
  console.error(
    `[gpu] ABBRUCH: im Umkreis von 1024 m um ${START_X}/${START_Z} kein Punkt ueber ${LAND_MINDESTHOEHE} m gefunden — ` +
      'das ist offenes Wasser. Anderen Messort waehlen.'
  );
  await browser.close();
  process.exit(7);
}
console.log(
  `[gpu] Land gefunden: ${platz.x.toFixed(0)}/${platz.z.toFixed(0)}, Boden ${platz.h.toFixed(1)} m ` +
    `(${platz.r} m vom Zielpunkt)`
);

// Dorthin setzen und erst DANN aufwaermen.
if (TESTFLUG) {
  await page.evaluate(([x, z]) => window.__vb.teleport(x, z, 0), [platz.x, platz.z]);
} else {
  await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x.toFixed(0)} ${z.toFixed(0)}`), [platz.x, platz.z]);
}
await page.waitForTimeout(AUFWAERMEN * 1000);

// Ankunft UND Trockenheit pruefen — beides ist schon schiefgegangen.
const lage = await page.evaluate(
  ([x, z]) => {
    const p = window.__dbg.player.position;
    return { abstand: Math.hypot(p.x - x, p.z - z), y: p.y, boden: window.__dbg.world.getGroundHeight(p.x, p.z) };
  },
  [platz.x, platz.z]
);
if (lage.abstand > 150) {
  console.error(`[gpu] ABBRUCH: ${lage.abstand.toFixed(0)} m vom Messort entfernt.`);
  await browser.close();
  process.exit(6);
}
if (lage.boden < 30) {
  console.error(`[gpu] ABBRUCH: Boden liegt bei ${lage.boden.toFixed(1)} m, Wasserspiegel ist 30 m — der Laeufer steht im Wasser.`);
  await browser.close();
  process.exit(8);
}
console.log(`[gpu] am Messort, Boden ${lage.boden.toFixed(1)} m, Spieler y=${lage.y.toFixed(1)} — an Land.`);

// ── Instrumentierung anhaengen ────────────────────────────────────────
const instrOk = await page.evaluate(async () => {
  const scene = window.__dbg.scene;
  const engine = scene.getEngine();
  // Babylon wird als ES-Modul gebuendelt; die Klasse ist nicht global.
  // Ueber den Konstruktor einer vorhandenen Instanz kommen wir nicht an
  // sie heran — deshalb der Umweg ueber den dynamischen Import, den der
  // Bundler mitgebaut hat.
  const mod = await import('@babylonjs/core/Instrumentation/sceneInstrumentation.js').catch(() => null);
  if (!mod?.SceneInstrumentation) return { ok: false, grund: 'SceneInstrumentation nicht importierbar' };
  const si = new mod.SceneInstrumentation(scene);
  si.captureGPUFrameTime = true;
  si.captureFrameTime = true;
  si.captureRenderTime = true;
  si.captureActiveMeshesEvaluationTime = true;
  si.captureInterFrameTime = true;
  si.captureRenderTargetsRenderTime = true;
  window.__si = si;
  const gl = engine._gl;
  return {
    ok: true,
    zeitabfrageDa: Boolean(
      gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || gl?.getExtension?.('EXT_disjoint_timer_query')
    ),
  };
});
console.log(`[gpu] Instrumentierung: ${JSON.stringify(instrOk)}`);

// ── Sprint mit laufender Messung ──────────────────────────────────────
// Feinmessung erst JETZT einschalten: Sie soll nur den Sprint erfassen,
// nicht den Weltaufbau. Und sie kostet performance.now()-Aufrufe, die im
// Aufwaermen nichts beitragen.
const feinDa = await page.evaluate(() => {
  if (typeof window.__vb.feinmessung !== 'function') return false;
  window.__vb.feinmessung(true);
  return true;
});
console.log(`[gpu] Feinmessung: ${feinDa ? 'an' : 'NICHT VERFUEGBAR (alter Client-Build?)'}`);
await page.evaluate(() => window.__vb.profil());
// Frame-Zeiten mitschneiden — die Aufschluesselung sagt, WO die Zeit
// hingeht, aber nur die Perzentile sagen, ob es sich besser anfuehlt.
await page.evaluate(() => {
  const s = { zeiten: [], laeuft: true, letzte: performance.now() };
  window.__fr = s;
  const tick = () => {
    if (!s.laeuft) return;
    const j = performance.now();
    s.zeiten.push(j - s.letzte);
    s.letzte = j;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
console.log(`[gpu] Sprint ${SEKUNDEN}s ...`);
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');

const beginn = Date.now();
let seite = 0;
/** Wie oft der Laeufer beim Wenden im Wasser stand — Guete der Messung. */
let imWasser = 0;
while ((Date.now() - beginn) / 1000 < SEKUNDEN) {
  const rest = SEKUNDEN - (Date.now() - beginn) / 1000;
  await page.waitForTimeout(Math.min(WENDE, rest) * 1000);
  if ((Date.now() - beginn) / 1000 >= SEKUNDEN) break;
  seite += 1;
  // Beim Richtungswechsel pruefen, ob der Laeufer noch trocken steht.
  // Auf einer Insel ist er nach 90 m Bein sonst im Meer — und misst dort
  // eine leere Szene, wie schon zweimal geschehen.
  const nass = await page.evaluate(
    ([gier, zx, zz]) => {
      const p = window.__dbg.player.position;
      const boden = window.__dbg.world.getGroundHeight(p.x, p.z);
      if (boden < 30) {
        // Zurueck auf den bekannten Landpunkt, neue Richtung.
        window.__vb.teleport(zx, zz, gier);
        return true;
      }
      window.__vb.teleport(p.x, p.z, gier);
      return false;
    },
    [(seite * Math.PI) / 2, platz.x, platz.z]
  );
  if (nass) imWasser++;
}
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');

// ── Auslesen ──────────────────────────────────────────────────────────
const frames = await page.evaluate(() => {
  window.__fr.laeuft = false;
  return window.__fr.zeiten;
});

const ergebnis = await page.evaluate(() => {
  const scene = window.__dbg.scene;
  const engine = scene.getEngine();
  const si = window.__si;
  const z = (c) => (c ? { letzte: +c.current.toFixed(2), mittel: +c.average.toFixed(2), max: +c.max.toFixed(2), min: +c.min.toFixed(2), n: c.count } : null);

  // ── VRAM-Schaetzung: Texturen ──
  // Bytes je Texel nach Format. Unkomprimiert ist RGBA8 = 4 B/Texel;
  // die Blockformate liegen bei 0,5-1 B/Texel. Genau darin liegt der
  // Unterschied, um den es bei der Kompression geht.
  const texturen = [];
  let texBytes = 0;
  let texBytesUnkomprimiert = 0;
  for (const t of scene.textures) {
    const g = t.getSize?.() ?? { width: 0, height: 0 };
    if (!g.width || !g.height) continue;
    const komprimiert = Boolean(t._compressedFormat ?? t.compressedFormat);
    const bpp = komprimiert ? 1 : 4;
    // Mipmaps kosten ein weiteres Drittel der Grundflaeche.
    const faktor = t.noMipmap === false || t.generateMipMaps !== false ? 4 / 3 : 1;
    const bytes = g.width * g.height * bpp * faktor * (t.isCube ? 6 : 1);
    texBytes += bytes;
    if (!komprimiert) texBytesUnkomprimiert += bytes;
    texturen.push({
      name: (t.name ?? '?').slice(0, 70),
      w: g.width,
      h: g.height,
      komprimiert,
      cube: Boolean(t.isCube),
      mb: +(bytes / 1048576).toFixed(2),
    });
  }
  texturen.sort((a, b) => b.mb - a.mb);

  // ── VRAM-Schaetzung: Geometrie ──
  let geoBytes = 0;
  let vertices = 0;
  let indizes = 0;
  const gesehen = new Set();
  for (const m of scene.meshes) {
    const geo = m.geometry;
    if (!geo || gesehen.has(geo.uniqueId)) continue;
    gesehen.add(geo.uniqueId);
    const v = geo.getTotalVertices?.() ?? 0;
    const i = geo.getTotalIndices?.() ?? 0;
    vertices += v;
    indizes += i;
    for (const art of geo.getVerticesDataKinds?.() ?? []) {
      const puffer = geo.getVertexBuffer?.(art);
      const stride = puffer?.getStrideSize?.() ?? 0;
      geoBytes += v * stride * 4;
    }
    geoBytes += i * 4;
  }

  // Thin Instances liegen als eigene Matrixpuffer auf der GPU:
  // 16 floats = 64 B je Instanz.
  let thinInstanzen = 0;
  for (const m of scene.meshes) thinInstanzen += m.thinInstanceCount ?? 0;
  const thinBytes = thinInstanzen * 64;

  const caps = engine.getCaps?.() ?? {};
  return {
    gpu: {
      zeitMs: z(si?.gpuFrameTimeCounter ? { current: si.gpuFrameTimeCounter.current / 1e6, average: si.gpuFrameTimeCounter.average / 1e6, max: si.gpuFrameTimeCounter.max / 1e6, min: si.gpuFrameTimeCounter.min / 1e6, count: si.gpuFrameTimeCounter.count } : null),
    },
    cpu: {
      frameTime: z(si?.frameTimeCounter),
      renderTime: z(si?.renderTimeCounter),
      aktiveMeshesAuswahl: z(si?.activeMeshesEvaluationTimeCounter),
      zwischenFrame: z(si?.interFrameTimeCounter),
      renderTargets: z(si?.renderTargetsRenderTimeCounter),
    },
    szene: {
      meshes: scene.meshes.length,
      aktiveMeshes: scene.getActiveMeshes().length,
      materialien: scene.materials.length,
      texturen: scene.textures.length,
      lichter: scene.lights.length,
      thinInstanzen,
      vertices,
      dreiecke: Math.round(indizes / 3),
    },
    vram: {
      texturenMB: +(texBytes / 1048576).toFixed(1),
      texturenUnkomprimiertMB: +(texBytesUnkomprimiert / 1048576).toFixed(1),
      geometrieMB: +(geoBytes / 1048576).toFixed(1),
      thinInstanzenMB: +(thinBytes / 1048576).toFixed(2),
      summeMB: +((texBytes + geoBytes + thinBytes) / 1048576).toFixed(1),
    },
    groessteTexturen: texturen.slice(0, 15),
    unterstuetzteKompression: {
      s3tc: Boolean(caps.s3tc),
      bptc: Boolean(caps.bptc),
      astc: Boolean(caps.astc),
      etc2: Boolean(caps.etc2),
      pvrtc: Boolean(caps.pvrtc),
      maxTexturgroesse: caps.maxTextureSize,
      maxAnisotropie: caps.maxAnisotropy,
    },
    teilsysteme: window.__vb.profil(),
  };
});

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...ergebnis, fehlanfragen: fehlanfragen.slice(0, 20) }, null, 2));

const e = ergebnis;
console.log('');
console.log('── Frame-Zeit ────────────────────────────────────');
console.log(`  GPU je Bild        : ${e.gpu.zeitMs ? `${e.gpu.zeitMs.mittel} ms (max ${e.gpu.zeitMs.max})` : 'NICHT VERFUEGBAR (Zeitabfrage-Erweiterung fehlt)'}`);
console.log(`  CPU frameTime      : ${e.cpu.frameTime ? `${e.cpu.frameTime.mittel} ms (max ${e.cpu.frameTime.max})` : '—'}`);
console.log(`  davon renderTime   : ${e.cpu.renderTime ? `${e.cpu.renderTime.mittel} ms (max ${e.cpu.renderTime.max})` : '—'}`);
console.log(`  aktive-Mesh-Auswahl: ${e.cpu.aktiveMeshesAuswahl ? `${e.cpu.aktiveMeshesAuswahl.mittel} ms (max ${e.cpu.aktiveMeshesAuswahl.max})` : '—'}`);
console.log(`  zwischen den Frames: ${e.cpu.zwischenFrame ? `${e.cpu.zwischenFrame.mittel} ms (max ${e.cpu.zwischenFrame.max})` : '—'}`);
console.log('── VRAM (geschaetzt) ─────────────────────────────');
console.log(`  Texturen           : ${e.vram.texturenMB} MB (davon unkomprimiert ${e.vram.texturenUnkomprimiertMB} MB)`);
console.log(`  Geometrie          : ${e.vram.geometrieMB} MB`);
console.log(`  Thin-Instanz-Matrizen: ${e.vram.thinInstanzenMB} MB (${e.szene.thinInstanzen} Instanzen)`);
console.log(`  Summe              : ${e.vram.summeMB} MB`);
console.log('── Szene ─────────────────────────────────────────');
console.log(`  Meshes ${e.szene.meshes} (aktiv ${e.szene.aktiveMeshes}) · Materialien ${e.szene.materialien} · Texturen ${e.szene.texturen} · Lichter ${e.szene.lichter}`);
console.log(`  ${e.szene.vertices.toLocaleString('de')} Vertices, ${e.szene.dreiecke.toLocaleString('de')} Dreiecke`);
console.log('── Kompression, die die GPU koennte ──────────────');
console.log(`  ${JSON.stringify(e.unterstuetzteKompression)}`);

// ── Der eigentliche Zweck: Wo geht die Terrain-Zeit hin? ──────────────
const grob = e.teilsysteme ?? {};
const fein = grob.fein ?? {};
if (imWasser > 0) {
  console.log(`  HINWEIS: bei ${imWasser} von ${seite} Wenden stand der Laeufer im Wasser und wurde zurueckgesetzt.`);
  console.log('  Die Messung enthaelt damit Anteile leerer Wasserszene — Messort verkleinern oder Beine kuerzen.');
}
const t = frames.slice(3).sort((x, y) => x - y);
const q = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))];
if (t.length > 30) {
  const ueber = (ms) => t.filter((x) => x > ms).length;
  ergebnis.frameZeit = {
    frames: t.length,
    fpsMedian: +(1000 / q(0.5)).toFixed(1),
    fps1ProzentLow: +(1000 / q(0.99)).toFixed(1),
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    p99: +q(0.99).toFixed(2),
    max: +t[t.length - 1].toFixed(2),
    ueber33ms: ueber(33),
    anteilUeber33: +((ueber(33) / t.length) * 100).toFixed(2),
  };
  const f = ergebnis.frameZeit;
  console.log('── Frame-Zeit ────────────────────────────────────');
  console.log(`  fps Median / 1%-low     : ${f.fpsMedian} / ${f.fps1ProzentLow}`);
  console.log(`  p50 / p95 / p99         : ${f.p50} / ${f.p95} / ${f.p99} ms`);
  console.log(`  Maximum                 : ${f.max} ms`);
  console.log(`  Frames >33ms            : ${f.ueber33ms} von ${f.frames} (${f.anteilUeber33} %)`);
}
console.log('── Terrain, grob ─────────────────────────────────');
for (const k of ['terrain', 'gras', 'entities', 'spieler']) {
  const p = grob[k];
  if (p) console.log(`  ${k.padEnd(10)} Summe ${String(p.summe.toFixed(0)).padStart(6)} ms   max ${String(p.max.toFixed(1)).padStart(6)} ms`);
}
const feinNamen = Object.keys(fein);
if (feinNamen.length === 0) {
  console.log('── Terrain, fein ─────────────────────────────────');
  console.log('  KEINE DATEN — Feinmessung nicht verfuegbar oder kein Chunk gebaut.');
} else {
  console.log('── Terrain, fein (Eigenzeit, Kinder abgezogen) ───');
  const summeAlle = feinNamen.reduce((a, k) => a + fein[k].summeMs, 0);
  for (const k of feinNamen.sort((a, b) => fein[b].summeMs - fein[a].summeMs)) {
    const p = fein[k];
    const anteil = summeAlle > 0 ? ((p.summeMs / summeAlle) * 100).toFixed(0) : '0';
    console.log(
      `  ${k.padEnd(22)} Summe ${String(p.summeMs.toFixed(0)).padStart(6)} ms  ` +
        `(${String(anteil).padStart(3)} %)   max ${String(p.maxMs.toFixed(1)).padStart(6)} ms   n=${p.n}`
    );
  }
  console.log(`  ${'SUMME'.padEnd(22)}       ${summeAlle.toFixed(0)} ms`);
}
console.log(`  -> ${OUT}`);
