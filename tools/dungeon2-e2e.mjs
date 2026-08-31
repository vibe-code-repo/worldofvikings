#!/usr/bin/env node
/**
 * Ende-zu-Ende-Lauf des Dungeon-Generators 2.0 (AP13) — EIGENER Spielserver,
 * EIGENER Vite, echter Spielclient in Chromium, und am Ende ein Bild.
 * End-to-end run of dungeon generator 2.0 — OWN game server, OWN Vite, a real
 * game client in Chromium, and a screenshot at the end.
 *
 *   node tools/dungeon2-e2e.mjs [--sichtbar] [--bild <pfad>]
 *
 * ── Was der Lauf beweist ──────────────────────────────────────────────
 * Dass die Kette traegt: Server erzeugt das Layout aus Thema und Seeds,
 * materialisiert nur das Interaktive, schickt den DESKRIPTOR (nie Geometrie),
 * der Client erzeugt daraus DASSELBE Layout, baut es, laesst den
 * Ladebildschirm fallen, taut die Figur auf — und sie laeuft.
 *
 * ── Zwei Dinge, die dieser Lauf ausdruecklich NICHT anfasst ───────────
 * 1. `wov-dev`. Der Server hier laeuft auf DIESER Maschine, in einem eigenen
 *    Weltverzeichnis unter /tmp, und wird am Ende wieder abgeraeumt.
 * 2. Die Ports des DEV-Standes. Der Spielserver laeuft auf 2477 statt 2467,
 *    Vite auf 5299 statt 5274 (`WOV_SPIEL_PORT`/`WOV_CLIENT_PORT`).
 *
 * ── Die Anmeldeschranke ───────────────────────────────────────────────
 * Der Client leitet ohne Sitzung auf die Webseite um (`main.ts`, „Online play
 * is account-only"). Ein hinterlegtes Sitzungs-Token schaltet diese Weiche um.
 * Es muss NICHT gueltig sein: Ein Token, das die Pruefung nicht besteht, fuehrt
 * serverseitig zu einer frisch gewuerfelten Identitaet statt zu einer
 * Ablehnung (`NetManager.handlePasswordAuth`, F3). Es wird hier also kein
 * Konto angelegt und kein Passwort eingegeben — es wird nur die Weiche
 * gestellt.
 * The client redirects to the website without a session. A stored session
 * token flips that switch. It need NOT be valid: a token failing the check
 * yields a freshly drawn server-side identity rather than a rejection. No
 * account is created and no password is entered here.
 *
 * ── Die GPU ───────────────────────────────────────────────────────────
 * Mit ANGLE/Vulkan-Flags, nicht mit SwiftShader (Vault: „Headless Chromium
 * braucht die GPU"). Der Lauf meldet den Renderer-String; steht dort
 * SwiftShader, sind die gemessenen Zeiten die einer Software-Rasterisierung
 * und nicht die des Spiels.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(WURZEL, 'node_modules/.bin/tsx');

const SPIEL_PORT = 2477;
const CLIENT_PORT = 5299;
const DUNGEON_ID = 'steingrab-live';
const THEMA = 'steingrab';
const SEED = 4242;

const argv = process.argv.slice(2);
const SICHTBAR = argv.includes('--sichtbar');
const BILD =
  argv.includes('--bild')
    ? argv[argv.indexOf('--bild') + 1]
    : `${process.env.HOME}/.cache/wov-tripo-test/dungeon2-ingame.png`;

/**
 * ANGLE/Vulkan statt SwiftShader. Ohne diese Flags rendert headless
 * Chromium in Software, und der Geländestrom verhungert am Zeitbudget.
 * ANGLE/Vulkan instead of SwiftShader.
 */
const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

const TMP = mkdtempSync(join(tmpdir(), 'wov-dg2-e2e-'));

/**
 * Die gestarteten Kindprozesse. Auf Modulebene, damit `finally` sie auch dann
 * abraeumt, wenn `main()` mit einer Ausnahme abbricht — ein zurueckgelassener
 * Spielserver haelt den Port und der naechste Lauf scheitert an EADDRINUSE,
 * ohne dass man den Zusammenhang sieht.
 * The started child processes, at module scope so `finally` cleans them up
 * even when `main()` throws — a left-behind game server holds the port.
 */
