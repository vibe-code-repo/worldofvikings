/**
 * GD1 N1 (attack finding F1): the watch knows the base stock. A base id that leaves the working copy is no removal:
 * no receipt "bestaetigung-noetig", nothing deleted, the stacks stay, the base entry applies again.
 * Run: npx tsx server/test/gd1-wache-grundbestand.ts   (from the repo root)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findItem } from '@wov/shared';
import { GRUNDBESTAND, leseGegenstandsDatei, schreibeGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { gegenstandsLetzterGuterDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { GegenstandsWache, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'tmp-gd1-wache');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const roh = (id: string, stapel = 1) => ({
  id, nameSchluessel: `inhalt.gegenstand.${id}.name`, typ: 'material', stapel,
  texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: id } },
});
/** Wood stands for a working-copy override of a base item: the base entry with another harvest level (the only free field). */
const holzRoh = { ...(JSON.parse(schreibeGegenstandsDatei([GRUNDBESTAND.find((g) => g.id === 'Wood')!])).gegenstaende[0] as Record<string, unknown>), ernte: { baum: 3 } };
const eintraege = (...ids: string[]): GegenstandsEintrag[] => {
  const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: ids.map((i) => (i === 'Wood' ? holzRoh : roh(i, 7))) }));
  if (l.dateiFehler || l.verworfen.length > 0) throw new Error('test data invalid');
  return l.eintraege;
};
const stumm = { log: () => undefined, warn: () => undefined, error: () => undefined };

async function lauf(name: string, angewendet: GegenstandsEintrag[], halt: Record<string, number>, neu: GegenstandsEintrag[]) {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  const pfad = resolve(dir, 'gegenstaende.json');
  wendeGegenstandsDatenAn(angewendet);
  const entfernt: string[][] = [];
  const wache = new GegenstandsWache({
    pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad), angewendet,
    gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (halt[i] ?? 0) > 0).map((i) => [i, halt[i]])),
    entfernen: (ids) => { entfernt.push([...ids].sort()); for (const i of ids) delete halt[i]; },
    neuBinden: () => undefined, log: stumm,
  });
  writeFileSync(pfad, schreibeGegenstandsDatei(neu));
  await warte(30);
  wache.tick();
  let q: GegenstandsQuittung | null = null;
  try { q = JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung; } catch { /* none */ }
  return { entfernt, q, halt };
}

