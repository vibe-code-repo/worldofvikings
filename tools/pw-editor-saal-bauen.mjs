#!/usr/bin/env node
/**
 * Prüft: das Fenster zu Meilenstein E8 — einen Saal AUS DEM EDITOR bauen,
 * die Seite neu laden, ihn setzen, speichern und im Spiel betreten.
 * Checks the E8 window: build a hall from the editor, reload, place it,
 * save it, enter it in the game.
 *
 *   node tools/pw-editor-saal-bauen.mjs [docId=saal-gen-probe] [breite=4] [tiefe=3] [raster=2]
 *
 * ── Warum es diesen Lauf gibt, obwohl alles grün ist ─────────────────
 * Weil grüne Tests kein Fenster sind. `client/test/dungeon-neuer-saal.ts`
 * misst, was das Formular in seinen Behälter hängt und welche vier Zahlen
 * ein Klick auslöst — an einem DOM-Stummel, ohne Netz, ohne Server, ohne
 * Babylon. `server/test/modulbau-grenzen.ts` misst die Klemmen und schreibt
 * dabei nach `os.tmpdir()`. Zwischen beiden liegt alles, was E8 wirklich
 * behauptet:
 *
 *   1. Der Server MELDET die Erlaubnis (`dungeons.modulbau` als Flagbit
 *      der `ServerConfig`) — und zwar an eine EDITOR-Verbindung, die
 *      dieses Paket bis E8 gar nicht bekam.
 *   2. Die geschriebene GLB wird vom Webserver auch AUSGELIEFERT, aus
 *      `assets/generiert/` und nicht aus `assets/models/`.
 *   3. Ein neu geladener Editor sieht das Modul im Katalog — der Weg über
 *      `modul-registry.json` und `applyModuleRegistry` im Browser.
 *   4. Der Saal steht danach im SPIEL, ist begehbar und dicht.
 *
 * Keiner dieser vier Punkte hat einen Zeugen ohne Browser.
 *
 * ── Er läuft LOKAL, nicht auf wov-dev ────────────────────────────────
 * Auf `wov-dev` startet kein Chromium (Gedächtnis „Messungen laufen
 * lokal"). Der Lauf gehört auf Mikes Maschine, gegen den Tunnel bzw. die
 * dev-Adressen unten.
 *
 * ── Voraussetzung, die er selbst prüft ───────────────────────────────
 * `server/data/server.yml` braucht
 *
 *     dungeons:
 *       enabled: true
 *       modulbau: true
 *
 * und danach einen NEUSTART des Spielservers: Flags erreichen einen
 * Client nur beim Anmelden (Gedächtnis
 * „server.yml erreicht laufende Clients nicht"). Fehlt der Schalter,
 * bricht Schritt 1 mit genau diesem Satz ab — und nicht mit „Knopf nicht
 * gefunden", was nach einem Fehler im Editor aussähe.
 *
 * Bilder: ~/.cache/wov-stonevault-sicht/saal-gen-*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const HOST_SPIEL = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const CREDS = {
  username: process.env.WOV_DEV_USER ?? 'Admin',
  password: process.env.WOV_DEV_PASS ?? '!T3mp12345',
};
// Ohne ANGLE-Flags rendert SwiftShader, und der Geländestrom verhungert am
// Zeitbudget (Gedächtnis „Headless Chromium braucht die GPU").
const GPU_FLAGS = [
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];
const [docId = 'saal-gen-probe', breite = '4', tiefe = '3', raster = '2'] = process.argv.slice(2);
/** Der Name, den der SERVER aus dem Mass bildet — `moduleRegistry.modulName`. */
const modulName = `Gen_StoneVaultHall${breite}x${tiefe}${raster === '2' ? '' : `r${raster}`}`;

mkdirSync(ORDNER, { recursive: true });
let nr = 0;
const befunde = [];
const merke = (ok, was, zusatz = '') => {
  befunde.push({ ok, was, zusatz });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
};

const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });

// ══ Teil A — Editor ═══════════════════════════════════════════════════
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: CREDS,
});
const seite = await ctx.newPage();
const seitenfehler = [];
seite.on('pageerror', (f) => seitenfehler.push(String(f).slice(0, 200)));
const bild = async (tag) => {
  nr++;
  const p = `${ORDNER}/saal-gen-${String(nr).padStart(2, '0')}-${tag}.png`;
  await seite.screenshot({ path: p });
  console.log(`  Bild ${p}`);
  return p;
};
/**
 * Einen Knopf über seine Beschriftung drücken.
 *
 * Gesucht wird der Anfang der Beschriftung und nicht ihr ganzer Text —
 * gemessen am 05.09.2026: Sobald am Dokument etwas ungespeichert ist,
 * heisst der Knopf „Speichern *", und ein Vergleich auf Gleichheit fand
 * ihn genau dann nicht, wenn es etwas zu speichern gab. Der Lauf klickte
 * ins Leere und meldete danach ehrlich „nicht gespeichert" — der Fehler
 * sass im Skript, nicht im Editor.
 */
