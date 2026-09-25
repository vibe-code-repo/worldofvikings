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
 *      zaehlt stop und start).
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
const flagZeilen = update.match(/^NEUSTART_BEI_ABBRUCH=1$/gm) ?? [];
const flagPos = update.search(/^NEUSTART_BEI_ABBRUCH=1$/m);
const testPos = update.indexOf('node scripts/run-tests.mjs');
const esbuildPos = update.indexOf('node tools/vorschau-buendeln.mjs');
pruefe(
  flagZeilen.length === 1 && testPos >= 0 && flagPos > testPos && esbuildPos > flagPos,
  'NEUSTART_BEI_ABBRUCH=1 steht genau einmal, nach den Tests und vor dem Buendeln',
);
if (aufraeumen !== null && reigen !== null && buendelBlock !== null && flagZeilen.length === 1) {
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-abbruch-'));
  try {
    const szenario = (name: string, vorbereitung: string, schritt: string) => {
      const logDatei = join(temp, `${name}.log`);
      const skript = [
        'set -euo pipefail',
        `WURZEL=${JSON.stringify(temp)}`,
        'INSTANZ=dev',
        'DIENSTE=(wov-server wov-client wov-admin wov-web)',
        `systemctl() { echo "$1" >> ${JSON.stringify(logDatei)}; if [ "$1" = is-enabled ]; then echo enabled; fi; }`,
        aufraeumen,
        reigen,
        vorbereitung,
        'dienste_stoppen',
        schritt,
        'echo MARKER_WEITER',
      ].join('\n');
      const r = spawnSync('bash', ['-c', skript], { cwd: temp, encoding: 'utf8', env: SAUBERE_UMGEBUNG });
      const verben = existsSync(logDatei) ? readFileSync(logDatei, 'utf8').split('\n') : [];
      const zahl = (v: string) => verben.filter((z) => z === v).length;
      return { r, stopps: zahl('stop'), starts: zahl('start') };
    };
    const flag = 'NEUSTART_BEI_ABBRUCH=1';
    const ohneBuendel = 'mkdir -p wov-web/static/assets/js';
    const leeresBuendel = `${ohneBuendel}; : > wov-web/static/assets/js/vorschau.js`;
    const gutesBuendel = `${ohneBuendel}; echo x > wov-web/static/assets/js/vorschau.js`;

    const leer = szenario('leer', leeresBuendel, `${flag}\n${buendelBlock}`);
    pruefe(leer.r.status !== 0 && !leer.r.stdout.includes('MARKER_WEITER'), 'leeres Buendel: Abbruch mit rc != 0', `rc=${leer.r.status}`);
    pruefe(leer.stopps === 4 && leer.starts === leer.stopps, 'leeres Buendel: Starts gleich Stopps', `stop=${leer.stopps} start=${leer.starts}`);
    pruefe(leer.r.stderr.includes('fehlt oder ist leer'), 'leeres Buendel: klare Meldung', leer.r.stderr);

    const fehlt = szenario('fehlt', ohneBuendel, `${flag}\n${buendelBlock}`);
    pruefe(fehlt.r.status !== 0 && fehlt.stopps === 4 && fehlt.starts === fehlt.stopps, 'fehlendes Buendel: rc != 0, Starts gleich Stopps', `rc=${fehlt.r.status} stop=${fehlt.stopps} start=${fehlt.starts}`);

    const esbuild = szenario('esbuild', ohneBuendel, `${flag}\nfalse`);
    pruefe(esbuild.r.status !== 0 && esbuild.stopps === 4 && esbuild.starts === esbuild.stopps, 'Fehler im Buendeln/Webbau: rc != 0, Starts gleich Stopps', `rc=${esbuild.r.status} stop=${esbuild.stopps} start=${esbuild.starts}`);

    const testFehler = szenario('tests', ohneBuendel, 'false');
    pruefe(testFehler.r.status !== 0 && testFehler.stopps === 4 && testFehler.starts === 0, 'Abbruch vor dem Webbau (Tests): Dienste bleiben gestoppt (Absicht)', `rc=${testFehler.r.status} stop=${testFehler.stopps} start=${testFehler.starts}`);
    pruefe(testFehler.r.stderr.includes('GESTOPPT'), 'Abbruch vor dem Webbau: Meldung sagt GESTOPPT', testFehler.r.stderr);

    const gut = szenario('gut', gutesBuendel, `${flag}\n${buendelBlock}`);
    pruefe(gut.r.status === 0 && gut.r.stdout.includes('MARKER_WEITER') && gut.starts === 0, 'vorhandenes Buendel: kein Abbruch, kein Neustart im Aufraeumen', `rc=${gut.r.status} start=${gut.starts}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-nicht-getrackt: alles gruen');
