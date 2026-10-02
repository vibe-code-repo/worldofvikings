/**
 * Bäume entfernen V2 N3: Der Speicherweg des Testflugs (`localStoragePersistenz().speichern`) zeigt den Vegetationshinweis
 * der Quittung wie der Editor (`weltdokument.ts`), mit denselben Texten.
 * Removed vegetation V2 N3: the flight's save path shows the receipt's vegetation hint like the editor.
 *
 * DOM-frei: `localStorage` und `fetch` sind Attrappen.
 *
 * Lauf: npx tsx client/test/testflug-vegetation-hinweis.ts   (aus der Projektwurzel)
 */
import { sanitizeWorldLayout } from '@wov/shared';
import { STAND_KEY } from '../src/editor/weltdokument';
import { localStoragePersistenz } from '../src/editor/testflug/LocalStoragePersistenz';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fehler++;
}
const HASH = 'a'.repeat(64);
const speicher = new Map<string, string>([[STAND_KEY, JSON.stringify({ zeit: '2026-10-02T00:00:00Z', basis: 'b'.repeat(64) })]]);
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => void speicher.set(k, v),
  removeItem: (k: string) => void speicher.delete(k),
} as unknown as Storage;
const antwort = (rumpf: unknown): void => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => new Response(JSON.stringify(rumpf), { status: 200 })) as typeof fetch;
};
const layout = sanitizeWorldLayout({ version: 1, name: 'x', detailSeed: 'v', continents: [], regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 10, baseLevel: 0.3 }] })!;

console.log('=== testflug-vegetation-hinweis ===');
{
  antwort({ ok: true, message: 'Gespeichert', hash: HASH, angewendet: true, zaehler: { vegetationAbgelehnt: 2, vegetationAbgelehntObjekte: 31000 } });
  const r = await localStoragePersistenz().speichern(layout as never);
  check('Testflug-Speichern nennt die abgelehnten Kreise (gleicher Text wie der Editor)', r.ok === true && /Vegetation nicht geräumt: 2 Kreis\(e\) mit 31000 Objekten/.test(r.message), r.message);
}
{
  antwort({ ok: true, message: 'Gespeichert', hash: HASH, angewendet: true, zaehler: { vegetationUngemarkt: 4, vegetationUngemarktZonen: 2 } });
  const r = await localStoragePersistenz().speichern(layout as never);
  check('… und den Hinweis auf Zonen ohne Marke', r.ok === true && /4 Objekt\(e\) in 2 Zone\(n\) ohne Herkunftsmarke nicht geräumt/.test(r.message), r.message);
}
{
  antwort({ ok: true, message: 'Gespeichert', hash: HASH, angewendet: true, zaehler: { vegetationGeloescht: 3 } });
  const r = await localStoragePersistenz().speichern(layout as never);
  check('ohne Befund: die Meldung bleibt unverändert', r.ok === true && r.message === 'Gespeichert', r.message);
}
if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