const knopf = (text) =>
  seite.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().startsWith(t)
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);
const oeffneDungeons = async () => {
  await seite.evaluate(() => {
    const b = [...document.querySelectorAll('button,a,div')].find(
      (b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3
    );
    b?.click();
  });
  await seite.waitForTimeout(3000);
};

await seite.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await oeffneDungeons();

// ── 1. Steht das Formular überhaupt da? ──────────────────────────────
//
// Das ist der eigentliche Zeuge für die Flagkette: server.yml →
// ServerConfig → Editor. Ein fehlender Abschnitt hat genau eine
// wahrscheinliche Ursache, und die steht in der Meldung.
// Ohne `i`: Die Überschrift kommt aus `abschnitt()` und trägt
// `text-transform: uppercase`. `innerText` gibt den GERENDERTEN Text —
// „NEUER SAAL" —, und die Prüfung meldete am 05.09.2026 ein fehlendes
// Formular, das im Bild daneben stand.
const formularDa = await seite.evaluate(() => /neuer saal/i.test(document.body.innerText));
merke(formularDa, 'der Abschnitt „Neuer Saal" ist da');
if (!formularDa) {
  console.error(
    'Abbruch: Kein Formular. Erwartet wird `dungeons.modulbau: true` in server/data/server.yml,\n' +
      'ein NEUSTART des Spielservers danach (Flags kommen nur beim Anmelden) und ein Peer mit\n' +
      'Adminrecht. Ist alles drei erfüllt und der Abschnitt fehlt trotzdem, ist die Kette\n' +
      'ServerConfig → Editor gebrochen — nicht das Formular.'
  );
  await bild('kein-formular');
  await browser.close();
  process.exit(1);
}
await bild('formular');

// ── 2. Saal bauen ────────────────────────────────────────────────────
const gefuellt = await seite.evaluate(([b, t, r]) => {
  const setzeWert = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // Die drei Zahlenfelder des Formulars in DOM-Reihenfolge: Breite,
  // Tiefe, Gewicht. Über die Reihenfolge und nicht über den Zeilentext —
  // dieselbe Falle wie bei „Kit-Vorgabe" in pw-editor-3d-generieren.mjs.
  const zahlen = [...document.querySelectorAll('input[type=number]')];
  if (zahlen.length < 3) return { fehler: `nur ${zahlen.length} Zahlenfelder` };
  setzeWert(zahlen[0], b);
  setzeWert(zahlen[1], t);
  setzeWert(zahlen[2], '1');
  const rw = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^Raster /.test(o.textContent))
  );
  if (!rw) return { fehler: 'keine Rasterauswahl' };
  rw.value = r;
  rw.dispatchEvent(new Event('change'));
  return { ok: true };
}, [breite, tiefe, raster]);
merke(gefuellt.ok === true, 'Breite, Tiefe, Raster und Gewicht gesetzt', JSON.stringify(gefuellt));

// Die Vorschau NACH dem Ausfüllen und VOR dem Klick: Sie muss den Namen
// nennen, den der Server gleich bildet. Weichen beide ab, hat der Editor
// eine zweite Namensregel — genau das, was `modulName` verhindern soll.
const vorschau = await seite.evaluate(() =>
  document.body.innerText.split('\n').find((z) => /Gen_StoneVaultHall/.test(z))?.trim() ?? ''
);
merke(vorschau.includes(modulName), `die Vorschau nennt ${modulName}`, vorschau);

const bauKnopfDa = await knopf('Saal bauen');
merke(bauKnopfDa, 'Knopf „Saal bauen" gedrückt');
await seite.waitForTimeout(12_000);
const antwort = await seite.evaluate(() =>
  document.body.innerText
    .split('\n')
    .filter((z) => /Gebaut|Dreiecke|abgelehnt|nicht eingeschaltet|Deckel/.test(z))
    .map((z) => z.trim())
    .join(' | ')
);
merke(/Gebaut/.test(antwort), 'der Server meldet einen gebauten Saal', antwort);
await bild('gebaut');

// Zweiter, unabhängiger Zeuge: die Datei liegt da, wo E7 sie hinlegt —
// unter `/assets/generiert/`, NICHT unter `/assets/models/`.
const ausgeliefert = await seite.evaluate(async (name) => {
  const hole = async (p) => {
    try {
      const a = await fetch(p, { cache: 'no-store' });
      return a.status;
    } catch (e) {
      return String(e);
    }
  };
  return {
    glb: await hole(`/assets/generiert/${name}.glb`),
    registry: await hole('/assets/generiert/modul-registry.json'),
    nichtInModels: await hole(`/assets/models/${name}.glb`),
  };
}, modulName);
merke(ausgeliefert.glb === 200, 'die GLB wird aus /assets/generiert/ ausgeliefert', JSON.stringify(ausgeliefert));
merke(ausgeliefert.registry === 200, 'die Registry liegt daneben');
merke(ausgeliefert.nichtInModels === 404, 'und NICHTS davon liegt unter /assets/models/');

// ── 3. Seite neu laden ───────────────────────────────────────────────
//
// Der Hinweis im Formular sagt es, und hier wird er eingelöst: Die
// Modulliste des Katalogs entsteht beim Aufbau der Seite, die Registry
// wird davor geholt (`ladeModulRegistrierung`, oberste await-Ebene von
// `editorMain.ts`). Ohne Neuladen kann der Saal nicht im Katalog stehen —
// und wenn er es doch täte, wäre das der interessantere Befund.
await seite.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await seite.waitForTimeout(8000);
await oeffneDungeons();

