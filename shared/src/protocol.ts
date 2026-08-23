/**
 * Network protocol definitions for Client <-> Server communication.
 * Replaces Steam Networking Sockets with WebSocket + einem
 * handgeschriebenen Binaerformat (kein MessagePack) — Port von
 * DataStream.h (Valhalla2.0 C++), siehe server/src/io/{Reader,Writer}.ts.
 *
 * Packet framing: [type: u8][payload: custom binary]
 *
 * Die Interfaces hier sind die LOGISCHE Form der Pakete, nicht
 * zwangslaeufig die exakte Feldreihenfolge auf dem Draht — wo beide
 * auseinanderlaufen, steht das als NOTE bei der jeweiligen Packet-Definition
 * (z. B. PlayerInputPacket, PlayerStatePacket).
 */

import type { Vector3, Quaternion, ZDOSnapshot, PeerInfo, WorldMeta } from './types.js';
import { PacketType } from './types.js';

// === Handshake Packets ===

export interface VersionCheckPacket {
  version: number;
  clientHash: number;
}

/**
 * Server → Client, EINMAL pro Verbindung nach VersionCheck (F4,
 * Security-Review): startet den Nonce/HMAC-Passwort-Handshake. Der Client
 * antwortet mit PasswordAuth.
 */
export interface AuthChallengePacket {
  /** Zufällig, hex-kodiert, nur für DIESE Verbindung gültig (Replay-Schutz). */
  nonce: string;
}

/**
 * Client → Server, Antwort auf AuthChallenge (F3/F4, Security-Review).
 *
 * `response` ersetzt den frueheren rohen `passwordHash`-Vergleich: es ist
 * HMAC-SHA256(key=Passwort, data=nonce), hex-kodiert — nicht wiederholbar
 * (anderer Nonce je Verbindung) und verraet das Passwort nicht direkt.
 *
 * `userId` ist ABSICHTLICH ENTFALLEN: die alte Fassung liess den Client
 * seine eigene Identitaet waehlen (Security-Review-Luecke A/B). Die
 * Identitaet kommt jetzt ausschliesslich vom Server, uebermittelt/erkannt
 * ueber `sessionToken`.
 */
export interface PasswordAuthPacket {
  response: string;
  playerName: string;
  /** Zuvor vom Server ausgestelltes SessionToken, '' bei Erstanmeldung
   *  oder wenn der Client keins (mehr) hat. */
  sessionToken: string;
}

/**
 * Server → Client, nach erfolgreicher Anmeldung. `sessionToken` legt der
 * Client in localStorage ab und schickt es beim naechsten Connect als
 * PasswordAuth.sessionToken zurueck (F3, Security-Review).
 */
export interface PeerInfoPacket {
  peer: PeerInfo;
  serverName: string;
  worldName: string;
  worldSeed: string;
  sessionToken: string;
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

/**
 * PlayerStatePacket — logical server->client state (F6).
 *
 * NOTE: like PlayerInputPacket above, the actual wire format (custom
 * binary, WovServer.sendPlayerState -> main.ts PlayerState handler)
 * serializes only a SUBSET, in this order:
 *   health(f32, percent of maxHealth), stamina(f32), position(vec3),
 *   seq(i32, peer.lastInputSeq — appended LAST on purpose, see
 *   sendPlayerState: an older reader stops after its known fields and
 *   never sees the extra bytes, a newer reader checks
 *   BinaryReader.remaining before reading them; this is why the field
 *   could be added without a protocol version bump).
 * userId/rotation/velocity/animation below are NOT on the wire yet.
 */
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

/**
 * Ersatzschluessel fuer den Nonce/HMAC-Handshake, wenn KEIN Serverpasswort
 * gesetzt ist.
 *
 * Warum es den braucht: Node akzeptiert `createHmac('sha256', '')` klaglos,
 * die WebCrypto des Browsers NICHT — `crypto.subtle.importKey` wirft dort
 * `DataError: HMAC key data must not be empty`. Der Server rechnete also
 * munter mit leerem Schluessel, waehrend im Browser die Berechnung
 * fehlschlug; weil der Fehler in einem `void (async …)()` verschwand, kam
 * gar keine Antwort und jede Anmeldung lief stumm in den 10-s-Timeout.
 * Genau so ist es am 20.08.2026 passiert, mit `password: ""` in server.yml.
 *
 * Der Wert ist KEIN Geheimnis und soll keines sein — ohne gesetztes
 * Passwort gibt es nichts zu schuetzen. Er sorgt nur dafuer, dass beide
 * Seiten dieselbe, in beiden Laufzeitumgebungen zulaessige Rechnung
 * anstellen. Er steht hier und nicht zweimal daneben, weil zwei getrennt
 * gepflegte Kopien auseinanderlaufen und der Fehler dann wieder still ist.
 */
export const HANDSHAKE_LEERPASSWORT_SCHLUESSEL = 'wov:kein-passwort';
