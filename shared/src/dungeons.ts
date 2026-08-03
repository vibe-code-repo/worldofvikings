/**
 * Dungeon registry (Phase G) — the 13 DG_* dungeon generators with their
 * complete room kits, parsed 1:1 from the C++ server's dungeons.pkg
 * (tools/prefab-parser/parse-dungeons.ts). This is the Unity
 * Room/RoomConnection component data that the GLB exports lack: room sizes,
 * connector transforms, themes, weights and the interactive net views
 * contained in each room.
 *
 * C++ reference: DungeonManager.cpp:19-201 (pkg read), Dungeon.h,
 * DungeonRoom.h, DungeonRoomConnection.h.
 */

import dungeonsData from './dungeonsData.json';
import { getStableHash } from './hash.js';
import type { Quaternion, Vector3 } from './types.js';

/** C++ Room::Theme (DungeonRoom.h) — bitmask. */
export enum RoomTheme {
  Crypt = 1,
  SunkenCrypt = 2,
  Cave = 4,
  ForestCrypt = 8,
  GoblinCamp = 16,
  MeadowsVillage = 32,
  MeadowsFarm = 64,
  DvergerTown = 128,
  DvergerBoss = 256,
  ForestCryptHildir = 512,
  CaveHildir = 1024,
  PlainsFortHildir = 2048,
  AshlandRuins = 4096,
  FortressRuins = 8192,
}

/** C++ Dungeon::Algorithm. */
export enum DungeonAlgorithm {
  Dungeon = 0,
  CampGrid = 1,
  CampRadial = 2,
}

/** C++ RoomConnection — a connector transform inside a room prefab. */
export interface RoomConnectionDef {
  /** Coupling type; rooms only attach to connectors of the same type ('' is common). */
  readonly type: string;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
  readonly doorOnlyIfOtherAlsoAllowsDoor: boolean;
  readonly localPos: Vector3;
  readonly localRot: Quaternion;
}

/** An interactive prefab contained in a room (chest, spawner, torch, …). */
export interface RoomNetView {
  readonly prefabName: string;
  readonly prefabHash: number;
  readonly pos: Vector3;
  readonly rot: Quaternion;
}

/** Random decoration variant data attached to net views of a room. */
export interface RoomRandomSpawn {
  readonly chanceToSpawn: number;
  readonly dungeonRequireTheme: number;
  readonly requireBiome: number;
  readonly notInLava: boolean;
  readonly minElevation: number;
  readonly maxElevation: number;
  /** Indices into the room's netViews affected by this spawn group. */
  readonly childViews: readonly number[];
}

/** C++ Room (DungeonRoom.h) — one placeable room prefab. */
export interface RoomDef {
  /** Prefab name — also the GLB model name under assets/models/. */
  readonly name: string;
  /** getStableHash(name) — network/persistence ID of the room. */
  readonly hash: number;
  readonly divider: boolean;
  readonly endCap: boolean;
  readonly endCapPrio: number;
  readonly entrance: boolean;
  readonly faceCenter: boolean;
  readonly minPlaceOrder: number;
  readonly perimeter: boolean;
  /** OBB size for the collision test (Vector3Int in Unity). */
  readonly size: Vector3;
  readonly theme: number;
  readonly weight: number;
  /** Room offset inside the source dungeon prefab (start-room dummy anchor). */
  readonly pos: Vector3;
  readonly rot: Quaternion;
  readonly connections: readonly RoomConnectionDef[];
  readonly netViews: readonly RoomNetView[];
  readonly randomSpawns: readonly RoomRandomSpawn[];
}

/** C++ Dungeon::DoorDef. */
export interface DungeonDoorDef {
  readonly prefabName: string;
  readonly prefabHash: number;
  readonly connectionType: string;
  readonly chance: number;
}

/** C++ Dungeon (Dungeon.h) — a DG_* generator with its room kit. */
export interface DungeonDef {
  /** DG_* prefab name. */
  readonly name: string;
  /** getStableHash(name). */
  readonly hash: number;
  /** Interior offset in the location prefab ((0,5000,0) for real dungeons). */
  readonly interiorPosition: Vector3 | null;
  readonly originalPosition: Vector3 | null;
  readonly algorithm: DungeonAlgorithm;
  readonly alternativeFunctionality: boolean;
  readonly campRadiusMax: number;
  readonly campRadiusMin: number;
  readonly doorChance: number;
  readonly doorTypes: readonly DungeonDoorDef[];
  readonly gridSize: number;
  /** Number of placement ATTEMPTS, not rooms (original naming). */
  readonly maxRooms: number;
  readonly maxTilt: number;
  readonly minAltitude: number;
  readonly minRequiredRooms: number;
  readonly minRooms: number;
  readonly perimeterBuffer: number;
  readonly perimeterSections: number;
  readonly requiredRooms: readonly string[];
  readonly spawnChance: number;
  /** RoomTheme bitmask. */
  readonly themes: number;
  readonly tileWidth: number;
  readonly rooms: readonly RoomDef[];
}

