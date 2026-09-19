/**
 * Schatten II messen (G15): Zuordnung der Schattenzeit und der Takt der fernen Kaskaden.
 *
 * ── Modus `zuordnung` ────────────────────────────────────────────────
 *  Je Ort (Wald am Start, schwere Insel) im Stand, Sonne und Wind fest:
 *   · je Werfergruppe (Laub-Klone, Stamm-Klone, Gelaende, Figur, Rest) Zeichenaufrufe,
 *     eingereichte Dreiecke, Instanzen, GPU-Zeit (Zeitabfrage je Kaskadenlage) und
 *     CPU-Zeit des Zeichnens, je Kaskade — die Werferliste wird dazu je Lage auf die
 *     Gruppe eingeschraenkt (`getCustomRenderList` der Schattenkarte);
 *   · Bildabstand, CPU- und GPU-Zeit fuer voll / ohne Laub / ohne Schatten, strikt
 *     abwechselnd, mehrere Runden, Median.
 * ── Modus `kandidaten` ───────────────────────────────────────────────
 *  Obergrenzen fuer Werferregeln je Kaskade (Laub nur in Kaskade 0, Laub in Kaskade 1 nur
 *  ab 5 / 8 m Hoehe, Bewuchs unter 3 m nicht in Kaskade 1, kein Laub), strikt abwechselnd:
 *  Bildabstand, CPU- und GPU-Zeit, Zeichenaufrufe und GPU-Zeit je Lage. Keine Codeaenderung
 *  noetig: die Liste wird je Lage ueber `getCustomRenderList` der Schattenkarte gesetzt.
 * ── Modus `bilder` ───────────────────────────────────────────────────
 *  Bildpaare derselben Lichtung wie in Berichte/schatten-g18-g20 (Baum bei -17068/-5287,
 *  Kamera 1,7 m ueber dem Boden, 5 / 15 / 30 m vor dem Kronenschatten, Blickachse 105 Grad,
 *  Wind eingefroren, Oberflaeche und Figur aus; Start mit `--t 0.52`): ein frisches Bild
 *  (`fernTakt` 1) und das uebersprungene Bild (`fernTakt` 2) an derselben Stelle, nachdem
 *  die Kamera 13 cm (Sprinttempo) weitergerueckt ist, dazu eine Differenz, mal 20 verstaerkt.
 *  Die Bilder liegen als PNG in `--bilderDir`.
 * ── Modus `pruefung` ─────────────────────────────────────────────────
 *  Die drei Faelle, die `fernTakt` 2 halten muss (Ort: Wald):
 *   1. Gleichmass: Bildabstaende der uebersprungenen und der gerenderten Bilder getrennt
 *      (Median, Mittel, p95, p99), dazu die mittlere Aenderung von Bild zu Bild — im Stand und
 *      im Sprint, Takt 1 als Vergleich.
 *   2. Bewegter Werfer jenseits der Nahkaskade: ein Quader (1 x 1 x 3,6 m) laeuft mit 5 und 8 m/s
 *      im Abstand 10 m (nur Kaskade 0, Gegenprobe), 17 m (Ueberblendzone) und 30 m (Kaskade 1)
 *      quer zur Blickrichtung. Gepaart: uebersprungenes Bild gegen frisches Bild am selben Ort;
 *      dazu Versatz des Schattens in cm und Flackern (dunkle Einbrueche wie in G19).
 *   3. Schneller Schwenk (180 und 360 Grad/s) und Teleport: Zahl der erzwungenen Neuzeichnungen
 *      (`luecken`), gepaarter Unterschied in den Bildern nach dem Ereignis.
 * ── Modus `takt` ─────────────────────────────────────────────────────
 *  Je Ort die ferne Kaskade jedes Bild (`fernTakt` 1) gegen jedes zweite (2):
 *   · Stand, 150 Bilder je Zelle, A B A B ...;
 *   · gepaarte Bilder: ein uebersprungenes Bild und dasselbe Bild frisch am selben
 *     Ort (Kamera mit Sprinttempo verschoben, dann um 3 Grad je Bild gedreht),
 *     Anteil der Bildpunkte mit Helligkeitsunterschied > 4 / 8 / 16 von 255, dazu
 *     der Rauschboden (zwei frische Bilder am selben Ort);
 *   · Sprint, Segmente von `--segmentM` Metern im Muster A B B A (Takt 1, 2, 2, 1), gepoolt
 *     (Mittel, p50, p95, p99 je Segment, Zaehler uebersprungen/gerendert/Luecken).
 *
 * ── Grenzen ──────────────────────────────────────────────────────────
 *  · Die GPU-Zeit kommt aus `EXT_disjoint_timer_query_webgl2`; fehlt sie, bleibt sie null.
 *  · Bildvergleiche laufen mit TAA aus (die Historie wuerde den Vergleich verwischen).
 *  · Braucht Adminrechte fuer `teleport` (`everyone-admin: true` in der server.yml des
 *    Arbeitsbaums, nie einchecken) und ein sichtbares Fenster auf einer echten GPU.
 *    Messsperre: `~/.cache/wov-mess.lock`.
 *
 * Aufruf:
 *   node tools/pw-schatten-ii-zuordnung.mjs --url http://127.0.0.1:5297 --modus zuordnung --ort wald
 *   node tools/pw-schatten-ii-zuordnung.mjs --url ... --modus takt --ort insel --out mess/takt-insel.json
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';

if (!process.env.WOV_MESSSPERRE_GEHALTEN) {
  const lockDatei = `${process.env.HOME}/.cache/wov-mess.lock`;
  mkdirSync(dirname(lockDatei), { recursive: true });
  try {
    execFileSync('flock', [lockDatei, process.execPath, process.argv[1], ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, WOV_MESSSPERRE_GEHALTEN: '1' },
    });
  } catch (e) {
    process.exit(typeof e.status === 'number' ? e.status : 1);
  }
  process.exit(0);
}

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const URL_ZIEL = arg('url', 'http://127.0.0.1:5297');
const MODUS = arg('modus', 'zuordnung');
const ORT = arg('ort', 'wald');
const OUT = arg('out', `mess/schatten-ii-${MODUS}-${ORT}.json`);
const RUNDEN = Math.max(2, Number(arg('runden', 4)));
const BILDER = Number(arg('bilder', 150));
const SEGMENT_M = Number(arg('segmentM', 12.5));
const SEGMENTE = Math.max(4, Number(arg('segmente', 16)));
const TAGESZEIT = arg('t', '0.708333');
/** Modus pruefung: welche der drei Teile laufen (Standard alle). */
const TEILE = arg('teile', '1,2,3').split(',');
/** Abstaende des bewegten Werfers in Metern (Kaskade 0 endet bei 19,2 m). */
const ABSTAENDE = arg('abstaende', '10,17,30').split(',').map(Number);
/** Orte: Der Wald ist der Startort (kein Teleport), die Insel wartet nach dem Teleport laenger. */
const ORTE = {
  wald: { name: 'Wald am Start', teleport: null, warteS: 4 },
  insel: { name: 'schwere Insel', teleport: [10077, -18723], warteS: 50 },
  lichtung: { name: 'Lichtung (freie Flaeche, Sonne 12:30 mit --t 0.52)', teleport: [-17067.6, -5286.9], warteS: 25 },
};
const ziel = ORTE[ORT];
if (!ziel) {
  console.error(`[schatten-ii] unbekannter Ort ${ORT}, erlaubt: ${Object.keys(ORTE).join(', ')}`);
  process.exit(1);
}

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

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
const kontext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await kontext.newPage();
const konsole = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') konsole.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => konsole.push(`[pageerror] ${e.message.slice(0, 300)}`));
await page.addInitScript(([t]) => localStorage.setItem('wov-session-token', t), [testToken()]);
await page.goto(`${URL_ZIEL}/?name=SchattenII${Date.now().toString(36).slice(-4)}&t=${TAGESZEIT}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
});
console.log(`[schatten-ii] GPU: ${gpu}`);
if (!gpu || /swiftshader|llvmpipe|software/i.test(gpu)) {
  console.error('[schatten-ii] ABBRUCH: kein Hardware-Renderer.');
  await browser.close();
  process.exit(2);
}
await page.waitForFunction(() => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.scene?.activeCamera), undefined, { timeout: 180_000 });
await page.waitForFunction(() => window.__dbg?.terrain?.ready !== false, undefined, { timeout: 120_000 }).catch(() => {});
await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

/** Die Hilfsfunktionen leben in der Seite (`window.__z`); alles Weitere ruft sie auf. */
await page.evaluate(() => {
  const d = window.__dbg;
  const scene = d.scene;
  const engine = scene.getEngine();
  const gl = engine._gl;
  const Z = (window.__z = {});
  const g = d.shadows.generator;
  const karte = g.getShadowMap();
  const or = karte._objectRenderer;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  Z.zeitabfrage = Boolean(ext);
  Z.frames = [];
  Z.aktiv = false;
  Z.pending = [];
  Z.zaehl = null;
  Z.modus = 'layer';
  let cur = null;
  let frame = null;
  // Zeichenaufrufe, Dreiecke und Instanzen je Lage mitzaehlen.
  const origEl = engine.drawElementsType.bind(engine);
  const origAr = engine.drawArraysType.bind(engine);
  engine.drawElementsType = (fm, is, ic, n = 1) => {
    if (Z.zaehl) {
      Z.zaehl.dc++;
      Z.zaehl.tris += (ic / 3) * (n || 1);
      Z.zaehl.inst += n || 1;
    }
    return origEl(fm, is, ic, n);
  };
  engine.drawArraysType = (fm, vs, vc, n = 1) => {
    if (Z.zaehl) {
      Z.zaehl.dc++;
      Z.zaehl.tris += (vc / 3) * (n || 1);
      Z.zaehl.inst += n || 1;
    }
    return origAr(fm, vs, vc, n);
  };
  or.onBeforeRenderObservable.add((layer) => {
    if (Z.aktiv) cur = { layer, t0: performance.now() };
  });
  or.onBeforeRenderingManagerRenderObservable.add(() => {
    if (!Z.aktiv || !cur) return;
    cur.t1 = performance.now();
    Z.zaehl = { dc: 0, tris: 0, inst: 0 };
    if (Z.modus === 'layer' && ext) {
      cur.q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, cur.q);
    }
  });
  or.onAfterRenderingManagerRenderObservable.add(() => {
    if (!Z.aktiv || !cur || !Z.zaehl) return;
    cur.t2 = performance.now();
    if (cur.q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    Object.assign(cur, Z.zaehl);
    Z.zaehl = null;
  });
  or.onAfterRenderObservable.add(() => {
    if (!Z.aktiv || !cur || cur.t2 === undefined) return;
    (frame ||= { layers: [] }).layers[cur.layer] = cur;
    cur = null;
  });
  scene.onBeforeRenderObservable.add(() => {
    if (!Z.aktiv) return;
    frame = { layers: [], t0: performance.now() };
    if (Z.modus === 'frame' && ext) {
      frame.q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, frame.q);
    }
  });
  scene.onAfterRenderObservable.add(() => {
    if (!Z.aktiv || !frame) return;
    frame.t3 = performance.now();
    if (frame.q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    Z.frames.push(frame);
    Z.pending.push(frame);
    frame = null;
    Z.poll();
  });
  Z.poll = () => {
    const rest = [];
    for (const f of Z.pending) {
      let fertig = true;
      const abfragen = [];
      if (f.q) abfragen.push([f, 'gpuFrame']);
      for (const L of f.layers) if (L?.q) abfragen.push([L, 'gpu']);
      for (const [o, aus] of abfragen) {
        if (o[aus] !== undefined) continue;
        if (gl.getQueryParameter(o.q, gl.QUERY_RESULT_AVAILABLE)) {
          o[aus] = gl.getQueryParameter(o.q, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(o.q);
        } else fertig = false;
      }
      if (!fertig) rest.push(f);
    }
    Z.pending = rest;
  };
  Z.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  Z.bilder = (n) =>
    new Promise((ok) => {
      let k = 0;
      const o = scene.onAfterRenderObservable.add(() => {
        if (++k >= n) {
          scene.onAfterRenderObservable.remove(o);
          ok(k);
        }
      });
    });
  Z.med = (a) => {
    const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : Number.NaN;
  };
  Z.p = (a, q) => {
    const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : Number.NaN;
  };
  const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
  const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
  /** n Bilder in der aktuellen Einstellung; je Lage Mediane, dazu Bildabstand und CPU-Renderzeit. */
  Z.messe = async (n, modus = 'layer') => {
    Z.modus = modus;
    Z.frames = [];
    Z.pending = [];
    Z.aktiv = true;
    await Z.bilder(n + 2);
    Z.aktiv = false;
    await Z.bilder(8);
    Z.poll();
    await Z.bilder(8);
    Z.poll();
    const F = Z.frames.slice(1, -1);
    const abst = [];
    for (let i = 1; i < F.length; i++) abst.push(F[i].t0 - F[i - 1].t0);
    const out = {
      n: F.length,
      abstandP50: r2(Z.med(abst)),
      abstandP95: r2(Z.p(abst, 0.95)),
      cpuRender: r2(Z.med(F.map((f) => f.t3 - f.t0))),
      gpuFrame: modus === 'frame' ? r2(Z.med(F.map((f) => f.gpuFrame))) : null,
      lagen: [],
    };
    const nl = Math.max(0, ...F.map((f) => f.layers.length));
    for (let l = 0; l < nl; l++) {
      const L = F.map((f) => f.layers[l]).filter(Boolean);
      out.lagen.push({
        lage: l,
        n: L.length,
        zeichenaufrufe: Z.med(L.map((x) => x.dc)),
        dreiecke: Math.round(Z.med(L.map((x) => x.tris))),
        instanzen: Z.med(L.map((x) => x.inst)),
        vorbereitenMs: r3(Z.med(L.map((x) => x.t1 - x.t0))),
        zeichnenMs: r3(Z.med(L.map((x) => x.t2 - x.t1))),
        gpuMs: modus === 'layer' ? r3(Z.med(L.map((x) => x.gpu))) : null,
      });
    }
    return out;
  };
  /** Mittel, p50, p95 und p99 der Bildabstaende ueber n Bilder (fuer den Sprint). */
  Z.abstaende = (n) =>
    new Promise((ok) => {
      const t = [];
      let k = 0;
      const o = scene.onAfterRenderObservable.add(() => {
        t.push(performance.now());
        if (++k >= n + 1) {
          scene.onAfterRenderObservable.remove(o);
          const a = [];
          for (let i = 1; i < t.length; i++) a.push(t[i] - t[i - 1]);
          ok({ n: a.length, mittel: r2(a.reduce((x, y) => x + y, 0) / a.length), p50: r2(Z.med(a)), p95: r2(Z.p(a, 0.95)), p99: r2(Z.p(a, 0.99)) });
        }
      });
    });
  // ── Werfergruppen und Einschraenkung der Liste je Lage ──────────────
  Z.gruppe = (m) => {
    const n = m.name;
    if (n.startsWith('schattenVegetation_')) return m.material?.transparencyMode === 1 ? 'laubKlon' : 'stammKlon';
    if (m.material?.transparencyMode === 1) return 'laubSonst';
    if (/^terrain/i.test(n)) return 'gelaende';
    if (/^(Chr_|__root__|Voelva|avatar)/i.test(n)) return 'figur';
    return 'rest';
  };
  Z.nurGruppe = (gr) => {
    const teil = karte.renderList.filter((m) => Z.gruppe(m) === gr);
    or.getCustomRenderList = () => teil;
  };
  Z.ohneGruppe = (gr) => {
    const teil = karte.renderList.filter((m) => Z.gruppe(m) !== gr);
    or.getCustomRenderList = () => teil;
  };
  Z.keineWerfer = () => {
    const leer = [];
    or.getCustomRenderList = () => leer;
  };
  Z.alleWerfer = () => {
    or.getCustomRenderList = null;
  };
  Z.gruppenZahl = () => {
    const h = {};
    for (const m of karte.renderList) {
      const k = Z.gruppe(m);
      (h[k] ||= { meshes: 0, instanzen: 0 });
      h[k].meshes++;
      h[k].instanzen += m.hasThinInstances ? m.thinInstanceCount : 1;
    }
    return h;
  };
  // ── Bildvergleich (gepaart) ─────────────────────────────────────────
  Z.grab = () =>
    new Promise((ok) =>
      scene.onAfterRenderObservable.addOnce(async () => {
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        const px = new Uint8Array(await engine.readPixels(0, 0, w, h));
        const L = new Uint8Array(w * h);
        for (let q = 0, s = 0; q < L.length; q++, s += 4) L[q] = 0.2126 * px[s] + 0.7152 * px[s + 1] + 0.0722 * px[s + 2];
        ok({ L, w, h });
      })
    );
  // `anteil`: wie viel des Bildes von UNTEN gezaehlt wird (readPixels liefert die unterste Zeile zuerst).
  Z.unterschied = (a, b, anteil = 0.65) => {
    let n = 0;
    let g4 = 0;
    let g8 = 0;
    let g16 = 0;
    let s = 0;
    for (let i = 0; i < Math.floor(a.h * anteil) * a.w; i++) {
      const dd = Math.abs(a.L[i] - b.L[i]);
      s += dd;
      if (dd > 4) g4++;
      if (dd > 8) g8++;
      if (dd > 16) g16++;
      n++;
    }
    return { mittel: +(s / n).toFixed(4), p4: +((100 * g4) / n).toFixed(4), p8: +((100 * g8) / n).toFixed(4), p16: +((100 * g16) / n).toFixed(4) };
  };
  Z.mittelUnterschied = (liste) => {
    const s = { mittel: 0, p4: 0, p8: 0, p16: 0 };
    for (const x of liste) for (const k of Object.keys(s)) s[k] += x[k] / liste.length;
    return { ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(4)])), maxP8: Math.max(...liste.map((x) => x.p8)), paare: liste.length };
  };
});

const bericht = { gpu, url: URL_ZIEL, zeit: new Date().toISOString(), modus: MODUS, ort: ziel.name };
bericht.zeitabfrage = await page.evaluate(() => window.__z.zeitabfrage);
bericht.aufbau = await page.evaluate(() => window.__dbg.shadows.messwerte());
// Zuordnung und Kandidaten beschreiben den Stand VOR G15: die ferne Kaskade rendert in jedem Bild.
if (MODUS === 'zuordnung' || MODUS === 'kandidaten') {
  bericht.fernTaktEingestellt = await page.evaluate(() => (window.__dbg.shadows.profil.schatten.fernTakt = 1));
}

// ── An den Ort ───────────────────────────────────────────────────────
if (ziel.teleport) {
  const ok = await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), ziel.teleport);
  if (!ok) {
    console.error('[schatten-ii] ABBRUCH: Admin-Teleport abgelehnt (everyone-admin im Arbeitsbaum an?).');
    await browser.close();
    process.exit(5);
  }
}
await page.waitForTimeout(ziel.warteS * 1000);
await page.evaluate(() => window.__vb.sway(0, 0));
bericht.position = await page.evaluate(() => {
  const p = window.__dbg.player.position;
  return { x: Math.round(p.x), z: Math.round(p.z) };
});
console.log(`[schatten-ii] ${ziel.name}: ${JSON.stringify(bericht.position)}, Aufbau ${JSON.stringify(bericht.aufbau)}`);

// ── Modus zuordnung ──────────────────────────────────────────────────
if (MODUS === 'zuordnung') {
  bericht.gruppenZahl = await page.evaluate(() => window.__z.gruppenZahl());
  bericht.gruppen = await page.evaluate(async () => {
    const Z = window.__z;
    const out = {};
    for (const gr of ['laubKlon', 'stammKlon', 'gelaende', 'figur', 'rest', 'laubSonst']) {
      Z.nurGruppe(gr);
      await Z.bilder(6);
      out[gr] = await Z.messe(100, 'layer');
    }
    Z.alleWerfer();
    await Z.bilder(6);
    out.alle = await Z.messe(100, 'layer');
    return out;
  });
  bericht.frames = await page.evaluate(async (runden) => {
    const Z = window.__z;
    const zellen = { voll: () => Z.alleWerfer(), ohneLaub: () => Z.ohneGruppe('laubKlon'), keineSchatten: () => Z.keineWerfer() };
    const roh = { voll: [], ohneLaub: [], keineSchatten: [] };
    for (let r = 0; r < runden; r++) {
      for (const k of Object.keys(zellen)) {
        zellen[k]();
        await Z.bilder(10);
        const m = await Z.messe(150, 'frame');
        roh[k].push({ abstandP50: m.abstandP50, abstandP95: m.abstandP95, cpuRender: m.cpuRender, gpuFrame: m.gpuFrame });
      }
    }
    Z.alleWerfer();
    const med = Object.fromEntries(
      Object.entries(roh).map(([k, v]) => [k, Object.fromEntries(['abstandP50', 'abstandP95', 'cpuRender', 'gpuFrame'].map((f) => [f, Z.med(v.map((x) => x[f]))]))])
    );
    return { roh, median: med };
  }, RUNDEN);
  for (const [k, v] of Object.entries(bericht.frames.median)) console.log(`[schatten-ii] ${k.padEnd(14)} Abstand p50 ${v.abstandP50} ms, p95 ${v.abstandP95}, CPU ${v.cpuRender}, GPU ${v.gpuFrame}`);
}

const setzeTaktPruefung = (t) => page.evaluate((n) => (window.__dbg.shadows.profil.schatten.fernTakt = n), t);

// ── Modus kandidaten ─────────────────────────────────────────────────
if (MODUS === 'kandidaten') {
  bericht.kandidaten = await page.evaluate(async (runden) => {
    const Z = window.__z;
    const sh = window.__dbg.shadows;
    const karte = sh.generator.getShadowMap();
    const or = karte._objectRenderer;
    const liste = karte.renderList.slice();
    const stand = new Map([...sh.vegetationsSchatten.values()].map((s) => [s.schatten, s]));
    const hoehe = (m) => {
      const s = stand.get(m);
      return s ? s.modellHoehe * s.maxSkala : 0;
    };
    const laub = (m) => m.name.startsWith('schattenVegetation_') && m.material?.transparencyMode === 1;
    const V = {
      ref: () => liste,
      laubNurKaskade0: (l) => (l === 1 ? liste.filter((m) => !laub(m)) : liste),
      laubKaskade1AbHoehe8: (l) => (l === 1 ? liste.filter((m) => !laub(m) || hoehe(m) >= 8) : liste),
      laubKaskade1AbHoehe5: (l) => (l === 1 ? liste.filter((m) => !laub(m) || hoehe(m) >= 5) : liste),
      bewuchsUnter3mNichtInKaskade1: (l) => (l === 1 ? liste.filter((m) => !stand.has(m) || hoehe(m) >= 3) : liste),
      keinLaub: () => liste.filter((m) => !laub(m)),
    };
    const namen = Object.keys(V);
    const roh = Object.fromEntries(namen.map((k) => [k, []]));
    for (let r = 0; r < runden; r++) {
      for (const k of namen) {
        or.getCustomRenderList = (l) => V[k](l);
        await Z.bilder(20);
        const m = await Z.messe(150, 'frame');
        roh[k].push({ abstandP50: m.abstandP50, abstandP95: m.abstandP95, cpuRender: m.cpuRender, gpuFrame: m.gpuFrame });
      }
    }
    const je = {};
    for (const k of namen) {
      or.getCustomRenderList = (l) => V[k](l);
      await Z.bilder(20);
      je[k] = (await Z.messe(80, 'layer')).lagen.map((x) => ({ zeichenaufrufe: x.zeichenaufrufe, gpuMs: x.gpuMs, zeichnenMs: x.zeichnenMs }));
    }
    or.getCustomRenderList = null;
    const median = Object.fromEntries(
      Object.entries(roh).map(([k, v]) => [k, Object.fromEntries(['abstandP50', 'abstandP95', 'cpuRender', 'gpuFrame'].map((f) => [f, Z.med(v.map((x) => x[f]))]))])
    );
    return { roh, median, jeLage: je };
  }, RUNDEN);
  for (const [k, v] of Object.entries(bericht.kandidaten.median)) console.log(`[schatten-ii] ${k.padEnd(30)} Abstand p50 ${v.abstandP50} ms, p95 ${v.abstandP95}, CPU ${v.cpuRender}, GPU ${v.gpuFrame}`);
}

// ── Modus bilder ─────────────────────────────────────────────────────
if (MODUS === 'bilder' || MODUS === 'pruefung') {
  const bilderDirH = arg('bilderDir', 'mess/bilder');
  mkdirSync(bilderDirH, { recursive: true });
  await page.evaluate(() => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    document.body.classList.add('ui-versteckt');
    window.__vb.figur?.(false);
    window.__vb.sway(0, 0);
    Z.pose = null;
    scene.onBeforeRenderObservable.add(() => {
      const p = Z.pose;
      if (!p) return;
      const c = scene.activeCamera;
      c.position.set(p.px, p.py, p.pz);
      c.setTarget(new c.position.constructor(p.tx, p.ty, p.tz));
    });
    // Kamera d Meter vor dem Ziel, Blick um `gier` Grad, `schritt` Meter weiter entlang der Blickachse.
    Z.stellePose = (tx, tz, dist, gierGrad, schritt) => {
      const ty = window.__vb.groundAt(tx, tz);
      const g = (gierGrad * Math.PI) / 180;
      const d = dist - schritt;
      const px = tx - Math.sin(g) * d;
      const pz = tz - Math.cos(g) * d;
      Z.pose = { tx, ty, tz, px, py: window.__vb.groundAt(px, pz) + 1.7, pz };
    };
    Z.png = async (bild, verstaerken) => {
      const { L, w, h } = bild;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const q = (h - 1 - y) * w + x;
          const v = verstaerken ? Math.min(255, verstaerken.L[q] * 20) : L[q];
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    };
    Z.farbeGrab = () =>
      new Promise((ok) =>
        scene.onAfterRenderObservable.addOnce(async () => {
          const eng = scene.getEngine();
          const w = eng.getRenderWidth();
          const h = eng.getRenderHeight();
          const px = new Uint8Array(await eng.readPixels(0, 0, w, h));
          ok({ px, w, h });
        })
      );
    Z.farbePng = (b) => {
      const c = document.createElement('canvas');
      c.width = b.w;
      c.height = b.h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(b.w, b.h);
      for (let y = 0; y < b.h; y++) {
        const q = (b.h - 1 - y) * b.w * 4;
        img.data.set(b.px.subarray(q, q + b.w * 4), y * b.w * 4);
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    };
  });
}

if (MODUS === 'bilder') {
  const bilderDir = arg('bilderDir', 'mess/bilder');
  await page.evaluate(() => window.__vb.setze('temporalAA', 0));
  const ZX = Number(arg('zielx', -17067.6));
  const ZZ = Number(arg('zielz', -5292.9));
  await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z + 6}`), [ZX, ZZ]);
  await page.waitForTimeout(25_000);
  const zahlen = {};
  for (const d of [5, 15, 30]) {
    const r = await page.evaluate(async ([tx, tz, dist]) => {
      const Z = window.__z;
      const sh = window.__dbg.shadows;
      const takt = sh.fernTakt;
      const lauf = async (t, schritt, erzwingeSkip) => {
        sh.profil.schatten.fernTakt = t;
        Z.stellePose(tx, tz, dist, 105, schritt);
        if (erzwingeSkip) takt.seit = 0;
        else takt.seit = 99;
        return Z.farbeGrab();
      };
      await Z.bilder(30);
      const frisch = await lauf(1, 0.13, false);
      // Uebersprungenes Bild: erst ein Renderbild eine Stelle weiter hinten, dann 13 cm vor.
      await lauf(2, 0, false);
      const vorher = takt.uebersprungen;
      const stale = await lauf(2, 0.13, true);
      const war = takt.uebersprungen > vorher;
      const lum = (b) => {
        const L = new Uint8Array(b.w * b.h);
        for (let q = 0, s = 0; q < L.length; q++, s += 4) L[q] = 0.2126 * b.px[s] + 0.7152 * b.px[s + 1] + 0.0722 * b.px[s + 2];
        return { L, w: b.w, h: b.h };
      };
      const a = lum(frisch);
      const b = lum(stale);
      const diff = { L: new Uint8Array(a.L.length), w: a.w, h: a.h };
      for (let i = 0; i < diff.L.length; i++) diff.L[i] = Math.abs(a.L[i] - b.L[i]);
      sh.profil.schatten.fernTakt = 2;
      return { war, unterschied: Z.unterschied(a, b, 1), frisch: Z.farbePng(frisch), stale: Z.farbePng(stale), diff: await Z.png(a, diff) };
    }, [ZX, ZZ, d]);
    writeFileSync(join(bilderDir, `g15-lichtung-${d}m-takt1-frisch.png`), Buffer.from(r.frisch, 'base64'));
    writeFileSync(join(bilderDir, `g15-lichtung-${d}m-takt2-uebersprungen.png`), Buffer.from(r.stale, 'base64'));
    writeFileSync(join(bilderDir, `g15-lichtung-${d}m-differenz-x20.png`), Buffer.from(r.diff, 'base64'));
    zahlen[d] = { uebersprungenesBild: r.war, ...r.unterschied };
    console.log(`[schatten-ii] Lichtung ${d} m: uebersprungen ${r.war}, Unterschied ${JSON.stringify(r.unterschied)}`);
  }
  bericht.lichtung = zahlen;
  await page.evaluate(() => window.__vb.setze('temporalAA', 1));
}

