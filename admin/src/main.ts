/**
 * Betriebsdienst der Live-Instanz — die Gegenstelle der Einstellungsseite
 * im Editor.
 *
 * ── Warum ein EIGENER Prozess ────────────────────────────────────────
 * Er muss `wov-server` neu starten können. Ein Teil des Spielservers zu
 * sein hiesse, sich selbst abzuschiessen — deshalb ein getrennter,
 * winziger Dienst mit eigener systemd-Unit.
 *
 * ── Warum auch der Speicherweg des Editors hier liegt (Block A/16) ───
 * POST /api/worldlayout und GET /api/serverlog steckten frueher als
 * Middleware-Plugins in client/vite.config.ts. Vite laeuft aber nur auf
 * dev; auf live liefert nginx einen statischen Build aus, und dort gab es
 * beide Endpunkte schlicht NICHT — der Editor konnte auf live nicht
 * speichern. Ein Speicherweg, der nur existiert, solange ein
 * Entwicklungsserver laeuft, ist keine Architektur, sondern ein Zufall.
 *
 * Warum hierher und nicht in den Spielserver: server/src hat gar keinen
 * HTTP-Server (nur den WebSocketAcceptor), und er muesste sich nach dem
 * Speichern selbst neu starten. Dieser Dienst dagegen laeuft auf beiden
 * Containern, kennt die Weltdatei ueber weltDatei(WURZEL, INSTANZ) und
 * hatte den Token-Schutz schon.
 *
 * ── Warum das sicher ist ─────────────────────────────────────────────
 * Vier Schranken, die zusammenwirken:
 *
 *  1. Er lauscht NUR auf der internen Bruecke (10.10.10.x). Von aussen
 *     leitet der Proxmox-Host ausschliesslich 80 und 443 auf den Nginx
 *     Proxy Manager weiter — dieser Port ist im Internet nicht erreichbar.
 *  2. Jede Anfrage braucht den Token aus TOKEN_DATEI. Den kennt nur der
 *     Container; im BROWSER taucht er nie auf, weil ihn der Vorschalter
 *     serverseitig setzt — auf dev der Vite-Proxy (server.proxy in
 *     client/vite.config.ts), auf live nginx per
 *     `include /etc/nginx/wov-admin-token.conf` (0600).
 *  3. Der Herkunfts-Riegel weiter unten (NAHE_NETZE): der IP-Guard, der
 *     frueher im Vite-Plugin sass. Er ist mit umgezogen statt zu
 *     verschwinden — siehe den ausfuehrlichen Block bei `herkunft`.
 *  4. Davor steht die Basic-Auth des Editors im Proxy Manager, und auf
 *     live zusaetzlich eine EIGENE Basic-Auth im location /api/-Block
 *     (deploy/nginx-live.conf). Das ist Absicht: Wer nur das Passwort des
 *     Proxy Managers kennt, soll die Welt nicht ueberschreiben koennen.
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
 * Umgebung: WOV_ADMIN_PORT (Vorgabe 2468, 0 = freier Port),
 *           WOV_ADMIN_ADRESSE, WOV_WURZEL (Projektpfad),
 *           WOV_ADMIN_TOKEN_DATEI, WOV_NAHE_NETZE, WOV_PROXY_ADRESSEN,
 *           WOV_LOG_STROEME_MAX
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { instanzName, weltDatei } from '@wov/shared/src/instanz.js';
// Direktimport am Barrel vorbei: shared/src/index.ts geht in den
// Client-Bundle, und layoutDatei.ts zieht node:fs herein. Gleiche
// Begruendung wie bei instanz.ts eine Zeile hoeher.
import {
  LayoutUngueltig,
  layoutLesen,
  layoutSchreiben,
} from '@wov/shared/src/worldlayout/layoutDatei.js';

const ausfuehren = promisify(execFile);

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = process.env.WOV_WURZEL ?? resolve(HIER, '../..');
const PORT = Number(process.env.WOV_ADMIN_PORT ?? 2468);
// Ueberschreibbar, damit admin/test/betriebsdienst.ts den echten Dienst
// mit einem Wegwerf-Token gegen ein Wegwerf-Verzeichnis fahren kann,
// ohne /etc anzufassen.
const TOKEN_DATEI = process.env.WOV_ADMIN_TOKEN_DATEI ?? '/etc/wov-admin.token';

const INSTANZ = instanzName();
const SERVER_YML = resolve(WURZEL, 'server/data/server.yml');
const LAYOUT_DATEI = weltDatei(WURZEL, INSTANZ);
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

// ── Herkunft einer Anfrage ────────────────────────────────────────────
//
// Der IP-Guard des alten Vite-Plugins (127.0.0.1, ::1, 10.10.10.*,
// 192.168.*) zieht hier ein. Er verschwindet NICHT — er wandert nur an
// die Stelle, die die Datei tatsaechlich besitzt, statt in der Konfig
// eines Entwicklungsservers zu haengen, den es auf live nicht gibt.
//
// ── Peer-Adresse und Klient-Adresse ──────────────────────────────────
// Die Peer-Adresse ist, wer die TCP-Verbindung aufgebaut hat. Hinter
// einem Vorschalter ist das IMMER der Vorschalter — auf dev der
// Vite-Prozess, auf live nginx. Ein IP-Guard, der nur die Peer-Adresse
// prueft, sagt hinter einem Proxy also nichts ueber den Aufrufer aus.
// Deshalb zwei Ebenen:
//
//   Peer   — muss in NAHE_NETZE liegen. Faengt alles ab, was direkt auf
//            Port 2468 klopft, ohne ueber einen Vorschalter zu kommen.
//   Klient — die erste Adresse aus X-Forwarded-For, aber NUR wenn der
//            Peer ein bekannter Vorschalter ist (PROXY_ADRESSEN). Sonst
//            ist der Kopf frei erfunden und wird ignoriert.
//
// Damit das traegt, MUSS jeder Vorschalter den Kopf UEBERSCHREIBEN statt
// ihn anzuhaengen — sonst schiebt der Aufrufer einfach selbst eine
// freundliche Adresse davor. Beides ist so eingerichtet:
//   dev  — client/vite.config.ts, proxyReq.setHeader('x-forwarded-for', …)
//   live — deploy/nginx-live.conf, proxy_set_header X-Forwarded-For $remote_addr
//
// ── Was das auf live NICHT leistet, und was stattdessen traegt ───────
// Auf live steht der Nginx Proxy Manager auf dem Host davor. Dessen
// Adresse liegt selbst auf der Bruecke, also faellt der Klient-Wert dort
// auf "10.10.10.x" zusammen und der Guard geht durch — egal wer wirklich
// anfragt. Das ist keine Nachlaessigkeit, sondern eine Eigenschaft der
// Topologie: Ein IP-Guard hinter einem Proxy, dessen Vorlauf man nicht
// kontrolliert, kann grundsaetzlich nichts unterscheiden.
// Die zweite Schranke auf live ist deshalb eine EIGENE Basic-Auth im
// location /api/-Block von deploy/nginx-live.conf, mit eigener
// htpasswd-Datei auf dem Container. Sie leistet genau das, was hier
// verlangt war: Wer nur das Passwort des Proxy Managers kennt, kommt an
// das Weltdokument nicht heran.
// Auf dev, wo Vite ungeschuetzt auf Port 5274 im Netz steht, ist dieser
// Guard dagegen die scharfe Schranke — dort ist der Klient-Wert echt.

/** Kommagetrennte Liste aus der Umgebung, sonst die Vorgabe. */
function netzListe(roh: string | undefined, vorgabe: readonly string[]): string[] {
  const werte = (roh ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return werte.length > 0 ? werte : [...vorgabe];
}

/** IPv4-gemappte IPv6-Adressen (::ffff:10.0.0.1) auf ihre v4-Form bringen. */
function adresse(roh: string | undefined): string {
  return (roh ?? '').trim().replace(/^::ffff:/, '');
}

/** Exakte Adresse oder Praefix mit '*' am Ende ("10.10.10.*"). */
function passt(wert: string, liste: readonly string[]): boolean {
  if (!wert) return false;
  return liste.some((m) => (m.endsWith('*') ? wert.startsWith(m.slice(0, -1)) : wert === m));
}

/** Wer den Dienst benutzen darf. Die Liste des alten Vite-Guards. */
const NAHE_NETZE = netzListe(process.env.WOV_NAHE_NETZE, ['127.0.0.1', '::1', '10.10.10.*', '192.168.*']);
/** Wessen X-Forwarded-For geglaubt wird. Bewusst enger als NAHE_NETZE. */
const PROXY_ADRESSEN = netzListe(process.env.WOV_PROXY_ADRESSEN, ['127.0.0.1', '::1', '10.10.10.*']);

function herkunft(req: IncomingMessage): { peer: string; klient: string } {
  const peer = adresse(req.socket.remoteAddress ?? undefined);
  const kopf = adresse(String(req.headers['x-forwarded-for'] ?? '').split(',')[0]);
  return { peer, klient: kopf && passt(peer, PROXY_ADRESSEN) ? kopf : peer };
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

// ── Server-Konsole: GET /api/serverlog ────────────────────────────────
//
// journalctl des Spielservers als Server-Sent-Events. Der Paket-Spam
// (30 Hz Eingabe pro Spieler) fliegt raus, damit in der Konsole
// Weltereignisse stehen und nicht das Netzprotokoll — gleiche Filterung
// wie in der Vite-Fassung.
//
// Zwei Dinge, die die Vite-Fassung NICHT hatte und die im Dauerbetrieb
// zaehlen:
//
//  1. Eine Obergrenze fuer gleichzeitige Stroeme. Jeder Strom ist ein
//     journalctl-Prozess; ohne Grenze reicht ein Skript, das den Endpunkt
//     in einer Schleife oeffnet, um den Container mit Kindprozessen zu
//     fuellen.
//  2. Ein Aufraeumen, das den Kindprozess WIRKLICH beendet. Vorher hing
//     das allein an req.on('close') und einem kill() ohne Nachschlag —
//     jedes Schliessen eines Editor-Tabs konnte ein `journalctl -f`
//     zuruecklassen.

const LOG_STROEME_MAX = Number(process.env.WOV_LOG_STROEME_MAX ?? 4);
let logStroemeOffen = 0;

function serverLogStroemen(req: IncomingMessage, res: ServerResponse): void {
  if (logStroemeOffen >= LOG_STROEME_MAX) {
    return json(res, 503, {
      ok: false,
      fehler: `Zu viele offene Konsolen (${LOG_STROEME_MAX})`,
      message: `Zu viele offene Konsolen (${LOG_STROEME_MAX}) — spaeter erneut versuchen.`,
    });
  }
  logStroemeOffen++;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform verbietet Zwischenstellen das Umpacken; X-Accel-Buffering
    // schaltet nginx' Pufferung ab, falls jemand den location-Block ohne
    // `proxy_buffering off` kopiert. Ohne beides kommt das erste Ereignis
    // erst, wenn 4 KB voll sind — also gefuehlt nie.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const kind = spawn('journalctl', ['-fu', 'wov-server', '-n', '120', '--no-pager', '-o', 'short-iso']);

  const senden = (text: string): void => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(text)}\n\n`);
  };
  const weiter = (stueck: Buffer): void => {
    for (const zeile of stueck.toString().split('\n')) {
      if (!zeile.trim()) continue;
      if (/Received packet|type=\d+ from/.test(zeile)) continue;
      senden(zeile);
    }
  };

  // Kommentarzeile alle 25 s: haelt die Verbindung durch Proxys mit
  // Leerlauf-Zeitgrenze offen, ohne dem Browser ein Ereignis vorzugaukeln
  // (Zeilen mit ':' ignoriert die EventSource-API).
  const takt = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': takt\n\n');
  }, 25_000);

  let beendet = false;
  const aufraeumen = (): void => {
    if (beendet) return;
    beendet = true;
    logStroemeOffen--;
    clearInterval(takt);
    kind.kill('SIGTERM');
    // Nachschlag: `journalctl -f` beendet sich auf SIGTERM zuverlaessig,
    // aber ein haengender Kindprozess darf den Platz nicht dauerhaft
    // belegen. unref(), damit dieser Timer den Prozess nicht am Leben haelt.
    setTimeout(() => { if (kind.exitCode === null) kind.kill('SIGKILL'); }, 2000).unref();
    res.end();
  };

  kind.stdout.on('data', weiter);
  kind.stderr.on('data', weiter);
  kind.on('error', (fehler) => {
    senden(`[Konsole] journalctl nicht verfuegbar: ${fehler.message}`);
    aufraeumen();
  });
  kind.on('close', aufraeumen);
  req.on('close', aufraeumen);
  res.on('close', aufraeumen);
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
        instanz: INSTANZ,
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

  // ── Weltdokument ──
  //
  // Pfadname und Methode bleiben, was sie im Vite-Plugin waren: POST
  // /api/worldlayout. Deutsche Endpunktnamen waeren Kosmetik und gehoeren
  // nicht in denselben Umbau — der Client bleibt bis auf Textmeldungen
  // unangetastet, damit die ZWEITE Aufrufstelle (client/src/main.ts,
  // RoutenEditor) nicht vergessen werden kann.
  //
  // Die Antwortform { ok, message } ist ebenfalls die des Vite-Plugins.
  // Der Editor liest genau diese zwei Felder; ein huebscheres Schema
  // haette einen Client-Umbau erzwungen, den dieser Schritt vermeiden soll.
  if (pfad === '/api/worldlayout' && methode === 'GET') {
    // NEU gegenueber dem Vite-Plugin: Der Editor kann sein Dokument auch
    // LESEN, statt es nur aus dem localStorage zu kennen. Voraussetzung
    // fuer Phase 2 — ohne Lesen gibt es kein "oeffnen, aendern, speichern",
    // sondern nur ein Ueberschreiben mit dem, was der Browser noch hatte.
    //
    // Geliefert wird das GEPRUEFTE Dokument, nicht der Rohtext: Der Editor
    // soll sehen, was auch der Spielserver sieht. `instanz` steht dabei,
    // weil die eine Codebasis zwei Welten bedient — der Editor muss
    // anzeigen koennen, welche er gerade geoeffnet hat.
    // Fehlende Weltdatei ist 404, nicht 400: Der Aufrufer hat nichts
    // falsch gemacht, hier fehlt etwas am Container. Ohne diesen Zweig
    // faengt der Sammel-catch das ENOENT und meldet "unbrauchbares
    // Dokument" — eine Diagnose, die in die falsche Richtung schickt.
    if (!existsSync(LAYOUT_DATEI)) {
      const fehlt = `${basename(LAYOUT_DATEI)} fehlt (Instanz ${INSTANZ}) — WOV_INSTANZ und server/data/welten/ pruefen.`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    const layout = layoutLesen(LAYOUT_DATEI);
    return {
      code: 200,
      daten: {
        ok: true,
        message: `${basename(LAYOUT_DATEI)}: ${layout.regions.length} Region(en), ${layout.placements?.length ?? 0} Platzierung(en)`,
        instanz: INSTANZ,
        datei: basename(LAYOUT_DATEI),
        layout,
      },
    };
  }
  if (pfad === '/api/worldlayout' && methode === 'POST') {
    // Gepruefte wird mit sanitizeWorldLayout, der STRENGEN Pruefung —
    // die Vite-Konfig konnte @wov/shared nicht laden und musste sich mit
    // einem Struktur-Check begnuegen. Dieser Prozess laeuft unter tsx und
    // kann es. Damit gilt: Was auf der Platte landet, haette der
    // Spielserver auch akzeptiert.
    const { layout, sicherung, text } = layoutSchreiben(LAYOUT_DATEI, leib);
    return {
      code: 200,
      daten: {
        ok: true,
        message:
          `Gespeichert in ${basename(LAYOUT_DATEI)}: ${layout.regions.length} Region(en), ` +
          `${layout.placements?.length ?? 0} Platzierung(en)`,
        instanz: INSTANZ,
        sicherung: sicherung ? basename(sicherung) : null,
        bytes: Buffer.byteLength(text),
      },
    };
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
    const pfad = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '') || '/';
    try {
      // Reihenfolge: erst Herkunft, dann Token. Wer gar nicht erst
      // hierhergehoert, soll auch nicht erfahren, ob er einen Token
      // erraten hat — 403 vor 401.
      const { peer, klient } = herkunft(req);
      if (!passt(peer, NAHE_NETZE) || !passt(klient, NAHE_NETZE)) {
        console.warn(`[Admin] abgewiesen: ${req.method} ${pfad} von Peer ${peer || '?'} / Klient ${klient || '?'}`);
        return json(res, 403, {
          ok: false,
          fehler: 'Zugriff nur aus dem lokalen Netz',
          message: 'Speichern nur aus dem lokalen Netz erlaubt',
        });
      }
      if (req.headers['x-wov-token'] !== token) {
        return json(res, 401, {
          ok: false,
          fehler: 'Token fehlt oder falsch',
          message: 'Token fehlt oder falsch — laeuft der Vorschalter (Vite bzw. nginx)?',
        });
      }

      // Die Server-Konsole vor der JSON-Weiche: sie antwortet nicht mit
      // einem Dokument, sondern haelt die Verbindung offen. `behandeln`
      // kann das mit seinem { code, daten } nicht ausdruecken.
      if (pfad === '/api/serverlog') {
        if (req.method !== 'GET') return json(res, 405, { ok: false, fehler: 'GET erwartet', message: 'GET erwartet' });
        return serverLogStroemen(req, res);
      }

      const leib = req.method === 'PUT' || req.method === 'POST' ? await leibLesen(req) : null;
      const { code, daten } = await behandeln(pfad, req.method ?? 'GET', leib);
      if (code >= 400) console.warn(`[Admin] ${req.method} ${pfad} -> ${code}`);
      json(res, code, daten);
    } catch (fehler) {
      // Ein unbrauchbares Dokument ist ein Fehler des Absenders, kein
      // Serverfehler — und vor allem: An dieser Stelle ist auf der Platte
      // NICHTS passiert. layoutSchreiben prueft, bevor es sichert oder
      // schreibt. Das ist die wichtigste Zusicherung des ganzen Endpunkts:
      // Ein misslungener Speichervorgang darf die Welt nicht beschaedigen.
      const eingabefehler = fehler instanceof LayoutUngueltig || fehler instanceof SyntaxError;
      const code = eingabefehler ? 400 : 500;
      const meldung = (fehler as Error).message;
      if (eingabefehler) console.warn(`[Admin] ${req.method} ${pfad} -> 400: ${meldung}`);
      else console.error('[Admin] Fehler:', fehler);
      json(res, code, { ok: false, fehler: meldung, message: meldung });
    }
  })();
});

// Nur auf der internen Bruecke lauschen. 0.0.0.0 waere hier der Fehler,
// den man erst bemerkt, wenn jemand anders ihn findet.
const ADRESSE = process.env.WOV_ADMIN_ADRESSE ?? '10.10.10.11';
dienst.listen(PORT, ADRESSE, () => {
  // Der TATSAECHLICH gebundene Port, nicht der gewuenschte: Mit
  // WOV_ADMIN_PORT=0 vergibt der Kern einen freien Port, und der Test
  // (admin/test/betriebsdienst.ts) liest ihn aus genau dieser Zeile.
  // Ein fest gewaehlter Testport waere ein Wettlauf mit allem anderen,
  // was auf der Maschine lauscht.
  const gebunden = dienst.address();
  const port = typeof gebunden === 'object' && gebunden ? gebunden.port : PORT;
  console.log(`[Admin] bereit auf ${ADRESSE}:${port} (Projekt ${WURZEL}, Instanz ${INSTANZ}, Welt ${LAYOUT_DATEI})`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { dienst.close(() => process.exit(0)); });
}
