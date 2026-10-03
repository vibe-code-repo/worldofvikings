/**
 * GD2: the reconciliation of the item working copy with the repo state and the basis file (`gegenstaendeAbgleichen`),
 * and what the game server's start does with the result. Every case runs in its own folder under /tmp/gd2-abgleich-*.
 *
 * The working copy holds only DEVIATIONS (own items, base items edited on purpose). A base item without an entry follows
 * the repo; the reconciliation never writes the 29 base entries into the file and takes out what is no deviation.
 *
 *  [1] DEV states replayed (DEV has a basis equal to its `[]` copy): nothing is written, 29 active; a Holzaxt copy is no conflict;
 *      broken / 0 byte / wrong head → 29 known, nothing held back; missing → an EMPTY document.
 *  [2] Clean-out: a file with the 29 repo copies (older build) + a Holzaxt loses exactly the 29 (back-up); an untouched copy of an
 *      older repo state is emptied; other key order / number form / entry order is no deviation; a deviation stays.
 *  [3] A change of the repo reaches the game for every base item without an entry (also `ernte`), and `grundErsetzt` names only
 *      real deviations; a deviation with a moved repo is ONE conflict report (the working copy wins, byte-equal).
 *  [4] Abort-proof order (working copy first, basis second), `pruefen` writes nothing, repo missing / broken, the lock.
 *  [5] The start wrapper (`gegenstaendeAbgleichenBeimStart`): conflict = warning, broken = error, never throws.
 *  [6] The wiring: `main.ts` calls the start wrapper as a statement of its own BEFORE `ladeGegenstandsDatei` (syntax tree).
 *
 * Run: npx tsx server/test/gd2-abgleich.ts   (from the repo root)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import {
  GRUNDBESTAND,
  GRUNDBESTAND_IDS,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  setzeGrundbestand,
  wendeGegenstandsDatenAn,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import {
  gegenstaendeAbgleichen,
  gegenstandsBasisLesen,
  gegenstandsRepoDatei,
} from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { layoutHash, layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { gegenstaendeAbgleichenBeimStart, ladeGegenstandsDatei } from '../src/world/gegenstandsLive.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ECHT = readFileSync(gegenstandsRepoDatei(WURZEL));
const ORDNER = mkdtempSync('/tmp/gd2-abgleich-');
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const stumm = { log: () => undefined, warn: () => undefined, error: () => undefined };
const sha = (b: Buffer | string): string => layoutHash(b);

let nr = 0;
interface Fall { dir: string; repo: string; arbeit: string; basis: string }
/** A fresh folder with a repo file (the real one unless `repoBytes` is given). */
function neuerFall(repoBytes: Buffer | string | null = REPO_ECHT): Fall {
  const dir = resolve(ORDNER, `f${++nr}`);
  mkdirSync(dir, { recursive: true });
  const repo = resolve(dir, 'repo', 'gegenstaende.json');
  mkdirSync(dirname(repo), { recursive: true });
  if (repoBytes !== null) writeFileSync(repo, repoBytes);
  const arbeit = resolve(dir, 'arbeit', 'gegenstaende.json');
  mkdirSync(dirname(arbeit), { recursive: true });
  return { dir, repo, arbeit, basis: resolve(dir, 'arbeit', 'gegenstaende.basis') };
}
type Roh = Record<string, unknown>;
const repoRoh = (): Roh[] => (JSON.parse(REPO_ECHT.toString('utf-8')) as { gegenstaende: Roh[] }).gegenstaende;
const dokument = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
const holzaxt: Roh = {
  id: 'Holzaxt', nameSchluessel: 'inhalt.gegenstand.Holzaxt.name', typ: 'material', stapel: 1,
  texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' } },
};
const mitErnte = (id: string, ernte: Roh): Roh => ({ ...repoRoh().find((e) => e.id === id)!, ernte });
const ids = (pfad: string): string => (JSON.parse(readFileSync(pfad, 'utf-8')) as { gegenstaende: Array<{ id: string }> }).gegenstaende.map((e) => e.id).join();
const baks = (f: Fall): string[] => readdirSync(dirname(f.arbeit)).filter((n) => n.endsWith('.bak'));
/** The repo file with the harvest field of AxeFlint changed (1 → 2): another repo state. */
function repoAnders(): string {
  const doc = JSON.parse(REPO_ECHT.toString('utf-8')) as { version: number; gegenstaende: Roh[] };
  doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte = { baum: 2 };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
interface Geladen { art: string; bekannt: number; extra: string[]; grundErsetzt: number }
/** Applies what the working copy says, the way the server's start does. */
function laden(f: Fall): Geladen {
  wendeGegenstandsDatenAn([]);
  const r = ladeGegenstandsDatei(f.arbeit, stumm);
  const bekannt = GRUNDBESTAND_IDS.filter((id) => findItem(id) !== undefined).length;
  const extra = r.eintraege.map((e) => e.id).filter((id) => !GRUNDBESTAND_IDS.includes(id));
  const lesung = existsSync(f.arbeit) ? leseGegenstandsDatei(readFileSync(f.arbeit, 'utf-8')) : null;
  return { art: r.art, bekannt, extra, grundErsetzt: lesung?.grundErsetzt.length ?? 0 };
}

console.log('\n[1] DEV states replayed');
{
  // what DEV has: `[]` and a basis equal to it (read from a copy of the DEV files in the attack of 03.10.)
  const f = neuerFall();
  const leer = schreibeGegenstandsDatei([]);
  writeFileSync(f.arbeit, leer);
  writeFileSync(f.basis, `${sha(leer)}\n`);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('DEV state (`[]`, basis = that copy): unveraendert, the file is NOT touched (byte-equal), no back-up', a.fall === 'unveraendert' && readFileSync(f.arbeit, 'utf-8') === leer && baks(f).length === 0, a.fall);
  check('... the basis is now the repo hash', gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT));
  const s = laden(f);
  check('after the start: 29 base items active, nothing else, nothing replaced', s.art === 'angewendet' && s.bekannt === 29 && s.extra.length === 0 && s.grundErsetzt === 0, JSON.stringify(s));
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('a second run changes nothing', b.fall === 'unveraendert' && readFileSync(f.arbeit, 'utf-8') === leer);
}
{
  const f = neuerFall();
  const leer = schreibeGegenstandsDatei([]);
  writeFileSync(f.arbeit, leer);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('`[]` without any basis: unveraendert as well (no copying of the 29), basis written', a.fall === 'unveraendert' && readFileSync(f.arbeit, 'utf-8') === leer && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT), a.fall);
}
{
  const f = neuerFall();
  const text = dokument([holzaxt]);
  writeFileSync(f.arbeit, text);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('a Holzaxt copy, no basis: no deviation of a base item, so NO conflict (unveraendert), byte-equal', a.fall === 'unveraendert' && readFileSync(f.arbeit, 'utf-8') === text && baks(f).length === 0, a.fall);
  const s = laden(f);
  check('after the start: 29 base items + Holzaxt active', s.art === 'angewendet' && s.bekannt === 29 && s.extra.join() === 'Holzaxt' && findItem('Holzaxt') !== undefined, JSON.stringify(s));
}
for (const [name, bytes] of [['broken (no JSON)', 'das ist {kein json'], ['0 byte', ''], ['wrong head', '{"version":7,"gegenstaende":[]}']] as const) {
  const f = neuerFall();
  writeFileSync(f.arbeit, bytes);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check(`${name}: arbeit-kaputt, nothing written (bytes equal, no basis, no backup)`, a.fall === 'arbeit-kaputt' && readFileSync(f.arbeit, 'utf-8') === bytes && !existsSync(f.basis) && baks(f).length === 0, a.fall);
  const s = laden(f);
  check(`${name}: 29 base items known, no extra`, s.bekannt === 29 && s.extra.length === 0, JSON.stringify(s));
  setzeUnbekannteVerwahren(true);
  const inv = new Inventory();
  inv.load(GRUNDBESTAND_IDS.map((n, i) => ({ name: n, stack: 1, durability: 0, quality: 1, gridX: i % 8, gridY: Math.floor(i / 8), equipped: false })));
  const truhe = unpackContainer(JSON.stringify(GRUNDBESTAND_IDS.slice(0, 12).map((n) => [n, 1, null, 1])));
  check(`${name}: 29 stacks in an inventory, 0 held back; chest 12, 0 held back`, inv.all.length === 29 && inv.verwahrte.length === 0 && truhe.all.length === 12 && truhe.verwahrte.length === 0, `${inv.all.length}/${inv.verwahrte.length}`);
  setzeUnbekannteVerwahren(false);
}
{
  const f = neuerFall();
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  const leer = schreibeGegenstandsDatei([]);
  check('working copy missing: an EMPTY document is created (angelegt), basis = repo hash', a.fall === 'angelegt' && readFileSync(f.arbeit, 'utf-8') === leer && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT), a.fall);
  const s = laden(f);
  check('after the start: 29 active', s.bekannt === 29 && s.extra.length === 0);
}

