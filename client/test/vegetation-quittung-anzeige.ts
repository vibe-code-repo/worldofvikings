/**
 * Bäume entfernen V2 N2: Der Editor zeigt bei `angewendet` auch den Vegetationshinweis der Quittung.
 * Removed vegetation V2 N2: on `angewendet` the editor also shows the vegetation hint of the receipt.
 *
 * DOM-frei: `schreibeWeltdokument` mit einer Attrappe für fetch, `wirkungsText` (die Statuszeile des Editors).
 *
 * Lauf: npx tsx client/test/vegetation-quittung-anzeige.ts   (aus der Projektwurzel)
 */
import { sanitizeWorldLayout } from '@wov/shared';
import { schreibeWeltdokument, vegetationHinweis, wirkungsText } from '../src/editor/weltdokument';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fehler++;
}
const layout = sanitizeWorldLayout({ version: 1, name: 'x', detailSeed: 'v', continents: [], regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 10, baseLevel: 0.3 }] })!;
const fetchMit = (rumpf: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(rumpf), { status })) as typeof fetch;

console.log('=== vegetation-quittung-anzeige ===');
{
  const a = await schreibeWeltdokument(
    layout,
    'h1',
    fetchMit({ ok: true, message: 'Gespeichert', hash: 'h2', angewendet: true, detail: 'Vegetation nicht geräumt: 2 Kreis(e) …', zaehler: { vegetationAbgelehnt: 2, vegetationAbgelehntObjekte: 31000, vegetationGeloescht: 5 } })
  );
  const text = a.art === 'ok' ? wirkungsText(a) : '(kein ok)';
  check('angewendet + abgelehnte Kreise: „live angewendet“ UND „Vegetation nicht geräumt“ mit der Zahl der Kreise', /live angewendet/.test(text) && /Vegetation nicht geräumt: 2 Kreis\(e\) mit 31000 Objekten/.test(text), text);
}
{
  const a = await schreibeWeltdokument(layout, 'h1', fetchMit({ ok: true, message: 'Gespeichert', hash: 'h2', angewendet: true, zaehler: { vegetationUngemarkt: 7, vegetationUngemarktZonen: 3, vegetationGeloescht: 0 } }));
  const text = a.art === 'ok' ? wirkungsText(a) : '(kein ok)';
  check('angewendet + Zonen ohne Marke: der Hinweis nennt Objekte und Zonen', /live angewendet/.test(text) && /7 Objekt\(e\) in 3 Zone\(n\) ohne Herkunftsmarke nicht geräumt/.test(text), text);
}
{
  const a = await schreibeWeltdokument(layout, 'h1', fetchMit({ ok: true, message: 'Gespeichert', hash: 'h2', angewendet: true, zaehler: { vegetationGeloescht: 4, vegetationUngemarkt: 0 } }), 'en');
  const text = a.art === 'ok' ? wirkungsText(a) : '(kein ok)';
  check('nichts abgelehnt, nichts ungemarkt: keine Vegetationszeile', a.art === 'ok' && a.vegetationHinweis === null && /^ — live angewendet\.$/.test(text), text);
  const en = vegetationHinweis({ vegetationAbgelehnt: 1, vegetationAbgelehntObjekte: 9 }, 'en');
  check('englischer Text über den Katalog', en === 'Vegetation not cleared: 1 circle(s) with 9 objects over the limit — takes effect after the next restart.', String(en));
}
{
  const a = await schreibeWeltdokument(layout, 'h1', fetchMit({ ok: true, message: 'Gespeichert', hash: 'h2', angewendet: true, zaehler: { vegetationAbgelehnt: 1, vegetationAbgelehntObjekte: 20001, zurueck: 2 }, detail: 'ids' }));
  const text = a.art === 'ok' ? wirkungsText(a) : '(kein ok)';
  check('zusammen mit „zurückgehalten“: beide Sätze stehen da', /Neusetzen/.test(text) && /Vegetation nicht geräumt/.test(text), text);
}
{
  // N2-T3 (P6): der Hinweis steht auch neben einer offenen Löschsperre
  const a = await schreibeWeltdokument(layout, 'h1', fetchMit({ ok: true, message: 'Gespeichert', hash: 'h2', angewendet: true, loeschsperre: { anzahl: 2 }, zaehler: { vegetationAbgelehnt: 1, vegetationAbgelehntObjekte: 9 } }));
  const text = a.art === 'ok' ? wirkungsText(a) : '(kein ok)';
  check('mit offener Löschsperre: Sperrsatz UND Vegetationshinweis', a.art === 'ok' && !!a.sperrHinweis && text.includes(a.sperrHinweis.charAt(0).toLowerCase() + a.sperrHinweis.slice(1)) && /Vegetation nicht geräumt: 1 Kreis\(e\)/.test(text), text);
}
if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
