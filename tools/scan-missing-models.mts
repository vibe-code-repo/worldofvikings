/**
 * Static audit: for every renderable prefab in the registry, check whether
 * its GLB model file exists in valheim_browser_assets/models and whether it
 * actually contains any meshes. Reports:
 *  - MISSING: no .glb file at all (404 at runtime -> permanent placeholder)
 *  - EMPTY:   .glb exists but has 0 meshes (permanent placeholder as well)
 * Prefabs with `model: null` are intentional 3D-placeholder-only prefabs
 * and are skipped (not a bug).
 *
 * Run: npx tsx tools/scan-missing-models.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { PREFAB_DEFS, isRenderable } from '../shared/src/prefabs.js';

const MODELS_DIR = 'C:/Users/Administrator/Modding/valheim_browser_assets/models';

function meshCount(file: string): number {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) return -1; // not glTF magic
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  return (json.meshes || []).length;
}

const missing: string[] = [];
const empty: string[] = [];
let checked = 0;
const seenModels = new Set<string>();

for (const def of PREFAB_DEFS) {
  if (!isRenderable(def)) continue;
  if (!def.model) continue;
  if (seenModels.has(def.model)) continue; // many prefabs share a model name
  seenModels.add(def.model);
  checked++;
  const file = path.join(MODELS_DIR, def.model + '.glb');
  if (!fs.existsSync(file)) {
    missing.push(`${def.name} -> ${def.model}.glb`);
    continue;
  }
  try {
    const n = meshCount(file);
    if (n === 0) empty.push(`${def.name} -> ${def.model}.glb`);
  } catch (e) {
    empty.push(`${def.name} -> ${def.model}.glb (parse error: ${(e as Error).message})`);
  }
}

console.log(`checked ${checked} distinct models across ${PREFAB_DEFS.length} prefab defs`);
console.log(`\nMISSING (${missing.length}):`);
missing.forEach((m) => console.log('  ' + m));
console.log(`\nEMPTY / 0-mesh (${empty.length}):`);
empty.forEach((m) => console.log('  ' + m));