const kinder = [];

/** Ein Kindprozess mit gesammelter Ausgabe. / A child process with logs. */
function starte(name, cmd, args, umgebung, verzeichnis = WURZEL) {
  const kind = spawn(cmd, args, {
    cwd: verzeichnis,
    env: { ...process.env, ...umgebung },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const zeilen = [];
  const sammle = (puffer) => {
    for (const z of puffer.toString().split('\n')) {
      if (!z.trim()) continue;
      zeilen.push(z);
      if (process.env.DG2_LAUT) console.log(`[${name}] ${z}`);
    }
  };
  kind.stdout.on('data', sammle);
  kind.stderr.on('data', sammle);
  kinder.push(kind);
  return { kind, zeilen };
}

/** Auf eine Zeile in der Ausgabe warten. / Wait for a line in the output. */
function warteAufZeile(prozess, muster, sekunden = 90) {
  return new Promise((auf, ab) => {
    const bis = Date.now() + sekunden * 1000;
    const takt = setInterval(() => {
      const treffer = prozess.zeilen.find((z) => muster.test(z));
      if (treffer) {
        clearInterval(takt);
        auf(treffer);
      } else if (Date.now() > bis) {
        clearInterval(takt);
        ab(new Error(`Zeitüberschreitung beim Warten auf ${muster}\n${prozess.zeilen.slice(-25).join('\n')}`));
      }
    }, 250);
  });
}

const messwerte = {};
const fehler = [];

async function main() {
  mkdirSync(dirname(BILD), { recursive: true });

  // ── 1. Der Server ───────────────────────────────────────────────────
  // Über ein winziges Startskript statt `server/src/main.ts`: So bekommt der
  // Lauf ein eigenes Weltverzeichnis und einen eigenen Port, ohne
  // `server/data/server.yml` anzufassen — die Datei gehört dem DEV-Stand.
  // Via a tiny launcher instead of `server/src/main.ts`, so the run gets its
  // own world directory and port without touching `server/data/server.yml`.
  const starterPfad = join(TMP, 'starte-server.mts');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    starterPfad,
    `import { randomBytes } from 'node:crypto';
import { createWovServer } from ${JSON.stringify(resolve(WURZEL, 'server/src/WovServer.ts'))};
import { spielerIdErzeugen, tokenAusstellen } from ${JSON.stringify(resolve(WURZEL, 'server/src/net/Identitaet.ts'))};

// Das Sitzungsgeheimnis wird HIER gewuerfelt und in den Server gereicht,
// damit derselbe Prozess ein GUELTIGES Token ausstellen kann. Ein
// zurechtgebasteltes Token taete es auch (der Server vergibt dann eine frische
// Identitaet), aber dann pruefte der Lauf einen Rueckfallpfad statt des Wegs,
// den ein Spieler geht.
// The session secret is drawn HERE and handed into the server so the same
// process can issue a VALID token — otherwise the run would exercise a
// fallback path instead of the path a player takes.
const geheimnis = randomBytes(32);
const server = createWovServer({
  port: ${SPIEL_PORT},
  worldsDir: ${JSON.stringify(join(TMP, 'worlds'))},
  saveIntervalMs: 3600000,
  sessionSecret: geheimnis,
});
server.start();
const doc = server.dungeons.erzeugeDungeon2(
  ${JSON.stringify(THEMA)},
  { architektur: ${SEED}, material: 77, deko: 99 },
  ${JSON.stringify(DUNGEON_ID)}
);
const spielerId = spielerIdErzeugen();
const token = tokenAusstellen(spielerId, 1234567n, geheimnis);
console.log('[e2e] Dokument: ' + JSON.stringify(doc));
console.log('[e2e] Token: ' + token);
console.log('[e2e] BEREIT');
`
  );

  const server = starte('server', TSX, [starterPfad], {});
  await warteAufZeile(server, /\[e2e\] BEREIT/, 120);
  const dokZeile = server.zeilen.find((z) => z.startsWith('[e2e] Dokument: '));
  const dokument = JSON.parse(dokZeile.slice('[e2e] Dokument: '.length));
  console.log(
    `Server auf ${SPIEL_PORT}. Dokument '${dokument.id}': Thema ${dokument.thema}, ` +
      `Seeds ${dokument.seeds.architektur}/${dokument.seeds.material}/${dokument.seeds.deko}, ` +
      `Prüfsumme ${dokument.pruefsumme}, Layoutversion ${dokument.layoutVersion}`
  );
  messwerte.dokument = dokument;
  const tokenZeile = server.zeilen.find((z) => z.startsWith('[e2e] Token: '));
  const token = tokenZeile.slice('[e2e] Token: '.length).trim();

  // ── 2. Der Client-Dev-Server ────────────────────────────────────────
  // IM `client/`-Verzeichnis starten, nicht in der Wurzel: `vite.config.ts`
  // sagt `root: '.'`, und aus der Wurzel heraus fände Vite die `index.html`
  // nicht — die Seite lädt dann leer, mit genau einem 404 und ohne jeden
  // Hinweis darauf, was fehlt.
  // Start INSIDE `client/`: the config says `root: '.'`, and from the repo
  // root Vite would not find `index.html` — the page loads empty with exactly
  // one 404 and no hint as to what is missing.
  const vite = starte(
    'vite',
    resolve(WURZEL, 'node_modules/.bin/vite'),
    ['--port', String(CLIENT_PORT)],
    { WOV_SPIEL_PORT: String(SPIEL_PORT), WOV_CLIENT_PORT: String(CLIENT_PORT) },
    resolve(WURZEL, 'client')
  );
  await warteAufZeile(vite, /Local:|localhost:/, 120);
  console.log(`Vite auf ${CLIENT_PORT}.`);

  // ── 3. Der Browser ──────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: !SICHTBAR, args: GPU_FLAGS });
  const seite = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const konsole = [];
  const seitenFehler = [];
  const t0 = Date.now();
  seite.on('console', (m) => {
    const text = `${((Date.now() - t0) / 1000).toFixed(1)}s ${m.type()}: ${m.text()}`;
    konsole.push(text);
    if (process.env.DG2_LAUT) console.log(`[browser] ${text}`);
  });
  seite.on('pageerror', (e) => seitenFehler.push(String(e)));
  // Wegnavigieren ist der Fehler, den man sonst erst am leeren Bild sieht.
  // Navigating away is the failure one otherwise only sees on an empty image.
  seite.on('framenavigated', (f) => {
    if (f === seite.mainFrame()) console.log(`[navigation] ${f.url()}`);
  });
  seite.on('requestfailed', (r) => {
    // Abbrüche durch das Verlassen der Seite zählen nicht.
    // Aborts caused by leaving the page do not count.
    const grund = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(grund)) konsole.push(`requestfailed: ${r.url()} ${grund}`);
  });

  // Die Anmelde-Weiche stellen (s. Kopfkommentar) und den Dungeon-Wunsch
  // gleich mit hinterlegen. / Flip the login switch.
  await seite.addInitScript((t) => {
    localStorage.setItem('wov-session-token', t);
  }, token);

  // OHNE `?dungeon=`. Der Auto-Sprung dort wartet auf `terrain.ready`
  // (`main.ts`, PlayerState) — richtig so, aber in einer frisch erzeugten
  // Radialwelt dauert das Gelände beliebig lange, und der Lauf misst dann
  // die Oberwelt statt den Dungeon. Betreten wird deshalb wie von Hand:
  // über den Admin-Befehl, denselben, den Taste E im Spiel schickt. Das ist
  // zugleich der schärfere Fall — hier steht der Ladebildschirm beim
  // Betreten NOCH, und nur `Dungeon2Instanz` kann ihn fallen lassen.
  // WITHOUT `?dungeon=`: the auto-jump waits for `terrain.ready`, which in a
  // freshly generated radial world takes arbitrarily long. Entering happens
  // like by hand — via the admin command, the same one key E sends. That is
  // also the sharper case: the loading screen is STILL up here.
  const url = `http://localhost:${CLIENT_PORT}/?lang=de`;

  /**
   * Laden und verbinden — mit Wiederholung.
   *
   * Warum eine Wiederholung noetig ist: Der Client gibt nach drei
   * Verbindungsversuchen auf und schickt zur Anmeldung auf der Webseite
   * (`main.ts`, `onDisconnected`). Trifft der erste Versuch den Vite-Proxy,
   * bevor dessen WebSocket-Weiterleitung steht, ist der Client damit
   * unwiderruflich weg — nicht weil etwas kaputt ist, sondern weil er sich
   * genau richtig verhaelt. Ein zweiter Anlauf kostet zwei Sekunden und
   * nimmt dem Lauf seine Launenhaftigkeit.
   * Why a retry is needed: the client gives up after three connection
   * attempts and leaves for the website login. If the first attempt hits the
   * Vite proxy before its WebSocket forwarding is up, the client is gone —
   * not because anything is broken, but because it behaves exactly right.
   */
  let verbunden = false;
  for (let anlauf = 1; anlauf <= 4 && !verbunden; anlauf++) {
    console.log(`Öffne ${url} (Anlauf ${anlauf}) …`);
    await seite.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    for (let i = 0; i < 100; i++) {
      // Waehrend der Weiterleitung wird der Ausfuehrungskontext zerstoert —
      // das ist keine Ausnahme, sondern die Antwort „ist weggegangen".
      // During the redirect the execution context is destroyed — that is not
      // an exception but the answer "has left".
      const st = await seite
        .evaluate(() => ({
          verbunden: window.__dbg?.socket?.connected ?? false,
          fort: !location.host.startsWith('localhost'),
        }))
        .catch(() => ({ verbunden: false, fort: true }));
      if (st.verbunden) {
        verbunden = true;
        break;
      }
      if (st.fort) break; // zur Anmeldung abgebogen / left for the login page
      await seite.waitForTimeout(200);
    }
  }
  if (!verbunden) {
    throw new Error('Der Client hat sich in vier Anläufen nicht verbunden');
  }

  // Der Renderer-String — der Zeuge dafür, dass hier keine Software
  // rasterisiert. / The renderer string.
  const renderer = await seite.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return 'kein WebGL';
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unbekannt';
  });
  messwerte.renderer = renderer;
  console.log(`Renderer: ${renderer}`);
  if (/swiftshader|llvmpipe|software/i.test(renderer)) {
    fehler.push(`Software-Rasterisierung (${renderer}) — die Zeiten unten messen nicht das Spiel`);
  }

  const vorEintritt = await seite.evaluate(() => ({
    terrainBereit: window.__dbg?.terrain?.ready ?? null,
    ladefortschritt: window.__dbg?.terrain?.loadProgress ?? null,
    vorhangSteht: document.getElementById('loading-screen') !== null,
  }));
  messwerte.vorEintritt = vorEintritt;
  console.log(
    `Verbunden. Gelände: ready=${vorEintritt.terrainBereit}, ` +
      `Fortschritt=${vorEintritt.ladefortschritt}, ` +
      `Ladebildschirm ${vorEintritt.vorhangSteht ? 'steht' : 'weg'}`
  );

  console.log(`Betrete '${DUNGEON_ID}' …`);
  await seite.evaluate(
    (id) => window.__dbg.socket.sendAdminCommand(`dungeon enter ${id}`),
    DUNGEON_ID
  );

  console.log('Warte auf die Baubereitschaft der Instanz …');
  try {
    await seite.waitForFunction(() => window.__dg2live != null, undefined, { timeout: 120_000 });
  } catch (e) {
    // Beim Warten stehenzubleiben, ohne zu sagen WORAUF, ist die teuerste
    // Sorte Fehlschlag. Also alles hinlegen, was den Stand erklaert.
    // Failing to wait without saying WHAT for is the most expensive kind of
    // failure. So put down everything that explains the state.
    const stand = await seite.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 600),
      terrainBereit: window.__dbg?.terrain?.ready ?? null,
      ladefortschritt: window.__dbg?.terrain?.loadProgress ?? null,
      imDungeon: window.__dbg?.imDungeon ?? null,
      hatDbg: window.__dbg != null,
    })).catch(() => null);
    console.log('Stand beim Abbruch:', JSON.stringify(stand, null, 1));
    console.log('Letzte Konsolenzeilen:');
    for (const z of konsole.slice(-40)) console.log(`  ${z}`);
    for (const z of seitenFehler.slice(-10)) console.log(`  AUSNAHME ${z}`);
    throw e;
  }
  const messung = await seite.evaluate(() => window.__dg2live.messung);
  messwerte.instanz = messung;
  console.log(
    `Baubereit nach ${messung.msBisBereit.toFixed(0)} ms — ` +
      `${messung.bloecke} Blöcke, ${messung.meshes} Meshes, ${messung.koerper} Körper, ` +
      `Materialsätze ${messung.arraysGeladen ? 'geladen' : 'FEHLEN (graue Kästen)'}`
  );
  console.log(
    `Prüfsumme: Server ${messung.pruefsummeErwartet}, Client ${messung.pruefsummeGerechnet} — ` +
      (messung.abweichung ? 'ABWEICHUNG' : 'gleich')
  );
  if (messung.abweichung) fehler.push('Prüfsummen von Server und Client gehen auseinander');
  if (messung.layoutFehler > 0) fehler.push(`${messung.layoutFehler} Layout-Fehler`);

  // Ladebildschirm wirklich weg? / Is the loading screen really gone?
  // `finish()` blendet aus und entfernt den Knoten erst 700 ms spaeter.
  // `finish()` fades out and removes the node only 700 ms later.
  await seite.waitForTimeout(1200);
  const vorhangWeg = await seite.evaluate(
    () => document.getElementById('loading-screen') === null
  );
  messwerte.vorhangWeg = vorhangWeg;
  if (!vorhangWeg) fehler.push('Der Ladebildschirm steht noch über der Instanz');

  // ── 5. Laufen ───────────────────────────────────────────────────────
  // Die Position muss sich MESSBAR ändern. Ein Client, der in einer Instanz
  // steht und sich nicht bewegen lässt, sieht auf einem Bild genauso aus wie
  // einer, der läuft.
  // The position must change MEASURABLY.
  const vorher = await seite.evaluate(() => {
    const p = window.__dbg?.player?.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });
  await seite.evaluate(() => window.focus());
  for (const taste of ['KeyW', 'KeyA', 'KeyW', 'KeyD']) {
    await seite.keyboard.down(taste);
    await seite.waitForTimeout(700);
    await seite.keyboard.up(taste);
    await seite.waitForTimeout(120);
  }
  const nachher = await seite.evaluate(() => {
    const p = window.__dbg?.player?.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });
  const strecke =
    vorher && nachher ? Math.hypot(nachher.x - vorher.x, nachher.z - vorher.z) : -1;
  messwerte.strecke = strecke;
  messwerte.vonBis = { vorher, nachher };
  console.log(
    `Gelaufen: ${strecke.toFixed(2)} m ` +
      `(${vorher ? `${vorher.x.toFixed(1)}/${vorher.z.toFixed(1)}` : '?'} → ` +
      `${nachher ? `${nachher.x.toFixed(1)}/${nachher.z.toFixed(1)}` : '?'})`
  );
  if (!(strecke > 0.5)) fehler.push(`Die Figur hat sich nicht bewegt (${strecke.toFixed(2)} m)`);
  // Nicht durch den Boden gefallen: Der Bauer setzt seine Körper um y = 0
  // herum, ein Durchfall wäre ein Sturz ins Bodenlose.
  // Not fallen through: a fall-through would be bottomless.
  if (nachher && nachher.y < -20) fehler.push(`Durch den Boden gefallen (y = ${nachher.y})`);

  // ── 6. Das Bild ─────────────────────────────────────────────────────
  const fertig = await seite.evaluate(() => window.__dg2live.vollstaendig());
  const statistik = await seite.evaluate(() => window.__dg2live.statistik());
  messwerte.vollstaendig = fertig;
  messwerte.statistik = statistik;
  // Die Messung NOCH EINMAL lesen: Die Deko laeuft nebenher und war beim
  // ersten Lesen noch nicht fertig — dort stuende sonst dauerhaft eine Null.
  // Read the measurement AGAIN: decor runs alongside and was not finished at
  // the first read.
  messwerte.instanz = await seite.evaluate(() => window.__dg2live.messung);
  await seite.screenshot({ path: BILD });
  console.log(`Bild: ${BILD}`);

  // ── 7. Wieder heraus ────────────────────────────────────────────────
  await seite.evaluate(() => window.__dbg?.socket?.sendAdminCommand?.('dungeon leave'));
  await seite.waitForTimeout(2500);
  const drinDanach = await seite.evaluate(() => window.__dbg?.imDungeon ?? null);
  messwerte.nachDemVerlassen = drinDanach;
  console.log(`Nach dem Verlassen: imDungeon = ${drinDanach}`);

  // ── 8. Fehler zählen ────────────────────────────────────────────────
  const konsolenFehler = konsole.filter((z) => z.startsWith('error:'));
  // Fehlende GLBs. Auf DIESER Maschine ist `assets/` absichtlich leer bis auf
  // wenige Dateien (Mike sichert die Modelle ausserhalb des Repos), also
  // werden Dungeon-Modelle und Weltmodelle GETRENNT gezaehlt — sonst zaehlt
  // man die fehlende Spielfigur als Dungeon-Fehler.
  // Missing GLBs, counted SEPARATELY for dungeon and world models: on THIS
  // machine `assets/` is deliberately near-empty.
  const assetFehler = konsole.filter((z) => /Unable to load from \/assets\//.test(z));
  const dungeonAssetFehler = assetFehler.filter((z) => /Steingrab|CryptWallTorch|TreasureChest|Spawner/.test(z));
  const prefabFehler = konsole.filter((z) => /unbekanntes? prefab|unknown prefab|prefabHash/i.test(z));
  const zdoFehler = konsole.filter((z) => /zdo/i.test(z) && /error|fehler/i.test(z));
  messwerte.zaehler = {
    konsolenFehler: konsolenFehler.length,
    seitenFehler: seitenFehler.length,
    assetFehlerGesamt: assetFehler.length,
    assetFehlerDungeon: dungeonAssetFehler.length,
    prefabFehler: prefabFehler.length,
    zdoFehler: zdoFehler.length,
  };
  console.log(`Zähler: ${JSON.stringify(messwerte.zaehler)}`);
  for (const z of [...konsolenFehler, ...seitenFehler].slice(0, 15)) console.log(`  ! ${z}`);
  if (konsolenFehler.length > 0) fehler.push(`${konsolenFehler.length} Konsolenfehler`);
  if (seitenFehler.length > 0) fehler.push(`${seitenFehler.length} unbehandelte Ausnahmen`);

  await browser.close();

  console.log('\n── Messwerte ──');
  console.log(JSON.stringify(messwerte, null, 1));
  if (fehler.length === 0) {
    console.log('\ndungeon2-e2e: GRÜN');
  } else {
    console.log('\ndungeon2-e2e: ROT');
    for (const f of fehler) console.log(`  ROT  ${f}`);
  }
  process.exitCode = fehler.length === 0 ? 0 : 1;
}

try {
  await main();
} catch (e) {
  console.error('dungeon2-e2e: ABBRUCH —', e);
  process.exitCode = 1;
} finally {
  for (const k of kinder) {
    try {
      k.kill('SIGKILL');
    } catch {
      /* schon tot / already gone */
    }
  }
  rmSync(TMP, { recursive: true, force: true });
  // Kindprozesse, die eine Ausnahme hinterlassen hat.
  // Child processes left behind by an exception.
  setTimeout(() => process.exit(process.exitCode ?? 1), 500).unref();
}
