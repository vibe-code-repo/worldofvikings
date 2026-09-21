/**
 * Measuring tool, not a test: which processes really call `listen()`, and on
 * which port? It answers "does this test bind a fixed port?" from a run instead
 * of from reading the code (a number in the code is not a bind: a test that only
 * calls `init()` never binds, and a constant tells nothing about that).
 *
 * It is preloaded into the test process and, because `NODE_OPTIONS` is
 * inherited, into every child process the test starts:
 *
 *   TP_SPION_LOG=/tmp/mein-lauf-$$.jsonl \
 *   NODE_OPTIONS="--import $PWD/scripts/listen-spion.mjs" npx tsx server/test/f1-truhe.ts
 *
 * One JSON line per `listen()`: `{ pid, skript, port }`. `port` is the number the
 * caller asked for (0 = the operating system picks it) or the text of a path or
 * pipe. Add `TP_SPION_TROCKEN=1` to measure WITHOUT binding: a call with a
 * fixed number (not 0) is logged and refused with an error, so nothing is bound
 * and nobody else's run or probe is disturbed while you count.
 *
 * Use a unique log path per run (`/tmp/<slug>-$$`), see CLAUDE.md.
 */
import net from 'node:net';
import { appendFileSync } from 'node:fs';

const logDatei = process.env.TP_SPION_LOG;
const trocken = process.env.TP_SPION_TROCKEN === '1';

if (logDatei) {
  const echt = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...argumente) {
    const erstes = argumente[0];
    const gewollt = erstes !== null && typeof erstes === 'object' ? erstes.port : erstes;
    const port = typeof gewollt === 'number' ? gewollt : String(gewollt);
    appendFileSync(logDatei, `${JSON.stringify({ pid: process.pid, skript: process.argv.slice(1, 3).join(' ').slice(-120), port })}\n`);
    if (trocken && typeof port === 'number' && port !== 0) {
      throw new Error(`listen-spion: listen(${port}) refused (TP_SPION_TROCKEN=1)`);
    }
    return echt.apply(this, argumente);
  };
}
