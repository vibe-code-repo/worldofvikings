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
  grundbestandEintraege,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  setzeGrundbestand,
  wendeGegenstandsDatenAn,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import {
  gegenstandsHinweiseLesen,
  gegenstaendeAbgleichen,
  gegenstandsBasisLesen,
  gegenstandsHistorieDatei,
  nurAbweichungen,
  gegenstandsBasisStand,
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

console.log('\n[3b] The basis holds the full repo state (N2)');
{
  const holzEintrag = leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!;
  /** What `main` (GD1) wrote for a missing copy and the mask saved afterwards: the 29 repo entries + an own item, written canonically. */
  const main29PlusX = (repoText: string | Buffer): string => schreibeGegenstandsDatei([...leseGegenstandsDatei(repoText.toString()).eintraege, holzEintrag]);
  const neuerBau = (repoText: string): (() => void) => {
    // like `grundbestand.ts` at module start: read the new file against an EMPTY base stock (else the changed locked fields would be replaced)
    setzeGrundbestand([]);
    const neu = leseGegenstandsDatei(repoText).eintraege;
    setzeGrundbestand(neu);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  {
    // the attack's probe Z1: `main` made the copy (hash-only basis R0), the mask added a Holzaxt, then the repo moves (AxeFlint.ernte 1 → 2)
    const f = neuerFall(repoAnders());
    const r0 = REPO_ECHT;
    writeFileSync(f.arbeit, main29PlusX(r0));
    writeFileSync(f.basis, `${sha(r0)}\n`);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Z1: 29 copies of R0 + Holzaxt, hash-only basis R0, repo R1: bereinigt, all 29 (rebuilt basis state, verified by its hash)', a.fall === 'bereinigt' && a.bereinigt?.length === 29 && (a.abweichend ?? []).length === 0, `${a.fall} ${a.bereinigt?.length} ${a.meldung.slice(0, 160)}`);
    check('Z1: no conflict, only the Holzaxt is left, the old file is in the back-up', ids(f.arbeit) === 'Holzaxt' && baks(f).length === 1 && !a.meldung.includes('Konflikt'), ids(f.arbeit));
    check('Z1: the basis is now a FULL copy of the repo file (R1)', gegenstandsBasisStand(f.arbeit)?.text === repoAnders() && gegenstandsBasisLesen(f.arbeit) === sha(repoAnders()));
    const zurueck = neuerBau(repoAnders());
    try {
      const s = laden(f);
      check('Z1: a game built from R1: AxeFlint harvests 2 (it follows the repo), Holzaxt active, grundErsetzt 0', findItem('AxeFlint')?.ernte?.baum === 2 && s.extra.join() === 'Holzaxt' && s.grundErsetzt === 0, JSON.stringify(findItem('AxeFlint')?.ernte));
    } finally {
      zurueck();
    }
  }
  {
    // the same, but one base entry was edited before: the hash does not match, only "equals the repo entry" counts (the honest limit of an old basis)
    const f = neuerFall(repoAnders());
    const alt = leseGegenstandsDatei(main29PlusX(REPO_ECHT)).eintraege.map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 3 } } : e));
    writeFileSync(f.arbeit, schreibeGegenstandsDatei(alt));
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('old basis + an edited base entry: only the copies equal to R1 go (27), the edited Wood AND the stale AxeFlint stay, reported as a conflict', a.fall === 'konflikt' && a.bereinigt?.length === 27 && [...(a.abweichend ?? [])].sort().join() === 'AxeFlint,Wood', `${a.fall} ${a.bereinigt?.length} ${a.abweichend?.join()}`);
  }
  {
    // full basis R0: every entry is compared with its own state of then
    const f = neuerFall(repoAnders());
    const alt = leseGegenstandsDatei(main29PlusX(REPO_ECHT)).eintraege.map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 3 } } : e));
    writeFileSync(f.arbeit, schreibeGegenstandsDatei(alt));
    writeFileSync(f.basis, REPO_ECHT);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('full basis R0, Wood edited, repo R1 changed only AxeFlint: 28 copies go (AxeFlint included), Wood and Holzaxt stay, NO conflict', a.fall === 'bereinigt' && a.bereinigt?.length === 28 && a.bereinigt.includes('AxeFlint') && ids(f.arbeit) === 'Wood,Holzaxt', `${a.fall} ${a.bereinigt?.length} ${ids(f.arbeit)}`);
    check('... the edited Wood is still named as a deviation', a.abweichend?.join() === 'Wood');
    const zurueck = neuerBau(repoAnders());
    try {
      laden(f);
      check('... a game built from R1: AxeFlint follows the repo (2), Wood keeps the own harvest (3)', findItem('AxeFlint')?.ernte?.baum === 2 && findItem('Wood')?.ernte?.baum === 3);
    } finally {
      zurueck();
    }
  }
  {
    // full basis R0, AxeFlint edited AND the repo changed AxeFlint: a real conflict naming only AxeFlint
    const f = neuerFall(repoAnders());
    writeFileSync(f.arbeit, dokument([mitErnte('AxeFlint', { baum: 3 }), mitErnte('Wood', { baum: 3 })]));
    writeFileSync(f.basis, REPO_ECHT);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('AxeFlint edited and changed in the repo, Wood edited and unchanged in the repo: konflikt naming ONLY AxeFlint', a.fall === 'konflikt' && a.meldung.includes('(AxeFlint)') && [...(a.abweichend ?? [])].sort().join() === 'AxeFlint,Wood', `${a.fall} ${a.meldung.slice(0, 200)}`);
    check('... nothing overwritten (the file is byte-equal), basis = R1 (reported once)', ids(f.arbeit) === 'AxeFlint,Wood' && baks(f).length === 0 && gegenstandsBasisStand(f.arbeit)?.text === repoAnders());
    const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('... the second run is quiet (unveraendert)', b.fall === 'unveraendert');
  }
  {
    // N1-D: an item the repo no longer has, the copy untouched
    const mitAlt = (repoText: Buffer | string): string => {
      const doc = JSON.parse(repoText.toString()) as { version: number; gegenstaende: Roh[] };
      doc.gegenstaende.push({ ...holzaxt, id: 'Alteaxt', nameSchluessel: 'inhalt.gegenstand.Alteaxt.name', texte: { 'inhalt.gegenstand.Alteaxt.name': { de: 'Alteaxt', en: 'Old axe' } } });
      return `${JSON.stringify(doc, null, 2)}\n`;
    };
    const r0 = mitAlt(REPO_ECHT);
    const f = neuerFall(REPO_ECHT);
    writeFileSync(f.arbeit, dokument([...JSON.parse(r0).gegenstaende, holzaxt]));
    writeFileSync(f.basis, r0);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('full basis with an item the repo dropped (Alteaxt), copy unchanged: the Alteaxt is removed with a message, the Holzaxt stays', a.fall === 'bereinigt' && a.entfallen?.join() === 'Alteaxt' && a.meldung.includes('Nicht mehr im Repo') && ids(f.arbeit) === 'Holzaxt', `${a.fall} ${a.entfallen?.join()} ${ids(f.arbeit)}`);
    const g = neuerFall(REPO_ECHT);
    writeFileSync(g.arbeit, dokument(JSON.parse(r0).gegenstaende));
    writeFileSync(g.basis, `${sha(Buffer.from(dokument(JSON.parse(r0).gegenstaende)))}\n`);
    const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('old basis, the whole file equals it (an untouched copy of an older repo): everything goes, the dropped item too (entfallen)', b.fall === 'bereinigt' && b.entfallen?.join() === 'Alteaxt' && ids(g.arbeit) === '', `${b.fall} ${b.entfallen?.join()}`);
    const h = neuerFall(REPO_ECHT);
    writeFileSync(h.arbeit, dokument([{ ...JSON.parse(r0).gegenstaende.at(-1), stapel: 7 }]));
    writeFileSync(h.basis, r0);
    gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
    check('a dropped item the admin CHANGED stays as an own item (not removed)', ids(h.arbeit) === 'Alteaxt');
  }
  {
    // the new basis is written for every case that has to write one
    const f = neuerFall();
    writeFileSync(f.arbeit, dokument([holzaxt]));
    writeFileSync(f.basis, `${sha('alt')}\n`);
    gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('an old hash-only basis is replaced by a full copy of the repo file', gegenstandsBasisStand(f.arbeit)?.text === REPO_ECHT.toString());
    const h = neuerFall();
    writeFileSync(h.arbeit, dokument([holzaxt]));
    writeFileSync(h.basis, `${sha(REPO_ECHT)}\n`);
    gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
    check('a hash-only basis that EQUALS the repo hash is replaced by the full copy as well (the old format is migrated, not kept)', gegenstandsBasisStand(h.arbeit)?.text === REPO_ECHT.toString());
    const g = neuerFall();
    gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('a created copy gets the full basis too', gegenstandsBasisStand(g.arbeit)?.text === REPO_ECHT.toString());
  }
}