console.log('\n[2] Clean-out');
{
  // the state an older build of this branch left: the 29 repo copies and an own item
  const f = neuerFall();
  const alt = dokument([...repoRoh(), holzaxt]);
  writeFileSync(f.arbeit, alt);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('the 29 repo copies + Holzaxt: bereinigt, exactly the 29 ids reported', a.fall === 'bereinigt' && a.bereinigt?.length === 29 && GRUNDBESTAND_IDS.every((id) => a.bereinigt?.includes(id)), `${a.fall} ${a.bereinigt?.length}`);
  check('... only the Holzaxt is left in the file', ids(f.arbeit) === 'Holzaxt', ids(f.arbeit));
  check('... the old file lies there as a back-up, byte-equal; basis = repo', baks(f).length === 1 && readFileSync(resolve(dirname(f.arbeit), baks(f)[0]!), 'utf-8') === alt && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT));
  check('... the message names it loudly enough (cleaned, ids, back-up)', a.meldung.includes('bereinigt') && a.meldung.includes('Wood') && a.meldung.includes('.bak'), a.meldung.slice(0, 120));
  const s = laden(f);
  check('after the start: 29 + Holzaxt active', s.bekannt === 29 && s.extra.join() === 'Holzaxt' && s.grundErsetzt === 0, JSON.stringify(s));
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('a second run: unveraendert (clean)', b.fall === 'unveraendert' && baks(f).length === 1);
}
{
  // an untouched copy of an OLDER repo state (file = basis): every base entry in it is emptied, whatever it says
  const f = neuerFall();
  const altRepo = dokument(repoRoh().map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 9 } } : e)));
  writeFileSync(f.arbeit, altRepo);
  writeFileSync(f.basis, `${sha(altRepo)}\n`);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('an untouched copy of an older repo state (= basis): bereinigt, the file is empty afterwards', a.fall === 'bereinigt' && ids(f.arbeit) === '' && a.bereinigt?.length === 29, `${a.fall} ${ids(f.arbeit)}`);
  check('... no conflict even though the Wood entry differed from the repo', !a.meldung.includes('Konflikt'));
}
{
  // other key order, number form and entry order are no deviation
  const f = neuerFall();
  const umgekehrt = (e: Roh): Roh => Object.fromEntries(Object.entries(e).reverse());
  const eintraege = [umgekehrt(repoRoh().find((e) => e.id === 'Hammer')!), umgekehrt(repoRoh().find((e) => e.id === 'Wood')!), holzaxt];
  const text = JSON.stringify({ gegenstaende: eintraege, version: 1 }).replace(/"stapel":(\d+)/g, '"stapel":$1.0');
  writeFileSync(f.arbeit, text);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('Hammer and Wood with reversed keys, `1.0` numbers, other order: bereinigt (no deviation), Holzaxt stays', a.fall === 'bereinigt' && JSON.stringify([...(a.bereinigt ?? [])].sort()) === '["Hammer","Wood"]' && ids(f.arbeit) === 'Holzaxt', `${a.fall} ${ids(f.arbeit)}`);
}
{
  // a deviation stays, an equal entry next to it goes
  const f = neuerFall();
  writeFileSync(f.arbeit, dokument([mitErnte('Wood', { baum: 3 }), repoRoh().find((e) => e.id === 'Stone')!, holzaxt]));
  writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('Wood.ernte changed (deviation) + Stone equal + Holzaxt: only Stone goes, no conflict (repo = basis)', a.fall === 'bereinigt' && a.bereinigt?.join() === 'Stone' && a.abweichend?.join() === 'Wood' && ids(f.arbeit) === 'Wood,Holzaxt', `${a.fall} ${ids(f.arbeit)}`);
  const s = laden(f);
  check('... Wood runs with the own harvest value, Holzaxt active, nothing replaced', findItem('Wood')?.ernte?.baum === 3 && s.extra.join() === 'Holzaxt' && s.grundErsetzt === 0, JSON.stringify(findItem('Wood')?.ernte));
}

