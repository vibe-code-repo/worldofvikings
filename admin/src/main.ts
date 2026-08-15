/**
 * Betriebsdienst der Live-Instanz — die Gegenstelle der Einstellungsseite
 * im Editor.
 *
 * ── Warum ein EIGENER Prozess ────────────────────────────────────────
 * Er muss `wov-server` neu starten können. Ein Teil des Spielservers zu
 * sein hiesse, sich selbst abzuschiessen — deshalb ein getrennter,
 * winziger Dienst mit eigener systemd-Unit.
 *
 * ── Warum das sicher ist ─────────────────────────────────────────────
 * Drei Schranken, die zusammenwirken:
 *
 *  1. Er lauscht NUR auf der internen Bruecke (10.10.10.x). Von aussen
 *     leitet der Proxmox-Host ausschliesslich 80 und 443 auf den Nginx
 *     Proxy Manager weiter — dieser Port ist im Internet nicht erreichbar.
 *  2. Jede Anfrage braucht den Token aus TOKEN_DATEI. Den kennt nur die
 *     Bau-Instanz; im BROWSER taucht er nie auf, weil der Vite-Server
 *     dort die Anfragen weiterreicht und den Kopf serverseitig setzt.
 *  3. Davor steht die Basic-Auth des Editors im Proxy Manager.
 *
 * Ohne (1) waere (2) allein zu duenn — ein Token in einer Datei ist kein
 * Ersatz fuer eine Firewall. Wer den Dienst je oeffentlich erreichbar
 * macht, muss zuerst eine echte Anmeldung davorsetzen.
 *
 * ── Was er NICHT tut ─────────────────────────────────────────────────
 * Kein beliebiges Kommando ausfuehren. Jeder Endpunkt macht genau eine
 * fest verdrahtete Sache; die Dienstnamen sind eine Positivliste. Ein
 * "fuehre aus, was ich schicke" waere bequem und genau die Luecke, die
 * man hinterher bereut.
 *
 * Start:  node --import tsx admin/src/main.ts
 * Umgebung: WOV_ADMIN_PORT (Vorgabe 2468), WOV_WURZEL (Projektpfad)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ausfuehren = promisify(execFile);

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = process.env.WOV_WURZEL ?? resolve(HIER, '../..');
const PORT = Number(process.env.WOV_ADMIN_PORT ?? 2468);
const TOKEN_DATEI = '/etc/wov-admin.token';

const SERVER_YML = resolve(WURZEL, 'server/data/server.yml');
const LAYOUT_DATEI = resolve(WURZEL, 'server/data/worldlayout.json');
const WELTEN_ORDNER = resolve(WURZEL, 'server/data/worlds');
const NGINX_SITE = '/etc/nginx/sites-available/wov';

/** Dienste, die dieser Prozess anfassen darf. Positivliste, keine Freitexte. */
const ERLAUBTE_DIENSTE = ['wov-server', 'nginx'] as const;
type Dienst = (typeof ERLAUBTE_DIENSTE)[number];

const token = existsSync(TOKEN_DATEI) ? readFileSync(TOKEN_DATEI, 'utf-8').trim() : '';
if (!token) {
  console.error(`[Admin] Kein Token in ${TOKEN_DATEI} — Dienst startet nicht.`);
  process.exit(1);
}

// ── Kleine Helfer ─────────────────────────────────────────────────────

function json(res: ServerResponse, code: number, daten: unknown): void {
  const leib = JSON.stringify(daten);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(leib) });
  res.end(leib);
}

async function leibLesen(req: IncomingMessage, grenze = 8_000_000): Promise<unknown> {
  const teile: Buffer[] = [];
  let gesamt = 0;
  for await (const stueck of req) {
    gesamt += (stueck as Buffer).length;
    if (gesamt > grenze) throw new Error('Anfrage zu gross');
    teile.push(stueck as Buffer);
  }
  if (gesamt === 0) return null;
  return JSON.parse(Buffer.concat(teile).toString('utf-8'));
}

/** Sicherungskopie mit Zeitstempel; behaelt die letzten `behalten` Staende. */
function sichern(datei: string, behalten = 10): string | null {
  if (!existsSync(datei)) return null;
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const ziel = `${datei}.${stempel}.bak`;
  copyFileSync(datei, ziel);
  const ordner = dirname(datei);
  const name = basename(datei);
  const alte = readdirSync(ordner)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith('.bak'))
    .sort();
  while (alte.length > behalten) unlinkSync(resolve(ordner, alte.shift()!));
  return ziel;
}

