/**
 * Das Vorschau-Buendel ist ein Bauerzeugnis und gehoert NICHT ins Repo.
 *
 * ── Der Anlass (23.09.2026) ──────────────────────────────────────────
 * `wov-web/static/assets/js/vorschau.js` war getrackt, und
 * `tools/wov-update.sh` Schritt 7 baut sie neu. Der Bau ist deterministisch
 * (zweimal byte-gleich), aber esbuild vergibt die gekuerzten Namen nach dem
 * Quellstand: sobald sich irgendeine Quelle unter tools/web, shared/ oder
 * client/ geaendert hat und niemand die Datei mitcommittet hat, unterscheidet
 * sich der Bau vom Repo-Stand. Folge: `git status --porcelain` schmutzig,
 * der NAECHSTE wov-update.sh bricht in der Sauberkeitspruefung ab. Zweimal
 * passiert (nach #59 und #60), zweimal von Hand zurueckgesetzt.
 *
 * Dauerhaft geloest ist das nur, wenn die Datei nicht getrackt ist: ein
 * Test „Stand passt zur Quelle“ wuerde bei jeder Aenderung an geteilten
 * Quellen rot, und ein Ausrollen ohne Neu-Commit bliebe schmutzig.
 *
 * Geprueft wird, dass die Teile der Loesung zusammenhalten:
 *   1. die Datei ist in .gitignore (und, wo ein .git da ist, nicht getrackt),
 *   2. wov-update.sh erzeugt genau diesen Pfad,
 *   3. wov-update.sh meldet nach dem Webseitenbau einen schmutzigen Baum,
 *      ohne abzubrechen (der Block wird in einem Wegwerf-Repo ausgefuehrt),
 *   4. nach einem Abbruch im Webseitenbau (leeres oder fehlendes Buendel,
 *      Fehler im Buendeln) starten die Dienste wieder, waehrend ein Abbruch
 *      vor dem Webseitenbau sie bewusst gestoppt laesst (Fake-systemctl
 *      zaehlt stop und start),
 *   5. Signale (INT, TERM, HUP), ein scheiternder Start und der Neustart-Zweig
 *      (Gesundheitspruefung ja, VERSION nein, Rueckweg in der Meldung) werden
 *      am selben Ausschnitt geprueft; der Bereich von der Testzeile bis
 *      gesundheit_pruefen laeuft mit Fake-Befehlen am Verhalten (Tests rot =
 *      0 Starts, Webbau rot = Neustart, gruen = ein Start nach dem Webbau).
 *
 * Lauf:  npx tsx tools/test/vorschau-nicht-getrackt.ts
 *
 * The preview bundle is a build product: it must be git-ignored, must be the
 * path wov-update.sh builds, and the script must warn about a dirty tree
 * after the web build.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUENDEL = 'wov-web/static/assets/js/vorschau.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Feste Marker: genau ein BEGIN und genau ein END, in dieser Reihenfolge, sonst null. */
function ausschnitt(quelle: string, name: string): string | null {
  const b = `# BEGIN ${name}`;
  const e = `# END ${name}`;
  if (quelle.split(b).length !== 2 || quelle.split(e).length !== 2) return null;
  const beginn = quelle.indexOf(b);
  const ende = quelle.indexOf(e);
  return ende > beginn ? quelle.slice(beginn, ende) : null;
}

/** Environment without GIT_* (a git hook would otherwise redirect the scratch repo into the caller's). */
const SAUBERE_UMGEBUNG: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
);

// ── Der Kaefig ───────────────────────────────────────────────────────
// Since N6 this test EXECUTES code cut out of wov-update.sh, in every `npm test`
// (as root on wov-dev, also while a rollout runs). Text rules for that code lost
// every round against a new disguise (N7: real nginx, curl, rm and systemctl were
// reached and the test stayed green). So the safety is not text: everything that
// executes runs in a cage, and the text rules below are only an early, readable
// hint. tools/test/kaefig.sh builds the cage: own PID/net/IPC/UTS/mount namespaces,
// the whole file system read-only (recursive), fresh tmpfs for /tmp and /run,
// no CAP_SYS_ADMIN. Nothing that breaks out of the text rules can signal a host
// process, reach the network, find a service manager socket or write outside /tmp.
// No cage available: the executing parts do NOT run without one. CI (env CI) may
// skip them loudly; anywhere else that is red.
const IM_KAEFIG = process.env.WOV_KAEFIG === '1';

/** unshare command line; root uses unshare directly, everyone else the user namespace (-r). */
function kaefigBefehl(befehl: string[]): [string, string[]] {
  const ns = ['--pid', '--fork', '--kill-child', '--net', '--ipc', '--uts', '--mount', '--propagation', 'private'];
  const rolle = process.getuid?.() === 0 ? [] : ['-r'];
  return ['unshare', [...rolle, ...ns, '--', 'bash', join(WURZEL, 'tools/test/kaefig.sh'), WURZEL, ...befehl]];
}

let ausfuehren = IM_KAEFIG;
if (!IM_KAEFIG) {
  const [prog, args] = kaefigBefehl(['true']);
  const probe = spawnSync(prog, args, { encoding: 'utf8' });
  if (probe.status === 0) {
    // Run this very file again, inside the cage; it prints everything and its exit code is ours.
    const [p2, a2] = kaefigBefehl([process.execPath, ...process.execArgv, fileURLToPath(import.meta.url)]);
    const umgebung = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TSX_')));
    const lauf = spawnSync(p2, a2, { stdio: 'inherit', env: { ...umgebung, WOV_KAEFIG: '1', TMPDIR: '/tmp' } });
    process.exit(lauf.status ?? 1);
  }
  const grund = `${probe.stderr ?? ''}`.trim().split('\n')[0] ?? '';
  console.error(`  Probe übersprungen: kein Namensraum verfügbar (${grund || `rc=${probe.status}`}). Nur die Textprüfungen laufen, der Skriptcode nicht.`);
  if (process.env.CI === undefined || process.env.CI === '') {
    pruefe(false, 'Kaefig verfuegbar (ausserhalb von CI ist ein fehlender Namensraum rot)', grund);
  }
} else {
  // A forged WOV_KAEFIG=1 without the cage must not pass: measure the cage itself.
  const schreibversuch = (pfad: string): string => {
    try {
      writeFileSync(pfad, 'x');
      unlinkSync(pfad);
      return 'geschrieben';
    } catch (e) {
      return (e as NodeJS.ErrnoException).code ?? 'fehler';
    }
  };
  pruefe(schreibversuch(join(WURZEL, '.kaefig-probe')) === 'EROFS', 'Kaefig: das Repo ist schreibgeschuetzt (EROFS)');
  pruefe(schreibversuch('/var/tmp/.kaefig-probe') === 'EROFS', 'Kaefig: /var/tmp ist schreibgeschuetzt (EROFS)');
  pruefe(schreibversuch('/tmp/.kaefig-probe') === 'geschrieben', 'Kaefig: /tmp ist schreibbar');
  pruefe(readdirSync('/run').length === 0, 'Kaefig: /run ist leer (kein systemd-Socket, keine pid-Datei)');
  const netz = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2).map((z) => z.split(':')[0].trim()).filter((n) => n !== '');
  pruefe(netz.every((n) => n === 'lo'), 'Kaefig: kein Netz ausser lo', netz.join(','));
  pruefe(readdirSync('/proc').filter((n) => /^\d+$/.test(n)).length < 40, 'Kaefig: eigener PID-Namensraum (wenige Prozesse sichtbar)');
  // Only a measured cage executes anything.
  ausfuehren = fehler === 0;
}

