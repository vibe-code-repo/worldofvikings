/**
 * Diese Datei war als Abriss-Kandidat gefuehrt („wird nach Erfolg von
 * Dungeon Generator 2.0 geloescht"). Das gilt so nicht mehr.
 *
 * `generateCampLayout`/`CampGround` (Oberwelt — Doerfer, Hoefe,
 * Goblinlager) bleiben aktiv wie bisher und wandern erst beim Teilen dieser
 * Datei (siehe design/ARCHITECTURE.md AP0) nach
 * `shared/src/campGenerator.ts`.
 *
 * Die Editor-Operationen `attachRoom`, `removeRoom` und
 * `computeOpenConnections` sind: BLEIBT — Grundlage des
 * Connector-Modul-Kits (`DG_StoneVault`), Entscheidung 03.09.2026,
 * s. Vault-Notiz „Workflow — Connector-Modul-Kit" und `LEGACY.md`.
 * `stempelSetzen`/`stempelEntfernen` aus `shared/src/dungeon2/` treten
 * NEBEN sie, nicht an ihre Stelle: der zellbasierte Weg wuerfelt, der
 * Connector-Weg wird von Hand gesetzt.
 *
 * `generateDungeonLayout` und seine Helfer stehen weiterhin unter
 * Saat-Vertrag (s. `server/test/m3-stonevault-seeds.ts`) — hier wird
 * nichts umgebaut, auch nicht „nur schnell".
 * This file used to be listed for deletion; that no longer holds.
 * `generateCampLayout`/`CampGround` (overworld) stay active as before.
 * `attachRoom`, `removeRoom` and `computeOpenConnections` STAY — they are
 * the foundation of the connector module kit (`DG_StoneVault`), decision
 * 2026-09-03; see the vault note "Workflow — Connector-Modul-Kit" and
 * `LEGACY.md`. `generateDungeonLayout` and its helpers remain under the
 * seed contract.
 *
 * Dungeon generator (Phase G) — 1:1 port of the C++ server's
 * DungeonGenerator — port of the reference implementation's dungeon
 * generator for the `Dungeon` algorithm.
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
/**
 * Die Kantentafel — DIESELBE Funktion, die der Rasterpfad benutzt.
 *
 * Der Import geht bewusst nur in diese Richtung: `dungeonRasterModul.ts`
 * ist rein (keine Saat, keine Einstellung) und kennt weder diese Datei
 * noch `dungeonRasterGenerator.ts`. Ein Import des Rastergenerators von
 * hier aus waere ein Ringschluss — jener importiert `generateDungeonLayout`
 * fuer die Nicht-Rasterkits. Ein Ring laeuft unter `tsx` und faellt erst im
 * gebuendelten Client um.
 */
import {
  gridEdgeNeedsSeal,
  gridEdgeTable,
  gridModulesOfKit,
  gridPlacementConflict,
  placedGridCells,
  placedGridPorts,
  type Direction,
  type GridCell,
  type GridEdgeTable,
  type GridModule,
} from './dungeonRasterModul.js';

