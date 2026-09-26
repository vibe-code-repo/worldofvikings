/**
 * wov-web/static/assets/appearance.json is a generated image of shared/src/aussehen.ts
 * and stays tracked (the web CI builds the site without wov-update.sh, so it
 * needs the file in the repo). The generator is deterministic (two runs and the
 * committed file are byte-identical, measured 24.09.2026), so a freshness
 * check is stable, unlike the preview bundle. Without it, a change to the
 * shared lists that forgets the JSON leaves the tree dirty after the next
 * wov-update.sh and the run after that aborts in the cleanliness check.
 *
 * Lauf:  npx tsx tools/test/appearance-frisch.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATEI = 'wov-web/static/assets/appearance.json';
const temp = mkdtempSync(join(tmpdir(), 'appearance-frisch-'));
let rc = 0;
try {
  const neu = join(temp, 'appearance.json');
  const r = spawnSync(join(WURZEL, 'node_modules/.bin/tsx'), ['tools/aussehen-json.mjs', '--aus', neu], {
    cwd: WURZEL,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`  ROT  aussehen-json.mjs bricht ab, rc=${r.status}\n${r.stderr}`);
    rc = 1;
  } else if (readFileSync(neu, 'utf8') !== readFileSync(join(WURZEL, DATEI), 'utf8')) {
    console.error(`  ROT  ${DATEI} ist veraltet. Neu erzeugen und committen:\n       node_modules/.bin/tsx tools/aussehen-json.mjs --aus ${DATEI}`);
    rc = 1;
  } else {
    console.log(`  OK   ${DATEI} entspricht shared/src/aussehen.ts`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
if (rc) process.exit(rc);
console.log('appearance-frisch: alles gruen');
