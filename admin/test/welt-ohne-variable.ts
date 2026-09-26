/**
 * World working copy without WOV_WELT_VERZEICHNIS (editor stage E2, card K5.7, B1/B2/N2).
 * Ohne die Variable liest und beschreibt der Betriebsdienst NIE ein Verzeichnis ausserhalb seiner Wurzel
 * (frueher: /var/lib/wov/welten, also die DEV-Welt, bei jedem Test und jedem Slot-Dienst ohne die Variable):
 * die Arbeitskopie liegt dann in <Wurzel>/server/data/welten-arbeit/ und wird von Git ignoriert.
 *
 *   npx tsx test/welt-ohne-variable.ts      (from admin/)
 *
 * Startet admin/src/main.ts gegen ein Temp-Git-Repo (WOV_WURZEL, mit der .gitignore dieses Repos) OHNE
 * WOV_WELT_VERZEICHNIS. Bewiesen wird:
 *  1. die Arbeitskopie entsteht unter <Wurzel>/server/data/welten-arbeit/dev.json (Bytes = Repo-Datei),
 *     Speichern (PATCH ops) aendert sie, die Repo-Datei nicht, `git status --porcelain` bleibt leer;
 *  2. ein relatives WOV_WELT_VERZEICHNIS beendet den Start mit Meldung und legt nirgends einen Ordner an (N2);
 *  3. /var/lib/wov ist danach unveraendert (Dateiliste; die Lauf-Mtime des Ordners wird mit gemessen).
 * Die Probe im umgelenkten /var/lib/wov (Mount-Namensraum) steht im Bericht; dieser Test misst, was ohne
 * Umlenkung moeglich ist: die tatsaechlichen Pfade und dass /var/lib/wov gleich bleibt.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLE = resolve(ADMIN, '..');
const TSX = resolve(QUELLE, 'node_modules/.bin/tsx');
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

const T = mkdtempSync(resolve(tmpdir(), 'wov-welt-ohne-variable-'));
const WURZEL = resolve(T, 'repo');
const REPO_DATEI = resolve(WURZEL, 'server/data/welten/dev.json');
const ARBEIT = resolve(WURZEL, 'server/data/welten-arbeit/dev.json');
const TOKEN = 'ohne-variable-token-4711';
const TOKEN_DATEI = resolve(T, 'token');
const stand = (p: string): string => {
  if (!existsSync(p)) return 'fehlt';
  const s = statSync(p);
  return `${readdirSync(p).sort().join(',')}@${s.mtimeMs}`;
};
const varLibVor = stand('/var/lib/wov');

const kinder: ChildProcess[] = [];
const git = (...args: string[]): string => {
  const r = spawnSync('git', args, { cwd: WURZEL, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const dokument = {
  version: 1,
  name: 'Ohne-Variable-Test',
  detailSeed: 'ov',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 }],
  lakes: [{ id: 'lk-00', x: 0, z: -300, radius: 50 }],
};
const AUSGANG = layoutText(sanitizeWorldLayout(dokument)!);

mkdirSync(resolve(WURZEL, 'server/data/welten'), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(REPO_DATEI, AUSGANG);
copyFileSync(resolve(QUELLE, '.gitignore'), resolve(WURZEL, '.gitignore'));
git('init', '-q');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Ausgang');

/** Start OHNE WOV_WELT_VERZEICHNIS (ausser `extra`); die Variable wird aus der Umgebung des Testlaufs entfernt. */
function dienstStarten(extra: NodeJS.ProcessEnv = {}): Promise<{ port: number | null; kind: ChildProcess; log: () => string; code: () => number | null }> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    let ende: number | null = null;
    const umgebung: NodeJS.ProcessEnv = { ...process.env, WOV_WURZEL: WURZEL, WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI };
    delete umgebung.WOV_WELT_VERZEICHNIS;
    const kind = spawn(TSX, ['src/main.ts'], { cwd: ADMIN, env: { ...umgebung, ...extra }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    kinder.push(kind);
    const frist = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(frist);
        fertig({ port: Number(t[1]), kind, log: () => protokoll, code: () => ende });
      }
    };
    kind.stdout.on('data', auf);
    kind.stderr.on('data', auf);
    kind.on('exit', (code) => {
      ende = code;
      clearTimeout(frist);
      // Ein Start, der mit Meldung endet, ist hier ein gueltiges Ergebnis (relativer Wert).
      if (extra.WOV_WELT_VERZEICHNIS !== undefined) fertig({ port: null, kind, log: () => protokoll, code: () => ende });
      else if (code !== null && code !== 0 && code !== 143) scheitern(new Error(`Dienst endet mit ${code}:\n${protokoll}`));
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

try {
  check('Ausgang: das Repo ist sauber, es gibt keine Arbeitskopie', git('status', '--porcelain') === '' && !existsSync(ARBEIT));

  // ── 1) ohne Variable: Arbeitskopie im Repo-Ordner welten-arbeit ────────
  const dienst = await dienstStarten();
  check('ohne Variable: Arbeitskopie unter <Wurzel>/server/data/welten-arbeit/dev.json, Bytes = Repo-Datei', existsSync(ARBEIT) && readFileSync(ARBEIT, 'utf-8') === AUSGANG);
  check('ohne Variable: die Logzeile nennt den Pfad im Repo-Ordner, nicht /var/lib/wov', dienst.log().includes(ARBEIT) && !/\/var\/lib\/wov/.test(dienst.log()), dienst.log().slice(0, 300));
  const g = await anfrage(dienst.port!, 'GET', '/api/worldlayout');
  const lake = (g.daten.layout as { lakes: Array<Record<string, unknown> & { id: string }> }).lakes[0]!;
  const r = await anfrage(dienst.port!, 'PATCH', '/api/worldlayout/ops', {
    vorgangId: 'ov-1',
    ops: [{ art: 'aendere', sammlung: 'lakes', id: lake.id, vorher: lake, nachher: { ...lake, radius: 77 } }],
  });
  check('ohne Variable: Speichern -> 200, Hash der Antwort = Hash der Arbeitskopie', r.status === 200 && r.daten.hash === sha(readFileSync(ARBEIT)));
  check('ohne Variable: Repo-Datei bytegleich zum Ausgang', readFileSync(REPO_DATEI, 'utf-8') === AUSGANG);
  check('ohne Variable: git status --porcelain leer (welten-arbeit/ ist ignoriert)', git('status', '--porcelain') === '', JSON.stringify(git('status', '--porcelain')));
  check('ohne Variable: Sicherungen und Basis liegen im Ordner welten-arbeit', readdirSync(dirname(ARBEIT)).includes('dev.basis') && readdirSync(dirname(ARBEIT)).some((n) => n.endsWith('.bak')));
  gruppeBeenden(dienst.kind, 'SIGTERM');
  await new Promise((f) => setTimeout(f, 500));

  // ── 2) relativer Wert: Start endet mit Meldung, nichts angelegt (N2) ───
  const relativ = await dienstStarten({ WOV_WELT_VERZEICHNIS: 'relwelt' });
  await new Promise((f) => setTimeout(f, 300));
  check('N2: relatives WOV_WELT_VERZEICHNIS: der Dienst endet mit Exit 1 und Meldung', relativ.code() === 1 && /kein absoluter Pfad/.test(relativ.log()), `${relativ.code()} ${relativ.log().slice(0, 200)}`);
  check('N2: nirgends wurde ein Ordner "relwelt" angelegt (Wurzel, admin/, server/)', !existsSync(resolve(WURZEL, 'relwelt')) && !existsSync(resolve(ADMIN, 'relwelt')) && !existsSync(resolve(QUELLE, 'server/relwelt')) && !existsSync(resolve(QUELLE, 'relwelt')));

  check('/var/lib/wov unveraendert (Dateiliste und mtime)', stand('/var/lib/wov') === varLibVor, `${varLibVor} -> ${stand('/var/lib/wov')}`);
} finally {
  for (const k of kinder) gruppeBeenden(k, 'SIGKILL');
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nwelt-ohne-variable (admin): alles gruen');
