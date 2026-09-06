import { describe, expect, it } from 'vitest';
import { TerrainDefinitionSchema } from './terrain.js';

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
});
