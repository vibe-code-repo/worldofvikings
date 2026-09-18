/**
 * Schatten messen: Kaskadengrenze (G18), Laubwurf (G20), Flackern und
 * TAA-Reihenfolge (G19) — eine Sitzung, ein Bericht.
 *
 * ── Was es misst ─────────────────────────────────────────────────────
 *  layout   Kaskadengrenzen (Sichttiefe in m), Texelbreite je Kaskade in cm,
 *           am laufenden Generator gelesen (`__dbg.shadows.messwerte()`).
 *  laub     Werferliste nach Alphatest-Material getrennt, wie viele Laub-Klone
 *           der Generator als bereit meldet, und die Schattenflaeche des
 *           Laubs allein. Die Flaeche entsteht aus ZWEI Bildern derselben
 *           Kamera (`darkness` 1 = kein Schatten, 0 = schwarz): 1 − hell/Bezug.
 *  taa      Reihenfolge der Kamerakette nach jedem Umschalten eines anderen
 *           Effekts. `hinten` kommt aus `__vb.taa()` — der Zeuge des Clients.
 *  flimmern „Dunkle Einbrueche" je Bildpunkt und Bild in der unteren Bildhaelfte
 *           bei FESTER Kamera: die Helligkeit faellt gegen beide Nachbarbilder
 *           um mehr als 10 von 255 und kommt zurueck. Die Sonne LAEUFT dabei
 *           im Spieltempo (Tageslauf 30 min = 1/1800 je Sekunde) — die
 *           laufende Sonne gehoert in die Messung; wer sie festsetzt, misst
 *           das Flackern nicht, um das es geht. Zellen: Sonne steht/laeuft,
 *           Wind an/aus, Schatten aus (darkness 1), TAA aus/an.
 *
 * ── Grenzen ──────────────────────────────────────────────────────────
 *  · Bei bewegter Kamera aendert sich jeder Bildpunkt legitim; ein Vergleich
 *    Bild gegen Bild taugt dort nicht. „Figur laeuft" ist damit NICHT gemessen.
 *  · n = 1 je Zelle und Lauf; `--runden` wiederholt. Zellen mit Wind streuen
 *    um Faktor ~2 zwischen Laeufen (Windzustand), die ohne Wind um weniger.
 *  · Braucht Adminrechte fuer `teleport` (`everyone-admin: true` in der
 *    server.yml des Arbeitsbaums, nie einchecken) und ein sichtbares Fenster
 *    auf einer echten GPU — SwiftShader/llvmpipe bricht ab, wie bei
 *    `pw-fps-bench.mjs`. Messsperre: `~/.cache/wov-mess.lock`.
 *
 * Aufruf:
 *   node tools/pw-schatten-g18-g20.mjs --url http://127.0.0.1:5292 --runden 3
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const URL_ZIEL = arg('url', 'http://127.0.0.1:5292');
const OUT = arg('out', 'mess/schatten-g18-g20.json');
/** Baumszene im Wald am Start; Kamera 12 m vom Kronenschatten, Blick ueber die Sonnenrichtung. */
const SPIELER_X = Number(arg('x', -16945));
const SPIELER_Z = Number(arg('z', -5425));
const ZIEL_X = Number(arg('zielx', -16950));
const ZIEL_Z = Number(arg('zielz', -5425.4));
const RUNDEN = Math.max(1, Number(arg('runden', 2)));
const BILDER = Number(arg('bilder', 240));
/** Feste Tageszeit fuer den Start; die Sonne wird danach von Hand im Spieltempo bewegt. */
const TAGESZEIT = arg('t', '0.708333');

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
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
});
const kontext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await kontext.newPage();
await page.addInitScript(([t]) => localStorage.setItem('wov-session-token', t), [testToken()]);
await page.goto(`${URL_ZIEL}/?name=SchattenBot${Date.now().toString(36).slice(-4)}&t=${TAGESZEIT}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
});
console.log(`[schatten] GPU: ${gpu}`);
if (!gpu || /swiftshader|llvmpipe|software/i.test(gpu)) {
  console.error('[schatten] ABBRUCH: kein Hardware-Renderer.');
  await browser.close();
  process.exit(2);
}
await page.waitForFunction(() => Boolean(window.__vb?.profil && window.__dbg?.player && window.__dbg?.scene?.activeCamera), undefined, { timeout: 180_000 });
await page.waitForFunction(() => window.__dbg?.terrain?.ready !== false, undefined, { timeout: 120_000 }).catch(() => {});
await page.bringToFront();
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});

/** Die Hilfsfunktionen leben in der Seite; alles Weitere ruft sie auf. */
await page.evaluate(() => {
  const d = window.__dbg;
  const scene = d.scene;
  const engine = scene.getEngine();
  const H = (window.__mess = {});
  H.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  H.frames = (n) =>
    new Promise((ok) => {
      let k = 0;
      const o = scene.onAfterRenderObservable.add(() => {
        if (++k >= n) {
          scene.onAfterRenderObservable.remove(o);
          ok(k);
        }
      });
    });
  // Kamera fest: die Spielerkamera setzt ihre Lage jedes Bild neu, wir ueberschreiben danach.
  H.pose = null;
  scene.onBeforeRenderObservable.add(() => {
    const p = H.pose;
    if (!p) return;
    const c = scene.activeCamera;
    c.position.set(p.px, p.py, p.pz);
    c.setTarget(new c.position.constructor(p.tx, p.ty, p.tz));
  });
  H.stellePose = (tx, tz, dist, gierGrad, neigungGrad) => {
    const ty = window.__vb.groundAt(tx, tz);
    const g = (gierGrad * Math.PI) / 180;
    const n = (neigungGrad * Math.PI) / 180;
    H.pose = {
      tx, ty, tz,
      px: tx - Math.sin(g) * Math.cos(n) * dist,
      py: ty + Math.sin(n) * dist,
      pz: tz - Math.cos(g) * Math.cos(n) * dist,
      dist,
    };
  };
  // Sonne im Spieltempo bewegen, waehrend `paused` bleibt (Server-Uhr wuerde sonst uebernehmen).
  H.sonneLaeuft = false;
  scene.onBeforeRenderObservable.add(() => {
    if (!H.sonneLaeuft) return;
    d.lighting.paused = true;
    d.lighting.timeOfDay = (d.lighting.timeOfDay + engine.getDeltaTime() / 1000 / 1800) % 1;
  });
  H.bild = () =>
    new Promise((ok) => {
      scene.onAfterRenderObservable.addOnce(async () => {
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        const px = new Uint8Array(await engine.readPixels(0, 0, w, h));
        const lum = new Float32Array(w * h);
        for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
        ok({ w, h, lum });
      });
    });
  /** Schattenmaske: 1 − hell(darkness 0) / hell(darkness 1); `vorher` darf die Werferliste aendern. */
  H.schattenFlaeche = async (vorher) => {
    const g = d.shadows.generator;
    const merke = g.darkness;
    g.darkness = 1;
    await H.frames(3);
    const bezug = await H.bild();
    g.darkness = 0;
    await H.frames(2);
    if (vorher) await vorher();
    await H.frames(4);
    const mit = await H.bild();
    g.darkness = merke;
    let flaeche = 0;
    for (let i = 0; i < bezug.lum.length; i++) {
      const s = bezug.lum[i] > 30 ? Math.min(1, Math.max(0, 1 - mit.lum[i] / bezug.lum[i])) : 0;
      if (s > 0.19) flaeche++;
    }
    return +((100 * flaeche) / bezug.lum.length).toFixed(3);
  };
  H.einbrueche = (bilder, delta = 10, anteil = 0.55) =>
    new Promise((ok) => {
      const w = engine.getRenderWidth();
      const zeilen = Math.floor(engine.getRenderHeight() * anteil);
      const n = w * zeilen;
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      const c = new Float32Array(n);
      let dips = 0;
      let blips = 0;
      let t = 0;
      const sonne0 = d.lighting.timeOfDay;
      const naechstes = () =>
        scene.onAfterRenderObservable.addOnce(async () => {
          const px = new Uint8Array(await engine.readPixels(0, 0, w, zeilen));
          for (let i = 0, p = 0; i < n; i++, p += 4) c[i] = 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
          if (t >= 2) {
            for (let i = 0; i < n; i++) {
              const m = b[i];
              if (m < Math.min(a[i], c[i]) - delta) dips++;
              else if (m > Math.max(a[i], c[i]) + delta) blips++;
            }
          }
          a.set(b);
          b.set(c);
          t++;
          if (t >= bilder) ok({ dipProzent: +((100 * dips) / (n * (bilder - 2))).toFixed(4), blipProzent: +((100 * blips) / (n * (bilder - 2))).toFixed(4), sonneGrad: +((d.lighting.timeOfDay - sonne0) * 360).toFixed(2) });
          else naechstes();
        });
      naechstes();
    });
  H.kette = () => scene.activeCamera._postProcesses.filter(Boolean).map((p) => p.name);
});

// ── Ort ──────────────────────────────────────────────────────────────
const tpOk = await page.evaluate(([x, z]) => window.__vb.admin(`teleport ${x} ${z}`), [SPIELER_X, SPIELER_Z]);
if (!tpOk) {
  console.error('[schatten] ABBRUCH: Admin-Teleport abgelehnt (everyone-admin im Arbeitsbaum an?).');
  await browser.close();
  process.exit(5);
}
await page.waitForTimeout(20_000);
await page.evaluate(([x, z]) => {
  window.__vb.sway(0, 0);
  const H = window.__mess;
  // Blick quer zur Sonnenrichtung, 12 m, 35° nach unten.
  H.stellePose(x, z, 12, -75, 35);
}, [ZIEL_X, ZIEL_Z]);
await page.waitForTimeout(3000);

const bericht = { gpu, url: URL_ZIEL, zeit: new Date().toISOString(), runden: RUNDEN, bilder: BILDER };

// ── layout ───────────────────────────────────────────────────────────
bericht.layout = await page.evaluate(() => {
  const g = window.__dbg.shadows.generator;
  const kanten = [];
  for (let i = 0; i < g.numCascades; i++) {
    const lo = g.getCascadeMinExtents(i);
    const hi = g.getCascadeMaxExtents(i);
    kanten.push(+((100 * (hi.x - lo.x)) / g.mapSize).toFixed(2));
  }
  return { messwerte: window.__dbg.shadows.messwerte(), texelCm: kanten };
});
console.log('[schatten] layout:', JSON.stringify(bericht.layout));

// ── laub ─────────────────────────────────────────────────────────────
bericht.laub = await page.evaluate(async () => {
  const H = window.__mess;
  const sh = window.__dbg.shadows;
  const g = sh.generator;
  const karte = g.getShadowMap();
  const istLaub = (m) => m.material?.transparencyMode === 1;
  const klone = karte.renderList.filter((m) => m.name.startsWith('schattenVegetation_') && m.material?.shadowDepthWrapper);
  const aktive = klone.filter((m) => m.thinInstanceCount > 0);
  const bereit = aktive.filter((m) => g.isReady(m.subMeshes[0], true, false)).length;
  const alle = [...karte.renderList];
  const nurLaub = await H.schattenFlaeche(async () => {
    karte.renderList = alle.filter(istLaub);
  });
  karte.renderList = alle;
  await H.frames(4);
  const gesamt = await H.schattenFlaeche();
  return {
    laubKlone: klone.length,
    davonMitInstanzen: aktive.length,
    davonBereit: bereit,
    schattenflaechePctNurLaub: nurLaub,
    schattenflaechePctGesamt: gesamt,
    statistik: sh.vegetationsSchattenStats(),
  };
});
console.log('[schatten] laub:', JSON.stringify(bericht.laub));

// ── taa ──────────────────────────────────────────────────────────────
bericht.taa = await page.evaluate(async () => {
  const H = window.__mess;
  const folge = [['bloom', 0], ['bloom', 1], ['motionBlur', 1], ['motionBlur', 0], ['depthOfField', 0], ['depthOfField', 1], ['antiAliasing', 0], ['antiAliasing', 1], ['ambientOcclusion', 1], ['ambientOcclusion', 0]];
  window.__vb.setze('temporalAA', 1);
  await H.sleep(1200);
  const spur = [{ schritt: 'TAA an', hinten: window.__vb.taa().hinten, ende: H.kette().slice(-3).join('>') }];
  for (const [k, v] of folge) {
    window.__vb.setze(k, v);
    await H.sleep(500);
    await H.frames(4);
    spur.push({ schritt: `${k} ${v}`, hinten: window.__vb.taa().hinten, ende: H.kette().slice(-3).join('>') });
  }
  window.__vb.setze('temporalAA', 0);
  await H.sleep(800);
  return { neuAngehaengt: window.__vb.taa().neuAngehaengt, spur };
});
console.log('[schatten] taa: hinten nach jedem Schritt =', bericht.taa.spur.map((s) => (s.hinten ? 1 : 0)).join(''));

// ── flimmern ─────────────────────────────────────────────────────────
const ZELLEN = [
  ['sonne steht, wind aus, TAA aus', { sonne: false, wind: false, taa: false, schatten: true }],
  ['sonne laeuft, wind aus, TAA aus', { sonne: true, wind: false, taa: false, schatten: true }],
  ['sonne laeuft, wind aus, Schatten aus', { sonne: true, wind: false, taa: false, schatten: false }],
  ['sonne laeuft, wind an, TAA aus', { sonne: true, wind: true, taa: false, schatten: true }],
  ['sonne laeuft, wind an, Schatten aus', { sonne: true, wind: true, taa: false, schatten: false }],
  ['sonne laeuft, wind an, TAA an', { sonne: true, wind: true, taa: true, schatten: true }],
];
bericht.flimmern = [];
for (let runde = 1; runde <= RUNDEN; runde++) {
  for (const [name, z] of ZELLEN) {
    await page.evaluate(async (zelle) => {
      const H = window.__mess;
      H.sonneLaeuft = zelle.sonne;
      if (zelle.wind) {
        window.__vb.sway(0.22, 3.0);
        window.__vb.setWind(135, 0.8);
      } else window.__vb.sway(0, 0);
      window.__vb.setze('temporalAA', zelle.taa ? 1 : 0);
      window.__dbg.shadows.generator.darkness = zelle.schatten ? 0.13 : 1;
      await H.sleep(1500);
      await H.frames(20);
    }, z);
    const m = await page.evaluate((b) => window.__mess.einbrueche(b), BILDER);
    const hinten = await page.evaluate(() => window.__vb.taa().hinten);
    bericht.flimmern.push({ runde, zelle: name, ...m, taaHinten: hinten });
    console.log(`[schatten] runde ${runde}  ${name.padEnd(38)} einbrueche ${String(m.dipProzent).padStart(8)} %  (sonne ${m.sonneGrad}°)`);
  }
}
await page.evaluate(() => {
  window.__mess.sonneLaeuft = false;
  window.__dbg.shadows.generator.darkness = window.__dbg.shadows.profil?.schatten?.dunkelheit ?? 0.13;
  window.__vb.setze('temporalAA', 0);
  window.__vb.resetWind?.();
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bericht, null, 2));
console.log(`[schatten] geschrieben: ${OUT}`);
await browser.close();