console.log('\n[3b2] Hash basis from GD1 + a repo change of a LOCKED field at the same time (N3)');
{
  const holzEintrag = leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!;
  const main29PlusX = (repoText: string | Buffer): string => schreibeGegenstandsDatei([...leseGegenstandsDatei(repoText.toString(), { ohneGrundsperre: true }).eintraege, holzEintrag]);
  /** R1': the repo changed Wood.gewicht (a locked field) AND AxeFlint.ernte 1 → 2 in one go: the probe of the attack of 03.10. */
  const r1 = ((): string => {
    const doc = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
    doc.gegenstaende.find((e) => e.id === 'Wood')!.gewicht = 9.5;
    doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte = { baum: 2 };
    return `${JSON.stringify(doc, null, 2)}\n`;
  })();
  const neuerBau = (text: string): (() => void) => {
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(text).eintraege);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  /** The history folder next to the repo file of this case (as `shared/data/gegenstaende-historie/` in the repo). */
  const historie = (f: Fall, text: string | Buffer): void => {
    const ziel = gegenstandsHistorieDatei(f.repo, sha(Buffer.from(text)));
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, text);
  };
  for (const mitHistorie of [true, false]) {
    const wie = mitHistorie ? 'with the history' : 'without a history file (rebuilt from the file, verified by the hash)';
    const f = neuerFall(r1);
    if (mitHistorie) historie(f, REPO_ECHT);
    writeFileSync(f.arbeit, main29PlusX(REPO_ECHT));
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    // the reconciliation runs in the NEW build (the base stock baked in is R1'), as at the start after a rollout
    const zurueck = neuerBau(r1);
    try {
      const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check(`Wood.gewicht AND AxeFlint.ernte changed, 29 copies of R0 + Holzaxt, hash basis, ${wie}: bereinigt all 29, no conflict`, a.fall === 'bereinigt' && a.bereinigt?.length === 29 && (a.abweichend ?? []).length === 0 && !a.basisUnbekannt, `${a.fall} ${a.bereinigt?.length} ${a.abweichend?.join()}`);
      check(`... only the Holzaxt is left, the basis is the full copy of R1'`, ids(f.arbeit) === 'Holzaxt' && gegenstandsBasisStand(f.arbeit)?.text === r1);
      const l = laden(f);
      check(`... the game: AxeFlint harvests 2 (follows the repo), Wood has the new weight, nothing is named in grundErsetzt`, findItem('AxeFlint')?.ernte?.baum === 2 && findItem('Wood')?.weight === 9.5 && l.grundErsetzt === 0 && l.extra.join() === 'Holzaxt', `${JSON.stringify(findItem('AxeFlint')?.ernte)} ${findItem('Wood')?.weight}`);
    } finally {
      zurueck();
    }
  }
  {
    // the history also carries a file with an EDITED base entry: every entry against its own state of then
    const f = neuerFall(r1);
    historie(f, REPO_ECHT);
    const alt = leseGegenstandsDatei(main29PlusX(REPO_ECHT), { ohneGrundsperre: true }).eintraege.map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 3 } } : e));
    writeFileSync(f.arbeit, schreibeGegenstandsDatei(alt));
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    const zurueck = neuerBau(r1);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    zurueck();
    check('an EDITED Wood (ernte) whose repo entry changed (gewicht): the 28 others go with the history, Wood stays and is the ONLY conflict', a.fall === 'konflikt' && a.bereinigt?.length === 28 && a.abweichend?.join() === 'Wood' && a.meldung.includes('(Wood)') && ids(f.arbeit) === 'Wood,Holzaxt', `${a.fall} ${a.bereinigt?.length} ${a.abweichend?.join()}`);
  }
  {
    // a FULL basis (R0) read in the new build: its entries are compared as written, not against the new base stock
    const f = neuerFall(r1);
    writeFileSync(f.arbeit, main29PlusX(REPO_ECHT));
    writeFileSync(f.basis, REPO_ECHT);
    const zurueck = neuerBau(r1);
    try {
      const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check('full basis R0, repo R1\' (Wood.gewicht + AxeFlint.ernte), run in the new build: bereinigt all 29, no conflict', a.fall === 'bereinigt' && a.bereinigt?.length === 29 && (a.abweichend ?? []).length === 0, `${a.fall} ${a.bereinigt?.length} ${a.abweichend?.join()}`);
    } finally {
      zurueck();
    }
  }
  {
    // an unknown hash: today's behaviour, and the message says so
    const f = neuerFall(r1);
    const alt = leseGegenstandsDatei(main29PlusX(REPO_ECHT), { ohneGrundsperre: true }).eintraege.map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 3 } } : e));
    writeFileSync(f.arbeit, schreibeGegenstandsDatei(alt));
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('hash basis that matches no history file and cannot be rebuilt (a base entry was edited): basisUnbekannt, the message says the basis is unknown', a.basisUnbekannt === true && a.meldung.includes('keine bekannte Repo-Fassung'), a.meldung.slice(-160));
    const g = neuerFall(r1);
    historie(g, REPO_ECHT);
    writeFileSync(resolve(dirname(g.repo), 'gegenstaende-historie', `${sha(REPO_ECHT)}.json`), r1); // a VALID item file, but not the state the name says
    writeFileSync(g.arbeit, schreibeGegenstandsDatei(alt));
    writeFileSync(g.basis, `${sha(REPO_ECHT)}\n`);
    const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('a history file whose bytes do not have the name hash is NOT used (basisUnbekannt)', b.basisUnbekannt === true);
  }
}

