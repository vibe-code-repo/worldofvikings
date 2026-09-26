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
 *           WOV_LOG_STROEME_MAX, WOV_SYSTEMCTL (nur Tests/Probelaeufe, s. SYSTEMCTL),
 *           WOV_ERLAUBTE_URSPRUENGE (kommagetrennte Host-Namen, s. fremdeHerkunft)
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
// S6-Notausgang (Karte 0.1, zweiter Weg): NUR lesend auf der
// Kontendatenbank, um einen Charakternamen in eine spielerId aufzuloesen.
// Warum kein Import von server/src/konto/Kontendatenbank.ts trotz
// gleichem Dateiformat: siehe die lange Begruendung bei ADMINS_DATEI
// weiter unten.
import { DatabaseSync } from 'node:sqlite';
import { instanzName, weltDatei, weltRepoDatei } from '@wov/shared/src/instanz.js';
import { weltAbgleichen } from '@wov/shared/src/worldlayout/weltArbeitskopie.js';
// Direktimport am Barrel vorbei: shared/src/index.ts geht in den
// Client-Bundle, und layoutDatei.ts zieht node:fs herein. Gleiche
// Begruendung wie bei instanz.ts eine Zeile hoeher.
import {
  LayoutFeldUngueltig,
  LayoutGesperrt,
  LayoutUngueltig,
  LayoutVeraltet,
  LayoutZuVielePlatzierungen,
  layoutLesenMitHash,
  layoutSchreibenAsync,
} from '@wov/shared/src/worldlayout/layoutDatei.js';
import { weltAnlegen, weltOpsBehandeln } from './routen/weltOps.js';
import {
  unfertigenResetMelden,
  weltZuruecksetzenBehandeln,
  weltZuruecksetzenVorschau,
  zuruecksetzenStatus,
  type ResetUmgebung,
} from './routen/weltZuruecksetzen.js';
// Dungeon-Dokumente werden hier NUR gelesen, aber durch dieselbe Pruefung
// geschickt wie beim Server. Der Editor soll sehen, was auch der
// Spielserver sieht — ein Rohtext koennte Raeume enthalten, die dort
// stillschweigend wegfallen, und dann zeichnete der Grundriss etwas, das
// es im Spiel nicht gibt.
import { sanitizeDungeonDocument } from '@wov/shared/src/dungeons.js';
// E8: die zur Laufzeit gebauten Module (Saele des Kits DG_StoneVault).
// Direktimport am Barrel vorbei wie eine Zeile hoeher; moduleRegistry.ts
// zieht nichts aus node herein, der Direktimport ist hier Konsistenz.
// E8: the runtime-built modules; direct import past the barrel as above.
import {
  REGISTRY_DATEI,
  applyModuleRegistry,
  leseRegistryAusText,
  leereRegistry,
  registeredModules,
  removeRegistryEntry,
} from '@wov/shared/src/moduleRegistry.js';
// U1: dieselbe Abgleich-Idee wie bei den Dungeon-Modulen, fuer per Editor
// hochgeladene Prefabs -- eigene Datei, eigener Ordner, eigene Registry.
import {
  MAX_BYTES as HOCHGELADEN_MAX_BYTES,
  REGISTRY_DATEI as HOCHGELADEN_REGISTRY_DATEI,
  applyUploadedModelRegistry,
  leereRegistry as leereHochgeladenRegistry,
  leseRegistryAusText as leseHochgeladenRegistryAusText,
  type Kollisionsart,
} from '@wov/shared/src/uploadedModelRegistry.js';
import {
  entferneUpload,
  pruefeUndSpeichereUpload,
  UPLOAD_DIR as HOCHGELADEN_ORDNER,
} from '@wov/shared/src/uploadedModelUpload.js';
// AP15.0: derselbe Lese-Grundsatz fuer das 2.0-Format. Direktimport an
// shared/src/dungeon2/index.ts vorbei, aus demselben Grund wie bei
// dungeons.js eine Zeile hoeher — nur dass hier NICHTS mitgezogen wird
// (document.ts importiert dungeons.ts absichtlich nicht, s. Kopfkommentar
// dort), der Direktimport ist also Konsistenz, keine Notwendigkeit.
// AP15.0: the same read principle for the 2.0 format. Direct import past
// the barrel, same reason as dungeons.js one line up — except this one
// pulls nothing extra in (document.ts deliberately does not import
// dungeons.ts), so the direct import is consistency, not necessity.
import {
  istDokument2,
  sanitizeDungeonDokument2,
  ambientLichtVon,
  type DungeonDokument2,
} from '@wov/shared/src/dungeon2/document.js';
// G12: Betriebsmetriken -- admin/ MISST nichts selbst (eigener Prozess,
// kein Zugriff auf den Spielserver-Zustand), sondern liest nur die Datei,
// die der Spielserver einmal je Sekunde schreibt, und formatiert sie mit
// demselben Code, der auch das Datenformat definiert (s. metrikenAusgeben
// weiter unten).
import { formatierePrometheus, type MetrikSchnappschuss } from '@wov/shared/src/metrik.js';

const ausfuehren = promisify(execFile);

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = process.env.WOV_WURZEL ?? resolve(HIER, '../..');
const PORT = Number(process.env.WOV_ADMIN_PORT ?? 2468);
// Ueberschreibbar, damit admin/test/betriebsdienst.ts den echten Dienst
// mit einem Wegwerf-Token gegen ein Wegwerf-Verzeichnis fahren kann,
// ohne /etc anzufassen.
const TOKEN_DATEI = process.env.WOV_ADMIN_TOKEN_DATEI ?? '/etc/wov-admin.token';

// Which program this process runs instead of `systemctl`: for tests and proof
// runs ONLY (admin/test/welt-zuruecksetzen.ts, a slot's own operations service);
// never set it in operation. It replaces EVERY systemctl call of this process
// (stop/start/restart/reload of services, the nginx reload, the state queries), so
// a stand-in sees all of them and none reaches the real wov-server. Not limited
// to the world reset on purpose: a variable that covered only some calls would
// leave the others on the real machine. Set in the environment, never by a request.
const SYSTEMCTL = process.env.WOV_SYSTEMCTL ?? 'systemctl';
// A stand-in for systemctl can make a stop/start answer "done" while nothing was stopped or started (a `true` in its place
// does exactly that), so it must never go unnoticed and never run in operation:
//  - a loud warning at start,
//  - the field `systemctlErsatz` in GET /status,
//  - no start at all under NODE_ENV=production (the units' /etc/wov.env sets it there).
const SYSTEMCTL_ERSATZ = process.env.WOV_SYSTEMCTL !== undefined && process.env.WOV_SYSTEMCTL !== '' ? SYSTEMCTL : null;
if (SYSTEMCTL_ERSATZ !== null) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `[Admin] WOV_SYSTEMCTL=${SYSTEMCTL_ERSATZ} ist gesetzt, aber NODE_ENV=production: Der Dienst startet nicht. ` +
        'Die Variable ersetzt jeden systemctl-Aufruf und ist nur fuer Tests und Probelaeufe — aus der Umgebung (/etc/wov.env, Unit) entfernen.'
    );
    process.exit(1);
  }
  console.warn(
    `[Admin] WARNUNG: WOV_SYSTEMCTL=${SYSTEMCTL_ERSATZ} ist gesetzt — jeder Dienst-Aufruf dieses Prozesses (stop/start/restart, nginx-Reload, ` +
      'Zustandsabfragen, Zuruecksetzen, Testwelt) geht an dieses Programm statt an systemctl. Nur fuer Tests und Probelaeufe.'
  );
}

const INSTANZ = instanzName();
const SERVER_YML = resolve(WURZEL, 'server/data/server.yml');
// Die Arbeitskopie der Welt (WOV_WELT_VERZEICHNIS, sonst /var/lib/wov/welten), nicht die Repo-Datei: Speichern
// macht den Git-Baum nicht schmutzig. Fehlt sie beim Start, legt der Dienst sie einmal aus dem Repo an
// (dieselbe Regel wie im Spielserver, nur ohne Nachziehen); Nachziehen und Konfliktwarnung gehoeren dem
// Spielserver-Start, Abnehmen und Verwerfen tools/welt-abnehmen.sh. Kein Git in diesem Prozess.
const LAYOUT_DATEI = weltDatei(WURZEL, INSTANZ);
try {
  const abgleich = weltAbgleichen({ repoDatei: weltRepoDatei(WURZEL, INSTANZ), arbeitsDatei: LAYOUT_DATEI, modus: 'anlegen' });
  if (abgleich.fall === 'angelegt') console.log(`[Admin] ${abgleich.meldung}`);
} catch (fehler) {
  console.error(`[Admin] Arbeitskopie der Welt nicht angelegt: ${(fehler as Error).message}`);
}
const WELTEN_ORDNER = resolve(WURZEL, 'server/data/worlds');
// Je Instanz ein eigener Unterordner — dieselbe Ableitung wie im
// Spielserver (`DungeonManager`, resolve(worldsDir, '..', 'dungeons',
// worldName)). Zwei Wege zu einem Ordner waeren zwei Gelegenheiten,
// beim naechsten Umbau auseinanderzulaufen.
const DUNGEON_ORDNER = resolve(WELTEN_ORDNER, '..', 'dungeons', INSTANZ);
const NGINX_SITE = '/etc/nginx/sites-available/wov';
// G12: derselbe Pfad, den WovServer.schreibeMetriken() befuellt
// (server/src/main.ts setzt ServerConfig.metrikenDatei genauso).
const METRIKEN_DATEI = resolve(WURZEL, 'server/data/metriken.json');
// E8: derselbe Ordner, den der Spielserver als GENERIERT_DIR kennt
// (server/src/world/dungeon/ModuleBuild.ts: vier Ebenen ueber
// server/src/world/dungeon, also die Projektwurzel). Wie bei
// METRIKEN_DATEI ist der Weg dorthin hier ein anderer — dort ein
// relativer Pfad ab der Moduldatei, hier WOV_WURZEL —, das Ziel muss
// dasselbe sein. Beide Dienste laufen auf demselben Container im
// selben Checkout.
const GENERIERT_ORDNER = resolve(WURZEL, 'assets/generiert');

