/**
 * Entfernte Vegetation V1, Editor-Seite: `weltdokument.ts` (Vergleich, `enthaelt`, Import) und der Testflug-Schutz F1
 * (`entwurfSpeichern.ts`) kennen `vegetationEntfernt`.
 * Removed vegetation V1, editor side: comparison, `enthaelt`, import and the F1 save guard know the field.
 *
 *  1. `enthaelt`: ein Stand mit Kreisen wird nur von einem Stand enthalten, der sie hat; ohne Kreise ändert sich nichts.
 *  2. `vergleiche`: ein Kreis, den der Server hat und der Entwurf nicht, ist `schwer`; Hinzufügen und Umsortieren nicht.
 *  3. `gleich`/`kanon`: Dokumente, die sich nur in den Kreisen unterscheiden, sind verschieden (Entwurfsvergleich).
 *  4. `importPruefen`: eine beschädigte Liste wird mit Meldung abgelehnt, nicht ohne die schlechten Einträge importiert.
 *  5. F1 (`entwurfSpeichern`): ein Entwurf mit kaputtem Kreis wird nicht gesendet (`verworfen`, Feld vegetationEntfernt).
 *
 * DOM-frei, ohne Browser/Assets/GPU (KERN-Bedingung).
 *
 * Lauf:  npx tsx client/test/vegetation-entfernt-dokument.ts
 */
import { enthaelt, gleich, importPruefen, vergleiche, type Unterschied } from '../src/editor/weltdokument';
import { entwurfSpeichern, verworfenePruefen } from '../src/editor/testflug/entwurfSpeichern';
import type { VegetationEntferntKreis, WorldLayout } from '@wov/shared';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const REGION = { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 };
function dok(kreise?: unknown): WorldLayout {
  return {
    version: 1,
    name: 'Vegetation-Dokument-Test',
    detailSeed: 'x',
    continents: [],
    regions: [REGION],
    ...(kreise !== undefined ? { vegetationEntfernt: kreise } : {}),
  } as unknown as WorldLayout;
}
const A: VegetationEntferntKreis = { x: 10, z: 10, r: 5 };
const B: VegetationEntferntKreis = { x: -40, z: 20, r: 12, nur: 'baeume' };
const zeile = (u: readonly Unterschied[]): Extract<Unterschied, { art: 'zeile' }> | undefined =>
  u.find((z): z is Extract<Unterschied, { art: 'zeile' }> => z.art === 'zeile' && z.feld === 'Entfernte Vegetation (Kreise)');

console.log('== 1 enthaelt');
check('Stand ohne Kreise wird von jedem enthalten (Verhalten wie vorher)', enthaelt(dok([A]), dok()) && enthaelt(dok(), dok()));
check('Stand mit Kreis wird vom gleichen Stand enthalten', enthaelt(dok([A, B]), dok([A])) && enthaelt(dok([A, B]), dok([B, A])));
check('Stand mit Kreis wird von einem Stand OHNE den Kreis nicht enthalten', !enthaelt(dok(), dok([A])) && !enthaelt(dok([B]), dok([A])));
check('ein veränderter Kreis zählt als anderer Kreis', !enthaelt(dok([{ ...A, r: 6 }]), dok([A])) && !enthaelt(dok([{ ...B, nur: undefined }]), dok([B])));
check('Multimenge: [A] enthält [A, A] nicht', !enthaelt(dok([A]), dok([A, A])));

console.log('== 2 vergleiche');
check('gleiche Kreise: keine Zeile', zeile(vergleiche(dok([A, B]), dok([B, A]))) === undefined);
check('ohne Kreise auf beiden Seiten: keine Zeile', zeile(vergleiche(dok(), dok())) === undefined);
{
  const z = zeile(vergleiche(dok([A, B]), dok([A])));
  check('Server hat einen Kreis mehr: Zeile "2 → 1", schwer', z?.server === '2' && z.entwurf === '1' && z.schwer === true, JSON.stringify(z));
}
{
  const z = zeile(vergleiche(dok([A]), dok([A, B])));
  check('Entwurf hat einen Kreis mehr: Zeile "1 → 2", NICHT schwer', z?.server === '1' && z.entwurf === '2' && z.schwer === false, JSON.stringify(z));
}
{
  const z = zeile(vergleiche(dok([A]), dok([B])));
  check('Kreis ersetzt (gleiche Zahl): schwer — der Server-Kreis fehlt', z?.server === '1' && z.entwurf === '1' && z.schwer === true, JSON.stringify(z));
}

