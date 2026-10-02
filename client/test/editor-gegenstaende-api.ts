/**
 * Editor card EG2: the API client of the item mask (`client/src/editor/gegenstaende/api.ts`) against the REAL
 * operations service (child process, test root, port 0), the pattern of `admin/test/gegenstaende-route.ts`.
 * Editor-Karte EG2: der Client der Gegenstands-Maske gegen den ECHTEN Betriebsdienst mit Testwurzel.
 *
 * Why the real service and not a stub: the refusals that matter (412, 409, 422, 503) come from the route's own
 * protection (compare under the lock, removal check, sanitiser); a stub built from the report would only prove
 * that the client agrees with the report.
 *
 *  [1] GET: state, hash, sanitised again
 *  [2] PUT 200: canonical bytes on disk, new hash, GET shows it
 *  [3] 412: stale hash -> `veraltet` with the current hash, file unchanged; the reload offer keeps the draft
 *  [4] 409: removal -> `bestaetigung` with the ids, file unchanged; confirmed PUT only after a yes
 *  [5] 422: a broken text, discarded entries with their reason codes
 *  [6] 503: a second process holds the lock -> `gesperrt`, file unchanged
 *  [7] other answers: 428, 401 without token, network failure
 *  [8] receipt: missing, readable, garbage
 *  [9] the end: service and lock holder are gone (`ps -p`), the test root is removed
 *
 * Run: npx tsx test/editor-gegenstaende-api.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { gegenstandsArbeitsDatei, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import {
  ladeQuittung,
  ladeStand,
  speichere,
  speichereText,
  speichernMitBestaetigung,
  type ApiOptionen,
} from '../src/editor/gegenstaende/api';
import { fehlerErgebnisText, grundText } from '../src/editor/gegenstaende/texte';

// Lock holder: this file started again as a second process (`--halter <working copy> <stop file>`).
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
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..', '..', 'admin');
const TSX = resolve(HIER, '..', '..', 'node_modules/.bin/tsx');
const ORDNER = mkdtempSync('/var/tmp/editor-eg2-');
const ARBEITSORDNER = resolve(ORDNER, 'arbeit');
const TOKEN = 'eg2-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(ARBEITSORDNER, { recursive: true });
mkdirSync(dirname(gegenstandsRepoDatei(ORDNER)), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, '#!/bin/sh\nexit 0\n');
chmodSync(SYSTEMCTL, 0o755);
writeFileSync(gegenstandsRepoDatei(ORDNER), schreibeGegenstandsDatei([]));
const ARBEIT = gegenstandsArbeitsDatei(ORDNER, ARBEITSORDNER);
const QUITTUNG = resolve(dirname(ARBEIT), 'gegenstaende.quittung.json');

let dienst: ChildProcess | null = null;
const halterPids: number[] = [];
function gruppeBeenden(): void {
  const pid = dienst?.pid;
  if (pid) {
    for (const ziel of [-pid, pid]) {
      try {
        process.kill(ziel, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  for (const p of halterPids) {
    for (const ziel of [-p, p]) {
      try {
        process.kill(ziel, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
function aufraeumen(): void {
  gruppeBeenden();
  rmSync(ORDNER, { recursive: true, force: true });
}
process.on('exit', aufraeumen);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => {
    aufraeumen();
    process.exit(1);
  });
}

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
const dienstPid = dienst!.pid!;
const API: ApiOptionen = { basis: `http://127.0.0.1:${port}`, kopf: { 'x-wov-token': TOKEN } };
const arbeitText = (): string => readFileSync(ARBEIT, 'utf-8');

async function halterStarten(): Promise<{ pid: number; freigeben: () => Promise<void> }> {
  const stopp = resolve(ORDNER, 'stopp-halter');
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
    },
  };
}

function eintrag(id: string, gewicht = 1): GegenstandsEintrag {
  const l = leseGegenstandsDatei(
    JSON.stringify({
      version: 1,
      gegenstaende: [{ id, nameSchluessel: `inhalt.gegenstand.${id}.name`, typ: 'material', gewicht, texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: `${id} en` } } }],
    })
  );
  if (l.eintraege.length !== 1) throw new Error('fixture refused');
  return l.eintraege[0];
}

try {
  // ── [1] GET ──
  console.log('\n[1] GET:');
  const erst = await ladeStand(API);
  check('GET liefert den Stand', erst.art === 'ok', JSON.stringify(erst));
  if (erst.art !== 'ok') throw new Error('no state');
  check('Hash ist ein SHA-256, Quelle repo, keine Eintraege, kein Dateifehler', /^[0-9a-f]{64}$/.test(erst.stand.hash) && erst.stand.quelle === 'repo' && erst.stand.eintraege.length === 0 && erst.stand.dateiFehler === null);
  check('die Arbeitsdatei wurde aus dem Repo-Stand angelegt', existsSync(ARBEIT) && arbeitText() === erst.stand.text);

  // ── [2] PUT 200 ──
  console.log('\n[2] PUT 200:');
  const holz = eintrag('Holzaxt', 2);
  const ok1 = await speichere(API, [holz], erst.stand.hash);
  check('PUT 200 mit neuem Hash', ok1.art === 'ok' && ok1.hash !== erst.stand.hash && ok1.eintraege === 1, JSON.stringify(ok1));
  check('die Datei ist genau der kanonische Text', arbeitText() === schreibeGegenstandsDatei([holz]));
  const nach1 = await ladeStand(API);
  check('GET zeigt den Eintrag, Hash = Hash der PUT-Antwort', nach1.art === 'ok' && nach1.stand.eintraege.length === 1 && nach1.stand.eintraege[0].id === 'Holzaxt' && ok1.art === 'ok' && nach1.stand.hash === ok1.hash && nach1.stand.quelle === 'arbeit');
  if (nach1.art !== 'ok' || ok1.art !== 'ok') throw new Error('no state');

  // ── [3] 412 ──
  console.log('\n[3] 412 und Neu laden:');
  const vorher = arbeitText();
  const feder = eintrag('Feder');
  const veraltet = await speichere(API, [holz, feder], erst.stand.hash);
  check('alter Hash: veraltet mit dem aktuellen Hash', veraltet.art === 'veraltet' && veraltet.hash === nach1.stand.hash, JSON.stringify(veraltet));
  check('Datei unveraendert', arbeitText() === vorher);
  // the reload offer: state is read again, the draft (the entry the author typed) is applied on top of the NEW state
  const neu = await ladeStand(API);
  check('Neu laden liefert den aktuellen Stand', neu.art === 'ok' && neu.stand.hash === nach1.stand.hash);
  if (neu.art === 'ok') {
    const entwurf = [...neu.stand.eintraege, feder];
    const nochmal = await speichere(API, entwurf, neu.stand.hash);
    check('der Entwurf geht mit dem neuen Hash durch und ist in der Datei', nochmal.art === 'ok' && arbeitText() === schreibeGegenstandsDatei(entwurf), JSON.stringify(nochmal));
  }
  const stand3 = await ladeStand(API);
  if (stand3.art !== 'ok') throw new Error('no state');
  check('Dokument hat jetzt Holzaxt und Feder', stand3.stand.eintraege.map((e) => e.id).join() === 'Holzaxt,Feder');

  // ── [4] 409 ──
  console.log('\n[4] 409 Bestaetigung:');
  const beiEntfernen = arbeitText();
  const ohneHolz = [feder];
  const roh409 = await speichere(API, ohneHolz, stand3.stand.hash);
  check('Entfernen ohne Bestaetigung: bestaetigung mit der id', roh409.art === 'bestaetigung' && roh409.info.art === 'entfernen' && roh409.info.entfernt.join() === 'Holzaxt' && roh409.info.entferntOhneId.length === 0, JSON.stringify(roh409));
  check('Datei unveraendert nach dem 409', arbeitText() === beiEntfernen);

  let gefragt = 0;
  let gefragtInfo: unknown = null;
  const nein = await speichernMitBestaetigung(API, ohneHolz, stand3.stand.hash, async (info) => {
    gefragt++;
    gefragtInfo = info;
    return false;
  });
  check('Antwort nein: abgebrochen, genau eine Frage, mit der id', nein.art === 'abgebrochen' && gefragt === 1 && JSON.stringify(gefragtInfo).includes('Holzaxt'), JSON.stringify(nein));
  check('Antwort nein: Datei unveraendert (kein bestaetigter PUT)', arbeitText() === beiEntfernen);

  gefragt = 0;
  const ja = await speichernMitBestaetigung(API, ohneHolz, stand3.stand.hash, async () => {
    gefragt++;
    return true;
  });
  check('Antwort ja: gespeichert, `entfernt` nennt die id', ja.art === 'ok' && ja.entfernt.join() === 'Holzaxt' && gefragt === 1, JSON.stringify(ja));
  check('Antwort ja: Datei ohne Holzaxt', arbeitText() === schreibeGegenstandsDatei(ohneHolz));

  let ohneFrage = 0;
  const stand4 = await ladeStand(API);
  if (stand4.art !== 'ok') throw new Error('no state');
  const harmlos = await speichernMitBestaetigung(API, [feder, holz], stand4.stand.hash, async () => {
    ohneFrage++;
    return true;
  });
  check('Hinzufuegen braucht keine Bestaetigung (keine Frage)', harmlos.art === 'ok' && ohneFrage === 0, JSON.stringify(harmlos));

  const stand5 = await ladeStand(API);
  if (stand5.art !== 'ok') throw new Error('no state');
  const bestaetigtVeraltet = await speichernMitBestaetigung(API, [], stand5.stand.hash, async () => {
    // the file changes while the dialog is open: the confirmed PUT must be refused (412), nothing removed
    const andere = await ladeStand(API);
    if (andere.art === 'ok') await speichere(API, [...andere.stand.eintraege, eintrag('Zwischen')], andere.stand.hash);
    return true;
  });
  check('Datei aendert sich waehrend der Frage: 412, nichts entfernt', bestaetigtVeraltet.art === 'veraltet' && leseGegenstandsDatei(arbeitText()).eintraege.map((e) => e.id).join() === 'Feder,Holzaxt,Zwischen', JSON.stringify(bestaetigtVeraltet));

  // ── [5] 422 ──
  console.log('\n[5] 422:');
  const stand6 = await ladeStand(API);
  if (stand6.art !== 'ok') throw new Error('no state');
  const vor422 = arbeitText();
  const kaputt = await speichereText(API, '{ das ist kein json', stand6.stand.hash);
  check('kein JSON: 422 datei-kein-json', kaputt.art === 'fehler' && kaputt.status === 422 && kaputt.fehler === 'datei-kein-json', JSON.stringify(kaputt));
  const schlechteId = JSON.stringify({ version: 1, gegenstaende: [{ id: 'klein', nameSchluessel: 'inhalt.gegenstand.klein.name', typ: 'material' }, { ...JSON.parse(schreibeGegenstandsDatei([feder])).gegenstaende[0] }] });
  const verw = await speichereText(API, schlechteId, stand6.stand.hash);
  check('ungueltiger Eintrag: verworfen mit Index und Grund-Code', verw.art === 'verworfen' && verw.verworfen.length === 1 && verw.verworfen[0].index === 0 && verw.verworfen[0].grund === 'id-ungueltig', JSON.stringify(verw));
  if (verw.art === 'verworfen') check('der Grund-Code hat einen Text (kein nackter Code)', !grundText(verw.verworfen[0].grund).includes('id-ungueltig') && grundText(verw.verworfen[0].grund).length > 10);
  const kopfFalsch = await speichereText(API, '[]', stand6.stand.hash);
  check('Kopf falsch (Liste statt Objekt): 422 datei-kopf-falsch', kopfFalsch.art === 'fehler' && kopfFalsch.status === 422 && kopfFalsch.fehler === 'datei-kopf-falsch', JSON.stringify(kopfFalsch));
  check('Datei nach allen 422 unveraendert', arbeitText() === vor422);
  check('die Texte der Fehler sind uebersetzt (kein nackter Code)', kaputt.art === 'fehler' && !fehlerErgebnisText(kaputt).includes('datei-kein-json') && fehlerErgebnisText(kaputt).length > 10);

  // ── [6] 503 ──
  console.log('\n[6] 503 gesperrt:');
  const halter = await halterStarten();
  const zeit0 = Date.now();
  const gesperrt = await speichere(API, [feder], stand6.stand.hash);
  check('Sperre gehalten: gesperrt mit Retry-After', gesperrt.art === 'gesperrt' && gesperrt.retryAfter === 2, JSON.stringify(gesperrt));
  check('der Client wartete nicht selbst (Antwort nach der Wartezeit des Dienstes, unter 6 s)', Date.now() - zeit0 < 6000, String(Date.now() - zeit0));
  check('Datei waehrend der Sperre unveraendert', arbeitText() === vor422);
  await halter.freigeben();
  const nachSperre = await speichere(API, leseGegenstandsDatei(vor422).eintraege, stand6.stand.hash);
  check('nach der Sperre geht derselbe PUT durch', nachSperre.art === 'ok', JSON.stringify(nachSperre));

  // ── [7] other answers ──
  console.log('\n[7] Andere Antworten:');
  const ohneBasis = await speichereText(API, schreibeGegenstandsDatei([]), '');
  check('leerer Hash: 428 basis-fehlt', ohneBasis.art === 'fehler' && ohneBasis.status === 428 && ohneBasis.fehler === 'basis-fehlt', JSON.stringify(ohneBasis));
  const ohneToken = await ladeStand({ basis: API.basis });
  check('ohne Token: 401, Text ist der Zugangstext', ohneToken.art === 'fehler' && ohneToken.status === 401 && fehlerErgebnisText(ohneToken).includes('Token'), JSON.stringify(ohneToken));
  const tot = await ladeStand({ basis: 'http://127.0.0.1:1', kopf: API.kopf });
  check('Dienst nicht erreichbar: netz', tot.art === 'netz');
  const werfend = await speichere({ fetcher: () => Promise.reject(new Error('boom')) }, [], 'x');
  check('fetch wirft: netz', werfend.art === 'netz');
  const keinJson = await ladeStand({ fetcher: async () => new Response('<html>bad gateway</html>', { status: 502 }) });
  check('Antwort ohne JSON: fehler mit Status, ohne Code', keinJson.art === 'fehler' && keinJson.status === 502 && keinJson.fehler === null, JSON.stringify(keinJson));
  const luege = await ladeStand({ fetcher: async () => new Response(JSON.stringify({ ok: true, hash: 'abc', text: 42 }), { status: 200 }) });
  check('Antwort mit falschem Aufbau wird nicht geglaubt', luege.art === 'fehler', JSON.stringify(luege));
  const unsauber = await ladeStand({
    fetcher: async () => new Response(JSON.stringify({ ok: true, hash: 'abc', text: JSON.stringify({ version: 1, gegenstaende: [{ id: 'x' }] }), eintraege: [{ id: 'Erfunden' }] }), { status: 200 }),
  });
  check('Eintraege kommen aus dem Rohtext, nicht aus dem Feld `eintraege` der Antwort', unsauber.art === 'ok' && unsauber.stand.eintraege.length === 0 && unsauber.stand.verworfen.length === 1, JSON.stringify(unsauber));

  // ── [8] receipt ──
  console.log('\n[8] Quittung:');
  const keine = await ladeQuittung(API);
  check('fehlt die Datei: status keine', keine.art === 'ok' && keine.quittung.status === 'keine', JSON.stringify(keine));
  writeFileSync(QUITTUNG, JSON.stringify({ status: 'bestaetigung-noetig', gehalten: { Holzaxt: 3 } }));
  const gelesen = await ladeQuittung(API);
  check('lesbar: durchgereicht mit Zaehlern', gelesen.art === 'ok' && gelesen.quittung.status === 'bestaetigung-noetig' && JSON.stringify(gelesen.quittung.gehalten) === '{"Holzaxt":3}', JSON.stringify(gelesen));
  writeFileSync(QUITTUNG, '{ kaputt');
  const unlesbar = await ladeQuittung(API);
  check('Muell: unlesbar', unlesbar.art === 'ok' && unlesbar.quittung.status === 'unlesbar', JSON.stringify(unlesbar));
} finally {
  // ── [9] the end ──
  console.log('\n[9] Ende:');
  const pids = [dienstPid, ...halterPids];
  gruppeBeenden();
  await new Promise((r) => setTimeout(r, 400));
  let uebrig = '';
  try {
    uebrig = execFileSync('ps', ['-o', 'pid=', '-p', pids.join(',')], { encoding: 'utf-8' }).trim();
  } catch {
    uebrig = ''; // `ps -p` exits 1 when none of the pids exists
  }
  check('Dienst und Sperr-Halter sind beendet (ps -p)', uebrig === '', uebrig);
  rmSync(ORDNER, { recursive: true, force: true });
  check('Testwurzel entfernt', !existsSync(ORDNER));
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
