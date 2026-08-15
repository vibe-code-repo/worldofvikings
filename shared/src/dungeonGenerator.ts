/**
 * Dungeon generator (Phase G) — 1:1 port of the C++ server's
 * DungeonGenerator (valheim.community DungeonGenerator.cpp, itself a port
 * of assembly_valheim DungeonGenerator.cs) for the `Dungeon` algorithm.
 *
 * Differences to the original, deliberate:
 *  - Generation happens in LOCAL dungeon space around the origin: the start
 *    room's entrance connector lands exactly at (0,0,0), the growth bounds
 *    (`zoneSize`) are centered on the origin (C++
 *    `TEST_dungeonsRoomsZoneCenterAtDungeon` behavior). Our dungeons are
 *    standalone instances, so there is no world/zone anchoring here — the
 *    server offsets the finished layout into an instance band.
 *  - Camp algorithms (CampGrid/CampRadial) are not supported: camps are
 *    open-world structures and are never instanced.
 *  - The result is a plain `DungeonLayout` (rooms + doors); interactive
 *    net views are materialized later from the RoomDefs.
 *
 * The RNG is the Unity-compatible XorShiftRandom (single stream, draw order
 * is part of the contract — do not reorder calls).
 */

import type { DungeonDef, DungeonLayout, PlacedDoor, PlacedRoom, RoomConnectionDef, RoomDef } from './dungeons.js';
import { DungeonAlgorithm, DUNGEONS_BY_NAME } from './dungeons.js';
import type { Quaternion, Vector3 } from './types.js';
import { XorShiftRandom } from './worldgen/Random.js';
import { quatEuler, quatMul, quatMulVec3 } from './worldgen/Math3d.js';

/** Mirrors the C++ VAL_SETTINGS dungeon defaults (ValhallaServer.cpp:450-484). */
export interface DungeonGeneratorSettings {
  /** Growth bounds (cube edge length) centered on the origin. */
  zoneSize: number;
  /** Attach rooms rotated 180° at the connector (original behavior). */
  roomsFlipped: boolean;
  /** Keep every room inside the zone bounds. */
  zoneBounded: boolean;
  /** m_maxRooms multiplier (more attempts → denser dungeons). */
  maxAttemptsMultiplier: number;
  /** Shrink applied to non-endcap rooms before the overlap test. */
  roomsInsetSize: number;
  /** Place end caps on remaining open connections. */
  endcapsEnabled: boolean;
  /** Size fraction of end caps for bounds/overlap tests. */
  endcapsInsetFrac: number;
  /** Whether end caps collide with rooms (default off — they seal openings). */
  endcapsCollision: boolean;
  /** Place doors on eligible connections. */
  doorsEnabled: boolean;
}

export const DEFAULT_GENERATOR_SETTINGS: DungeonGeneratorSettings = {
  zoneSize: 64,
  roomsFlipped: true,
  zoneBounded: true,
  maxAttemptsMultiplier: 2,
  roomsInsetSize: 0.1,
  endcapsEnabled: true,
  endcapsInsetFrac: 0.5,
  endcapsCollision: false,
  doorsEnabled: true,
};

interface ConnectionInstance {
  def: RoomConnectionDef;
  pos: Vector3;
  rot: Quaternion;
  placeOrder: number;
}

interface RoomInstance {
  room: RoomDef;
  pos: Vector3;
  rot: Quaternion;
  placeOrder: number;
  seed: number;
  connections: ConnectionInstance[];
}

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const FLIP_180 = quatEuler(0, 180, 0);

