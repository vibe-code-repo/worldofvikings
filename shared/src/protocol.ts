/**
 * Network protocol definitions for Client <-> Server communication.
 * Replaces Steam Networking Sockets with WebSocket + MessagePack.
 *
 * Packet framing: [type: u8][payload: MessagePack binary]
 */

import type { Vector3, Quaternion, ZDOSnapshot, PeerInfo, WorldMeta } from './types.js';
import { PacketType } from './types.js';

// === Handshake Packets ===

export interface VersionCheckPacket {
  version: number;
  clientHash: number;
}

export interface PasswordAuthPacket {
  passwordHash: string;
  playerName: string;
  userId: string; // steam id or browser session id
}

export interface PeerInfoPacket {
  peer: PeerInfo;
  serverName: string;
  worldName: string;
  worldSeed: string;
}

export interface DisconnectPacket {
  reason: string;
  status: number;
}

// === ZDO Sync Packets ===

export interface ZDOSyncPacket {
  /** ZDOs created or updated */
  updates: ZDOSnapshot[];
  /** ZDOIDs destroyed (as [userId, id] tuples) */
  destroyed: Array<[string, number]>;
  /** Server tick for reconciliation */
  tick: number;
}

export interface ZDOAssignPacket {
  zdoids: Array<[string, number]>;
}

// === World Packets ===

export interface TimeSyncPacket {
  worldTime: number;
  timeOfDay: number;
  day: number;
}

export interface HeightmapDataPacket {
  zoneX: number;
  zoneY: number;
  /** 64x64 float32 heights, delta-encoded */
  heights: Float32Array;
  /** Biome per corner (4 values) */
  cornerBiomes: number[];
}

// === Player Packets ===

/**
 * PlayerInputPacket — logical input state.
 *
 * NOTE: the actual wire format (custom binary, GameSocket.sendPlayerInput ↔
 * WovServer.handlePlayerInput) currently serializes only:
 *   seq(i32), moveX(f32), moveZ(f32), lookYaw(f32), lookPitch(f32),
 *   moveY(f32), running(bool), jumping(bool)
 * Client and server must be version-matched (same repo, no compat layer).
 * moveY is the vertical intent (-1..+1), used by the fly mode only.
 */
export interface PlayerInputPacket {
  /** Sequence number for prediction reconciliation */
  seq: number;
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  /** Vertical intent (-1..+1) — fly mode only */
  moveY: number;
  running: boolean;
  jumping: boolean;
  crouching: boolean;
  attack: boolean;
  block: boolean;
  interact: boolean;
}

export interface PlayerStatePacket {
  userId: string;
  seq: number;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  health: number;
  stamina: number;
  animation: number;
}

export interface ChatMessagePacket {
  senderId: string;
  senderName: string;
  type: number; // ChatMsgType
  text: string;
  position: Vector3;
}

// === RPC Packet ===

export interface RpcCallPacket {
  /** RPC method hash (stable hash of method name) */
  methodHash: number;
  /** Target ZDOID (optional, for ZDO-targeted RPCs) */
  targetZdoid?: [string, number];
  /** Payload bytes (MessagePack-encoded args) */
  payload: Uint8Array;
}

// === Admin Packets ===

/**
 * Client → server: one admin command line, e.g. "fly" (later "teleport x y z").
 * The server parses the first token and dispatches to its AdminCommandRegistry.
 * Currently unprotected by design (see server/admin/AdminCommands.ts).
 */
export interface AdminCommandPacket {
  command: string;
}

/**
 * Server → client (requesting peer only): result of an admin command.
 * `active` carries the resulting toggle state for toggle-style commands
 * (e.g. fly on/off) so the client HUD mirrors the server state exactly.
 */
export interface AdminEventPacket {
  command: string;
  active: boolean;
  message: string;
}

// === Packet type map for serialization ===
export const PACKET_REGISTRY: Record<number, string> = {
  [PacketType.VersionCheck]: 'VersionCheckPacket',
  [PacketType.PasswordAuth]: 'PasswordAuthPacket',
  [PacketType.PeerInfo]: 'PeerInfoPacket',
  [PacketType.Disconnect]: 'DisconnectPacket',
  [PacketType.ZDOSync]: 'ZDOSyncPacket',
  [PacketType.ZDOAssign]: 'ZDOAssignPacket',
  [PacketType.TimeSync]: 'TimeSyncPacket',
  [PacketType.HeightmapData]: 'HeightmapDataPacket',
  [PacketType.PlayerInput]: 'PlayerInputPacket',
  [PacketType.PlayerState]: 'PlayerStatePacket',
  [PacketType.ChatMessage]: 'ChatMessagePacket',
  [PacketType.RpcCall]: 'RpcCallPacket',
  [PacketType.AdminCommand]: 'AdminCommandPacket',
  [PacketType.AdminEvent]: 'AdminEventPacket',
};
