/**
 * Items from data, N1 (card G2, review of PR #176): F2 the confirmation covers only what the receipt showed;
 * F3 `Inventory.rebind` splits a stack over the new maximum.
 * Gegenstandsdaten N1: F2 Bestätigung nur für die quittierten ids und den Hash; F3 rebind mit Überstapel.
 *
 *  [F2a] The probe of the review: file removes Holzaxt and Steinaxt; at the receipt only Holzaxt is held; then 7 Steinaxt
 *        appear; the confirmation (hash of the receipt) does NOT delete them: new receipt with both, nothing removed.
 *  [F2b] More copies of the SAME confirmed id are removed too (Mike: "endgültig entfernen").
 *  [F2c] A confirmation without a receipt of this run (restart) does not apply: new receipt.
 *  [F3]  Stack 8, new maximum 1: split onto free slots (8 stacks of 1); no free slot: the excess stays, console.warn.
 *
 * Run: npx tsx server/test/gegenstaende-g2-n1.ts   (from the repo root)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inventory, findItem } from '@wov/shared';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { GegenstandsWache, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-n1');
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

/** A watch with fake holdings; `halt` is what inventories, chests and saved players "hold". */
function baue(name: string, angewendet: GegenstandsEintrag[], halt: Record<string, number>) {
  const dir = resolve(DIR, name);
  mkdirSync(dir, { recursive: true });
  const pfad = resolve(dir, 'gegenstaende.json');
  wendeGegenstandsDatenAn(angewendet);
  const entfernt: string[][] = [];
  const wache = new GegenstandsWache({
    pfad, quittungsPfad: gegenstandsQuittungsDatei(pfad), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad),
    angewendet,
    gehalten: (ids) => Object.fromEntries([...ids].filter((i) => (halt[i] ?? 0) > 0).map((i) => [i, halt[i]])),
    entfernen: (ids) => { entfernt.push([...ids].sort()); for (const i of ids) delete halt[i]; },
    neuBinden: () => undefined, log: stumm,
  });
  const schreibe = async (e: GegenstandsEintrag[]): Promise<string> => {
    const text = schreibeGegenstandsDatei(e);
    writeFileSync(pfad, text);
    await warte(30);
    return layoutHash(Buffer.from(text));
  };
  const quittung = (): GegenstandsQuittung | null => {
    try { return JSON.parse(readFileSync(gegenstandsQuittungsDatei(pfad), 'utf-8')) as GegenstandsQuittung; } catch { return null; }
  };
  const bestaetige = async (hash: string): Promise<void> => { bestaetigenAnfrageSchreiben(gegenstandsBestaetigenDatei(pfad), hash); await warte(30); };
  return { wache, halt, entfernt, schreibe, quittung, bestaetige, pfad };
}

function main(): Promise<void> {
  return (async () => {
    try {
      console.log('\n[F2a] the probe of the review: 7 Steinaxt appear between receipt and confirmation');
      {
        const t = baue('f2a', eintraege('Holzaxt', 'Steinaxt', 'Rest'), { Holzaxt: 1 });
        const hash = await t.schreibe(eintraege('Rest'));
        t.wache.tick();
        check('receipt bestaetigung-noetig, gehalten = {Holzaxt: 1}', t.quittung()?.status === 'bestaetigung-noetig' && JSON.stringify(t.quittung()?.gehalten) === '{"Holzaxt":1}', JSON.stringify(t.quittung()));
        t.halt.Steinaxt = 7;
        await t.bestaetige(hash);
        t.wache.tick();
        const q = t.quittung();
        check('the confirmation does NOT apply: nothing removed, the 7 Steinaxt stay', t.entfernt.length === 0 && t.halt.Steinaxt === 7 && t.halt.Holzaxt === 1);
        check('new receipt bestaetigung-noetig now naming both ids', q?.status === 'bestaetigung-noetig' && q.gehalten?.Holzaxt === 1 && q.gehalten?.Steinaxt === 7, JSON.stringify(q));
        check('the definitions of both are still known (nothing applied)', findItem('Steinaxt') !== undefined && findItem('Holzaxt') !== undefined);
        await t.bestaetige(hash);
        t.wache.tick();
        check('a second confirmation (now the receipt showed both ids) applies and removes both', t.entfernt.length === 1 && t.entfernt[0].join() === 'Holzaxt,Steinaxt' && t.quittung()?.status === 'angewendet', JSON.stringify(t.entfernt));
      }

      console.log('\n[F2b] more copies of the SAME confirmed id are removed too');
      {
        const t = baue('f2b', eintraege('Holzaxt', 'Rest'), { Holzaxt: 1 });
        const hash = await t.schreibe(eintraege('Rest'));
        t.wache.tick();
        t.halt.Holzaxt = 5;
        await t.bestaetige(hash);
        t.wache.tick();
        check('applied although the count rose 1 -> 5 (same id): removed, receipt angewendet', t.entfernt.length === 1 && t.entfernt[0].join() === 'Holzaxt' && t.halt.Holzaxt === undefined && t.quittung()?.status === 'angewendet', JSON.stringify(t.quittung()));
      }

      console.log('\n[F2c] a confirmation without a receipt of this run does not apply');
      {
        const t = baue('f2c', eintraege('Holzaxt', 'Rest'), { Holzaxt: 2 });
        const hash = await t.schreibe(eintraege('Rest'));
        await t.bestaetige(hash);
        t.wache.tick();
        check('nothing removed, receipt bestaetigung-noetig (gehalten Holzaxt 2)', t.entfernt.length === 0 && t.quittung()?.status === 'bestaetigung-noetig' && t.quittung()?.gehalten?.Holzaxt === 2, JSON.stringify(t.quittung()));
      }

      console.log('\n[F3] rebind with an over-stack');
      {
        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 8 })));
        const inv = new Inventory();
        inv.addItem(findItem('Stapelaxt')!, 8);
        check('setup: one stack of 8, maximum 8', inv.all.length === 1 && inv.all[0].stack === 8 && findItem('Stapelaxt')!.maxStackSize === 8);
        wendeGegenstandsDatenAn(eintraege('Stapelaxt'));
        inv.rebind();
        check('maximum now 1: 8 stacks of 1, count 8 (nothing lost)', inv.all.length === 8 && inv.all.every((s) => s.stack === 1) && inv.countOf('Stapelaxt') === 8, `${inv.all.length} stacks, ${inv.countOf('Stapelaxt')} items`);
        check('all stacks on distinct slots', new Set(inv.all.map((s) => `${s.gridX},${s.gridY}`)).size === 8);

        wendeGegenstandsDatenAn(eintraege('Stapelaxt').map((e) => ({ ...e, stapel: 8 })));
        const voll = new Inventory();
        voll.addItem(findItem('Stapelaxt')!, 8);
        voll.addItem(findItem('Wood')!, 100000);
        const platz = voll.width * voll.height - voll.all.length;
        check('setup: inventory full', platz === 0, String(platz));
        wendeGegenstandsDatenAn(eintraege('Stapelaxt'));
        const warnungen: string[] = [];
        const alt = console.warn;
        console.warn = (...a: unknown[]) => { warnungen.push(a.join(' ')); };
        try { voll.rebind(); } finally { console.warn = alt; }
        check('no free slot: the excess stays (8 items, no loss), one console.warn', voll.countOf('Stapelaxt') === 8 && voll.all.filter((s) => s.shared.name === 'Stapelaxt').length === 1 && warnungen.length === 1 && warnungen[0].includes('Stapelaxt'), `${warnungen.length} warn`);
      }
    } finally {
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
