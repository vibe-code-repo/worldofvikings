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
 *  [D] (N4-1) the order of a chest list does not matter; `removeByName` removes what it counts.
 *  [E] (N4-2) one repair (`repariereStapel`) for `load`, `unpackContainer` and `rebind`; N5: repair instead of keeping, cells against kept ones, tests for `removeByName`.
 *  [F] (N4-3) the watch without a file: save in progress, scan rate, outdated receipt, broken last good state.
 *
 * Run: npx tsx server/test/gegenstaende-g2-n4.ts   (from the repo root)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, packContainer, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import { STAPEL_OBERGRENZE } from '@wov/shared/src/items/Inventory.js';
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

const zellen = (inv: Inventory): string[] => [...inv.all.map((s) => `${s.gridX},${s.gridY}`), ...inv.verwahrte.map((s) => `${s.gridX},${s.gridY}`)];
const eindeutig = (z: string[]): boolean => new Set(z).size === z.length;
const holz = () => findItem('Wood')!;

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
  const speichert = { an: false };
  const scans = { n: 0 };
  const starte = () => {
    wendeGegenstandsDatenAn([]);
    verwahren.length = 0;
    const stand = ladeGegenstandsDatei(pfad, stumm);
    const wache = new GegenstandsWache({
      pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad),
      angewendet: stand.eintraege, startQuittung: stand.startQuittung, ohneGutenStand: stand.ohneGutenStand,
      gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (halt[i] ?? 0) > 0).map((i) => [i, halt[i]])),
      speichertGerade: () => speichert.an,
      unbekanntGehalten: (istBekannt) => (scans.n++, Object.fromEntries(Object.entries(halt).filter(([n, c]) => c > 0 && !istBekannt(n)))),
      verwahren: (an) => { verwahren.push(an); setzeUnbekannteVerwahren(an); },
      entfernen: (ids) => { entfernt.push([...ids].sort()); for (const i of ids) delete halt[i]; },
      neuBinden: () => undefined, log: stumm,
    });
    return { stand, wache };
  };
  const quittung = (): GegenstandsQuittung | null => {
    try { return JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung; } catch { return null; }
  };
  return { pfad, guter: gegenstandsLetzterGuterDatei(pfad), halt, entfernt, verwahren, starte, quittung, speichert, scans, dir };
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

    console.log('\n[B] rebind brings back usable stacks, repairs the repairable, keeps the rest (N3-3, N5-1)');
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
          gespeichert('Datenaxt', { durability: Number.POSITIVE_INFINITY, gridX: 6, gridY: 1 }),
          gespeichert('Datenaxt', { durability: -5, gridX: 7, gridY: 1 }),
          gespeichert('Datenaxt', { stack: 7, durability: 20, equipped: true, gridX: 5, gridY: 1 }),
        ]);
        check('setup: eight stacks kept raw', inv.verwahrte.length === 8 && inv.all.length === 0);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        const { warnungen } = ohneWarnung(() => inv.rebind());
        check('the three without a usable amount (x, 0, -4) stay kept, one warning each', inv.verwahrte.length === 3 && warnungen.filter((w) => w.includes('unusable')).length === 3, `${inv.verwahrte.length} kept, ${warnungen.length} warnings`);
        check('the five repairable ones came back, repaired with a warning each', inv.all.length === 5 && warnungen.filter((w) => w.includes('repaired')).length === 4, `${inv.all.length} back`);
        check('every stack in the grid is usable: whole amount >= 1, finite durability >= 0, whole quality >= 1', inv.all.every((i) => Number.isInteger(i.stack) && i.stack >= 1 && Number.isFinite(i.durability) && i.durability >= 0 && Number.isInteger(i.quality) && i.quality >= 1));
        check('1.5 became 1, the infinite durability the maximum, -5 became 0', inv.all.some((i) => i.stack === 1) && inv.all.some((i) => i.durability === 0) && inv.all.every((i) => i.durability <= (i.shared.maxDurability ?? 1e9)));
        check('nothing is equipped that came back', inv.all.every((i) => i.equipped === false));
        check('the kept ones are still written back unchanged', inv.verwahrte.some((s) => (s.stack as unknown) === 'x') && inv.serialize().length === 8);
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

    console.log('\n[D] chest: the order of the list does not matter, no known stack outside the grid (N4-1)');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const zwoelf = Array.from({ length: 12 }, () => '["Wood",5,0,1]').join(',');
        const truhe = unpackContainer(`[["Datenaxt",4,0,1],${zwoelf}]`);
        const imGitter = truhe.all.every((i) => i.gridX >= 0 && i.gridX < truhe.width && i.gridY >= 0 && i.gridY < truhe.height);
        check('raw stack BEFORE 12 known ones: all 12 known lie in the grid, the raw one is kept', truhe.all.length === 12 && imGitter && truhe.verwahrte.length === 1 && eindeutig(zellen(truhe)));
        check('removeByName(Wood, 60) removes all 60 (true) and nothing stays', truhe.removeByName('Wood', 60) === true && truhe.countOf('Wood') === 0);
        const dreizehn = unpackContainer(`[${Array.from({ length: 13 }, () => '["Wood",50,0,1]').join(',')}]`);
        check('13 known stacks: 12 in the grid, the 13th kept (not dropped)', dreizehn.all.length === 12 && dreizehn.verwahrte.length === 1 && dreizehn.verwahrte[0].name === 'Wood');
        check('removeByName asks for more than the grid holds: false, nothing changes', dreizehn.removeByName('Wood', 650) === false && dreizehn.countOf('Wood') === 600);
        const beide = unpackContainer(`[${zwoelf},["Datenaxt",4,0,1]]`);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        ohneWarnung(() => beide.rebind());
        check('12 known + 1 raw, the name gets defined later: nothing is lost (kept: no free cell)', beide.all.length === 12 && beide.verwahrte.filter((v) => v.name === 'Datenaxt').length === 1 && JSON.parse(packContainer(beide)).length === 13);
        wendeGegenstandsDatenAn([]);
        // removeByName counts and removes the same stacks, wherever they lie (mutant: grid walk)
        const schief = new Inventory();
        schief.addItem(holz(), 5);
        schief.all[0].gridY = 9;
        check('a stack outside the grid: removeByName is true and removes it (no half removal)', schief.removeByName('Wood', 5) === true && schief.countOf('Wood') === 0);
        const roh2 = unpackContainer('[["Wood",0,0,1],["Wood","2",0,1],["Wood",null,0,1]]');
        check('tuples without a usable amount (0, "2", null) are kept, never in the grid, never dropped', roh2.all.length === 0 && roh2.verwahrte.length === 3);
        const mitMuell = unpackContainer(`[["Wood",0,0,1],${zwoelf}]`);
        check('an unusable tuple in front does not take one of the 12 grid cells (a legitimate 12th is not pushed out)', mitMuell.all.length === 12 && mitMuell.verwahrte.length === 1, `${mitMuell.all.length} in grid`);
        const repariert = unpackContainer('[["Wood",3,-5,0]]');
        check('a repairable tuple (durability -5, quality 0) lies in the grid, repaired', repariert.all.length === 1 && repariert.all[0].durability === 0 && repariert.all[0].quality === 1 && repariert.verwahrte.length === 0);
        const nan = new Inventory();
        nan.addItem(holz(), 5);
        nan.all[0].stack = Number.NaN;
        check('removeByName that cannot remove everything is false (a NaN stack)', nan.removeByName('Wood', 5) === false);
      } finally {
        setzeUnbekannteVerwahren(false);
        wendeGegenstandsDatenAn([]);
      }
    }

    console.log('\n[E] one repair for load, unpack and rebind (N4-2, N5-1, N5-2)');
    {
      const unbrauchbar: Record<string, unknown>[] = [{ stack: 0 }, { stack: -1 }, { stack: '2' }, { stack: null }, { stack: Number.NaN }, { stack: 0.5 }];
      const inv = new Inventory();
      const { warnungen } = ohneWarnung(() => inv.load(unbrauchbar.map((x, n) => gespeichert('Wood', { ...x, gridX: n, gridY: 0 }))));
      check('load: a stack without a usable amount (0, -1, "2", null, NaN, 0.5) is kept, none in the grid, one warning each', inv.all.length === 0 && inv.verwahrte.length === 6 && warnungen.length === 6, `${inv.all.length} in grid, ${inv.verwahrte.length} kept`);
      const weg = new Inventory();
      weg.load(JSON.parse(JSON.stringify(inv.serialize())) as never);
      check('after a JSON round trip the next login keeps them all (6 kept, 0 in the grid)', weg.all.length === 0 && weg.verwahrte.length === 6, `${weg.all.length} / ${weg.verwahrte.length}`);

      const reparierbar: Record<string, unknown>[] = [
        { stack: 1.5 }, { durability: -5 }, { durability: Number.POSITIVE_INFINITY }, { durability: Number.NaN }, { quality: -1 }, { quality: 0 }, { quality: 1.5 }, { quality: null }, { quality: Number.NaN },
      ];
      const rep = new Inventory();
      const r = ohneWarnung(() => rep.load(reparierbar.map((x, n) => gespeichert('Wood', { ...x, gridX: n % 8, gridY: (n / 8) | 0 }))));
      check('load: a repairable stack is repaired, not kept (9 in the grid, none kept, one warning each)', rep.all.length === 9 && rep.verwahrte.length === 0 && r.warnungen.filter((w) => w.includes('repaired')).length === 9, `${rep.all.length} in grid, ${rep.verwahrte.length} kept`);
      check('quality is a whole number >= 1, durability finite and >= 0, amount a whole number >= 1', rep.all.every((i) => Number.isInteger(i.quality) && i.quality >= 1 && Number.isFinite(i.durability) && i.durability >= 0 && Number.isInteger(i.stack) && i.stack >= 1));
      const ausnahmen = new Inventory();
      ohneWarnung(() => ausnahmen.load([gespeichert('Wood', { stack: 1e308 })]));
      check('an absurd amount (1e308) is brought to 9999 and split, not kept and not an endless loop', ausnahmen.verwahrte.length === 0 && ausnahmen.countOf('Wood') === STAPEL_OBERGRENZE, `${ausnahmen.countOf('Wood')}`);
      const hoch = new Inventory();
      ohneWarnung(() => hoch.load([gespeichert('Wood', { durability: 99999 })]));
      const max = findItem('Wood')!.maxDurability;
      check('durability over the maximum is brought to it (when the item has one)', max === undefined || hoch.all[0].durability === max, `${hoch.all[0].durability} / ${max}`);

      const gut = new Inventory();
      gut.load([
        gespeichert('Wood', { stack: 20, equipped: true, gridX: 0, gridY: 0 }),
        gespeichert('Wood', { gridX: 99, gridY: -3 }),
        gespeichert('Wood', { gridX: 0, gridY: 0 }),
        gespeichert('Wood', { gridX: 1.5, gridY: 2 }),
      ]);
      check('a cell outside the grid, a fraction or a taken cell gets a free one; each stack owns its cell', gut.all.length === 4 && eindeutig(zellen(gut)) && gut.all.every((i) => i.gridX >= 0 && i.gridX < gut.width && i.gridY >= 0 && i.gridY < gut.height));
      check('equipped stays a real boolean (true kept for the server to derive from)', gut.all.some((i) => i.equipped === true) && gut.all.every((i) => typeof i.equipped === 'boolean'));
      const voll = new Inventory(1, 1);
      ohneWarnung(() => voll.load([gespeichert('Wood', { gridX: 0, gridY: 0 }), gespeichert('Stone', { gridX: 0, gridY: 0 })]));
      check('no free cell for a stack with a taken cell: it is kept, not dropped', voll.all.length === 1 && voll.verwahrte.length === 1);

      setzeUnbekannteVerwahren(true);
      try {
        for (const rohZuerst of [true, false]) {
          const a = new Inventory();
          const rohStapel = gespeichert('Datenaxt', { gridX: 1, gridY: 1 });
          const holzStapel = gespeichert('Wood', { gridX: 1, gridY: 1 });
          ohneWarnung(() => a.load(rohZuerst ? [rohStapel, holzStapel] : [holzStapel, rohStapel]));
          check(`N5-2: a kept raw stack and a known one on the same cell (${rohZuerst ? 'raw first' : 'known first'}): every stack owns its own cell`, a.all.length === 1 && a.verwahrte.length === 1 && eindeutig(zellen(a)), zellen(a).join(' | '));
        }
      } finally {
        setzeUnbekannteVerwahren(false);
      }
    }

    console.log('\n[F] the watch without a file: save in progress, scan rate, outdated receipt, broken last good state (N4-3, hints)');
    {
      const t = umgebung('f-speichern', {});
      t.speichert.an = true;
      const { wache } = t.starte();
      wache.tick();
      check('a save in progress puts the tick off: no scan, no last good state, the switch stays on', t.scans.n === 0 && !existsSync(t.guter) && t.verwahren.join() === 'true', `scans ${t.scans.n}`);
      t.speichert.an = false;
      wache.tick();
      check('after the save the tick settles the state', existsSync(t.guter) && t.verwahren.join() === 'true,false' && t.scans.n === 1);
    }
    {
      const t = umgebung('f-takt', { Datenaxt: 2 });
      const { wache } = t.starte();
      for (let i = 0; i < 20; i++) wache.tick();
      check('held item, file missing for 20 ticks: at most 5 scans (not 20), one receipt', t.scans.n >= 2 && t.scans.n <= 5 && t.quittung()?.status === 'bestaetigung-noetig', `scans ${t.scans.n}`);
      delete t.halt.Datenaxt;
      for (let i = 0; i < 6; i++) wache.tick();
      check('what was held is gone: the outdated receipt is replaced (angewendet), state settled, switch off', t.quittung()?.status === 'angewendet' && existsSync(t.guter) && t.verwahren.join() === 'true,false', JSON.stringify(t.quittung()));
      setzeUnbekannteVerwahren(false);
    }
    {
      const t = umgebung('f-kaputt', {});
      writeFileSync(t.guter, '{kaputt');
      const { wache } = t.starte();
      wache.tick();
      const kopien = readdirSync(t.dir).filter((f) => f.includes('.kaputt-'));
      const l = existsSync(t.guter) ? leseGegenstandsDatei(readFileSync(t.guter, 'utf-8')) : null;
      check('a broken last good state is kept as .kaputt-<time> before it is replaced by an empty one', kopien.length === 1 && readFileSync(resolve(t.dir, kopien[0]), 'utf-8') === '{kaputt' && l !== null && !l.dateiFehler && l.eintraege.length === 0, kopien.join());
      setzeUnbekannteVerwahren(false);
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