(async () => {
  console.log('\n[F1] Wood overridden in the working copy, then deleted from it, 5 Wood held');
  const a = await lauf('wood', eintraege('Wood', 'Rest'), { Wood: 5 }, eintraege('Rest'));
  check('receipt is angewendet, no confirmation asked', a.q?.status === 'angewendet', JSON.stringify(a.q));
  check('nothing removed, the 5 Wood stay', a.entfernt.length === 0 && a.halt.Wood === 5, JSON.stringify(a.entfernt));
  check('the base entry applies again (no harvest level, not the override 3)', findItem('Wood')?.ernte?.baum === undefined);
  console.log('\n[F1b] a data item (not base) removed together with a base id: only the data item needs the confirmation');
  const b = await lauf('gemischt', eintraege('Wood', 'Holzaxt', 'Rest'), { Wood: 5, Holzaxt: 2 }, eintraege('Rest'));
  check('receipt names only Holzaxt', b.q?.status === 'bestaetigung-noetig' && JSON.stringify(b.q?.gehalten) === '{"Holzaxt":2}', JSON.stringify(b.q));
  check('nothing removed yet, Wood stays', b.entfernt.length === 0 && b.halt.Wood === 5);
  console.log('\n[F1c] start: last good state holds an override of Wood, the file does not: the file applies (no "letzter guter Stand")');
  {
    const dir = resolve(DIR, 'start');
    mkdirSync(dir, { recursive: true });
    const pfad = resolve(dir, 'gegenstaende.json');
    writeFileSync(gegenstandsLetzterGuterDatei(pfad), schreibeGegenstandsDatei(eintraege('Wood', 'Rest')));
    writeFileSync(pfad, schreibeGegenstandsDatei(eintraege('Rest')));
    const r = ladeGegenstandsDatei(pfad, stumm);
    check('result is angewendet, not letzter-guter', r.art === 'angewendet', r.art);
    check('Wood is the base entry (no harvest level)', findItem('Wood')?.ernte?.baum === undefined);
  }

  // ── N1-1: a deviating copy of a base entry never costs the rest of the file ──
  const abweichend = { ...holzRoh, stapel: 77, ernte: { baum: 3 } };
  const holzaxt = roh('Holzaxt', 7);
  const dateiMit = (...e: unknown[]): string => JSON.stringify({ version: 1, gegenstaende: e });
  const warnungen: string[] = [];
  const laut = { log: () => undefined, warn: (m: string) => { warnungen.push(m); }, error: () => undefined };
  const nur = (m: string): boolean => warnungen.some((w) => w.includes('Wood') && w.includes('weichen vom Grundstand ab')) && m.length > 0;

  console.log('\n[N1-1a] start: file with Holzaxt and Wood stack 77');
  {
    warnungen.length = 0;
    const dir = resolve(DIR, 'n1-start'); mkdirSync(dir, { recursive: true });
    const pfad = resolve(dir, 'gegenstaende.json');
    writeFileSync(pfad, dateiMit(abweichend, holzaxt));
    const r = ladeGegenstandsDatei(pfad, laut);
    check('applied, not rejected', r.art === 'angewendet' || r.ohneGutenStand === true, r.art);
    check('Holzaxt is known, Wood is the base entry (stack 50), the harvest level of the copy is kept', findItem('Holzaxt') !== undefined && findItem('Wood')?.maxStackSize === 50 && findItem('Wood')?.ernte?.baum === 3);
    check('a loud warning names Wood', nur('start'), warnungen.join(' | '));
  }
  console.log('\n[N1-1b] last good state holds a stale base copy (en name of before N1) and Holzaxt, working copy broken');
  {
    warnungen.length = 0;
    wendeGegenstandsDatenAn([]);
    const dir = resolve(DIR, 'n1-guter'); mkdirSync(dir, { recursive: true });
    const pfad = resolve(dir, 'gegenstaende.json');
    const alt = { ...holzRoh, texte: { 'inhalt.gegenstand.Wood.name': { de: 'Holz', en: 'Timber' } }, ernte: {} };
    writeFileSync(gegenstandsLetzterGuterDatei(pfad), dateiMit(alt, holzaxt));
    writeFileSync(pfad, '{kaputt');
    const r = ladeGegenstandsDatei(pfad, laut);
    check('last good state loads (not "unusable")', r.art === 'letzter-guter', r.art);
    check('Holzaxt stays known, Wood is the base entry', findItem('Holzaxt') !== undefined && findItem('Wood')?.label === 'Holz');
    check('warning names Wood', nur('guter'), warnungen.join(' | '));
    check('N1-2: the start receipt carries the reason code of the broken working copy', r.startQuittung?.grund === 'datei-kein-json', JSON.stringify(r.startQuittung));
  }
  console.log('\n[N1-1c] watch: file with a deviating Wood copy and Holzaxt is applied');
  {
    warnungen.length = 0;
    const dir = resolve(DIR, 'n1-wache'); mkdirSync(dir, { recursive: true });
    const pfad = resolve(dir, 'gegenstaende.json');
    wendeGegenstandsDatenAn([]);
    const wache = new GegenstandsWache({
      pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad), angewendet: [],
      gehalten: () => ({}), entfernen: () => undefined, neuBinden: () => undefined, log: laut,
    });
    writeFileSync(pfad, dateiMit(abweichend, holzaxt));
    await warte(30);
    wache.tick();
    const q = JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung;
    check('receipt angewendet', q.status === 'angewendet', JSON.stringify(q));
    check('Holzaxt known, Wood base entry with the own harvest level', findItem('Holzaxt') !== undefined && findItem('Wood')?.maxStackSize === 50 && findItem('Wood')?.ernte?.baum === 3);
    check('warning names Wood', nur('wache'), warnungen.join(' | '));
    writeFileSync(pfad, '{kaputt');
    await warte(30);
    wache.tick();
    const q2 = JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung;
    check('N1-2: a broken file gives receipt abgelehnt with the reason code datei-kein-json', q2.status === 'abgelehnt' && q2.grund === 'datei-kein-json', JSON.stringify(q2));
  }
  wendeGegenstandsDatenAn([]);
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAIL`);
  rmSync(DIR, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})();