console.log('\n[3d] A deliberately empty ernte survives (N3)');
{
  const axeRoh = repoRoh().find((e) => e.id === 'AxeFlint')!;
  const leerErnte = leseGegenstandsDatei(dokument([{ ...axeRoh, ernte: {} }])).eintraege;
  const text = schreibeGegenstandsDatei(leerErnte);
  check('the writer keeps an explicit empty `ernte: {}` on an item that harvests in the base', JSON.parse(text).gegenstaende[0].ernte !== undefined && Object.keys(JSON.parse(text).gegenstaende[0].ernte).length === 0, text.slice(0, 40));
  check('... and not on an item whose base entry has no harvest (the repo file stays canonical)', !('ernte' in JSON.parse(schreibeGegenstandsDatei(leseGegenstandsDatei(dokument([repoRoh().find((e) => e.id === 'Wood')!])).eintraege)).gegenstaende[0]) && schreibeGegenstandsDatei(leseGegenstandsDatei(REPO_ECHT.toString()).eintraege) === REPO_ECHT.toString());
  check('... the round trip is stable and keeps `{}` (read again: ernte {})', schreibeGegenstandsDatei(leseGegenstandsDatei(text).eintraege) === text && leseGegenstandsDatei(text).eintraege[0]?.ernte.baum === undefined);
  // the repo changes a LOCKED field of the same item (gewicht): the copy is replaced, its explicit `{}` stays
  const r1 = ((): string => {
    const doc = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
    doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.gewicht = 7.5;
    return `${JSON.stringify(doc, null, 2)}\n`;
  })();
  const f = neuerFall(r1);
  writeFileSync(f.arbeit, text);
  writeFileSync(f.basis, REPO_ECHT);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('the repo changed AxeFlint.gewicht while the copy has `ernte: {}`: konflikt naming AxeFlint (the edit is not lost silently)', a.fall === 'konflikt' && a.abweichend?.join() === 'AxeFlint' && ids(f.arbeit) === 'AxeFlint', `${a.fall} ${a.abweichend?.join()}`);
  setzeGrundbestand([]);
  setzeGrundbestand(leseGegenstandsDatei(r1).eintraege);
  try {
    const l = laden(f);
    check('a game built from the new repo: the axe harvests NOTHING (`{}` kept), the weight is the new one, AxeFlint is named in grundErsetzt', l.grundErsetzt === 1 && findItem('AxeFlint')?.ernte?.baum === undefined && findItem('AxeFlint')?.weight === 7.5, JSON.stringify(findItem('AxeFlint')?.ernte));
  } finally {
    setzeGrundbestand(GRUNDBESTAND);
    wendeGegenstandsDatenAn([]);
  }
  // absent field: inherits (unchanged from N2), also after the writer
  const ohne = { ...axeRoh, gewicht: 99 } as Roh;
  delete ohne.ernte;
  check('a copy with the field MISSING inherits the base harvest', leseGegenstandsDatei(dokument([ohne])).eintraege[0]?.ernte.baum === 1);
  check('a copy with `ernte: null` inherits too (no value)', leseGegenstandsDatei(dokument([{ ...ohne, ernte: null }])).eintraege[0]?.ernte.baum === 1);
  check('a copy with `ernte: {}` and a locked change keeps `{}`', leseGegenstandsDatei(dokument([{ ...ohne, ernte: {} }])).eintraege[0]?.ernte.baum === undefined);
}

