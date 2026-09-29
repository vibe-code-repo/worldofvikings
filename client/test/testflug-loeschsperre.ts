/**
 * Test flight shows the deletion-lock hint (Auflage C2, Angriff #120): a receipt of the operations service that
 * carries `loeschsperre` ({anzahl, hash}) makes the flight say — on the HUD line — that deletions are held back,
 * how many, and that they are confirmed in the map editor. Both ways: the PATCH per gesture (`OpsPersistenz`)
 * and the publish (`LocalStoragePersistenz.speichern`). No receipt field, no hint.
 *
 *   npx tsx test/testflug-loeschsperre.ts      (from client/)
 *
 * The 202 bodies come from the REAL composition of the operations service (`anwendungAnhaengen` of
 * `admin/src/routen/anwendung.ts`, receipt file on disk), not from hand-made stand-ins: the service appends its own
 * (technical) hold-back sentence, the flight must show exactly ONE, its own.
 *
 * DOM-free: `fetch` is handed in / stubbed, `localStorage` is a small map.
 */
import { opsSender } from '../src/editor/testflug/OpsPersistenz';
import { antwortText, speicherText } from '../src/editor/testflug/TestflugPersistenz';
import { localStoragePersistenz } from '../src/editor/testflug/LocalStoragePersistenz';
import { STAND_KEY } from '../src/editor/weltdokument';
import { quittungSchreiben } from '@wov/shared/src/worldlayout/quittung.js';
import { anwendungAnhaengen } from '../../admin/src/routen/anwendung.js';
import { ohneDienstSperrsatz } from '../src/editor/weltdokument';
import { mkdirSync, rmSync } from 'node:fs';
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
async function speichern(status: number, body: unknown): Promise<string> {
  speicher.set(STAND_KEY, JSON.stringify({ basis: 'a'.repeat(64) }));
  const saved = globalThis.fetch;
  globalThis.fetch = antwortMit(status, body) as unknown as typeof fetch;
  try {
    return speicherText(await localStoragePersistenz().speichern({ version: 1, placements: [] }));
  } finally {
    globalThis.fetch = saved;
  }
}

const speichern202 = (daten: Record<string, unknown>): Promise<string> => speichern(202, { ok: true, ...daten });

const TEMP = `/var/tmp/editor-loeschsperre-n1-${process.pid}`;
mkdirSync(TEMP, { recursive: true });
const HASH = 'a'.repeat(64);
const SPERRE = { anzahl: 7, hash: 'b'.repeat(64) };
/** What the real service answers for a write whose receipt says `nicht-angewendet` (or `angewendet`). */
async function dienst(
  grund: string | null,
  sperre: { anzahl: number; hash: string; kaputt?: boolean } | undefined,
  sprache: string | undefined,
  code = 200
): Promise<{ code: number; daten: Record<string, unknown> }> {
  const q = `${TEMP}/quittung.json`;
  quittungSchreiben(q, {
    hash: HASH,
    ergebnis: grund ? 'nicht-angewendet' : 'angewendet',
    grund: grund as never,
    ...(sperre ? { loeschsperre: sperre } : {}),
    zaehler: {},
    zeit: new Date().toISOString(),
  } as never);
  if (sprache === undefined) delete process.env.WOV_LANGUAGE;
  else process.env.WOV_LANGUAGE = sprache;
  const r = await anwendungAnhaengen({ code, daten: { ok: true, hash: HASH, message: 'Gespeichert' } }, { quittungsPfad: q, dienstAktiv: async () => true, warteMs: 300 });
  return { code: r.code, daten: r.daten as Record<string, unknown> };
}

const ANY = /zurückgehalten|held back|gesperrt|locked|Löschung|deletion|bestaetigen|welt\/best/i;
const sprachen: Array<['de' | 'en', RegExp, RegExp, RegExp]> = [
  ['de', /7 Löschung\(en\) zurückgehalten/g, /Karteneditor bestätigen/, /zurückgehalten|gesperrt/g],
  ['en', /7 deletion\(s\) held back/g, /confirm them in the map editor/, /held back|locked/g],
];