// ── 4. Steht das Modul im Katalog? ───────────────────────────────────
//
// Erst braucht es ein Dokument: Das Raumfeld unter „Anfügen" gibt es nur
// mit geöffnetem Grundriss. Deshalb legt Schritt 5 an, und die
// Katalogprüfung folgt darauf.
const anlegen = await seite.evaluate(async ([id]) => {
  const setzeWert = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const basis = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /^DG_StoneVault/.test(o.textContent.trim()))
  );
  if (!basis) return { fehler: 'kein Basis-Select' };
  basis.value = [...basis.options].find((o) => /^DG_StoneVault/.test(o.textContent.trim())).value;
  basis.dispatchEvent(new Event('change'));
  const idFeld = document.querySelector('input[placeholder^="id,"]');
  if (!idFeld) return { fehler: 'kein id-Feld' };
  setzeWert(idFeld, id);
  [...document.querySelectorAll('button')].find((b) => /^Anlegen/.test(b.textContent.trim()))?.click();
  return { ok: true };
}, [docId]);
await seite.waitForTimeout(8000);
merke(anlegen.ok === true, `Dokument ${docId} angelegt`, JSON.stringify(anlegen));

const imKatalog = await seite.evaluate((name) => {
  const raumWahl = [...document.querySelectorAll('select')].filter((s) =>
    [...s.options].some((o) => /StoneVault/.test(o.textContent))
  );
  const alle = raumWahl.flatMap((s) => [...s.options].map((o) => o.textContent.trim()));
  return { gefunden: alle.some((t) => t.includes(name)), angeboten: alle.filter((t) => /Gen_/.test(t)) };
}, modulName);
merke(imKatalog.gefunden, `nach dem Neuladen steht ${modulName} im Katalog`, JSON.stringify(imKatalog));
await bild('im-katalog');

// ── 5. Saal setzen und speichern ─────────────────────────────────────
const gesetzt = await seite.evaluate(async (name) => {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const selects = [...document.querySelectorAll('select')];
  const raum = selects.find((s) => [...s.options].some((o) => o.textContent.includes(name)));
  if (!raum) return { fehler: `keine Raumwahl mit ${name}` };
  const kante = selects.find((s) => [...s.options].some((o) => /#0\//.test(o.textContent)));
  if (kante) {
    const wahl = [...kante.options].find((o) => !/Eingang/i.test(o.textContent)) ?? kante.options[0];
    kante.value = wahl.value;
    kante.dispatchEvent(new Event('change'));
    await warte(300);
  }
  const raum2 = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.textContent.includes(name))
  );
  raum2.value = [...raum2.options].find((o) => o.textContent.includes(name)).value;
  raum2.dispatchEvent(new Event('change'));
  await warte(300);
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Anfügen')?.click();
  await warte(1000);
  // Der Kopf des DOKUMENTS, nicht die Zeile der Instanzliste: Beide
  // sagen „… Räume, … Türen", und die Liste steht weiter oben. Am
  // Zusatz „Deko" hängt der Unterschied.
  return {
    ok: true,
    kopf:
      document.body.innerText
        .split('\n')
        .find((z) => /^\d+ Räume, \d+ Türen, \d+ Deko, \d+ offen$/.test(z.trim())) ?? '',
  };
}, modulName);
merke(gesetzt.ok === true, 'der gebaute Saal ist angefügt', JSON.stringify(gesetzt));
merke(
  /^2 Räume/.test((gesetzt.kopf ?? '').trim()),
  'das Dokument hat jetzt zwei Räume (Eingang + Saal)',
  gesetzt.kopf ?? ''
);
await bild('angefuegt');

// ── 5b. Kanten schliessen ────────────────────────────────────────────
//
// Von Hand und VOR dem Speichern, obwohl der Schalter „beim Speichern
// schliessen" dasselbe täte: Nur so lässt sich die Zahl der offenen
// Kanten vorher und nachher gegeneinanderhalten. Bleibt sie stehen, hat
// der Knopf nichts getan — und die Lichtfugenzählung weiter unten misst
// dann eine offene Wand statt einer Fuge.
const offenVorher = await seite.evaluate(
  () => document.body.innerText.match(/(\d+) offen/)?.[1] ?? '?'
);
await knopf('Kanten schließen');
await seite.waitForTimeout(2000);
const offenNachher = await seite.evaluate(
  () => document.body.innerText.match(/(\d+) offen/)?.[1] ?? '?'
);
merke(
  offenNachher === '0',
  'die Kanten sind geschlossen',
  `offen ${offenVorher} → ${offenNachher}`
);
await bild('kanten-zu');