console.log('\n[3e] An old-format copy keeps working as GD1 let it: a base entry WITHOUT ernte runs with ernte {} (N4)');
{
  const holzEintrag = leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!;
  const repoMitAxe = (ueber: Roh): string => {
    const doc = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
    const e = doc.gegenstaende.find((x) => x.id === 'AxeFlint')!;
    Object.assign(e, ueber);
    return `${JSON.stringify(doc, null, 2)}\n`;
  };
  const neuerBau = (text: string): (() => void) => {
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(text).eintraege);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  /** What `main` (GD1) saved after "AxeFlint harvests nothing": the 29 copies, AxeFlint WITHOUT the `ernte` field (its writer leaves an empty one out), + an own item. */
  const mainDatei = (): string => {
    const liste = [...leseGegenstandsDatei(REPO_ECHT.toString(), { ohneGrundsperre: true }).eintraege, holzEintrag];
    const doc = JSON.parse(schreibeGegenstandsDatei(liste)) as { version: number; gegenstaende: Roh[] };
    delete doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte;
    return `${JSON.stringify(doc, null, 2)}\n`;
  };
  const mitErnteFeld = (pfad: string): boolean => JSON.stringify((JSON.parse(readFileSync(pfad, 'utf-8')) as { gegenstaende: Roh[] }).gegenstaende.find((e) => e.id === 'AxeFlint')?.ernte) === '{}';

  // the probe H4a of the attack: the repo later changes a locked field of the axe
  const r1 = repoMitAxe({ gewicht: 3 });
  const f = neuerFall(r1);
  const hz = resolve(dirname(f.repo), 'gegenstaende-historie');
  mkdirSync(hz, { recursive: true });
  writeFileSync(resolve(hz, `${sha(REPO_ECHT)}.json`), REPO_ECHT);
  writeFileSync(f.arbeit, mainDatei());
  writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
  const vorher = readFileSync(f.arbeit, 'utf-8');
  const zurueck = neuerBau(r1);
  try {
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('old-format copy (hash basis) with AxeFlint WITHOUT ernte: ernte {} is written explicitly for AxeFlint, reported', a.ernteFestgeschrieben?.join() === 'AxeFlint' && a.meldung.includes('ausdruecklich geschrieben'), a.meldung.slice(-200));
    check('... the file now has `ernte: {}` on AxeFlint and the other 28 copies are cleaned out (the history knows R0), the Holzaxt stays', mitErnteFeld(f.arbeit) && ids(f.arbeit) === 'AxeFlint,Holzaxt', ids(f.arbeit));
    check('... with a back-up of the old file (byte-equal)', baks(f).length === 1 && readFileSync(resolve(dirname(f.arbeit), baks(f)[0]!), 'utf-8') === vorher);
    check('... the gewicht change of the axe in the repo is reported as a conflict naming AxeFlint', a.fall === 'konflikt' && a.abweichend?.join() === 'AxeFlint', `${a.fall} ${a.abweichend?.join()}`);
    const l = laden(f);
    check('the axe harvests NOTHING in the new build (as it did under main), although the repo changed a locked field of it; AxeFlint is named in grundErsetzt', l.grundErsetzt === 1 && findItem('AxeFlint')?.ernte?.baum === undefined && findItem('AxeFlint')?.weight === 3, JSON.stringify(findItem('AxeFlint')?.ernte));
    // the next mask save: it sends what GET shows (the replaced copy with ernte {}) and writes only deviations
    const gelesen = leseGegenstandsDatei(readFileSync(f.arbeit, 'utf-8')).eintraege;
    const repoE = leseGegenstandsDatei(r1, { ohneGrundsperre: true }).eintraege;
    const gespeichert = schreibeGegenstandsDatei(nurAbweichungen(gelesen, repoE));
    check('the next mask save keeps the edit: the written file still has `ernte: {}` on AxeFlint', JSON.parse(gespeichert).gegenstaende.some((e: Roh) => e.id === 'AxeFlint' && JSON.stringify(e.ernte) === '{}'), gespeichert.slice(0, 60));
    const zwei = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('a second run changes nothing (the basis is the full copy now, the rule is the new one)', zwei.fall === 'unveraendert' && baks(f).length === 1);
  } finally {
    zurueck();
  }
  // the new rule after the transition: a missing field inherits
  check('after the transition a copy whose `ernte` field is missing inherits (new rule)', leseGegenstandsDatei(dokument([{ ...repoRoh().find((e) => e.id === 'AxeFlint')!, gewicht: 99, ernte: undefined }])).eintraege[0]?.ernte.baum === 1);

  // the latent variant H4b: the repo changes only another item, the file still gets the explicit `{}` at the transition
  const g = neuerFall(REPO_ECHT);
  writeFileSync(g.arbeit, mainDatei());
  writeFileSync(g.basis, `${sha(REPO_ECHT)}\n`);
  const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
  check('H4b: only `ernte: {}` is written (no other change), the 28 unmodified copies go', b.ernteFestgeschrieben?.join() === 'AxeFlint' && mitErnteFeld(g.arbeit));

  // only where it is the transition: a FULL basis (new format) leaves a missing field alone (it means "inherit" there)
  const h = neuerFall(REPO_ECHT);
  const doc = JSON.parse(schreibeGegenstandsDatei([leseGegenstandsDatei(dokument([{ ...repoRoh().find((e) => e.id === 'AxeFlint')!, gewicht: 99 }]), { ohneGrundsperre: true }).eintraege[0]!])) as { version: number; gegenstaende: Roh[] };
  delete doc.gegenstaende[0]!.ernte;
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(h.arbeit, text);
  writeFileSync(h.basis, REPO_ECHT);
  const c = gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
  check('new format (full basis): an entry without `ernte` is NOT rewritten', (c.ernteFestgeschrieben ?? []).length === 0 && readFileSync(h.arbeit, 'utf-8') === text, `${c.fall}`);

  // only where the repo entry has a harvest: Wood has none, so a Wood copy without ernte stays as it is
  const k = neuerFall(REPO_ECHT);
  const woodText = `${JSON.stringify({ version: 1, gegenstaende: [{ ...repoRoh().find((e) => e.id === 'Wood')!, gewicht: 77 }] }, null, 2)}\n`;
  writeFileSync(k.arbeit, woodText);
  writeFileSync(k.basis, `${sha(REPO_ECHT)}\n`);
  const d = gegenstaendeAbgleichen({ repoDatei: k.repo, arbeitsDatei: k.arbeit });
  check('old format, a base entry WITHOUT ernte whose repo entry has no harvest (Wood): nothing is written for it', (d.ernteFestgeschrieben ?? []).length === 0 && readFileSync(k.arbeit, 'utf-8') === woodText, JSON.stringify(d.ernteFestgeschrieben));

  // the file has NOTHING to clean out, only the missing field (the write must not depend on a clean-out); `ernte: null` counts as missing
  for (const [wie, ernteWert] of [['missing', undefined], ['null', null]] as const) {
    const n = neuerFall(REPO_ECHT);
    const nur = { ...repoRoh().find((e) => e.id === 'AxeFlint')!, gewicht: 99, ernte: ernteWert } as Roh;
    if (ernteWert === undefined) delete nur.ernte;
    writeFileSync(n.arbeit, `${JSON.stringify({ version: 1, gegenstaende: [nur, holzaxt] }, null, 2)}\n`);
    writeFileSync(n.basis, `${sha(REPO_ECHT)}\n`);
    const e = gegenstaendeAbgleichen({ repoDatei: n.repo, arbeitsDatei: n.arbeit });
    check(`old format, only AxeFlint (ernte ${wie}) + Holzaxt, nothing to clean out: fall bereinigt, ernte {} written, back-up there`, e.fall === 'bereinigt' && e.bereinigt?.length === 0 && e.ernteFestgeschrieben?.join() === 'AxeFlint' && mitErnteFeld(n.arbeit) && baks(n).length === 1, `${e.fall} ${e.bereinigt?.length}`);
  }
  // no basis file at all: the state the file worked under is UNKNOWN, so nothing is written and the message says so (N5)
  const o = neuerFall(REPO_ECHT);
  {
    const doc = JSON.parse(mainDatei()) as { version: number; gegenstaende: Roh[] };
    doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.gewicht = 99; // a deviation that keeps the entry (an entry equal to the repo goes: it inherits)
    writeFileSync(o.arbeit, `${JSON.stringify(doc, null, 2)}\n`);
  }
  const q = gegenstaendeAbgleichen({ repoDatei: o.repo, arbeitsDatei: o.arbeit });
  check('no basis file: nothing is written for AxeFlint (state unknown), ernteUnklar names it, the message says so; the field inherits', (q.ernteFestgeschrieben ?? []).length === 0 && q.ernteUnklar?.join() === 'AxeFlint' && !mitErnteFeld(o.arbeit) && q.meldung.includes('unbekannt') && q.meldung.includes('nichts festgeschrieben'), q.meldung.slice(-220));

  // pruefen writes nothing
  const m = neuerFall(REPO_ECHT);
  writeFileSync(m.arbeit, mainDatei());
  writeFileSync(m.basis, `${sha(REPO_ECHT)}\n`);
  const vor = readFileSync(m.arbeit, 'utf-8');
  const p = gegenstaendeAbgleichen({ repoDatei: m.repo, arbeitsDatei: m.arbeit, modus: 'pruefen' });
  check('pruefen names it (bereinigt, ernte {}) and writes nothing', p.fall === 'bereinigt' && p.ernteFestgeschrieben?.join() === 'AxeFlint' && readFileSync(m.arbeit, 'utf-8') === vor && baks(m).length === 0);
}