for (const [sprache, zahl, ort, jede] of sprachen) {
  speicher.set('wov-language', sprache);
  console.log(`Sprache ${sprache}`);
  const einmal = (s: string | null): boolean => !!s && (s.match(zahl) ?? []).length === 1 && (s.match(jede) ?? []).length === 1;
  const sauber = (s: string | null): boolean => !!s && !/POST \/api\/welt|bestaetigen/.test(s);

  // PATCH 202 against the real composition: every reason x the service's language (the client cannot know it).
  for (const dienstSprache of ['de', 'en', undefined]) {
    for (const grund of ['geo', 'abgelehnt', 'bestaetigung-noetig']) {
      const r = await dienst(grund, SPERRE, dienstSprache);
      const wie = `${grund}, Dienst ${dienstSprache ?? '(unset)'}`;
      check(`echte Form: 202 (${wie})`, r.code === 202 && r.daten.grund === grund);
      const o = await ops(202, { ok: true, ...r.daten });
      check(`PATCH 202 (${wie}): Sperrsatz genau einmal`, einmal(o), String(o));
      check(`PATCH 202 (${wie}): eigener Satz (Karteneditor)`, !!o && ort.test(o));
      check(`PATCH 202 (${wie}): kein "POST /api/welt"`, sauber(o), String(o));
      check(`PATCH 202 (${wie}): Grund bleibt`, !!o && o.includes(grund));
      if (grund !== 'bestaetigung-noetig') check(`PATCH 202 (${wie}): Trennzeichen vor dem Sperrsatz`, !!o && /\S · \d+ /.test(o), String(o));
      const s = await speichern202(r.daten);
      check(`Speichern 202 (${wie}): Sperrsatz genau einmal`, einmal(s), s);
      check(`Speichern 202 (${wie}): kein "POST /api/welt"`, sauber(s), s);
    }
  }
  // Mixed languages in the message: only the verbatim service sentence goes, anything else stays.
  check('fremder Text mit Sperr-Worten bleibt', ohneDienstSperrsatz('x 7 Objekt(e) sind dauerhaft gesperrt; y', 7) === 'x 7 Objekt(e) sind dauerhaft gesperrt; y');
  check('Zahl weicht ab: Satz bleibt', ohneDienstSperrsatz('A. ' + (await dienst('geo', { anzahl: 3, hash: 'h' }, 'de')).daten.message, 7).includes('3 Objekt(e)'));
  check('Anzahl 0: Nachricht unverändert', ohneDienstSperrsatz('abc', 0) === 'abc');

  // 200 and no lock.
  const o200 = await ops(200, { ok: true, angewendet: true, ...(await dienst(null, SPERRE, 'de')).daten });
  check('PATCH 200 mit Sperre: genau einmal', einmal(o200), String(o200));
  check('PATCH 200 mit Sperre: Ort (Karteneditor)', !!o200 && ort.test(o200));
  check('PATCH 200 mit Sperre: Trennzeichen', !!o200 && /Gespeichert · 7 /.test(o200));
  const ohne = await ops(200, { ok: true, angewendet: true });
  check('PATCH 200 ohne Sperre: keine Sperr-Meldung', !!ohne && !ANY.test(ohne), String(ohne));
  const s200 = await speichern(200, (await dienst(null, SPERRE, 'de')).daten);
  check('Speichern 200 mit Sperre: genau einmal', einmal(s200), s200);
  check('Speichern 200 mit Sperre: Ort + Trennzeichen', ort.test(s200) && /\S · 7 /.test(s200), s200);
  const sOhne = await speichern(200, { ok: true, message: 'Gespeichert', angewendet: true });
  check('Speichern ohne Sperre: keine Sperr-Meldung', !ANY.test(sOhne), sOhne);

  // Count 0 and a broken lock file: the real service leaves the field out; a stand-in with the field says nothing either.
  for (const [name, sperre] of [['Anzahl 0', { anzahl: 0, hash: 'c' }], ['kaputt', { anzahl: 5, hash: 'c', kaputt: true }]] as const) {
    for (const grund of [null, 'geo', 'abgelehnt']) {
      const r = await dienst(grund, sperre, sprache);
      check(`echte Antwort (${name}, ${grund ?? 'angewendet'}) ohne Sperrfeld`, r.daten.loeschsperre === undefined);
      const o = await ops(r.code, { ok: true, ...r.daten });
      check(`PATCH ${name} (${grund ?? 'angewendet'}): kein Sperrhinweis`, !/zurückgehalten|held back|Löschung|deletion/.test(o ?? ''), String(o));
      const s = await speichern(r.code, r.daten);
      check(`Speichern ${name} (${grund ?? 'angewendet'}): kein Sperrhinweis`, !/zurückgehalten|held back|Löschung|deletion/.test(s), s);
    }
  }
  const z0 = await ops(200, { ok: true, loeschsperre: { anzahl: 0, hash: 'c' } });
  check('PATCH 200 mit Feld Anzahl 0: kein Hinweis irgendeiner Art', !!z0 && !ANY.test(z0), String(z0));
  const z0s = await speichern(200, { ok: true, message: 'Gespeichert', loeschsperre: { anzahl: 0, hash: 'c' } });
  check('Speichern mit Feld Anzahl 0: kein Hinweis irgendeiner Art', !ANY.test(z0s), z0s);
  const zk = await speichern(200, { ok: true, message: 'Gespeichert', loeschsperre: { anzahl: 'x', hash: 'c' } });
  check('Speichern mit Anzahl "x": kein Hinweis irgendeiner Art', !ANY.test(zk), zk);
}
speicher.delete('wov-language');
delete process.env.WOV_LANGUAGE;
rmSync(TEMP, { recursive: true, force: true });
console.log(fehler === 0 ? 'ALLE GRÜN' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