// ── Adminliste: der zweite Weg (S6, Roadmap-Karte 0.1) ──────────────────
//
// Wenn `players.everyone-admin` (server.yml) auf `false` steht, bestimmt
// allein `server/src/admin/AdminListe.ts` (im Spielserver-Prozess), wer
// Admin-Befehle nutzen darf. Ein Betreiber ohne laufenden Client/Konsole
// hatte dafuer bislang NUR Handarbeit an der JSON-Datei auf dem Server.
// Diese Routen (/admin/liste, /admin/spieler) sind der zweite Weg dahin,
// ueber denselben Betriebsdienst, der schon server.yml und die
// Auslieferung bedient.
//
// ── Warum dieselbe Datei, aber NICHT dieselbe Klasse ────────────────────
// `admins.<instanz>.json` in server/data/worlds/ ist exakt der Pfad, den
// WovServer.ts an `new AdminListe(...)` uebergibt (Begruendung fuer den
// Ordner statt server.yml steht dort). Ein zweiter Schreiber auf dieselbe
// Datei ist hier bewusst in Kauf genommen -- genau wie server.yml und die
// Weltdatei schon von zwei Prozessen angefasst werden (Spielserver
// schreibt/liest sein Deployment, dieser Dienst pflegt die Konfiguration).
//
// Importiert wird `AdminListe` selbst trotzdem NICHT, und ebenso wenig
// `Kontendatenbank` fuer die Namensaufloesung weiter unten. Grund: Beide
// haengen (ueber `../net/Identitaet.js`) an `import { ... } from
// '@wov/shared'` OHNE Direktimport-Pfad -- also am VOLLEN Barrel
// (shared/src/index.ts), nicht an den einzelnen Modulen, die dieser
// Prozess sich sonst ueberall bewusst erkauft (s. Kommentar bei
// layoutDatei.js oben). Ausprobiert: Ein einziger Import von
// `AdminListe.js` zieht beim Start den kompletten Katalog-Code mit
// herein (Vegetation/Features/Spawns/Items/Bauteile -- derselbe Code, der
// sonst nur store:aufbereiten laeuft) samt dessen Konsolenausgabe. Das ist
// exakt die Kopplung, die dieser Prozess seit seiner Entstehung vermeidet
// (Kopfkommentar: "Direktimport am Barrel vorbei"). Die Abhilfe waere ein
// Umbau von Identitaet.ts auf einen Direktimport -- das ist server/src/net,
// nicht mein Dateibesitz in diesem Auftrag, siehe Bericht.
//
// Deshalb: eigene, minimale Lese-/Schreibfunktionen unten, die exakt
// dasselbe Dateiformat kennen ({spielerId, name, seit}[]) und dieselbe
// spielerId-Form pruefen ("sp_" + 22 Zeichen Base64url, Identitaet.ts
// SPIELER_ID_PRAEFIX/-ZUFALLSBYTES) -- Duplikation von etwa 20 Zeilen ist
// hier der Preis fuer einen Prozess, der weiterhin sauber und leise
// startet.
//
// ── Wann die Aenderung im Spielserver ankommt ───────────────────────────
// Ohne Neustart: server/src/admin/AdminListe.ts vergleicht vor jeder
// Rechtefrage Aenderungszeit und Groesse dieser Datei und liest bei
// Abweichung neu ein. Diese Route schreibt deshalb atomar (tmp+rename),
// genau wie der Spielserver -- ein halb geschriebenes JSON waere sonst
// fuer den Bruchteil einer Sekunde eine LEERE Adminliste.
// Was ein Schreiben hier NICHT tut: einer bereits offenen Verbindung
// Rechte geben oder nehmen. Der Spielserver entscheidet beim Anmelden
// (NetManager.handlePasswordAuth) und merkt sich das Ergebnis in
// peer.isAdmin; wirksam wird die Aenderung also beim naechsten
// Verbinden des Betroffenen. Genau das sagt ADMIN_HINWEIS.
const ADMINS_DATEI = resolve(WELTEN_ORDNER, `admins.${INSTANZ}.json`);
// Derselbe Pfad, den WovServer.ts aus ServerConfig.kontenDir und
// worldName ableitet (server/data/konten/<instanz>.db, s.
// ServerKonfig.ts kontenDir und WovServer.ts this.kontenDb).
const KONTEN_DB = resolve(WURZEL, 'server/data/konten', `${INSTANZ}.db`);
/** Wie Identitaet.ts' istSpielerId(), aber ohne den Barrel-Import (s. o.). */
const SPIELER_ID_MUSTER = /^sp_[A-Za-z0-9_-]{22}$/;
const ADMIN_HINWEIS =
  'Der laufende Spielserver uebernimmt diese Datei ohne Neustart (er prueft sie vor ' +
  'jeder Rechtefrage). Wer gerade verbunden ist, behaelt aber die Rechte seiner ' +
  'laufenden Sitzung -- wirksam wird die Aenderung mit seinem naechsten Verbinden. ' +
  "Sofort erzwingen: POST /dienst { dienst: 'wov-server', aktion: 'restart' }.";

interface BetriebsAdminEintrag { spielerId: string; name: string; seit: string }

function spielerIdGueltig(wert: unknown): wert is string {
  return typeof wert === 'string' && SPIELER_ID_MUSTER.test(wert);
}

function adminsLesen(): BetriebsAdminEintrag[] {
  if (!existsSync(ADMINS_DATEI)) return [];
  try {
    const roh = JSON.parse(readFileSync(ADMINS_DATEI, 'utf-8')) as unknown;
    if (!Array.isArray(roh)) return [];
    return roh.filter(
      (e): e is BetriebsAdminEintrag =>
        !!e && typeof e === 'object' &&
        spielerIdGueltig((e as Record<string, unknown>).spielerId) &&
        typeof (e as Record<string, unknown>).name === 'string' &&
        typeof (e as Record<string, unknown>).seit === 'string'
    );
  } catch (fehler) {
    // Wie AdminListe.laden(): eine kaputte Datei darf die Anzeige nicht
    // sprengen. Leere Liste ist hier der ehrliche Rueckfall, nicht "alle
    // sind Admin" oder ein 500er.
    console.error(`[Admin] ${ADMINS_DATEI} unlesbar: ${(fehler as Error).message}`);
    return [];
  }
}

/** Atomarer Ersatz + Zeitstempel-Sicherung -- derselbe Grundsatz wie bei server.yml. */
function adminsSchreiben(eintraege: BetriebsAdminEintrag[]): void {
  mkdirSync(WELTEN_ORDNER, { recursive: true });
  sichern(ADMINS_DATEI, 20);
  const tmp = `${ADMINS_DATEI}.tmp`;
  writeFileSync(tmp, JSON.stringify(eintraege, null, 2));
  renameSync(tmp, ADMINS_DATEI);
}

interface KontoTreffer { name: string; spielerId: string; zuletztGespielt: string | null }

function kontoZeileNachAussen(z: { name: string; spieler_id: string; zuletzt_gespielt: number | null }): KontoTreffer {
  return {
    name: z.name,
    spielerId: z.spieler_id,
    zuletztGespielt: z.zuletzt_gespielt ? new Date(z.zuletzt_gespielt).toISOString() : null,
  };
}

/** Namenssuche fuer die Oberflaeche -- ein Betreiber kennt die spielerId nie auswendig. */
function charaktereSuchen(suche: string, grenze = 20): KontoTreffer[] {
  if (!existsSync(KONTEN_DB)) return [];
  const db = new DatabaseSync(KONTEN_DB, { readOnly: true });
  try {
    // LIKE-Sonderzeichen escapen, sonst durchsucht "50%" oder "a_b" mehr,
    // als der Name hergibt.
    const muster = `%${suche.replace(/[%_\\]/g, (z) => `\\${z}`)}%`;
    const zeilen = db
      .prepare(
        "SELECT name, spieler_id, zuletzt_gespielt FROM charaktere WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ?"
      )
      .all(muster, grenze) as { name: string; spieler_id: string; zuletzt_gespielt: number | null }[];
    return zeilen.map(kontoZeileNachAussen);
  } finally {
    db.close();
  }
}

function charakterNachName(name: string): KontoTreffer | null {
  if (!existsSync(KONTEN_DB)) return null;
  const db = new DatabaseSync(KONTEN_DB, { readOnly: true });
  try {
    const z = db
      .prepare('SELECT name, spieler_id, zuletzt_gespielt FROM charaktere WHERE name = ? COLLATE NOCASE')
      .get(name) as { name: string; spieler_id: string; zuletzt_gespielt: number | null } | undefined;
    return z ? kontoZeileNachAussen(z) : null;
  } finally {
    db.close();
  }
}

function charakterNachSpielerId(spielerId: string): KontoTreffer | null {
  if (!existsSync(KONTEN_DB)) return null;
  const db = new DatabaseSync(KONTEN_DB, { readOnly: true });
  try {
    const z = db
      .prepare('SELECT name, spieler_id, zuletzt_gespielt FROM charaktere WHERE spieler_id = ?')
      .get(spielerId) as { name: string; spieler_id: string; zuletzt_gespielt: number | null } | undefined;
    return z ? kontoZeileNachAussen(z) : null;
  } finally {
    db.close();
  }
}

/** Dienste, die dieser Prozess anfassen darf. Positivliste, keine Freitexte. */
const ERLAUBTE_DIENSTE = ['wov-server', 'nginx'] as const;
type Dienst = (typeof ERLAUBTE_DIENSTE)[number];

/**
 * Getting-started (2026-09-12): "git clone && npm install && npm run dev"
 * hat keinen Operator, der vorab eine Token-Datei unter /etc anlegt. Für
 * genau diesen Fall setzt scripts/dev.mjs WOV_ADMIN_TOKEN_DATEI auf
 * server/data/admin.token (Teil des Checkouts, gitignored) statt des
 * Vorgabewerts /etc/wov-admin.token — und dieser Prozess erzeugt dort,
 * wenn die Datei fehlt, sein eigenes Zufallstoken statt abzubrechen.
 *
 * Der alte harte Abbruch bleibt der wirksame Schutz für den Betriebsfall:
 * Zeigt TOKEN_DATEI weiterhin auf /etc/wov-admin.token (Operator-Pfad,
 * root-only), scheitert das Anlegen an den Dateirechten, und der Prozess
 * bricht genauso ab wie zuvor — nur eben ueber denselben Codepfad statt
 * eines gesonderten.
 *
 * ── Getting started (2026-09-12): "git clone && npm install && npm run
 * dev" has no operator placing a token file under /etc beforehand. For
 * exactly that case scripts/dev.mjs points WOV_ADMIN_TOKEN_DATEI at
 * server/data/admin.token (part of the checkout, gitignored) instead of
 * the default /etc/wov-admin.token — and this process generates its own
 * random token there when the file is missing, instead of exiting.
 *
 * The old hard stop stays the effective guard for the operated case: if
 * TOKEN_DATEI still points at /etc/wov-admin.token (operator path,
 * root-only), creating it fails on file permissions and the process
 * exits exactly as before — just through the same code path rather than
 * a separate one.
 */
function tokenBeschaffen(): string {
  if (existsSync(TOKEN_DATEI)) {
    const vorhanden = readFileSync(TOKEN_DATEI, 'utf-8').trim();
    if (vorhanden) return vorhanden;
  }
  const neu = randomBytes(32).toString('hex');
  try {
    mkdirSync(dirname(TOKEN_DATEI), { recursive: true });
    writeFileSync(TOKEN_DATEI, `${neu}\n`, { mode: 0o600 });
  } catch (fehler) {
    console.error(`[Admin] Kein Token in ${TOKEN_DATEI} und Erzeugen fehlgeschlagen: ${(fehler as Error).message}`);
    process.exit(1);
  }
  console.warn(`[Admin] Kein Token in ${TOKEN_DATEI} — neues Token erzeugt und dort abgelegt (nur für diesen Rechner).`);
  return neu;
}

const token = tokenBeschaffen();

// ── Kleine Helfer ─────────────────────────────────────────────────────

function json(res: ServerResponse, code: number, daten: unknown, kopf: Record<string, string> = {}): void {
  const leib = JSON.stringify(daten);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(leib),
    ...kopf,
  });
  res.end(leib);
}

/** Der Rumpf ueberschreitet die Grenze von `leibLesen`: 413, nicht 500 (der Absender hat sie gerissen, nicht wir). */
class AnfrageZuGross extends Error {}

async function leibLesen(req: IncomingMessage, grenze = 8_000_000): Promise<unknown> {
  const teile: Buffer[] = [];
  let gesamt = 0;
  for await (const stueck of req) {
    gesamt += (stueck as Buffer).length;
    if (gesamt > grenze) throw new AnfrageZuGross(`Anfrage zu gross (mehr als ${grenze} Bytes)`);
    teile.push(stueck as Buffer);
  }
  if (gesamt === 0) return null;
  return JSON.parse(Buffer.concat(teile).toString('utf-8'));
}

/**
 * Wie `leibLesen`, aber OHNE `JSON.parse` — für den Modell-Upload (U1),
 * dessen Körper eine `.glb` ist, kein JSON-Text. Dieselbe `AnfrageZuGross`,
 * damit der bestehende Sammel-catch unten (413, `Connection: close`) sie
 * unverändert auffängt.
 */
