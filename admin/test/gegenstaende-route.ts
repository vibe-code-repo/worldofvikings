/**
 * Editor card EG1: `GET/PUT /api/gegenstaende` and `GET /api/gegenstaende/quittung` against the REAL operations
 * service (child process, test root, free port). The route reads the working copy from `gegenstandsArbeitsDatei`, never
 * a path from the request.
 * Editor-Karte EG1: Betriebsdienst-Route fuer Gegenstaende aus Daten, gegen den echten Dienst mit einer Testwurzel.
 *
 *  1. GET creates the working copy from the repo state (+ `.basis`), `hash` = sha256 of the file, `ETag`, `quelle`.
 *  2. PUT: no `If-Match` 428, stale 412 (with the current hash), broken JSON 422 `datei-kein-json`, wrong head 422,
 *     one invalid entry among valid ones 422 (file byte-identical), too big 413, valid 200 (canonical bytes, new hash),
 *     round trip GET -> PUT -> GET gives the same bytes.
 *  3. Removing an item: 409 `brauchtBestaetigung` with `entfernt` (file unchanged); with `?bestaetigt=1` 200.
 *  4. Two PUTs with the same `If-Match`: exactly one 200 and one 412.
 *  5. Receipt: missing -> `keine`, readable -> passed on, garbage -> `unlesbar`.
 *  6. Path: a PUT changes only the working copy (file list of the test root before/after; no lock/tmp left over),
 *     whatever the query says.
 *  7. Other verbs / paths / missing token.
 *
 * Run: npx tsx admin/test/gegenstaende-route.ts   (from the repo root; cwd as in scripts/kern/admin.mjs)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_DATEI_BYTES, leseGegenstandsDatei, schreibeGegenstandsDatei } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsBasisDatei, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}`);
}
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');
const ORDNER = mkdtempSync('/var/tmp/editor-eg1-');
const ARBEITSORDNER = resolve(ORDNER, 'arbeit');
const TOKEN = 'eg1-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(ARBEITSORDNER, { recursive: true });
mkdirSync(dirname(gegenstandsRepoDatei(ORDNER)), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, '#!/bin/sh\nexit 0\n');
chmodSync(SYSTEMCTL, 0o755);
const REPO_TEXT = schreibeGegenstandsDatei([]);
writeFileSync(gegenstandsRepoDatei(ORDNER), REPO_TEXT);

const ARBEIT = gegenstandsArbeitsDatei(ORDNER, ARBEITSORDNER);
const BASIS = gegenstandsBasisDatei(ORDNER, ARBEITSORDNER);
const QUITTUNG = resolve(dirname(ARBEIT), 'gegenstaende.quittung.json');

// ── the real service, child process in its own process group ──
let dienst: ChildProcess | null = null;
function gruppeBeenden(signal: NodeJS.Signals = 'SIGKILL'): void {
  const pid = dienst?.pid;
  if (!pid) return;
  for (const ziel of [-pid, pid]) {
    try {
      process.kill(ziel, signal);
    } catch {
      /* already gone */
    }
  }
}
function aufraeumenAlles(): void {
  gruppeBeenden('SIGKILL');
  rmSync(ORDNER, { recursive: true, force: true });
}
process.on('exit', aufraeumenAlles);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => {
    aufraeumenAlles();
    process.exit(1);
  });
}
const ELTERN = process.ppid;
setInterval(() => {
  if (process.ppid !== ELTERN) {
    aufraeumenAlles();
    process.exit(1);
  }
}, 500).unref();

