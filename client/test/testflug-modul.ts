/**
 * Guard for the offline-flight module (`client/src/editor/testflug/`).
 *
 * The flight used to be one 770-line block inside `main()`. It moved out
 * unchanged; what must stay true afterwards:
 *
 *  1. `main.ts` no longer builds any flight object (panel, route editor,
 *     route preview, vegetation preview, live plinth) and no longer touches
 *     the draft in `localStorage` — it only fills the context and calls the
 *     module once.
 *  2. The module reaches the draft only through the persistence seam, and
 *     `main()`'s reassigned state (`world`, `player`, `terrain`, `grass`,
 *     `sockelFreiflaechen`) only through getters — never as a copy taken at
 *     the start.
 *  3. The flight stays statically linked (it was before): no dynamic import.
 *  4. The localStorage implementation of the seam keeps the old wire
 *     behaviour: same key, same JSON, same endpoint.
 *  5. Loading the start draft keeps its rules (only with `layout=editor`,
 *     a broken entry means "no draft", a missing one warns).
 *
 * Source checks read the files as text; the logic checks run the real code
 * against a fake `localStorage` / `fetch`.
 *
 * Run: npx tsx client/test/testflug-modul.ts
 */
import { readFileSync } from 'node:fs';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};
const lies = (rel: string): string => {
  try {
    return readFileSync(new URL(rel, import.meta.url), 'utf-8');
  } catch {
    fehler++;
    console.error(`  FAIL: cannot read ${rel}`);
    return '';
  }
};
const anzahl = (text: string, muster: RegExp): number => (text.match(muster) ?? []).length;

console.log('Offline flight module');

const main = lies('../src/main.ts');
const testflug = lies('../src/editor/testflug/Testflug.ts');