async function leibBinaerLesen(req: IncomingMessage, grenze: number): Promise<Buffer> {
  const teile: Buffer[] = [];
  let gesamt = 0;
  for await (const stueck of req) {
    gesamt += (stueck as Buffer).length;
    if (gesamt > grenze) throw new AnfrageZuGross(`Anfrage zu gross (mehr als ${grenze} Bytes)`);
    teile.push(stueck as Buffer);
  }
  return Buffer.concat(teile);
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
// daneben, teils mit Fundstellen), und ein Round-Trip durch einen
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
    await ausfuehren(SYSTEMCTL, ['reload', 'nginx']);
  } catch (fehler) {
    // Kaputte Konfiguration NIE stehen lassen — sonst ist die Seite weg.
    if (sicherung) copyFileSync(sicherung, NGINX_SITE);
    await ausfuehren(SYSTEMCTL, ['reload', 'nginx']).catch(() => undefined);
    throw new Error(`nginx lehnt ab, zurueckgerollt: ${(fehler as Error).message}`);
  }
  return erledigt;
}

// ── Zustand ───────────────────────────────────────────────────────────

async function dienstZustand(name: Dienst): Promise<{ aktiv: boolean; seit: string | null }> {
  try {
    const { stdout } = await ausfuehren(SYSTEMCTL, ['show', name, '--property=ActiveState,ActiveEnterTimestamp']);
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

// ── Betriebsmetriken (G12): GET /metriken ───────────────────────────────
//
// Prometheus-Textformat statt JSON, s. shared/src/metrik.ts fuer die
// Begruendung. admin/ MISST nichts selbst -- kein In-Process-Zugriff auf
// den Spielserver (eigener Prozess, kein HTTP-Server dort, s.
// Kopfkommentar oben im Datei-Header). Stattdessen liest dieser Endpunkt
// nur die Datei, die der Spielserver einmal je Sekunde schreibt
// (WovServer.schreibeMetriken) -- der einfachste Kanal zwischen den
// beiden Prozessen ohne neue Abhaengigkeit: kein IPC, kein zweiter
// HTTP-Server im Spielserver, den man erst wieder absichern muesste.
function metrikenAusgeben(res: ServerResponse): void {
  let text: string;
  let code = 200;
  try {
    const roh = readFileSync(METRIKEN_DATEI, 'utf-8');
    const schnappschuss = JSON.parse(roh) as MetrikSchnappschuss;
    text = formatierePrometheus(schnappschuss, Date.now());
  } catch {
    // Datei fehlt (Server lief noch nie, oder metrikenDatei ist nicht
    // gesetzt) oder ist kaputt. Eine Prometheus-Zeile statt eines nackten
    // HTTP-Fehlers, damit ein Scraper den Ausfall selbst sieht statt nur
    // einen Verbindungsfehler zu protokollieren.
    code = 503;
    text =
      '# HELP wov_metriken_verfuegbar Ob die Metrikdatei lesbar war (1) oder nicht (0)\n' +
      '# TYPE wov_metriken_verfuegbar gauge\n' +
      'wov_metriken_verfuegbar 0\n';
  }
  const puffer = Buffer.from(text, 'utf-8');
  res.writeHead(code, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Content-Length': puffer.length,
  });
  res.end(puffer);
}

// ── Modell-Upload (U1) ───────────────────────────────────────────────────
//
// Eigenes Tor, eigener Schalter (server.yml: uploads.modell-hochladen,
// Vorgabe FALSE) — NICHT dungeons.modulbau mitbenutzt, wie die Karte
// ausdruecklich verlangt: „darf Adminbefehle" (hier: ueberhaupt bis zum
// Betriebsdienst durchdringen — Herkunft+Token) ist eine andere Frage als
// „darf Dateien unter assets/hochgeladen/ anlegen".
//
// Und auf `live` GESPERRT, wie das Weltzuruecksetzen: Diese Karte gilt
// fuer die Entwicklungs-Instanz, der Weg von dev nach live ist eine eigene
// Karte (Ist-Analyse Abschnitt 3 — es gibt dafuer heute keinen
// Mechanismus).
function uploadsErlaubt(): boolean {
  if (INSTANZ === 'live') return false;
  return ymlLesen()['uploads.modell-hochladen'] === 'true';
}

/**
 * `POST /api/modell-hochladen` — VOR der JSON-Weiche wie `/api/serverlog`
 * und `/metriken`: Der Koerper ist eine `.glb`, kein JSON-Text, und
 * `leibLesen()` erzwingt `JSON.parse` IMMER (Ist-Analyse Abschnitt 5).
 * Name und Kollisionswunsch reisen als Kopfzeilen, weil der Koerper damit
 * die REINEN Bytes der Datei bleibt — kein multipart-Parser, keine
 * Base64-Huelle mit einem Drittel Aufschlag.
 */
async function modellHochladenBehandeln(
  req: IncomingMessage,
  res: ServerResponse,
  hochgeladenVon: string
): Promise<void> {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, fehler: 'POST erwartet', message: 'POST erwartet' });
  }
  // N1 (Angriff, Abschnitt "Geprüft und nicht gefunden"/B7-Kleinkram): auf
  // `live` (oder bei ausgeschaltetem Schalter) wird SO der ganze Körper
  // erst gar nicht gelesen -- vorher las `leibBinaerLesen` bis zu 21 MB,
  // bevor `pruefeUndSpeichereUpload` weiter unten den Schalter überhaupt
  // ansah. Nichts landete auf der Platte, aber jeder Aufruf kostete
  // unnötig Bandbreite und Zeit. Dieselbe Ablehnung wie bisher, nur früher.
  if (!uploadsErlaubt()) {
    return json(res, 400, {
      ok: false,
      fehler: 'abgelehnt',
      message: 'Modell-Upload ist auf dieser Instanz nicht erlaubt (server.yml: uploads.modell-hochladen, oder Instanz live).',
    });
  }
  // N2 (Nachangriff, Befund N-1): Dieser Zweig laeuft VOR `behandeln()` (wie
  // `/api/serverlog`) und damit auch vor dessen `moduleAbgleichen()`/
  // `hochgeladenAbgleichen()` -- ohne eigenen Aufruf hier saehe der
  // ALLERERSTE Upload nach einem Neustart dieses Prozesses einen LEEREN
  // Speicher: weder die zur Laufzeit gebauten `Gen_`-Module noch schon auf
  // der Platte stehende Uploads waeren in `PREFABS_BY_HASH`/den
  // Registry-Karten bekannt, und die Gross-/Klein-Sperre (B7) sowie die
  // Hash-Pruefung (B1) liefen gegen einen unvollstaendigen Stand.
  moduleAbgleichen();
  hochgeladenAbgleichen();
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.startsWith('application/octet-stream')) {
    return json(res, 415, {
      ok: false,
      fehler: 'falscher-content-type',
      message: `Erwartet wird 'application/octet-stream', bekommen wurde '${contentType || '(keine Angabe)'}'.`,
    });
  }
  // N1 (Angriff, Befund B6): Kopfzeilenwerte sind ByteStrings -- ein
  // `fetch` mit einem Zeichen über U+00FF (Umlaute eingeschlossen, sobald
  // NICHT in Latin-1, z. B. kyrillisch oder ein Stern) wirft im BROWSER
  // schon beim Setzen der Kopfzeile einen TypeError, bevor die Anfrage
  // überhaupt losgeht -- die UI zeigte dafür nur "Netzwerkfehler:", nie
  // einen ganzen Satz. Der Editor schickt den Namen deshalb jetzt
  // `encodeURIComponent`-kodiert (reines ASCII, jede Kopfzeile erlaubt
  // das), hier wird er zurückübersetzt.
  const angezeigterNameRoh = String(req.headers['x-wov-modellname'] ?? '');
  let angezeigterName: string;
  try {
    angezeigterName = decodeURIComponent(angezeigterNameRoh).trim();
  } catch {
    return json(res, 400, {
      ok: false,
      fehler: 'name-ungueltig-kodiert',
      message: 'Kopfzeile x-wov-modellname ist nicht gültig kodiert (encodeURIComponent erwartet).',
    });
  }
  if (angezeigterName === '') {
    return json(res, 400, { ok: false, fehler: 'name-fehlt', message: 'Kopfzeile x-wov-modellname fehlt oder ist leer.' });
  }
  const kollisionsRoh = String(req.headers['x-wov-kollision'] ?? 'fest');
  if (kollisionsRoh !== 'fest' && kollisionsRoh !== 'durchlaessig') {
    return json(res, 400, {
      ok: false,
      fehler: 'kollision-ungueltig',
      message: `Kollisionsart '${kollisionsRoh}' unbekannt — erwartet wird 'fest' oder 'durchlaessig'.`,
    });
  }

  // Eine Byte-Grenze GRÖSSER als der harte Deckel der Prüfung: Eine zu
  // grosse Datei soll die eigene, sprechende Ablehnung von
  // `pruefeUndSpeichereUpload` bekommen ("Datei zu gross: X > Y Byte"),
  // nicht das nackte 413 des Körperlesers — die Marge lässt dafür genug
  // Bytes durch, um überhaupt bis zu dieser Meldung zu kommen.
  let koerper: Buffer;
  try {
    koerper = await leibBinaerLesen(req, HOCHGELADEN_MAX_BYTES + 1_000_000);
  } catch (fehler) {
    if (fehler instanceof AnfrageZuGross) {
      return json(res, 413, { ok: false, fehler: 'anfrage-zu-gross', message: fehler.message }, { Connection: 'close' });
    }
    throw fehler;
  }

  const antwort = pruefeUndSpeichereUpload(
    { erlaubt: uploadsErlaubt(), verzeichnis: HOCHGELADEN_ORDNER, hochgeladenVon },
    {
      bytes: new Uint8Array(koerper.buffer, koerper.byteOffset, koerper.byteLength),
      angezeigterName,
      kollisionswunsch: kollisionsRoh as Kollisionsart,
    }
  );
  if (!antwort.ok) {
    console.warn(`[Admin] POST /api/modell-hochladen -> abgelehnt: ${antwort.meldung}`);
    return json(res, 400, { ok: false, fehler: 'abgelehnt', message: antwort.meldung });
  }
  console.log(
    `[Admin] Modell hochgeladen: '${antwort.eintrag.name}' (${antwort.eintrag.bytes} Byte, ` +
      `${antwort.eintrag.dreiecke} Dreiecke) von ${hochgeladenVon}`
  );
  return json(res, 200, { ok: true, eintrag: antwort.eintrag, hinweise: antwort.hinweise });
}

// ── Modul-Registry (E8) ─────────────────────────────────────────────────
//
// ── Der Vorfall ──────────────────────────────────────────────────────
// `sanitizeDungeonDocument` verwirft unbekannte Raeume WORTLOS
// (shared/src/dungeons.ts, Kopf: „Unknown rooms are dropped"). Der
// Spielserver darf das, weil er die zur Laufzeit gebauten Saele beim
// Start registriert (server/src/main.ts, ladeModulRegistrierung) — fuer
// ihn ist `Gen_StoneVaultHall4x3` kein unbekannter Raum. Dieser Dienst
// tat es NICHT: Ein Grab mit 18 Raeumen kam bei ihm mit 17 heraus, der
// Editor zeichnete ein Loch mit vierzehn offenen Kanten, und das
// naechste Speichern haette den Saal festgeschrieben.
//
// ── Warum je ANFRAGE und nicht beim Start ────────────────────────────
// Der Spielserver liest die Registry einmal, weil er nach jedem eigenen
// Bau selbst nachtraegt. Dieser Dienst baut nichts und erfaehrt vom Bau
// nichts: Ein Saal entsteht im Spielserver-Prozess und schreibt nur die
// Datei. Ein Lesen beim Start wuerde also genau bis zum ersten neuen
// Modul stimmen — und danach still wieder falsch liegen. Neu gestartet
// wird der Betriebsdienst dabei nie; er startet den Spielserver.
//
// Billig ist das, weil nur der Zeitstempel der Datei angesehen wird.
// Erst wenn der sich geaendert hat, wird gelesen und abgeglichen.
//
// ── Warum ABGLEICH und nicht nur Nachtragen ──────────────────────────
// Module verschwinden auch (`deleteModule`, E9). Ein Dienst, der nur
// nachtraegt, hielte einen geloeschten Saal ewig fuer vorhanden und
// lieferte ein Dokument als heil aus, das der Spielserver nach seinem
// naechsten Start nicht mehr bauen kann. `removeRegistryEntry` ist die
// Rueckseite, die es dafuer braucht.
//
// Per-request re-sync of the runtime module registry: the admin service
// builds nothing and is never restarted, so reading once at start would
// be right only until the next module is built.
let registryStempel = '';