function vAdd(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vSub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function sqDist(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Unit-quaternion inverse (conjugate). */
function quatInverse(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** C++ VUtils::Physics::LocalToGlobal (note the childRot*parentRot order). */
function localToGlobal(
  localPos: Vector3,
  localRot: Quaternion,
  parentPos: Vector3,
  parentRot: Quaternion
): { pos: Vector3; rot: Quaternion } {
  return {
    pos: vAdd(parentPos, quatMulVec3(parentRot, localPos)),
    rot: quatMul(localRot, parentRot),
  };
}

/** Position-derived decoration seed (DungeonGenerator.cpp:595). */
function roomSeed(pos: Vector3): number {
  return (
    (Math.imul(Math.trunc(pos.x), 4271) +
      Math.imul(Math.trunc(pos.y), 9187) +
      Math.imul(Math.trunc(pos.z), 2134)) |
    0
  );
}

function makeRoomInstance(
  room: RoomDef,
  pos: Vector3,
  rot: Quaternion,
  placeOrder: number
): RoomInstance {
  const connections: ConnectionInstance[] = room.connections.map((c) => {
    const g = localToGlobal(c.localPos, c.localRot, pos, rot);
    return { def: c, pos: g.pos, rot: g.rot, placeOrder };
  });
  return { room, pos, rot, placeOrder, seed: roomSeed(pos), connections };
}

export class DungeonGenerationError extends Error {}

/**
 * Generate a dungeon layout — pure and deterministic: same (def, seed,
 * settings) always yields the same layout.
 */
export function generateDungeonLayout(
  def: DungeonDef,
  seed: number,
  settingsIn?: Partial<DungeonGeneratorSettings>
): DungeonLayout {
  if (def.algorithm !== DungeonAlgorithm.Dungeon) {
    throw new DungeonGenerationError(
      `Dungeon '${def.name}' uses camp algorithm ${def.algorithm} — only interior dungeons are instanced`
    );
  }

  const settings = { ...DEFAULT_GENERATOR_SETTINGS, ...settingsIn };
  const state = new XorShiftRandom(seed | 0);

  const placedRooms: RoomInstance[] = [];
  const openConnections: ConnectionInstance[] = [];
  const doorConnections: ConnectionInstance[] = [];

  const zoneHalf = settings.zoneSize * 0.5;

  // ---- helpers closing over the working lists -----------------------------

  /** C++ Room::GetConnection — random connector of the same type. */
  function getConnection(room: RoomDef, other: RoomConnectionDef): RoomConnectionDef {
    const matching = room.connections.filter((c) => c.type === other.type);
    if (matching.length === 0) {
      throw new DungeonGenerationError(`missing guaranteed connection on room '${room.name}'`);
    }
    return matching[state.rangeInt(0, matching.length)];
  }

  function haveConnection(room: RoomDef, other: RoomConnectionDef): boolean {
    return room.connections.some((c) => c.type === other.type);
  }

  /** C++ CalculateRoomPosRot. */
  function calculateRoomPosRot(
    roomCon: RoomConnectionDef,
    pos: Vector3,
    rot: Quaternion
  ): { pos: Vector3; rot: Quaternion } {
    const outRot = quatMul(rot, quatInverse(roomCon.localRot));
    const outPos = vSub(pos, quatMulVec3(outRot, roomCon.localPos));
    return { pos: outPos, rot: outRot };
  }

  /** All 4 rotated floor corners inside the origin-centered zone cube? */
  function isInsideZone(room: RoomDef, pos: Vector3, rot: Quaternion): boolean {
    if (!settings.zoneBounded) return true;

    let semi = { x: room.size.x * 0.5, y: room.size.y * 0.5, z: room.size.z * 0.5 };
    if (room.endCap) {
      semi = {
        x: semi.x * settings.endcapsInsetFrac,
        y: semi.y * settings.endcapsInsetFrac,
        z: semi.z * settings.endcapsInsetFrac,
      };
    }

    if (pos.y + semi.y < -zoneHalf || pos.y - semi.y > zoneHalf) return false;

    const corners = [
      vAdd(pos, quatMulVec3(rot, { x: -semi.x, y: 0, z: -semi.z })),
      vAdd(pos, quatMulVec3(rot, { x: -semi.x, y: 0, z: semi.z })),
      vAdd(pos, quatMulVec3(rot, { x: semi.x, y: 0, z: semi.z })),
      vAdd(pos, quatMulVec3(rot, { x: semi.x, y: 0, z: -semi.z })),
    ];
    return corners.every(
      (c) => c.x >= -zoneHalf && c.x <= zoneHalf && c.z >= -zoneHalf && c.z <= zoneHalf
    );
  }

  function rectOverlapRect(size1: Vector3, pos1: Vector3, size2: Vector3, pos2: Vector3): boolean {
    const s1 = { x: size1.x * 0.5, y: size1.y * 0.5, z: size1.z * 0.5 };
    const s2 = { x: size2.x * 0.5, y: size2.y * 0.5, z: size2.z * 0.5 };
    return !(
      pos1.x + s1.x < pos2.x - s2.x ||
      pos1.y + s1.y < pos2.y - s2.y ||
      pos1.z + s1.z < pos2.z - s2.z ||
      pos1.x - s1.x > pos2.x + s2.x ||
      pos1.y - s1.y > pos2.y + s2.y ||
      pos1.z - s1.z > pos2.z + s2.z
    );
  }

  /** Rotated AABB size (rooms attach axis-aligned or at 90°). */
  function rotatedSize(room: RoomDef, rot: Quaternion): Vector3 {
    const s = quatMulVec3(rot, room.size);
    return { x: Math.abs(s.x), y: s.y, z: Math.abs(s.z) };
  }

  /** C++ TestCollision — true means "does NOT fit here". */
  function testCollision(room: RoomDef, pos: Vector3, rot: Quaternion): boolean {
    if (!isInsideZone(room, pos, rot)) return true;

    let size = rotatedSize(room, rot);
    if (room.endCap) {
      size = {
        x: size.x * settings.endcapsInsetFrac,
        y: size.y * settings.endcapsInsetFrac,
        z: size.z * settings.endcapsInsetFrac,
      };
    } else {
      const inset = settings.roomsInsetSize;
      size = { x: size.x - inset, y: size.y - inset, z: size.z - inset };
    }

    // End caps seal openings — by default they only check zone bounds.
    if (room.endCap && !settings.endcapsCollision) return false;

    for (const other of placedRooms) {
      const otherSize = rotatedSize(other.room, other.rot);
      if (rectOverlapRect(size, pos, otherSize, other.pos)) return true;
    }
    return false;
  }

  /** In-place Fisher-Yates matching the C++ inlined .Shuffle draw order. */
  function shuffle<T>(arr: T[]): void {
    let i = arr.length;
    while (i > 1) {
      i--;
      const index = state.rangeInt(0, i);
      const value = arr[index];
      arr[index] = arr[i];
      arr[i] = value;
    }
  }

  function getWeightedRoom(rooms: RoomDef[]): RoomDef {
    let total = 0;
    for (const r of rooms) total += r.weight;
    const target = state.rangeFloat(0, total);
    let acc = 0;
    for (const r of rooms) {
      acc += r.weight;
      if (target <= acc) return r;
    }
    return rooms[rooms.length - 1];
  }

  function candidateRooms(connection: ConnectionInstance | null): RoomDef[] {
    return def.rooms.filter(
      (r) =>
        !r.entrance &&
        !r.endCap &&
        !r.divider &&
        (!connection ||
          (haveConnection(r, connection.def) && connection.placeOrder >= r.minPlaceOrder))
    );
  }

  function getRandomWeightedRoom(connection: ConnectionInstance | null): RoomDef | null {
    const rooms = candidateRooms(connection);
    if (rooms.length === 0) return null;
    return getWeightedRoom(rooms);
  }

  function getRandomRoom(connection: ConnectionInstance | null): RoomDef | null {
    const rooms = candidateRooms(connection);
    if (rooms.length === 0) return null;
    return rooms[state.rangeInt(0, rooms.length)];
  }

  function findEndCaps(connection: RoomConnectionDef): RoomDef[] {
    const rooms = def.rooms.filter((r) => r.endCap && haveConnection(r, connection));
    shuffle(rooms);
    return rooms;
  }

  function findDividers(): RoomDef[] {
    const rooms = def.rooms.filter((r) => r.divider);
    shuffle(rooms);
    return rooms;
  }

  /** Register a placed room and open up its remaining connectors. */
  function commitRoom(
    room: RoomDef,
    pos: Vector3,
    rot: Quaternion,
    fromConnection: ConnectionInstance
  ): RoomInstance {
    const instance = makeRoomInstance(room, pos, rot, fromConnection.placeOrder + 1);
    for (const conn of instance.connections) {
      if (!conn.def.entrance && sqDist(conn.pos, fromConnection.pos) >= 0.1 * 0.1) {
        conn.placeOrder = instance.placeOrder;
        openConnections.push(conn);
      }
    }
    placedRooms.push(instance);
    return instance;
  }

  /**
   * C++ PlaceRoom(state, itr, room, outErased) — try to attach `room` to the
   * open connection at `openIndex`. Returns {placed, erased}.
   */
  function tryPlaceRoomAt(
    openIndex: number,
    room: RoomDef
  ): { placed: boolean; erased: boolean } {
    const connection = openConnections[openIndex];
    const connection2 = getConnection(room, connection.def);

    const attachRot = settings.roomsFlipped ? quatMul(connection.rot, FLIP_180) : connection.rot;
    const { pos, rot } = calculateRoomPosRot(connection2, connection.pos, attachRot);

    if (room.size.x !== 0 && room.size.z !== 0 && testCollision(room, pos, rot)) {
      return { placed: false, erased: false };
    }

    commitRoom(room, pos, rot, connection);

    if (!room.endCap) {
      if (
        connection.def.allowDoor &&
        (!connection.def.doorOnlyIfOtherAlsoAllowsDoor || connection2.allowDoor)
      ) {
        doorConnections.push(connection);
      }
      openConnections.splice(openIndex, 1);
      return { placed: true, erased: true };
    }
    return { placed: true, erased: false };
  }

  // ---- phase 1: start room ------------------------------------------------

  function placeStartRoom(): void {
    const entranceRooms = def.rooms.filter((r) => r.entrance);
    if (entranceRooms.length === 0) {
      throw new DungeonGenerationError(`dungeon '${def.name}' has no entrance room`);
    }
    const roomData = entranceRooms[state.rangeInt(0, entranceRooms.length)];
    const entrance = roomData.connections.find((c) => c.entrance);
    if (!entrance) {
      throw new DungeonGenerationError(`room '${roomData.name}' has no entrance connection`);
    }

    // Entrance connector lands exactly at the origin.
    const { pos, rot } = calculateRoomPosRot(entrance, { x: 0, y: 0, z: 0 }, IDENTITY);

    // Dummy fromConnection like the C++ (prefab-space transform of the entrance).
    const dummyGlobal = localToGlobal(entrance.localPos, entrance.localRot, roomData.pos, roomData.rot);
    const dummy: ConnectionInstance = {
      def: entrance,
      pos: dummyGlobal.pos,
      rot: dummyGlobal.rot,
      placeOrder: 0,
    };

    // Like the C++: the start room ends up with placeOrder 1 (dummy 0 + 1).
    commitRoom(roomData, pos, rot, dummy);
  }

  // ---- phase 2: random growth --------------------------------------------

  function placeOneRoom(): boolean {
    if (openConnections.length === 0) return false;
    const openIndex = state.rangeInt(0, openConnections.length);
    const openConnection = openConnections[openIndex];

    for (let i = 0; i < 10; i++) {
      const roomData = def.alternativeFunctionality
        ? getRandomWeightedRoom(openConnection)
        : getRandomRoom(openConnection);
      if (!roomData) break;
      if (tryPlaceRoomAt(openIndex, roomData).placed) return true;
    }
    return false;
  }

  function checkRequiredRooms(): boolean {
    if (def.minRequiredRooms === 0 || def.requiredRooms.length === 0) return false;
    const required = new Set(def.requiredRooms);
    let n = 0;
    for (const r of placedRooms) if (required.has(r.room.name)) n++;
    return n >= def.minRequiredRooms;
  }

  function placeRooms(): void {
    const maxAttempts = Math.trunc(def.maxRooms * settings.maxAttemptsMultiplier);
    for (let i = 0; i < maxAttempts; i++) {
      placeOneRoom();
      if (checkRequiredRooms() && placedRooms.length > def.minRooms) return;
    }
  }

  // ---- phase 3: end caps --------------------------------------------------

  function placeEndCaps(): void {
    let i = 0;
    while (i < openConnections.length) {
      const connection = openConnections[i];

      // Cycle detection: another open connection touching this one?
      let contact: ConnectionInstance | null = null;
      for (let j = 0; j < openConnections.length; j++) {
        if (j !== i && sqDist(connection.pos, openConnections[j].pos) < 0.1 * 0.1) {
          contact = openConnections[j];
          break;
        }
      }

      if (contact) {
        if (connection.def.type !== contact.def.type) {
          // Door type mismatch on a cycle — place a divider wall if possible.
          const dividers = findDividers();
          if (dividers.length > 0) {
            const divider = getWeightedRoom(dividers);
            const first = divider.connections[0];
            if (first) {
              const { pos } = calculateRoomPosRot(first, connection.pos, connection.rot);
              const already = placedRooms.some(
                (r) => r.room.divider && sqDist(r.pos, pos) < 0.5 * 0.5
              );
              if (!already) {
                // C++ logs the mismatch; the divider placement itself was
                // disabled upstream too — we keep the cycle open like the C++.
              }
            }
          }
        }
        i++;
        continue;
      }

      const endCaps = findEndCaps(connection.def);
      let placed = false;
      let erased = false;

      if (def.alternativeFunctionality) {
        for (let k = 0; k < 5 && endCaps.length > 0; k++) {
          const weighted = getWeightedRoom(endCaps);
          const result = tryPlaceRoomAt(i, weighted);
          if (result.placed) {
            placed = true;
            erased = result.erased;
            break;
          }
        }
      }

      if (!placed) {
        const sorted = [...endCaps].sort((a, b) => b.endCapPrio - a.endCapPrio);
        for (const roomData of sorted) {
          const result = tryPlaceRoomAt(i, roomData);
          if (result.placed) {
            placed = true;
            erased = result.erased;
            break;
          }
        }
      }

      if (!placed) {
        // Nothing fit — force-place the first candidate without collision
        // check; an overlapping end cap beats an open hole into the void.
        const roomData = endCaps[0];
        if (roomData) {
          const connection2 = getConnection(roomData, connection.def);
          const attachRot = settings.roomsFlipped
            ? quatMul(connection.rot, FLIP_180)
            : connection.rot;
          const { pos, rot } = calculateRoomPosRot(connection2, connection.pos, attachRot);
          commitRoom(roomData, pos, rot, connection);
          placed = true;
        }
      }

      if (!erased) i++;
    }
  }

  // ---- phase 4: doors -----------------------------------------------------

  const doors: PlacedDoor[] = [];

  function placeDoors(): void {
    for (const connection of doorConnections) {
      const defs = def.doorTypes.filter((d) => d.connectionType === connection.def.type);
      if (defs.length === 0) continue;
      const doorDef = defs[state.rangeInt(0, defs.length)];
      // Exactly one chance draw, mirroring the C++ short-circuit structure.
      if (
        (doorDef.chance <= 0 || state.nextFloat() <= doorDef.chance) &&
        (doorDef.chance > 0 || state.nextFloat() <= def.doorChance)
      ) {
        doors.push({
          prefabName: doorDef.prefabName,
          prefabHash: doorDef.prefabHash,
          pos: connection.pos,
          rot: connection.rot,
        });
      }
    }
  }

  // ---- run ----------------------------------------------------------------

  placeStartRoom();
  placeRooms();
  if (settings.endcapsEnabled) placeEndCaps();
  if (settings.doorsEnabled) placeDoors();

  const rooms: PlacedRoom[] = placedRooms.map((r) => ({
    room: r.room.name,
    pos: r.pos,
    rot: r.rot,
    placeOrder: r.placeOrder,
    seed: r.seed,
  }));

  return { rooms, doors };
}

// ---------------------------------------------------------------------------
// Camp generation (CampRadial) — villages, farms, goblin camps IN THE WORLD
// ---------------------------------------------------------------------------

/** Terrain sample for camp placement (height + surface normal y). */
export interface CampGround {
  y: number;
  normalY: number;
}

/**
 * C++ GenerateCampRadial + PlaceWall (DungeonGenerator.cpp:139-219) — camps
 * are OPEN-WORLD structures: buildings snap individually to the terrain
 * (`ground` callback), steep spots (maxTilt) and water are skipped, no
 * doors, no connectors. Positions in the returned layout are WORLD
 * coordinates around `origin`. All five camp bases in dungeons.pkg use
 * CampRadial; CampGrid has no data and stays unimplemented.
 */
export function generateCampLayout(
  def: DungeonDef,
  seed: number,
  origin: Vector3,
  ground: (x: number, z: number) => CampGround,
  waterLevel = 30
): DungeonLayout {
  if (def.algorithm !== DungeonAlgorithm.CampRadial) {
    throw new DungeonGenerationError(`'${def.name}' ist kein CampRadial-Camp`);
  }
  const state = new XorShiftRandom(seed | 0);
  const placed: Array<{ room: RoomDef; pos: Vector3; rot: Quaternion }> = [];

  /** Camp-Kollisionsmaß: normalisierte Größe × horizontale Ausdehnung. */
  const campSize = (room: RoomDef): Vector3 => {
    const m = Math.hypot(room.size.x, room.size.y, room.size.z) || 1;
    const h = Math.hypot(room.size.x, room.size.z);
    return { x: (room.size.x / m) * h, y: (room.size.y / m) * h, z: (room.size.z / m) * h };
  };

  const overlaps = (room: RoomDef, pos: Vector3): boolean => {
    let size = campSize(room);
    size = { x: size.x - 0.1, y: size.y - 0.1, z: size.z - 0.1 };
    for (const other of placed) {
      const os = campSize(other.room);
      const hit = !(
        pos.x + size.x / 2 < other.pos.x - os.x / 2 ||
        pos.y + size.y / 2 < other.pos.y - os.y / 2 ||
        pos.z + size.z / 2 < other.pos.z - os.z / 2 ||
        pos.x - size.x / 2 > other.pos.x + os.x / 2 ||
        pos.y - size.y / 2 > other.pos.y + os.y / 2 ||
        pos.z - size.z / 2 > other.pos.z + os.z / 2
      );
      if (hit) return true;
    }
    return false;
  };

  const weightedRoom = (perimeter: boolean): RoomDef | null => {
    const rooms = def.rooms.filter(
      (r) => !r.entrance && !r.endCap && !r.divider && r.perimeter === perimeter
    );
    if (rooms.length === 0) return null;
    let total = 0;
    for (const r of rooms) total += r.weight;
    const target = state.rangeFloat(0, total);
    let acc = 0;
    for (const r of rooms) {
      acc += r.weight;
      if (target <= acc) return r;
    }
    return rooms[rooms.length - 1];
  };

  /** C++ GetCampRoomRotation — zur Lagermitte drehen oder 22.5°-Raster. */
  const campRotation = (room: RoomDef, pos: Vector3): Quaternion => {
    if (room.faceCenter) {
      let dx = origin.x - pos.x;
      let dz = origin.z - pos.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) {
        dx = 0;
        dz = 1;
      } else {
        dx /= len;
        dz /= len;
      }
      const yawDeg = Math.round(((Math.atan2(dx, dz) * 180) / Math.PI) / 22.5) * 22.5;
      return quatEuler(0, yawDeg, 0);
    }
    return quatEuler(0, 22.5 * state.rangeInt(0, 16), 0);
  };

  const maxNormalY = Math.cos(0.017453292 * def.maxTilt);

  const tryPlaceAt = (room: RoomDef, dist: number): boolean => {
    const yawDeg = state.rangeInt(0, 360);
    const rad = (yawDeg * Math.PI) / 180;
    const pos: Vector3 = {
      x: origin.x + Math.sin(rad) * dist,
      y: origin.y,
      z: origin.z + Math.cos(rad) * dist,
    };
    const g = ground(pos.x, pos.z);
    pos.y = g.y;
    if (g.normalY < maxNormalY || pos.y - waterLevel < def.minAltitude) return false;
    const rot = campRotation(room, pos);
    if (overlaps(room, pos)) return false;
    placed.push({ room, pos, rot });
    return true;
  };

  // Radial: Zielanzahl Gebäude innerhalb des Lagerradius.
  const radius = state.rangeFloat(def.campRadiusMin, def.campRadiusMax);
  const target = state.rangeInt(def.minRooms, def.maxRooms);
  let count = 0;
  for (let i = 0; i < target * 20 && count < target; i++) {
    const room = weightedRoom(false);
    if (!room) break;
    if (tryPlaceAt(room, state.rangeFloat(0, radius - def.perimeterBuffer))) count++;
  }

  // Palisade: Perimeter-Segmente auf dem Radius.
  if (def.perimeterSections > 0) {
    let sections = 0;
    for (let i = 0; i < def.perimeterSections * 20 && sections < def.perimeterSections; i++) {
      const room = weightedRoom(true);
      if (!room) break;
      if (tryPlaceAt(room, radius)) sections++;
    }
  }

  return {
    rooms: placed.map((p) => ({
      room: p.room.name,
      pos: p.pos,
      rot: p.rot,
      placeOrder: 0,
      seed: roomSeed(p.pos),
    })),
    doors: [],
  };
}

// ---------------------------------------------------------------------------
// Editor helpers — layout inspection and manual room placement
// ---------------------------------------------------------------------------

/** A connector of a placed room with no counterpart touching it. */
export interface OpenConnection {
  roomIndex: number;
  connIndex: number;
  type: string;
  pos: Vector3;
  rot: Quaternion;
}

function connectionInstances(
  layout: DungeonLayout,
  roomsByName: Map<string, RoomDef>
): Array<OpenConnection> {
  const all: OpenConnection[] = [];
  layout.rooms.forEach((placed, roomIndex) => {
    const room = roomsByName.get(placed.room);
    if (!room) return;
    room.connections.forEach((c, connIndex) => {
      const g = localToGlobal(c.localPos, c.localRot, placed.pos, placed.rot);
      all.push({ roomIndex, connIndex, type: c.type, pos: g.pos, rot: g.rot });
    });
  });
  return all;
}

/**
 * All connectors without a counterpart within 0.1 m — the places where the
 * editor can attach another room.
 */
export function computeOpenConnections(layout: DungeonLayout, baseName: string): OpenConnection[] {
  const def = DUNGEONS_BY_NAME.get(baseName);
  const roomsByName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);
  const all = connectionInstances(layout, roomsByName);
  return all.filter((a, i) =>
    all.every((b, j) => i === j || sqDist(a.pos, b.pos) >= 0.1 * 0.1)
  );
}

function roomOverlapsLayout(
  layout: DungeonLayout,
  roomsByName: Map<string, RoomDef>,
  room: RoomDef,
  pos: Vector3,
  rot: Quaternion,
  inset: number
): boolean {
  if (room.size.x === 0 || room.size.z === 0) return false;
  const s = quatMulVec3(rot, room.size);
  const size = { x: Math.abs(s.x) - inset, y: s.y - inset, z: Math.abs(s.z) - inset };
  for (const placed of layout.rooms) {
    const other = roomsByName.get(placed.room);
    if (!other || other.size.x === 0 || other.size.z === 0) continue;
    const os = quatMulVec3(placed.rot, other.size);
    const otherSize = { x: Math.abs(os.x), y: os.y, z: Math.abs(os.z) };
    const overlap = !(
      pos.x + size.x / 2 < placed.pos.x - otherSize.x / 2 ||
      pos.y + size.y / 2 < placed.pos.y - otherSize.y / 2 ||
      pos.z + size.z / 2 < placed.pos.z - otherSize.z / 2 ||
      pos.x - size.x / 2 > placed.pos.x + otherSize.x / 2 ||
      pos.y - size.y / 2 > placed.pos.y + otherSize.y / 2 ||
      pos.z - size.z / 2 > placed.pos.z + otherSize.z / 2
    );
    if (overlap) return true;
  }
  return false;
}

/**
 * Attach `roomName` to an open connector (editor operation). Tries every
 * matching connector of the room, 180°-flipped like the generator; end
 * caps skip the overlap test (they seal openings by design). Returns the
 * placed room or an error reason. Mutates nothing — the caller appends.
 */
export function attachRoom(
  layout: DungeonLayout,
  baseName: string,
  open: OpenConnection,
  roomName: string
): { ok: true; placed: PlacedRoom } | { ok: false; reason: string } {
  const def = DUNGEONS_BY_NAME.get(baseName);
  const room = def?.rooms.find((r) => r.name === roomName);
  if (!def || !room) return { ok: false, reason: `Unbekannter Raum: ${roomName}` };

  const roomsByName = new Map(def.rooms.map((r) => [r.name, r]));
  const matching = room.connections.filter((c) => c.type === open.type);
  if (matching.length === 0) {
    return { ok: false, reason: `Raum hat keinen Connector vom Typ '${open.type || 'Standard'}'` };
  }

  const attachRot = quatMul(open.rot, FLIP_180);
  for (const conn of matching) {
    const outRot = quatMul(attachRot, quatInverse(conn.localRot));
    const outPos = vSub(open.pos, quatMulVec3(outRot, conn.localPos));
    if (!room.endCap && roomOverlapsLayout(layout, roomsByName, room, outPos, outRot, 0.1)) {
      continue;
    }
    return {
      ok: true,
      placed: {
        room: room.name,
        pos: outPos,
        rot: outRot,
        placeOrder: (layout.rooms[open.roomIndex]?.placeOrder ?? 0) + 1,
        seed: roomSeed(outPos),
      },
    };
  }
  return { ok: false, reason: 'Kollision — kein Connector passt ohne Überschneidung' };
}

/**
 * Remove a room from the layout (never the start room at index 0). Doors
 * sitting on the removed room's connectors are dropped with it.
 */
export function removeRoom(
  layout: DungeonLayout,
  baseName: string,
  index: number
): { ok: boolean; reason?: string } {
  if (index <= 0 || index >= layout.rooms.length) {
    return { ok: false, reason: 'Startraum (Index 0) kann nicht entfernt werden' };
  }
  const def = DUNGEONS_BY_NAME.get(baseName);
  const placed = layout.rooms[index]!;
  const room = def?.rooms.find((r) => r.name === placed.room);
  if (room) {
    const conns = room.connections.map((c) =>
      localToGlobal(c.localPos, c.localRot, placed.pos, placed.rot)
    );
    layout.doors = layout.doors.filter(
      (d) => !conns.some((c) => sqDist(c.pos, d.pos) < 0.3 * 0.3)
    );
  }
  layout.rooms.splice(index, 1);
  return { ok: true };
}
