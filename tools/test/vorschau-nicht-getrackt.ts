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
 *      ohne abzubrechen.
 *
 * Lauf:  npx tsx tools/test/vorschau-nicht-getrackt.ts
 *
 * The preview bundle is a build product: it must be git-ignored, must be the
 * path wov-update.sh builds, and the script must warn about a dirty tree
 * after the web build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const webbau = update.indexOf('npm run build && bash tools/ohne-js-pruefen.sh', Math.max(bau, 0));
const warnung = update.indexOf('WARNUNG: Der Webseitenbau', Math.max(webbau, 0));
pruefe(webbau > bau && warnung > webbau, 'wov-update.sh warnt nach dem Webseitenbau vor einem schmutzigen Baum');
const statusNachBau = update.indexOf('git status --porcelain', Math.max(webbau, 0));
pruefe(statusNachBau > webbau && statusNachBau < warnung, 'die Warnung stuetzt sich auf git status --porcelain');
const warnBlock = warnung >= 0 ? (update.slice(warnung).split('\nfi\n')[0] ?? '') : '';
pruefe(warnung >= 0 && !/\bexit\b/.test(warnBlock), 'die Warnung bricht nicht ab');

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-nicht-getrackt: alles gruen');
