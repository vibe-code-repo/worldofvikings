/**
 * Abort the real service test's process group (TERM and KILL), then check
 * both process survival and the service port. Each probe owns a fresh mkdtemp
 * directory; its child creates its own temporary directories below it.
 * Signal/exit handlers are installed immediately after mkdtemp, before spawn.
 * No caller-supplied directory is removed and no previous run is cleaned up.
 *
 * The stdin EOF guard in the inner test ends its detached group if this test
 * dies. SIGKILL of THIS test cannot run cleanup: its directory may remain.
 * This is an explicit limit, not a reason to delete old directories next time.
 * Manual runner-abort sweep: upload-grundskala-betriebsdienst-abbruch-sweep.ts.
 * Run: npx tsx admin/test/upload-grundskala-betriebsdienst-abbruch.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures++;
}
function processesWithRoot(root: string): number[] {
  return readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).flatMap((entry) => {
    try {
      return readFileSync(`/proc/${entry}/environ`, 'utf8').split('\0').includes(`WOV_WURZEL=${root}`) ? [Number(entry)] : [];
    } catch { return []; }
  });
}
function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}
async function probe(signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  let child: ChildProcess | undefined;
  const directory = mkdtempSync(resolve(tmpdir(), 'wov-upload-abort-'));
  const cleanup = (): void => {
    if (child?.pid !== undefined) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
    }
    rmSync(directory, { recursive: true, force: true });
  };
  const term = (): never => { process.exit(143); };
  const interrupt = (): never => { process.exit(130); };
  process.on('exit', cleanup);
  process.on('SIGTERM', term);
  process.on('SIGINT', interrupt);
  try {
    console.log(`# probe ${signal} directory ${directory}`);
    child = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst.ts'], {
      cwd: ADMIN, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: directory, WOV_STDIN_WAECHTER: '1' },
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
      child!.once('exit', (code, exitSignal) => done({ code, signal: exitSignal }));
    });
    let output = '';
    const ready = await new Promise<{ port: number; root: string }>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`Service test never ready: ${output}`)), 30_000);
      child!.once('error', (error) => { clearTimeout(timer); reject(error); });
      child!.once('exit', (code, exitSignal) => {
        clearTimeout(timer);
        reject(new Error(`Premature exit ${code}/${exitSignal}: ${output}`));
      });
      child!.stdout!.on('data', (data: Buffer) => {
        output += data.toString();
        const match = /# Betriebsdienst auf 127\.0\.0\.1:(\d+), WOV_WURZEL (.*?), Uploads nach /.exec(output);
        if (match) { clearTimeout(timer); done({ port: Number(match[1]), root: match[2]! }); }
      });
      child!.stderr!.on('data', (data: Buffer) => { output += data.toString(); });
    });
    check(`${signal}: service port reported`, ready.port > 0);
    check(`${signal}: inner root belongs to this probe`, ready.root.startsWith(`${directory}/`), ready.root);
    process.kill(-child.pid!, signal);
    const result = await Promise.race([exited, delay(5_000).then(() => { throw new Error('Child did not exit'); })]);
    check(`${signal}: expected child exit`, signal === 'SIGTERM'
      ? result.code === 143 || result.signal === 'SIGTERM'
      : result.signal === 'SIGKILL', JSON.stringify(result));
    await delay(1_000);
    if (signal === 'SIGTERM') check('SIGTERM: inner test removed its own directory', !existsSync(ready.root));
    const survivors = processesWithRoot(ready.root);
    check(`${signal}: no surviving service`, survivors.length === 0, survivors.join(','));
    check(`${signal}: service port released`, await portIsFree(ready.port));
  } finally {
    cleanup();
    process.removeListener('exit', cleanup);
    process.removeListener('SIGTERM', term);
    process.removeListener('SIGINT', interrupt);
    check(`${signal}: own directory removed`, !existsSync(directory));
  }
}
try {
  await probe('SIGTERM');
  await probe('SIGKILL');
} catch (error) {
  console.error(error);
  failures++;
}
console.log(failures === 0 ? 'OK — no orphan after either abort probe.' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
