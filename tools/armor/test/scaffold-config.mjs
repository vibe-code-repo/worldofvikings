/** Every scaffold-built set (sets/{seidraven,emberrage,gravethorn,plainhide}) is data plus
 * design on tools/armor/lib -- no text of another builder is executed. Checked without Blender:
 *   - each set's config.py is complete for lib/config.py (every required field, items that
 *     replace every non-free region exactly once) and the library refuses one that is not;
 *   - items, replaced regions, hidden appearance layers and free regions agree with the
 *     registry in shared/src/<family>.ts;
 *   - no exec( / .replace( survives anywhere under sets/**.py, and no scaffold marker in the four.
 * tsx tools/armor/test/scaffold-config.mjs   (~1 s)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const armor = join(root, 'tools/armor');
const SETS = ['seidraven', 'emberrage', 'gravethorn', 'plainhide'];

function python(code, ...argv) {
  const child = spawnSync('python3', ['-c', code, ...argv], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (child.error) throw new Error(`python3 not found (needed to read the set configurations): ${child.error.message}`);
  return child;
}

// 1. Every configuration is complete, and the schema refuses an incomplete one.
const DESCRIBE = `
import json, sys
armor, family = sys.argv[1], sys.argv[2]
sys.path[:0] = [armor + '/sets/' + family, armor]
from config import CONFIG
from lib import config as schema
full = schema.complete(CONFIG)
short = {k: v for k, v in CONFIG.items() if k != 'class_label'}
try:
    schema.complete(short); refused = None
except schema.ConfigError as error:
    refused = str(error)
print(json.dumps({'described': schema.describe(full), 'refused': refused, 'fields': sorted(full)}))
`;
const described = {};
for (const family of SETS) {
  const child = python(DESCRIBE, armor, family);
  assert.equal(child.status, 0, `${family}/config.py is not a complete configuration:\n${child.stderr}`);
  const out = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.ok(out.refused && out.refused.includes('class_label'), `${family}: the schema must refuse a configuration without class_label, got ${out.refused}`);
  described[family] = out.described;
}

// 2. The configuration and the registry describe the same set.
function registry(family) {
  const text = readFileSync(join(root, 'shared/src', family + '.ts'), 'utf8');
  const items = {};
  for (const m of text.matchAll(/\{\s*key:\s*'(\w+)'[^}]*?regions:\s*\[([^\]]*)\][^}]*?hideAppearance:\s*\[([^\]]*)\]/g)) {
    const list = s => [...s.matchAll(/'(\w+)'/g)].map(x => x[1]);
    items[m[1]] = { regions: list(m[2]), hideAppearance: list(m[3]) };
  }
  const free = text.match(/FREE_REGIONS\s*=\s*\[([^\]]*)\]/);
  return { items, freeRegions: free ? [...free[1].matchAll(/'(\w+)'/g)].map(x => x[1]) : [] };
}
for (const family of SETS) {
  const reg = registry(family), cfg = described[family];
  assert.ok(Object.keys(reg.items).length >= 5, `shared/src/${family}.ts: no parts found`);
  assert.deepEqual(Object.keys(reg.items).sort(), cfg.items.map(i => i.key).sort(), `${family}: item keys differ between config.py and shared/src/${family}.ts`);
  for (const item of cfg.items) {
    assert.deepEqual(item.regions, reg.items[item.key].regions, `${family}/${item.key}: regions differ from the registry`);
    assert.deepEqual(item.hideAppearance, reg.items[item.key].hideAppearance, `${family}/${item.key}: hideAppearance differs from the registry`);
  }
  assert.deepEqual(cfg.freeRegions, reg.freeRegions, `${family}: free regions differ from the registry`);
}

// 3. No builder executes or edits another builder's text any more.
function pyFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pyFiles(path) : name.endsWith('.py') ? [path] : [];
  });
}
// exec/replace nowhere under sets/; the two former marker lines nowhere in the four scaffold-built
// sets (Ashenveil and Wildwarden are self-contained builders and keep their own section comments).
const MARKERS = ['New geometry inspired by the supplied silhouette', 'Join each replacement region and bind every component'];
const offenders = [];
for (const file of pyFiles(join(armor, 'sets'))) {
  const text = readFileSync(file, 'utf8');
  const scaffoldSet = SETS.some(family => file.startsWith(join(armor, 'sets', family) + '/'));
  for (const needle of ['exec(', '.replace(', ...(scaffoldSet ? MARKERS : [])]) if (text.includes(needle)) offenders.push(`${file.slice(root.length)}: ${needle}`);
}
assert.deepEqual(offenders, [], 'text execution or replacement left under sets/');
console.log(`PASS scaffold-config: ${SETS.length} configurations complete, refuse a missing class_label, agree with shared/src, ${pyFiles(join(armor, 'sets')).length} python files without exec/replace/markers`);
