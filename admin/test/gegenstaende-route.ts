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
 *  9. N1/F1: entries the reader DISCARDS in the old state count as removed (409, ids or `#<index>`), file byte-equal.
 * 10. N1/F2: a broken old state needs `?bestaetigt=1` (409 `alter-stand-kaputt`), a `.kaputt-<time>` copy is kept (max 5).
 * 10b. N2/N-1+N-2: the rotation removes only its OWN names (foreign `.kaputt-*` stay), skips directories, checks its fresh copy.
 * 11. N1/F3+F4: a SECOND process holds the lock: PUT gets 503 `gesperrt` (+ Retry-After, no pid/path), another endpoint
 *     answers in < 300 ms meanwhile; a PUT waits (async) for a lock released within 2 s.
 * 12. N1/F5: stable `fehler` codes (404, 500 `intern`), `If-Match: *` 428, ETag lists, stale `.tmp` cleanup, HEAD.
 *
 * Run: npx tsx admin/test/gegenstaende-route.ts   (from the repo root; cwd as in scripts/kern/admin.mjs)
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRUNDBESTAND, MAX_DATEI_BYTES, leseGegenstandsDatei, schreibeGegenstandsDatei } from '@wov/shared/src/items/gegenstandsDaten.js';
import { layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { gegenstandsArbeitsDatei, gegenstandsBasisDatei, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';

// Lock holder: this file started again as a second process (`--halter <working copy> <stop file>`). It takes the lock
// like the game server's watch would and holds it until the stop file exists.
if (process.argv[2] === '--halter') {
  const [arbeitsDatei, stoppDatei] = [process.argv[3], process.argv[4]];
  layoutUnterSperre(
    arbeitsDatei,
    () => {
      console.log('HALTER-BEREIT');
      while (!existsSync(stoppDatei)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    },
    { sperreWartenMs: 5000 }
  );
  process.exit(0);
}

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
/** Every pid of the service's process group (tsx starts the real node process as a child of `dienst.pid`). */
function dienstPids(): number[] {
  const aus = execFileSync('ps', ['-o', 'pid=', '-g', String(dienst!.pid)], { encoding: 'utf-8' });
  const liste = aus.split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
  if (liste.length < 2) throw new Error(`process group of the service not found: ${aus}`);
  return liste;
}

type Antwort = { status: number; daten: Record<string, unknown>; etag: string | null; retryAfter: string | null; roh: string };
async function anfrage(
  methode: string,
  pfad: string,
  opt: { body?: string; ifMatch?: string | null; ifMatchRoh?: string; token?: boolean } = {}
): Promise<Antwort> {
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  if (opt.token !== false) kopf['x-wov-token'] = TOKEN;
  if (opt.ifMatch) kopf['if-match'] = opt.ifMatch;
  if (opt.ifMatchRoh !== undefined) kopf['if-match'] = opt.ifMatchRoh;
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: kopf, ...(opt.body === undefined ? {} : { body: opt.body }) });
  let daten: Record<string, unknown> = {};
  const roh = await r.text();
  try {
    daten = JSON.parse(roh) as Record<string, unknown>;
  } catch {
    /* no JSON */
  }
  return { status: r.status, daten, etag: r.headers.get('etag'), retryAfter: r.headers.get('retry-after'), roh };
}
const get = (): Promise<Antwort> => anfrage('GET', '/api/gegenstaende');
const put = (body: string, ifMatch: string | null, query = ''): Promise<Antwort> =>
  anfrage('PUT', `/api/gegenstaende${query}`, { body, ifMatch: ifMatch === null ? null : `"${ifMatch}"` });
const arbeitBytes = (): Buffer => readFileSync(ARBEIT);

/** A second process holding `<working copy>.lock`; `freigeben()` lets it go and waits for its end. */
const halterPids: number[] = [];
async function halterStarten(name: string): Promise<{ pid: number; freigeben: () => Promise<void> }> {
  const stopp = resolve(ORDNER, `stopp-${name}`);
  const kind = spawn(TSX, [fileURLToPath(import.meta.url), '--halter', ARBEIT, stopp], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = kind.pid!;
  halterPids.push(pid);
  const beendet = new Promise<void>((fertig) => kind.once('exit', () => fertig()));
  await new Promise<void>((fertig, scheitern) => {
    const zeit = setTimeout(() => scheitern(new Error('lock holder does not start')), 30_000);
    let s = '';
    kind.stdout!.on('data', (d: Buffer) => {
      s += d.toString();
      if (s.includes('HALTER-BEREIT')) {
        clearTimeout(zeit);
        fertig();
      }
    });
  });
  return {
    pid,
    freigeben: async () => {
      writeFileSync(stopp, '');
      await Promise.race([beendet, new Promise((r) => setTimeout(r, 10_000))]);
      for (const z of [-pid, pid]) {
        try {
          process.kill(z, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    },
  };
}

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
/** The raw file entry of a base item (as the writer emits it), with overrides: a base id may only differ in `ernte`. */
const grundRoh = (id: string, ueberschreibe: Record<string, unknown> = {}): Record<string, unknown> => {
  const e = GRUNDBESTAND.find((g) => g.id === id);
  if (!e) throw new Error(`kein Grundgegenstand ${id}`);
  return { ...(JSON.parse(schreibeGegenstandsDatei([e])).gegenstaende[0] as Record<string, unknown>), ...ueberschreibe };
};

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
  // GD1 N1/F1: a base id (Wood) that leaves the file is no removal: the base entry stands in, no confirmation.
  const mitWood = await put(datei([{ ...holzaxt, werte: { damage: 12 } }, { ...grundRoh('Wood'), ernte: { baum: 3 } }]), hash);
  check('4 Grundkennung (Wood) als eigener Eintrag: 200', mitWood.status === 200, `${mitWood.status}`);
  hash = String(mitWood.daten.hash);
  const ohneWood = await put(datei([{ ...holzaxt, werte: { damage: 12 } }]), hash);
  check('4 Grundkennung (Wood) aus der Datei nehmen ist kein Entfernen: 200 ohne Bestaetigung, entfernt leer', ohneWood.status === 200 && (ohneWood.daten.entfernt as unknown[]).length === 0, `${ohneWood.status} ${JSON.stringify(ohneWood.daten)}`);
  hash = String(ohneWood.daten.hash);
  const gesperrt = await put(datei([{ ...holzaxt, werte: { damage: 12 } }, grundRoh('Wood', { stapel: 7 })]), hash);
  check('4 Grundgegenstand mit anderer Stapelgroesse: 422 (bis GD3 gesperrt), nichts geschrieben', gesperrt.status === 422 && JSON.stringify(gesperrt.daten).includes('grundwert-gesperrt'), `${gesperrt.status} ${JSON.stringify(gesperrt.daten).slice(0, 200)}`);
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
  // N3 (N2-1): reading a working copy with a deviating base entry reports it (`grundErsetzt`); a clean one reports none.
  const sauber = await get();
  check('8 saubere Arbeitskopie: grundErsetzt ist leer', Array.isArray(sauber.daten.grundErsetzt) && (sauber.daten.grundErsetzt as unknown[]).length === 0, JSON.stringify(sauber.daten.grundErsetzt));
  const vorherBytes = arbeitBytes();
  writeFileSync(ARBEIT, datei([grundRoh('Wood', { stapel: 77 }), holzaxt]));
  const abw = await get();
  check('8 abweichender Grundeintrag: GET nennt grundErsetzt [Wood], Holzaxt und Wood bleiben in eintraege',
    JSON.stringify(abw.daten.grundErsetzt) === '["Wood"]' && (abw.daten.eintraege as Array<{ id: string }>).map((e) => e.id).join() === 'Wood,Holzaxt', JSON.stringify(abw.daten.grundErsetzt));
  writeFileSync(ARBEIT, vorherBytes);
  check('8 ohne Token: 401', (await anfrage('GET', '/api/gegenstaende', { token: false })).status === 401);
  check('8 DELETE: 405', (await anfrage('DELETE', '/api/gegenstaende')).status === 405);
  check('8 POST auf quittung: 405', (await anfrage('POST', '/api/gegenstaende/quittung', { body: '{}' })).status === 405);
  const unbekannt = await anfrage('POST', '/api/gegenstaende/bestaetigen', { body: '{}' });
  check('8 bestaetigen/abnehmen gibt es noch nicht: 404 unbekannter-endpunkt', unbekannt.status === 404 && unbekannt.daten.fehler === 'unbekannter-endpunkt', `${unbekannt.status} ${JSON.stringify(unbekannt.daten)}`);
  check('8 kaputte Arbeitskopie: GET meldet dateiFehler, kein Absturz', await (async () => {
    writeFileSync(ARBEIT, '{kaputt');
    const a = await get();
    return a.status === 200 && a.daten.dateiFehler === 'datei-kein-json' && a.daten.hash === sha('{kaputt');
  })());
  // N1/F2: overwriting a broken state is NOT silent any more.
  const ohneBestaetigung = await put(datei([holzaxt]), sha('{kaputt'));
  check('8 kaputte Arbeitskopie: PUT ohne Bestaetigung 409 alter-stand-kaputt', ohneBestaetigung.status === 409 && ohneBestaetigung.daten.fehler === 'alter-stand-kaputt' && arbeitBytes().toString('utf-8') === '{kaputt', `${ohneBestaetigung.status} ${JSON.stringify(ohneBestaetigung.daten)}`);
  const repariert = await put(datei([holzaxt]), sha('{kaputt'), '?bestaetigt=1');
  check('8 kaputte Arbeitskopie laesst sich MIT Bestaetigung ueberschreiben', repariert.status === 200 && arbeitBytes().toString('utf-8') === kanon([holzaxt]));
  hash = String(repariert.daten.hash);
}

// ── 9. N1/F1: entries the reader discards in the OLD state count as removed ──
{
  const schwert = { id: 'Schwert', nameSchluessel: 'inhalt.gegenstand.Schwert.name', typ: 'unbekannterTyp', texte: {} };
  const ohneId = { nameSchluessel: 'x', typ: 'material' };
  const altText = datei([holzaxt, ohneId, schwert, { id: 'kaputt!', typ: 'material' }, erz]);
  writeFileSync(ARBEIT, altText);
  const g = await get();
  const verw = g.daten.verworfen as Array<{ index: number; id: string | null }>;
  check('9 Vorbereitung: der Leser verwirft 3 Eintraege des alten Stands', Array.isArray(verw) && verw.length === 3, JSON.stringify(verw));
  const alt = Buffer.from(altText);
  const a = await put(datei([holzaxt, erz]), String(g.daten.hash));
  const ids = (a.daten.entfernt as string[] | undefined) ?? [];
  check('9 verworfene Eintraege mit id stehen in entfernt: 409', a.status === 409 && a.daten.fehler === 'brauchtBestaetigung' && [...ids].sort().join(',') === 'Schwert,kaputt!', `${a.status} ${JSON.stringify(a.daten)}`);
  check('9 Eintrag ohne lesbare id steht als #<index> in entferntOhneId', JSON.stringify(a.daten.entferntOhneId) === JSON.stringify(['#1']), JSON.stringify(a.daten.entferntOhneId));
  check('9 Datei nach dem 409 byte-gleich', arbeitBytes().equals(alt));
  const b = await put(datei([holzaxt, erz]), String(g.daten.hash), '?bestaetigt=1');
  check('9 mit Bestaetigung: 200, entfernt und entferntOhneId genannt', b.status === 200 && (b.daten.entfernt as string[]).length === 2 && JSON.stringify(b.daten.entferntOhneId) === JSON.stringify(['#1']), `${b.status} ${JSON.stringify(b.daten)}`);
  check('9 Datei danach kanonisch', arbeitBytes().toString('utf-8') === kanon([holzaxt, erz]));
  hash = String(b.daten.hash);
  // A discarded entry whose id IS in the new state is not removed (the id lives on).
  writeFileSync(ARBEIT, datei([holzaxt, { ...schwert }]));
  const g2 = await get();
  const c = await put(datei([holzaxt, eintrag('Schwert')]), String(g2.daten.hash));
  check('9 verworfen, aber die id steht im neuen Stand: kein Entfernen, 200', c.status === 200 && (c.daten.entfernt as string[]).length === 0 && !('entferntOhneId' in c.daten && (c.daten.entferntOhneId as unknown[]).length > 0), `${c.status} ${JSON.stringify(c.daten)}`);
  hash = String(c.daten.hash);
}

// ── 10. N1/F2: a broken old state needs confirmation and leaves a copy ──
{
  const kaputtFall = { 'version 2': datei([holzaxt, erz, eintrag('Stein')], { version: 2 }), abgeschnitten: '{"version":1,"gegenstaende":[{"id":"Holz' };
  for (const [name, inhalt] of Object.entries(kaputtFall)) {
    writeFileSync(ARBEIT, inhalt);
    const g = await get();
    const a = await put(datei([holzaxt]), String(g.daten.hash));
    check(`10 ${name}: PUT ohne Bestaetigung 409 alter-stand-kaputt mit dateiFehler des alten Stands`, a.status === 409 && a.daten.fehler === 'alter-stand-kaputt' && a.daten.dateiFehler === g.daten.dateiFehler && g.daten.dateiFehler !== null, `${a.status} ${JSON.stringify(a.daten)}`);
    check(`10 ${name}: Datei byte-gleich`, readFileSync(ARBEIT, 'utf-8') === inhalt);
    const b = await put(datei([holzaxt]), String(g.daten.hash), '?bestaetigt=1');
    const kopien = readdirSync(dirname(ARBEIT)).filter((f) => f.startsWith(`${ARBEIT.split('/').pop()}.kaputt-`)).sort();
    check(`10 ${name}: mit Bestaetigung 200, kanonisch geschrieben`, b.status === 200 && arbeitBytes().toString('utf-8') === kanon([holzaxt]), `${b.status} ${JSON.stringify(b.daten)}`);
    check(`10 ${name}: Sicherung der kaputten Datei liegt da (gleiche Bytes)`, kopien.length > 0 && readFileSync(resolve(dirname(ARBEIT), kopien[kopien.length - 1]), 'utf-8') === inhalt, kopien.join(','));
    hash = String(b.daten.hash);
  }
  // At most the last 5 copies are kept.
  let letzte = '';
  for (let i = 0; i < 7; i++) {
    letzte = `{"kaputt":${i}`;
    writeFileSync(ARBEIT, letzte);
    const g = await get();
    const r = await put(datei([holzaxt]), String(g.daten.hash), '?bestaetigt=1');
    hash = String(r.daten.hash);
  }
  const kopien = readdirSync(dirname(ARBEIT)).filter((f) => f.startsWith(`${ARBEIT.split('/').pop()}.kaputt-`)).sort();
  check('10 hoechstens 5 Sicherungen', kopien.length === 5, String(kopien.length));
  check('10 die neueste Sicherung ist die letzte kaputte Datei', kopien.length > 0 && readFileSync(resolve(dirname(ARBEIT), kopien[kopien.length - 1]), 'utf-8') === letzte);
  for (const k of kopien) rmSync(resolve(dirname(ARBEIT), k));
}

// ── 10b. N2/N-1+N-2: the rotation only touches its OWN names; the own fresh copy is checked ──
{
  const ordner = dirname(ARBEIT);
  const basisName = ARBEIT.split('/').pop()!;
  const alle = (): string[] => readdirSync(ordner).filter((f) => f.startsWith(`${basisName}.kaputt-`)).sort();
  const eigene = (): string[] => alle().filter((f) => new RegExp(`^${basisName.replace(/\./g, '\\.')}\\.kaputt-\\d{8}T\\d{9}(-\\d+)?$`).test(f) && statSync(resolve(ordner, f)).isFile());
  const aufraeumen = (): void => {
    for (const f of alle()) rmSync(resolve(ordner, f), { recursive: true, force: true });
  };
  /** Breaks the working copy with `inhalt`, then a confirmed PUT; returns the response. */
  const ueberschreiben = async (inhalt: string): Promise<{ status: number; daten: Record<string, unknown> }> => {
    writeFileSync(ARBEIT, inhalt);
    const g = await get();
    const r = await put(datei([holzaxt]), String(g.daten.hash), '?bestaetigt=1');
    if (r.status === 200) hash = String(r.daten.hash);
    return r;
  };
  aufraeumen();

  // Foreign files with a similar prefix stay, even the ones that sort first.
  writeFileSync(resolve(ordner, `${basisName}.kaputt-0`), 'fremd-0');
  writeFileSync(resolve(ordner, `${basisName}.kaputt-1999`), 'fremd-1999');
  let r1 = await ueberschreiben('{"handarbeit":0');
  for (let i = 1; i < 6 && r1.status === 200; i++) r1 = await ueberschreiben(`{"handarbeit":${i}`);
  check('10b fremde kaputt-0 / kaputt-1999: 6 bestaetigte PUTs 200, 5 eigene Sicherungen', r1.status === 200 && eigene().length === 5, `${r1.status} ${JSON.stringify(r1.daten)} ${alle().join(',')}`);
  check('10b fremde kaputt-0 / kaputt-1999 bleiben liegen, unveraendert', existsSync(resolve(ordner, `${basisName}.kaputt-0`)) && existsSync(resolve(ordner, `${basisName}.kaputt-1999`)) && readFileSync(resolve(ordner, `${basisName}.kaputt-0`), 'utf-8') === 'fremd-0' && readFileSync(resolve(ordner, `${basisName}.kaputt-1999`), 'utf-8') === 'fremd-1999', alle().join(','));
  aufraeumen();

  // 5 foreign names that sort like the newest: the own copy is there, with the old content, the foreign ones are untouched.
  const fremd = ['z1', 'z2', 'z3', 'z4', 'z5'];
  for (const f of fremd) writeFileSync(resolve(ordner, `${basisName}.kaputt-${f}`), `fremd-${f}`);
  const r2 = await ueberschreiben('{"wichtig":"handarbeit"');
  const eig2 = eigene();
  check('10b 5 fremde kaputt-z1..z5: PUT 200', r2.status === 200, `${r2.status} ${JSON.stringify(r2.daten)}`);
  check('10b 5 fremde: die eigene Sicherung ist da und enthaelt den alten Inhalt', eig2.length === 1 && readFileSync(resolve(ordner, eig2[0]), 'utf-8') === '{"wichtig":"handarbeit"', eig2.join(','));
  check('10b 5 fremde: die fremden sind unveraendert', fremd.every((f) => existsSync(resolve(ordner, `${basisName}.kaputt-${f}`)) && readFileSync(resolve(ordner, `${basisName}.kaputt-${f}`), 'utf-8') === `fremd-${f}`));
  aufraeumen();

  // 8 confirmed runs, foreign files in between: exactly 5 own copies.
  writeFileSync(resolve(ordner, `${basisName}.kaputt-AAA`), 'fremd-AAA');
  writeFileSync(resolve(ordner, `${basisName}.kaputt-manual-backup.json`), 'fremd-manual');
  let alleAcht = true;
  for (let i = 0; i < 8; i++) alleAcht = (await ueberschreiben(`{"lauf":${i}`)).status === 200 && alleAcht;
  check('10b nach 8 bestaetigten Laeufen liegen genau 5 eigene Sicherungen', alleAcht && eigene().length === 5, eigene().join(','));
  check('10b die 5 eigenen sind die 5 neuesten Laeufe', eigene().map((f) => readFileSync(resolve(ordner, f), 'utf-8')).join('|') === [3, 4, 5, 6, 7].map((i) => `{"lauf":${i}`).join('|'));
  check('10b die fremden AAA / manual-backup.json bleiben', readFileSync(resolve(ordner, `${basisName}.kaputt-AAA`), 'utf-8') === 'fremd-AAA' && readFileSync(resolve(ordner, `${basisName}.kaputt-manual-backup.json`), 'utf-8') === 'fremd-manual');
  aufraeumen();

  // N-2: a directory under the OLDEST own name does not abort, is skipped and does not count.
  mkdirSync(resolve(ordner, `${basisName}.kaputt-00000101T000000000`));
  writeFileSync(resolve(ordner, `${basisName}.kaputt-00000101T000000000`, 'drin.txt'), 'x');
  const r3 = await ueberschreiben('{"verzeichnis":0');
  check('10b Verzeichnis unter dem aeltesten eigenen Namen: kein 500, geschrieben', r3.status === 200 && arbeitBytes().toString('utf-8') === kanon([holzaxt]), `${r3.status} ${JSON.stringify(r3.daten)}`);
  let stimmt = true;
  for (let i = 1; i < 8; i++) stimmt = (await ueberschreiben(`{"verzeichnis":${i}`)).status === 200 && stimmt;
  const mitVerzeichnis = alle().length;
  for (let i = 8; i < 12; i++) stimmt = (await ueberschreiben(`{"verzeichnis":${i}`)).status === 200 && stimmt;
  check('10b Verzeichnis: alle Laeufe 200, genau 5 eigene Dateien, das Verzeichnis bleibt', stimmt && eigene().length === 5 && statSync(resolve(ordner, `${basisName}.kaputt-00000101T000000000`)).isDirectory(), alle().join(','));
  check('10b Verzeichnis: die Zahl der Eintraege waechst nicht mehr (6 nach 8 Laeufen und nach 12)', mitVerzeichnis === 6 && alle().length === 6, `${mitVerzeichnis} ${alle().length}`);
  aufraeumen();

  // B1/N3: five own-pattern names from the future (clock jumped back) must not push the own fresh copy out: 200, at most 5 own copies.
  for (let i = 1; i <= 5; i++) writeFileSync(resolve(ordner, `${basisName}.kaputt-9999010${i}T000000000`), `zukunft-${i}`);
  writeFileSync(ARBEIT, '{"nur":"alt"');
  const g4 = await get();
  const r4 = await put(datei([holzaxt]), String(g4.daten.hash), '?bestaetigt=1');
  if (r4.status === 200) hash = String(r4.daten.hash);
  check('10b Zukunfts-Stempel: bestaetigter PUT 200', r4.status === 200, `${r4.status} ${JSON.stringify(r4.daten)}`);
  const frische = eigene().filter((f) => readFileSync(resolve(ordner, f), 'utf-8') === '{"nur":"alt"');
  check('10b Zukunfts-Stempel: die frische Kopie liegt da und enthaelt den alten Inhalt', frische.length === 1, eigene().join(','));
  check('10b Zukunfts-Stempel: hoechstens 5 eigene Sicherungen', eigene().length <= 5, eigene().join(','));
  aufraeumen();
  writeFileSync(ARBEIT, kanon([holzaxt]));
  hash = sha(kanon([holzaxt]));
}

// ── 11. N1/F3 + F4: a SECOND process holds the lock ──
{
  const vorher = arbeitBytes();
  const h = await halterStarten('sperre-503');
  const t0 = Date.now();
  const putP = put(datei(JSON.parse(vorher.toString('utf-8')).gegenstaende), hash);
  await new Promise((r) => setTimeout(r, 300));
  const t1 = Date.now();
  const q = await anfrage('GET', '/api/gegenstaende/quittung');
  const dauer = Date.now() - t1;
  check('11 waehrend die Sperre fremd gehalten wird: anderer Endpunkt antwortet in < 300 ms', q.status === 200 && dauer < 300, `${q.status} ${dauer} ms`);
  const a = await putP;
  const zeit = Date.now() - t0;
  check('11 PUT bei fremder Sperre: 503 gesperrt mit Retry-After: 2', a.status === 503 && a.daten.fehler === 'gesperrt' && a.retryAfter === '2', `${a.status} ${a.roh} ${String(a.retryAfter)}`);
  check('11 der PUT wartet hoechstens rund 2 s (unter 3 s)', zeit < 3000, `${zeit} ms`);
  check('11 Antwort ohne pid, Rechnername, Pfad', !/pid|\.lock|\/var\/tmp|\/opt\//i.test(a.roh) && !a.roh.includes(hostname()) && !a.roh.includes(String(h.pid)) && ![...dienstPids(), h.pid].some((p) => new RegExp(`\\b${p}\\b`).test(a.roh)) && !a.roh.includes(ORDNER), a.roh);
  check('11 Datei byte-gleich, keine .tmp', arbeitBytes().equals(vorher) && !readdirSync(dirname(ARBEIT)).some((f) => f.endsWith('.tmp')));
  await h.freigeben();
  const danach = await put(datei(JSON.parse(vorher.toString('utf-8')).gegenstaende), hash);
  check('11 nach dem Loslassen: PUT geht wieder (200)', danach.status === 200, `${danach.status} ${danach.roh}`);
  hash = String(danach.daten.hash);
}
{
  // The wait is asynchronous: a lock released within the wait time lets the PUT through, after the release.
  const h = await halterStarten('sperre-frei');
  const bestand = JSON.parse(arbeitBytes().toString('utf-8')).gegenstaende as unknown[];
  const t0 = Date.now();
  const putP = put(datei([...bestand, eintrag('Wartend')]), hash);
  await new Promise((r) => setTimeout(r, 700));
  const fruehVorher = arbeitBytes();
  await h.freigeben();
  const a = await putP;
  check('11 PUT wartet auf eine kurz gehaltene fremde Sperre und geht dann durch (200)', a.status === 200 && Date.now() - t0 >= 600, `${a.status} ${a.roh}`);
  check('11 waehrend des Haltens wurde nichts geschrieben', fruehVorher.toString('utf-8') === kanon(bestand));
  hash = String(a.daten.hash);
}

// ── 12. N1/F5 + F6: stable codes, If-Match rules, temp files, HEAD ──
{
  const q404 = await anfrage('GET', '/api/gegenstaende/gibtsnicht');
  check('12 404 traegt den Code unbekannter-endpunkt', q404.status === 404 && q404.daten.fehler === 'unbekannter-endpunkt', q404.roh);
  check('12 405 traegt den Code methode', (await anfrage('DELETE', '/api/gegenstaende')).daten.fehler === 'methode');
  mkdirSync(QUITTUNG);
  const q500 = await anfrage('GET', '/api/gegenstaende/quittung');
  check('12 500 hat den Code intern und keinen Rohtext (EISDIR, Pfad)', q500.status === 500 && q500.daten.fehler === 'intern' && !/EISDIR|editor-eg1|\/var\/tmp|at /.test(q500.roh), q500.roh);
  rmSync(QUITTUNG, { recursive: true });
  const bestand = arbeitBytes().toString('utf-8');
  const stern = await anfrage('PUT', '/api/gegenstaende', { body: bestand, ifMatchRoh: '*' });
  check('12 If-Match: * wird abgelehnt (428), nichts geschrieben', stern.status === 428 && typeof stern.daten.fehler === 'string' && arbeitBytes().toString('utf-8') === bestand, `${stern.status} ${stern.roh}`);
  const liste = await anfrage('PUT', '/api/gegenstaende', { body: bestand, ifMatchRoh: `"${'a'.repeat(64)}", W/"${hash}"` });
  check('12 If-Match-Liste: ein passender Eintrag genuegt (200)', liste.status === 200, `${liste.status} ${liste.roh}`);
  const listeFalsch = await anfrage('PUT', '/api/gegenstaende', { body: bestand, ifMatchRoh: `"${'a'.repeat(64)}", "${'b'.repeat(64)}"` });
  check('12 If-Match-Liste ohne passenden Eintrag: 412', listeFalsch.status === 412 && listeFalsch.daten.fehler === 'veraltet', `${listeFalsch.status}`);
  const listeStern = await anfrage('PUT', '/api/gegenstaende', { body: bestand, ifMatchRoh: `"${hash}", *` });
  check('12 If-Match-Liste mit * darin: 428', listeStern.status === 428, `${listeStern.status}`);
  // stale temp files of THIS route (older than 10 min) are removed under the lock; fresh and foreign ones stay
  const ordner = dirname(ARBEIT);
  const alt = `${ARBEIT}.99999.deadbeef.tmp`;
  const frisch = `${ARBEIT}.99998.cafebabe.tmp`;
  const fremd = resolve(ordner, 'anderes.tmp');
  for (const f of [alt, frisch, fremd]) writeFileSync(f, 'x');
  const vorZehnMin = new Date(Date.now() - 11 * 60_000);
  for (const f of [alt, fremd]) utimesSync(f, vorZehnMin, vorZehnMin);
  const bestand2 = arbeitBytes().toString('utf-8');
  const p = await anfrage('PUT', '/api/gegenstaende', { body: bestand2, ifMatchRoh: `"${sha(bestand2)}"` });
  check('12 PUT 200', p.status === 200, `${p.status} ${p.roh}`);
  check('12 alte .tmp der Route entfernt, frische und fremde bleiben', !existsSync(alt) && existsSync(frisch) && existsSync(fremd));
  for (const f of [frisch, fremd]) rmSync(f, { force: true });
  hash = sha(arbeitBytes());
  // HEAD: an answer instead of a reset connection
  for (const pfad of ['/api/gegenstaende', '/api/gegenstaende/quittung']) {
    let status = -1;
    try {
      status = (await fetch(`http://127.0.0.1:${port}${pfad}`, { method: 'HEAD', headers: { 'x-wov-token': TOKEN } })).status;
    } catch {
      status = -1;
    }
    check(`12 HEAD ${pfad}: 405 oder 200 ohne Body statt Verbindungsabbruch`, status === 405 || status === 200, String(status));
  }
}

// ── shut down ──
const gruppe = dienst!.pid!;
gruppeBeenden('SIGTERM');
await new Promise((r) => setTimeout(r, 300));
gruppeBeenden('SIGKILL');
await new Promise((r) => setTimeout(r, 300));
let lebt = false;
for (const p of [gruppe, ...pids, ...halterPids, ...halterPids.map((x) => -x)]) {
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
