/**
 * Shared types ported from Valhalla2.0 C++ server.
 * Source: Types.h, Prefab.h, ZoneManager.h, Peer.h
 */

// === Basic Types (Types.h) ===
export type Hash = number; // int32
export type UserID = bigint; // int64

// === Biome (Types.h) ===
// C++ enum class Biome : std::uint16_t — bitmask type.
export enum Biome {
  None = 0,
  Meadows = 1 << 0,
  Swamp = 1 << 1,
  Mountain = 1 << 2,
  BlackForest = 1 << 3,
  Plains = 1 << 4,
  AshLands = 1 << 5,
  DeepNorth = 1 << 6,
  Ocean = 1 << 8,
  Mistlands = 1 << 9,
}

// C++ enum class BiomeArea : std::uint8_t — NOTE: unlike the Unity original
// (Everything = 0), the C++ server has None = 0 and Everything = 3.
export enum BiomeArea {
  None = 0,
  Edge = 1 << 0,
  Median = 1 << 1,
  Everything = Edge | Median,
}

// === Prefab Flags (Prefab.h) ===
// Const object (not enum) because TypeScript enums don't support bigint.
export const PrefabFlag = {
  NONE: 0n,
  SYNC_INITIAL_SCALE: 1n << 0n,
  DISTANT: 1n << 1n,
  PERSISTENT: 1n << 2n,
  TYPE1: 1n << 3n,
  TYPE2: 1n << 4n,
  PIECE: 1n << 5n,
  BED: 1n << 6n,
  DOOR: 1n << 7n,
  CHAIR: 1n << 8n,
  SHIP: 1n << 9n,
  FISH: 1n << 10n,
  PLANT: 1n << 11n,
  ARMOR_STAND: 1n << 12n,
  PROJECTILE: 1n << 13n,
  ITEM_DROP: 1n << 14n,
  PICKABLE: 1n << 15n,
  PICKABLE_ITEM: 1n << 16n,
  CONTAINER: 1n << 17n,
  COOKING_STATION: 1n << 18n,
  CRAFTING_STATION: 1n << 19n,
  SMELTER: 1n << 20n,
  FIREPLACE: 1n << 21n,
  WEAR_N_TEAR: 1n << 22n,
  DESTRUCTIBLE: 1n << 23n,
  ITEM_STAND: 1n << 24n,
  ANIMAL_AI: 1n << 25n,
  MONSTER_AI: 1n << 26n,
  TAMEABLE: 1n << 27n,
  PROCREATION: 1n << 28n,
  MINE_ROCK_5: 1n << 29n,
  TREE_BASE: 1n << 30n,
  TREE_LOG: 1n << 31n,
  DUNGEON: 1n << 32n,
  TERRAIN_MODIFIER: 1n << 33n,
  CREATURE_SPAWNER: 1n << 34n,
  SYNCED_TRANSFORM: 1n << 35n,
} as const;

export type PrefabFlag = bigint;

// === Object Type (derived from Prefab flags) ===
export enum ObjectType {
  Default = 0,
  Piece = 1,
  Item = 2,
  Creature = 3,
  Dungeon = 4,
  Terrain = 5,
}

// === Connection Status (Peer.h) ===
export enum ConnectionStatus {
  None = 0,
  Connecting = 1,
  Connected = 2,
  ErrorVersion = 3,
  ErrorDisconnected = 4,
  ErrorConnectFailed = 5,
  ErrorPassword = 6,
  ErrorAlreadyConnected = 7,
  ErrorBanned = 8,
  ErrorFull = 9,
  ErrorPlatformExcluded = 10,
  ErrorCrossplayPrivilege = 11,
  ErrorKicked = 12,
}

// === Chat Message Type (Peer.h) ===
export enum ChatMsgType {
  Whisper = 0,
  Normal = 1,
  Shout = 2,
  Ping = 3,
}

// === Global Keys (ZoneManager.h) ===
export enum GlobalKey {
  PlayerDamage,
  EnemyDamage,
  WorldLevel,
  EventRate,
  ResourceRate,
  StaminaRate,
  MoveStaminaRate,
  StaminaRegenRate,
  SkillGainRate,
  SkillReductionRate,
  EnemySpeedSize,
  PlayerEvents,
  Fire,
  DeathKeepEquip,
  DeathDeleteItems,
  DeathDeleteUnequipped,
  DeathSkillsReset,
  NoBuildCost,
  NoCraftCost,
  AllPiecesUnlocked,
  NoWorkbench,
  AllRecipesUnlocked,
  WorldLevelLockedTools,
  PassiveMobs,
  NoMap,
  NoPortals,
  NoBossPortals,
  DungeonBuild,
  TeleportAll,
  Preset,
  NonServerOption,
  defeated_eikthyr,
  defeated_dragon,
  defeated_goblinking,
  defeated_gdking,
  defeated_bonemass,
  activeBosses,
  KilledTroll,
  killed_surtling,
  KilledBat,
}

