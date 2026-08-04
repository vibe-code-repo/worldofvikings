/**
 * Peer — represents a connected client.
 * 1:1 port of Peer.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class Peer : public enable_shared_from_this<Peer>,
 *                public RpcBase<shared_ptr<Peer>> {
 *     Map<ZDOID, pair<Rev, float>> m_zdos;  // known ZDOs per peer
 *     Set<ZDOID> m_forceSend;
 *     Set<ZDOID> m_invalidSector;
 *     string m_name;
 *     ISocket::Ptr m_socket;
 *     Vector3f m_pos;
 *     ZDOID m_characterID;
 *     BitPack<uint8, 1, 1, 1, 5> m_pack;  // visible, gated, ...
 *     Map<string, string> m_syncData;
 *     ...
 *   };
 *
 * Transport: WebSocket (replaces SteamSocket).
 */

import type { Vector3, ZoneID, ConnectionStatus } from '@wov/shared';
import { Inventory } from '@wov/shared';
import { ZDOID } from '../zdo/ZDOID.js';
import { ZDORevision } from '../zdo/ZDO.js';
import { RpcRegistry } from './Rpc.js';
import { Writer } from '../io/Writer.js';
import { Reader } from '../io/Reader.js';
import { PacketType } from '@wov/shared';
import type { WebSocket } from 'ws';

/** ZDO tracking entry per peer (matches C++ pair<Rev, float>) */
interface PeerZDOEntry {
  dataRevision: number;
  ownerRevision: number;
  lastSentTime: number;
}

export class Peer {
  // ── Immutable ──────────────────────────────────────────────────
  readonly name: string;
  private socket: WebSocket;

  /** Verbindung hart schließen (Timeout/Fehler) — Socket bleibt privat. */
  trenne(): void {
    this.socket.close();
  }

  // ── Mutable state ──────────────────────────────────────────────
  position: Vector3;
  characterID: ZDOID;
  userId: bigint;

  /** Connection status */
  status: ConnectionStatus;

  /** Whether this peer has completed authentication */
  authenticated: boolean;

  /** Whether this peer is an admin */
  isAdmin: boolean;

  /** Admin fly mode (AdminCommand "fly") — server-authoritative: skips
   *  gravity/ground clamp in handlePlayerInput so zone streaming and ZDO
   *  sync keep following the flying player. */
  flying: boolean;

  /** Kampf-Basis: Lebenspunkte (Server-autoritativ, 100 = voll). */
  health: number;

  /** Ausdauer (Server-autoritativ): Rennen und Schläge zehren, Pause regeneriert. */
  stamina: number;
  /** Zeitstempel (ms) des letzten Ausdauer-Verbrauchs — Regen-Sperre 1,5 s. */
  staminaZuletztVerbraucht: number;
  /** Akku fuer den 4-Hz-PlayerState-Versand (s). */
  staminaSyncAkku?: number;

  /** Respawn-Punkt (Bett) — null = Weltspawn. */
  spawnPoint: Vector3 | null;

  /** Aktiver Essens-Buff: maxHP-Bonus bis Zeitstempel (ms). */
  foodBonus: number;
  foodBis: number;

  /** Phase G: dungeon instance the peer is currently inside (null = overworld). */
  dungeonId: string | null;

  /** Phase G: overworld position to return to when leaving the dungeon. */
  dungeonReturn: Vector3 | null;
  /** Zeitstempel des letzten akzeptierten Schlags (Angriff/Ernte-Cooldown). */
  letzterSchlag = 0;
  /** Zeitstempel der letzten Chat-Nachricht (Frequenzlimit). */
  letzterChat = 0;
  /** Zeitstempel des letzten empfangenen Pakets (Heartbeat/Timeout). */
  letztesPaket = Date.now();
  /** Welt, in der der Peer lebt (Review 15) — heute immer die Hauptwelt. */
  worldId = 'haupt';
  /** Server-autoritatives Inventar (Review-Punkt 8) — Quelle der Wahrheit. */
  readonly inventar = new Inventory();
  /** Anzahl eigener Bauwerke (Piece-Budget); beim Login gezählt. */
  bautenAnzahl = 0;

  /** Map visibility flag (BitPack index 0) */
  mapVisible: boolean;

  /** ZDOs known to this peer: zdoid.toString() -> entry */
  private knownZDOs: Map<string, PeerZDOEntry>;

  /** ZDOs to force-send next tick */
  private forceSend: Set<string>;