await knopf('Speichern');
await seite.waitForTimeout(10_000);
// ── Woran man das Speichern erkennt ──────────────────────────────────
//
// NICHT an der Meldung: Die Statuszeile trägt sie nur eine Weile, und
// ein Lauf, der acht Sekunden später nachsieht, findet eine leere Zeile
// und meldet „nicht gespeichert" — so geschehen am 05.09.2026, während
// die Datei längst auf der Platte lag. Der bleibende Zeuge ist die
// Schmutzmarke: Sie hängt das Sternchen an den Knopf und die Zeile
// „Ungespeichert." darüber, und beide verschwinden erst, wenn der Server
// das Dokument angenommen hat.
const gespeichert = await seite.evaluate(() => ({
  meldung: document.body.innerText
    .split('\n')
    .filter((z) => /gespeichert|abgelehnt|veraltet/i.test(z))
    .map((z) => z.trim())
    .join(' | '),
  sternchen: [...document.querySelectorAll('button')].some((b) =>
    b.textContent.trim().startsWith('Speichern *')
  ),
  ungespeichert: /Ungespeichert\./.test(document.body.innerText),
}));
// „Registry veraltet — Seite neu laden" wäre hier der interessanteste
// Fehlschlag: Er hiesse, dass die Prüfsumme des Browsers und die des
// Servers auseinanderliegen, obwohl beide dasselbe Modul kennen sollten.
merke(
  gespeichert.sternchen === false && gespeichert.ungespeichert === false,
  'gespeichert (die Schmutzmarke ist fort)',
  JSON.stringify(gespeichert)
);
await bild('gespeichert');

// ── 6. 3D-Bild aus dem Editor ────────────────────────────────────────
await knopf('3D-Ansicht');
await seite.waitForTimeout(15_000);
const bild3d = await bild('3d-editor');
merke(true, '3D-Bild aus dem Editor', bild3d);
if (seitenfehler.length) console.log(`  Seitenfehler: ${seitenfehler.slice(0, 4).join(' || ')}`);
await ctx.close();