const gitignore = readFileSync(join(WURZEL, '.gitignore'), 'utf8').split('\n').map((z) => z.trim());
pruefe(gitignore.includes(BUENDEL), `.gitignore fuehrt ${BUENDEL}`);

if (existsSync(join(WURZEL, '.git'))) {
  const r = spawnSync('git', ['ls-files', '--', BUENDEL], { cwd: WURZEL, encoding: 'utf8' });
  pruefe(r.status === 0 && r.stdout.trim() === '', `${BUENDEL} ist nicht getrackt`, r.stdout.trim());
}

const update = readFileSync(join(WURZEL, 'tools/wov-update.sh'), 'utf8');
const bau = update.indexOf(`node tools/vorschau-buendeln.mjs --aus ${BUENDEL}`);
pruefe(bau >= 0, `wov-update.sh baut ${BUENDEL}`);
const webbau = update.indexOf('npm run build && bash tools/ohne-js-pruefen.sh', Math.max(bau, 0));
const warnung = update.indexOf('WARNUNG: Der Webseitenbau', Math.max(webbau, 0));
pruefe(webbau > bau && warnung > webbau, 'wov-update.sh warnt nach dem Webseitenbau vor einem schmutzigen Baum');
const statusNachBau = update.indexOf('status --porcelain', Math.max(webbau, 0));
pruefe(statusNachBau > webbau && statusNachBau < warnung, 'die Warnung stuetzt sich auf git status --porcelain (quotePath=false)');
// Behavior, not text: cut the real block out of the script (between its
// markers) and run it under the script's own `set -euo pipefail` in a scratch
// repo. 6e837b0 had a broken printf line that only failed with a dirty tree,
// and a text check for "exit" did not see it.
const block = ausschnitt(update, 'webbau-warnung');
pruefe(block !== null, 'wov-update.sh markiert den Warnblock genau einmal (BEGIN/END webbau-warnung)');
if (ausfuehren && block !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-warnblock-'));
  try {
    const git = (...a: string[]) => {
      const r = spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a],
        { cwd: temp, encoding: 'utf8', env: SAUBERE_UMGEBUNG },
      );
      pruefe(r.status === 0, `Vorbereitung git ${a[0]}`, r.stderr);
      return r;
    };
    git('init', '-q');
    writeFileSync(join(temp, 'erzeugt.json'), '{}\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'x');
    const lauf = () =>
      spawnSync('bash', ['-c', `set -euo pipefail\n${block}\necho MARKER_WEITER`], {
        cwd: temp,
        encoding: 'utf8',
        env: SAUBERE_UMGEBUNG,
      });

    const sauber = lauf();
    pruefe(sauber.status === 0 && sauber.stdout.includes('MARKER_WEITER'), 'sauberer Baum: rc=0, Code laeuft weiter', `rc=${sauber.status} ${sauber.stderr}`);
    pruefe(!sauber.stderr.includes('WARNUNG'), 'sauberer Baum: keine Warnung', sauber.stderr);

    writeFileSync(join(temp, 'erzeugt.json'), '{"neu":1}\n');
    writeFileSync(join(temp, 'ä-umlaut.json'), '{}\n');
    const schmutzig = lauf();
    pruefe(schmutzig.status === 0, 'schmutziger Baum unter set -euo pipefail: rc=0', `rc=${schmutzig.status} ${schmutzig.stderr}`);
    pruefe(schmutzig.stderr.includes('WARNUNG') && schmutzig.stderr.includes('erzeugt.json'), 'schmutziger Baum: Warnung nennt die Datei', schmutzig.stderr);
    pruefe(schmutzig.stderr.includes('ä-umlaut.json'), 'schmutziger Baum: Umlaut-Dateiname lesbar (core.quotePath=false)', schmutzig.stderr);
    pruefe(schmutzig.stdout.includes('MARKER_WEITER'), 'schmutziger Baum: Code laeuft danach weiter', schmutzig.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ── Abbruch nach dem Stoppen der Dienste: Fake-systemctl zaehlt stop/start ──
// Behavior, not text: the real blocks (aufraeumen + trap, dienste_stoppen/
// _starten, the bundle check) are cut out of the script and run in bash with
// a systemctl function that logs its verb. Before this the empty-bundle abort
// left DEV stopped (4x stop, 0x start).
const aufraeumen = ausschnitt(update, 'abbruch-aufraeumen');
const reigen = ausschnitt(update, 'dienste-reigen');
const buendelBlock = ausschnitt(update, 'buendel-pruefung');
pruefe(aufraeumen !== null, 'wov-update.sh markiert abbruch-aufraeumen genau einmal');
pruefe(reigen !== null, 'wov-update.sh markiert dienste-reigen genau einmal');
pruefe(buendelBlock !== null, 'wov-update.sh markiert buendel-pruefung genau einmal');

// ── Schritt 7 bis 8 am Verhalten, nicht am Text ──
// Every text rule for the command sequence lost the race against a new
// disguise (`if false`, a trailing `||`, `printf -v`, `export dienste_starten`
// ...). So the real range from the tests line to `gesundheit_pruefen` is cut
// out of the script and run with fake commands; the log says what happened.
// Behavior required: red tests never restart the services, a red web build
// does (via aufraeumen), a green run starts them exactly once after the web
// build and clears the flag before the health check.
const testZeilen = update.split('\n').filter((z) => /^node scripts\/run-tests\.mjs 2>&1 \| tee /.test(z));
// A trailing comment is harmless: cut it before comparing.
const schritt8 = update.split('\n').filter((z) => z.replace(/^(\s*[^#\s].*?)\s+#.*$/, '$1') === 'dienste_starten');
pruefe(testZeilen.length === 1, 'genau ein Aufruf "node scripts/run-tests.mjs" als Zeile', `${testZeilen.length}`);
pruefe(schritt8.length === 1, 'genau ein Schritt 8 (dienste_starten als eigene Zeile)', `${schritt8.length}`);

/** Real range: from `echo "▶ Tests"` up to (excluding) the health check call. */
function rolloutKern(quelle: string): string | null {
  const zl = quelle.split('\n');
  const a = zl.indexOf('echo "▶ Tests"');
  let z = -1;
  for (let i = Math.max(a, 0); i < zl.length && z < 0; i++) if (/^gesundheit_pruefen(\s+#.*)?$/.test(zl[i])) z = i;
  return a >= 0 && z > a ? zl.slice(a, z).join('\n') : null;
}
const kern = rolloutKern(update);
pruefe(kern !== null, 'wov-update.sh: Bereich von echo "▶ Tests" bis gesundheit_pruefen gefunden');

// The probe below executes this range, inside the cage (see above): what it
// finds there cannot reach the host. This text rule is only the early, readable
// hint and no longer the safeguard: any direct call of the service manager (also
// by absolute path, `command -p` or `service`) turns the test red BEFORE anything
// runs. The range needs no systemctl at all: the services are started by
// dienste_starten and aufraeumen.
/**
 * A line as code: comment lines and trailing comments are cut, and so is the text
 * of a plain `echo`/`printf` message (quoted, without `$(` or a backtick), because
 * a message may name the way back by hand ("systemctl start wov.target").
 */
function ohneText(z: string): string {
  if (/^\s*#/.test(z)) return '';
  const ohneMeldung = z.replace(/^(\s*(?:echo|printf)\s+(?:-[a-zA-Z]+\s+)?)("(?:[^"\\`$]|\$(?!\()|\\.)*"|'[^']*')/, '$1""');
  return ohneMeldung.replace(/\s+#.*$/, '');
}
const verbotTreffer =
  kern === null
    ? []
    : kern
        .split('\n')
        .filter((z) => {
          const c = ohneText(z);
          return /systemctl/.test(c) || /(^|[;&|(])\s*service\s/.test(c) || /command\s+-p/.test(c) || /(^|[\s;&|(=])\/(usr\/)?(local\/)?s?bin\//.test(c);
        });
pruefe(verbotTreffer.length === 0, 'Bereich Tests bis Gesundheitspruefung: kein systemctl, service, command -p, absoluter Systempfad', verbotTreffer.join(' | '));

// The flag is set exactly once before the web build and cleared exactly once after step 8;
// outside the cleanup block no other line may name it (a set one line too early would survive red tests).
const ohneAufraeumen = aufraeumen === null ? update : update.replace(aufraeumen, '');
const flagZeilen = ohneAufraeumen.split('\n').map(ohneText).filter((z) => z.includes('NEUSTART_BEI_ABBRUCH'));
const flagImKern = kern === null ? [] : kern.split('\n').map(ohneText).filter((z) => z.includes('NEUSTART_BEI_ABBRUCH'));
const nurFlag = (z: string) => z.trim().replace(/^export\s+/, '').replace(/\s*;$/, '');
pruefe(
  flagZeilen.length === 2 && flagImKern.length === 2 && nurFlag(flagImKern[0] ?? '') === 'NEUSTART_BEI_ABBRUCH=1' && nurFlag(flagImKern[1] ?? '') === 'NEUSTART_BEI_ABBRUCH=0',
  'NEUSTART_BEI_ABBRUCH steht ausserhalb des Aufraeumblocks in genau 2 Zeilen (Setzen vor dem Webbau, Ruecksetzen nach Schritt 8), beide im Bereich',
  `${flagZeilen.length} Zeilen, ${flagImKern.length} im Bereich: ${flagZeilen.join(' | ')}`,
);

// Inside the cleanup block the name may appear in exactly three ways: the one line
// `NEUSTART_BEI_ABBRUCH=0`, read as "$NEUSTART_BEI_ABBRUCH", and in comments. A helper
// there that sets it (`webbau_frei() { NEUSTART_BEI_ABBRUCH=1; }`, called one line too
// early) would restart the services after red tests.
if (aufraeumen !== null) {
  const imBlock = aufraeumen.split('\n').map(ohneText).filter((z) => z.includes('NEUSTART_BEI_ABBRUCH'));
  const nurLesen = (z: string) => !z.replace(/"\$\{?NEUSTART_BEI_ABBRUCH\}?"/g, '').includes('NEUSTART_BEI_ABBRUCH');
  const rueck = imBlock.filter((z) => z.trim() === 'NEUSTART_BEI_ABBRUCH=0');
  const fremd = imBlock.filter((z) => z.trim() !== 'NEUSTART_BEI_ABBRUCH=0' && !nurLesen(z));
  pruefe(rueck.length === 1 && fremd.length === 0, 'Aufraeumblock: NEUSTART_BEI_ABBRUCH nur als Zeile "=0", lesend als "$NEUSTART_BEI_ABBRUCH" und in Kommentaren', `=0: ${rueck.length}, andere: ${fremd.join(' | ')}`);
}

// The real dist_tauschen and dist_sichern of the script run in the live probe (not stubs
// that ignore their arguments): swapped or wrong arguments must show in the files.
const zeilenUpdate = update.split('\n');
function distFunktionen(): string | null {
  const a = zeilenUpdate.indexOf('dist_tauschen() {');
  const s = zeilenUpdate.indexOf('dist_sichern() {');
  if (a < 0 || s < a) return null;
  let e = s;
  while (e < zeilenUpdate.length && zeilenUpdate[e] !== '}') e++;
  return e < zeilenUpdate.length ? zeilenUpdate.slice(a, e + 1).join('\n') : null;
}
const distFn = distFunktionen();
pruefe(distFn !== null, 'wov-update.sh: dist_tauschen und dist_sichern als Funktionen gefunden');

if (ausfuehren && kern !== null && aufraeumen !== null && distFn !== null && verbotTreffer.length === 0) {
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-kern-'));
  try {
    const bin = join(temp, 'bin');
    const werkzeug = join(temp, 'werkzeug');
    mkdirSync(bin, { recursive: true });
    mkdirSync(werkzeug, { recursive: true });
    // The probe's PATH is ONLY the fake directory plus symlinks to the tools the range
    // really needs; the caller's PATH is not passed on. Everything else (curl, service,
    // nginx, ssh ...) is "command not found" and turns the run red.
    const gebraucht = ['bash', 'mktemp', 'tee', 'cat', 'grep', 'sed', 'rm', 'mkdir', 'mv', 'cp', 'find', 'wc', 'date', 'sleep', 'tail', 'head', 'cut', 'tr', 'dirname', 'basename', 'tar', 'gzip', 'du', 'ls'];
    const suchpfade = ['/usr/bin', '/bin', '/usr/local/bin'];
    for (const w of gebraucht) {
      const ort = suchpfade.map((d) => join(d, w)).find((p) => existsSync(p));
      pruefe(ort !== undefined, `Werkzeug fuer die Probe vorhanden: ${w}`);
      if (ort !== undefined) symlinkSync(ort, join(werkzeug, w));
    }
    const bash = join(werkzeug, 'bash');
    // Every fake counts its calls in $LOG; node/npm/tsx take their exit code from the environment.
    const fake = (pfad: string, inhalt: string) => {
      writeFileSync(pfad, `#!${bash}\n${inhalt}\n`);
      chmodSync(pfad, 0o755);
    };
    fake(join(bin, 'node'), 'echo "node $1" >> "$LOG"\n[ "$1" = scripts/run-tests.mjs ] && exit "${TESTRC:-0}"\n[ "$1" = tools/vorschau-buendeln.mjs ] && exit "${BUENDELRC:-0}"\nexit 0');
    fake(join(bin, 'npm'), 'echo "npm $*" >> "$LOG"\n[ "$1" = run ] && exit "${NPMRC:-0}"\nexit 0');
    fake(join(bin, 'git'), 'echo abc1234');
    fake(join(bin, 'systemctl'), 'echo "systemctl $*" >> "$LOG"');
    const kernLauf = (name: string, env: Record<string, string>, instanz = 'dev') => {
      const cwd = join(temp, name);
      for (const d of ['node_modules/.bin', 'wov-web/static/assets/js', 'wov-web/tools', 'client/dist', 'sicherung']) mkdirSync(join(cwd, d), { recursive: true });
      writeFileSync(join(cwd, 'wov-web/static/assets/js/vorschau.js'), 'x\n');
      writeFileSync(join(cwd, 'client/dist/index.html'), 'ALT\n');
      writeFileSync(join(cwd, 'wov-web/tools/ohne-js-pruefen.sh'), 'exit 0\n');
      fake(join(cwd, 'node_modules/.bin/tsx'), 'echo "tsx" >> "$LOG"');
      // Fake vite writes a marker into --outDir (also when it fails: a half build), like the real one.
      fake(join(cwd, 'node_modules/.bin/vite'), 'echo "vite" >> "$LOG"\no=""; while [ $# -gt 0 ]; do [ "$1" = --outDir ] && o="$2"; shift; done\n[ -n "$o" ] && mkdir -p "$o" && echo NEU > "$o/index.html"\nexit "${VITERC:-0}"');
      const log = join(cwd, 'log');
      writeFileSync(log, '');
      const skript = [
        'set -euo pipefail',
        `INSTANZ=${instanz}`,
        `WURZEL=${JSON.stringify(cwd)}`,
        `VERSION_DATEI=${JSON.stringify(join(cwd, 'VERSION'))}`,
        `SICHERUNG_VERZEICHNIS=${JSON.stringify(join(cwd, 'sicherung'))}`,
        'DIENSTE=(wov-server wov-client wov-admin wov-web)',
        'SICHERUNGEN_BEHALTEN=5',
        aufraeumen,
        // The stop step of the real script has happened by now.
        'DIENSTE_GESTOPPT=1',
        'dienste_starten() { echo STARTEN >> "$LOG"; }',
        'gesundheit_pruefen() { echo "GESUNDHEIT flag=$NEUSTART_BEI_ABBRUCH" >> "$LOG"; }',
        distFn as string,
        kern,
        'gesundheit_pruefen',
      ].join('\n');
      const r = spawnSync(bash, ['-c', skript], {
        cwd,
        encoding: 'utf8',
        env: { PATH: `${bin}:${werkzeug}`, LOG: log, TMPDIR: cwd, HOME: cwd, ...env },
      });
      const zl = readFileSync(log, 'utf8').split('\n').filter((z) => z !== '');
      const lies = (p: string) => (existsSync(join(cwd, p)) ? readFileSync(join(cwd, p), 'utf8').trim() : '-');
      const sicherungen = existsSync(join(cwd, 'sicherung')) ? readdirSync(join(cwd, 'sicherung')).filter((d) => d.endsWith('.tar.gz')) : [];
      // What the backup holds: index.html of the dist it packed (from the real tar).
      const sicherungInhalt = sicherungen.length === 0 ? '-' : spawnSync('tar', ['xzOf', join(cwd, 'sicherung', sicherungen[0] ?? ''), 'dist/index.html'], { encoding: 'utf8' }).stdout.trim();
      return {
        dist: lies('client/dist/index.html'),
        sicherungen: sicherungen.length,
        sicherungInhalt,
        liegt: ['client/dist.neu', 'client/dist.alt'].filter((d) => existsSync(join(cwd, d))),
        rc: r.status,
        stderr: r.stderr ?? '',
        log: zl,
        starts: zl.filter((z) => z === 'STARTEN').length,
        systemctlStart: zl.findIndex((z) => z.startsWith('systemctl start')),
        bau: zl.findIndex((z) => z === 'npm run build'),
        start: zl.indexOf('STARTEN'),
        vite: zl.findIndex((z) => z === 'vite'),
        gesundheit: zl.find((z) => z.startsWith('GESUNDHEIT')) ?? '',
      };
    };

    const rot = kernLauf('tests-rot', { TESTRC: '1' });
    pruefe(rot.rc !== 0, 'Tests rot: Abbruch mit rc != 0', `rc=${rot.rc}`);
    pruefe(rot.starts === 0 && rot.systemctlStart < 0, 'Tests rot: 0 Starts (kein Neustart, Dienste bleiben gestoppt)', `starts=${rot.starts} ${rot.log}`);
    pruefe(rot.bau < 0, 'Tests rot: der Webbau laeuft nicht', rot.log.join(' | '));
    pruefe(rot.stderr.includes('GESTOPPT'), 'Tests rot: Meldung sagt GESTOPPT', rot.stderr);

    const vorbelegt = kernLauf('tests-rot-env', { TESTRC: '1', NEUSTART_BEI_ABBRUCH: '1' });
    pruefe(vorbelegt.rc !== 0 && vorbelegt.starts === 0, 'Tests rot, NEUSTART_BEI_ABBRUCH=1 aus der Umgebung: wirkt nicht, 0 Starts', `rc=${vorbelegt.rc} starts=${vorbelegt.starts}`);

    const bauRot = kernLauf('webbau-rot', { NPMRC: '1' });
    pruefe(bauRot.rc !== 0 && bauRot.bau >= 0, 'Webbau rot: npm run build lief und brach ab', `rc=${bauRot.rc} ${bauRot.log}`);
    pruefe(bauRot.starts === 1 && bauRot.systemctlStart < 0, 'Webbau rot: Neustart in aufraeumen, genau 1 Start', `starts=${bauRot.starts}`);
    pruefe(bauRot.stderr.includes('ABBRUCH nach bestandenen Tests'), 'Webbau rot: Meldung nennt den Neustart', bauRot.stderr);

    const buendelRot = kernLauf('buendel-rot', { BUENDELRC: '1' });
    pruefe(buendelRot.rc !== 0 && buendelRot.starts === 1, 'Buendeln rot: Neustart in aufraeumen, genau 1 Start', `rc=${buendelRot.rc} starts=${buendelRot.starts}`);

    const gruen = kernLauf('gruen', {});
    pruefe(gruen.rc === 0, 'alles gruen: rc=0', `rc=${gruen.rc} ${gruen.stderr}`);
    pruefe(gruen.starts === 1, 'alles gruen: genau ein Start (Schritt 8)', `starts=${gruen.starts} ${gruen.log}`);
    pruefe(gruen.bau >= 0 && gruen.start > gruen.bau, 'alles gruen: der Start kommt nach dem Webbau', `bau=${gruen.bau} start=${gruen.start}`);
    pruefe(gruen.systemctlStart < 0, 'alles gruen: kein systemctl start im Bereich (Dienste kommen nur aus Schritt 8)', gruen.log.join(' | '));
    pruefe(gruen.gesundheit === 'GESUNDHEIT flag=0', 'alles gruen: das Flag ist vor der Gesundheitspruefung 0', gruen.gesundheit);
    pruefe(gruen.vite < 0, 'dev: kein Client-Bau (vite laeuft nur auf live)', gruen.log.join(' | '));

    // ── live: zusaetzlich der Client-Bau vor dem Webbau (Reihenfolge wird gemessen, nicht angenommen) ──
    const lRot = kernLauf('live-tests-rot', { TESTRC: '1' }, 'live');
    pruefe(lRot.rc !== 0 && lRot.starts === 0 && lRot.systemctlStart < 0 && lRot.vite < 0 && lRot.bau < 0, 'live, Tests rot: 0 Starts, kein Client-Bau, kein Webbau', `rc=${lRot.rc} ${lRot.log.join(' | ')}`);
    const lVite = kernLauf('live-vite-rot', { VITERC: '1' }, 'live');
    pruefe(lVite.rc !== 0 && lVite.vite >= 0, 'live, Client-Bau rot: vite lief und brach ab', `rc=${lVite.rc} ${lVite.log.join(' | ')}`);
    pruefe(lVite.starts === 0 && lVite.systemctlStart < 0, 'live, Client-Bau rot: 0 Starts (neuer Server mit altem Client waere ein Fehlstand)', `starts=${lVite.starts} ${lVite.log.join(' | ')}`);
    pruefe(lVite.bau < 0, 'live, Client-Bau rot: der Webbau laeuft nicht mehr', lVite.log.join(' | '));
    pruefe(lVite.stderr.includes('GESTOPPT'), 'live, Client-Bau rot: Meldung sagt GESTOPPT', lVite.stderr);
    const lBau = kernLauf('live-webbau-rot', { NPMRC: '1' }, 'live');
    pruefe(lBau.rc !== 0 && lBau.vite >= 0 && lBau.bau >= 0 && lBau.starts === 1, 'live, Webbau rot: Client gebaut, Neustart in aufraeumen, genau 1 Start', `rc=${lBau.rc} starts=${lBau.starts} ${lBau.log.join(' | ')}`);
    const lGruen = kernLauf('live-gruen', {}, 'live');
    pruefe(lGruen.rc === 0 && lGruen.starts === 1 && lGruen.systemctlStart < 0, 'live, alles gruen: rc=0, genau ein Start, kein systemctl', `rc=${lGruen.rc} starts=${lGruen.starts} ${lGruen.log.join(' | ')}`);
    pruefe(lGruen.vite >= 0 && lGruen.bau > lGruen.vite && lGruen.start > lGruen.bau, 'live, alles gruen: Reihenfolge Client-Bau, Webbau, Start', lGruen.log.join(' | '));
    // The real dist_sichern/dist_tauschen ran: the files say what happened, not the order of calls.
    pruefe(lGruen.dist === 'NEU', 'live, alles gruen: client/dist enthaelt den neuen Stand (echter Tausch)', `dist=${lGruen.dist}`);
    pruefe(lGruen.sicherungen === 1 && lGruen.sicherungInhalt === 'ALT', 'live, alles gruen: die Sicherung enthaelt den ALTEN Stand', `sicherungen=${lGruen.sicherungen} inhalt=${lGruen.sicherungInhalt}`);
    pruefe(lGruen.liegt.length === 0, 'live, alles gruen: weder client/dist.neu noch client/dist.alt bleiben liegen', lGruen.liegt.join(','));
    pruefe(lVite.dist === 'ALT', 'live, Client-Bau rot: client/dist bleibt der alte Stand (kein halber Bau, kein Loeschen vor dem Bau)', `dist=${lVite.dist}`);
    pruefe(lBau.dist === 'NEU' && lBau.sicherungInhalt === 'ALT', 'live, Webbau rot: Tausch war schon durch (dist neu), Sicherung alt', `dist=${lBau.dist} sicherung=${lBau.sicherungInhalt}`);
    pruefe(lRot.dist === 'ALT', 'live, Tests rot: client/dist unberuehrt', `dist=${lRot.dist}`);
    pruefe(lGruen.gesundheit === 'GESUNDHEIT flag=0', 'live, alles gruen: das Flag ist vor der Gesundheitspruefung 0', lGruen.gesundheit);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (ausfuehren && aufraeumen !== null && reigen !== null && buendelBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-abbruch-'));
  try {
    interface Optionen {
      startFehlt?: string; // this unit's `systemctl start` fails
      versionDatei?: boolean;
      gesundheitScheitert?: boolean;
      env?: Record<string, string>;
      signalBeiStart?: [string, string]; // [unit, signal]: sent to the shell when this unit is started
    }
    const szenario = (name: string, vorbereitung: string, schritt: string, opt: Optionen = {}) => {
      const logDatei = join(temp, `${name}.log`);
      const versionDatei = join(temp, `${name}.VERSION`);
      if (opt.versionDatei !== false) writeFileSync(versionDatei, 'WOV_VERSION_COMMIT=alt1234alt1234\nWOV_VERSION_VORHER=aelter99\n');
      const skript = [
        'set -euo pipefail',
        `WURZEL=${JSON.stringify(temp)}`,
        'INSTANZ=dev',
        'DIENSTE=(wov-server wov-client wov-admin wov-web)',
        `VERSION_DATEI=${JSON.stringify(versionDatei)}`,
        'export WOV_UPDATE_VORHER=vorher5678',
        `systemctl() { echo "$1 \${2:-}" >> ${JSON.stringify(logDatei)}; if [ "$1" = is-enabled ]; then echo enabled; fi; ${opt.signalBeiStart ? `if [ "$1 \${2:-}" = "start ${opt.signalBeiStart[0]}.service" ]; then kill -${opt.signalBeiStart[1]} $$; fi; ` : ''}${opt.startFehlt ? `[ "$1 \${2:-}" != "start ${opt.startFehlt}.service" ]` : 'true'}; }`,
        `gesundheit_pruefen() { echo "gesundheit" >> ${JSON.stringify(logDatei)}; ${opt.gesundheitScheitert ? 'echo "GESUNDHEIT_ROT"; exit 1' : 'true'}; }`,
        `version_schreiben() { echo "version" >> ${JSON.stringify(logDatei)}; }`,
        aufraeumen,
        reigen,
        vorbereitung,
        'dienste_stoppen',
        schritt,
        'echo MARKER_WEITER',
      ].join('\n');
      const r = spawnSync('bash', ['-c', skript], {
        cwd: temp,
        encoding: 'utf8',
        env: { ...SAUBERE_UMGEBUNG, ...(opt.env ?? {}) },
      });
      const verben = existsSync(logDatei) ? readFileSync(logDatei, 'utf8').split('\n') : [];
      const zahl = (v: string) => verben.filter((z) => z === v || z === `${v} `).length;
      return {
        r,
        stderr: r.stderr ?? '',
        stopps: verben.filter((z) => z.startsWith('stop ')).length,
        starts: verben.filter((z) => z.startsWith('start ')).length,
        startsServer: verben.filter((z) => z === 'start wov-server.service').length,
        log: verben,
        gesundheit: zahl('gesundheit'),
        version: zahl('version'),
      };
    };
    // Signal inside dienste_stoppen itself: the shared harness stops first, so this one runs the reigen once, with the signalling fake.
    const szenarioOhneStopp = (sig: string) => {
      const logDatei = join(temp, `stopp-${sig}.log`);
      const versionDatei = join(temp, `stopp-${sig}.VERSION`);
      writeFileSync(versionDatei, 'WOV_VERSION_COMMIT=alt1234alt1234\nWOV_VERSION_VORHER=aelter99\n');
      const skript = [
        'set -euo pipefail',
        `WURZEL=${JSON.stringify(temp)}`,
        'INSTANZ=dev',
        'DIENSTE=(wov-server wov-client wov-admin wov-web)',
        `VERSION_DATEI=${JSON.stringify(versionDatei)}`,
        'export WOV_UPDATE_VORHER=vorher5678',
        `systemctl() { echo "$1 \${2:-}" >> ${JSON.stringify(logDatei)}; if [ "$1 \${2:-}" = "stop wov-admin.service" ]; then kill -${sig} $$; fi; true; }`,
        aufraeumen,
        reigen,
        'dienste_stoppen',
        'echo MARKER_WEITER',
      ].join('\n');
      const r = spawnSync('bash', ['-c', skript], { cwd: temp, encoding: 'utf8', env: SAUBERE_UMGEBUNG });
      const verben = existsSync(logDatei) ? readFileSync(logDatei, 'utf8').split('\n') : [];
      return { r, stderr: r.stderr ?? '', stopps: verben.filter((z) => z.startsWith('stop ')).length, starts: verben.filter((z) => z.startsWith('start ')).length };
    };
    const flag = 'NEUSTART_BEI_ABBRUCH=1';
    const ohneBuendel = 'mkdir -p wov-web/static/assets/js';
    const leeresBuendel = `${ohneBuendel}; : > wov-web/static/assets/js/vorschau.js`;
    const gutesBuendel = `${ohneBuendel}; echo x > wov-web/static/assets/js/vorschau.js`;

    const leer = szenario('leer', leeresBuendel, `${flag}\n${buendelBlock}`);
    pruefe(leer.r.status !== 0 && !leer.r.stdout.includes('MARKER_WEITER'), 'leeres Buendel: Abbruch mit rc != 0', `rc=${leer.r.status}`);
    pruefe(leer.stopps === 4 && leer.starts === leer.stopps, 'leeres Buendel: Starts gleich Stopps', `stop=${leer.stopps} start=${leer.starts}`);
    pruefe(leer.stderr.includes('fehlt oder ist leer'), 'leeres Buendel: klare Meldung', leer.stderr);
    pruefe(leer.gesundheit === 1, 'Neustart nach Abbruch ruft die Gesundheitspruefung genau einmal', `${leer.gesundheit}`);
    pruefe(leer.version === 0, 'Neustart nach Abbruch schreibt VERSION NICHT', `${leer.version}`);
    pruefe(leer.stderr.includes('alt1234alt1234') && leer.stderr.includes('git checkout -B main alt1234alt1234'), 'Neustart nach Abbruch: Meldung nennt den alten Stand und den Rueckweg', leer.stderr);
    pruefe(leer.stderr.includes('NICHT fertig ausgerollt') && leer.stderr.includes('zurueck') && leer.stderr.includes('NICHT'), 'Neustart nach Abbruch: Meldung sagt, dass nicht fertig ausgerollt und zurueck hier nicht geht', leer.stderr);

    // Rueckweg im Neustart-Zweig: die Dienste laufen dort, also erst stoppen, dann Baum zurueck, dann npm ci, dann starten.
    const rueckzeile = leer.stderr.split('\n').find((z) => z.includes('git checkout -B main alt1234alt1234')) ?? '';
    const reihe = ['systemctl stop wov-server wov-client wov-admin wov-web', 'git checkout -B main alt1234alt1234', 'npm ci --include=dev', 'systemctl start wov.target'].map((t) => rueckzeile.indexOf(t));
    pruefe(reihe.every((i, k) => i >= 0 && (k === 0 || i > reihe[k - 1])), 'Neustart-Meldung: Rueckweg stoppt erst die Dienste, dann checkout, npm ci, start wov.target', rueckzeile);
    pruefe(!rueckzeile.includes('restart'), 'Neustart-Meldung: Rueckweg nutzt kein restart wov.target', rueckzeile);
    // Der Rueckweg-Text steht VOR dem ersten Start (er soll auch bei SIGKILL im Start nicht fehlen).
    const kopfNr = leer.log.findIndex((z) => z.startsWith('start '));
    pruefe(leer.stderr.indexOf('Rückweg von Hand') >= 0 && leer.stderr.indexOf('Rückweg von Hand') < leer.stderr.indexOf('Gesundheitsprüfung: '), 'Neustart-Meldung: Rueckweg-Text vor dem Ergebnis des Starts', `${kopfNr}`);

    const fehlt = szenario('fehlt', ohneBuendel, `${flag}\n${buendelBlock}`);
    pruefe(fehlt.r.status !== 0 && fehlt.stopps === 4 && fehlt.starts === fehlt.stopps, 'fehlendes Buendel: rc != 0, Starts gleich Stopps', `rc=${fehlt.r.status} stop=${fehlt.stopps} start=${fehlt.starts}`);

    const esbuild = szenario('esbuild', ohneBuendel, `${flag}\nfalse`);
    pruefe(esbuild.r.status !== 0 && esbuild.stopps === 4 && esbuild.starts === esbuild.stopps, 'Fehler im Buendeln/Webbau: rc != 0, Starts gleich Stopps', `rc=${esbuild.r.status} stop=${esbuild.stopps} start=${esbuild.starts}`);

    const testFehler = szenario('tests', ohneBuendel, 'false');
    pruefe(testFehler.r.status !== 0 && testFehler.stopps === 4 && testFehler.starts === 0, 'Abbruch vor dem Webbau (Tests): Dienste bleiben gestoppt (Absicht)', `rc=${testFehler.r.status} stop=${testFehler.stopps} start=${testFehler.starts}`);
    pruefe(testFehler.stderr.includes('GESTOPPT'), 'Abbruch vor dem Webbau: Meldung sagt GESTOPPT', testFehler.stderr);
    pruefe(
      testFehler.stderr.includes('alt1234alt1234') &&
        ['git checkout -B main alt1234alt1234', 'npm ci --include=dev', 'systemctl start wov.target'].every((s) => testFehler.stderr.includes(s)),
      'GESTOPPT-Meldung nennt den alten Commit (aus VERSION) und die Befehle fuer den Rueckweg',
      testFehler.stderr,
    );
    pruefe(!testFehler.stderr.includes('Notfalls den vorhandenen Stand'), 'GESTOPPT-Meldung empfiehlt nicht mehr, den vorhandenen (neuen, durchgefallenen) Stand zu starten', testFehler.stderr);
    pruefe(testFehler.gesundheit === 0 && testFehler.version === 0, 'Abbruch vor dem Webbau: keine Gesundheitspruefung, kein VERSION');

    const ohneVersion = szenario('ohneversion', ohneBuendel, 'false', { versionDatei: false });
    pruefe(ohneVersion.stderr.includes('git checkout -B main vorher5678'), 'ohne VERSION nennt die Meldung den Stand vor dem Pull (WOV_UPDATE_VORHER)', ohneVersion.stderr);

    const gut = szenario('gut', gutesBuendel, `${flag}\n${buendelBlock}`);
    pruefe(gut.r.status === 0 && gut.r.stdout.includes('MARKER_WEITER') && gut.starts === 0, 'vorhandenes Buendel: kein Abbruch, kein Neustart im Aufraeumen', `rc=${gut.r.status} start=${gut.starts}`);

    // Gesundheitspruefung scheitert im Neustart: Exit-Code des Abbruchs bleibt, Meldung sichtbar.
    const gesund = szenario('gesund', ohneBuendel, `${flag}\nexit 7`, { gesundheitScheitert: true });
    pruefe(gesund.r.status === 7 && gesund.starts === 4 && gesund.stderr.includes('Gesundheitsprüfung GESCHEITERT'), 'Neustart mit roter Gesundheitspruefung: Exit-Code bleibt 7, 4 Starts, Meldung', `rc=${gesund.r.status} start=${gesund.starts} ${gesund.stderr}`);

    // ── H2: ein scheiternder Start ──
    const startNormal = szenario('startnormal', ohneBuendel, 'dienste_starten', { startFehlt: 'wov-server' });
    pruefe(startNormal.r.status !== 0 && !startNormal.r.stdout.includes('MARKER_WEITER'), 'Start scheitert (Normalweg): Abbruch mit rc != 0', `rc=${startNormal.r.status}`);
    pruefe(startNormal.startsServer === 1 && startNormal.starts === 4, 'Start scheitert (Normalweg): jeder Dienst genau einmal, KEIN zweiter Startversuch', `server=${startNormal.startsServer} start=${startNormal.starts}`);
    pruefe(startNormal.stderr.includes('FEHLER: wov-server') && startNormal.stderr.includes('journalctl -u wov-server'), 'Start scheitert: Meldung nennt den Dienst und journalctl -u', startNormal.stderr);
    pruefe(!startNormal.r.stdout.includes('gestartet: wov-server'), 'Start scheitert: der Dienst gilt nicht als gestartet', startNormal.r.stdout);
    pruefe(!startNormal.stderr.includes('werden wieder gestartet') && !startNormal.stderr.includes('GESTOPPT und bleiben'), 'Start scheitert (Normalweg): kein Text des Neustart- oder GESTOPPT-Zweigs', startNormal.stderr);
    pruefe(startNormal.gesundheit === 0 && startNormal.version === 0, 'Start scheitert: keine Gesundheitspruefung, kein VERSION');
    // Im Normalweg ist das Flag 1 (Schritt 8 steht vor dem Zuruecksetzen): auch dann kein zweiter Versuch.
    const startFlag = szenario('startflag', ohneBuendel, `${flag}\ndienste_starten`, { startFehlt: 'wov-server' });
    pruefe(startFlag.r.status !== 0 && startFlag.startsServer === 1 && startFlag.starts === 4, 'Start scheitert bei gesetztem Flag: kein zweiter Startversuch', `rc=${startFlag.r.status} server=${startFlag.startsServer} start=${startFlag.starts}`);
    pruefe(startFlag.stderr.includes('journalctl -u wov-server') && !startFlag.stderr.includes('werden wieder gestartet'), 'Start scheitert bei gesetztem Flag: Fehlertext statt Neustart-Text', startFlag.stderr);
    // Der Neustart selbst scheitert (Abbruch im Webbau, dann Start von wov-server rot).
    const startNeu = szenario('startneu', ohneBuendel, `${flag}\nexit 7`, { startFehlt: 'wov-server' });
    pruefe(startNeu.r.status === 7 && startNeu.startsServer === 1 && startNeu.starts === 4, 'Neustart scheitert an wov-server: Exit-Code bleibt, jeder Dienst einmal versucht', `rc=${startNeu.r.status} server=${startNeu.startsServer} start=${startNeu.starts}`);
    pruefe(startNeu.stderr.includes('FEHLER: wov-server') && startNeu.stderr.includes('journalctl -u wov-server') && startNeu.gesundheit === 0, 'Neustart scheitert: Fehler sichtbar, keine Gesundheitspruefung', startNeu.stderr);

    // ── H1: Signale, jeweils vor und nach dem Setzen des Flags ──
    const signale: Array<[string, number]> = [['INT', 130], ['TERM', 143], ['HUP', 129], ['PIPE', 141]];
    for (const [sig, code] of signale) {
      const vor = szenario(`sig-${sig}-vor`, ohneBuendel, `kill -${sig} $$\nsleep 1`);
      pruefe(vor.r.status === code && !vor.r.stdout.includes('MARKER_WEITER'), `${sig} vor dem Flag: Exit-Code ${code}`, `rc=${vor.r.status}`);
      pruefe(vor.stopps === 4 && vor.starts === 0 && vor.stderr.includes(`Signal ${sig}`) && vor.stderr.includes('GESTOPPT'), `${sig} vor dem Flag: kein Neustart, Meldung nennt Signal und GESTOPPT`, `stop=${vor.stopps} start=${vor.starts} ${vor.stderr}`);
      const nach = szenario(`sig-${sig}-nach`, ohneBuendel, `${flag}\nkill -${sig} $$\nsleep 1`);
      pruefe(nach.r.status === code && !nach.r.stdout.includes('MARKER_WEITER'), `${sig} nach dem Flag: Exit-Code ${code}`, `rc=${nach.r.status}`);
      pruefe(nach.stopps === 4 && nach.starts === 4 && nach.stderr.includes(`Signal ${sig}`), `${sig} nach dem Flag: 4x stop, 4x start, Meldung nennt das Signal`, `stop=${nach.stopps} start=${nach.starts} ${nach.stderr}`);
    }
    // SSH-Abbruch: die Ausgabe ist tot, der Neustart muss trotzdem laufen (kein set -e in der Falle).
    const hupTot = szenario('hup-tot', ohneBuendel, `exec 1>/dev/full 2>/dev/full\n${flag}\nkill -HUP $$\nsleep 1`);
    pruefe(hupTot.r.status === 129 && hupTot.stopps === 4 && hupTot.starts === 4, 'HUP nach dem Flag bei nicht schreibbarer Ausgabe (/dev/full): Exit-Code 129, Neustart laeuft trotzdem', `rc=${hupTot.r.status} start=${hupTot.starts}`);

    // ── F1: echte tote Pipe (SSH ohne tty): die naechste Ausgabe bekommt SIGPIPE ──
    const pipeTot = szenario('pipe-tot', ohneBuendel, `exec 2> >(exit 0)\nsleep 0.5\n${flag}\necho x >&2\nsleep 1`);
    pruefe(pipeTot.r.status === 141 && pipeTot.stopps === 4 && pipeTot.starts === 4, 'SIGPIPE (tote Pipe) nach dem Flag: Exit-Code 141, Neustart laeuft trotzdem', `rc=${pipeTot.r.status} stop=${pipeTot.stopps} start=${pipeTot.starts}`);

    // ── F3: ein zweites Signal waehrend des Neustarts bricht ihn nicht ab ──
    for (const sig of ['INT', 'TERM', 'HUP']) {
      const zweites = szenario(`zweit-${sig}`, ohneBuendel, `${flag}\nexit 7`, { signalBeiStart: ['wov-admin', sig] });
      pruefe(zweites.r.status === 7 && zweites.starts === 4 && zweites.gesundheit === 1, `zweites Signal (${sig}) im Neustart: Exit-Code 7, alle 4 Dienste gestartet, Gesundheitspruefung`, `rc=${zweites.r.status} start=${zweites.starts} gesundheit=${zweites.gesundheit}`);
      pruefe(zweites.stderr.includes('weiteres Signal') && zweites.stderr.includes('git checkout -B main alt1234alt1234'), `zweites Signal (${sig}) im Neustart: Meldung und Rueckweg-Text vollstaendig`, zweites.stderr);
    }

    // ── F4: Signal in Schritt 8 (Tests waren gruen) ──
    for (const [sig, code] of [['INT', 130], ['TERM', 143], ['HUP', 129]] as Array<[string, number]>) {
      const s8 = szenario(`s8-${sig}`, ohneBuendel, `${flag}\ndienste_starten`, { signalBeiStart: ['wov-admin', sig] });
      pruefe(s8.r.status === code && s8.starts === 3 && s8.stopps === 4, `${sig} in Schritt 8: Exit-Code ${code}, kein zweiter Startversuch (3 Starts, 4 Stopps)`, `rc=${s8.r.status} start=${s8.starts} stop=${s8.stopps}`);
      pruefe(
        s8.stderr.includes('Tests waren grün') && s8.stderr.includes('Laufen:   wov-server wov-client\n') && s8.stderr.includes('Gestoppt: wov-admin wov-web') && !s8.stderr.includes('durchgefallen') && !s8.stderr.includes('GESTOPPT und bleiben') && !s8.stderr.includes('werden wieder gestartet'),
        `${sig} in Schritt 8: Meldung sagt gruene Tests, nennt laufende und gestoppte Dienste, nicht "durchgefallen"`,
        s8.stderr,
      );
    }

    // ── F5: Signal mitten im Stoppen ──
    for (const [sig, code] of [['INT', 130], ['TERM', 143], ['HUP', 129]] as Array<[string, number]>) {
      const sp = szenarioOhneStopp(sig);
      pruefe(sp.r.status === code && sp.stopps === 3 && sp.starts === 0, `${sig} mitten im Stoppen: Exit-Code ${code}, 3 Stopps, kein Start`, `rc=${sp.r.status} stop=${sp.stopps} start=${sp.starts}`);
      pruefe(sp.stderr.includes('GESTOPPT') && sp.stderr.includes('git checkout -B main alt1234alt1234'), `${sig} mitten im Stoppen: GESTOPPT-Meldung mit Rueckweg`, sp.stderr);
    }

    // ── F6: scheitert mv dist.alt dist, darf dist.alt nicht geloescht werden ──
    const distVorb = (mvKaputt: boolean) =>
      `BAU_BEGONNEN=1\nrm -rf client; mkdir -p client/dist.alt; echo x > client/dist.alt/datei\n${mvKaputt ? 'mv() { return 1; }' : ''}`;
    const mvKaputt = szenario('mvkaputt', distVorb(true), 'false');
    pruefe(existsSync(join(temp, 'client/dist.alt/datei')) && !existsSync(join(temp, 'client/dist')), 'mv dist.alt dist scheitert: dist.alt bleibt liegen', '');
    pruefe(mvKaputt.stderr.includes('client/dist.alt bleibt liegen'), 'mv dist.alt dist scheitert: Fehler wird gemeldet', mvKaputt.stderr);
    szenario('mvgut', distVorb(false), 'false');
    pruefe(existsSync(join(temp, 'client/dist/datei')) && !existsSync(join(temp, 'client/dist.alt')), 'Halbfertiger Tausch: dist.alt wird zurueckgetauscht und weggeraeumt', '');

    // ── F7: eine Vorbelegung aus der Umgebung darf keinen Neustart erzwingen ──
    const umgebung = szenario('umgebung', ohneBuendel, 'false', { env: { NEUSTART_BEI_ABBRUCH: '1' } });
    pruefe(umgebung.r.status !== 0 && umgebung.stopps === 4 && umgebung.starts === 0, 'NEUSTART_BEI_ABBRUCH=1 in der Umgebung erzwingt keinen Neustart nach rotem Test', `rc=${umgebung.r.status} start=${umgebung.starts}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-nicht-getrackt: alles gruen');
