/**
 * Live sync of the world document (Editor E2, card K5.0): a running game server
 * takes over a written world file within a second, without a restart.
 *
 * A REAL server runs (start(), real 1-second block of update()), a real
 * WebSocket client watches the sync with the real client parser. The world file
 * is written the way the operations service writes it: temp file + rename.
 * The receipt (`layout-quittung.<instanz>.json` next to the saves) is the
 * witness for "applied"; the ZDO store and the client mirror are the witnesses
 * for "what happened".
 *
 *  (a) a new placement: within 2 s `gespawnt` = 1, one ZDO with `layoutId`, the second client
 *      receives it in the sync; the packet LayoutAktualisiert reaches it too
 *  (b) moved: same zdoid, position to 1 mm
 *  (c) removed: `entfernt` = 1, the client receives it in the destroy list
 *  (d) the unchanged document written again (also re-formatted): 0 changed revisions over ALL ZDOs
 *  (f) regions change / `einebnen` change, each alone and each together with an object
 *      change: receipt `geo`, 0 ZDOs changed, and the server keeps the old document
 *  (g) duration of the live sync, median over 20 runs (with WOV_LIVE_KOPIE=<dir of a copy of a
 *      DEV save> on that save, otherwise on the test world)
 *  (h) typo in `placements` (text, null, all entries dropped) and a file that is no JSON: 0 removed
 *  (i) state stays: a chest with content that moves keeps its content; a prefab change with the
 *      same id replaces it and logs `überzähliges ZDO` with the member count
 *
 * Run: npx tsx test/layout-live.ts   (from server/)
 */
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_ID_MEMBER, PacketType } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';
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

const SEED = 'LayoutLive1';
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-live-'));
const WELTEN = join(WURZEL, 'worlds');
mkdirSync(WELTEN, { recursive: true });
const LAYOUT = join(WURZEL, 'layout.json');
const QUITTUNG = quittungsDatei(WELTEN, 'liveprobe');
const KOPIE = process.env.WOV_LIVE_KOPIE;

