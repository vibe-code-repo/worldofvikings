/**
 * Items from data, N4 (card G2, findings N3-1 and N3-3 of the third follow-up review of PR #176, plus the chest hint):
 * no data item is lost silently when both files are gone, a kept stack comes back only as a usable stack, and a chest
 * list never loses a known stack because raw ones lie beside it.
 * Gegenstandsdaten N4: Restbefunde aus Nachangriff N3.
 *
 *  [A] Working copy AND last good state missing (N3-1): `ohneGutenStand` is set; a held data item stays kept and the
 *      receipt is `bestaetigung-noetig`. A first start (nothing held) writes the last good state with its first tick and
 *      switches keeping off again; the next start is an ordinary one.
 *  [B] `rebind()` (N3-3): a kept stack with an unusable amount / durability / quality stays kept with a warning, a
 *      usable one comes back never equipped.
 *  [C] `unpackContainer`: 12 known stacks plus raw ones lose no known stack.
 *
 * Run: npx tsx server/test/gegenstaende-g2-n4.ts   (from the repo root)
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, packContainer, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import { leseGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsLetzterGuterDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { GegenstandsWache, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-n4');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const stumm = { log: () => undefined, warn: () => undefined, error: () => undefined };

const roh = (id: string) => ({
  id,
  nameSchluessel: `inhalt.gegenstand.${id}.name`,
  typ: 'zweihaendigWaffe',
  slot: 'hand',
  modell: { upload: null, skala: 0.6 },
  stapel: 10,
  gewicht: 2,
  werte: { damage: 10 },
  texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: id } },
});
const eintraege = (...ids: string[]): GegenstandsEintrag[] => {
  const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: ids.map((i) => roh(i)) }));
  if (l.dateiFehler || l.verworfen.length > 0) throw new Error('test data invalid');
  return l.eintraege;
};

function ohneWarnung<T>(f: () => T): { wert: T; warnungen: string[] } {
  const warnungen: string[] = [];
  const alt = console.warn;
  console.warn = (...a: unknown[]) => { warnungen.push(a.join(' ')); };
  try { return { wert: f(), warnungen }; } finally { console.warn = alt; }
}

function umgebung(name: string, halt: Record<string, number>) {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  const pfad = resolve(dir, 'gegenstaende.json');
  const verwahren: boolean[] = [];
  const entfernt: string[][] = [];
  const starte = () => {
    wendeGegenstandsDatenAn([]);
    verwahren.length = 0;
    const stand = ladeGegenstandsDatei(pfad, stumm);
    const wache = new GegenstandsWache({
      pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad),
      angewendet: stand.eintraege, startQuittung: stand.startQuittung, ohneGutenStand: stand.ohneGutenStand,
      gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (halt[i] ?? 0) > 0).map((i) => [i, halt[i]])),
      unbekanntGehalten: (istBekannt) => Object.fromEntries(Object.entries(halt).filter(([n, c]) => c > 0 && !istBekannt(n))),
      verwahren: (an) => { verwahren.push(an); setzeUnbekannteVerwahren(an); },
      entfernen: (ids) => { entfernt.push([...ids].sort()); for (const i of ids) delete halt[i]; },
      neuBinden: () => undefined, log: stumm,
    });
    return { stand, wache };
  };
  const quittung = (): GegenstandsQuittung | null => {
    try { return JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung; } catch { return null; }
  };
  return { pfad, guter: gegenstandsLetzterGuterDatei(pfad), halt, entfernt, verwahren, starte, quittung };
}

const gespeichert = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, stack: 3, durability: 10, quality: 1, gridX: 0, gridY: 0, equipped: false, ...extra }) as never;

function main(): void {
  try {
    console.log('\n[A] working copy and last good state both missing (N3-1)');
    {
      const t = umgebung('a-halt', { Datenaxt: 2 });
      const { stand, wache } = t.starte();
      check('the flag is set and the keep switch goes on', stand.ohneGutenStand === true && t.verwahren.join() === 'true', `flag ${stand.ohneGutenStand} switch [${t.verwahren}]`);
      const inv = new Inventory();
      inv.load([gespeichert('Datenaxt', { stack: 2 })]);
      check('a player holding a data item: the stack stays kept at login', inv.verwahrte.length === 1 && inv.serialize().some((s) => s.name === 'Datenaxt' && s.stack === 2));
      wache.tick();
      check('first tick: receipt bestaetigung-noetig with the held copies', t.quittung()?.status === 'bestaetigung-noetig' && t.quittung()?.gehalten?.Datenaxt === 2, JSON.stringify(t.quittung()));
      check('nothing removed, no last good state written, switch stays on', t.entfernt.length === 0 && t.halt.Datenaxt === 2 && !existsSync(t.guter) && t.verwahren.join() === 'true');
      const vorher = JSON.stringify(t.quittung());
      wache.tick();
      check('a second tick changes nothing (same receipt)', JSON.stringify(t.quittung()) === vorher && t.entfernt.length === 0);
      setzeUnbekannteVerwahren(false);
    }
    {
      const t = umgebung('a-erststart', {});
      const { stand, wache } = t.starte();
      check('first start: flag set (nothing known yet)', stand.ohneGutenStand === true);
      wache.tick();
      check('first tick: the last good state is written (empty list)', existsSync(t.guter) && (() => { const l = leseGegenstandsDatei(readFileSync(t.guter, 'utf-8')); return !l.dateiFehler && l.verworfen.length === 0 && l.eintraege.length === 0; })());
      check('the keep switch went on and off again', t.verwahren.join() === 'true,false' && t.quittung()?.status !== 'bestaetigung-noetig', `[${t.verwahren}]`);
      wache.tick();
      check('further ticks stay quiet', t.verwahren.join() === 'true,false');
      const zweiter = t.starte();
      check('the next start is an ordinary one (good state present, no flag, no switch)', zweiter.stand.ohneGutenStand !== true && t.verwahren.length === 0, `flag ${zweiter.stand.ohneGutenStand}`);
      setzeUnbekannteVerwahren(false);
    }

    console.log('\n[B] rebind brings back only usable stacks (N3-3)');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const inv = new Inventory();
        inv.load([
          gespeichert('Datenaxt', { stack: 'x', durability: Number.NaN, equipped: true, gridX: 0, gridY: 1 }),
          gespeichert('Datenaxt', { stack: 1.5, gridX: 1, gridY: 1 }),
          gespeichert('Datenaxt', { stack: 0, gridX: 2, gridY: 1 }),
          gespeichert('Datenaxt', { stack: -4, gridX: 3, gridY: 1 }),
          gespeichert('Datenaxt', { quality: Number.POSITIVE_INFINITY, gridX: 4, gridY: 1 }),
          gespeichert('Datenaxt', { stack: 7, durability: 20, equipped: true, gridX: 5, gridY: 1 }),
        ]);
        check('setup: six stacks kept raw', inv.verwahrte.length === 6 && inv.all.length === 0);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        const { warnungen } = ohneWarnung(() => inv.rebind());
        check('the five unusable stacks stay kept with a warning each', inv.verwahrte.length === 5 && warnungen.filter((w) => w.includes('unusable')).length === 5, `${inv.verwahrte.length} kept, ${warnungen.length} warnings`);
        check('nothing unusable entered the grid: one stack of 7 with finite values', inv.all.length === 1 && inv.all[0].stack === 7 && Number.isFinite(inv.all[0].durability) && Number.isInteger(inv.all[0].stack));
        check('the coming-back stack is not equipped', inv.all[0].equipped === false);
        check('the kept ones are still written back unchanged', inv.serialize().filter((s) => s.name === 'Datenaxt').length === 6 && inv.verwahrte.some((s) => (s.stack as unknown) === 'x'));
      } finally {
        setzeUnbekannteVerwahren(false);
        wendeGegenstandsDatenAn([]);
      }
    }

    console.log('\n[C] chest: raw stacks beside 12 known ones cost no known stack (hint from N3)');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const zwoelf = Array.from({ length: 12 }, () => '["Wood",50,0,1]').join(',');
        const eins = unpackContainer(`[${zwoelf},["Datenaxt",4,0,1]]`);
        check('12 known + 1 raw: all 12 known stacks stay, the raw one is kept', eins.all.length === 12 && eins.verwahrte.length === 1, `${eins.all.length} known, ${eins.verwahrte.length} raw`);
        const drei = unpackContainer(`[["Datenaxt",1,0,1],["Datenaxt",2,0,1],["Datenaxt",3,0,1],${zwoelf}]`);
        check('12 known + 3 raw (raw first): all 12 known stacks stay', drei.all.length === 12 && drei.verwahrte.length === 3);
        const zelle = new Set([...drei.all, ...drei.verwahrte].map((s) => `${s.gridX},${s.gridY}`));
        check('every stack owns its own cell', zelle.size === 15);
        const rund = unpackContainer(packContainer(eins));
        check('pack / unpack round trip keeps 12 + 1', rund.all.length === 12 && rund.verwahrte.length === 1);
        const dreizehn = unpackContainer(`[${zwoelf},["Wood",50,0,1]]`);
        check('13 known stacks (manipulated): still capped at the chest size', dreizehn.all.length === 12);
        check('sanity: Wood is a known item', findItem('Wood') !== undefined);
      } finally {
        setzeUnbekannteVerwahren(false);
      }
    }
  } finally {
    setzeUnbekannteVerwahren(false);
    wendeGegenstandsDatenAn([]);
    rmSync(DIR, { recursive: true, force: true });
  }
}

try {
  main();
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  process.exit(1);
}
