/**
 * GD2: the reconciliation of the item working copy with the repo state and the basis file (`gegenstaendeAbgleichen`),
 * and what the game server's start does with the result. Every case runs in its own folder under /tmp/gd2-abgleich-*.
 *
 *  [1] DEV states replayed: working copy `[]` + no basis → pulled, 29 active; a Holzaxt copy → conflict (the working
 *      copy wins and stays byte-equal), 29 + Holzaxt active; broken / 0 byte / missing → 29 known, nothing held back.
 *  [2] The decision table: repo changed only → pulled (backup, basis); working copy changed only → kept; both changed → conflict;
 *      same items, other formatting → no conflict; repo missing / broken → nothing copied; `pruefen` writes nothing.
 *  [3] The lock: a held lock stops the reconciliation (no write).
 *  [4] The start wrapper (`gegenstaendeAbgleichenBeimStart`): logs a conflict as a warning, never throws.
 *
 *  [5] The wiring: `main.ts` calls the start wrapper as a statement of its own BEFORE `ladeGegenstandsDatei` (checked on the syntax tree).
 *
 * Run: npx tsx server/test/gd2-abgleich.ts   (from the repo root)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import {
  GRUNDBESTAND_IDS,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  wendeGegenstandsDatenAn,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import {
  gegenstaendeAbgleichen,
  gegenstandsArbeitsDatei,
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
const dateiText = (roh: unknown[]): string => JSON.stringify({ version: 1, gegenstaende: roh });
const holzaxt = {
  id: 'Holzaxt', nameSchluessel: 'inhalt.gegenstand.Holzaxt.name', typ: 'material', stapel: 1,
  texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' } },
};
const lesen = (pfad: string): Buffer => readFileSync(pfad);
/** The repo file with Wood's harvest field changed: another repo state. */
function repoAnders(): string {
  const doc = JSON.parse(REPO_ECHT.toString('utf-8')) as { version: number; gegenstaende: Array<Record<string, unknown>> };
  doc.gegenstaende.find((e) => e.id === 'Wood')!.ernte = { baum: 4 };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
/** Applies what the working copy says, the way the server's start does; returns the data ids that are active besides the base stock. */
function laden(f: Fall): { art: string; bekannt: number; extra: string[] } {
  wendeGegenstandsDatenAn([]);
  const r = ladeGegenstandsDatei(f.arbeit, stumm);
  const bekannt = GRUNDBESTAND_IDS.filter((id) => findItem(id) !== undefined).length;
  const extra = r.eintraege.map((e) => e.id).filter((id) => !GRUNDBESTAND_IDS.includes(id));
  return { art: r.art, bekannt, extra };
}

console.log('\n[1] DEV states replayed');
{
  const f = neuerFall();
  writeFileSync(f.arbeit, schreibeGegenstandsDatei([]));
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('working copy [] without a basis: pulled', a.fall === 'nachgezogen', a.fall);
  check('the working copy is now the repo file (29 entries), byte for byte', lesen(f.arbeit).equals(REPO_ECHT) && leseGegenstandsDatei(lesen(f.arbeit).toString('utf-8')).eintraege.length === 29);
  check('the basis is the repo hash', gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT));
  check('the old state was backed up (.bak) before it was overwritten', readdirSync(dirname(f.arbeit)).some((n) => n.endsWith('.bak')));
  const s = laden(f);
  check('after the start: 29 base items active, nothing else', s.art === 'angewendet' && s.bekannt === 29 && s.extra.length === 0, JSON.stringify(s));
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('a second run changes nothing (unveraendert)', b.fall === 'unveraendert' && lesen(f.arbeit).equals(REPO_ECHT), b.fall);
}
{
  const f = neuerFall();
  const text = dateiText([holzaxt]);
  writeFileSync(f.arbeit, text);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('working copy with a Holzaxt, no basis: conflict', a.fall === 'konflikt', a.fall);
  check('the working copy is NOT overwritten (byte-equal), no basis written, no backup', readFileSync(f.arbeit, 'utf-8') === text && !existsSync(f.basis) && !readdirSync(dirname(f.arbeit)).some((n) => n.endsWith('.bak')));
  check('the message names the conflict loudly', a.meldung.includes('WARNUNG') && a.meldung.includes('Konflikt'), a.meldung);
  const s = laden(f);
  check('after the start: 29 base items + Holzaxt active', s.art === 'angewendet' && s.bekannt === 29 && s.extra.join() === 'Holzaxt' && findItem('Holzaxt') !== undefined, JSON.stringify(s));
}
for (const [name, bytes] of [['broken (no JSON)', 'das ist {kein json'], ['0 byte', ''], ['wrong head', '{"version":7,"gegenstaende":[]}']] as const) {
  const f = neuerFall();
  writeFileSync(f.arbeit, bytes);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check(`${name}: arbeit-kaputt, nothing written (bytes equal, no basis, no backup)`, a.fall === 'arbeit-kaputt' && readFileSync(f.arbeit, 'utf-8') === bytes && !existsSync(f.basis) && !readdirSync(dirname(f.arbeit)).some((n) => n.endsWith('.bak')), a.fall);
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
  check('working copy missing: created from the repo (angelegt), basis written', a.fall === 'angelegt' && lesen(f.arbeit).equals(REPO_ECHT) && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT), a.fall);
  const s = laden(f);
  check('after the start: 29 active', s.bekannt === 29 && s.extra.length === 0);
}

