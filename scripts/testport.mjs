/**
 * Ports for tests: the operating system picks them, a test never chooses one.
 *
 * Why. A fixed test port (2551, 2586, 27314, ...) is a shared resource that
 * nobody owns: two full runs at once, a probe another session runs on the same
 * number, or an orphan left by an aborted run all make the bind fail with
 * EADDRINUSE, and the test hangs or goes red for a reason that has nothing to
 * do with the code. The worktree slot ports (247n / 248n / 529n, see
 * AGENTS.md section 3) do NOT protect against that: they are a different band
 * and only reserved for a session's own manual runs, no test binds them.
 *
 * The rule.
 *   - A test that starts a server hands it `port: 0` and reads the real port
 *     back afterwards with `portVon(server)`. The kernel picks a free port and
 *     the bind is one step, so there is no window in which somebody else can
 *     take it. Do this whenever the test can.
 *   - A test that must tell a CHILD PROCESS or a CONFIG FILE the port before
 *     that one binds can ask `freierPort()`. That is the second choice: the
 *     port is reserved, released and only then handed on, so a small window
 *     remains in which another process could take it.
 *   - A test that really needs a fixed number (there is none today) writes the
 *     reason at the place AND enters the port in FESTE_PORTS below, so the list
 *     of fixed ports can be read in one place.
 *
 * `portVon` needs the server to be listening: create it with `port: 0`, call
 * `start()`, then read. It also takes a bare NetManager.
 *
 * Tests that only call `init()` never bind. They pass `port: 0` too, so the
 * number in the code cannot be mistaken for a port that is in use.
 */
import { createServer } from 'node:net';

/**
 * Fixed test ports that cannot be avoided, one entry per port, with the reason.
 * Empty on purpose: every test that binds takes an ephemeral port.
 *
 * @type {Readonly<Record<string, { port: number; grund: string }>>}
 */
export const FESTE_PORTS = Object.freeze({});

/**
 * The port a started server (a WovServer, or a NetManager) is really bound to.
 * Throws with a plain message if it is not listening, so a test that forgot
 * `start()` or passed a fixed port does not connect to nowhere.
 *
 * @param {{ boundPort?: number | null, net?: { boundPort: number | null } }} server
 * @returns {number}
 */
export function portVon(server) {
  const port = (server.net ?? server).boundPort ?? null;
  if (port === null) {
    throw new Error('portVon: the server is not listening — create it with `port: 0` and call start() first');
  }
  return port;
}

/**
 * A free port picked by the operating system, for the case that a child process
 * or a config file has to be told the port before it binds. Second choice, see
 * the header: reserve, release, hand on — a small window remains.
 *
 * @returns {Promise<number>}
 */
export function freierPort() {
  return new Promise((erfuellt, abgelehnt) => {
    const probe = createServer();
    probe.once('error', abgelehnt);
    probe.listen(0, '127.0.0.1', () => {
      const adresse = probe.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : null;
      probe.close((fehler) => (fehler || port === null ? abgelehnt(fehler ?? new Error('no port')) : erfuellt(port)));
    });
  });
}