console.log('\n[3] A change of the repo reaches the game');
{
  // the attack of 03.10.: a working copy with an own item, later the repo changes AxeFlint.ernte 1 → 2
  const f = neuerFall();
  writeFileSync(f.arbeit, dokument([holzaxt]));
  gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  writeFileSync(f.repo, repoAnders());
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('the repo changed AxeFlint, the copy has no AxeFlint entry: unveraendert, no conflict, file untouched', a.fall === 'unveraendert' && ids(f.arbeit) === 'Holzaxt' && (a.abweichend ?? []).length === 0, a.fall);
  // a new build bakes the new repo state in
  const neuerBestand = leseGegenstandsDatei(repoAnders()).eintraege;
  try {
    setzeGrundbestand(neuerBestand);
    const s = laden(f);
    check('a game built from the new repo: AxeFlint harvests 2 (the new value arrives), Holzaxt active, grundErsetzt 0', findItem('AxeFlint')?.ernte?.baum === 2 && s.extra.join() === 'Holzaxt' && s.grundErsetzt === 0, JSON.stringify(findItem('AxeFlint')?.ernte));
  } finally {
    setzeGrundbestand(GRUNDBESTAND);
    wendeGegenstandsDatenAn([]);
  }
  check('with the old build the value is still 1 (so the 2 above came from the repo state, not from the file)', laden(f).bekannt === 29 && findItem('AxeFlint')?.ernte?.baum === 1);
}
{
  // a deviation and a moved repo: ONE conflict report, the working copy wins
  const f = neuerFall();
  const eigen = dokument([mitErnte('AxeFlint', { baum: 3 }), holzaxt]);
  writeFileSync(f.arbeit, eigen);
  writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
  writeFileSync(f.repo, repoAnders());
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('AxeFlint overridden, the repo moved: konflikt, naming AxeFlint', a.fall === 'konflikt' && a.abweichend?.join() === 'AxeFlint' && a.meldung.includes('WARNUNG') && a.meldung.includes('AxeFlint'), a.fall);
  check('... the working copy is byte-equal (nothing overwritten), no back-up', readFileSync(f.arbeit, 'utf-8') === eigen && baks(f).length === 0);
  check('... the basis is the repo hash now: the conflict is reported once', gegenstandsBasisLesen(f.arbeit) === sha(readFileSync(f.repo)));
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('a second run: unveraendert (no repeated warning), the deviation is still named', b.fall === 'unveraendert' && b.abweichend?.join() === 'AxeFlint');
}
{
  // an invalid copy of a base item: replaced and named, the rest of the file is applied (the file is not lost)
  const f = neuerFall();
  writeFileSync(f.arbeit, dokument([{ ...repoRoh().find((e) => e.id === 'Wood')!, stapel: 'viel' }, holzaxt]));
  writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('an invalid Wood copy: kept in the file as a deviation (the editor can heal it), not "equal"', a.abweichend?.join() === 'Wood' && ids(f.arbeit) === 'Wood,Holzaxt', `${a.fall} ${ids(f.arbeit)}`);
  const s = laden(f);
  check('the game applies the file: Holzaxt active, Wood is the base entry (stack 50), Wood named in grundErsetzt', s.art === 'angewendet' && s.extra.join() === 'Holzaxt' && s.grundErsetzt === 1 && findItem('Wood')?.maxStackSize === 50, JSON.stringify(s));
}

