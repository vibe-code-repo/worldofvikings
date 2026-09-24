/**
 * Reset the world to zero (Editor K4.0): the editor's side, without a window.
 *
 * What is proven here:
 *  1. The confirmation gate: only the exact instance name frees the button;
 *     editing the text takes it away again; the switches do not touch it; a
 *     click through a shut gate resolves nothing.
 *  2. The dialog's sentences carry the real numbers and say what stays.
 *  3. The two requests (GET numbers, POST reset) against a fetch stand-in:
 *     what is sent, what every answer becomes (also "unknown" when the answer
 *     is missing: the editor must not claim a reset that may not have happened).
 *  4. After a success the editor stands clean: draft = the new document, BASE =
 *     the new hash, undo/redo stacks empty, and the next save with that base is
 *     accepted where the old base is refused (the stand-in server is strict
 *     about `If-Match`, so the contrast is real). When the storage does not take
 *     the draft ('voll') or another tab wrote ('fremd'), the base is NOT moved.
 *  5. Source checks on the wiring in editorMain.ts and the dialog, on the syntax
 *     tree (line breaks, quotes, comments and helper variables change nothing).
 *
 * Run:  npx tsx test/welt-zuruecksetzen.ts    (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import * as ts from 'typescript';
import { EntwurfsSpeicher, SchrittVerlauf, speicherGrund, type KvSpeicher } from '../src/editor/entwurfsSpeicher';
import { ENTWURF_KEY, STAND_KEY, schreibeWeltdokument } from '../src/editor/weltdokument';

// Optional access: a stand without the module fails by assertion, not by aborting the run.
const modul = (await import('../src/editor/weltZuruecksetzen').catch((e: unknown) => {
  console.log(`  ✗ Modul client/src/editor/weltZuruecksetzen.ts laesst sich laden (${String(e)})`);
  process.exit(1);
})) as typeof import('../src/editor/weltZuruecksetzen');
const {
  RESET_PFAD,
  ResetDialogZustand,
  bestaetigungPasst,
  bleibtSaetze,
  erfolgsMeldung,
  groesseText,
  holeVorschau,
  nachZuruecksetzen,
  verschwindetSaetze,
  weltZuruecksetzen,
  zahlText,
} = modul;
type ResetZahlen = import('../src/editor/weltZuruecksetzen').ResetZahlen;
type ResetErgebnis = import('../src/editor/weltZuruecksetzen').ResetErgebnis;

const HIER = dirname(fileURLToPath(import.meta.url));

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

// ── Fixtures ──────────────────────────────────────────────────────────
const ROH = {
  version: 1,
  name: 'Pruefwelt',
  detailSeed: 'pruefseed',
  continents: [{ id: 'nord', name: 'Nordland', faction: 'viking' }],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 }],
  placements: [
    { prefab: 'Beech1', x: 1, z: 2 },
    { prefab: 'Beech1', x: 3, z: 4 },
    { prefab: 'Beech1', x: 5, z: 6 },
  ],
};
const REICH = sanitizeWorldLayout(ROH)!;
const LEER: WorldLayout = { version: 1, name: 'Pruefwelt', detailSeed: 'pruefseed', continents: [], regions: [], placements: [], rivers: [], lakes: [], routes: [] };

const ZAHLEN: ResetZahlen = {
  weltdokument: { name: 'Pruefwelt', detailSeed: 'pruefseed', platzierungen: 52, regionen: 19, fluesse: 1, seen: 3, routen: 4, kontinente: 1, hash: 'h-alt' },
  spielstand: { datei: 'dev.db.zst', bytes: 2_072_236, zdos: 94_212, geaendert: '2026-09-20T19:56:00.000Z' },
  konten: { konten: 3, charaktere: 5 },
};

// ── 1. Confirmation gate ─────────────────────────────────────────────
console.log('▶ Tippbestätigung');
{
  const faelle: [string, string | null, boolean][] = [
    ['dev', 'dev', true],
    ['', 'dev', false],
    ['de', 'dev', false],
    ['dev ', 'dev', false],
    [' dev', 'dev', false],
    ['DEV', 'dev', false],
    ['Dev', 'dev', false],
    ['devv', 'dev', false],
    ['live', 'dev', false],
    ['', '', false],
    ['x', null, false],
    ['null', null, false],
  ];
  for (const [eingabe, instanz, soll] of faelle) {
    check(`bestaetigungPasst(${JSON.stringify(eingabe)}, ${JSON.stringify(instanz)}) = ${soll}`, bestaetigungPasst(eingabe, instanz) === soll);
  }
  const z = new ResetDialogZustand('dev');
  check('Anfangszustand: gesperrt, Ergebnis null', !z.freigegeben() && z.ergebnis() === null);
  z.eingabe = 'de';
  check('halber Name: gesperrt', !z.freigegeben() && z.ergebnis() === null);
  z.konten = true;
  z.seed = 'neu';
  check('die Schalter (Konten, Seed) geben nichts frei', !z.freigegeben() && z.ergebnis() === null);
  z.eingabe = 'dev';
  check('exakter Name: frei, Ergebnis trägt Name, Seed und Konten', z.freigegeben() && JSON.stringify(z.ergebnis()) === JSON.stringify({ bestaetigung: 'dev', seed: 'neu', konten: true }));
  z.eingabe = 'dev.';
  check('danach noch ein Zeichen: wieder gesperrt', !z.freigegeben() && z.ergebnis() === null);
  z.eingabe = 'dev';
  z.konten = false;
  z.seed = 'behalten';
  check('Voreinstellung: Seed behalten, Konten AUS', JSON.stringify(z.ergebnis()) === JSON.stringify({ bestaetigung: 'dev', seed: 'behalten', konten: false }));
  check('die Voreinstellung eines frischen Zustands ist Seed behalten und Konten aus', new ResetDialogZustand('dev').seed === 'behalten' && new ResetDialogZustand('dev').konten === false);
}

// ── 2. Sentences ──────────────────────────────────────────────────────
console.log('▶ Sätze mit den echten Zahlen');
{
  const ohne = verschwindetSaetze(ZAHLEN, { konten: false, entwurf: { platzierungen: 7, regionen: 2 } }).join('\n');
  check('nennt 52 Platzierungen, 19 Regionen, 1 Fluss, 3 Seen, 4 Routen', ohne.includes('52 Platzierungen') && ohne.includes('19 Regionen') && ohne.includes('1 Fluss') && ohne.includes('3 Seen') && ohne.includes('4 Routen'), ohne.slice(0, 140));
  check('nennt den Spielstand mit Größe und 94.212 Objekten', ohne.includes('2,0 MB') && ohne.includes('94.212 Objekte'), ohne);
  check('nennt den Browser-Entwurf (7 Platzierungen, 2 Regionen) und den Rückgängig-Stapel', ohne.includes('7 Platzierungen, 2 Regionen') && ohne.includes('Rückgängig-Stapel'));
  check('ohne Konten-Haken: Konten stehen NICHT bei „verschwindet“', !ohne.includes('3 Konten'));
  const mit = verschwindetSaetze(ZAHLEN, { konten: true, entwurf: { platzierungen: 7, regionen: 2 } }).join('\n');
  check('mit Konten-Haken: 3 Konten mit 5 Charakteren stehen bei „verschwindet“', mit.includes('3 Konten mit 5 Charakteren'), mit);
  const bleibt = bleibtSaetze(ZAHLEN, { konten: false, seed: 'behalten' }).join('\n');
  check('„bleibt“: Konten (3/5), Dungeons, Forum, Adminliste, Seed', bleibt.includes('3 Konten') && bleibt.includes('Dungeons') && bleibt.includes('Forum') && bleibt.includes('Adminliste') && bleibt.includes('pruefseed'), bleibt);
  const bleibtMit = bleibtSaetze(ZAHLEN, { konten: true, seed: 'neu' }).join('\n');
  check('mit Konten-Haken bleiben Konten NICHT; Seed neu sagt „neu gewürfelt“', !bleibtMit.includes('Spielerkonten') && bleibtMit.includes('neu gewürfelt'), bleibtMit);
  const leer = verschwindetSaetze({ weltdokument: null, spielstand: null, konten: null }, { konten: true, entwurf: { platzierungen: 0, regionen: 0 } }).join('\n');
  check('ohne Weltdokument und ohne Spielstand: ehrliche Sätze statt „undefined“', leer.includes('nicht lesbar') && leer.includes('Spielstand gibt es nicht') && !leer.includes('undefined') && !leer.includes('null'), leer);
  check('zahlText(94212)=94.212, zahlText(999)=999, zahlText(1000000)=1.000.000', zahlText(94_212) === '94.212' && zahlText(999) === '999' && zahlText(1_000_000) === '1.000.000');
  check('groesseText: 900 Byte, 2048 → 2 KB, 5 MB', groesseText(900) === '900 Byte' && groesseText(2048) === '2 KB' && groesseText(5 * 1024 * 1024) === '5,0 MB');
}

// ── 3. Requests ───────────────────────────────────────────────────────
console.log('▶ GET und POST gegen eine Fetch-Attrappe');
interface Aufruf {
  url: string;
  methode: string;
  rumpf: string | undefined;
}
type Antwortmuster = { status: number; rumpf?: unknown; roh?: string } | 'netz';
function attrappe(antworten: Antwortmuster[]): { fetchFn: typeof fetch; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
    aufrufe.push({ url, methode: init?.method ?? 'GET', rumpf: init?.body as string | undefined });
    const a = antworten[Math.min(aufrufe.length - 1, antworten.length - 1)]!;
    if (a === 'netz') throw new Error('ECONNREFUSED');
    return new Response(a.roh ?? JSON.stringify(a.rumpf ?? {}), { status: a.status });
  }) as typeof fetch;
  return { fetchFn, aufrufe };
}
const OK_ANTWORT = {
  ok: true,
  message: 'Welt zurückgesetzt: 52 Platzierungen …',
  kennung: '2026-09-20_2015',
  hash: 'h-neu',
  dokument: LEER,
  sicherung: { spielstand: 'dev.db.zst.2026-09-20T20-15-00-000Z.bak', weltdokument: 'dev.json.2026-09-20_2015' },
  beiseite: ['dev.db.zst.vor-reset-2026-09-20_2015', 'dev.db.zst.prev.vor-reset-2026-09-20_2015'],
  vorher: ZAHLEN,
};
{
  let a = attrappe([{ status: 200, rumpf: { ok: true, instanz: 'dev', erlaubt: true, testweltAktiv: false, zahlen: ZAHLEN } }]);
  let v = await holeVorschau(a.fetchFn);
  check('GET: Pfad /api/welt-zuruecksetzen, Methode GET, ohne Rumpf', a.aufrufe.length === 1 && a.aufrufe[0]!.url === RESET_PFAD && RESET_PFAD === '/api/welt-zuruecksetzen' && a.aufrufe[0]!.methode === 'GET' && a.aufrufe[0]!.rumpf === undefined);
  check('GET: Zahlen, Instanz, erlaubt kommen an', v.erreichbar && v.instanz === 'dev' && v.erlaubt && !v.testweltAktiv && v.zahlen.weltdokument?.platzierungen === 52);
  a = attrappe([{ status: 200, rumpf: { ok: true, instanz: 'live', erlaubt: false, grund: 'Auf live nie', testweltAktiv: false, zahlen: ZAHLEN } }]);
  v = await holeVorschau(a.fetchFn);
  check('GET live: erlaubt=false mit Grund', v.erreichbar && !v.erlaubt && v.grund === 'Auf live nie');
  v = await holeVorschau(attrappe(['netz']).fetchFn);
  check('GET ohne Netz: erreichbar=false, kein Wurf', !v.erreichbar);
  v = await holeVorschau(attrappe([{ status: 401, rumpf: { message: 'Token fehlt' } }]).fetchFn);
  check('GET 401: erreichbar=false mit der Meldung des Dienstes', !v.erreichbar && v.grund.includes('Token fehlt'), v.erreichbar ? '' : v.grund);
  v = await holeVorschau(attrappe([{ status: 200, roh: '<html>index</html>' }]).fetchFn);
  check('GET mit HTML statt JSON (Vorschalter reicht /api/ nicht durch): erreichbar=false', !v.erreichbar);
}
{
  const a = attrappe([{ status: 200, rumpf: OK_ANTWORT }]);
  const e = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'neu', konten: true }, a.fetchFn);
  check('POST: Pfad, Methode, Rumpf {bestaetigung, seed, konten}', a.aufrufe.length === 1 && a.aufrufe[0]!.url === RESET_PFAD && a.aufrufe[0]!.methode === 'POST' && a.aufrufe[0]!.rumpf === JSON.stringify({ bestaetigung: 'dev', seed: 'neu', konten: true }), a.aufrufe[0]?.rumpf);
  check('POST 200: art=ok mit Hash, Dokument (0 Regionen), Kennung, Sicherungen, beiseite', e.art === 'ok' && e.hash === 'h-neu' && e.dokument.regions.length === 0 && e.kennung === '2026-09-20_2015' && e.sicherung.weltdokument === 'dev.json.2026-09-20_2015' && e.beiseite.length === 2 && e.warnung === null, JSON.stringify(e).slice(0, 120));
  let f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 400, rumpf: { ok: false, fehler: 'bestaetigung', message: 'bestaetigung muss …' } }]).fetchFn);
  check('POST 400: art=fehler mit der Meldung des Dienstes', f.art === 'fehler' && f.status === 400 && f.message.startsWith('bestaetigung muss'));
  f = await weltZuruecksetzen({ bestaetigung: 'live', seed: 'behalten', konten: false }, attrappe([{ status: 403, rumpf: { ok: false, fehler: 'live-gesperrt', message: 'Auf live nie' } }]).fetchFn);
  check('POST 403: art=fehler', f.art === 'fehler' && f.status === 403);
  f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 500, rumpf: { ok: false, fehler: 'tausch-fehlgeschlagen', message: 'nicht möglich. Alles steht wieder wie vorher.', zurueckgerollt: true } }]).fetchFn);
  check('POST 500 mit Antwort: art=fehler, zurueckgerollt=true', f.art === 'fehler' && f.status === 500 && f.zurueckgerollt === true);
  f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe(['netz']).fetchFn);
  check('POST ohne Antwort (Netz): art=unbekannt — kein „fehlgeschlagen“, kein „ok“', f.art === 'unbekannt' && f.message.includes('unbekannt'));
  f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 504, roh: '<html>Gateway Timeout</html>' }]).fetchFn);
  check('POST 504 ohne lesbaren Rumpf (Proxy-Zeitüberschreitung): art=unbekannt', f.art === 'unbekannt');
  f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 200, rumpf: { ok: true, hash: 'h', dokument: 'kein Dokument' } }]).fetchFn);
  check('POST 200 mit unlesbarem Dokument: art=unbekannt (nichts wird angenommen)', f.art === 'unbekannt');
  f = await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 200, rumpf: { ...OK_ANTWORT, hash: '' } }]).fetchFn);
  check('POST 200 ohne Hash: art=unbekannt (ohne Hash keine Basis)', f.art === 'unbekannt');
  f = await weltZuruecksetzen(
    { bestaetigung: 'dev', seed: 'behalten', konten: false },
    attrappe([{ status: 500, rumpf: { ...OK_ANTWORT, ok: false, fehler: 'start-fehlgeschlagen', message: 'wov-server ließ sich nicht starten — von Hand: systemctl start wov-server.' } }]).fetchFn
  );
  check('POST 500 start-fehlgeschlagen: die Welt IST zurückgesetzt → art=ok mit Warnung (der Editor zieht nach)', f.art === 'ok' && f.warnung !== null && f.warnung.includes('systemctl start') && f.hash === 'h-neu');
}

// ── 4. After a success: the editor stands clean ──────────────────────
console.log('▶ Nachbereitung im Editor (echter Entwurfsspeicher, echter Verlauf)');

/** A stand-in for the server that is strict about the base: the state the next save is measured against. */
function serverAttrappe(anfangsHash: string): { fetchFn: typeof fetch; setzeHash: (h: string) => void; posts: { basis: string | null; status: number }[] } {
  let hash = anfangsHash;
  const posts: { basis: string | null; status: number }[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit): Promise<Response> => {
    const kopf = (init?.headers ?? {}) as Record<string, string>;
    const basis = kopf['If-Match'] ? kopf['If-Match'].replace(/"/g, '') : null;
    let status = 200;
    if (basis === null) status = 428;
    else if (basis !== hash) status = 409;
    posts.push({ basis, status });
    if (status === 200) {
      hash = `h-nach-speichern-${posts.length}`;
      return new Response(JSON.stringify({ ok: true, message: 'Gespeichert in dev.json', hash }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, fehler: status === 409 ? 'veraltet' : 'basis-fehlt', aktuell: hash }), { status });
  }) as typeof fetch;
  return { fetchFn, setzeHash: (h) => (hash = h), posts };
}

