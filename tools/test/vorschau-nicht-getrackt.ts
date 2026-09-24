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
 *      ohne abzubrechen (der Block wird in einem Wegwerf-Repo ausgefuehrt).
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

const gitignore = readFileSync(join(WURZEL, '.gitignore'), 'utf8').split('\n').map((z) => z.trim());
pruefe(gitignore.includes(BUENDEL), `.gitignore fuehrt ${BUENDEL}`);

if (existsSync(join(WURZEL, '.git'))) {
  const r = spawnSync('git', ['ls-files', '--', BUENDEL], { cwd: WURZEL, encoding: 'utf8' });
  pruefe(r.status === 0 && r.stdout.trim() === '', `${BUENDEL} ist nicht getrackt`, r.stdout.trim());
}

const update = readFileSync(join(WURZEL, 'tools/wov-update.sh'), 'utf8');
const bau = update.indexOf(`node tools/vorschau-buendeln.mjs --aus ${BUENDEL}`);
pruefe(bau >= 0, `wov-update.sh baut ${BUENDEL}`);
const buendelPruefung = update.indexOf(`[ -s ${BUENDEL} ]`, Math.max(bau, 0));
pruefe(buendelPruefung > bau && bau >= 0, 'wov-update.sh bricht ab, wenn das Buendel nach dem Bau fehlt oder leer ist');
const webbau = update.indexOf('npm run build && bash tools/ohne-js-pruefen.sh', Math.max(bau, 0));
const warnung = update.indexOf('WARNUNG: Der Webseitenbau', Math.max(webbau, 0));
pruefe(webbau > bau && warnung > webbau, 'wov-update.sh warnt nach dem Webseitenbau vor einem schmutzigen Baum');
const statusNachBau = update.indexOf('git status --porcelain', Math.max(webbau, 0));
pruefe(statusNachBau > webbau && statusNachBau < warnung, 'die Warnung stuetzt sich auf git status --porcelain');
// Behavior, not text: cut the real block out of the script (between its
// markers) and run it under the script's own `set -euo pipefail` in a scratch
// repo. 6e837b0 had a broken printf line that only failed with a dirty tree,
// and a text check for "exit" did not see it.
const beginn = update.indexOf('# BEGIN webbau-warnung');
const ende = update.indexOf('# END webbau-warnung', Math.max(beginn, 0));
pruefe(beginn >= 0 && ende > beginn, 'wov-update.sh markiert den Warnblock (BEGIN/END webbau-warnung)');
if (beginn >= 0 && ende > beginn) {
  const block = update.slice(beginn, ende);
  const temp = mkdtempSync(join(tmpdir(), 'vorschau-warnblock-'));
  try {
    const git = (...a: string[]) =>
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: temp, encoding: 'utf8' });
    git('init', '-q');
    writeFileSync(join(temp, 'erzeugt.json'), '{}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'x');
    const lauf = () =>
      spawnSync('bash', ['-c', `set -euo pipefail\n${block}\necho MARKER_WEITER`], { cwd: temp, encoding: 'utf8' });

    const sauber = lauf();
    pruefe(sauber.status === 0 && sauber.stdout.includes('MARKER_WEITER'), 'sauberer Baum: rc=0, Code laeuft weiter', `rc=${sauber.status} ${sauber.stderr}`);
    pruefe(!sauber.stderr.includes('WARNUNG'), 'sauberer Baum: keine Warnung', sauber.stderr);

    writeFileSync(join(temp, 'erzeugt.json'), '{"neu":1}\n');
    const schmutzig = lauf();
    pruefe(schmutzig.status === 0, 'schmutziger Baum unter set -euo pipefail: rc=0', `rc=${schmutzig.status} ${schmutzig.stderr}`);
    pruefe(schmutzig.stderr.includes('WARNUNG') && schmutzig.stderr.includes('erzeugt.json'), 'schmutziger Baum: Warnung nennt die Datei', schmutzig.stderr);
    pruefe(schmutzig.stdout.includes('MARKER_WEITER'), 'schmutziger Baum: Code laeuft danach weiter', schmutzig.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-nicht-getrackt: alles gruen');
