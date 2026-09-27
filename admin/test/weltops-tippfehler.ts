/**
 * Editor E2, card K5.0 N4: the operations service REFUSES a world document with typed-wrong placements (422, list
 * `{ id, feld, wert }`, nothing written), and tells editor and MCP what a live apply held back.
 *
 *   npx tsx test/weltops-tippfehler.ts      (from admin/)
 *
 * The real operations service (admin/src/main.ts, WOV_WURZEL = temp directory, port 0) runs against a REAL game
 * server (in this process, layout mode, own temp world directory, port 0). The world file is written ONLY through
 * the service, except the last case, which tests the second safeguard (the game server's own check on a file
 * written behind the service's back). Nothing is written to server/data/.
 *
 * The attack on N3 (probes A, B, E, G) ran through the service and got 200 plus a revived / deleted tree. Here:
 *  A  yaw: "abc" on a felled tree            B  x: "abc" on a standing tree
 *  E  scale: null on a felled tree           G  key typo `Yaw` on a felled tree
 *  each: 422 `ungueltig`, the list names id + field + value, the file is byte-identical, no backup written, no tree
 *  revived or deleted.
 *  Further: einebnen / npc.stufe null, npc name cut, npc [], unknown npc key, x missing, entry not an object, all in
 *  one list; a number as text ("3") is NOT an error (200); PATCH with a typed-wrong `nachher` (422, nothing written);
 *  a valid PATCH still applies (200).
 *  N3-B: a felled tree deleted and put back: 200, `zaehler.zurueck` = 1 and `detail` in the ANSWER; the editor's
 *  sentence (`wirkungsText`) and the MCP's (`wirkungsHinweis`) both say a re-set was held back and name the id.
 *  Editor and MCP show the 422 list: `schreibeWeltdokument` (editor code, real service) and `schreibe` (MCP code).
 *  The second safeguard: the same typo in a file written raw is still refused by the game server (receipt `verworfen`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../../server/src/WovServer.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltops-tippfehler-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'tippfehler-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

type Platz = Record<string, unknown> & { id: string };
const baeume = (n: number): Platz[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 20 + i * 12, z: 20, ...(i === 9 ? { yaw: 1 } : {}) }));
const dokument = (placements: unknown): Record<string, unknown> => ({
  version: 1,
  name: 'Tippfehler',
  detailSeed: 'tippfehler',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
  defaultSpawn: [0, 0],
  placements,
});
const T = baeume(10);
// The set-up file is written by hand ONCE (the game server needs a file to boot); every later write goes through the service.
writeFileSync(WELT_DATEI, JSON.stringify(dokument(T), null, 2));

let dienst = null as ChildProcess | null;
function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WURZEL: ORDNER, WOV_WELT_VERZEICHNIS: WELTEN, NODE_ENV: 'test', WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI, WOV_SYSTEMCTL: SYSTEMCTL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zeit = setTimeout(() => scheitern(new Error(`service does not start:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeit);
        fertig(Number(t[1]));
      }
    };
    dienst.stdout!.on('data', auf);
    dienst.stderr!.on('data', auf);
  });
}
const port = await dienstStarten();

// The MCP code talks to the same service: its constants are read at import, so set them first.
process.env.WOV_ADMIN_URL = `http://127.0.0.1:${port}`;
process.env.WOV_ADMIN_TOKEN = TOKEN;
process.env.WOV_MCP_FREMDE_WELT = '1';
// Editor and MCP code are loaded by a path in a variable: the admin package is type-checked without the DOM lib
// and without the MCP SDK's types, and this test only calls their functions (the packages check their own files).
const laden = (pfad: string): Promise<unknown> => import(pfad);
const mcp = (await laden(resolve(HIER, '../../tools/worldlayout-mcp/kern.ts'))) as {
  wirkungsHinweis(status: number, daten: Record<string, unknown>): string;
  lade(): Promise<unknown>;
  schreibe(layout: unknown, basis: string): Promise<string>;
};
const { schreibeWeltdokument, wirkungsText } = (await laden(resolve(HIER, '../../client/src/editor/weltdokument.ts'))) as {
  schreibeWeltdokument(layout: unknown, basis: string | null, fetchFn: typeof fetch): Promise<{ art: string; message: string }>;
  wirkungsText(a: { art: 'ok'; message: string; hash: string | null; angewendet: boolean | null; grund: string | null; detail: string | null; zurueck?: number }): string;
};

let server = createWovServer({
  port: 0,
  worldName: 'dev',
  worldSeed: 'tippfehler',
  worldFeatures: false,
  worldVegetation: false,
  worldsDir: SPIELSTAENDE,
  kontenDir: resolve(ORDNER, 'konten'),
  worldMode: 'layout',
  worldLayoutPath: WELT_DATEI,
  saveIntervalMs: 3600_000,
});
server.start();
writeFileSync(LAEUFT, '');

interface Daten {
  ok?: boolean;
  hash?: string;
  fehler?: string;
  grund?: string;
  detail?: string;
  message?: string;
  angewendet?: boolean;
  zaehler?: Record<string, number>;
  fehlerhaft?: { id: string; feld: string; wert: unknown }[];
  anzahlFehlerhaft?: number;
  layout: { placements: Platz[] };
}
async function anfrage(methode: 'GET' | 'POST' | 'PATCH', pfad: string, leib?: unknown, ifMatch?: string): Promise<{ status: number; daten: Daten }> {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: { 'x-wov-token': TOKEN, ...(leib !== undefined ? { 'content-type': 'application/json' } : {}), ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Daten };
}
const layoutZdos = () => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
const nach = (id: string) => layoutZdos().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);
const dateiHash = (): string => layoutHash(readFileSync(WELT_DATEI));
const dateiListe = (): string => readdirSync(WELTEN).sort().join(',');
const schlafen = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const stumm = (): void => undefined;
/** The document of the FILE with `aendern` applied to the placements, sent as POST with the file's hash as base. */
async function post(placements: unknown): Promise<{ status: number; daten: Daten; basis: string }> {
  const basis = dateiHash();
  const r = await anfrage('POST', '/api/worldlayout', dokument(placements), basis);
  return { ...r, basis };
}
const gleicheDatei = (basis: string, liste: string): boolean => dateiHash() === basis && dateiListe() === liste;
const findet = (d: Daten, id: string, feld: string): { id: string; feld: string; wert: unknown } | undefined => d.fehlerhaft?.find((f) => f.id === id && f.feld === feld);