// ── server.yml ────────────────────────────────────────────────────────
//
// Bewusst ZEILENWEISE geaendert statt YAML zu parsen und neu zu schreiben:
// Die Datei ist dicht kommentiert (jede Einstellung hat ihre Herleitung
// daneben, teils mit C++-Fundstellen), und ein Round-Trip durch einen
// YAML-Serialisierer wirft all das weg. Geaendert wird nur der Wert
// hinter dem Doppelpunkt, alles andere bleibt Zeichen fuer Zeichen stehen.

/** Welche Schluessel die Oberflaeche anfassen darf, mit Typ und Grenzen. */
const FELDER = {
  'server.name': { typ: 'text', hinweis: 'Anzeigename des Servers' },
  'server.password': { typ: 'text', hinweis: 'Leer = kein Passwort' },
  'players.max': { typ: 'zahl', min: 1, max: 200, hinweis: 'Spielerzahl' },
  'players.everyone-admin': { typ: 'bool', hinweis: 'ACHTUNG: jeder Verbindende wird Admin' },
  'world.save-interval': { typ: 'text', hinweis: 'z. B. 30min' },
  'world.creatures': { typ: 'bool', hinweis: 'Kreaturen spawnen' },
  'world.vegetation': { typ: 'bool', hinweis: 'Vegetation aussaeen' },
  'world.features': { typ: 'bool', hinweis: 'Locations platzieren' },
  'dungeons.enabled': { typ: 'bool', hinweis: 'Dungeons' },
} as const;
type FeldName = keyof typeof FELDER;

function ymlLesen(): Record<string, string> {
  const zeilen = readFileSync(SERVER_YML, 'utf-8').split('\n');
  const werte: Record<string, string> = {};
  let abschnitt = '';
  for (const z of zeilen) {
    const oben = /^([a-z][a-z0-9-]*):\s*$/.exec(z);
    if (oben) { abschnitt = oben[1]; continue; }
    const paar = /^ {2}([a-z][a-z0-9-]*):\s*(.*?)\s*$/.exec(z);
    if (paar && abschnitt) werte[`${abschnitt}.${paar[1]}`] = paar[2];
  }
  return werte;
}

function ymlSchreiben(aenderungen: Record<string, string>): string[] {
  const zeilen = readFileSync(SERVER_YML, 'utf-8').split('\n');
  const erledigt: string[] = [];
  let abschnitt = '';
  for (let i = 0; i < zeilen.length; i++) {
    const oben = /^([a-z][a-z0-9-]*):\s*$/.exec(zeilen[i]);
    if (oben) { abschnitt = oben[1]; continue; }
    const paar = /^( {2})([a-z][a-z0-9-]*):(\s*)(.*?)(\s*)$/.exec(zeilen[i]);
    if (!paar || !abschnitt) continue;
    const schluessel = `${abschnitt}.${paar[2]}`;
    if (!(schluessel in aenderungen)) continue;
    zeilen[i] = `${paar[1]}${paar[2]}:${paar[3] || ' '}${aenderungen[schluessel]}`;
    erledigt.push(schluessel);
  }
  sichern(SERVER_YML);
  writeFileSync(SERVER_YML, zeilen.join('\n'));
  return erledigt;
}

