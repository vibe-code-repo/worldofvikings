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

async function main(): Promise<void> {
  // 1. Occupy a port ourselves (OS-picked), then ask the server for exactly it.
  const fremd = createServer();
  await new Promise<void>((ok) => fremd.listen(0, ok));
  const belegt = (fremd.address() as { port: number }).port;
  let server = createWovServer({ port: belegt, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  try {
    const l = await mitLog(async () => server.start());
    const fehlerCode = (l.fehler as NodeJS.ErrnoException | undefined)?.code;
    pruefe(fehlerCode === 'EADDRINUSE', `start() rejects with EADDRINUSE (got ${String(fehlerCode)})`);
    pruefe(
      l.zeilen.some((z) => z.includes('EADDRINUSE') && z.includes(String(belegt))),
      'an error line names EADDRINUSE and the port',
    );
    pruefe(!l.zeilen.some((z) => /Listening on port|Started on port|Server started/.test(z)), 'no success line is logged');
    pruefe(server.net.boundPort === null, 'boundPort stays null');
  } finally {
    server.stop();
    await new Promise<void>((ok) => fremd.close(() => ok()));
  }

  // 2. Normal start on port 0: the Listening line carries the real port.
  server = createWovServer({ port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'listen-bindefehler' });
  try {
    const l = await mitLog(async () => server.start());
    pruefe(l.fehler === undefined, 'normal start resolves');
    const port = portVon(server);
    pruefe(port > 0 && l.ergebnis === port, `start() resolves with the bound port ${port}`);
    pruefe(l.zeilen.includes(`[Acceptor] Listening on port ${port}`), 'Listening line names the real port, not 0');
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
  console.log('PASS: bind failures are logged and reach the caller; Listening only after bind');
}

// Explicit exit, see verbindungsdeckel.ts: the test server keeps timers open after stop().
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