interface DungeonJson extends Omit<DungeonDef, 'hash' | 'rooms' | 'algorithm'> {
  readonly algorithm: number;
  readonly rooms: readonly Omit<RoomDef, 'hash'>[];
}

/** All 13 dungeon generators from dungeons.pkg, in pkg order. */
export const DUNGEONS: readonly DungeonDef[] = (
  (dungeonsData as unknown as { dungeons: DungeonJson[] }).dungeons
).map((d) => ({
  ...d,
  hash: getStableHash(d.name),
  algorithm: d.algorithm as DungeonAlgorithm,
  rooms: d.rooms.map((r) => ({ ...r, hash: getStableHash(r.name) })),
}));

export const DUNGEONS_BY_NAME: ReadonlyMap<string, DungeonDef> = new Map(
  DUNGEONS.map((d) => [d.name, d])
);

export const DUNGEONS_BY_HASH: ReadonlyMap<number, DungeonDef> = new Map(
  DUNGEONS.map((d) => [d.hash, d])
);

/** Room lookup across all dungeons (room names are globally unique). */
export const ROOMS_BY_HASH: ReadonlyMap<number, RoomDef> = new Map(
  DUNGEONS.flatMap((d) => d.rooms.map((r) => [r.hash, r] as const))
);

export function getDungeonByName(name: string): DungeonDef | undefined {
  return DUNGEONS_BY_NAME.get(name);
}

export function getDungeonByHash(hash: number): DungeonDef | undefined {
  return DUNGEONS_BY_HASH.get(hash);
}

export function getRoomByHash(hash: number): RoomDef | undefined {
  return ROOMS_BY_HASH.get(hash);
}

// ---------------------------------------------------------------------------
// Layout & document — our own instance-based dungeon format
// ---------------------------------------------------------------------------

/** One placed room in a dungeon layout (local dungeon space, origin = entrance connector). */
export interface PlacedRoom {
  /** RoomDef name (must exist in the base dungeon's room kit). */
  room: string;
  pos: Vector3;
  rot: Quaternion;
  /** Depth in the growth tree (0 = start room). */
  placeOrder: number;
  /** Position-derived seed for random decoration variants. */
  seed: number;
}

/** One placed door in a dungeon layout (local dungeon space). */
export interface PlacedDoor {
  prefabName: string;
  prefabHash: number;
  pos: Vector3;
  rot: Quaternion;
}

/** The complete geometry of one dungeon — rooms + doors in local space. */
export interface DungeonLayout {
  rooms: PlacedRoom[];
  doors: PlacedDoor[];
}

export const DUNGEON_DOCUMENT_VERSION = 1;

/** Hard cap on rooms in a (user-editable) dungeon document. */
export const MAX_DUNGEON_ROOMS = 256;
export const MAX_DUNGEON_DOORS = 256;

/**
 * A saved dungeon with its own ID — either generated (reproducible from
 * base+seed, but stored materialized so it can be edited) or hand-built.
 */
export interface DungeonDocument {
  version: number;
  /** Unique dungeon ID, e.g. 'forestcrypt-a3f19c' — assignable to entrances. */
  id: string;
  /** Display name. */
  name: string;
  /** DG_* base — provides room kit, door types and interior environment. */
  base: string;
  mode: 'generated' | 'custom';
  /** Generation seed (also reused for decoration variants). */
  seed: number;
  /** Growth bounds used at generation time (informational for the editor). */
  zoneSize: number;
  layout: DungeonLayout;
}

/**
 * Interior lighting environment per dungeon base (Unity
 * Location.m_interiorEnvironment — the EnvZone the location prefab forces
 * inside its interior box). Names must exist in envData.json.
 */
const INTERIOR_ENV: ReadonlyMap<string, string> = new Map([
  ['DG_ForestCrypt', 'Crypt'],
  ['DG_Hildir_ForestCrypt', 'CryptHildir'],
  ['DG_SunkenCrypt', 'SunkenCrypt'],
  ['DG_Cave', 'Caves'],
  ['DG_Hildir_Cave', 'CavesHildir'],
  ['DG_DvergrBoss', 'Darklands_dark'],
  ['DG_DvergrTown', 'Darklands_dark'],
]);

/** Lighting environment for a dungeon base ('Crypt' as always-dark fallback). */
export function interiorEnvironment(base: string): string {
  return INTERIOR_ENV.get(base) ?? 'Crypt';
}

/**
 * DG_* bases that must NOT become standalone instances. PlainsFortress is
 * algorithm=Dungeon on paper, but it is an above-ground fortress whose
 * generation fills every wall slot with endcaps (measured: ~8 000 rooms
 * per run) — materializing that as an instance would create 60k+ ZDOs.
 */
const NOT_INSTANCEABLE = new Set(['DG_Hildir_PlainsFortress']);

