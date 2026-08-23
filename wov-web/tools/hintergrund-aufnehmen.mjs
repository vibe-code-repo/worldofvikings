/**
 * Hintergrundfilm fuer die Charaktererstellung auf dev.play aufnehmen.
 *
 * Laeuft auf MIKES Maschine, nicht auf wov-dev — dort startet kein Chromium.
 * Erreicht wird dev.play ueber den Tunnel bzw. direkt per HTTPS.
 *
 * Ablauf:
 *   1. Fenster oeffnen, anmelden, in den Schwarzwald teleportieren.
 *   2. BEREIT melden — Mike stellt die Kamera ein und ruehrt sie dann nicht mehr an.
 *   3. Sobald die Datei LOS auftaucht: Figur ausblenden, intern hoeher rendern,
 *      Leinwand abfilmen, roh.webm schreiben.
 *
 * Aufgenommen wird der Zeichenpuffer der Leinwand (captureStream), nicht das
 * Fenster — die Bedienoberflaeche liegt als DOM darueber und ist damit von
 * vornherein nicht im Bild.
 */
// Playwright liegt nicht im Repo — Pfad notfalls per WOV_PLAYWRIGHT setzen.
const { chromium } = await import(
  process.env.WOV_PLAYWRIGHT ?? 'playwright',
);
import { writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';

// Arbeitsordner: hier landen roh.webm und die Auslesedatei LOS.
const ORDNER = process.env.WOV_AUFNAHME_ORDNER ?? `${process.env.HOME}/wov-aufnahme`;
mkdirSync(ORDNER, { recursive: true });
const LOS = `${ORDNER}/LOS`;
const ZIEL = `${ORDNER}/roh.webm`;

/** Schwarzwald-Fleck, den Mike beim letzten Mal ausgesucht hat. */
const POS = '-27820,-5900';
/** Kantenlaenge mal so viel intern rendern. 2 = vierfache Pixelzahl. */
const UEBER = Number(process.argv[2] ?? 2);
/** Sekunden Film. */
const DAUER = Number(process.argv[3] ?? 20);

const B = 1100;
const H = 1000;

rmSync(LOS, { force: true });

const browser = await chromium.launch({
  headless: false,
  args: [
    `--window-size=${B},${H + 120}`,
    '--window-position=0,0',
    // Ohne echte GPU rechnet SwiftShader auf der CPU — bei vierfacher
    // Pixelzahl waere das unbrauchbar langsam.
    '--enable-gpu-rasterization',
    '--ignore-gpu-blocklist',
  ],
});
const seite = await browser.newPage({ viewport: null });

// DEV liegt hinter Basic Auth. Zugangsdaten stehen im Tresor, nicht hier:
//   WOV_DEV_NUTZER=... WOV_DEV_PASSWORT=... node tools/hintergrund-aufnehmen.mjs
const nutzer = process.env.WOV_DEV_NUTZER;
const passwort = process.env.WOV_DEV_PASSWORT;
if (!nutzer || !passwort) {
  console.log('FEHLER: WOV_DEV_NUTZER und WOV_DEV_PASSWORT setzen.');
  await browser.close();
  process.exit(1);
}

// Zugangsdaten NUR bei dieser ersten Navigation einbetten. Bei jeder
// weiteren haengt Chromium in einen Zeitablauf statt sich anzumelden.
const anmeldung = `${encodeURIComponent(nutzer)}:${encodeURIComponent(passwort)}`;
await seite.goto(
  `https://${anmeldung}@play.dev.world-of-vikings.com/?pos=${POS}`,
  { waitUntil: 'domcontentloaded', timeout: 120_000 },
);

console.log('verbunden, warte auf die Welt …');
await seite.waitForFunction(() => window.__vb?.figur !== undefined, null, {
  timeout: 180_000,
});

// Zeugen: ohne diese Zahlen merkt man nie, ob ein Schalter wirklich gegriffen hat.
const stand = await seite.evaluate(() => {
  const c = document.querySelector('canvas');
  return { b: c.width, h: c.height, haken: typeof window.__vb.ueberaufloesung };
});
console.log(`Leinwand: ${stand.b}x${stand.h}`);
console.log(`Haken ueberaufloesung: ${stand.haken}`);
if (stand.haken !== 'function') {
  console.log('FEHLER: der Haken fehlt — Seite neu laden oder main.ts pruefen.');
  await browser.close();
  process.exit(1);
}

console.log('BEREIT — Fenster gehoert dir. Kamera ruhig stellen, dann Bescheid geben.');

while (!existsSync(LOS)) await new Promise((r) => setTimeout(r, 500));
rmSync(LOS, { force: true });

const gross = await seite.evaluate((f) => {
  window.__vb.ueberaufloesung(f);
  window.__vb.figur(false);
  const c = document.querySelector('canvas');
  return { b: c.width, h: c.height };
}, UEBER);
console.log(`Figur aus, Aufnahme mit ${gross.b}x${gross.h}`);

// Bildrate kurz messen, bevor der Film laeuft — lieber jetzt abbrechen
// als hinterher eine ruckelnde Aufnahme haben.
const bilder = await seite.evaluate(
  () =>
    new Promise((fertig) => {
      let n = 0;
      const t0 = performance.now();
      const zaehl = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(zaehl);
        else fertig(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(zaehl);
    }),
);
console.log(`Bildrate bei dieser Aufloesung: ${bilder}/s`);

const roh = await seite.evaluate(
  ([sekunden]) =>
    new Promise((fertig) => {
      const c = document.querySelector('canvas');
      const strom = c.captureStream(30);
      const rec = new MediaRecorder(strom, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 40_000_000,
      });
      const teile = [];
      rec.ondataavailable = (e) => e.data.size && teile.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(teile, { type: 'video/webm' });
        const puffer = await blob.arrayBuffer();
        let s = '';
        const b = new Uint8Array(puffer);
        for (let i = 0; i < b.length; i += 0x8000)
          s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        fertig(btoa(s));
      };
      rec.start();
      setTimeout(() => rec.stop(), sekunden * 1000);
    }),
  [DAUER],
);

writeFileSync(ZIEL, Buffer.from(roh, 'base64'));
await seite.evaluate(() => window.__vb.figur(true));
console.log(`FERTIG ${(Buffer.from(roh, 'base64').length / 1e6).toFixed(2)} MB → ${ZIEL}`);
await browser.close();
