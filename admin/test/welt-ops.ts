/**
 * PATCH /api/worldlayout/ops against the REAL operations service (Editor E1,
 * card K1.2), and POST /api/worldlayout without a base (428).
 *
 *   npx tsx test/welt-ops.ts      (from admin/)
 *
 * Starts admin/src/main.ts against a COPY of the world in a temp directory
 * (never server/data/welten/). Port: free (WOV_ADMIN_PORT=0); with
 * WOV_TEST_ADMIN_PORT=<n> a fixed slot port is forced.
 *
 * What is proven, in numbers:
 *  1. two clients change DIFFERENT objects from the same base → 2 × 200, both
 *     changes in the file; the SAME object → 1 × 200 + 1 × 409 naming the id;
 *  2. a Vorgang with one invalid op writes nothing (file checksum equal, no
 *     new backup);
 *  3. two PROCESSES at the same time, 20 Vorgaenge each on different
 *     objects → all 40 in the file (once all at once, once one after the
 *     other);
 *  4. the retry: a foreign writer wins between read and write → the Vorgang
 *     is read, applied and written again; a writer that always wins → 503
 *     after the last try and nothing written;
 *  5. a held lock → 503 with Retry-After, nothing written;
 *  6. token / origin guards as for /api/worldlayout;
 *  7. POST /api/worldlayout without If-Match / basis → 428, file unchanged.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutSchreiben, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL = resolve(ADMIN, '..');
const TSX = resolve(WURZEL, 'node_modules/.bin/tsx');

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
type Eintrag = Record<string, unknown> & { id: string };

const LAKES = 40;
function ausgangsDokument(mitPlatzierungen: boolean): Record<string, unknown> {
  return {
    version: 1,
    name: 'Ops-Test',
    detailSeed: 'ops',
    continents: [{ id: 'nord', name: 'Nordland', faction: 'viking' }],
    regions: [
      { id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 },
      { id: 'wald', biome: 'blackforest', shape: { kind: 'circle', x: 2000, z: 0, radius: 800 }, edgeFalloff: 300 },
      { id: 'berg', biome: 'mountain', shape: { kind: 'circle', x: 0, z: 2500, radius: 600 }, edgeFalloff: 300 },
    ],
    ...(mitPlatzierungen
      ? { placements: Array.from({ length: 12 }, (_, i) => ({ id: `pl-${i}`, prefab: 'Beech1', x: i * 10, z: 5 })) }
      : {}),
    routes: [
      { id: 'weg-a', points: [[0, 0], [100, 0]], mode: 'loop' },
      { id: 'weg-b', points: [[0, 50], [100, 50]], mode: 'pingpong' },
    ],
    rivers: [
      { id: 'fluss-a', points: [[0, 0], [300, 300]], width: 30 },
      { id: 'fluss-b', points: [[100, 0], [300, 900]], width: 20 },
    ],
    lakes: Array.from({ length: LAKES }, (_, i) => ({ id: `lk-${String(i).padStart(2, '0')}`, x: i * 40, z: -300, radius: 50 })),
  };
}

const lakeId = (i: number): string => `lk-${String(i).padStart(2, '0')}`;

// ══ Client process ═══════════════════════════════════════════════════
// The same file as a child: reads the current lakes, then changes ITS lakes
// with PATCH, all at the same moment as the other client (`startAt`).

async function kundenprozess(): Promise<void> {
  const [, , , portText, token, vonText, bisText, radiusBasisText, startAtText, modus] = process.argv;
  const von = Number(vonText);
  const bis = Number(bisText);
  const radiusBasis = Number(radiusBasisText);
  const kopf = { 'x-wov-token': token!, 'content-type': 'application/json' };
  const url = `http://127.0.0.1:${portText}/api/worldlayout`;
  const stand = (await (await fetch(url, { headers: kopf })).json()) as { layout: WorldLayout };
  const seen = new Map((stand.layout.lakes ?? []).map((l) => [l.id, l as unknown as Eintrag]));
  const eins = async (i: number): Promise<{ status: number; versuche: unknown }> => {
    const vorher = seen.get(lakeId(i))!;
    const r = await fetch(`${url}/ops`, {
      method: 'PATCH',
      headers: kopf,
      body: JSON.stringify({
        vorgangId: `${modus}-${i}`,
        ops: [{ art: 'aendere', sammlung: 'lakes', id: lakeId(i), vorher, nachher: { ...vorher, radius: radiusBasis + i } }],
      }),
    });
    const d = (await r.json()) as { versuche?: unknown };
    return { status: r.status, versuche: d.versuche };
  };
  while (Date.now() < Number(startAtText)) {
    /* both processes start in the same millisecond */
  }
  const antworten: { status: number; versuche: unknown }[] = [];
  if (modus === 'gleichzeitig') {
    antworten.push(...(await Promise.all(Array.from({ length: bis - von }, (_, k) => eins(von + k)))));
  } else {
    for (let i = von; i < bis; i++) antworten.push(await eins(i));
  }
  console.log(JSON.stringify(antworten));
}