/**
 * LEGACY (s. Kopfkommentar dieser Datei) / LEGACY (see this file's header
 * comment) — inkl. `endcaps*`, `roomsFlipped`, `roomsInsetSize`,
 * `roomBodyFromFloor`, alle unten in dieser Interface-Definition.
 * Mirrors the dungeon defaults of the C++ reference server.
 */
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
  /**
   * Welchen Abschluss der Notfallzweig nimmt, wenn KEINER passt.
   *
   * Vorgabe `false` = das Verhalten der Vorlage: `endCaps[0]` aus der
   * frisch gemischten Liste, also ein beliebiger. Dort ist das harmlos,
   * weil Abschlüsse in der Vorlage durchweg dünne Blenden sind — welche
   * es wird, ändert nichts.
   *
   * `true` nimmt stattdessen den mit dem KLEINSTEN `endCapPrio`, also den
   * anspruchslosesten. Das ist für ein Kit gedacht, das begehbare Räume
   * UND ein bloßes Verschlussstück als Abschluss führt: Wenn nichts mehr
   * passt, soll zugemauert werden und nicht ein Raum in den Fels
   * getrieben. Ohne diesen Schalter nützt `endcapsCollision` dort nichts —
   * jede abgelehnte Nische landet im Notfallzweig und wird dort ohne
   * Prüfung doch gesetzt. Gemessen an `DG_Steingrab`: 163 solcher
   * Notfallsetzungen über 40 Seeds, ausnahmslos die Nische.
   *
   * Die Mischung bleibt in beiden Fällen unangetastet — sie zieht aus dem
   * RNG, und die Ziehreihenfolge ist Teil des Vertrags.
   */
  endcapsFallbackByPrio: boolean;
  /**
   * Höhe der Überschneidungsprüfung ab der BODENFLÄCHE statt um `pos.y`.
   *
   * ── Der Befund, gemessen am 28.08.2026 ─────────────────────────────
   * Die Vorlage prüft `pos.y ± size.y / 2`. Die Modelle haben ihren
   * Ursprung aber auf dem BODEN (nachgemessen beim Export: z = −0,30 …
   * +12,00 bei size.y = 12), nicht in der Mitte. Die geprüfte Box liegt
   * damit um size.y / 2 zu tief.
   *
   * Solange alle Räume gleich hoch sind und auf einer Ebene stehen,
   * fällt das nie auf — der Versatz ist bei allen gleich. Mit der
   * Treppe fällt es sofort auf: 12 m hoch, gesetzt auf y = −8, prüft
   * der Generator [−14, −2], während sie wirklich auf [−8, +4] steht.
   * Er baute Gänge mitten durch ihr Obergeschoss. Über 40 Seeds:
   * 5 Durchdringungen, alle an der Treppe.
   *
   * Vorgabe `false` — die 13 geparsten Fremdkits sollen sich weiter
   * verhalten wie die Vorlage. Eigene Kits mit Ebenensprüngen schalten
   * es über `generatorEinstellungen` ein.
   */
  roomBodyFromFloor: boolean;
  /** Place doors on eligible connections. */
  doorsEnabled: boolean;
}