// ── Modus pruefung ───────────────────────────────────────────────────
if (MODUS === 'pruefung') {
  const bilderDir = arg('bilderDir', 'mess/bilder');
  mkdirSync(bilderDir, { recursive: true });
  await page.evaluate(() => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    const sh = window.__dbg.shadows;
    const takt = sh.fernTakt;
    // Bildabstaende mit Kennung: war dieses Bild ein uebersprungenes?
    Z.paritaet = (n) =>
      new Promise((ok) => {
        const t = [];
        const fl = [];
        let k = 0;
        let letzt = takt.uebersprungen;
        const o = scene.onAfterRenderObservable.add(() => {
          t.push(performance.now());
          fl.push(takt.uebersprungen > letzt);
          letzt = takt.uebersprungen;
          if (++k >= n + 2) {
            scene.onAfterRenderObservable.remove(o);
            const a = [];
            for (let i = 2; i < t.length; i++) a.push({ d: t[i] - t[i - 1], s: fl[i], p: i % 2 });
            const st = (l) => ({ n: l.length, median: +Z.med(l.map((x) => x.d)).toFixed(2), mittel: +(l.reduce((x, y) => x + y.d, 0) / (l.length || 1)).toFixed(2), p95: +Z.p(l.map((x) => x.d), 0.95).toFixed(2), p99: +Z.p(l.map((x) => x.d), 0.99).toFixed(2) });
            let wechsel = 0;
            for (let i = 1; i < a.length; i++) wechsel += Math.abs(a[i].d - a[i - 1].d);
            ok({ uebersprungen: st(a.filter((x) => x.s)), gerendert: st(a.filter((x) => !x.s)), geradeIndex: st(a.filter((x) => x.p === 0)), ungeradeIndex: st(a.filter((x) => x.p === 1)), alle: st(a), wechselMittel: +(wechsel / (a.length - 1)).toFixed(3) });
          }
        });
      });
    // Der bewegte Werfer: ein Quader, per Bild-Nummer bewegt, damit gepaarte Bilder denselben Stand haben.
    Z.werfer = null;
    Z.baueWerfer = () => {
      if (Z.werfer) return Z.werfer;
      const Mesh = scene.meshes.find((m) => m.getClassName() === 'Mesh').constructor;
      const m = new Mesh('bewegtTest', scene);
      const b = 0.5;
      const h = 3.6;
      m.setVerticesData('position', [-b, 0, -b, b, 0, -b, b, h, -b, -b, h, -b, -b, 0, b, b, 0, b, b, h, b, -b, h, b], false);
      m.setIndices([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
      // Ohne Normalen, UVs und ein Material, das der Client sicher uebersetzt, wird der Quader nie gezeichnet.
      const pos = [-b, 0, -b, b, 0, -b, b, h, -b, -b, h, -b, -b, 0, b, b, 0, b, b, h, b, -b, h, b];
      m.setVerticesData('normal', pos.map((v, i) => (i % 3 === 1 ? (v > 0 ? 1 : -1) : v > 0 ? 0.7 : -0.7)), false);
      m.setVerticesData('uv', [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], false);
      const vorlage = scene.meshes.find((x) => x.name.startsWith('schattenVegetation_') && x.material && !x.material.shadowDepthWrapper);
      if (vorlage) m.material = vorlage.material;
      m.layerMask = 0x0fffffff;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      // Beim Anlegen stand der Quader ohne Geometrie im Ursprung: Erst jetzt, nahe beim Spieler, aufnehmen.
      m.position.copyFrom(scene.activeCamera.position);
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo?.();
      sh.meldeWerfer(m);
      Z.werfer = m;
      return m;
    };
    Z.entferneWerfer = () => {
      if (!Z.werfer) return;
      sh.entferneWerfer(Z.werfer);
      Z.werfer.dispose();
      Z.werfer = null;
    };
  });
  await page.evaluate(() => window.__vb.setze('temporalAA', 0));
  await page.evaluate(() => window.__vb.sway(0, 0));

  if (TEILE.includes('1')) {
  // 1. Gleichmass
  bericht.gleichmass = { stand: {}, sprint: {} };
  for (const t of [1, 2]) {
    await setzeTaktPruefung(t);
    await page.evaluate(() => window.__z.bilder(30));
    bericht.gleichmass.stand[t] = await page.evaluate(() => window.__z.paritaet(600));
    console.log(`[schatten-ii] Gleichmass Stand Takt ${t}: ${JSON.stringify(bericht.gleichmass.stand[t])}`);
  }
  await page.evaluate(() => {
    const p = window.__dbg.player.position;
    window.__vb.teleport(p.x, p.z, 0);
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let r = 0; r < 3; r++) {
    for (const t of [1, 2]) {
      await setzeTaktPruefung(t);
      await page.evaluate(() => window.__z.bilder(20));
      const m = await page.evaluate(() => window.__z.paritaet(400));
      (bericht.gleichmass.sprint[t] ||= []).push(m);
      console.log(`[schatten-ii] Gleichmass Sprint Takt ${t} Runde ${r + 1}: gerendert ${m.gerendert.median}/${m.gerendert.p95}, uebersprungen ${m.uebersprungen.median}/${m.uebersprungen.p95}, Wechsel ${m.wechselMittel}`);
    }
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await setzeTaktPruefung(2);
  }

  if (TEILE.includes('2')) {
  // 2. Bewegter Werfer, gepaart
  bericht.werfer = await page.evaluate(async (abstaende) => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    const sh = window.__dbg.shadows;
    const takt = sh.fernTakt;
    const cam = scene.activeCamera;
    const p0 = cam.position.clone();
    const f0 = cam.getForwardRay().direction.clone();
    const fwd = f0.clone();
    fwd.y = 0;
    fwd.normalize();
    const quer = new p0.constructor(fwd.z, 0, -fwd.x);
    const m = Z.baueWerfer();
    const imListe = sh.generator.getShadowMap().renderList.includes(m);
    let k = 0;
    let aktiv = false;
    let abstand = 10;
    let tempo = 5;
    const ort = (kk) => {
      const mitte = p0.add(fwd.scale(abstand));
      const p = mitte.add(quer.scale((kk - 100) * (tempo / 90)));
      p.y = window.__vb.groundAt(p.x, p.z);
      return p;
    };
    const o = scene.onBeforeRenderObservable.add(() => {
      if (!aktiv) return;
      cam.position.copyFrom(p0);
      // Blick auf die Mitte des Weges des Quaders: er ist in jedem Bild im Bild.
      const mitte = p0.add(fwd.scale(abstand));
      mitte.y = window.__vb.groundAt(mitte.x, mitte.z) + 1.5;
      cam.setTarget(mitte);
      m.position.copyFrom(ort(k));
    });
    const out = {};
    const N = 16;
    for (const a of abstaende) {
      for (const v of [5, 8]) {
        abstand = a;
        tempo = v;
        aktiv = true;
        await Z.bilder(30);
        const stale = [];
        let echt = 0;
        for (let i = 0; i < N; i++) {
          k = 100 + i - 1; // Das frische Bild davor steht eine Stelle zurueck
          sh.profil.schatten.fernTakt = 1;
          await Z.grab();
          k = 100 + i;
          sh.profil.schatten.fernTakt = 2;
          takt.seit = 0;
          const vor = takt.uebersprungen;
          const s1 = await Z.grab();
          if (takt.uebersprungen > vor) echt++;
          sh.profil.schatten.fernTakt = 1;
          const f1 = await Z.grab();
          stale.push(Z.unterschied(s1, f1));
        }
        // Gegenprobe: Ist der Schatten des Quaders ueberhaupt im Bild? Frisches Bild mit und ohne Quader.
        sh.profil.schatten.fernTakt = 1;
        k = 108;
        m.setEnabled(false);
        const ohne = await Z.grab();
        m.setEnabled(true);
        const mit = await Z.grab();
        const sichtbar = Z.unterschied(mit, ohne);
        sh.profil.schatten.fernTakt = 2;
        out[`${a}m_${v}ms`] = { ...Z.mittelUnterschied(stale), uebersprungeneBilder: echt, versatzCm: +((v / 90) * 100).toFixed(1), quaderImBild: sichtbar, quaderSichtbar: sichtbar.p4 > 0 };
      }
    }
    aktiv = false;
    scene.onBeforeRenderObservable.remove(o);
    out.werferInDerListe = imListe;
    out.quaderDiagnose = { material: m.material?.name ?? null, bereit: m.isReady(true), aktiv: m.isEnabled(), sichtbar: m.isVisible, teilMeshes: m.subMeshes?.length ?? 0 };
    return out;
  }, ABSTAENDE);
  for (const [k, v] of Object.entries(bericht.werfer)) console.log(`[schatten-ii] Werfer ${k}: ${JSON.stringify(v)}`);

  // 2b. Flackern mit bewegtem Werfer in der Ueberblendzone: dunkle Einbrueche Takt 1 gegen 2
  bericht.werferFlackern = await page.evaluate(async () => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    const engine = scene.getEngine();
    const sh = window.__dbg.shadows;
    const cam = scene.activeCamera;
    const p0 = cam.position.clone();
    const f0 = cam.getForwardRay().direction.clone();
    const fwd = f0.clone();
    fwd.y = 0;
    fwd.normalize();
    const quer = new p0.constructor(fwd.z, 0, -fwd.x);
    const m = Z.baueWerfer();
    let k = 0;
    let aktiv = false;
    const o = scene.onBeforeRenderObservable.add(() => {
      if (!aktiv) return;
      cam.position.copyFrom(p0);
      const mitte = p0.add(fwd.scale(17));
      mitte.y = window.__vb.groundAt(mitte.x, mitte.z) + 1.5;
      cam.setTarget(mitte);
      const p = p0.add(fwd.scale(17)).add(quer.scale((((k % 240) - 120) * 5) / 90));
      p.y = window.__vb.groundAt(p.x, p.z);
      m.position.copyFrom(p);
    });
    const w = engine.getRenderWidth();
    const zeilen = Math.floor(engine.getRenderHeight() * 0.55);
    const n = w * zeilen;
    const lauf = async (takt) => {
      sh.profil.schatten.fernTakt = takt;
      aktiv = true;
      await Z.bilder(20);
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      const c = new Float32Array(n);
      let dips = 0;
      let blips = 0;
      const BILDER = 200;
      for (let t = 0; t < BILDER; t++) {
        k = 1000 + t;
        await new Promise((ok) =>
          scene.onAfterRenderObservable.addOnce(async () => {
            const px = new Uint8Array(await engine.readPixels(0, 0, w, zeilen));
            for (let i = 0, q = 0; i < n; i++, q += 4) c[i] = 0.2126 * px[q] + 0.7152 * px[q + 1] + 0.0722 * px[q + 2];
            if (t >= 2) {
              for (let i = 0; i < n; i++) {
                const mm = b[i];
                if (mm < Math.min(a[i], c[i]) - 10) dips++;
                else if (mm > Math.max(a[i], c[i]) + 10) blips++;
              }
            }
            a.set(b);
            b.set(c);
            ok();
          })
        );
      }
      aktiv = false;
      return { dipProzent: +((100 * dips) / (n * (BILDER - 2))).toFixed(4), blipProzent: +((100 * blips) / (n * (BILDER - 2))).toFixed(4) };
    };
    const out = { takt1: [], takt2: [] };
    for (let r = 0; r < 3; r++) {
      out.takt1.push(await lauf(1));
      out.takt2.push(await lauf(2));
    }
    sh.profil.schatten.fernTakt = 2;
    scene.onBeforeRenderObservable.remove(o);
    return out;
  });
  console.log(`[schatten-ii] Werfer-Flackern: ${JSON.stringify(bericht.werferFlackern)}`);

  // 2c. Bildpaar in der Ueberblendzone (uebersprungen / frisch / Differenz)
  {
    const r = await page.evaluate(async () => {
      const Z = window.__z;
      const scene = window.__dbg.scene;
      const sh = window.__dbg.shadows;
      const takt = sh.fernTakt;
      document.body.classList.add('ui-versteckt');
      const cam = scene.activeCamera;
      const p0 = cam.position.clone();
      const f0 = cam.getForwardRay().direction.clone();
      const fwd = f0.clone();
      fwd.y = 0;
      fwd.normalize();
      const quer = new p0.constructor(fwd.z, 0, -fwd.x);
      const m = Z.baueWerfer();
      let k = 0;
      const o = scene.onBeforeRenderObservable.add(() => {
        cam.position.copyFrom(p0);
        const mitte = p0.add(fwd.scale(17));
        mitte.y = window.__vb.groundAt(mitte.x, mitte.z) + 1.5;
        cam.setTarget(mitte);
        const p = p0.add(fwd.scale(17)).add(quer.scale((k * 8) / 90));
        p.y = window.__vb.groundAt(p.x, p.z);
        m.position.copyFrom(p);
      });
      const lum = (b) => {
        const L = new Uint8Array(b.w * b.h);
        for (let q = 0, s = 0; q < L.length; q++, s += 4) L[q] = 0.2126 * b.px[s] + 0.7152 * b.px[s + 1] + 0.0722 * b.px[s + 2];
        return { L, w: b.w, h: b.h };
      };
      k = 49;
      sh.profil.schatten.fernTakt = 1;
      await Z.farbeGrab();
      k = 50;
      sh.profil.schatten.fernTakt = 2;
      takt.seit = 0;
      const s1 = await Z.farbeGrab();
      sh.profil.schatten.fernTakt = 1;
      const f1 = await Z.farbeGrab();
      const a = lum(s1);
      const b = lum(f1);
      const diff = { L: new Uint8Array(a.L.length), w: a.w, h: a.h };
      for (let i = 0; i < diff.L.length; i++) diff.L[i] = Math.abs(a.L[i] - b.L[i]);
      sh.profil.schatten.fernTakt = 2;
      scene.onBeforeRenderObservable.remove(o);
      return { stale: Z.farbePng(s1), frisch: Z.farbePng(f1), diff: await Z.png(a, diff) };
    });
    writeFileSync(join(bilderDir, 'g15-werfer-17m-uebersprungen.png'), Buffer.from(r.stale, 'base64'));
    writeFileSync(join(bilderDir, 'g15-werfer-17m-frisch.png'), Buffer.from(r.frisch, 'base64'));
    writeFileSync(join(bilderDir, 'g15-werfer-17m-differenz-x20.png'), Buffer.from(r.diff, 'base64'));
  }
  await page.evaluate(() => window.__z.entferneWerfer());
  }

  if (TEILE.includes('3')) {
  // 3. Schwenk und Teleport
  bericht.schwenk = await page.evaluate(async () => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    const sh = window.__dbg.shadows;
    const takt = sh.fernTakt;
    const cam = scene.activeCamera;
    const p0 = cam.position.clone();
    const f0 = cam.getForwardRay().direction.clone();
    const yaw0 = Math.atan2(f0.x, f0.z);
    let k = 0;
    let aktiv = false;
    let grad = 3;
    const o = scene.onBeforeRenderObservable.add(() => {
      if (!aktiv) return;
      const y = yaw0 + k * ((grad * Math.PI) / 180);
      cam.position.copyFrom(p0);
      cam.setTarget(p0.add(new p0.constructor(Math.sin(y) * 10, f0.y * 10, Math.cos(y) * 10)));
    });
    const out = {};
    for (const gradProBild of [2, 4, 8]) {
      grad = gradProBild;
      aktiv = true;
      sh.profil.schatten.fernTakt = 2;
      await Z.bilder(20);
      const vor = { u: takt.uebersprungen, g: takt.gerendert, l: takt.luecken };
      const gierVon = (() => {
        const f = cam.getForwardRay().direction;
        return Math.atan2(f.x, f.z);
      })();
      let gierNach = gierVon;
      for (let i = 0; i < 120; i++) {
        k = i;
        await Z.bilder(1);
        if (i === 29) {
          const f = cam.getForwardRay().direction;
          gierNach = Math.atan2(f.x, f.z);
        }
      }
      const gemessenGrad = +((((gierNach - gierVon) * 180) / Math.PI) / 30).toFixed(2);
      const nach = { u: takt.uebersprungen, g: takt.gerendert, l: takt.luecken };
      // gepaart wie oben
      const stale = [];
      for (let i = 0; i < 16; i++) {
        k = 300 + i - 1; // Das frische Bild davor steht eine Stelle zurueck
        sh.profil.schatten.fernTakt = 1;
        await Z.grab();
        k = 300 + i;
        sh.profil.schatten.fernTakt = 2;
        takt.seit = 0;
        const s1 = await Z.grab();
        sh.profil.schatten.fernTakt = 1;
        const f1 = await Z.grab();
        stale.push(Z.unterschied(s1, f1));
      }
      sh.profil.schatten.fernTakt = 2;
      out[`${gradProBild}grad_je_bild`] = { gemessenGradJeBild: gemessenGrad, bilder: 120, uebersprungen: nach.u - vor.u, gerendert: nach.g - vor.g, erzwungeneNeuzeichnungen: nach.l - vor.l, gepaart: Z.mittelUnterschied(stale) };
    }
    aktiv = false;
    scene.onBeforeRenderObservable.remove(o);
    return out;
  });
  for (const [k, v] of Object.entries(bericht.schwenk)) console.log(`[schatten-ii] Schwenk ${k}: ${JSON.stringify(v)}`);

  // Teleport: Neuzeichnungen und die Bilder danach
  bericht.teleport = [];
  for (const [dx, dz] of [[120, 0], [0, -300], [-60, 60]]) {
    const vor = await page.evaluate(() => {
      const t = window.__dbg.shadows.fernTakt;
      const p = window.__dbg.player.position;
      return { u: t.uebersprungen, g: t.gerendert, l: t.luecken, x: p.x, z: p.z };
    });
    await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [Math.round(vor.x + dx), Math.round(vor.z + dz)]);
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      const Z = window.__z;
      const sh = window.__dbg.shadows;
      const takt = sh.fernTakt;
      const roh = [];
      for (let i = 0; i < 40; i++) {
        await Z.bilder(1);
        sh.profil.schatten.fernTakt = 2;
        const a = await Z.grab();
        sh.profil.schatten.fernTakt = 1;
        const b = await Z.grab();
        sh.profil.schatten.fernTakt = 2;
        roh.push(Z.unterschied(a, b, 0.3));
      }
      return { luecken: takt.luecken, maxP8: Math.max(...roh.map((x) => x.p8)), mittelP8: +(roh.reduce((s, x) => s + x.p8, 0) / roh.length).toFixed(4), maxP16: Math.max(...roh.map((x) => x.p16)) };
    });
    bericht.teleport.push({ verschiebung: [dx, dz], erzwungeneNeuzeichnungenSeitStart: r.luecken - vor.l, bilderNachDemEreignis: 40, maxP8: r.maxP8, mittelP8: r.mittelP8, maxP16: r.maxP16 });
    console.log(`[schatten-ii] Teleport ${dx}/${dz}: ${JSON.stringify(bericht.teleport.at(-1))}`);
    await page.waitForTimeout(6000);
  }
  }

  await page.evaluate(() => window.__vb.setze('temporalAA', 1));
}

