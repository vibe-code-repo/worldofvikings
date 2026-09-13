/**
 * Offline DEV migration: regenerate natural foliage in one region.
 * Always writes a NEW file; never opens a listener or overwrites the input.
 * Stop the server and back up the latest save before installing the output.
 * Usage: npx tsx tools/refresh-village-save.ts INPUT OUTPUT [REGION=insel-1]
 *
 * Only supported for the current v3 layout world with locations disabled.
 * Player records, buildings, other regions, terrain edits and progression
 * remain byte-for-byte equal as JSON values. Harvested foliage in the
 * selected region is intentionally reseeded along with the new biome.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { strict as assert } from 'node:assert';
import {
  RegionGeo, HeightmapProvider, getStableHash, sanitizeWorldLayout,
  PREFABS_BY_NAME, PrefabFlag, LAYOUT_ID_MEMBER,
} from '../shared/src/index.js';
import { FOLIAGE_HASHES } from '../shared/src/vegetation.js';
import { streueZone } from '../shared/src/worldgen/streuung.js';
import { terrainCompAusBase64 } from '../shared/src/worldgen/terrainCompCodec.js';
import { leseServerKonfig } from '../server/src/ServerKonfig.js';
import { createWovServer } from '../server/src/WovServer.js';
import { ZDOManager } from '../server/src/zdo/ZDOManager.js';
import type { WorldSaveData } from '../server/src/world/WorldManager.js';

const [input, output, region = 'insel-1'] = process.argv.slice(2);
assert(input && output, 'Provide separate input and output save paths');
assert(resolve(input) !== resolve(output) && !existsSync(output), 'Output must be a new file');
// Resolve the exact runtime defaults without init/start or saving anything.
const config = createWovServer({ ...leseServerKonfig(resolve('server/data'), 'dev'),
  standardKonten: [], kontenDir: resolve(output + '.accounts'),
  worldsDir: resolve(output + '.worlds') }).config;
assert(config.worldMode === 'layout' && !config.worldFeatures, 'Requires layout mode without locations');
console.log('Configuration resolved');
const data: WorldSaveData = JSON.parse(zstdDecompressSync(readFileSync(input)).toString());
assert(data.meta.worldName === 'dev', 'Only the DEV save may be migrated');
assert(data.version === 3 && !data.terrainOps?.length, 'Requires migrated v3 terrain');
assert(data.meta.worldSeed === config.worldSeed && data.meta.worldGenVersion === config.worldGenVersion);
const layout = sanitizeWorldLayout(JSON.parse(readFileSync(config.worldLayoutPath!, 'utf8')));
assert(layout && layout.regions.some(r => r.id === region), 'Region must exist');
console.log('Save and layout validated');
const geo = new RegionGeo(getStableHash(layout.detailSeed ?? config.worldSeed), {
  worldGenVersion: config.worldGenVersion,
  disableDistantRivers: config.worldDisableDistantRivers,
  riverAffectsOcean: config.worldRiverAffectsOcean,
  ashlandsModernNoise: config.worldAshlandsModernNoise,
}, layout);
const heightmaps = new HeightmapProvider(geo, {
  blendSmoothStep: config.worldBlendSmoothStep,
  bilinearSampling: config.worldBilinearHeight,
});
for (const text of data.terrainComps ?? []) heightmaps.restoreTerrainComp(terrainCompAusBase64(text));
const belongs = (pos: { x: number; z: number }) => geo.regionAt(pos.x, pos.z)?.id === region;
const protectedObject = (z: Record<string, unknown>) => z.owner != null ||
  Boolean((z.members as Record<string, unknown> | undefined)?.[getStableHash(LAYOUT_ID_MEMBER)]);
const natural = (z: Record<string, unknown>) => !protectedObject(z) && FOLIAGE_HASHES.has(z.prefab as number) &&
  belongs(z.pos as { x: number; z: number });
console.log('Terrain initialized');
const retained = data.zdos.filter(z => !natural(z));
console.log('Retained objects:', retained.length);
const ids = new ZDOManager(1n);
ids.restoreFromSnapshots(data.zdos);
const added: Record<string, unknown>[] = [];
// Keep a modest clearing around existing non-foliage objects (buildings,
// props, NPCs). Their positions and every saved property remain untouched.
const clearAreas = retained.filter(z => !FOLIAGE_HASHES.has(z.prefab as number) || protectedObject(z)).map(z => ({
  center: z.pos as { x: number; y: number; z: number }, radius: 5,
}));
let visited = 0;
for (const [x, y] of data.zones) {
  // Include border zones; filter each candidate using the exact region field.
  const corners = [[0, 0], [-32, -32], [-32, 32], [32, -32], [32, 32]];
  if (!corners.some(([dx, dz]) => belongs({ x: x * 64 + dx, z: y * 64 + dz }))) continue;
  visited++;
  if (visited % 10 === 0) console.log('Generated zones:', visited);
  streueZone({ seed: getStableHash(config.worldSeed), geo, heightmaps, regionGeo: geo },
    heightmaps.getZone(x, y), clearAreas, fund => {
      if (!belongs(fund.position)) return;
      const zdo = ids.createZDO(fund.prefabHash, fund.position, fund.rotation);
      const prefab = PREFABS_BY_NAME.get(fund.prefabName)!;
      const ls = prefab.localScale;
      if ((prefab.flags & PrefabFlag.SYNC_INITIAL_SCALE) !== 0n) {
        if (Math.abs(ls.x - ls.y) < 1e-8 && Math.abs(ls.y - ls.z) < 1e-8) {
          if (Math.abs(ls.x - 1) > 1e-8) zdo.setFloat('scaleScalar', ls.x);
        } else zdo.setVec3('scale', ls);
      }
      if (fund.scale !== ls.x) zdo.setFloat('scaleScalar', fund.scale);
      added.push(zdo.toSnapshot());
    });
}
console.log('Foliage generated:', added.length);
assert(added.length > 0, 'No foliage generated; refusing empty migration');
const next = { ...data, meta: { ...data.meta, layoutHash: getStableHash(JSON.stringify(layout)) },
  zdos: [...retained, ...added] };
const allIds = next.zdos.map(z => JSON.stringify(z.id));
assert(new Set(allIds).size === allIds.length, 'Duplicate ZDO identifiers');
assert(JSON.stringify(next.zdos.filter(z => !natural(z))) === JSON.stringify(retained), 'Retained ZDOs changed');
for (const key of ['players', 'terrainComps', 'globalKeys', 'zones', 'worldTime'] as const) {
  assert.deepEqual(next[key], data[key], 'Preserve ' + key);
}
const bytes = zstdCompressSync(Buffer.from(JSON.stringify(next)));
assert(zstdDecompressSync(bytes).toString() === JSON.stringify(next), 'Compressed save roundtrip failed');
writeFileSync(output, bytes, { flag: 'wx' });
console.log(JSON.stringify({ region, visitedZones: visited, removed: data.zdos.length - retained.length,
  added: added.length, retained: retained.length, output, preservedPlayers: data.players.length }));