function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_WELT_VERZEICHNIS: ARBEITSORDNER,
        NODE_ENV: 'test',
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        WOV_SYSTEMCTL: SYSTEMCTL,
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zeit = setTimeout(() => scheitern(new Error(`service does not start:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeit);
        fertig(Number(t[1]));
      }
    };
    dienst.stdout!.on('data', auf);
    dienst.stderr!.on('data', auf);
  });
}
const port = await dienstStarten();
const pids = [dienst!.pid!];

type Antwort = { status: number; daten: Record<string, unknown>; etag: string | null };
async function anfrage(
  methode: string,
  pfad: string,
  opt: { body?: string; ifMatch?: string | null; token?: boolean } = {}
): Promise<Antwort> {
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  if (opt.token !== false) kopf['x-wov-token'] = TOKEN;
  if (opt.ifMatch) kopf['if-match'] = opt.ifMatch;
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: kopf, ...(opt.body === undefined ? {} : { body: opt.body }) });
  let daten: Record<string, unknown> = {};
  try {
    daten = (await r.json()) as Record<string, unknown>;
  } catch {
    /* no JSON */
  }
  return { status: r.status, daten, etag: r.headers.get('etag') };
}
const get = (): Promise<Antwort> => anfrage('GET', '/api/gegenstaende');
const put = (body: string, ifMatch: string | null, query = ''): Promise<Antwort> =>
  anfrage('PUT', `/api/gegenstaende${query}`, { body, ifMatch: ifMatch === null ? null : `"${ifMatch}"` });
const arbeitBytes = (): Buffer => readFileSync(ARBEIT);

// ── test data ──
function eintrag(id: string, ueberschreibe: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    nameSchluessel: `inhalt.gegenstand.${id}.name`,
    typ: 'material',
    texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: `${id} (en)` } },
    ...ueberschreibe,
  };
}
const holzaxt = eintrag('Holzaxt', { typ: 'zweihaendigWaffe', werte: { damage: 10 }, ernte: { baum: 1 }, rarity: 'common', itemLevel: 1 });
const erz = eintrag('Erz');
const datei = (liste: unknown[], kopf: Record<string, unknown> = {}): string => JSON.stringify({ version: 1, gegenstaende: liste, ...kopf });
const kanon = (liste: unknown[]): string => {
  const l = leseGegenstandsDatei(datei(liste));
  if (l.dateiFehler !== null || l.verworfen.length > 0) throw new Error('test data invalid');
  return schreibeGegenstandsDatei(l.eintraege);
};

/** Every file under the test root with its hash (lock and temp files would show up here). */
function dateiListe(): Record<string, string> {
  const aus: Record<string, string> = {};
  const gehe = (ordner: string): void => {
    for (const name of readdirSync(ordner)) {
      const p = resolve(ordner, name);
      if (statSync(p).isDirectory()) gehe(p);
      else aus[relative(ORDNER, p)] = sha(readFileSync(p));
    }
  };
  gehe(ORDNER);
  return aus;
}

// ── 1. GET creates the working copy from the repo ──
{
  check('1 vorher: keine Arbeitskopie', !existsSync(ARBEIT));
  const a = await get();
  check('1 GET 200', a.status === 200, String(a.status));
  check('1 Arbeitskopie angelegt, Bytes = Repo-Stand', existsSync(ARBEIT) && arbeitBytes().toString('utf-8') === REPO_TEXT);
  check('1 .basis = sha256 des Repo-Stands', existsSync(BASIS) && readFileSync(BASIS, 'utf-8').trim() === sha(REPO_TEXT));
  check('1 hash = sha256 der Datei', a.daten.hash === sha(arbeitBytes()), String(a.daten.hash));
  check('1 ETag gesetzt = "hash"', a.etag === `"${String(a.daten.hash)}"`, String(a.etag));
  check('1 quelle = repo (unveraendert)', a.daten.quelle === 'repo', String(a.daten.quelle));
  check('1 text = Dateiinhalt, eintraege leer, kein Dateifehler', a.daten.text === REPO_TEXT && Array.isArray(a.daten.eintraege) && (a.daten.eintraege as unknown[]).length === 0 && a.daten.dateiFehler === null);
  check('1 verworfen leer', Array.isArray(a.daten.verworfen) && (a.daten.verworfen as unknown[]).length === 0);
}
let hash = sha(arbeitBytes());

// ── 2. PUT refusals: nothing is written ──
{
  const vorher = dateiListe();
  const ohne = await put(datei([holzaxt]), null);
  check('2 ohne If-Match: 428', ohne.status === 428 && ohne.daten.fehler === 'basis-fehlt', `${ohne.status} ${String(ohne.daten.fehler)}`);
  const falsch = await put(datei([holzaxt]), 'f'.repeat(64));
  check('2 falscher Hash: 412 mit dem aktuellen Hash', falsch.status === 412 && falsch.daten.hash === hash, `${falsch.status} ${String(falsch.daten.hash)}`);
  const kaputt = await put('{"version":1,', hash);
  check('2 kaputtes JSON: 422 datei-kein-json', kaputt.status === 422 && kaputt.daten.fehler === 'datei-kein-json', `${kaputt.status} ${String(kaputt.daten.fehler)}`);
  const kopf = await put('[]', hash);
  check('2 falscher Kopf: 422 datei-kopf-falsch', kopf.status === 422 && kopf.daten.fehler === 'datei-kopf-falsch', `${kopf.status} ${String(kopf.daten.fehler)}`);
  const version = await put(datei([holzaxt], { version: 99 }), hash);
  check('2 unbekannte Version: 422 datei-version-unbekannt', version.status === 422 && version.daten.fehler === 'datei-version-unbekannt', `${version.status} ${String(version.daten.fehler)}`);
  const gemischt = await put(datei([holzaxt, eintrag('kleingeschrieben'), erz]), hash);
  const v = gemischt.daten.verworfen as Array<{ index: number; id: string | null; grund: string }> | undefined;
  check(
    '2 ein ungueltiger Eintrag unter gueltigen: 422, Liste [{index,id,grund}]',
    gemischt.status === 422 && Array.isArray(v) && v.length === 1 && v[0].index === 1 && v[0].grund === 'id-ungueltig',
    `${gemischt.status} ${JSON.stringify(v)}`
  );
  const gross = await put('x'.repeat(MAX_DATEI_BYTES + 1), hash);
  check('2 zu gross: 413', gross.status === 413, String(gross.status));
  check('2 Datei nach allen Ablehnungen byte-gleich', arbeitBytes().toString('utf-8') === REPO_TEXT && sha(arbeitBytes()) === hash);
  check('2 Dateiliste der Testwurzel unveraendert', JSON.stringify(dateiListe()) === JSON.stringify(vorher));
}

// ── 3. valid PUT: canonical bytes, new hash; round trip ──
{
  // Non-canonical body: pretty printed, keys in reverse order.
  const roh = JSON.stringify({ gegenstaende: [erz, holzaxt].map((e) => Object.fromEntries(Object.entries(e).reverse())), version: 1 }, null, 4);
  const a = await put(roh, hash);
  const erwartet = kanon([erz, holzaxt]);
  check('3 gueltig: 200', a.status === 200, `${a.status} ${JSON.stringify(a.daten)}`);
  check('3 Datei = schreibeGegenstandsDatei(...), nicht die Anfrage-Bytes', arbeitBytes().toString('utf-8') === erwartet && erwartet !== roh);
  check('3 neuer Hash = sha256 der Datei, ETag gleich', a.daten.hash === sha(arbeitBytes()) && a.etag === `"${String(a.daten.hash)}"` && a.daten.hash !== hash);
  hash = String(a.daten.hash);
  const g = await get();
  check('3 GET danach: dieselben Bytes, hash gleich, quelle arbeit', g.daten.text === erwartet && g.daten.hash === hash && g.daten.quelle === 'arbeit');
  check('3 GET liefert die Eintraege (2)', Array.isArray(g.daten.eintraege) && (g.daten.eintraege as unknown[]).length === 2);
  const runde = await put(String(g.daten.text), hash);
  check('3 Rundreise GET -> PUT -> GET: 200 und byte-gleich', runde.status === 200 && runde.daten.hash === hash && arbeitBytes().toString('utf-8') === erwartet);
  check('3 If-Match als schwacher Wert W/"hash" wird akzeptiert', (await anfrage('PUT', '/api/gegenstaende', { body: String(g.daten.text), ifMatch: `W/"${hash}"` })).status === 200);
}

// ── 4. Removing needs confirmation ──
{
  const vorher = arbeitBytes();
  const nur = datei([holzaxt]);
  const a = await put(nur, hash);
  check(
    '4 Entfernen ohne Bestaetigung: 409 brauchtBestaetigung mit entfernt',
    a.status === 409 && a.daten.fehler === 'brauchtBestaetigung' && a.daten.brauchtBestaetigung === true && JSON.stringify(a.daten.entfernt) === JSON.stringify(['Erz']),
    `${a.status} ${JSON.stringify(a.daten)}`
  );
  check('4 Datei unveraendert', arbeitBytes().equals(vorher));
  const falsch = await put(nur, hash, '?bestaetigt=0');
  check('4 ?bestaetigt=0 zaehlt nicht', falsch.status === 409 && arbeitBytes().equals(vorher));
  const b = await put(nur, hash, '?bestaetigt=1');
  check('4 mit Bestaetigung: 200, entfernt genannt', b.status === 200 && JSON.stringify(b.daten.entfernt) === JSON.stringify(['Erz']), `${b.status} ${JSON.stringify(b.daten)}`);
  check('4 Datei enthaelt nur noch Holzaxt', arbeitBytes().toString('utf-8') === kanon([holzaxt]));
  hash = String(b.daten.hash);
  // Renaming (id change) is a removal, too; a plain edit of an entry is not.
  const umbenannt = await put(datei([eintrag('Holzbeil')]), hash);
  check('4 andere id = Entfernen der alten: 409', umbenannt.status === 409 && JSON.stringify(umbenannt.daten.entfernt) === JSON.stringify(['Holzaxt']));
  const geaendert = await put(datei([{ ...holzaxt, werte: { damage: 12 } }]), hash);
  check('4 Werte aendern ohne Entfernen: 200 ohne Bestaetigung', geaendert.status === 200 && Array.isArray(geaendert.daten.entfernt) && (geaendert.daten.entfernt as unknown[]).length === 0);
  hash = String(geaendert.daten.hash);
}

// ── 5. Two PUTs with the same If-Match: exactly one wins ──
{
  const a = datei([holzaxt, eintrag('Alpha')]);
  const b = datei([holzaxt, eintrag('Beta')]);
  const [ra, rb] = await Promise.all([put(a, hash), put(b, hash)]);
  const codes = [ra.status, rb.status].sort();
  check('5 gleichzeitig: genau ein 200 und ein 412', JSON.stringify(codes) === JSON.stringify([200, 412]), codes.join(','));
  const sieger = ra.status === 200 ? a : b;
  check('5 Datei = die Fassung des Siegers', arbeitBytes().toString('utf-8') === kanon(JSON.parse(sieger).gegenstaende));
  const verlierer = ra.status === 200 ? rb : ra;
  check('5 der Verlierer bekommt den neuen Hash', verlierer.daten.hash === sha(arbeitBytes()));
  // The same again, many at once: still exactly one 200.
  const hashJetzt = sha(arbeitBytes());
  const bestand = (JSON.parse(arbeitBytes().toString('utf-8')) as { gegenstaende: unknown[] }).gegenstaende;
  const viele = await Promise.all(Array.from({ length: 8 }, (_, i) => put(datei([...bestand, eintrag(`Z${i}`)]), hashJetzt)));
  check('5 acht gleichzeitige PUTs: genau ein 200, sieben 412', viele.filter((r) => r.status === 200).length === 1 && viele.filter((r) => r.status === 412).length === 7, viele.map((r) => r.status).join(','));
  hash = sha(arbeitBytes());
}

// ── 6. Receipt ──
{
  const keine = await anfrage('GET', '/api/gegenstaende/quittung');
  check('6 Quittung fehlt: 200 status keine', keine.status === 200 && keine.daten.status === 'keine', `${keine.status} ${JSON.stringify(keine.daten)}`);
  writeFileSync(QUITTUNG, JSON.stringify({ status: 'bestaetigung-noetig', hash, gehalten: { Holzaxt: 3 } }));
  const da = await anfrage('GET', '/api/gegenstaende/quittung');
  check('6 Quittung lesbar: durchgereicht', da.status === 200 && da.daten.status === 'bestaetigung-noetig' && JSON.stringify(da.daten.gehalten) === JSON.stringify({ Holzaxt: 3 }));
  writeFileSync(QUITTUNG, '{kaputt');
  const muell = await anfrage('GET', '/api/gegenstaende/quittung');
  check('6 Quittung kaputt: status unlesbar', muell.status === 200 && muell.daten.status === 'unlesbar');
  writeFileSync(QUITTUNG, JSON.stringify(['x']));
  check('6 Quittung ohne status: unlesbar', (await anfrage('GET', '/api/gegenstaende/quittung')).daten.status === 'unlesbar');
  rmSync(QUITTUNG);
}

// ── 7. Path: only the working copy is written, whatever the query says ──
{
  const vorher = dateiListe();
  const a = await put(datei([holzaxt, eintrag('Pfadprobe')]), hash, `?datei=${encodeURIComponent('../../etc/evil')}&pfad=/tmp/evil&bestaetigt=1`);
  check('7 PUT 200', a.status === 200, String(a.status));
  const nachher = dateiListe();
  const geaendert = Object.keys({ ...vorher, ...nachher }).filter((k) => vorher[k] !== nachher[k]);
  check('7 geaendert wurde genau die Arbeitskopie', JSON.stringify(geaendert) === JSON.stringify([relative(ORDNER, ARBEIT)]), JSON.stringify(geaendert));
  check('7 Dateiliste sonst gleich (kein .lock, kein .tmp)', JSON.stringify(Object.keys(vorher)) === JSON.stringify(Object.keys(nachher)));
  check('7 Repo-Stand unberuehrt', readFileSync(gegenstandsRepoDatei(ORDNER), 'utf-8') === REPO_TEXT);
  hash = String(a.daten.hash);
}

// ── 8. Other verbs, paths, token ──
{
  check('8 ohne Token: 401', (await anfrage('GET', '/api/gegenstaende', { token: false })).status === 401);
  check('8 DELETE: 405', (await anfrage('DELETE', '/api/gegenstaende')).status === 405);
  check('8 POST auf quittung: 405', (await anfrage('POST', '/api/gegenstaende/quittung', { body: '{}' })).status === 405);
  check('8 bestaetigen/abnehmen gibt es noch nicht: 404', (await anfrage('POST', '/api/gegenstaende/bestaetigen', { body: '{}' })).status === 404);
  check('8 kaputte Arbeitskopie: GET meldet dateiFehler, kein Absturz', await (async () => {
    writeFileSync(ARBEIT, '{kaputt');
    const a = await get();
    return a.status === 200 && a.daten.dateiFehler === 'datei-kein-json' && a.daten.hash === sha('{kaputt');
  })());
  const repariert = await put(datei([holzaxt]), sha('{kaputt'));
  check('8 kaputte Arbeitskopie laesst sich mit gueltigem Stand ueberschreiben', repariert.status === 200 && arbeitBytes().toString('utf-8') === kanon([holzaxt]));
}

// ── shut down ──
const gruppe = dienst!.pid!;
gruppeBeenden('SIGTERM');
await new Promise((r) => setTimeout(r, 300));
gruppeBeenden('SIGKILL');
await new Promise((r) => setTimeout(r, 300));
let lebt = false;
for (const p of [gruppe, ...pids]) {
  try {
    process.kill(p, 0);
    lebt = true;
  } catch {
    /* gone */
  }
}
check('Dienst-Prozess beendet', !lebt);

console.log(fehler === 0 ? '\nalle Pruefungen bestanden' : `\n${fehler} Pruefung(en) fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
