/**
 * Editor E2, card Z3: a withheld mass deletion (`bestaetigung-noetig`) survives a restart of the
 * game server, and stays withheld until an explicit `POST /api/welt/bestaetigen` — a restart alone
 * must not apply it, and the receipt must not silently flip to `angewendet`.
 *
 * The real operations service (spawned, port 0) answers the confirmation endpoint; a REAL game
 * server (in this process, layout mode, its own temp world directory, port 0) is stopped and a
 * FRESH instance started against the same files — that is what a process restart looks like from
 * outside (`WovServer` keeps no state beyond the file system).
 *
 *   npx tsx test/welt-bestaetigen-z3.ts   (from admin/)
 *
 * Cases:
 *  1. 5 trees + a chest with content, then `placements: []`: receipt `bestaetigung-noetig`, 0 ZDOs
 *     removed, the chest keeps its content, a warning names the count and the ids.
 *  2. Restart the REAL game server: the chest (with content) is STILL there, a warning was logged
 *     during the boot, and the receipt STAYS `bestaetigung-noetig` for the same hash (it does not
 *     flip to `angewendet` on its own).
 *  3. `POST /api/welt/bestaetigen` with a hash that no longer matches the file: 409, nothing applied.
 *  4. `POST /api/welt/bestaetigen` with the right hash: 200, the chest is gone, receipt `angewendet`.
 *  5. Revocation: writing the file back WITHOUT the mass deletion (the objects return) makes the open
 *     confirmation moot — the next receipt is a plain `angewendet` for the new hash, not stuck.
 *  6. `welt-zuruecksetzen`'s effect on an open confirmation: a boot against a DIFFERENT document (the
 *     kind a reset writes) ignores a stale confirmation of another hash and boots unprotected, as
 *     `main.ts` only ever applies the lock when the hash still matches exactly.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../../server/src/WovServer.js';
import type { ZDO } from '../../server/src/zdo/ZDO.js';

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
    await warte(20);
  }
  return true;
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-welt-bestaetigen-z3-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const INSTANZ = 'dev';
const QUITTUNG = quittungsDatei(SPIELSTAENDE, INSTANZ);
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'z3-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

type Platz = { id: string; prefab: string; x: number; z: number };
function dokument(placements: Platz[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Z3',
    detailSeed: 'z3-loeschschutz',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
  };
}
function schreibe(text: string): string {
  const temp = `${WELT_DATEI}.probe.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, WELT_DATEI);
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

const BAEUME: Platz[] = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 30 + i * 4, z: 20 }));
const KISTE: Platz = { id: 'kiste-1', prefab: 'piece_chest_wood', x: 60, z: 20 };
const DOC_VOLL: Platz[] = [...BAEUME, KISTE];
const HASH_VOLL = layoutHash(json(dokument(DOC_VOLL)));
schreibe(json(dokument(DOC_VOLL)));

function neuerServer(): ReturnType<typeof createWovServer> {
  return createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: INSTANZ,
    worldSeed: 'z3-loeschschutz',
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: SPIELSTAENDE,
    kontenDir: resolve(ORDNER, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: WELT_DATEI,
    saveIntervalMs: 3600_000,
  });
}

// ── real operations service (subprocess) ──
const HIER = resolve(new URL('.', import.meta.url).pathname);
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');
let dienst: ChildProcess | null = null;
function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_WELT_VERZEICHNIS: WELTEN,
        NODE_ENV: 'test',
        WOV_INSTANZ: INSTANZ,
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        WOV_SYSTEMCTL: SYSTEMCTL,
      },
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

async function bestaetigen(hash: string): Promise<{ status: number; daten: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/welt/bestaetigen`, {
    method: 'POST',
    headers: { 'x-wov-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ hash }),
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

async function haupt(): Promise<void> {
  let server = neuerServer();
  server.start();
  writeFileSync(LAEUFT, '');
  const layoutZdos = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
  const nach = (id: string): ZDO | undefined => layoutZdos().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);

  const zeilen: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]): void => {
    zeilen.push(a.map(String).join(' '));
    orig(...a);
  };

  try {
    check('set-up: boot applies the 6 entries', (await quittung(HASH_VOLL))?.ergebnis === 'angewendet', `${layoutZdos().length} ZDOs`);
    check('set-up: 6 layout ZDOs stand', layoutZdos().length === 6, `${layoutZdos().length}`);
    nach('kiste-1')?.setString('truheInhalt', '[[Wood,9]]');
    const kisteId = nach('kiste-1')?.zdoid.toString();

    // ── 1: placements: [] is withheld (live, no restart yet) ──
    zeilen.length = 0;
    const hashLeer = schreibe(json(dokument([])));
    let q = await quittung(hashLeer);
    check('1 placements:[] -> receipt bestaetigung-noetig', q?.ergebnis === 'nicht-angewendet' && q.grund === 'bestaetigung-noetig', `${q?.ergebnis} ${q?.grund}`);
    check('1 nothing removed: 6 layout ZDOs, chest content intact', layoutZdos().length === 6 && nach('kiste-1')?.getString('truheInhalt') === '[[Wood,9]]');
    check('1 warning names a count and ids', zeilen.some((z) => /bestätigung/i.test(z) && /kiste-1|t0|t1/.test(z)), zeilen.join(' | ').slice(0, 200));

    // ── 2: restart the REAL game server; the withheld state survives ──
    server.stop();
    await warte(300);
    zeilen.length = 0;
    server = neuerServer();
    server.start();
    writeFileSync(LAEUFT, '');
    await warte(2000); // boot + at least one tick of the new instance's layout wache
    const layoutZdos2 = (): ZDO[] => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
    const nach2 = (id: string): ZDO | undefined => layoutZdos2().find((z) => z.getString(LAYOUT_ID_MEMBER) === id);
    q = quittungLesen(QUITTUNG);
    check('2 restart: receipt STAYS bestaetigung-noetig for the same hash (does not flip to angewendet)', q?.hash === hashLeer && q.ergebnis === 'nicht-angewendet' && q.grund === 'bestaetigung-noetig', `${q?.hash === hashLeer ? '' : `hash mismatch (${q?.hash} vs ${hashLeer}) `}${q?.ergebnis} ${q?.grund}`);
    check('2 restart: chest (with content) still stands, 6 layout ZDOs', layoutZdos2().length === 6 && nach2('kiste-1')?.getString('truheInhalt') === '[[Wood,9]]', `${layoutZdos2().length} ZDOs, inhalt=${nach2('kiste-1')?.getString('truheInhalt')}`);
    check('2 restart: a warning was logged during/after the boot', zeilen.some((z) => /offene Bestätigung|zurückgehaltene Löschung/.test(z)), zeilen.join(' | ').slice(0, 200));

    // ── 3: confirming a stale hash is refused ──
    const stale = await bestaetigen('a'.repeat(64));
    check('3 confirm with a wrong hash: 409, nothing applied', stale.status === 409 && stale.daten.ok === false && stale.daten.aktuell === hashLeer, `${stale.status} ${JSON.stringify(stale.daten)}`);
    check('3 nothing changed by the refused confirmation: 6 layout ZDOs', layoutZdos2().length === 6);

    // ── 4: confirming the right hash applies the withheld deletion ──
    const ok = await bestaetigen(hashLeer);
    check('4 confirm with the right hash: 200, angewendet', ok.status === 200 && ok.daten.angewendet === true, `${ok.status} ${JSON.stringify(ok.daten)}`);
    check('4 the chest (and the trees) are gone: 0 layout ZDOs', layoutZdos2().length === 0, `${layoutZdos2().length}`);
    const q4 = quittungLesen(QUITTUNG);
    check('4 receipt angewendet for the confirmed hash', q4?.hash === hashLeer && q4.ergebnis === 'angewendet', `${q4?.hash} ${q4?.ergebnis}`);

    // ── 5: revocation — writing the objects back drops the open confirmation ──
    let hash = schreibe(json(dokument(DOC_VOLL)));
    q = await quittung(hash);
    check('5 set-up: the 6 entries return (fresh ZDOs)', q?.ergebnis === 'angewendet' && layoutZdos2().length === 6, `${q?.ergebnis} ${layoutZdos2().length}`);
    nach2('kiste-1')?.setString('truheInhalt', '[[Wood,5]]');
    zeilen.length = 0;
    const hashLeer2 = schreibe(json(dokument([])));
    q = await quittung(hashLeer2);
    check('5 set-up: bestaetigung-noetig again for the new empty document', q?.ergebnis === 'nicht-angewendet' && q.grund === 'bestaetigung-noetig', `${q?.ergebnis} ${q?.grund}`);
    hash = schreibe(json(dokument(DOC_VOLL))); // undo: bring the objects back instead of confirming
    q = await quittung(hash);
    check('5 revocation: writing the objects back is a plain "angewendet" for the new hash', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.ergebnis} ${q?.grund}`);
    check('5 revocation: no longer stuck on bestaetigung-noetig, 6 ZDOs (fresh)', layoutZdos2().length === 6, `${layoutZdos2().length}`);
    const nochOffen = await bestaetigen(hashLeer2);
    check('5 the old (revoked) confirmation no longer matches the current file: 409', nochOffen.status === 409, `${nochOffen.status} ${JSON.stringify(nochOffen.daten)}`);

    // ── 6: welt-zuruecksetzen writes a DIFFERENT document — a stale confirmation of another hash never applies ──
    zeilen.length = 0;
    const hashLeer3 = schreibe(json(dokument([])));
    await quittung(hashLeer3);
    check('6 set-up: bestaetigung-noetig once more', quittungLesen(QUITTUNG)?.grund === 'bestaetigung-noetig');
    server.stop();
    await warte(300);
    // A reset writes a fresh, valid, EMPTY-of-placements document with a NEW detailSeed (a different hash even
    // though it also has no placements) — the same shape `weltZuruecksetzenBehandeln`'s `leeresWeltdokument`
    // produces. It is written directly here (not through the reset route) to isolate exactly the boot-side
    // question the card asks: does a stale confirmation of the WITHHELD hash ever reach a document it was
    // never about? It must not — `main.ts` only sets `bootLoeschschutz` when the hash still matches exactly.
    const hashReset = schreibe(json({ ...dokument([]), detailSeed: 'nach-reset' }));
    check('6 the reset document has a DIFFERENT hash than the withheld one', hashReset !== hashLeer3);
    server = neuerServer();
    server.start();
    writeFileSync(LAEUFT, '');
    const q6 = await quittung(hashReset);
    check('6 boot against the reset document: applies normally (angewendet), the stale confirmation never matched', q6?.ergebnis === 'angewendet' && q6.grund === null, `${q6?.ergebnis} ${q6?.grund}`);
  } finally {
    console.warn = orig;
    dienst?.kill('SIGTERM');
    try {
      server.stop();
    } catch {
      /* already stopped */
    }
    await warte(400);
  }
}

try {
  await haupt();
} finally {
  if (existsSync(ORDNER)) rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