console.log('\n[3f] The transition decides by the BASIS state, not by today\'s repo (N5)');
{
  const neuerBau = (text: string): (() => void) => {
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(text).eintraege);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  const repoMit = (aendere: (doc: { gegenstaende: Roh[] }) => void): string => {
    const doc = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
    aendere(doc);
    return `${JSON.stringify(doc, null, 2)}\n`;
  };
  const historie = (f: Fall, text: string | Buffer): void => {
    const ziel = gegenstandsHistorieDatei(f.repo, sha(Buffer.from(text)));
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, text);
  };
  const ohneErnte = (id: string, ueber: Roh): Roh => {
    const e = { ...repoRoh().find((x) => x.id === id)!, ...ueber };
    delete e.ernte;
    return e;
  };
  const datei = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
  const imFeld = (pfad: string, id: string): unknown => (JSON.parse(readFileSync(pfad, 'utf-8')) as { gegenstaende: Roh[] }).gegenstaende.find((e) => e.id === id)?.ernte;

  {
    // P6a of the check: Hammer had NO harvest in the state the file worked under; the repo gives it one NOW: it must arrive
    const r1 = repoMit((d) => { d.gegenstaende.find((e) => e.id === 'Hammer')!.ernte = { baum: 3 }; });
    const f = neuerFall(r1);
    historie(f, REPO_ECHT);
    writeFileSync(f.arbeit, datei([ohneErnte('Hammer', { gewicht: 99 }), holzaxt]));
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    const zurueck = neuerBau(r1);
    try {
      const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check('Hammer without ernte, the basis state (history) had no harvest for it, the repo gives it one now: NOTHING is written (no `ernte: {}`)', (a.ernteFestgeschrieben ?? []).length === 0 && imFeld(f.arbeit, 'Hammer') === undefined, JSON.stringify(a.ernteFestgeschrieben));
      laden(f);
      check('... the new harvest arrives in the game (Hammer baum 3, inherited)', findItem('Hammer')?.ernte?.baum === 3, JSON.stringify(findItem('Hammer')?.ernte));
    } finally {
      zurueck();
    }
  }
  {
    // P5: a G1 file (the basis hash is the empty state) with a hand-made AxeFlint without ernte: the base state had no AxeFlint entry, so no `{}`
    const f = neuerFall(REPO_ECHT);
    const g1 = schreibeGegenstandsDatei([]);
    historie(f, g1);
    writeFileSync(f.arbeit, datei([ohneErnte('AxeFlint', { gewicht: 99 })]));
    writeFileSync(f.basis, `${sha(Buffer.from(g1))}\n`);
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('G1 basis (the empty state), a hand-made AxeFlint without ernte: nothing is written (the state had no AxeFlint harvest), the field inherits', (a.ernteFestgeschrieben ?? []).length === 0 && imFeld(f.arbeit, 'AxeFlint') === undefined && (a.ernteUnklar ?? []).length === 0, JSON.stringify(a.ernteFestgeschrieben));
    const l = laden(f);
    check('... in the game the axe still harvests (baum 1)', l.grundErsetzt === 1 && findItem('AxeFlint')?.ernte?.baum === 1);
  }
  {
    // the state is NOT known: a hash that is in no history and cannot be rebuilt, or no basis at all
    const f = neuerFall(REPO_ECHT);
    const editiert = leseGegenstandsDatei(datei([ohneErnte('AxeFlint', { gewicht: 99 }), mitErnte('Wood', { baum: 3 })]), { ohneGrundsperre: true }).eintraege;
    writeFileSync(f.arbeit, datei([ohneErnte('AxeFlint', { gewicht: 99 }), mitErnte('Wood', { baum: 3 })]));
    writeFileSync(f.basis, `${sha(Buffer.from('ein unbekannter Stand'))}\n`);
    void editiert;
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('unknown hash (no history, cannot be rebuilt): nothing is written, ernteUnklar names AxeFlint, the message says the state is unknown', (a.ernteFestgeschrieben ?? []).length === 0 && a.ernteUnklar?.join() === 'AxeFlint' && imFeld(f.arbeit, 'AxeFlint') === undefined && a.meldung.includes('unbekannt') && a.basisUnbekannt === true, a.meldung.slice(-250));
  }
  {
    // P7: an UNREADABLE full basis is no old format: no `ernte {}`, a message, the basis is rewritten
    const f = neuerFall(REPO_ECHT);
    const text = datei([ohneErnte('AxeFlint', { gewicht: 99 }), holzaxt]);
    writeFileSync(f.arbeit, text);
    writeFileSync(f.basis, REPO_ECHT.toString().slice(0, 200));
    const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('broken FULL basis (cut off): basisKaputt, no `ernte: {}` written, the message says the basis was unreadable and is rewritten', a.basisKaputt === true && (a.ernteFestgeschrieben ?? []).length === 0 && imFeld(f.arbeit, 'AxeFlint') === undefined && a.meldung.includes('unlesbar') && !a.meldung.includes('altes Format') && !a.meldung.includes('alte Datei'), a.meldung.slice(-250));
    check('... the basis is the full repo copy afterwards, the file is untouched', gegenstandsBasisStand(f.arbeit)?.text === REPO_ECHT.toString() && readFileSync(f.arbeit, 'utf-8') === text);
    const l = laden(f);
    check('... in the game the axe keeps the inherited harvest (baum 1)', l.grundErsetzt === 1 && findItem('AxeFlint')?.ernte?.baum === 1);
    check('a missing basis file is NOT "broken"', gegenstaendeAbgleichen({ repoDatei: neuerFall(REPO_ECHT).repo, arbeitsDatei: neuerFall(REPO_ECHT).arbeit }).basisKaputt === undefined);
  }
  {
    // messages say only what happened
    const f = neuerFall(REPO_ECHT);
    const main = leseGegenstandsDatei(REPO_ECHT.toString(), { ohneGrundsperre: true }).eintraege;
    void main;
    const nur = datei([ohneErnte('AxeFlint', { gewicht: 99 }), holzaxt]);
    writeFileSync(f.arbeit, nur);
    writeFileSync(f.basis, `${sha(REPO_ECHT)}\n`);
    const p = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, modus: 'pruefen' });
    check('pruefen: the message says "wuerde" and never claims to have written or taken out anything', p.meldung.includes('wuerde') && !/(?<!wuerde )ausdruecklich geschrieben/.test(p.meldung) && !p.meldung.includes('gesichert') && !p.meldung.includes('Eintrag/Eintraege'), p.meldung);
    const v = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('voll, only `ernte {}` added: no "0 Eintrag", no empty list "()", the back-up is named exactly once', !v.meldung.includes('0 Eintrag') && !v.meldung.includes('()') && v.meldung.split('gesichert').length === 2 && v.meldung.includes('ausdruecklich geschrieben'), v.meldung);
    const g = neuerFall(REPO_ECHT);
    writeFileSync(g.arbeit, dokument([...repoRoh(), holzaxt]));
    writeFileSync(g.basis, REPO_ECHT);
    const w = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('voll, only a clean-out: no word about `ernte`, the back-up once', w.meldung.includes('herausgenommen') && !w.meldung.includes('ernte') && w.meldung.split('gesichert').length === 2, w.meldung.slice(0, 200));
  }
}

