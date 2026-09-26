/**
 * Bind failures are loud, and "Listening" means bound.
 *
 * Before: WebSocketAcceptor logged "Listening on port <n>" straight after
 * calling listen(), whatever the bind did, and start() gave the caller no way
 * to see EADDRINUSE. The test occupies a port itself, starts the server on
 * exactly that port and expects: a rejected start() with code EADDRINUSE, an
 * error line with code and port, and no Listening line. A normal start on
 * port 0 must log the port the OS really gave.
 */
import { createServer } from 'node:net';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-listen-bindefehler');
rmSync(WORLDS_DIR, { recursive: true, force: true });

function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) throw new Error(text);
  console.log(`  ok: ${text}`);
}

const FRIST_MS = 10_000;

/** A start() that never settles must fail this test quickly, not at the runner timeout. */
function mitFrist<T>(p: Promise<T>, was: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const frist = new Promise<never>((_, nein) => {
    timer = setTimeout(() => nein(new Error(`${was} did not settle within ${FRIST_MS} ms`)), FRIST_MS);
  });
  return Promise.race([p, frist]).finally(() => clearTimeout(timer));
}

/** Run `f` and return everything it wrote through console.log / console.error. */
async function mitLog<T>(f: () => Promise<T>): Promise<{ zeilen: string[]; ergebnis: T | undefined; fehler: unknown }> {
  const zeilen: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => { zeilen.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { zeilen.push(a.join(' ')); };
  let ergebnis: T | undefined;
  let fehler: unknown;
  try {
    ergebnis = await f();
  } catch (e) {
    fehler = e;
  } finally {
    console.log = log;
    console.error = err;
  }
  return { zeilen, ergebnis, fehler };
}

/** Private start state, read for the cleanup checks. */
function zustand(s: unknown): { running: boolean; updateTimer: unknown; saveTimer: unknown } {
  return s as { running: boolean; updateTimer: unknown; saveTimer: unknown };
}

/** The acceptor is private to NetManager; the test reads its state on purpose. */
function acceptorVon(s: { net: unknown }): { isListening: boolean } {
  return (s.net as { acceptor: { isListening: boolean } }).acceptor;
}

/** Count the server's ticks by wrapping the private update(); a leftover timer shows up as ticks. */
function tickZaehler(s: unknown): { n: number } {
  const roh = s as { update(): void };
  const zaehler = { n: 0 };
  const orig = roh.update.bind(s);
  roh.update = () => { zaehler.n++; orig(); };
  return zaehler;
}

const warte = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

async function main(): Promise<void> {
  // 1. Occupy a port ourselves (OS-picked), then ask the server for exactly it.
  const fremd = createServer();
  await new Promise<void>((ok) => fremd.listen(0, ok));
  const belegt = (fremd.address() as { port: number }).port;
  let server = createWovServer({ port: belegt, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  let takt = tickZaehler(server);
  try {
    const l = await mitLog(() => mitFrist(server.start(), 'start() on an occupied port'));
    const fehlerCode = (l.fehler as NodeJS.ErrnoException | undefined)?.code;
    pruefe(fehlerCode === 'EADDRINUSE', `start() rejects with EADDRINUSE (got ${String(fehlerCode ?? (l.fehler as Error | undefined)?.message)})`);
    pruefe(
      l.zeilen.some((z) => z.includes('EADDRINUSE') && z.includes(String(belegt))),
      'an error line names EADDRINUSE and the port',
    );
    pruefe(!l.zeilen.some((z) => /Listening on port|Started on port|Server started/.test(z)), 'no success line is logged');
    pruefe(!acceptorVon(server).isListening, 'acceptor was closed after the failed bind');
    pruefe(zustand(server).running === false && zustand(server).updateTimer === null && zustand(server).saveTimer === null,
      'a failed start() leaves no running flag and no timers behind');
    takt.n = 0;
    await warte(300);
    pruefe(takt.n === 0, `no tick runs after the failed start (30/s would give ~9, got ${takt.n})`);
  } finally {
    server.stop();
    await new Promise<void>((ok) => fremd.close(() => ok()));
  }

  // 1b. An invalid port makes listen() throw synchronously (ERR_SOCKET_BAD_PORT).
  server = createWovServer({ port: 70000, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  takt = tickZaehler(server);
  try {
    const l = await mitLog(() => mitFrist(server.start(), 'start() on port 70000'));
    const code = (l.fehler as NodeJS.ErrnoException | undefined)?.code;
    pruefe(code === 'ERR_SOCKET_BAD_PORT', `start() rejects with ERR_SOCKET_BAD_PORT (got ${String(code ?? (l.fehler as Error | undefined)?.message)})`);
    pruefe(l.zeilen.some((z) => z.includes('Cannot listen on port 70000')), 'a "Cannot listen" line names the port');
    pruefe(!l.zeilen.some((z) => /Listening on port|Started on port|Server started/.test(z)), 'no success line is logged');
    pruefe(!acceptorVon(server).isListening, 'acceptor was closed after the synchronous failure');
    pruefe(zustand(server).running === false && zustand(server).updateTimer === null && zustand(server).saveTimer === null,
      'no running flag and no timers after the synchronous failure');
    takt.n = 0;
    await warte(300);
    pruefe(takt.n === 0, `no tick runs after the synchronous failure (got ${takt.n})`);
  } finally {
    server.stop();
  }

  // 2. Normal start on port 0: the Listening line carries the real port.
  server = createWovServer({ port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  try {
    const l = await mitLog(() => mitFrist(server.start(), 'normal start()'));
    pruefe(l.fehler === undefined, 'normal start resolves');
    const port = portVon(server);
    pruefe(port > 0 && l.ergebnis === port, `start() resolves with the bound port ${port}`);
    pruefe(l.zeilen.includes(`[Acceptor] Listening on port ${port}`), 'Listening line names the real port, not 0');
    // A later runtime error on the http server must not close a listener that works.
    const http = (acceptorVon(server) as unknown as { httpServer: { emit(e: string, x: Error): boolean } }).httpServer;
    const still = await mitLog(async () => http.emit('error', new Error('late runtime error')));
    pruefe(still.fehler === undefined && acceptorVon(server).isListening, 'a late http error leaves the working listener open');
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
  // 3. start() twice without stop() must not stack timers: after stop() no tick may remain.
  server = createWovServer({ port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  takt = tickZaehler(server);
  try {
    await mitFrist(server.start(), 'first start()');
    await mitFrist(server.start(), 'second start()');
  } finally {
    server.stop();
  }
  takt.n = 0;
  await warte(300);
  pruefe(takt.n === 0, `no orphaned tick after start(), start(), stop() (got ${takt.n})`);
  rmSync(WORLDS_DIR, { recursive: true, force: true });
  console.log('PASS: bind failures are logged and reach the caller; Listening only after bind');
}

// Explicit exit, see verbindungsdeckel.ts: the test server keeps timers open after stop().
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