interface Editor {
  layout: WorldLayout;
  serverKanon: string | null;
  verlauf: SchrittVerlauf<WorldLayout>;
  sp: EntwurfsSpeicher;
  kv: Map<string, string> & { voll?: boolean };
  fremdMeldungen: number;
}

/** The same wiring as `weltZuruecksetzenStarten` in editorMain.ts, on real parts. */
function editorBauen(): Editor {
  const daten = new Map<string, string>() as Map<string, string> & { voll?: boolean };
  const kv: KvSpeicher = {
    getItem: (k) => daten.get(k) ?? null,
    setItem: (k, v) => {
      if (daten.voll && k === ENTWURF_KEY) throw new Error('QuotaExceededError');
      daten.set(k, v);
    },
    removeItem: (k) => void daten.delete(k),
  };
  const e: Editor = {
    layout: REICH,
    serverKanon: JSON.stringify(REICH),
    verlauf: new SchrittVerlauf<WorldLayout>(50),
    sp: null as unknown as EntwurfsSpeicher,
    kv: daten,
    fremdMeldungen: 0,
  };
  e.sp = new EntwurfsSpeicher({
    speicher: kv,
    tabId: 'tab-a',
    aktuell: () => e.layout,
    beiFremdem: (fremd) => {
      e.fremdMeldungen++;
      e.layout = fremd;
    },
  });
  // Start state: the draft equals the server state 'h-alt', and the user has worked: three steps, one of them undone.
  e.sp.schreiben(REICH, 'server', 'dev');
  e.sp.basisMerken('h-alt');
  e.verlauf.merke(REICH);
  e.verlauf.merke(REICH);
  e.verlauf.merke(REICH);
  e.verlauf.zurueck(REICH);
  return e;
}