console.log('\n[3g] Without a known basis a missing ernte INHERITS: message and game say the same (N6)');
{
  const neuerBau = (text: string): (() => void) => {
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(text).eintraege);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  const axeRoh = repoRoh().find((e) => e.id === 'AxeFlint')!;
  const ohne = (ueber: Roh = {}): Roh => {
    const e = { ...axeRoh, ...ueber };
    delete e.ernte;
    return e;
  };
  const datei = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
  const holz = leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!;
  /** the file `main` saved after "AxeFlint harvests nothing" (no `ernte` field), 29 copies + an own item */
  const mainDatei = (): string => {
    const doc = JSON.parse(schreibeGegenstandsDatei([...leseGegenstandsDatei(REPO_ECHT.toString(), { ohneGrundsperre: true }).eintraege, holz])) as { version: number; gegenstaende: Roh[] };
    delete doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte;
    return `${JSON.stringify(doc, null, 2)}\n`;
  };

  // the reader, without any file: a missing or null `ernte` inherits whether or not a locked field deviates; `{}` stays
  const l1 = leseGegenstandsDatei(dokument([ohne()]));
  check('reader: a base entry with the `ernte` field MISSING and nothing else changed inherits the base harvest (baum 1), nothing is replaced', l1.eintraege[0]?.ernte.baum === 1 && l1.grundErsetzt.length === 0);
  check('reader: `ernte: null` inherits as well', leseGegenstandsDatei(dokument([{ ...ohne(), ernte: null }])).eintraege[0]?.ernte.baum === 1);
  check('reader: an explicit `ernte: {}` stays empty (a deliberate "harvests nothing")', leseGegenstandsDatei(dokument([{ ...axeRoh, ernte: {} }])).eintraege[0]?.ernte.baum === undefined);
  check('reader: read AS WRITTEN (ohneGrundsperre) a missing field stays missing (a state is compared, not interpreted)', leseGegenstandsDatei(dokument([ohne()]), { ohneGrundsperre: true }).eintraege[0]?.ernte.baum === undefined);

  // N5-A1: no basis file, the repo unchanged: the message says "inherits" and the game inherits
  const f = neuerFall(REPO_ECHT);
  writeFileSync(f.arbeit, mainDatei());
  const a1 = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('no basis file, AxeFlint without ernte and otherwise equal to the repo: it inherits, so it equals the repo entry and goes with the 28 others (nothing is written, no note)', a1.fall === 'bereinigt' && a1.bereinigt?.includes('AxeFlint') === true && (a1.ernteFestgeschrieben ?? []).length === 0 && (a1.ernteUnklar ?? []).length === 0 && ids(f.arbeit) === 'Holzaxt', `${a1.fall} ${ids(f.arbeit)}`);
  const l = laden(f);
  check('... and the GAME inherits: AxeFlint harvests baum 1 (not `{}`), as the message says', findItem('AxeFlint')?.ernte?.baum === 1 && l.grundErsetzt === 0, JSON.stringify(findItem('AxeFlint')?.ernte));
  // N5-A2: later the repo changes a locked field of the axe: no silent switch, the value stays the same
  const doc2 = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
  doc2.gegenstaende.find((e) => e.id === 'AxeFlint')!.gewicht = 3;
  const r1 = `${JSON.stringify(doc2, null, 2)}\n`;
  const g = neuerFall(r1);
  writeFileSync(g.arbeit, mainDatei());
  const zurueck = neuerBau(r1);
  try {
    gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    const l2 = laden(g);
    check('N5-A2: the repo changed a locked field of the axe later: the harvest is STILL baum 1 (no silent change), the axe is named in grundErsetzt, the weight is the new one', findItem('AxeFlint')?.ernte?.baum === 1 && l2.grundErsetzt === 1 && findItem('AxeFlint')?.weight === 3, JSON.stringify(findItem('AxeFlint')?.ernte));
  } finally {
    zurueck();
  }
  // with a HASH basis (N3-A) everything stays: an entry that ran with `{}` under GD1 keeps harvesting nothing
  const h = neuerFall(REPO_ECHT);
  writeFileSync(h.arbeit, mainDatei());
  writeFileSync(h.basis, `${sha(REPO_ECHT)}\n`);
  gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
  laden(h);
  check('hash basis (N3-A): the axe of the old file still harvests NOTHING (explicit `ernte: {}` was written)', findItem('AxeFlint')?.ernte?.baum === undefined);

  // the notes for the editor
  console.log('  — the notes (gegenstaende.hinweise.json) for the editor');
  const n = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  void n;
  const w = neuerFall(REPO_ECHT);
  writeFileSync(w.arbeit, datei([ohne({ gewicht: 99 }), holzaxt]));
  gegenstaendeAbgleichen({ repoDatei: w.repo, arbeitsDatei: w.arbeit });
  const hw = gegenstandsHinweiseLesen(w.arbeit);
  check('the run writes the notes: ernteUnklar [AxeFlint], basisKaputt false, a time', hw.ernteUnklar.join() === 'AxeFlint' && hw.basisKaputt === false && typeof hw.zeit === 'string');
  gegenstaendeAbgleichen({ repoDatei: w.repo, arbeitsDatei: w.arbeit });
  const hw2 = gegenstandsHinweiseLesen(w.arbeit);
  check('a later clean run (basis is the full copy now) removes the notes', hw2.ernteUnklar.length === 0 && hw2.zeit === null && !existsSync(resolve(dirname(w.arbeit), 'gegenstaende.hinweise.json')));
  const k = neuerFall(REPO_ECHT);
  writeFileSync(k.arbeit, datei([ohne({ gewicht: 99 }), holzaxt]));
  writeFileSync(k.basis, REPO_ECHT.toString().slice(0, 200));
  const ak = gegenstaendeAbgleichen({ repoDatei: k.repo, arbeitsDatei: k.arbeit });
  const hk = gegenstandsHinweiseLesen(k.arbeit);
  check('an unreadable basis: the notes say basisKaputt true (and ernteUnklar for the entry without ernte)', ak.basisKaputt === true && hk.basisKaputt === true && hk.ernteUnklar.join() === 'AxeFlint');
  const p = neuerFall(REPO_ECHT);
  writeFileSync(p.arbeit, datei([ohne({ gewicht: 99 }), holzaxt]));
  gegenstaendeAbgleichen({ repoDatei: p.repo, arbeitsDatei: p.arbeit, modus: 'pruefen' });
  check('pruefen writes no notes', !existsSync(resolve(dirname(p.arbeit), 'gegenstaende.hinweise.json')));
  const q = neuerFall(REPO_ECHT);
  writeFileSync(resolve(dirname(q.arbeit), 'gegenstaende.hinweise.json'), 'kein json');
  check('a broken notes file reads as "no notes"', gegenstandsHinweiseLesen(q.arbeit).zeit === null);
  writeFileSync(resolve(dirname(q.arbeit), 'gegenstaende.hinweise.json'), JSON.stringify({ ernteUnklar: [5], basisKaputt: false, zeit: 'x' }));
  check('a notes file of the wrong shape reads as "no notes"', gegenstandsHinweiseLesen(q.arbeit).zeit === null);
}