/** Whether a DG_* base may be materialized as a standalone instance. */
export function isInstanceableDungeon(def: DungeonDef): boolean {
  return def.algorithm === DungeonAlgorithm.Dungeon && !NOT_INSTANCEABLE.has(def.name);
}

/**
 * Visible entrance hulls (Phase G): the exterior model of a dungeon
 * location is NOT a ZNetView piece — in Unity it is static geometry of the
 * location prefab, reconstructed client-side via LocationProxy. We spawn
 * it as a plain static ZDO instead; these are the location-hull GLBs from
 * the asset export (feature name = model name, all verified present).
 */
export const ENTRANCE_HULL_MODELS: ReadonlySet<string> = new Set([
  'Crypt2',
  'Crypt3',
  'Crypt4',
  'SunkenCrypt4',
  'MountainCave02',
  'Hildir_cave',
  'Hildir_crypt',
  'Mistlands_DvergrTownEntrance1',
  'Mistlands_DvergrTownEntrance2',
  'Mistlands_DvergrBossEntrance1',
]);

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export function isValidDungeonId(id: string): boolean {
  return ID_RE.test(id);
}

function sanitizeVec3(v: unknown): Vector3 {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { x: n(o.x), y: n(o.y), z: n(o.z) };
}

function sanitizeQuat(q: unknown): Quaternion {
  const o = (q ?? {}) as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const raw = { x: n(o.x, 0), y: n(o.y, 0), z: n(o.z, 0), w: n(o.w, 1) };
  const m = Math.sqrt(raw.x * raw.x + raw.y * raw.y + raw.z * raw.z + raw.w * raw.w);
  if (m < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  // Only repair truly degenerate quaternions — normalizing healthy ones
  // would shift f32-precision generator output on every save/load cycle.
  if (Math.abs(m - 1) < 1e-3) return raw;
  return { x: raw.x / m, y: raw.y / m, z: raw.z / m, w: raw.w / m };
}

/**
 * Validate/clamp an untrusted dungeon document (editor upload, disk file).
 * Never throws; returns null only when the document is beyond repair
 * (unknown base dungeon or unusable ID). Unknown rooms are dropped.
 */
export function sanitizeDungeonDocument(input: unknown): DungeonDocument | null {
  const o = (input ?? {}) as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id.toLowerCase() : '';
  if (!isValidDungeonId(id)) return null;

  const base = typeof o.base === 'string' ? o.base : '';
  const def = DUNGEONS_BY_NAME.get(base);
  if (!def) return null;

  const roomsByName = new Map(def.rooms.map((r) => [r.name, r]));
  const doorHashes = new Set(def.doorTypes.map((d) => d.prefabHash));

  const layoutIn = (o.layout ?? {}) as Record<string, unknown>;
  const roomsIn = Array.isArray(layoutIn.rooms) ? layoutIn.rooms : [];
  const doorsIn = Array.isArray(layoutIn.doors) ? layoutIn.doors : [];

  const rooms: PlacedRoom[] = [];
  for (const r of roomsIn.slice(0, MAX_DUNGEON_ROOMS)) {
    const ro = (r ?? {}) as Record<string, unknown>;
    const name = typeof ro.room === 'string' ? ro.room : '';
    if (!roomsByName.has(name)) continue;
    rooms.push({
      room: name,
      pos: sanitizeVec3(ro.pos),
      rot: sanitizeQuat(ro.rot),
      placeOrder:
        typeof ro.placeOrder === 'number' && Number.isFinite(ro.placeOrder)
          ? Math.max(0, Math.min(1024, Math.trunc(ro.placeOrder)))
          : 0,
      seed: typeof ro.seed === 'number' && Number.isFinite(ro.seed) ? ro.seed | 0 : 0,
    });
  }
  if (rooms.length === 0) return null;

  const doors: PlacedDoor[] = [];
  for (const d of doorsIn.slice(0, MAX_DUNGEON_DOORS)) {
    const doorObj = (d ?? {}) as Record<string, unknown>;
    const hash =
      typeof doorObj.prefabHash === 'number' && Number.isFinite(doorObj.prefabHash)
        ? doorObj.prefabHash | 0
        : 0;
    if (!doorHashes.has(hash)) continue;
    const doorDef = def.doorTypes.find((t) => t.prefabHash === hash)!;
    doors.push({
      prefabName: doorDef.prefabName,
      prefabHash: hash,
      pos: sanitizeVec3(doorObj.pos),
      rot: sanitizeQuat(doorObj.rot),
    });
  }

  return {
    version: DUNGEON_DOCUMENT_VERSION,
    id,
    name:
      typeof o.name === 'string' && o.name.trim().length > 0
        ? o.name.trim().slice(0, 64)
        : id,
    base,
    mode: o.mode === 'custom' ? 'custom' : 'generated',
    seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? o.seed | 0 : 0,
    zoneSize:
      typeof o.zoneSize === 'number' && Number.isFinite(o.zoneSize)
        ? Math.max(16, Math.min(512, o.zoneSize))
        : 64,
    layout: { rooms, doors },
  };
}
