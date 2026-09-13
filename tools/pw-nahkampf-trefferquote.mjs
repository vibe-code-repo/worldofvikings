/**
 * Nahkampf-Trefferquote — fuehlen sich normale Schlaege richtig an?
 * Melee hit rate probe: does an honest swing still land?
 *
 * Paket 0.3 hat den Nahkampf enger gemacht: Reichweite 3,5 m statt 8 m,
 * Trefferkegel ±60° um die gemeldete Blickrichtung, und die Zielsuche
 * haengt an der SERVER-Position statt an der vom Client gemeldeten. Jede
 * dieser drei Regeln kann ehrliche Schlaege verschlucken, und keine davon
 * meldet sich dabei — der Schlag geht einfach ins Leere. Ein Test ohne
 * Browser kann das nicht sehen: Er schickt die Pakete selbst und misst
 * damit seine eigene Annahme darueber, was der Client meldet.
 *
 * Dieses Skript spielt. Es faengt die Maus, klickt mit der linken Taste,
 * laesst die Dreierkombo im AvatarRig laufen und zaehlt die Treffer am
 * HitEffect-Paket (Typ 59, art 1 = Fleisch), das der Server nach jedem
 * Treffer an alle im Umkreis schickt. Kein Eingriff in den Servercode.
 *
 * Vier Lagen — drei muessen treffen, eine darf NICHT:
 *   FRONTAL       stehend, Ziel 2 m vorn. Der Normalfall.
 *   KOMBO_SCHWENK Ziel wandert waehrend der Kombo von −55° bis +55° um
 *                 den Spieler. Der Kegel darf die Kette nicht auf halber
 *                 Strecke abwuergen; `letzterHieb` bezeugt, dass sie laeuft.
 *   SCHRAEG_45    45° neben dem Ziel gezielt — noch im Kegel.
 *   RUECKEN       180° weggedreht. GEGENPROBE: Quote muss 0 sein, sonst
 *                 misst das Skript den Kegel gar nicht.
 *
 * Voraussetzungen:
 *  • Spielserver und Client laufen (s. docs/, `--url` zeigt auf den Client).
 *  • Der Testcharakter braucht ADMINRECHTE fuer `spawn` — entweder
 *    `players.everyone-admin: true` in server/data/server.yml oder ein
 *    Charakter auf der Adminliste.
 *
 * Zwei Fallen, beide gemessen (13.09.2026), beide kosten sonst still die
 * ganze Messung:
 *  • HEADLESS. Ein sichtbares Chromium-Fenster wird vom Compositor auf
 *    genau 1 rAF/s gedrosselt (auch bei visibilityState 'visible' und
 *    --disable-backgrounding-occluded-windows). Der Client rechnet dann
 *    gegen seinen dt-Deckel von 0,1 s und laeuft dem Server scheinbar
 *    fuenf Meter hinterher. Headless mit denselben ANGLE-Flags: ~50 fps.
 *  • SYNTHETISCHE Klicks. Bei gefangener Maus traegt jedes echte
 *    Playwright-Mausereignis ein movementX, und der InputManager addiert
 *    das auf den Gierwinkel — die Figur dreht sich waehrend des Messens
 *    im Kreis. Ein document-Ereignis mit movementX 0 nimmt denselben Weg
 *    durch den InputManager, ohne den Blick zu verreissen.
 *
 * Aufruf:
 *   node tools/pw-nahkampf-trefferquote.mjs --url http://localhost:5295
 */
import { chromium } from '/home/mike/node_modules/playwright/index.mjs';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const URL_ZIEL = arg('url', 'http://localhost:5295');
/*
  Eikthyr, nicht Boar: 300 Lebenspunkte (shared/src/leben.ts) gegen 30.
  Mit der Faust (4 Schaden) war der Boar nach acht Treffern tot, und der
  Rest des Laufs schlug ins Leere — der erste Messlauf las das als
  "Trefferquote 27 %". Ein Ziel, das die Messreihe ueberlebt, ist
  Bedingung, nicht Bequemlichkeit.
*/
const KREATUR = arg('kreatur', 'Eikthyr');
/**
 * Klicktakt. 700 ms ist LANGSAMER als beides, was einen Schlag unterwegs
 * verwirft: der Client-Takt (ANGRIFF_TAKT 0,5 s) und die Server-Drossel
 * (Fuellzeit 350 ms). Und kuerzer als das Kombo-Fenster (Restzeit des
 * Hiebs + 0,6 s) — die Dreierkette laeuft also durch.
 */
const TAKT_MS = Number(arg('takt', 700));