console.log('\n[3h] The reconciliation reads a missing ernte exactly like the game (N7)');
{
  const neuerBau = (text: string): (() => void) => {
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(text).eintraege);
    return () => { setzeGrundbestand(GRUNDBESTAND); wendeGegenstandsDatenAn([]); };
  };
  const axeRoh = repoRoh().find((e) => e.id === 'AxeFlint')!;
  const ohne = (ueber: Roh = {}): Roh => {
    const e = { ...axeRoh, ...ueber };
    delete e.ernte;
    return e;
  };
  const datei = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
  const repoMit = (ueber: Roh): string => {
    const doc = JSON.parse(REPO_ECHT.toString()) as { version: number; gegenstaende: Roh[] };
    Object.assign(doc.gegenstaende.find((e) => e.id === 'AxeFlint')!, ueber);
    return `${JSON.stringify(doc, null, 2)}\n`;
  };
  // N6-L: a FULL basis R0, the file holds AxeFlint without ernte, otherwise equal to the repo: no deviation
  const l0 = neuerFall(REPO_ECHT);
  writeFileSync(l0.arbeit, datei([ohne(), holzaxt]));
  writeFileSync(l0.basis, REPO_ECHT);
  const a0 = gegenstaendeAbgleichen({ repoDatei: l0.repo, arbeitsDatei: l0.arbeit });
  check('N6-L: full basis, AxeFlint without ernte (equal to the repo otherwise): NOT a deviation, it goes (the game reads it as the repo entry)', (a0.abweichend ?? []).length === 0 && a0.bereinigt?.join() === 'AxeFlint' && ids(l0.arbeit) === 'Holzaxt', `${a0.fall} ${a0.abweichend?.join()}`);
  // N6-L2a: the repo sets the harvest of the axe to baum 2: it arrives at once, and NO message says "only after the reset"
  const r2 = repoMit({ ernte: { baum: 2 } });
  const l2 = neuerFall(r2);
  writeFileSync(l2.arbeit, datei([ohne(), holzaxt]));
  writeFileSync(l2.basis, REPO_ECHT);
  const zurueck = neuerBau(r2);
  try {
    const a2 = gegenstaendeAbgleichen({ repoDatei: l2.repo, arbeitsDatei: l2.arbeit });
    check('N6-L2a: repo harvest baum 2: no conflict, no "only after the reset" message, the entry goes', a2.fall === 'bereinigt' && !a2.meldung.includes('Konflikt') && !a2.meldung.includes('zurueckgesetzt') && (a2.abweichend ?? []).length === 0, `${a2.fall} ${a2.meldung.slice(0, 160)}`);
    laden(l2);
    check('... and in the game the new harvest is there at once (baum 2)', findItem('AxeFlint')?.ernte?.baum === 2, JSON.stringify(findItem('AxeFlint')?.ernte));
  } finally {
    zurueck();
  }
  // N6-L2b: the repo changes the weight: the entry is untouched since the basis, so it is no deviation either
  const r3 = repoMit({ gewicht: 3 });
  const l3 = neuerFall(r3);
  writeFileSync(l3.arbeit, datei([ohne(), holzaxt]));
  writeFileSync(l3.basis, REPO_ECHT);
  const zurueck3 = neuerBau(r3);
  try {
    const a3 = gegenstaendeAbgleichen({ repoDatei: l3.repo, arbeitsDatei: l3.arbeit });
    check('N6-L2b: repo changes the weight, the entry (no ernte) is as at the basis: it goes, no conflict', a3.bereinigt?.join() === 'AxeFlint' && (a3.abweichend ?? []).length === 0 && !a3.meldung.includes('Konflikt'), `${a3.fall} ${a3.abweichend?.join()}`);
    laden(l3);
    check('... the game: weight 3 and harvest baum 1, nothing replaced', findItem('AxeFlint')?.weight === 3 && findItem('AxeFlint')?.ernte?.baum === 1);
  } finally {
    zurueck3();
  }
  // the GD1 transition is NOT touched: with a hash basis whose state had a harvest, the missing field still means `{}`
  const g = neuerFall(REPO_ECHT);
  writeFileSync(g.arbeit, datei([ohne(), holzaxt]));
  writeFileSync(g.basis, `${sha(REPO_ECHT)}\n`);
  const ag = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
  check('hash basis, the state had a harvest for the axe: AxeFlint without ernte is still a deviation (it ran with `{}`) and gets the explicit `ernte: {}`', ag.ernteFestgeschrieben?.join() === 'AxeFlint' && ag.abweichend?.join() === 'AxeFlint' && (ag.bereinigt ?? []).length === 0, `${ag.fall} ${ag.ernteFestgeschrieben?.join()}`);
  // an entry WITH an explicit `ernte: {}` is a deviation under a full basis (deliberate)
  const e = neuerFall(REPO_ECHT);
  writeFileSync(e.arbeit, datei([{ ...axeRoh, ernte: {} }, holzaxt]));
  writeFileSync(e.basis, REPO_ECHT);
  const ae = gegenstaendeAbgleichen({ repoDatei: e.repo, arbeitsDatei: e.arbeit });
  check('full basis, an explicit `ernte: {}`: a deviation, kept', ae.abweichend?.join() === 'AxeFlint' && ids(e.arbeit) === 'AxeFlint,Holzaxt', `${ae.fall}`);
  // the notes with ONLY basisKaputt (nothing without ernte): the file is kept (N6-B)
  const k = neuerFall(REPO_ECHT);
  writeFileSync(k.arbeit, datei([holzaxt]));
  writeFileSync(k.basis, REPO_ECHT.toString().slice(0, 200));
  const ak = gegenstaendeAbgleichen({ repoDatei: k.repo, arbeitsDatei: k.arbeit });
  const hk = gegenstandsHinweiseLesen(k.arbeit);
  check('unreadable basis and NO entry without ernte: the notes still say basisKaputt true with ernteUnklar [] (the file exists)', ak.fall === 'unveraendert' && ak.basisKaputt === true && hk.basisKaputt === true && hk.ernteUnklar.length === 0 && typeof hk.zeit === 'string' && existsSync(resolve(dirname(k.arbeit), 'gegenstaende.hinweise.json')), JSON.stringify(hk));
}

