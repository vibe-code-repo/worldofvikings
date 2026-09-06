import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, type RawImage } from './png.js';
import { writeGlb } from './glb.js';
import { buildHeightFieldGlb, type HeightGrid } from './height-field.js';
import {
  HEIGHT_FIELDS,
  TERRAIN_SURFACE_TEXTURES,
  TERRAIN_TEXTURES,
  VILLAGE_SPLAT_MAPS,
  decimateHeightField,
  fitTerrainTexture,
  heightFieldOrigin,
  terrainTextureOrigin,
  terrainTexturePath,
} from './terrain-import.js';

function grid(columns: number, rows: number, step: number): HeightGrid {
  const heights = new Float32Array(columns * rows);
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = (index % 7) * 0.5;
  }
  return { columns, rows, originX: 0, originZ: 0, stepX: step, stepZ: step, heights };
}

describe('the terrain texture table', () => {
  it('gives every texture a store name nobody has to decode', () => {
    for (const texture of TERRAIN_TEXTURES) {
      expect(texture.name).toMatch(/^[a-z0-9][a-z0-9-]*\.png$/);
    }
  });

  it('claims each store name exactly once', () => {
    const names = TERRAIN_TEXTURES.map((texture) => texture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('takes each source file exactly once', () => {
    const files = TERRAIN_TEXTURES.map((texture) => texture.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('has at most eight surface layers, because two RGBA maps carry eight', () => {
    expect(TERRAIN_SURFACE_TEXTURES.length).toBeLessThanOrEqual(8);
    expect(VILLAGE_SPLAT_MAPS.length).toBe(2);
  });

  it('puts textures under textures/ so a world file can name them', () => {
    expect(terrainTexturePath(TERRAIN_TEXTURES[0] as never)).toMatch(/^textures\//);
  });
});

describe('the height field table', () => {
  it('thins by a factor that keeps both edges of a 513 grid', () => {
    for (const field of HEIGHT_FIELDS) {
      expect((513 - 1) % field.factor).toBe(0);
      expect(field.path).toMatch(/^terrain\/[a-z0-9-]+\.glb$/);
    }
  });
});

describe('decimateHeightField', () => {
  const source = writeGlb(buildHeightFieldGlb('tile', grid(9, 9, 1)));

  it('halves the vertex count in each axis and keeps the tile size', () => {
    const decimated = decimateHeightField(source, 'tile.glb', 2);
    expect([decimated.columns, decimated.rows]).toEqual([5, 5]);
    expect([decimated.sourceColumns, decimated.sourceRows]).toEqual([9, 9]);
    expect(decimated.size).toEqual([8, 8]);
    expect(decimated.triangles).toBe(4 * 4 * 2);
  });

  it('measures the hull of the file it produced, not of the source', () => {
    const decimated = decimateHeightField(source, 'tile.glb', 2);
    expect(decimated.bounds.min[0]).toBe(0);
    expect(decimated.bounds.max[0]).toBe(8);
  });

  it('is deterministic', () => {
    const first = decimateHeightField(source, 'tile.glb', 2);
    const second = decimateHeightField(source, 'tile.glb', 2);
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });

  it('says so in the origin line instead of leaving it to be guessed', () => {
    const decimated = decimateHeightField(source, 'tile.glb', 2);
    const origin = heightFieldOrigin(decimated);
    expect(origin).toContain('9x9 to 5x5 vertices');
    expect(origin).toContain('normals and UVs rebuilt');
    expect(origin).toContain('origin kept at the tile corner');
  });
});

describe('fitTerrainTexture', () => {
  const png = (size: number): Buffer =>
    encodePng({
      width: size,
      height: size,
      channels: 4,
      data: Buffer.alloc(size * size * 4, 200),
    });

  it('passes a layer texture inside the budget through byte for byte', () => {
    const bytes = png(64);
    expect(fitTerrainTexture(bytes, 'x.png')).toBe(bytes);
  });

  it('halves a layer texture over the budget', () => {
    const shrunk = fitTerrainTexture(png(4096), 'x.png');
    expect(shrunk.readUInt32BE(16)).toBe(2048);
  });

  it('turns a splat map onto the ground’s axes and keeps its size', () => {
    const source: RawImage = {
      width: 2,
      height: 2,
      channels: 4,
      // One marked texel, top-left, so the mapping is visible in one pixel.
      data: Buffer.from([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
    };
    const turned = decodePng(fitTerrainTexture(encodePng(source), 'splat.png', true));
    expect([turned.width, turned.height]).toEqual([2, 2]);
    // out[row][col] = in[h-1-col][w-1-row]: the marked texel lands bottom-right.
    expect([...turned.data.subarray(12, 16)]).toEqual([255, 0, 0, 255]);
    expect([...turned.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it('refuses to resize a splat map rather than bleeding its weights', () => {
    expect(() => fitTerrainTexture(png(4096), 'splat.png', true)).toThrow(/must not be resized/);
  });

  it('refuses something that is not a PNG', () => {
    expect(() => fitTerrainTexture(Buffer.from('not a png'), 'x.png')).toThrow(/must be PNG/);
  });

  it('records the turn in the origin line, so nobody has to rediscover it', () => {
    const splat = TERRAIN_TEXTURES.find((texture) => texture.isSplatMap === true);
    const layer = TERRAIN_TEXTURES.find((texture) => texture.isSplatMap !== true);
    expect(splat).toBeDefined();
    expect(terrainTextureOrigin(splat as never)).toContain('anti-diagonal');
    expect(terrainTextureOrigin(layer as never)).not.toContain('anti-diagonal');
  });
});

describe('terrainTextureOrigin', () => {
  it('says what the texture is and that its name was chosen, not derived', () => {
    const texture = TERRAIN_TEXTURES[0];
    expect(texture).toBeDefined();
    expect(terrainTextureOrigin(texture as never)).toContain('under a chosen name');
  });
});
