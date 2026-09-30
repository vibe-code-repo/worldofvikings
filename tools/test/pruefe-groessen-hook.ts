/**
 * H1 (N3): Der Größenwächter darf aus einem Git-Hook heraus das umgebende Repo nicht verändern.
 * The size guard must not touch the surrounding repository when it runs from a git hook.
 *
 * Ein pre-commit-Hook in einem verknüpften Arbeitsbaum (so sind alle Worktrees auf dem Bauhost gebaut) bekommt von Git `GIT_DIR` und
 * `GIT_INDEX_FILE` gesetzt. Erbt die Selbstprobe des Wächters sie, laufen ihre `git init/add/commit` gegen das ECHTE Repo: HEAD wandert,
 * der Index wird ersetzt, der Baum verliert Dateien (Nachangriff auf #155, H1). Dieser Test fährt den Wächter aus einem solchen Hook, aus
 * `git rebase --exec` und mit von Hand gesetztem `GIT_DIR`/`GIT_INDEX_FILE`, in einem Wegwerf-Klon, und vergleicht HEAD, Refs, Index und
 * `shallow` des echten Repos vorher und nachher. `WOV_GUARD_SKRIPT` nennt einen anderen Wächter (der Rot-Nachweis nimmt den Stand `feeccea6`).
 *
 * Run: npx tsx tools/test/pruefe-groessen-hook.ts   (from the repo root)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const WAECHTER = process.env.WOV_GUARD_SKRIPT ? resolve(process.env.WOV_GUARD_SKRIPT) : join(WURZEL, 'scripts/pruefe-groessen.mjs');

let fehler = 0;
function pruefe(ok: boolean, name: string, detail = ''): void {
  if (ok) console.log(`  PASS ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
    fehler++;
  }
}

/** Git ohne geerbte GIT_*-Variablen (dieser Test selbst darf nicht von einem äußeren Hook beeinflusst werden). */
function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}, ok = false): string {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, extraEnv);
  try {
    return execFileSync('git', ['-C', cwd, '-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (ok) return String((e as { stdout?: string }).stdout ?? '');
    throw e;
  }
}

const basisOrdner = existsSync('/var/tmp') ? '/var/tmp' : tmpdir();
const T = mkdtempSync(join(basisOrdner, 'i1s0n3-'));
try {
  const klon = join(T, 'klon');
  mkdirSync(join(klon, 'scripts'), { recursive: true });
  mkdirSync(join(klon, 'client/src'), { recursive: true });
  copyFileSync(WAECHTER, join(klon, 'scripts/pruefe-groessen.mjs'));
  writeFileSync(join(klon, 'scripts/groessen-grenzen.json'), '{}\n');
  for (let i = 0; i < 6; i++) writeFileSync(join(klon, `client/src/d${i}.ts`), `export const x${i} = ${i};\n`);
  git(klon, ['init', '-q', '-b', 'main']);
  git(klon, ['add', '-A']);
  git(klon, ['commit', '-q', '-m', 'basis']);
  const hooks = join(T, 'hooks');
  mkdirSync(hooks);
  const hookAusgabe = join(T, 'hook-ausgabe.txt');
  writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\nnode scripts/pruefe-groessen.mjs > '${hookAusgabe}' 2>&1\nexit 0\n`);
  chmodSync(join(hooks, 'pre-commit'), 0o755);
  git(klon, ['config', 'core.hooksPath', hooks]);
  const baum = join(T, 'baum');
  git(klon, ['worktree', 'add', '-q', '-b', 'probe-zweig', baum, 'main']);

  /** Zustand des echten Repos (klon/.git): HEAD-Ref, alle Refs, Index, shallow. */
  const zustand = (): { refs: string; head: string; index: string; flach: boolean; baumDateien: number } => ({
    refs: git(klon, ['for-each-ref', '--format=%(refname) %(objectname)']),
    head: git(klon, ['rev-parse', 'main']).trim(),
    index: createHash('sha256').update(readFileSync(join(klon, '.git/index'))).digest('hex'),
    flach: existsSync(join(klon, '.git/shallow')),
    baumDateien: git(klon, ['ls-tree', '-r', 'main']).trim().split('\n').length,
  });
  const vorher = zustand();
  const ohneZweig = (refs: string): string => refs.split('\n').filter((z) => !z.startsWith('refs/heads/probe-zweig')).join('\n');
  const gleichBisAufZweig = (nachher: ReturnType<typeof zustand>, was: string): void => {
    pruefe(nachher.head === vorher.head, `${was}: main unverändert`, `${vorher.head} → ${nachher.head}`);
    pruefe(ohneZweig(nachher.refs) === ohneZweig(vorher.refs), `${was}: keine neuen oder geänderten Refs außer dem eigenen Zweig`, `vorher:\n${vorher.refs}\nnachher:\n${nachher.refs}`);
    pruefe(nachher.index === vorher.index, `${was}: Index des echten Repos unverändert`);
    pruefe(nachher.flach === vorher.flach && !nachher.flach, `${was}: keine shallow-Datei`);
    pruefe(nachher.baumDateien === vorher.baumDateien, `${was}: Baum von main unverändert (${nachher.baumDateien} Dateien)`);
  };

  console.log('1. Commit mit pre-commit-Hook in einem verknüpften Arbeitsbaum (GIT_DIR und GIT_INDEX_FILE gesetzt)');
  writeFileSync(join(baum, 'client/src/d0.ts'), 'export const x0 = 100;\n');
  git(baum, ['add', 'client/src/d0.ts']);
  let commitOk = true;
  try {
    git(baum, ['commit', '-q', '-m', 'probe commit']);
  } catch {
    commitOk = false;
  }
  pruefe(commitOk, 'der Commit im Arbeitsbaum gelingt (der Hook hat ihn nicht zerstört)');
  const zweigLog = git(klon, ['log', '--format=%s', 'probe-zweig']).trim().split('\n');
  pruefe(zweigLog.join('|') === 'probe commit|basis', 'der Zweig hat genau einen neuen Commit über der Basis', zweigLog.join('|'));
  pruefe(git(klon, ['ls-tree', '-r', 'probe-zweig']).trim().split('\n').length === vorher.baumDateien, 'der neue Commit enthält alle Dateien (nichts aus dem Baum gelöscht)');
  pruefe(existsSync(hookAusgabe) && /pruefe-groessen/.test(readFileSync(hookAusgabe, 'utf8')), 'der Wächter lief im Hook');
  gleichBisAufZweig(zustand(), 'nach dem Hook');
  pruefe(git(klon, ['status', '--short'], {}, true) !== undefined, 'der Hauptarbeitsbaum des Klons ist benutzbar (git status)');

  console.log('2. git rebase --exec mit dem Wächter');
  writeFileSync(join(baum, 'client/src/d1.ts'), 'export const x1 = 101;\n');
  git(baum, ['add', 'client/src/d1.ts']);
  git(baum, ['commit', '-q', '--no-verify', '-m', 'zweiter']);
  const vorRebase = zustand();
  git(baum, ['rebase', '-q', '--exec', `node scripts/pruefe-groessen.mjs > '${join(T, 'exec-ausgabe.txt')}' 2>&1; exit 0`, 'main'], {}, true);
  const nachRebase = zustand();
  pruefe(nachRebase.index === vorRebase.index && nachRebase.head === vorRebase.head, 'rebase --exec: echtes Repo unverändert (HEAD, Index)');
  pruefe(git(klon, ['ls-tree', '-r', 'probe-zweig']).trim().split('\n').length === vorher.baumDateien + 0, 'rebase --exec: der Zweig verliert keine Dateien');
  pruefe(ohneZweig(nachRebase.refs) === ohneZweig(vorher.refs), 'rebase --exec: keine neuen Refs außer dem Zweig');

  console.log('3. Wächter mit von Hand gesetztem GIT_DIR/GIT_INDEX_FILE');
  const gitDir = join(klon, '.git/worktrees/baum');
  const lauf = execFileSync(process.execPath, [join(baum, 'scripts/pruefe-groessen.mjs')], { cwd: baum, encoding: 'utf-8', env: { ...process.env, GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') }, stdio: ['ignore', 'pipe', 'pipe'] }).length;
  pruefe(lauf > 0, 'der Wächter läuft');
  const nach3 = zustand();
  gleichBisAufZweig(nach3, 'mit gesetztem GIT_DIR');
  pruefe(git(klon, ['log', '--format=%s', 'probe-zweig']).trim().split('\n')[0] === 'zweiter', 'der Zweig zeigt weiter auf seinen eigenen Commit (kein Commit „basis“ obendrauf)');
} finally {
  rmSync(T, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nHook-Probe des Größenwächters: alles grün.' : `\nHook-Probe des Größenwächters: ${fehler} FEHLGESCHLAGEN.`);
process.exit(fehler === 0 ? 0 : 1);
