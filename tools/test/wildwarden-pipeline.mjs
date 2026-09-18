/** Wildwarden: the Blender build script, the item registry and the shipped GLBs must agree.
 * tsx tools/test/wildwarden-pipeline.mjs
 * Reads tools/build-druid-armor.py as text (python3 parses its PARTS table, Blender
 * is not started) and the seven GLBs under wov-web/static/assets/models/armor/wildwarden.
 * Nothing is built; the Blender build itself is described in Docs/Wildwarden-DEV.md.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WILDWARDEN_PARTS } from '../../shared/src/wildwarden.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'tools/build-druid-armor.py');
const models = join(root, 'wov-web/static/assets/models/armor/wildwarden');

// The table the build script writes into equipment.json, taken from its own source.
const parsed = spawnSync('python3', ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in tree.body:
    if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == 'PARTS' for t in node.targets):
        print(json.dumps(ast.literal_eval(node.value)))
`, script], { encoding: 'utf8' });
assert.equal(parsed.status, 0, `python3 could not read ${script}:\n${parsed.stderr}`);
const built = JSON.parse(parsed.stdout);

assert.deepEqual(built.map(p => p.item).sort(), WILDWARDEN_PARTS.map(p => p.item).sort(),
  'The build script and the registry must list the same items');
for (const part of WILDWARDEN_PARTS) {
  const source = built.find(p => p.item === part.item);
  assert.deepEqual([...source.regions].sort(), [...part.regions].sort(), `${part.item}: replaced regions`);
  assert.deepEqual([...(source.sourceRegions ?? source.regions)].sort(), part.regions.length ? [...part.regions].sort() : ['Crown'],
    `${part.item}: exported geometry`);
}
const registered = new Set(WILDWARDEN_PARTS.flatMap(p => p.regions));
assert.equal(registered.size, 10, 'Six items replace ten body regions; the crown replaces none');
assert(!registered.has('Head'), 'The textured head stays visible under the crown');

// The shipped GLBs carry exactly that contract in their node extras.
let nodes = 0;
for (const part of WILDWARDEN_PARTS) {
  const bytes = readFileSync(join(models, `${part.item}.glb`));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const meshNodes = json.nodes.filter(n => n.mesh !== undefined);
  assert(meshNodes.length > 0, `${part.item}: renderable mesh nodes`);
  nodes += meshNodes.length;
  if (part.regions.length === 0) {
    assert(meshNodes.every(n => n.extras?.attachment === true && !('replaces' in n.extras)), `${part.item}: attachment only`);
  } else {
    assert(meshNodes.every(n => part.regions.includes(n.extras?.replaces) && !n.extras.attachment), `${part.item}: replaces its own regions`);
    assert.deepEqual(new Set(meshNodes.map(n => n.extras.replaces)), new Set(part.regions), `${part.item}: every region has geometry`);
  }
}
console.log(`PASS Wildwarden: ${built.length} items, ${registered.size} replaced regions, ${nodes} shipped mesh nodes agree with the build script`);
