/**
 * NetManager — manages all connected peers, handshake, and packet routing.
 * 1:1 port of NetManager.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class INetManager {
 *     Map<string, int32> m_sessionIndexes;
 *     vector<Peer::Ptr> m_connectedPeers;
 *     vector<Peer::Ptr> m_onlinePeers;
 *     unique_ptr<IAcceptor> m_acceptor;
 *     string m_passwordHash, m_passwordSalt;
 *     ...
 *   };
 *
 * Transport: WebSocket (replaces Steam Networking Sockets).
 */

import type { WebSocket } from 'ws';
import { PacketType, ConnectionStatus, MAX_PLAYERS } from '@wov/shared';
import { Peer } from './Peer.js';
import { WebSocketAcceptor } from './WebSocketAcceptor.js';
import { Reader } from '../io/Reader.js';
import { Writer } from '../io/Writer.js';
import { getStableHash } from '../util/Hash.js';

export interface NetManagerConfig {
  port: number;
  password: string;
  serverName: string;
  maxPlayers: number;
  everyoneAdmin: boolean;
}

export class NetManager {
  private acceptor: WebSocketAcceptor;
  private connectedPeers: Peer[] = [];
  private onlinePeers: Peer[] = [];

  readonly config: NetManagerConfig;
  private passwordHash: string;

  /** Callbacks for server integration */
  onPeerAuthenticated: ((peer: Peer) => void) | null = null;
  onPeerQuit: ((peer: Peer) => void) | null = null;
  onPacket: ((peer: Peer, type: PacketType, reader: Reader) => void) | null = null;

  private playerListAccumulator = 0;

