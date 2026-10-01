import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { beendeProzess } from './testhilfen/prozess';

// Der Aufräum-Griff des SSR-Tests darf nie hängen: tot, lebendig, taub.
describe('beendeProzess', () => {
  const node = (code: string) => spawn(process.execPath, ['-e', code], { stdio: 'ignore' });

  it('ein schon beendeter Prozess: sofort zurück', async () => {
    const kind = node('process.exit(0)');
    await new Promise((r) => kind.once('exit', r));
    const t0 = Date.now();
    expect(await beendeProzess(kind, 5000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('ein lebendiger Prozess wird beendet', async () => {
    const kind = node('setInterval(() => {}, 1000)');
    expect(await beendeProzess(kind, 5000)).toBe(true);
    expect(kind.exitCode !== null || kind.signalCode !== null).toBe(true);
  });

  it('ein Prozess, der SIGTERM ignoriert, wird nach der Frist erschossen', async () => {
    const kind = node("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    expect(await beendeProzess(kind, 400)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(kind.signalCode).toBe('SIGKILL');
  });

  it('undefined (nie gestartet) ist in Ordnung', async () => {
    expect(await beendeProzess(undefined, 100)).toBe(true);
  });
});
