/**
 * Runs the self-test of `tools/i1-verschiebung.mjs` (I1 step 0): real, forged and incomplete moves for a
 * class method and for a free function, and the command line's exit codes. The tool does the checking;
 * this file only makes it a test of the collective run (`['tools', 'test/i1-verschiebung.ts']`).
 * Startet den Selbsttest des Verschiebebeweis-Werkzeugs.
 *
 * Run: npx tsx tools/test/i1-verschiebung.ts   (from the repo root)
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const werkzeug = resolve(import.meta.dirname, '../i1-verschiebung.mjs');
const lauf = spawnSync(process.execPath, [werkzeug, '--selbsttest'], { encoding: 'utf-8' });
process.stdout.write(lauf.stdout);
process.stderr.write(lauf.stderr);
if (lauf.status !== 0 || !/Selbsttest grün/.test(lauf.stdout)) {
  console.error(`i1-verschiebung selftest FAILED (exit ${lauf.status})`);
  process.exit(1);
}
console.log('i1-verschiebung selftest: all green.');
