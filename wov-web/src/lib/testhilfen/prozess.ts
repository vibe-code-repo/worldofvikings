import type { ChildProcess } from 'node:child_process';

/**
 * Beendet einen Kindprozess und wartet darauf, aber höchstens `frist` ms.
 * Ist er schon tot, kehrt die Funktion sofort zurück; ignoriert er SIGTERM,
 * folgt nach der Frist SIGKILL. Gibt zurück, ob er am Ende beendet war.
 */
export async function beendeProzess(
  kind: ChildProcess | undefined,
  frist: number,
): Promise<boolean> {
  if (!kind || kind.exitCode !== null || kind.signalCode !== null) return true;
  const ende = new Promise<void>((fertig) => kind.once('exit', () => fertig()));
  void 0;
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const abgelaufen = new Promise<'frist'>((fertig) => {
    uhr = setTimeout(() => fertig('frist'), frist);
  });
  const erster = await Promise.race([ende.then(() => 'ende' as const), abgelaufen]);
  clearTimeout(uhr);
  if (erster === 'frist') {
    kind.kill('SIGKILL');
    await Promise.race([ende, new Promise((r) => setTimeout(r, 2000))]);
  }
  return kind.exitCode !== null || kind.signalCode !== null;
}
