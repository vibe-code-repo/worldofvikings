/**
 * GD2 N3: the history of `shared/data/gegenstaende.json` (`shared/data/gegenstaende-historie/<sha256>.json`).
 * An old working copy holds only the SHA-256 of the repo state it was made from (basis written since GD1); the reconciliation
 * finds that state in the history and compares every entry with its own state of then. So the history must GROW with the repo
 * file: every state the file has had since GD1 stays there, and the CURRENT one must be there too. A PR that changes the repo
 * file without adding the new state to the history fails here.
 *
 *  [1] Every file is named by the SHA-256 of its own bytes and is a readable item file (as written, no base-stock check).
 *  [2] The current repo state is in the history (this is the check no future PR can forget).
 *  [3] The states instances can have a basis for are there: the G1 state (`[]`, the hash the DEV basis holds), the state of
 *      the first GD1 commit, and the one the GD1 merge brought.
 *
 * Run: npx tsx test/gd2-historie.ts   (from shared/, cwd as in scripts/kern/shared.mjs)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leseGegenstandsDatei } from '../src/items/gegenstandsDaten.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

const DATEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const REPO = resolve(DATEN, 'gegenstaende.json');
const ORDNER = resolve(DATEN, 'gegenstaende-historie');
const dateien = existsSync(ORDNER) ? readdirSync(ORDNER).sort() : [];

console.log('\n[1] Every history file is what its name says');
check('the history folder exists and holds at least the three known states', dateien.length >= 3, String(dateien.length));
for (const name of dateien) {
  const passt = /^[0-9a-f]{64}\.json$/.test(name);
  const bytes = passt ? readFileSync(resolve(ORDNER, name)) : Buffer.alloc(0);
  const lesung = leseGegenstandsDatei(bytes.toString('utf-8'), { ohneGrundsperre: true });
  check(`${name.slice(0, 12)}…: named by its SHA-256, a readable item file without discarded entries`, passt && sha(bytes) === name.slice(0, 64) && lesung.dateiFehler === null && lesung.verworfen.length === 0, passt ? `${sha(bytes).slice(0, 12)} ${String(lesung.dateiFehler)}` : name);
}

console.log('\n[2] The current repo state is in the history');
const aktuell = sha(readFileSync(REPO));
check(`the current state of shared/data/gegenstaende.json (${aktuell.slice(0, 12)}) is in shared/data/gegenstaende-historie/ — a PR that changes the repo file must add the new state there (copy the file to <its sha256>.json)`, dateien.includes(`${aktuell}.json`), aktuell);

console.log('\n[3] The states instances can hold a basis hash for');
check('the G1 state `{"version":1,"gegenstaende":[]}` (the hash the DEV basis holds, c50a7f30…)', dateien.includes('c50a7f302964aac7bb8ff11d73de748a676e8d70f3befa55791606842c153bcf.json'));
check('the state of the first GD1 commit (56553c83…)', dateien.includes('56553c83136ca99cf04ecf1df616cdc486e704b872c498bf097be77e785026d9.json'));
check('the state the GD1 merge brought (92b0666f…)', dateien.includes('92b0666f2967086849160821897180e03a269b1cc19721afb7d448c2de126612.json'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
