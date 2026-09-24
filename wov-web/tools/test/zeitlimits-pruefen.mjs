#!/usr/bin/env node
/**
 * Prüft Karte W2: Zeitlimits der Webseiten-Aufrufe und den halben Ablauf von
 * „Auf Fahrt gehen“. Ohne Browser: ein kleiner HTTP-Stub, gegen den die
 * ECHTEN Aufrufe aus src/lib/account.ts und die echte Ablauffunktion aus
 * src/lib/losfahren.ts laufen.
 *
 * Aufruf (in wov-web/):
 *   node --experimental-transform-types tools/test/zeitlimits-pruefen.mjs [--port 2487] [--wurzel .]
 *
 * `--wurzel` zeigt auf ein anderes wov-web (z. B. ein `git archive` des alten
 * Stands). Fehlt dort src/lib/losfahren.ts, läuft an dessen Stelle der Ablauf,
 * wie ihn die Seite vor W2 inline hatte (anlegen, dann play, ohne Gedächtnis);
 * das steht in der Ausgabe.
 *
 * Es endet mit Exit 0 nur, wenn jede Zusage hält. Der Stub wird am Ende
 * geschlossen; der Port ist danach frei (Ausgabe „Port frei“).
 */
import { createServer } from 'node:http';
import { createServer as testeServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('--port', '2487'));
const WURZEL = resolve(arg('--wurzel', '.'));

// account.ts liest die Adresse der Küste aus einer Vite-`define`-Konstante.
globalThis.WOV_DEV_ORIGIN = `http://127.0.0.1:${PORT}`;

const account = await import(pathToFileURL(resolve(WURZEL, 'src/lib/account.ts')).href);
const hatAblauf = existsSync(resolve(WURZEL, 'src/lib/losfahren.ts'));
const ablauf = hatAblauf
  ? await import(pathToFileURL(resolve(WURZEL, 'src/lib/losfahren.ts')).href)
  : null;

// Das Limit, gegen das gemessen wird; im alten Stand gibt es keins.
const LIMIT = account.CALL_TIMEOUT_MS ?? 20000;
const SKRIPT_LIMIT = LIMIT + 1000;

/* ------------------------------------------------------------------ Stub */

/** Zustand je Szenario; das Szenario steht im Token (x-wov-account). */
const szenarien = new Map();
const zustand = (name) => {
  if (!szenarien.has(name)) {
    szenarien.set(name, { helden: [], anlegen: 0, play: [], me: 0, verhalten: {}, naechsteId: 100 });
  }
  return szenarien.get(name);
};

const offen = new Set();
const stub = createServer((req, res) => {
  offen.add(res);
  res.on('close', () => offen.delete(res));
  const z = zustand(String(req.headers['x-wov-account'] ?? 'ohne'));
  const v = z.verhalten;
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const json = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const url = req.url ?? '';
    if (v.nieAntworten && v.nieAntworten(url, req.method)) return; // Verbindung angenommen, nie eine Antwort
    if (v.kopfDannStille && v.kopfDannStille(url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"acc');
      return; // Kopf gesendet, Rumpf bleibt stehen
    }
    if (url === '/accounts/login' || url === '/accounts/register') {
      return json(200, { token: 't', account: { id: 1, username: 'x' } });
    }
    if (url === '/accounts/me') {
      z.me++;
      return json(200, { account: { id: 1, username: 'x' }, characters: z.helden });
    }
    if (url === '/accounts/characters' && req.method === 'POST') {
      z.anlegen++;
      const w = JSON.parse(body);
      const vergeben = (v.fremd ?? []).concat(z.helden.map((h) => h.name));
      if (vergeben.some((n) => n.toLowerCase() === w.name.toLowerCase())) {
        return json(409, { error: 'name-taken' });
      }
      const held = { id: z.naechsteId++, ...w, created: Date.now(), lastPlayed: null };
      if (v.speichernOhneAntwort && z.anlegen === 1) {
        z.helden.push(held); // beim Server angekommen …
        return; // … Antwort geht verloren
      }
      if (v.hangErsteAnlage && z.anlegen === 1) return; // nicht gespeichert, keine Antwort
      z.helden.push(held);
      return json(201, { character: held });
    }
    const m = /^\/accounts\/characters\/(\d+)\/play$/.exec(url);
    if (m) {
      z.play.push(Number(m[1]));
      if (!z.helden.some((h) => h.id === Number(m[1]))) return json(404, { error: 'unknown' });
      if (v.playFehler && z.play.length <= v.playFehler) return json(503, { error: 'server-error' });
      return json(200, { sessionToken: 'ticket-' + m[1], character: z.helden.find((h) => h.id === Number(m[1])) });
    }
    json(404, { error: 'unknown' });
  });
});
await new Promise((ok) => stub.listen(PORT, '127.0.0.1', ok));