console.log('\n[3c] Replaced copies: ernte inherited, deep copy (N2)');
{
  const axe = (ueber: Roh): Roh => ({ ...repoRoh().find((e) => e.id === 'AxeFlint')!, ...ueber });
  const ohneErnte = axe({ stapel: 77 });
  delete ohneErnte.ernte;
  const l1 = leseGegenstandsDatei(dokument([ohneErnte]));
  check('a copy with a locked field changed and NO ernte: replaced, and it inherits the harvest of the base entry (baum 1)', l1.grundErsetzt.join() === 'AxeFlint' && l1.eintraege[0]?.ernte.baum === 1 && l1.eintraege[0]?.stapel === grundbestandEintraege().find((e) => e.id === 'AxeFlint')?.stapel, JSON.stringify(l1.eintraege[0]?.ernte));
  const l2 = leseGegenstandsDatei(dokument([axe({ stapel: 77, ernte: { baum: 5 } })]));
  check('a copy WITH an own ernte keeps it (baum 5)', l2.eintraege[0]?.ernte.baum === 5);
  const f = neuerFall();
  writeFileSync(f.arbeit, dokument([ohneErnte, holzaxt]));
  writeFileSync(f.basis, REPO_ECHT);
  const s = laden(f);
  check('in the game the axe still fells trees (ernte.baum 1) although its copy was replaced', s.art === 'angewendet' && s.grundErsetzt === 1 && findItem('AxeFlint')?.ernte?.baum === 1, JSON.stringify(findItem('AxeFlint')?.ernte));
  // an invalid copy is replaced by the whole base entry (harvest included)
  const l3 = leseGegenstandsDatei(dokument([axe({ stapel: 'viel' })]));
  check('an INVALID copy is replaced by the whole base entry (ernte baum 1)', l3.grundErsetzt.join() === 'AxeFlint' && l3.eintraege[0]?.ernte.baum === 1);
  // the replaced entry is a DEEP copy: changing it never touches the base stock
  for (const [wie, lesung] of [['locked field', l1], ['invalid', l3]] as const) {
    const e = lesung.eintraege[0]!;
    const vorher = JSON.stringify(grundbestandEintraege().find((g) => g.id === 'AxeFlint'));
    e.texte[e.nameSchluessel]!.de = 'VERAENDERT';
    e.werte.damage = 12345;
    e.modell.haltePosition?.push(9);
    e.haltbarkeit.max = 1;
    e.ernte.baum = 99;
    if (e.rezept) e.rezept.zutaten.push({ item: 'Wood', menge: 1 });
    check(`${wie}: changing the replaced entry (texte, werte, modell, haltbarkeit, ernte, rezept) leaves the base stock untouched`, JSON.stringify(grundbestandEintraege().find((g) => g.id === 'AxeFlint')) === vorher && findItem('AxeFlint')?.ernte?.baum === 1);
  }
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
