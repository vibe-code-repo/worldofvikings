/**
 * WebSocketAcceptor — accepts incoming WebSocket connections.
 * Replaces the Steam-based acceptor of the C++ reference server.
 *
 * C++ reference:
 *   class AcceptorSteam : public IAcceptor {
 *     HSteamListenSocket m_listenSocket;
 *     ...
 *   };
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

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
   */
  listen(
    port: number,
    onConnection: (socket: WebSocket, address: string) => void,
    httpBehandler?: HttpBehandler,
  ): void {
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
      const address = req.socket.remoteAddress ?? 'unknown';
      console.log(`[Acceptor] New connection from ${address}`);
      this.onConnection?.(socket, address);
    });

    this.wss.on('error', (err: Error) => {
      console.error(`[Acceptor] Server error: ${err.message}`);
    });

    this.httpServer.listen(port);
    console.log(`[Acceptor] Listening on port ${port}`);
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
}
