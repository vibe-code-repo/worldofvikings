/**
 * Test flight shows the deletion-lock hint (Auflage C2, Angriff #120): a receipt of the operations service that
 * carries `loeschsperre` ({anzahl, hash}) makes the flight say — on the HUD line — that deletions are held back,
 * how many, and that they are confirmed in the map editor. Both ways: the PATCH per gesture (`OpsPersistenz`)
 * and the publish (`LocalStoragePersistenz.speichern`). No receipt field, no hint.
 *
 *   npx tsx test/testflug-loeschsperre.ts      (from client/)
 *
 * DOM-free: `fetch` is handed in / stubbed, `localStorage` is a small map.
 */
import { opsSender } from '../src/editor/testflug/OpsPersistenz';
import { antwortText, speicherText } from '../src/editor/testflug/TestflugPersistenz';
import { localStoragePersistenz } from '../src/editor/testflug/LocalStoragePersistenz';
import { STAND_KEY } from '../src/editor/weltdokument';
import type { Vorgang } from '@wov/shared/src/worldlayout/ops.js';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const speicher = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => void speicher.set(k, v),
  removeItem: (k: string) => void speicher.delete(k),
};

const antwortMit = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
const vorgang: Vorgang = { ops: [{ sammlung: 'placements', art: 'entferne', id: 'a', vorher: { prefab: 'Beech1', x: 1, z: 1 } }] } as unknown as Vorgang;

async function ops(status: number, body: unknown): Promise<string | null> {
  return antwortText(await opsSender(antwortMit(status, body) as unknown as typeof fetch)(vorgang));
}
async function speichern(body: unknown): Promise<string> {
  speicher.set(STAND_KEY, JSON.stringify({ basis: 'a'.repeat(64) }));
  const saved = globalThis.fetch;
  globalThis.fetch = antwortMit(200, body) as unknown as typeof fetch;
  try {
    return speicherText(await localStoragePersistenz().speichern({ version: 1, placements: [] }));
  } finally {
    globalThis.fetch = saved;
  }
}

const SPERRE = { anzahl: 7, hash: 'b'.repeat(64) };
const sprachen: Array<['de' | 'en', RegExp, RegExp]> = [
  ['de', /7 Löschung\(en\) zurückgehalten/, /Karteneditor bestätigen/],
  ['en', /7 deletion\(s\) held back/, /confirm them in the map editor/],
];

for (const [sprache, zahl, ort] of sprachen) {
  speicher.set('wov-language', sprache);
  console.log(`Sprache ${sprache}`);
  const o200 = await ops(200, { ok: true, angewendet: true, loeschsperre: SPERRE });
  check('PATCH 200 mit Sperre: Zahl', !!o200 && zahl.test(o200), String(o200));
  check('PATCH 200 mit Sperre: Ort (Karteneditor)', !!o200 && ort.test(o200));
  const o202 = await ops(202, { ok: true, grund: 'geo', message: 'x', loeschsperre: SPERRE });
  check('PATCH 202 mit Sperre: Zahl + Grund bleibt', !!o202 && zahl.test(o202) && o202.includes('geo'), String(o202));
  const ohne = await ops(200, { ok: true, angewendet: true });
  check('PATCH 200 ohne Sperre: keine Sperr-Meldung', !!ohne && !zahl.test(ohne) && !ort.test(ohne), String(ohne));
  const leer = await ops(200, { ok: true, loeschsperre: { anzahl: 0, hash: 'c' } });
  check('PATCH 200 mit Anzahl 0: keine Sperr-Meldung', !!leer && !zahl.test(leer));
  const s = await speichern({ ok: true, message: 'Gespeichert', angewendet: true, loeschsperre: SPERRE });
  check('Speichern mit Sperre: Zahl', zahl.test(s), s);
  check('Speichern mit Sperre: Ort (Karteneditor)', ort.test(s));
  const sOhne = await speichern({ ok: true, message: 'Gespeichert', angewendet: true });
  check('Speichern ohne Sperre: keine Sperr-Meldung', !zahl.test(sOhne) && !ort.test(sOhne), sOhne);
}
speicher.delete('wov-language');
console.log(fehler === 0 ? 'ALLE GRÜN' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
