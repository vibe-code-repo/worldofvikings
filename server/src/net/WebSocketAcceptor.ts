/**
 * WebSocketAcceptor — accepts incoming WebSocket connections.
 * Replaces the acceptor of the reference server, which holds
 * a single listen socket.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { herkunftErmitteln } from './Herkunft.js';

export interface AcceptResult {
  socket: WebSocket;
  address: string;
}

/**
 * Handles a plain HTTP request on the game port. Returns true when it took
 * the request; false lets the acceptor fall back to its 426.
 */
export type HttpBehandler = (req: IncomingMessage, res: ServerResponse) => boolean;

export class WebSocketAcceptor {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private onConnection: ((socket: WebSocket, address: string) => void) | null = null;

  /**
   * Start listening on the given port.
   *
   * The HTTP server is created explicitly rather than left to `ws`, so that
   * a handler can answer plain requests on the same port — that is how the
   * account API (/api/konto/...) reaches the browser without a second host
   * or certificate.
   *
   * Everything the handler does not take keeps answering 426 Upgrade
   * Required, exactly as before: tools/wov-update.sh uses that status as
   * its health check after every rollout.
   *
   * Returns a promise for the port the socket is really bound to (the one
   * the OS picked when `port` is 0). It rejects with the original error
   * (EADDRINUSE, EACCES, ...) when binding fails, after logging the code and
   * the port. "Listening" is logged only once the socket is bound: the bind
   * itself still happens synchronously inside this call, so `boundPort` is
   * readable right after it and a successful start is not delayed.
   */
  listen(
    port: number,
    onConnection: (socket: WebSocket, address: string) => void,
    httpBehandler?: HttpBehandler,
  ): Promise<number> {
    this.onConnection = onConnection;

    this.httpServer = createServer((req, res) => {
      try {
        if (httpBehandler?.(req, res)) return;
      } catch (e) {
        console.error('[Acceptor] HTTP-Behandler warf:', e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Upgrade Required');
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: 1024 * 1024, // 1MB max packet
      perMessageDeflate: false, // binary game data, no compression overhead
    });

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      // herkunftErmitteln(): hinter nginx (deploy/nginx/wov-lab.conf, /ws)
      // ist req.socket.remoteAddress sonst IMMER 127.0.0.1, fuer jeden
      // Spieler gleich — siehe Herkunft.ts. Dieselbe Luecke wie in
      // KontoApi.ts, hier nur ohne die Anmelde-Drossel als Symptom.
      const address = herkunftErmitteln(req);
      console.log(`[Acceptor] New connection from ${address}`);
      this.onConnection?.(socket, address);
    });

    this.wss.on('error', (err: Error) => {
      console.error(`[Acceptor] Server error: ${err.message}`);
    });

    const httpServer = this.httpServer;
    return new Promise<number>((resolve, reject) => {
      const beiFehler = (err: NodeJS.ErrnoException): void => {
        console.error(`[Acceptor] Cannot listen on port ${port}: ${err.code ?? 'ERROR'} (${err.message})`);
        this.close();
        reject(err);
      };
      httpServer.once('error', beiFehler);
      httpServer.once('listening', () => {
        httpServer.off('error', beiFehler);
        const gebunden = this.boundPort ?? port;
        console.log(`[Acceptor] Listening on port ${gebunden}`);
        resolve(gebunden);
      });
      httpServer.listen(port);
    });
  }

  /** Stop accepting connections. */
  close(): void {
    this.wss?.close();
    this.wss = null;
    this.httpServer?.close();
    this.httpServer = null;
  }

  get isListening(): boolean {
    return this.wss !== null;
  }

  /**
   * The port the HTTP server is really bound to, or null before `listen` and
   * after `close`. With `listen(0, ...)` the operating system picks the port;
   * this is where a test reads it back (server/test uses port 0, see
   * scripts/testport.mjs). `listen` binds synchronously, so the value is there
   * right after the call.
   */
  get boundPort(): number | null {
    const adresse = this.httpServer?.address();
    return adresse !== null && adresse !== undefined && typeof adresse === 'object' ? adresse.port : null;
  }
}
