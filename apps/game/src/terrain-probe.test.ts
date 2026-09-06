import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  VILLAGE_SPAWN,
  VILLAGE_TERRAIN,
  permuteLayers,
  spawnFromQuery,
  type TerrainProbeLayer,
} from './terrain-probe.js';

const layers: TerrainProbeLayer[] = [
  { asset: 'a.png', tileSize: 1 },
  { asset: 'b.png', tileSize: 2 },
  { asset: 'c.png', tileSize: 3 },
];

describe('permuteLayers', () => {
  it('reorders by index', () => {
    expect(permuteLayers(layers, '2,0,1').map((layer) => layer.asset)).toEqual([
      'c.png',
      'a.png',
      'b.png',
    ]);
  });

  it('keeps the table order for anything malformed', () => {
    for (const order of ['', '0,1', '0,1,9', '0,1,1', 'x,y,z', '0, 1, 2, 3']) {
      const result = permuteLayers(layers, order);
      if (order === '0, 1, 2, 3') {
        expect(result).toBe(layers);
        continue;
      }
      expect(result.map((layer) => layer.asset)).toEqual(['a.png', 'b.png', 'c.png']);
    }
  });

  it('accepts spaces around the indices', () => {
    expect(permuteLayers(layers, ' 1 , 0 , 2 ').map((layer) => layer.asset)).toEqual([
      'b.png',
      'a.png',
      'c.png',
    ]);
  });
});

describe('spawnFromQuery', () => {
  it('reads a point on the tile', () => {
    expect(spawnFromQuery('162,87', [300, 300])).toEqual([162, 87]);
  });

  it('falls back to the middle rather than dropping the player off the tile', () => {
    for (const value of [null, '', '1', '1,2,3', 'a,b', '-1,10', '10,301']) {
      expect(spawnFromQuery(value, [300, 300])).toEqual(VILLAGE_SPAWN);
    }
  });
});

/**
 * The probe and the world fixture describe the same tile.
 *
 * The game cannot read a world file yet, so the numbers live twice: once as the
 * probe's fixture and once as `tooling/fixtures/worlds/village-terrain.json`,
 * which is validated against the real schema. Two copies drift; this is what
 * notices when they do, and it is the assertion that goes away in Phase 4
 * together with the probe.
 */
describe('the probe and the world fixture agree', () => {
  it('names the same height field, size, layer order and splat maps', async () => {
    const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
    const file = join(repoRoot, 'tooling', 'fixtures', 'worlds', 'village-terrain.json');
    const fixture = JSON.parse(await readFile(file, 'utf8')) as {
      zones: {
        terrain: {
          heightField: string;
          position: number[];
          size: number[];
          layers: { texture: string; tileSize: number }[];
          splat: string[];
        };
      }[];
    };
    const terrain = fixture.zones[0]?.terrain;
    expect(terrain).toBeDefined();
    expect(terrain?.heightField).toBe(VILLAGE_TERRAIN.heightField);
    expect(terrain?.position).toEqual([...VILLAGE_TERRAIN.position]);
    expect(terrain?.size).toEqual([...VILLAGE_TERRAIN.size]);
    expect(terrain?.splat).toEqual([...VILLAGE_TERRAIN.splat]);
    expect(terrain?.layers).toEqual(
      VILLAGE_TERRAIN.layers.map((layer) => ({ texture: layer.asset, tileSize: layer.tileSize })),
    );
  });
});
