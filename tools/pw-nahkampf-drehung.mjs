/**
 * Schnelle Drehungen — kostet die Drehratengrenze ehrliche Treffer?
 * Fast turns: does the server-side turn-rate limit eat honest swings?
 *
 * Seit dem 13.09. fuehrt der Server eine eigene Blickrichtung
 * (WovServer.fuehreBlickNach) und laesst sie je Meldung nur um
 * BLICK_DREHRATE_MAX (15 rad/s) wandern. Das schliesst die Luecke, dass
 * ein Angriffspaket seinen Gierwinkel frei behaupten durfte — und es ist
 * zugleich die Stelle, an der sich die Aenderung anfuehlen kann: Wer sich
 * schneller dreht, als der Server nachfuehrt, schlaegt fuer den Bruchteil
 * einer Sekunde in eine Richtung, die er gerade verlassen hat.
 *
 * Dieses Skript misst genau das, und zwar ueber ECHTE Mausereignisse, die
 * denselben Weg durch den InputManager nehmen wie die Hand des Spielers:
 * Die Figur steht mit dem Ruecken zum Gegner, reisst die Maus herum und
 * klickt. Die Lagen unterscheiden sich nur im Abstand zwischen Riss und
 * Klick:
 *
 *   RISS_SOFORT  Klick unmittelbar nach dem letzten Mausereignis. Der
 *                haerteste Fall, den eine Hand erzeugen kann.
 *   RISS_200MS   Klick 200 ms danach. Der realistische Fall: erst zielen
 *                die Augen, dann faellt der Finger.
 *
 * Gemessen wird ausserdem, wie schnell der Riss ueberhaupt war (Grad je
 * Sekunde, aus dem Gierwinkel des Clients vor und nach dem Riss) — sonst
 * steht am Ende eine Trefferquote ohne die Bewegung, die sie erzeugt hat.
 *
 * Die drei Messfallen sind dieselben wie bei
 * tools/pw-nahkampf-trefferquote.mjs (dort ausfuehrlich): headless
 * messen, Klicks synthetisch mit movementX 0, und die Ausdauer im Auge
 * behalten. Der RISS selbst ist die Ausnahme von der zweiten Regel — dort
 * ist das movementX ja gerade der Messgegenstand.
 *
 * Dazu zwei Lagen mit einem Riss, den keine Hand schafft: RISS_SPRUNG
 * setzt alle Mausereignisse in EINE Aufgabe, der Blick springt also in
 * einem einzigen Bild um 180°. Das ist die Obergrenze dessen, was ueber
 * den Eingabeweg ueberhaupt hereinkommen kann.
 *
 * Aufruf:
 *   node tools/pw-nahkampf-drehung.mjs --url http://localhost:5298
 */
import { chromium } from '/home/mike/node_modules/playwright/index.mjs';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const URL_ZIEL = arg('url', 'http://localhost:5298');
/** Eikthyr: 300 Lebenspunkte — er ueberlebt die ganze Messreihe. */
const KREATUR = arg('kreatur', 'Eikthyr');
/** Schlaege je Lage. Zehn bleiben unter dem Ausdauervorrat (8 je Schlag). */
const SCHLAEGE = Number(arg('schlaege', 10));
/**
 * Dauer des Risses in ms und Zahl der Mausereignisse darin.
 *
 * GEMESSEN (13.09.2026, dieses Skript): sechs Ereignisse ueber ~100 ms
 * kommen im Client als 480–640°/s an — schneller laesst sich eine
 * Zeigerbewegung ueber setTimeout nicht in den Bildtakt bringen, und es
 * ist zugleich die Groessenordnung eines zuegigen Handrisses. Der Server
 * fuehrt mit 860°/s nach (BLICK_DREHRATE_MAX), liegt also darueber.
 * Wer die Grenze wirklich reissen will, braucht RISS_SPRUNG.
 */
const RISS_MS = Number(arg('riss', 100));
const RISS_SCHRITTE = 6;
/** Mausempfindlichkeit des Clients (PlayerController.ts). */
const EMPFINDLICHKEIT = 0.0022;

const testToken = () =>
  `${Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.testlauf`;

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ozone-platform=x11',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 160)));
await page.addInitScript(([t]) => localStorage.setItem('wov-session-token', t), [testToken()]);

const name = `Riss${Date.now().toString(36).slice(-4)}`;
await page.goto(`${URL_ZIEL}/play/?name=${name}&t=0.5`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__dbg?.player && window.__vb?.admin), undefined, {
  timeout: 180_000,
});
await page.waitForFunction(() => window.__dbg?.terrain?.ready === true, undefined, { timeout: 420_000 });
await page.waitForTimeout(4000);

// Treffer zaehlen wie im Trefferquoten-Skript: HitEffect (59), art 1.
await page.evaluate(() => {
  window.__treffer = 0;
  window.__dbg.socket.on(59, (leser) => {
    const v = leser.view;
    if (!v || v.byteLength < 16) return;
    if (v.getInt32(12, true) === 1) window.__treffer++;
  });
});

await page.locator('canvas').first().click({ position: { x: 640, y: 360 } });
await page.waitForTimeout(1500);

const start = await page.evaluate(() => {
  const p = window.__dbg.player.position;
  return { x: p.x, y: p.y, z: p.z };
});
const zielX = start.x;
const zielZ = start.z - 2;
const gesetzt = await page.evaluate(
  ([k, x, z]) => window.__vb.admin(`spawn ${k} ${x} ${z}`),
  [KREATUR, zielX, zielZ]
);
console.log(`${KREATUR} bei ${zielX.toFixed(1)} / ${zielZ.toFixed(1)} — Serverantwort: ${JSON.stringify(gesetzt)}`);
await page.waitForTimeout(2500);

