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
// Attrappe fuer systemctl: das echte wird in diesem Test nie gerufen. Sie meldet FAKE_SERVER_ENV / FAKE_ADMIN_ENV als
// `Environment=...` der Units (ungesetzt: Exit 1 wie bei einer unbekannten Unit) und protokolliert jeden Aufruf.
const FAKEBIN = resolve(T, 'fakebin');
const FAKE_LOG = resolve(T, 'systemctl.log');
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
let zusatzEnv: NodeJS.ProcessEnv = {};
const skript = (...args: string[]): { rc: number; aus: string } => {
  const r = spawnSync('bash', [resolve(WURZEL, 'tools/welt-abnehmen.sh'), ...args], {
    cwd: WURZEL,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${FAKEBIN}:${process.env.PATH}`, FAKE_LOG: FAKE_LOG, WOV_WELT_VERZEICHNIS: ARBEITSORDNER, TMPDIR: T, ...zusatzEnv },
  });
  return { rc: r.status ?? -1, aus: `${r.stdout}${r.stderr}` };
};

try {
  // M3 (K5.7 N2/N3): der Runner (scripts/run-tests.mjs) reicht die Welt-Variablen und den Haken WOV_DEV_CHECKOUT einer Shell oder eines Dienstes nicht an Tests durch.
  // Dieser Test ist der Zeuge dafuer: laeuft er mit gesetzter Variable, hat sie jemand am Runner vorbei gesetzt.
  check('M3: WOV_WELT_VERZEICHNIS, WOV_ADMIN_URL und WOV_DEV_CHECKOUT sind in der Umgebung dieses Tests nicht gesetzt (der Runner entfernt sie)', process.env.WOV_WELT_VERZEICHNIS === undefined && process.env.WOV_ADMIN_URL === undefined && process.env.WOV_DEV_CHECKOUT === undefined, `WOV_WELT_VERZEICHNIS=${process.env.WOV_WELT_VERZEICHNIS} WOV_ADMIN_URL=${process.env.WOV_ADMIN_URL} WOV_DEV_CHECKOUT=${process.env.WOV_DEV_CHECKOUT}`);
  mkdirSync(FAKEBIN, { recursive: true });
  writeFileSync(
    resolve(FAKEBIN, 'systemctl'),
    '#!/bin/sh\necho "$@" >> "$FAKE_LOG"\ncase "$4" in\n  wov-server) [ -n "${FAKE_SERVER_ENV+x}" ] && { printf "Environment=%s\\n" "$FAKE_SERVER_ENV"; exit 0; } ;;\n  wov-admin) [ -n "${FAKE_ADMIN_ENV+x}" ] && { printf "Environment=%s\\n" "$FAKE_ADMIN_ENV"; exit 0; } ;;\nesac\nexit 1\n'
  );
  chmodSync(resolve(FAKEBIN, 'systemctl'), 0o755);
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
  check('ohne --commit (H2): die Basis bleibt, wie sie war (Hash des alten Repo-Stands), Arbeitskopie unberuehrt', basisLesen(ARBEIT) === layoutHash(AUSGANG) && readFileSync(ARBEIT, 'utf-8') === v1);

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
  check('--verwerfen: die verworfene Arbeitskopie liegt gesichert daneben (Datei .gesichert, nicht rotierendes .bak)', readdirSync(ARBEITSORDNER).some((n) => n.includes('.verworfen-') && n.endsWith('.gesichert')));
  check('--verwerfen: Repo bleibt sauber', git('status', '--porcelain') === '');

  // ── N4: gestagte Weltdatei, --verwerfen ohne Arbeitskopie, --status-Text ─
  const v3 = dokument('Abnahme 3', 410);
  {
    writeFileSync(ARBEIT, v3);
    skript('dev'); // schreibt die Repo-Datei, kein Commit
    git('add', '--', 'server/data/welten/dev.json'); // vorher gestaged
    const cs = commits();
    const rs = skript('dev', '--commit');
    check('N4: eine vorher gestagte Weltdatei wird trotzdem committet (Vergleich gegen HEAD, nicht gegen den Index)', rs.rc === 0 && commits() === cs + 1 && !/Nichts abzunehmen/.test(rs.aus) && readFileSync(REPO_DATEI, 'utf-8') === v3, rs.aus.slice(0, 300));

    rmSync(ARBEIT);
    rmSync(resolve(ARBEITSORDNER, 'dev.basis'), { force: true });
    const stFehlt = skript('dev', '--status');
    check('N4: --status ohne Arbeitskopie: sagt, dass nichts geschrieben wurde, und legt nichts an', stFehlt.rc === 0 && /WELT_GESCHRIEBEN=nein/.test(stFehlt.aus) && /wuerde aus dem Repo angelegt/.test(stFehlt.aus) && !existsSync(ARBEIT), stFehlt.aus.slice(0, 300));
    const vw = skript('dev', '--verwerfen');
    check('N4: --verwerfen ohne Arbeitskopie legt sie aus dem Repo an (Exit 0)', vw.rc === 0 && existsSync(ARBEIT) && readFileSync(ARBEIT, 'utf-8') === v3 && basisLesen(ARBEIT) === layoutHash(v3), vw.aus.slice(0, 300));
    const dz = skript('dev', '--diff');
    check('N4: --diff bei gleichen Dateien: Exit 0, schreibt nichts', dz.rc === 0 && git('status', '--porcelain') === '');
    writeFileSync(ARBEIT, dokument('Diffbeispiel', 12));
    const dv = skript('dev', '--diff');
    check('--diff zeigt den Unterschied zwischen Repo-Datei und Arbeitskopie, schreibt nichts', dv.rc === 0 && /Diffbeispiel/.test(dv.aus) && git('status', '--porcelain') === '' && readFileSync(ARBEIT, 'utf-8') === dokument('Diffbeispiel', 12), dv.aus.slice(0, 300));
    writeFileSync(ARBEIT, v3);
  }

  // ── H2: im DEV-Deployment wird nichts abgenommen oder committet ─────────
  {
    zusatzEnv = { WOV_DEV_CHECKOUT: WURZEL };
    const c5 = commits();
    writeFileSync(ARBEIT, dokument('Auf DEV', 66));
    const repoVor = readFileSync(REPO_DATEI, 'utf-8');
    const d1 = skript('dev', '--commit');
    check('H2: --commit im DEV-Checkout verweigert (Exit 2), kein Commit, Repo-Datei unveraendert', d1.rc === 2 && /DEV-Deployment/.test(d1.aus) && commits() === c5 && readFileSync(REPO_DATEI, 'utf-8') === repoVor && git('status', '--porcelain') === '', d1.aus.slice(0, 300));
    const d2 = skript('dev');
    check('H2: auch Abnehmen ohne --commit verweigert (es schriebe in den DEV-Baum)', d2.rc === 2 && readFileSync(REPO_DATEI, 'utf-8') === repoVor && git('status', '--porcelain') === '', d2.aus.slice(0, 200));
    const d3 = skript('dev', '--status');
    const d4 = skript('dev', '--diff');
    check('H2: --status und --diff laufen im DEV-Checkout weiter', d3.rc === 0 && /WELT_FALL=/.test(d3.aus) && d4.rc === 0 && /Auf DEV/.test(d4.aus));
    zusatzEnv = {};
    writeFileSync(ARBEIT, v3);
  }

  // ── M1: DEV-Checkout ohne WOV_WELT_VERZEICHNIS arbeitet nie still auf server/data/welten-arbeit ──────────
  {
    const leerLog = (): boolean => !existsSync(FAKE_LOG) || readFileSync(FAKE_LOG, 'utf-8') === '';
    const wegDamit = (): void => rmSync(FAKE_LOG, { force: true });
    const imWurzelOrdner = resolve(WURZEL, 'server/data/welten-arbeit');
    const arbeitVor = readFileSync(ARBEIT, 'utf-8');
    const repoVor = readFileSync(REPO_DATEI, 'utf-8');
    const dev = { WOV_DEV_CHECKOUT: WURZEL, WOV_WELT_VERZEICHNIS: undefined };

    // a) ohne Unit: alle Modi verweigern mit Exit 2 und nennen den Aufruf, der funktioniert; nichts wird angelegt oder veraendert.
    for (const modus of ['--status', '--diff', '--verwerfen', '--commit', ''] as const) {
      wegDamit();
      zusatzEnv = { ...dev };
      const r = skript(...(modus === '' ? ['dev'] : ['dev', modus]));
      const meldungOk = modus === '--commit' || modus === ''
        ? /DEV-Deployment/.test(r.aus)
        : /WOV_WELT_VERZEICHNIS=\/var\/lib\/wov\/welten tools\/welt-abnehmen\.sh dev/.test(r.aus) && /nicht gesetzt/.test(r.aus);
      check(`M1: DEV ohne Variable und ohne lesbare Unit, ${modus || 'Abnehmen'}: Exit 2 mit Meldung`, r.rc === 2 && meldungOk, r.aus.slice(0, 300));
    }
    check('M1: DEV ohne Variable: nichts angelegt (kein welten-arbeit im Checkout), Arbeitskopie und Repo-Datei unveraendert, Baum sauber',
      !existsSync(imWurzelOrdner) && readFileSync(ARBEIT, 'utf-8') === arbeitVor && readFileSync(REPO_DATEI, 'utf-8') === repoVor && git('status', '--porcelain') === '');

    // b) mit Unit: die Variable wird aus wov-server gelesen (Wert mit Leerzeichen in Anfuehrungszeichen, wie systemctl ihn zeigt) und genutzt.
    const mitUnit = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
      ...dev,
      FAKE_SERVER_ENV: `WOV_INSTANZ=dev "WOV_WELT_VERZEICHNIS=${ARBEITSORDNER}" ANDERES=x`,
      FAKE_ADMIN_ENV: `WOV_INSTANZ=dev "WOV_WELT_VERZEICHNIS=${ARBEITSORDNER}"`,
      ...extra,
    });
    wegDamit();
    zusatzEnv = mitUnit();
    writeFileSync(ARBEIT, dokument('Aus der Unit', 91));
    const u1 = skript('dev', '--status');
    check('M1: DEV, Variable aus der Unit gelesen: --status Exit 0 auf der Datei des Dienstes (WELT_FALL, Hinweis "aus der Unit")', u1.rc === 0 && /WELT_FALL=/.test(u1.aus) && /aus der Unit wov-server gelesen/.test(u1.aus) && !existsSync(imWurzelOrdner), u1.aus.slice(0, 300));
    check('M1: der Unit-Aufruf war genau `show -p Environment <unit>`, fuer wov-server UND wov-admin', /^show -p Environment wov-server$/m.test(readFileSync(FAKE_LOG, 'utf-8')) && /^show -p Environment wov-admin$/m.test(readFileSync(FAKE_LOG, 'utf-8')), readFileSync(FAKE_LOG, 'utf-8'));
    const u2 = skript('dev', '--diff');
    check('M1: DEV, --diff zeigt die Datei des Dienstes (nicht welten-arbeit)', u2.rc === 0 && /Aus der Unit/.test(u2.aus) && !existsSync(imWurzelOrdner), u2.aus.slice(0, 300));
    const gesichertVor = readdirSync(ARBEITSORDNER).filter((n) => n.includes('.verworfen-')).length;
    const u3 = skript('dev', '--verwerfen');
    check('M1: DEV, --verwerfen wirkt auf der Datei des Dienstes: Arbeitskopie = Repo-Datei, gesichert, kein welten-arbeit', u3.rc === 0 && readFileSync(ARBEIT, 'utf-8') === repoVor && readdirSync(ARBEITSORDNER).filter((n) => n.includes('.verworfen-')).length === gesichertVor + 1 && !existsSync(imWurzelOrdner), u3.aus.slice(0, 300));

    // c) die Units widersprechen sich, oder der Wert ist relativ: Verweigerung.
    zusatzEnv = mitUnit({ FAKE_ADMIN_ENV: 'WOV_WELT_VERZEICHNIS=/tmp/anderswo' });
    const w1 = skript('dev', '--status');
    check('M1: wov-server und wov-admin widersprechen sich: Exit 2, nennt beide Werte', w1.rc === 2 && /widersprechen sich/.test(w1.aus) && w1.aus.includes('/tmp/anderswo'), w1.aus.slice(0, 300));
    // N-C (K5.7 N3): hat wov-admin die Variable NICHT (Mischzustand), bricht das Werkzeug ab; ebenso, wenn die Unit nicht lesbar ist.
    const ohneVar = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => mitUnit(extra);
    zusatzEnv = ohneVar({ FAKE_ADMIN_ENV: 'WOV_INSTANZ=dev' });
    const n1 = skript('dev', '--status');
    check('N-C: wov-admin ohne die Variable: Exit 2 mit Meldung (wov-admin), nichts gelesen oder angelegt', n1.rc === 2 && /wov-admin/.test(n1.aus) && /nicht zu lesen/.test(n1.aus) && !/aus der Unit wov-server gelesen/.test(n1.aus) && !existsSync(imWurzelOrdner), n1.aus.slice(0, 300));
    zusatzEnv = ohneVar({ FAKE_ADMIN_ENV: undefined });
    const n2 = skript('dev', '--verwerfen');
    check('N-C: wov-admin nicht lesbar (systemctl Exit 1): --verwerfen Exit 2, Arbeitskopie unveraendert', n2.rc === 2 && /wov-admin/.test(n2.aus) && readFileSync(ARBEIT, 'utf-8') === repoVor, n2.aus.slice(0, 300));
    // INFO: systemd schreibt einen Tab als \t; der Dienst trimmt ihn. Bei doppeltem Schluessel gilt der letzte Eintrag.
    const tabEnv = `"WOV_WELT_VERZEICHNIS=${ARBEITSORDNER}\\t"`;
    zusatzEnv = ohneVar({ FAKE_SERVER_ENV: tabEnv, FAKE_ADMIN_ENV: tabEnv });
    const t1 = skript('dev', '--status');
    check('INFO: \\t am Ende des Werts wird wie systemd gelesen (Tab, getrimmt): Pfad = Datei des Dienstes, kein "t" angehaengt', t1.rc === 0 && t1.aus.includes(`aus der Unit wov-server gelesen: ${ARBEITSORDNER}\n`), t1.aus.slice(0, 300));
    const doppelt = `WOV_WELT_VERZEICHNIS=/tmp/falsch WOV_WELT_VERZEICHNIS=${ARBEITSORDNER}`;
    zusatzEnv = ohneVar({ FAKE_SERVER_ENV: doppelt, FAKE_ADMIN_ENV: doppelt });
    const t2 = skript('dev', '--status');
    check('INFO: doppelter Schluessel: der letzte Eintrag gilt (wie bei systemd)', t2.rc === 0 && t2.aus.includes(`aus der Unit wov-server gelesen: ${ARBEITSORDNER}\n`), t2.aus.slice(0, 300));
    zusatzEnv = mitUnit({ FAKE_SERVER_ENV: 'WOV_WELT_VERZEICHNIS=relwelt', FAKE_ADMIN_ENV: 'WOV_WELT_VERZEICHNIS=relwelt' });
    const w2 = skript('dev', '--status');
    check('M1: relativer Wert in der Unit: Exit 2 (kein absoluter Pfad)', w2.rc === 2 && /kein absoluter Pfad/.test(w2.aus) && !existsSync(resolve(WURZEL, 'relwelt')), w2.aus.slice(0, 300));

    // d) gesetzte Variable gewinnt, systemctl wird nicht gefragt; ausserhalb von DEV wird systemctl nie gefragt.
    wegDamit();
    zusatzEnv = { WOV_DEV_CHECKOUT: WURZEL };
    const g1 = skript('dev', '--status');
    check('M1: DEV mit gesetzter Variable: Exit 0, systemctl nicht gerufen', g1.rc === 0 && leerLog(), g1.aus.slice(0, 200));
    zusatzEnv = { WOV_DEV_CHECKOUT: resolve(T, 'nicht-dev'), WOV_WELT_VERZEICHNIS: undefined };
    const g2 = skript('dev', '--status');
    check('M1: eigener Worktree (nicht DEV) ohne Variable: laeuft auf welten-arbeit, systemctl nicht gerufen', g2.rc === 0 && /WELT_FALL=angelegt/.test(g2.aus) && leerLog() && !existsSync(imWurzelOrdner), g2.aus.slice(0, 300));
    zusatzEnv = {};
    writeFileSync(ARBEIT, v3);
  }

  // ── N2: relatives WOV_WELT_VERZEICHNIS wird abgelehnt ────────────────────
  {
    zusatzEnv = { WOV_WELT_VERZEICHNIS: 'relwelt' };
    const rr = skript('dev', '--status');
    check('N2: relatives WOV_WELT_VERZEICHNIS: Exit 2 mit Meldung, nichts angelegt', rr.rc === 2 && /kein absoluter Pfad/.test(rr.aus) && !existsSync(resolve(WURZEL, 'relwelt')), rr.aus.slice(0, 300));
    zusatzEnv = {};
  }

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