// LEGACY (s. Kopfkommentar) / LEGACY (see header comment).
export const DEFAULT_GENERATOR_SETTINGS: DungeonGeneratorSettings = {
  zoneSize: 64,
  roomsFlipped: true,
  zoneBounded: true,
  maxAttemptsMultiplier: 2,
  roomsInsetSize: 0.1,
  endcapsEnabled: true,
  endcapsInsetFrac: 0.5,
  endcapsCollision: false,
  endcapsFallbackByPrio: false,
  roomBodyFromFloor: false,
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

// LEGACY (s. Kopfkommentar) / LEGACY (see header comment).
export class DungeonGenerationError extends Error {}

/**
 * LEGACY (s. Kopfkommentar) — ersetzt durch `erzeugeLayout()` in
 * `shared/src/dungeon2/generator.ts`.
 * LEGACY (see header comment) — replaced by `erzeugeLayout()` in
 * `shared/src/dungeon2/generator.ts`.
 *
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

  // Reihenfolge ist Absicht: Vorgabe der Vorlage, darüber das Kit,
  // darüber der Aufrufer. So bleibt eine Messzelle oder ein Test in der
  // Lage, eine Kit-Einstellung gezielt zu übersteuern, ohne dass das Kit
  // seine Zusage für den Normalbetrieb verliert.
  const settings = { ...DEFAULT_GENERATOR_SETTINGS, ...def.generatorEinstellungen, ...settingsIn };
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

    // Bezugspunkt statt Vergleichslogik — Begruendung an
    // `roomBodyFromFloor`. `rectOverlapRect` bleibt unangetastet und
    // damit die der Vorlage.
    const alsMitte = (p: Vector3, sz: Vector3): Vector3 =>
      settings.roomBodyFromFloor ? { x: p.x, y: p.y + sz.y / 2, z: p.z } : p;
    const eigene = alsMitte(pos, size);
    for (const other of placedRooms) {
      const otherSize = rotatedSize(other.room, other.rot);
      if (rectOverlapRect(size, eigene, otherSize, alsMitte(other.pos, otherSize))) return true;
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
        // Nothing fit — force-place a candidate without collision check;
        // an overlapping end cap beats an open hole into the void.
        //
        // WELCHER Kandidat, ist die Frage: `findEndCaps` MISCHT die Liste
        // (Ziehung aus dem RNG, Teil des Vertrags), `endCaps[0]` ist also
        // ein beliebiger. Ein Kit, dessen Abschlüsse unterschiedlich viel
        // Platz brauchen, bekommt hier sonst reihenweise seinen größten
        // in den Fels getrieben — s. `endcapsFallbackByPrio`.
        const roomData = settings.endcapsFallbackByPrio
          ? [...endCaps].sort((a, b) => a.endCapPrio - b.endCapPrio)[0]
          : endCaps[0];
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

  // Ein erzeugtes Layout traegt keine Deko — die setzt jemand von Hand.
  return { rooms, doors, props: [] };
}

// ---------------------------------------------------------------------------
// Camp generation (CampRadial) — villages, farms, goblin camps IN THE WORLD
//
// BLEIBT AKTIV — keine LEGACY-Markierung. Oberweltinhalt, unabhaengig vom
// Dungeon Generator 2.0. Wandert erst beim Teilen dieser Datei (AP0) nach
// `shared/src/campGenerator.ts`, s. Kopfkommentar dieser Datei.
// STAYS ACTIVE — no LEGACY marker. Overworld content, independent of
// Dungeon Generator 2.0. Only moves to `shared/src/campGenerator.ts` once
// this file is split (AP0), see this file's header comment.
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
    props: [],
  };
}

// ---------------------------------------------------------------------------
// Editor helpers — layout inspection and manual room placement
//
// LEGACY (s. Kopfkommentar dieser Datei) — ersetzt durch
// `stempelSetzen`/`stempelEntfernen` in `shared/src/dungeon2/cells.ts`.
// LEGACY (see this file's header comment) — replaced by
// `stempelSetzen`/`stempelEntfernen` in `shared/src/dungeon2/cells.ts`.
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
 * Steuerung von {@link computeOpenConnections}.
 *
 * Additiv und mit Vorgabe „aus": Ohne das Objekt rechnet die Funktion Wort
 * fuer Wort wie vorher. Das ist kein Stil, sondern Pflicht — `anbaubareKanten`
 * und `wandConnectors` in `dungeonKanten.ts` brauchen die ROHE Liste, und
 * der Saat-Vertrag haengt an ihr.
 */
export interface OpenConnectionOptions {
  /**
   * Statt „Connector ohne Partner" zaehlen, was ein LOCH ist.
   *
   * ── Warum das zwei Filter sind und nicht einer ───────────────────────
   * Ein Connector ohne Gegenstueck ist nicht dasselbe wie ein Loch. Zwei
   * Faelle sind vollstaendig versorgt und trotzdem ungepaart:
   *
   *  1. Der EINGANG von Raum 0. Dort geht es hinaus; der Server haengt
   *     genau da die Verbindung zur Oberwelt an. Erkannt hart an Raum 0
   *     UND `connection.entrance`, nicht an der Lage (0,0,0) — ein zweiter
   *     Connector, der dort zufaellig auch laege, bliebe sonst ein Loch.
   *  2. Eine Oeffnung, vor der die EINGEBAUTE Wand des Nachbarmoduls
   *     steht (Zeile 3 der Kantentafel). Der Rasterpfad setzt dort mit
   *     Absicht keine Platte — zwei deckungsgleiche Koerper waeren
   *     Z-Fighting, und die Kante ist bereits dicht. Der Connector bleibt
   *     trotzdem ungepaart, weil die fremde Wand kein Connector ist.
   *
   * Fall 2 gilt nur fuer Kits mit `gridGeneration`; ohne Raster gibt es
   * keine Tafel, und dann bleibt es beim Eingangsfilter.
   *
   * Der Name stammt aus der Konzeptnotiz (G9). Er nennt den ersten Filter;
   * der zweite kam dazu, als die Messung zeigte, dass „1 offen" in Wahrheit
   * „1 Eingang + n fremde Waende" war (46 solcher Kanten ueber 40 Saaten).
   */
  ohneEingang?: boolean;
}

/**
 * Ein Connector, zurueckgerechnet auf seine Rasterzelle und -kante.
 * `null`, wenn das Kit keine Rastererklaerung hat.
 */
function gridPortIndex(
  layout: DungeonLayout,
  def: DungeonDef
): { table: GridEdgeTable; ports: Map<string, { cell: GridCell; direction: Direction }> } | null {
  if (!def.gridGeneration) return null;
  const modules = gridModulesOfKit(def.rooms);
  const ports = new Map<string, { cell: GridCell; direction: Direction }>();
  layout.rooms.forEach((placed, roomIndex) => {
    const module = modules.get(placed.room);
    if (!module || module.endCap) return;
    for (const p of placedGridPorts(module, placed.pos, placed.rot)) {
      ports.set(`${roomIndex}/${p.connector}`, { cell: p.cell, direction: p.direction });
    }
  });
  return { table: gridEdgeTable(layout.rooms, modules), ports };
}

/**
 * All connectors without a counterpart within 0.1 m — the places where the
 * editor can attach another room.
 *
 * Mit `{ ohneEingang: true }` zaehlt sie stattdessen LOECHER; die Begruendung
 * steht an {@link OpenConnectionOptions}.
 */
export function computeOpenConnections(
  layout: DungeonLayout,
  baseName: string,
  options?: OpenConnectionOptions
): OpenConnection[] {
  const def = DUNGEONS_BY_NAME.get(baseName);
  const roomsByName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);
  const all = connectionInstances(layout, roomsByName);
  const offen = all.filter((a, i) =>
    all.every((b, j) => i === j || sqDist(a.pos, b.pos) >= 0.1 * 0.1)
  );
  if (!options?.ohneEingang || !def) return offen;

  const start = roomsByName.get(layout.rooms[0]?.room ?? '');
  const raster = gridPortIndex(layout, def);
  return offen.filter((c) => {
    if (c.roomIndex === 0 && start?.connections[c.connIndex]?.entrance) return false;
    if (!raster) return true;
    const port = raster.ports.get(`${c.roomIndex}/${c.connIndex}`);
    // Kein Eintrag heisst: Dieser Connector ist nicht im Raster erklaert
    // (Fremdmodul, verbogene Drehung). Im Zweifel ein Loch — Verschweigen
    // waere der teurere Fehler.
    if (!port) return true;
    return gridEdgeNeedsSeal(raster.table, port.cell, port.direction);
  });
}

