/**
 * Live sync of the world document, follow-up N3 (Editor E2, card K5.0 N3). Every case here is red at 4914829.
 *
 *  Z1b an entry the sanitizer CLAMPED (not dropped) in a field the user set counts like a dropped one: receipt
 *      `verworfen` with id and field, nothing applied (`yaw: "abc"`, `scale: 99`, `route`, `npc.rolle`); a felled
 *      tree stays felled through typo + correction. Number texts (`scale: "3"`) are NOT typos. Known behaviour, not
 *      code: a prefab typo (`Beeech1`) and an id typo (`T5`) are valid changes.
 *  Z5a a swallowed re-set (tombstone) is never "applied, all counters 0" without a hint: `zaehler.zurueck` and `detail`
 *  Z7a `quittungLoeschenSicher` through the guard logs exactly ONE `[WoV]` prefix
 *  (Z6: the limit is 40: `layout-live-grenze.ts`, `layout-live-n2.ts`)
 *
 * A REAL server runs; the world file is written like the operations service does (temp file + rename).
 * Own temp directory, every server on port 0.
 *
 * Run: npx tsx test/layout-live-n3.ts   (from server/)
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { geklemmteFelder } from '@wov/shared/src/worldlayout/sanitize.js';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';
import { LayoutWache } from '../src/world/layoutLive.js';
import type { ZDO } from '../src/zdo/ZDO.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function warteAuf(bed: () => boolean, ms = 8000): Promise<boolean> {
  const t0 = Date.now();
  while (!bed()) {
    if (Date.now() - t0 > ms) return false;
    await warte(10);
  }
  return true;
}

const SEED = 'LayoutLiveN3';
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-live-n3-'));
const WELTEN = join(WURZEL, 'worlds');
mkdirSync(WELTEN, { recursive: true });
const LAYOUT = join(WURZEL, 'layout.json');
const INSTANZ = 'liven3';
const QUITTUNG = quittungsDatei(WELTEN, INSTANZ);

type Platz = Record<string, unknown> & { id: string; prefab: string; x: number | string; z: number };
function dokument(placements: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Live-N3',
    detailSeed: SEED,
    continents: [],
    regions: [
      { id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] },
    ],
    defaultSpawn: [0, 0],
    placements,
    ...extra,
  };
}
function schreibe(text: string): string {
  const temp = `${LAYOUT}.probe.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, LAYOUT);
  return layoutHash(text);
}
const json = (d: unknown): string => JSON.stringify(d);
async function quittung(hash: string, ms = 5000): Promise<Quittung | null> {
  let q: Quittung | null = null;
  await warteAuf(() => {
    q = quittungLesen(QUITTUNG);
    return q?.hash === hash;
  }, ms);
  return q && (q as Quittung).hash === hash ? (q as Quittung) : null;
}

function starte(): ReturnType<typeof createWovServer> {
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: INSTANZ,
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: WELTEN,
    kontenDir: join(WURZEL, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
    saveIntervalMs: 3600_000,
  });
  server.start();
  return server;
}

const baeume = (n: number, ab = 0): Platz[] => Array.from({ length: n }, (_, i) => ({ id: `t${ab + i}`, prefab: 'Beech1', x: 30 + (ab + i) * 4, z: 20, ...(ab + i === 9 ? { yaw: 1 } : {}), ...(ab + i === 8 ? { npc: { rolle: 'haendler' } } : {}) }));

async function haupt(): Promise<void> {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const stumm = (): void => undefined;
  console.log = stumm;
  console.warn = stumm;
  const T = baeume(10);
  schreibe(json(dokument(T)));
  const server = starte();
  const layoutZdos = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
  const nach = (id: string): ZDO | undefined => layoutZdos().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);
  const ausgabe = (t: string, ok: boolean, d = ''): void => {
    console.log = orig.log;
    check(t, ok, d);
    console.log = stumm;
  };
  const mit = (id: string, f: (p: Platz) => Platz, liste: Platz[] = T): Platz[] => liste.map((p) => (p.id === id ? f(p) : p));
  try {
    await warteAuf(() => quittungLesen(QUITTUNG) !== null);
    ausgabe('set-up: 10 trees stand after the boot', layoutZdos().length === 10, `${layoutZdos().length}`);

    // ── Z1b: yaw "abc" on a felled tree ──
    server.zdos.destroyZDO(nach('t9')!.zdoid);
    let hash = schreibe(json(dokument(mit('t9', (p) => ({ ...p, yaw: 'abc' })))));
    let q = await quittung(hash);
    ausgabe('Z1b yaw "abc" on the felled tree t9: receipt verworfen', q?.ergebnis === 'nicht-angewendet' && q.grund === 'verworfen', `${q?.grund}: ${q?.detail}`);
    ausgabe('Z1b the receipt names id and field (t9, yaw)', /t9/.test(q?.detail ?? '') && /yaw/.test(q?.detail ?? ''), q?.detail ?? '');
    ausgabe('Z1b nothing applied: t9 stays felled, 9 layout ZDOs', !nach('t9') && layoutZdos().length === 9, `${layoutZdos().length}`);
    hash = schreibe(json(dokument(T)));
    q = await quittung(hash);
    ausgabe('Z1b typo + correction (the old state again): nothing revived, t9 stays felled', q?.ergebnis === 'angewendet' && !nach('t9') && layoutZdos().length === 9, `${q?.grund} ${JSON.stringify(q?.zaehler)}`);

    // ── Z1b: more clamped fields, each on its own ──
    const klemmProben: [string, Platz[], string][] = [
      ['scale 99 (clamped to 5)', mit('t9', (p) => ({ ...p, scale: 99 })), 'scale'],
      ['scale "abc"', mit('t9', (p) => ({ ...p, scale: 'abc' })), 'scale'],
      ['npc a text', mit('t8', (p) => ({ ...p, npc: 'x' })), 'npc'],
      ['npc.rolle a typo', mit('t8', (p) => ({ ...p, npc: { rolle: 'haendlerr' } })), 'npc.rolle'],
      ['yaw 99 (clamped)', mit('t9', (p) => ({ ...p, yaw: 99 })), 'yaw'],
    ];
    for (const [name, liste, feld] of klemmProben) {
      hash = schreibe(json(dokument(liste)));
      q = await quittung(hash);
      ausgabe(`Z1b ${name}: verworfen, the field ${feld} is named, t9 stays felled`, q?.grund === 'verworfen' && (q?.detail ?? '').includes(feld) && !nach('t9'), `${q?.grund}: ${q?.detail}`);
    }
    hash = schreibe(json(dokument(T)));
    await quittung(hash);

    // ── Z1b: number texts are NOT typos ──
    hash = schreibe(json(dokument(mit('t3', (p) => ({ ...p, scale: '3' })))));
    q = await quittung(hash);
    ausgabe('Z1b scale "3" (number text) is a change like any other: applied, aktualisiert = 1', q?.ergebnis === 'angewendet' && q.grund === null && q.zaehler?.aktualisiert === 1, `${q?.grund} ${JSON.stringify(q?.zaehler)}`);
    hash = schreibe(json(dokument(mit('t3', (p) => ({ ...p, scale: '3', yaw: ' 0.5 ' })))));
    q = await quittung(hash);
    ausgabe('Z1b yaw " 0.5 " (number text with blanks): applied', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.grund}: ${q?.detail}`);
    // Known behaviour (risk table, not code): a prefab typo and an id typo are valid, other entries.
    server.zdos.destroyZDO(nach('t7')!.zdoid);
    hash = schreibe(json(dokument(mit('t7', (p) => ({ ...p, prefab: 'Beeech1' }), mit('t3', (p) => ({ ...p, scale: '3', yaw: ' 0.5 ' }))))));
    q = await quittung(hash);
    ausgabe('known: a prefab typo (Beeech1) is a valid change: applied, not verworfen', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.grund}: ${q?.detail}`);
    hash = schreibe(json(dokument(mit('t8', (p) => ({ ...p, id: 'T8' }), mit('t3', (p) => ({ ...p, scale: '3', yaw: ' 0.5 ' }))))));
    q = await quittung(hash);
    ausgabe('known: an id typo (T8) is a valid change: applied, not verworfen', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.grund}: ${q?.detail}`);

    // ── Z5a: a swallowed re-set is reported ──
    const Z = baeume(10).map((p) => (p.id === 't9' ? { id: 't9', prefab: 'Beech1', x: 66, z: 20 } : p)); // fresh baseline
    hash = schreibe(json(dokument(Z)));
    await quittung(hash);
    server.zdos.destroyZDO(nach('t5')!.zdoid);
    hash = schreibe(json(dokument(Z.filter((p) => p.id !== 't5'))));
    q = await quittung(hash);
    ausgabe('Z5a felled tree deleted: applied, zurueck = 0', q?.ergebnis === 'angewendet' && q.zaehler?.zurueck === 0, JSON.stringify(q?.zaehler));
    hash = schreibe(json(dokument(Z)));
    q = await quittung(hash);
    ausgabe('Z5a the same entry again: the tombstone swallows it, no tree', !nach('t5') && q?.zaehler?.gespawnt === 0, JSON.stringify(q?.zaehler));
    ausgabe('Z5a ... and the receipt says so: zaehler.zurueck = 1, detail names t5', q?.zaehler?.zurueck === 1 && /t5/.test(q?.detail ?? ''), `${JSON.stringify(q?.zaehler)} ${q?.detail}`);
    hash = schreibe(json(dokument([...Z, { id: 'neu-9', prefab: 'Beech1', x: 300, z: 20 }])));
    q = await quittung(hash);
    ausgabe('Z5a an ordinary write: zurueck = 0, no detail', q?.zaehler?.zurueck === 0 && !q?.detail, JSON.stringify(q));
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await warte(300);
  }

  // ── Z1b unit: the clamped fields, table ──
  const tabelle: [string, unknown, string[]][] = [
    ['plain entry', { prefab: 'a', x: 1, z: 1 }, []],
    ['yaw number in range', { yaw: 3 }, []],
    ['yaw text "abc"', { yaw: 'abc' }, ['yaw']],
    ['yaw empty text', { yaw: '' }, ['yaw']],
    ['yaw true', { yaw: true }, ['yaw']],
    ['yaw null counts as missing', { yaw: null }, []],
    ['yaw hex text "0x10" is not read as a number', { yaw: '0x10' }, ['yaw']],
    ['scale "3"', { scale: '3' }, []],
    ['scale "1e0"', { scale: '1e0' }, []],
    ['scale 99', { scale: 99 }, ['scale']],
    ['scale 0', { scale: 0 }, ['scale']],
    ['scale "Infinity"', { scale: 'Infinity' }, ['scale']],
    ['einebnen 500', { einebnen: 500 }, ['einebnen']],
    ['einebnen 2.55 (rounding only)', { einebnen: 2.55 }, []],
    ['route with a blank', { route: 'a b' }, ['route']],
    ['route valid', { route: 'nordweg' }, []],
    ['npc.stufe "x"', { npc: { stufe: 'x' } }, ['npc.stufe']],
    ['npc.stufe 2.5 (rounding only)', { npc: { stufe: 2.5 } }, []],
    ['prefab typo is not a clamped field', { prefab: 'Beeech1' }, []],
    ['id typo is not a clamped field', { id: 'T5' }, []],
  ];
  for (const [name, roh, erwartet] of tabelle) {
    const ist = geklemmteFelder(roh);
    check(`geklemmteFelder: ${name}`, JSON.stringify(ist) === JSON.stringify(erwartet), JSON.stringify(ist));
  }

  // ── Z7a: one [WoV] prefix ──
  const z7 = join(WURZEL, 'z7');
  mkdirSync(join(z7, 'quittung-ist-ordner', 'inhalt'), { recursive: true });
  const zeilen: string[] = [];
  console.error = (...a: unknown[]): void => void zeilen.push(a.map(String).join(' '));
  try {
    new LayoutWache({ pfad: join(z7, 'welt.json'), quittungsPfad: join(z7, 'quittung-ist-ordner'), aktuell: () => null, speichertGerade: () => false, anwenden: () => ({ art: 'abgelehnt', grund: 'x' }), uebernehmen: () => undefined });
  } finally {
    console.error = orig.error;
  }
  const z = zeilen.find((t) => /Quittung nicht gelöscht/.test(t)) ?? '';
  check('Z7a the guard logs the failed delete with ONE [WoV] prefix', (z.match(/\[WoV\]/g) ?? []).length === 1 && z.startsWith('[WoV] Layout-Wache:'), z);
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts'), 'utf-8');
  check('Z7a main.ts passes its own prefix (the helper has none)', /quittungLoeschenSicher\(quittungsDatei\([^\n]*\[WoV\] \$\{text\}/.test(main));
}

try {
  await haupt();
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