// === ZDO Member Types (ZDO.h) ===
export enum ZDOMemberType {
  Float = 0,
  Vec3 = 1,
  Quat = 2,
  Int = 3,
  Long = 4,
  String = 5,
  ByteArray = 6,
}

// === Network Packet Types ===
export enum PacketType {
  // Handshake
  VersionCheck = 1,
  PasswordAuth = 2,
  PeerInfo = 3,
  Disconnect = 4,

  // ZDO Sync
  ZDOSync = 10,
  ZDODestroy = 11,
  ZDOAssign = 12,
  ZDORelease = 13,

  // RPC
  RpcCall = 20,
  RpcResponse = 21,

  // World
  TimeSync = 30,
  ChunkData = 31,
  HeightmapData = 32,
  SetTimeOfDay = 33,

  // Player
  PlayerInput = 40,
  PlayerState = 41,
  ChatMessage = 42,
  /** Server → client: hard position set (dungeon enter/leave). Payload:
   *  Vector3 pos, Bool inDungeon, String dungeonId (may be empty). */
  Teleport = 43,
  /** Client → Server: Interaktion (E). Payload: Vector3 pos, Int32 prefabHash. */
  Interact = 44,
  /** Server → Client: Bool ok, String message, String itemName (''), Int32 amount. */
  InteractResult = 45,
  /** Client → Server: Nahkampfschlag. Payload: Vector3 pos, Float32 yaw. */
  Attack = 46,
  /** Client → Server: Terrain-Werkzeug anwenden. Payload: Vector3 pos,
   *  String settingsJson (TerrainOpSettings). */
  TerrainOp = 47,
  /** Server → Client: Int32 count × { Vector3 pos, String settingsJson } —
   *  Broadcast einer Op bzw. Replay aller Ops beim Verbinden. */
  TerrainOpSync = 48,
  /** Client → Server: Bau-Piece setzen. Payload: Int32 prefabHash,
   *  Vector3 pos, Quaternion rot. */
  PlacePiece = 55,
  /** Client → Server: eigenes Bau-Piece abreißen. Payload: Vector3 pos. */
  RemovePiece = 56,
  /** Client → Server: Essen (Taste F). Payload: String itemName. */
  Eat = 57,

  // Admin
  PlayerList = 50,
  AdminList = 51,
  ServerConfig = 52,
  AdminCommand = 53,
  AdminEvent = 54,

  // Dungeon-Editor (Phase G) — admin-gated
  /** Client → Server: String dungeonId ('' = aktueller Dungeon des Peers). */
  DungeonEditRequest = 60,
  /** Server → Client: Bool ok, String message, String json (DungeonDocument). */
  DungeonEditData = 61,
  /** Client → Server: String json (DungeonDocument) — sanitisiert + gespeichert. */
  DungeonEditSave = 62,
  /** Server → Client: Dungeon-Eingänge für die Weltkarte. Payload:
   *  Int32 count × { String feature, String dungeonId, Vector3 pos }. */
  DungeonEntrances = 63,
  /** Server → Client: WorldLayout-Dokument (Layout-Modus), direkt nach
   *  ServerConfig. Payload: String json. Der Client baut seine Welt erst,
   *  wenn dieses Paket da ist (ServerConfig-Flag Bit 5 kündigt es an). */
  WorldLayoutData = 64,
  /** Server → Client: autoritativer Inventarstand. Payload: String json
   *  (SavedItemStack[]) — der Client ersetzt sein Inventar vollständig. */
  InventorySync = 65,
  /** Client → Server: Craft-Wunsch. Payload: String ergebnis (REZEPTE). */
  Craft = 66,
  /** Beidseitig: Heartbeat (leer). Client alle 5 s, Server echot —
   *  Grundlage der Verbindungs-Timeouts (NetManager.pruefeTimeouts). */
  Ping = 67,
}

// === Vector3 (Vector.h) ===
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// === Quaternion (Quaternion.h) ===
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

// === ZoneID ===
export interface ZoneID {
  x: number;
  y: number;
}

// === ZDOID (packed) ===
export interface ZDOIDData {
  userId: UserID;
  id: number;
}

// === Prefab Definition ===
// (Full registry definition lives in prefabs.ts — PrefabDef is exported there.)

// === ZDO Snapshot (for network sync) ===
export interface ZDOSnapshot {
  zdoid: { userId: string; id: number };
  prefabHash: Hash;
  position: Vector3;
  rotation: Quaternion;
  dataRevision: number;
  ownerRevision: number;
  members: Record<number, number | string | number[] | Vector3 | Quaternion>;
}

// === Peer Info ===
export interface PeerInfo {
  name: string;
  userId: string;
  characterId: { userId: string; id: number };
  position: Vector3;
}

// === World Meta ===
export interface WorldMeta {
  name: string;
  seedName: string;
  seed: Hash;
  uid: bigint;
  worldGenVersion: number;
  globalKeys: string[];
}
