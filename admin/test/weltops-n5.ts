/**
 * Editor E2, card K5.0 N5: a set but invalid `id` and duplicate ids with different content are refused (422),
 * `placement_set` reports what it clamped, `ops_apply` with a `vorher` from `area_describe` can be undone, and a save
 * without a change does not repeat the counters of the previous receipt.
 *
 *   npx tsx test/weltops-n5.ts      (from admin/)
 *
 * The real operations service (admin/src/main.ts, WOV_WURZEL = temp directory, port 0) runs against a REAL game
 * server (in this process, layout mode, own temp world directory, port 0) and the REAL MCP server (stdio, the
 * tools/worldlayout-mcp process) talks to that service. The world file is written by hand ONCE (the game server needs
 * a file to boot); every later write goes through the service. Nothing is written to server/data/.
 *
 *  P1..P4  (N4-A)  id "T9" / "t3 " / "t5ä" / 7 on trees: 422, `feld: "id"`, file byte-identical, felled trees stay felled,
 *                  the standing tree is neither deleted nor respawned
 *  P5, P6  (N4-B)  the copy of a felled / a standing tree with the same id and other content: 422 `doppelt`; P6b: exact
 *                  duplicate (same id, same content): 200, folded
 *  M2..M5  (N4-D)  MCP `ops_apply` with `vorher` from `area_describe` (aendere / entferne), then `undo_last`: both work
 *  M7, M8  (N4-E)  MCP `placement_set` with yaw 90, scale 12, einebnen 150: the answer lists {id, feld, wert, neu}
 *  F       (N4-F)  the same document saved twice: the second answer says `unveraendert` and counts 0
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../../server/src/WovServer.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL_REPO = resolve(ADMIN, '..');
const TSX = resolve(WURZEL_REPO, 'node_modules/.bin/tsx');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltops-n5-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'n5-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

type Platz = Record<string, unknown> & { id: string };
const baeume = (n: number): Platz[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 20 + i * 12, z: 20 }));
const dokument = (placements: unknown): Record<string, unknown> => ({
  version: 1,
  name: 'N5',
  detailSeed: 'n5',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
  defaultSpawn: [0, 0],
  placements,
});
const T = baeume(14);
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

// The MCP SDK is loaded by a path in a variable: the admin package is type-checked without the SDK's types.
const laden = (pfad: string): Promise<Record<string, unknown>> => import(pfad) as Promise<Record<string, unknown>>;
const sdkClient = (await laden('@modelcontextprotocol/sdk/client/index.js')) as { Client: new (i: { name: string; version: string }) => McpClient };
const sdkStdio = (await laden('@modelcontextprotocol/sdk/client/stdio.js')) as {
  StdioClientTransport: new (o: { command: string; args: string[]; cwd: string; env: Record<string, string> }) => unknown;
  getDefaultEnvironment(): Record<string, string>;
};
interface McpClient {
  connect(t: unknown): Promise<void>;
  callTool(a: { name: string; arguments: Record<string, unknown> }): Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  close(): Promise<void>;
}
let mcpClient: McpClient | null = null;

let server = createWovServer({
  port: 0,
  worldName: 'dev',
  worldSeed: 'n5',
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
  message?: string;
  angewendet?: boolean;
  unveraendert?: boolean;
  zaehler?: Record<string, number>;
  fehlerhaft?: { id: string; feld: string; wert: unknown }[];
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
const dateiPlatz = (): Platz[] => (JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { placements: Platz[] }).placements;
const schlafen = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const stumm = (): void => undefined;
async function post(placements: unknown): Promise<{ status: number; daten: Daten; basis: string }> {
  const basis = dateiHash();
  const r = await anfrage('POST', '/api/worldlayout', dokument(placements), basis);
  return { ...r, basis };
}
const gleicheDatei = (basis: string, liste: string): boolean => dateiHash() === basis && dateiListe() === liste;
const findet = (d: Daten, id: string, feld: string, wert?: unknown): boolean => (d.fehlerhaft ?? []).some((f) => f.id === id && f.feld === feld && (wert === undefined || f.wert === wert));
/** The JSON part of an MCP answer (after the first blank line), or the whole text if there is none. */
const mcpJson = (text: string): unknown => {
  const i = text.indexOf('\n\n');
  try {
    return JSON.parse(i >= 0 ? text.slice(i + 2) : text);
  } catch {
    return undefined;
  }
};
const suche = (v: unknown, id: string): Record<string, unknown> | undefined => {
  if (Array.isArray(v)) for (const e of v) { const r = suche(e, id); if (r) return r; }
  else if (typeof v === 'object' && v !== null) {
    if ((v as { id?: unknown }).id === id && 'prefab' in v) return v as Record<string, unknown>;
    for (const e of Object.values(v)) { const r = suche(e, id); if (r) return r; }
  }
  return undefined;
};

