#!/usr/bin/env node
/**
 * Echte Probe zu Paket 0.1: Ein gewoehnlicher Spieler darf keinen
 * Adminbefehl mehr ausfuehren, das Adminkonto schon.
 * Proof for package 0.1: an ordinary player can no longer run admin
 * commands; the admin account still can.
 *
 * ── Warum eine Probe und nicht nur ein Test ──────────────────────────
 * `server/test/standard-konto.ts` prueft gegen die echte `AdminListe`,
 * baut den Aufrufer aber nach. Es kann deshalb nicht beweisen, dass die
 * Rechte auf dem GANZEN Weg greifen — Anmeldung ueber die Konto-API,
 * Handshake im NetManager, `peer.isAdmin`, `canUseAdminCommands`. Genau
 * diesen Weg geht dieses Skript.
 *
 * ── Warum KEIN Testtoken ─────────────────────────────────────────────
 * Die anderen pw-Proben legen ein formgerechtes, ungueltig signiertes
 * Token vor; der Server wuerfelt dann eine frische Identitaet. Fuer diese
 * Frage waere das wertlos — die Rechte haengen an der spielerId eines
 * ECHTEN Charakters. Beide Konten melden sich hier ueber
 * `/accounts/login` und `/accounts/characters/<id>/play` an, genau wie
 * ein Besucher ueber die Webseite.
 *
 * Voraussetzung: ein laufender Server samt Client-Dev-Server (Ports unten
 * bzw. ueber WOV_SPIEL_PORT / WOV_CLIENT_PORT).
 *
 * Erwartete Ausgabe:
 *   gast  → "Admin commands are not allowed for this player"
 *   admin → die Antwort des Befehls
 */
import { chromium } from 'playwright';

const SPIEL = `http://127.0.0.1:${process.env.WOV_SPIEL_PORT ?? 2471}`;
const CLIENT = `http://localhost:${process.env.WOV_CLIENT_PORT ?? 5291}/play/`;
/** Der Befehl, mit dem geprueft wird. `admin liste` ist der schaerfste:
 *  es ist die Verwaltung der Rechteliste selbst. */
const BEFEHL = process.argv[2] ?? 'admin liste';

async function ticketFuer(user, pass) {
  const login = await (await fetch(`${SPIEL}/accounts/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })).json();
  if (!login.characters?.length) throw new Error(`kein Charakter fuer ${user}`);
  const charId = login.characters[0].id;
  const spielen = await (await fetch(`${SPIEL}/accounts/characters/${charId}/play`, {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}` },
  })).json();
  return { ticket: spielen.sessionToken, name: login.characters[0].name };
}

async function probe(browser, user, pass, befehl) {
  const { ticket, name } = await ticketFuer(user, pass);
  if (!ticket) throw new Error(`kein Sitzungstoken fuer ${user}`);
  const kontext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const seite = await kontext.newPage();
  await seite.addInitScript((t) => localStorage.setItem('wov-session-token', t), ticket);
  await seite.goto(CLIENT, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await seite.waitForFunction(() => window.__vb?.admin !== undefined, undefined, {
    timeout: 240_000,
  });
  // Die Antwort kommt als AdminEvent-Paket zurueck und landet ueber
  // hud.meldung() im Bild — also wird das Bild gelesen, nicht die Konsole.
  await seite.evaluate((b) => window.__vb.admin(b), befehl);
  await seite.waitForTimeout(3000);
  const sichtbar = await seite.evaluate(() => document.body.innerText);
  await kontext.close();
  return { name, sichtbar };
}

const browser = await chromium.launch({
  headless: false,
  args: ['--ozone-platform=x11', '--use-angle=vulkan', '--enable-features=Vulkan',
         '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
try {
  for (const [user, pass] of [['gast', 'gast'], ['admin', 'admin']]) {
    const { name, sichtbar } = await probe(browser, user, pass, BEFEHL);
    console.log(`\n── ${user} (Charakter ${name}) — "${BEFEHL}" ──`);
    for (const z of sichtbar.split('\n')) if (/admin|fly|flug/i.test(z)) console.log('   ' + z);
  }
} finally {
  await browser.close();
}
