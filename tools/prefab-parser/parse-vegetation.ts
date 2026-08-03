/**
 * Vegetation Parser — reads vegetation.pkg from the Valhalla C++ dedicated
 * server (valheim.community) and exports all foliage entries as JSON for the
 * browser game (used by the server's PopulateFoliage port, Phase E).
 *
 * Binary format (valheim.community/library/src/ZoneManager.cpp:166-227):
 *
 *   header:
 *     string  comment            (.NET BinaryWriter: 7-bit varint length + UTF-8)
 *     string  gameVersion        (e.g. "0.221.6")
 *     int32   foliageCount       (little-endian)
 *   per foliage entry (in read order):
 *     string  prefabName
 *     int32   biome              (Biome bitmask)
 *     int32   biomeArea          (BiomeArea bitmask)
 *     float32 radius, min, max, minTilt, maxTilt, groupRadius
 *     bool    forcePlacement
 *     int32   groupSizeMin, groupSizeMax
 *     float32 scaleMin, scaleMax, randTilt
 *     bool    blockCheck
 *     float32 minAltitude, maxAltitude, minOceanDepth, maxOceanDepth,
 *             terrainDeltaRadius, minTerrainDelta, maxTerrainDelta
 *     bool    inForest
 *     float32 forestTresholdMin, forestTresholdMax
 *     bool    snapToWater, snapToStaticSolid
 *     float32 groundOffset, chanceToUseGroundTilt, minVegetation, maxVegetation
 *
 * Usage: npm run parse --workspace=tools/prefab-parser -- [path-to-vegetation.pkg]
 *        (or: npx tsx tools/prefab-parser/parse-vegetation.ts [path])
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PKG = resolve(__dirname, '../../../valheim.community/data/vegetation.pkg');
const OUTPUT_DIR = resolve(__dirname, '../../shared/src');

interface ParsedFoliage {
  prefabName: string;
  biome: number;
  biomeArea: number;
  radius: number;
  min: number;
  max: number;
  minTilt: number;
  maxTilt: number;
  groupRadius: number;
  forcePlacement: boolean;
  groupSizeMin: number;
  groupSizeMax: number;
  scaleMin: number;
  scaleMax: number;
  randTilt: number;
  blockCheck: boolean;
  minAltitude: number;
  maxAltitude: number;
  minOceanDepth: number;
  maxOceanDepth: number;
  terrainDeltaRadius: number;
  minTerrainDelta: number;
  maxTerrainDelta: number;
  inForest: boolean;
  forestTresholdMin: number;
  forestTresholdMax: number;
  snapToWater: boolean;
  snapToStaticSolid: boolean;
  groundOffset: number;
  chanceToUseGroundTilt: number;
  minVegetation: number;
  maxVegetation: number;
}

function main(): void {
  const pkgPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PKG;

  console.log('Valheim vegetation.pkg parser');
  console.log(`  source: ${pkgPath}`);

  if (!existsSync(pkgPath)) {
    console.error(`[ERROR] vegetation.pkg not found: ${pkgPath}`);
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

  const foliage: ParsedFoliage[] = [];
  for (let i = 0; i < count; i++) {
    foliage.push({
      prefabName: reader.readString(),
      biome: reader.readInt32(),
      biomeArea: reader.readInt32(),
      radius: reader.readFloat(),
      min: reader.readFloat(),
      max: reader.readFloat(),
      minTilt: reader.readFloat(),
      maxTilt: reader.readFloat(),
      groupRadius: reader.readFloat(),
      forcePlacement: reader.readBool(),
      groupSizeMin: reader.readInt32(),
      groupSizeMax: reader.readInt32(),
      scaleMin: reader.readFloat(),
      scaleMax: reader.readFloat(),
      randTilt: reader.readFloat(),
      blockCheck: reader.readBool(),
      minAltitude: reader.readFloat(),
      maxAltitude: reader.readFloat(),
      minOceanDepth: reader.readFloat(),
      maxOceanDepth: reader.readFloat(),
      terrainDeltaRadius: reader.readFloat(),
      minTerrainDelta: reader.readFloat(),
      maxTerrainDelta: reader.readFloat(),
      inForest: reader.readBool(),
      forestTresholdMin: reader.readFloat(),
      forestTresholdMax: reader.readFloat(),
      snapToWater: reader.readBool(),
      snapToStaticSolid: reader.readBool(),
      groundOffset: reader.readFloat(),
      chanceToUseGroundTilt: reader.readFloat(),
      minVegetation: reader.readFloat(),
      maxVegetation: reader.readFloat(),
    });
  }

  if (reader.pos !== data.length) {
    console.warn(`[WARN] ${data.length - reader.pos} trailing bytes after ${count} entries`);
  }

  const outPath = join(OUTPUT_DIR, 'vegetationData.json');
  writeFileSync(outPath, JSON.stringify({ comment, version, foliage }, null, 1));
  console.log(`  wrote ${foliage.length} foliage entries -> ${outPath}`);
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

  /** C++ DataReader read<bool> — 1 byte. */
  readBool(): boolean {
    return this.buf[this.pos++] !== 0;
  }
}

main();