const treffer = () => page.evaluate(() => window.__treffer);
const ausdauer = () => page.evaluate(() => Math.round(window.__dbg.player.ausdauerStand ?? -1));

/** Blick auf einen Punkt richten, ohne die Stelle zu wechseln. */
async function blickAuf(x, z, versatzGrad = 0) {
  await page.evaluate(
    ([zx, zz, versatz]) => {
      const p = window.__dbg.player;
      const yaw = Math.atan2(-(zx - p.position.x), -(zz - p.position.z)) + (versatz * Math.PI) / 180;
      p.debugTeleport(p.position.x, p.position.z, yaw);
    },
    [x, z, versatzGrad]
  );
}

/**
 * Einen Riss um `radiant` fahren — als Folge echter mousemove-Ereignisse
 * mit movementX, wie sie eine bewegte Hand bei gefangener Maus erzeugt.
 * Liefert Gierwinkel vorher/nachher und die gebrauchte Zeit.
 */
async function riss(radiant, rissMs = RISS_MS) {
  return page.evaluate(
    async ([gesamt, schritte, dauer, empf]) => {
      const p = window.__dbg.player;
      const vorher = p.yaw;
      const t0 = performance.now();
      const proSchritt = gesamt / schritte;
      for (let i = 0; i < schritte; i++) {
        document.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            movementX: proSchritt / empf,
            movementY: 0,
          })
        );
        // dauer 0 = alle Ereignisse in EINER Aufgabe, also in einem
        // einzigen Bild: der Blick springt. Schneller kann kein Riss
        // sein, auch keiner von einer echten Hand.
        if (dauer > 0) await new Promise((r) => setTimeout(r, dauer / schritte));
      }
      return { vorher, nachher: p.yaw, ms: performance.now() - t0 };
    },
    [radiant, RISS_SCHRITTE, rissMs, EMPFINDLICHKEIT]
  );
}

async function klick() {
  await page.evaluate(() => {
    const opt = { button: 0, buttons: 1, bubbles: true, movementX: 0, movementY: 0 };
    document.dispatchEvent(new MouseEvent('mousedown', opt));
    document.dispatchEvent(new MouseEvent('mouseup', { ...opt, buttons: 0 }));
  });
}

const ergebnisse = [];

/**
 * Eine Lage: `SCHLAEGE` mal mit dem Ruecken zum Gegner anfangen,
 * herumreissen, nach `wartenMs` klicken.
 */
async function lage(label, wartenMs, rissMs = RISS_MS) {
  await page.waitForTimeout(11_000); // Ausdauer voll auffuellen
  const vor = await treffer();
  const raten = [];
  let leer = 0;
  for (let i = 0; i < SCHLAEGE; i++) {
    // Mit dem Ruecken zum Gegner anfangen — und dem Server Zeit lassen,
    // diese Richtung zu uebernehmen. Sonst misst die Lage nicht den
    // Riss, sondern den Rest der vorigen Drehung.
    await blickAuf(zielX, zielZ, 180);
    await page.waitForTimeout(500);
    const r = await riss(-Math.PI, rissMs);
    // Aus dem TATSAECHLICHEN Gierwinkel vor/nach dem Riss, nicht aus dem
    // bestellten Winkel — ein verschlucktes Mausereignis faellt sonst nie
    // auf. Bei einem Sprung in einem Bild ist die Zeit ~0; dann steht
    // hier keine Zahl, sondern "Sprung".
    const gedreht = Math.abs(((r.nachher - r.vorher + Math.PI) % (2 * Math.PI)) - Math.PI);
    raten.push(r.ms > 1 ? (gedreht * 180) / Math.PI / (r.ms / 1000) : Infinity);
    if (wartenMs) await page.waitForTimeout(wartenMs);
    if ((await ausdauer()) < 8) leer++;
    else await klick();
    await page.waitForTimeout(900);
  }
  const getroffen = (await treffer()) - vor;
  const schlaege = SCHLAEGE - leer;
  const roh = raten.reduce((a, b) => a + b, 0) / raten.length;
  const schnitt = Number.isFinite(roh) ? Math.round(roh) : 'Sprung (ein Bild)';
  ergebnisse.push({
    label,
    'Klick nach': `${wartenMs} ms`,
    'Riss (Grad/s)': schnitt,
    schlaege,
    treffer: getroffen,
    quote: `${Math.round((getroffen / schlaege) * 100)} %`,
  });
  console.log(`    ${label}: ${getroffen}/${schlaege} — Riss im Schnitt ${schnitt}°/s`);
}

console.log('\n[1] RISS_SOFORT — 180° herumreissen, sofort klicken:');
await lage('RISS_SOFORT', 0);
console.log('\n[2] RISS_200MS — 180° herumreissen, nach 200 ms klicken:');
await lage('RISS_200MS', 200);

console.log('\n[3] RISS_SPRUNG — 180° in EINEM Bild, sofort klicken:');
await lage('RISS_SPRUNG', 0, 0);
console.log('\n[4] RISS_SPRUNG_200MS — 180° in einem Bild, nach 200 ms klicken:');
await lage('RISS_SPRUNG_200MS', 200, 0);

console.log('\n=== Schnelle Drehungen ===');
console.table(ergebnisse);
await browser.close();