// ── 1. main.ts only wires ───────────────────────────────────────────
{
  const zeilen = main.split('\n').length;
  pruefe(zeilen < 3700, `main.ts still has ${zeilen} lines (the flight block was ~770)`);
  for (const bauteil of ['SpawnPanel', 'RoutenEditor', 'RoutenVorschau', 'BewuchsVorschau']) {
    pruefe(!new RegExp(`\\b${bauteil}\\b`).test(main), `main.ts still mentions ${bauteil}`);
  }
  for (const name of ['leseEntwurf', 'bodenPunkt', 'alleNeuZeichnen']) {
    pruefe(!main.includes(name), `main.ts still defines/uses ${name}`);
  }
  pruefe(!main.includes('wov-editor-layout'), 'main.ts still touches the draft key');
  pruefe(anzahl(main, /\bstarteTestflug\(/g) === 1, 'main.ts must call starteTestflug exactly once');
  pruefe(anzahl(main, /\bladeTestflugEntwurf\(/g) === 1, 'main.ts must call ladeTestflugEntwurf exactly once');
}

// ── 2. module: persistence seam and getters ─────────────────────────
{
  pruefe(anzahl(testflug, /new SpawnPanel\(/g) === 1, 'Testflug.ts must build the SpawnPanel once');
  pruefe(anzahl(testflug, /new RoutenEditor\(/g) === 1, 'Testflug.ts must build the RoutenEditor once');
  pruefe(anzahl(testflug, /new RoutenVorschau\(/g) === 1, 'Testflug.ts must build the RoutenVorschau once');
  pruefe(anzahl(testflug, /new BewuchsVorschau\(/g) === 1, 'Testflug.ts must build the BewuchsVorschau once');
  pruefe(!/localStorage\s*[.[]/.test(testflug), 'Testflug.ts must not access localStorage directly');
  pruefe(!/\bfetch\(/.test(testflug), 'Testflug.ts must not call fetch directly');
  pruefe(anzahl(testflug, /persistenz\.laden\(\)/g) >= 5, 'draft reads must go through persistenz.laden()');
  // Since K5.3 the flight changes the draft by operations (TestflugAktionen -> persistenz.vorgang), never by writing it whole.
  pruefe(anzahl(testflug, /aktionen\.(setzen|verschieben|drehen|npcSetzen|loeschen)\(/g) >= 6, 'draft writes must go through the Vorgang actions');
  pruefe(!/persistenz\.aendern\(/.test(testflug), 'the flight must not write the draft whole any more');
  pruefe(anzahl(testflug, /persistenz\s*\.speichern\(/g) === 1, 'publishing must go through persistenz.speichern()');
  // A copy taken directly in the body of starteTestflug (two-space indent)
  // would freeze the state at start. `ent` is the one deliberate snapshot —
  // the flight was always set up against the entity manager of that moment.
  pruefe(
    !/^ {2}const (world|player|terrain|grass|welt|sockelFreiflaechen)\b.*kontext\./m.test(testflug),
    'a reassigned main() value is copied once at the start of starteTestflug instead of read through its getter'
  );
  for (const getter of ['world', 'player', 'terrain', 'grass', 'sockelFreiflaechen']) {
    pruefe(testflug.includes(`kontext.${getter}()`), `Testflug.ts never reads kontext.${getter}()`);
  }
  pruefe(
    testflug.includes('kontext.setzeSockelFreiflaechen(') &&
      testflug.includes('kontext.setzeSpawnEditorOffen(') &&
      testflug.includes('kontext.setzeRoutenEditorOffen('),
    'Testflug.ts must hand back the three reassigned main() values through the context setters'
  );
}

// ── 3. still statically linked ──────────────────────────────────────
{
  pruefe(/^import \{[^}]*starteTestflug[^}]*\} from '\.\/editor\/testflug\/Testflug';/m.test(main), 'main.ts must import the flight statically');
  pruefe(!/import\(\s*['"][^'"]*testflug/i.test(main), 'the flight must not become a dynamic import');
}

// ── 4./5. logic against a fake localStorage / fetch ─────────────────
const speicher = new Map<string, string>();
let gelesen = 0;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => {
    gelesen++;
    return speicher.get(k) ?? null;
  },
  setItem: (k: string, v: string) => void speicher.set(k, v),
};
const abrufe: Array<{ url: string; init: RequestInit }> = [];
// The server answer the fake returns next (status and body); default: 200 with a new hash.
let naechsteAntwort: { status: number; rumpf: unknown } = { status: 200, rumpf: { ok: true, message: 'saved', hash: 'h2' } };
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
  abrufe.push({ url, init });
  return new Response(JSON.stringify(naechsteAntwort.rumpf), { status: naechsteAntwort.status });
};
const warnungen: string[] = [];
console.warn = (...teile: unknown[]): void => void warnungen.push(teile.join(' '));

try {
  const { localStoragePersistenz, ENTWURF_SCHLUESSEL } = await import('../src/editor/testflug/LocalStoragePersistenz');
  const { ladeTestflugEntwurf } = await import('../src/editor/testflug/Testflug');

  // Importing the shared tables may warn about missing assets — not our business.
  warnungen.length = 0;
  pruefe(ENTWURF_SCHLUESSEL === 'wov-editor-layout', `draft key changed: ${ENTWURF_SCHLUESSEL}`);
  const p = localStoragePersistenz();
  pruefe(p.laden() === null, 'an empty store must load as null');

  const dok = { placements: [{ prefab: 'Tree', x: 1, z: 2 }], eigenesFeld: 7 };
  p.aendern(dok);
  pruefe(speicher.get('wov-editor-layout') === JSON.stringify(dok), 'aendern must write the whole document as JSON under the draft key');
  const zurueck = p.laden();
  pruefe(zurueck?.placements?.length === 1 && zurueck.eigenesFeld === 7, 'laden must return what aendern wrote, extra fields included');

  // Publishing needs the server base the editor left in the draft's companion
  // note. Without one nothing is sent (an older save by an editor could be
  // overwritten silently otherwise).
  const ohneBasis = await p.speichern({ placements: [] });
  pruefe(ohneBasis.ok === false && /Editor-Stand/.test(ohneBasis.message), `without a base: refuse with the editor hint, got ${JSON.stringify(ohneBasis)}`);
  pruefe(abrufe.length === 0, `without a base no request may go out, ${abrufe.length} did`);
  speicher.set('wov-editor-entwurf-stand', JSON.stringify({ zeit: '2026-09-19T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'tabA', basis: 'h1' }));
  const antwort = await p.speichern({ placements: [] });
  pruefe(antwort.ok === true && antwort.message === 'saved', 'speichern must return the server answer');
  pruefe(abrufe.length === 1, `speichern must call fetch once, called ${abrufe.length}x`);
  pruefe(abrufe[0]?.url === '/api/worldlayout', `wrong endpoint: ${abrufe[0]?.url}`);
  pruefe(abrufe[0]?.init.method === 'POST', 'speichern must POST');
  pruefe(abrufe[0]?.init.body === '{"placements":[]}', `wrong body: ${String(abrufe[0]?.init.body)}`);
  pruefe((abrufe[0]?.init.headers as Record<string, string> | undefined)?.['If-Match'] === '"h1"', `If-Match must carry the base from the note: ${JSON.stringify(abrufe[0]?.init.headers)}`);
  const zettelNach = JSON.parse(speicher.get('wov-editor-entwurf-stand') ?? 'null') as Record<string, unknown> | null;
  pruefe(zettelNach?.basis === 'h2', `after a successful save the note carries the new hash, has ${String(zettelNach?.basis)}`);
  pruefe(zettelNach?.tabId === 'tabA' && zettelNach?.quelle === 'server' && zettelNach?.zeit === '2026-09-19T00:00:00.000Z', 'the flight changes only `basis` in the note (stamp and tab stay)');
  naechsteAntwort = { status: 409, rumpf: { fehler: 'veraltet', aktuell: 'h9' } };
  const veraltet = await p.speichern({ placements: [] });
  pruefe(veraltet.ok === false && /inzwischen geändert/.test(veraltet.message) && /im Editor abgleichen/.test(veraltet.message), `409: message for the flight, got ${JSON.stringify(veraltet)}`);
  pruefe((JSON.parse(speicher.get('wov-editor-entwurf-stand') ?? 'null') as { basis?: string }).basis === 'h2', '409 must keep the old base in the note (only the editor replaces it after looking at the server)');
  naechsteAntwort = { status: 200, rumpf: { ok: true, message: 'saved', hash: 'h2' } };

  // start draft
  gelesen = 0;
  pruefe(ladeTestflugEntwurf(new URLSearchParams(''), p) === null, 'no layout=editor: no draft');
  pruefe(gelesen === 0, 'no layout=editor: storage must not even be read');
  const start = ladeTestflugEntwurf(new URLSearchParams('layout=editor'), p) as { placements: unknown[] } | null;
  pruefe(start?.placements.length === 1, 'layout=editor must load the stored draft');
  pruefe(warnungen.length === 0, 'a present draft must not warn');

  speicher.set('wov-editor-layout', '{kaputt');
  pruefe(ladeTestflugEntwurf(new URLSearchParams('layout=editor'), p) === null, 'a broken entry must mean "no draft"');
  pruefe(warnungen.length === 1, 'a broken entry must warn once');
  speicher.delete('wov-editor-layout');
  pruefe(ladeTestflugEntwurf(new URLSearchParams('layout=editor'), p) === null, 'a missing entry must mean "no draft"');
  pruefe(warnungen.length === 2 && warnungen[1]!.includes('[Testflug]'), 'a missing entry must warn with the [Testflug] prefix');
} catch (e) {
  fehler++;
  console.error(`  FAIL: flight module cannot be loaded or run: ${e instanceof Error ? e.message : String(e)}`);
}

if (fehler > 0) {
  console.log(`\n${fehler} failure(s) of ${geprueft} checks`);
  process.exit(1);
}
console.log(`\nThe flight lives in editor/testflug/, main.ts only wires it (${geprueft} checks).`);
