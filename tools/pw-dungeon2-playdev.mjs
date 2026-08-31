#!/usr/bin/env node
/**
 * Beweisbilder des Vollausbaus auf play.dev — mit einem eigenen
 * Testcharakter, in `steingrab-2` und `steingrab-dunkel`.
 * Proof shots of the full build on play.dev, with an own test character.
 *
 *   node tools/pw-dungeon2-playdev.mjs
 *
 * ── Testcharakter, kein Konto, kein Passwort ──────────────────────────
 * Der Client prueft an einem Sitzungstoken nur die FORM und das Ablaufdatum
 * (die Signatur kann er nicht pruefen, das Geheimnis liegt im Server). Ein
 * formgerechtes, nicht abgelaufenes, aber ungueltig signiertes Token passiert
 * diese Weiche — und der Server wuerfelt daraufhin eine FRISCHE Identitaet
 * (`NetManager`, F3). Der Name kommt aus `?name=`. Es wird also kein Konto
 * angelegt und kein Passwort eingegeben.
 * The client only checks the FORM and the expiry of a session token; a
 * well-formed but invalidly signed token passes, and the server then draws a
 * FRESH identity. No account is created and no password is typed.
 *
 * ── Zwei Fallen aus dem Lauf vom 31.08.2026, beide wiederkehrend ──────
 * 1. Basic-Auth NICHT in die Adresse einbetten, sondern ueber Playwrights
 *    `httpCredentials`: Eingebettete Zugangsdaten vererben sich auf Vites
 *    `/@fs/`-Adressen, und `fetch` verweigert eine URL mit Zugangsdaten —
 *    Folge waere ein Grab ohne Havok, also ohne Kollision.
 * 2. Je Lauf ein EIGENER Name. Zweimal derselbe, waehrend der vorige Peer
 *    noch haengt, heisst „Name already in use", und der Lauf stirbt in einem
 *    Timeout, der nach einem kaputten Client aussieht.
 *
 * Mikes Charakter und `steingrab-7` werden nicht angefasst.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-tripo-test`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';

const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/** Formgerechtes, nicht abgelaufenes, ungueltig signiertes Token (s. Kopf). */
function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

/**
 * Die Aufnahmen. `stufe` ist der Wert des Reglers „Dungeon-Grafik"
 * (0/1/2) — gesetzt in den GESPEICHERTEN Einstellungen, also auf genau dem
 * Weg, den der Spieler nimmt.
 * The shots. `stufe` is the value of the "dungeon graphics" control, written
 * into the STORED settings, i.e. exactly the player's path.
 */
const AUFNAHMEN = [
  { datei: 'dungeon2-voll-gang.png', dungeon: 'steingrab-2', stufe: 2 },
  { datei: 'dungeon2-voll-dunkel.png', dungeon: 'steingrab-dunkel', stufe: 2 },
  { datei: 'dungeon2-voll-vergleich-mittel.png', dungeon: 'steingrab-2', stufe: 1 },
  { datei: 'dungeon2-voll-vergleich-hoch.png', dungeon: 'steingrab-2', stufe: 2 },
];

