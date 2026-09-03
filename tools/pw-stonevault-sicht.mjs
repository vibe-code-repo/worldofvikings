#!/usr/bin/env node
/**
 * Sichtprüfung des Modul-Kits auf play.dev — mit eigenem Testcharakter und
 * Beweisbildern: Gang/Halle im Handbau-Dokument, Texturen pro Dokument und
 * pro Raum (Konsolenbefehl `dungeon steinkit`), F4-Editor mit dem Feld
 * „Ausrichtung" (Wand entfernen → Raum mit gewählter Kante anfügen →
 * „Speichern als").
 * Visual check of the module kit on play.dev with an own test character.
 *
 *   node tools/pw-stonevault-sicht.mjs <dungeonId> [yawGrad=270] [raumIndex=3] [f4Id=<dungeonId>-f4]
 *
 * JEDES Szenario läuft in einer EIGENEN Browsersitzung mit eigenem
 * Charakter. Der Grund: Nach `dungeon enter` in einer laufenden Sitzung
 * (Neu-Betreten) laufen Client- und Serverposition auseinander, und der
 * Abgleich zieht die Figur beim Losgehen um zehn Meter weg — gemessen am
 * 03.09.2026, s. Memory „Serverposition kennt keine Wände". Ein frischer
 * Beitritt hat das Problem nicht.
 * Each scenario runs in its own browser session with a fresh character:
 * re-entering within one session desyncs client and server position.
 *
 * Anmeldung wie in pw-dungeon2-playdev.mjs (Testtoken, kein Passwort).
 * Bilder: ~/.cache/wov-stonevault-sicht/<dungeonId>-*.png
 * Das Dokument wird am Ende auf seine Vorgabe-Texturen zurückgesetzt; der
 * F4-Test speichert unter einer EIGENEN id.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = 'https://play.dev.world-of-vikings.com';
const ORDNER = `${process.env.HOME}/.cache/wov-stonevault-sicht`;
const BENUTZER = process.env.WOV_DEV_USER ?? 'Admin';
const PASSWORT = process.env.WOV_DEV_PASS ?? '!T3mp12345';
const GPU_FLAGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

const [dungeonId, yawGradRoh = '270', raumRoh = '5', f4IdRoh] = process.argv.slice(2);
if (!dungeonId) { console.error('Aufruf: node tools/pw-stonevault-sicht.mjs <dungeonId> [yawGrad] [raumIndex] [f4Id]'); process.exit(2); }
const yaw = (Number(yawGradRoh) * Math.PI) / 180;
const raumIndex = Number(raumRoh);
const f4Id = f4IdRoh ?? `${dungeonId}-f4`;
// Erwartete Laufrichtung: forward = (−sin yaw, −cos yaw) (PlayerController.ts).
const erwDx = -Math.sin(yaw), erwDz = -Math.cos(yaw);

function testToken() {
  const nutzlast = Buffer.from(JSON.stringify({ e: Date.now() + 3600_000 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${nutzlast}.testlauf`;
}

mkdirSync(ORDNER, { recursive: true });
const browser = await chromium.launch({ headless: true, args: GPU_FLAGS });
let bildNr = 0;

/** Eine Sitzung: eigener Kontext, eigener Charakter, betritt `id`, führt `ablauf(s)` aus. */
async function sitzung(id, ablauf) {
  const kontext = await browser.newContext({ viewport: { width: 1600, height: 900 }, httpCredentials: { username: BENUTZER, password: PASSWORT } });
  const seite = await kontext.newPage();
  const fehler = [];
  seite.on('pageerror', (f) => fehler.push(String(f)));
  await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), testToken());
  const name = `Sicht${Date.now().toString(36).slice(-5)}`;
  await seite.goto(`${HOST}/?name=${name}&dungeon=${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await seite.waitForFunction(() => window.__dbg?.imDungeon === true, undefined, { timeout: 240_000 });
  await seite.waitForTimeout(10_000);
  await seite.evaluate(() => { window.__dbg.scene.imageProcessingConfiguration.exposure = 6; });

  const s = {
    seite,
    lage: () => seite.evaluate(() => { const p = window.__dbg.player; return { x: +p.position.x.toFixed(1), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(1) }; }),
    blick: (y, pitch = -0.1) => seite.evaluate(([y, p]) => { const pl = window.__dbg.player; pl._yaw = y; pl._figurYaw = y; pl._pitch = p; }, [y, pitch]),
    admin: (zeile) => seite.evaluate((z) => window.__vb.admin(z), zeile),
    bild: async (tag) => { bildNr++; const p = `${ORDNER}/${dungeonId}-${String(bildNr).padStart(2, '0')}-${tag}.png`; await seite.screenshot({ path: p }); console.log(`  Bild ${p.split('/').pop()}`); },
    mausGefangen: false,
    yawEff: yaw,
  };
  // Maus EINMAL fangen — der Klick bewegt den Zeiger nach (800,450), und unter Pointer-Lock addiert
  // dieses Delta auf `_yaw` (PlayerController.ts ~669). Deshalb: erst fangen, DANN den Blick setzen.
  s.mausFangen = async () => { if (s.mausGefangen) return; await seite.mouse.click(800, 450); await seite.waitForTimeout(400); s.mausGefangen = true; };
  s.laufen = async (sek) => { await s.mausFangen(); await seite.keyboard.down('KeyW'); await seite.waitForTimeout(sek * 1000); await seite.keyboard.up('KeyW'); await seite.waitForTimeout(500); };
  // In Weltrichtung (dx,dz) gehen: yaw ableiten, 0,4 s anlaufen, Vorzeichen prüfen, ggf. umdrehen.
  s.geheRichtung = async (dx, dz, sek) => {
    await s.mausFangen();
    let y = Math.atan2(-dx, -dz);
    await s.blick(y);
    const a = await s.lage();
    await s.laufen(0.4);
    const b = await s.lage();
    if ((b.x - a.x) * dx + (b.z - a.z) * dz < 0) { y += Math.PI; await s.blick(y); console.log(`  Laufrichtung korrigiert (${dx},${dz})`); }
    s.yawEff = y;
    if (sek > 0.4) await s.laufen(sek - 0.4);
    return s.lage();
  };
  // Bis zu einer Weltkoordinate laufen — Positionen sind verlässlich, Laufzeiten nicht.
  s.geheBis = async (achse, ziel, maxSek = 8) => {
    await s.mausFangen();
    await seite.keyboard.down('KeyW');
    const t0 = Date.now();
    let l = await s.lage();
    const vor = l[achse] < ziel;
    while (Date.now() - t0 < maxSek * 1000) {
      await seite.waitForTimeout(150);
      l = await s.lage();
      if (vor ? l[achse] >= ziel : l[achse] <= ziel) break;
    }
    await seite.keyboard.up('KeyW');
    await seite.waitForTimeout(500);
    return s.lage();
  };
  console.log(`Sitzung ${name} in ${id}: Start ${JSON.stringify(await s.lage())}`);
  try {
    await ablauf(s);
  } finally {
    if (fehler.length) console.log(`  Seitenfehler: ${fehler.length} (erste: ${fehler[0].slice(0, 200)})`);
    await kontext.close();
  }
}

// Probe-Layout (sicht-probe): Eingang bei x 0, Korridore x 1..5, Halle x 5..9 (Mitte 7), weiter +x.
const gangUndHalle = async (s, tag) => {
  await s.geheRichtung(erwDx, erwDz, 0.4);
  await s.geheBis('x', 2.5);
  await s.bild(`${tag}-korridor-anfang`);
  await s.geheBis('x', 4.3);
  await s.bild(`${tag}-korridor`);
  const h = await s.geheBis('x', 7.0);
  console.log(`  Halle erreicht bei ${JSON.stringify(h)}`);
  await s.bild(`${tag}-halle`);
  await s.blick(s.yawEff + Math.PI / 2); await s.seite.waitForTimeout(600); await s.bild(`${tag}-halle-links`);
  await s.blick(s.yawEff - Math.PI / 2); await s.seite.waitForTimeout(600); await s.bild(`${tag}-halle-rechts`);
  await s.blick(s.yawEff, 0.35); await s.seite.waitForTimeout(600); await s.bild(`${tag}-halle-decke`);
};

// ── 1. Vorgabe-Texturen ────────────────────────────────────────────────
await sitzung(dungeonId, async (s) => {
  await gangUndHalle(s, 'vorgabe');
  console.log('  Dokument-Textur setzen: wand=stein_moos moos=4 boden=stein_frost frost=3');
  await s.admin(`dungeon steinkit ${dungeonId} wand=stein_moos moos=4 boden=stein_frost frost=3`);
  await s.seite.waitForTimeout(1500);
});

// ── 2. Texturen pro Dokument (frische Sitzung) ─────────────────────────
await sitzung(dungeonId, async (s) => {
  await gangUndHalle(s, 'dokument');
  console.log(`  Raum-Textur setzen: room=${raumIndex} boden=stein_frost frost=4 decke=stein_moos moos=4 (Dokument zurück auf Vorgabe)`);
  await s.admin(`dungeon steinkit ${dungeonId} reset`);
  await s.seite.waitForTimeout(800);
  await s.admin(`dungeon steinkit ${dungeonId} room=${raumIndex} boden=stein_frost frost=4 decke=stein_moos moos=4`);
  await s.seite.waitForTimeout(1500);
});

// ── 3. Textur pro Raum (frische Sitzung) ───────────────────────────────
// Der Raumindex sollte auf die Halle zeigen (Boden + Decke): Sie ist vom Korridor aus als Ganzes zu sehen —
// in den 1,4 m schmalen Korridoren steckt die Verfolgerkamera in der Wand, dort ist kein Bild zu machen.
await sitzung(dungeonId, async (s) => {
  await s.geheRichtung(erwDx, erwDz, 0.4);
  await s.geheBis('x', 3.6);
  await s.bild('raum-blick-aus-korridor-auf-raum');
  await s.geheBis('x', 7.0);
  await s.bild('raum-im-ueberschriebenen-raum');
  await s.blick(s.yawEff, 0.4); await s.seite.waitForTimeout(600); await s.bild('raum-decke');
  await s.blick(s.yawEff, -0.45); await s.seite.waitForTimeout(600); await s.bild('raum-boden');
  await s.admin(`dungeon steinkit ${dungeonId} room=${raumIndex} reset`);
  await s.seite.waitForTimeout(800);
});

// ── 4. F4-Editor: Ausrichtung wählen, anfügen, speichern als ───────────
let f4 = null;
await sitzung(dungeonId, async (s) => {
  const { seite } = s;
  await seite.keyboard.press('F4');
  await seite.waitForTimeout(1500);
  const panelDa = await seite.evaluate(() => {
    const t = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Dungeon-Editor');
    return !!t && getComputedStyle(t.parentElement.parentElement).display !== 'none';
  });
  console.log(`  F4-Panel sichtbar: ${panelDa}`);
  await s.bild('f4-panel');
  f4 = await seite.evaluate(async ([raumName, neueId]) => {
    const warte = (ms) => new Promise((r) => setTimeout(r, ms));
    const titel = [...document.querySelectorAll('div')].find((d) => d.textContent === 'Dungeon-Editor');
    const panel = titel.parentElement;
    const knopf = (text) => [...panel.querySelectorAll('button')].find((b) => b.textContent === text);
    const [connWahl, raumWahl, ausrichtungWahl] = panel.querySelectorAll('select');
    const xKnoepfe = [...panel.querySelectorAll('button')].filter((b) => b.textContent === '✕' && b.title === 'Raum entfernen');
    if (xKnoepfe.length === 0) return { fehler: 'kein entfernbarer Raum' };
    xKnoepfe[xKnoepfe.length - 1].click();
    await warte(300);
    const offen = [...connWahl.options].map((o) => o.textContent);
    raumWahl.value = raumName;
    raumWahl.dispatchEvent(new Event('change'));
    await warte(100);
    const ausrichtungen = [...ausrichtungWahl.options].map((o) => o.textContent);
    if (ausrichtungWahl.options.length > 1) { ausrichtungWahl.selectedIndex = 1; ausrichtungWahl.dispatchEvent(new Event('change')); }
    const gewaehlt = ausrichtungWahl.options[ausrichtungWahl.selectedIndex]?.textContent;
    knopf('Anfügen').click();
    await warte(300);
    const statusZeile = [...panel.querySelectorAll('div')].map((d) => d.textContent).filter((t) => t.length < 80 && /ungespeichert|Kollision|Connector|angef/i.test(t)).slice(-1)[0] ?? '';
    panel.querySelector('input[placeholder="neue-id"]').value = neueId;
    knopf('Speichern als').click();
    return { offen, ausrichtungen, gewaehlt, statusZeile };
  }, ['StoneVaultCorridor', f4Id]);
  console.log(`  F4: ${JSON.stringify(f4)}`);
  await seite.waitForTimeout(1200);
  await s.bild('f4-nach-anfuegen');
  await seite.waitForTimeout(6000);
});

// ── 5. Das per F4 gespeicherte Dokument frisch betreten ────────────────
await sitzung(f4Id, async (s) => {
  // Der neue Korridor hängt nördlich (+z) am Eingang (Ausrichtung „Nord #0"); sein fernes Ende ist OFFEN
  // (der Editor setzt keine Abschlüsse), also nur bis z 1 hinein und dann zurückschauen.
  await s.geheRichtung(0, 1, 0.4);
  const im = await s.geheBis('z', 1.0, 4);
  console.log(`  im neuen Korridor: ${JSON.stringify(im)}`);
  await s.bild('f4-gespeichert-neuer-korridor');
  await s.blick(s.yawEff + Math.PI); await s.seite.waitForTimeout(600);
  await s.bild('f4-gespeichert-rueckblick-zum-eingang');
});

await browser.close();
