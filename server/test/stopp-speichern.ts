/**
 * S1 — Stopp ohne Speichern: der Prozess endet trotzdem.
 *
 * Befund (Angriff auf K4.0, 20.09.2026): Scheitert saveWorld() im
 * SIGTERM-Weg (dort: copyFileSync EISDIR), landete die Ausnahme im
 * Auffangnetz, process.exit wurde nie erreicht; der Prozess lebte weiter und
 * der Port blieb auf LISTEN, bis systemd nach 30 s SIGKILL schickte.
 *
 * Geprüft wird mit echten Kindprozessen und echtem SIGTERM (ein Test im
 * selben Prozess kann "Prozess endet" nicht beweisen):
 *   A. Speichern scheitert (Verzeichnis liegt an der Stelle der Weltdatei):
 *      Kind ist in höchstens 2 s weg, Exit-Code 74, Kennzeile im Journal,
 *      Port zu, Prozess-ID nicht mehr vorhanden.
 *   B. Normalfall: Exit-Code 0, Weltdatei da, kein Fehler.
 *   C. Reihenfolge: erst Annahme zu, dann Save, dann Peers trennen
 *      (die Peers müssen beim Save noch in der Liste stehen).
 *   D. Der Handler selbst: wirft stop(), endet er trotzdem (Exit 75);
 *      ein zweites Signal tut nichts.
 *
 * Lauf: npx tsx test/stopp-speichern.ts   (aus server/)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';
import { createWovServer } from '../src/WovServer.js';
import {
  erstelleHerunterfahren,
  EXIT_SPEICHERN_FEHLGESCHLAGEN,
  EXIT_STOPP_GEWORFEN,
} from '../src/herunterfahren.js';
import { portVon } from '../../scripts/testport.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATEI = fileURLToPath(import.meta.url);
const TSX = resolve(__dirname, '../../node_modules/.bin/tsx');

// ── Kindmodus: ein Weltserver mit dem echten Signal-Handler ─────────
if (process.argv[2] === 'kind') {
  const worldsDir = process.argv[3]!;
  const server = createWovServer({
    port: 0,
    worldName: 'world',
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    worldsDir,
    kontenDir: resolve(worldsDir, 'konten'),
  });
  server.init();
  server.start();
  const fahreHerunter = erstelleHerunterfahren(server, (code) => process.exit(code));
  process.on('SIGTERM', fahreHerunter);
  console.log(`BEREIT ${portVon(server)}`);
  setInterval(() => {}, 1000); // am Leben bleiben wie der echte Server
} else {
  await haupt();
}

interface Lauf {
  code: number | null;
  ms: number;
  out: string;
  pid: number;
  port: number;
  portZuNachStopp: boolean;
  pidWeg: boolean;
}

function portOffen(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
}

function pidLebt(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function starteKind(worldsDir: string): Promise<{ lauf: () => Promise<Lauf> }> {
  return new Promise((ok, fehl) => {
    const kind = spawn(TSX, [DATEI, 'kind', worldsDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let port = 0;
    const timer = setTimeout(() => { kind.kill('SIGKILL'); fehl(new Error('Kind wurde nicht bereit:\n' + out)); }, 60_000);
    const beiDaten = (d: Buffer) => {
      out += d.toString();
      const m = /BEREIT (\d+)/.exec(out);
      if (m && port === 0) {
        port = Number(m[1]);
        clearTimeout(timer);
        ok({
          lauf: async () => {
            const t0 = Date.now();
            const ende = new Promise<number | null>((r) => kind.once('exit', (c) => r(c)));
            kind.kill('SIGTERM');
            const code = await Promise.race([
              ende,
              new Promise<number | null>((r) => setTimeout(() => r(-999), 10_000)),
            ]);
            const ms = Date.now() - t0;
            if (code === -999) kind.kill('SIGKILL');
            return {
              code, ms, out, pid: kind.pid!, port,
              portZuNachStopp: !(await portOffen(port)),
              pidWeg: !pidLebt(kind.pid!),
            };
          },
        });
      }
    };
    kind.stdout.on('data', beiDaten);
    kind.stderr.on('data', beiDaten);
  });
}

async function haupt(): Promise<void> {
  let failures = 0;
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
    else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); failures++; }
  };

  const WURZEL = resolve(tmpdir(), `server-stopp-speichern-${process.pid}`);
  rmSync(WURZEL, { recursive: true, force: true });

  console.log('=== S1 Stopp ohne Speichern ===');

  console.log('\n[A] Speichern scheitert (Verzeichnis statt Weltdatei):');
  const dirA = resolve(WURZEL, 'a');
  mkdirSync(resolve(dirA, 'world.db.zst'), { recursive: true });
  const a = await (await starteKind(dirA)).lauf();
  check('Prozess endet in höchstens 2 s', a.code !== -999 && a.ms <= 2000, `${a.ms} ms`);
  check(`Exit-Code ${EXIT_SPEICHERN_FEHLGESCHLAGEN}`, a.code === EXIT_SPEICHERN_FEHLGESCHLAGEN, `Code ${a.code}`);
  check('Kennzeile SAVE_FAILED_ON_STOP im Protokoll', a.out.includes('SAVE_FAILED_ON_STOP'));
  check('Kennzeile Exit-Code im Protokoll', a.out.includes(`Exit-Code ${EXIT_SPEICHERN_FEHLGESCHLAGEN}`));
  check('Port nicht mehr offen', a.portZuNachStopp, `Port ${a.port}`);
  check('Prozess-ID nicht mehr vorhanden', a.pidWeg, `pid ${a.pid}`);
  check('vorhandenes Verzeichnis unangetastet', existsSync(resolve(dirA, 'world.db.zst')));

  console.log('\n[B] Normalfall:');
  const dirB = resolve(WURZEL, 'b');
  const b = await (await starteKind(dirB)).lauf();
  check('Exit-Code 0', b.code === 0, `Code ${b.code}`);
  check('Weltdatei geschrieben', existsSync(resolve(dirB, 'world.db.zst')));
  check('"World saved" im Protokoll', b.out.includes('World saved'));
  check('kein SAVE_FAILED_ON_STOP', !b.out.includes('SAVE_FAILED_ON_STOP'));
  check('Port zu, Prozess weg', b.portZuNachStopp && b.pidWeg);
  const kopf = JSON.parse(zstdDecompressSync(readFileSync(resolve(dirB, 'world.db.zst'))).toString('utf-8'));
  check('Weltdatei lesbar (Version, Spieler-Liste)', typeof kopf.version === 'number' && Array.isArray(kopf.players));

  console.log('\n[C] Reihenfolge: Peers stehen beim Save noch in der Liste:');
  const dirC = resolve(WURZEL, 'c');
  const server = createWovServer({
    port: 0, worldName: 'world', worldSeed: 'KxSYuZquuw', worldFeatures: false,
    worldVegetation: false, worldCreatures: false, dungeonsEnabled: false,
    worldsDir: dirC, kontenDir: resolve(dirC, 'konten'),
  });
  server.init();
  server.start();
  const port = portVon(server);
  const net = (server as unknown as { net: { getPeers(): unknown[]; stop(): void; schliesseAnnahme(): void } }).net;
  const ereignisse: string[] = [];
  const stopAlt = net.stop.bind(net);
  const annahmeAlt = net.schliesseAnnahme.bind(net);
  const speicherAlt = server.saveWorld.bind(server);
  net.schliesseAnnahme = () => { ereignisse.push('annahme-zu'); annahmeAlt(); };
  net.stop = () => { ereignisse.push('net.stop'); stopAlt(); };
  server.saveWorld = () => { ereignisse.push('save'); speicherAlt(); };
  const erg = server.stop();
  check('stop() meldet true', erg === true);
  check('Reihenfolge Annahme zu → Save → Peers trennen', ereignisse.join(',') === 'annahme-zu,save,net.stop', ereignisse.join(','));
  check('Port nach stop() zu', !(await portOffen(port)));

  console.log('\n[D] Handler:');
  const meldungen: string[] = [];
  const codes: number[] = [];
  const wirft = erstelleHerunterfahren({ stop: () => { throw new Error('kaputt'); } }, (c) => codes.push(c), (z) => meldungen.push(z));
  wirft(); wirft();
  check(`stop() wirft → Exit ${EXIT_STOPP_GEWORFEN}, genau einmal`, codes.length === 1 && codes[0] === EXIT_STOPP_GEWORFEN, codes.join(','));
  const falsch: number[] = [];
  erstelleHerunterfahren({ stop: () => false }, (c) => falsch.push(c), () => {})();
  check(`stop() false → Exit ${EXIT_SPEICHERN_FEHLGESCHLAGEN}`, falsch[0] === EXIT_SPEICHERN_FEHLGESCHLAGEN);
  const gut: number[] = [];
  erstelleHerunterfahren({ stop: () => true }, (c) => gut.push(c), () => {})();
  check('stop() true → Exit 0', gut[0] === 0);

  rmSync(WURZEL, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`\n${failures} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden');
  process.exit(0);
}