  /** Invalidated sectors */
  private invalidSectors: Set<string>;

  /** Sync data (key-value pairs sent to client) */
  syncData: Map<string, string>;

  /** RPC registry for this peer */
  readonly rpc: RpcRegistry;

  /** Last ping timestamp */
  lastPingTime: number;

  /** Measured ping in ms */
  ping: number;

  /** Sequence number for input reconciliation */
  lastInputSeq: number;

  /** Timestamp of the last input packet (D6 gravity delta time) */
  lastInputTime: number;

  constructor(socket: WebSocket, name: string, userId: bigint) {
    this.socket = socket;
    this.name = name;
    this.userId = userId;
    this.position = { x: 0, y: 0, z: 0 };
    this.characterID = ZDOID.NONE;
    this.status = 1; // Connecting
    this.authenticated = false;
    this.isAdmin = false;
    this.flying = false;
    this.health = 100;
    this.stamina = 100;
    this.staminaZuletztVerbraucht = 0;
    this.spawnPoint = null;
    this.foodBonus = 0;
    this.foodBis = 0;
    this.dungeonId = null;
    this.dungeonReturn = null;
    this.mapVisible = false;
    this.knownZDOs = new Map();
    this.forceSend = new Set();
    this.invalidSectors = new Set();
    this.syncData = new Map();
    this.rpc = new RpcRegistry();
    this.lastPingTime = Date.now();
    this.ping = 0;
    this.lastInputSeq = 0;
    this.lastInputTime = 0;
  }

  // ── ZDO tracking (C++ m_zdos) ──────────────────────────────────

  /** Check if a ZDO is outdated for this peer. */
  isOutdatedZDO(zdoid: ZDOID, dataRev: number, ownerRev: number): boolean {
    const key = zdoid.toString();
    const entry = this.knownZDOs.get(key);
    if (!entry) return true; // never sent = outdated
    return entry.dataRevision !== dataRev || entry.ownerRevision !== ownerRev;
  }

  /** Mark a ZDO as known/sent to this peer. */
  markZDOSent(zdoid: ZDOID, dataRev: number, ownerRev: number): void {
    this.knownZDOs.set(zdoid.toString(), {
      dataRevision: dataRev,
      ownerRevision: ownerRev,
      lastSentTime: Date.now(),
    });
  }

  /** Remove a ZDO from this peer's known set. */
  removeKnownZDO(zdoid: ZDOID): void {
    this.knownZDOs.delete(zdoid.toString());
  }

  /** Force-send a ZDO next tick (C++ ForceSendZDO). */
  forceSendZDO(zdoid: ZDOID): void {
    this.forceSend.add(zdoid.toString());
  }

  /** Consume force-send set. */
  consumeForceSend(): Set<string> {
    const set = this.forceSend;
    this.forceSend = new Set();
    return set;
  }

  /** Invalidate a sector for this peer. */
  invalidateSector(zone: ZoneID): void {
    this.invalidSectors.add(`${zone.x},${zone.y}`);
  }

  get knownZDOCount(): number {
    return this.knownZDOs.size;
  }

  // ── Network send ───────────────────────────────────────────────

  /** Send a binary packet: [type: u8][payload] */
  sendPacket(type: PacketType, payload: Buffer): void {
    if (this.socket.readyState !== 1) return; // OPEN
    const packet = Buffer.allocUnsafe(1 + payload.length);
    packet.writeUInt8(type, 0);
    payload.copy(packet, 1);
    this.socket.send(packet);
  }

  /** Send a packet built from a Writer callback. */
  sendPacketWith(type: PacketType, writeFn: (w: Writer) => void): void {
    const writer = new Writer();
    writeFn(writer);
    this.sendPacket(type, writer.toBuffer());
  }

  /** Send raw binary data. */
  sendRaw(data: Buffer): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(data);
  }

  /** Disconnect this peer. */
  disconnect(reason = ''): void {
    if (this.socket.readyState === 1) {
      const writer = new Writer();
      writer.writeString(reason);
      this.sendPacket(PacketType.Disconnect, writer.toBuffer());
      this.socket.close();
    }
  }

  get isConnected(): boolean {
    return this.socket.readyState === 1;
  }

  get socketRef(): WebSocket {
    return this.socket;
  }

  // ── Utility ────────────────────────────────────────────────────

  toString(): string {
    return `Peer(${this.name}, ${this.userId})`;
  }
}