// ── Modus takt ───────────────────────────────────────────────────────
if (MODUS === 'takt') {
  const setzeTakt = (t) => page.evaluate((n) => (window.__dbg.shadows.profil.schatten.fernTakt = n), t);
  const zaehler = () => page.evaluate(() => {
    const t = window.__dbg.shadows.fernTakt;
    return { uebersprungen: t.uebersprungen, gerendert: t.gerendert, luecken: t.luecken };
  });
  await page.evaluate(() => window.__vb.setze('temporalAA', 0));

  // 1. Stand, abwechselnd
  bericht.stand = await page.evaluate(async ([runden, bilder]) => {
    const Z = window.__z;
    const roh = { 1: [], 2: [] };
    for (let r = 0; r < runden; r++) {
      for (const t of [1, 2]) {
        window.__dbg.shadows.profil.schatten.fernTakt = t;
        await Z.bilder(30);
        const m = await Z.messe(bilder, 'frame');
        roh[t].push({ abstandP50: m.abstandP50, abstandP95: m.abstandP95, cpuRender: m.cpuRender, gpuFrame: m.gpuFrame });
      }
    }
    window.__dbg.shadows.profil.schatten.fernTakt = 2;
    const med = Object.fromEntries(
      Object.entries(roh).map(([k, v]) => [k, Object.fromEntries(['abstandP50', 'abstandP95', 'cpuRender', 'gpuFrame'].map((f) => [f, Z.med(v.map((x) => x[f]))]))])
    );
    return { roh, median: med };
  }, [RUNDEN, BILDER]);
  console.log(`[schatten-ii] Stand Takt 1: ${JSON.stringify(bericht.stand.median[1])}`);
  console.log(`[schatten-ii] Stand Takt 2: ${JSON.stringify(bericht.stand.median[2])}`);

  // 2. Gepaarte Bilder: uebersprungen gegen frisch am selben Ort
  bericht.bilder = await page.evaluate(async () => {
    const Z = window.__z;
    const scene = window.__dbg.scene;
    const sh = window.__dbg.shadows;
    const cam = scene.activeCamera;
    const p0 = cam.position.clone();
    const f0 = cam.getForwardRay().direction.clone();
    const fwd = f0.clone();
    fwd.y = 0;
    fwd.normalize();
    const yaw0 = Math.atan2(f0.x, f0.z);
    let k = 0;
    let bewegung = 'schub';
    let aktiv = false;
    const o = scene.onBeforeRenderObservable.add(() => {
      if (!aktiv) return;
      if (bewegung === 'schub') {
        const p = p0.add(fwd.scale(k * (8 / 60)));
        cam.position.copyFrom(p);
        cam.setTarget(p.add(fwd.scale(10)));
      } else {
        const y = yaw0 + k * ((3 * Math.PI) / 180);
        cam.position.copyFrom(p0);
        cam.setTarget(p0.add(new p0.constructor(Math.sin(y) * 10, f0.y * 10, Math.cos(y) * 10)));
      }
    });
    const N = 16;
    const out = {};
    for (const art of ['schub', 'drehung']) {
      bewegung = art;
      aktiv = true;
      const takt = sh.fernTakt;
      const rauschen = [];
      const stale = [];
      sh.profil.schatten.fernTakt = 1;
      await Z.bilder(6);
      for (let i = 0; i < N; i++) {
        k = 200 + i;
        const a = await Z.grab();
        const b = await Z.grab();
        rauschen.push(Z.unterschied(a, b));
      }
      sh.profil.schatten.fernTakt = 2;
      let nachweis = 0;
      for (let i = 0; i < N; i++) {
        // Erst ein frisches Bild eine Stelle zurueck, dann das uebersprungene an der naechsten, dann dasselbe frisch.
        k = 300 + i - 1;
        sh.profil.schatten.fernTakt = 1;
        await Z.grab();
        k = 300 + i;
        sh.profil.schatten.fernTakt = 2;
        takt.seit = 0;
        const vorher = takt.uebersprungen;
        const s1 = await Z.grab();
        if (takt.uebersprungen > vorher) nachweis++;
        sh.profil.schatten.fernTakt = 1;
        const f1 = await Z.grab();
        stale.push(Z.unterschied(s1, f1));
      }
      sh.profil.schatten.fernTakt = 2;
      out[art] = { rauschboden: Z.mittelUnterschied(rauschen), uebersprungenGegenFrisch: Z.mittelUnterschied(stale), uebersprungeneBilder: nachweis };
    }
    aktiv = false;
    scene.onBeforeRenderObservable.remove(o);
    return out;
  });
  console.log(`[schatten-ii] Bilder: ${JSON.stringify(bericht.bilder)}`);

  // 3. Sprint, Segmente im Muster A B B A (ein linearer Gang der Last hebt sich je Vierergruppe auf)
  await page.evaluate(() => {
    const p = window.__dbg.player.position;
    window.__vb.teleport(p.x, p.z, 0);
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  bericht.sprint = [];
  const gepoolt = { 1: [], 2: [] };
  let gelaufen = 0;
  const MUSTER = [1, 2, 2, 1];
  for (let s = 0; s < SEGMENTE; s++) {
    const takt = MUSTER[s % 4];
    await setzeTakt(takt);
    const vor = await zaehler();
    const start = await page.evaluate(() => {
      const p = window.__dbg.player.position;
      return { x: p.x, z: p.z };
    });
    // Bis SEGMENT_M gelaufen sind, die Bildabstaende der ganzen Zeit sammeln.
    const roh = await page.evaluate(async (meter) => {
      const scene = window.__dbg.scene;
      const p0 = window.__dbg.player.position;
      const x0 = p0.x;
      const z0 = p0.z;
      const t = [];
      await new Promise((ok) => {
        const o = scene.onAfterRenderObservable.add(() => {
          t.push(performance.now());
          const p = window.__dbg.player.position;
          if (Math.hypot(p.x - x0, p.z - z0) >= meter || t.length > 4000) {
            scene.onAfterRenderObservable.remove(o);
            ok();
          }
        });
      });
      const a = [];
      for (let i = 2; i < t.length; i++) a.push(+(t[i] - t[i - 1]).toFixed(2));
      return a;
    }, SEGMENT_M);
    const nach = await zaehler();
    const ende = await page.evaluate(() => {
      const p = window.__dbg.player.position;
      return { x: p.x, z: p.z };
    });
    const strecke = Math.hypot(ende.x - start.x, ende.z - start.z);
    gelaufen += strecke;
    gepoolt[takt].push(...roh);
    const mittel = roh.reduce((x, y) => x + y, 0) / roh.length;
    const sortiert = [...roh].sort((x, y) => x - y);
    bericht.sprint.push({ segment: s, takt, strecke: +strecke.toFixed(1), bilder: roh.length, mittel: +mittel.toFixed(2), p50: sortiert[Math.floor(sortiert.length * 0.5)], uebersprungen: nach.uebersprungen - vor.uebersprungen, gerendert: nach.gerendert - vor.gerendert, luecken: nach.luecken - vor.luecken });
    console.log(`[schatten-ii] Sprint ${s} Takt ${takt}: ${strecke.toFixed(1)} m, ${roh.length} Bilder, mittel ${mittel.toFixed(2)}, p50 ${sortiert[Math.floor(sortiert.length * 0.5)]}, uebersprungen ${nach.uebersprungen - vor.uebersprungen}/${nach.gerendert - vor.gerendert}`);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  bericht.sprintStrecke = { angefordert: SEGMENTE * SEGMENT_M, gelaufen: +gelaufen.toFixed(1) };
  const pool = (l) => {
    const x = [...l].sort((a, b) => a - b);
    const q = (p) => x[Math.min(x.length - 1, Math.floor(x.length * p))];
    return { bilder: x.length, mittel: +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99) };
  };
  // Vierergruppen A B B A: Differenz der Mittel je Gruppe
  const quads = [];
  for (let g = 0; g + 3 < bericht.sprint.length; g += 4) {
    const q = bericht.sprint.slice(g, g + 4);
    const m = (t) => q.filter((x) => x.takt === t).reduce((a, x) => a + x.mittel, 0) / 2;
    quads.push(+(m(2) - m(1)).toFixed(2));
  }
  bericht.sprintGepoolt = { 1: pool(gepoolt[1]), 2: pool(gepoolt[2]), differenzMittelJeVierergruppe: quads };
  console.log(`[schatten-ii] Sprint gepoolt Takt 1: ${JSON.stringify(bericht.sprintGepoolt[1])}`);
  console.log(`[schatten-ii] Sprint gepoolt Takt 2: ${JSON.stringify(bericht.sprintGepoolt[2])}`);
  console.log(`[schatten-ii] Differenz Takt2 - Takt1 je A-B-B-A-Gruppe (Mittel, ms): ${JSON.stringify(quads)}`);
  await page.evaluate(() => window.__vb.setze('temporalAA', 1));
}

bericht.konsole = konsole.slice(0, 20);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bericht, null, 2));
console.log(`[schatten-ii] geschrieben: ${OUT}`);
await browser.close();