function nachbereiten(e: Editor, ergebnis: Extract<ResetErgebnis, { art: 'ok' }>) {
  return nachZuruecksetzen(ergebnis, {
    verlaufLeeren: () => e.verlauf.leeren(),
    serverStandMerken: (d) => {
      e.serverKanon = JSON.stringify(d);
    },
    ersetzeStand: (d) => {
      e.verlauf.merke(e.layout, true); // the editor's merkeSchritt(true): the stacks must be empty at the end all the same
      e.layout = d;
      return speicherGrund(e.sp.schreiben(e.layout, 'server', 'dev'), 0);
    },
    basisSetzen: (h) => void e.sp.basisMerken(h),
  });
}

const okErgebnis = (await weltZuruecksetzen({ bestaetigung: 'dev', seed: 'behalten', konten: false }, attrappe([{ status: 200, rumpf: OK_ANTWORT }]).fetchFn)) as Extract<ResetErgebnis, { art: 'ok' }>;
{
  // The draft is read from the fake storage directly (the module-level reader needs a browser's localStorage).
  const e = editorBauen();
  const draftVorher = JSON.parse(e.kv.get(ENTWURF_KEY)!) as WorldLayout;
  check('Vorbedingung: Entwurf im Speicher mit 3 Platzierungen und 1 Region, Basis h-alt, Rückgängig 2, Wiederherstellen 1', draftVorher.placements?.length === 3 && draftVorher.regions.length === 1 && e.sp.basisLesen() === 'h-alt' && e.verlauf.vergangenheit.length === 2 && e.verlauf.zukunft.length === 1);
  const n = nachbereiten(e, okErgebnis);
  const draft = JSON.parse(e.kv.get(ENTWURF_KEY)!) as WorldLayout;
  const zettel = JSON.parse(e.kv.get(STAND_KEY)!) as { quelle: string; basis?: string; instanz: string | null };
  check('Entwurf im Speicher: 0 Regionen, 0 Platzierungen (dasselbe Minimaldokument)', draft.regions.length === 0 && (draft.placements?.length ?? 0) === 0 && JSON.stringify(draft) === JSON.stringify(sanitizeWorldLayout(LEER)), JSON.stringify(draft).slice(0, 100));
  check('Begleitzettel: Quelle „server“ (Entwurf = Serverstand)', zettel.quelle === 'server', zettel.quelle);
  check('Basis = neuer Hash h-neu (Begleitzettel UND basisLesen)', zettel.basis === 'h-neu' && e.sp.basisLesen() === 'h-neu', `${zettel.basis} / ${e.sp.basisLesen()}`);
  check('Rückgängig-Stapel leer (vorher 2)', e.verlauf.vergangenheit.length === 0);
  check('Wiederherstellen-Stapel leer (vorher 1)', e.verlauf.zukunft.length === 0);
  check('Strg+Z danach findet nichts (kein Weg zurück zum alten Entwurf)', e.verlauf.zurueck(e.layout) === undefined);
  check('der angezeigte Stand ist das neue Dokument; serverKanon passt dazu', e.layout === okErgebnis.dokument && e.serverKanon === JSON.stringify(okErgebnis.dokument));
  check('Ergebnis: Grund ok, Basis gesetzt', n.grund === 'ok' && n.basisGesetzt);

  // the next save
  const server = serverAttrappe('h-neu');
  const naechste: WorldLayout = { ...e.layout, regions: REICH.regions, continents: REICH.continents };
  const gut = await schreibeWeltdokument(naechste, e.sp.basisLesen(), server.fetchFn);
  check('nächstes Speichern mit der Basis des Editors → ok (200), nicht veraltet (409), nicht basis-fehlt (428)', gut.art === 'ok' && server.posts.length === 1 && server.posts[0]!.status === 200 && server.posts[0]!.basis === 'h-neu', JSON.stringify(gut));
  const alt = await schreibeWeltdokument(naechste, 'h-alt', serverAttrappe('h-neu').fetchFn);
  check('Kontrolle: mit der ALTEN Basis h-alt lehnt dieselbe Attrappe ab (409 = veraltet)', alt.art === 'veraltet', JSON.stringify(alt));
  const ohne = await schreibeWeltdokument(naechste, null, serverAttrappe('h-neu').fetchFn);
  check('Kontrolle: ohne Basis lehnt sie ab (428 = basis-fehlt)', ohne.art === 'basis-fehlt', JSON.stringify(ohne));
  check('Meldung nennt Sicherung Spielstand, Sicherung Weltdokument und die beiseite gelegten Dateien', (() => {
    const m = erfolgsMeldung(okErgebnis, n);
    return m.includes('dev.db.zst.2026-09-20T20-15-00-000Z.bak') && m.includes('dev.json.2026-09-20_2015') && m.includes('dev.db.zst.vor-reset-2026-09-20_2015') && !m.includes('ACHTUNG');
  })());
}
{
  // the storage refuses the draft: the base must NOT move
  const e = editorBauen();
  e.kv.voll = true;
  const n = nachbereiten(e, okErgebnis);
  check('Speicher voll: Grund „voll“, Basis NICHT gesetzt, sie bleibt h-alt', n.grund === 'voll' && !n.basisGesetzt && e.sp.basisLesen() === 'h-alt', `${n.grund} ${e.sp.basisLesen()}`);
  check('Speicher voll: die Meldung warnt (ACHTUNG) und rät zum Neuladen', erfolgsMeldung(okErgebnis, n).includes('ACHTUNG') && erfolgsMeldung(okErgebnis, n).includes('neu laden'));
  check('Speicher voll: Rückgängig-Stapel ist trotzdem leer', e.verlauf.vergangenheit.length === 0 && e.verlauf.zukunft.length === 0);
}
{
  // another tab wrote the draft in the meantime
  const e = editorBauen();
  e.kv.set(ENTWURF_KEY, JSON.stringify({ ...REICH, name: 'Fremder Entwurf' }));
  const n = nachbereiten(e, okErgebnis);
  check('anderer Tab hat geschrieben: Grund „fremd“, Basis NICHT gesetzt, beiFremdem lief', n.grund === 'fremd' && !n.basisGesetzt && e.sp.basisLesen() === 'h-alt' && e.fremdMeldungen === 1, `${n.grund} ${e.sp.basisLesen()} ${e.fremdMeldungen}`);
}
{
  // the server did not come back: the editor still moves on, the message warns
  const e = editorBauen();
  const mitWarnung = { ...okErgebnis, warnung: 'wov-server ließ sich nicht starten — von Hand: systemctl start wov-server.' };
  const n = nachbereiten(e, mitWarnung);
  check('Start fehlgeschlagen: Editor steht trotzdem auf dem neuen Stand (Basis h-neu), die Meldung warnt', e.sp.basisLesen() === 'h-neu' && erfolgsMeldung(mitWarnung, n).includes('ACHTUNG: wov-server'));
}
// ── 5. Source checks on the wiring ───────────────────────────────────
console.log('▶ Quelltext: Verdrahtung in editorMain.ts und im Dialog (Syntaxbaum)');
function quelle(datei: string): ts.SourceFile {
  const pfad = resolve(HIER, datei);
  return ts.createSourceFile(pfad, readFileSync(pfad, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function alle<T extends ts.Node>(wurzel: ts.Node, passt: (n: ts.Node) => n is T): T[] {
  const treffer: T[] = [];
  const geh = (n: ts.Node): void => {
    if (passt(n)) treffer.push(n);
    ts.forEachChild(n, geh);
  };
  geh(wurzel);
  return treffer;
}
const istAufruf = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n);
const aufrufName = (c: ts.CallExpression): string => c.expression.getText().replace(/\s+/g, '');
const funktion = (sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined =>
  alle(sf, (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n)).find((f) => f.name?.text === name);

const main = quelle('../src/editor/editorMain.ts');
const dialog = quelle('../src/editor/WeltZuruecksetzenDialog.ts');
{
  const rufe = alle(main, istAufruf).filter((c) => aufrufName(c) === 'nachZuruecksetzen');
  check('editorMain ruft nachZuruecksetzen genau einmal', rufe.length === 1, `n=${rufe.length}`);
  const host = rufe[0]?.arguments[1];
  const eigenschaften = host && ts.isObjectLiteralExpression(host) ? host.properties.filter(ts.isPropertyAssignment) : [];
  const namen = eigenschaften.map((p) => p.name.getText()).sort().join(',');
  check('der Host hat genau die vier Haken (basisSetzen, ersetzeStand, serverStandMerken, verlaufLeeren)', namen === 'basisSetzen,ersetzeStand,serverStandMerken,verlaufLeeren', namen);
  const haken = (n: string): ts.PropertyAssignment | undefined => eigenschaften.find((p) => p.name.getText() === n);
  const ruft = (p: ts.Node | undefined, name: string): boolean => !!p && alle(p, istAufruf).some((c) => aufrufName(c) === name);
  check('verlaufLeeren ruft verlauf.leeren()', ruft(haken('verlaufLeeren'), 'verlauf.leeren'));
  check('basisSetzen ruft setzeEntwurfBasis(…)', ruft(haken('basisSetzen'), 'setzeEntwurfBasis'));
  check('ersetzeStand ruft alles(\'server\') (schreibt den Entwurf, Quelle server)', (() => {
    const p = haken('ersetzeStand');
    return !!p && alle(p, istAufruf).some((c) => aufrufName(c) === 'alles' && c.arguments[0] !== undefined && ts.isStringLiteralLike(c.arguments[0]) && c.arguments[0].text === 'server');
  })());
  check('ersetzeStand legt vor der Zuweisung merkeSchritt(true) an (wie jedes Ersetzen) und setzt dann layout', (() => {
    const p = haken('ersetzeStand');
    if (!p) return false;
    const schritt = alle(p, istAufruf).find((c) => aufrufName(c) === 'merkeSchritt' && c.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword);
    const zuweisung = alle(p, (n): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken).find((b) => b.left.getText() === 'layout');
    return !!schritt && !!zuweisung && schritt.getStart() < zuweisung.getStart();
  })());
  check('ersetzeStand setzt layout und bricht die Werkzeuge ab', (() => {
    const p = haken('ersetzeStand');
    if (!p) return false;
    const setztLayout = alle(p, (n): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken).some((b) => b.left.getText() === 'layout');
    return setztLayout && alle(p, istAufruf).some((c) => /\.abbrechen$/.test(aufrufName(c)));
  })());
  check('serverStandMerken setzt serverKanon', (() => {
    const p = haken('serverStandMerken');
    return !!p && alle(p, (n): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken).some((b) => b.left.getText() === 'serverKanon');
  })());
}
{
  const start = funktion(main, 'weltZuruecksetzenStarten');
  check('weltZuruecksetzenStarten existiert', !!start);
  const pos = (name: string): number => {
    const c = start ? alle(start, istAufruf).find((x) => aufrufName(x) === name) : undefined;
    return c ? c.getStart() : -1;
  };
  const vorschau = pos('holeVorschau');
  const dialogPos = pos('weltZuruecksetzenDialog');
  const post = pos('weltZuruecksetzen');
  const erlaubtGelesen = start ? alle(start, (n): n is ts.PropertyAccessExpression => ts.isPropertyAccessExpression(n)).filter((p) => p.name.text === 'erlaubt').map((p) => p.getStart()) : [];
  const testweltGelesen = start ? alle(start, (n): n is ts.PropertyAccessExpression => ts.isPropertyAccessExpression(n)).filter((p) => p.name.text === 'testweltAktiv').map((p) => p.getStart()) : [];
  check('Reihenfolge: holeVorschau → erlaubt geprüft → testweltAktiv geprüft → Dialog → POST', vorschau >= 0 && dialogPos > vorschau && post > dialogPos && erlaubtGelesen.some((p) => p > vorschau && p < dialogPos) && testweltGelesen.some((p) => p > vorschau && p < dialogPos), `${vorschau} ${erlaubtGelesen} ${testweltGelesen} ${dialogPos} ${post}`);
  check('der Dialog-Ausgang null (Abbrechen) kehrt vor dem POST zurück', (() => {
    if (!start || dialogPos < 0 || post < 0) return false;
    const ifs = alle(start, (n): n is ts.IfStatement => ts.isIfStatement(n)).filter((i) => i.getStart() > dialogPos && i.getStart() < post && /=== null/.test(i.expression.getText()));
    return ifs.some((i) => alle(i.thenStatement, (n): n is ts.ReturnStatement => ts.isReturnStatement(n)).length > 0);
  })());
  const refs = alle(main, (n): n is ts.Identifier => ts.isIdentifier(n) && n.text === 'weltZuruecksetzenStarten').filter((i) => !(ts.isFunctionDeclaration(i.parent) && i.parent.name === i));
  const sektion = funktion(main, 'resetSektionBauen');
  check('der Knopf ruft weltZuruecksetzenStarten nur aus resetSektionBauen (nicht aus der Werkzeugleiste)', refs.length === 1 && !!sektion && refs[0]!.getStart() >= sektion.getStart() && refs[0]!.getEnd() <= sektion.getEnd(), `refs=${refs.length}`);
  const weltSektion = funktion(main, 'weltSektionBauen');
  check('resetSektionBauen hängt im Welt-Reiter (weltSektionBauen ruft sie)', !!weltSektion && alle(weltSektion, istAufruf).some((c) => aufrufName(c) === 'resetSektionBauen'));
  const texte = alle(main, (n): n is ts.StringLiteral => ts.isStringLiteralLike(n) && /welt-zuruecksetzen/.test(n.text));
  check('editorMain kennt den Pfad /api/welt-zuruecksetzen nicht selbst (nur weltZuruecksetzen.ts)', texte.length === 0, `n=${texte.length}`);
  const abgleich = funktion(main, 'testweltSchalten');
  check('der Wartebalken benutzt denselben Weg wie die Testwelt (dienstAbwarten → testweltStand)', (() => {
    const warten = funktion(main, 'dienstAbwarten');
    return !!warten && !!start && !!abgleich && alle(warten, istAufruf).some((c) => aufrufName(c) === 'testweltStand') && alle(start, istAufruf).some((c) => aufrufName(c) === 'dienstAbwarten') && alle(abgleich, istAufruf).some((c) => aufrufName(c) === 'dienstAbwarten');
  })());
}
{
  const dlg = funktion(dialog, 'weltZuruecksetzenDialog');
  check('Dialog: ausführen-Knopf wird über zustand.freigegeben() geschaltet (.disabled = …)', (() => {
    if (!dlg) return false;
    const zuweisung = alle(dlg, (n): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken).filter((b) => /\.disabled$/.test(b.left.getText()));
    const frei = alle(dlg, istAufruf).some((c) => aufrufName(c) === 'zustand.freigegeben');
    return zuweisung.length > 0 && frei;
  })());
  check('Dialog: die Auflösung geht durch zustand.ergebnis() (ein Klick durch die Sperre löst nichts auf)', !!dlg && alle(dlg, istAufruf).some((c) => aufrufName(c) === 'zustand.ergebnis'));
  check('Dialog: Abbrechen bekommt den Fokus, nicht das Eingabefeld', !!dlg && alle(dlg, istAufruf).some((c) => aufrufName(c) === 'abbrechen.focus') && !alle(dlg, istAufruf).some((c) => aufrufName(c) === 'eingabe.focus'));
  check('Dialog: kein Esc-Ausweg (weder ein Tastenhörer noch eine Taste „Escape“ im Code)', (() => {
    const tasten = alle(dialog, (n): n is ts.StringLiteral => ts.isStringLiteralLike(n) && /^(Escape|keydown|keyup)$/.test(n.text));
    const hoerer = alle(dialog, (n): n is ts.PropertyAccessExpression => ts.isPropertyAccessExpression(n) && /^(onkeydown|onkeyup)$/.test(n.name.text));
    return tasten.length === 0 && hoerer.length === 0;
  })());
}

console.log(fehler === 0 ? '\nAlle Prüfungen grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
