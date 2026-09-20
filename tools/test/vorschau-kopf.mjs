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
/** Ein Buendel mit Kopf-Zoom (vorheriger Stand): ab 2,2 m pixelgleich (auch gedreht), Vorderansicht im Portraet auf 2 px und 1 % Kopfgroesse. */
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
  // Alle Eckpunkte eines Netzes in Weltkoordinaten, auf der CPU gehautet (aktuelle Pose).
  w.weltPunkte = (m) => {
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
    return welt;
  };
  w.minAbstand = (v) => {
    const cam = v.kamera.position; const P = [cam.x, cam.y, cam.z];
    let best = Infinity; let wer = '';
    for (const m of v.scene.meshes) {
      if (!m.isEnabled() || m.getTotalVertices() === 0) continue;
      const welt = w.weltPunkte(m);
      const idx = m.getIndices();
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
        const d = w.punktDreieck(P, [welt[a], welt[a + 1], welt[a + 2]], [welt[b], welt[b + 1], welt[b + 2]], [welt[c], welt[c + 1], welt[c + 2]]);
        if (d < best) { best = d; wer = m.name; }
      }
    }
    return { abstand: best, netz: wer };
  };
  // Eckpunkte der Kopfnetze oberhalb der Kinnlinie (1,46 m), unabhaengig von der Vorschau in die Leinwand projiziert:
  // Anteil ausserhalb (waagerecht) und Mitte des Huellrechtecks (Anteil der Leinwandbreite, rechts positiv).
  w.kopfAussen = (v, netze) => {
    const b = w.leinwandBox();
    const M = v.kamera.getViewMatrix().multiply(v.kamera.getProjectionMatrix());
    const V3 = window.__B.Vector3;
    let n = 0; let aussen = 0; let lo = 1e9; let hi = -1e9;
    for (const m of netze ?? v.kopfNetze()) {
      const welt = w.weltPunkte(m);
      for (let i = 0; i < welt.length; i += 3) {
        if (welt[i + 1] < 1.46) continue;
        const p = V3.TransformCoordinates(new V3(welt[i], welt[i + 1], welt[i + 2]), M);
        const px = (p.x + 1) / 2 * b.w;
        n++; if (px < 0 || px > b.w) aussen++;
        lo = Math.min(lo, px); hi = Math.max(hi, px);
      }
    }
    return { n, anteil: n ? aussen / n : 0, mitte: n ? ((lo + hi) / 2 - b.w / 2) / b.w : 0, links: (lo - b.w / 2) / b.w, rechts: (hi - b.w / 2) / b.w };
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
async function kopfMass(extra = [], nurExtra = false, mitte = [0, 0], ganz = false) {
  await auswerten(({ e, n }) => window.kopfGruppeNur(window.v, true, e, n), { e: extra, n: nurExtra });
  await frames(3);
  const box = await auswerten(() => window.leinwandBox());
  const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const kinn = await auswerten(() => window.kinnZeile(window.v));
  const m = await page.evaluate(({ b64, kinn, mitte }) => window.alphaMass(b64, kinn, mitte[0], mitte[1]), { b64: png.toString('base64'), kinn: ganz ? 1e6 : kinn, mitte });
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
    /*
      Die Ruhepose steht still, in PHASEN festen Phasen des Ruhe-Clips (kein Zufall der Bildzeit, der den
      kleinsten Abstand zwischen 0,285 und 0,311 m streuen liess). Der Kopfversatz wird dazu einmal in der
      angehaltenen Pose (Bild 0) neu gemessen, damit jeder Lauf mit derselben Zahl rechnet.
    */
    const PHASEN = 8;
    const versatz = await auswerten(async () => {
      const v = window.v;
      v.ruhe.pause(); v.ruhe.goToFrame(v.ruhe.from); await window.frames(3);
      if ('kopfVersatz' in v) { v.kopfVersatz = null; await window.frames(3); }
      return v.kopfVersatz ? { x: +v.kopfVersatz.x.toFixed(4), z: +v.kopfVersatz.z.toFixed(4) } : null;
    });
    console.log(`INFO ${aktuellerKoerper}: Kopfversatz in der angehaltenen Ruhepose (Bild 0): ${JSON.stringify(versatz)}`);
    let kleinsterGesamt = { abstand: Infinity };
    const drehung = async (etikett, schritte = 24, waffe = false) => {
      let klein = Infinity; let wo = {};
      for (let ph = 0; ph < PHASEN; ph++) {
        await auswerten(({ f, waffe }) => {
          const v = window.v; const g = v.ruhe; g.goToFrame(g.from + (g.to - g.from) * f);
          // Die Waffenpose rechnet mit der Bildzeit: Zeit anhalten und in derselben Phase auf eine feste Stelle setzen.
          if (waffe) {
            v.engine.getDeltaTime = () => 0;
            const schicht = v.waffenSchichten.get(v.waffeAktiv)?.[0];
            if (schicht) v.waffenZeit = f * (schicht.bis - schicht.von) / schicht.bilderJeSekunde;
          }
        }, { f: ph / PHASEN, waffe });
        await frames(3);
        for (let i = 0; i < schritte; i++) {
          await auswerten((w) => { window.v.figurKnoten.rotation.y = w; }, i * 2 * Math.PI / schritte);
          await frames(2);
          const a = await auswerten(() => window.minAbstand(window.v));
          if (a.abstand < klein) { klein = a.abstand; wo = { phase: ph, schritt: i, netz: a.netz }; }
        }
      }
      const minZ = await auswerten(() => window.v.kamera.minZ);
      pruefe(`Portraet, ${PHASEN} feste Phasen der Ruhepose x ${schritte} Drehschritte, ${etikett}: kleinster Abstand Kamera-Dreieck >= 0,25 m (minZ 0,05)`, klein > minZ && klein >= 0.25, { klein: +klein.toFixed(3), minZ, ...wo });
      if (klein < kleinsterGesamt.abstand) kleinsterGesamt = { abstand: klein, etikett, ...wo };
      return klein;
    };
    for (const f of new Set([breit.datei, hoch.datei])) {
      await auswerten(async (d) => { await window.v.setze('frisur', d); await window.frames(4); }, f);
      await drehung(`Frisur ${f.split('/').pop()}`);
    }
    // Kalibrierung der CPU-Haut: Kopfnetz-Mitte muss bei ~1,63 m liegen.
    await auswerten(async () => { window.v.figurKnoten.rotation.y = 0; await window.frames(3); });
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
      // Leinwandgroesse und Sichtfeld aendern den Abstand Kamera - Netz nicht (nur der Radius und der Blickpunkt tun es).
      await drehung(`Ruestung ${satz.id}`);
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
      await drehung(`Waffe ${art}`, 24, true);
      await auswerten(() => { delete window.v.engine.getDeltaTime; });
    }
    await auswerten(async () => { await window.v.setzeWaffe(null); window.v.figurKnoten.rotation.y = 0; window.v.ruhe.play(true); await window.frames(2); });
    console.log(`INFO ${aktuellerKoerper}: kleinster Abstand Kamera-Dreieck ueber alle Faelle des Schritts (8 Phasen x 24 Drehschritte je Fall): ${kleinsterGesamt.abstand.toFixed(3)} m (${JSON.stringify(kleinsterGesamt)})`);
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
    for (const [w, h] of [[227, 600], [227, 731], [390, 600], [390, 844], [619, 699], [1440, 900], [2560, 900]]) {
      await leinwand(w, h);
      await auswerten(() => { window.v.zoomeKopf(true); });
      await fahrtEnde();
      const z = await zustand();
      const g = await kopfMass();
      const kahl = await kahlMass();
      const breitenAnteil = (g.rechts - g.links + 1) / g.box.w;
      const hoehe = kahl.hoehePx / kahl.boxH;
      const erwartet = 0.34 / Math.max(0.8, 0.364 / 0.85 / (w / h));
      const fov = await auswerten(() => window.v.kamera.fov);
      pruefe(`Portraet ${w}x${h} (Haar H_14): kein Kopfpixel am linken/rechten Rand, Kopfbreite <= 87 %, kahler Kopf <= 45 % der Hoehe`,
        z.nah && nahe(z.radius, PORTRAET, 0.014) && g.randL === 0 && g.randR === 0 && breitenAnteil <= 0.87 && hoehe <= 0.45,
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

  /* --- Klein 1: Zoom auf schmaler Buehne ------------------------------------------------------- */
  await schritt('Zoom auf schmaler Buehne', async () => {
    await auswerten(() => { window.v.ruhe.pause(); });
    const ergebnis = {};
    for (const [w, h] of [[208, 731], [227, 731], [390, 844], [1440, 900]]) {
      await leinwand(w, h);
      const zeile = {};
      for (const r of [3.2, 2.2, 1.4]) {
        await auswerten((rr) => { window.v.kamera.radius = rr; }, r);
        await frames(4);
        const kahl = await kahlMass();
        zeile[r] = { hoehePx: kahl.hoehePx, wurzelFlaeche: +Math.sqrt(kahl.flaeche).toFixed(1) };
      }
      ergebnis[`${w}x${h}`] = zeile;
    }
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.ruhe.play(true); });
    await leinwand(...LEINWAND_STANDARD);
    const z227 = ergebnis['227x731'];
    const verh = z227[1.4].hoehePx / z227[2.2].hoehePx;
    const verhFl = z227[1.4].wurzelFlaeche / z227[2.2].wurzelFlaeche;
    pruefe('Bildschirm 227x731: das Portraet (1,4 m) vergroessert den Kopf gegenueber 2,2 m mindestens 1,35-fach (Kopfhoehe in Pixeln)', verh >= 1.35, { verhaeltnisHoehe: +verh.toFixed(3), verhaeltnisWurzelFlaeche: +verhFl.toFixed(3), kopfHoehePx: ergebnis });
    const z390 = ergebnis['390x844']; const z1440 = ergebnis['1440x900'];
    pruefe('Bildschirm 390x844 und 1440x900: das Portraet vergroessert den Kopf gegenueber 2,2 m mindestens 1,5-fach', z390[1.4].hoehePx / z390[2.2].hoehePx >= 1.5 && z1440[1.4].hoehePx / z1440[2.2].hoehePx >= 1.5, { m390: +(z390[1.4].hoehePx / z390[2.2].hoehePx).toFixed(3), m1440: +(z1440[1.4].hoehePx / z1440[2.2].hoehePx).toFixed(3) });
    console.log(`INFO ${aktuellerKoerper}: Kopfhoehe in Pixeln bei 3,2 / 2,2 / 1,4 m je Buehne: ${JSON.stringify(ergebnis)}`);
  });

  /* --- Klein 1: alle Frisuren im Portraet auf der schmalsten Buehne ---------------------------------- */
  await schritt('Alle Frisuren im Portraet', async () => {
    await auswerten(() => { window.v.ruhe.pause(); });
    await leinwand(227, 731);
    await auswerten(() => { window.v.kamera.radius = 1.4; });
    const zaehler = { 0: [], 45: [], 90: [] };
    const hoechstRand = { 0: 0, 45: 0, 90: 0 };
    const kahlRand = { 0: 0, 45: 0, 90: 0 };
    let breitesteVorn = 0;
    const frisuren = app.hairstyles.filter((hh) => !(k.figur === 'wikinger' && hh.id === 'H_01'));
    // kahler Kopf (ohne Frisur) bei allen Drehungen: Rand-Pixel zaehlen
    await auswerten(async () => { await window.v.setze('frisur', null); await window.v.setze('bart', null); await window.v.setze('augenbraue', null); await window.frames(3); });
    for (const grad of [0, 45, 90]) {
      await auswerten((g) => { window.v.figurKnoten.rotation.y = g * Math.PI / 180; }, grad);
      const g = await kopfMass([], false, [0, 0], true);
      kahlRand[grad] += g.randL + g.randR;
    }
    for (const hh of frisuren) {
      await auswerten(async (d) => { await window.v.setze('frisur', d); await window.frames(2); }, `${app.folder}/${hh.file}`);
      for (const grad of [0, 45, 90]) {
        await auswerten((g) => { window.v.figurKnoten.rotation.y = g * Math.PI / 180; }, grad);
        const g = await kopfMass([], false, [0, 0], true);
        if (grad === 0) breitesteVorn = Math.max(breitesteVorn, (g.rechts - g.links + 1) / g.box.w);
        if (g.randL || g.randR) zaehler[grad].push(`${hh.id}:${g.randL}/${g.randR}`);
        hoechstRand[grad] = Math.max(hoechstRand[grad], g.randL + g.randR);
      }
    }
    await auswerten(async ({ d, bart, brauen, figur }) => { window.v.figurKnoten.rotation.y = 0; await window.v.setze('frisur', d); if (figur === 'wikinger') await window.v.setze('bart', bart); await window.v.setze('augenbraue', brauen); await window.frames(3); },
      { d: haar, figur: k.figur, bart: `${app.folder}/${app.beards[0].file}`, brauen: `${app.folder}/${app.eyebrows.find((e) => e.figure === k.figur).file}` });
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.ruhe.play(true); });
    await leinwand(...LEINWAND_STANDARD);
    pruefe(`Alle ${frisuren.length} Frisuren im Portraet auf 227x731: von vorn (0 Grad) kein Kopf- oder Frisurpixel am linken/rechten Rand, Breite hoechstens 87 %`, zaehler[0].length === 0 && breitesteVorn <= 0.87, { beruehren0Grad: zaehler[0], breitesteVorn: +breitesteVorn.toFixed(3) });
    pruefe('Alle Frisuren im Portraet auf 227x731: der kahle Kopf beruehrt von vorn (0 Grad) nie den Rand', kahlRand[0] === 0, { randPixelKahlerKopfJeDrehung: kahlRand });
    // Gedreht (45, 90 Grad) ist nicht zugleich Zoom und freier Rand zu haben (siehe KOPF_BREITE): nur ausweisen.
    console.log(`INFO ${aktuellerKoerper}: auf 227x731 Randpixel (Zeilen links/rechts) je Drehung: kahler Kopf ${JSON.stringify(kahlRand)}; Maximum ueber ${frisuren.length} Frisuren 0 Grad ${hoechstRand[0]}, 45 Grad ${hoechstRand[45]}, 90 Grad ${hoechstRand[90]}; Frisuren am Rand: 0 Grad ${zaehler[0].length}, 45 Grad ${zaehler[45].length}, 90 Grad ${zaehler[90].length}`);
  });


  /* --- Der Blickpunkt folgt im Portraet der Kopfmitte ---------------------------------------------- */
  const helmSatz = app.equipmentSets.find((e) => e.id === k.helm);
  const helmIndex = helmSatz.parts.findIndex((t) => t.appearanceSlot === 'kopf');
  const helmModell = (helmSatz.parts[helmIndex].previewModel ?? helmSatz.parts[helmIndex].model).replace(/\.glb$/, '');
  const BUEHNEN = [[227, 731], [345, 731]]; // Fenster 900 und 1024 Pixel breit
  const aussehenWieder = () => auswerten(async ({ d, bart, brauen, figur, helmIndex }) => {
    const v = window.v; v.figurKnoten.rotation.y = 0;
    await v.setze(`klassenruestung-${helmIndex}`, null);
    await v.setze('frisur', d); await v.setze('bart', figur === 'wikinger' ? bart : null); await v.setze('augenbraue', brauen); await window.frames(3);
  }, { d: haar, figur: k.figur, bart: `${app.folder}/${app.beards[0].file}`, brauen: `${app.folder}/${app.eyebrows.find((e) => e.figure === k.figur).file}`, helmIndex });

  await schritt('Kopfversatz bei verstecktem Leinwand-Laden', async () => {
    // Die Seite laedt den ersten Koerper, solange die Buehne noch versteckt ist: Das Netz wird dann nicht gezeichnet,
    // seine Hautmatrizen bleiben die Einheitsmatrizen der Bindepose. Gemessen werden darf erst in der Ruhepose.
    const versatz = await auswerten(async ({ url, d }) => {
      const modul = await import(url);
      window.v?.dispose();
      const c = document.querySelector('canvas');
      c.style.display = 'none';
      const v = window.v = new modul.Vorschau(c, `${location.origin}/assets/models/`);
      const Vec = v.kamera.target.constructor; window.__B = { Vector3: Vec };
      await v.ladeKoerper(d);
      await window.frames(15);
      const versteckt = v.kopfVersatz ? { x: +v.kopfVersatz.x.toFixed(4), z: +v.kopfVersatz.z.toFixed(4) } : null;
      c.style.display = '';
      await window.frames(40);
      return { versteckt, sichtbar: v.kopfVersatz ? { x: +v.kopfVersatz.x.toFixed(4), z: +v.kopfVersatz.z.toFixed(4) } : null };
    }, { url: `${basis}${BUENDEL}`, d: k.datei });
    pruefe('Koerper bei versteckter Leinwand geladen: Kopfversatz wird erst in der Ruhepose gemessen (8 bis 14 cm vor der Achse), nicht in der Bindepose', versatz.sichtbar !== null && Math.abs(versatz.sichtbar.z) > 0.08 && Math.abs(versatz.sichtbar.z) < 0.14, versatz);
    // Ruhepose gleich nach dem Laden angehalten: Sie wirkt nie auf die Haut, gemessen werden darf nichts; erst mit ihr (play) kommt die Zahl.
    const angehalten = await auswerten(async ({ url, d }) => {
      const modul = await import(url);
      window.v?.dispose();
      const v = window.v = new modul.Vorschau(document.querySelector('canvas'), `${location.origin}/assets/models/`);
      window.__B = { Vector3: v.kamera.target.constructor };
      await v.ladeKoerper(d);
      v.ruhe.pause();
      await window.frames(25);
      const inBindepose = v.kopfVersatz ? { x: +v.kopfVersatz.x.toFixed(4), z: +v.kopfVersatz.z.toFixed(4) } : null;
      v.ruhe.play(true);
      await window.frames(40);
      return { inBindepose, danach: v.kopfVersatz ? { x: +v.kopfVersatz.x.toFixed(4), z: +v.kopfVersatz.z.toFixed(4) } : null };
    }, { url: `${basis}${BUENDEL}`, d: k.datei });
    pruefe('Ruhepose gleich nach dem Laden angehalten: kein Kopfversatz aus der Bindepose, nach dem Weiterlaufen 8 bis 14 cm vor der Achse', angehalten.inBindepose === null && angehalten.danach !== null && Math.abs(angehalten.danach.z) > 0.08 && Math.abs(angehalten.danach.z) < 0.14, angehalten);
    await neueVorschau(k.datei);
    await auswerten(async ({ haar, figur, bart, brauen }) => {
      await window.v.setze('frisur', haar);
      if (figur === 'wikinger') await window.v.setze('bart', bart);
      await window.v.setze('augenbraue', brauen);
      await window.frames(6);
    }, { haar, figur: k.figur, bart: `${app.folder}/${app.beards[0].file}`, brauen: `${app.folder}/${app.eyebrows.find((e) => e.figure === k.figur).file}` });
  });

  await schritt('Drehen im Portraet: Kopf bleibt mittig', async () => {
    const versatz = await auswerten(() => { const o = window.v.kopfVersatz; return o ? { x: +o.x.toFixed(4), z: +o.z.toFixed(4) } : null; });
    pruefe('Kopfversatz einmal je Koerper gemessen: 8 bis 14 cm vor der Achse, hoechstens 2 cm seitlich', versatz !== null && Math.abs(versatz.z) > 0.08 && Math.abs(versatz.z) < 0.14 && Math.abs(versatz.x) < 0.02, { versatz });
    const konfigs = [['kahler Kopf', null], ...(k.figur === 'wikinger' ? [['Bart', 'bart']] : []), [`Helm ${k.helm}`, 'helm']];
    for (const [bw, bh] of BUEHNEN) {
      await leinwand(bw, bh);
      await auswerten(() => { window.v.zoomeKopf(true); });
      await fahrtEnde();
      for (const [etikett, art] of konfigs) {
        await auswerten(async ({ art, helmIndex, helmModell, bart }) => {
          const v = window.v;
          await v.setze('frisur', null); await v.setze('bart', art === 'bart' ? bart : null);
          await v.setze(`klassenruestung-${helmIndex}`, art === 'helm' ? helmModell : null);
          await window.frames(6);
        }, { art, helmIndex, helmModell, bart: `${app.folder}/${app.beards[0].file}` });
        const extra = art === 'helm' ? [`klassenruestung-${helmIndex}`] : [];
        const rand = {}; const abw = {};
        let kahlAussen = 0; let ueberstand = 0;
        for (const grad of [0, 45, 90, 135, 180, 270]) {
          await auswerten((g) => { window.v.figurKnoten.rotation.y = g * Math.PI / 180; }, grad);
          let randSumme = 0; let abweichung = 0;
          // Ruhepose laeuft: mehrere Aufnahmen in verschiedenen Phasen, die schlechteste zaehlt.
          for (let n = 0; n < (art === null ? 3 : 2); n++) {
            await page.waitForTimeout(700);
            const m = await kopfMass(extra, false, [0, 0], true);
            randSumme += m.randL + m.randR;
            abweichung = Math.max(abweichung, Math.abs((m.links + m.rechts + 1) / 2 - m.w / 2) / m.w);
            if (art === 'helm') {
              // Das Gesicht (Kopfnetz unter dem Helm, ausgeblendet, aber am Skelett) und der Helmrand, rechnerisch projiziert
              const u = await auswerten(() => {
                const v = window.v; const kahl = window.kopfAussen(v, v.koerperNetze.filter((n) => /^Chr_Head_/.test(n.name))); const h = window.kopfAussen(v);
                return { kahl: kahl.anteil, ueberstand: Math.max(0, -h.links - 0.5, h.rechts - 0.5) };
              });
              kahlAussen += u.kahl; ueberstand = Math.max(ueberstand, u.ueberstand);
            }
          }
          rand[grad] = randSumme; abw[grad] = +(abweichung * 100).toFixed(1);
        }
        const randfrei = Object.values(rand).every((x) => x === 0);
        const mittig = art !== null || Object.values(abw).every((x) => x <= 6);
        if (art === 'helm') {
          // Ein Helm ist gedreht bis 0,42 m breit (Ironward bei 45 Grad 98,7 % der Buehnenbreite, aus der Mitte): ganz randfrei
          // geht er nicht (siehe Bericht); das Gesicht darunter bleibt drin, der Helmrand ragt hoechstens 10 % der Buehnenbreite hinaus.
          pruefe(`Portrait ${bw}x${bh}, ${etikett}, Drehung 0/45/90/135/180/270 Grad bei laufender Ruhepose: Gesicht (Kopfnetz unter dem Helm) ganz im Bild, Helmrand ragt hoechstens 10 % der Buehnenbreite hinaus`,
            kahlAussen === 0 && ueberstand <= 0.10, { gesichtAusserhalb: kahlAussen, helmUeberstandProzent: +(ueberstand * 100).toFixed(1), randPixelHelm: rand, mitteAbweichungProzent: abw });
        } else {
          pruefe(`Portrait ${bw}x${bh}, ${etikett}, Drehung 0/45/90/135/180/270 Grad bei laufender Ruhepose: kein Kopfpixel am linken/rechten Rand${art === null ? ', Kopfmitte hoechstens 6 % der Buehnenbreite neben der Mitte' : ''}`,
            randfrei && mittig, { randPixel: rand, mitteAbweichungProzent: abw });
        }
      }
      await auswerten(() => { window.v.figurKnoten.rotation.y = 0; });
      await auswerten(() => { window.v.zoomeKopf(false); });
      await fahrtEnde();
    }
    await leinwand(...LEINWAND_STANDARD);
    await aussehenWieder();
  });

  await schritt('Frisuren gedreht im Portraet: Anteil ausserhalb', async () => {
    await auswerten(async () => { const g = window.v.ruhe; g.pause(); g.goToFrame(g.from + 10); await window.v.setze('bart', null); await window.v.setze('augenbraue', null); });
    const frisuren = app.hairstyles.filter((hh) => !(k.figur === 'wikinger' && hh.id === 'H_01'));
    const GRAD = [0, 45, 90, 180];
    const zusammen = {};
    for (const [bw, bh] of BUEHNEN) {
      await leinwand(bw, bh);
      await auswerten(() => { window.v.kamera.radius = 1.4; });
      const tab = {};
      for (const hh of [{ id: 'kahl', file: null }, ...frisuren]) {
        await auswerten(async (d) => { await window.v.setze('frisur', d); await window.frames(2); }, hh.file ? `${app.folder}/${hh.file}` : null);
        for (const grad of GRAD) {
          await auswerten((g) => { window.v.figurKnoten.rotation.y = g * Math.PI / 180; }, grad);
          await frames(2);
          const m = await auswerten(() => window.kopfAussen(window.v));
          (tab[hh.id] ??= {})[grad] = +(m.anteil * 100).toFixed(1);
        }
      }
      const hoechst = {};
      for (const grad of GRAD) {
        let best = { id: '', v: -1 };
        for (const [id, z] of Object.entries(tab)) if (id !== 'kahl' && z[grad] > best.v) best = { id, v: z[grad] };
        hoechst[grad] = best;
      }
      zusammen[`${bw}x${bh}`] = { kahl: tab.kahl, H_23: tab.H_23, H_38: tab.H_38, hoechst };
    }
    console.log(`INFO ${aktuellerKoerper}: Anteil der Kopf-Eckpunkte ausserhalb der Buehne in Prozent je Drehung (kahl, H_23, H_38, Maximum ueber alle Frisuren): ${JSON.stringify(zusammen)}`);
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.figurKnoten.rotation.y = 0; window.v.ruhe.play(true); });
    await leinwand(...LEINWAND_STANDARD);
    await aussehenWieder();
    const z227 = zusammen['227x731']; const z345 = zusammen['345x731'];
    pruefe('Alle Frisuren im Portraet: von vorn (0 Grad) und von hinten (180 Grad) liegt kein Eckpunkt ausserhalb der Buehne (227 und 345 px)',
      [z227, z345].every((z) => z.hoechst[0].v === 0 && z.hoechst[180].v === 0), { z227: [z227.hoechst[0], z227.hoechst[180]], z345: [z345.hoechst[0], z345.hoechst[180]] });
    pruefe('Kahler Kopf im Portraet: bei jeder Drehung liegt kein Eckpunkt ausserhalb der Buehne (227 und 345 px)',
      [z227, z345].every((z) => GRAD.every((g) => z.kahl[g] === 0)), { z227: z227.kahl, z345: z345.kahl });
    // Haar darf hinten ueberstehen (kahler Kopf und Gesicht nie, siehe oben); vorher, mit dem Blickpunkt auf der Achse, waren es bis 24 %
    pruefe('Frisuren gedreht (45 und 90 Grad) im Portraet: H_23 hoechstens 5 %, H_38 hoechstens 12 %, Maximum ueber alle Frisuren hoechstens 18 % der Eckpunkte ausserhalb (nur Haar, hinten)',
      [z227, z345].every((z) => [45, 90].every((g) => z.hoechst[g].v <= 18 && z.H_23[g] <= 5 && z.H_38[g] <= 12)), { z227: { hoechst: z227.hoechst, H_23: z227.H_23, H_38: z227.H_38 }, z345: { hoechst: z345.hoechst, H_23: z345.H_23, H_38: z345.H_38 } });
  });

  await schritt('Drehen in 5-Grad-Schritten: Kopfmitte springt nicht', async () => {
    await auswerten(async () => { const v = window.v; v.ruhe.pause(); v.ruhe.goToFrame(v.ruhe.from + 10); await v.setze('frisur', null); await v.setze('bart', null); });
    for (const [bw, bh] of BUEHNEN) {
      await leinwand(bw, bh);
      await auswerten(() => { window.v.kamera.radius = 1.4; });
      let sprung = 0; let ort = 0; let vor = null; let abweichung = 0; let ausserhalb = 0;
      for (let grad = 0; grad <= 360; grad += 5) {
        await auswerten((g) => { window.v.figurKnoten.rotation.y = g * Math.PI / 180; }, grad);
        const m = await kopfMass([], false, [0, 0], true);
        if (vor) { const d = Math.hypot(m.sx - vor.x, m.sy - vor.y); if (d > sprung) { sprung = d; ort = grad; } }
        vor = { x: m.sx, y: m.sy };
        abweichung = Math.max(abweichung, Math.abs((m.links + m.rechts + 1) / 2 - m.w / 2) / m.w);
        ausserhalb += m.randL + m.randR;
      }
      pruefe(`Portrait ${bw}x${bh}, kahler Kopf in 5-Grad-Schritten ueber 360 Grad (angehaltene Ruhepose): Schwerpunkt der Silhouette springt zwischen zwei Schritten um hoechstens 3 px`, sprung <= 3, { groessterSprungPx: +sprung.toFixed(2), beiGrad: ort, hoechsteMitteAbweichungProzent: +(abweichung * 100).toFixed(1), randPixel: ausserhalb });
    }
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.figurKnoten.rotation.y = 0; window.v.ruhe.play(true); });
    await leinwand(...LEINWAND_STANDARD);
    await aussehenWieder();
  });

  await schritt('Fahrt ins Portraet bei gedrehter Figur', async () => {
    await leinwand(227, 731);
    for (const grad of [90, 270]) {
      const daten = await auswerten(async (g) => {
        const v = window.v; const w = window;
        v.ruhe.pause(); v.ruhe.goToFrame(v.ruhe.from + 10);
        v.radiusFahrt = null; v.kamera.radius = 3.2; v.figurKnoten.rotation.y = g * Math.PI / 180;
        await w.frames(6);
        const kahl = v.koerperNetze.filter((m) => /^Chr_Head_/.test(m.name) && m.isEnabled());
        // die echte Fahrt (Bildzeit), je gerendertem Bild die Kopfmitte
        const echt = [];
        const beo = v.scene.onAfterRenderObservable.add(() => echt.push({ r: +v.kamera.radius.toFixed(3), mitte: w.kopfAussen(v, kahl).mitte }));
        v.zoomeKopf(true);
        const ende = performance.now() + 8000;
        while (v.radiusFahrt && performance.now() < ende) await w.frames(1);
        await w.frames(3);
        v.scene.onAfterRenderObservable.remove(beo);
        // dieselbe Strecke in festen Schritten (unabhaengig von der Bildrate)
        const schritte = [];
        v.radiusFahrt = null;
        for (let i = 0; i <= 32; i++) { v.kamera.radius = 2.2 - i * 0.025; await w.frames(2); schritte.push({ r: +v.kamera.radius.toFixed(3), mitte: w.kopfAussen(v, kahl).mitte }); }
        v.kamera.radius = 3.2; v.figurKnoten.rotation.y = 0;
        return { echt, schritte };
      }, grad);
      const vorzeichen = Math.sign(daten.schritte[0].mitte) || 1;
      const richtung = (l) => l.map((x) => x.mitte * vorzeichen);
      const pruefeReihe = (l) => { const d = richtung(l); let steigt = 0; let unter = 0; for (let i = 1; i < d.length; i++) steigt = Math.max(steigt, d[i] - d[i - 1]); for (const x of d) unter = Math.min(unter, x); return { steigt, unter }; };
      const fest = pruefeReihe(daten.schritte);
      const echtNah = daten.echt.filter((x) => x.r < 2.2);
      const echtR = pruefeReihe(echtNah);
      const ausgang = daten.echt[0]; const ende = daten.echt.at(-1);
      pruefe(`Fahrt ins Portraet bei ${grad} Grad (227x731): von 2,2 auf 1,4 m wandert die Kopfmitte monoton zur Buehnenmitte, kein Ueberschwingen ueber die Mitte hinaus, mehr als 1,5 % der Buehnenbreite (feste Schritte und echte Fahrt)`,
        fest.steigt <= 0.002 && fest.unter >= -0.015 && echtNah.length >= 3 && echtR.steigt <= 0.002 && echtR.unter >= -0.015 && Math.abs(daten.schritte.at(-1).mitte) <= 0.06,
        { festeSchritte: { mitteVon: +daten.schritte[0].mitte.toFixed(3), mitteNach: +daten.schritte.at(-1).mitte.toFixed(3), groessterAnstieg: +fest.steigt.toFixed(4), kleinsterWert: +fest.unter.toFixed(4) },
          echteFahrt: { bilderNahe: echtNah.length, bilderGesamt: daten.echt.length, groessterAnstieg: +echtR.steigt.toFixed(4), kleinsterWert: +echtR.unter.toFixed(4), mitteEnde: +ende.mitte.toFixed(3), mitteAnfang: +ausgang.mitte.toFixed(3) } });
    }
    await auswerten(() => { window.v.kamera.radius = 3.2; window.v.figurKnoten.rotation.y = 0; window.v.ruhe.play(true); });
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
    for (const [w, h, etikett, tol] of [[1000, 1400, 'breit genug', 0.02], [390, 844, 'Mobil', 0.03], [227, 731, 'schmalste Buehne', 0.03], [400, 1200, 'sehr schmal', 0.04]]) {
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
      const ok = voll.length >= 1 && voll.every((f) => Math.abs(f.faktor - 1.12) <= tol) && folge.every((f) => f.faktor <= 1.15) && folge.at(-1).r === PORTRAET;
      pruefe(`Radschritt bei Leinwand ${w}x${h} (${etikett}): jede volle Rastung vergroessert den Kopf im Bild (Wurzel der Silhouettenflaeche) um 1,12 +-${tol} (nie ueber 1,15), auch ueber 2,2 m hinweg, und die Grenze 1,4 wird exakt erreicht`, ok, { folge: folge.map((f) => `${f.r}:${f.faktor}`).join(' '), rohdaten: folge.slice(-3) });
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

  /* --- K3: keine Markierung ohne gueltige Kopfposition (ganze Rueckruffolge) ------------------------ */
  await schritt('Wechsel: Markierung ungueltig', async () => {
    const anderer = k.figur === 'wikinger' ? 'wikingerin/WikingerinKoerper' : 'wikinger/WikingerKoerper';
    // Den Koerper-GLB um 700 ms bremsen: Das Fenster ohne Koerper umfasst dann viele Bilder, und jede Luege von
    // `gueltig` in diesem Fenster faellt auf.
    const bremse = async (route) => { await new Promise((ok) => setTimeout(ok, 700)); await route.continue(); };
    await page.route(/\/(WikingerKoerper|WikingerinKoerper)\.glb$/, bremse);
    const aufzeichnen = (art, ziel) => auswerten(async ({ art, ziel }) => {
      const v = window.v; const el = document.querySelector('#b');
      const c = document.querySelector('canvas').getBoundingClientRect(); const e = el.getBoundingClientRect();
      const versatz = { x: c.left - e.left, y: c.top - e.top, w: c.width, h: c.height };
      let gueltig = v.kopfZustandLetzter.gueltig;
      const ruf = [];
      v.beiKopfZustand = (z) => { gueltig = z.gueltig; ruf.push({ ...z }); };
      const proben = []; let laeuft = true;
      const f = () => { if (!laeuft) return; proben.push({ g: gueltig, x: parseFloat(el.style.getPropertyValue('--kopf-x')), y: parseFloat(el.style.getPropertyValue('--kopf-y')), r: parseFloat(el.style.getPropertyValue('--kopf-r')) }); requestAnimationFrame(f); };
      requestAnimationFrame(f);
      let sofort;
      if (art === 'koerper') {
        const p = v.ladeKoerper(ziel.datei);
        sofort = ruf.map((z) => ({ ...z }));
        await p;
      } else {
        // Eine andere Schreibweise derselben Adresse: setzeWurzel kehrt bei gleicher Zeichenfolge sofort zurueck.
        const p = v.setzeWurzel(location.origin + ziel.wurzel);
        sofort = ruf.map((z) => ({ ...z }));
        await p;
        await window.frames(30); // Server gewechselt, noch kein Koerper: die ganze Zeit ungueltig
        await v.ladeKoerper(ziel.datei);
      }
      const start = performance.now();
      while (!gueltig && performance.now() - start < 5000) await window.frames(1);
      const bisGueltig = Math.round(performance.now() - start);
      await window.frames(6);
      laeuft = false;
      v.beiKopfZustand = null;
      return { sofort, ruf, proben, versatz, bisGueltig, endeGueltig: gueltig };
    }, { art, ziel });
    const pruefeFolge = (etikett, r) => {
      const sichtbar = r.proben.filter((x) => x.g === true);
      const luegen = sichtbar.filter((x) => !(Number.isFinite(x.x) && Number.isFinite(x.y) && x.r > 0 && !(x.x === 0 && x.y === 0)
        && x.x >= r.versatz.x && x.x <= r.versatz.x + r.versatz.w && x.y >= r.versatz.y && x.y <= r.versatz.y + r.versatz.h));
      const ohne = r.proben.filter((x) => x.g === false).length;
      pruefe(`${etikett}: sofort gueltig=false, danach in keinem Bild gueltig=true mit Position ausserhalb der Leinwand, bei 0/0 oder Radius 0, und spaetestens nach 5 s wieder gueltig`,
        r.sofort.length >= 1 && r.sofort.at(-1).gueltig === false && ohne >= 5 && luegen.length === 0 && r.endeGueltig === true && r.bisGueltig < 5000,
        { sofort: r.sofort, bilderUngueltig: ohne, bilderGueltig: sichtbar.length, luegen: luegen.slice(0, 3), anzahlLuegen: luegen.length, rueckrufe: r.ruf.map((z) => z.gueltig), bisGueltigMs: r.bisGueltig });
    };
    const r1 = await aufzeichnen('koerper', { datei: anderer });
    pruefeFolge('Koerperwechsel', r1);
    await auswerten(async (d) => { await window.v.ladeKoerper(d); await window.frames(30); }, k.datei);
    const r2 = await aufzeichnen('wurzel', { wurzel: `/assets/models/${Math.random().toString(36).slice(2)}/../`, datei: k.datei });
    pruefeFolge('Serverwechsel (setzeWurzel)', r2);
    await page.unroute(/\/(WikingerKoerper|WikingerinKoerper)\.glb$/, bremse);
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

/* --- Vergleiche mit aelteren Buendeln (nur mit --vergleich-datei / --vergleich-portraet-datei) ---------------------------- */
if (VERGLEICH_DATEI) {
  for (const k of KOERPER) {
    aktuellerKoerper = k.name;
    const haar = `${app.folder}/H_02`;
    const aufnahme = async (url, radius, grad = 0) => {
      await page.evaluate(async ({ url, d, haar, radius, grad }) => {
        const { Vorschau } = await import(url);
        window.v?.dispose();
        const v = window.v = new Vorschau(document.querySelector('canvas'), `${location.origin}/assets/models/`);
        await v.ladeKoerper(d);
        await v.setze('frisur', haar);
        v.ruhe.goToFrame(10); v.ruhe.pause();
        v.kamera.radius = radius;
        v.figurKnoten.rotation.y = grad * Math.PI / 180;
        await window.frames(20);
      }, { url, d: k.datei, haar, radius, grad });
      const box = await auswerten(() => window.leinwandBox());
      return (await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } })).toString('base64');
    };
    const vergleiche = async (radius, altUrl, grad = 0) => {
      const neu = await aufnahme(`${basis}${BUENDEL}`, radius, grad);
      const alt = await aufnahme(`${basis}${altUrl}`, radius, grad);
      return page.evaluate(async ({ a, b }) => {
        const lade = async (x) => { const bin = Uint8Array.from(atob(x), (c) => c.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
        const A = await lade(a); const B = await lade(b);
        let n = 0; for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) n++;
        return { w: A.width, h: A.height, abweichendeKanaele: n };
      }, { a: neu, b: alt });
    };
    await schritt('Ausgangsbild pixelgleich', async () => {
      await leinwand(619, 699); // Buehne bei 1440 x 900
      for (const grad of [0, 90]) {
        const ausgang = await vergleiche(3.2, '/assets/js/vorschau-vergleich.js', grad);
        pruefe(`Ausgangsbild (Radius 3,2, Figur ${grad} Grad gedreht, Leinwand 619x699, angehaltene Ruhepose) ist pixelgleich zum aelteren Buendel`, ausgang.abweichendeKanaele === 0, ausgang);
      }
    });
    if (VERGLEICH_PORTRAET_DATEI) {
      await schritt('Ab 2,2 m bitgleich, Vorderansicht im Portraet gleich', async () => {
        // Oberhalb von 2,2 m (Portraetanteil 0) bleibt alles Pixel fuer Pixel gleich, gedreht wie ungedreht
        await leinwand(619, 699);
        for (const r of [2.5, 2.2]) for (const grad of [0, 90]) {
          const g = await vergleiche(r, '/assets/js/vorschau-vergleich2.js', grad);
          pruefe(`Radius ${r} m, Figur ${grad} Grad gedreht, Leinwand 619x699: pixelgleich zum vorherigen Stand`, g.abweichendeKanaele === 0, g);
        }
        // Vorderansicht im Portraet: Kopfmitte hoechstens 2 px verschoben, Kopfgroesse +-1 %
        const kopfDaten = async (url) => {
          await page.evaluate(async ({ url, d }) => {
            const { Vorschau } = await import(url);
            window.v?.dispose();
            const v = window.v = new Vorschau(document.querySelector('canvas'), `${location.origin}/assets/models/`);
            await v.ladeKoerper(d);
            v.ruhe.goToFrame(10); v.ruhe.pause();
            v.kamera.radius = 1.4;
            await window.frames(24);
            window.kopfNetzeNur(v, true);
            await window.frames(3);
          }, { url, d: k.datei });
          const box = await auswerten(() => window.leinwandBox());
          const png = await page.screenshot({ omitBackground: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
          const m = await page.evaluate(({ b64 }) => window.alphaMass(b64, 1e6), { b64: png.toString('base64') });
          await auswerten(() => window.kopfNetzeNur(window.v, false));
          return m;
        };
        for (const [gw, gh] of [[227, 731], [619, 699], [1440, 900], [390, 844]]) {
          await leinwand(gw, gh);
          const neu = await kopfDaten(`${basis}${BUENDEL}`);
          const alt = await kopfDaten(`${basis}/assets/js/vorschau-vergleich2.js`);
          const dx = neu.sx - alt.sx; const dy = neu.sy - alt.sy; const groesse = Math.sqrt(neu.n) / Math.sqrt(alt.n) - 1;
          pruefe(`Vorderansicht im Portraet ${gw}x${gh}: Kopfmitte hoechstens 2 px gegen den vorherigen Stand verschoben, Kopfgroesse +-1 %`,
            Math.hypot(dx, dy) <= 2 && Math.abs(groesse) <= 0.01, { verschiebungPx: { x: +dx.toFixed(2), y: +dy.toFixed(2) }, groesseAbweichungProzent: +(groesse * 100).toFixed(2), kopfPixel: { neu: neu.n, alt: alt.n } });
        }
      });
    }
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
