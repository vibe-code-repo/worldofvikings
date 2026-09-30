/**
 * Self-test of the move proof (`tools/verschiebung/`), part 5: the tool and its self-tests type
 * check. `npm run typecheck` covers the four workspaces and not `tools/`, so the type check of
 * the tool runs here, with the tool's own `tsconfig.json`, and the CI sees it through `npm test`.
 *
 * Run: npx tsx tools/test/verschiebung-typen.ts   (from the repository root)
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TSC = resolve(WURZEL, 'node_modules/.bin/tsc');
const r = spawnSync(TSC, ['-p', 'tools/verschiebung/tsconfig.json', '--pretty', 'false'], { cwd: WURZEL, encoding: 'utf8', timeout: 300_000 });
const aus = `${r.stdout}${r.stderr}`.trim();
if (r.status === 0) {
  console.log('ok    tsc -p tools/verschiebung/tsconfig.json: no type errors');
  console.log('\nverschiebung-typen: 1 case, as expected.');
  process.exit(0);
}
console.log(`FAIL  tsc -p tools/verschiebung/tsconfig.json: exit ${r.status}\n${aus.slice(0, 4000)}`);
console.log('\nverschiebung-typen: 1 of 1 cases FAILED.');
process.exit(1);
