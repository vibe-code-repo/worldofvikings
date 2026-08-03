/**
 * WebSocketAcceptor — accepts incoming WebSocket connections.
 * Replaces NetAcceptorSteamDedicated.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class AcceptorSteam : public IAcceptor {
 *     HSteamListenSocket m_listenSocket;
 *     ...
 *   };
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

export interface AcceptResult {
  socket: WebSocket;
  address: string;
}

export class WebSocketAcceptor {
  private wss: WebSocketServer | null = null;
  private onConnection: ((socket: WebSocket, address: string) => void) | null = null;

  /** Start listening on the given port. */
  listen(port: number, onConnection: (socket: WebSocket, address: string) => void): void {
    this.onConnection = onConnection;

    this.wss = new WebSocketServer({
      port,
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

    console.log(`[Acceptor] Listening on port ${port}`);
  }

  /** Stop accepting connections. */
  close(): void {
    this.wss?.close();
    this.wss = null;
  }

  get isListening(): boolean {
    return this.wss !== null;
  }
}
