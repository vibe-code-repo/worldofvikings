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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUENDEL = 'wov-web/static/assets/js/vorschau.js';

let fehler = 0;
let gruen = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) {
    gruen++;
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
// No cage available: the executing parts do NOT run without one. In CI the cage is
// tried as the user first, then through `sudo -n` (passwordless on GitHub runners);
// only if both fail does CI skip them (the runner shows that line on failure only).
// Anywhere else a missing cage is red.
const IM_KAEFIG = process.env.WOV_KAEFIG === '1';

/**
 * unshare command line. Root uses unshare directly, everyone else the user namespace (-r);
 * `viaSudo` (CI only, see below) runs unshare as root through `sudo -n`. `setpriv --pdeathsig KILL`
 * makes unshare die with its parent, so a killed test leaves no orphaned cage behind.
 * sudo gets a closed environment: `env -i --` with absolute tool paths, a fixed PATH and only the names
 * of SUDO_UMGEBUNG (each checked against NAME_OK). The caller's PATH, LD_PRELOAD, NODE_OPTIONS never get through.
 */
const NAME_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SUDO_UMGEBUNG = ['HOME', 'CI', 'WOV_KAEFIG', 'TMPDIR'];
const SUDO_PFAD = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const SUDO_WERKZEUGE = { env: '/usr/bin/env', setpriv: '/usr/bin/setpriv', unshare: '/usr/bin/unshare' };

/** Names and values for `env -i` in the sudo path: the fixed list only, never the caller's PATH. */
function sudoUmgebung(umgebung: Record<string, string>): string[] {
  const paare: string[] = [`PATH=${SUDO_PFAD}`];
  for (const name of SUDO_UMGEBUNG) {
    const wert = umgebung[name];
    if (wert !== undefined && NAME_OK.test(name)) paare.push(`${name}=${wert}`);
  }
  return paare;
}

function kaefigBefehl(befehl: string[], viaSudo = false, umgebung: Record<string, string> = {}): [string, string[]] {
  const ns = ['--pid', '--fork', '--kill-child', '--net', '--ipc', '--uts', '--mount', '--propagation', 'private'];
  const rolle = viaSudo || process.getuid?.() === 0 ? [] : ['-r'];
  const innen = ['--pdeathsig', 'KILL'];
  const rest = [...rolle, ...ns, '--', 'bash', join(WURZEL, 'tools/test/kaefig.sh'), WURZEL, ...befehl];
  if (!viaSudo) return ['setpriv', [...innen, 'unshare', ...rest]];
  const { env, setpriv, unshare } = SUDO_WERKZEUGE;
  return ['sudo', ['-n', '--', env, '-i', '--', ...sudoUmgebung(umgebung), setpriv, ...innen, unshare, ...rest]];
}

/** CI means exactly CI=true or CI=1. CI=false, 0, no, empty or anything else is "no CI": no sudo. */
const IN_CI = /^(true|1)$/i.test(process.env.CI ?? '');
/** The cage run prints KAEFIG-PROBE OK=<n>; fewer than this many measured checks is not green. */
const MINDEST_OK = 150;

let ausfuehren = IM_KAEFIG;
if (!IM_KAEFIG) {
  const umgebung = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith('TSX_') && v !== undefined)) as Record<string, string>;
  const lauf = { ...umgebung, WOV_KAEFIG: '1', TMPDIR: '/tmp' };
  // 1st try: the cage as the current user (root, or unshare -r).
  let viaSudo = false;
  let [prog, args] = kaefigBefehl(['true']);
  let probe = spawnSync(prog, args, { encoding: 'utf8' });
  // 2nd try, only in CI (GitHub runners have passwordless sudo, Ubuntu 24.04 blocks unshare -r):
  // never sudo on a developer machine, never a password prompt (-n).
  const werkzeugFehlt = Object.values(SUDO_WERKZEUGE).filter((p) => !existsSync(p));
  if (probe.status !== 0 && IN_CI && process.getuid?.() !== 0 && werkzeugFehlt.length > 0) {
    probe = { ...probe, stderr: `sudo path not possible, missing under /usr/bin: ${werkzeugFehlt.join(' ')}` } as typeof probe;
  } else if (probe.status !== 0 && IN_CI && process.getuid?.() !== 0) {
    const sudoOk = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' }).status === 0;
    if (sudoOk) {
      [prog, args] = kaefigBefehl(['true'], true, lauf);
      const probe2 = spawnSync(prog, args, { encoding: 'utf8' });
      if (probe2.status === 0) {
        viaSudo = true;
        probe = probe2;
      } else {
        probe = { ...probe2, stderr: `sudo -n unshare: ${probe2.stderr ?? ''}` } as typeof probe;
      }
    }
  }
  if (probe.status === 0) {
    // Run this very file again, inside the cage; it prints everything and its exit code is ours.
    const [p2, a2] = kaefigBefehl([process.execPath, ...process.execArgv, fileURLToPath(import.meta.url)], viaSudo, lauf);
    const l = spawnSync(p2, a2, { stdio: ['inherit', 'pipe', 'inherit'], env: lauf, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    process.stdout.write(l.stdout ?? '');
    if ((l.status ?? 1) !== 0) process.exit(l.status ?? 1);
    // rc 0 alone proves nothing (any program in the chain can exit 0): the cage run has to report its count.
    const gezaehlt = /^KAEFIG-PROBE OK=(\d+)$/m.exec(l.stdout ?? '');
    const n = gezaehlt ? Number(gezaehlt[1]) : -1;
    if (n < MINDEST_OK) {
      console.error(`  ROT  Kaefig-Lauf meldet ${gezaehlt ? `nur ${n}` : 'keine'} Pruefungen (erwartet mindestens ${MINDEST_OK})`);
      process.exit(1);
    }
    process.exit(0);
  }
  const grund = `${probe.stderr ?? ''}`.trim().split('\n')[0] ?? '';
  // The runner prints a test's output only when it fails, and it has no way for a test to report itself
  // as skipped (only its own switch list can). So this line is visible with a failure only.
  console.error(`  Probe übersprungen: kein Namensraum verfügbar (${grund || `rc=${probe.status}`}). Nur die Textprüfungen laufen, der Skriptcode nicht.`);
  if (!IN_CI) {
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
    fake(join(bin, 'node'), 'echo "node $1" >> "$LOG"\n[ "$1" = scripts/run-tests.mjs ] && echo "TOR-ENV wv=${WOV_WELT_VERZEICHNIS-X} au=${WOV_ADMIN_URL-X}" >> "$LOG"\n[ "$1" = scripts/run-tests.mjs ] && exit "${TESTRC:-0}"\n[ "$1" = tools/vorschau-buendeln.mjs ] && exit "${BUENDELRC:-0}"\nexit 0');
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

    // K5.7 N3: vor dem Test-Tor werden die Welt-Variablen entfernt (auch wenn /etc/wov.env oder die Shell sie gesetzt hat).
    const koeder = kernLauf('tor-ohne-welt-variablen', { WOV_WELT_VERZEICHNIS: '/var/lib/wov/welten', WOV_ADMIN_URL: 'http://127.0.0.1:9' });
    pruefe(koeder.rc === 0 && koeder.log.includes('TOR-ENV wv=X au=X'), 'Test-Tor: WOV_WELT_VERZEICHNIS und WOV_ADMIN_URL sind beim Runner nicht gesetzt, obwohl sie exportiert waren', `rc=${koeder.rc} ${koeder.log.join(' | ')}`);

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

// ── Stopp ohne Speichern: das Skript bricht VOR npm ci und Build ab (S1-Nachtrag) ──
// The game server exits 74 (or 75) and logs SAVE_FAILED_ON_STOP when saving at stop
// fails, yet `systemctl stop` reports success: only Result and the journal tell. The
// real dienste_stoppen + aufraeumen run with fake systemctl/journalctl functions
// (inside the cage, never the real services); "WEITER" stands for everything after the
// stop step (npm ci, build, swap) and must NOT appear when the stop was not clean.
if (ausfuehren && aufraeumen !== null && reigen !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'stopp-speichern-'));
  try {
    interface Stopp {
      result?: Record<string, string>; // unit -> Result after its stop (default success)
      journal?: string; // what `journalctl -u wov-server --since ...` prints
      startFehlt?: string;
      kopf?: string; // what `git rev-parse HEAD` prints (default: a new commit)
      vorher?: string; // WOV_UPDATE_VORHER (default vorher5678, '' = unset)
      checkoutFehlt?: boolean; // the reset `git checkout -B` fails
      vorherResult?: Record<string, string>; // Result a unit already carries BEFORE the rollout (sticky until reset-failed)
    }
    const stoppLauf = (name: string, opt: Stopp = {}) => {
      const logDatei = join(temp, `${name}.log`);
      const versionDatei = join(temp, `${name}.VERSION`);
      writeFileSync(versionDatei, 'WOV_VERSION_COMMIT=alt1234alt1234\n');
      const zuweisung = (m: Record<string, string> | undefined, feld: string) =>
        Object.entries(m ?? {})
          .map(([u, r]) => `${feld}[${u}.service]=${JSON.stringify(r)}`)
          .join('; ');
      const skript = [
        'set -euo pipefail',
        `WURZEL=${JSON.stringify(temp)}`,
        'INSTANZ=dev',
        'DIENSTE=(wov-server wov-client wov-admin wov-web)',
        `VERSION_DATEI=${JSON.stringify(versionDatei)}`,
        `export WOV_UPDATE_VORHER=${JSON.stringify(opt.vorher ?? 'vorher5678')} WOV_UPDATE_STUFE2=1`,
        `LOGD=${JSON.stringify(logDatei)}`,
        // Result is sticky: it changes on a stop (to the scripted value, else it stays) and is cleared by reset-failed.
        'declare -A RES STOPRES',
        zuweisung(opt.vorherResult, 'RES'),
        zuweisung(opt.result, 'STOPRES'),
        'systemctl() {',
        '  echo "$*" >> "$LOGD"',
        '  case "$1" in',
        '    is-enabled) echo enabled ;;',
        '    stop) [ -n "${STOPRES[$2]+x}" ] && RES[$2]="${STOPRES[$2]}" ;;',
        '    reset-failed) for u in "${!RES[@]}"; do RES[$u]=success; done ;;',
        '    show) echo "${RES[${5:-}]-success}" ;;',
        `    start) [ "$2" = ${JSON.stringify(`${opt.startFehlt ?? '-'}.service`)} ] && return 1 ;;`,
        '  esac',
        '  return 0',
        '}',
        `journalctl() { echo "journalctl $*" >> "$LOGD"; printf '%b' ${JSON.stringify(opt.journal ?? '')}; }`,
        `git() { echo "git $*" >> "$LOGD"; case "$1" in rev-parse) echo ${JSON.stringify(opt.kopf ?? 'neu9999')};; checkout) ${opt.checkoutFehlt ? 'return 1' : 'true'};; status) echo "?? server/src/kollision.ts";; esac; }`,
        'gesundheit_pruefen() { echo gesundheit >> "$LOGD"; }',
        'version_schreiben() { echo version >> "$LOGD"; }',
        aufraeumen,
        reigen,
        'dienste_stoppen',
        'echo WEITER',
        'echo WEITER >> "$LOGD"',
      ].join('\n');
      const r = spawnSync('bash', ['-c', skript], { cwd: temp, encoding: 'utf8', env: SAUBERE_UMGEBUNG });
      const log = existsSync(logDatei) ? readFileSync(logDatei, 'utf8').split('\n').filter((z) => z !== '') : [];
      return {
        rc: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        log,
        stopps: log.filter((z) => z.startsWith('stop ')).length,
        starts: log.filter((z) => z.startsWith('start ')).length,
        weiter: log.includes('WEITER'),
        gesundheit: log.filter((z) => z === 'gesundheit').length,
        version: log.filter((z) => z === 'version').length,
        checkout: log.findIndex((z) => z.startsWith('git checkout -B main ')),
        ersterStart: log.findIndex((z) => z.startsWith('start ')),
        resetFailed: log.filter((z) => z.startsWith('reset-failed')).length,
      };
    };

    // (a) wov-server ends with Result=exit-code: abort, all four restarted, rc != 0, nothing after the stop.
    const a = stoppLauf('a-exit-code', { result: { 'wov-server': 'exit-code' } });
    pruefe(a.rc !== 0, 'Stopp Result=exit-code: Abbruch mit rc != 0', `rc=${a.rc}`);
    pruefe(!a.weiter, 'Stopp Result=exit-code: der Ablauf danach (npm ci, Build) laeuft nicht', a.log.join(' | '));
    pruefe(a.stopps === 4 && a.starts === 4, 'Stopp Result=exit-code: 4 Stopps, danach 4 Starts (Rueckweg startet die Dienste wieder)', `stopps=${a.stopps} starts=${a.starts}`);
    pruefe(a.resetFailed === 2, 'Stopp Result=exit-code: reset-failed zweimal (vor dem Stopp, und vor dem Neustart)', `${a.resetFailed}`);
    pruefe(a.gesundheit === 1 && a.version === 0, 'Stopp Result=exit-code: Gesundheitspruefung ja, VERSION nicht geschrieben', `g=${a.gesundheit} v=${a.version}`);
    pruefe(a.stderr.includes('Endstand nicht gespeichert') && a.stderr.includes('wov-server (Result=exit-code)'), 'Stopp Result=exit-code: Meldung nennt Grund und Dienst', a.stderr);

    pruefe(a.checkout >= 0 && a.checkout < a.ersterStart && a.log[a.checkout] === 'git checkout -B main vorher5678', 'Stopp Result=exit-code: Baum wird auf WOV_UPDATE_VORHER zurueckgesetzt, BEVOR der erste Start kommt', a.log.join(' | '));
    pruefe(a.stderr.includes('ZURÜCKGESETZT') && a.stderr.includes('neu9999') && a.stderr.includes('vorher5678'), 'Stopp Result=exit-code: Meldung nennt beide Commits und das Zuruecksetzen', a.stderr);

    // (b) Result=success, but SAVE_FAILED_ON_STOP in the journal since the stop began.
    const zeilen = 'Sep 26 10:00:01 dev wov-server[1]: Speichern...\nSep 26 10:00:02 dev wov-server[1]: SAVE_FAILED_ON_STOP: EACCES\n';
    const b = stoppLauf('b-journal', { journal: zeilen });
    pruefe(b.rc !== 0 && !b.weiter, 'Stopp mit SAVE_FAILED_ON_STOP im Journal (Result success): Abbruch, kein Weiterlauf', `rc=${b.rc} ${b.log.join(' | ')}`);
    pruefe(b.stopps === 4 && b.starts === 4 && b.gesundheit === 1 && b.version === 0, 'Stopp mit SAVE_FAILED_ON_STOP: 4 Stopps, 4 Starts, Gesundheitspruefung, kein VERSION', `stopps=${b.stopps} starts=${b.starts}`);
    pruefe(b.stderr.includes('Endstand nicht gespeichert') && b.stderr.includes('SAVE_FAILED_ON_STOP: EACCES'), 'Stopp mit SAVE_FAILED_ON_STOP: Meldung nennt den Grund und zitiert die Journalzeile', b.stderr);
    pruefe(b.log.some((z) => /^journalctl -u wov-server\.service --since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(z)), 'Stopp: das Journal wird nur seit Stoppbeginn gelesen (--since Zeitstempel)', b.log.join(' | '));

    pruefe(b.checkout >= 0 && b.checkout < b.ersterStart, 'Stopp mit SAVE_FAILED_ON_STOP: Zuruecksetzen vor dem ersten Start', b.log.join(' | '));

    // HEAD already on the before-commit, or WOV_UPDATE_VORHER empty (zurueck run): nothing is reset.
    const g1 = stoppLauf('g1-gleich', { result: { 'wov-server': 'exit-code' }, kopf: 'vorher5678' });
    pruefe(g1.rc !== 0 && g1.checkout < 0 && g1.starts === 4, 'HEAD gleich Vorher-Commit: kein Zuruecksetzen, Dienste starten wieder', `checkout=${g1.checkout} starts=${g1.starts}`);
    const g2 = stoppLauf('g2-leer', { result: { 'wov-server': 'exit-code' }, vorher: '' });
    pruefe(g2.rc !== 0 && g2.checkout < 0 && g2.starts === 4, 'WOV_UPDATE_VORHER leer: kein Zuruecksetzen, Dienste starten wieder', `checkout=${g2.checkout} starts=${g2.starts}`);

    // The reset itself fails: no start on the new tree, clear message with the way back by hand.
    const h = stoppLauf('h-reset-scheitert', { result: { 'wov-server': 'exit-code' }, checkoutFehlt: true });
    pruefe(h.rc !== 0 && h.starts === 0 && h.gesundheit === 0, 'Zuruecksetzen scheitert: 0 Starts auf dem neuen Baum, keine Gesundheitspruefung', `rc=${h.rc} starts=${h.starts}`);
    pruefe(h.stderr.includes('nicht auf vorher5678 zurücksetzen') && h.stderr.includes('git checkout -B main vorher5678') && h.stderr.includes('NICHT gestartet'), 'Zuruecksetzen scheitert: Meldung mit Rueckweg-Befehlen von Hand', h.stderr);
    pruefe(h.log.includes('git status --short') && h.stderr.includes('server/src/kollision.ts') && h.stderr.includes('Erst diese wegräumen'), 'Zuruecksetzen scheitert: Meldung zeigt git status, nennt die kollidierende Datei und sagt, was zuerst wegzuraeumen ist', h.stderr);

    // B1: another unit (not the game server) with Result != success is only a warning, the rollout goes on.
    const c = stoppLauf('c-anderer', { result: { 'wov-admin': 'timeout' } });
    pruefe(c.rc === 0 && c.weiter && c.starts === 0 && c.stopps === 4, 'wov-admin Result=timeout (offener Editor-Tab): kein Abbruch, Ablauf geht weiter', `rc=${c.rc} starts=${c.starts} ${c.stderr}`);
    pruefe(c.stderr.includes('WARNUNG') && c.stderr.includes('wov-admin endete beim Stopp mit Result=timeout') && !c.stderr.includes('ABBRUCH'), 'wov-admin Result=timeout: Warnung nennt Dienst und Result, keine Abbruchmeldung', c.stderr);
    const c2 = stoppLauf('c2-alle-anderen', { result: { 'wov-client': 'exit-code', 'wov-admin': 'timeout', 'wov-web': 'signal' } });
    pruefe(c2.rc === 0 && c2.weiter && c2.starts === 0, 'wov-client, wov-admin, wov-web mit Result != success: nur Warnungen, kein Abbruch', `rc=${c2.rc} ${c2.stderr}`);
    // admin timeout AND game server failed: the abort names the game server only.
    const c3 = stoppLauf('c3-admin-und-server', { result: { 'wov-admin': 'timeout', 'wov-server': 'exit-code' } });
    pruefe(c3.rc !== 0 && !c3.weiter && c3.stderr.includes('wov-server (Result=exit-code)') && !c3.stderr.includes('Endstand nicht gespeichert — wov-admin') && !/nicht gespeichert[^\n]*wov-admin/.test(c3.stderr), 'wov-admin timeout + wov-server exit-code: Abbruch, Grund ist der Spielserver', c3.stderr);

    // Empty Result of the game server = unknown, not an error.
    const leer = stoppLauf('leer-result', { result: { 'wov-server': '' } });
    pruefe(leer.rc === 0 && leer.weiter && leer.starts === 0, 'wov-server: leeres Result = unbekannt, kein Abbruch', `rc=${leer.rc} ${leer.stderr}`);

    // B2: the game server was already failed BEFORE the rollout; the clean stop must not abort for the old Result.
    const alt = stoppLauf('b2-vorher-failed', { vorherResult: { 'wov-server': 'exit-code' } });
    pruefe(alt.rc === 0 && alt.weiter && alt.starts === 0, 'wov-server war schon vor dem Rollout gescheitert, neuer Stopp sauber: kein Abbruch', `rc=${alt.rc} ${alt.stderr}`);
    const resetIdx = alt.log.findIndex((z) => z.startsWith('reset-failed'));
    pruefe(alt.resetFailed === 1 && resetIdx >= 0 && resetIdx < alt.log.findIndex((z) => z.startsWith('stop ')), 'reset-failed kommt vor dem ersten Stopp (genau einmal im sauberen Lauf)', alt.log.join(' | '));
    // ... but a REAL failure at this stop after a stale one still aborts.
    const alt2 = stoppLauf('b2-vorher-und-jetzt', { vorherResult: { 'wov-server': 'signal' }, result: { 'wov-server': 'exit-code' } });
    pruefe(alt2.rc !== 0 && !alt2.weiter && alt2.stderr.includes('wov-server (Result=exit-code)'), 'wov-server vorher failed UND jetzt exit-code: Abbruch mit dem neuen Result', `rc=${alt2.rc} ${alt2.stderr}`);

    // (c) clean stop: flow as before (4 stops, no start in the stop step, continues).
    const d = stoppLauf('d-sauber', { journal: 'Sep 26 10:00:01 dev wov-server[1]: Gestoppt, Welt gespeichert\n' });
    pruefe(d.rc === 0 && d.weiter, 'sauberer Stopp: Ablauf geht weiter, rc=0', `rc=${d.rc} ${d.stderr}`);
    pruefe(d.stopps === 4 && d.starts === 0 && d.resetFailed === 1, 'sauberer Stopp: 4 Stopps, kein Start, reset-failed nur einmal (vor dem Stopp)', `stopps=${d.stopps} starts=${d.starts}`);
    pruefe(!d.stderr.includes('ABBRUCH'), 'sauberer Stopp: keine Abbruchmeldung', d.stderr);

    // The journal line of an EARLIER run (before this stop) must not count: the fake prints
    // nothing for a --since window that starts now; a plain empty journal is the clean case.
    const e = stoppLauf('e-leer');
    pruefe(e.rc === 0 && e.weiter, 'leeres Journal, alles success: kein Abbruch', `rc=${e.rc}`);

    // A start that fails on the way back: the message says so and there is no second try.
    const f = stoppLauf('f-start-fehlt', { result: { 'wov-server': 'exit-code' }, startFehlt: 'wov-client' });
    pruefe(f.rc !== 0 && f.starts === 4 && f.stderr.includes('Nicht alle Dienste liessen sich starten') && f.gesundheit === 0, 'Rueckweg: scheitert ein Start, steht das in der Meldung, es gibt keinen zweiten Versuch', `starts=${f.starts} ${f.stderr}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ── K5.7 N3, Stufe 1: die installierten Units werden vor jeder Aenderung gegen origin/main geprueft ──
const unitBlock = ausschnitt(update, 'unit-pruefung');
pruefe(unitBlock !== null, 'wov-update.sh markiert unit-pruefung genau einmal (BEGIN/END unit-pruefung)');
{
  // Line numbers of real code lines (comment lines and text mentions do not count).
  const zl = update.split('\n');
  const zeile = (re: RegExp) => zl.findIndex((z) => re.test(z));
  const aufruf = zl.filter((z) => /^\s*unit_pruefung \|\| exit 1\s*$/.test(z));
  pruefe(aufruf.length === 1, 'genau ein Aufruf "unit_pruefung || exit 1" (Stufe 1)', `${aufruf.length}`);
  const iAufruf = zeile(/^\s*unit_pruefung \|\| exit 1\s*$/);
  const iSchmutz = zeile(/^SCHMUTZ="\$\(git status --porcelain\)"/);
  const iVorher = zeile(/^\s*export WOV_UPDATE_VORHER=/);
  const iPull = zeile(/^\s*git merge --ff-only "\$GEPRUEFTER_STAND"\s*$/);
  const pullZeilen = zl.filter((z) => /^\s*git pull\b/.test(z));
  pruefe(pullZeilen.length === 0 && iPull >= 0, 'S-5: Stufe 1 holt keinen neuen Stand (kein "git pull"), sie nimmt genau den geprueften Commit (git merge --ff-only "$GEPRUEFTER_STAND")', pullZeilen.join(' | '));
  const iStopp = zeile(/^dienste_stoppen\s*$/);
  pruefe(iSchmutz >= 0 && iAufruf > iSchmutz && iVorher > iAufruf && iPull > iAufruf && iStopp > iAufruf, 'Stufe 1: die Unit-Pruefung steht nach der Sauberkeitspruefung und VOR dem Pull und vor dienste_stoppen', `${iSchmutz} ${iAufruf} ${iVorher} ${iPull} ${iStopp}`);
  const iEnv = zeile(/^\. "\$ENV_DATEI"\s*$/);
  const iUnset = zeile(/^unset WOV_WELT_VERZEICHNIS WOV_ADMIN_URL\s*$/);
  const iTests = zeile(/^echo "▶ Tests"\s*$/);
  const iTor = zeile(/^node scripts\/run-tests\.mjs 2>&1 \| tee /);
  pruefe(iEnv >= 0 && iUnset > iEnv && iUnset > iTests && iTor > iUnset, 'unset der Welt-Variablen steht nach dem Laden von /etc/wov.env und vor dem Test-Tor', `${iEnv} ${iTests} ${iUnset} ${iTor}`);
  // N4 S-1: the post-start check runs in the update path only (flag set directly before the last health check).
  const gesundZeilen = zl.map((z, i) => [z, i] as const).filter(([z]) => /^gesundheit_pruefen(\s+#.*)?$/.test(z));
  const letzte = gesundZeilen.length > 0 ? gesundZeilen[gesundZeilen.length - 1]![1] : -1;
  pruefe(letzte > 0 && /^WELT_LAUFZEIT_PRUEFEN=1\s*$/.test(zl[letzte - 1] ?? ''), 'S-1: WELT_LAUFZEIT_PRUEFEN=1 steht direkt vor dem letzten gesundheit_pruefen (Update-Weg, Stufe 2)', zl[letzte - 1] ?? '');
  pruefe(zl.filter((z) => /^\s*WELT_LAUFZEIT_PRUEFEN=1\b/.test(z)).length === 1, 'S-1: WELT_LAUFZEIT_PRUEFEN=1 wird genau einmal gesetzt (Rueckweg und Neustart nach Abbruch pruefen die Welt nicht)');
}
if (ausfuehren && unitBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'unit-pruefung-'));
  try {
    const bash = ['/usr/bin/bash', '/bin/bash'].find((p) => existsSync(p)) ?? 'bash';
    const repo = join(temp, 'repo');
    const verz = join(temp, 'etc-units');
    const fakeBin = join(temp, 'bin');
    const zustand = join(temp, 'zustand');
    for (const d of [repo, verz, fakeBin, zustand]) mkdirSync(d, { recursive: true });
    const UNITS = ['wov-server', 'wov-admin', 'wov-sicherung'];
    const unitText = (u: string) => `[Service]\nEnvironment=WOV_WELT_VERZEICHNIS=/var/lib/wov/welten\nExecStart=/bin/true # ${u}\n`;
    mkdirSync(join(repo, 'deploy/systemd'), { recursive: true });
    for (const u of UNITS) writeFileSync(join(repo, 'deploy/systemd', `${u}.service`), unitText(u));
    const git = (...a: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: repo, encoding: 'utf8', env: SAUBERE_UMGEBUNG });
      pruefe(r.status === 0, `Unit-Probe Vorbereitung git ${a[0]}`, r.stderr);
    };
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'x');
    git('branch', 'stand-a');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git('add', 'b.txt');
    git('commit', '-q', '--no-verify', '-m', 'b');
    git('branch', 'stand-b');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git('add', 'c.txt');
    git('commit', '-q', '--no-verify', '-m', 'c');
    git('branch', 'stand-c');
    git('reset', '-q', '--hard', 'stand-b');
    git('update-ref', 'refs/remotes/origin/main', 'stand-b');
    // Fake systemctl: `show -p <Eigenschaft> --value <Unit>` liest <zustand>/<Unit>.<Eigenschaft>, sonst die Vorgabe (alles in Ordnung).
    writeFileSync(
      join(fakeBin, 'systemctl'),
      `#!${bash}\n[ "$1" = daemon-reload ] && echo reload >> "${zustand}/reload.log"\nif [ "$3" = EnvironmentFiles ] && [ "$5" = wov-sicherung ] && [ -f "${zustand}/verschiebe" ]; then git -C "${repo}" update-ref refs/remotes/origin/main refs/heads/stand-c; fi\nf="${zustand}/$5.$3"\nif [ -f "$f" ]; then cat "$f"; [ -f "$f.rc" ] && exit "$(cat "$f.rc")"; exit 0; fi\ncase "$3" in NeedDaemonReload) echo no;; DropInPaths) ;; Environment) echo "WOV_INSTANZ=dev WOV_WELT_VERZEICHNIS=/var/lib/wov/welten";; esac\n`,
    );
    chmodSync(join(fakeBin, 'systemctl'), 0o755);
    const alleInstallieren = () => {
      for (const u of UNITS) writeFileSync(join(verz, `${u}.service`), unitText(u));
      for (const d of readdirSync(zustand)) rmSync(join(zustand, d), { force: true });
    };
    const setze = (u: string, eigenschaft: string, inhalt: string) => writeFileSync(join(zustand, `${u}.${eigenschaft}`), `${inhalt}\n`);
    const lauf = (extra: Record<string, string> = {}, danach = '') =>
      spawnSync(bash, ['-c', `set -euo pipefail\n${unitBlock}\n# END unit-pruefung\nunit_pruefung || exit 1\necho MARKER_WEITER\n${danach}`], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...SAUBERE_UMGEBUNG, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, WOV_UNIT_VERZEICHNIS: verz, WOV_KAEFIG: '1', ...extra },
      });
    const abbruch = (name: string, r: ReturnType<typeof lauf>, unit: string, befehl: RegExp) =>
      pruefe(r.status === 1 && !r.stdout.includes('MARKER_WEITER') && r.stderr.includes('ABBRUCH (Stufe 1)') && r.stderr.includes('NICHTS getan') && r.stderr.includes(unit) && befehl.test(r.stderr), name, `rc=${r.status} ${r.stderr}`);

    alleInstallieren();
    const ok = lauf();
    pruefe(ok.status === 0 && ok.stdout.includes('MARKER_WEITER') && !ok.stderr.includes('ABBRUCH'), 'Units: alles passt, das Skript laeuft weiter', `rc=${ok.status} ${ok.stderr}`);

    writeFileSync(join(verz, 'wov-admin.service'), unitText('wov-admin').replace('/var/lib/wov/welten', '/anderswo'));
    abbruch('Units: installierte Datei weicht von origin/main ab: Abbruch, nennt Unit und den Installationsbefehl', lauf(), 'wov-admin', /git -C \/opt\/worldofvikings show [0-9a-f]{40}:deploy\/systemd\/wov-admin\.service .*install -m 644 .*wov-admin\.service.*daemon-reload/);
    alleInstallieren();

    rmSync(join(verz, 'wov-server.service'));
    abbruch('Units: installierte Datei fehlt: Abbruch', lauf(), 'wov-server', /install -m 644/);
    alleInstallieren();

    setze('wov-sicherung', 'NeedDaemonReload', 'yes');
    abbruch('Units: NeedDaemonReload=yes (Datei gleich, aber nicht neu geladen): Abbruch mit daemon-reload', lauf(), 'wov-sicherung', /NeedDaemonReload=yes[\s\S]*systemctl daemon-reload/);
    alleInstallieren();

    setze('wov-server', 'Environment', 'WOV_INSTANZ=dev');
    setze('wov-server', 'DropInPaths', '/etc/systemd/system/wov-server.service.d/leer.conf');
    abbruch('Units: ein Drop-in leert die Variable (wirksame Umgebung ohne WOV_WELT_VERZEICHNIS): Abbruch', lauf(), 'wov-server', /kein WOV_WELT_VERZEICHNIS[\s\S]*Drop-in/);
    alleInstallieren();

    setze('wov-admin', 'Environment', 'WOV_INSTANZ=dev');
    abbruch('Units: Variable in der wirksamen Umgebung nicht gesetzt (ohne Drop-in): Abbruch', lauf(), 'wov-admin', /kein WOV_WELT_VERZEICHNIS/);
    alleInstallieren();

    setze('wov-admin', 'Environment', 'WOV_WELT_VERZEICHNIS=');
    abbruch('Units: Variable leer gesetzt: Abbruch', lauf(), 'wov-admin', /kein WOV_WELT_VERZEICHNIS/);
    alleInstallieren();

    setze('wov-admin', 'Environment', 'WOV_WELT_VERZEICHNIS=/fremd/welten');
    setze('wov-admin', 'DropInPaths', '/etc/systemd/system/wov-admin.service.d/x.conf');
    abbruch('Units: ein Drop-in setzt einen anderen Wert: Abbruch', lauf(), 'wov-admin', /wirksam '\/fremd\/welten'[\s\S]*Drop-ins/);
    alleInstallieren();

    setze('wov-server', 'DropInPaths', '/etc/systemd/system/wov-server.service.d/harmlos.conf');
    const harmlos = lauf();
    pruefe(harmlos.status === 0 && harmlos.stdout.includes('MARKER_WEITER'), 'Units: ein Drop-in, das die Variable nicht aendert, ist erlaubt', `rc=${harmlos.status} ${harmlos.stderr}`);
    alleInstallieren();

    setze('wov-server', 'NeedDaemonReload', '');
    writeFileSync(join(zustand, 'wov-server.NeedDaemonReload.rc'), '1\n');
    abbruch('Units: systemctl scheitert (Exit 1): Abbruch, nie stilles Weitermachen', lauf(), 'wov-server', /NeedDaemonReload/);
    alleInstallieren();

    // ── N4 S-2: wov-sicherung nur pruefen, wenn installiert ──
    rmSync(join(verz, 'wov-sicherung.service'));
    const ohneSich = lauf();
    pruefe(ohneSich.status === 0 && ohneSich.stdout.includes('MARKER_WEITER') && /WARNUNG:.*wov-sicherung.*nicht installiert/.test(ohneSich.stderr) && !ohneSich.stderr.includes('ABBRUCH'), 'S-2: wov-sicherung nicht installiert: Warnung, kein Abbruch', `rc=${ohneSich.status} ${ohneSich.stderr}`);
    rmSync(join(verz, 'wov-admin.service'));
    abbruch('S-2: wov-admin fehlt bleibt Pflicht (auch wenn wov-sicherung fehlt): Abbruch', lauf(), 'wov-admin', /install -m 644/);
    alleInstallieren();

    // ── N4 S-3: strengere Pruefung der wirksamen Umgebung ──
    setze('wov-server', 'Environment', 'WOV_WELT_VERZEICHNIS= ALT_WOV_WELT_VERZEICHNIS=/var/lib/wov/welten');
    abbruch('S-3: Teilwort ALT_WOV_WELT_VERZEICHNIS zaehlt nicht (der echte Schluessel ist leer): Abbruch', lauf(), 'wov-server', /kein WOV_WELT_VERZEICHNIS/);
    alleInstallieren();

    setze('wov-server', 'Environment', 'ALT_WOV_WELT_VERZEICHNIS=/var/lib/wov/welten');
    abbruch('S-3: nur das Teilwort in der Umgebung: Abbruch', lauf(), 'wov-server', /kein WOV_WELT_VERZEICHNIS/);
    alleInstallieren();

    setze('wov-server', 'Environment', 'WOV_INSTANZ=dev "WOV_WELT_VERZEICHNIS=/var/lib/wov/welten /fremd"');
    abbruch('S-3: Wert mit Leerzeichen wird ganz gelesen und weicht von der Unit-Datei ab: Abbruch, Meldung nennt den ganzen Wert', lauf(), 'wov-server', /wirksam '\/var\/lib\/wov\/welten \/fremd'/);
    alleInstallieren();

    setze('wov-admin', 'UnsetEnvironment', 'FOO WOV_WELT_VERZEICHNIS');
    abbruch('S-3: UnsetEnvironment nennt die Variable: Abbruch', lauf(), 'wov-admin', /UnsetEnvironment nennt WOV_WELT_VERZEICHNIS/);
    alleInstallieren();

    setze('wov-admin', 'UnsetEnvironment', 'ALT_WOV_WELT_VERZEICHNIS FOO');
    const unsetAnders = lauf();
    pruefe(unsetAnders.status === 0 && unsetAnders.stdout.includes('MARKER_WEITER'), 'S-3: UnsetEnvironment mit anderen Namen (Teilwort) ist erlaubt', `rc=${unsetAnders.status} ${unsetAnders.stderr}`);
    alleInstallieren();

    const envDatei = join(temp, 'wov.env');
    writeFileSync(envDatei, 'WOV_INSTANZ=dev\nWOV_WELT_VERZEICHNIS=/geheim-anderswo\n');
    setze('wov-admin', 'EnvironmentFiles', `${envDatei} (ignore_errors=no)`);
    const inEnv = lauf();
    abbruch('S-3: WOV_WELT_VERZEICHNIS steht in einer EnvironmentFile: Abbruch "Variable nie in wov.env"', inEnv, 'wov-admin', /Variable nie in wov\.env/);
    pruefe(!inEnv.stderr.includes('/geheim-anderswo') && !inEnv.stdout.includes('/geheim-anderswo'), 'S-3: der Inhalt der EnvironmentFile wird nie ausgegeben', inEnv.stderr);
    alleInstallieren();

    writeFileSync(envDatei, 'WOV_INSTANZ=dev\n# WOV_WELT_VERZEICHNIS=/auskommentiert\nALT_WOV_WELT_VERZEICHNIS=/teilwort\n');
    setze('wov-admin', 'EnvironmentFiles', `${envDatei} (ignore_errors=no)`);
    const envHarmlos = lauf();
    pruefe(envHarmlos.status === 0 && envHarmlos.stdout.includes('MARKER_WEITER'), 'S-3: eine EnvironmentFile ohne den Schluessel (nur Kommentar und Teilwort) ist erlaubt', `rc=${envHarmlos.status} ${envHarmlos.stderr}`);
    alleInstallieren();

    // Die Zerlegung selbst, mit Randfaellen (systemd quotiert Werte mit Leerraum).
    const zerlegt = (funktion: string, liste: string, schluessel: string) =>
      spawnSync(bash, ['-c', `set -euo pipefail\n${unitBlock}\n# END unit-pruefung\n${funktion} "$1" "$2"`, 'x', liste, schluessel], { encoding: 'utf8', env: SAUBERE_UMGEBUNG });
    const w1 = zerlegt('env_wert', 'A=1 "WOV_WELT_VERZEICHNIS=/a b/c" X=2', 'WOV_WELT_VERZEICHNIS');
    pruefe(w1.status === 0 && w1.stdout === '/a b/c\n', 'S-3: env_wert liest einen Wert mit Leerzeichen ganz', JSON.stringify(w1.stdout));
    const w2 = zerlegt('env_wert', 'ALT_WOV_WELT_VERZEICHNIS=/x', 'WOV_WELT_VERZEICHNIS');
    pruefe(w2.status === 1 && w2.stdout === '', 'S-3: env_wert: ein Teilwort ist kein Treffer (Exit 1)', `rc=${w2.status} ${JSON.stringify(w2.stdout)}`);
    const w3 = zerlegt('env_wert', 'WOV_WELT_VERZEICHNIS=/erst WOV_WELT_VERZEICHNIS=/zweit', 'WOV_WELT_VERZEICHNIS');
    pruefe(w3.status === 0 && w3.stdout === '/zweit\n', 'S-3: env_wert: bei doppeltem Schluessel gilt der letzte', JSON.stringify(w3.stdout));
    const w4 = zerlegt('env_wert', 'WOV_WELT_VERZEICHNIS=', 'WOV_WELT_VERZEICHNIS');
    pruefe(w4.status === 0 && w4.stdout === '\n', 'S-3: env_wert: ein leerer Wert ist ein Treffer mit leerem Wert', JSON.stringify(w4.stdout));
    const w5 = zerlegt('env_wert', '"WOV_WELT_VERZEICHNIS=/a\\"b\\\\c"', 'WOV_WELT_VERZEICHNIS');
    pruefe(w5.status === 0 && w5.stdout === '/a"b\\c\n', 'S-3: env_wert: \\" und \\\\ in Anfuehrungszeichen wie bei systemd', JSON.stringify(w5.stdout));
    const w6 = zerlegt('env_nennt', 'FOO ALT_WOV_WELT_VERZEICHNIS', 'WOV_WELT_VERZEICHNIS');
    pruefe(w6.status === 1, 'S-3: env_nennt: ein Teilwort ist kein Treffer', `rc=${w6.status}`);
    const w7 = zerlegt('env_nennt', 'FOO WOV_WELT_VERZEICHNIS=/x', 'WOV_WELT_VERZEICHNIS');
    pruefe(w7.status === 0, 'S-3: env_nennt: KEY=Wert zaehlt als Nennung', `rc=${w7.status}`);

    // ── N4 S-4: der Befehl der Abbruchmeldung schreibt nie eine leere Unit ──
    {
      writeFileSync(join(verz, 'wov-admin.service'), unitText('wov-admin').replace('/var/lib/wov/welten', '/anderswo'));
      const meldung = lauf();
      const befehl = /Befehl \([^)]*\): (bash -c '[^\n]*')\n/.exec(`${meldung.stderr}\n`);
      pruefe(befehl !== null && befehl[1]!.includes('set -o pipefail') && befehl[1]!.includes('test -s') && befehl[1]!.includes('install -m 644') && befehl[1]!.includes('git -C /opt/worldofvikings show'), 'S-4: der Befehl hat pipefail, git -C mit fester Wurzel, Nicht-leer-Pruefung und install -m 644', meldung.stderr);
      pruefe(!/Befehl \([^)]*\): sudo /.test(meldung.stderr) && meldung.stderr.includes('kein sudo noetig'), 'N5 (Karte, Punkt 6): der Befehl in der Abbruchmeldung steht ohne "sudo" (wov-update.sh laeuft an dieser Stelle schon als root)', meldung.stderr);
      if (befehl !== null) {
        const ziel = join(verz, 'wov-admin.service');
        const vorher = readFileSync(ziel, 'utf8');
        const ausfuehren = (cmd: string, pfad: string) => {
          rmSync(join(zustand, 'reload.log'), { force: true });
          return spawnSync(bash, ['-c', cmd], { encoding: 'utf8', cwd: '/', env: { ...SAUBERE_UMGEBUNG, PATH: `${pfad}:${process.env.PATH ?? ''}` } });
        };
        // (1) falscher Ordner / kein Repo: git scheitert, die Zieldatei bleibt, kein daemon-reload
        const keinRepo = join(temp, 'kein-repo');
        mkdirSync(keinRepo, { recursive: true });
        const f1 = ausfuehren(befehl[1]!.replace('/opt/worldofvikings', keinRepo), fakeBin);
        pruefe(f1.status !== 0 && readFileSync(ziel, 'utf8') === vorher && !existsSync(join(zustand, 'reload.log')), 'S-4: falscher Ordner: der Befehl schlaegt fehl, die Unit-Datei bleibt unveraendert (nicht leer), kein daemon-reload', `rc=${f1.status} ${f1.stderr}`);
        // (2) git liefert nichts (Exit 0, leere Ausgabe): Nicht-leer-Pruefung greift
        const leerBin = join(temp, 'leer-bin');
        mkdirSync(leerBin, { recursive: true });
        writeFileSync(join(leerBin, 'git'), `#!${bash}\nexit 0\n`);
        chmodSync(join(leerBin, 'git'), 0o755);
        const f2 = ausfuehren(befehl[1]!, `${leerBin}:${fakeBin}`);
        pruefe(f2.status !== 0 && readFileSync(ziel, 'utf8') === vorher && !existsSync(join(zustand, 'reload.log')), 'S-4: git liefert nichts: der Befehl schlaegt fehl, die Unit-Datei bleibt, kein daemon-reload', `rc=${f2.status} ${f2.stderr}`);
        // (4) richtiger Ordner: die Datei wird ersetzt, Modus 644, danach daemon-reload
        const f3 = ausfuehren(befehl[1]!.replace('/opt/worldofvikings', repo), fakeBin);
        pruefe(f3.status === 0 && readFileSync(ziel, 'utf8') === unitText('wov-admin') && (statSync(ziel).mode & 0o777) === 0o644 && existsSync(join(zustand, 'reload.log')), 'S-4: richtiger Ordner: Unit installiert (Inhalt gleich origin/main, Modus 644), danach daemon-reload', `rc=${f3.status} ${f3.stderr}`);
      }
      alleInstallieren();
    }

    // ── N4 S-5: genau der gepruefte Commit wird genommen, nicht ein neuer Pull ──
    {
      const mergeZeile = update.split('\n').find((z) => /^\s*git merge --ff-only "\$GEPRUEFTER_STAND"\s*$/.test(z)) ?? 'false # Zeile fehlt';
      git('reset', '-q', '--hard', 'stand-a');
      writeFileSync(join(zustand, 'verschiebe'), '1\n');
      const r = lauf({}, `${mergeZeile.trim()}\ngit rev-parse HEAD\ngit rev-parse refs/remotes/origin/main\necho STAND=$GEPRUEFTER_STAND`);
      const zeilen = r.stdout.trim().split('\n');
      const rev = (n: string) => spawnSync('git', ['rev-parse', n], { cwd: repo, encoding: 'utf8', env: SAUBERE_UMGEBUNG }).stdout.trim();
      const kopf = zeilen[zeilen.length - 3];
      const ursprung = zeilen[zeilen.length - 2];
      const gepr = (zeilen[zeilen.length - 1] ?? '').replace('STAND=', '');
      pruefe(r.status === 0 && ursprung === rev('stand-c') && gepr === rev('stand-b') && kopf === rev('stand-b'), 'S-5: origin/main wandert waehrend der Pruefung (stand-b -> stand-c): HEAD nimmt genau den geprueften Commit (stand-b), nicht den neuen', `rc=${r.status} kopf=${kopf} ursprung=${ursprung} gepr=${gepr} ${r.stderr}`);
      rmSync(join(zustand, 'verschiebe'), { force: true });
      git('reset', '-q', '--hard', 'stand-b');
      git('update-ref', 'refs/remotes/origin/main', 'stand-b');
      alleInstallieren();
    }

    // ── N4 S-6: der Pruefhaken wirkt nur mit der Testmarke des Kaefigs ──
    {
      const ohneMarke = lauf({ WOV_KAEFIG: '' });
      pruefe(ohneMarke.status === 1 && ohneMarke.stderr.includes('/etc/systemd/system/wov-server.service'), 'S-6: WOV_UNIT_VERZEICHNIS ohne Testmarke (WOV_KAEFIG=1) wirkt nicht: es wird /etc/systemd/system gelesen', `rc=${ohneMarke.status} ${ohneMarke.stderr}`);
      const mitMarke = lauf({ WOV_KAEFIG: '1' });
      pruefe(mitMarke.status === 0 && mitMarke.stdout.includes('MARKER_WEITER'), 'S-6: mit Testmarke wirkt der Haken', `rc=${mitMarke.status} ${mitMarke.stderr}`);
    }

    git('update-ref', '-d', 'refs/remotes/origin/main');
    abbruch('Units: origin/main nicht lesbar: Abbruch', lauf(), 'wov-server', /nicht lesbar/);
    git('update-ref', 'refs/remotes/origin/main', 'stand-b');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ── K5.7 N4/N5 S-1: Nachpruefung nach dem Start (wov-server UND wov-admin lesen dieselbe Welt aus
// WOV_WELT_VERZEICHNIS, gleich dem Wert in deploy/systemd/<u>.service des gepruepften Stands) ──
const weltBlock = ausschnitt(update, 'welt-laufzeit');
pruefe(weltBlock !== null, 'wov-update.sh markiert welt-laufzeit genau einmal (BEGIN/END welt-laufzeit)');
const gesundFn = /\ngesundheit_pruefen\(\) \{\n[\s\S]*?\n\}\n/.exec(update)?.[0] ?? null;
pruefe(gesundFn !== null && /^\s*welt_laufzeit_pruefen \|\| exit 1\s*$/m.test(gesundFn), 'S-1: gesundheit_pruefen ruft welt_laufzeit_pruefen und bricht bei Fehler ab (exit 1, der bestehende Weg nach #88)');
if (ausfuehren && weltBlock !== null && gesundFn !== null && unitBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'welt-laufzeit-'));
  try {
    const bash = ['/usr/bin/bash', '/bin/bash'].find((p) => existsSync(p)) ?? 'bash';
    const wurzel = join(temp, 'wurzel');
    const fakeBin = join(temp, 'bin');
    const zustand = join(temp, 'zustand');
    mkdirSync(join(wurzel, 'server/data'), { recursive: true });
    mkdirSync(join(wurzel, 'deploy/systemd'), { recursive: true });
    for (const d of [fakeBin, zustand]) mkdirSync(d, { recursive: true });
    writeFileSync(join(wurzel, 'server/data/server.yml'), 'server:\n  port: 0\n');
    // Ein Wert mit Leerzeichen braucht in einer echten Unit-Datei Anfuehrungszeichen (systemd-Quotierung),
    // sonst laesst env_wert/env_woerter (dieselbe Zerlegung wie bei "systemctl show") ihn am ersten
    // Leerzeichen abschneiden -- kein Fehler des Parsers, nur eine ungueltige Testvorlage ohne Quotes.
    const unitDatei = (wert: string) => `[Service]\nEnvironment="WOV_WELT_VERZEICHNIS=${wert}"\nExecStart=/bin/true\n`;
    writeFileSync(join(wurzel, 'deploy/systemd/wov-server.service'), unitDatei('/var/lib/wov/welten'));
    writeFileSync(join(wurzel, 'deploy/systemd/wov-admin.service'), unitDatei('/var/lib/wov/welten'));
    writeFileSync(join(fakeBin, 'systemctl'), `#!${bash}\nf="${zustand}/$5.$3"\nif [ -f "$f" ]; then cat "$f"; fi\nexit 0\n`);
    writeFileSync(join(fakeBin, 'curl'), `#!${bash}\necho 426\n`);
    writeFileSync(join(fakeBin, 'journalctl'), `#!${bash}\nexit 0\n`);
    const loggerLog = join(zustand, 'logger.log');
    writeFileSync(join(fakeBin, 'logger'), `#!${bash}\necho "$*" >> ${JSON.stringify(loggerLog)}\n`);
    for (const f of ['systemctl', 'curl', 'journalctl', 'logger']) chmodSync(join(fakeBin, f), 0o755);

    interface Optionen {
      adminEnv?: string[] | null; // null: kein wov-admin-Prozess wird gestartet (MainPID bleibt leer)
      serverPidDatei?: string; // literaler Inhalt statt der echten Kind-PID (fuer "0"/leer)
      adminPidDatei?: string;
      adminPidVerzoegert?: number; // Sekunden, nach denen die echte admin-PID erst geschrieben wird (Neustart-Luecke)
      frist?: string; // WOV_WELT_MAINPID_FRIST (nur mit WOV_KAEFIG=1 wirksam -- hier immer der Fall, s.o.)
      vorher?: string; // WOV_UPDATE_VORHER, fuer den Rueckweg-Text im Logger
    }
    const lauf = (serverEnv: string[], flag: string, opt: Optionen = {}) => {
      const q = (arr: string[]) => arr.map((e) => `'${e.replace(/'/g, `'\\''`)}'`).join(' ');
      rmSync(loggerLog, { force: true });
      // Frischer Zustand je Lauf: sonst saehe z.B. "nieBereit" (kein admin-Prozess) noch die
      // MainPID einer FRUEHEREN Probe im selben zustand-Ordner und liefe nicht in den Fehlerfall.
      for (const u of ['wov-server', 'wov-admin']) rmSync(join(zustand, `${u}.service.MainPID`), { force: true });
      const zeilen: string[] = [
        'set -euo pipefail',
        // welt_laufzeit_pruefen braucht env_wert (aus dem unit-pruefung-Block); unit_pruefung selbst wird hier nie
        // aufgerufen, ihre Definition ist harmlos mitgezogen.
        unitBlock as string,
        '# END unit-pruefung',
        weltBlock as string,
        '# END welt-laufzeit',
        gesundFn as string,
        'GESTARTET=(wov-server)',
        flag === '' ? '' : `WELT_LAUFZEIT_PRUEFEN=${flag}`,
        `env -i ${q(serverEnv)} sleep 300 & server_kid=$!`,
      ];
      if (opt.adminEnv !== null) zeilen.push(`env -i ${q(opt.adminEnv ?? serverEnv)} sleep 300 & admin_kid=$!`);
      else zeilen.push('admin_kid=');
      zeilen.push(
        'kids="$server_kid${admin_kid:+ $admin_kid}"',
        'trap \'for k in $kids; do kill "$k" 2>/dev/null || true; done; for k in $kids; do wait "$k" 2>/dev/null || true; done; lebt=0; for k in $kids; do kill -0 "$k" 2>/dev/null && lebt=1; done; if [ "$lebt" = 1 ]; then echo KIND_LEBT; else echo KIND_ENDE; fi\' EXIT',
        'for _ in $(seq 1 200); do ok=1; for k in $kids; do [ "$(cat /proc/$k/comm 2>/dev/null || true)" = sleep ] || ok=0; done; [ "$ok" = 1 ] && break; sleep 0.05; done',
        `echo "${opt.serverPidDatei ?? '$server_kid'}" > "${zustand}/wov-server.service.MainPID"`,
      );
      if (opt.adminEnv !== null && opt.adminPidVerzoegert) {
        // Datei bleibt bewusst fehlend (s. Node-seitiges rm oben), bis der Hintergrundjob sie nach der Verzoegerung schreibt.
        // Ohne die Umleitung haelt dieser abgehaengte Hintergrundjob die (von spawnSync geerbte) stdout/stderr-Pipe
        // offen, bis er selbst endet -- spawnSync wartete dann bis zum Ende der Verzoegerung, egal wie schnell
        // welt_laufzeit_pruefen wirklich war, und die gemessene Dauer bewiese gar nichts.
        zeilen.push(`(sleep ${opt.adminPidVerzoegert}; echo "$admin_kid" > "${zustand}/wov-admin.service.MainPID") >/dev/null 2>&1 & disown`);
      } else if (opt.adminEnv !== null) {
        zeilen.push(`echo "${opt.adminPidDatei ?? '$admin_kid'}" > "${zustand}/wov-admin.service.MainPID"`);
      } else if (opt.adminPidDatei !== undefined) {
        zeilen.push(`echo "${opt.adminPidDatei}" > "${zustand}/wov-admin.service.MainPID"`);
      }
      zeilen.push('gesundheit_pruefen', 'echo GESUND_OK');
      const skript = zeilen.filter((z) => z !== '').join('\n');
      const r = spawnSync(bash, ['-c', skript], {
        cwd: wurzel,
        encoding: 'utf8',
        env: { ...SAUBERE_UMGEBUNG, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, ...(opt.frist ? { WOV_WELT_MAINPID_FRIST: opt.frist } : {}), ...(opt.vorher ? { WOV_UPDATE_VORHER: opt.vorher } : {}) },
      });
      const journal = existsSync(loggerLog) ? readFileSync(loggerLog, 'utf8') : '';
      return { ...r, journal };
    };
    const ende = (r: ReturnType<typeof lauf>) => r.stdout.includes('KIND_ENDE') && !r.stdout.includes('KIND_LEBT');

    const ok = lauf(['WOV_INSTANZ=dev', 'WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1');
    pruefe(
      ok.status === 0 &&
        ok.stdout.includes('GESUND_OK') &&
        /✓ wov-server \(PID \d+\) liest die Welt aus WOV_WELT_VERZEICHNIS=\/var\/lib\/wov\/welten/.test(ok.stdout) &&
        /✓ wov-admin \(PID \d+\) liest die Welt aus WOV_WELT_VERZEICHNIS=\/var\/lib\/wov\/welten/.test(ok.stdout) &&
        ok.journal === '' &&
        ende(ok),
      'N5/S-1: wov-server UND wov-admin haben die Variable, gleich deploy/systemd/*.service: beide gruen, kein Journal-Eintrag',
      `rc=${ok.status} ${ok.stdout} ${ok.stderr}`,
    );
    const leerzeichen = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/we lten'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/var/lib/wov/we lten'] });
    pruefe(leerzeichen.status !== 0 && leerzeichen.stderr.includes('weicht von deploy/systemd/wov-server.service'), 'N5: ein Wert mit Leerzeichen wird ganz gelesen, weicht aber vom Vorgabewert /var/lib/wov/welten in deploy/systemd ab: rot', `rc=${leerzeichen.status} ${leerzeichen.stderr}`);
    // Dieselbe Probe mit passender Vorgabedatei (Wert mit Leerzeichen auch dort): gruen.
    writeFileSync(join(wurzel, 'deploy/systemd/wov-server.service'), unitDatei('/var/lib/wov/we lten'));
    writeFileSync(join(wurzel, 'deploy/systemd/wov-admin.service'), unitDatei('/var/lib/wov/we lten'));
    const leerzeichenOk = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/we lten'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/var/lib/wov/we lten'] });
    pruefe(leerzeichenOk.status === 0 && leerzeichenOk.stdout.includes('WOV_WELT_VERZEICHNIS=/var/lib/wov/we lten'), 'N5: ein Wert mit Leerzeichen wird ganz gelesen (und gleicht hier der Vorgabe): gruen', `rc=${leerzeichenOk.status} ${leerzeichenOk.stdout}`);
    writeFileSync(join(wurzel, 'deploy/systemd/wov-server.service'), unitDatei('/var/lib/wov/welten'));
    writeFileSync(join(wurzel, 'deploy/systemd/wov-admin.service'), unitDatei('/var/lib/wov/welten'));

    const rot = (name: string, r: ReturnType<typeof lauf>, muster: RegExp) =>
      pruefe(r.status === 1 && !r.stdout.includes('GESUND_OK') && muster.test(r.stderr) && r.stderr.includes('welt-einbau.md') && ende(r), name, `rc=${r.status} ${r.stdout} ${r.stderr}`);
    rot('N5: wov-server hat die Variable nicht: rot, kein Weiter', lauf(['WOV_INSTANZ=dev'], '1'), /wov-server.*KEIN WOV_WELT_VERZEICHNIS/s);
    rot('N5: nur das Teilwort ALT_WOV_WELT_VERZEICHNIS bei wov-server: rot', lauf(['ALT_WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1'), /wov-server.*KEIN WOV_WELT_VERZEICHNIS/s);
    rot('N5: die Variable ist bei wov-server leer: rot', lauf(['WOV_WELT_VERZEICHNIS='], '1'), /wov-server.*KEIN WOV_WELT_VERZEICHNIS/s);
    rot('N5: die Variable ist bei wov-server relativ: rot', lauf(['WOV_WELT_VERZEICHNIS=welten'], '1'), /wov-server.*KEIN WOV_WELT_VERZEICHNIS/s);

    // ── N4-1: "irgendein absoluter Pfad" reicht nicht mehr; der Wert muss dem aus deploy/systemd gleichen ──
    const w2 = lauf(['WOV_WELT_VERZEICHNIS=/anderswo-aus-wov-env'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/anderswo-aus-wov-env'] });
    rot('N4-1 (Probe W2 des Angreifers): wov-server UND wov-admin lesen /anderswo statt deploy/systemd (/var/lib/wov/welten): rot, kein VERSION-Schreibpfad erreicht (GESUND_OK fehlt)', w2, /wov-server.*weicht von deploy\/systemd\/wov-server\.service \(\/var\/lib\/wov\/welten\)/s);
    pruefe(w2.stderr.includes('wov-admin') && w2.stderr.includes('weicht von deploy/systemd/wov-admin.service'), 'N4-1: die Meldung nennt auch wov-admin namentlich', w2.stderr);

    // ── N4-1: wov-admin weicht ab (der alte Code fragte wov-admin gar nicht) ──
    const adminAb = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/fremd/welten'] });
    rot('N4-1: wov-admin liest eine andere Welt als wov-admin.service vorsieht: rot, wov-server allein reicht nicht mehr aus', adminAb, /wov-admin.*weicht von deploy\/systemd\/wov-admin\.service/s);

    // ── N4-1: beide Units je fuer sich gleich ihrer eigenen deploy/systemd-Datei, aber untereinander verschieden ──
    writeFileSync(join(wurzel, 'deploy/systemd/wov-admin.service'), unitDatei('/verschieden/welten'));
    const untereinander = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/verschieden/welten'] });
    rot('N4-1: "der Wert muss bei beiden gleich sein": wov-admin weicht von wov-server ab, obwohl beide ihrer je eigenen Unit-Datei gleichen', untereinander, /wov-admin.*weicht von wov-server/s);
    writeFileSync(join(wurzel, 'deploy/systemd/wov-admin.service'), unitDatei('/var/lib/wov/welten'));

    // ── N4-6: MainPID 0 (Neustart-Luecke) wird bis zur Frist erneut geprueft, nicht sofort gemeldet ──
    const startZeit = Date.now();
    const erholtSich = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1', {
      adminEnv: ['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'],
      adminPidVerzoegert: 2,
      frist: '5',
    });
    const erholtDauer = Date.now() - startZeit;
    pruefe(erholtSich.status === 0 && erholtSich.stdout.includes('GESUND_OK') && erholtDauer >= 1500, 'N4-6: MainPID von wov-admin ist zunaechst leer und wird erst nach ~2s gueltig: die Nachpruefung wartet (mind. 1,5s gemessen) und wird dann gruen, kein sofortiger Abbruch', `rc=${erholtSich.status} dauer=${erholtDauer}ms ${erholtSich.stdout} ${erholtSich.stderr}`);
    const nieBereit = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1', { adminEnv: null, frist: '1' });
    pruefe(nieBereit.status === 1 && !nieBereit.stdout.includes('GESUND_OK') && nieBereit.stderr.includes('wov-admin hat keine MainPID'), 'N4-6: wov-admin bleibt ohne MainPID (kein Prozess): nach der Frist ein klarer Fehler, kein stilles Uebergehen', `rc=${nieBereit.status} ${nieBereit.stderr}`);

    const keinPid = lauf(['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/var/lib/wov/welten'], serverPidDatei: '0', frist: '1' });
    pruefe(keinPid.status === 1 && !keinPid.stdout.includes('GESUND_OK') && keinPid.stderr.includes('wov-server hat keine MainPID') && ende(keinPid), 'S-1: MainPID 0 bei wov-server, dauerhaft: Fehler statt stillem Weiter', `rc=${keinPid.status} ${keinPid.stderr}`);

    // ── N4-5: Journal-Zeile bei gescheiterter Weltpruefung, mit klarem Text und Rueckweg ──
    const mitJournal = lauf(['WOV_WELT_VERZEICHNIS=/anderswo'], '1', { adminEnv: ['WOV_WELT_VERZEICHNIS=/anderswo'], vorher: 'altstand1234' });
    pruefe(
      mitJournal.status === 1 &&
        /^-t wov-update /.test(mitJournal.journal) &&
        mitJournal.journal.includes('Dienste laufen, aber auf falscher Welt') &&
        mitJournal.journal.includes('Units pruefen') &&
        mitJournal.journal.includes('Rueckweg') &&
        mitJournal.journal.includes('altstand1234'),
      'N4-5: bei gescheiterter Weltpruefung schreibt das Skript eine Journalzeile (logger -t wov-update) mit dem Text "Dienste laufen, aber auf falscher Welt; Units pruefen, Rueckweg: …" und dem Stand aus WOV_UPDATE_VORHER',
      `journal=${JSON.stringify(mitJournal.journal)}`,
    );
    pruefe(ok.journal === '' && leerzeichenOk.journal === '', 'N4-5: bei gruener Weltpruefung wird NICHTS ins Journal geschrieben', `${JSON.stringify(ok.journal)} ${JSON.stringify(leerzeichenOk.journal)}`);

    const ohneFlag = lauf(['WOV_INSTANZ=dev'], '', { adminEnv: ['WOV_INSTANZ=dev'] });
    pruefe(ohneFlag.status === 0 && ohneFlag.stdout.includes('GESUND_OK') && !ohneFlag.stdout.includes('liest die Welt') && ohneFlag.journal === '' && ende(ohneFlag), 'S-1: ohne WELT_LAUFZEIT_PRUEFEN (Rueckweg, Neustart nach Abbruch) wird die Welt-Umgebung nicht geprueft', `rc=${ohneFlag.status} ${ohneFlag.stdout} ${ohneFlag.stderr}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ── N5 (N4-4): WOV_KAEFIG und WOV_UNIT_VERZEICHNIS wirken nur aus der Aufrufumgebung, nie aus /etc/wov.env ──
const envSourcenBlock = ausschnitt(update, 'wov-env-sourcen');
pruefe(envSourcenBlock !== null, 'wov-update.sh markiert wov-env-sourcen genau einmal (BEGIN/END wov-env-sourcen)');
if (ausfuehren && envSourcenBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'env-sourcen-'));
  try {
    const envDatei = join(temp, 'wov.env');
    writeFileSync(envDatei, 'WOV_INSTANZ=dev\nWOV_KAEFIG=0\nWOV_UNIT_VERZEICHNIS=/von-wov-env\n');
    // Diese Testdatei laeuft selbst im Kaefig (WOV_KAEFIG=1 in der Aufrufumgebung des ganzen Laufs):
    // die Basisumgebung fuer den "Aufrufer hat nichts gesetzt"-Fall muss beide Variablen deshalb explizit
    // entfernen, sonst wuerde der Kaefig der aeusseren Probe selbst als "vom Aufrufer gesetzt" durchgehen.
    const OHNE_KAEFIG_MARKEN: NodeJS.ProcessEnv = { ...SAUBERE_UMGEBUNG };
    delete OHNE_KAEFIG_MARKEN.WOV_KAEFIG;
    delete OHNE_KAEFIG_MARKEN.WOV_UNIT_VERZEICHNIS;
    const lauf = (extra: Record<string, string> = {}) => {
      const skript = ['set -euo pipefail', `ENV_DATEI=${JSON.stringify(envDatei)}`, envSourcenBlock as string, 'echo "INSTANZ=${WOV_INSTANZ-X}"', 'echo "KAEFIG=${WOV_KAEFIG-X}"', 'echo "VERZ=${WOV_UNIT_VERZEICHNIS-X}"'].join('\n');
      return spawnSync('bash', ['-c', skript], { encoding: 'utf8', env: { ...OHNE_KAEFIG_MARKEN, ...extra } });
    };
    const ohne = lauf();
    pruefe(
      ohne.status === 0 && ohne.stdout.includes('INSTANZ=dev') && ohne.stdout.includes('KAEFIG=X') && ohne.stdout.includes('VERZ=X'),
      'N4-4: WOV_KAEFIG und WOV_UNIT_VERZEICHNIS aus /etc/wov.env wirken NICHT, wenn der Aufrufer sie nicht selbst gesetzt hat (WOV_INSTANZ aus wov.env schon)',
      `${ohne.stdout} ${ohne.stderr}`,
    );
    const mit = lauf({ WOV_KAEFIG: '1', WOV_UNIT_VERZEICHNIS: '/vom-aufrufer' });
    pruefe(
      mit.status === 0 && mit.stdout.includes('KAEFIG=1') && mit.stdout.includes('VERZ=/vom-aufrufer'),
      'N4-4: eigene WOV_KAEFIG/WOV_UNIT_VERZEICHNIS des Aufrufers bleiben nach dem Sourcen von wov.env erhalten (nicht der abweichende Wert aus wov.env)',
      `${mit.stdout} ${mit.stderr}`,
    );
    const leerAufrufer = lauf({ WOV_KAEFIG: '' });
    pruefe(leerAufrufer.status === 0 && leerAufrufer.stdout.split('\n').includes('KAEFIG='), 'N4-4: ein leer (aber) gesetztes WOV_KAEFIG des Aufrufers bleibt leer, nicht der Wert 1 aus wov.env', leerAufrufer.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ── N5 (N4-3/N4-5): der Merge nimmt genau den gepruepften Stand, HEAD wird danach verifiziert, und
// WOV_UPDATE_VORHER verliert den Rueckweg nicht, wenn ein frueherer Lauf schon gemergt hat ──
const mergeBlock = ausschnitt(update, 'merge-gepruefter-stand');
pruefe(mergeBlock !== null, 'wov-update.sh markiert merge-gepruefter-stand genau einmal (BEGIN/END merge-gepruefter-stand)');
if (ausfuehren && mergeBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'merge-stand-'));
  try {
    const bash = ['/usr/bin/bash', '/bin/bash'].find((p) => existsSync(p)) ?? 'bash';
    const repo = join(temp, 'repo');
    const fakeBin = join(temp, 'bin');
    mkdirSync(repo, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    const git = (...a: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: repo, encoding: 'utf8', env: SAUBERE_UMGEBUNG });
      pruefe(r.status === 0, `Merge-Probe Vorbereitung git ${a[0]}`, r.stderr);
      return r.stdout.trim();
    };
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'a');
    const standA = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'b');
    const standB = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', standB);
    git('reset', '-q', '--hard', standA);
    writeFileSync(join(fakeBin, 'systemctl'), `#!${['/usr/bin/bash', '/bin/bash'].find((p) => existsSync(p)) ?? 'bash'}\nexit 0\n`);
    chmodSync(join(fakeBin, 'systemctl'), 0o755);
    // unit_pruefung wird durch eine gruene Attrappe ersetzt: dieser Block prueft nur, was NACH ihr passiert.
    const lauf = (versionInhalt: string | null, danach: string) => {
      const versionDatei = join(temp, 'VERSION');
      if (versionInhalt !== null) writeFileSync(versionDatei, versionInhalt);
      else rmSync(versionDatei, { force: true });
      const skript = [
        'set -euo pipefail',
        `WURZEL=${JSON.stringify(repo)}`,
        `VERSION_DATEI=${JSON.stringify(versionDatei)}`,
        // Attrappe fuer die echte unit_pruefung: sie setzt (genau wie das Original) GEPRUEFTER_STAND und ist sonst gruen.
        `unit_pruefung() { GEPRUEFTER_STAND="$(git rev-parse --verify -q "origin/main^{commit}" 2>/dev/null)" || GEPRUEFTER_STAND=""; return 0; }`,
        'version_feld() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2-; }',
        mergeBlock as string,
        danach,
      ].join('\n');
      return spawnSync(bash, ['-c', skript], { cwd: repo, encoding: 'utf8', env: { ...SAUBERE_UMGEBUNG, PATH: `${fakeBin}:${process.env.PATH ?? ''}` } });
    };

    // (1) Normalfall: HEAD wandert von A nach B, VORHER = A (aus HEAD, nicht aus VERSION).
    const normal = lauf('WOV_VERSION_COMMIT=irrelevant999999\n', 'echo "HEAD=$(git rev-parse HEAD)"\necho "VORHER=$WOV_UPDATE_VORHER"\necho MARKER_WEITER');
    pruefe(normal.status === 0 && normal.stdout.includes(`HEAD=${standB}`) && normal.stdout.includes(`VORHER=${standA}`) && normal.stdout.includes('MARKER_WEITER'), 'N4-3 Normalfall: HEAD landet auf dem gepruepften Stand (B), WOV_UPDATE_VORHER ist das vorherige HEAD (A)', `rc=${normal.status} ${normal.stdout} ${normal.stderr}`);
    git('reset', '-q', '--hard', standA);

    // (2) N4-3 (Probe K_lokal_voraus des Angreifers): origin/main bewegt sich NICHT (bleibt A), aber der Checkout hat
    // einen lokalen, nie gepushten Commit obendrauf. "git merge --ff-only A" ist dann ein No-Op ("Already up to
    // date", HEAD bleibt beim lokalen Commit stehen) -- ohne den expliziten HEAD-Vergleich waere das GRUEN.
    git('update-ref', 'refs/remotes/origin/main', standA);
    writeFileSync(join(repo, 'lokal.txt'), 'x\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'lokal, nie gepusht');
    const standLokal = git('rev-parse', 'HEAD');
    const lokal = lauf(null, 'echo VOR_HEAD=$(git rev-parse HEAD)\necho MARKER_WEITER');
    pruefe(lokal.status === 1 && !lokal.stdout.includes('MARKER_WEITER') && lokal.stderr.includes('ABBRUCH (Stufe 1)') && lokal.stderr.includes('nicht der geprüfte Stand') && lokal.stderr.includes('NICHTS getan'), 'N4-3: lokaler Commit voraus (origin/main bewegt sich nicht, "git merge --ff-only" ist ein No-Op): Abbruch, bevor irgendetwas gestoppt wird', `rc=${lokal.status} ${lokal.stdout} ${lokal.stderr}`);
    pruefe(git('rev-parse', 'HEAD') === standLokal, 'N4-3: der Baum bleibt unveraendert auf dem lokalen Commit (kein Zuruecksetzen, kein weiterer Merge)', git('rev-parse', 'HEAD'));
    git('update-ref', 'refs/remotes/origin/main', standB);
    git('reset', '-q', '--hard', standA);

    // (3) N4-5: ein frueherer Lauf hat schon gemergt (HEAD == B), aber VERSION nennt noch A (die Weltpruefung
    // war nie gruen) -> WOV_UPDATE_VORHER bleibt A, nicht B (sonst zeigte "zurueck" auf sich selbst).
    git('reset', '-q', '--hard', standB);
    const zweiterLauf = lauf(`WOV_VERSION_COMMIT=${standA}\nWOV_VERSION_VORHER=${standA}\n`, 'echo "HEAD=$(git rev-parse HEAD)"\necho "VORHER=$WOV_UPDATE_VORHER"\necho MARKER_WEITER');
    pruefe(
      zweiterLauf.status === 0 && zweiterLauf.stdout.includes(`HEAD=${standB}`) && zweiterLauf.stdout.includes(`VORHER=${standA}`) && zweiterLauf.stdout.includes('MARKER_WEITER') && zweiterLauf.stdout.includes('frueherer Lauf hat schon gemergt'),
      'N4-5: zweiter Lauf nach einem gemergten, aber nie gruen geprueften Rollout: WOV_UPDATE_VORHER bleibt der zuletzt bestaetigte Stand aus VERSION (A), nicht das schon verschobene HEAD (B)',
      `rc=${zweiterLauf.status} ${zweiterLauf.stdout} ${zweiterLauf.stderr}`,
    );
    git('reset', '-q', '--hard', standA);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
if (IM_KAEFIG) console.log(`KAEFIG-PROBE OK=${gruen}`);
console.log('\nvorschau-nicht-getrackt: alles gruen');
