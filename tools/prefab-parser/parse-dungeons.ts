/**
 * Dungeons Parser — reads dungeons.pkg from the Valhalla C++ dedicated
 * server (valheim.community) and exports all dungeon generators with their
 * complete room kits (sizes, connections, contained net views, random
 * spawns) as JSON. This is the data the Unity Room/RoomConnection
 * components carry, which the GLB exports do not contain.
 *
 * Binary format (valheim.community/library/src/DungeonManager.cpp:19-201):
 *
 *   header:
 *     string  comment            (.NET BinaryWriter: 7-bit varint length + UTF-8)
 *     string  gameVersion
 *     int32   dungeonCount
 *   per dungeon:
 *     int32   anchor             == getStableHash("dungeon")
 *     string  name               (DG_* prefab name)
 *     bool    useCustomInteriorTransform
 *     if useCustomInteriorTransform:
 *       float32×3  interiorPosition     (typically (0, 5000, 0))
 *       float32×4  interiorRotation     (quaternion, unused by the C++ server)
 *       float32×3  originalPosition     (generator offset inside the location)
 *     int32   algorithm          (0 Dungeon, 1 CampGrid, 2 CampRadial)
 *     bool    alternativeFunctionality
 *     float32 campRadiusMax, campRadiusMin, doorChance
 *     int32   doorCount
 *     per door:
 *       int32   anchor           == getStableHash("dungeonDoor")
 *       string  prefabName
 *       int32   prefabHash
 *       string  connectionType
 *       float32 chance
 *     int32   gridSize, maxRooms
 *     float32 maxTilt, minAltitude
 *     int32   minRequiredRooms, minRooms
 *     float32 perimeterBuffer
 *     int32   perimeterSections
 *     int32   requiredRoomCount, then string × count
 *     float32 spawnChance
 *     int32   themes             (Room.Theme bitmask)
 *     float32 tileWidth
 *     int32   roomCount
 *     per room:
 *       int32   anchor           == getStableHash("dungeonRoom")
 *       string  name
 *       bool    divider, endCap
 *       int32   endCapPrio
 *       bool    entrance, faceCenter
 *       int32   minPlaceOrder
 *       bool    perimeter
 *       float32×3  size          (Vector3Int in Unity, stored as floats)
 *       int32   theme
 *       float32 weight
 *       float32×3  pos           (room offset inside the source dungeon prefab)
 *       float32×4  rot
 *       int32   connectionCount
 *       per connection:
 *         string  type
 *         bool    entrance, allowDoor, doorOnlyIfOtherAlsoAllowsDoor
 *         float32×3  localPos
 *         float32×4  localRot
 *       int32   netViewCount
 *       per netView:
 *         int32   anchor         == getStableHash("dungeonView")
 *         string  prefabName
 *         int32   prefabHash
 *         float32×3  pos         (local to the room)
 *         float32×4  rot
 *       int32   randomSpawnCount
 *       per randomSpawn:
 *         float32 chanceToSpawn
 *         int32   dungeonRequireTheme
 *         uint16  requireBiome
 *         bool    notInLava
 *         float32 minElevation, maxElevation
 *         int32   childViewCount, then uint16 × count (netView indices)
 *
 * Usage: npx tsx tools/prefab-parser/parse-dungeons.ts [path-to-dungeons.pkg]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PKG = resolve(__dirname, '../../../valheim.community/data/dungeons.pkg');
const OUTPUT_DIR = resolve(__dirname, '../../shared/src');

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface ParsedDoorDef {
  prefabName: string;
  prefabHash: number;
  connectionType: string;
  chance: number;
}

interface ParsedConnection {
  type: string;
  entrance: boolean;
  allowDoor: boolean;
  doorOnlyIfOtherAlsoAllowsDoor: boolean;
  localPos: Vec3;
  localRot: Quat;
}

interface ParsedNetView {
  prefabName: string;
  prefabHash: number;
  pos: Vec3;
  rot: Quat;
}

interface ParsedRandomSpawn {
  chanceToSpawn: number;
  dungeonRequireTheme: number;
  requireBiome: number;
  notInLava: boolean;
  minElevation: number;
  maxElevation: number;
  childViews: number[];
}

interface ParsedRoom {
  name: string;
  hash: number;
  divider: boolean;
  endCap: boolean;
  endCapPrio: number;
  entrance: boolean;
  faceCenter: boolean;
  minPlaceOrder: number;
  perimeter: boolean;
  size: Vec3;
  theme: number;
  weight: number;
  pos: Vec3;
  rot: Quat;
  connections: ParsedConnection[];
  netViews: ParsedNetView[];
  randomSpawns: ParsedRandomSpawn[];
}

interface ParsedDungeon {
  name: string;
  hash: number;
  interiorPosition: Vec3 | null;
  originalPosition: Vec3 | null;
  algorithm: number;
  alternativeFunctionality: boolean;
  campRadiusMax: number;
  campRadiusMin: number;
  doorChance: number;
  doorTypes: ParsedDoorDef[];
  gridSize: number;
  maxRooms: number;
  maxTilt: number;
  minAltitude: number;
  minRequiredRooms: number;
  minRooms: number;
  perimeterBuffer: number;
  perimeterSections: number;
  requiredRooms: string[];
  spawnChance: number;
  themes: number;
  tileWidth: number;
  rooms: ParsedRoom[];
}

/** Valheim's stable string hash (copy of shared/src/hash.ts, kept standalone). */
function getStableHash(name: string): number {
  let num = 5381 >>> 0;
  let num2 = 5381 >>> 0;
  let idx = 0;
  const len = name.length;
  while (idx !== len) {
    num = (Math.imul(num, 33) ^ name.charCodeAt(idx)) >>> 0;
    if (idx + 1 !== len) {
      num2 = (Math.imul(num2, 33) ^ name.charCodeAt(idx + 1)) >>> 0;
      idx += 2;
    } else {
      break;
    }
  }
  const sum = (num + (Math.imul(num2, 1566083941) >>> 0)) >>> 0;
  return sum | 0;
}