const orig = { log: console.log, warn: console.warn };
try {
  console.log = stumm;
  console.warn = stumm;
  const q = quittungsDatei(SPIELSTAENDE, 'dev');
  for (let i = 0; i < 300 && !existsSync(q); i++) await schlafen(20);
  console.log = orig.log;
  check('set-up: 10 trees stand after the boot', layoutZdos().length === 10, `${layoutZdos().length}`);
  console.log = stumm;
  const ausgabe = (t: string, ok: boolean, d = ''): void => {
    console.log = orig.log;
    check(t, ok, d);
    console.log = stumm;
  };

  // The file goes through the service once (hash for the base), then it is only ever refused or applied.
  const sauber = await post(T);
  ausgabe('set-up: the clean document goes through the service (200)', sauber.status === 200 || sauber.status === 202, `${sauber.status}`);
  await schlafen(1300);
  const nachHash = dateiHash();
  const nachListe = dateiListe();
  const zdosVorher = layoutZdos().length;

  // ── A, B, E, G (the attack's probes) ──
  server.zdos.destroyZDO(nach('t9')!.zdoid);
  server.zdos.destroyZDO(nach('t7')!.zdoid);
  server.zdos.destroyZDO(nach('t1')!.zdoid);
  const t3 = nach('t3')!.zdoid.toString();
  const stehen = layoutZdos().length; // 7

  const probeA = await post(T.map((p) => (p.id === 't9' ? { ...p, yaw: 'abc' } : p)));
  ausgabe('A yaw "abc" on a felled tree: 422 ungueltig with grund ungueltig', probeA.status === 422 && probeA.daten.fehler === 'ungueltig' && probeA.daten.grund === 'ungueltig', `${probeA.status} ${probeA.daten.fehler}`);
  ausgabe('A the list names t9, yaw, "abc"', findet(probeA.daten, 't9', 'yaw')?.wert === 'abc', JSON.stringify(probeA.daten.fehlerhaft));
  ausgabe('A the file is byte-identical, no backup written', gleicheDatei(nachHash, nachListe));

  const probeB = await post(T.map((p) => (p.id === 't3' ? { ...p, x: 'abc' } : p)));
  ausgabe('B x "abc" on a standing tree: 422, list names t3 x', probeB.status === 422 && findet(probeB.daten, 't3', 'x')?.wert === 'abc', `${probeB.status} ${JSON.stringify(probeB.daten.fehlerhaft)}`);

  const probeE = await post(T.map((p) => (p.id === 't7' ? { ...p, scale: null } : p)));
  ausgabe('E scale null on a felled tree: 422, list names t7 scale null', probeE.status === 422 && findet(probeE.daten, 't7', 'scale') !== undefined && findet(probeE.daten, 't7', 'scale')?.wert === null, `${probeE.status} ${JSON.stringify(probeE.daten.fehlerhaft)}`);

  const probeG = await post(T.map((p) => (p.id === 't1' ? { id: p.id, prefab: p.prefab, x: p.x, z: p.z, Yaw: 2 } : p)));
  ausgabe('G key typo Yaw on a felled tree: 422, list names t1 Yaw', probeG.status === 422 && findet(probeG.daten, 't1', 'Yaw')?.wert === 2, `${probeG.status} ${JSON.stringify(probeG.daten.fehlerhaft)}`);

  await schlafen(1500); // a wrong 200 would have been applied within a second
  ausgabe('A/B/E/G: nothing written (hash + directory unchanged), nothing revived, nothing deleted', gleicheDatei(nachHash, nachListe) && layoutZdos().length === stehen && !nach('t9') && !nach('t7') && !nach('t1') && nach('t3')?.zdoid.toString() === t3, `${layoutZdos().length} ZDOs`);

  // ── the rest of the list ──
  const vieles = await post(
    T.map((p) => {
      if (p.id === 't0') return { ...p, einebnen: null };
      if (p.id === 't2') return { ...p, npc: { stufe: null } };
      if (p.id === 't4') return { ...p, npc: { name: 'x'.repeat(40) } };
      if (p.id === 't5') return { ...p, npc: [] };
      if (p.id === 't6') return { ...p, npc: { name: 'Ok', Rolle: 'wache' } };
      if (p.id === 't8') return { ...p, x: undefined };
      return p;
    }).concat([{ id: 'x1', prefab: 'Beech1', x: 3, z: 3 }, 'kein Objekt' as unknown as Platz])
  );
  const l = vieles.daten;
  ausgabe(
    'more: einebnen null, npc.stufe null, npc.name 40 chars, npc [], npc.Rolle, x missing, entry not an object: one 422 with all of them',
    vieles.status === 422 && !!findet(l, 't0', 'einebnen') && !!findet(l, 't2', 'npc.stufe') && !!findet(l, 't4', 'npc.name') && !!findet(l, 't5', 'npc') && !!findet(l, 't6', 'npc.Rolle') && !!findet(l, 't8', 'x') && (l.fehlerhaft ?? []).some((f) => f.feld === 'eintrag'),
    `${vieles.status} ${JSON.stringify(l.fehlerhaft?.map((f) => `${f.id}.${f.feld}`))}`
  );
  ausgabe('more: the count of the answer is the length of the list (7)', l.anzahlFehlerhaft === 7 && l.fehlerhaft?.length === 7, `${l.anzahlFehlerhaft}`);
  ausgabe('more: nothing written', gleicheDatei(nachHash, nachListe));

  // ── PATCH ──
  const patch = async (nachher: Record<string, unknown>) => anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v1', ops: [{ art: 'setze', sammlung: 'placements', id: 't3-neu', nachher }] });
  const pFalsch = await patch({ id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, yaw: 'abc' });
  ausgabe('PATCH nachher yaw "abc": 422 ungueltig, list names t3-neu yaw', pFalsch.status === 422 && pFalsch.daten.fehler === 'ungueltig' && findet(pFalsch.daten, 't3-neu', 'yaw')?.wert === 'abc', `${pFalsch.status} ${JSON.stringify(pFalsch.daten.fehlerhaft)}`);
  const pKey = await patch({ id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, Yaw: 2 });
  ausgabe('PATCH nachher with the key Yaw: 422, list names it', pKey.status === 422 && !!findet(pKey.daten, 't3-neu', 'Yaw'), `${pKey.status}`);
  ausgabe('PATCH refused: file unchanged, no backup', gleicheDatei(nachHash, nachListe));
  const pGut = await patch({ id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, yaw: 2, scale: '3' });
  ausgabe('PATCH valid (yaw 2, scale as text "3"): 200 applied, gespawnt = 1', pGut.status === 200 && pGut.daten.angewendet === true && pGut.daten.zaehler?.gespawnt === 1 && !!nach('t3-neu'), `${pGut.status} ${JSON.stringify(pGut.daten.zaehler)}`);

  // ── numbers as text are not an error ──
  const text = await post([...T.filter((p) => p.id !== 't3-neu'), { id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, yaw: 2, scale: '3' }, ...[]]);
  ausgabe('a number as text (scale "3", yaw 2): 200, not an error', text.status === 200 && text.daten.fehlerhaft === undefined, `${text.status}`);

  // ── N3-B: a felled tree deleted, then put back ──
  server.zdos.destroyZDO(nach('t6')!.zdoid);
  const ohne6 = T.filter((p) => p.id !== 't6');
  const weg = await post([...ohne6, { id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, yaw: 2, scale: '3' }]);
  ausgabe('B set-up: the felled t6 deleted: 200 applied', weg.status === 200 && weg.daten.angewendet === true, `${weg.status}`);
  const zurueck = await post([...T, { id: 't3-neu', prefab: 'Beech1', x: 400, z: 20, yaw: 2, scale: '3' }]);
  const zd = zurueck.daten;
  ausgabe('B t6 put back: 200 applied, zaehler.zurueck = 1, detail (with the id) IN THE ANSWER', zurueck.status === 200 && zd.angewendet === true && zd.zaehler?.zurueck === 1 && (zd.detail ?? '').includes('t6'), `${zurueck.status} ${JSON.stringify(zd.zaehler)} ${zd.detail}`);
  ausgabe('B t6 did not come back (the tombstone held)', !nach('t6'));
  const satz = wirkungsText({ art: 'ok', message: '', hash: zd.hash ?? null, angewendet: true, grund: null, detail: zd.detail ?? null, zurueck: zd.zaehler?.zurueck ?? 0 });
  ausgabe('B editor sentence: live applied, 1 re-set held back, the id', /live angewendet/.test(satz) && /1 Neusetzen/.test(satz) && satz.includes('t6'), satz);
  ausgabe('B editor sentence without a re-set is unchanged', wirkungsText({ art: 'ok', message: '', hash: null, angewendet: true, grund: null, detail: null }) === ' — live angewendet.');
  const hinweis = mcp.wirkungsHinweis(zurueck.status, zd as unknown as Record<string, unknown>);
  ausgabe('B MCP sentence: applied, BUT 1 re-set held back, the id', /angewendet, ABER 1 Neusetzen/.test(hinweis) && hinweis.includes('t6'), hinweis);
  ausgabe('B MCP sentence without a re-set is unchanged', mcp.wirkungsHinweis(200, { angewendet: true, zaehler: { gespawnt: 1 } }) === '\nIm laufenden Spiel angewendet.');

  // ── editor and MCP show the 422 list (their code, the real service) ──
  const editorFetch = ((url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-wov-token': TOKEN } })) as typeof fetch;
  const basisJetzt = dateiHash();
  const listeJetzt = dateiListe();
  const kaputt = dokument(T.map((p) => (p.id === 't9' ? { ...p, yaw: 'abc' } : p)));
  const ed = await schreibeWeltdokument(kaputt, basisJetzt, editorFetch);
  ausgabe('editor: saving shows the 422 list (id, field, value), not "HTTP 422"', ed.art === 'fehler' && /t9 yaw="abc"/.test(ed.message) && /1 Fehler/.test(ed.message), ed.message);
  let mcpText = '';
  try {
    await mcp.lade();
    await mcp.schreibe(kaputt, basisJetzt);
  } catch (e) {
    mcpText = (e as Error).message;
  }
  ausgabe('MCP: the error carries the list for the AI (id, field, value)', /t9: yaw = "abc"/.test(mcpText) && /korrigieren/.test(mcpText), mcpText);
  ausgabe('editor + MCP refusals wrote nothing', dateiHash() === basisJetzt && dateiListe() === listeJetzt);

  // ── the second safeguard: the same typo in a file written behind the service's back ──
  const stand = JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { placements: Platz[] };
  const rohHash = ((): string => {
    const tmp = `${WELT_DATEI}.roh.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...stand, placements: stand.placements.map((p) => (p.id === 't9' ? { ...p, yaw: 'abc' } : p)) }, null, 2));
    renameSync(tmp, WELT_DATEI);
    return dateiHash();
  })();
  let rq = quittungLesen(q);
  for (let i = 0; i < 60 && rq?.hash !== rohHash; i++) {
    await schlafen(100);
    rq = quittungLesen(q);
  }
  ausgabe('second safeguard: a raw file with yaw "abc" gets the receipt verworfen, t9 stays felled', rq?.hash === rohHash && rq.grund === 'verworfen' && !nach('t9'), `${rq?.grund}: ${rq?.detail}`);
  void zdosVorher;
} finally {
  console.log = orig.log;
  console.warn = orig.warn;
  dienst?.kill('SIGTERM');
  try {
    server.stop();
  } catch {
    /* already stopped */
  }
  await schlafen(500);
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
