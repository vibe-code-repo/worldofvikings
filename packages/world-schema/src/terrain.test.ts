import { describe, expect, it } from 'vitest';
import { TerrainDefinitionSchema, terrainAssetPaths } from './terrain.js';

const heightField = 'terrain/village-257.glb';
const splatA = 'textures/village-splat-a.png';
const splatB = 'textures/village-splat-b.png';

function layers(count: number): { texture: string; tileSize: number }[] {
  return Array.from({ length: count }, (_, index) => ({
    texture: `textures/layer-${String(index)}.png`,
    tileSize: 2,
  }));
}

describe('TerrainDefinitionSchema', () => {
  it('accepts a height field with no layers at all — a plain coloured tile', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
    });
    expect(result.success).toBe(true);
  });

  it('accepts one splat map with four layers', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [-150, 0, -150],
      size: [300, 300],
      layers: layers(4),
      splat: [splatA],
    });
    expect(result.success).toBe(true);
  });

  it('accepts two splat maps with eight layers', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: layers(8),
      splat: [splatA, splatB],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a ninth layer: two RGBA maps carry eight weights and no more', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: layers(9),
      splat: [splatA, splatB],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a fifth layer when only one splat map is given', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: layers(5),
      splat: [splatA],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a second layer with no splat map to weight it', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: layers(2),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a splat map with no layer to blend', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      splat: [splatA],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tile with no extent', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [0, 300],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tile size of zero metres, which would divide by zero', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ texture: 'textures/grass.png', tileSize: 0 }],
      splat: [splatA],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an absolute height field path', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField: '/terrain/village-257.glb',
      position: [0, 0, 0],
      size: [300, 300],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields instead of dropping them', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      lod: 3,
    });
    expect(result.success).toBe(false);
  });

  it('accepts the surface fields a layer may carry', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: [
        {
          texture: 'textures/terrain-rock-a.png',
          tileSize: 2,
          normalMap: 'textures/terrain-rock-a-normal.png',
          normalScale: 1.5,
          metallic: 0.85,
          smoothness: 0.1,
        },
      ],
      splat: [splatA],
      flatNormals: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a normal strength with no normal map to scale', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ texture: 'textures/grass.png', tileSize: 2, normalScale: 2 }],
      splat: [splatA],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a metallic value outside 0…1', () => {
    const result = TerrainDefinitionSchema.safeParse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ texture: 'textures/grass.png', tileSize: 2, metallic: 1.4 }],
      splat: [splatA],
    });
    expect(result.success).toBe(false);
  });
});

describe('terrainAssetPaths', () => {
  it('names every normal map, so validate:content sees them too', () => {
    const terrain = TerrainDefinitionSchema.parse({
      heightField,
      position: [0, 0, 0],
      size: [300, 300],
      layers: [
        { texture: 'textures/a.png', tileSize: 2, normalMap: 'textures/a-normal.png' },
        { texture: 'textures/b.png', tileSize: 2 },
      ],
      splat: [splatA, splatB],
    });
    expect(terrainAssetPaths(terrain)).toEqual([
      heightField,
      splatA,
      splatB,
      'textures/a.png',
      'textures/b.png',
      'textures/a-normal.png',
    ]);
  });
});
