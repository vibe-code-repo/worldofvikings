/**
 * The HTTP way of the editor: GET /api/worldlayout hands the world document to the editor without a handshake.
 * A document with a greyglen region is refused (426, reload message) to a caller that announces an older protocol
 * version in `x-wov-protokoll` or none at all (an editor from before the header); a document without it goes to
 * everybody. Real operations service against a temp copy of a world.
 *
 * Der HTTP-Weg des Editors: GET /api/worldlayout liefert das Weltdokument ohne Handshake. Ein Dokument mit
 * greyglen-Region wird einem Aufrufer mit aelterer oder fehlender Protokollversion verweigert (426).
 *
 *   npx tsx test/welt-protokoll-kopf.ts      (aus admin/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { PROTOCOL_VERSION, PROTOKOLL_KOPF } from '@wov/shared/src/protokollVersion.js';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WURZEL = resolve(ADMIN, '..');
const TSX = resolve(WURZEL, 'node_modules/.bin/tsx');
const TOKEN = 'protokoll-token-4711';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const dokument = (biome: string): string => layoutText(sanitizeWorldLayout({
  version: 1, name: 'Kopf', detailSeed: 'kopf', continents: [{ id: 'c', name: 'C' }],
  regions: [{ id: 'r', continentId: 'c', biome, shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 }],
})!);

const kinder: ChildProcess[] = [];
const ordnerListe: string[] = [];
async function dienst(name: string, biome: string): Promise<number> {
  const ordner = mkdtempSync(resolve(tmpdir(), `wov-protokoll-kopf-${name}-`));
  ordnerListe.push(ordner);
  const welten = resolve(ordner, 'server/data/welten');
  mkdirSync(welten, { recursive: true });
  writeFileSync(resolve(welten, 'dev.json'), dokument(biome));
  writeFileSync(resolve(ordner, 'token'), `${TOKEN}\n`);
  return await new Promise<number>((fertig, scheitern) => {
    const kind = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WURZEL: ordner, WOV_WELT_VERZEICHNIS: welten, WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_QUITTUNG: 'aus', NODE_ENV: 'test', WOV_ADMIN_TOKEN_DATEI: resolve(ordner, 'token') },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: tsx starts the service as a CHILD of the process spawned here, so killing only the
      // spawned process leaves the service (and esbuild) running as an orphan. The whole group is killed below.
      detached: true,
    });
    kinder.push(kind);
    let log = '';
    const frist = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${log}`)), 30_000);
    const auf = (b: Buffer): void => {
      log += b.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(log);
      if (t) { clearTimeout(frist); fertig(Number(t[1])); }
    };
    kind.stdout!.on('data', auf);
    kind.stderr!.on('data', auf);
    kind.on('exit', (c) => { clearTimeout(frist); scheitern(new Error(`Dienst beendet mit ${c}:\n${log}`)); });
  });
}

async function hole(port: number, kopf?: string): Promise<{ status: number; daten: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/worldlayout`, { headers: { 'x-wov-token': TOKEN, ...(kopf !== undefined ? { [PROTOKOLL_KOPF]: kopf } : {}) } });
  return { status: r.status, daten: (await r.json()) as Record<string, unknown> };
}

try {
  const ohne = await dienst('ohne', 'grassland');
  const mit = await dienst('mit', 'greyglen');

  // world without greyglen: everybody
  for (const [name, kopf] of [['no header (editor from before the header)', undefined], ['version 2', '2'], ['current version', String(PROTOCOL_VERSION)], ['garbage', 'abc']] as const) {
    const a = await hole(ohne, kopf);
    check(`no greyglen, ${name}: 200 with the document`, a.status === 200 && a.daten.ok === true && typeof a.daten.hash === 'string');
  }

  // world with greyglen
  const keiner = await hole(mit);
  check('greyglen, no header: 426', keiner.status === 426, `= ${keiner.status}`);
  check('greyglen, no header: ok false, reload message in `message`, no document', keiner.daten.ok === false && /veraltet/.test(String(keiner.daten.message)) && /neu laden/.test(String(keiner.daten.message)) && keiner.daten.layout === undefined && keiner.daten.hash === undefined, String(keiner.daten.message));
  check('greyglen, no header: the message is bilingual and names the versions', /Client v2, Server v3/.test(String(keiner.daten.message)) && /please reload/.test(String(keiner.daten.message)));
  check('greyglen, version 2: 426', (await hole(mit, '2')).status === 426);
  check('greyglen, version 1: 426 (below the base)', (await hole(mit, '1')).status === 426);
  for (const wirr of ['abc', '3x', ' ', '-3', '3.0', '1e1', '999999999999']) {
    check(`greyglen, header ${JSON.stringify(wirr)}: 426 (not a plain number counts as the base version)`, (await hole(mit, wirr)).status === 426, String((await hole(mit, wirr)).status));
  }
  const neu = await hole(mit, String(PROTOCOL_VERSION));
  check('greyglen, current version: 200 with the document including the region', neu.status === 200 && neu.daten.ok === true && JSON.stringify(neu.daten.layout).includes('greyglen'));
  check('greyglen, a newer version: 200', (await hole(mit, String(PROTOCOL_VERSION + 4))).status === 200);
} finally {
  for (const k of kinder) {
    try { if (k.pid !== undefined) process.kill(-k.pid, 'SIGKILL'); } catch { /* group already gone */ }
  }
  await new Promise((r) => setTimeout(r, 300));
  for (const o of ordnerListe) rmSync(o, { recursive: true, force: true });
  for (const k of kinder) {
    let lebt = false;
    for (const ziel of k.pid === undefined ? [] : [-k.pid, k.pid]) {
      try { process.kill(ziel, 0); lebt = true; } catch { /* gone */ }
    }
    check('service process group is gone after the test', !lebt);
  }
}
if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nwelt-protokoll-kopf: alle Pruefungen gruen');
process.exit(0);