console.log('\n[2] The decision table');
{
  // repo changed only: the working copy equals the basis (the old repo state)
  const f = neuerFall();
  gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit }); // angelegt from the old repo
  const alt = lesen(f.arbeit);
  writeFileSync(f.repo, repoAnders());
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('repo changed, working copy untouched: pulled', a.fall === 'nachgezogen', a.fall);
  check('the working copy is the new repo state, the basis too', readFileSync(f.arbeit, 'utf-8') === repoAnders() && gegenstandsBasisLesen(f.arbeit) === sha(repoAnders()));
  const baks = readdirSync(dirname(f.arbeit)).filter((n) => n.endsWith('.bak'));
  check('the old working copy lies there as a backup, byte-equal', baks.length === 1 && lesen(resolve(dirname(f.arbeit), baks[0]!)).equals(alt), baks.join());
}
{
  // working copy changed only: repo = basis
  const f = neuerFall();
  gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  const doc = JSON.parse(REPO_ECHT.toString('utf-8')) as { version: number; gegenstaende: unknown[] };
  doc.gegenstaende.push(holzaxt);
  const mein = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(f.arbeit, mein);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('working copy changed, repo not: kept', a.fall === 'unveraendert' && readFileSync(f.arbeit, 'utf-8') === mein && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT), a.fall);
}
{
  // both changed, basis present
  const f = neuerFall();
  gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  const doc = JSON.parse(REPO_ECHT.toString('utf-8')) as { version: number; gegenstaende: unknown[] };
  doc.gegenstaende.push(holzaxt);
  const mein = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(f.arbeit, mein);
  writeFileSync(f.repo, repoAnders());
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('both changed: conflict, the working copy wins (byte-equal), basis unchanged', a.fall === 'konflikt' && readFileSync(f.arbeit, 'utf-8') === mein && gegenstandsBasisLesen(f.arbeit) === sha(REPO_ECHT), a.fall);
  const s = laden(f);
  check('the working copy is what runs: Holzaxt active, Wood without the repo\'s new harvest value', s.extra.join() === 'Holzaxt' && findItem('Wood')?.ernte?.baum !== 4, JSON.stringify(s));
}
{
  // same items, other formatting: no conflict
  const f = neuerFall();
  gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  writeFileSync(f.repo, repoAnders());
  const doc = JSON.parse(repoAnders()) as unknown;
  writeFileSync(f.arbeit, JSON.stringify(doc)); // the working copy now equals the NEW repo, only formatted differently
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('same items as the repo, other bytes: unveraendert (no conflict), basis := repo', a.fall === 'unveraendert' && gegenstandsBasisLesen(f.arbeit) === sha(repoAnders()), a.fall);
}
{
  const f = neuerFall(null);
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
  check('repo file missing, no working copy: repo-fehlt, nothing created', a.fall === 'repo-fehlt' && !existsSync(f.arbeit) && !existsSync(f.basis), a.fall);
  const g = neuerFall('kein json');
  const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
  check('repo file broken, no working copy: repo-kaputt, nothing created', b.fall === 'repo-kaputt' && !existsSync(g.arbeit) && !existsSync(g.basis), b.fall);
  const h = neuerFall('kein json');
  const text = schreibeGegenstandsDatei([]);
  writeFileSync(h.arbeit, text);
  const c = gegenstaendeAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
  check('repo file broken, working copy there: repo-kaputt, working copy untouched', c.fall === 'repo-kaputt' && readFileSync(h.arbeit, 'utf-8') === text && !existsSync(h.basis), c.fall);
}
{
  const f = neuerFall();
  writeFileSync(f.arbeit, schreibeGegenstandsDatei([]));
  const vorher = readdirSync(dirname(f.arbeit)).join();
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, modus: 'pruefen' });
  check('pruefen names the case (nachgezogen) and writes nothing', a.fall === 'nachgezogen' && readdirSync(dirname(f.arbeit)).join() === vorher && readFileSync(f.arbeit, 'utf-8') === schreibeGegenstandsDatei([]), a.fall);
  const g = neuerFall();
  const b = gegenstaendeAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit, modus: 'pruefen' });
  check('pruefen with a missing working copy: angelegt, nothing created', b.fall === 'angelegt' && !existsSync(g.arbeit));
}
{
  const f = neuerFall();
  const a = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.repo });
  check('the same path for repo and working copy: gleicher-pfad, nothing done', a.fall === 'gleicher-pfad');
}