/**
 * Schlaege je Salve, und die Pause danach.
 *
 * Die AUSDAUER setzt die Grenze, nicht der Takt: Ein Schlag kostet 8
 * Punkte (SCHLAG_AUSDAUER), der Vorrat ist 100, und nachgefuellt wird
 * erst nach 1,5 s Ruhe mit 14 Punkten je Sekunde
 * (shared/src/bewegung/ausdauer.ts). Wer im 700-ms-Takt durchklickt, ist
 * nach zwoelf Schlaegen leer — und `handleAttack` verwirft dann JEDEN
 * weiteren Klick, bevor er ueberhaupt ein Ziel sucht. Ein erster Lauf
 * las genau das als "Trefferquote 70 %", obwohl kein einziger
 * ausgefuehrter Schlag danebenging.
 *
 * Zehn Schlaege je Salve bleiben unter den zwoelf; zehn Sekunden Pause
 * fuellen den Vorrat wieder ganz auf (1,5 s Ruhe + 80/14 s).
 */
const SALVE = 10;
const PAUSE_MS = 10_000;

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

const name = `Hieb${Date.now().toString(36).slice(-4)}`;
await page.goto(`${URL_ZIEL}/play/?name=${name}&t=0.5`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__dbg?.player && window.__vb?.admin), undefined, {
  timeout: 180_000,
});
// WARTEN, bis das Gelaende steht — nicht "hoechstens warten". Vor
// terrain.ready haelt der Gelaendestrom den Hauptthread und der Client
// laeuft bei 1 fps; auf dieser Maschine dauert der Aufbau ~3 Minuten.
await page.waitForFunction(() => window.__dbg?.terrain?.ready === true, undefined, { timeout: 420_000 });
await page.waitForTimeout(4000);

/*
  Treffer zaehlen: HitEffect (Typ 59), art 1 = Fleisch. Der Server
  schickt das Paket nach JEDEM Treffer an eine Kreatur; art 0 (Holz,
  Stein) und art 2 (Parade) zaehlen hier nicht mit.

  Gelesen wird ueber feste Versaetze in der DataView, nicht mit
  `leser.readVector3()`: Alle Handler eines Pakettyps teilen sich EINEN
  BinaryReader (GameSocket.handlePacket), und der Anzeige-Handler des
  Clients ist vor diesem hier registriert — er hat den Lesezeiger dann
  schon ans Ende geschoben. Ein zweiter sequenzieller Leser liefe ins
  Leere. Die Nutzlast ist Vector3 (12 Byte) + Int32 art.
*/
await page.evaluate(() => {
  window.__treffer = 0;
  window.__dbg.socket.on(59, (leser) => {
    const v = leser.view;
    if (!v || v.byteLength < 16) return;
    if (v.getInt32(12, true) === 1) window.__treffer++;
  });
});

// Mausfang ZUERST: Der Fangklick addiert sein Zeigerdelta auf den
// Gierwinkel. Wer den Blick vorher setzt, misst hinterher eine andere
// Richtung, als er gesetzt hat.
await page.locator('canvas').first().click({ position: { x: 640, y: 360 } });
await page.waitForTimeout(1500);

const start = await page.evaluate(() => {
  const p = window.__dbg.player.position;
  return { x: p.x, y: p.y, z: p.z };
});
const zielX = start.x;
const zielZ = start.z - 2; // 2 m in Blickrichtung yaw 0 (= −Z)
const gesetzt = await page.evaluate(
  ([k, x, z]) => window.__vb.admin(`spawn ${k} ${x} ${z}`),
  [KREATUR, zielX, zielZ]
);
await page.waitForTimeout(2500);
console.log(`${KREATUR} bei ${zielX.toFixed(1)} / ${zielZ.toFixed(1)} — Serverantwort: ${JSON.stringify(gesetzt)}`);

/** Blick auf einen Punkt richten, ohne die Stelle zu wechseln. */
async function blickAuf(x, z, versatzGrad = 0) {
  await page.evaluate(
    ([zx, zz, versatz]) => {
      const p = window.__dbg.player;
      // Umkehrung der Client-Basis forward = (−sin yaw, −cos yaw).
      const yaw = Math.atan2(-(zx - p.position.x), -(zz - p.position.z)) + (versatz * Math.PI) / 180;
      p.debugTeleport(p.position.x, p.position.z, yaw);
    },
    [x, z, versatzGrad]
  );
}

/**
 * Klicks, die der Server mangels Ausdauer verworfen hat — sie sind kein
 * Fehlschlag und duerfen die Quote nicht verderben. Gezaehlt wird an der
 * Ausdauer, die der Client vom Server gemeldet bekommt (PlayerState).
 */
let leer = 0;

