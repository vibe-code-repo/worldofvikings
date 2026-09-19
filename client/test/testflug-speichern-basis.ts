/**
 * The offline flight publishes with the server base the editor left behind
 * (companion note `wov-editor-entwurf-stand`, field `basis`), against the REAL
 * operations service on a copy of the world in a temp directory.
 *
 *   npx tsx test/testflug-speichern-basis.ts      (from client/)
 *
 * Before: the flight POSTed without `If-Match`, so it silently overwrote a
 * newer save of an editor (in another browser or tab profile) and reported the
 * same success message. Now: 409 -> "changed meanwhile, reconcile in the
 * editor", nothing written; without a base in the note nothing is sent at all.
 *
 * The "editor" in this test is not a hand-written note: it drives the real
 * draft store (`EntwurfsSpeicher`) with the same calls, in the same order, as
 * `editorMain.ts` (weltAbgleich / veraltetAbgleichen / inDieWeltSpeichern;
 * `editor-speichern-basis.ts` pins that order in the editor source). The base in
 * the companion note means "the server state the draft rests on": fetching a
 * newer server state does not move it; loading server content into the draft,
 * a successful save, and the explicit "keep draft" decision do.
 *
 * The checks reach the new pieces through optional access (`basisMerken`,
 * `entwurfImSpeicher`), so a stand without the fix fails by assertion instead
 * of aborting the run.
 * Port: free (WOV_ADMIN_PORT=0); WOV_TEST_ADMIN_PORT=<n> forces a slot port.
 * (Lives in client/test/ because it exercises client code and the client
 * typecheck has the DOM types the editor modules need; the service itself is
 * started from admin/.)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import { STAND_KEY, holeWeltdokument, schreibeWeltdokument } from '../src/editor/weltdokument';
import { EntwurfsSpeicher } from '../src/editor/entwurfsSpeicher';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const TEST_WURZEL = mkdtempSync(resolve(tmpdir(), 'testflug-basis-'));
const TOKEN = 'testflug-basis-token';
const TOKEN_DATEI = resolve(TEST_WURZEL, 'token');
const WELT_DATEI = resolve(TEST_WURZEL, 'server/data/welten/dev.json');

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const weltText = (name: string): string =>
  JSON.stringify({
    version: 1,
    name,
    detailSeed: 'testflug-basis',
    continents: [],
    regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
    placements: [{ prefab: 'Beech1', x: 10, z: 10 }],
  });
mkdirSync(resolve(TEST_WURZEL, 'server/data/welten'), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(WELT_DATEI, weltText('Startwelt'));
const platte = (): string => createHash('sha256').update(readFileSync(WELT_DATEI)).digest('hex');
const nameAufPlatte = (): string => (JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { name: string }).name;

function dienstStarten(): Promise<{ kind: ChildProcess; url: string }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: resolve(WURZEL, 'admin'),
      env: {
        ...process.env,
        WOV_WURZEL: TEST_WURZEL,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: process.env.WOV_TEST_ADMIN_PORT ?? '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const frist = setTimeout(() => {
      kind.kill();
      scheitern(new Error(`operations service does not start:\n${puffer}`));
    }, 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(frist);
        fertig({ kind, url: `http://127.0.0.1:${t[1]}` });
      }
    });
    kind.stderr.on('data', (s: Buffer) => (puffer += s.toString()));
    kind.on('exit', (code) => {
      clearTimeout(frist);
      scheitern(new Error(`operations service ended with ${code}:\n${puffer}`));
    });
  });
}

// ── The browser: a localStorage fake and a fetch that reaches the service ──
const speicher = new Map<string, string>();
const kv = {
  getItem: (k: string): string | null => speicher.get(k) ?? null,
  setItem: (k: string, v: string): void => void speicher.set(k, v),
  removeItem: (k: string): void => void speicher.delete(k),
};
(globalThis as unknown as { localStorage: unknown }).localStorage = kv;
let dienstUrl = '';
const anfragen: string[] = [];
const echtesFetch = globalThis.fetch;
(globalThis as unknown as { fetch: unknown }).fetch = (url: string, init: RequestInit = {}) => {
  anfragen.push(init.method ?? 'GET');
  return echtesFetch(`${dienstUrl}${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-wov-token': TOKEN } });
};
const posts = (): number => anfragen.filter((m) => m === 'POST').length;
const zettelBasis = (): string | undefined => (JSON.parse(speicher.get(STAND_KEY) ?? '{}') as { basis?: string }).basis;

const weltLeer = (): WorldLayout => sanitizeWorldLayout(JSON.parse(weltText('leer')))!;
const ENTWURF_SCHLUESSEL = 'wov-editor-layout';

let dienst: ChildProcess | undefined;
try {
  const gestartet = await dienstStarten();
  dienst = gestartet.kind;
  dienstUrl = gestartet.url;
  const { localStoragePersistenz } = await import('../src/editor/testflug/LocalStoragePersistenz');
  const flug = localStoragePersistenz();
  const speicherModul = (await import('../src/editor/entwurfsSpeicher')) as {
    entwurfImSpeicher?: (g: string) => boolean;
    speicherGrund: (e: string, geopfert: number) => string;
  };

  // ── The editor, as far as the base is concerned (calls as in editorMain.ts) ──
  /** `entwurfImSpeicher`; the fallback keeps the run going on a stand where the export does not exist yet. */
  const imSpeicher = (g: string): boolean => speicherModul.entwurfImSpeicher?.(g) ?? (g === 'ok' || g === 'knapp');
  let layout: WorldLayout = weltLeer();
  const editor = new EntwurfsSpeicher({
    speicher: kv,
    tabId: 'tabA',
    aktuell: () => layout,
    beiFremdem: (fremd) => {
      layout = fremd; // the editor takes over a foreign draft (the flight's changes)
    },
  });
  const merken = (h: string | null): boolean => (editor as unknown as { basisMerken?: (x: string | null) => boolean }).basisMerken?.(h) ?? false;
  check('the draft store can remember a base (basisMerken)', typeof (editor as unknown as { basisMerken?: unknown }).basisMerken === 'function');
  /** weltAbgleich.uebernehmen / veraltetAbgleichen "Serverstand laden": server content BECOMES the draft; only then it rests on that state. */
  const editorLaedtServerstand = (st: { layout: WorldLayout; hash: string | null }): string => {
    editor.abgleichen(); // storage events of the browser: a draft change by the flight has arrived by now
    layout = st.layout;
    const grund = speicherModul.speicherGrund(editor.schreiben(layout, 'server', 'dev'), 0);
    if (imSpeicher(grund)) merken(st.hash);
    return grund;
  };
  /** The dialog answer "keep draft": the SHOWN state becomes the base (not with a foreign draft pending). */
  const editorBehaeltEntwurf = (gezeigt: string | null): string => {
    const grund = speicherModul.speicherGrund(editor.schreiben(layout, 'bearbeitet', 'dev'), 0);
    if (grund !== 'fremd') merken(gezeigt);
    return grund;
  };
  /** An edit in the editor: take over what the flight wrote meanwhile, change, write the draft. */
  const editorAendert = (name: string): string => {
    editor.abgleichen();
    layout = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: name, x: 5, z: 5 }] })!;
    return editor.schreiben(layout, 'bearbeitet', 'dev');
  };
  /** `basisLesen()` of the store; `undefined` on a stand without the method (fails by assertion). */
  const basisLesenOderFehlt = (): string | null | undefined => {
    const f = (editor as unknown as { basisLesen?: () => string | null }).basisLesen;
    return f ? f.call(editor) : undefined;
  };
  /** The import button: the imported document replaces the draft; it rests on no server state. `mitBasisNull` false = the stand before K1.0 (`7cb7702`), kept as a control. */
  const editorImportiert = (name: string, mitBasisNull = true): string => {
    editor.abgleichen();
    layout = sanitizeWorldLayout(JSON.parse(weltText(name)))!;
    const grund = speicherModul.speicherGrund(editor.schreiben(layout, 'import', 'dev'), 0);
    if (mitBasisNull && imSpeicher(grund)) merken(null);
    return grund;
  };
  /** inDieWeltSpeichern on success: write the draft first, then move the base if it is in storage. */
  const editorSpeichertInWelt = async (): Promise<string> => {
    editor.abgleichen();
    const b = (editor as unknown as { basisLesen?: () => string | null }).basisLesen?.() ?? null;
    if (b === null) return 'ohne-basis';
    const antwort = await schreibeWeltdokument(layout, b);
    if (antwort.art !== 'ok') return antwort.art;
    const grund = speicherModul.speicherGrund(editor.schreiben(layout, 'server', 'dev'), 0);
    if (imSpeicher(grund)) merken(antwort.hash);
    return 'ok';
  };

  // ── 1. The editor loads the server and leaves its base in the note ──
  console.log('▶ Editor: Stand laden, Basis in den Begleitzettel');
  const stand = await holeWeltdokument();
  if (!stand.erreichbar) throw new Error(stand.grund);
  const h0 = stand.hash;
  check('editor GET delivers a hash', typeof h0 === 'string' && h0.length === 64, String(h0));
  check('the editor loads the server state into the draft: ok', editorLaedtServerstand(stand) === 'ok');
  check('the note carries the server base h0 (companion note, `basis`) — written by the editor calls, not by hand', zettelBasis() === h0, String(zettelBasis()));

  // ── 2. The flight publishes with the base ───────────────────────────
  console.log('▶ Testflug: speichern mit gültiger Basis → 200');
  const entwurf = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: 'Beech1', x: 20, z: 20 }] })!;
  flug.aendern(entwurf as never);
  const ok1 = await flug.speichern(entwurf);
  check('valid base: the server accepts (ok=true)', ok1.ok === true, JSON.stringify(ok1));
  check('… the file on disk has the flight’s placement', (JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { placements: unknown[] }).placements.length === 2);
  const s1 = await holeWeltdokument();
  const h1 = s1.erreichbar ? s1.hash : null;
  check('… the server hash moved (h1 != h0)', h1 !== null && h1 !== h0);
  check('… and the note carries the NEW hash (the next flight save must not 409 itself)', zettelBasis() === h1, String(zettelBasis()));

  // ── 3. An editor elsewhere saves newer; the flight must not overwrite it ──
  console.log('▶ neuere Editor-Speicherung, danach Testflug → 409, Serverdatei unverändert');
  const fremdLayout = sanitizeWorldLayout(JSON.parse(weltText('Editor-Stand')))!;
  const fremd = await schreibeWeltdokument(fremdLayout, h1);
  check('an editor (other browser) saves newer: ok', fremd.art === 'ok', JSON.stringify(fremd));
  const hFremd = fremd.art === 'ok' ? fremd.hash : null;
  const summeVorher = platte();
  const postsVorher = posts();
  const abgelehnt = await flug.speichern(entwurf);
  check('the flight save is refused (ok=false)', abgelehnt.ok === false, JSON.stringify(abgelehnt));
  check('… with the message for the flight', /inzwischen geändert/.test(abgelehnt.message) && /im Editor abgleichen/.test(abgelehnt.message), abgelehnt.message);
  check('… the world file on disk is byte-identical (sha256)', platte() === summeVorher);
  check('… and still holds the editor’s save', nameAufPlatte() === 'Editor-Stand', nameAufPlatte());
  check('… exactly one request went out and it was answered 409 (no retry, no fallback without base)', posts() === postsVorher + 1);
  check('… the note keeps the OLD base (only the editor’s decision replaces it)', zettelBasis() === h1, String(zettelBasis()));
  const nochmal = await flug.speichern(entwurf);
  check('pressing again does not overwrite either', nochmal.ok === false && nameAufPlatte() === 'Editor-Stand');

  // ── 4. The editor reconciles (loads the server state); the flight works again ──
  console.log('▶ Editor lädt den Serverstand → Testflug speichert wieder');
  const s2 = await holeWeltdokument();
  check('editor reads the current state = the editor save', s2.erreichbar && s2.hash === hFremd);
  check('fetching alone did not move the base (still h1)', zettelBasis() === h1, String(zettelBasis()));
  check('the editor loads it into the draft: ok', s2.erreichbar && editorLaedtServerstand(s2) === 'ok');
  check('… now the draft rests on it: base = the fetched hash', zettelBasis() === hFremd, String(zettelBasis()));
  const wieder = await flug.speichern(entwurf);
  check('after the editor loaded the server: the flight save is accepted', wieder.ok === true, JSON.stringify(wieder));
  const s3 = await holeWeltdokument();
  const h3 = s3.erreichbar ? s3.hash : null;
  check('… the note follows (h3)', zettelBasis() === h3 && h3 !== hFremd, String(zettelBasis()));

  // ── 5. An editor write after the flight save keeps the newer base ────
  console.log('▶ Editor schreibt den Entwurf nach dem Testflug-Speichern: Basis bleibt');
  check('the editor takes over the flight’s draft and writes its own change: ok (a real write, not a refused one)', editorAendert('Beech1') === 'ok');
  check('the editor draft write keeps the base h3 in the note (no stale overwrite)', zettelBasis() === h3, String(zettelBasis()));
  const danach = await flug.speichern(entwurf);
  check('… so the next flight save is accepted (no false 409)', danach.ok === true, JSON.stringify(danach));

  // ── 6. No base known: nothing is sent ───────────────────────────────
  console.log('▶ keine Basis im Zettel → nichts wird gesendet');
  const zettelMerk = speicher.get(STAND_KEY)!;
  speicher.delete(STAND_KEY);
  const anfragenVorher = anfragen.length;
  const summe = platte();
  const ohne = await flug.speichern(entwurf);
  check('without a note the flight refuses with the editor hint', ohne.ok === false && /Editor-Stand/.test(ohne.message), JSON.stringify(ohne));
  check('… no request reached the service', anfragen.length === anfragenVorher);
  check('… the world file is unchanged', platte() === summe);
  speicher.set(STAND_KEY, JSON.stringify({ zeit: '2026-09-19T00:00:00.000Z', instanz: 'dev', quelle: 'server' }));
  const ohneFeld = await flug.speichern(entwurf);
  check('a note without `basis` is refused the same way', ohneFeld.ok === false && /Editor-Stand/.test(ohneFeld.message));
  speicher.set(STAND_KEY, '{kaputt');
  const kaputt = await flug.speichern(entwurf);
  check('a broken note is refused the same way', kaputt.ok === false && /Editor-Stand/.test(kaputt.message));
  speicher.set(STAND_KEY, zettelMerk);

  // ── 7. S5: the editor only FETCHES a newer state; the dialog is still open ──
  console.log('▶ S5: Editor holt einen neueren Stand, Dialog offen → Testflug-Speichern = 409, Serverdatei byte-identisch');
  {
    const sA = await holeWeltdokument();
    if (!sA.erreichbar) throw new Error(sA.grund);
    editorLaedtServerstand(sA); // the draft rests on S1 (hash hA)
    check('draft on S1: the editor makes its own change (ok)', editorAendert('S5-eigen') === 'ok');
    check('… the base is hA', zettelBasis() === sA.hash, String(zettelBasis()));
    const fremdS2 = await schreibeWeltdokument(sanitizeWorldLayout(JSON.parse(weltText('S2-fremd')))!, sA.hash);
    check('another writer saves S2', fremdS2.art === 'ok');
    const hB = fremdS2.art === 'ok' ? fremdS2.hash : null;
    // editor start: weltAbgleich fetches S2 and opens the dialog. Fetching moves nothing.
    const sB = await holeWeltdokument();
    check('the editor fetches S2 (hash hB), dialog open', sB.erreichbar && sB.hash === hB);
    check('… the base of the draft is STILL hA (fetching does not move it)', zettelBasis() === sA.hash, String(zettelBasis()));
    const dok = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: 'Beech1', x: 40, z: 40 }] })!;
    flug.aendern(dok as never);
    const summeS2 = platte();
    const aufS2 = await flug.speichern(dok);
    check('flight save with the dialog still open: refused (409 message)', aufS2.ok === false && /inzwischen geändert/.test(aufS2.message), JSON.stringify(aufS2));
    check('… S2 on disk is byte-identical (sha256) and the name is still S2-fremd', platte() === summeS2 && nameAufPlatte() === 'S2-fremd', nameAufPlatte());
    // dialog answer: keep the draft — explicitly, with the SHOWN state hB
    editor.abgleichen(); // the flight’s draft change arrives (storage event in the browser)
    check('"keep draft": the base becomes the shown state hB', editorBehaeltEntwurf(sB.erreichbar ? sB.hash : null) !== 'fremd' && zettelBasis() === hB, String(zettelBasis()));
    const beh = await flug.speichern(dok);
    check('flight save after "keep draft": 200 (a decision was made)', beh.ok === true, JSON.stringify(beh));
    check('… and the server now holds the draft (S2 replaced on purpose)', nameAufPlatte() !== 'S2-fremd');
  }

  // ── 8. "Take over the server state": the draft becomes S3 and rests on it ──
  console.log('▶ S5b: Serverstand übernehmen → Entwurf = S3, Basis = h(S3), Testflug mit eigener Änderung = 200');
  {
    const sA = await holeWeltdokument();
    if (!sA.erreichbar) throw new Error(sA.grund);
    editorLaedtServerstand(sA);
    const fremdS3 = await schreibeWeltdokument(sanitizeWorldLayout(JSON.parse(weltText('S3-fremd')))!, sA.hash);
    const hC = fremdS3.art === 'ok' ? fremdS3.hash : null;
    const sC = await holeWeltdokument(); // dialog opens
    const dok = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: 'Beech1', x: 50, z: 50 }] })!;
    flug.aendern(dok as never);
    const summeS3 = platte();
    const ein = await flug.speichern(dok);
    check('dialog open: the flight is refused', ein.ok === false && platte() === summeS3);
    editor.abgleichen();
    check('"take over server state": the draft is S3', sC.erreichbar && editorLaedtServerstand(sC) === 'ok' && JSON.stringify(sanitizeWorldLayout(JSON.parse(speicher.get(ENTWURF_SCHLUESSEL)!))) === JSON.stringify(sC.layout));
    check('… and the base is h(S3)', zettelBasis() === hC, String(zettelBasis()));
    const mit = sanitizeWorldLayout({ ...(sC.erreichbar ? sC.layout : layout), placements: [{ prefab: 'Beech1', x: 60, z: 60 }] })!;
    flug.aendern(mit as never);
    const zwei = await flug.speichern(mit);
    check('flight save with its own change: 200', zwei.ok === true, JSON.stringify(zwei));
  }

  // ── 9. What the dialog showed is what "keep draft" decides about ────
  console.log('▶ S5c: nach dem Holen speichert jemand S4 — „Entwurf behalten“ gilt nur für den gezeigten Stand');
  {
    const sA = await holeWeltdokument();
    if (!sA.erreichbar) throw new Error(sA.grund);
    editorLaedtServerstand(sA);
    editorAendert('S5c');
    const f1 = await schreibeWeltdokument(sanitizeWorldLayout(JSON.parse(weltText('S-gezeigt')))!, sA.hash);
    const gezeigt = await holeWeltdokument(); // shown in the dialog
    const hGezeigt = gezeigt.erreichbar ? gezeigt.hash : null;
    const f2 = await schreibeWeltdokument(sanitizeWorldLayout(JSON.parse(weltText('S-ungesehen')))!, hGezeigt);
    check('two foreign saves (shown, then an unseen one)', f1.art === 'ok' && f2.art === 'ok');
    editorBehaeltEntwurf(hGezeigt);
    const dok = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: 'Beech1', x: 70, z: 70 }] })!;
    flug.aendern(dok as never);
    const summeU = platte();
    const r = await flug.speichern(dok);
    check('the flight save after "keep draft" is refused: the unseen S4 is not replaced', r.ok === false && platte() === summeU && nameAufPlatte() === 'S-ungesehen', nameAufPlatte());
  }

  // ── 10. The editor's own save: successful save moves the base, no base → no POST ──
  console.log('▶ Editor speichert: Basis rückt vor; ohne Basis kein POST');
  {
    const sA = await holeWeltdokument();
    if (!sA.erreichbar) throw new Error(sA.grund);
    editorLaedtServerstand(sA);
    editorAendert('E-eigen');
    const vorher = posts();
    check('the editor saves with the base of its draft: ok', (await editorSpeichertInWelt()) === 'ok' && posts() === vorher + 1);
    const nach = await holeWeltdokument();
    check('… the base moved to the new server hash', nach.erreichbar && zettelBasis() === nach.hash, String(zettelBasis()));
    speicher.delete(STAND_KEY);
    merken(null);
    const vor2 = posts();
    check('without any base the editor sends nothing', (await editorSpeichertInWelt()) === 'ohne-basis' && posts() === vor2);
  }
  // ── 11. Import: rests on no server state; no save until the dialog decided ──
  console.log('▶ Import: Basis null → Editor und Testflug senden nichts; Ausweg über den Abgleich → 200');
  {
    const sA = await holeWeltdokument();
    if (!sA.erreichbar) throw new Error(sA.grund);
    editorLaedtServerstand(sA); // browser with base h(S0) == the server state
    check('browser has base h(S0) == server', zettelBasis() === sA.hash);
    // control: the stand before K1.0 kept the base over an import and replaced S0 silently
    const kontrolle = editorImportiert('IMPORT-KONTROLLE', false);
    check('control (stand 7cb7702, import keeps the base): the editor save goes out with h(S0) and REPLACES S0 without a question', kontrolle === 'ok' && (await editorSpeichertInWelt()) === 'ok' && nameAufPlatte() === 'IMPORT-KONTROLLE', nameAufPlatte());

    const sB = await holeWeltdokument();
    if (!sB.erreichbar) throw new Error(sB.grund);
    editorLaedtServerstand(sB);
    check('again a browser with base h(S0) == server', zettelBasis() === sB.hash);
    const summeVorImport = platte();
    const postsVorImport = posts();
    check('import written to the draft: ok', editorImportiert('IMPORT-NEU') === 'ok');
    check('… the note has NO base afterwards (quelle import, basisLesen null)', zettelBasis() === undefined && basisLesenOderFehlt() === null && (JSON.parse(speicher.get(STAND_KEY) ?? '{}') as { quelle?: string }).quelle === 'import', String(zettelBasis()));
    check('editor save after the import: no POST goes out', (await editorSpeichertInWelt()) === 'ohne-basis' && posts() === postsVorImport);
    check('… the server file is byte-identical (sha256) and still holds the old state', platte() === summeVorImport && nameAufPlatte() !== 'IMPORT-NEU', nameAufPlatte());
    flug.aendern(sanitizeWorldLayout(JSON.parse(weltText('IMPORT-NEU')))! as never);
    const flugNachImport = await flug.speichern(sanitizeWorldLayout(JSON.parse(weltText('IMPORT-NEU')))!);
    check('flight save after the import: refused, no request, file unchanged', flugNachImport.ok === false && /Editor-Stand/.test(flugNachImport.message) && posts() === postsVorImport && platte() === summeVorImport, JSON.stringify(flugNachImport));
    check('… and the message names the way out (field WELT at the top left)', /WELT/.test(flugNachImport.message), flugNachImport.message);
    // the way out: instance field → weltAbgleich fetches the state, dialog, "keep draft" with the SHOWN hash
    const gezeigt = await holeWeltdokument();
    check('way out: the dialog fetch alone does not give the import a base', gezeigt.erreichbar && zettelBasis() === undefined);
    editor.abgleichen();
    check('"keep draft" (import stays): the base becomes the shown state', gezeigt.erreichbar && editorBehaeltEntwurf(gezeigt.hash) !== 'fremd' && zettelBasis() === gezeigt.hash, String(zettelBasis()));
    check('… now saving works: the editor replaces the shown state on purpose (200) and the file holds the import', (await editorSpeichertInWelt()) === 'ok' && nameAufPlatte() === 'IMPORT-NEU', nameAufPlatte());
  }
} finally {
  dienst?.removeAllListeners('exit');
  dienst?.kill();
  rmSync(TEST_WURZEL, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} check(s) FAILED`);
process.exit(fehler === 0 ? 0 : 1);
