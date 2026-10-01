/**
 * Items from data, N2 (card G2, remaining findings of the follow-up review of PR #176): N1-a a start without a usable
 * last good state must not let a held data item vanish; N1-c `Inventory.load` and opening a chest split an over-stack.
 * Gegenstandsdaten N2: N1-a kein brauchbarer letzter guter Stand; N1-c Überstapel beim Laden von Spieler und Truhe.
 *
 * Rule for N1-a: without a usable last good state (missing, 0 byte, broken) the start applies the file but does NOT write
 * the last good state and flags `ohneGutenStand`. The watch then counts what is HELD under a name that neither a
 * definition nor the file knows; any such name is a removal needing the confirmation (receipt `bestaetigung-noetig`),
 * and until then `Inventory.load` / `unpackContainer` keep unknown stacks raw (nothing is dropped at login or chest
 * opening). Only after the confirmation (or when nothing unknown is held) the last good state is written.
 *
 *  [A1-A3] Start, last good state broken / 0 byte / missing, valid file without the held Steinaxt.
 *  [A4]    A restart between receipt and confirmation changes nothing; a confirmation removes the copies.
 *  [A5]    Nothing unknown held: applied at once, last good state written.
 *  [A6]    Live watch with a valid baseline and a broken / empty / missing last good state: removal of a held id.
 *  [A7]    Kept stacks survive `load` -> `serialize` and a chest `unpack` -> `pack` while the switch is on, and are
 *          counted and removed by the stock functions.
 *  [C1]    Player load: stack 8, maximum now 3: 3+3+2 on free slots; no free slot: the excess stays, one warning.
 *  [C2]    Chest open: the same.
 *
 * Run: npx tsx server/test/gegenstaende-g2-n2.ts   (from the repo root)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem, packContainer, setzeUnbekannteVerwahren, unpackContainer } from '@wov/shared';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsLetzterGuterDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { entferneGehalten, zaehleGehalten, zaehleUnbekannteGehalten, type BestandsQuellen } from '../src/spiel/Gegenstandsbestand.js';
import { GegenstandsWache, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-n2');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const roh = (id: string, stapel = 1) => ({
  id,
  nameSchluessel: `inhalt.gegenstand.${id}.name`,
  typ: 'zweihaendigWaffe',
  slot: 'hand',
  modell: { upload: null, skala: 0.6 },
  stapel,
  gewicht: 2,
  werte: { damage: 10 },
  texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: id } },
});
const eintraege = (...ids: string[]): GegenstandsEintrag[] => {
  const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: ids.map((i) => roh(i)) }));
  if (l.dateiFehler || l.verworfen.length > 0) throw new Error('test data invalid');
  return l.eintraege;
};
const stumm = { log: () => undefined, warn: () => undefined, error: () => undefined };

type GuterArt = 'kaputt' | '0-byte' | 'fehlt';
const GUTER_ARTEN: GuterArt[] = ['kaputt', '0-byte', 'fehlt'];

/** A start like `main.ts` does it, with fake holdings (`halt` = names held in inventories, chests, saved players). */
function startUmgebung(name: string, guterArt: GuterArt, halt: Record<string, number>) {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  const pfad = resolve(dir, 'gegenstaende.json');
  const guter = gegenstandsLetzterGuterDatei(pfad);
  if (guterArt === 'kaputt') writeFileSync(guter, '{kaputt');
  else if (guterArt === '0-byte') writeFileSync(guter, '');
  const entfernt: string[][] = [];
  const verwahren: boolean[] = [];
  const schreibeDatei = async (e: GegenstandsEintrag[]): Promise<string> => {
    const text = schreibeGegenstandsDatei(e);
    writeFileSync(pfad, text);
    await warte(30);
    return layoutHash(Buffer.from(text));
  };
  const starte = () => {
    wendeGegenstandsDatenAn([]); // a fresh process
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
  const guterText = (): string | null => (existsSync(guter) ? readFileSync(guter, 'utf-8') : null);
  const bestaetige = async (hash: string): Promise<void> => { bestaetigenAnfrageSchreiben(gegenstandsBestaetigenDatei(pfad), hash); await warte(30); };
  return { pfad, guter, halt, entfernt, verwahren, schreibeDatei, starte, quittung, guterText, bestaetige };
}

function main(): Promise<void> {
  return (async () => {
    try {
      for (const art of GUTER_ARTEN) {
        console.log(`\n[A1-A4] start, last good state ${art}, valid file without the held Steinaxt (2 held)`);
        const t = startUmgebung(`a-${art}`, art, { Steinaxt: 2, Holzaxt: 1 });
        const hash = await t.schreibeDatei(eintraege('Holzaxt'));
        const vorher = t.guterText();
        let { stand, wache } = t.starte();
        check('the file is valid and applied; the start flags ohneGutenStand', stand.art === 'angewendet' && stand.ohneGutenStand === true, `${stand.art} ${stand.ohneGutenStand}`);
        check('the last good state is NOT overwritten by the start', t.guterText() === vorher, String(t.guterText()));
        check('the watch switches keeping of unknown stacks on at once', t.verwahren.join() === 'true', t.verwahren.join());
        wache.tick();
        let q = t.quittung();
        check('receipt bestaetigung-noetig, gehalten = {Steinaxt: 2}', q?.status === 'bestaetigung-noetig' && q.hash === hash && JSON.stringify(q.gehalten) === '{"Steinaxt":2}', JSON.stringify(q));
        check('the copies stay: nothing removed, 2 Steinaxt held, last good state still not written', t.entfernt.length === 0 && t.halt.Steinaxt === 2 && t.guterText() === vorher);

        ({ stand, wache } = t.starte()); // restart between receipt and confirmation
        check('restart: same flag, last good state still untouched', stand.ohneGutenStand === true && t.guterText() === vorher);
        wache.tick();
        q = t.quittung();
        check('restart: receipt bestaetigung-noetig again, copies stay', q?.status === 'bestaetigung-noetig' && t.halt.Steinaxt === 2 && t.entfernt.length === 0, JSON.stringify(q));
        await t.bestaetige(hash);
        wache.tick();
        check('confirmation with the receipt of this run: Steinaxt removed, receipt angewendet', t.entfernt.length === 1 && t.entfernt[0].join() === 'Steinaxt' && t.halt.Steinaxt === undefined && t.quittung()?.status === 'angewendet', JSON.stringify(t.quittung()));
        const g = t.guterText();
        check('now the last good state is written (1 entry Holzaxt) and keeping is switched off', g !== null && leseGegenstandsDatei(g).eintraege.map((e) => e.id).join() === 'Holzaxt' && t.verwahren.join() === 'true,false', `${g?.length} byte, ${t.verwahren.join()}`);
        ({ stand } = t.starte());
        check('next start has a usable last good state: no flag', stand.ohneGutenStand !== true);
      }

      console.log('\n[A5] nothing unknown held: applied at once, last good state written');
      {
        const t = startUmgebung('a5', 'kaputt', { Holzaxt: 1 });
        await t.schreibeDatei(eintraege('Holzaxt'));
        const { wache } = t.starte();
        wache.tick();
        check('receipt angewendet, nothing removed', t.quittung()?.status === 'angewendet' && t.entfernt.length === 0, JSON.stringify(t.quittung()));
        check('last good state written and valid', leseGegenstandsDatei(t.guterText() ?? '').eintraege.length === 1 && t.verwahren.join() === 'true,false');
      }

      console.log('\n[A5b] broken file, no last good state: later fixed file lacking a held item is checked too');
      {
        const t = startUmgebung('a5b', 'fehlt', { Steinaxt: 3 });
        writeFileSync(t.pfad, '{kaputt');
        const { stand, wache } = t.starte();
        check('start: file rejected, flag set', stand.art === 'abgelehnt' && stand.ohneGutenStand === true, `${stand.art}`);
        wache.tick();
        check('receipt abgelehnt, nothing removed', t.quittung()?.status === 'abgelehnt' && t.entfernt.length === 0);
        const hash = await t.schreibeDatei(eintraege('Holzaxt'));
        wache.tick();
        check('the fixed file lacks the held Steinaxt: receipt bestaetigung-noetig, copies stay', t.quittung()?.status === 'bestaetigung-noetig' && t.quittung()?.hash === hash && t.halt.Steinaxt === 3 && t.entfernt.length === 0, JSON.stringify(t.quittung()));
      }

      console.log('\n[A6] live watch with a valid baseline, last good state broken / 0 byte / missing');
      for (const art of GUTER_ARTEN) {
        const t = startUmgebung(`l-${art}`, art, { Steinaxt: 1 });
        await t.schreibeDatei(eintraege('Holzaxt', 'Steinaxt'));
        const vorher = t.guterText();
        // The state before (applied by a process that had a good state): baseline with both entries.
        wendeGegenstandsDatenAn(eintraege('Holzaxt', 'Steinaxt'));
        const wache = new GegenstandsWache({
          pfad: t.pfad, quittungsPfad: gegenstandsQuittungsDatei(t.pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(t.pfad),
          angewendet: eintraege('Holzaxt', 'Steinaxt'),
          gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (t.halt[i] ?? 0) > 0).map((i) => [i, t.halt[i]])),
          entfernen: (ids) => { t.entfernt.push([...ids]); },
          neuBinden: () => undefined, log: stumm,
        });
        const hash = await t.schreibeDatei(eintraege('Holzaxt'));
        wache.tick();
        const q = t.quittung();
        check(`${art}: removal of the held Steinaxt needs the confirmation, copy stays`, q?.status === 'bestaetigung-noetig' && q.hash === hash && t.entfernt.length === 0 && t.guterText() === vorher, JSON.stringify(q));
      }

      console.log('\n[A7] kept stacks: load/serialize, chest unpack/pack, count, remove');
      {
        wendeGegenstandsDatenAn([]);
        const gespeichert = [{ name: 'Steinaxt', stack: 2, durability: 5, quality: 1, gridX: 1, gridY: 0, equipped: false }];
        setzeUnbekannteVerwahren(false);
        const aus = new Inventory();
        aus.load(gespeichert);
        check('switch off: the unknown stack is dropped (old behaviour)', aus.all.length === 0 && aus.verwahrte.length === 0 && aus.serialize().length === 0);
        setzeUnbekannteVerwahren(true);
        try {
          const an = new Inventory();
          an.load(gespeichert);
          check('switch on: kept raw, not in `all`, written back by serialize', an.all.length === 0 && an.verwahrte.length === 1 && an.serialize().length === 1 && an.serialize()[0].name === 'Steinaxt' && an.serialize()[0].stack === 2);
          const truhe = unpackContainer('[["Steinaxt",4,0,1]]');
          check('switch on: a chest keeps the unknown tuple through unpack -> pack', truhe.verwahrte.length === 1 && packContainer(truhe) === '[["Steinaxt",4,0,1]]', packContainer(truhe));
          const q: BestandsQuellen = { online: () => [{ spielerId: 'x', name: 'Anna', inventar: an }], gespeichert: () => [], zdos: () => [] };
          check('unknown held counted (online kept stack)', JSON.stringify(zaehleUnbekannteGehalten(q, (n) => findItem(n) !== undefined)) === '{"Steinaxt":2}');
          check('zaehleGehalten counts the kept stack of an online player too', JSON.stringify(zaehleGehalten(q, new Set(['Steinaxt']))) === '{"Steinaxt":2}');
          const weg = entferneGehalten(q, new Set(['Steinaxt']), () => 1);
          check('entferneGehalten removes the kept stack', weg.lebend === 1 && an.verwahrte.length === 0 && an.serialize().length === 0);
        } finally {
          setzeUnbekannteVerwahren(false);
        }
      }

      console.log('\n[C1] player load with an over-stack (maximum 10 -> 3, saved 8)');
      {
        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 10 })));
        const quelle = new Inventory();
        quelle.addItem(findItem('Stapelaxt')!, 8);
        const gewichtVorher = quelle.totalWeight();
        const gespeichert = quelle.serialize();
        check('setup: one saved stack of 8', gespeichert.length === 1 && gespeichert[0].stack === 8);
        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 3 })));
        const inv = new Inventory();
        inv.load(gespeichert);
        const stapel = inv.all.map((s) => s.stack).sort((a, b) => b - a);
        check('free slots: 3+3+2, sum 8', stapel.join() === '3,3,2' && inv.countOf('Stapelaxt') === 8, stapel.join());
        check('weight unchanged', inv.totalWeight() === gewichtVorher, `${inv.totalWeight()} vs ${gewichtVorher}`);
        check('distinct slots, no duplicates (only the original stack may be equipped)', new Set(inv.all.map((s) => `${s.gridX},${s.gridY}`)).size === 3 && inv.all.filter((s) => s.equipped).length <= 1);

        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 10 })));
        const voll = new Inventory();
        voll.addItem(findItem('Stapelaxt')!, 8);
        voll.addItem(findItem('Wood')!, 100000);
        const holz = voll.countOf('Wood');
        check('setup: inventory full', voll.width * voll.height - voll.all.length === 0);
        const vollGespeichert = voll.serialize();
        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 3 })));
        const warnungen: string[] = [];
        const alt = console.warn;
        console.warn = (...a: unknown[]) => { warnungen.push(a.join(' ')); };
        const geladen = new Inventory();
        try { geladen.load(vollGespeichert); } finally { console.warn = alt; }
        check('no free slot: the excess stays (8 items, one stack), one warning, load keeps the wood', geladen.countOf('Stapelaxt') === 8 && geladen.all.filter((s) => s.shared.name === 'Stapelaxt').length === 1 && warnungen.length === 1 && warnungen[0].includes('load') && geladen.countOf('Wood') === holz, `${warnungen.length} warn`);
      }

      console.log('\n[C2] chest open with an over-stack');
      {
        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 3 })));
        const frei = unpackContainer('[["Stapelaxt",8,0,1]]');
        const stapel = frei.all.map((s) => s.stack).sort((a, b) => b - a);
        check('free slots: 3+3+2, sum 8', stapel.join() === '3,3,2' && frei.countOf('Stapelaxt') === 8, stapel.join());
        check('weight 16 = 8 x 2', frei.totalWeight() === 16);
        const tupel = ['["Stapelaxt",8,0,1]', ...Array.from({ length: 11 }, () => '["Wood",50,0,1]')].join(',');
        const warnungen: string[] = [];
        const alt = console.warn;
        console.warn = (...a: unknown[]) => { warnungen.push(a.join(' ')); };
        let voll: Inventory;
        try { voll = unpackContainer(`[${tupel}]`); } finally { console.warn = alt; }
        check('setup: chest full (12 stacks)', voll.all.length === 12 && voll.width * voll.height === 12, String(voll.all.length));
        check('no free slot: the excess stays (8 in one stack), one warning', voll.countOf('Stapelaxt') === 8 && voll.all.filter((s) => s.shared.name === 'Stapelaxt').length === 1 && warnungen.length === 1, `${warnungen.length} warn`);
      }
    } finally {
      setzeUnbekannteVerwahren(false);
      wendeGegenstandsDatenAn([]);
      rmSync(DIR, { recursive: true, force: true });
    }
  })();
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