console.log('\n[3] The lock');
{
  const f = neuerFall();
  writeFileSync(f.arbeit, schreibeGegenstandsDatei([]));
  let geworfen = '';
  layoutUnterSperre(f.arbeit, () => {
    try {
      gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, sperreWartenMs: 0 });
    } catch (e) {
      geworfen = (e as Error).name;
    }
  });
  check('under a held lock the reconciliation does not run (throws, writes nothing)', geworfen !== '' && readFileSync(f.arbeit, 'utf-8') === schreibeGegenstandsDatei([]) && !existsSync(f.basis), geworfen);
  const b = gegenstaendeAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, sperreWartenMs: 0 });
  check('after the release it runs (the lock file is gone)', b.fall === 'nachgezogen');
}

console.log('\n[4] The start wrapper');
{
  const f = neuerFall();
  writeFileSync(f.arbeit, dateiText([holzaxt]));
  const zeilen: string[] = [];
  const r = gegenstaendeAbgleichenBeimStart(f.dir, f.arbeit, { log: (t) => zeilen.push(`log ${t}`), warn: (t) => zeilen.push(`warn ${t}`), error: (t) => zeilen.push(`error ${t}`) });
  // the wrapper reads the repo file under <root>/shared/data: there is none in this folder
  check('without a repo file under the root: repo-fehlt, one log line, no throw', r?.fall === 'repo-fehlt' && zeilen.length === 1 && zeilen[0]!.startsWith('log '), JSON.stringify(zeilen));
  const g = neuerFall();
  mkdirSync(resolve(g.dir, 'shared/data'), { recursive: true });
  writeFileSync(gegenstandsRepoDatei(g.dir), REPO_ECHT);
  writeFileSync(g.arbeit, dateiText([holzaxt]));
  const z2: string[] = [];
  const r2 = gegenstaendeAbgleichenBeimStart(g.dir, g.arbeit, { log: (t) => z2.push(`log ${t}`), warn: (t) => z2.push(`warn ${t}`), error: (t) => z2.push(`error ${t}`) });
  check('a conflict is a WARNING line naming the conflict', r2?.fall === 'konflikt' && z2.length === 1 && z2[0]!.startsWith('warn ') && z2[0]!.includes('Konflikt'), JSON.stringify(z2));
  const h = neuerFall();
  mkdirSync(resolve(h.dir, 'shared/data'), { recursive: true });
  writeFileSync(gegenstandsRepoDatei(h.dir), REPO_ECHT);
  writeFileSync(h.arbeit, 'kaputt');
  const z3: string[] = [];
  gegenstaendeAbgleichenBeimStart(h.dir, h.arbeit, { log: (t) => z3.push(`log ${t}`), warn: (t) => z3.push(`warn ${t}`), error: (t) => z3.push(`error ${t}`) });
  check('a broken working copy is an ERROR line', z3.length === 1 && z3[0]!.startsWith('error '), JSON.stringify(z3));
  // a real I/O error: the working copy folder is a file
  const i = neuerFall();
  mkdirSync(resolve(i.dir, 'shared/data'), { recursive: true });
  writeFileSync(gegenstandsRepoDatei(i.dir), REPO_ECHT);
  writeFileSync(resolve(i.dir, 'blockiert'), 'x');
  const z4: string[] = [];
  let r4: unknown = 'nicht gelaufen';
  let geworfen = false;
  try {
    r4 = gegenstaendeAbgleichenBeimStart(i.dir, resolve(i.dir, 'blockiert', 'gegenstaende.json'), { log: (t) => z4.push(`log ${t}`), warn: (t) => z4.push(`warn ${t}`), error: (t) => z4.push(`error ${t}`) });
  } catch {
    geworfen = true;
  }
  check('an I/O error never stops the start: null, one error line, no throw', !geworfen && r4 === null && z4.length === 1 && z4[0]!.startsWith('error '), JSON.stringify(z4));
  void gegenstandsArbeitsDatei;
}

console.log('\n[5] The wiring in main.ts');
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
  const laden = aufrufe.filter((a) => a.name === 'ladeGegenstandsDatei');
  check('main.ts calls gegenstaendeAbgleichenBeimStart exactly once, as a top-level statement', abgleich.length === 1 && abgleich[0]!.oberste, JSON.stringify(abgleich));
  check('main.ts calls ladeGegenstandsDatei exactly once', laden.length === 1);
  check('the reconciliation comes BEFORE the load (source order)', abgleich.length === 1 && laden.length === 1 && abgleich[0]!.pos < laden[0]!.pos);
  check('both get the same working copy variable (gegenstandsDatei)', abgleich.length === 1 && laden.length === 1 && abgleich[0]!.argumente[1] === 'gegenstandsDatei' && laden[0]!.argumente[0] === 'gegenstandsDatei', JSON.stringify([abgleich[0]?.argumente, laden[0]?.argumente]));
  check('the root argument is the repo root (resolve(DATA_DIR, "../.."), like the path of the working copy)', abgleich.length === 1 && /^resolve\(DATA_DIR,\s*['"]\.\.\/\.\.['"]\)$/.test(abgleich[0]!.argumente[0] ?? ''), abgleich[0]?.argumente[0]);
}

wendeGegenstandsDatenAn([]);
rmSync(ORDNER, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