type Platz = { id: string; prefab: string; x: number; z: number; yaw?: number; einebnen?: number; route?: string };
function dokument(placements: Platz[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Live',
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

/** Write like the operations service: temp file, rename. Returns the hash of the bytes. */
function schreibe(text: string): string {
  const temp = `${LAYOUT}.probe.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, LAYOUT);
  return layoutHash(text);
}
const json = (d: unknown, einzug = 0): string => JSON.stringify(d, null, einzug || undefined);

async function quittung(hash: string, ms = 4000): Promise<Quittung | null> {
  let q: Quittung | null = null;
  await warteAuf(() => {
    q = quittungLesen(QUITTUNG);
    return q?.hash === hash;
  }, ms);
  return q && (q as Quittung).hash === hash ? (q as Quittung) : null;
}

// ── Client ──
interface Klient {
  ws: WebSocket;
  sichtbar: Set<string>;
  zerstoert: Set<string>;
  spiegel: ZDOSpiegel;
  layoutPakete: string[];
}
function verbinde(port: number): Promise<Klient> {
  return new Promise((ok, nein) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    const k: Klient = { ws, sichtbar: new Set(), zerstoert: new Set(), spiegel: new ZDOSpiegel(), layoutPakete: [] };
    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      if (typ === 10) {
        const { updates, destroyed } = parseZDOSync(new BinaryReader(data.buffer, data.byteOffset + 1), '', k.spiegel);
        for (const u of updates) k.sichtbar.add(u.key);
        for (const z of destroyed) {
          k.sichtbar.delete(z);
          k.zerstoert.add(z);
        }
      } else if (typ === PacketType.LayoutAktualisiert) {
        k.layoutPakete.push(new Reader(Buffer.from(data.subarray(1))).readString());
      }
    });
    let auth = false;
    const t = setTimeout(() => nein(new Error('Handshake-Timeout')), 8000);
    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (typ === 1) ws.send(Buffer.concat([Buffer.from([1]), new Writer().writeInt32(2).toBuffer()]));
      else if (typ === 68) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString('Lena');
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([2]), w.toBuffer()]));
      } else if (typ === 3) {
        clearTimeout(t);
        ok(k);
      }
    });
    ws.on('error', nein);
  });
}

async function haupt(): Promise<void> {
  // Server
  if (KOPIE) {
    cpSync(join(KOPIE, 'dev.json'), LAYOUT);
    cpSync(join(KOPIE, 'worlds'), WELTEN, { recursive: true });
  } else {
    schreibe(json(dokument([])));
  }
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: KOPIE ? 'dev' : 'liveprobe',
    worldSeed: KOPIE ? (process.env.WOV_LIVE_SEED ?? 'KxSYuZquuw') : SEED, // a copy of a DEV save only loads with the seed of its world
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: WELTEN,
    kontenDir: join(WURZEL, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
    saveIntervalMs: 3600_000,
  });
  const zeilen: string[] = [];
  const orig = { log: console.log, warn: console.warn };
  const faenge = (w: (...a: unknown[]) => void) => (...a: unknown[]): void => {
    const z = a.map(String).join(' ');
    if (z.includes('Layout-')) zeilen.push(z);
    w(...a);
  };
  console.log = faenge(orig.log);
  console.warn = faenge(orig.warn);
  server.start();
  const port = portVon(server);
  const quittungDatei = KOPIE ? quittungsDatei(WELTEN, 'dev') : QUITTUNG;
  try {
    if (KOPIE) {
      await messe(server, zeilen, quittungDatei);
      return;
    }
    const layoutZdos = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
    const nach = (id: string): ZDO | undefined => layoutZdos().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);
    // All ZDOs except the characters of connected players and the creatures the SpawnSystem simulates around them (they move and appear on their own).
    const alle = (): Map<string, number> => {
      const figuren = new Set(server.net.getPeers().map((p) => p.characterID.toString()));
      const wesen = (server.spawns as unknown as { creatures: Map<string, unknown> }).creatures;
      return new Map(server.zdos.getAllZDOs().filter((z) => !figuren.has(z.zdoid.toString()) && !wesen.has(z.zdoid.toString())).map((z) => [z.zdoid.toString(), z.revision.raw]));
    };
    const gleicheRevisionen = (a: Map<string, number>, b: Map<string, number>): number => {
      let diff = a.size === b.size ? 0 : Math.abs(a.size - b.size);
      for (const k of b.keys()) if (!a.has(k)) console.error(`  neu ${k} (${server.prefabs.getByHash(server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === k)!.prefabHash)?.name})`);
      for (const k of a.keys()) if (!b.has(k)) console.error(`  weg ${k}`);
      for (const [k, v] of a) {
        if (b.get(k) !== v) {
          diff++;
          console.error(`  diff ${k}: ${v} -> ${b.get(k)} (${server.prefabs.getByHash(server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === k)!.prefabHash)?.name})`);
        }
      }
      return diff;
    };

    // Boot receipt: the first tick reports the state the server started with.
    const start = quittungLesen(QUITTUNG);
    await warteAuf(() => quittungLesen(QUITTUNG) !== null);
    const q0 = quittungLesen(QUITTUNG);
    check('boot: receipt with the hash of the file', q0?.hash === layoutHash(readFileSync(LAYOUT)) && q0?.ergebnis === 'angewendet', JSON.stringify(q0));
    void start;

    const klient = await verbinde(port);
    await warte(300);

    // (a)
    const P1: Platz = { id: 'baum-1', prefab: 'Beech1', x: 30, z: 20 };
    let t0 = Date.now();
    let hash = schreibe(json(dokument([P1])));
    let q = await quittung(hash);
    const dauerA = Date.now() - t0;
    check('(a) receipt within 2 s, applied', !!q && q.ergebnis === 'angewendet' && dauerA <= 2000, `${dauerA} ms`);
    check('(a) gespawnt = 1', q?.zaehler?.gespawnt === 1, JSON.stringify(q?.zaehler));
    const z1 = nach('baum-1');
    check('(a) one ZDO with layoutId', layoutZdos().filter((z) => z.getString(LAYOUT_ID_MEMBER) === 'baum-1').length === 1 && !!z1);
    const key1 = z1?.zdoid.toString() ?? '?';
    check('(a) the client receives the ZDO in the sync', await warteAuf(() => klient.sichtbar.has(key1)));
    check('(a) the client got LayoutAktualisiert with the document', await warteAuf(() => klient.layoutPakete.length >= 1) && JSON.parse(klient.layoutPakete[0]!).placements?.length === 1);

    // (b)
    hash = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }])));
    q = await quittung(hash);
    const z1b = nach('baum-1');
    check('(b) applied, aktualisiert = 1', q?.ergebnis === 'angewendet' && q.zaehler?.aktualisiert === 1, JSON.stringify(q?.zaehler));
    check('(b) same zdoid', z1b?.zdoid.toString() === key1);
    check('(b) position to 1 mm', !!z1b && Math.abs(z1b.position.x - 34.123) < 0.001 && Math.abs(z1b.position.z - 21.456) < 0.001, z1b ? `${z1b.position.x},${z1b.position.z}` : '');

    // (d) unchanged, byte-identical and re-formatted
    const vorher = alle();
    hash = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }])));
    q = await quittung(hash);
    const nachIdent = alle();
    const hash2 = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }]), 4));
    const q2 = await quittung(hash2);
    check('(d) unchanged document (bytes equal / re-formatted): receipt applied', q?.ergebnis === 'angewendet' && q2?.ergebnis === 'angewendet');
    check('(d) 0 changed revisions over all ZDOs', gleicheRevisionen(vorher, nachIdent) === 0 && gleicheRevisionen(vorher, alle()) === 0, `${vorher.size} ZDOs`);

    // (i) state stays
    const KISTE: Platz = { id: 'kiste-1', prefab: 'piece_chest_wood', x: 40, z: 20 };
    hash = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }, KISTE])));
    await quittung(hash);
    const kiste = nach('kiste-1');
    kiste?.setString('truheInhalt', '[[Wood,3]]');
    const kisteId = kiste?.zdoid.toString();
    hash = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }, { ...KISTE, x: 42, z: 22 }])));
    q = await quittung(hash);
    const kiste2 = nach('kiste-1');
    check('(i) moved chest: same zdoid, content stays, position moved', kiste2?.zdoid.toString() === kisteId && kiste2?.getString('truheInhalt') === '[[Wood,3]]' && Math.abs((kiste2?.position.x ?? 0) - 42) < 0.001, `aktualisiert=${q?.zaehler?.aktualisiert}`);
    zeilen.length = 0;
    hash = schreibe(json(dokument([{ ...P1, x: 34.123, z: 21.456 }, { ...KISTE, x: 42, z: 22, prefab: 'woodwall' }])));
    q = await quittung(hash);
    const ersetzt = nach('kiste-1');
    check('(i) prefab change with the same id replaces the ZDO (new zdoid, no content)', !!ersetzt && ersetzt.zdoid.toString() !== kisteId && !ersetzt.getString('truheInhalt'));
    check('(i) the replacement is logged with the member count', zeilen.some((z) => /überzähliges ZDO .* mit \d+ Zustands-Member/.test(z)), zeilen.filter((z) => z.includes('überzählig')).join(' | '));

    // (f) geo
    const basis = [{ ...P1, x: 34.123, z: 21.456 }, { ...KISTE, x: 42, z: 22, prefab: 'woodwall' }];
    const neu: Platz = { id: 'baum-2', prefab: 'Beech1', x: 60, z: 20 };
    const regionAnders = { regions: [{ id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1500 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }] };
    const faelle: [string, Record<string, unknown>][] = [
      ['regions only', dokument(basis, regionAnders)],
      ['regions + object', dokument([...basis, neu], regionAnders)],
      ['einebnen only', dokument([{ ...basis[0]!, einebnen: 6 }, basis[1]!])],
      ['einebnen + object', dokument([{ ...basis[0]!, einebnen: 6 }, basis[1]!, neu])],
    ];
    for (const [name, doc] of faelle) {
      const v = alle();
      const anzahl = alle().size;
      hash = schreibe(json(doc));
      q = await quittung(hash);
      check(`(f) ${name}: receipt not applied, grund geo`, q?.ergebnis === 'nicht-angewendet' && q.grund === 'geo', `${q?.grund} ${q?.detail ?? ''}`);
      check(`(f) ${name}: 0 ZDOs changed`, gleicheRevisionen(v, alle()) === 0 && alle().size === anzahl && !nach('baum-2'));
    }
    // The clean document afterwards applies again (the server kept the old one, no half state).
    hash = schreibe(json(dokument([...basis, neu])));
    q = await quittung(hash);
    check('(f) afterwards a document with the old geo applies again', q?.ergebnis === 'angewendet' && q.zaehler?.gespawnt === 1 && !!nach('baum-2'), JSON.stringify(q?.zaehler));

    // (h) typos
    const vor = alle();
    const anzH = layoutZdos().length;
    const kaputt: [string, string][] = [
      ['placements is text', json({ ...dokument([]), placements: 'kaputt' })],
      ['placements is null', json({ ...dokument([]), placements: null })],
      ['all entries dropped', json({ ...dokument([]), placements: ['x', 1, {}] })],
      ['not JSON', '{"version": 1, "name": '],
    ];
    for (const [name, text] of kaputt) {
      hash = schreibe(text);
      q = await quittung(hash);
      check(`(h) ${name}: rejected, 0 removed`, q?.ergebnis === 'nicht-angewendet' && q.grund === 'abgelehnt' && layoutZdos().length === anzH && gleicheRevisionen(vor, alle()) === 0, `${q?.grund}: ${q?.detail ?? ''}`);
    }

    // (c) remove (last, so the destroy list is visible)
    const key2 = nach('baum-2')!.zdoid.toString();
    hash = schreibe(json(dokument([basis[0]!, basis[1]!])));
    q = await quittung(hash);
    check('(c) entfernt = 1', q?.zaehler?.entfernt === 1, JSON.stringify(q?.zaehler));
    check('(c) the client receives it in the destroy list', await warteAuf(() => klient.zerstoert.has(key2)));
    klient.ws.close();
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await warte(300);
  }
}

/** (g): duration of the live sync, median over 20 runs. Drives the guard directly (no waiting for the 1-second block). */
async function messe(server: ReturnType<typeof createWovServer>, zeilen: string[], quittungDatei: string): Promise<void> {
  void quittungDatei;
  const wache = (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
  wache.tick(); // takes the boot state
  const dok = JSON.parse(readFileSync(LAYOUT, 'utf-8')) as { placements: Platz[] };
  const ziel = dok.placements.find((p) => !p.einebnen && !p.route) ?? dok.placements[0]!;
  const zdoAnzahl = server.zdos.getAllZDOs().length;
  const dauern: number[] = [];
  for (let i = 0; i < 20; i++) {
    ziel.x += i % 2 === 0 ? 1 : -1;
    zeilen.length = 0;
    schreibe(JSON.stringify(dok));
    wache.tick();
    const z = zeilen.find((l) => l.includes('angewendet in'));
    const m = z ? /angewendet in ([\d.]+) ms/.exec(z) : null;
    dauern.push(m ? Number(m[1]) : NaN);
  }
  const sortiert = [...dauern].sort((a, b) => a - b);
  const median = (sortiert[9]! + sortiert[10]!) / 2;
  console.log(`MESSUNG (g): ${zdoAnzahl} ZDOs, ${dok.placements.length} placements, 20 runs, median ${median.toFixed(1)} ms, min ${sortiert[0]} max ${sortiert[19]} (all: ${dauern.join(' ')})`);
  check('(g) 20 runs measured', dauern.every((d) => Number.isFinite(d)));
  check('(g) median <= 50 ms', median <= 50, `${median.toFixed(1)} ms`);
}

try {
  await haupt();
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
