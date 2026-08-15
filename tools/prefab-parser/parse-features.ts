/**
 * Features Parser — reads features.pkg from the Valhalla C++ dedicated
 * server (valheim.community) and exports all zone locations (features) as
 * JSON for the browser game (used by the server's location placement, Phase F).
 *
 * Binary format (valheim.community/library/src/ZoneManager.cpp:48-157):
 *
 *   header:
 *     string  comment            (.NET BinaryWriter: 7-bit varint length + UTF-8)
 *     string  gameVersion        (e.g. "0.221.6")
 *     int32   featureCount       (little-endian)
 *   per feature entry (in read order):
 *     string  name
 *     int32   biome              (Biome bitmask)
 *     int32   biomeArea          (BiomeArea bitmask)
 *     bool    applyRandomDamage, centerFirst, clearArea
 *     float32 exteriorRadius, interiorRadius, forestTresholdMin, forestTresholdMax
 *     string  group
 *     bool    iconAlways, iconPlaced, inForest
 *     float32 minAltitude, maxAltitude, minDistance, maxDistance,
 *             minTerrainDelta, maxTerrainDelta, minDistanceFromSimilar
 *     int32   spawnAttempts, quantity
 *     bool    randomRotation, slopeRotation, snapToWater, unique
 *     int32   pieceCount
 *     per piece:
 *       string  pieceName
 *     int32   prefabHash       (stable hash)
 *       float32 pos.x, pos.y, pos.z
 *       float32 rot.x, rot.y, rot.z, rot.w
 *     int32   randomSpawnCount
 *     per randomSpawn:
 *       float32 chanceToSpawn
 *       int32   unknown (outdoor/indoor flag?)
 *       uint8   flags1, flags2, flags3   (flags1 bit0 = notInLava)
 *       int32   minElevation, maxElevation
 *       int32   prefabIndexCount
 *       uint16  prefabIndex × count       → applies to those pieces
 *
 * C++ merges each RandomSpawn into the referenced pieces
 * (ZoneManager.cpp:137-152); we do the same and store it on the piece.
 *
 * Usage: npm run parse --workspace=tools/prefab-parser -- [path-to-features.pkg]
 *        (or: npx tsx tools/prefab-parser/parse-features.ts [path])
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PKG = resolve(__dirname, '../../../valheim.community/data/features.pkg');
const OUTPUT_DIR = resolve(__dirname, '../../shared/src');

interface ParsedRandomSpawn {
  chanceToSpawn: number;
  notInLava: boolean;
  minElevation: number;
  maxElevation: number;
}

interface ParsedPiece {
  pieceName: string;
  prefabHash: number;
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number; w: number };
  randomSpawn: ParsedRandomSpawn | null;
}

interface ParsedFeature {
  name: string;
  biome: number;
  biomeArea: number;
  applyRandomDamage: boolean;
  centerFirst: boolean;
  clearArea: boolean;
  exteriorRadius: number;
  interiorRadius: number;
  forestTresholdMin: number;
  forestTresholdMax: number;
  group: string;
  iconAlways: boolean;
  iconPlaced: boolean;
  inForest: boolean;
  minAltitude: number;
  maxAltitude: number;
  minDistance: number;
  maxDistance: number;
  minTerrainDelta: number;
  maxTerrainDelta: number;
  minDistanceFromSimilar: number;
  spawnAttempts: number;
  quantity: number;
  randomRotation: boolean;
  slopeRotation: boolean;
  snapToWater: boolean;
  unique: boolean;
  pieces: ParsedPiece[];
}

function main(): void {
  const pkgPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PKG;

  console.log('Valheim features.pkg parser');
  console.log(`  source: ${pkgPath}`);

  if (!existsSync(pkgPath)) {
    console.error(`[ERROR] features.pkg not found: ${pkgPath}`);
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

  const features: ParsedFeature[] = [];
  for (let i = 0; i < count; i++) {
    const feature: ParsedFeature = {
      name: reader.readString(),
      biome: reader.readInt32(),
      biomeArea: reader.readInt32(),
      applyRandomDamage: reader.readBool(),
      centerFirst: reader.readBool(),
      clearArea: reader.readBool(),
      exteriorRadius: reader.readFloat(),
      interiorRadius: reader.readFloat(),
      forestTresholdMin: reader.readFloat(),
      forestTresholdMax: reader.readFloat(),
      group: reader.readString(),
      iconAlways: reader.readBool(),
      iconPlaced: reader.readBool(),
      inForest: reader.readBool(),
      minAltitude: reader.readFloat(),
      maxAltitude: reader.readFloat(),
      minDistance: reader.readFloat(),
      maxDistance: reader.readFloat(),
      minTerrainDelta: reader.readFloat(),
      maxTerrainDelta: reader.readFloat(),
      minDistanceFromSimilar: reader.readFloat(),
      spawnAttempts: reader.readInt32(),
      quantity: reader.readInt32(),
      randomRotation: reader.readBool(),
      slopeRotation: reader.readBool(),
      snapToWater: reader.readBool(),
      unique: reader.readBool(),
      pieces: [],
    };

    const pieceCount = reader.readInt32();
    for (let j = 0; j < pieceCount; j++) {
      feature.pieces.push({
        pieceName: reader.readString(),
        prefabHash: reader.readInt32(),
        pos: { x: reader.readFloat(), y: reader.readFloat(), z: reader.readFloat() },
        rot: {
          x: reader.readFloat(),
          y: reader.readFloat(),
          z: reader.readFloat(),
          w: reader.readFloat(),
        },
        randomSpawn: null,
      });
    }

    // RandomSpawns — merged into the referenced pieces (C++ ZoneManager.cpp:118-153)
    const spawnCount = reader.readInt32();
    for (let s = 0; s < spawnCount; s++) {
      const chanceToSpawn = reader.readFloat();
      reader.readInt32(); // unknown (outdoor/indoor flag?) — parsed, unused (like C++)
      const flags1 = reader.readUInt8();
      reader.readUInt8(); // flags2
      reader.readUInt8(); // flags3
      const notInLava = (flags1 & 0x01) !== 0;
      const minElevation = reader.readInt32();
      const maxElevation = reader.readInt32();

      const prefabIndexCount = reader.readInt32();
      for (let p = 0; p < prefabIndexCount; p++) {
        const prefabIndex = reader.readUInt16();
        if (prefabIndex < feature.pieces.length) {
          feature.pieces[prefabIndex].randomSpawn = {
            chanceToSpawn,
            notInLava,
            minElevation,
            maxElevation,
          };
        } else {
          console.warn(
            `[WARN] RandomSpawn prefabIndex ${prefabIndex} out of range for ` +
              `'${feature.name}' (${feature.pieces.length} pieces)`
          );
        }
      }
    }

    features.push(feature);
  }

  if (reader.pos !== data.length) {
    console.warn(`[WARN] ${data.length - reader.pos} trailing bytes after ${count} entries`);
  }

  // ZWEI DATEIEN statt einer (Bundle-Schnitt): Die Pieces sind ~8,5 MB und
  // werden ausschliesslich serverseitig gebraucht (Platzierung, Camp-
  // Backfill, Dungeon-Erkennung). Blieben sie im Feature-Kopf, zoege der
  // Barrel-Export von shared sie in jedes Browser-Bundle — sie allein
  // machten 6 MB des ausgelieferten JavaScript aus, wegen des eigenen
  // Rollup-Einstiegs des Karten-Workers sogar doppelt.
  //
  // Der Kopf traegt statt der Pieces nur `pieceRadius`: den groessten
  // horizontalen Abstand eines Pieces vom Ursprung. Das ist die einzige
  // Piece-Information, die ausserhalb des Servers gebraucht wird
  // (getTerrainLeveling begrenzt das Einebnen darauf).
  const featurePieces: Record<string, ParsedPiece[]> = {};
  const featureHeads = features.map((f) => {
    featurePieces[f.name] = f.pieces;
    let pieceRadius = 0;
    for (const p of f.pieces) {
      const d = Math.hypot(p.pos.x, p.pos.z);
      if (d > pieceRadius) pieceRadius = d;
    }
    const { pieces: _pieces, ...head } = f;
    return { ...head, pieceRadius };
  });

  const outPath = join(OUTPUT_DIR, 'featuresData.json');
  writeFileSync(outPath, JSON.stringify({ comment, version, features: featureHeads }, null, 1));
  console.log(`  wrote ${features.length} feature heads -> ${outPath}`);

  const piecesPath = join(OUTPUT_DIR, 'featurePiecesData.json');
  writeFileSync(piecesPath, JSON.stringify({ comment, version, pieces: featurePieces }, null, 1));
  console.log(`  wrote pieces of ${features.length} features -> ${piecesPath}`);

  // Quick sanity stats
  const totalPieces = features.reduce((n, f) => n + f.pieces.length, 0);
  const withSpawns = features.reduce(
    (n, f) => n + f.pieces.filter((p) => p.randomSpawn !== null).length,
    0
  );
  console.log(`  stats: ${totalPieces} pieces total, ${withSpawns} with randomSpawn`);
  const startTemple = features.find((f) => f.name === 'StartTemple');
  if (startTemple) {
    console.log(
      `  StartTemple: biome=${startTemple.biome} pieces=${startTemple.pieces.length} ` +
        `centerFirst=${startTemple.centerFirst} clearArea=${startTemple.clearArea} ` +
        `exteriorRadius=${startTemple.exteriorRadius}`
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

  readUInt8(): number {
    return this.buf[this.pos++];
  }

  readUInt16(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  /** C++ DataReader read<bool> — 1 byte. */
  readBool(): boolean {
    return this.buf[this.pos++] !== 0;
  }
}

main();