console.log('== 3 gleich');
check('Dokumente, die sich nur in den Kreisen unterscheiden, sind verschieden', !gleich(dok([A]), dok()) && !gleich(dok([A]), dok([B])) && !gleich(dok([A]), dok([{ ...A, x: 11 }])));
check('gleiche Kreise: gleich; leere Liste = fehlendes Feld', gleich(dok([A, B]), dok([A, B])) && gleich(dok([]), dok()));

console.log('== 4 importPruefen');
{
  const gut = importPruefen(JSON.stringify(dok([A, B])), 'de');
  check('gültiger Import trägt die Kreise', gut.layout?.vegetationEntfernt?.length === 2);
  const schlecht = importPruefen(JSON.stringify(dok([A, { x: 1, z: 1, r: 99 }])), 'de');
  check('beschädigte Liste: Import abgelehnt, mit Meldung (deutsch)', schlecht.layout === null && /vegetationEntfernt/.test(schlecht.message ?? '') && /nichts importiert/.test(schlecht.message ?? ''), schlecht.message);
  const en = importPruefen(JSON.stringify(dok('kaputt')), 'en');
  check('Feld kein Array: abgelehnt, Meldung englisch', en.layout === null && /nothing imported/.test(en.message ?? ''), en.message);
  const zuViele = importPruefen(JSON.stringify(dok(Array.from({ length: 4097 }, (_, i) => ({ x: i, z: 0, r: 1 })))), 'de');
  check('4097 Kreise: abgelehnt (Grenze)', zuViele.layout === null && /4096/.test(zuViele.message ?? ''), zuViele.message);
}

console.log('== 5 F1 (entwurfSpeichern)');
{
  const roh = dok([A, { x: 1, z: 1, r: 500 }, { x: 'a', z: 1, r: 5 }]) as unknown as object;
  const teile = verworfenePruefen(roh, { ...dok([A]) } as object, 0);
  check('verworfenePruefen zählt die beiden kaputten Kreise', teile.length === 1 && teile[0]!.feld === 'vegetationEntfernt' && teile[0]!.anzahl === 2, JSON.stringify(teile));
  let gesendet = 0;
  const e = await entwurfSpeichern({
    laden: () => roh,
    speichern: async () => {
      gesendet++;
      return { art: 'ok' } as never;
    },
  } as never);
  check('Speichern wird angehalten: art verworfen, Feld vegetationEntfernt, NICHTS gesendet', e.art === 'verworfen' && e.teile.some((t) => t.feld === 'vegetationEntfernt') && gesendet === 0, JSON.stringify(e));
  const nichtListe = await entwurfSpeichern({ laden: () => dok('kaputt') as unknown as object, speichern: async () => ({ art: 'ok' }) as never } as never);
  check('Feld kein Array: verworfen mit keineListe', nichtListe.art === 'verworfen' && nichtListe.teile.some((t) => t.feld === 'vegetationEntfernt' && t.keineListe === true), JSON.stringify(nichtListe));
  let gesendet2 = 0;
  let inhalt: unknown = null;
  const gut = await entwurfSpeichern({
    laden: () => dok([A, B]) as unknown as object,
    speichern: async (d: object) => {
      gesendet2++;
      inhalt = (d as { vegetationEntfernt?: unknown }).vegetationEntfernt;
      return { art: 'ok' } as never;
    },
  } as never);
  check('gültiger Entwurf mit Kreisen wird gesendet, mit den Kreisen', gut.art === 'antwort' && gesendet2 === 1 && JSON.stringify(inhalt) === JSON.stringify([A, B]), JSON.stringify(inhalt));
}

if (fehler > 0) {
  console.error(`\n${fehler} FAILED`);
  process.exit(1);
}
console.log('\nAll vegetation-entfernt-dokument checks passed.');
