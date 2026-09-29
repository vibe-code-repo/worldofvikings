/**
 * Editor E2, Karte Z3 N1 (Nachbesserung nach dem Angriff auf PR #120): `POST /api/welt/bestaetigen`
 * löscht GENAU die dauerhaft gesperrten ids, die im aktuellen Dokument fehlen — kein Abgleich im
 * Boot-Stil mehr (Angriffsbefund A5: das belebte vorher gefällte Bäume und getötete NPCs). Die
 * Boot-über-Neustart-Fälle (A1a/A2/A3) stehen als echter `main.ts`-Kindprozess in
 * `server/test/z3n1-hauptprozess.ts`; A1b/A1c und die Sperrlogik selbst in
 * `server/test/z3n1-live-inproc.ts`. Hier: der echte Betriebsdienst (Kindprozess) + ein echter
 * Spielserver (in diesem Prozess, Port 0) für die BESTÄTIGEN/RÜCKNAHME/RESET-Wege.
 *
 *   npx tsx test/welt-bestaetigen-z3.ts   (aus admin/)
 *
 * Fälle:
 *  1. Massenlöschung wird zurückgehalten, dauerhaft gesperrt (Sperrdatei mit ids).
 *  2. Bestätigen ohne offene Sperre: 409 nichts-offen, keine Anfrage-Datei.
 *  3. Bestätigen mit veraltetem Hash: 409, nichts geändert.
 *  4. Bestätigen mit dem richtigen Hash: GENAU die gesperrten ids weg, ein vorher gefällter Baum
 *     bleibt gefällt (kein Abgleich im Boot-Stil), Sperrdatei weg.
 *  5. Rücknahme: die Truhe wieder ins Dokument schreiben → Sperrdatei weg (ohne Bestätigen).
 *  6. Welt zurücksetzen (K4.0) mit offener Sperre → Sperrdatei weg.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungSchreiben, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { bestaetigenAnfrageDatei } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { loeschsperreDatei, loeschsperreLesen } from '@wov/shared/src/worldlayout/loeschsperre.js';
import { createWovServer } from '../../server/src/WovServer.js';
import { weltBestaetigenBehandeln } from '../src/routen/weltBestaetigen.js';
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
const SPERRE = loeschsperreDatei(SPIELSTAENDE, INSTANZ);
const ANFRAGE = bestaetigenAnfrageDatei(SPIELSTAENDE, INSTANZ);
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
    name: 'Z3N1',
    detailSeed: 'z3n1-bestaetigen',
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
async function quittung(hash: string, ms = 8000): Promise<Quittung | null> {
  let q: Quittung | null = null;
  await warteAuf(() => {
    q = quittungLesen(QUITTUNG);
    return q?.hash === hash;
  }, ms);
  return q && (q as Quittung).hash === hash ? (q as Quittung) : null;
}
async function quittungAngewendet(hash: string, ms = 8000): Promise<Quittung | null> {
  let q: Quittung | null = null;
  await warteAuf(() => {
    q = quittungLesen(QUITTUNG);
    return q?.hash === hash && q.ergebnis === 'angewendet';
  }, ms);
  return q && (q as Quittung).hash === hash && (q as Quittung).ergebnis === 'angewendet' ? (q as Quittung) : null;
}

const BAEUME: Platz[] = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 30 + i * 4, z: 20 }));
const KISTE: Platz = { id: 'kiste-1', prefab: 'piece_chest_wood', x: 60, z: 20 };
const DOC_VOLL: Platz[] = [...BAEUME, KISTE];
const HASH_VOLL = layoutHash(json(dokument(DOC_VOLL)));
schreibe(json(dokument(DOC_VOLL)));

const server = createWovServer({
  port: 0,
  everyoneAdmin: true,
  worldName: INSTANZ,
  worldSeed: 'z3n1-bestaetigen',
  worldFeatures: false,
  worldVegetation: false,
  worldsDir: SPIELSTAENDE,
  kontenDir: resolve(ORDNER, 'konten'),
  worldMode: 'layout',
  worldLayoutPath: WELT_DATEI,
  saveIntervalMs: 3600_000,
});

// ── echter Betriebsdienst (Kindprozess) ──
const HIER = resolve(new URL('.', import.meta.url).pathname);
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');
let dienst: ChildProcess | null = null;
/** Z3 N2 (B6): end the service's whole process group (a KILL to the tsx wrapper alone leaves the node behind it). */
function gruppeBeenden(signal: NodeJS.Signals = 'SIGKILL'): void {
  const pid = dienst?.pid;
  if (!pid) return;
  for (const ziel of [-pid, pid]) {
    try {
      process.kill(ziel, signal);
    } catch {
      /* already gone */
    }
  }
}
function aufraeumenAlles(): void {
  gruppeBeenden('SIGKILL');
  rmSync(ORDNER, { recursive: true, force: true });
}
process.on('exit', aufraeumenAlles);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => {
    aufraeumenAlles();
    process.exit(1);
  });
}
// The wrapper above us is gone (KILL to it re-parents this process): clean up instead of running on.
const ELTERN = process.ppid;
setInterval(() => {
  if (process.ppid !== ELTERN) {
    aufraeumenAlles();
    process.exit(1);
  }
}, 500).unref();
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
      detached: true, // own process group (Z3 N2, B6): the tsx wrapper AND the node behind it die with `gruppeBeenden`
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
    check('set-up: boot applies the 31 entries', (await quittung(HASH_VOLL))?.ergebnis === 'angewendet', `${layoutZdos().length} ZDOs`);
    check('set-up: 31 layout ZDOs stand', layoutZdos().length === 31, `${layoutZdos().length}`);
    nach('kiste-1')?.setString('truheInhalt', '[[Wood,9]]');
    // Ein bereits gefällter Baum (kein Löschen, nur "gefällt"): sein ZDO geht, der EINTRAG bleibt im
    // Dokument stehen. Boot-Stil-Reconciliation würde ihn wiederbeleben (Angriffsbefund A5) — dieser
    // Weg (E-d) darf das nicht.
    const t3 = nach('t3');
    check('set-up: t3 exists before felling', !!t3);
    t3 && server.zdos.destroyZDO(t3.zdoid);
    check('set-up: t3 felled (30 ZDOs)', layoutZdos().length === 30, `${layoutZdos().length}`);

    // ── 2: confirming without any open lock is refused ──
    const ohneSperre = await bestaetigen(HASH_VOLL);
    check('2 confirm without an open lock: 409 nichts-offen', ohneSperre.status === 409 && ohneSperre.daten.fehler === 'nichts-offen', `${ohneSperre.status} ${JSON.stringify(ohneSperre.daten)}`);

    // ── 1: placements: [] is withheld and durably locked ──
    zeilen.length = 0;
    const hashLeer = schreibe(json(dokument([])));
    let q = await quittung(hashLeer);
    check('1 placements:[] -> receipt bestaetigung-noetig', q?.ergebnis === 'nicht-angewendet' && q.grund === 'bestaetigung-noetig', `${q?.ergebnis} ${q?.grund}`);
    check('1 nothing removed: 30 layout ZDOs, chest content intact', layoutZdos().length === 30 && nach('kiste-1')?.getString('truheInhalt') === '[[Wood,9]]');
    const sperre1 = loeschsperreLesen(SPERRE);
    check(
      '1 Sperrdatei enthält die 30 zurückgehaltenen ids',
      sperre1 !== null && sperre1 !== 'kaputt' && sperre1.ids.length === 30 && sperre1.ids.includes('kiste-1') && !sperre1.ids.includes('t3'),
      JSON.stringify(sperre1)
    );
    check('1 warning names a count and ids', zeilen.some((z) => /Löschsperre/.test(z) && /kiste-1|t0|t1/.test(z)), zeilen.join(' | ').slice(0, 200));

    // ── 3: confirming a stale hash is refused ──
    const stale = await bestaetigen('a'.repeat(64));
    check('3 confirm with a wrong hash: 409, nothing applied', stale.status === 409 && stale.daten.ok === false && stale.daten.aktuell === hashLeer, `${stale.status} ${JSON.stringify(stale.daten)}`);
    check('3 nothing changed by the refused confirmation: 30 layout ZDOs', layoutZdos().length === 30);

    // ── 3b: an unreadable lock is refused (409), never freed, and no request file is written ──
    const sperreBytes = existsSync(SPERRE) ? readFileSync(SPERRE, 'utf-8') : '';
    writeFileSync(SPERRE, '{kaputt');
    const kaputt = await bestaetigen(hashLeer);
    check('3b confirm with a broken lock file: 409, no request file', kaputt.status === 409 && kaputt.daten.ok === false && !existsSync(ANFRAGE), `${kaputt.status} ${JSON.stringify(kaputt.daten)}`);
    check('3b the broken lock file is untouched', existsSync(SPERRE) && readFileSync(SPERRE, 'utf-8') === '{kaputt');
    if (sperreBytes) writeFileSync(SPERRE, sperreBytes);
    else rmSync(SPERRE, { force: true });

    // ── 3c: an OLD "angewendet" receipt for the same hash is no success for a new request ──
    // (after a start with a lock the wache writes `angewendet` for the current hash without any confirmation).
    // While a save runs the wache cannot take the request: the answer must be 202, not a stale 200.
    const srv = server as unknown as { speichertGerade: boolean };
    srv.speichertGerade = true;
    quittungSchreiben(QUITTUNG, { hash: hashLeer, ergebnis: 'angewendet', grund: null, zaehler: null, zeit: new Date().toISOString() });
    const t3c = Date.now();
    const alt = await bestaetigen(hashLeer);
    check('3c old angewendet receipt: NO premature 200 (202 keine-quittung after the wait)', alt.status === 202 && alt.daten.angewendet === false && Date.now() - t3c >= 2500, `${alt.status} ${JSON.stringify(alt.daten)} after ${Date.now() - t3c} ms`);
    check('3c the request is still pending, 30 layout ZDOs stand', existsSync(ANFRAGE) && layoutZdos().length === 30, `${layoutZdos().length}`);
    srv.speichertGerade = false;
    await warteAuf(() => !existsSync(ANFRAGE), 5000);
    check('3c after the save the wache takes the request and deletes the locked ids', !existsSync(ANFRAGE) && layoutZdos().length === 0 && loeschsperreLesen(SPERRE) === null, `${layoutZdos().length}`);
    // Back to the state before 3b for the following steps: full document, the felled t3 stays felled.
    const hashVoll2 = schreibe(json(dokument(DOC_VOLL)));
    await quittung(hashVoll2);
    nach('kiste-1')?.setString('truheInhalt', '[[Wood,9]]');
    nach('t3') && server.zdos.destroyZDO(nach('t3')!.zdoid);
    const hashLeerB = schreibe(json(dokument([])));
    await quittung(hashLeerB);
    check('3c set-up for 4: lock is open again with the chest', loeschsperreLesen(SPERRE) !== null && !!nach('kiste-1'));

    // ── 4: confirming the right hash removes EXACTLY the locked ids, nothing else ──
    const ok = await bestaetigen(hashLeerB);
    check(
      '4 confirm with the right hash: self-consistent answer (200+angewendet, or 202+bestaetigung-noetig while the wache catches up)',
      (ok.status === 200 && ok.daten.angewendet === true && ok.daten.bestaetigt === true && ok.daten.entfernt === 30) || (ok.status === 202 && ok.daten.angewendet === false),
      `${ok.status} ${JSON.stringify(ok.daten)}`
    );
    const q4 = await quittungAngewendet(hashLeerB);
    check('4 receipt angewendet for the confirmed hash', q4?.hash === hashLeerB && q4.ergebnis === 'angewendet', `${q4?.hash} ${q4?.ergebnis}`);
    check('4 the chest and the 29 standing trees are gone: 0 layout ZDOs', layoutZdos().length === 0, `${layoutZdos().length}`);
    check('4 lock file is gone', loeschsperreLesen(SPERRE) === null, JSON.stringify(loeschsperreLesen(SPERRE)));
    check('4 the felled t3 was NOT resurrected (no boot-style reconciliation, findet A5)', !nach('t3'));

    // ── 5: revocation — writing the objects back drops the open lock, WITHOUT confirming ──
    let hash = schreibe(json(dokument(DOC_VOLL)));
    q = await quittung(hash);
    // t3 stays felled: its entry never left the document's applied state (tombstone), so only 30 ZDOs come back.
    check('5 set-up: the entries return (30 ZDOs; the felled t3 stays felled)', q?.ergebnis === 'angewendet' && layoutZdos().length === 30, `${q?.ergebnis} ${layoutZdos().length}`);
    nach('kiste-1')?.setString('truheInhalt', '[[Wood,5]]');
    zeilen.length = 0;
    const hashLeer2 = schreibe(json(dokument([])));
    q = await quittung(hashLeer2);
    check('5 set-up: bestaetigung-noetig again for the new empty document', q?.ergebnis === 'nicht-angewendet' && q.grund === 'bestaetigung-noetig', `${q?.ergebnis} ${q?.grund}`);
    check('5 set-up: lock file exists', loeschsperreLesen(SPERRE) !== null);
    hash = schreibe(json(dokument(DOC_VOLL))); // undo: bring the objects back instead of confirming
    q = await quittung(hash);
    check('5 revocation: writing the objects back is a plain "angewendet" for the new hash', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.ergebnis} ${q?.grund}`);
    check('5 revocation: no longer stuck on bestaetigung-noetig, 30 ZDOs', layoutZdos().length === 30, `${layoutZdos().length}`);
    check('5 revocation: lock file is gone (every id is back in the document)', loeschsperreLesen(SPERRE) === null, JSON.stringify(loeschsperreLesen(SPERRE)));
    const nochOffen = await bestaetigen(hashLeer2);
    check('5 confirming the revoked (gone) lock: 409 nichts-offen', nochOffen.status === 409 && nochOffen.daten.fehler === 'nichts-offen', `${nochOffen.status} ${JSON.stringify(nochOffen.daten)}`);

    // ── 7 (Z3 N2, B2): the answer of the operations service carries the open lock; editor and MCP show it ──
    {
      // Editor and MCP code are loaded by a path in a variable (the admin package is type-checked without the DOM lib and
      // the MCP SDK's types); their constants are read at import, so the environment is set first.
      process.env.WOV_ADMIN_URL = `http://127.0.0.1:${port}`;
      process.env.WOV_ADMIN_TOKEN = TOKEN;
      process.env.WOV_MCP_FREMDE_WELT = '1';
      const laden = (pfad: string): Promise<unknown> => import(pfad);
      const mcp = (await laden(resolve(HIER, '../../tools/worldlayout-mcp/kern.ts'))) as {
        wirkungsHinweis(status: number, daten: Record<string, unknown>, locale?: string): string;
      };
      const { schreibeWeltdokument, wirkungsText } = (await laden(resolve(HIER, '../../client/src/editor/weltdokument.ts'))) as {
        schreibeWeltdokument(layout: unknown, basis: string | null, fetchFn: typeof fetch, locale?: string): Promise<{ art: string; message: string; angewendet: boolean | null; sperrHinweis?: string | null }>;
        wirkungsText(a: unknown): string;
      };
      const dateiHash = (): string => layoutHash(readFileSync(WELT_DATEI));
      interface Antwort7 {
        grund?: string;
        message?: string;
        angewendet?: boolean;
        loeschsperre?: { anzahl: number };
        loeschsperreHinweis?: string;
      }
      const post = async (d: unknown): Promise<{ status: number; daten: Antwort7 }> => {
        const r = await fetch(`http://127.0.0.1:${port}/api/worldlayout`, {
          method: 'POST',
          headers: { 'x-wov-token': TOKEN, 'content-type': 'application/json', 'if-match': `"${dateiHash()}"` },
          body: JSON.stringify(d),
        });
        return { status: r.status, daten: (await r.json().catch(() => ({}))) as Antwort7 };
      };
      nach('kiste-1')?.setString('truheInhalt', '[[Wood,7]]');
      const erste = await post(dokument(BAEUME)); // the chest (with content) leaves the document
      check('7 first document without the chest: 202 bestaetigung-noetig, the answer names the lock (1)', erste.status === 202 && erste.daten.grund === 'bestaetigung-noetig' && erste.daten.loeschsperre?.anzahl === 1, `${erste.status} ${JSON.stringify(erste.daten).slice(0, 300)}`);
      check(
        '7 the 202 text no longer promises that the next restart takes the file; it names the durable lock and the confirmation',
        !/nächste Neustart übernimmt/.test(String(erste.daten.message)) && /dauerhaft gesperrt/.test(String(erste.daten.message)) && /bestaetigen/.test(String(erste.daten.message)),
        String(erste.daten.message)
      );
      const zweite = await post(dokument([...BAEUME, { id: 'neu-b', prefab: 'Beech1', x: 700, z: 20 }])); // a harmless follow-up change
      check('7 second document (+1 tree): 200 angewendet, the tree stands, the chest stands with content', zweite.status === 200 && zweite.daten.angewendet === true && !!nach('neu-b') && nach('kiste-1')?.getString('truheInhalt') === '[[Wood,7]]', `${zweite.status} ${JSON.stringify(zweite.daten).slice(0, 300)}`);
      check('7 the 200 answer carries the lock (anzahl 1) and a hint that the chest stays locked and how to confirm', zweite.daten.loeschsperre?.anzahl === 1 && /gesperrt/.test(String(zweite.daten.loeschsperreHinweis)) && /bestaetigen/.test(String(zweite.daten.loeschsperreHinweis)), `${JSON.stringify(zweite.daten.loeschsperre)} ${String(zweite.daten.loeschsperreHinweis)}`);
      const mcpText = mcp.wirkungsHinweis(zweite.status, zweite.daten as Record<string, unknown>);
      check('7 MCP reader: not the bare success sentence; names the locked object and the confirmation', mcpText !== '\nIm laufenden Spiel angewendet.' && /1 Objekt\(e\) bleiben gesperrt/.test(mcpText) && /bestaetigen/.test(mcpText), mcpText);
      check('7 MCP reader (en): same content, English', /stay locked/.test(mcp.wirkungsHinweis(200, zweite.daten as Record<string, unknown>, 'en')) && !/gesperrt/.test(mcp.wirkungsHinweis(200, zweite.daten as Record<string, unknown>, 'en')), mcp.wirkungsHinweis(200, zweite.daten as Record<string, unknown>, 'en'));
      check('7 MCP reader for the 202: names the durable lock', /dauerhaft gesperrt/.test(mcp.wirkungsHinweis(erste.status, erste.daten as Record<string, unknown>)), mcp.wirkungsHinweis(erste.status, erste.daten as Record<string, unknown>));
      const editorFetch = ((url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-wov-token': TOKEN } })) as typeof fetch;
      const ed = await schreibeWeltdokument(dokument([...BAEUME, { id: 'neu-b', prefab: 'Beech1', x: 700, z: 20 }, { id: 'neu-c', prefab: 'Beech1', x: 720, z: 20 }]), dateiHash(), editorFetch);
      const edSatz = ed.art === 'ok' ? wirkungsText(ed) : '';
      check('7 editor: applied, but the sentence is not "live angewendet." alone; it names the locked object', ed.art === 'ok' && ed.angewendet === true && edSatz !== ' — live angewendet.' && /gesperrt/.test(edSatz) && /bestaetigen/.test(edSatz), edSatz);
      const edEn = await schreibeWeltdokument(dokument([...BAEUME, { id: 'neu-b', prefab: 'Beech1', x: 700, z: 20 }, { id: 'neu-c', prefab: 'Beech1', x: 720, z: 20 }, { id: 'neu-d', prefab: 'Beech1', x: 740, z: 20 }]), dateiHash(), editorFetch, 'en');
      check('7 editor (en): the lock sentence is English', edEn.art === 'ok' && /stay locked/.test(edEn.sperrHinweis ?? ''), String((edEn as { sperrHinweis?: string }).sperrHinweis));
      // put the chest back: the lock is revoked, and step 6 starts from a clean state
      const zurueckHash = schreibe(json(dokument(DOC_VOLL)));
      await quittung(zurueckHash);
      check('7 clean-up: chest back in the document, lock revoked', loeschsperreLesen(SPERRE) === null && !!nach('kiste-1'));
    }

    // ── 8 (Z3 N2, B5): the texts of POST /api/welt/bestaetigen come from the catalog, in both languages ──
    {
      const vorher = process.env.WOV_LANGUAGE;
      try {
        const umgKaputt = { datei: WELT_DATEI, anfragePfad: ANFRAGE, loeschsperrePfad: SPERRE, quittungsPfad: QUITTUNG, dienstAktiv: async () => true, warten: false };
        process.env.WOV_LANGUAGE = 'de';
        const de = (await weltBestaetigenBehandeln({ hash: 'x' }, umgKaputt)) as { code: number; daten: { message: string } };
        process.env.WOV_LANGUAGE = 'en';
        const en = (await weltBestaetigenBehandeln({ hash: 'x' }, umgKaputt)) as { code: number; daten: { message: string } };
        const enLeer = (await weltBestaetigenBehandeln({}, umgKaputt)) as { code: number; daten: { message: string } };
        check('8 no open lock: 409, German text by default', de.code === 409 && /Keine zurückgehaltene Löschung/.test(de.daten.message), de.daten.message);
        check('8 no open lock: 409, English text with WOV_LANGUAGE=en', en.code === 409 && /No held-back deletion/.test(en.daten.message) && !/Löschung/.test(en.daten.message), en.daten.message);
        check('8 empty hash: 400, English text', enLeer.code === 400 && /missing or empty/.test(enLeer.daten.message), enLeer.daten.message);
      } finally {
        if (vorher === undefined) delete process.env.WOV_LANGUAGE;
        else process.env.WOV_LANGUAGE = vorher;
      }
      // the two catalogs carry the same keys and the same placeholders (a text without its English twin would show a hole)
      const katalog = (sprache: string): Record<string, string> => JSON.parse(readFileSync(resolve(HIER, `../../shared/data/worldlayout/${sprache}.json`), 'utf-8'));
      const kd = katalog('de');
      const ke = katalog('en');
      const platz = (t: string): string => [...t.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort().join(',');
      check('8 catalog: de and en have the same keys', Object.keys(kd).sort().join('|') === Object.keys(ke).sort().join('|'));
      check('8 catalog: same placeholders per key', Object.keys(kd).every((k) => platz(kd[k]!) === platz(ke[k] ?? '')), Object.keys(kd).filter((k) => platz(kd[k]!) !== platz(ke[k] ?? '')).join(','));
      check('8 catalog: the confirm.* and lock.* texts exist (>= 15 keys)', Object.keys(kd).filter((k) => /^(confirm|lock)\./.test(k)).length >= 15);
    }

    // ── 6: welt-zuruecksetzen removes an open lock file ──
    zeilen.length = 0;
    const hashLeer3 = schreibe(json(dokument([])));
    await quittung(hashLeer3);
    check('6 set-up: bestaetigung-noetig once more, lock file present', quittungLesen(QUITTUNG)?.grund === 'bestaetigung-noetig' && loeschsperreLesen(SPERRE) !== null);
    const reset = await fetch(`http://127.0.0.1:${port}/api/welt-zuruecksetzen`, {
      method: 'POST',
      headers: { 'x-wov-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ bestaetigung: INSTANZ, seed: 'neu', konten: false }),
    });
    const resetDaten = (await reset.json().catch(() => ({}))) as Record<string, unknown>;
    check('6 reset accepted', reset.status === 200, `${reset.status} ${JSON.stringify(resetDaten).slice(0, 300)}`);
    check('6 reset removes the lock file', loeschsperreLesen(SPERRE) === null, JSON.stringify(loeschsperreLesen(SPERRE)));
    writeFileSync(LAEUFT, ''); // the reset restarted the (faked) service; keep the "aktiv" marker consistent
  } finally {
    console.warn = orig;
    gruppeBeenden('SIGTERM');
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
