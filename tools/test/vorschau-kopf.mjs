/**
 * Browserprobe fuer den Kopf-Zoom und den Helm der Charaktervorschau.
 *
 * Laedt das GEBAUTE Buendel (wov-web/static/assets/js/vorschau.js) auf einer
 * nackten Leinwand in echtem WebGL und prueft fuer beide Koerper, was
 * tools/web/vorschau-web.ts zusagt. Kein Konto, keine Schreibzugriffe.
 *
 *   node tools/test/vorschau-kopf.mjs [--basis <url>] [--buendel <pfad>] [--buendel-datei <datei>]
 *                                      [--bilder <ordner>] [--nur <regex>]
 *                                      [--vergleich-datei <datei>] [--vergleich-portraet-datei <datei>]
 *
 * Ohne --basis liefert die Probe wov-web/static selbst aus (Arbeitsverzeichnis =
 * Wurzel des Repos). Mit --basis steht ein Server bereit, der /assets/... kennt
 * (z. B. ein Tunnel), die Probe liefert dann nur die Leerseite. --buendel ist der
 * URL-Pfad des zu pruefenden Buendels (Vorgabe /assets/js/vorschau.js).
 *
 * Chromium startet nicht ueberall (auf wov-dev nicht); dort laeuft die Probe
 * ueber einen Tunnel auf einem Rechner mit Browser. NICHT in `npm test`.
 *
 * Die Probe misst, statt Zusagen abzunicken: der Kopfanteil kommt aus einer
 * gerenderten Kopfsilhouette (Alphakanal), der kleinste Kameraabstand aus
 * dem von Hand auf der CPU gehauteten Netz, nicht aus Bounding-Kugeln.
 * Ein Pruefpunkt, der wirft, zaehlt als Fehlschlag; Exit-Code 1, sobald einer scheitert.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, vorgabe) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : vorgabe);
const BUENDEL = arg('--buendel', '/assets/js/vorschau.js');
const BILDER = arg('--bilder', '');
/** Liefert statt des Servers diese lokale Datei als Buendel aus (z. B. das alte zum Gegenlauf). */
const BUENDEL_DATEI = arg('--buendel-datei', '');
/** Nur Schritte, deren Name zu diesem regulaeren Ausdruck passt (zum Nachstellen einzelner Faelle). */
const NUR = arg('--nur', '') ? new RegExp(arg('--nur', ''), 'i') : null;
/** Ein aelteres Buendel, gegen das das Ausgangsbild pixelweise verglichen wird. */
const VERGLEICH_DATEI = arg('--vergleich-datei', '');
/** Ein Buendel mit Kopf-Zoom (vorheriger Stand), gegen das das Portraet bei breiter Leinwand pixelweise verglichen wird. */
const VERGLEICH_PORTRAET_DATEI = arg('--vergleich-portraet-datei', '');
let basis = arg('--basis', '');