const ANCHOR_DUNGEON = getStableHash('dungeon');
const ANCHOR_DOOR = getStableHash('dungeonDoor');
const ANCHOR_ROOM = getStableHash('dungeonRoom');
const ANCHOR_VIEW = getStableHash('dungeonView');

function main(): void {
  const pkgPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PKG;

  console.log('Valheim dungeons.pkg parser');
  console.log(`  source: ${pkgPath}`);

  if (!existsSync(pkgPath)) {
    console.error(`[ERROR] dungeons.pkg not found: ${pkgPath}`);
    process.exit(1);
  }

  const data = readFileSync(pkgPath);
  console.log(`  size:   ${(data.length / 1024).toFixed(1)} KB`);

  const reader = new BinReader(data);

  const comment = reader.readString();
  const version = reader.readString();
  const count = reader.readInt32();

  console.log(`  comment: ${comment}`);
  console.log(`  version: ${version}`);
  console.log(`  count:   ${count}`);

  const dungeons: ParsedDungeon[] = [];
  for (let i = 0; i < count; i++) {
    reader.expectAnchor(ANCHOR_DUNGEON, 'dungeon');
    const name = reader.readString();

    let interiorPosition: Vec3 | null = null;
    let originalPosition: Vec3 | null = null;
    if (reader.readBool()) {
      interiorPosition = reader.readVec3();
      reader.readQuat(); // interior rotation — parsed, unused (like C++)
      originalPosition = reader.readVec3();
    }

    const dungeon: ParsedDungeon = {
      name,
      hash: getStableHash(name),
      interiorPosition,
      originalPosition,
      algorithm: reader.readInt32(),
      alternativeFunctionality: reader.readBool(),
      campRadiusMax: reader.readFloat(),
      campRadiusMin: reader.readFloat(),
      doorChance: reader.readFloat(),
      doorTypes: [],
      gridSize: 0,
      maxRooms: 0,
      maxTilt: 0,
      minAltitude: 0,
      minRequiredRooms: 0,
      minRooms: 0,
      perimeterBuffer: 0,
      perimeterSections: 0,
      requiredRooms: [],
      spawnChance: 0,
      themes: 0,
      tileWidth: 0,
      rooms: [],
    };

    const doorCount = reader.readInt32();
    for (let d = 0; d < doorCount; d++) {
      reader.expectAnchor(ANCHOR_DOOR, 'dungeonDoor');
      dungeon.doorTypes.push({
        prefabName: reader.readString(),
        prefabHash: reader.readInt32(),
        connectionType: reader.readString(),
        chance: reader.readFloat(),
      });
    }

    dungeon.gridSize = reader.readInt32();
    dungeon.maxRooms = reader.readInt32();
    dungeon.maxTilt = reader.readFloat();
    dungeon.minAltitude = reader.readFloat();
    dungeon.minRequiredRooms = reader.readInt32();
    dungeon.minRooms = reader.readInt32();
    dungeon.perimeterBuffer = reader.readFloat();
    dungeon.perimeterSections = reader.readInt32();

    const requiredCount = reader.readInt32();
    for (let r = 0; r < requiredCount; r++) {
      dungeon.requiredRooms.push(reader.readString());
    }

    dungeon.spawnChance = reader.readFloat();
    dungeon.themes = reader.readInt32();
    dungeon.tileWidth = reader.readFloat();

    const roomCount = reader.readInt32();
    for (let r = 0; r < roomCount; r++) {
      reader.expectAnchor(ANCHOR_ROOM, 'dungeonRoom');
      const room: ParsedRoom = {
        name: reader.readString(),
        hash: 0,
        divider: reader.readBool(),
        endCap: reader.readBool(),
        endCapPrio: reader.readInt32(),
        entrance: reader.readBool(),
        faceCenter: reader.readBool(),
        minPlaceOrder: reader.readInt32(),
        perimeter: reader.readBool(),
        size: reader.readVec3(),
        theme: reader.readInt32(),
        weight: reader.readFloat(),
        pos: reader.readVec3(),
        rot: reader.readQuat(),
        connections: [],
        netViews: [],
        randomSpawns: [],
      };
      room.hash = getStableHash(room.name);

      const connCount = reader.readInt32();
      for (let c = 0; c < connCount; c++) {
        room.connections.push({
          type: reader.readString(),
          entrance: reader.readBool(),
          allowDoor: reader.readBool(),
          doorOnlyIfOtherAlsoAllowsDoor: reader.readBool(),
          localPos: reader.readVec3(),
          localRot: reader.readQuat(),
        });
      }

      const viewCount = reader.readInt32();
      for (let v = 0; v < viewCount; v++) {
        reader.expectAnchor(ANCHOR_VIEW, 'dungeonView');
        room.netViews.push({
          prefabName: reader.readString(),
          prefabHash: reader.readInt32(),
          pos: reader.readVec3(),
          rot: reader.readQuat(),
        });
      }

      const spawnCount = reader.readInt32();
      for (let s = 0; s < spawnCount; s++) {
        // ±Infinity is common for the elevation bounds; JSON.stringify would
        // turn it into null, so clamp to finite sentinels.
        const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
        const spawn: ParsedRandomSpawn = {
          chanceToSpawn: reader.readFloat(),
          dungeonRequireTheme: reader.readInt32(),
          requireBiome: reader.readUInt16(),
          notInLava: reader.readBool(),
          minElevation: finite(reader.readFloat(), -1e9),
          maxElevation: finite(reader.readFloat(), 1e9),
          childViews: [],
        };
        const childCount = reader.readInt32();
        for (let cv = 0; cv < childCount; cv++) {
          spawn.childViews.push(reader.readUInt16());
        }
        room.randomSpawns.push(spawn);
      }

      dungeon.rooms.push(room);
    }

    dungeons.push(dungeon);
  }

  if (reader.pos !== data.length) {
    console.warn(`[WARN] ${data.length - reader.pos} trailing bytes after ${count} entries`);
  }

  const outPath = join(OUTPUT_DIR, 'dungeonsData.json');
  writeFileSync(outPath, JSON.stringify({ comment, version, dungeons }, null, 1));
  console.log(`  wrote ${dungeons.length} dungeons -> ${outPath}`);

  for (const d of dungeons) {
    const entrances = d.rooms.filter((r) => r.entrance).length;
    const endCaps = d.rooms.filter((r) => r.endCap).length;
    const views = d.rooms.reduce((n, r) => n + r.netViews.length, 0);
    console.log(
      `  ${d.name}: algo=${d.algorithm} rooms=${d.rooms.length} ` +
        `(entrance=${entrances}, endCap=${endCaps}) doors=${d.doorTypes.length} ` +
        `netViews=${views} themes=0x${d.themes.toString(16)}`
    );
  }
}

/** Little-endian binary reader matching Valhalla's DataReader. */
class BinReader {
  pos = 0;
  constructor(private buf: Buffer) {}

  /** .NET BinaryWriter string: 7-bit varint length prefix + UTF-8 bytes. */
  readString(): string {
    let len = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    const s = this.buf.toString('utf-8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  readInt32(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readFloat(): number {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readUInt16(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readBool(): boolean {
    return this.buf[this.pos++] !== 0;
  }

  readVec3(): Vec3 {
    return { x: this.readFloat(), y: this.readFloat(), z: this.readFloat() };
  }

  readQuat(): Quat {
    return { x: this.readFloat(), y: this.readFloat(), z: this.readFloat(), w: this.readFloat() };
  }

  /** Debug anchors written by the exporter mod — hard format validation. */
  expectAnchor(expected: number, label: string): void {
    const v = this.readInt32();
    if (v !== expected) {
      throw new Error(
        `Format error at offset ${this.pos - 4}: expected ${label} anchor ` +
          `${expected}, got ${v}`
      );
    }
  }
}

main();
