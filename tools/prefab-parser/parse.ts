/**
 * Prefab Parser — reads prefabs.pkg from the Valhalla C++ dedicated server
 * (valheim.community) and exports all prefab definitions as JSON for the
 * browser game (shared registry used by server and client).
 *
 * Binary format (verified against valheim.community/library/src/PrefabManager.cpp
 * and a hex dump of the file):
 *
 *   header:
 *     string  comment            (.NET BinaryWriter: 7-bit varint length + UTF-8)
 *     string  gameVersion        (e.g. "0.221.6")
 *     int32   prefabCount        (little-endian)
 *   per prefab (PrefabManager::Register(DataReader&)):
 *     string  name
 *     int32   oldHash            (hash stored in pkg; re-computed at runtime)
 *     float32 localScale.x
 *     float32 localScale.y
 *     float32 localScale.z
 *     uint64  flags              (Prefab::Flag bitfield, see Prefab.h)
 *
 * Usage: npm run parse --workspace=tools/prefab-parser -- [path-to-prefabs.pkg]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default: the C++ server data directory next to the valheim-browser project
const DEFAULT_PKG = resolve(__dirname, '../../../valheim.community/data/prefabs.pkg');
const OUTPUT_DIR = resolve(__dirname, '../../shared/src');

interface ParsedPrefab {
  name: string;
  /** Hash stored in the pkg (may differ from getStableHash(name) on old data). */
  oldHash: number;
  localScale: { x: number; y: number; z: number };
  /** Prefab::Flag bitfield as decimal string (uint64). */
  flags: string;
}

function main(): void {
  const pkgPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PKG;

  console.log('Valheim prefabs.pkg parser');
  console.log(`  source: ${pkgPath}`);

  if (!existsSync(pkgPath)) {
    console.error(`[ERROR] prefabs.pkg not found: ${pkgPath}`);
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

  const prefabs: ParsedPrefab[] = [];
  for (let i = 0; i < count; i++) {
    const name = reader.readString();
    const oldHash = reader.readInt32();
    const localScale = {
      x: reader.readFloat(),
      y: reader.readFloat(),
      z: reader.readFloat(),
    };
    const flags = reader.readUInt64();

    if (!name) {
      console.error(`[WARN] empty prefab name at entry ${i} (pos=${reader.pos})`);
    }

    prefabs.push({ name, oldHash, localScale, flags: flags.toString() });
  }

  if (reader.pos !== data.length) {
    console.warn(`[WARN] ${data.length - reader.pos} trailing bytes after ${count} prefabs`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, 'prefabData.json');
  writeFileSync(
    outPath,
    JSON.stringify({ comment, version, prefabs }, null, 1)
  );
  console.log(`  wrote ${prefabs.length} prefabs -> ${outPath}`);
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

  readUInt64(): bigint {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
}

main();