/* --------------------------------------------------------------- Hilfen */

const ergebnisse = [];
const pruefe = (name, ok, detail = '') => {
  ergebnisse.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

/** Läuft `fn`; endet es nicht binnen `grenze` ms, gilt es als hängend. */
async function messe(fn, grenze) {
  const t0 = performance.now();
  let ende;
  const stopp = new Promise((ok) => (ende = setTimeout(() => ok({ haengt: true }), grenze)));
  const lauf = fn().then(
    (wert) => ({ wert }),
    (fehler) => ({ fehler }),
  );
  const r = await Promise.race([lauf, stopp]);
  clearTimeout(ende);
  return { ...r, ms: Math.round(performance.now() - t0) };
}

const wunsch = (name = 'Ragnar') => ({
  name,
  figure: 'wikinger',
  hairstyle: 'H_04',
  hairColor: 'blond',
  eyeColor: 'blau',
  classId: 'krieger',
  top: '',
  legs: '',
});

/** Der Ablauf der Seite: neu (`losfahren.ts`) oder, im alten Stand, inline. */
function baueAblauf(token) {
  const konto = {
    createCharacter: (w) => account.createCharacter('dev', token, w),
    characters: () => account.me('dev', token),
    play: (id) => account.play('dev', token, id),
  };
  if (ablauf) {
    const fahrt = ablauf.neueFahrt();
    return (w) => ablauf.fahreLos(konto, fahrt, w);
  }
  // Alter Stand: so rief die Seite es auf (createCharacter, dann play).
  return async (w) => {
    const neu = await konto.createCharacter({ ...w, name: w.name.trim() });
    return konto.play(neu.character.id);
  };
}

const schluessel = (r) => r.fehler?.key ?? (r.haengt ? 'HÄNGT' : r.fehler ? String(r.fehler) : null);

console.log(`Stub auf 127.0.0.1:${PORT}, Limit ${LIMIT} ms, Skript-Limit ${SKRIPT_LIMIT} ms`);
console.log(hatAblauf ? 'Ablauf: src/lib/losfahren.ts' : 'Ablauf: INLINE-Nachbau des alten Stands (kein losfahren.ts)');

/* ------------------------------------------------- a) nie antworten */
async function szenarioA() {
  const z = zustand('a');
  z.verhalten.nieAntworten = () => true;
  const aufrufe = {
    login: () => account.login('dev', 'x', 'passwort1'),
    register: () => account.register('dev', 'x', 'x@example.org', 'passwort1'),
    createCharacter: () => account.createCharacter('dev', 'a', wunsch()),
    play: () => account.play('dev', 'a', 1),
    me: () => account.me('dev', 'a'),
    deleteCharacter: () => account.deleteCharacter('dev', 'a', 1),
  };
  // login/register senden kein Token: ihr Szenario ist `ohne`.
  zustand('ohne').verhalten.nieAntworten = () => true;
  const r = await Promise.all(Object.entries(aufrufe).map(async ([n, f]) => [n, await messe(f, SKRIPT_LIMIT)]));
  for (const [n, m] of r) {
    pruefe(`a) ${n} ohne Antwort endet mit ApiError('timeout') in ≤ Limit+1 s`,
      schluessel(m) === 'timeout' && m.ms <= SKRIPT_LIMIT && m.ms >= LIMIT - 200,
      `${m.ms} ms, Ergebnis ${schluessel(m)}`);
  }
  // Kopf da, Rumpf hängt: darf nicht als Erfolg mit `null` enden.
  zustand('ak').verhalten.kopfDannStille = () => true;
  const k = await messe(() => account.me('dev', 'ak'), SKRIPT_LIMIT);
  pruefe('a) Antwortkopf gesendet, Rumpf hängt: ApiError(\'timeout\'), kein stiller Erfolg',
    schluessel(k) === 'timeout' && k.ms <= SKRIPT_LIMIT, `${k.ms} ms, Ergebnis ${schluessel(k) ?? 'Wert ' + JSON.stringify(k.wert)}`);
  // Die Statusabfrage behält ihre 4 s.
  zustand('ohne').verhalten.nieAntworten = () => true;
  const s = await messe(() => account.shoreStatus('dev'), 6000);
  pruefe('a) shoreStatus endet weiter nach 4 s', schluessel(s) === 'timeout' || schluessel(s) === 'network' ? s.ms >= 3800 && s.ms <= 5000 : false,
    `${s.ms} ms, Ergebnis ${schluessel(s)}`);
}

/* ------------------------------------- b) create ok, play 503, nochmal */
async function szenarioB() {
  const z = zustand('b');
  z.verhalten.playFehler = 1;
  const los = baueAblauf('b');
  const e1 = await messe(() => los(wunsch()), 5000);
  const e2 = await messe(() => los(wunsch()), 5000);
  pruefe('b) erster Versuch scheitert an play mit server-error', schluessel(e1) === 'server-error', `${e1.ms} ms`);
  pruefe('b) zweiter Versuch liefert das Ticket', e2.wert?.sessionToken === 'ticket-100', JSON.stringify(e2.wert?.sessionToken ?? schluessel(e2)));
  pruefe('b) Stub zählt 1× Anlegen und 2× play (gleiche Id)', z.anlegen === 1 && z.play.length === 2 && z.play[0] === z.play[1],
    `anlegen=${z.anlegen}, play=${JSON.stringify(z.play)}`);
  // Name geändert → neuer Wunsch, neuer Recke (nichts wird still wiederverwendet).
  const e3 = await messe(() => los(wunsch('Bjorn')), 5000);
  pruefe('b) anderer Name nach halbem Ablauf legt einen neuen Recken an', e3.wert?.sessionToken === 'ticket-101' && z.anlegen === 2,
    `anlegen=${z.anlegen}, ${e3.wert?.sessionToken ?? schluessel(e3)}`);
}

/* ---------- c) Anlage kam an, Antwort ging verloren (Zeitablauf) */
async function szenarioC() {
  const z = zustand('c');
  z.verhalten.speichernOhneAntwort = true;
  const los = baueAblauf('c');
  const e1 = await messe(() => los(wunsch()), SKRIPT_LIMIT + 2000);
  pruefe('c) erster Versuch endet mit timeout', schluessel(e1) === 'timeout' && e1.ms <= SKRIPT_LIMIT, `${e1.ms} ms, ${schluessel(e1)}`);
  const e2 = await messe(() => los(wunsch()), 5000);
  pruefe('c) zweiter Versuch: eigener Recke gefunden, Ticket, KEIN name-taken', e2.wert?.sessionToken === 'ticket-100' && !e2.fehler,
    `${e2.wert?.sessionToken ?? schluessel(e2)}`);
  pruefe('c) Stub: 1 Recke im Konto, Kontoabfrage 1×, play mit dessen Id', z.helden.length === 1 && z.me === 1 && z.play.join() === '100',
    `helden=${z.helden.length}, me=${z.me}, play=${JSON.stringify(z.play)}, anlegen=${z.anlegen}`);
}

/* -------------------------------------------- d) fremder Name bleibt */
async function szenarioD() {
  // d1: frischer Versuch, Name gehört einem anderen Konto.
  const d1 = zustand('d1');
  d1.verhalten.fremd = ['Ragnar'];
  const r1 = await messe(() => baueAblauf('d1')(wunsch()), 5000);
  pruefe('d) fremder Name: name-taken, kein play', schluessel(r1) === 'name-taken' && d1.play.length === 0, `${schluessel(r1)}, play=${d1.play.length}`);
  // d2: nach einem Zeitablauf (nicht gespeichert), Name danach von einem Fremden vergeben.
  const d2 = zustand('d2');
  d2.verhalten.hangErsteAnlage = true;
  const los = baueAblauf('d2');
  const a = await messe(() => los(wunsch()), SKRIPT_LIMIT + 2000);
  d2.verhalten.fremd = ['Ragnar'];
  const b = await messe(() => los(wunsch()), 5000);
  pruefe('d) nach Zeitablauf, Name inzwischen fremd: Konto abgefragt, kein eigener → name-taken',
    schluessel(a) === 'timeout' && schluessel(b) === 'name-taken' && d2.me === 1 && d2.play.length === 0,
    `${schluessel(a)} dann ${schluessel(b)}, me=${d2.me}, play=${d2.play.length}`);
  // d4: unklarer Versuch, das Konto hat einen eigenen Recken mit ANDEREM Namen, ein Fremder hält den Wunschnamen.
  const d4 = zustand('d4');
  d4.verhalten.hangErsteAnlage = true;
  const los4 = baueAblauf('d4');
  const a4 = await messe(() => los4(wunsch()), SKRIPT_LIMIT + 2000);
  d4.helden.push({ id: 7, ...wunsch('Sven'), created: 1, lastPlayed: null });
  d4.verhalten.fremd = ['Ragnar'];
  const b4 = await messe(() => los4(wunsch()), 5000);
  pruefe('d) unklarer Versuch, eigener Recke mit anderem Namen, Wunschname fremd: name-taken, play=0',
    schluessel(a4) === 'timeout' && schluessel(b4) === 'name-taken' && d4.play.length === 0 && d4.me === 1,
    `${schluessel(a4)} dann ${schluessel(b4)}, me=${d4.me}, play=${d4.play.length}`);
  // d3: Konto hat schon einen Recken dieses Namens, aber es gab keinen unklaren Versuch → nicht still übernehmen.
  const d3 = zustand('d3');
  d3.helden.push({ id: 7, ...wunsch(), created: 1, lastPlayed: null });
  const r3 = await messe(() => baueAblauf('d3')(wunsch()), 5000);
  pruefe('d) vorhandener gleichnamiger Recke ohne unklaren Versuch wird NICHT still übernommen',
    schluessel(r3) === 'name-taken' && d3.play.length === 0, `${schluessel(r3)}, me=${d3.me}, play=${d3.play.length}`);
}

/* ---- e) play mit endgültiger Absage: Gedächtnis fällt, nächster Klick legt neu an */
async function szenarioE() {
  const z = zustand('e');
  z.verhalten.playFehler = 1;
  const los = baueAblauf('e');
  const e1 = await messe(() => los(wunsch()), 5000);
  z.helden.length = 0; // der Recke wird anderswo gelöscht
  const e2 = await messe(() => los(wunsch()), 5000);
  const e3 = await messe(() => los(wunsch()), 5000);
  pruefe('e) play 503, Recke danach weg: Klick 2 meldet unknown', schluessel(e1) === 'server-error' && schluessel(e2) === 'unknown',
    `${schluessel(e1)}, ${schluessel(e2)}`);
  pruefe('e) Klick 3 legt neu an und liefert das Ticket (kein Hängen auf der toten Id)',
    e3.wert?.sessionToken === 'ticket-101' && z.anlegen === 2 && z.play.join() === '100,100,101',
    `${e3.wert?.sessionToken ?? schluessel(e3)}, anlegen=${z.anlegen}, play=${JSON.stringify(z.play)}`);
}

try {
  await Promise.all([szenarioA(), szenarioB(), szenarioC(), szenarioD(), szenarioE()]);
} finally {
  for (const r of offen) r.destroy();
  await new Promise((ok) => stub.close(ok));
}

// Port frei?
const frei = await new Promise((ok) => {
  const t = testeServer();
  t.once('error', () => ok(false));
  t.listen(PORT, '127.0.0.1', () => t.close(() => ok(true)));
});
pruefe('Port frei nach dem Lauf', frei, `${PORT}`);

const gut = ergebnisse.filter(Boolean).length;
console.log(`\n${gut}/${ergebnisse.length} Prüfungen bestanden`);
process.exit(gut === ergebnisse.length ? 0 : 1);