// ══ Teil B — im Spiel ═════════════════════════════════════════════════
function testToken() {
  const n = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${n}.testlauf`;
}
const ctx2 = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  httpCredentials: CREDS,
});
const spiel = await ctx2.newPage();
await spiel.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
await spiel.goto(`${HOST_SPIEL}/?name=Saal${Date.now().toString(36).slice(-4)}&dungeon=${docId}`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await spiel.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
await spiel.waitForTimeout(10_000);
// Maus fangen, BEVOR ein Blick gesetzt wird — der Klick addiert sonst sein
// Delta auf `_yaw` (s. pw-lichtfuge.mjs).
await spiel.mouse.click(800, 450);
await spiel.waitForTimeout(400);

// Wo steht der Saal WIRKLICH? Gefragt werden die Instanzmatrizen und nicht
// das Dokument: Der Ladebildschirm hängt am Gelände, und ein Teleport auf
// eine gerechnete Koordinate vor dem Laden landet im Nichts.
const saal = await spiel.evaluate((name) => {
  for (const b of window.__dbg.entities.buckets.values()) {
    if (String(b.prefabName) !== name) continue;
    const m = b.matrices;
    if (!m || m.length < 16) continue;
    // Spalte 4 einer 4x4-Matrix in Babylons Speicherfolge: die Verschiebung.
    return { x: m[12], y: m[13], z: m[14], instanzen: m.length / 16 };
  }
  return null;
}, modulName);
merke(saal !== null, `der Saal ${modulName} steht im Spiel`, JSON.stringify(saal));
if (!saal) {
  await browser.close();
  process.exit(1);
}

// ── 7. Die Diagonale laufen ──────────────────────────────────────────
//
// Positionsgesteuert und nicht zeitgesteuert (Gedächtnis „Framezeit:
// Strecke statt Zeit"): Gemessen wird der FORTSCHRITT je Abtastung. Ein
// Hänger ist eine Abtastung ohne Fortschritt, während das Ziel noch weit
// ist — keine Frage der Uhr.
//
// Vorbehalt, der im Bericht stehen muss: Der Serverabgleich zieht die
// Figur nach etwa zwei Sekunden durch Wände (Gedächtnis
// „Serverposition kennt keine Wände"). Dieser Lauf ist deshalb eine
// PLAUSIBILITÄTSPROBE — er findet einen Saal, in dem man steckenbleibt,
// aber er beweist keine saubere Kollision.
// ── Warum NICHT teleportiert wird ───────────────────────────────────
//
// Der erste Anlauf setzte `player.position` und lief los. Gemessen am
// 05.09.2026: Nach neun Abtastungen (≈ 2,3 s) sprang die Figur um acht
// Meter zurück — der Serverabgleich. Ein Teleport im Client hält den
// Spieler nicht; im Dungeon gibt es zum Ausgleich auch keinen
// Admin-Teleport, denn `teleport` VERLÄSST die Instanz (s. WovServer).
// Gelaufen wird deshalb wirklich: vom Eingang in den Saal und dort die
// Diagonale — der Server sieht dieselbe Strecke und hat nichts zu
// korrigieren.
//
// ── Die Blickrichtung ist gerechnet, nicht geraten ──────────────────
// `PlayerController`: forward = (−sin yaw, −cos yaw). Der erste Anlauf
// nahm `atan2(dx, dz)` und lief damit exakt rückwärts — die Restweite
// wuchs von 6,5 auf 40,9 m, und der Lauf meldete brav „nicht begehbar".
// Richtig ist `atan2(−dx, −dz)`.
const yawZu = (von, zu) => Math.atan2(-(zu.x - von.x), -(zu.z - von.z));
const stelle = () =>
  spiel.evaluate(() => {
    const p = window.__dbg.player.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
  });
/**
 * Zu einem Punkt laufen und dabei jede Abtastung nachsteuern.
 *
 * Nachsteuern statt einmal ausrichten: Eine Figur, die an einer Kante
 * abrutscht, liefe sonst mit unveränderter Blickrichtung ins Nichts
 * weiter, und die Messung sagte „kein Hänger" über eine Strecke, die nie
 * am Ziel ankam.
 */
const laufeZu = async (ziel, abtastungen = 40) => {
  const spur = [await stelle()];
  await spiel.keyboard.down('KeyW');
  for (let i = 0; i < abtastungen; i++) {
    const jetzt = spur[spur.length - 1];
    await spiel.evaluate((yy) => {
      const p = window.__dbg.player;
      p._yaw = yy;
      p._figurYaw = yy;
      p._pitch = -0.05;
    }, yawZu(jetzt, ziel));
    await spiel.waitForTimeout(250);
    const neu = await stelle();
    neu.rest = +Math.hypot(ziel.x - neu.x, ziel.z - neu.z).toFixed(2);
    spur.push(neu);
    if (neu.rest < 0.9) break;
  }
  await spiel.keyboard.up('KeyW');
  await spiel.waitForTimeout(300);
  let haenger = 0;
  for (let i = 2; i < spur.length; i++) {
    const weg = Math.hypot(spur[i].x - spur[i - 1].x, spur[i].z - spur[i - 1].z);
    if (weg < 0.05 && spur[i].rest > 1.0) haenger++;
  }
  return { spur, haenger, rest: spur[spur.length - 1].rest ?? null };
};

const halbX = (Number(breite) * 2) / 2;
const halbZ = (Number(tiefe) * 2) / 2;
const mitte = { x: saal.x, z: saal.z };
const eckeA = { x: saal.x - halbX + 1.0, z: saal.z - halbZ + 1.0 };
const eckeB = { x: saal.x + halbX - 1.0, z: saal.z + halbZ - 1.0 };

// Erst hinein — das ist noch nicht die Messung, sondern der Weg dorthin.
const hin = await laufeZu(mitte);
console.log(`   Weg in den Saal: ${hin.spur.map((s) => s.rest ?? '·').join(' → ')}`);
merke(hin.rest !== null && hin.rest < 1.2, 'der Saal ist vom Eingang aus erreichbar', `Restweg ${hin.rest} m`);
const zurEcke = await laufeZu(eckeA);
console.log(`   Weg in die Ecke: ${zurEcke.spur.map((s) => s.rest ?? '·').join(' → ')}`);

// ── und jetzt die Diagonale ─────────────────────────────────────────
const diagonale = await laufeZu(eckeB);
merke(
  diagonale.rest !== null && diagonale.rest < 1.2 && diagonale.haenger === 0,
  'die Diagonale ist ohne Hänger begehbar',
  `von ${JSON.stringify(zurEcke.spur[zurEcke.spur.length - 1])} nach ${JSON.stringify(eckeB)}: ` +
    `Restweg ${diagonale.rest} m, ${diagonale.haenger} Abtastung(en) ohne Fortschritt, ` +
    `${diagonale.spur.length} Abtastungen`
);
console.log(`   Diagonale: ${diagonale.spur.map((s) => s.rest ?? '·').join(' → ')}`);

// ── 8. Lichtfugen zählen ─────────────────────────────────────────────
//
// Gezählt wird OHNE Belichtungsanhebung, und das ist die ganze Aussage:
// „Hell" soll Licht heissen, das durch eine Fuge fällt, nicht ein
// aufgedrehter Regler. Die Schwelle und die drei Zonen sind dieselben wie
// in `tools/elements/pruefung/zaehle-naht.py`, damit sich die Zahlen
// neben ein Rendering legen lassen.
//
// ── Warum aus dem BILDSCHIRMFOTO und nicht aus der Leinwand ──────────
// Der erste Entwurf zeichnete die WebGL-Leinwand in eine Hilfsleinwand
// und las die Bildpunkte dort — so macht es `dungeon2-speckle-guard.mjs`.
// DORT geht das, weil `dungeon2Preview.ts` seine Engine mit
// `preserveDrawingBuffer: true` anlegt. Der SPIELCLIENT tut das nicht
// (`main.ts`: `new Engine(canvas, true, { stencil: true, … })`), und ohne
// diese Zusage ist der Zeichenpuffer nach dem Zusammensetzen des Bildes
// leer. Die Zählung hätte also verlässlich 0 gemeldet — für einen
// dichten Saal wie für ein Loch in der Wand. Gemessen wird deshalb das
// Bildschirmfoto, das ohnehin entsteht.
//
// Der Ausschnitt lässt die Anzeigen aussen vor (Lebensbalken oben links,
// Diagnosefeld unten rechts, Gürtel unten Mitte) — DOM-Elemente über der
// Leinwand, deren helle Punkte mit dem Saal nichts zu tun haben. Das
// Fadenkreuz in der Bildmitte wird ausmaskiert.
const AUSSCHNITT = { links: 220, oben: 60, breite: 780, hoehe: 570 };
const FADENKREUZ = { x: 800, y: 450, r: 16 };
const zaehleFuge = async (pfad) => {
  const { data, info } = await sharp(pfad)
    .extract({
      left: AUSSCHNITT.links,
      top: AUSSCHNITT.oben,
      width: AUSSCHNITT.breite,
      height: AUSSCHNITT.hoehe,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const SCHWELLE = 200;
  const zonen = [0, 0, 0];
  let hell = 0;
  let maxHell = 0;
  let summe = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const punkt = i / info.channels;
    const sx = AUSSCHNITT.links + (punkt % info.width);
    const sy = AUSSCHNITT.oben + Math.floor(punkt / info.width);
    if (Math.abs(sx - FADENKREUZ.x) < FADENKREUZ.r && Math.abs(sy - FADENKREUZ.y) < FADENKREUZ.r) {
      continue;
    }
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    summe += m;
    if (m > maxHell) maxHell = m;
    if (m < SCHWELLE) continue;
    hell++;
    const zy = Math.floor(punkt / info.width);
    zonen[zy < info.height / 4 ? 0 : zy < (3 * info.height) / 4 ? 1 : 2]++;
  }
  return {
    hell,
    maxHell,
    mittel: +(summe / (info.width * info.height)).toFixed(1),
    deckeWand: zonen[0],
    wand: zonen[1],
    bodenWand: zonen[2],
  };
};

await spiel.evaluate(() => {
  window.__dbg.scene.imageProcessingConfiguration.exposure = 1;
});
// Zurück in die Mitte — gelaufen, nicht gesetzt (Begründung oben). Und
// nachgesehen statt angenommen: Steht die Figur beim Zählen gar nicht im
// Saal, zählte die Messung die Dunkelheit des Eingangsraums und meldete
// stolz „keine Fuge".
const zurueck = await laufeZu(mitte);
const wo = await stelle();
merke(
  Math.abs(wo.x - saal.x) < halbX && Math.abs(wo.z - saal.z) < halbZ,
  'die Figur steht beim Zählen IM Saal',
  `${JSON.stringify(wo)} gegen Mitte ${JSON.stringify(mitte)} ± ${halbX}/${halbZ} m, ` +
    `Restweg ${zurueck.rest} m`
);

// ── Die Kamera heranholen ────────────────────────────────────────────
//
// Ohne diese Zeile misst der Lauf Stein. Die Verfolgerkamera hängt vier
// Meter HINTER dem Auge und wird von keiner Wand aufgehalten
// (`PlayerController`: kein Kollisionstest am Ausleger, im Dungeon fällt
// auch die Bodenklemme weg). In einem Saal von 8 × 6 m steckt sie
// deshalb bei fast jeder Blickrichtung in einem Pfeiler — der erste
// Anlauf am 05.09.2026 lieferte vier Bilder mit bildfüllendem Fels und
// eine Fugenzahl von 0, die nichts über den Saal aussagte, sondern über
// den Pfeiler davor. `BOOM_MIN` ist 1,5 m; das passt in jede Richtung.
await spiel.evaluate(() => {
  window.__dbg.player.boomLength = 1.5;
});
// Und die Figur aus dem Bild nehmen: Sie steht in der Bildmitte, ihre
// Haut liegt bei ~230 und wäre damit „hell" — die Zählung mässe dann den
// Rücken des Testcharakters statt einer Fuge. `__vb.figur(false)` blendet
// nur die Netze aus; Kamera und Physik laufen weiter.
await spiel.evaluate(() => window.__vb.figur(false));
await spiel.waitForTimeout(400);

const RICHTUNGEN = [['nord', 0], ['ost', Math.PI / 2], ['sued', Math.PI], ['west', -Math.PI / 2]];
let fugenGesamt = 0;
const fugenZeilen = [];
for (const [tag, yaw] of RICHTUNGEN) {
  await spiel.evaluate((yy) => {
    const p = window.__dbg.player;
    p._yaw = yy;
    p._figurYaw = yy;
    p._pitch = -0.05;
  }, yaw);
  await spiel.waitForTimeout(900);
  const kamera = await spiel.evaluate(() => {
    const c = window.__dbg.scene.activeCamera;
    return { x: +c.globalPosition.x.toFixed(2), y: +c.globalPosition.y.toFixed(2), z: +c.globalPosition.z.toFixed(2) };
  });
  nr++;
  const pfad = `${ORDNER}/saal-gen-${String(nr).padStart(2, '0')}-fuge-${tag}.png`;
  await spiel.screenshot({ path: pfad });
  const zaehlung = await zaehleFuge(pfad);
  fugenGesamt += zaehlung.hell;
  fugenZeilen.push(`${tag}: ${JSON.stringify({ ...zaehlung, kamera })}`);
  console.log(`   ${tag}: ${JSON.stringify({ ...zaehlung, kamera })}`);
}
// Null ist die Erwartung, nicht das Ideal: Ein Saal ist rundum von
// Wandmodulen umschlossen, es gibt keine Aussenwelt, die hereinleuchten
// könnte. Jeder helle Bildpunkt ist deshalb entweder eine Fuge oder eine
// Fackel im Bild — und beide will man gesehen haben.
//
// Der zweite Zeuge steht daneben und ist der wichtigere: `maxHell`. Eine
// 0 aus einem LEEREN Bild sähe genauso aus wie eine 0 aus einem dichten
// Saal. Solange der hellste Bildpunkt über 0 liegt, ist wenigstens
// erwiesen, dass überhaupt etwas gemessen wurde.
merke(fugenGesamt === 0, 'keine Lichtfuge an den Anschlusskanten', `${fugenGesamt} helle Bildpunkte`);
merke(
  fugenZeilen.every((z) => !/"maxHell":0[,}]/.test(z)),
  'und das Bild war dabei nicht leer (maxHell > 0)',
  fugenZeilen.join(' | ')
);

await spiel.evaluate(() => window.__vb.figur(true));

// Zum Ansehen: dieselben vier Blicke mit angehobener Belichtung.
await spiel.evaluate(() => {
  window.__dbg.scene.imageProcessingConfiguration.exposure = 6;
});
for (const [tag, yaw] of RICHTUNGEN) {
  await spiel.evaluate((yy) => {
    const p = window.__dbg.player;
    p._yaw = yy;
    p._figurYaw = yy;
    p._pitch = -0.05;
  }, yaw);
  await spiel.waitForTimeout(600);
  nr++;
  await spiel.screenshot({ path: `${ORDNER}/saal-gen-${String(nr).padStart(2, '0')}-hell-${tag}.png` });
}

// ══ Teil C — der Löschweg (E9) ════════════════════════════════════════
//
// Drei Anläufe in dieser Reihenfolge, und die Reihenfolge ist die Aussage:
//
//   (1) Löschen, WÄHREND das Grab den Saal benutzt → muss abgelehnt
//       werden, und die Ablehnung muss `saal-gen-probe` NENNEN. Eine
//       Ablehnung ohne Namen zwingt zum Durchsuchen aller Gräber von Hand.
//   (2) Das Dokument löschen (`dungeon delete` über `__vb.admin`).
//   (3) Nochmal löschen → muss durchgehen, und danach müssen Registry und
//       `assets/generiert/` dasselbe sagen.
//
// Der Editor bekommt dafür eine EIGENE, frische Seite ohne geöffnetes
// Dokument: Die Liste sperrt die Zeile selbst, solange der Saal im
// offenen Grundriss steht (der Server sieht nur die Platte). Mit offenem
// Dokument prüfte Anlauf (1) also die Sperre des Browsers und nicht die
// des Servers — und genau die soll hier gemessen werden.
// Höher als die anderen beiden Fenster, und das ist keine Kosmetik: Die
// Liste „Gebaute Säle" und die Antwort des Servers stehen ganz unten in
// der Seitenleiste. Bei 900 px lag beides unter dem Rand, und das
// Beweisbild zeigte eine Ablehnung, die man darauf nicht lesen konnte.
const ctx3 = await browser.newContext({
  viewport: { width: 1600, height: 1300 },
  httpCredentials: CREDS,
});
const editor2 = await ctx3.newPage();
const bild2 = async (tag) => {
  nr++;
  const p = `${ORDNER}/saal-gen-${String(nr).padStart(2, '0')}-${tag}.png`;
  // Die Liste in den Blick rücken, bevor fotografiert wird — sonst ist
  // das Beweisbild ein Bild der Seitenleiste ohne die Stelle, um die es
  // geht.
  await editor2.evaluate(() => {
    const k = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().startsWith('Saal löschen')
    );
    (k ?? document.body).scrollIntoView({ block: 'center' });
  });
  await editor2.waitForTimeout(600);
  await editor2.screenshot({ path: p });
  console.log(`  Bild ${p}`);
  return p;
};
/**
 * Zum Reiter „Dungeons" und dort auf „Saal löschen" in der Zeile des Saals.
 *
 * Die Wartezeit ist gemessen und nicht geschätzt: Die Liste steht erst,
 * wenn die Erlaubnisprobe geantwortet hat — eine eigene, kurze
 * Verbindung zum Spielserver. Mit drei Sekunden fand der Lauf am
 * 05.09.2026 „kein Knopf", mit fünf stand die Zeile da. Gewartet wird
 * deshalb AUF DIE ZEILE und nicht auf die Uhr.
 */
const loeschVersuch = async () => {
  await editor2.evaluate(() => {
    const b = [...document.querySelectorAll('button,a,div')].find(
      (b) => b.textContent.trim() === 'Dungeons' && b.children.length <= 3
    );
    b?.click();
  });
  await editor2
    .waitForFunction(
      (name) =>
        [...document.querySelectorAll('button')].some(
          (b) =>
            b.textContent.trim() === 'Saal löschen' &&
            (b.parentElement?.textContent ?? '').includes(name)
        ),
      modulName,
      { timeout: 30_000 }
    )
    .catch(() => {});
  const zeileDa = await editor2.evaluate((name) => {
    const zeilen = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent.trim() === 'Saal löschen')
      .map((b) => ({ text: b.parentElement?.textContent?.trim() ?? '', gesperrt: b.disabled }));
    const treffer = zeilen.find((z) => z.text.includes(name));
    if (!treffer) return { gefunden: false, zeilen: zeilen.map((z) => z.text) };
    const k = [...document.querySelectorAll('button')].find(
      (b) =>
        b.textContent.trim() === 'Saal löschen' && (b.parentElement?.textContent ?? '').includes(name)
    );
    if (k.disabled) return { gefunden: true, gesperrt: true, zeile: treffer.text };
    k.click();
    return { gefunden: true, gesperrt: false, zeile: treffer.text };
  }, modulName);
  if (!zeileDa.gefunden || zeileDa.gesperrt) return { ...zeileDa, meldung: '' };
  await editor2.waitForTimeout(12_000);
  const meldung = await editor2.evaluate(() =>
    document.body.innerText
      .split('\n')
      .filter((z) => /wird noch benutzt|gelöscht|Nicht gelöscht|Registry|Berechtigung|modulbau/.test(z))
      .map((z) => z.trim())
      .join(' | ')
  );
  return { ...zeileDa, meldung };
};

await editor2.goto(HOST_EDITOR, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await editor2.waitForTimeout(8000);

// ── C1. Löschen, solange das Grab den Saal benutzt ───────────────────
const abgelehnt = await loeschVersuch();
merke(abgelehnt.gefunden === true, `${modulName} steht in der Liste „Gebaute Säle"`, JSON.stringify(abgelehnt.zeilen ?? abgelehnt.zeile));
merke(
  /wird noch benutzt/.test(abgelehnt.meldung) && abgelehnt.meldung.includes(docId),
  `das Löschen wird abgelehnt und nennt ${docId}`,
  abgelehnt.meldung
);
await bild2('loesch-abgelehnt');

// ── C2. Das Dokument löschen ─────────────────────────────────────────
//
// Erst hinaus, dann löschen: Der Spieler steht in genau dieser Instanz.
// `__vb.admin` schickt die Zeile nur ab — die Antwort kommt als
// Systemmeldung zurück, deshalb wird sie aus dem Chat gelesen und nicht
// aus einem Rückgabewert.
await spiel.evaluate(() => window.__vb.admin('dungeon leave'));
await spiel.waitForTimeout(4000);
const gesendet = await spiel.evaluate((id) => window.__vb.admin(`dungeon delete ${id}`), docId);
await spiel.waitForTimeout(4000);
const chat = await spiel.evaluate(() =>
  document.body.innerText
    .split('\n')
    .filter((z) => /gelöscht|Unbekannter Dungeon/.test(z))
    .map((z) => z.trim())
    .slice(-3)
    .join(' | ')
);
merke(gesendet === true, `\`dungeon delete ${docId}\` abgeschickt`, chat);

// ── C3. Nochmal löschen — jetzt hält den Saal nichts mehr ────────────
await editor2.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await editor2.waitForTimeout(8000);
const geloescht = await loeschVersuch();
merke(
  /gelöscht/.test(geloescht.meldung) && !/Nicht gelöscht/.test(geloescht.meldung),
  'nach dem Löschen des Dokuments geht das Löschen des Saals durch',
  geloescht.meldung
);
await bild2('geloescht');

// ── C4. Registry und assets/generiert deckungsgleich ─────────────────
//
// Zwei Richtungen, und beide fehlen einzeln: Ein Eintrag ohne Datei ist
// ein Katalogplatz, der beim Betreten ins Leere greift; eine Datei ohne
// Eintrag ist still — sie sperrt aber den Namen für immer, weil
// `baueModul` eine vorhandene Datei als „schon gebaut" ablehnt. Die
// erste Richtung lässt sich aus dem Browser messen, die zweite braucht
// ein Verzeichnis; die steht deshalb unten im Bericht des Laufs.
const stand = await editor2.evaluate(async (name) => {
  const hole = async (p) => {
    try {
      return (await fetch(p, { cache: 'no-store' })).status;
    } catch (e) {
      return String(e);
    }
  };
  let registry = null;
  try {
    registry = await (await fetch('/assets/generiert/modul-registry.json', { cache: 'no-store' })).json();
  } catch (e) {
    registry = { fehler: String(e) };
  }
  const namen = (registry?.module ?? []).map((m) => m.name);
  const dateien = {};
  for (const n of namen) dateien[n] = await hole(`/assets/generiert/${n}.glb`);
  return { namen, dateien, geloeschteGlb: await hole(`/assets/generiert/${name}.glb`) };
}, modulName);
merke(!stand.namen.includes(modulName), `${modulName} steht nicht mehr in der Registry`, JSON.stringify(stand.namen));
merke(stand.geloeschteGlb === 404, 'und seine GLB ist fort (404)', String(stand.geloeschteGlb));
merke(
  Object.values(stand.dateien).every((s) => s === 200),
  'jeder verbliebene Registry-Eintrag hat seine Datei',
  JSON.stringify(stand.dateien)
);

await browser.close();
const offen = befunde.filter((b) => !b.ok);
console.log(
  offen.length === 0
    ? `\nAlle ${befunde.length} Prüfungen bestanden. Bilder in ${ORDNER}`
    : `\n${offen.length} von ${befunde.length} Prüfungen offen:\n` +
        offen.map((b) => `  - ${b.was}${b.zusatz ? ` (${b.zusatz})` : ''}`).join('\n')
);
process.exit(offen.length === 0 ? 0 : 1);