  constructor(config: NetManagerConfig) {
    this.config = config;
    this.acceptor = new WebSocketAcceptor();
    this.passwordHash = config.password ? getStableHash(config.password).toString() : '';
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start(): void {
    this.acceptor.listen(this.config.port, (socket, address) => {
      this.handleNewConnection(socket, address);
    });
    console.log(`[NetManager] Started on port ${this.config.port}`);
  }

  stop(): void {
    for (const peer of this.onlinePeers) {
      peer.disconnect('Server shutting down');
    }
    this.acceptor.close();
  }

  update(deltaMs: number): void {
    // Periodic player list broadcast (C++ SendPlayerList)
    this.playerListAccumulator += deltaMs;
    if (this.playerListAccumulator >= 2000) {
      this.playerListAccumulator = 0;
      this.sendPlayerList();
    }
  }

  // ── Connection handling ──────────────────────────────────────────

  private handleNewConnection(socket: WebSocket, address: string): void {
    // Check server full
    if (this.onlinePeers.length >= this.config.maxPlayers) {
      socket.close(1000, 'Server full');
      return;
    }

    // Create a temporary peer (name assigned after auth)
    const peer = new Peer(socket, `pending_${address}`, 0n);
    this.connectedPeers.push(peer);

    socket.binaryType = 'nodebuffer';

    socket.on('message', (data: Buffer) => {
      this.handlePacket(peer, data);
    });

    socket.on('close', () => {
      this.handleDisconnect(peer);
    });

    socket.on('error', (err: Error) => {
      console.error(`[NetManager] Socket error for ${peer.name}: ${err.message}`);
    });

    // Send version check request
    peer.sendPacketWith(PacketType.VersionCheck, (w) => {
      w.writeInt32(1); // protocol version
      w.writeString(this.config.serverName);
    });
  }

  private handlePacket(peer: Peer, data: Buffer): void {
    if (data.length < 1) return;

    const type = data.readUInt8(0) as PacketType;
    const payload = data.subarray(1);
    const reader = new Reader(Buffer.from(payload));

    console.log(`[NetManager] Received packet type=${type} from ${peer.name} (${data.length} bytes)`);

    switch (type) {
      case PacketType.VersionCheck:
        this.handleVersionCheck(peer, reader);
        break;
      case PacketType.PasswordAuth:
        this.handlePasswordAuth(peer, reader);
        break;
      case PacketType.PlayerInput:
      case PacketType.ChatMessage:
      case PacketType.RpcCall:
      case PacketType.SetTimeOfDay:
      case PacketType.AdminCommand:
        // Forward to server for processing
        this.onPacket?.(peer, type, reader);
        break;
      default:
        // Forward unknown types to server
        this.onPacket?.(peer, type, reader);
        break;
    }
  }

  private handleVersionCheck(peer: Peer, reader: Reader): void {
    const clientVersion = reader.readInt32();
    if (clientVersion !== 1) {
      peer.status = ConnectionStatus.ErrorVersion;
      peer.disconnect('Version mismatch');
      return;
    }
    // Version OK — send PeerInfo to trigger client auth
    this.sendPeerInfo(peer);
  }

  private handlePasswordAuth(peer: Peer, reader: Reader): void {
    const passwordHash = reader.readString();
    const playerName = reader.readString();
    const userIdStr = reader.readString();

    // Check password
    if (this.config.password && passwordHash !== this.passwordHash) {
      peer.status = ConnectionStatus.ErrorPassword;
      peer.disconnect('Wrong password');
      return;
    }

    // Check duplicate name
    if (this.onlinePeers.some(p => p.name === playerName)) {
      peer.status = ConnectionStatus.ErrorAlreadyConnected;
      peer.disconnect('Name already in use');
      return;
    }

    // Authenticate
    // Browser session IDs are non-numeric strings, hash them to a BigInt
    let userId: bigint;
    if (/^\d+$/.test(userIdStr)) {
      userId = BigInt(userIdStr);
    } else {
      // Hash non-numeric session IDs to a stable BigInt
      userId = BigInt(getStableHash(userIdStr) & 0x7fffffff);
    }
    (peer as { name: string }).name = playerName;
    (peer as { userId: bigint }).userId = userId;
    peer.authenticated = true;
    peer.status = ConnectionStatus.Connected;
    peer.isAdmin = this.config.everyoneAdmin;

    // Move from connected to online
    const idx = this.connectedPeers.indexOf(peer);
    if (idx !== -1) this.connectedPeers.splice(idx, 1);
    this.onlinePeers.push(peer);

    // Send peer info + server config
    this.sendPeerInfo(peer);

    console.log(`[NetManager] ${playerName} authenticated (userId: ${userId})`);
    this.onPeerAuthenticated?.(peer);
  }

  private handleDisconnect(peer: Peer): void {
    const connIdx = this.connectedPeers.indexOf(peer);
    if (connIdx !== -1) this.connectedPeers.splice(connIdx, 1);

    const onlineIdx = this.onlinePeers.indexOf(peer);
    if (onlineIdx !== -1) {
      this.onlinePeers.splice(onlineIdx, 1);
      console.log(`[NetManager] ${peer.name} disconnected`);
      this.onPeerQuit?.(peer);
    }
  }

  // ── Server → Client packets ──────────────────────────────────────

  private sendPeerInfo(peer: Peer): void {
    peer.sendPacketWith(PacketType.PeerInfo, (w) => {
      w.writeString(peer.name);
      w.writeString(peer.userId.toString());
      w.writeString(this.config.serverName);
    });
  }

  private sendPlayerList(): void {
    const writer = new Writer();
    writer.writeInt32(this.onlinePeers.length);
    for (const p of this.onlinePeers) {
      writer.writeString(p.name);
      writer.writeString(p.userId.toString());
      writer.writeVector3(p.position);
      writer.writeInt32(p.ping);
    }
    const payload = writer.toBuffer();
    for (const p of this.onlinePeers) {
      p.sendPacket(PacketType.PlayerList, payload);
    }
  }

  // ── Peer lookup (C++ FindPeer*) ──────────────────────────────────

  findPeerByName(name: string): Peer | undefined {
    return this.onlinePeers.find(p => p.name === name);
  }

  findPeerByUserId(userId: bigint): Peer | undefined {
    return this.onlinePeers.find(p => p.userId === userId);
  }

  getPeers(): readonly Peer[] {
    return this.onlinePeers;
  }

  get peerCount(): number {
    return this.onlinePeers.length;
  }

  // ── Admin actions ────────────────────────────────────────────────

  kick(identifier: string): Peer | undefined {
    const peer = this.findPeerByName(identifier);
    if (peer) {
      peer.disconnect('Kicked by admin');
    }
    return peer;
  }
}