function moduleAbgleichen(): void {
  const pfad = resolve(GENERIERT_ORDNER, REGISTRY_DATEI);
  let stempel = 'fehlt';
  if (existsSync(pfad)) {
    const s = statSync(pfad);
    stempel = `${s.mtimeMs}:${s.size}`;
  }
  if (stempel === registryStempel) return;
  registryStempel = stempel;

  // Eine unlesbare Datei ist hier eine LEERE Registry und kein Absturz:
  // Sie ist auf jeder Maschine abwesend, die nie einen Saal gebaut hat.
  // Was ihr Fehlen NICHT bedeutet, ist „alles in Ordnung" — die
  // Raumzaehlung weiter unten macht daraus eine Meldung statt eines
  // stillen Verlusts.
  const datei = existsSync(pfad) ? leseRegistryAusText(readFileSync(pfad, 'utf8')) : leereRegistry();

  // Erst AUSTRAGEN, dann eintragen. Andersherum liefe ein Saal, dessen
  // Zuschnitt sich geaendert hat (gleicher Name, andere Zellzahl), in die
  // Namenssperre von `registerModule` und bliebe auf dem alten Stand.
  const sollen = new Set(datei.module.map((m) => m.name));
  for (const m of registeredModules()) {
    if (!sollen.has(m.name)) removeRegistryEntry(m.name);
  }
  const erg = applyModuleRegistry(datei);
  // Ablehnungen werden LAUT — dieselbe Begruendung wie im Spielserver:
  // Die Registry ist eine Textdatei neben den GLBs, die ein Mensch
  // bearbeiten kann, und ein still uebergangener Eintrag ist ein Raum,
  // den ein Dokument beim naechsten Speichern verliert.
  for (const zeile of erg.meldungen) console.error(`[Admin/Modulbau] abgelehnt: ${zeile}`);
  console.log(`[Admin/Modulbau] Registry gelesen: ${erg.geladen} Modul(e) bekannt`);
}

// ── Hochgeladene Modelle (U1) ─────────────────────────────────────────
//
// Derselbe Abgleich wie `moduleAbgleichen`, für dieselbe Sorte Grund:
// Dieser Prozess NIMMT den Upload entgegen und trägt ihn beim Schreiben
// selbst sofort ein (`pruefeUndSpeichereUpload` ruft `registerUploadedPrefab`)
// — der Abgleich hier fängt den saubereren, aber selteneren zweiten Fall:
// ein von aussen geänderter Registry-Stand (z. B. nach einem Neustart
// DIESES Prozesses, oder wenn je zwei Betriebsdienst-Prozesse dieselbe
// Instanz bedienen sollten). Anders als bei den Dungeon-Modulen macht
// `applyUploadedModelRegistry` selbst schon AUSTRAGEN+EINTRAGEN in einem
// Zug (s. Kopf von `uploadedModelRegistry.ts`), ein zweiter, manueller
// Austrage-Schritt hier wäre doppelt gemoppelt.
let hochgeladenStempel = '';

function hochgeladenAbgleichen(): void {
  const pfad = resolve(HOCHGELADEN_ORDNER, HOCHGELADEN_REGISTRY_DATEI);
  let stempel = 'fehlt';
  if (existsSync(pfad)) {
    const s = statSync(pfad);
    stempel = `${s.mtimeMs}:${s.size}`;
  }
  if (stempel === hochgeladenStempel) return;
  hochgeladenStempel = stempel;

  const datei = existsSync(pfad)
    ? leseHochgeladenRegistryAusText(readFileSync(pfad, 'utf8'))
    : leereHochgeladenRegistry();
  const erg = applyUploadedModelRegistry(datei);
  for (const zeile of erg.meldungen) console.error(`[Admin/ModellUpload] abgelehnt: ${zeile}`);
  console.log(`[Admin/ModellUpload] Registry gelesen: ${erg.geladen} Modell(e) bekannt`);
}

/**
 * Wie viele Raeume der Sanitizer verworfen hat — und welche.
 *
 * Der ganze Sinn dieses Dienstes ist, dem Editor zu zeigen, was auch der
 * Spielserver sieht. Bleibt nach dem Abgleich oben trotzdem ein Raum
 * unbekannt (auf einer Maschine, deren GLB-Bestand hinterherhinkt, oder
 * nach einem von Hand geloeschten Modul), dann ist die einzige richtige
 * Antwort eine MELDUNG. Ein Dokument mit einem Loch auszuliefern hiesse,
 * dem Editor ein Grab zu zeigen, das es nicht gibt — und die E6-Pruefsumme
 * faengt das beim Speichern NICHT: Sie deckt unbekannte Module ab, nicht
 * einen Raum, den der Editor nie zu Gesicht bekommen hat.
 */
function unbekannteRaeume(roh: unknown, doc: { layout: { rooms: { room: string }[] } }): { anzahl: number; namen: string[] } {
  const layout = ((roh as Record<string, unknown>)?.layout ?? {}) as Record<string, unknown>;
  const rohRaeume = Array.isArray(layout.rooms) ? (layout.rooms as Record<string, unknown>[]) : [];
  const bekannt = new Set(doc.layout.rooms.map((r) => r.room));
  const namen = [
    ...new Set(
      rohRaeume
        .map((r) => (typeof r?.room === 'string' ? r.room : '?'))
        .filter((n) => !bekannt.has(n))
    ),
  ];
  return { anzahl: Math.max(0, rohRaeume.length - doc.layout.rooms.length), namen };
}

/** The world reset's view of this process: files, and the service it stops and starts. Shared by the route and the start-up check. */
function resetUmgebung(): ResetUmgebung {
  return {
    instanz: INSTANZ,
    // `instanzName()` falls back to 'dev' when WOV_INSTANZ is missing; for the reset lock that is not enough (fail closed).
    instanzBestimmt: (process.env.WOV_INSTANZ ?? '').trim() !== '',
    layoutDatei: LAYOUT_DATEI,
    spielstand: resolve(WELTEN_ORDNER, `${INSTANZ}.db.zst`),
    kontenDb: KONTEN_DB,
    dienstStoppen: async () => {
      await ausfuehren(SYSTEMCTL, ['stop', 'wov-server']);
    },
    dienstStarten: async () => {
      await ausfuehren(SYSTEMCTL, ['start', 'wov-server']);
    },
    dienstZustand: () => dienstZustand('wov-server'),
    sichern,
  };
}

// ── Routen ────────────────────────────────────────────────────────────

// `kopf`: zusaetzliche Antwortkopfzeilen (bisher nur der ETag des Weltdokuments).
type Antwort = { code: number; daten: unknown; kopf?: Record<string, string> };

/**
 * Die Basis aus einem If-Match-Wert oder dem Rumpffeld `basis`: der nackte
 * Hash. Ein ETag steht in Anfuehrungszeichen (`"<hash>"`), ein schwacher
 * zusaetzlich mit `W/`; beides wird abgestreift. Alles andere — auch eine
 * Liste oder `*` — bleibt, wie es ist, und passt dann zu keinem Hash: Eine
 * Basis, die nicht eindeutig einen Stand benennt, darf nicht als „passt"
 * durchgehen.
 */