console.log('\n[4] Abort-proof order, pruefen, repo missing / broken, the lock');
{
  // abort between the two writes: the working copy is written FIRST, so the basis is still old afterwards
  const f = neuerFall();
  const alt = dokument([...repoRoh(), holzaxt]);
  writeFileSync(f.arbeit, alt);
  writeFileSync(f.basis, `${sha('ein alter Repo-Stand')}\n`);
  let geworfen = false;
  try {
    gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, zwischenschritt: () => { throw new Error('Absturz'); } });
  } catch {
    geworfen = true;
  }
  check('an abort between the two writes: the working copy is already cleaned, the basis is still the old one', geworfen && ids(f.arbeit) === 'Holzaxt' && gegenstandsBasisLesen(f.arbeit) === sha('ein alter Repo-Stand'), `${geworfen} ${ids(f.arbeit)}`);
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('the next run repeats nothing harmful: unveraendert, basis := repo, Holzaxt still there, no second back-up', b.fall === 'unveraendert' && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT) && ids(f.arbeit) === 'Holzaxt' && baks(f).length === 1, b.fall);
}
{
  const f = neuerFall();
  const text = dokument([...repoRoh(), holzaxt]);
  writeFileSync(f.arbeit, text);
  const vorher = readdirSync(dirname(f.arbeit)).join();
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, modus: 'pruefen' });
  check('pruefen names the case (bereinigt) and writes nothing', a.fall === 'bereinigt' && readdirSync(dirname(f.arbeit)).join() === vorher && readFileSync(f.arbeit, 'utf-8') === text && !existsSync(f.basis), a.fall);
  const g = neuerFall();
  const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit, modus: 'pruefen' });
  check('pruefen with a missing working copy: angelegt, nothing created', b.fall === 'angelegt' && !existsSync(g.arbeit) && !existsSync(g.basis));
}
{
  const f = neuerFall(null);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('repo file missing, no working copy: repo-fehlt, nothing created', a.fall === 'repo-fehlt' && !existsSync(f.arbeit) && !existsSync(f.basis), a.fall);
  const g = neuerFall('kein json');
  const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
  check('repo file broken, no working copy: repo-kaputt, nothing created', b.fall === 'repo-kaputt' && !existsSync(g.arbeit) && !existsSync(g.basis), b.fall);
  const h = neuerFall('kein json');
  const text = dokument([...repoRoh(), holzaxt]);
  writeFileSync(h.arbeit, text);
  const c = gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
  check('repo file broken, working copy there: repo-kaputt, working copy untouched (nothing cleaned)', c.fall === 'repo-kaputt' && readFileSync(h.arbeit, 'utf-8') === text && !existsSync(h.basis) && baks(h).length === 0, c.fall);
}
{
  const f = neuerFall();
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.repo });
  check('the same path for repo and working copy: gleicher-pfad, nothing done', a.fall === 'gleicher-pfad');
}
{
  const f = neuerFall();
  writeFileSync(f.arbeit, dokument([...repoRoh()]));
  let geworfen = '';
  layoutUnterSperre(f.arbeit, () => {
    try {
      gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, sperreWartenMs: 0 });
    } catch (e) {
      geworfen = (e as Error).name;
    }
  });
  check('under a held lock the reconciliation does not run (throws, writes nothing)', geworfen !== '' && ids(f.arbeit).split(',').length === 29 && !existsSync(f.basis), geworfen);
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, sperreWartenMs: 0 });
  check('after the release it runs', b.fall === 'bereinigt' && ids(f.arbeit) === '');
}

