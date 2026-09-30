/**
 * Items from data, N3 (card G2, findings F1-F6 of the second follow-up review of PR #176): kept raw stacks must not be
 * lost, collide or stay hidden, and the start without a usable last good state has no silent gap any more.
 * Gegenstandsdaten N3: verwahrte rohe Stapel gehen nicht verloren, liegen nicht doppelt und kommen zurück.
 *
 *  [F1] A chest with a kept raw stack counts it against the size: putting one more item in is refused (the raw stack
 *       owns a cell); a list longer than the chest never cuts a raw stack (a known stack gives way).
 *  [F2] The cell of a kept raw stack is taken: new items and moves never land on it; a stack coming back onto a cell that
 *       is taken (old save) gets a free one.
 *  [F3] `rebind()` brings kept stacks back at once when the name is defined again; without a free cell it stays kept.
 *  [F4] Start: last good state missing / 0 byte / broken x working copy missing / 0 byte / broken / valid: every
 *       combination flags `ohneGutenStand` (N4: also both missing; the first start writes the last good state, see n4).
 *  [F5] Two servers one after the other in one process: `stop()` leaves the keep switch off.
 *  [F6] Watch in the `ohneGutenStand` mode: a confirmation covers only the ids of its receipt (M3) and only the hash
 *       of its receipt, also when the file changed in the same tick (M4).
 *
 * Run: npx tsx server/test/gegenstaende-g2-n3.ts   (from the repo root)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, packContainer, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import { unbekannteWerdenVerwahrt } from '@wov/shared/src/items/Inventory.js';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsLetzterGuterDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { createWovServer } from '../src/WovServer.js';
import { GegenstandsWache, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-n3');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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
const stein = () => findItem('Stone')!;

function ohneWarnung<T>(f: () => T): { wert: T; warnungen: string[] } {
  const warnungen: string[] = [];
  const alt = console.warn;
  console.warn = (...a: unknown[]) => { warnungen.push(a.join(' ')); };
  try { return { wert: f(), warnungen }; } finally { console.warn = alt; }
}

// ── [F4]/[F6] helpers ─────────────────────────────────────────────────────
type Art = 'fehlt' | '0-byte' | 'kaputt' | 'gueltig';
function schreibeArt(pfad: string, art: Art, gueltig = ''): void {
  if (art === 'fehlt') rmSync(pfad, { force: true });
  else if (art === '0-byte') writeFileSync(pfad, '');
  else if (art === 'kaputt') writeFileSync(pfad, '{kaputt');
  else writeFileSync(pfad, gueltig);
}

function umgebung(name: string, halt: Record<string, number>) {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  const pfad = resolve(dir, 'gegenstaende.json');
  const entfernt: string[][] = [];
  const verwahren: boolean[] = [];
  const schreibeDatei = async (e: GegenstandsEintrag[]): Promise<string> => {
    const text = schreibeGegenstandsDatei(e);
    writeFileSync(pfad, text);
    await warte(30);
    return layoutHash(Buffer.from(text));
  };
  const starte = () => {
    wendeGegenstandsDatenAn([]);
    verwahren.length = 0;
    const stand = ladeGegenstandsDatei(pfad, stumm);
    const wache = new GegenstandsWache({
      pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad),
      angewendet: stand.eintraege, startQuittung: stand.startQuittung, ohneGutenStand: stand.ohneGutenStand,
      gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (halt[i] ?? 0) > 0).map((i) => [i, halt[i]])),
      unbekanntGehalten: (istBekannt) => Object.fromEntries(Object.entries(halt).filter(([n, c]) => c > 0 && !istBekannt(n))),
      verwahren: (an) => verwahren.push(an),
      entfernen: (ids) => { entfernt.push([...ids].sort()); for (const i of ids) delete halt[i]; },
      neuBinden: () => undefined, log: stumm,
    });
    return { stand, wache };
  };
  const quittung = (): GegenstandsQuittung | null => {
    try { return JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung; } catch { return null; }
  };
  const bestaetige = async (hash: string): Promise<void> => { bestaetigenAnfrageSchreiben(gegenstandsBestaetigenDatei(pfad), hash); await warte(30); };
  return { pfad, guter: gegenstandsLetzterGuterDatei(pfad), halt, entfernt, verwahren, schreibeDatei, starte, quittung, bestaetige };
}

async function main(): Promise<void> {
  try {
    console.log('\n[F1] chest: kept raw stacks count against the size and are never cut');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const elf = Array.from({ length: 11 }, () => '["Wood",50,0,1]');
        const truhe = unpackContainer(`[["Datenaxt",4,0,1],${elf.join(',')}]`);
        check('setup: 11 Wood + 1 kept raw stack = the chest is full', truhe.all.length === 11 && truhe.verwahrte.length === 1 && truhe.width * truhe.height === 12);
        const rest = truhe.addItem(stein(), 1);
        check('putting one more item in is refused (1 left over, nothing added)', rest === 1 && truhe.all.length === 11, `rest ${rest}`);
        const gepackt = JSON.parse(packContainer(truhe)) as unknown[][];
        check('pack holds 12 entries incl. the raw one', gepackt.length === 12 && gepackt.some((t) => t[0] === 'Datenaxt'));
        const nochmal = unpackContainer(packContainer(truhe));
        check('unpack again: the raw stack is still there (50 rounds pack/unpack change nothing)', (() => {
          let t = nochmal;
          for (let i = 0; i < 50; i++) t = unpackContainer(packContainer(t));
          return t.verwahrte.length === 1 && t.verwahrte[0].stack === 4 && t.all.length === 11;
        })());

        const teilvoll = unpackContainer(`[["Datenaxt",4,0,1],${elf.slice(0, 10).join(',')}]`);
        check('one cell free: one more item fits, then the chest is full and the raw stack survives', teilvoll.addItem(stein(), 1) === 0 && (() => {
          const t = unpackContainer(packContainer(teilvoll));
          return t.all.length === 11 && t.verwahrte.length === 1;
        })());

        const zuLang = unpackContainer(`[${Array.from({ length: 12 }, () => '["Wood",50,0,1]').join(',')},["Datenaxt",4,0,1]]`);
        check('13 entries (old save): the raw stack at the end is kept and no known stack gives way (N4)', zuLang.verwahrte.length === 1 && zuLang.all.length === 12 && eindeutig(zellen(zuLang)), `${zuLang.all.length} known, ${zuLang.verwahrte.length} raw`);
      } finally {
        setzeUnbekannteVerwahren(false);
      }
    }

    console.log('\n[F2] the cell of a kept raw stack is taken');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const inv = new Inventory();
        inv.load([{ name: 'Datenaxt', stack: 4, durability: 0, quality: 1, gridX: 0, gridY: 3, equipped: false }]);
        check('setup: one kept raw stack on 0,3', inv.verwahrte.length === 1 && inv.all.length === 0);
        inv.addItem(holz(), 100000);
        check('filling the inventory takes 31 cells, never 0,3', inv.all.length === 31 && inv.itemAt(0, 3) === null && eindeutig(zellen(inv)), `${inv.all.length} stacks`);
        inv.removeItem(inv.all[0], inv.all[0].stack);
        const frei = inv.all.length; // one cell free now
        const ziel = inv.all[0];
        check('a move onto the cell of the kept stack is refused', inv.moveTo(ziel, 0, 3) === false && !(ziel.gridX === 0 && ziel.gridY === 3));
        check('setup unchanged: still 30 stacks', frei === 30);

        // an old save with two stacks on one cell: the raw one gets a free cell when it comes back
        setzeUnbekannteVerwahren(true);
        const alt = new Inventory();
        alt.load([
          { name: 'Wood', stack: 50, durability: 0, quality: 1, gridX: 0, gridY: 3, equipped: false },
          { name: 'Datenaxt', stack: 4, durability: 0, quality: 1, gridX: 0, gridY: 3, equipped: false },
        ]);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        alt.rebind();
        const axt = alt.all.find((s) => s.shared.name === 'Datenaxt');
        check('old save with two stacks on one cell: load already gives the known one a free cell (N5), the coming-back stack keeps its own, no two on one cell', !!axt && alt.verwahrte.length === 0 && eindeutig(zellen(alt)) && axt.gridX === 0 && axt.gridY === 3 && (() => { const h = alt.all.find((x) => x.shared.name === 'Wood')!; return !(h.gridX === 0 && h.gridY === 3); })(), axt ? `${axt.gridX},${axt.gridY}` : 'missing');
      } finally {
        setzeUnbekannteVerwahren(false);
        wendeGegenstandsDatenAn([]);
      }
    }

    console.log('\n[F3] rebind brings kept stacks back at once');
    {
      setzeUnbekannteVerwahren(true);
      try {
        const inv = new Inventory();
        inv.load([
          { name: 'Datenaxt', stack: 4, durability: 7, quality: 1, gridX: 2, gridY: 1, equipped: false },
          { name: 'Wood', stack: 10, durability: 0, quality: 1, gridX: 0, gridY: 0, equipped: false },
        ]);
        check('setup: Datenaxt kept, only Wood in the grid', inv.all.length === 1 && inv.verwahrte.length === 1);
        inv.rebind();
        check('still undefined: rebind leaves it kept', inv.verwahrte.length === 1 && inv.all.length === 1);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        let gemeldet = 0;
        inv.onChanged(() => gemeldet++);
        inv.rebind();
        const axt = inv.all.find((s) => s.shared.name === 'Datenaxt');
        check('defined: the stack is in `all` on its own cell with its numbers, no longer kept', !!axt && axt.stack === 4 && axt.durability === 7 && axt.gridX === 2 && axt.gridY === 1 && inv.verwahrte.length === 0 && gemeldet > 0);
        check('serialize has 2 entries (no duplicate of the kept stack)', inv.serialize().length === 2 && inv.countOf('Datenaxt') === 4);
        const weg = inv.all.find((s) => s.shared.name === 'Datenaxt');
        check('the returned stack behaves as any item (itemAt finds it, remove works)', inv.itemAt(2, 1) === weg && (inv.removeItem(weg!), inv.countOf('Datenaxt') === 0));

        // no free cell: stays kept, comes back when a cell is free
        wendeGegenstandsDatenAn([]);
        const voll = new Inventory();
        voll.load([{ name: 'Datenaxt', stack: 4, durability: 0, quality: 1, gridX: 99, gridY: 99, equipped: false }]); // a cell of its own that does not exist
        voll.addItem(holz(), 100000);
        wendeGegenstandsDatenAn(eintraege('Datenaxt'));
        const { warnungen } = ohneWarnung(() => voll.rebind());
        check('no free cell: the stack stays kept with a warning, nothing lost', voll.verwahrte.length === 1 && voll.all.every((s) => s.shared.name === 'Wood') && warnungen.length === 1, `${warnungen.length} warn`);
        voll.removeItem(voll.all[5], voll.all[5].stack);
        voll.rebind();
        check('a cell is free later: the next rebind brings it back', voll.verwahrte.length === 0 && voll.countOf('Datenaxt') === 4 && eindeutig(zellen(voll)));
      } finally {
        setzeUnbekannteVerwahren(false);
        wendeGegenstandsDatenAn([]);
      }
    }

    console.log('\n[F4] start: last good state x working copy');
    {
      const GUTE_ARTEN: Exclude<Art, 'gueltig'>[] = ['fehlt', '0-byte', 'kaputt'];
      const ARBEIT_ARTEN: Art[] = ['fehlt', '0-byte', 'kaputt', 'gueltig'];
      for (const guter of GUTE_ARTEN) {
        for (const arbeit of ARBEIT_ARTEN) {
          const t = umgebung(`f4-${guter}-${arbeit}`, { Datenaxt: 2 });
          schreibeArt(t.guter, guter);
          schreibeArt(t.pfad, arbeit, schreibeGegenstandsDatei(eintraege('Holzaxt')));
          const { stand } = t.starte();
          const soll = true; // also both missing (N4): a save may hold data items nobody can tell from removed ones
          check(`last good ${guter} / working copy ${arbeit}: ohneGutenStand ${soll}, switch ${soll ? 'on' : 'untouched'}`, (stand.ohneGutenStand === true) === soll && t.verwahren.join() === (soll ? 'true' : ''), `art ${stand.art} flag ${stand.ohneGutenStand} switch [${t.verwahren}]`);
        }
      }
      const t = umgebung('f4-kette', { Datenaxt: 2 });
      schreibeArt(t.guter, 'kaputt');
      const { wache } = t.starte();
      wache.tick();
      check('kaputt + missing working copy: a held Datenaxt stays kept at login (switch on), nothing removed', t.verwahren[0] === true && t.entfernt.length === 0 && t.halt.Datenaxt === 2);
      const hash = await t.schreibeDatei(eintraege('Holzaxt'));
      wache.tick();
      check('the file appears without the held Datenaxt: receipt bestaetigung-noetig, copies stay', t.quittung()?.status === 'bestaetigung-noetig' && t.quittung()?.hash === hash && t.halt.Datenaxt === 2 && t.entfernt.length === 0, JSON.stringify(t.quittung()));
    }

    console.log('\n[F5] two servers one after the other in one process');
    {
      const dir = resolve(DIR, 'f5');
      const config = (name: string, extra: object) => ({
        port: 0, worldsDir: resolve(dir, 'welten'), kontenDir: resolve(dir, 'welten', 'konten'), worldName: name,
        saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false, ...extra,
      });
      const arbeit = resolve(dir, 'gegenstaende.json');
      mkdirSync(dir, { recursive: true });
      setzeUnbekannteVerwahren(false);
      const a = createWovServer(config('f5-a', { gegenstandsDatei: arbeit, gegenstandsStart: [], gegenstandsOhneGutenStand: true }));
      a.start();
      check('server A (ohneGutenStand) switches keeping on', unbekannteWerdenVerwahrt() === true);
      a.stop();
      check('after A.stop() the switch is off again', unbekannteWerdenVerwahrt() === false);
      const b = createWovServer(config('f5-b', {}));
      b.start();
      const inv = new Inventory();
      inv.load([{ name: 'Datenaxt', stack: 1, durability: 0, quality: 1, gridX: 0, gridY: 0, equipped: false }]);
      check('server B (no flag) does not inherit it: an unknown stack is dropped as before', unbekannteWerdenVerwahrt() === false && inv.verwahrte.length === 0 && inv.all.length === 0);
      b.stop();
    }

    console.log('\n[F6] watch in the ohneGutenStand mode: what a confirmation covers');
    {
      // M3: a confirmation covers only the ids of its receipt.
      const t = umgebung('f6-ids', { A: 1 });
      schreibeArt(t.guter, 'kaputt');
      const hash = await t.schreibeDatei(eintraege('Holzaxt'));
      const { wache } = t.starte();
      wache.tick();
      check('receipt {A:1}', JSON.stringify(t.quittung()?.gehalten) === '{"A":1}' && t.quittung()?.status === 'bestaetigung-noetig', JSON.stringify(t.quittung()));
      t.halt.B = 4; // another unknown name shows up after the receipt
      await t.bestaetige(hash);
      wache.tick();
      check('confirmation with the old receipt does NOT cover B: new receipt {A:1,B:4}, nothing removed', t.quittung()?.status === 'bestaetigung-noetig' && JSON.stringify(t.quittung()?.gehalten) === '{"A":1,"B":4}' && t.entfernt.length === 0 && t.halt.A === 1 && t.halt.B === 4, JSON.stringify(t.quittung()));
      await t.bestaetige(hash);
      wache.tick();
      check('the second confirmation removes exactly A and B', t.entfernt.length === 1 && t.entfernt[0].join() === 'A,B' && t.quittung()?.status === 'angewendet', `${JSON.stringify(t.entfernt)} ${t.quittung()?.status}`);

      // M4: a confirmation covers only the hash of its receipt, also when the file changed in the same tick.
      const u = umgebung('f6-hash', { A: 1 });
      schreibeArt(u.guter, '0-byte');
      await u.schreibeDatei(eintraege('Holzaxt'));
      const { wache: w2 } = u.starte();
      w2.tick();
      check('receipt for the first state {A:1}', u.quittung()?.status === 'bestaetigung-noetig' && u.entfernt.length === 0);
      const hash2 = await u.schreibeDatei(eintraege('Holzaxt', 'Steinaxt')); // file changes ...
      await u.bestaetige(hash2); // ... and a confirmation for the NEW hash arrives before the watch has seen it
      w2.tick();
      check('no receipt stood for the new hash: bestaetigung-noetig for it, nothing removed', u.quittung()?.status === 'bestaetigung-noetig' && u.quittung()?.hash === hash2 && u.entfernt.length === 0 && u.halt.A === 1, JSON.stringify(u.quittung()));
      await u.bestaetige(hash2);
      w2.tick();
      check('now the receipt of this hash stands: the confirmation removes A', u.entfernt.length === 1 && u.entfernt[0].join() === 'A' && u.quittung()?.status === 'angewendet', `${JSON.stringify(u.entfernt)} ${u.quittung()?.status}`);
      check('last good state written after that', existsSync(u.guter) && leseGegenstandsDatei(readFileSync(u.guter, 'utf-8')).eintraege.length === 2);
    }
  } finally {
    setzeUnbekannteVerwahren(false);
    wendeGegenstandsDatenAn([]);
    rmSync(DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