function basisHash(roh: string): string {
  const s = roh.trim().replace(/^W\//, '');
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

async function behandeln(
  pfad: string,
  methode: string,
  leib: unknown,
  // Nur GET /admin/spieler liest hieraus (Namenssuche per ?suche=...).
  // Alle anderen Routen nehmen ihre Eingabe wie bisher aus `leib`, um
  // nicht zwei Uebergabewege fuer dieselbe Sache zu haben.
  parameter: URLSearchParams = new URLSearchParams(),
  // Nur POST /api/worldlayout liest hieraus (If-Match).
  kopfzeilen: IncomingHttpHeaders = {}
): Promise<Antwort> {
  // ── Zustand ──
  if (pfad === '/status' && methode === 'GET') {
    const [server, nginx] = await Promise.all([dienstZustand('wov-server'), dienstZustand('nginx')]);
    return {
      code: 200,
      daten: {
        instanz: INSTANZ,
        dienste: { 'wov-server': server, nginx },
        welt: weltStand(),
        // Not null: a stand-in runs in place of systemctl (tests and proof runs only, see SYSTEMCTL).
        systemctlErsatz: SYSTEMCTL_ERSATZ,
        // K4.0: a world reset that was killed halfway and what state it was left in (empty when there is none).
        zuruecksetzen: zuruecksetzenStatus(resetUmgebung()),
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
    await ausfuehren(SYSTEMCTL, [aktion!, dienst!]);
    return { code: 200, daten: { dienst, aktion, zustand: await dienstZustand(dienst as Dienst) } };
  }

  // ── Admin-Liste (S6-Notausgang) ──
  //
  // Begruendung fuer Pfad, Dateiform, Barrel-Umgehung und Neustart-Hinweis
  // steht ausfuehrlich bei ADMINS_DATEI weiter oben.
  if (pfad === '/admin/liste' && methode === 'GET') {
    return { code: 200, daten: { admins: adminsLesen(), instanz: INSTANZ, hinweis: ADMIN_HINWEIS } };
  }

  // Namenssuche: Ohne sie waere die Route nur mit einer 128-Bit-Zufalls-
  // zahl bedienbar, die kein Betreiber auswendig kennt (Auftrag, Punkt 2).
  // Liest read-only aus derselben Kontendatenbank, die das Spiel selbst
  // beim Anlegen eines Charakters befuellt (charaktere.name/spieler_id).
  if (pfad === '/admin/spieler' && methode === 'GET') {
    const suche = (parameter.get('suche') ?? '').trim();
    if (!suche) return { code: 400, daten: { fehler: 'Parameter "suche" fehlt oder ist leer' } };
    if (suche.length > 100) return { code: 400, daten: { fehler: 'suche: zu lang' } };
    return {
      code: 200,
      daten: {
        treffer: charaktereSuchen(suche),
        instanz: INSTANZ,
        kontendatenbankVorhanden: existsSync(KONTEN_DB),
      },
    };
  }

  if (pfad === '/admin/liste' && methode === 'POST') {
    const eingabe = (leib ?? {}) as { name?: unknown; spielerId?: unknown };
    let spielerId: string;
    let name: string;
    if (eingabe.spielerId !== undefined) {
      // Der Weg fuer den Text aus `admin liste` (Konsole/Chat): der
      // Betreiber hat dort "Name [spielerId]" stehen und kann die
      // Klammer direkt hier einfuegen.
      if (!spielerIdGueltig(eingabe.spielerId)) {
        return { code: 400, daten: { fehler: 'spielerId: ungueltiges Format (erwartet "sp_" + 22 Zeichen)' } };
      }
      spielerId = eingabe.spielerId;
      const eigenerName = typeof eingabe.name === 'string' ? eingabe.name.trim() : '';
      name = eigenerName || charakterNachSpielerId(spielerId)?.name || spielerId;
    } else {
      // Der Weg ueber /admin/spieler?suche=...: Betreiber kennt nur den
      // Namen, die spielerId kommt aus der Kontendatenbank.
      const gesucht = typeof eingabe.name === 'string' ? eingabe.name.trim() : '';
      if (!gesucht) return { code: 400, daten: { fehler: 'name oder spielerId erforderlich' } };
      const treffer = charakterNachName(gesucht);
      if (!treffer) {
        return {
          code: 404,
          daten: {
            fehler: `Unbekannter Spieler: "${gesucht}" (kein Charakter dieses Namens in der Kontendatenbank der Instanz ${INSTANZ} -- GET /admin/spieler?suche=... zum Nachsehen)`,
          },
        };
      }
      ({ spielerId, name } = treffer);
    }
    const aktuelle = adminsLesen();
    const hinzugefuegt = !aktuelle.some((e) => e.spielerId === spielerId);
    if (hinzugefuegt) {
      aktuelle.push({ spielerId, name, seit: new Date().toISOString() });
      adminsSchreiben(aktuelle);
    }
    return { code: 200, daten: { ok: true, hinzugefuegt, admins: aktuelle, hinweis: ADMIN_HINWEIS } };
  }

  if (pfad === '/admin/liste' && methode === 'DELETE') {
    const eingabe = (leib ?? {}) as { name?: unknown; spielerId?: unknown };
    const aktuelle = adminsLesen();
    let ziel: BetriebsAdminEintrag | undefined;
    if (eingabe.spielerId !== undefined) {
      if (!spielerIdGueltig(eingabe.spielerId)) {
        return { code: 400, daten: { fehler: 'spielerId: ungueltiges Format (erwartet "sp_" + 22 Zeichen)' } };
      }
      ziel = aktuelle.find((e) => e.spielerId === eingabe.spielerId);
    } else if (typeof eingabe.name === 'string' && eingabe.name.trim()) {
      // Entfernen braucht keine Kontendatenbank: der Name steht schon in
      // der Admin-Liste selbst (AdminEintrag.name), nur die Suche danach
      // ist hier case-insensitiv wie die spieler-Namensvergabe im Spiel.
      const gesucht = eingabe.name.trim().toLowerCase();
      ziel = aktuelle.find((e) => e.name.toLowerCase() === gesucht);
    } else {
      return { code: 400, daten: { fehler: 'name oder spielerId erforderlich' } };
    }
    if (!ziel) {
      return { code: 200, daten: { ok: true, entfernt: false, admins: aktuelle, hinweis: ADMIN_HINWEIS } };
    }
    const rest = aktuelle.filter((e) => e.spielerId !== ziel!.spielerId);
    adminsSchreiben(rest);
    return { code: 200, daten: { ok: true, entfernt: true, admins: rest, hinweis: ADMIN_HINWEIS } };
  }

  // ── Weltdokument ──
  //
  // Pfadname und Methode bleiben, was sie im Vite-Plugin waren: POST
  // /api/worldlayout. Deutsche Endpunktnamen waeren Kosmetik und gehoeren
  // nicht in denselben Umbau. Dazu kamen (Editor E1): PATCH
  // /api/worldlayout/ops fuer einzelne Objekte (keine Basis noetig) und
  // POST mit `If-None-Match: *`, das die Weltdatei anlegt, wenn sie fehlt.
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
      const fehlt = `${basename(LAYOUT_DATEI)} fehlt (Instanz ${INSTANZ}) — WOV_INSTANZ, WOV_WELT_VERZEICHNIS und server/data/welten/ pruefen.`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    // Basisversion (E0): Der Hash gehoert zu den BYTES auf der Platte, aus
    // denen `layout` eben gelesen wurde (eine Lesung, keine zwei). Er steht
    // als ETag-Kopf UND im Rumpf — der Editor liest den Rumpf, ein
    // Zwischenspeicher oder curl -i sieht den Kopf. Der Client schickt ihn
    // beim Speichern als If-Match bzw. `basis` zurueck.
    const { layout, hash } = layoutLesenMitHash(LAYOUT_DATEI);
    // Verschwindet die Datei zwischen `existsSync` und hier, fehlt die
    // Kennung nur (statt eines 500): Der MCP-Server verweigert das Schreiben
    // dann. / A vanished file only drops the kennung instead of a 500.
    let weltKennung: string | undefined;
    try {
      weltKennung = createHash('sha256').update(realpathSync(LAYOUT_DATEI)).digest('hex');
    } catch {
      /* ohne Kennung antworten */
    }
    return {
      code: 200,
      kopf: { ETag: `"${hash}"` },
      daten: {
        ok: true,
        message: `${basename(LAYOUT_DATEI)}: ${layout.regions.length} Region(en), ${layout.placements?.length ?? 0} Platzierung(en)`,
        instanz: INSTANZ,
        datei: basename(LAYOUT_DATEI),
        // Welche Datei das ist, ohne den Pfad preiszugeben: Der MCP-Server
        // vergleicht sie mit der Weltdatei SEINES Checkouts und schreibt nur
        // dorthin (tools/worldlayout-mcp/server.ts). / Which file this is,
        // without leaking the path.
        ...(weltKennung ? { weltKennung } : {}),
        hash,
        layout,
      },
    };
  }
  // E8: Bevor unten ein Dokument durch den Sanitizer geht, muss dieser
  // Prozess dieselben Module kennen wie der Spielserver — sonst faellt
  // ein zur Laufzeit gebauter Saal WORTLOS heraus. Die Begruendung, warum
  // das je Anfrage geschieht und nicht beim Start, steht bei
  // `moduleAbgleichen`. Der Aufruf steht VOR allen vier Dungeon-Routen
  // (1.0 und 2.0), damit keine von ihnen ihn vergessen kann.
  // E8: sync the runtime module registry before any document is sanitized.
  moduleAbgleichen();
  // U1: derselbe Abgleich für hochgeladene Modelle — VOR jeder Route, die
  // gegen `istEigenesModell`/`PREFABS_BY_NAME` prüft (Weltlayout-Speichern,
  // Katalog-Zahlen) oder eine Entfernung anstösst.
  hochgeladenAbgleichen();

  // ── Hochgeladenes Modell entfernen (U1) ──
  //
  // JSON-Körper wie DELETE /admin/liste: Die URL allein kennt keine
  // Kennung. Ohne `bestaetigt` UND bestehende Nutzung wird NICHTS
  // angefasst — die Antwort nennt nur Zahl und Orte (Karte, Abschnitt 5:
  // „Platzierungen, die es noch benutzen, werden vorher genannt").
  if (pfad === '/api/modell-hochladen' && methode === 'DELETE') {
    const { name, bestaetigt } = (leib ?? {}) as { name?: string; bestaetigt?: boolean };
    if (!name || typeof name !== 'string') {
      return { code: 400, daten: { ok: false, fehler: 'name-fehlt', message: 'Körperfeld "name" fehlt.' } };
    }
    const antwort = entferneUpload(
      { erlaubt: uploadsErlaubt(), verzeichnis: HOCHGELADEN_ORDNER, layoutDatei: LAYOUT_DATEI },
      name,
      bestaetigt === true
    );
    if ('brauchtBestaetigung' in antwort) {
      return {
        code: 409,
        daten: {
          ok: false,
          brauchtBestaetigung: true,
          nutzung: antwort.nutzung,
          message:
            `'${name}' wird noch ${antwort.nutzung.anzahl} Mal platziert. Erneut mit ` +
            `"bestaetigt": true aufrufen, um trotzdem zu entfernen.`,
        },
      };
    }
    if (!antwort.ok) {
      return { code: 400, daten: { ok: false, fehler: 'abgelehnt', message: antwort.meldung } };
    }
    console.log(`[Admin] Modell entfernt: '${antwort.name}', ${antwort.verbleibend} verbleiben`);
    return { code: 200, daten: { ok: true, name: antwort.name, verbleibend: antwort.verbleibend } };
  }

  // ── Dungeon-Dokumente (nur lesen) ──
  //
  // Der Karteneditor zeichnet Grundrisse daraus. GESCHRIEBEN wird hier
  // nichts: Der Betriebsdienst ist ein anderer Prozess als der
  // Spielserver, und eine Datei, die er anlegt, kennt dessen `documents`
  // im Arbeitsspeicher nicht. Speichern laeuft deshalb ueber den
  // Spielserver-Socket (`DungeonEditSave`), der sanitisiert, persistiert
  // und die Instanz gleich neu aufbaut.
  if (pfad === '/api/dungeons' && methode === 'GET') {
    if (!existsSync(DUNGEON_ORDNER)) {
      // Kein Ordner heisst „noch keiner gebaut" und ist kein Fehler —
      // anders als eine fehlende Weltdatei, ohne die der Server nicht
      // startet. Eine leere Liste ist die ehrliche Antwort.
      return {
        code: 200,
        daten: { ok: true, message: `Keine Dungeons (Instanz ${INSTANZ})`, instanz: INSTANZ, dungeons: [] },
      };
    }
    const liste: unknown[] = [];
    const kaputt: string[] = [];
    /** E8: Dokumente, deren Raeume dieser Dienst nicht vollstaendig kennt. */
    const mitLoch: string[] = [];
    for (const datei of readdirSync(DUNGEON_ORDNER)) {
      if (!datei.endsWith('.json') || datei === 'entrances.json') continue;
      try {
        const roh = JSON.parse(readFileSync(resolve(DUNGEON_ORDNER, datei), 'utf-8'));
        // AP15.0: Ein 2.0-Dokument ist hier nicht „kaputt", es ist nur am
        // falschen Schalter. Dieselbe Weiche wie im Spielserver-Loader
        // (DungeonManager.load) — s. GET /api/dungeons2 weiter unten.
        // AP15.0: a 2.0 document is not "broken" here, it is simply at the
        // wrong switch. Same fork as the game server's loader.
        if (istDokument2(roh)) continue;
        const doc = sanitizeDungeonDocument(roh);
        if (!doc) {
          kaputt.push(datei);
          continue;
        }
        // Nur der Kopf, nicht das Layout: Ein Dokument mit 50 Raeumen ist
        // schnell 20 kB, und die Liste dient dem Auswaehlen. Das Layout
        // holt der Editor beim Oeffnen einzeln.
        //
        // E8: `raeume` bleibt die Zahl der Raeume, die WIRKLICH gebaut
        // wuerden; `unbekannteRaeume` steht daneben. Die Uebersicht
        // stillschweigend auf die Rohzahl zu heben waere die zweite Luege
        // ueber dasselbe Dokument — hier soll sichtbar sein, dass etwas
        // fehlt, nicht dass alles da ist.
        const verlust = unbekannteRaeume(roh, doc);
        if (verlust.anzahl > 0) mitLoch.push(doc.id);
        liste.push({
          id: doc.id,
          name: doc.name,
          base: doc.base,
          mode: doc.mode,
          seed: doc.seed,
          raeume: doc.layout.rooms.length,
          tueren: doc.layout.doors.length,
          deko: doc.layout.props.length,
          unbekannteRaeume: verlust.anzahl,
        });
      } catch {
        kaputt.push(datei);
      }
    }
    liste.sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));
    return {
      code: 200,
      daten: {
        ok: true,
        message:
          `${liste.length} Dungeon(s) in Instanz ${INSTANZ}` +
          (kaputt.length ? `, ${kaputt.length} unlesbar (${kaputt.join(', ')})` : '') +
          (mitLoch.length ? `, ${mitLoch.length} mit unbekannten Raeumen (${mitLoch.join(', ')})` : ''),
        instanz: INSTANZ,
        dungeons: liste,
      },
    };
  }
  if (pfad.startsWith('/api/dungeons/') && methode === 'GET') {
    const id = pfad.slice('/api/dungeons/'.length);
    // Kein Pfad, sondern eine Kennung: Alles ausser Kleinbuchstaben,
    // Ziffern und Bindestrich fliegt raus, BEVOR daraus ein Dateiname
    // wird. Ohne diese Zeile waere `../../etc/passwd` eine gueltige
    // Dungeon-ID.
    if (!/^[a-z0-9-]{1,64}$/.test(id)) {
      return { code: 400, daten: { ok: false, fehler: 'Ungueltige Dungeon-ID', message: 'Ungueltige Dungeon-ID' } };
    }
    const datei = resolve(DUNGEON_ORDNER, `${id}.json`);
    if (!existsSync(datei)) {
      const fehlt = `Dungeon ${id} nicht gefunden (Instanz ${INSTANZ})`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    let roh: unknown;
    try {
      roh = JSON.parse(readFileSync(datei, 'utf-8'));
    } catch {
      roh = null;
    }
    // AP15.0: Ein 2.0-Dokument unter dieser ID ist fuer DIESEN Endpunkt
    // nicht vorhanden, nicht kaputt — es gehoert zu GET /api/dungeons2/:id.
    // 404 statt 422 sagt „falscher Weg", nicht „Dokument beschaedigt".
    // AP15.0: a 2.0 document under this id does not EXIST for THIS
    // endpoint, it is not broken — it belongs to GET /api/dungeons2/:id.
    if (roh !== null && istDokument2(roh)) {
      const fehlt = `Dungeon ${id} nicht gefunden (Instanz ${INSTANZ})`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    const doc = roh === null ? null : sanitizeDungeonDocument(roh);
    if (!doc) {
      const kaputt = `${id}.json ist unbrauchbar (Basis, ID oder Raeume ungueltig)`;
      return { code: 422, daten: { ok: false, fehler: kaputt, message: kaputt } };
    }
    // ── E8: lieber gar nicht oeffnen als mit einem Loch ────────────────
    //
    // Nach `moduleAbgleichen` kennt dieser Dienst dieselben Module wie
    // der Spielserver. Fehlt danach IMMER NOCH ein Raum, dann fehlt er
    // wirklich — das GLB ist nie angekommen, oder jemand hat den Eintrag
    // von Hand entfernt. Das Dokument trotzdem auszuliefern, waere der
    // teuerste aller Ausgaenge: Der Editor zeichnete ein Grab mit einem
    // Loch, der Benutzer schoebe die Kanten zurecht, und sein Speichern
    // machte den Verlust dauerhaft. Die E6-Pruefsumme faengt das NICHT —
    // sie vergleicht die Modulstaende beider Seiten, und die sind sich
    // hier ja einig: Beide kennen den Saal nicht.
    //
    // 422 und nicht 200 mit Warnfeld, weil der Editor sonst entscheiden
    // muesste, ob er trotzdem oeffnet — und ein Warnfeld, das man
    // wegklicken kann, wird weggeklickt.
    //
    // E8: refuse rather than hand out a document with a hole in it.
    const verlust = unbekannteRaeume(roh, doc);
    if (verlust.anzahl > 0) {
      const loch =
        `${id}.json nennt ${verlust.anzahl} Raum/Raeume, die dieser Dienst nicht kennt ` +
        `(${verlust.namen.join(', ')}) — nicht geoeffnet. Sonst zeigte der Editor ein Grab ` +
        `mit einem Loch und schriebe es beim naechsten Speichern fest. ` +
        `Fehlt ein gebautes Modul, gehoert es in ${REGISTRY_DATEI}.`;
      return { code: 422, daten: { ok: false, fehler: loch, message: loch, unbekannteRaeume: verlust.anzahl, namen: verlust.namen } };
    }
    return {
      code: 200,
      daten: {
        ok: true,
        message: `${doc.id}: ${doc.layout.rooms.length} Raum/Raeume, ${doc.layout.doors.length} Tuer(en), ${doc.layout.props.length} Deko`,
        instanz: INSTANZ,
        dungeon: doc,
        unbekannteRaeume: 0,
      },
    };
  }

  // ── Dungeon-Dokumente 2.0 (AP15.0, nur lesen) ──
  //
  // EIGENE Routen statt eines Format-Feldes an den obigen — aus demselben
  // Grund, aus dem `DungeonManager` zwei Karten statt einer mit Union-Typ
  // haelt (s. Kommentar dort): Der Legacy-Client
  // (`client/src/editor/DungeonDokument.ts`, holeDungeonListe/holeDungeon)
  // erwartet an `/api/dungeons` fest die Kopf-Form { base, mode, seed,
  // raeume, tueren, deko } und an `/api/dungeons/:id` ein volles
  // DungeonDocument mit `layout.rooms`. Ein 2.0-Dokument hat weder `base`
  // noch zwingend ein `layout` (Modus 'erzeugt' traegt nur Seeds) — jede
  // gemeinsame Antwortform waere entweder fuer den Alt-Client eine Luecke
  // (Felder fehlen) oder fuer den 2.0-Client eine Verrenkung (Felder, die
  // nichts bedeuten). Zwei Routen sind die Aussage „zwei Formate" noch
  // einmal, diesmal auf HTTP-Ebene, und der kommende 2.0-Katalog-Client
  // (AP15.2) kann direkt gegen sie tippen, ohne ein `format`-Feld pruefen
  // zu muessen.
  //
  // OWN routes instead of a format field on the ones above — the same
  // reason `DungeonManager` keeps two maps rather than a union type: the
  // legacy client expects a fixed head shape at `/api/dungeons` and a full
  // DungeonDocument at `/api/dungeons/:id`. A 2.0 document has neither
  // `base` nor necessarily a `layout`. Two routes state "two formats" once
  // more, this time at the HTTP level, and the upcoming 2.0 catalogue
  // client (AP15.2) can type against them directly.
  if (pfad === '/api/dungeons2' && methode === 'GET') {
    if (!existsSync(DUNGEON_ORDNER)) {
      return {
        code: 200,
        daten: { ok: true, message: `Keine 2.0-Dungeons (Instanz ${INSTANZ})`, instanz: INSTANZ, dungeons: [] },
      };
    }
    const liste: unknown[] = [];
    const kaputt: string[] = [];
    for (const datei of readdirSync(DUNGEON_ORDNER)) {
      if (!datei.endsWith('.json') || datei === 'entrances.json') continue;
      try {
        const roh = JSON.parse(readFileSync(resolve(DUNGEON_ORDNER, datei), 'utf-8'));
        if (!istDokument2(roh)) continue; // gehoert zu /api/dungeons, nicht hierher / belongs to /api/dungeons, not here
        const doc = sanitizeDungeonDokument2(roh);
        if (!doc) {
          kaputt.push(datei);
          continue;
        }
        // Raum-/Tuerzahl NUR bei modus 'gebaut': Dort steht das Layout
        // schon im Dokument, Zaehlen kostet nichts. Bei 'erzeugt' fehlt es
        // und muesste der Generator erst herstellen — fuer eine Liste, die
        // ueber ALLE Dungeons laeuft, waere das der teure Vollausbau, den
        // die Aufgabe ausdruecklich vermeiden will.
        // Room/door count ONLY for modus 'gebaut': there the layout already
        // sits in the document, counting is free. For 'erzeugt' it is
        // absent and the generator would first have to produce it — across
        // ALL dungeons in a list, that is exactly the expensive full build
        // this endpoint must avoid.
        const kennzahlen =
          doc.modus === 'gebaut' && doc.layout
            ? { raeume: doc.layout.stempel.length, tueren: doc.layout.tueren.length }
            : {};
        liste.push({
          id: doc.id,
          name: doc.name,
          thema: doc.thema,
          modus: doc.modus,
          version: doc.version,
          ambientLicht: ambientLichtVon(doc),
          pruefsumme: doc.pruefsumme,
          ...kennzahlen,
        });
      } catch {
        kaputt.push(datei);
      }
    }
    liste.sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));
    return {
      code: 200,
      daten: {
        ok: true,
        message:
          `${liste.length} 2.0-Dungeon(s) in Instanz ${INSTANZ}` +
          (kaputt.length ? `, ${kaputt.length} unlesbar (${kaputt.join(', ')})` : ''),
        instanz: INSTANZ,
        dungeons: liste,
      },
    };
  }
  if (pfad.startsWith('/api/dungeons2/') && methode === 'GET') {
    const id = pfad.slice('/api/dungeons2/'.length);
    // Dasselbe Muster wie ID_MUSTER in shared/src/dungeon2/document.ts
    // (Unterstrich erlaubt, anders als bei der 1.0-Route) — die
    // Duplikation ist dort ausdruecklich in Kauf genommen (s. Kopfkommentar
    // der Datei), damit dieser Prozess `document.ts` importieren kann, ohne
    // dessen private Konstanten zu exportieren.
    // Same pattern as ID_MUSTER in shared/src/dungeon2/document.ts
    // (underscore allowed, unlike the 1.0 route) — the duplication is
    // deliberately accepted there.
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      return { code: 400, daten: { ok: false, fehler: 'Ungueltige Dungeon-ID', message: 'Ungueltige Dungeon-ID' } };
    }
    const datei = resolve(DUNGEON_ORDNER, `${id}.json`);
    if (!existsSync(datei)) {
      const fehlt = `Dungeon ${id} nicht gefunden (Instanz ${INSTANZ})`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    let roh: unknown;
    try {
      roh = JSON.parse(readFileSync(datei, 'utf-8'));
    } catch {
      roh = null;
    }
    // Ein 1.0-Dokument unter dieser ID ist fuer DIESEN Endpunkt nicht
    // vorhanden — spiegelbildlich zu oben.
    // A 1.0 document under this id does not exist for THIS endpoint —
    // the mirror image of the case above.
    if (roh === null || !istDokument2(roh)) {
      const fehlt = `Dungeon ${id} nicht gefunden (Instanz ${INSTANZ})`;
      return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
    }
    const doc: DungeonDokument2 | null = sanitizeDungeonDokument2(roh);
    if (!doc) {
      const kaputt = `${id}.json ist unbrauchbar (Thema, Kennung oder Seeds ungueltig)`;
      return { code: 422, daten: { ok: false, fehler: kaputt, message: kaputt } };
    }
    return {
      code: 200,
      daten: {
        ok: true,
        message: `${doc.id}: Thema ${doc.thema}, Modus ${doc.modus}`,
        instanz: INSTANZ,
        dungeon: doc,
      },
    };
  }

  // Einzelne Objekte aendern statt das ganze Dokument ersetzen (Editor E1, K1.2).
  if (pfad === '/api/worldlayout/ops' && methode === 'PATCH') return weltOpsBehandeln(leib, { datei: LAYOUT_DATEI, instanz: INSTANZ });

  if (pfad === '/api/worldlayout' && methode === 'POST') {
    // Gepruefte wird mit sanitizeWorldLayout, der STRENGEN Pruefung —
    // die Vite-Konfig konnte @wov/shared nicht laden und musste sich mit
    // einem Struktur-Check begnuegen. Dieser Prozess laeuft unter tsx und
    // kann es. Damit gilt: Was auf der Platte landet, haette der
    // Spielserver auch akzeptiert.
    //
    // Basisversion (E0): Der Rumpf IST das Dokument; ein zusaetzliches
    // Feld `basis` auf oberster Ebene benennt den Hash, auf den sich der
    // Schreiber bezieht (der Kopf If-Match tut dasselbe und gewinnt). Es
    // wird abgetrennt, bevor das Dokument den Sanitizer sieht. Ohne Basis
    // wird nichts geschrieben (428): Editor, Testflug und MCP schicken seit
    // E0 eine, und ein Schreiber ohne Basis koennte jede fremde Aenderung
    // stillschweigend ueberschreiben. Einzelne Objekte aendert
    // PATCH /api/worldlayout/ops, das braucht keine Basis.
    //
    // Eine FEHLENDE Weltdatei hat keinen Hash, den man als Basis schicken
    // koennte (GET liefert 404). Sie legt `If-None-Match: *` an: geschrieben
    // wird nur, wenn es die Datei nicht gibt, sonst 412 mit dem Hash der
    // vorhandenen (die Basis fuer den normalen Weg). Zusammen mit If-Match /
    // basis ist der Kopf ein Widerspruch (400). Siehe weltOps.ts.
    let dokument: unknown = leib;
    let rumpfBasis: unknown;
    if (typeof leib === 'object' && leib !== null && !Array.isArray(leib) && 'basis' in leib) {
      const { basis: b, ...rest } = leib as Record<string, unknown>;
      rumpfBasis = b;
      dokument = rest;
    }
    const kopfBasis = kopfzeilen['if-match'];
    let basis: string | null = null;
    if (typeof kopfBasis === 'string') basis = basisHash(kopfBasis);
    else if (typeof rumpfBasis === 'string') basis = basisHash(rumpfBasis);
    else if (rumpfBasis !== undefined && rumpfBasis !== null) {
      throw new LayoutUngueltig('basis muss ein Hash-Text sein');
    }
    const kopfNeu = kopfzeilen['if-none-match'];
    const anlegen = kopfNeu !== undefined;
    if (anlegen) {
      if (typeof kopfNeu !== 'string' || kopfNeu.trim() !== '*') {
        throw new LayoutUngueltig('If-None-Match: nur * wird verstanden (Datei nur anlegen, wenn sie fehlt)');
      }
      if (basis !== null) throw new LayoutUngueltig('If-None-Match: * und If-Match / basis schliessen sich aus');
    } else if (basis === null) {
      const meldung =
        'Speichern ohne Basis: If-Match (oder das Feld "basis") mit dem Hash aus GET /api/worldlayout fehlt — ' +
        'nichts geschrieben. Erst lesen, dann mit dem gelesenen Hash speichern; fehlt die Weltdatei ganz, ' +
        'legt sie POST mit If-None-Match: * an.';
      console.warn(`[Admin] POST /api/worldlayout -> 428 basis-fehlt: ${basename(LAYOUT_DATEI)} nicht geschrieben`);
      return { code: 428, daten: { ok: false, fehler: 'basis-fehlt', message: meldung } };
    }
    try {
      // Async: Wartet ein fremder Schreiber auf der Sperre, bleibt die
      // Ereignisschleife frei (/status, /metriken, der Log-Strom laufen weiter).
      let geschrieben;
      if (anlegen) {
        const a = await weltAnlegen(LAYOUT_DATEI, dokument);
        if (a.art === 'existiert') {
          const meldung = `${basename(LAYOUT_DATEI)} gibt es schon — nichts geschrieben. Lesen (GET) und mit dem Hash als If-Match speichern.`;
          console.warn(`[Admin] POST /api/worldlayout -> 412 existiert (If-None-Match: *, aktuell ${a.hash})`);
          return {
            code: 412,
            kopf: { ETag: `"${a.hash}"` },
            daten: { ok: false, fehler: 'existiert', aktuell: a.hash, message: meldung },
          };
        }
        geschrieben = a.ergebnis;
      } else {
        geschrieben = await layoutSchreibenAsync(LAYOUT_DATEI, dokument, undefined, { basis });
      }
      const { layout, sicherung, text, hash, verworfen, verworfenJeFeld, zusammengefasst, zusammengefasstJeFeld } = geschrieben;
      if (verworfen > 0) {
        console.warn(
          `[Admin] POST /api/worldlayout: ${verworfen} ungueltige(r) Eintrag/Eintraege im Dokument verworfen ` +
            `(${Object.entries(verworfenJeFeld).map(([feld, n]) => `${feld} ${n}`).join(', ')}), Rest gespeichert`
        );
      }
      return {
        code: anlegen ? 201 : 200,
        kopf: { ETag: `"${hash}"` },
        daten: {
          ok: true,
          message:
            `${anlegen ? 'Angelegt' : 'Gespeichert'} in ${basename(LAYOUT_DATEI)}: ${layout.regions.length} Region(en), ` +
            `${layout.placements?.length ?? 0} Platzierung(en)`,
          instanz: INSTANZ,
          sicherung: sicherung ? basename(sicherung) : null,
          bytes: Buffer.byteLength(text),
          hash,
          // `verworfen` = Summe (Zahl, wie bisher), `verworfenJeFeld` = dieselbe Zahl je Liste.
          ...(verworfen > 0 ? { verworfen, verworfenJeFeld } : {}),
          // Exakte Duplikate, die der Sanitizer zu einem Eintrag zusammengefasst hat: KEIN Verlust, zählt nicht bei `verworfen`.
          ...(zusammengefasst > 0 ? { zusammengefasst, zusammengefasstJeFeld } : {}),
        },
      };
    } catch (fehler) {
      // Zusatzfelder `ok`/`message` neben `fehler`: Der bestehende Client
      // liest nur diese beiden, und eine Ablehnung soll bei ihm nicht als
      // leere Meldung ankommen.
      if (fehler instanceof LayoutVeraltet) {
        const meldung = 'Das Weltdokument hat sich seit dem Laden geaendert — neu laden und erneut speichern.';
        console.warn(`[Admin] POST /api/worldlayout -> 409 veraltet (Basis ${basis}, aktuell ${fehler.aktuell})`);
        return {
          code: 409,
          ...(fehler.aktuell ? { kopf: { ETag: `"${fehler.aktuell}"` } } : {}),
          daten: { ok: false, fehler: 'veraltet', aktuell: fehler.aktuell, message: meldung },
        };
      }
      if (fehler instanceof LayoutZuVielePlatzierungen) {
        console.warn(
          `[Admin] POST /api/worldlayout -> 422 zu-viele-platzierungen: ${fehler.anzahl} > ${fehler.grenze}, nichts gespeichert`
        );
        return {
          code: 422,
          daten: {
            ok: false,
            fehler: 'zu-viele-platzierungen',
            anzahl: fehler.anzahl,
            grenze: fehler.grenze,
            message: fehler.message,
          },
        };
      }
      if (fehler instanceof LayoutFeldUngueltig) {
        console.warn(`[Admin] POST /api/worldlayout -> 422 ungueltig: ${fehler.message}`);
        return {
          code: 422,
          daten: { ok: false, fehler: 'ungueltig', feld: fehler.feld, message: fehler.message },
        };
      }
      if (fehler instanceof LayoutGesperrt) {
        console.warn(`[Admin] POST /api/worldlayout -> 503: ${fehler.message}`);
        // Retry-After: Die Sperre eines Schreibers, der gerade arbeitet, ist in
        // Millisekunden weg; ein Wiederholen nach ein paar Sekunden ist richtig.
        return {
          code: 503,
          kopf: { 'Retry-After': '3' },
          daten: { ok: false, fehler: 'gesperrt', message: fehler.message },
        };
      }
      throw fehler;
    }
  }

  // ── Testwelt: die Karte einmal frisch erzeugen lassen ────────────────
  //
  // Anlass: Der Editor konnte ein Layout speichern, aber nicht sehen, was
  // daraus wird. Ein blosser Serverneustart genuegt dafuer NICHT — das
  // Terrain entsteht zwar neu aus dem Layout (WovServer createGeo), aber
  // `ZoneManager` laedt die bereits besiedelten Zonen aus dem Weltspeicher
  // (ZoneManager.ts, "Restore generated zones").
  // Auf der dev-Welt sind das 811 Zonen und ueber 94.000 ZDOs: Man saehe
  // neues Gelaende mit alter Vegetation, Haeuser in der Luft oder im Hang,
  // und die geaenderte Insel nur dort richtig, wo man nie war.
  //
  // Deshalb wird die Weltdatei beiseitegelegt statt weiterbenutzt. Der
  // Server findet dann keinen Spielstand und erzeugt alles frisch aus dem
  // Layout — das ist der einzige Zustand, in dem eine Karte zeigt, was sie
  // ist.
  //
  // Reihenfolge ist nicht beliebig: Der Server haelt die Datei offen und
  // schreibt sie im Speicherintervall. Getauscht wird deshalb NUR im
  // gestoppten Zustand, sonst laege danach wieder der alte Stand da.
  //
  // Nichts wird geloescht: Die echte Welt geht nach `.beiseite`, die
  // Testwelt beim Zurueckholen nach `testwelt.db.zst` (wird beim naechsten
  // Lauf ueberschrieben). Zusaetzlich haengt eine regulaere Sicherung ueber
  // `sichern()` daran, 20 Generationen.
  if (pfad === '/api/testwelt' && methode === 'GET') {
    const welt = resolve(WELTEN_ORDNER, `${INSTANZ}.db.zst`);
    return {
      code: 200,
      daten: {
        aktiv: existsSync(`${welt}.beiseite`),
        welt: basename(welt),
        weltVorhanden: existsSync(welt),
        instanz: INSTANZ,
        // Damit der Editor waehrend eines Neustarts etwas ANDERES zeigen
        // kann als einen Balken: Er fragt hier im Sekundentakt nach.
        zustand: await dienstZustand('wov-server'),
      },
    };
  }

  if (pfad === '/api/testwelt' && methode === 'POST') {
    const { aktion } = (leib ?? {}) as { aktion?: string };
    if (aktion !== 'starten' && aktion !== 'zurueck') {
      return { code: 400, daten: { fehler: 'aktion muss "starten" oder "zurueck" sein' } };
    }
    const welt = resolve(WELTEN_ORDNER, `${INSTANZ}.db.zst`);
    const beiseite = `${welt}.beiseite`;
    const vorher = `${welt}.prev`;
    const vorherBeiseite = `${vorher}.beiseite`;
    const testAblage = resolve(WELTEN_ORDNER, 'testwelt.db.zst');

    if (aktion === 'starten' && existsSync(beiseite)) {
      return { code: 409, daten: { fehler: 'Es laeuft bereits eine Testwelt — erst zurueckholen' } };
    }
    if (aktion === 'zurueck' && !existsSync(beiseite)) {
      return { code: 409, daten: { fehler: 'Keine Testwelt aktiv — nichts zurueckzuholen' } };
    }

    let sicherung: string | null = null;
    if (aktion === 'starten') sicherung = sichern(welt, 20);

    await ausfuehren(SYSTEMCTL, ['stop', 'wov-server']);
    try {
      if (aktion === 'starten') {
        if (existsSync(welt)) renameSync(welt, beiseite);
        if (existsSync(vorher)) renameSync(vorher, vorherBeiseite);
      } else {
        // Die Testwelt aufheben statt loeschen — wer sie noch einmal
        // ansehen will, findet sie unter testwelt.db.zst.
        if (existsSync(welt)) renameSync(welt, testAblage);
        if (existsSync(vorher)) unlinkSync(vorher);
        renameSync(beiseite, welt);
        if (existsSync(vorherBeiseite)) renameSync(vorherBeiseite, vorher);
      }
    } finally {
      // Auch wenn der Tausch schiefgeht: Der Server muss wieder laufen.
      await ausfuehren(SYSTEMCTL, ['start', 'wov-server']);
    }

    return {
      code: 200,
      daten: {
        ok: true,
        aktion,
        aktiv: existsSync(beiseite),
        sicherung: sicherung ? basename(sicherung) : null,
        message:
          aktion === 'starten'
            ? `Testwelt gestartet — ${basename(welt)} liegt beiseite, der Server erzeugt die Karte neu aus dem Layout.`
            : `dev-Welt zurueckgeholt. Die Testwelt liegt als ${basename(testAblage)} daneben.`,
        zustand: await dienstZustand('wov-server'),
      },
    };
  }

  // ── Welt zuruecksetzen: alles auf null (Editor K4.0) ──
  //
  // Begruendung, Reihenfolge und Sicherungen stehen im Kopf von
  // routen/weltZuruecksetzen.ts. Hier nur die Verdrahtung.
  if (pfad === '/api/welt-zuruecksetzen') {
    if (methode !== 'GET' && methode !== 'POST') {
      return { code: 405, daten: { ok: false, fehler: 'GET oder POST erwartet', message: 'GET oder POST erwartet' } };
    }
    const umgebung = resetUmgebung();
    return methode === 'GET' ? weltZuruecksetzenVorschau(umgebung) : weltZuruecksetzenBehandeln(leib, umgebung);
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

// ── Fremde Seiten: zustandsaendernde Anfragen ────────────────────────
//
// Token und Netz-Riegel sagen, WER anklopft, nicht, in wessen Auftrag. Eine
// fremde Webseite kann den Browser eines Editor-Nutzers eine Anfrage an diesen
// Dienst schicken lassen (der Vorschalter setzt den Token serverseitig, der
// Nutzer ist angemeldet). Ohne Herkunftspruefung genuegt dafuer ein Formular
// oder ein fetch mit `Content-Type: text/plain` (das braucht keinen
// Preflight), und die Welt ist zurueckgesetzt.
//
// Regel fuer POST/PUT/PATCH/DELETE (GET aendert nichts und bleibt frei):
//   1. `Sec-Fetch-Site` da (jeder aktuelle Browser setzt ihn, Seitencode kann
//      ihn nicht faelschen): nur `same-origin` gilt.
//   2. Sonst `Origin` (oder, wenn auch der fehlt, `Referer`) da: deren Host muss
//      der Host der Anfrage sein (`Host`, bei einem Vorschalter auch
//      `X-Forwarded-Host`), ein Loopback-Name oder in WOV_ERLAUBTE_URSPRUENGE /
//      WOV_ALLOWED_HOSTS stehen.
//   3. Keins von beidem da (curl, Node-Werkzeuge wie der MCP-Server, die mit
//      Token kommen): erlaubt. Ein Browser sendet immer eines.
const ERLAUBTE_URSPRUENGE = (process.env.WOV_ERLAUBTE_URSPRUENGE ?? process.env.WOV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function hostVon(roh: string | undefined): string | null {
  if (!roh) return null;
  try {
    return new URL(roh).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Ein Grund (Text), wenn die Anfrage von einer fremden Seite kommt; `null`, wenn sie durchgehen darf. */
function fremdeHerkunft(methode: string, kopf: IncomingHttpHeaders): string | null {
  if (methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS') return null;
  const einzeln = (n: string): string | undefined => {
    const w = kopf[n];
    return Array.isArray(w) ? w[0] : w;
  };
  const site = einzeln('sec-fetch-site');
  if (site !== undefined) return site === 'same-origin' ? null : `Sec-Fetch-Site: ${site}`;
  const quelle = einzeln('origin') ?? einzeln('referer');
  if (quelle === undefined) return null;
  const host = hostVon(quelle);
  if (host === null) return `Origin/Referer nicht lesbar: ${quelle.slice(0, 80)}`;
  const eigene = [einzeln('host'), einzeln('x-forwarded-host')].filter((h): h is string => !!h).map((h) => h.toLowerCase());
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const loopback = name === 'localhost' || name === '127.0.0.1' || name === '::1';
  if (eigene.includes(host) || loopback || ERLAUBTE_URSPRUENGE.includes(name) || ERLAUBTE_URSPRUENGE.includes(host)) return null;
  return `Herkunft ${host}`;
}

// ── Server ────────────────────────────────────────────────────────────

const dienst = createServer((req, res) => {
  void (async () => {
    const angefragteUrl = new URL(req.url ?? '/', 'http://x');
    const pfad = angefragteUrl.pathname.replace(/\/+$/, '') || '/';
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

      const fremd = fremdeHerkunft(req.method ?? 'GET', req.headers);
      if (fremd !== null) {
        console.warn(`[Admin] abgewiesen (fremde Seite): ${req.method} ${pfad} — ${fremd}`);
        return json(res, 403, {
          ok: false,
          fehler: 'fremde-herkunft',
          message: 'Zustandsaendernde Anfragen nur von der eigenen Seite (Editor) oder ohne Browser-Herkunft — nichts geaendert.',
        });
      }

      // Zustandsaendernde Anfragen sind JSON: `application/json` kann ein seitenuebergreifendes <form> nicht setzen (nur
      // urlencoded, multipart, text/plain), und ein fetch damit braucht einen Preflight, den dieser Dienst nie beantwortet.
      // Schliesst den Rest der Herkunftsregel oben (weder Sec-Fetch-Site noch Origin → erlaubt).
      //
      // U1 (22.09.2026): EINE eng gefasste Ausnahme -- `POST /api/modell-hochladen`
      // schickt die rohen Bytes einer `.glb` (Ist-Analyse Abschnitt 5: `leibLesen()`
      // erzwingt `JSON.parse`, eine `.glb` bräuchte sonst eine Base64-Hülle mit einem
      // Drittel Aufschlag). Dieselbe Begründung wie oben trägt trotzdem, nur mit einem
      // anderen Ergebnis: `application/octet-stream` gehört NICHT zu den drei
      // CORS-safelisted Content-Types, die ein <form> setzen kann, und ein fetch damit
      // loest von einer fremden Seite genau den Preflight aus, den dieser Dienst nie
      // beantwortet -- der Angriff, gegen den die Regel oben steht, geht mit diesem
      // Content-Type gar nicht. Die Herkunftsregel (`fremdeHerkunft`, direkt darueber)
      // bleibt fuer diesen Pfad UNVERAENDERT scharf; nur die Content-Type-Klemme wird
      // hier uebersprungen. `DELETE /api/modell-hochladen` (Entfernen) schickt normales
      // JSON und braucht keine Ausnahme.
      const istModellUpload = pfad === '/api/modell-hochladen' && req.method === 'POST';
      if (
        !istModellUpload &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '') &&
        !/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] ?? ''))
      ) {
        console.warn(`[Admin] abgewiesen (Content-Type): ${req.method} ${pfad} — ${String(req.headers['content-type'] ?? 'keiner').slice(0, 60)}`);
        return json(res, 415, {
          ok: false,
          fehler: 'content-type',
          message: 'Zustandsaendernde Anfragen brauchen Content-Type: application/json — nichts geaendert.',
        });
      }

      // Die Server-Konsole vor der JSON-Weiche: sie antwortet nicht mit
      // einem Dokument, sondern haelt die Verbindung offen. `behandeln`
      // kann das mit seinem { code, daten } nicht ausdruecken.
      if (pfad === '/api/serverlog') {
        if (req.method !== 'GET') return json(res, 405, { ok: false, fehler: 'GET erwartet', message: 'GET erwartet' });
        return serverLogStroemen(req, res);
      }

      // G12: ebenfalls vor der JSON-Weiche -- die Antwort ist
      // Prometheus-Text, kein { code, daten }-Dokument (s. metrikenAusgeben).
      if (pfad === '/metriken') {
        if (req.method !== 'GET') return json(res, 405, { ok: false, fehler: 'GET erwartet', message: 'GET erwartet' });
        return metrikenAusgeben(res);
      }

      // U1: ebenfalls vor der JSON-Weiche -- der Koerper ist eine `.glb`,
      // `leibLesen()` wuerde ihn als Text parsen und an JSON.parse scheitern.
      //
      // N1 (Angriff, Befund B2): OHNE `await` liefert dieses `return` das
      // Promise selbst zurueck, statt auf sein Ergebnis zu warten -- eine
      // Ablehnung darin (Verbindungsabbruch mitten im Koerper, kaputte
      // registry.json) landete NIE im `catch` unten, sondern als
      // unbehandelte Ablehnung auf Prozessebene, und Node beendet den
      // Dienst dafuer. Ein abgebrochener Upload durfte den ganzen
      // Betriebsdienst nicht mitnehmen.
      if (pfad === '/api/modell-hochladen' && req.method === 'POST') {
        return await modellHochladenBehandeln(req, res, klient || peer);
      }

      // DELETE zusaetzlich zu PUT/POST: DELETE /admin/liste braucht einen
      // Koerper ({name} oder {spielerId}), um zu sagen, WAS entfernt
      // werden soll -- die URL allein kennt keine Kennung dafuer.
      const leib =
        req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
          ? await leibLesen(req)
          : null;
      const { code, daten, kopf } = await behandeln(
        pfad,
        req.method ?? 'GET',
        leib,
        angefragteUrl.searchParams,
        req.headers
      );
      if (code >= 400) console.warn(`[Admin] ${req.method} ${pfad} -> ${code}`);
      json(res, code, daten, kopf);
    } catch (fehler) {
      // Ein unbrauchbares Dokument ist ein Fehler des Absenders, kein
      // Serverfehler — und vor allem: An dieser Stelle ist auf der Platte
      // NICHTS passiert. layoutSchreiben prueft, bevor es sichert oder
      // schreibt. Das ist die wichtigste Zusicherung des ganzen Endpunkts:
      // Ein misslungener Speichervorgang darf die Welt nicht beschaedigen.
      if (fehler instanceof AnfrageZuGross) {
        console.warn(`[Admin] ${req.method} ${pfad} -> 413: ${fehler.message}`);
        // Der Rest des Rumpfs bleibt ungelesen: Die Verbindung wird nach der Antwort geschlossen, sonst
        // haengt die naechste Anfrage auf derselben Keep-Alive-Verbindung an den uebrigen Bytes.
        return json(res, 413, { ok: false, fehler: 'anfrage-zu-gross', message: fehler.message }, { Connection: 'close' });
      }
      const eingabefehler = fehler instanceof LayoutUngueltig || fehler instanceof SyntaxError;
      const code = eingabefehler ? 400 : 500;
      // U1-N3: Die Upload-Route (POST/DELETE /api/modell-hochladen) gibt nie
      // eine rohe `Error.message` an den Browser — fs-Fehler tragen den
      // absoluten Pfad, JSON-Fehler einen Dateiausschnitt. Nur eine feste
      // Meldung plus Kennung; die Einzelheiten stehen im Log.
      if (pfad === '/api/modell-hochladen') {
        console.error(`[Admin] ${req.method} ${pfad} -> ${code}:`, fehler);
        return json(res, code, {
          ok: false,
          fehler: eingabefehler ? 'anfrage-ungueltig' : 'interner-fehler',
          message: eingabefehler
            ? 'Die Anfrage konnte nicht gelesen werden.'
            : 'Interner Fehler (Einzelheiten im Server-Log).',
        });
      }
      const meldung = (fehler as Error).message;
      if (eingabefehler) console.warn(`[Admin] ${req.method} ${pfad} -> 400: ${meldung}`);
      else console.error('[Admin] Fehler:', fehler);
      json(res, code, { ok: false, fehler: meldung, message: meldung });
    }
  })();
});

// Nur auf der internen Bruecke lauschen. 0.0.0.0 waere hier der Fehler,
// den man erst bemerkt, wenn jemand anders ihn findet.
//
// Getting-started (2026-09-12): Der Rückfall war bislang 10.10.10.11 — die
// Adresse der internen Bruecke IM BETRIEB, wo eine systemd-Unit
// WOV_ADMIN_ADRESSE aus /etc/wov.env immer setzt (siehe
// deploy/wov.env.beispiel) und dieser Wert also nie griff. Ohne Unit
// (lokal per `npm run dev`, genau der Fall, den der Kommentar bei
// client/vite.config.ts:ADMIN_ADRESSE schon als Rückfall auf 127.0.0.1
// beschreibt) gab es aber gar keine Bruecke mit dieser IP — der Dienst
// schlug beim Start mit EADDRNOTAVAIL fehl. Der Rückfall hier muss also
// zu dem in vite.config.ts PASSEN, nicht zur Live-Adresse: 127.0.0.1 ist
// im Betrieb genauso falsch wie 10.10.10.11 es lokal war, aber dort
// GREIFT der Rückfall nie, weil die Unit ihn überschreibt.
//
// Getting started (2026-09-12): the fallback used to be 10.10.10.11 — the
// internal bridge's address IN PRODUCTION, where a systemd unit always
// sets WOV_ADMIN_ADRESSE from /etc/wov.env (see deploy/wov.env.beispiel),
// so this value never actually applied. Without a unit (`npm run dev` by
// hand — exactly the case client/vite.config.ts's own ADMIN_ADRESSE
// comment already describes as falling back to 127.0.0.1) there is no
// bridge with that address, and the service failed to start with
// EADDRNOTAVAIL. The fallback here has to MATCH the one in
// vite.config.ts, not the live address: 127.0.0.1 is just as wrong in
// production as 10.10.10.11 was locally, but there the fallback never
// applies because the unit overrides it.
const ADRESSE = process.env.WOV_ADMIN_ADRESSE ?? '127.0.0.1';
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

// K4.0: a world reset killed between `stop` and `start` leaves the game server down and nobody told. Look for its marker.
void unfertigenResetMelden(resetUmgebung()).catch((fehler) => console.error('[Admin] Marker-Pruefung des Zuruecksetzens fehlgeschlagen:', fehler));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { dienst.close(() => process.exit(0)); });
}
