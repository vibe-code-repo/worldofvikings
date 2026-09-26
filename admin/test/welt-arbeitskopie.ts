/**
 * Saving in the editor must not dirty the git tree (editor stage E2, card K5.7).
 * Speichern ueber den Betriebsdienst schreibt die ARBEITSKOPIE (WOV_WELT_VERZEICHNIS), nicht die
 * Repo-Datei: 10 Speichervorgaenge (PATCH ops) ergeben 0 Zeilen in `git status --porcelain`.
 *
 *   npx tsx test/welt-arbeitskopie.ts      (from admin/)
 *
 * Startet admin/src/main.ts gegen ein Temp-Git-Repo (WOV_WURZEL) mit dem abgenommenen Stand
 * (server/data/welten/dev.json, committet) und einem SEPARATEN Weltverzeichnis (WOV_WELT_VERZEICHNIS).
 * Es wird nie nach /var/lib/wov geschrieben.
 *
 * In Zahlen:
 *  1. der Start legt die Arbeitskopie einmal aus dem Repo an (Bytes gleich, Basis = Repo-Hash);
 *  2. 10 x PATCH ops -> 10 x 200, `git status --porcelain` 0 Zeilen, Repo-Datei bytegleich, die
 *     Arbeitskopie hat sich 10 x geaendert (Hash aus der Antwort = Hash der Platte);
 *  3. Neustart des Dienstes: Arbeitskopie bleibt bytegleich, GET liefert denselben Hash, kein neues Anlegen;
 *  4. der Abgleich des Spielservers (Modus voll) danach: Repo = Basis, Arbeitskopie bleibt (keine Ueberschreibung);
 *  5. /var/lib/wov unveraendert.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { basisLesen, weltAbgleichen } from '@wov/shared/src/worldlayout/weltArbeitskopie.js';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const T = mkdtempSync(resolve(tmpdir(), 'wov-welt-arbeitskopie-admin-'));
const WURZEL = resolve(T, 'repo');
const REPO_DATEI = resolve(WURZEL, 'server/data/welten/dev.json');
const ARBEITSORDNER = resolve(T, 'arbeit');
const ARBEIT = resolve(ARBEITSORDNER, 'dev.json');
const TOKEN = 'arbeitskopie-token-4711';
const TOKEN_DATEI = resolve(T, 'token');
const vorVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;

const kinder: ChildProcess[] = [];
const git = (...args: string[]): string => {
  const r = spawnSync('git', args, { cwd: WURZEL, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const dokument = {
  version: 1,
  name: 'Arbeitskopie-Test',
  detailSeed: 'ak',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 }],
  lakes: Array.from({ length: 10 }, (_, i) => ({ id: `lk-${String(i).padStart(2, '0')}`, x: i * 40, z: -300, radius: 50 })),
};
const AUSGANG = layoutText(sanitizeWorldLayout(dokument)!);

mkdirSync(resolve(WURZEL, 'server/data/welten'), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(REPO_DATEI, AUSGANG);
git('init', '-q');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Ausgang');

function dienstStarten(): Promise<{ port: number; kind: ChildProcess; log: () => string }> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    const kind = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: WURZEL,
        WOV_WELT_VERZEICHNIS: ARBEITSORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: process.env.WOV_TEST_ADMIN_PORT ?? '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Eigene Prozessgruppe: tsx startet node als Kind; nur die Gruppe zu beenden raeumt beide weg
      // (sonst haelt das Enkelkind die Pipes offen und der Runner wartet bis zum Zeitlimit).
      detached: true,
    });
    kinder.push(kind);
    const frist = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(frist);
        fertig({ port: Number(t[1]), kind, log: () => protokoll });
      }
    };
    kind.stdout.on('data', auf);
    kind.stderr.on('data', auf);
    kind.on('exit', (code) => {
      clearTimeout(frist);
      if (code !== null && code !== 0 && code !== 143) scheitern(new Error(`Dienst endet mit ${code}:\n${protokoll}`));
    });
  });
}
async function anfrage(port: number, methode: 'GET' | 'PATCH', pfad: string, leib?: unknown): Promise<{ status: number; daten: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: { 'x-wov-token': TOKEN, ...(leib !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
function gruppeBeenden(kind: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-kind.pid!, signal);
  } catch {
    /* Gruppe schon weg */
  }
}
async function stoppen(kind: ChildProcess): Promise<void> {
  if (kind.exitCode !== null) return;
  await new Promise<void>((f) => {
    kind.once('exit', () => f());
    gruppeBeenden(kind, 'SIGTERM');
  });
}

