/** The four thin build entry points must check their command line before they build anything.
 * tsx tools/armor/test/entry-args.mjs
 * No Blender: each entry point (sets/{seidraven,emberrage}/{male,female}/build.py) runs under python3
 * with a stand-in for runpy.run_path, the call that would start build_common.py. A good command line
 * must reach the stand-in with the right arguments; a bad one must exit non-zero with a message and a
 * usage line WITHOUT reaching it. The same cases also run through a symlink from a foreign working
 * directory and from a copy of the sets folder under a path with a space and an umlaut.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sets = join(root, 'tools/armor/sets');
const ENTRIES = [['seidraven', 'male'], ['seidraven', 'female'], ['emberrage', 'male'], ['emberrage', 'female']];

// Runs an entry point like Blender would: argv[0] is the executable, the rest is the command line.
const HARNESS = `
import json, runpy, sys
entry, sys.argv = sys.argv[1], sys.argv[2:]
real = runpy.run_path
def stand_in(path, **kwargs):
    print('RUN_PATH_CALLED ' + json.dumps({'path': str(path), 'argv': sys.argv, 'kwargs': kwargs}))
runpy.run_path = stand_in
real(entry, run_name='__main__')
`;

const scratch = mkdtempSync(join(tmpdir(), 'entry-args-'));
const harness = join(scratch, 'harness.py');
writeFileSync(harness, HARNESS);

function run(entry, args, cwd = scratch) {
  const child = spawnSync('python3', [harness, entry, 'blender', '--factory-startup', '-b', 'body.blend', ...args], { encoding: 'utf8', cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (child.error) throw new Error(`python3 not found (needed to run the entry points under this test): ${child.error.message}`);
  const line = child.stdout.split('\n').find(l => l.startsWith('RUN_PATH_CALLED '));
  return { status: child.status, stderr: child.stderr, called: line ? JSON.parse(line.slice('RUN_PATH_CALLED '.length)) : null };
}
const withScript = (entry, tail) => ['--python', entry, ...tail];

// [description, arguments after `--python <entry>` (the entry is filled in), applies to variants, expected]
const GOOD = [
  ['directory only', ['--', 'OUT'], ['male', 'female'], ['OUT']],
  ['directory and --quick', ['--', 'OUT', '--quick'], ['male', 'female'], ['OUT', '--quick']],
  ['directory with spaces', ['--', 'my out dir'], ['male', 'female'], ['my out dir']],
  ['explicit --female', ['--', 'OUT', '--female'], ['female'], ['OUT', '--female']],
  ['--quick and --female', ['--', 'OUT', '--quick', '--female'], ['female'], ['OUT', '--quick', '--female']],
];
const BAD = [
  ['no -- at all', [], ['male', 'female'], "missing '--'"],
  ['-- without a directory', ['--'], ['male', 'female'], "missing output directory"],
  ['a switch as directory (--female)', ['--', '--female'], ['male', 'female'], 'expected the output directory'],
  ['a switch as directory (--quick)', ['--', '--quick', 'OUT'], ['male', 'female'], 'expected the output directory'],
  ['a single-dash directory', ['--', '-OUT'], ['male', 'female'], 'expected the output directory'],
  ['an empty directory', ['--', ''], ['male', 'female'], 'expected the output directory'],
  ['unknown switch --male', ['--', 'OUT', '--male'], ['male', 'female'], 'unknown argument'],
  ['misspelt switch', ['--', 'OUT', '--quik'], ['male', 'female'], 'unknown argument'],
  ['a second positional', ['--', 'OUT', 'OTHER'], ['male', 'female'], 'unknown argument'],
  ['--quick twice', ['--', 'OUT', '--quick', '--quick'], ['male', 'female'], 'given twice'],
  ['--female twice', ['--', 'OUT', '--female', '--female'], ['female'], 'given twice'],
  ['--female on the male entry point', ['--', 'OUT', '--female'], ['male'], 'does not accept --female'],
  ['--female on the male entry point, after --quick', ['--', 'OUT', '--quick', '--female'], ['male'], 'does not accept --female'],
  ['--female before the --', ['--female', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['--quick before the --', ['--quick', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['--male before the --', ['--male', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['--quick before the -- and no --', ['--quick'], ['male', 'female'], "in front of '--'"],
  // Write variants of a switch before the `--`: Blender would ignore each of these just as
  // silently as the exact spelling above, so each dimension of the normalization gets its own case.
  ['single-dash spelling before the --', ['-female', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['em-dash spelling before the --', ['—female', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['uppercase spelling before the --', ['--Quick', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['=value suffix before the --', ['--female=1', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
  ['whitespace around the switch before the --', [' --female ', '--', 'OUT'], ['male', 'female'], "in front of '--'"],
];

let checked = 0;
function check(entry, [set, variant], label, cwd) {
  const where = `${set}/${variant} ${label}`;
  for (const [what, tail, variants, expected] of GOOD) {
    if (!variants.includes(variant)) continue;
    const result = run(entry, withScript(entry, tail), cwd);
    checked++;
    assert.equal(result.status, 0, `${where}: ${what} must pass:\n${result.stderr}`);
    assert(result.called, `${where}: ${what} must reach build_common.py`);
    assert(result.called.path.endsWith(join('sets', set, 'build_common.py')), `${where}: wrong build script ${result.called.path}`);
    assert.equal(result.called.kwargs.run_name, '__main__');
    const args = result.called.argv.slice(result.called.argv.indexOf('--') + 1);
    // The female entry point makes the variant explicit for build_common.py; the male one adds nothing.
    const wanted = variant === 'female' && !expected.includes('--female') ? [...expected, '--female'] : expected;
    assert.deepEqual(args, wanted, `${where}: ${what}: arguments seen by build_common.py`);
    assert.equal(args.filter(a => a === '--female').length, variant === 'female' ? 1 : 0, `${where}: ${what}: --female count`);
  }
  for (const [what, tail, variants, message] of BAD) {
    if (!variants.includes(variant)) continue;
    const result = run(entry, withScript(entry, tail), cwd);
    checked++;
    assert.equal(result.called, null, `${where}: ${what} must stop BEFORE build_common.py`);
    assert.notEqual(result.status, 0, `${where}: ${what} must exit non-zero`);
    assert(result.stderr.includes(message), `${where}: ${what}: expected "${message}" in:\n${result.stderr}`);
    assert(result.stderr.includes('usage: blender') && result.stderr.includes('--python-exit-code 1'), `${where}: ${what}: usage line`);
    assert(result.stderr.includes(variant === 'female' ? 'BODY_BASE_FEMALE.blend' : 'BODY_BASE_MALE.blend'), `${where}: ${what}: body source in usage`);
  }
}

try {
  // 1. The entry points in the repository, from a foreign working directory.
  for (const [set, variant] of ENTRIES) check(join(sets, set, variant, 'build.py'), [set, variant], 'in place');
  // 2. Through a symlink to the entry point.
  for (const [set, variant] of ENTRIES) {
    const link = join(scratch, `link-${set}-${variant}.py`);
    symlinkSync(join(sets, set, variant, 'build.py'), link);
    check(link, [set, variant], 'via symlink');
  }
  // 3. A copy of the sets folder under a path with a space and an umlaut.
  const moved = join(scratch, 'Rüstung Werkzeuge', 'tools', 'armor', 'sets');
  cpSync(sets, moved, { recursive: true, filter: source => !source.includes('__pycache__') });
  for (const [set, variant] of ENTRIES) check(join(moved, set, variant, 'build.py'), [set, variant], 'in a path with space and umlaut', moved);
  // 4. Without python3 on PATH, run() must fail with a clear message, not
  // `TypeError: Cannot read properties of null (reading 'split')` from a null child.stdout.
  {
    const entry = join(sets, 'seidraven', 'male', 'build.py');
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    let error = null;
    try {
      run(entry, withScript(entry, ['--', 'OUT']));
    } catch (e) {
      error = e;
    } finally {
      process.env.PATH = savedPath;
    }
    checked++;
    assert(error, 'run() must throw when python3 cannot be found on PATH');
    assert(!(error instanceof TypeError), `expected a clear error, got a TypeError: ${error.message}`);
    assert(error.message.includes('python3'), `expected the error to name python3: ${error.message}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS entry-args: ${checked} command lines over 4 entry points x 3 placements (in place, symlink, path with space and umlaut) ` +
  'plus one missing-python3 case; good ones reach build_common.py with the right arguments, bad ones stop before it with a message, ' +
  'a usage line and a non-zero exit, and a missing python3 fails clearly instead of with a TypeError');