console.log('\n[5] The start wrapper');
{
  const mitWurzel = (): Fall => {
    const f = neuerFall(null);
    mkdirSync(resolve(f.dir, 'shared/data'), { recursive: true });
    writeFileSync(gegenstandsRepoDatei(f.dir), REPO_ECHT);
    return f;
  };
  const sammler = (z: string[]) => ({ log: (t: string) => z.push(`log ${t}`), warn: (t: string) => z.push(`warn ${t}`), error: (t: string) => z.push(`error ${t}`) });
  const f = neuerFall(null);
  writeFileSync(f.arbeit, dokument([holzaxt]));
  const z1: string[] = [];
  const r1 = gegenstaendeAbgleichenBeimStart(f.dir, f.arbeit, sammler(z1));
  check('without a repo file under the root: repo-fehlt, one log line, no throw', r1?.fall === 'repo-fehlt' && z1.length === 1 && z1[0]!.startsWith('log '), JSON.stringify(z1));
  const g = mitWurzel();
  writeFileSync(g.arbeit, dokument([mitErnte('AxeFlint', { baum: 3 }), holzaxt]));
  const z2: string[] = [];
  const r2 = gegenstaendeAbgleichenBeimStart(g.dir, g.arbeit, sammler(z2));
  check('a conflict (deviation, no basis) is ONE warning line naming the conflict', r2?.fall === 'konflikt' && z2.length === 1 && z2[0]!.startsWith('warn ') && z2[0]!.includes('Konflikt'), JSON.stringify(z2));
  const g2 = mitWurzel();
  writeFileSync(g2.arbeit, dokument([...repoRoh(), holzaxt]));
  const z2b: string[] = [];
  gegenstaendeAbgleichenBeimStart(g2.dir, g2.arbeit, sammler(z2b));
  check('a clean-out is a log line (not a warning)', z2b.length === 1 && z2b[0]!.startsWith('log ') && z2b[0]!.includes('bereinigt'), JSON.stringify(z2b));
  const h = mitWurzel();
  writeFileSync(h.arbeit, 'kaputt');
  const z3: string[] = [];
  gegenstaendeAbgleichenBeimStart(h.dir, h.arbeit, sammler(z3));
  check('a broken working copy is an ERROR line', z3.length === 1 && z3[0]!.startsWith('error '), JSON.stringify(z3));
  const i = mitWurzel();
  writeFileSync(resolve(i.dir, 'blockiert'), 'x');
  const z4: string[] = [];
  let r4: unknown = 'nicht gelaufen';
  let geworfen = false;
  try {
    r4 = gegenstaendeAbgleichenBeimStart(i.dir, resolve(i.dir, 'blockiert', 'gegenstaende.json'), sammler(z4));
  } catch {
    geworfen = true;
  }
  check('an I/O error never stops the start: null, one error line, no throw', !geworfen && r4 === null && z4.length === 1 && z4[0]!.startsWith('error '), JSON.stringify(z4));
}