async function klicken(anzahl, zwischenschritt = null) {
  for (let i = 0; i < anzahl; i++) {
    if (i > 0 && i % SALVE === 0) await page.waitForTimeout(PAUSE_MS); // Ausdauer
    if ((await ausdauer()) < 8) leer++;
    if (zwischenschritt) await zwischenschritt(i);
    await page.evaluate(() => {
      const opt = { button: 0, buttons: 1, bubbles: true, movementX: 0, movementY: 0 };
      document.dispatchEvent(new MouseEvent('mousedown', opt));
      document.dispatchEvent(new MouseEvent('mouseup', { ...opt, buttons: 0 }));
    });
    await page.waitForTimeout(TAKT_MS);
  }
  await page.waitForTimeout(800);
}

const ergebnisse = [];
const treffer = () => page.evaluate(() => window.__treffer);
const gier = () => page.evaluate(() => +window.__dbg.player.yaw.toFixed(3));

const ausdauer = () => page.evaluate(() => Math.round(window.__dbg.player.ausdauerStand ?? -1));

async function lage(label, klicks, erwartet, zwischenschritt = null) {
  // Erst auffuellen. Ohne diese Pause startet jede Lage mit dem Rest der
  // vorigen, und die fehlenden Schlaege sehen aus wie Fehlschlaege.
  await page.waitForTimeout(PAUSE_MS);
  const vor = await treffer();
  const gierVor = await gier();
  leer = 0;
  await klicken(klicks, zwischenschritt);
  const getroffen = (await treffer()) - vor;
  const quote = getroffen / (klicks - leer);
  if (leer) console.log(`    (${leer} Klicks ohne Ausdauer — zaehlen nicht als Schlag)`);
  const ok = erwartet === 'trifft' ? quote === 1 : getroffen === 0;
  ergebnisse.push({
    label,
    schlaege: klicks - leer,
    treffer: getroffen,
    quote: `${(quote * 100).toFixed(0)} %`,
    erwartet,
    ok,
  });
  console.log(
    `    ${label}: ${getroffen}/${klicks - leer} (${(quote * 100).toFixed(0)} %), Gierwinkel ${gierVor} → ${await gier()}`
  );
}

console.log('\n[1] FRONTAL — stehend, Ziel 2 m vorn:');
await blickAuf(zielX, zielZ);
await page.waitForTimeout(600);
await lage('FRONTAL', 20, 'trifft');

/*
  [2] Der Kegel darf eine laufende Dreierkombo nicht auf halber Strecke
  abwuergen. Nachgebildet wird der Fall, der das ausloesen wuerde: Die
  Kreatur wandert waehrend der Kette um den Spieler, er dreht mit — von
  Hieb zu Hieb steht sie in einem anderen Winkel, hier durchgeschwenkt
  von −55° bis +55°, also bis dicht an den Rand des Kegels (±60°).

  Nicht per Strafe-Taste: Ein erster Versuch lief mit KeyD/KeyA um das
  Ziel herum und verlor die Kreatur dabei ganz aus dem Umkreis — gemessen
  war dann die Reichweite, nicht der Winkel. Der Blick allein reicht;
  was der Server prueft, ist der Winkel, nicht wie er zustande kam.
*/
console.log('\n[2] KOMBO_SCHWENK — Ziel schwenkt waehrend der Kombo um den Spieler:');
const hiebe = [];
await lage('KOMBO_SCHWENK', 20, 'trifft', async (i) => {
  await blickAuf(zielX, zielZ, -55 + (110 * (i % 10)) / 9);
  hiebe.push(await page.evaluate(() => window.__dbg.player.avatar.letzterHieb));
});
// Zeuge: Bliebe `letzterHieb` stehen, waere hier 24-mal derselbe
// Einzelhieb gemessen worden und von der Kombo keine Rede.
console.log(`    Hiebfolge: ${hiebe.slice(0, 12).join('')}… (${new Set(hiebe).size} verschiedene Hiebe)`);

console.log('\n[3] SCHRAEG_45 — 45° am Ziel vorbei gezielt (noch im Kegel):');
await blickAuf(zielX, zielZ, 45);
await page.waitForTimeout(600);
await lage('SCHRAEG_45', 20, 'trifft');

console.log('\n[4] RUECKEN — 180° weggedreht (Gegenprobe):');
await blickAuf(zielX, zielZ, 180);
await page.waitForTimeout(600);
await lage('RUECKEN', 20, 'trifft nicht');

console.log('\n=== Trefferquote ===');
console.table(ergebnisse);
const schlecht = ergebnisse.filter((e) => !e.ok);
console.log(
  schlecht.length === 0
    ? 'ALLE LAGEN WIE ERWARTET'
    : `ABWEICHUNG: ${schlecht.map((e) => e.label).join(', ')}`
);
await browser.close();
process.exit(schlecht.length === 0 ? 0 : 1);
