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
 *      am selben Ausschnitt geprueft; die Aufrufstellen des Flags per Zeilen-
 *      Regex als exakte Befehlsfolge von Schritt 7b bis 8.
 *
 * Lauf:  npx tsx tools/test/vorschau-nicht-getrackt.ts
 *
 * The preview bundle is a build product: it must be git-ignored, must be the
 * path wov-update.sh builds, and the script must warn about a dirty tree
 * after the web build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
if (block !== null) {
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

// ── Aufrufstellen per Zeilen-Regex, nicht per Textsuche ──
// A plain indexOf hit a comment once. Here: the 7b spine (everything from the
// flag to the flag reset after step 8), with comments, blank lines and the
// marked blocks taken out, must be exactly this list of top-level commands.
// A flag inside `if false`, a moved or placeholder bundle check, a deleted
// step 8 or a flag set before the tests all break the list.
const zeilen = update.split('\n');
const zeile = (re: RegExp): number[] => zeilen.flatMap((z, i) => (re.test(z) ? [i] : []));
const testZeilen = zeile(/^node scripts\/run-tests\.mjs 2>&1 \| tee /);
const flagSetzen = zeile(/^NEUSTART_BEI_ABBRUCH=1$/);
const flagAlleZuweisungen = zeile(/^NEUSTART_BEI_ABBRUCH=/);
const flagRueck = zeile(/^NEUSTART_BEI_ABBRUCH=0$/);
const blockEnde = zeile(/^# END abbruch-aufraeumen$/);
const warnEnde = zeile(/^# END webbau-warnung$/);
const schritt8 = zeile(/^dienste_starten$/);
pruefe(testZeilen.length === 1, 'genau ein Aufruf "node scripts/run-tests.mjs" als Zeile', `${testZeilen.length}`);
pruefe(schritt8.length === 1 && warnEnde.length === 1 && schritt8[0] > warnEnde[0], 'genau ein Schritt 8 (dienste_starten als eigene Zeile), nach dem Warnblock', `${schritt8}`);
// Genau zwei Zuweisungen ausserhalb der Vorbelegung im Aufraeumblock: Setzen und Ruecksetzen.
const ausserhalb = flagAlleZuweisungen.filter((i) => blockEnde.length === 1 && i > blockEnde[0]);
pruefe(
  ausserhalb.length === 2 && flagSetzen.length === 1 && flagRueck.filter((i) => i > blockEnde[0]).length === 1 && flagSetzen[0] < ausserhalb[1] && zeilen[ausserhalb[1]] === 'NEUSTART_BEI_ABBRUCH=0',
  'NEUSTART_BEI_ABBRUCH wird ausserhalb der Vorbelegung genau zweimal zugewiesen: =1 vor dem Webbau, =0 nach Schritt 8',
  `${ausserhalb.map((i) => zeilen[i])}`,
);
if (testZeilen.length === 1 && flagSetzen.length === 1 && schritt8.length === 1 && ausserhalb.length === 2) {
  pruefe(flagSetzen[0] > testZeilen[0], 'das Flag wird erst NACH den Tests gesetzt');
  pruefe(ausserhalb[1] === schritt8[0] + 1 || zeilen.slice(schritt8[0] + 1, ausserhalb[1]).every((z) => /^\s*(#.*)?$/.test(z)), 'das Flag wird direkt nach Schritt 8 zurueckgesetzt');
  // Marked blocks (BEGIN..END) collapse to one token; comments and blanks vanish.
  const spine: string[] = [];
  let drin: string | null = null;
  for (const z of zeilen.slice(flagSetzen[0], ausserhalb[1] + 1)) {
    const b = z.match(/^# BEGIN (\S+)/);
    if (b) { drin = b[1]; spine.push(`[${b[1]}]`); continue; }
    if (drin !== null) { if (z === `# END ${drin}`) drin = null; continue; }
    if (/^\s*(#.*)?$/.test(z)) continue;
    spine.push(z);
  }
  const erwartet = [
    /^NEUSTART_BEI_ABBRUCH=1$/,
    /^node_modules\/\.bin\/tsx tools\/aussehen-json\.mjs --aus wov-web\/static\/assets\/appearance\.json$/,
    /^node tools\/vorschau-buendeln\.mjs --aus wov-web\/static\/assets\/js\/vorschau\.js$/,
    /^\[buendel-pruefung\]$/,
    /^\(cd wov-web && npm ci --include=dev && npm run build && bash tools\/ohne-js-pruefen\.sh\)$/,
    /^\[webbau-warnung\]$/,
    /^dienste_starten$/,
    /^NEUSTART_BEI_ABBRUCH=0$/,
  ];
  pruefe(
    spine.length === erwartet.length && erwartet.every((re, i) => re.test(spine[i] ?? '')),
    'Schritt 7b bis 8 besteht genau aus den erwarteten Befehlen in dieser Reihenfolge (keine if-Huelle, kein Platzhalter, nichts verschoben)',
    spine.join(' | '),
  );
}

if (aufraeumen !== null && reigen !== null && buendelBlock !== null) {
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-abbruch-'));
  try {
    interface Optionen {
      startFehlt?: string; // this unit's `systemctl start` fails
      versionDatei?: boolean;
      gesundheitScheitert?: boolean;
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
        `systemctl() { echo "$1 \${2:-}" >> ${JSON.stringify(logDatei)}; if [ "$1" = is-enabled ]; then echo enabled; fi; ${opt.startFehlt ? `[ "$1 \${2:-}" != "start ${opt.startFehlt}.service" ]` : 'true'}; }`,
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
        env: SAUBERE_UMGEBUNG,
      });
      const verben = existsSync(logDatei) ? readFileSync(logDatei, 'utf8').split('\n') : [];
      const zahl = (v: string) => verben.filter((z) => z === v || z === `${v} `).length;
      return {
        r,
        stderr: r.stderr ?? '',
        stopps: verben.filter((z) => z.startsWith('stop ')).length,
        starts: verben.filter((z) => z.startsWith('start ')).length,
        startsServer: verben.filter((z) => z === 'start wov-server.service').length,
        gesundheit: zahl('gesundheit'),
        version: zahl('version'),
      };
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
    const signale: Array<[string, number]> = [['INT', 130], ['TERM', 143], ['HUP', 129]];
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
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-nicht-getrackt: alles gruen');