const orig = { log: console.log, warn: console.warn };
try {
  console.log = stumm;
  console.warn = stumm;
  const q = quittungsDatei(SPIELSTAENDE, 'dev');
  for (let i = 0; i < 300 && !existsSync(q); i++) await schlafen(20);
  const ausgabe = (t: string, ok: boolean, d = ''): void => {
    console.log = orig.log;
    check(t, ok, d);
    console.log = stumm;
  };
  ausgabe('set-up: 14 trees stand after the boot', layoutZdos().length === 14, `${layoutZdos().length}`);
  const sauber = await post(T);
  ausgabe('set-up: the clean document goes through the service', sauber.status === 200 || sauber.status === 202, `${sauber.status}`);
  await schlafen(1300);

  // ── N4-A: a set but invalid id ──
  server.zdos.destroyZDO(nach('t9')!.zdoid);
  server.zdos.destroyZDO(nach('t5')!.zdoid);
  server.zdos.destroyZDO(nach('t7')!.zdoid);
  server.zdos.destroyZDO(nach('t1')!.zdoid);
  const t3 = nach('t3')!.zdoid.toString();
  const t2 = nach('t2')!.zdoid.toString();
  const stehen = layoutZdos().length; // 10
  const h0 = dateiHash();
  const l0 = dateiListe();
  const mitId = (id: string, wert: unknown): Platz[] => T.map((p) => (p.id === id ? { ...p, id: wert as string } : p));
  const p1 = await post(mitId('t9', 'T9'));
  ausgabe('P1 id "T9" (capital) on a felled tree: 422 ungueltig, list names feld id', p1.status === 422 && p1.daten.fehler === 'ungueltig' && findet(p1.daten, 'T9', 'id', 'T9'), `${p1.status} ${JSON.stringify(p1.daten.fehlerhaft)}`);
  const p2 = await post(mitId('t3', 't3 '));
  ausgabe('P2 id "t3 " (space) on a standing tree: 422, list names feld id', p2.status === 422 && findet(p2.daten, 't3 ', 'id'), `${p2.status} ${JSON.stringify(p2.daten.fehlerhaft)}`);
  const p3 = await post(mitId('t5', 't5ä'));
  ausgabe('P3 id "t5ä" (umlaut) on a felled tree: 422, list names feld id', p3.status === 422 && findet(p3.daten, 't5ä', 'id'), `${p3.status}`);
  const p4 = await post(mitId('t7', 7));
  ausgabe('P4 id 7 (number) on a felled tree: 422, list names feld id at #7', p4.status === 422 && findet(p4.daten, '#7', 'id', 7), `${p4.status} ${JSON.stringify(p4.daten.fehlerhaft)}`);
  const p4b = await post(mitId('t7', null));
  ausgabe('P4b id null: 422', p4b.status === 422 && findet(p4b.daten, '#7', 'id', null), `${p4b.status}`);
  const p4c = await post(mitId('t7', 'a'.repeat(65)));
  ausgabe('P4c id of 65 characters: 422', p4c.status === 422 && (p4c.daten.fehlerhaft ?? []).some((f) => f.feld === 'id'), `${p4c.status}`);
  await schlafen(1500); // a wrong 200 would have been applied within a second
  ausgabe(
    'P1..P4: file byte-identical, no backup, felled trees stay felled, the standing tree is neither deleted nor respawned',
    gleicheDatei(h0, l0) && layoutZdos().length === stehen && !nach('t9') && !nach('t5') && !nach('t7') && nach('t3')?.zdoid.toString() === t3,
    `${layoutZdos().length} ZDOs`
  );
  const h1 = dateiHash();
  const l1 = dateiListe();
  const dateiT = dateiPlatz();
  const byId = (id: string): Platz => dateiT.find((p) => p.id === id)!;

  // ── N4-B: duplicate ids with different content ──
  const t1 = byId('t1');
  const p5 = await post([{ ...t1, z: 70 }, ...dateiT]);
  ausgabe('P5 a copy of the felled t1 (z 70) BEFORE the original, same id: 422 doppelt', p5.status === 422 && findet(p5.daten, t1.id, 'id', 'doppelt'), `${p5.status} ${JSON.stringify(p5.daten.fehlerhaft)}`);
  const t2e = byId('t2');
  const p6 = await post([{ ...t2e, x: 500 }, ...dateiT]);
  ausgabe('P6 a copy of the standing t2 (x 500) BEFORE the original, same id: 422 doppelt', p6.status === 422 && findet(p6.daten, t2e.id, 'id', 'doppelt'), `${p6.status}`);
  const p6c = await post([...dateiT, { ...t2e, x: 500 }]);
  ausgabe('P6c the same copy AFTER the original: 422 too (the order does not decide)', p6c.status === 422 && findet(p6c.daten, t2e.id, 'id', 'doppelt'), `${p6c.status}`);
  await schlafen(1500);
  ausgabe('P5/P6: file byte-identical, t1 still felled, t2 not moved or respawned', gleicheDatei(h1, l1) && !nach('t1') && nach('t2')?.zdoid.toString() === t2, `${layoutZdos().length}`);
  const p6b = await post([{ ...t2e }, ...dateiT]);
  ausgabe('P6b an EXACT duplicate (same id, same content) is still folded: 200, no id error', (p6b.status === 200 || p6b.status === 202) && p6b.daten.fehlerhaft === undefined, `${p6b.status}`);

  // ── N4-F: a save without a change ──
  const neuerBaum = { id: 'neu1', prefab: 'Beech1', x: 300, z: 40 };
  const f1 = await post([...dateiPlatz(), neuerBaum]);
  ausgabe('F set-up: a new tree is saved and spawned (gespawnt 1)', f1.status === 200 && f1.daten.zaehler?.gespawnt === 1, `${f1.status} ${JSON.stringify(f1.daten.zaehler)}`);
  const f2 = await post([...dateiPlatz()]);
  ausgabe(
    'F the same document again: 200, unveraendert, every counter 0 (not the previous receipt)',
    f2.status === 200 && f2.daten.unveraendert === true && f2.daten.zaehler !== undefined && Object.values(f2.daten.zaehler).every((n) => n === 0) && f2.basis === f2.daten.hash,
    `${f2.status} ${JSON.stringify(f2.daten.zaehler)} ${f2.daten.unveraendert}`
  );
  const f3 = await post([...dateiPlatz(), { id: 'neu2', prefab: 'Beech1', x: 320, z: 40 }]);
  ausgabe('F a real change after that still reports its own counters (gespawnt 1, not unveraendert)', f3.status === 200 && f3.daten.unveraendert !== true && f3.daten.zaehler?.gespawnt === 1, `${JSON.stringify(f3.daten.zaehler)}`);

  // ── the real MCP: N4-D and N4-E ──
  process.env.WOV_MCP_FREMDE_WELT = '1';
  const transport = new sdkStdio.StdioClientTransport({
    command: TSX,
    args: ['tools/worldlayout-mcp/server.ts'],
    cwd: WURZEL_REPO,
    env: { ...sdkStdio.getDefaultEnvironment(), WOV_ADMIN_URL: `http://127.0.0.1:${port}`, WOV_ADMIN_TOKEN: TOKEN, WOV_MCP_FREMDE_WELT: '1' },
  });
  mcpClient = new sdkClient.Client({ name: 'n5', version: '1.0.0' });
  await mcpClient.connect(transport);
  const rufe = async (name: string, args: Record<string, unknown>) => {
    const r = await mcpClient!.callTool({ name, arguments: args });
    return { text: r.content.map((c) => c.text).join('\n'), fehler: r.isError === true };
  };
  const beschreibe = async (id: string): Promise<Record<string, unknown> | undefined> => {
    const e = dateiPlatz().find((p) => p.id === id)!;
    const a = await rufe('area_describe', { x: e.x as number, z: e.z as number, radius: 5 });
    return suche(mcpJson(a.text), id);
  };

  const ansicht = await beschreibe('t6');
  ausgabe('M1 set-up: area_describe shows t6 with display fields (abstand, fest)', ansicht !== undefined && 'abstand' in ansicht, JSON.stringify(ansicht));
  const vorherOffen = dateiPlatz().find((p) => p.id === 't6')!;
  const m2 = await rufe('ops_apply', { trocken: false, ops: [{ art: 'aendere', sammlung: 'placements', id: 't6', vorher: ansicht, nachher: { ...vorherOffen, yaw: 1 } }] });
  ausgabe('M2 ops_apply aendere t6 with `vorher` from area_describe: saved', !m2.fehler && /gespeichert/.test(m2.text), m2.text.slice(0, 200));
  ausgabe('M2 the file holds yaw 1 for t6', dateiPlatz().find((p) => p.id === 't6')?.yaw === 1);
  const m3 = await rufe('undo_last', {});
  ausgabe('M3 undo_last afterwards: works (no 422 about abstand/fest)', !m3.fehler && /zurückgenommen/.test(m3.text), m3.text.slice(0, 300));
  ausgabe('M3 t6 is back without yaw', dateiPlatz().find((p) => p.id === 't6')?.yaw === undefined);

  const ansicht8 = await beschreibe('t8');
  const t8vorher = dateiPlatz().find((p) => p.id === 't8')!;
  const m4 = await rufe('ops_apply', { trocken: false, ops: [{ art: 'entferne', sammlung: 'placements', id: 't8', vorher: ansicht8 }] });
  ausgabe('M4 ops_apply entferne t8 with `vorher` from area_describe: saved, t8 out of the file', !m4.fehler && dateiPlatz().every((p) => p.id !== 't8'), m4.text.slice(0, 200));
  const m5 = await rufe('undo_last', {});
  const t8jetzt = dateiPlatz().find((p) => p.id === 't8');
  ausgabe('M5 undo_last brings t8 back into the file (same position)', !m5.fehler && t8jetzt !== undefined && t8jetzt.x === t8vorher.x && t8jetzt.z === t8vorher.z, m5.text.slice(0, 300));

  const m7 = await rufe('placement_set', { platzierung: { id: 't10', prefab: 'Beech1', x: dateiPlatz().find((p) => p.id === 't10')!.x as number, z: 20, yaw: 90, scale: 12, einebnen: 150 } });
  const liste = ((): { id: string; feld: string; wert: unknown; neu: unknown }[] => {
    const i = m7.text.indexOf('\n[');
    try {
      return JSON.parse(m7.text.slice(i + 1, m7.text.indexOf('\n', i + 1)));
    } catch {
      return [];
    }
  })();
  const nachSetzen = dateiPlatz().find((p) => p.id === 't10');
  ausgabe('M7 placement_set yaw 90, scale 12, einebnen 150: saved, clamped values in the file', !m7.fehler && nachSetzen?.scale === 5 && nachSetzen?.einebnen === 100 && nachSetzen?.yaw === Math.PI * 2, JSON.stringify(nachSetzen));
  const g = (feld: string) => liste.find((x) => x.id === 't10' && x.feld === feld);
  ausgabe(
    'M7 the answer lists {id, feld, wert, neu}: scale 12 -> 5, einebnen 150 -> 100, yaw 90 -> 2 pi',
    g('scale')?.wert === 12 && g('scale')?.neu === 5 && g('einebnen')?.wert === 150 && g('einebnen')?.neu === 100 && g('yaw')?.wert === 90 && g('yaw')?.neu === Math.PI * 2,
    m7.text.slice(0, 400)
  );
  const m8 = await rufe('placement_set', { platzierung: { id: 't11', prefab: 'Beech1', x: dateiPlatz().find((p) => p.id === 't11')!.x as number, z: 20, yaw: 1, scale: 2 } });
  ausgabe('M8 placement_set with clean values: no "Geklemmt" line (no false alarm)', !m8.fehler && !/Geklemmt/.test(m8.text), m8.text.slice(0, 200));
} finally {
  console.log = orig.log;
  console.warn = orig.warn;
  try {
    await mcpClient?.close();
  } catch {
    /* already closed */
  }
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