async function eineAufnahme(browser, aufnahme, lauf) {
  const kontext = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    httpCredentials: { username: BENUTZER, password: PASSWORT },
  });
  const seite = await kontext.newPage();
  const konsole = [];
  seite.on('console', (m) => {
    if (m.type() === 'error') konsole.push(m.text());
  });
  seite.on('pageerror', (f) => konsole.push(String(f)));

  await seite.addInitScript(
    ([token, stufe]) => {
      localStorage.setItem('wov-session-token', token);
      const key = 'valheim-babylon-settings-v1';
      let stand = {};
      try {
        stand = JSON.parse(localStorage.getItem(key) ?? '{}');
      } catch {
        stand = {};
      }
      stand.dungeonQuality = stufe;
      localStorage.setItem(key, JSON.stringify(stand));
    },
    [testToken(), aufnahme.stufe]
  );

  const name = `Pruefer${lauf}${Date.now().toString(36).slice(-4)}`;
  await seite.goto(`${HOST}/?name=${name}&dungeon=${aufnahme.dungeon}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });

  await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, {
    timeout: 240_000,
  });
  await seite.waitForFunction(
    () => window.__dbg?.dungeon2?.bereit === true,
    undefined,
    { timeout: 180_000 }
  );
  // Vollstaendig bauen lassen UND die Deko abwarten: Ein Beweisbild, auf dem
  // die Haelfte der Bloecke noch fehlt, beweist die halbe Sache.
  // Let it finish AND wait for the decor: a proof shot with half the blocks
  // missing proves half the thing.
  await seite.waitForTimeout(12_000);

  // Die Kamera auf den naechsten Lichtschacht ausrichten — das ist die
  // Stelle, an der Godrays ueberhaupt etwas zu zeigen haben. Ohne diese
  // Ausrichtung fotografiert man einen Gang und nennt ihn „Godrays".
  // Aim at the nearest shaft: without it one photographs a corridor and calls
  // it godrays.
  const blick = await seite.evaluate(() => {
    const inst = window.__dbg.dungeon2;
    const kamera = window.__dbg.scene.activeCamera;
    const p = window.__dbg.player;
    const wo = p?.position ?? kamera.position;
    const schaechte = inst.bauer.lichtschaechte.filter((l) => l.art === 'schacht');
    if (schaechte.length === 0) return null;
    let beste = schaechte[0];
    let bestQ = Infinity;
    for (const l of schaechte) {
      const q = (l.mitte.x - wo.x) ** 2 + (l.mitte.z - wo.z) ** 2;
      if (q < bestQ) {
        bestQ = q;
        beste = l;
      }
    }
    return { mitte: beste.mitte, boden: beste.boden, entfernung: Math.sqrt(bestQ) };
  });

  // Vom Eingang aus HINEINGEHEN — mit echten Tastendruecken.
  //
  // Warum nicht teleportieren: `teleportTo()` setzt zwar `position`, aber der
  // Havok-Charakterkoerper zieht sie im naechsten Bild wieder zurueck (gemessen:
  // nach `teleportTo(-22, 0.05, -14)` stand die Figur unveraendert auf (2, 2)).
  // Der Blickwinkel dagegen laesst sich setzen und bleibt.
  // Warum ueberhaupt: Der Spawnpunkt schaut auf die Eingangswand, und der
  // Ausleger der Verfolgerkamera steckt dort im Mauerwerk. Ein Beweisbild von
  // dieser Stelle zeigt eine Wand aus zwanzig Zentimetern Abstand.
  // Walk IN from the entrance with real key presses: `teleportTo()` sets
  // `position`, but the Havok character controller pulls it back the next
  // frame (measured). The view angle can be set and sticks.
  await seite.evaluate(() => {
    const p = window.__dbg.player;
    // Blickrichtung 0 heisst HINEIN. Der erste Versuch nahm Math.PI, weil die
    // Figur am Spawnpunkt vor einer Wand zu stehen schien — das war die Wand
    // HINTER der Verfolgerkamera. Mit Math.PI lief die Figur zum Eingang
    // hinaus und stand nach sieben Sekunden unter dem Sternenhimmel; das Bild
    // hiess „dungeon2-voll-gang" und zeigte eine Wiese.
    // Yaw 0 means INWARD: the first attempt used Math.PI because the figure
    // seemed to face a wall at spawn — that was the wall BEHIND the chase
    // camera. With Math.PI it walked out of the entrance and stood under the
    // night sky, in a picture named "corridor".
    p._yaw = 0;
    p._figurYaw = 0;
    p._pitch = -0.12;
  });
  await seite.mouse.click(800, 450);
  await seite.keyboard.down('KeyW');
  await seite.waitForTimeout(7000);
  await seite.keyboard.up('KeyW');
  await seite.waitForTimeout(1500);
  const wo = await seite.evaluate(() => {
    const p = window.__dbg.player;
    return { x: Math.round(p.position.x * 10) / 10, z: Math.round(p.position.z * 10) / 10 };
  });

  const werte = await seite.evaluate(() => window.__dbg.dungeon2?.atmosphaereWerte ?? null);
  const stat = await seite.evaluate(() => window.__dbg.dungeon2?.bauer?.statistik?.() ?? null);

  mkdirSync(ORDNER, { recursive: true });
  await seite.screenshot({ path: `${ORDNER}/${aufnahme.datei}` });
  console.log(`${aufnahme.datei}: ${aufnahme.dungeon}, Stufe ${aufnahme.stufe}, Name ${name}`);
  console.log(`  Schacht: ${blick === null ? 'keiner' : JSON.stringify(blick)} — gelaufen bis ${JSON.stringify(wo)}`);
  console.log(`  Effekte: ${JSON.stringify(werte)}`);
  console.log(`  Bau: ${JSON.stringify(stat)}`);
  if (konsole.length > 0) console.log(`  Konsolenfehler: ${konsole.length} (erste: ${konsole[0]})`);

  await kontext.close();
  return { werte, blick, konsole: konsole.length };
}

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
try {
  let i = 0;
  for (const a of AUFNAHMEN) {
    i += 1;
    await eineAufnahme(browser, a, i);
  }
} finally {
  await browser.close();
}
