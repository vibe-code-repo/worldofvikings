/**
 * Self-test of the move proof (`tools/verschiebung/`), part 4: the command line and the two states.
 *
 * A throwaway git repository under a temp folder holds the old state as a commit and the new state
 * as its working tree, the way a real step is checked. The cases:
 *  - exit codes of the command line: 0 for a proof, 1 for findings, 2 for a broken manifest or an
 *    unknown switch; `--json` gives the result as JSON;
 *  - the old state is read from git, not from disk: a change of a support module that exists in the
 *    working tree only (an import of a module for its effect) is not seen by the old program, so
 *    rule B10 reports the module as newly loaded. With the same change committed, the proof holds.
 *
 * Run: npx tsx tools/test/verschiebung-aufruf.ts   (from the repository root)
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TSCONFIG, schnitt } from '../verschiebung/pruefstand/probe';
import { AUFTRAG_FORMK, KAMPF, QUELLE, SERVER, UMFELD } from '../verschiebung/pruefstand/vorlagen';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const WERKZEUG = resolve(WURZEL, 'tools/verschiebung/verschiebung.ts');
const TSX = resolve(WURZEL, 'node_modules/.bin/tsx');

let faelle = 0;
let rot = 0;
function pruefe(id: string, name: string, ok: boolean, zeuge = ''): void {
  faelle++;
  if (ok) console.log(`ok    ${id.padEnd(6)} ${name}`);
  else {
    rot++;
    console.log(`FAIL  ${id.padEnd(6)} ${name}\n        ${zeuge.slice(0, 1500)}`);
  }
}

// An interrupted run leaves no temp folder behind (the `finally` below does not run on a signal).
// The handlers stand BEFORE the folder is made: a signal in between would end the process without cleaning up.
let laufend: ChildProcess | null = null;
let tmp = '';
/** The tool runs in its own process group (`tsx` starts a child): the whole group is ended, not only the wrapper. */
const killeGruppe = (c: ChildProcess): void => {
  try {
    if (c.pid !== undefined) process.kill(-c.pid, 'SIGKILL');
  } catch {
    // already gone
  }
};
/** Removes the temp folder; a git process that is still writing into it makes the first tries fail. */
const raeume = (): void => {
  for (let i = 0; i < 40 && tmp !== ''; i++) {
    try {
      rmSync(tmp, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (laufend) killeGruppe(laufend);
    raeume();
    process.exit(130);
  });
}

tmp = mkdtempSync(join(tmpdir(), 'verschiebung-aufruf-'));
/** Asynchronous like the tool runs: a blocked event loop cannot answer a signal, and `tsx` then ends the process without the handler. */
const git = (...a: string[]): Promise<string> =>
  new Promise((fertig, fehler) => {
    execFile('git', a, { cwd: tmp, encoding: 'utf8' }, (e, aus, err) => (e ? fehler(new Error(`git ${a.join(' ')}: ${err}`)) : fertig(aus)));
  });
const schreibe = (dateien: Record<string, string | null>): void => {
  for (const [p, t] of Object.entries(dateien)) {
    const voll = join(tmp, p);
    if (t === null) rmSync(voll, { force: true });
    else {
      mkdirSync(dirname(voll), { recursive: true });
      writeFileSync(voll, t);
    }
  }
};
/** Runs the tool and collects its output. Asynchronous, so that a signal reaches the handler above at once. */
const lauf = (...argv: string[]): Promise<{ status: number | null; aus: string }> =>
  new Promise((fertig) => {
    const c = spawn(TSX, [WERKZEUG, ...argv], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    laufend = c;
    let aus = '';
    c.stdout.on('data', (d: Buffer) => (aus += d.toString()));
    c.stderr.on('data', (d: Buffer) => (aus += d.toString()));
    const frist = setTimeout(() => killeGruppe(c), 240_000);
    c.on('close', (status) => {
      clearTimeout(frist);
      laufend = null;
      fertig({ status, aus });
    });
  });
async function haupt(): Promise<void> {
  try {
    // -- the old state: a commit --
    const e = schnitt(SERVER, AUFTRAG_FORMK, { dateien: UMFELD });
    await git('init', '-q');
    await git('config', 'user.email', 'probe@example.invalid');
    await git('config', 'user.name', 'probe');
    schreibe({ 'package.json': '{ "name": "verschiebung-probe", "private": true }\n', 'tsconfig.json': TSCONFIG, ...e.alt });
    await git('add', '-A');
    await git('commit', '-q', '-m', 'old state');
    const alt = (await git('rev-parse', 'HEAD')).trim();

    // -- the new state: the working tree --
    const neu: Record<string, string | null> = {};
    for (const p of Object.keys(e.alt)) if (!(p in e.neu)) neu[p] = null;
    for (const [p, t] of Object.entries(e.neu)) if (e.alt[p] !== t) neu[p] = t;
    schreibe(neu);
    const manifest = { ...e.manifest, alt: 'git:HEAD', neu: 'arbeitsbaum' };
    schreibe({ 'manifest.json': JSON.stringify(manifest, null, 2) });

    const gut = await lauf('manifest.json');
    pruefe('C1', 'a real cut from the command line: exit 0 and the proof', gut.status === 0 && /PROOF GIVEN/.test(gut.aus) && gut.aus.includes(`git:${alt}`) && /arbeitsbaum:/.test(gut.aus), gut.aus);
    const json = await lauf('manifest.json', '--json');
    let geparst: { exit?: number; manifest?: { quelle?: string } } | null = null;
    try {
      geparst = JSON.parse(json.aus) as { exit?: number };
    } catch {
      geparst = null;
    }
    pruefe('C5', '--json: the result is JSON with the exit code and the manifest', json.status === 0 && geparst?.exit === 0 && geparst?.manifest?.quelle === QUELLE, json.aus.slice(0, 300));

    const kampf = e.neu[KAMPF]!;
    schreibe({ [KAMPF]: kampf.replace('return k.zaehler + 1;', 'return k.zaehler + 2;') });
    const schlecht = await lauf('manifest.json');
    pruefe('C2', 'a forged target from the command line: exit 1 and findings', schlecht.status === 1 && /Findings \([1-9]/.test(schlecht.aus) && /\[B3 /.test(schlecht.aus), schlecht.aus);
    schreibe({ [KAMPF]: kampf });

    schreibe({ 'kaputt.json': JSON.stringify({ ...manifest, schalter: true }) });
    const kaputt = await lauf('kaputt.json');
    pruefe('C3', 'a manifest with an unknown key: exit 2', kaputt.status === 2 && /schalter/.test(kaputt.aus), kaputt.aus);
    const unbekannt = await lauf('manifest.json', '--gibtsnicht');
    pruefe('C4', 'an unknown switch: exit 2 (everything that influences the proof stands in the manifest)', unbekannt.status === 2, unbekannt.aus);
    const ohne = await lauf();
    pruefe('C4b', 'no manifest: exit 2', ohne.status === 2, ohne.aus);

    // -- Nachweis 6: the old state is the commit, not the disk --
    const werte = UMFELD['src/werte.ts']!;
    schreibe({ 'src/werte.ts': `import './wirkung';\n${werte}` });
    const fremd = await lauf('manifest.json');
    pruefe(
      'N6a',
      'a support module of the working tree imports another module for its effect; the old program (git) does not see it, so B10 reports the module as newly loaded',
      fremd.status === 1 && /\[B10 neu-geladen\][\s\S]{0,400}?src\/wirkung\.ts/.test(fremd.aus),
      fremd.aus,
    );
    await git('add', 'src/werte.ts');
    await git('commit', '-q', '-m', 'the same import in the old state');
    const gleich = await lauf('manifest.json');
    pruefe('N6b', 'the same import committed into the old state: both states load it, the proof holds', gleich.status === 0 && /PROOF GIVEN/.test(gleich.aus), gleich.aus);
    const zeilen = fremd.aus.match(/program of the old state: (\d+) files/);
    pruefe('N6c', 'the output names the programs of both states', !!zeilen && /program of the new state: \d+ files/.test(fremd.aus), fremd.aus.slice(0, 400));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

void haupt().then(() => {
  console.log(rot === 0 ? `\nverschiebung-aufruf: ${faelle} cases, all as expected.` : `\nverschiebung-aufruf: ${rot} of ${faelle} cases FAILED.`);
  process.exit(rot === 0 ? 0 : 1);
});
