/**
 * GameSocket — WebSocket client for server communication (Phase 2).
 * Ported 1:1 from the valheim-browser client (protocol code only, no
 * engine dependencies). Binary framing: [type: u8][payload].
 */

import { PacketType, getStableHash } from '@wov/shared';
import type { Vector3, Quaternion } from '@wov/shared';

/** Minimal binary reader for client-side packet parsing */
export class BinaryReader {
  private view: DataView;
  private pos = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readBool(): boolean { return this.view.getUint8(this.pos++) !== 0; }
  readInt8(): number { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
  readUInt8(): number { return this.view.getUint8(this.pos++); }
  readInt32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  readUInt32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  readFloat32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  readFloat64(): number { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }

  skip(n: number): void { this.pos += n; }

  readVarInt(): number {
    let result = 0, shift = 0, byte: number;
    do {
      byte = this.view.getUint8(this.pos++);
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return (result >>> 1) ^ -(result & 1);
  }

  readString(): string {
    const len = this.readVarInt();
    if (len === 0) return '';
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
  }

  readVector3(): Vector3 {
    return { x: this.readFloat32(), y: this.readFloat32(), z: this.readFloat32() };
  }

  readQuaternion(): Quaternion {
    return { x: this.readFloat32(), y: this.readFloat32(), z: this.readFloat32(), w: this.readFloat32() };
  }

  get remaining(): number { return this.view.byteLength - this.pos; }
}

/** Minimal binary writer for client-side packets */
class BinaryWriter {
  private buf: number[] = [];

  writeBool(v: boolean) { this.buf.push(v ? 1 : 0); }
  writeInt32(v: number) {
    const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeFloat32(v: number) {
    const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeFloat64(v: number) {
    const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, v, true);
    this.buf.push(...new Uint8Array(b));
  }
  writeString(v: string) {
    const encoded = new TextEncoder().encode(v);
    let len = encoded.length;
    let zigzag = ((len << 1) ^ (len >> 31)) >>> 0;
    do {
      const byte = zigzag & 0x7f;
      zigzag >>>= 7;
      this.buf.push(zigzag ? byte | 0x80 : byte);
    } while (zigzag);
    // Schleife statt Spread: push(...arr) legt jedes Byte als Argument auf
    // den Stack — bei Editor-Dokumenten (>64k Bytes JSON) platzt der.
    for (let i = 0; i < encoded.length; i++) this.buf.push(encoded[i]!);
  }

  toUint8Array(): Uint8Array { return new Uint8Array(this.buf); }
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<PacketType, Array<(reader: BinaryReader) => void>> = new Map();
  private inputSeq = 0;
  private authSent = false;
  private _pendingPassword = '';

  readonly url: string;
  readonly playerName: string;
  connected = false;
  /** Own user ID assigned by the server (from PeerInfo). */
  ownUserId = '';

  onConnected: (() => void) | null = null;
  onDisconnected: ((reason?: string) => void) | null = null;
  private disconnectReason = '';

  constructor(url: string, playerName: string) {
    this.url = url;
    this.playerName = playerName;
  }

  connect(password = ''): void {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => console.log('[GameSocket] Connected to', this.url);
    this.ws.onmessage = (event) => this.handleMessage(event.data as ArrayBuffer);
    this.ws.onclose = () => {
      this.connected = false;
      this.onDisconnected?.(this.disconnectReason);
    };
    this.ws.onerror = (err) => console.error('[GameSocket] Error:', err);

    this._pendingPassword = password;
  }

  private handleMessage(data: ArrayBuffer): void {
    const reader = new BinaryReader(data);
    const type = reader.readUInt8() as PacketType;

    switch (type) {
      case PacketType.VersionCheck: {
        const w = new BinaryWriter();
        w.writeInt32(1); // protocol version
        this.sendPacket(PacketType.VersionCheck, w.toUint8Array());
        break;
      }
      case PacketType.Disconnect: {
        this.disconnectReason = reader.readString();
        console.warn('[GameSocket] Server disconnect:', this.disconnectReason);
        break;
      }
      case PacketType.PeerInfo: {
        reader.readString();
        this.ownUserId = reader.readString();
        reader.readString();
        if (!this.authSent) {
          this.authSent = true;
          const w = new BinaryWriter();
          w.writeString(this._pendingPassword ? String(getStableHash(this._pendingPassword)) : '');
          w.writeString(this.playerName);
          w.writeString(this.generateSessionId());
          this.sendPacket(PacketType.PasswordAuth, w.toUint8Array());
          this.connected = true;
          this.onConnected?.();
        }
        break;
      }
      default:
        break;
    }

    const handlers = this.handlers.get(type);
    if (handlers) {
      const payloadReader = new BinaryReader(data.slice(1));
      for (const h of handlers) h(payloadReader);
    }
  }

  on(type: PacketType, handler: (reader: BinaryReader) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  sendPacket(type: PacketType, payload: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = new Uint8Array(1 + payload.length);
    packet[0] = type;
    packet.set(payload, 1);
    this.ws.send(packet.buffer);
  }

  sendPlayerInput(
    moveX: number, moveZ: number,
    lookYaw: number, lookPitch: number,
    moveY: number,
    running: boolean, jumping: boolean
  ): void {
    const w = new BinaryWriter();
    w.writeInt32(++this.inputSeq);
    w.writeFloat32(moveX);
    w.writeFloat32(moveZ);
    w.writeFloat32(lookYaw);
    w.writeFloat32(lookPitch);
    w.writeFloat32(moveY);
    w.writeBool(running);
    w.writeBool(jumping);
    this.sendPacket(PacketType.PlayerInput, w.toUint8Array());
  }

  sendAdminCommand(command: string): void {
    const w = new BinaryWriter();
    w.writeString(command);
    this.sendPacket(PacketType.AdminCommand, w.toUint8Array());
  }

  /** Essen (Taste F) — Item hat der Client bereits abgezogen. */
  sendEat(itemName: string): void {
    const w = new BinaryWriter();
    w.writeString(itemName);
    this.sendPacket(PacketType.Eat, w.toUint8Array());
  }

  /** Bau-Piece setzen (Hammer). */
  sendPlacePiece(prefabHash: number, x: number, y: number, z: number, rot: Quaternion): void {
    const w = new BinaryWriter();
    w.writeInt32(prefabHash);
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeFloat32(rot.x);
    w.writeFloat32(rot.y);
    w.writeFloat32(rot.z);
    w.writeFloat32(rot.w);
    this.sendPacket(PacketType.PlacePiece, w.toUint8Array());
  }

  /** Eigenes Bau-Piece abreissen (Hammer, mittlere Maustaste). */
  sendRemovePiece(x: number, y: number, z: number): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    this.sendPacket(PacketType.RemovePiece, w.toUint8Array());
  }

  /** Terrain-Werkzeug (Hacke/Pflug/Spitzhacke) — Server wendet an + broadcastet. */
  sendTerrainOp(x: number, y: number, z: number, settingsJson: string): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeString(settingsJson);
    this.sendPacket(PacketType.TerrainOp, w.toUint8Array());
  }

  /** Nahkampfschlag an der Spielerposition (weapon = Item-Name, '' = Faust). */
  sendAttack(x: number, y: number, z: number, yaw: number, weapon = ''): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeFloat32(yaw);
    w.writeString(weapon);
    this.sendPacket(PacketType.Attack, w.toUint8Array());
  }

  /** Interaktion (E): Position + Prefab-Hash des Ziels. */
  sendInteract(x: number, y: number, z: number, prefabHash: number): void {
    const w = new BinaryWriter();
    w.writeFloat32(x);
    w.writeFloat32(y);
    w.writeFloat32(z);
    w.writeInt32(prefabHash);
    this.sendPacket(PacketType.Interact, w.toUint8Array());
  }

  /** Editor (Phase G): Dungeon-Dokument anfordern ('' = aktueller Dungeon). */
  sendDungeonEditRequest(dungeonId = ''): void {
    const w = new BinaryWriter();
    w.writeString(dungeonId);
    this.sendPacket(PacketType.DungeonEditRequest, w.toUint8Array());
  }

  /** Editor (Phase G): bearbeitetes Dungeon-Dokument speichern. */
  sendDungeonEditSave(json: string): void {
    const w = new BinaryWriter();
    w.writeString(json);
    this.sendPacket(PacketType.DungeonEditSave, w.toUint8Array());
  }

  /**
   * Tageszeit für die ganze Welt setzen (Auswahl im Verbinden-Fenster).
   *
   * @param seconds Sekunden INNERHALB des Tages, also [0, WORLD_TIME_LENGTH).
   *   Nicht die absolute Weltzeit — der Server behält seinen Tageszähler
   *   und verschiebt nur die Zeit darin (WovServer.handleSetTimeOfDay).
   */
  sendSetTimeOfDay(seconds: number): void {
    const w = new BinaryWriter();
    w.writeFloat64(seconds);
    this.sendPacket(PacketType.SetTimeOfDay, w.toUint8Array());
  }

  sendChat(text: string, chatType = 1): void {
    const w = new BinaryWriter();
    w.writeInt32(chatType);
    w.writeString(text);
    this.sendPacket(PacketType.ChatMessage, w.toUint8Array());
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private generateSessionId(): string {
    return 'babylon_' + Math.random().toString(36).substring(2, 10);
  }
}