console.log('\n[6] The wiring in main.ts');
{
  const datei = resolve(WURZEL, 'server/src/main.ts');
  const quelle = ts.createSourceFile(datei, readFileSync(datei, 'utf-8'), ts.ScriptTarget.Latest, true);
  const aufrufe: Array<{ name: string; pos: number; oberste: boolean; argumente: string[] }> = [];
  const besuche = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const oberste = ts.isExpressionStatement(n.parent) && n.parent.parent === quelle;
      aufrufe.push({ name: n.expression.text, pos: n.getStart(quelle), oberste, argumente: n.arguments.map((a) => a.getText(quelle)) });
    }
    ts.forEachChild(n, besuche);
  };
  besuche(quelle);
  const abgleich = aufrufe.filter((a) => a.name === 'gegenstaendeAbgleichenBeimStart');
  const laden2 = aufrufe.filter((a) => a.name === 'ladeGegenstandsDatei');
  check('main.ts calls gegenstaendeAbgleichenBeimStart exactly once, as a top-level statement', abgleich.length === 1 && abgleich[0]!.oberste, JSON.stringify(abgleich));
  check('main.ts calls ladeGegenstandsDatei exactly once', laden2.length === 1);
  check('the reconciliation comes BEFORE the load (source order)', abgleich.length === 1 && laden2.length === 1 && abgleich[0]!.pos < laden2[0]!.pos);
  check('both get the same working copy variable (gegenstandsDatei)', abgleich.length === 1 && laden2.length === 1 && abgleich[0]!.argumente[1] === 'gegenstandsDatei' && laden2[0]!.argumente[0] === 'gegenstandsDatei', JSON.stringify([abgleich[0]?.argumente, laden2[0]?.argumente]));
  check('the root argument is the repo root (resolve(DATA_DIR, "../.."), like the path of the working copy)', abgleich.length === 1 && /^resolve\(DATA_DIR,\s*['"]\.\.\/\.\.['"]\)$/.test(abgleich[0]!.argumente[0] ?? ''), abgleich[0]?.argumente[0]);
}

wendeGegenstandsDatenAn([]);
rmSync(ORDNER, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