try {
  check('Ausgang: das Repo ist sauber', git('status', '--porcelain') === '');
  check('Ausgang: es gibt noch keine Arbeitskopie', !existsSync(ARBEIT));

  // ── 1) Start: Arbeitskopie wird einmal angelegt ───────────────────────
  let dienst = await dienstStarten();
  check('Start: Arbeitskopie angelegt, Bytes = Repo-Datei', existsSync(ARBEIT) && readFileSync(ARBEIT, 'utf-8') === AUSGANG);
  check('Start: Basis = Hash des Repo-Stands', basisLesen(ARBEIT) === sha(AUSGANG));
  check('Start: Logzeile nennt das Anlegen', /Arbeitskopie angelegt aus dem Repo/.test(dienst.log()));
  const g0 = await anfrage(dienst.port, 'GET', '/api/worldlayout');
  check('Start: GET liefert den Hash der Arbeitskopie', g0.status === 200 && g0.daten.hash === sha(AUSGANG));

  // ── 2) 10 Speichervorgaenge ───────────────────────────────────────────
  let stand = g0.daten.layout as { lakes: Array<Record<string, unknown> & { id: string; radius: number }> };
  const hashes = new Set<string>([sha(AUSGANG)]);
  let ok200 = 0;
  for (let i = 0; i < 10; i++) {
    const vorher = stand.lakes.find((l) => l.id === `lk-${String(i).padStart(2, '0')}`)!;
    const r = await anfrage(dienst.port, 'PATCH', '/api/worldlayout/ops', {
      vorgangId: `ak-${i}`,
      ops: [{ art: 'aendere', sammlung: 'lakes', id: vorher.id, vorher, nachher: { ...vorher, radius: 100 + i } }],
    });
    if (r.status === 200) ok200++;
    const platte = sha(readFileSync(ARBEIT));
    if (r.status === 200 && r.daten.hash === platte) hashes.add(platte);
  }
  check('10 x PATCH ops -> 10 x 200', ok200 === 10, `${ok200}`);
  check('die Arbeitskopie hat sich bei jedem Vorgang geaendert (11 verschiedene Staende, Hash aus der Antwort = Hash der Platte)', hashes.size === 11, `${hashes.size}`);
  const porcelain = git('status', '--porcelain');
  check('git status --porcelain: 0 Zeilen nach 10 Speichervorgaengen', porcelain.split('\n').filter((z) => z !== '').length === 0, JSON.stringify(porcelain));
  check('Repo-Datei bytegleich zum Ausgang', readFileSync(REPO_DATEI, 'utf-8') === AUSGANG);
  check('Basis unveraendert (Repo-Stand)', basisLesen(ARBEIT) === sha(AUSGANG));
  check('Sicherungen und Sperrdateien liegen im Weltverzeichnis, nicht im Repo', readdirSync(resolve(WURZEL, 'server/data/welten')).join(',') === 'dev.json' && readdirSync(ARBEITSORDNER).some((n) => n.endsWith('.bak')));
  const arbeitHash = sha(readFileSync(ARBEIT));

  // ── 3) Neustart ───────────────────────────────────────────────────────
  await stoppen(dienst.kind);
  dienst = await dienstStarten();
  check('Neustart: Arbeitskopie bytegleich (Hash gleich)', sha(readFileSync(ARBEIT)) === arbeitHash);
  const g1 = await anfrage(dienst.port, 'GET', '/api/worldlayout');
  check('Neustart: GET liefert den Arbeitsstand (Hash gleich)', g1.status === 200 && g1.daten.hash === arbeitHash);
  check('Neustart: nichts neu angelegt', !/Arbeitskopie angelegt/.test(dienst.log()));
  check('Neustart: Repo weiter sauber', git('status', '--porcelain') === '');

  // ── 4) Abgleich des Spielservers nach dem Neustart ─────────────────────
  const a = weltAbgleichen({ repoDatei: REPO_DATEI, arbeitsDatei: ARBEIT });
  check('Abgleich (Spielserver-Start): Repo = Basis -> Arbeitskopie gelesen, nicht ueberschrieben', a.fall === 'unveraendert' && sha(readFileSync(ARBEIT)) === arbeitHash, a.fall);

  const nachVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;
  check('/var/lib/wov unveraendert', vorVarLibWov === nachVarLibWov, `${vorVarLibWov} -> ${nachVarLibWov}`);
} finally {
  for (const k of kinder) gruppeBeenden(k, 'SIGKILL');
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nwelt-arbeitskopie (admin): alles gruen');