if (process.argv[2] === 'kunde') {
  await kundenprozess();
  process.exit(0);
}

// ══ Test bench ═══════════════════════════════════════════════════════

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// Does the sanitizer of this tree keep the `id` of a placement (card K1.1)?
const PLATZIERUNGS_IDS =
  (sanitizeWorldLayout({ ...ausgangsDokument(true) })?.placements?.[0] as unknown as { id?: string } | undefined)?.id === 'pl-0';
console.log(`# placement ids: ${PLATZIERUNGS_IDS ? 'kept by the sanitizer (K1.1 in tree)' : 'dropped by the sanitizer (K1.1 not in tree yet)'}`);

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-welt-ops-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const TOKEN = 'ops-token-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');
mkdirSync(WELTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
const AUSGANG = layoutText(sanitizeWorldLayout(ausgangsDokument(PLATZIERUNGS_IDS))!);
writeFileSync(WELT_DATEI, AUSGANG);

const platte = (): Buffer => readFileSync(WELT_DATEI);
const plattenHash = (): string => sha(platte());
const gelesen = (): WorldLayout => JSON.parse(platte().toString('utf-8')) as WorldLayout;
const sicherungen = (): number => readdirSync(WELTEN).filter((f) => f.startsWith('dev.json.') && f.endsWith('.bak')).length;
const seeText = (l: WorldLayout | undefined, id: string): Eintrag | undefined => (l?.lakes ?? []).find((x) => x.id === id) as unknown as Eintrag | undefined;

let protokoll = '';
const kinder: ChildProcess[] = [];

function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: process.env.WOV_TEST_ADMIN_PORT ?? '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    kinder.push(kind);
    const zeitgrenze = setTimeout(() => scheitern(new Error(`service does not start:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig(Number(t[1]));
      }
    };
    kind.stdout.on('data', auf);
    kind.stderr.on('data', auf);
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`service ended with ${code}:\n${protokoll}`));
    });
  });
}

function kundeStarten(port: number, von: number, bis: number, radiusBasis: number, startAt: number, modus: string): Promise<{ status: number; versuche: unknown }[]> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(TSX, [fileURLToPath(import.meta.url), 'kunde', String(port), TOKEN, String(von), String(bis), String(radiusBasis), String(startAt), modus], {
      cwd: ADMIN,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    kinder.push(kind);
    let aus = '';
    kind.stdout.on('data', (s: Buffer) => (aus += s.toString()));
    kind.on('exit', (code) => (code === 0 ? fertig(JSON.parse(aus.trim().split('\n').at(-1)!)) : scheitern(new Error(`client process ended with ${code}: ${aus}`))));
  });
}

const port = await dienstStarten();
console.log(`# service on 127.0.0.1:${port}, root ${ORDNER}`);

async function anfrage(
  methode: 'GET' | 'POST' | 'PATCH',
  pfad: string,
  opt: { leib?: unknown; roh?: string; token?: string | null; weiter?: string; ifMatch?: string } = {}
): Promise<{ status: number; kopf: Headers; daten: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: {
      ...(opt.token === null ? {} : { 'x-wov-token': opt.token ?? TOKEN }),
      ...(opt.weiter ? { 'x-forwarded-for': opt.weiter } : {}),
      ...(opt.ifMatch !== undefined ? { 'if-match': opt.ifMatch } : {}),
      ...(opt.leib !== undefined || opt.roh !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opt.roh ?? (opt.leib !== undefined ? JSON.stringify(opt.leib) : undefined),
  });
  return { status: r.status, kopf: r.headers, daten: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const ops = (leib: unknown, opt: Parameters<typeof anfrage>[2] = {}): ReturnType<typeof anfrage> => anfrage('PATCH', '/api/worldlayout/ops', { ...opt, leib });
const holeStand = async (): Promise<{ layout: WorldLayout; hash: string }> => {
  const g = await anfrage('GET', '/api/worldlayout');
  return { layout: g.daten.layout as WorldLayout, hash: String(g.daten.hash) };
};
const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const aendereSee = (vorher: Eintrag, radius: number, vorgangId: string): unknown => ({
  vorgangId,
  ops: [{ art: 'aendere', sammlung: 'lakes', id: vorher.id, vorher, nachher: { ...vorher, radius } }],
});

try {
  const g0 = await holeStand();
  check('setup: file = sanitizer output of the start document', platte().toString('utf-8') === AUSGANG && g0.hash === plattenHash());

  // ── 1) Two clients, different objects, same base ──────────────────
  {
    const s1 = seeText(g0.layout, 'lk-01')!;
    const s2 = seeText(g0.layout, 'lk-02')!;
    const bakVor = sicherungen();
    const a = await ops(aendereSee(s1, 111, 'client-a'));
    const b = await ops(aendereSee(s2, 222, 'client-b')); // built from the SAME base as `a`
    check('different objects, same base: 2 × 200', a.status === 200 && b.status === 200, `${a.status} ${b.status} ${JSON.stringify(b.daten)}`);
    const l = gelesen();
    check('both changes are in the file', seeText(l, 'lk-01')?.radius === 111 && seeText(l, 'lk-02')?.radius === 222);
    check('nothing else in the lakes changed', (l.lakes ?? []).filter((x) => !['lk-01', 'lk-02'].includes(x.id)).every((x) => x.radius === 50));
    check('regions, routes, rivers, continents are byte-identical to the start', JSON.stringify([l.regions, l.routes, l.rivers, l.continents]) === JSON.stringify([g0.layout.regions, g0.layout.routes, g0.layout.rivers, g0.layout.continents]));
    check('answer carries ok and the file hash; ETag matches', a.daten.ok === true && b.daten.hash === plattenHash() && b.kopf.get('etag') === `"${plattenHash()}"`);
    check('each op wrote one backup', sicherungen() === Math.min(bakVor + 2, 10), `= ${sicherungen()} (before ${bakVor})`);
  }

  // ── 2) The same object ───────────────────────────────────────────
  {
    const g = await holeStand();
    const s = seeText(g.layout, 'lk-03')!;
    const a = await ops(aendereSee(s, 301, 'same-a'));
    const b = await ops(aendereSee(s, 302, 'same-b'));
    check('same object, same base, one after the other: 200 then 409', a.status === 200 && b.status === 409, `${a.status} ${b.status}`);
    check('409 body: fehler konflikt, ids = [lk-03]', b.daten.fehler === 'konflikt' && JSON.stringify(b.daten.ids) === '["lk-03"]', JSON.stringify(b.daten));
    check('409 body: aktuell = the file hash, and the current entry is in eintraege', b.daten.aktuell === plattenHash() && (b.daten.eintraege as { eintrag: Eintrag }[])[0]?.eintrag.radius === 301);
    check('the loser changed nothing (radius stays 301)', seeText(gelesen(), 'lk-03')?.radius === 301);
    // The same, both at the same instant: exactly one wins.
    const g2 = await holeStand();
    const s2 = seeText(g2.layout, 'lk-04')!;
    const [c, d] = await Promise.all([ops(aendereSee(s2, 401, 'race-a')), ops(aendereSee(s2, 402, 'race-b'))]);
    const codes = [c.status, d.status].sort();
    check('same object, both at once: 1 × 200 + 1 × 409', codes[0] === 200 && codes[1] === 409, `${c.status} ${d.status}`);
    const verlierer = c.status === 409 ? c : d;
    check('the 409 names the id', JSON.stringify(verlierer.daten.ids) === '["lk-04"]');
    check('the file holds the winner\'s value', [401, 402].includes(Number(seeText(gelesen(), 'lk-04')?.radius)));
  }

  // ── 3) One invalid op voids the whole Vorgang ─────────────────────
  {
    const g = await holeStand();
    const s5 = seeText(g.layout, 'lk-05')!;
    const vorHash = plattenHash();
    const vorBak = sicherungen();
    const schlechteOps: unknown[] = [
      // valid op first, invalid second
      { vorgangId: 'schlecht-1', ops: [{ art: 'aendere', sammlung: 'lakes', id: 'lk-05', vorher: s5, nachher: { ...s5, radius: 999 } }, { art: 'setze', sammlung: 'regions', id: 'kaputt', nachher: { id: 'kaputt', biome: 'nichtvorhanden', shape: { kind: 'circle', x: 0, z: 0, radius: 100 } } }] },
      // valid op first, then a conflicting one
      { vorgangId: 'schlecht-2', ops: [{ art: 'aendere', sammlung: 'lakes', id: 'lk-05', vorher: s5, nachher: { ...s5, radius: 998 } }, { art: 'entferne', sammlung: 'lakes', id: 'lk-06', vorher: { id: 'lk-06', x: 1, z: 1, radius: 5 } }] },
      { vorgangId: 'schlecht-3', ops: [{ art: 'aendere', sammlung: 'lakes', id: 'lk-05', vorher: s5, nachher: { ...s5, radius: 997 } }, { art: 'loesche', sammlung: 'lakes', id: 'lk-06' }] },
      { vorgangId: 'schlecht-4', ops: [] },
      { ops: [{ art: 'entferne', sammlung: 'lakes', id: 'lk-05', vorher: s5 }] },
    ];
    const codes: number[] = [];
    for (const v of schlechteOps) codes.push((await ops(v)).status);
    check('invalid / conflicting / malformed Vorgaenge: 422, 409, 422, 422, 422', JSON.stringify(codes) === '[422,409,422,422,422]', JSON.stringify(codes));
    check('…and nothing was written: file checksum equal', plattenHash() === vorHash);
    check('…and no backup was made', sicherungen() === vorBak, `${vorBak} → ${sicherungen()}`);
    const kaputtesJson = await anfrage('PATCH', '/api/worldlayout/ops', { roh: '{ das ist kein json' });
    check('unreadable JSON → 400, nothing written', kaputtesJson.status === 400 && plattenHash() === vorHash, `= ${kaputtesJson.status}`);
    // The limit: 2001st placement → 422 zu-viele-platzierungen (only reachable when placement ids exist).
    if (PLATZIERUNGS_IDS) {
      const viele = Array.from({ length: 2001 - 12 }, (_, i) => ({ art: 'setze', sammlung: 'placements', id: `gross-${i}`, nachher: { id: `gross-${i}`, prefab: 'Beech1', x: i % 500, z: 1 } }));
      const r = await ops({ vorgangId: 'gross', ops: viele });
      check('the 2001st placement → 422 zu-viele-platzierungen (2001 > 2000), nothing written', r.status === 422 && r.daten.fehler === 'zu-viele-platzierungen' && r.daten.anzahl === 2001 && r.daten.grenze === 2000 && plattenHash() === vorHash, JSON.stringify(r.daten).slice(0, 200));
    } else {
      // Until K1.1: a placement op must fail loudly, never lose its id silently.
      const r = await ops({ vorgangId: 'pl', ops: [{ art: 'setze', sammlung: 'placements', id: 'neu-1', nachher: { id: 'neu-1', prefab: 'Beech1', x: 1, z: 1 } }] });
      check('SKIP limit test (needs K1.1); meanwhile a placement op is refused 422, not stored without its id', r.status === 422 && plattenHash() === vorHash, `= ${r.status}`);
    }
  }

  // ── 4) Setze and entferne over HTTP ───────────────────────────────
  {
    const g = await holeStand();
    const neu = { id: 'see-neu', x: 7, z: 7, radius: 70 };
    const r1 = await ops({ vorgangId: 'neu', ops: [{ art: 'setze', sammlung: 'lakes', id: 'see-neu', nachher: neu }] });
    check('setze over HTTP → 200, entry appended', r1.status === 200 && gelesen().lakes?.at(-1)?.id === 'see-neu');
    const r2 = await ops({ vorgangId: 'neu2', ops: [{ art: 'setze', sammlung: 'lakes', id: 'see-neu', nachher: neu }] });
    check('setze of an existing id → 409', r2.status === 409 && JSON.stringify(r2.daten.ids) === '["see-neu"]');
    const r3 = await ops({ vorgangId: 'weg', ops: [{ art: 'entferne', sammlung: 'lakes', id: 'see-neu', vorher: neu, index: (gelesen().lakes?.length ?? 1) - 1 }] });
    check('entferne over HTTP → 200, file equals the state before the setze (byte for byte)', r3.status === 200 && JSON.stringify(gelesen().lakes) === JSON.stringify(g.layout.lakes));
  }

  // ── 5) Two PROCESSES at the same time, 20 Vorgaenge each ──────────
  for (const modus of ['gleichzeitig', 'nacheinander'] as const) {
    const vorher = gelesen();
    const basisRadius = modus === 'gleichzeitig' ? 1000 : 2000;
    const startAt = Date.now() + 1500;
    const [ra, rb] = await Promise.all([
      kundeStarten(port, 0, 20, basisRadius, startAt, modus),
      kundeStarten(port, 20, 40, basisRadius + 500, startAt, modus),
    ]);
    const alle = [...ra, ...rb];
    const l = gelesen();
    const gewonnen = alle.filter((a) => a.status === 200).length;
    const stimmt = Array.from({ length: LAKES }, (_, i) => i).filter((i) => seeText(l, lakeId(i))?.radius === basisRadius + (i >= 20 ? 500 : 0) + i).length;
    const versuche = alle.map((a) => Number(a.versuche)).filter((n) => Number.isFinite(n));
    console.log(`# ${modus}: ${gewonnen}/40 answered 200; ${stimmt}/40 changes in the file; tries per Vorgang max ${Math.max(...versuche)}`);
    check(`two processes, ${modus}: 40 × 200`, alle.length === 40 && gewonnen === 40, JSON.stringify(alle.filter((a) => a.status !== 200)));
    check(`two processes, ${modus}: all 40 changes are in the file`, stimmt === 40, `${stimmt}/40`);
    check(`two processes, ${modus}: the rest of the document is untouched`, JSON.stringify([l.regions, l.routes, l.rivers, l.continents, l.placements]) === JSON.stringify([vorher.regions, vorher.routes, vorher.rivers, vorher.continents, vorher.placements]));
    check(`two processes, ${modus}: the file is a valid document (sanitizer keeps all ${l.lakes?.length} lakes)`, sanitizeWorldLayout(l)?.lakes?.length === l.lakes?.length);
  }

  // ── 6) Retry: a foreign writer wins between read and write ─────────
  // Imported here, not at the top: on a tree without the route this section
  // fails on its own assertion instead of taking the whole file down.
  const weltOps = await import('../src/routen/weltOps.js').catch(() => null);
  check('the ops module can be imported (admin/src/routen/weltOps.ts)', weltOps !== null);
  if (weltOps) {
    const { opsAnwenden } = weltOps;
    // A second world file, in-process (the retry lives in `opsAnwenden`).
    const pfad2 = resolve(WELTEN, 'retry.json');
    writeFileSync(pfad2, AUSGANG);
    const start = JSON.parse(AUSGANG) as WorldLayout;
    const s10 = seeText(start, 'lk-10')!;
    const v = aendereSee(s10, 1010, 'retry-1');
    let hakenAufrufe = 0;
    const r = await opsAnwenden(pfad2, v, {
      nachLesen: (versuch) => {
        hakenAufrufe++;
        if (versuch === 1) {
          // The foreign writer: changes ANOTHER object, with the base it just read.
          const jetzt = JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout;
          const geaendert = { ...jetzt, lakes: jetzt.lakes!.map((x) => (x.id === 'lk-11' ? { ...x, radius: 1111 } : x)) };
          layoutSchreiben(pfad2, geaendert, undefined, { basis: sha(readFileSync(pfad2)) });
        }
      },
    });
    const l = JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout;
    check('foreign writer wins once: the Vorgang is applied again and stands (versuche = 2)', r.art === 'ok' && r.versuche === 2, JSON.stringify(r).slice(0, 200));
    check('…and both the foreign change and ours are in the file', seeText(l, 'lk-10')?.radius === 1010 && seeText(l, 'lk-11')?.radius === 1111, `${seeText(l, 'lk-10')?.radius} ${seeText(l, 'lk-11')?.radius}`);
    check('…the hook ran exactly twice (once per try)', hakenAufrufe === 2, `= ${hakenAufrufe}`);

    // The foreign writer changes OUR object: the re-apply finds the conflict.
    writeFileSync(pfad2, AUSGANG);
    const r2 = await opsAnwenden(pfad2, aendereSee(s10, 1020, 'retry-2'), {
      nachLesen: (versuch) => {
        if (versuch === 1) {
          const jetzt = JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout;
          layoutSchreiben(pfad2, { ...jetzt, lakes: jetzt.lakes!.map((x) => (x.id === 'lk-10' ? { ...x, radius: 4321 } : x)) }, undefined, { basis: sha(readFileSync(pfad2)) });
        }
      },
    });
    check('foreign writer changes the SAME object meanwhile: after the retry it is a conflict', r2.art === 'konflikt' && r2.ids[0] === 'lk-10', JSON.stringify(r2).slice(0, 200));
    check('…and the file holds the foreign value', seeText(JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout, 'lk-10')?.radius === 4321);

    // A writer that wins every time: after the last try, nothing of ours is written.
    writeFileSync(pfad2, AUSGANG);
    let zaehler = 0;
    const r3 = await opsAnwenden(pfad2, aendereSee(s10, 1030, 'retry-3'), {
      maxVersuche: 3,
      nachLesen: () => {
        zaehler++;
        const jetzt = JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout;
        layoutSchreiben(pfad2, { ...jetzt, lakes: jetzt.lakes!.map((x) => (x.id === 'lk-12' ? { ...x, radius: 100 + zaehler } : x)) }, undefined, { basis: sha(readFileSync(pfad2)) });
      },
    });
    const l3 = JSON.parse(readFileSync(pfad2, 'utf-8')) as WorldLayout;
    check('a writer that always wins: 3 tries, then "wettlauf", nothing of ours written', r3.art === 'wettlauf' && r3.versuche === 3 && seeText(l3, 'lk-10')?.radius === 50 && seeText(l3, 'lk-12')?.radius === 103, JSON.stringify(r3));
  }

  // ── 7) A held lock → 503, nothing written ─────────────────────────
  {
    const halter = spawn('sleep', ['60'], { stdio: 'ignore' });
    const halterPid = halter.pid!;
    try {
      const stat = readFileSync(`/proc/${halterPid}/stat`, 'utf-8');
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]!;
      writeFileSync(`${WELT_DATEI}.lock`, JSON.stringify({ pid: halterPid, start, host: hostname(), marke: 'test-halter' }));
      const g = await holeStand();
      const vorHash = plattenHash();
      const r = await ops(aendereSee(seeText(g.layout, 'lk-13')!, 1300, 'gesperrt'));
      check('lock held by a living process → 503 gesperrt with Retry-After', r.status === 503 && r.daten.fehler === 'gesperrt' && r.kopf.get('retry-after') === '3', `${r.status} ${JSON.stringify(r.daten)}`);
      check('…and nothing was written', plattenHash() === vorHash);
    } finally {
      halter.kill('SIGKILL');
      rmSync(`${WELT_DATEI}.lock`, { force: true });
      await new Promise((f) => halter.once('exit', f));
      const noch = spawnSync('ps', ['-p', String(halterPid)], { encoding: 'utf-8' });
      check(`lock holder (pid ${halterPid}) ended, ps -p finds nothing`, noch.status !== 0);
    }
  }

  // ── 8) Guards: token and origin, as for /api/worldlayout ──────────
  {
    const g = await holeStand();
    const s = seeText(g.layout, 'lk-14')!;
    const vorHash = plattenHash();
    const ohneToken = await ops(aendereSee(s, 1400, 'guard-1'), { token: null });
    const falschesToken = await ops(aendereSee(s, 1400, 'guard-2'), { token: 'falsch' });
    const fremd = await ops(aendereSee(s, 1400, 'guard-3'), { weiter: '203.0.113.7' });
    check('no token → 401, wrong token → 401, foreign client address → 403', ohneToken.status === 401 && falschesToken.status === 401 && fremd.status === 403, `${ohneToken.status} ${falschesToken.status} ${fremd.status}`);
    check('…and nothing was written', plattenHash() === vorHash);
    const get = await anfrage('GET', '/api/worldlayout/ops');
    check('GET on the ops route is not served as a write (404)', get.status === 404 && plattenHash() === vorHash, `= ${get.status}`);
  }

  // ── 9) POST /api/worldlayout without a base → 428 ──────────────────
  {
    const g = await holeStand();
    const vorHash = plattenHash();
    const vorBak = sicherungen();
    const ohne = await anfrage('POST', '/api/worldlayout', { leib: g.layout });
    check('POST without If-Match / basis → 428', ohne.status === 428, `= ${ohne.status} ${JSON.stringify(ohne.daten)}`);
    check('428 body: fehler basis-fehlt and a message', ohne.daten.fehler === 'basis-fehlt' && typeof ohne.daten.message === 'string' && ohne.daten.ok === false);
    check('428: file unchanged, no backup', plattenHash() === vorHash && sicherungen() === vorBak);
    const leer = await anfrage('POST', '/api/worldlayout', { leib: { ...g.layout, basis: null } });
    check('POST with basis: null in the body is also 428', leer.status === 428 && plattenHash() === vorHash);
    const mitBasis = await anfrage('POST', '/api/worldlayout', { leib: g.layout, ifMatch: `"${g.hash}"` });
    check('POST with the base is unchanged: 200, no ohneBasis mark', mitBasis.status === 200 && mitBasis.daten.ohneBasis === undefined);
    const imRumpf = await anfrage('POST', '/api/worldlayout', { leib: { ...g.layout, basis: plattenHash() } });
    check('POST with `basis` in the body is unchanged: 200', imRumpf.status === 200);
  }
} finally {
  // Only the PIDs this test started.
  const pids = kinder.map((k) => k.pid).filter((p): p is number => p !== undefined);
  for (const k of kinder) k.kill('SIGTERM');
  await warte(500);
  for (const k of kinder) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
  await warte(300);
  const uebrig = pids.length > 0 ? spawnSync('ps', ['-p', pids.join(',')], { encoding: 'utf-8' }).stdout.trim().split('\n').length - 1 : 0;
  check(`cleanup: all ${pids.length} child processes ended (ps -p shows ${uebrig})`, uebrig === 0);
  rmSync(ORDNER, { recursive: true, force: true });
}

process.exit(fehler > 0 ? 1 : 0);