/** Wert auf den erlaubten Typ pruefen und als YAML-Text zurueckgeben. */
function wertPruefen(feld: FeldName, roh: unknown): string {
  const def = FELDER[feld];
  if (def.typ === 'bool') {
    if (typeof roh !== 'boolean') throw new Error(`${feld}: true oder false erwartet`);
    return String(roh);
  }
  if (def.typ === 'zahl') {
    const n = Number(roh);
    if (!Number.isFinite(n)) throw new Error(`${feld}: Zahl erwartet`);
    const d = def as { min: number; max: number };
    if (n < d.min || n > d.max) throw new Error(`${feld}: ausserhalb ${d.min}..${d.max}`);
    return String(Math.round(n));
  }
  if (typeof roh !== 'string') throw new Error(`${feld}: Text erwartet`);
  if (roh.length > 200 || /[\n\r]/.test(roh)) throw new Error(`${feld}: unzulaessiger Text`);
  // Anfuehrungszeichen nur, wo der bisherige Wert schon welche hatte oder
  // der Text leer ist — sonst kippt YAML bei Sonderzeichen.
  return roh === '' || /[:#]/.test(roh) ? JSON.stringify(roh) : roh;
}

// ── Auslieferung (nginx) ──────────────────────────────────────────────
//
// Geaendert werden nur einzelne Direktiven per regulaerem Ausdruck. Die
// Datei selbst (deploy/nginx-live.conf) bleibt die Vorlage im Repo und
// traegt die Begruendungen; hier wird nur nachjustiert.

const NGINX_FELDER = {
  brotli: /^(\s*)brotli\s+(on|off);/m,
  brotli_comp_level: /^(\s*)brotli_comp_level\s+(\d+);/m,
  gzip_comp_level: /^(\s*)gzip_comp_level\s+(\d+);/m,
} as const;

function nginxLesen(): Record<string, string> {
  if (!existsSync(NGINX_SITE)) return {};
  const text = readFileSync(NGINX_SITE, 'utf-8');
  const werte: Record<string, string> = {};
  for (const [name, muster] of Object.entries(NGINX_FELDER)) {
    const t = muster.exec(text);
    if (t) werte[name] = t[2];
  }
  const cache = /location \/assets\/ \{[\s\S]*?expires\s+(\S+);/.exec(text);
  if (cache) werte['assets_expires'] = cache[1];
  return werte;
}

async function nginxSchreiben(aenderungen: Record<string, string>): Promise<string[]> {
  let text = readFileSync(NGINX_SITE, 'utf-8');
  const erledigt: string[] = [];
  for (const [name, wert] of Object.entries(aenderungen)) {
    if (name === 'assets_expires') {
      if (!/^\d+[smhdwMy]$/.test(wert)) throw new Error('assets_expires: z. B. 7d');
      text = text.replace(/(location \/assets\/ \{[\s\S]*?expires\s+)\S+;/, `$1${wert};`);
      erledigt.push(name);
      continue;
    }
    const muster = NGINX_FELDER[name as keyof typeof NGINX_FELDER];
    if (!muster) throw new Error(`unbekanntes Feld: ${name}`);
    if (name === 'brotli' && !/^(on|off)$/.test(wert)) throw new Error('brotli: on oder off');
    if (name.endsWith('comp_level') && !/^([1-9]|1[01])$/.test(wert)) throw new Error(`${name}: 1..11`);
    text = text.replace(muster, (_g, raum) => `${raum}${name} ${wert};`);
    erledigt.push(name);
  }
  const sicherung = sichern(NGINX_SITE);
  writeFileSync(NGINX_SITE, text);
  try {
    await ausfuehren('nginx', ['-t']);
    await ausfuehren('systemctl', ['reload', 'nginx']);
  } catch (fehler) {
    // Kaputte Konfiguration NIE stehen lassen — sonst ist die Seite weg.
    if (sicherung) copyFileSync(sicherung, NGINX_SITE);
    await ausfuehren('systemctl', ['reload', 'nginx']).catch(() => undefined);
    throw new Error(`nginx lehnt ab, zurueckgerollt: ${(fehler as Error).message}`);
  }
  return erledigt;
}

// ── Zustand ───────────────────────────────────────────────────────────

async function dienstZustand(name: Dienst): Promise<{ aktiv: boolean; seit: string | null }> {
  try {
    const { stdout } = await ausfuehren('systemctl', ['show', name, '--property=ActiveState,ActiveEnterTimestamp']);
    const aktiv = /ActiveState=active/.test(stdout);
    const seit = /ActiveEnterTimestamp=(.*)/.exec(stdout)?.[1]?.trim() || null;
    return { aktiv, seit };
  } catch {
    return { aktiv: false, seit: null };
  }
}

function weltStand(): { saves: { name: string; bytes: number; geaendert: string }[]; layoutBytes: number } {
  const saves = existsSync(WELTEN_ORDNER)
    ? readdirSync(WELTEN_ORDNER)
        .filter((f) => f.endsWith('.db.zst'))
        .map((f) => {
          const s = statSync(resolve(WELTEN_ORDNER, f));
          return { name: f, bytes: s.size, geaendert: s.mtime.toISOString() };
        })
        .sort((a, b) => b.geaendert.localeCompare(a.geaendert))
    : [];
  return { saves, layoutBytes: existsSync(LAYOUT_DATEI) ? statSync(LAYOUT_DATEI).size : 0 };
}

// ── Routen ────────────────────────────────────────────────────────────

type Antwort = { code: number; daten: unknown };

async function behandeln(pfad: string, methode: string, leib: unknown): Promise<Antwort> {
  // ── Zustand ──
  if (pfad === '/status' && methode === 'GET') {
    const [server, nginx] = await Promise.all([dienstZustand('wov-server'), dienstZustand('nginx')]);
    return {
      code: 200,
      daten: {
        instanz: process.env.WOV_INSTANZ ?? 'live',
        dienste: { 'wov-server': server, nginx },
        welt: weltStand(),
        laufzeitSekunden: Math.round(process.uptime()),
      },
    };
  }

  // ── Spielserver-Einstellungen ──
  if (pfad === '/einstellungen/server' && methode === 'GET') {
    const alle = ymlLesen();
    const sichtbar: Record<string, { wert: string; hinweis: string; typ: string }> = {};
    for (const [feld, def] of Object.entries(FELDER)) {
      sichtbar[feld] = { wert: alle[feld] ?? '', hinweis: def.hinweis, typ: def.typ };
    }
    return { code: 200, daten: { felder: sichtbar } };
  }
  if (pfad === '/einstellungen/server' && methode === 'PUT') {
    const eingabe = (leib ?? {}) as Record<string, unknown>;
    const aenderungen: Record<string, string> = {};
    for (const [feld, wert] of Object.entries(eingabe)) {
      if (!(feld in FELDER)) return { code: 400, daten: { fehler: `unbekanntes Feld: ${feld}` } };
      aenderungen[feld] = wertPruefen(feld as FeldName, wert);
    }
    const erledigt = ymlSchreiben(aenderungen);
    return { code: 200, daten: { geaendert: erledigt, hinweis: 'Wirkt erst nach Neustart des Spielservers.' } };
  }

  // ── Auslieferung ──
  if (pfad === '/einstellungen/auslieferung' && methode === 'GET') {
    return { code: 200, daten: { felder: nginxLesen() } };
  }
  if (pfad === '/einstellungen/auslieferung' && methode === 'PUT') {
    const eingabe = (leib ?? {}) as Record<string, string>;
    const erledigt = await nginxSchreiben(eingabe);
    return { code: 200, daten: { geaendert: erledigt, hinweis: 'Sofort wirksam (nginx neu geladen).' } };
  }

  // ── Dienste ──
  if (pfad === '/dienst' && methode === 'POST') {
    const { dienst, aktion } = (leib ?? {}) as { dienst?: string; aktion?: string };
    if (!ERLAUBTE_DIENSTE.includes(dienst as Dienst)) return { code: 400, daten: { fehler: 'unbekannter Dienst' } };
    if (!['start', 'stop', 'restart', 'reload'].includes(aktion ?? '')) return { code: 400, daten: { fehler: 'unbekannte Aktion' } };
    await ausfuehren('systemctl', [aktion!, dienst!]);
    return { code: 200, daten: { dienst, aktion, zustand: await dienstZustand(dienst as Dienst) } };
  }

  // ── Weltsicherungen ──
  if (pfad === '/sicherungen' && methode === 'GET') {
    return { code: 200, daten: weltStand() };
  }
  if (pfad === '/sicherung' && methode === 'POST') {
    const { name } = (leib ?? {}) as { name?: string };
    if (!name || !/^[\w.-]+\.db\.zst$/.test(name)) return { code: 400, daten: { fehler: 'Weltname ungueltig' } };
    const quelle = resolve(WELTEN_ORDNER, name);
    if (!quelle.startsWith(WELTEN_ORDNER + '/') || !existsSync(quelle)) return { code: 404, daten: { fehler: 'Welt nicht gefunden' } };
    const ziel = sichern(quelle, 20);
    return { code: 200, daten: { gesichert: ziel ? basename(ziel) : null } };
  }

  return { code: 404, daten: { fehler: 'unbekannter Endpunkt' } };
}

// ── Server ────────────────────────────────────────────────────────────

const dienst = createServer((req, res) => {
  void (async () => {
    try {
      if (req.headers['x-wov-token'] !== token) return json(res, 401, { fehler: 'Token fehlt oder falsch' });
      const pfad = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '') || '/';
      const leib = req.method === 'PUT' || req.method === 'POST' ? await leibLesen(req) : null;
      const { code, daten } = await behandeln(pfad, req.method ?? 'GET', leib);
      if (code >= 400) console.warn(`[Admin] ${req.method} ${pfad} -> ${code}`);
      json(res, code, daten);
    } catch (fehler) {
      console.error('[Admin] Fehler:', fehler);
      json(res, 500, { fehler: (fehler as Error).message });
    }
  })();
});

// Nur auf der internen Bruecke lauschen. 0.0.0.0 waere hier der Fehler,
// den man erst bemerkt, wenn jemand anders ihn findet.
const ADRESSE = process.env.WOV_ADMIN_ADRESSE ?? '10.10.10.11';
dienst.listen(PORT, ADRESSE, () => {
  console.log(`[Admin] bereit auf ${ADRESSE}:${PORT} (Projekt ${WURZEL})`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { dienst.close(() => process.exit(0)); });
}
