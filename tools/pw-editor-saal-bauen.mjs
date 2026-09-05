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
 * Bilder: ~/.cache/wov-saal-bauen/
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST_EDITOR = 'https://editor.dev.world-of-vikings.com/editor.html';
const HOST_SPIEL = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-saal-bauen`;
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
  const p = `${ORDNER}/${String(nr).padStart(2, '0')}-${tag}.png`;
  await seite.screenshot({ path: p });
  console.log(`  Bild ${p}`);
  return p;
};
const knopf = (text) =>
  seite.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
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
const formularDa = await seite.evaluate(() => document.body.innerText.includes('Neuer Saal'));
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
  return { ok: true, kopf: document.body.innerText.split('\n').find((z) => /Räume, \d+ Türen/.test(z)) ?? '' };
}, modulName);
merke(gesetzt.ok === true, 'der gebaute Saal ist angefügt', JSON.stringify(gesetzt));
await bild('angefuegt');

await knopf('Speichern');
await seite.waitForTimeout(8000);
const gespeichert = await seite.evaluate(() =>
  document.body.innerText.split('\n').filter((z) => /Gespeichert|abgelehnt|veraltet/.test(z)).join(' | ')
);
// „Registry veraltet — Seite neu laden" wäre hier der interessanteste
// Fehlschlag: Er hiesse, dass die Prüfsumme des Browsers und die des
// Servers auseinanderliegen, obwohl beide dasselbe Modul kennen sollten.
merke(/Gespeichert/.test(gespeichert), 'gespeichert', gespeichert);
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
const halbX = (Number(breite) * 2) / 2;
const halbZ = (Number(tiefe) * 2) / 2;
const start = { x: saal.x - halbX + 1.0, z: saal.z - halbZ + 1.0 };
const ziel = { x: saal.x + halbX - 1.0, z: saal.z + halbZ - 1.0 };
await spiel.evaluate((s) => {
  const p = window.__dbg.player;
  p.position.x = s.x;
  p.position.z = s.z;
}, start);
await spiel.waitForTimeout(1500);
await spiel.evaluate((yy) => {
  const p = window.__dbg.player;
  p._yaw = yy;
  p._figurYaw = yy;
  p._pitch = -0.05;
}, Math.atan2(ziel.x - start.x, ziel.z - start.z));
await spiel.waitForTimeout(400);

await spiel.keyboard.down('KeyW');
const spur = [];
for (let i = 0; i < 32; i++) {
  await spiel.waitForTimeout(250);
  spur.push(
    await spiel.evaluate((z) => {
      const p = window.__dbg.player.position;
      return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), rest: +Math.hypot(z.x - p.x, z.z - p.z).toFixed(2) };
    }, ziel)
  );
  if (spur[spur.length - 1].rest < 0.8) break;
}
await spiel.keyboard.up('KeyW');
let haenger = 0;
for (let i = 1; i < spur.length; i++) {
  const weg = Math.hypot(spur[i].x - spur[i - 1].x, spur[i].z - spur[i - 1].z);
  if (weg < 0.05 && spur[i].rest > 1.0) haenger++;
}
merke(
  spur[spur.length - 1].rest < 1.2 && haenger === 0,
  'die Diagonale ist ohne Hänger begehbar',
  `Restweg ${spur[spur.length - 1].rest} m, ${haenger} Abtastung(en) ohne Fortschritt, ` +
    `${spur.length} Abtastungen`
);
console.log(`   Spur: ${spur.map((s) => s.rest).join(' → ')}`);

// ── 8. Lichtfugen zählen ─────────────────────────────────────────────
//
// Gezählt wird OHNE Belichtungsanhebung, und das ist die ganze Aussage:
// „Hell" soll Licht heissen, das durch eine Fuge fällt, nicht ein
// aufgedrehter Regler. Die Schwelle und die drei Zonen sind dieselben wie
// in `tools/elements/pruefung/zaehle-naht.py`, damit sich die Zahlen
// neben ein Rendering legen lassen.
await spiel.evaluate(() => {
  window.__dbg.scene.imageProcessingConfiguration.exposure = 1;
});
await spiel.evaluate((s) => {
  const p = window.__dbg.player;
  p.position.x = s.x;
  p.position.z = s.z;
}, { x: saal.x, z: saal.z });
await spiel.waitForTimeout(1500);

const RICHTUNGEN = [['nord', 0], ['ost', Math.PI / 2], ['sued', Math.PI], ['west', -Math.PI / 2]];
let fugenGesamt = 0;
for (const [tag, yaw] of RICHTUNGEN) {
  await spiel.evaluate((yy) => {
    const p = window.__dbg.player;
    p._yaw = yy;
    p._figurYaw = yy;
    p._pitch = -0.05;
  }, yaw);
  await spiel.waitForTimeout(800);
  const zaehlung = await spiel.evaluate(() => {
    // Leinwand in eine Hilfsleinwand und die Bildpunkte heraus — dasselbe
    // Vorgehen wie in tools/dungeon2-speckle-guard.mjs.
    const leinwand = document.querySelector('canvas');
    const hilfs = document.createElement('canvas');
    hilfs.width = leinwand.width;
    hilfs.height = leinwand.height;
    const ctx = hilfs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(leinwand, 0, 0);
    const d = ctx.getImageData(0, 0, hilfs.width, hilfs.height).data;
    const SCHWELLE = 200;
    const h = hilfs.height;
    const zonen = [0, 0, 0];
    let hell = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) < SCHWELLE) continue;
      hell++;
      const y = Math.floor(i / 4 / hilfs.width);
      zonen[y < h / 4 ? 0 : y < (3 * h) / 4 ? 1 : 2]++;
    }
    return { breite: hilfs.width, hoehe: h, hell, deckeWand: zonen[0], wand: zonen[1], bodenWand: zonen[2] };
  });
  fugenGesamt += zaehlung.hell;
  console.log(`   ${tag}: ${JSON.stringify(zaehlung)}`);
  nr++;
  await spiel.screenshot({ path: `${ORDNER}/${String(nr).padStart(2, '0')}-fuge-${tag}.png` });
}
// Null ist die Erwartung, nicht das Ideal: Ein Saal ist rundum von
// Wandmodulen umschlossen, es gibt keine Aussenwelt, die hereinleuchten
// könnte. Jeder helle Bildpunkt ist deshalb entweder eine Fuge oder eine
// Fackel im Bild — und beide will man gesehen haben.
merke(fugenGesamt === 0, 'keine Lichtfuge an den Anschlusskanten', `${fugenGesamt} helle Bildpunkte`);

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
  await spiel.screenshot({ path: `${ORDNER}/${String(nr).padStart(2, '0')}-hell-${tag}.png` });
}

await browser.close();
const offen = befunde.filter((b) => !b.ok);
console.log(
  offen.length === 0
    ? `\nAlle ${befunde.length} Prüfungen bestanden. Bilder in ${ORDNER}`
    : `\n${offen.length} von ${befunde.length} Prüfungen offen:\n` +
        offen.map((b) => `  - ${b.was}${b.zusatz ? ` (${b.zusatz})` : ''}`).join('\n')
);
process.exit(offen.length === 0 ? 0 : 1);
