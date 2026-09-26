/**
 * tools/welt-abnehmen.sh (editor stage E2, card K5.7): accept or discard the world working copy.
 * Ohne --commit 0 Commits (nur der Diff), mit --commit genau 1 Commit nur der Weltdatei; --verwerfen legt
 * die Arbeitskopie neu aus dem Repo an. Die Repo-Datei ist danach byte-gleich zum sanitisierten Text
 * (derselbe Schreibweg wie im Betriebsdienst).
 *
 *   npx tsx tools/test/welt-abnehmen.ts      (from any directory)
 *
 * Laeuft in einem Temp-Git-Repo mit Kopien von tools/welt-abnehmen.sh und tools/welt-abnehmen.ts; das
 * Weltverzeichnis liegt in einem Temp-Ordner (WOV_WELT_VERZEICHNIS), nie in /var/lib/wov.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutHash, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { basisLesen, weltAbgleichen } from '@wov/shared/src/worldlayout/weltArbeitskopie.js';

const QUELLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const T = mkdtempSync(resolve(tmpdir(), 'wov-welt-abnehmen-'));
const WURZEL = resolve(T, 'repo');
const ARBEITSORDNER = resolve(T, 'arbeit');
const ARBEIT = resolve(ARBEITSORDNER, 'dev.json');
const REPO_DATEI = resolve(WURZEL, 'server/data/welten/dev.json');
const vorVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;

function dokument(name: string, radius: number): string {
  return layoutText(
    sanitizeWorldLayout({
      version: 1,
      name,
      detailSeed: 'ab',
      continents: [],
      regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
      lakes: [{ id: 'lk-00', x: 0, z: 0, radius }],
    })!
  );
}
const git = (...args: string[]): string => {
  const r = spawnSync('git', args, { cwd: WURZEL, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const commits = (): number => Number(git('rev-list', '--count', 'HEAD').trim());
const skript = (...args: string[]): { rc: number; aus: string } => {
  const r = spawnSync('bash', [resolve(WURZEL, 'tools/welt-abnehmen.sh'), ...args], {
    cwd: WURZEL,
    encoding: 'utf-8',
    env: { ...process.env, WOV_WELT_VERZEICHNIS: ARBEITSORDNER, TMPDIR: T },
  });
  return { rc: r.status ?? -1, aus: `${r.stdout}${r.stderr}` };
};

try {
  mkdirSync(resolve(WURZEL, 'tools'), { recursive: true });
  mkdirSync(resolve(WURZEL, 'server/data/welten'), { recursive: true });
  for (const f of ['welt-abnehmen.sh', 'welt-abnehmen.ts']) copyFileSync(resolve(QUELLE, 'tools', f), resolve(WURZEL, 'tools', f));
  chmodSync(resolve(WURZEL, 'tools/welt-abnehmen.sh'), 0o755);
  symlinkSync(resolve(QUELLE, 'node_modules'), resolve(WURZEL, 'node_modules'));
  writeFileSync(resolve(WURZEL, 'package.json'), '{ "type": "module" }\n');
  const AUSGANG = dokument('Ausgang', 100);
  writeFileSync(REPO_DATEI, AUSGANG);
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '-A');
  git('commit', '-q', '-m', 'Ausgang');
  weltAbgleichen({ repoDatei: REPO_DATEI, arbeitsDatei: ARBEIT });
  const c0 = commits();

  // ── --status: schreibt nichts ─────────────────────────────────────────
  const st = skript('dev', '--status');
  check('--status: Exit 0, Fall unveraendert, kein Commit, Baum sauber', st.rc === 0 && /WELT_FALL=unveraendert/.test(st.aus) && commits() === c0 && git('status', '--porcelain') === '', st.aus.slice(0, 200));
  writeFileSync(ARBEIT, dokument('Arbeit', 55));
  writeFileSync(REPO_DATEI, dokument('Repo neu', 66));
  const konflikt = skript('dev', '--status');
  check('--status bei beiden geaendert: WELT_FALL=konflikt und die Warnung, nichts ueberschrieben', konflikt.rc === 0 && /WELT_FALL=konflikt/.test(konflikt.aus) && /Weltkonflikt: Repo und Arbeitskopie beide geaendert/.test(konflikt.aus) && readFileSync(ARBEIT, 'utf-8') === dokument('Arbeit', 55));
  git('checkout', '--', 'server/data/welten/dev.json');
  writeFileSync(ARBEIT, AUSGANG);

  // ── ohne --commit: Diff, 0 Commits ─────────────────────────────────────
  const v1 = dokument('Abnahme 1', 200);
  writeFileSync(ARBEIT, v1);
  const r1 = skript('dev');
  check('ohne --commit: Exit 0', r1.rc === 0, r1.aus.slice(0, 300));
  check('ohne --commit: 0 neue Commits', commits() === c0, `${c0} -> ${commits()}`);
  check('ohne --commit: die Repo-Datei liegt geaendert im Arbeitsbaum, bytegleich zur Arbeitskopie', readFileSync(REPO_DATEI, 'utf-8') === v1 && git('status', '--porcelain').trim() === 'M server/data/welten/dev.json', git('status', '--porcelain'));
  check('ohne --commit: der Diff wird gezeigt', /Abnahme 1/.test(r1.aus) && /Kein Commit/.test(r1.aus), r1.aus.slice(0, 300));
  check('ohne --commit: Basis = Hash der Repo-Datei', basisLesen(ARBEIT) === layoutHash(v1));

  // ── mit --commit: genau 1 Commit ───────────────────────────────────────
  const v2 = dokument('Abnahme 2', 300);
  writeFileSync(ARBEIT, v2);
  const c1 = commits();
  const r2 = skript('dev', '--commit');
  check('mit --commit: Exit 0', r2.rc === 0, r2.aus.slice(0, 300));
  check('mit --commit: genau 1 neuer Commit', commits() === c1 + 1, `${c1} -> ${commits()}`);
  check('mit --commit: der Commit enthaelt nur die Weltdatei', git('show', '--name-only', '--format=', 'HEAD').trim() === 'server/data/welten/dev.json');
  check('mit --commit: Commit-Betreff zweisprachig', / \/ /.test(git('log', '-1', '--format=%s').trim()) && /Welt dev/.test(git('log', '-1', '--format=%s')));
  check('mit --commit: Baum sauber, Repo-Datei = Arbeitskopie', git('status', '--porcelain') === '' && readFileSync(REPO_DATEI, 'utf-8') === v2 && readFileSync(ARBEIT, 'utf-8') === v2);
  check('mit --commit: kein Konflikt beim naechsten Abgleich', weltAbgleichen({ repoDatei: REPO_DATEI, arbeitsDatei: ARBEIT, modus: 'pruefen' }).fall === 'unveraendert');

  // ── nichts zu tun ──────────────────────────────────────────────────────
  const c2 = commits();
  const r3 = skript('dev', '--commit');
  check('erneut --commit ohne Aenderung: Exit 0, kein Commit, "Nichts abzunehmen"', r3.rc === 0 && commits() === c2 && /Nichts abzunehmen/.test(r3.aus), r3.aus.slice(0, 300));

  // ── --verwerfen ────────────────────────────────────────────────────────
  writeFileSync(ARBEIT, dokument('Wegwerfen', 7));
  const c3 = commits();
  const r4 = skript('dev', '--verwerfen');
  check('--verwerfen: Exit 0, Arbeitskopie = Repo-Datei, kein Commit', r4.rc === 0 && readFileSync(ARBEIT, 'utf-8') === v2 && commits() === c3, r4.aus.slice(0, 300));
  check('--verwerfen: die verworfene Arbeitskopie liegt gesichert daneben', readdirSync(ARBEITSORDNER).some((n) => n.endsWith('.bak')));
  check('--verwerfen: Repo bleibt sauber', git('status', '--porcelain') === '');

  // ── falsche Aufrufe ────────────────────────────────────────────────────
  check('ohne Instanz: Exit 2', skript().rc === 2);
  check('unbekannte Instanz: Exit 2', skript('bau').rc === 2);
  check('unbekannte Option: Exit 2', skript('dev', '--alles').rc === 2);
  const c4 = commits();
  const r5 = skript('live', '--commit');
  check('Instanz ohne Arbeitskopie: Fehler, kein Commit', r5.rc !== 0 && commits() === c4, r5.aus.slice(0, 200));

  const nachVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;
  check('/var/lib/wov unveraendert', vorVarLibWov === nachVarLibWov);
} finally {
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nwelt-abnehmen: alles gruen');