function roomOverlapsLayout(
  layout: DungeonLayout,
  roomsByName: Map<string, RoomDef>,
  room: RoomDef,
  pos: Vector3,
  rot: Quaternion,
  inset: number,
  fromFloor: boolean
): boolean {
  if (room.size.x === 0 || room.size.z === 0) return false;
  const s = quatMulVec3(rot, room.size);
  const size = { x: Math.abs(s.x) - inset, y: s.y - inset, z: Math.abs(s.z) - inset };
  // Statt die Vergleiche umzubauen, wandert der BEZUGSPUNKT: Liegt der
  // Ursprung des Modells auf dem Boden, ist die Mitte um size.y / 2
  // hoeher. Die sechs Zeilen darunter bleiben damit die der Vorlage.
  const mitteY = (p: Vector3, sz: Vector3): number =>
    fromFloor ? p.y + sz.y / 2 : p.y;
  const yA = mitteY(pos, size);
  for (const placed of layout.rooms) {
    const other = roomsByName.get(placed.room);
    if (!other || other.size.x === 0 || other.size.z === 0) continue;
    const os = quatMulVec3(placed.rot, other.size);
    const otherSize = { x: Math.abs(os.x), y: os.y, z: Math.abs(os.z) };
    const yB = mitteY(placed.pos, otherSize);
    const overlap = !(
      pos.x + size.x / 2 < placed.pos.x - otherSize.x / 2 ||
      yA + size.y / 2 < yB - otherSize.y / 2 ||
      pos.z + size.z / 2 < placed.pos.z - otherSize.z / 2 ||
      pos.x - size.x / 2 > placed.pos.x + otherSize.x / 2 ||
      yA - size.y / 2 > yB + otherSize.y / 2 ||
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
 *
 * `connIndex` (optional) pins WHICH connector of the room is used.
 */
export function attachRoom(
  layout: DungeonLayout,
  baseName: string,
  open: OpenConnection,
  roomName: string,
  connIndex?: number
): { ok: true; placed: PlacedRoom } | { ok: false; reason: string } {
  const def = DUNGEONS_BY_NAME.get(baseName);
  const room = def?.rooms.find((r) => r.name === roomName);
  if (!def || !room) return { ok: false, reason: `Unbekannter Raum: ${roomName}` };

  const roomsByName = new Map(def.rooms.map((r) => [r.name, r]));
  // Der Editor muss denselben Koerper pruefen wie der Generator, sonst
  // laesst er von Hand zu, was jener ablehnt — und der Unterschied faellt
  // erst im Spiel auf. Die Einstellung kommt deshalb aus dem KIT.
  const fromFloor =
    def.generatorEinstellungen?.roomBodyFromFloor ?? DEFAULT_GENERATOR_SETTINGS.roomBodyFromFloor;
  const matching = room.connections.filter((c) => c.type === open.type);
  if (matching.length === 0) {
    return { ok: false, reason: `Raum hat keinen Connector vom Typ '${open.type || 'Standard'}'` };
  }

  // Wer von Hand baut, will die RICHTUNG bestimmen, in die ein Gang
  // weiterläuft. Genau das ist `connIndex` — und bewusst NICHT ein zweiter,
  // freier Geometriepfad.
  //
  // Der Grund steht eine Zeile tiefer: `attachRot` ist vollständig durch den
  // OFFENEN Connector bestimmt (dessen Drehung, um 180° gekippt). Die einzige
  // Größe, die danach noch variiert, ist `quatInverse(conn.localRot)` — die
  // Kante des ANGEDOCKTEN Raums. Bei einer StoneVault-Zelle mit vier
  // `cellEdge`-Kanten sind die vier Kandidaten faktisch vier Drehungen um
  // 90°: die Drehung IST der Connector-Index. Ein eigenes Winkel- oder
  // Drehfeld wäre eine zweite Quelle für dieselbe Zahl — und die erste
  // Abweichung zwischen beiden fiele nicht hier auf, sondern erst im Spiel,
  // wenn ein Gang neben statt an seiner Tür sitzt.
  //
  // Ohne den Parameter bleibt alles wie bisher: die Schleife nimmt den ersten
  // kollisionsfreien Kandidaten. Der Generator-Pfad (`generateDungeonLayout`
  // und seine Helfer) ruft `attachRoom` nicht auf und ist davon unberührt —
  // der Saat-Vertrag bleibt Wort für Wort derselbe.
  let kandidaten = matching;
  if (connIndex !== undefined) {
    const gewaehlt = room.connections[connIndex];
    if (!gewaehlt || gewaehlt.type !== open.type) {
      return {
        ok: false,
        reason: `Raum hat keinen Connector ${connIndex} vom Typ '${open.type || 'Standard'}'`,
      };
    }
    kandidaten = [gewaehlt];
  }

  // Die Kantentafel — dieselbe Funktion, die der Rasterpfad benutzt, nicht
  // eine zweite Fassung derselben Regel.
  //
  // ── Warum die Huelle allein nicht reicht ─────────────────────────────
  // `roomOverlapsLayout` prueft `RoomDef.size`, und die luegt mit Absicht:
  // 1,4 statt 2,0 m Innenmass, damit der Abschluss der Nachbarzelle nicht
  // dagegenstoesst (`eigeneDungeons.ts`, Begruendung an StoneVaultCorridor).
  // Genau in diesen 0,6 m entsteht Mikes Befund vom 04.09.2026: zwei Module
  // Wand an Wand, dazwischen eine Oeffnung vor einer eingebauten Wand. Die
  // Huelle sieht das nie, weil sie an dieser Stelle gar nicht hinreicht.
  //
  // Einmal vor der Schleife gerechnet: Die Tafel haengt am LAYOUT, nicht am
  // Kandidaten, und `gridModulesOfKit` erklaert alle acht Module.
  const gridModules = def.gridGeneration ? gridModulesOfKit(def.rooms) : null;
  const gridTable: GridEdgeTable | null = gridModules
    ? gridEdgeTable(layout.rooms, gridModules)
    : null;
  const gridModule: GridModule | null = gridModules?.get(room.name) ?? null;

  const attachRot = quatMul(open.rot, FLIP_180);
  // Der letzte Tafelverstoss, als Begruendung fuer den Aufrufer. Ohne ihn
  // meldete der Editor „Kollision" fuer einen Fall, in dem sich nichts
  // ueberschneidet — und niemand faende den Grund.
  let tafelGrund: string | null = null;
  for (const conn of kandidaten) {
    const outRot = quatMul(attachRot, quatInverse(conn.localRot));
    const outPos = vSub(open.pos, quatMulVec3(outRot, conn.localPos));
    if (
      !room.endCap &&
      roomOverlapsLayout(layout, roomsByName, room, outPos, outRot, 0.1, fromFloor)
    ) {
      continue;
    }
    // Verschlussplatten sind ausgenommen: Sie belegen keine Zelle und
    // legen sich in die Kantenebene — `placedGridCells` liefert fuer sie
    // ohnehin nichts, aber die Ausnahme steht hier ausgeschrieben, damit
    // ein Kit mit einer dickeren Platte nicht lautlos die Regel bricht.
    if (gridTable && gridModule && !gridModule.endCap) {
      const verstoss = gridPlacementConflict(
        gridTable,
        placedGridCells(gridModule, outPos, outRot)
      );
      if (verstoss) {
        tafelGrund = verstoss;
        continue;
      }
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
  return {
    ok: false,
    reason: tafelGrund ?? 'Kollision — kein Connector passt ohne Überschneidung',
  };
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
  // Deko dieses Raums geht mit. Ohne das bliebe eine Fackel dort in der
  // Luft haengen, wo eben noch eine Wand war.
  //
  // Und die Indizes RUTSCHEN: `splice` verschiebt jeden Raum hinter dem
  // entfernten um eins nach vorn. Ein `roomIndex`, der nicht mitzieht,
  // zeigt danach auf den falschen Raum — und das faellt erst auf, wenn
  // jemand viel spaeter einen zweiten Raum entfernt und die Fackeln eines
  // dritten verschwinden.
  layout.props = (layout.props ?? [])
    .filter((p) => p.roomIndex !== index)
    .map((p) => (p.roomIndex > index ? { ...p, roomIndex: p.roomIndex - 1 } : p));
  layout.rooms.splice(index, 1);
  return { ok: true };
}
