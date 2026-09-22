/** armor-motion.py's --keep-body= contract (tools/armor/test/keep_body.py), checked without
 * Blender: an unknown region name, a region the armor already replaces, and a second
 * --keep-body option must all be refused; an empty list and a repeated region are allowed.
 * tsx tools/armor/test/keep-body-args.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// [description, --keep-body-ish argv tokens, replaced regions (JSON array), expected: null (OK) or a substring]
const CASES = [
  ['no --keep-body at all', [], [], null],
  ['empty value', ['--keep-body='], [], null],
  ['one region', ['--keep-body=Head'], [], null],
  ['region repeated within one option', ['--keep-body=Head,Head'], [], null],
  ['all eleven regions kept, none replaced', ['--keep-body=Torso,Hips,ArmUpperLeft,ArmUpperRight,ArmLowerLeft,ArmLowerRight,LegLeft,LegRight,Head,HandLeft,HandRight'], [], null],
  ['unknown region name', ['--keep-body=Mystery'], [], 'outside the eleven-region body'],
  ['unknown among otherwise valid regions', ['--keep-body=Head,Mystery'], [], 'outside the eleven-region body'],
  ['region the armor already replaces (Plainhide-shaped: 8 replaced, Torso among them)',
    ['--keep-body=Torso'],
    ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'LegLeft', 'LegRight'],
    'already replaces'],
  ['region the armor already replaces (Seidraven-shaped: all eleven replaced)',
    ['--keep-body=Torso'],
    ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight'],
    'already replaces'],
  ['second --keep-body option: the first no longer silently wins', ['--keep-body=Head', '--keep-body=HandLeft'], [], 'only one is allowed'],
  ['third --keep-body option', ['--keep-body=Head', '--keep-body=HandLeft', '--keep-body=HandRight'], [], 'only one is allowed'],
];

const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(here)})
from keep_body import parse_keep_body, KeepBodyError
args, replaced = json.loads(sys.argv[1]), set(json.loads(sys.argv[2]))
try:
    print(json.dumps({'ok': True, 'result': parse_keep_body(args, replaced)}))
except KeepBodyError as error:
    print(json.dumps({'ok': False, 'error': str(error)}))
`;

let checked = 0;
for (const [label, keepBodyArgs, replaced, expectedSubstring] of CASES) {
  const result = spawnSync('python3', ['-c', script, JSON.stringify(keepBodyArgs), JSON.stringify(replaced)], { encoding: 'utf8' });
  checked++;
  assert.equal(result.status, 0, `${label}: python3 itself must exit 0:\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  if (expectedSubstring === null) {
    assert(parsed.ok, `${label}: expected acceptance, got rejection: ${parsed.error}`);
  } else {
    assert(!parsed.ok, `${label}: expected rejection, got acceptance: ${JSON.stringify(parsed.result)}`);
    assert(parsed.error.includes(expectedSubstring), `${label}: expected "${expectedSubstring}" in: ${parsed.error}`);
  }
}
console.log(`PASS keep-body-args: ${checked} --keep-body cases (unknown region, already-replaced region, ` +
  'a second option, and the allowed empty/repeated cases) without Blender');
