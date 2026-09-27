/**
 * Live sync of the world document, follow-up N2 (Editor E2, card K5.0 N2). Every case here is red at 0395005.
 *
 *  Z1  a typo in ONE entry (x: "abc") applies NOTHING live: receipt `verworfen` with the id in `detail`,
 *      0 ZDOs removed, the change of a valid entry in the same write waits; after the correction a felled
 *      tree stays felled
 *  Z5  the change detection compares normalised entries: `yaw: 0` / `scale: 1` added, or the keys in another
 *      order, revive nothing; delete + save + undo + save revives a felled tree neither (tombstone); a
 *      deleted tree that STOOD comes back (new ZDO) when the entry returns
 *  Z6  more than 40 new / changed / removed entries in one write (limit lowered from 100 to 50 to 40 in N3): receipt
 *      `zu-viele-aenderungen` with the number, nothing applied; exactly 40 apply
 *  Z4  boot with `placements: null` (after a run with felled trees): the receipt says `abgelehnt` with the
 *      reason, not "applied"; the corrected file afterwards revives nothing
 *  Z7  `quittungLoeschenSicher` swallows an error (a directory instead of the file) and logs it; a
 *      source check that `main.ts` calls that and not the bare delete
 *
 * A REAL server runs (real 1-second block of update()); the world file is written the way the operations
 * service writes it: temp file + rename. Own temp directory, every server on port 0.
 *
 * Run: npx tsx test/layout-live-n2.ts   (from server/)
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungLoeschenSicher, quittungSchreiben, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';
import { quittungAbwarten } from '../../admin/src/routen/anwendung.js';
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

const SEED = 'LayoutLiveN2';
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-live-n2-'));
const WELTEN = join(WURZEL, 'worlds');
mkdirSync(WELTEN, { recursive: true });
const LAYOUT = join(WURZEL, 'layout.json');
const INSTANZ = 'liven2';
const QUITTUNG = quittungsDatei(WELTEN, INSTANZ);

type Platz = Record<string, unknown> & { id: string; prefab: string; x: number | string; z: number };
function dokument(placements: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Live-N2',
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

const baeume = (n: number, ab = 0): Platz[] => Array.from({ length: n }, (_, i) => ({ id: `t${ab + i}`, prefab: 'Beech1', x: 30 + (ab + i) * 4, z: 20 }));

async function haupt(): Promise<void> {
  const zeilen: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const faenge = (w: (...a: unknown[]) => void) => (...a: unknown[]): void => {
    const z = a.map(String).join(' ');
    if (z.includes('Layout-')) zeilen.push(z);
    w(...a);
  };
  const stumm = (...a: unknown[]): void => {
    const z = a.map(String).join(' ');
    if (z.includes('Layout-')) zeilen.push(z);
  };
  void faenge;
  console.log = stumm;
  console.warn = stumm;

  const T = baeume(10);
  schreibe(json(dokument(T)));
  let server = starte();
  const layoutZdos = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
  const nach = (id: string): ZDO | undefined => layoutZdos().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);
  const ausgabe = (t: string, ok: boolean, d = ''): void => {
    console.log = orig.log;
    check(t, ok, d);
    console.log = stumm;
  };
  try {
    await warteAuf(() => quittungLesen(QUITTUNG) !== null);
    ausgabe('set-up: 10 trees stand after the boot', layoutZdos().length === 10, `${layoutZdos().length}`);

    // ── Z1 ──
    // t5 is felled the way handleHarvest does it.
    server.zdos.destroyZDO(nach('t5')!.zdoid);
    const t3vorher = nach('t3')!.zdoid.toString();
    let hash = schreibe(json(dokument(T.map((p) => (p.id === 't3' ? { ...p, x: 'abc' } : p)))));
    let q = await quittung(hash);
    ausgabe('Z1 a typo in one entry: receipt not applied, grund verworfen', q?.ergebnis === 'nicht-angewendet' && q.grund === 'verworfen', `${q?.grund}: ${q?.detail}`);
    ausgabe('Z1 the receipt names the entry (t3)', (q?.detail ?? '').includes('t3'), q?.detail ?? '');
    ausgabe('Z1 nothing removed: t3 still there with the same zdoid, 9 layout ZDOs (t5 felled)', nach('t3')?.zdoid.toString() === t3vorher && layoutZdos().length === 9, `${layoutZdos().length}`);
    // The typo AND a valid new entry in the same write: the new one waits.
    hash = schreibe(json(dokument([...T.map((p) => (p.id === 't3' ? { ...p, x: 'abc' } : p)), { id: 'neu-1', prefab: 'Beech1', x: 300, z: 20 }])));
    q = await quittung(hash);
    ausgabe('Z1 typo + valid new entry in one write: nothing applied (the new one waits)', q?.grund === 'verworfen' && !nach('neu-1'), `${q?.grund}`);
    // The correction: t5 must stay felled, only the new entry appears.
    hash = schreibe(json(dokument([...T, { id: 'neu-1', prefab: 'Beech1', x: 300, z: 20 }])));
    q = await quittung(hash);
    ausgabe('Z1 the correction applies only what is new: gespawnt = 1, entfernt = 0', q?.ergebnis === 'angewendet' && q.zaehler?.gespawnt === 1 && q.zaehler?.entfernt === 0, JSON.stringify(q?.zaehler));
    ausgabe('Z1 typo + correction together do not revive the felled tree t5', !nach('t5') && !!nach('neu-1') && nach('t3')?.zdoid.toString() === t3vorher);

    // ── Z5 ──
    const Tn = [...T, { id: 'neu-1', prefab: 'Beech1', x: 300, z: 20 }];
    const mit = (f: (p: Platz) => Platz): Platz[] => Tn.map((p) => (p.id === 't5' ? f(p) : p));
    const proben: [string, Platz[]][] = [
      ['yaw: 0 added', mit((p) => ({ ...p, yaw: 0 }))],
      ['scale: 1 added', mit((p) => ({ ...p, scale: 1 }))],
      ['yaw: 0 and scale: 1 added, keys in another order', mit((p) => ({ scale: 1, z: p.z, yaw: 0, x: p.x, prefab: p.prefab, id: p.id }))],
    ];
    for (const [name, liste] of proben) {
      hash = schreibe(json(dokument(liste)));
      q = await quittung(hash);
      ausgabe(`Z5 ${name}: applied, gespawnt = 0, the felled tree stays felled`, q?.ergebnis === 'angewendet' && q.zaehler?.gespawnt === 0 && !nach('t5'), JSON.stringify(q?.zaehler));
    }
    // delete + save, then undo + save
    hash = schreibe(json(dokument(Tn.filter((p) => p.id !== 't5'))));
    q = await quittung(hash);
    ausgabe('Z5 delete of a felled tree: applied', q?.ergebnis === 'angewendet' && !nach('t5'), JSON.stringify(q?.zaehler));
    hash = schreibe(json(dokument(Tn)));
    q = await quittung(hash);
    ausgabe('Z5 undo (the entry returns unchanged): applied, gespawnt = 0, the tree stays felled', q?.ergebnis === 'angewendet' && q.zaehler?.gespawnt === 0 && !nach('t5'), JSON.stringify(q?.zaehler));
    // A tree that STOOD, deleted and put back: it was destroyed by the delete, so it must come back.
    hash = schreibe(json(dokument(Tn.filter((p) => p.id !== 't7'))));
    q = await quittung(hash);
    const weg = !nach('t7');
    hash = schreibe(json(dokument(Tn)));
    q = await quittung(hash);
    ausgabe('Z5 a tree that stood: deleted (gone), then put back (a new ZDO, gespawnt = 1)', weg && q?.zaehler?.gespawnt === 1 && !!nach('t7'), JSON.stringify(q?.zaehler));
    // The entry returns with a DIFFERENT content: it is new and spawns.
    hash = schreibe(json(dokument(Tn.filter((p) => p.id !== 't5'))));
    await quittung(hash);
    hash = schreibe(json(dokument(mit((p) => ({ ...p, x: 77 })))));
    q = await quittung(hash);
    ausgabe('Z5 the felled tree returns with another position: it is new, gespawnt = 1', q?.zaehler?.gespawnt === 1 && !!nach('t5'), JSON.stringify(q?.zaehler));

    // ── Z6 ──
    const vorZ6 = layoutZdos().length;
    const stand = mit((p) => ({ ...p, x: 77 }));
    hash = schreibe(json(dokument([...stand, ...baeume(41, 100)])));
    q = await quittung(hash);
    ausgabe('Z6 41 new entries: receipt zu-viele-aenderungen with the number, nothing applied', q?.ergebnis === 'nicht-angewendet' && q.grund === 'zu-viele-aenderungen' && (q.detail ?? '').includes('41') && layoutZdos().length === vorZ6, `${q?.grund}: ${q?.detail}`);
    hash = schreibe(json(dokument([...stand, ...baeume(40, 100)])));
    q = await quittung(hash);
    ausgabe('Z6 exactly 40 new entries: applied, gespawnt = 40', q?.ergebnis === 'angewendet' && q.zaehler?.gespawnt === 40 && layoutZdos().length === vorZ6 + 40, JSON.stringify(q?.zaehler));
    hash = schreibe(json(dokument(stand.slice(0, 5))));
    q = await quittung(hash);
    ausgabe('Z6 removing 40+ entries is refused by the limit as well', q?.ergebnis === 'nicht-angewendet' && (q.grund === 'zu-viele-aenderungen' || q.grund === 'bestaetigung-noetig'), `${q?.grund}: ${(q?.detail ?? '').slice(0, 60)}`);

    // ── Z4 ──
    // Run 1 ends with two felled trees saved; run 2 boots with `placements: null`.
    server.zdos.destroyZDO(nach('t2')!.zdoid);
    server.zdos.destroyZDO(nach('t4')!.zdoid);
    hash = schreibe(json(dokument(stand.slice(0, 8))));
    await quittung(hash);
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await warte(300);
    console.log = stumm;
    console.warn = stumm;
    schreibe(json(dokument(null)));
    server = starte();
    hash = layoutHash(readFileSync(LAYOUT));
    q = await quittung(hash);
    ausgabe('Z4 boot with placements: null: the receipt is NOT "applied", grund abgelehnt with the reason', q?.ergebnis === 'nicht-angewendet' && q.grund === 'abgelehnt' && /Start/.test(q.detail ?? ''), `${q?.ergebnis} ${q?.grund}: ${q?.detail}`);
    ausgabe('Z4 the boot left the world alone (t2 and t4 still felled)', !nach('t2') && !nach('t4') && layoutZdos().length > 0, `${layoutZdos().length}`);
    hash = schreibe(json(dokument(stand.slice(0, 8))));
    q = await quittung(hash);
    ausgabe('Z4 the corrected file: nothing applied live (no baseline), felled trees t2 and t4 stay felled', q?.ergebnis === 'nicht-angewendet' && !nach('t2') && !nach('t4'), `${q?.ergebnis} ${q?.grund}: ${q?.detail}`);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await warte(300);
  }

  // ── the operations service passes the new reasons on (200/202 answer is built from them) ──
  for (const grund of ['verworfen', 'zu-viele-aenderungen'] as const) {
    const pfad = join(WURZEL, `q-${grund}.json`);
    quittungSchreiben(pfad, { hash: 'h1', ergebnis: 'nicht-angewendet', grund, detail: 'detail-text', zaehler: null, zeit: new Date().toISOString() });
    const stand = await quittungAbwarten({ hash: 'h1', quittungsPfad: pfad, dienstAktiv: async () => true, warteMs: 500 });
    check(`admin: receipt grund ${grund} is passed on (not turned into abgelehnt)`, !stand.angewendet && stand.grund === grund && stand.detail === 'detail-text', JSON.stringify(stand));
  }

  // ── Z7 ──
  const ordner = join(WURZEL, 'z7');
  mkdirSync(join(ordner, 'quittung-ist-ordner', 'inhalt'), { recursive: true });
  const meldungen: string[] = [];
  let geworfen = false;
  let ergebnis = true;
  try {
    ergebnis = quittungLoeschenSicher(join(ordner, 'quittung-ist-ordner'), (t) => meldungen.push(t));
  } catch {
    geworfen = true;
  }
  check('Z7 quittungLoeschenSicher: an error does not throw, is logged, returns false', !geworfen && ergebnis === false && meldungen.length === 1 && /Quittung nicht gelöscht/.test(meldungen[0] ?? ''), `${geworfen} ${ergebnis} ${meldungen.join('|')}`);
  writeFileSync(join(ordner, 'q.json'), '{}');
  check('Z7 a normal file is removed, returns true', quittungLoeschenSicher(join(ordner, 'q.json'), () => undefined) === true && !existsSync(join(ordner, 'q.json')));
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts'), 'utf-8');
  check('Z7 main.ts deletes the old receipt through the safe variant only', /quittungLoeschenSicher\(quittungsDatei\(/.test(main) && !/[^\w]quittungLoeschen\(/.test(main));
}

try {
  await haupt();
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