const wurzel = process.cwd();
let server = null;
if (!basis) {
  const statisch = path.resolve(wurzel, 'wov-web/static');
  server = http.createServer((req, res) => {
    const datei = path.join(statisch, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!datei.startsWith(statisch + path.sep) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const endung = path.extname(datei);
    res.setHeader('content-type', endung === '.js' ? 'text/javascript' : endung === '.json' ? 'application/json' : 'application/octet-stream');
    fs.createReadStream(datei).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  basis = `http://127.0.0.1:${server.address().port}`;
}
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });

/* ------------------------------------------------------------ Ergebnisse */

const ergebnisse = [];
let aktuellerKoerper = '';
function pruefe(name, ok, werte = {}) {
  ergebnisse.push({ name: `${aktuellerKoerper ? aktuellerKoerper + ': ' : ''}${name}`, ok: Boolean(ok), werte });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${aktuellerKoerper ? aktuellerKoerper + ': ' : ''}${name} ${JSON.stringify(werte)}`);
}
async function schritt(name, fn) {
  if (NUR && !NUR.test(name)) return;
  try {
    await fn();
  } catch (fehler) {
    pruefe(`${name} (Ausnahme)`, false, { fehler: String(fehler).slice(0, 300) });
  }
}

/* ------------------------------------------------------------ Browser */

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const seitenfehler = [];
const kontext = await browser.newContext({ viewport: { width: 900, height: 940 }, hasTouch: true });
const page = await kontext.newPage();
page.on('pageerror', (e) => seitenfehler.push(e.message));

/*
  Die Buehne der echten Seite im Kleinen: ein Elternelement (800 x 800) und
  eine Leinwand, die ueber alle Seiten hinausragt (inset -28px -10px -36px).
  So wird der Versatz zwischen Leinwand und Elternelement mitgemessen, auf dem
  die CSS-Variablen der Kopfmarkierung beruhen.
*/
const LEERSEITE = `<body style="margin:0"><div id="b" style="position:relative;margin:40px 40px 0 40px;width:800px;height:800px">
<canvas style="position:absolute;left:-10px;top:-28px;width:820px;height:864px;outline:none;touch-action:none"></canvas>
<div id="marke" style="position:absolute;left:var(--kopf-x);top:var(--kopf-y);width:calc(var(--kopf-r) * 2);height:calc(var(--kopf-r) * 2);transform:translate(-50%,-50%);pointer-events:none"></div>
</div></body>`;
await page.route(`${basis}/leer`, (route) => route.fulfill({ contentType: 'text/html', body: LEERSEITE }));
/*
  Maennliche Klassenruestungen verweisen im Katalog auf models/<familie>/...,
  die Webseite liefert sie aber unter models/armor/<familie>/. Dieser Umweg
  gehoert zur Probe, nicht zum Bau: Er laesst den Helm des Kriegers und die Krone des
  Druiden laden, damit beide getestet werden koennen.
*/
await page.route(/\/assets\/models\/(ironward|wildwarden|ashenveil)\//, (route) => {
  const url = route.request().url().replace('/assets/models/', '/assets/models/armor/');
  return route.continue({ url });
});
if (BUENDEL_DATEI) {
  await page.route(`${basis}${BUENDEL}`, (route) => route.fulfill({ path: BUENDEL_DATEI, contentType: 'text/javascript' }));
}
if (VERGLEICH_DATEI) {
  await page.route(`${basis}/assets/js/vorschau-vergleich.js`, (route) => route.fulfill({ path: VERGLEICH_DATEI, contentType: 'text/javascript' }));
}
if (VERGLEICH_PORTRAET_DATEI) {
  await page.route(`${basis}/assets/js/vorschau-vergleich2.js`, (route) => route.fulfill({ path: VERGLEICH_PORTRAET_DATEI, contentType: 'text/javascript' }));
}
await page.goto(`${basis}/leer`);

// Hilfsfunktionen im Browser
await page.evaluate(() => {
  const w = window;
  w.frames = (n) => new Promise((ok) => { let k = 0; const f = () => (++k >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  w.leinwandBox = () => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  // Kopfmitte unabhaengig von der Vorschau projizieren (Bildschirmkoordinaten der Seite).
  w.kopfProjektion = (v, kopfY = 1.62) => {
    const knochen = v.kopfKnoten?.getAbsolutePosition() ?? { x: 0, z: 0 };
    const B = window.__B;
    const p = B.Vector3.TransformCoordinates(new B.Vector3(knochen.x, kopfY, knochen.z), v.scene.getTransformMatrix());
    const b = w.leinwandBox();
    const view = B.Vector3.TransformCoordinates(new B.Vector3(knochen.x, kopfY, knochen.z), v.kamera.getViewMatrix()).z;
    return { x: b.x + (p.x + 1) / 2 * b.w, y: b.y + (1 - p.y) / 2 * b.h, tiefe: view, proMeter: b.h / (2 * view * Math.tan(v.kamera.fov / 2)) };
  };
  // Kleinster Abstand Kamera - Netz ueber alle sichtbaren Netze: jedes Netz auf der CPU
  // gehautet, dann Punkt-Dreieck-Abstand (nicht nur zum naechsten Eckpunkt: ein grosses
  // Dreieck kann die Kamera schneiden, ohne dass ein Eckpunkt in der Naehe liegt).
  w.punktDreieck = (p, a, b, c) => {
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const ab = sub(b, a); const ac = sub(c, a); const ap = sub(p, a);
    const d1 = dot(ab, ap); const d2 = dot(ac, ap);
    let q;
    if (d1 <= 0 && d2 <= 0) q = a;
    else {
      const bp = sub(p, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) q = b;
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); q = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]; }
        else {
          const cp = sub(p, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) q = c;
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); q = [a[0] + t * ac[0], a[1] + t * ac[1], a[2] + t * ac[2]]; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [b[0] + t * (c[0] - b[0]), b[1] + t * (c[1] - b[1]), b[2] + t * (c[2] - b[2])]; }
              else { const den = 1 / (va + vb + vc); const vv = vb * den; const ww = vc * den; q = [a[0] + ab[0] * vv + ac[0] * ww, a[1] + ab[1] * vv + ac[1] * ww, a[2] + ab[2] * vv + ac[2] * ww]; }
            }
          }
        }
      }
    }
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  w.minAbstand = (v) => {
    const cam = v.kamera.position; const P = [cam.x, cam.y, cam.z];
    let best = Infinity; let wer = '';
    for (const m of v.scene.meshes) {
      if (!m.isEnabled() || m.getTotalVertices() === 0) continue;
      m.computeWorldMatrix(true);
      const W = m.getWorldMatrix().m;
      const pos = m.getVerticesData('position');
      const ind = m.skeleton ? m.getVerticesData('matricesIndices') : null;
      const gew = ind ? m.getVerticesData('matricesWeights') : null;
      const indE = ind ? m.getVerticesData('matricesIndicesExtra') : null;
      const gewE = indE ? m.getVerticesData('matricesWeightsExtra') : null;
      const S = ind ? m.skeleton.getTransformMatrices(m) : null;
      const welt = new Float64Array(pos.length);
      for (let i = 0, j = 0; i < pos.length; i += 3, j += 4) {
        let x = pos[i]; let y = pos[i + 1]; let z = pos[i + 2];
        if (S) {
          let sx = 0; let sy = 0; let sz = 0;
          const beitrag = (idx, wt) => {
            if (!(wt > 0)) return;
            const o = idx * 16;
            sx += wt * (pos[i] * S[o] + pos[i + 1] * S[o + 4] + pos[i + 2] * S[o + 8] + S[o + 12]);
            sy += wt * (pos[i] * S[o + 1] + pos[i + 1] * S[o + 5] + pos[i + 2] * S[o + 9] + S[o + 13]);
            sz += wt * (pos[i] * S[o + 2] + pos[i + 1] * S[o + 6] + pos[i + 2] * S[o + 10] + S[o + 14]);
          };
          for (let k = 0; k < 4; k++) beitrag(ind[j + k], gew[j + k]);
          if (indE) for (let k = 0; k < 4; k++) beitrag(indE[j + k], gewE[j + k]);
          x = sx; y = sy; z = sz;
        }
        welt[i] = x * W[0] + y * W[4] + z * W[8] + W[12];
        welt[i + 1] = x * W[1] + y * W[5] + z * W[9] + W[13];
        welt[i + 2] = x * W[2] + y * W[6] + z * W[10] + W[14];
      }
      const idx = m.getIndices();
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
        const d = w.punktDreieck(P, [welt[a], welt[a + 1], welt[a + 2]], [welt[b], welt[b + 1], welt[b + 2]], [welt[c], welt[c + 1], welt[c + 2]]);
        if (d < best) { best = d; wer = m.name; }
      }
    }
    return { abstand: best, netz: wer };
  };
  // Silhouette des Kopfnetzes (alles andere aus): oberste Zeile, Kinnzeile, Anteil an der Leinwandhoehe.
  w.kopfNetzeNur = (v, an) => {
    if (an) {
      w.__gemerkt = v.scene.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => [m, m.isEnabled()]);
      for (const [m] of w.__gemerkt) if (!/^Chr_Head_/.test(m.name)) m.setEnabled(false);
    } else {
      for (const [m, war] of w.__gemerkt) m.setEnabled(war);
    }
  };
  // Nur die Kopfgruppe zeigen: Kopfregion des Koerpers, Frisur, Bart, Augenbrauen und die genannten Slots
  // (`nurExtra`: nur diese Slots). `an=false` stellt alles wieder her.
  w.kopfGruppeNur = (v, an, extra = [], nurExtra = false) => {
    if (an) {
      const behalten = new Set();
      if (!nurExtra) {
        for (const m of v.koerperNetze) if (/^Chr_Head_/.test(m.name) && m.isEnabled()) behalten.add(m);
      }
      const slots = nurExtra ? extra : ['frisur', 'bart', 'augenbraue', ...extra];
      for (const [slot, datei] of v.aktuell) if (slots.includes(slot)) for (const m of v.geladen.get(datei)?.netze ?? []) if (m.isEnabled()) behalten.add(m);
      w.__gem2 = v.scene.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => [m, m.isEnabled()]);
      for (const [m] of w.__gem2) if (!behalten.has(m)) m.setEnabled(false);
    } else {
      for (const [m, war] of w.__gem2) m.setEnabled(war);
    }
  };
  // Nur Netze, deren Name zum Ausdruck passt (z. B. Schulterstuecke der Seidraven-Ruestung).
  w.nurNetze = (v, muster, an) => {
    if (an) {
      w.__gem3 = v.scene.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => [m, m.isEnabled()]);
      for (const [m] of w.__gem3) if (!new RegExp(muster).test(m.name)) m.setEnabled(false);
    } else for (const [m, war] of w.__gem3) m.setEnabled(war);
  };
  // Kinnzeile (Leinwand-Pixel) aus der gemessenen Kinnhoehe 1,46 m, unabhaengig von der Vorschau-Rechnung.
  w.kinnZeile = (v, kinnY = 1.46) => {
    const kn = v.kopfKnoten?.getAbsolutePosition() ?? { x: 0, z: 0 };
    const B = window.__B;
    const p = B.Vector3.TransformCoordinates(new B.Vector3(kn.x, kinnY, kn.z), v.scene.getTransformMatrix());
    return (1 - p.y) / 2 * w.leinwandBox().h;
  };
  // Bildmasse der Silhouette (Alphakanal) in den Zeilen bis zur Kinnzeile.
  w.alphaMass = async (b64, kinn, cx = 0, cy = 0) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let oben = -1; let links = 1e9; let rechts = -1; let n = 0; let sx = 0; let sy = 0; let randL = 0; let randR = 0; let randO = 0; let maxDist = 0;
    const bis = Math.min(bmp.height, Math.floor(kinn));
    for (let y = 0; y < bis; y++) for (let x = 0; x < bmp.width; x++) {
      if (d[(y * bmp.width + x) * 4 + 3] <= 40) continue;
      if (oben < 0) oben = y;
      links = Math.min(links, x); rechts = Math.max(rechts, x); n++; sx += x; sy += y; maxDist = Math.max(maxDist, Math.hypot(x - cx, y - cy));
      if (x === 0) randL++; if (x === bmp.width - 1) randR++; if (y === 0) randO++;
    }
    return { oben, links, rechts, n, randL, randR, randO, maxDist, sx: n ? sx / n : 0, sy: n ? sy / n : 0, w: bmp.width, h: bmp.height };
  };
  // Anteil der Silhouettenpixel (Zeilen bis zur Kinnzeile), die die echte Klickpruefung als Kopf gelten laesst.
  w.trefferAnteil = async (b64, kinn, schritt = 2) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const b = w.leinwandBox(); const v = w.v;
    let n = 0; let treffer = 0; let weitest = 0; const bis = Math.min(bmp.height, Math.floor(kinn));
    const k = v.kopfAufBildschirm();
    for (let y = 0; y < bis; y += schritt) for (let x = 0; x < bmp.width; x += schritt) {
      if (d[(y * bmp.width + x) * 4 + 3] <= 40) continue;
      n++;
      if (v.kopfGetroffen(b.x + x, b.y + y, false)) treffer++;
      else weitest = Math.max(weitest, Math.hypot(x - k.x, y - k.y) - k.r);
    }
    return { n, treffer, anteil: n ? treffer / n : 1, weitestAussen: weitest, kreis: k && { x: k.x, y: k.y, r: k.r, kinn: k.kinn } };
  };
  // Der Silhouettenpunkt mit dem groessten waagerechten Abstand von der gegebenen Bildspalte (Zeilen bis zur Kinnzeile).
  w.fernsterPunkt = async (b64, kinn, spalte) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let best = null; let bd = -1;
    for (let y = 0; y < Math.min(bmp.height, Math.floor(kinn)); y++) for (let x = 0; x < bmp.width; x++) {
      if (d[(y * bmp.width + x) * 4 + 3] <= 200) continue;
      const dist = Math.abs(x - spalte); if (dist > bd) { bd = dist; best = [x, y]; }
    }
    return best;
  };
  w.zeilenBreiten = async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const zeilen = [];
    let flaeche = 0;
    for (let y = 0; y < bmp.height; y++) {
      let mn = 1e9; let mx = -1;
      for (let x = 0; x < bmp.width; x++) { const a = d[(y * bmp.width + x) * 4 + 3]; flaeche += a / 255; if (a > 40) { mn = Math.min(mn, x); mx = Math.max(mx, x); } }
      zeilen.push(mx < 0 ? 0 : mx - mn + 1);
    }
    return { zeilen, flaeche, hoehe: bmp.height, alphaAn: (px, py) => d[(Math.round(py) * bmp.width + Math.round(px)) * 4 + 3] };
  };
});

// Das Buendel laden und Babylon fuer die Hilfsfunktionen greifbar machen.
async function neueVorschau(koerperDatei) {
  await page.evaluate(async ({ url, k }) => {
    const modul = await import(url);
    window.__modul = modul;
    if (window.v) { try { window.v.dispose(); } catch { /* schon weg */ } }
    const v = window.v = new modul.Vorschau(document.querySelector('canvas'), `${location.origin}/assets/models/`);
    // Zugriff auf Babylons Vektoren ohne zweite Babylon-Kopie: die Kamera bringt ihre Klassen mit.
    const Vec = v.kamera.target.constructor;
    window.__B = { Vector3: Vec };
    window.kamera = v.kamera;
    if (!(await v.ladeKoerper(k))) throw new Error('Koerper nicht geladen');
    await window.frames(40);
  }, { url: `${basis}${BUENDEL}`, k: koerperDatei });
}
const auswerten = (fn, arg) => page.evaluate(fn, arg);
const frames = (n) => page.evaluate((k) => window.frames(k), n);

async function bild(name) {
  if (!BILDER) return;
  await page.evaluate(() => { document.body.style.background = '#252931'; });
  await frames(2);
  await page.screenshot({ path: path.join(BILDER, `${name}.png`), clip: { x: 40, y: 40, width: 800, height: 800 } });
  await page.evaluate(() => { document.body.style.background = ''; });
}

async function klick(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}
/** Wartet, bis die Fahrt zu Ende ist (oder es sie nie gab), hoechstens 4 s. */
async function fahrtEnde() {
  await page.evaluate(async () => {
    const ende = performance.now() + 4000;
    while (window.v.radiusFahrt && performance.now() < ende) await window.frames(1);
    await window.frames(2);
  });
}
const zustand = () => auswerten(() => ({
  radius: window.v.kamera.radius, zielY: window.v.kamera.target.y, nah: window.v.kopfNah, fahrt: Boolean(window.v.radiusFahrt),
  rotation: window.v.figurKnoten.rotation.y, cursor: document.querySelector('canvas').style.cursor,
}));
const nahe = (a, b, tol) => Math.abs(a - b) <= tol;

/** Leinwandgroesse setzen (CSS-Pixel) und das Bild nachziehen lassen. */
async function leinwand(w, h) {
  await page.setViewportSize({ width: Math.max(900, w + 80), height: Math.max(940, h + 80) });
  await page.evaluate(({ w, h }) => { const c = document.querySelector('canvas'); c.style.width = `${w}px`; c.style.height = `${h}px`; }, { w, h });
  await frames(5);
}
const LEINWAND_STANDARD = [820, 864];

/** Silhouette der Kopfgruppe (gewaehlte Slots), Bildmasse bis zur Kinnzeile. */
async function kopfMass(extra = [], nurExtra = false, mitte = [0, 0]) {
  await auswerten(({ e, n }) => window.kopfGruppeNur(window.v, true, e, n), { e: extra, n: nurExtra });
  await frames(3);
  const box = await auswerten(() => window.leinwandBox());
  const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const kinn = await auswerten(() => window.kinnZeile(window.v));
  const m = await page.evaluate(({ b64, kinn, mitte }) => window.alphaMass(b64, kinn, mitte[0], mitte[1]), { b64: png.toString('base64'), kinn, mitte });
  await auswerten(() => window.kopfGruppeNur(window.v, false));
  return { ...m, kinn, png, box };
}

/**
 * Kahler Kopf (nur das Kopfnetz): oberste Zeile, Kinn (Silhouette verjuengt sich auf 60 % der groessten Breite),
 * Hoehe, groesste Breite und Flaeche (Summe der Alphawerte) in Pixeln. Fuer Groessenverhaeltnisse taugt die Wurzel der
 * Flaeche am besten: sie ist auf Teilpixel genau, waehrend Kinnzeile und Breite um ganze Pixel springen.
 */
async function kahlMass() {
  await auswerten(() => window.kopfNetzeNur(window.v, true));
  await frames(3);
  const box = await auswerten(() => window.leinwandBox());
  const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const m = await page.evaluate(async (b64) => {
    const r = await window.zeilenBreiten(b64);
    const z = r.zeilen; const oben = z.findIndex((wd) => wd > 0);
    let breit = oben; for (let y = oben; y < z.length; y++) if (z[y] > z[breit]) breit = y;
    let kinn = breit; while (kinn < z.length && z[kinn] >= 0.6 * z[breit]) kinn++;
    return { oben, kinn, hoehe: r.hoehe, breitePx: z[breit], flaeche: r.flaeche };
  }, png.toString('base64'));
  await auswerten(() => window.kopfNetzeNur(window.v, false));
  return { ...m, hoehePx: m.kinn - m.oben, boxW: box.w, boxH: box.h };
}

/* ------------------------------------------------------------ die Proben */

const KOERPER = [
  { name: 'Wikinger', datei: 'wikinger/WikingerKoerper', figur: 'wikinger', ruestung: 'ironward', helm: 'ironward' },
  { name: 'Wikingerin', datei: 'wikingerin/WikingerinKoerper', figur: 'wikingerin', ruestung: 'seidraven_female', helm: 'seidraven_female' },
];
const app = await (await page.request.get(`${basis}/assets/appearance.json`)).json();
const PORTRAET = 1.4;

for (const k of KOERPER) {
  aktuellerKoerper = k.name;
  await neueVorschau(k.datei);
  const zeit = await auswerten(() => {
    const v = window.v;
    return { hatZoom: typeof v.zoomeKopf === 'function', hatNah: 'kopfNah' in v, fahrtFeld: 'radiusFahrt' in v };
  });
  pruefe('Schnittstelle: zoomeKopf und kopfNah vorhanden', zeit.hatZoom && zeit.hatNah, zeit);

  // Frisur, Bart, Augenbrauen wie die Seite sie setzt.
  const haar = `${app.folder}/${app.defaultHairstyle === 'H_01' && k.figur === 'wikinger' ? 'H_02' : app.defaultHairstyle}`;
  await auswerten(async ({ haar, figur, bart, brauen }) => {
    await window.v.setze('frisur', haar);
    if (figur === 'wikinger') await window.v.setze('bart', bart);
    await window.v.setze('augenbraue', brauen);
    await window.frames(6);
  }, { haar, figur: k.figur, bart: `${app.folder}/${app.beards[0].file}`, brauen: `${app.folder}/${app.eyebrows.find((e) => e.figure === k.figur).file}` });

  /* --- Ausgang ------------------------------------------------------- */
  await schritt('Ausgang', async () => {
    const z = await zustand();
    pruefe('Ausgang: Radius 3,2, Blick auf der Brust', nahe(z.radius, 3.2, 1e-6) && nahe(z.zielY, 1.05, 1e-6), z);
    await bild(`${k.figur}-1-ausgang`);
  });

  /* --- Kopfmitte, Trefferpunkt liegt auf Kopfpixeln --------------------- */
  let kopfPunkt = null;
  await schritt('Kopfmitte', async () => {
    kopfPunkt = await auswerten(() => window.kopfProjektion(window.v));
    await auswerten(() => window.kopfNetzeNur(window.v, true));
    await frames(3);
    const box = await auswerten(() => window.leinwandBox());
    const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    const alpha = await page.evaluate(async ({ b64, px, py }) => {
      const r = await window.zeilenBreiten(b64);
      return r.alphaAn(px, py);
    }, { b64: png.toString('base64'), px: kopfPunkt.x - box.x, py: kopfPunkt.y - box.y });
    await auswerten(() => window.kopfNetzeNur(window.v, false));
    pruefe('Kopfmitte: projizierter Punkt liegt auf Kopfpixeln (Alpha > 40)', alpha > 40, { alpha, x: +kopfPunkt.x.toFixed(1), y: +kopfPunkt.y.toFixed(1) });
  });

  /* --- Klick auf den Kopf: hinein ---------------------------------------- */
  let reihe = [];
  await schritt('Klick hinein', async () => {
    await auswerten(() => {
      window.__reihe = [];
      const f = () => { if (window.__reihe) window.__reihe.push(window.v.kamera.radius); requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    await klick(kopfPunkt.x, kopfPunkt.y);
    await fahrtEnde();
    reihe = await auswerten(() => { const r = window.__reihe; window.__reihe = null; return r; });
    const z = await zustand();
    pruefe('Klick auf den Kopf: Radius = Portraetabstand (+-1 %)', nahe(z.radius / PORTRAET, 1, 0.01), { radius: +z.radius.toFixed(4) });
    pruefe('Klick auf den Kopf: Blickpunkt auf Kopfhoehe (+-0,005 m)', nahe(z.zielY, 1.62, 0.005), { zielY: +z.zielY.toFixed(4) });
    pruefe('Klick auf den Kopf: kopfNah', z.nah === true, z);
    const nichtSteigend = reihe.every((r, i) => i === 0 || r <= reihe[i - 1] + 1e-9);
    pruefe('Fahrt hinein: Radius je Bild monoton fallend, mehrere Bilder', nichtSteigend && new Set(reihe.map((r) => r.toFixed(4))).size >= 3, { bilder: reihe.length, reihe: reihe.slice(0, 12).map((r) => +r.toFixed(3)) });
  });

  /* --- Kopfanteil im Portraet ------------------------------------------- */
  await schritt('Kopfanteil', async () => {
    await auswerten(() => window.kopfNetzeNur(window.v, true));
    await frames(3);
    const box = await auswerten(() => window.leinwandBox());
    const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    const m = await page.evaluate(async (b64) => {
      const r = await window.zeilenBreiten(b64);
      const z = r.zeilen; const oben = z.findIndex((w) => w > 0);
      let breit = oben; for (let y = oben; y < z.length; y++) if (z[y] > z[breit]) breit = y;
      let kinn = breit; while (kinn < z.length && z[kinn] >= 0.6 * z[breit]) kinn++;
      return { oben, breit, kinn, hoehe: r.hoehe };
    }, png.toString('base64'));
    await auswerten(() => window.kopfNetzeNur(window.v, false));
    const anteil = (m.kinn - m.oben) / m.hoehe;
    pruefe('Portraet: Kopf (Scheitel bis Kinn) fuellt 35-45 % der Leinwandhoehe', anteil >= 0.35 && anteil <= 0.45, { anteil: +anteil.toFixed(4), ...m });
    const mitte = ((m.oben + m.kinn) / 2) / m.hoehe;
    pruefe('Portraet: Kopfmitte liegt nahe der Bildmitte (+-5 % der Hoehe)', nahe(mitte, 0.5, 0.05), { mitte: +mitte.toFixed(4) });
    await bild(`${k.figur}-2-portraet-ohne-ruestung`);
  });

  /* --- Sichtfeld folgt dem Radius, Rad bis an die Grenze --------------------------- */
  await schritt('Sichtfeld', async () => {
    const nah = await auswerten(() => ({ fov: window.v.kamera.fov, radius: window.v.kamera.radius }));
    const erwartet = 2 * Math.atan(0.8 / (2 * PORTRAET));
    pruefe('Portraet: Sichtfeld verengt (Tele) auf 2*atan(0,8/(2*1,4)) = 0,557 rad', nahe(nah.fov, erwartet, 0.002), { fov: +nah.fov.toFixed(4), erwartet: +erwartet.toFixed(4) });
    await auswerten(() => { window.v.zoomeKopf(false); });
    await fahrtEnde();
    const aus = await auswerten(() => window.v.kamera.fov);
    pruefe('Ausgangsbild: Sichtfeld wieder 0,8 rad', nahe(aus, 0.8, 1e-9), { fov: aus });
    // Sichtfeld ueber die Grenze bei 2,2 m: stetig, oberhalb exakt 0,8, darunter streng fallend
    const folge = [];
    for (const r of [5.5, 3.2, 2.5, 2.3, 2.21, 2.2, 2.19, 2.1, 1.9, 1.7, 1.5, 1.4]) {
      folge.push([r, await auswerten(async (rr) => { window.v.kamera.radius = rr; await window.frames(2); return window.v.kamera.fov; }, r)]);
    }
    const ueber = folge.filter(([r]) => r >= 2.2).every(([, f]) => f === 0.8);
    const sprung = Math.abs(folge.find(([r]) => r === 2.21)[1] - folge.find(([r]) => r === 2.19)[1]);
    const fallend = folge.filter(([r]) => r <= 2.2).every(([, f], i, l) => i === 0 || f < l[i - 1][1]);
    pruefe('Sichtfeld ueber die Grenze 2,2 m: oberhalb exakt 0,8, Sprung 2,21 -> 2,19 unter 0,005 rad, darunter streng fallend', ueber && sprung < 0.005 && fallend, { sprung: +sprung.toFixed(5), folge: folge.map(([r, f]) => `${r}:${f.toFixed(4)}`).join(' ') });
    await auswerten(() => { window.v.kamera.radius = 3.2; });
    await frames(3);
    // Mit dem Rad bis an die Grenze: 3,2 -> 1,4 ist genau die Portraetgrenze, nicht naeher.
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 16; i++) await page.mouse.wheel(0, -100);
    await frames(4);
    const z = await zustand();
    pruefe('Rad bis ans Ende: Radius bleibt an der Portraetgrenze 1,4 (nicht naeher), kopfNah', nahe(z.radius, PORTRAET, 1e-9) && z.nah, { radius: z.radius, nah: z.nah });
  });

  /* --- Zeigerform ---------------------------------------------------------- */
  await schritt('Zeigerform', async () => {
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await page.mouse.move(p.x, p.y);
    await frames(3);
    const im = await zustand();
    await page.mouse.move(45, 45);
    await frames(3);
    const aus = await zustand();
    pruefe('Zeiger im Portraet: ueber dem Kopf zoom-out, daneben Stil der Seite', im.cursor === 'zoom-out' && aus.cursor === '', { ueber: im.cursor, daneben: aus.cursor });
  });

  /* --- Zweiter Klick: heraus ------------------------------------------------ */
  await schritt('Klick heraus', async () => {
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await klick(p.x, p.y);
    await fahrtEnde();
    const z = await zustand();
    pruefe('Zweiter Klick auf den Kopf: Radius 3,2 (+-1 %), nicht mehr nah', nahe(z.radius / 3.2, 1, 0.01) && z.nah === false, { radius: +z.radius.toFixed(4), nah: z.nah });
    const p2 = await auswerten(() => window.kopfProjektion(window.v));
    await page.mouse.move(p2.x, p2.y);
    await frames(3);
    const c = await zustand();
    pruefe('Zeiger im Ausgangsbild: ueber dem Kopf zoom-in', c.cursor === 'zoom-in', { cursor: c.cursor });
  });

  /* --- Brust und Hintergrund -------------------------------------------------- */
  await schritt('Brust und Hintergrund', async () => {
    const vorher = await zustand();
    const brust = await auswerten(() => {
      const b = window.leinwandBox(); const B = window.__B; const v = window.v;
      const p = B.Vector3.TransformCoordinates(new B.Vector3(0, 1.05, 0), v.scene.getTransformMatrix());
      return { x: b.x + (p.x + 1) / 2 * b.w, y: b.y + (1 - p.y) / 2 * b.h };
    });
    await klick(brust.x, brust.y);
    await frames(4);
    const nachBrust = await zustand();
    await klick(60, 60);
    await frames(4);
    const nachLeer = await zustand();
    pruefe('Klick auf die Brust und auf leeren Hintergrund: Radius unveraendert', nachBrust.radius === vorher.radius && nachLeer.radius === vorher.radius && !nachBrust.fahrt && !nachLeer.fahrt, { vorher: vorher.radius, brust: nachBrust.radius, leer: nachLeer.radius });
  });

  /* --- Ziehen ------------------------------------------------------------------ */
  await schritt('Ziehen', async () => {
    const p = await auswerten(() => window.kopfProjektion(window.v));
    const vorher = await zustand();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + i * 4, p.y);
    await page.mouse.up();
    await frames(4);
    const nach = await zustand();
    pruefe('Ziehen (40 px) ab Kopf: Figur gedreht, kein Zoom', nach.radius === vorher.radius && !nach.fahrt && nahe(nach.rotation - vorher.rotation, 0.4, 0.005), { drehung: +(nach.rotation - vorher.rotation).toFixed(4), radius: nach.radius });
    // Hin und zurueck, Ende wieder auf dem Kopf: der Weg (60 px) zaehlt, nicht der Abstand.
    const q = await auswerten(() => window.kopfProjektion(window.v));
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(q.x + i * 6, q.y);
    for (let i = 4; i >= 0; i--) await page.mouse.move(q.x + i * 6, q.y);
    await page.mouse.up();
    await frames(4);
    const nach2 = await zustand();
    pruefe('Ziehen hin und zurueck auf den Kopf: kein Zoom (Weg statt Abstand)', nach2.radius === vorher.radius && !nach2.fahrt, { radius: nach2.radius });
    await auswerten(() => { window.v.figurKnoten.rotation.y = 0; });
    // Kurzer Klick mit 5 px Wackeln zaehlt noch als Klick? (Grenze 6 px)
  });

  /* --- Rad waehrend der Fahrt --------------------------------------------------- */
  await schritt('Rad waehrend der Fahrt', async () => {
    await auswerten(() => {
      window.__vorher = null; window.__nachher = null; window.__rad = [];
      window.addEventListener('wheel', () => { window.__vorher = window.v.kamera.radius; setTimeout(() => { window.__nachher = window.v.kamera.radius; }, 0); }, { capture: true, once: true });
      const f = () => { if (window.__rad) window.__rad.push(window.v.kamera.radius); requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await klick(p.x, p.y);
    // Ein Bild abwarten, damit die Fahrt sichtlich laeuft, dann drehen.
    await frames(1);
    const mitten = await zustand();
    await page.mouse.wheel(0, 100);
    await frames(8);
    const r = await auswerten(() => ({ v: window.__vorher, n: window.__nachher, reihe: window.__rad, fahrt: Boolean(window.v.radiusFahrt), radius: window.v.kamera.radius }));
    await auswerten(() => { window.__rad = null; });
    const sprung = r.n / r.v;
    pruefe('Rad waehrend der Fahrt: Fahrt lief noch und bricht ab', mitten.fahrt && !r.fahrt, { fahrtVorRad: mitten.fahrt, fahrtDanach: r.fahrt });
    pruefe('Rad waehrend der Fahrt: genau ein Radschritt (x1,12), kein Springen', nahe(sprung, 1.12, 1e-6), { vorher: +r.v.toFixed(4), nachher: +r.n.toFixed(4), faktor: +sprung.toFixed(6) });
    const bisWheel = r.reihe.slice(0, r.reihe.findIndex((x) => Math.abs(x - r.n) < 1e-9));
    const monoton = bisWheel.every((x, i) => i === 0 || x <= bisWheel[i - 1] + 1e-9);
    const danach = r.reihe.slice(r.reihe.findIndex((x) => Math.abs(x - r.n) < 1e-9));
    pruefe('Rad waehrend der Fahrt: Radius bis zum Abbruch monoton, danach still', monoton && danach.every((x) => Math.abs(x - r.n) < 1e-9), { bisAbbruch: bisWheel.map((x) => +x.toFixed(3)), danachBilder: danach.length });
    // Zurueck in den Ausgang fuer die weiteren Proben.
    await auswerten(() => { window.v.zoomeKopf(false); });
    await fahrtEnde();
  });

  /* --- CSS-Variablen der Markierung -------------------------------------------- */
  await schritt('Markierung', async () => {
    const lies = () => auswerten(() => {
      const el = document.querySelector('#b'); const b = document.querySelector('#marke').getBoundingClientRect();
      const stil = (n) => parseFloat(el.style.getPropertyValue(n));
      return { x: stil('--kopf-x'), y: stil('--kopf-y'), r: stil('--kopf-r'), zoom: parseFloat(el.style.getPropertyValue('--zoom')), mitteX: b.left + b.width / 2, mitteY: b.top + b.height / 2, breite: b.width };
    });
    const bisAus = async () => { await auswerten(() => { window.v.zoomeKopf(false); }); await fahrtEnde(); };
    await bisAus();
    const aus = await lies();
    await auswerten(() => { window.v.zoomeKopf(true); });
    await fahrtEnde();
    const nah = await lies();
    const innen = (m) => m.x >= 0 && m.x <= 800 && m.y >= 0 && m.y <= 800 && m.r > 0;
    pruefe('Markierung: Variablen liegen im Elternelement (Ausgang und Portraet)', innen(aus) && innen(nah), { aus, nah });
    pruefe('Markierung: Ring waechst mit dem Zoom (im Portraet mindestens dreimal so gross wie im Ausgang)', nah.r > 3 * aus.r, { rAus: aus.r, rNah: nah.r });
    // Unabhaengig von der Rechnung der Vorschau: Die Kopfgruppe (Kopfregion, Frisur, Bart, Brauen) wird allein
    // gerendert; ihre Silhouette bis zum Kinn muss im DOM-Element der Markierung liegen.
    const liegtImRing = async (etikett) => {
      const ring = await auswerten(() => { const b = document.querySelector('#marke').getBoundingClientRect(); const c = document.querySelector('canvas').getBoundingClientRect(); return { x: b.left + b.width / 2 - c.left, y: b.top + b.height / 2 - c.top, r: b.width / 2 }; });
      const m = await kopfMass([], false, [ring.x, ring.y]);
      const halbeDiagonale = Math.hypot((m.rechts - m.links) / 2, (m.kinn - m.oben) / 2);
      const ok = m.maxDist <= ring.r + 3 && Math.hypot(m.sx - ring.x, m.sy - ring.y) <= 0.35 * ring.r + 2 && ring.r <= 1.6 * halbeDiagonale;
      pruefe(`Markierung (${etikett}): jeder Silhouettenpunkt der Kopfgruppe liegt im Ring, Schwerpunkt nahe der Ringmitte, Ring nicht ueberdimensioniert`, ok, { ring: { x: +ring.x.toFixed(1), y: +ring.y.toFixed(1), r: +ring.r.toFixed(1) }, weitesterPunkt: +m.maxDist.toFixed(1), schwerpunkt: [+m.sx.toFixed(1), +m.sy.toFixed(1)], halbeDiagonale: +halbeDiagonale.toFixed(1) });
    };
    await liegtImRing('Portraet');
    await bisAus();
    await liegtImRing('Ausgang');
    pruefe('Video-Massstab --zoom: Ausgang wie Wurzel(5,5/3,2), Portraet wie Wurzel(5,5/1,4) und <= 2,0', nahe(aus.zoom, Math.sqrt(5.5 / 3.2), 0.002) && nahe(nah.zoom, Math.sqrt(5.5 / PORTRAET), 0.002) && nah.zoom <= 2.0, { ausgang: aus.zoom, portraet: nah.zoom });
    // Nur schreiben bei > 0,5 px: (a) steht die Figur still (Ruhe angehalten), gibt es keine
    // Stilschreibung; (b) laeuft die Ruhepose, unterscheidet sich jede Schreibung um mehr als 0,5 px.
    const beobachte = () => auswerten(async () => {
      const el = document.querySelector('#b'); const folge = [];
      const beob = new MutationObserver(() => folge.push(['--kopf-x', '--kopf-y', '--kopf-r'].map((n) => parseFloat(el.style.getPropertyValue(n)))));
      beob.observe(el, { attributes: true, attributeFilter: ['style'] });
      await window.frames(30); beob.disconnect(); return folge;
    });
    await auswerten(() => { window.v.ruhe.pause(); });
    await frames(4);
    const still = await beobachte();
    await auswerten(() => { window.v.ruhe.play(true); });
    const lauf = await beobachte();
    let kleinster = Infinity;
    for (let i = 1; i < lauf.length; i++) kleinster = Math.min(kleinster, Math.max(...lauf[i].map((x, j) => Math.abs(x - lauf[i - 1][j]))));
    pruefe('Markierung: Figur steht still -> keine Stilschreibung ueber 30 Bilder', still.length === 0, { schreibungen: still.length });
    pruefe('Markierung: Ruhepose laeuft -> jede Schreibung aendert einen Wert um mehr als 0,5 px (geschrieben wird auf 0,1 gerundet)', lauf.length < 2 || kleinster >= 0.4, { schreibungen: lauf.length, kleinsteAenderung: +kleinster.toFixed(2) });
    await bisAus();
  });

  /* --- Drehung im Portraet, Abstand Kamera - Netz ----------------------------------- */
  await schritt('Abstand', async () => {
    // die groesste Frisur suchen: groesster Abstand von der Drehachse und groesste Hoehe
    const hair = await auswerten(async ({ folder, hairstyles, figur }) => {
      const v = window.v; const erg = [];
      for (const h of hairstyles) {
        if (figur === 'wikinger' && h.id === 'H_01') continue;
        const datei = `${folder}/${h.file}`;
        await v.setze('frisur', datei);
        const t = v.geladen.get(datei);
        let r = 0; let y = -9;
        for (const m of t?.netze ?? []) {
          m.computeWorldMatrix(true); const W = m.getWorldMatrix().m; const p = m.getVerticesData('position');
          for (let i = 0; i < p.length; i += 3) {
            const wx = p[i] * W[0] + p[i + 1] * W[4] + p[i + 2] * W[8] + W[12];
            const wy = p[i] * W[1] + p[i + 1] * W[5] + p[i + 2] * W[9] + W[13];
            const wz = p[i] * W[2] + p[i + 1] * W[6] + p[i + 2] * W[10] + W[14];
            r = Math.max(r, Math.hypot(wx, wz)); y = Math.max(y, wy);
          }
        }
        erg.push({ datei, r, y });
      }
      return erg;
    }, { folder: app.folder, hairstyles: app.hairstyles, figur: k.figur });
    const breit = hair.reduce((a, b) => (b.r > a.r ? b : a));
    const hoch = hair.reduce((a, b) => (b.y > a.y ? b : a));
    pruefe('Frisuren vermessen', hair.length >= 37, { anzahl: hair.length, breit: [breit.datei, +breit.r.toFixed(3)], hoch: [hoch.datei, +hoch.y.toFixed(3)] });

    await auswerten(() => { window.v.zoomeKopf(true); });
    await fahrtEnde();
    const drehung = async (etikett, schritte = 8) => {
      const reihe = []; let netz = '';
      for (let i = 0; i < schritte; i++) {
        await auswerten((w) => { window.v.figurKnoten.rotation.y = w; }, i * 2 * Math.PI / schritte);
        await frames(3);
        const a = await auswerten(() => window.minAbstand(window.v));
        reihe.push(a.abstand); if (a.abstand === Math.min(...reihe)) netz = a.netz;
      }
      const klein = Math.min(...reihe);
      const minZ = await auswerten(() => window.v.kamera.minZ);
      pruefe(`Portraet, Figur in ${schritte} Schritten gedreht, ${etikett}: kleinster Abstand Kamera-Dreieck >= 0,29 m (minZ 0,05)`, klein > minZ && klein >= 0.29, { klein: +klein.toFixed(3), minZ, netz, reihe: reihe.map((x) => +x.toFixed(2)) });
      return klein;
    };
    for (const f of new Set([breit.datei, hoch.datei])) {
      await auswerten(async (d) => { await window.v.setze('frisur', d); await window.frames(4); }, f);
      await drehung(`Frisur ${f.split('/').pop()}`);
    }
    // Kalibrierung der CPU-Haut: Kopfnetz-Mitte muss bei ~1,63 m liegen.
    const cpu = await auswerten(() => {
      const v = window.v; const m = v.koerperNetze.find((n) => /^Chr_Head_/.test(n.name));
      m.computeWorldMatrix(true);
      const kopie = v.scene.meshes.filter((n) => n !== m && n.getTotalVertices() > 0).map((n) => [n, n.isEnabled()]);
      for (const [n] of kopie) n.setEnabled(false);
      const cam = v.kamera.position; const a = window.minAbstand(v);
      for (const [n, war] of kopie) n.setEnabled(war);
      const ziel = v.kamera.target;
      return { kopfNetzAbstand: a.abstand, kameraZuBlickpunkt: Math.hypot(cam.x - ziel.x, cam.y - ziel.y, cam.z - ziel.z) };
    });
    pruefe('CPU-Haut kalibriert: Kopfnetz liegt 1,10-1,40 m vor der Kamera (Portraet 1,4 m)', cpu.kopfNetzAbstand > 1.1 && cpu.kopfNetzAbstand < 1.4, cpu);
    await auswerten(() => { window.v.figurKnoten.rotation.y = 0; });

    // Jede Klassenruestung dieses Koerpers: alle sieben Teile an, Figur in 8 und in 24 Schritten gedreht.
    for (const satz of app.equipmentSets.filter((e) => e.figure === k.figur)) {
      const teile = satz.parts.map((t) => (t.previewModel ?? t.model).replace(/\.glb$/, ''));
      const geladen = await auswerten(async ({ teile }) => {
        try { await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, d))); await window.frames(6); return true; } catch (e) { return String(e).slice(0, 90); }
      }, { teile });
      if (geladen !== true) { console.log(`INFO ${k.name}: Set ${satz.id} nicht ladbar (${geladen}) - uebersprungen`); continue; }
      await drehung(`Ruestung ${satz.id}`);
      await drehung(`Ruestung ${satz.id}, fein`, 24);
      // Schmale und breite Leinwand: der Radius bleibt 1,4 m, nur das Sichtfeld weitet sich.
      for (const [cw, ch] of [[227, 600], [2560, 900]]) {
        await leinwand(cw, ch);
        await drehung(`Ruestung ${satz.id}, Leinwand ${cw}x${ch}`);
      }
      await leinwand(...LEINWAND_STANDARD);
      if (satz.id === k.helm) await bild(`${k.figur}-4-portraet-mit-helm`);
      await auswerten(() => { window.v.figurKnoten.rotation.y = 0; });
      await auswerten(async ({ teile }) => {
        await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, null)));
        await window.frames(4);
      }, { teile });
    }
    // Waffe: Stab des Druiden und Nordschwert
    for (const art of ['stab', 'schwert']) {
      await auswerten(async (a) => { await window.v.setzeWaffe(a); await window.frames(30); }, art);
      await drehung(`Waffe ${art}`);
    }
    await auswerten(async () => { await window.v.setzeWaffe(null); window.v.figurKnoten.rotation.y = 0; await window.frames(2); });
    await auswerten(() => { window.v.zoomeKopf(false); });
    await fahrtEnde();
  });

  /* --- Helm: Sichtbarkeit -------------------------------------------------------- */
  await schritt('Helm', async () => {
    const satz = app.equipmentSets.find((s) => s.id === k.helm);
    const teile = satz.parts.map((t) => (t.previewModel ?? t.model).replace(/\.glb$/, ''));
    const kopfIndex = satz.parts.findIndex((t) => t.appearanceSlot === 'kopf');
    const kopfTeil = satz.parts[kopfIndex];
    await auswerten(async ({ teile }) => {
      await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, d)));
      await window.frames(6);
    }, { teile });
    const messe = () => auswerten(({ teile, kopfIndex }) => {
      const v = window.v;
      const aus = (slot) => { const d = v.aktuell.get(slot); const t = d ? v.geladen.get(d) : null; return t ? t.netze.map((m) => m.isEnabled()) : null; };
      const koerper = Object.fromEntries(v.koerperNetze.map((m) => [m.name, m.isEnabled()]));
      const teil = teile.map((d) => v.geladen.get(d)?.netze.every((m) => m.isEnabled()) ?? null);
      return { frisur: aus('frisur'), bart: aus('bart'), brauen: aus('augenbraue'), koerper, teile: teil, kopfTeil: teil[kopfIndex] };
    }, { teile, kopfIndex });
    const an = await messe();
    const regionen = kopfTeil.regions;
    const kopfRegion = Object.entries(an.koerper).filter(([n]) => regionen.some((r) => n.startsWith(`Chr_${r}_`)));
    const versteckt = kopfTeil.hideAppearance ?? [];
    const alles = (l) => (l ?? []).every((x) => x === false) && l !== null;
    pruefe(`Helm an (${k.helm}): Kopfteil sichtbar, Frisur ${versteckt.includes('hair') ? 'aus' : 'an'}`, an.kopfTeil === true && (versteckt.includes('hair') ? alles(an.frisur) : an.frisur?.every(Boolean)), { versteckt, frisur: an.frisur, kopfTeil: an.kopfTeil });
    if (k.figur === 'wikinger') pruefe('Helm an: Bart aus', alles(an.bart), { bart: an.bart });
    pruefe('Helm an: Augenbrauen aus', alles(an.brauen), { brauen: an.brauen });
    pruefe(`Helm an: Kopfregion des Koerpers aus (Regionen ${JSON.stringify(regionen)})`, regionen.length === 0 || kopfRegion.every(([, e]) => e === false) && kopfRegion.length > 0, { kopfRegion });
    await auswerten(async ({ kopfIndex }) => { await window.v.setze(`klassenruestung-${kopfIndex}`, null); await window.frames(4); }, { kopfIndex });
    const ohne = await messe();
    pruefe('Helm aus (setze(Kopfslot, null)): Frisur, Bart und Brauen wieder an', ohne.frisur?.every(Boolean) && ohne.brauen?.every(Boolean) && (k.figur !== 'wikinger' || ohne.bart?.every(Boolean)), { frisur: ohne.frisur, bart: ohne.bart, brauen: ohne.brauen });
    pruefe('Helm aus: Kopfregion des Koerpers wieder an', regionen.length === 0 || Object.entries(ohne.koerper).filter(([n]) => regionen.some((r) => n.startsWith(`Chr_${r}_`))).every(([, e]) => e === true), { koerper: Object.entries(ohne.koerper).filter(([n]) => /Head/.test(n)) });
    const uebrige = ohne.teile.filter((_, i) => i !== kopfIndex);
    pruefe('Helm aus: die uebrigen sechs Teile bleiben an', uebrige.length === 6 && uebrige.every((x) => x === true), { uebrige });
    // Bild: Ruestung ohne Helm im Portraet. (Die Sichtbarkeitsproben oben pruefen bestehendes
    // Verhalten der Vorschau und sind auch auf dem alten Buendel gruen; `?.` haelt sie dort lauffaehig.)
    await auswerten(() => { window.v.zoomeKopf?.(true); });
    await fahrtEnde();
    await bild(`${k.figur}-3-portraet-ruestung-ohne-helm`);
    await auswerten(() => { window.v.zoomeKopf?.(false); });
    await fahrtEnde();
    await auswerten(async ({ teile }) => { await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, null))); await window.frames(4); }, { teile });
  });

  /* --- Neuer Klick mitten in der Fahrt ------------------------------------------------ */
  await schritt('Klick in der Fahrt', async () => {
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await auswerten(() => { window.__zk = []; const v = window.v; const o = v.zoomeKopf.bind(v); v.zoomeKopf = (n) => { window.__zk.push([n, v.kopfNah, +v.kamera.radius.toFixed(3)]); return o(n); }; });
    await klick(p.x, p.y);
    await frames(1);
    const mitten = await zustand();
    // Ein BEWUSSTER zweiter Klick (nach dem Doppelklickfenster von 350 ms) kehrt um. Der Kopf wandert
    // waehrend der Fahrt ueber die Buehne: der Klick geht auf seine jetzige Stelle.
    await page.waitForTimeout(380);
    const jetzt = await auswerten(() => window.kopfProjektion(window.v));
    await klick(jetzt.x, jetzt.y);
    await fahrtEnde();
    const z = await zustand();
    const aufrufe = await auswerten(() => { const a = window.__zk; delete window.v.zoomeKopf; return a; });
    pruefe('Bewusster zweiter Klick (380 ms spaeter) kehrt um: am Ende Radius 3,2, nicht nah', mitten.fahrt && nahe(z.radius, 3.2, 0.03) && !z.nah, { mitten: +mitten.radius.toFixed(3), ende: +z.radius.toFixed(3), nah: z.nah, aufrufe });
  });

  /* --- Touch: Tippen, Ziehen, zweiter Finger, Fingerzugabe ------------------------------- */
  await schritt('Touch', async () => {
    const kopf = () => auswerten(() => { const b = window.leinwandBox(); const q = window.v.kopfAufBildschirm(); return { x: b.x + q.x, y: b.y + q.y, r: q.r }; });
    const cdp = await kontext.newCDPSession(page);
    const beruehre = async (typ, punkte) => cdp.send('Input.dispatchTouchEvent', { type: typ, touchPoints: punkte.map(([x, y], id) => ({ x, y, id })) });
    let q = await kopf();
    await page.touchscreen.tap(q.x, q.y);
    await fahrtEnde();
    let z = await zustand();
    pruefe('Touch: Tippen auf den Kopf faehrt ins Portraet', nahe(z.radius, PORTRAET, 0.014) && z.nah, { radius: z.radius });
    q = await kopf();
    await page.touchscreen.tap(q.x, q.y);
    await fahrtEnde();
    z = await zustand();
    pruefe('Touch: zweites Tippen auf den Kopf faehrt zurueck', nahe(z.radius, 3.2, 0.03) && !z.nah, { radius: z.radius });
    // Ziehen mit dem Finger ab Kopf: dreht, zoomt nie
    q = await kopf();
    const r0 = (await zustand()).rotation;
    await beruehre('touchStart', [[q.x, q.y]]);
    for (let i = 1; i <= 10; i++) await beruehre('touchMove', [[q.x + i * 4, q.y]]);
    await beruehre('touchEnd', []);
    await frames(5);
    z = await zustand();
    pruefe('Touch: Ziehen (40 px) ab Kopf dreht die Figur, kein Zoom', nahe(z.rotation - r0, 0.4, 0.02) && nahe(z.radius, 3.2, 1e-6) && !z.fahrt, { drehung: +(z.rotation - r0).toFixed(3), radius: z.radius });
    await auswerten(() => { window.v.figurKnoten.rotation.y = 0; });
    // Zwei Finger (Kneifen), beide heben ohne Weg ab: kein Zoom
    q = await kopf();
    await beruehre('touchStart', [[q.x, q.y], [q.x + 120, q.y + 40]]);
    await beruehre('touchEnd', []);
    await frames(5);
    z = await zustand();
    pruefe('Touch: zwei Finger gleichzeitig zoomen nicht', nahe(z.radius, 3.2, 1e-6) && !z.fahrt, { radius: z.radius });
    // Fingerzugabe: knapp ausserhalb des Kopfkreises trifft der Finger (14 px), die Maus nicht (4 px)
    q = await kopf();
    await page.touchscreen.tap(q.x + q.r + 10, q.y);
    await fahrtEnde();
    const treffer = await zustand();
    await auswerten(() => { window.v.zoomeKopf(false); });
    await fahrtEnde();
    await page.touchscreen.tap(q.x + q.r + 40, q.y);
    await frames(6);
    const daneben = await zustand();
    pruefe('Touch: Tippen 10 px ausserhalb des Kopfkreises trifft (Zugabe 14 px), 40 px daneben nicht', treffer.nah && nahe(treffer.radius, PORTRAET, 0.014) && !daneben.nah && nahe(daneben.radius, 3.2, 1e-6), { treffer: +treffer.radius.toFixed(3), daneben: +daneben.radius.toFixed(3) });
    await cdp.detach();
  });

  /* --- Reduzierte Bewegung ---------------------------------------------------------------- */
  await schritt('Reduzierte Bewegung', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await auswerten(() => { window.v.zoomeKopf(true); });
    const sofort = await zustand();
    pruefe('prefers-reduced-motion: Kopf-Zoom ohne Animation (Radius sofort 1,4, keine Fahrt)', nahe(sofort.radius, PORTRAET, 1e-9) && !sofort.fahrt && sofort.nah, sofort);
    await auswerten(() => { window.v.zoomeKopf(false); });
    const zurueck = await zustand();
    pruefe('prefers-reduced-motion: zurueck ebenfalls sofort', nahe(zurueck.radius, 3.2, 1e-9) && !zurueck.fahrt && !zurueck.nah, zurueck);
    // Doppelklick ohne Animation: der erste Klick setzt den Radius sofort, der zweite wird verschluckt
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await page.mouse.move(p.x, p.y);
    await page.mouse.dblclick(p.x, p.y);
    await frames(3);
    const dk = await zustand();
    pruefe('prefers-reduced-motion: Doppelklick auf den Kopf endet im Portraet', dk.nah && nahe(dk.radius, PORTRAET, 1e-9), dk);
    await auswerten(() => { window.v.zoomeKopf(false); });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  /* --- Koerper- und Serverwechsel setzen das Portraet zurueck ------------------------------- */
  await schritt('Wechsel', async () => {
    const anderer = k.figur === 'wikinger' ? 'wikingerin/WikingerinKoerper' : 'wikinger/WikingerKoerper';
    await auswerten(() => { window.__rufe = []; window.v.beiKopfZustand = (z) => window.__rufe.push(z); window.v.zoomeKopf(true); });
    await fahrtEnde();
    await auswerten(async (d) => { await window.v.ladeKoerper(d); await window.frames(5); }, anderer);
    let z = await zustand();
    let rufe = await auswerten(() => window.__rufe);
    pruefe('Koerperwechsel im Portraet: zurueck im Ausgangsbild, Rueckruf meldet nah=false', nahe(z.radius, 3.2, 1e-9) && !z.nah && !z.fahrt && rufe.at(-1)?.nah === false, { radius: z.radius, letzterRuf: rufe.at(-1) });
    await auswerten(async (d) => { await window.v.ladeKoerper(d); await window.frames(30); window.v.zoomeKopf(true); }, k.datei);
    await fahrtEnde();
    await auswerten(async () => { await window.v.setzeWurzel(`${location.origin}/assets/models/./`); await window.frames(3); });
    z = await zustand();
    pruefe('Serverwechsel (setzeWurzel) im Portraet: zurueck im Ausgangsbild, Fahrt aus', nahe(z.radius, 3.2, 1e-9) && !z.nah && !z.fahrt, { radius: z.radius });
    const marke = await auswerten(() => document.querySelector('#b').style.getPropertyValue('--kopf-r'));
    pruefe('Serverwechsel: Markierung ohne Figur (--kopf-r = 0px)', marke === '0.0px', { marke });
    // Koerper wieder laden fuer die folgenden Schritte
    await auswerten(async (d) => { await window.v.ladeKoerper(d); await window.frames(30); }, k.datei);
    const haar2 = `${app.folder}/${k.figur === 'wikinger' && app.defaultHairstyle === 'H_01' ? 'H_02' : app.defaultHairstyle}`;
    await auswerten(async (h) => { await window.v.setze('frisur', h); await window.frames(4); }, haar2);
  });

  /* --- M1: Portraet bei schmaler und breiter Leinwand ---------------------------------- */
  await schritt('Schmal und breit', async () => {
    await auswerten(async (h) => { await window.v.setze('frisur', h); await window.frames(4); }, `${app.folder}/H_14`); // breiteste Frisur von vorn
    for (const [w, h] of [[227, 600], [390, 600], [390, 844], [619, 699], [1440, 900], [2560, 900]]) {
      await leinwand(w, h);
      await auswerten(() => { window.v.zoomeKopf(true); });
      await fahrtEnde();
      const z = await zustand();
      const g = await kopfMass();
      const kahl = await kahlMass();
      const breitenAnteil = (g.rechts - g.links + 1) / g.box.w;
      const hoehe = kahl.hoehePx / kahl.boxH;
      const erwartet = 0.34 / Math.max(0.8, 0.4 / 0.7 / (w / h));
      const fov = await auswerten(() => window.v.kamera.fov);
      pruefe(`Portraet ${w}x${h} (Haar H_14): kein Kopfpixel am linken/rechten Rand, Kopfbreite <= 72 %, kahler Kopf <= 45 % der Hoehe`,
        z.nah && nahe(z.radius, PORTRAET, 0.014) && g.randL === 0 && g.randR === 0 && breitenAnteil <= 0.72 && hoehe <= 0.45,
        { randL: g.randL, randR: g.randR, breite: +breitenAnteil.toFixed(3), hoehe: +hoehe.toFixed(3), entwurf: +erwartet.toFixed(3), fov: +fov.toFixed(4), radius: +z.radius.toFixed(3) });
      if (w / h >= 0.75) pruefe(`Portraet ${w}x${h}: breite Leinwand behaelt den Kopfanteil im Sollband 35-45 %`, hoehe >= 0.35 && hoehe <= 0.45, { hoehe: +hoehe.toFixed(3) });
      await auswerten(() => { window.v.zoomeKopf(false); });
      await fahrtEnde();
    }
    await leinwand(...LEINWAND_STANDARD);
    await auswerten(async (h) => { await window.v.setze('frisur', h); await window.frames(4); }, haar);
  });

  /* --- M1: Groessenwechsel im Portraet ------------------------------------------------------ */
  await schritt('Groessenwechsel im Portraet', async () => {
    await leinwand(700, 700);
    await auswerten(() => { window.v.zoomeKopf(true); });
    await fahrtEnde();
    const reihe = [];
    let bleibt = true;
    const messen = async (w) => {
      await page.evaluate((ww) => { document.querySelector('canvas').style.width = `${ww}px`; }, w);
      await frames(3);
      const kahl = await kahlMass();
      const z = await zustand();
      bleibt = bleibt && z.nah && nahe(z.radius, PORTRAET, 0.014);
      reihe.push(Math.sqrt(kahl.flaeche));
    };
    for (let w = 700; w >= 200; w -= 6) await messen(w);
    for (let w = 206; w <= 700; w += 6) await messen(w);
    let sprung = 0;
    for (let i = 1; i < reihe.length; i++) sprung = Math.max(sprung, Math.abs(reihe[i] / reihe[i - 1] - 1));
    pruefe('Groessenwechsel im Portraet (Breite 700 -> 200 -> 700 in 6-px-Schritten): Zustand Portraet bleibt, kein Sprung ueber 5 % der Kopfgroesse (Wurzel der Silhouettenflaeche) zwischen zwei Messungen', bleibt && sprung <= 0.05, { schritte: reihe.length, groessterSprung: +sprung.toFixed(4), kopfGroessePx: `${reihe[0].toFixed(0)}..${Math.min(...reihe).toFixed(0)}..${reihe.at(-1).toFixed(0)}` });
    // Sprung der Leinwand (Mobil-Umbruch): der Zustand bleibt, die Kopfgroesse folgt dem Entwurf
    await leinwand(619, 699);
    const gross = await kahlMass();
    await leinwand(227, 731);
    const schmal = await kahlMass();
    const z = await zustand();
    pruefe('Leinwand springt im Portraet von 619x699 auf 227x731: Zustand bleibt', z.nah && nahe(z.radius, PORTRAET, 0.014), { breit: gross.hoehePx, schmal: schmal.hoehePx, radius: z.radius });
    await auswerten(() => { window.v.zoomeKopf(false); });
    await fahrtEnde();
    await leinwand(...LEINWAND_STANDARD);
  });

  /* --- M2: Trefferflaeche folgt dem Getragenen ---------------------------------------------- */
  await schritt('Trefferflaeche', async () => {
    const haare = k.figur === 'wikinger' ? ['H_38', 'H_30', 'H_14'] : ['H_01', 'H_38', 'H_14'];
    const faelle = haare.map((h) => ({ etikett: `Frisur ${h}`, frisur: `${app.folder}/${h}`, satz: null }));
    for (const satz of app.equipmentSets.filter((e) => e.figure === k.figur)) faelle.push({ etikett: `Set ${satz.id}`, frisur: haar, satz });
    for (const f of faelle) {
      const teile = f.satz ? f.satz.parts.map((t) => (t.previewModel ?? t.model).replace(/\.glb$/, '')) : [];
      const kopfIdx = f.satz ? f.satz.parts.findIndex((t) => t.appearanceSlot === 'kopf') : -1;
      const geladen = await auswerten(async ({ fr, teile }) => {
        try {
          await window.v.setze('frisur', fr);
          await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, d)));
          await window.frames(6);
          return true;
        } catch (e) { return String(e).slice(0, 90); }
      }, { fr: f.frisur, teile });
      if (geladen !== true) {
        console.log(`INFO ${k.name}: ${f.etikett} nicht ladbar (${geladen}) - uebersprungen`);
        await auswerten(async ({ teile }) => { await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, null).catch(() => {}))); }, { teile });
        continue;
      }
      const extra = kopfIdx >= 0 ? [`klassenruestung-${kopfIdx}`] : [];
      const werte = [];
      for (const r of [3.2, 1.4]) for (const rot of [0, 90]) {
        await auswerten(({ r, rot }) => { window.v.kamera.radius = r; window.v.figurKnoten.rotation.y = rot * Math.PI / 180; }, { r, rot });
        await frames(4);
        await auswerten(() => window.v.kopfAufBildschirm()); // Flaeche vor dem Ausblenden fertig berechnen
        const g = await kopfMass(extra);
        const t = await page.evaluate(({ b64, kinn }) => window.trefferAnteil(b64, kinn, 3), { b64: g.png.toString('base64'), kinn: g.kinn });
        werte.push({ r, rot, n: t.n, anteil: +t.anteil.toFixed(4), aussenPx: +t.weitestAussen.toFixed(1) });
      }
      const schlechtester = Math.min(...werte.map((w) => w.anteil));
      pruefe(`Trefferflaeche ${f.etikett}: Silhouette von Kopf, Frisur und Kopfteil zu >= 95 % im Treffer (0 und 90 Grad, Ausgang und Portraet)`, schlechtester >= 0.95, { schlechtester: +schlechtester.toFixed(4), werte });
      // Klicks bei 3,2 m und 0 Grad
      await auswerten(() => { window.v.kamera.radius = 3.2; window.v.figurKnoten.rotation.y = 0; });
      await frames(4);
      await auswerten(() => window.v.kopfAufBildschirm());
      const box = await auswerten(() => window.leinwandBox());
      if (kopfIdx >= 0) {
        const kt = await kopfMass(extra, true); // nur das Kopfteil
        const pk = [box.x + kt.sx, box.y + kt.sy];
        await klick(pk[0], pk[1]);
        await fahrtEnde();
        const zoomt = await zustand();
        await auswerten(() => { window.v.zoomeKopf(false); });
        await fahrtEnde();
        pruefe(`Trefferflaeche ${f.etikett}: Klick auf die Mitte des Kopfteils zoomt`, zoomt.nah && nahe(zoomt.radius, PORTRAET, 0.014), { klick: pk.map(Math.round), radius: +zoomt.radius.toFixed(3) });
      }
      const brust = await auswerten(() => { const b = window.leinwandBox(); const kn = window.v.kopfKnoten.getAbsolutePosition(); const B = window.__B; const p = B.Vector3.TransformCoordinates(new B.Vector3(kn.x, 1.2, kn.z), window.v.scene.getTransformMatrix()); return { x: b.x + (p.x + 1) / 2 * b.w, y: b.y + (1 - p.y) / 2 * b.h }; });
      await klick(brust.x, brust.y);
      await frames(6);
      const nachBrust = await zustand();
      pruefe(`Trefferflaeche ${f.etikett}: Klick auf die Brust (1,20 m) zoomt nicht`, nahe(nachBrust.radius, 3.2, 1e-6) && !nachBrust.fahrt, { radius: nachBrust.radius });
      if (f.satz && f.satz.id === 'seidraven_female') {
        const g0 = await kopfMass(extra);
        await auswerten(() => window.nurNetze(window.v, 'ArmUpper', true));
        await frames(3);
        const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
        const kinn = await auswerten(() => window.kinnZeile(window.v));
        const fern = await page.evaluate(({ b64, kinn, sp }) => window.fernsterPunkt(b64, kinn, sp), { b64: png.toString('base64'), kinn, sp: g0.sx });
        await auswerten(() => window.nurNetze(window.v, 'ArmUpper', false));
        if (fern) {
          await klick(box.x + fern[0], box.y + fern[1]);
          await frames(6);
          const nachFluegel = await zustand();
          pruefe('Trefferflaeche seidraven_female: Klick auf den fernsten Punkt der Schulter-/Fluegelstuecke (oberhalb des Kinns) zoomt nicht', nahe(nachFluegel.radius, 3.2, 1e-6) && !nachFluegel.fahrt, { klick: [Math.round(fern[0] - g0.sx), Math.round(fern[1] - g0.sy)], radius: nachFluegel.radius });
        }
      }
      await auswerten(async ({ teile }) => { window.v.figurKnoten.rotation.y = 0; await Promise.all(teile.map((d, i) => window.v.setze(`klassenruestung-${i}`, null))); await window.v.setze('frisur', null); await window.frames(2); }, { teile });
    }
    await auswerten(async (h) => { window.v.kamera.radius = 3.2; await window.v.setze('frisur', h); await window.frames(4); }, haar);
  });

  /* --- K4: Radschritt ueber die Grenze bei 2,2 m ----------------------------------------------- */
  await schritt('Radschritt', async () => {
    await auswerten(() => { window.v.ruhe.pause(); }); // die Ruhepose atmet: ohne Anhalten schwankt die Silhouette um ein bis zwei Prozent
    // Toleranz je Leinwand: Der Kopf lehnt sich in der Ruhepose rund 9 cm zur Kamera (Kopfknochen z = 0,086 m). Diese Tiefe
    // vergroessert ihn beim Herangehen zusaetzlich (Perspektive); bei einer Rastung ueber einen langen Radiusweg (schmale
    // Leinwand: 2,28 -> 1,43 m in einem Schritt) macht das rund 2,5 % aus. Bei breiter Leinwand ist der Weg je Rastung kurz.
    for (const [w, h, etikett, tol] of [[1000, 1400, 'breit genug', 0.02], [390, 844, 'Mobil', 0.03], [400, 1200, 'sehr schmal', 0.04]]) {
      await leinwand(w, h);
      await auswerten(() => { window.v.kamera.radius = 3.2; window.v.figurKnoten.rotation.y = 0; });
      await frames(4);
      const box = await auswerten(() => window.leinwandBox());
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      let vorher = Math.sqrt((await kahlMass()).flaeche);
      const folge = [];
      for (let i = 0; i < 16; i++) {
        await page.mouse.wheel(0, -100);
        await frames(6);
        const z = await zustand();
        const kahl = await kahlMass();
        const groesse = Math.sqrt(kahl.flaeche);
        const bild = await auswerten(() => ({ fov: window.v.kamera.fov, ziel: window.v.kamera.target.y, aspekt: window.v.engine.getAspectRatio(window.v.kamera), hoehe: 2 * window.v.kamera.radius * Math.tan(window.v.kamera.fov / 2) }));
        folge.push({ r: +z.radius.toFixed(3), px: +groesse.toFixed(1), faktor: +(groesse / vorher).toFixed(3), fov: +bild.fov.toFixed(4), hoehe: +bild.hoehe.toFixed(4), aspekt: +bild.aspekt.toFixed(3), ziel: +bild.ziel.toFixed(3) });
        vorher = groesse;
        if (z.radius <= PORTRAET + 1e-6) break;
      }
      // Die letzte Rastung stoesst an die Portraetgrenze und ist nur ein Teilschritt.
      const voll = folge.slice(0, folge.at(-1).r <= PORTRAET + 1e-6 ? -1 : undefined);
      const ok = voll.length >= 1 && voll.every((f) => Math.abs(f.faktor - 1.12) <= tol) && folge.every((f) => f.faktor <= 1.12 + tol);
      pruefe(`Radschritt bei Leinwand ${w}x${h} (${etikett}): jede volle Rastung vergroessert den Kopf im Bild (Wurzel der Silhouettenflaeche) um 1,12 +-${tol}, auch ueber 2,2 m hinweg`, ok, { folge: folge.map((f) => `${f.r}:${f.faktor}`).join(' '), rohdaten: folge.slice(-3) });
    }
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.ruhe.play(true); });
    await leinwand(...LEINWAND_STANDARD);
    await frames(3);
  });

  /* --- K6: Doppelklick ------------------------------------------------------------------------------ */
  await schritt('Doppelklick', async () => {
    const zaehle = () => auswerten(() => { window.__zk = []; const v = window.v; const o = v.zoomeKopf.bind(v); v.zoomeKopf = (n) => { window.__zk.push(n ?? null); return o(n); }; });
    const lies = () => auswerten(() => { const a = window.__zk; delete window.v.zoomeKopf; return a; });
    let p = await auswerten(() => window.kopfProjektion(window.v));
    await zaehle();
    await page.mouse.move(p.x, p.y);
    await page.mouse.dblclick(p.x, p.y);
    await fahrtEnde();
    let z = await zustand();
    let aufrufe = await lies();
    pruefe('Doppelklick auf den Kopf: erreicht das Portraet (der zweite Klick wird verschluckt)', z.nah && nahe(z.radius, PORTRAET, 0.014) && aufrufe.length === 1, { radius: +z.radius.toFixed(3), aufrufe });
    p = await auswerten(() => window.kopfProjektion(window.v));
    await zaehle();
    await page.mouse.dblclick(p.x, p.y);
    await fahrtEnde();
    z = await zustand();
    aufrufe = await lies();
    pruefe('Doppelklick auf den Kopf im Portraet: faehrt zurueck (ein Umschalten, kein zweites)', !z.nah && nahe(z.radius, 3.2, 0.03) && aufrufe.length === 1, { radius: +z.radius.toFixed(3), aufrufe });
  });

  /* --- K3: keine Markierung ohne gueltige Kopfposition ------------------------------------------ */
  await schritt('Wechsel: Markierung ungueltig', async () => {
    const anderer = k.figur === 'wikinger' ? 'wikingerin/WikingerinKoerper' : 'wikinger/WikingerKoerper';
    const r = await auswerten(async (d) => {
      window.__gz = []; window.v.beiKopfZustand = (z) => window.__gz.push({ ...z });
      const el = document.querySelector('#b'); const proben = [];
      const abtast = setInterval(() => proben.push(parseFloat(el.style.getPropertyValue('--kopf-r'))), 10);
      const p = window.v.ladeKoerper(d);
      const sofort = window.__gz.map((z) => ({ ...z }));
      await p; await window.frames(40);
      clearInterval(abtast);
      const spaet = window.__gz.at(-1);
      window.v.beiKopfZustand = null;
      return { sofort, spaet, proben, anzahl: window.__gz.length };
    }, anderer);
    const waehrend = r.proben.slice(0, r.proben.findIndex((x) => x > 0) < 0 ? r.proben.length : r.proben.findIndex((x) => x > 0));
    pruefe('Koerperwechsel: Rueckruf meldet sofort gueltig=false, danach gueltig=true, --kopf-r bleibt bis zur gueltigen Position 0', r.sofort.length >= 1 && r.sofort.at(-1).gueltig === false && r.spaet?.gueltig === true && waehrend.every((x) => x === 0 || Number.isNaN(x)), { sofort: r.sofort, spaet: r.spaet, probenBis0: waehrend.length, gesamt: r.proben.length });
    await auswerten(async (d) => { await window.v.ladeKoerper(d); await window.frames(30); }, k.datei);
    await auswerten(async (h) => { await window.v.setze('frisur', h); await window.frames(4); }, haar);
  });

  /* --- dispose waehrend der Fahrt ------------------------------------------------------ */
  await schritt('dispose', async () => {
    seitenfehler.length = 0;
    const p = await auswerten(() => window.kopfProjektion(window.v));
    await auswerten(() => { window.__rufe = []; window.__ruf = (z) => window.__rufe.push(z); window.v.beiKopfZustand = window.__ruf; });
    await page.mouse.move(p.x, p.y);
    await frames(3);
    await klick(p.x, p.y);
    await frames(1);
    const mitten = await zustand();
    const vorDispose = await auswerten(() => { window.v.dispose(); return window.__rufe.length; });
    await page.waitForTimeout(700);
    const nach = await auswerten(() => ({ rufe: window.__rufe.length, cursor: document.querySelector('canvas').style.cursor, kopfX: document.querySelector('#b').style.getPropertyValue('--kopf-x'), zoom: document.querySelector('#b').style.getPropertyValue('--zoom') }));
    pruefe('dispose() mitten in der Fahrt: Fahrt lief, keine Ausnahme, kein Rueckruf danach', mitten.fahrt && seitenfehler.length === 0 && nach.rufe === vorDispose, { fahrtLief: mitten.fahrt, rufeVor: vorDispose, rufeNach: nach.rufe, seitenfehler: seitenfehler.slice(0, 2) });
    pruefe('dispose(): Zeigerform und Variablen abgeraeumt', nach.cursor === '' && nach.kopfX === '' && nach.zoom === '', nach);
  });
}

/* --- Ausgangsbild gegen ein aelteres Buendel (nur mit --vergleich-datei) ---------------------------- */
if (VERGLEICH_DATEI) {
  for (const k of KOERPER) {
    aktuellerKoerper = k.name;
    await schritt('Ausgangsbild pixelgleich', async () => {
      await leinwand(619, 699); // Buehne bei 1440 x 900
      const haar = `${app.folder}/H_02`;
      const aufnahme = async (url, radius) => {
        await page.evaluate(async ({ url, d, haar, radius }) => {
          const { Vorschau } = await import(url);
          window.v?.dispose();
          const v = window.v = new Vorschau(document.querySelector('canvas'), `${location.origin}/assets/models/`);
          await v.ladeKoerper(d);
          await v.setze('frisur', haar);
          v.ruhe.goToFrame(10); v.ruhe.pause();
          v.kamera.radius = radius;
          await window.frames(20);
        }, { url, d: k.datei, haar, radius });
        const box = await auswerten(() => window.leinwandBox());
        return (await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } })).toString('base64');
      };
      const vergleiche = async (radius, altUrl) => {
        const neu = await aufnahme(`${basis}${BUENDEL}`, radius);
        const alt = await aufnahme(`${basis}${altUrl}`, radius);
        return page.evaluate(async ({ a, b }) => {
          const lade = async (x) => { const bin = Uint8Array.from(atob(x), (c) => c.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
          const A = await lade(a); const B = await lade(b);
          let n = 0; for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) n++;
          return { w: A.width, h: A.height, abweichendeKanaele: n };
        }, { a: neu, b: alt });
      };
      const ausgang = await vergleiche(3.2, '/assets/js/vorschau-vergleich.js');
      pruefe('Ausgangsbild (Radius 3,2, Leinwand 619x699, angehaltene Ruhepose) ist pixelgleich zum aelteren Buendel', ausgang.abweichendeKanaele === 0, ausgang);
      // Die Leinwand der Buehne bei 1440 x 900 ist breit genug: auch das Portraet (Radius 1,4) bleibt Pixel fuer Pixel gleich
      if (VERGLEICH_PORTRAET_DATEI) {
        const portraet = await vergleiche(1.4, '/assets/js/vorschau-vergleich2.js');
        pruefe('Portraet (Radius 1,4, Leinwand 619x699, angehaltene Ruhepose) ist pixelgleich zum vorherigen Stand mit Kopf-Zoom', portraet.abweichendeKanaele === 0, portraet);
      }
    });
  }
}

/* --- Aufraeumen und Ergebnis ------------------------------------------------------------ */
aktuellerKoerper = '';
pruefe('keine pageerror ueber den ganzen Lauf', seitenfehler.length === 0, { seitenfehler: seitenfehler.slice(0, 3) });
await browser.close();
server?.close();
const schlecht = ergebnisse.filter((e) => !e.ok);
console.log(`\n${ergebnisse.length - schlecht.length} bestanden, ${schlecht.length} fehlgeschlagen`);
process.exit(schlecht.length ? 1 : 0);
