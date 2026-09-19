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
 * The checks reach the new pieces through optional access (`basisMerken`), so
 * a stand without the fix fails by assertion instead of aborting the run.
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

let dienst: ChildProcess | undefined;
try {
  const gestartet = await dienstStarten();
  dienst = gestartet.kind;
  dienstUrl = gestartet.url;
  const { localStoragePersistenz } = await import('../src/editor/testflug/LocalStoragePersistenz');
  const flug = localStoragePersistenz();

  // ── 1. The editor loads the server and leaves its base in the note ──
  console.log('▶ Editor: Stand laden, Basis in den Begleitzettel');
  const stand = await holeWeltdokument();
  if (!stand.erreichbar) throw new Error(stand.grund);
  const h0 = stand.hash;
  check('editor GET delivers a hash', typeof h0 === 'string' && h0.length === 64, String(h0));
  let layout: WorldLayout = stand.layout;
  const editor = new EntwurfsSpeicher({ speicher: kv, tabId: 'tabA', aktuell: () => layout, beiFremdem: () => undefined });
  const merken = (h: string | null): boolean => (editor as unknown as { basisMerken?: (x: string | null) => boolean }).basisMerken?.(h) ?? false;
  check('the draft store can remember a base (basisMerken)', typeof (editor as unknown as { basisMerken?: unknown }).basisMerken === 'function');
  merken(h0);
  check('editor writes the draft: ok', editor.schreiben(layout, 'server', 'dev') === 'ok');
  check('the note carries the server base h0 (companion note, `basis`)', zettelBasis() === h0, String(zettelBasis()));
  // Contract level, independent of the editor code above: a note WITH a base is what the flight needs.
  const zettel = JSON.parse(speicher.get(STAND_KEY) ?? '{}') as Record<string, unknown>;
  zettel.basis = h0;
  speicher.set(STAND_KEY, JSON.stringify(zettel));

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
  check('… with the message for the flight', /inzwischen geändert/.test(abgelehnt.message) && /im Editor abgleichen und dort speichern/.test(abgelehnt.message), abgelehnt.message);
  check('… the world file on disk is byte-identical (sha256)', platte() === summeVorher);
  check('… and still holds the editor’s save', nameAufPlatte() === 'Editor-Stand', nameAufPlatte());
  check('… exactly one request went out and it was answered 409 (no retry, no fallback without base)', posts() === postsVorher + 1);
  check('… the note keeps the OLD base (only the editor replaces it after looking)', zettelBasis() === h1, String(zettelBasis()));
  const nochmal = await flug.speichern(entwurf);
  check('pressing again does not overwrite either', nochmal.ok === false && nameAufPlatte() === 'Editor-Stand');

  // ── 4. The editor reconciles; the flight works again ────────────────
  console.log('▶ Editor gleicht ab → Testflug speichert wieder');
  const s2 = await holeWeltdokument();
  check('editor reads the current state = the editor save', s2.erreichbar && s2.hash === hFremd);
  layout = s2.erreichbar ? s2.layout : layout;
  merken(s2.erreichbar ? s2.hash : null);
  const wieder = await flug.speichern(entwurf);
  check('after the editor saw the server: the flight save is accepted', wieder.ok === true, JSON.stringify(wieder));
  const s3 = await holeWeltdokument();
  const h3 = s3.erreichbar ? s3.hash : null;
  check('… the note follows (h3)', zettelBasis() === h3 && h3 !== hFremd, String(zettelBasis()));

  // ── 5. An editor write after the flight save keeps the newer base ────
  console.log('▶ Editor schreibt den Entwurf nach dem Testflug-Speichern: Basis bleibt');
  layout = sanitizeWorldLayout({ ...layout, placements: [...(layout.placements ?? []), { prefab: 'Beech1', x: 30, z: 30 }] })!;
  editor.schreiben(layout, 'bearbeitet', 'dev');
  check('the editor draft write keeps the base h3 in the note (no stale overwrite)', zettelBasis() === h3, String(zettelBasis()));
  const danach = await flug.speichern(entwurf);
  check('… so the next flight save is accepted (no false 409)', danach.ok === true, JSON.stringify(danach));

  // ── 6. No base known: nothing is sent ───────────────────────────────
  console.log('▶ keine Basis im Zettel → nichts wird gesendet');
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
} finally {
  dienst?.removeAllListeners('exit');
  dienst?.kill();
  rmSync(TEST_WURZEL, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} check(s) FAILED`);
process.exit(fehler === 0 ? 0 : 1);
