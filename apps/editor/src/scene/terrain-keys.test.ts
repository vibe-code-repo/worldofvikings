import { describe, expect, it } from 'vitest';
import type { TerrainDefinition } from '@wov/world-schema';
import { NO_TERRAIN_KEYS, terrainChange, terrainKeys, terrainSurface } from './terrain-keys.js';

const NAME = 'village1:village';

/** The village tile in miniature: two layers, one splat map, one normal map. */
function ground(patch: Partial<TerrainDefinition> = {}): TerrainDefinition {
  return {
    heightField: 'terrain/village-257.glb',
    position: [0, 0, 0],
    size: [300, 300],
    splat: ['textures/village-splat-a.png'],
    layers: [
      {
        texture: 'textures/grass.png',
        tileSize: 8,
        normalMap: 'textures/grass-n.png',
        normalScale: 1,
        metallic: 0,
        smoothness: 0.2,
      },
      { texture: 'textures/rock.png', tileSize: 12, metallic: 0.85, smoothness: 0.4 },
    ],
    ...patch,
  } as TerrainDefinition;
}

/** What the reconciler would do to go from one block to the other. */
function change(
  before: TerrainDefinition | undefined,
  after: TerrainDefinition | undefined,
  afterName = NAME,
): string {
  return terrainChange(terrainKeys(NAME, before), terrainKeys(afterName, after));
}

/** The same layer with one field replaced, leaving the rest alone. */
function withLayer(index: number, patch: Record<string, unknown>): TerrainDefinition {
  const base = ground();
  const layers = (base.layers ?? []).map((layer, at) =>
    at === index ? { ...layer, ...patch } : layer,
  );
  return ground({ layers } as Partial<TerrainDefinition>);
}

describe('what a terrain change costs', () => {
  it('answers nothing at all when the block is the same', () => {
    // The case that happens thousands of times a session: the document is
    // replaced on every gizmo drag and the ground is stated again unchanged.
    expect(change(ground(), ground())).toBe('none');
  });

  /**
   * The dials the Surface panel turns. Each of these reaches the shader as a
   * value in `uLayerScale` or `uLayerSurface`, so the tile that is already on
   * screen can take it — and the whole of ADR-0050 is that it does.
   */
  it.each([
    ['metallic', { metallic: 0.7 }],
    ['smoothness', { smoothness: 0.9 }],
    ['normalScale', { normalScale: 0.3 }],
    ['tileSize', { tileSize: 4 }],
  ])('turns %s into a uniform write, not a rebuild', (_name, patch) => {
    expect(change(ground(), withLayer(0, patch))).toBe('uniform');
  });

  /**
   * The other half. Each of these is a different compiled program or a
   * different image, and answering `uniform` for any of them would be a panel
   * that writes into nothing — the failure this project has been bitten by
   * before (a define set is not a shader recompiled).
   */
  it.each([
    ['the facet switch', ground({ flatNormals: true })],
    ['a layer texture', withLayer(1, { texture: 'textures/sand.png' })],
    ['a normal map', withLayer(0, { normalMap: 'textures/grass-n2.png' })],
    ['a normal map taken away', withLayer(0, { normalMap: undefined, normalScale: undefined })],
    ['a splat map', ground({ splat: ['textures/village-splat-b.png'] })],
    ['a layer added', ground({ layers: [...(ground().layers ?? []), ground().layers![0]!] })],
    ['the tile size', ground({ size: [400, 400] })],
    ['the tile position', ground({ position: [10, 0, 0] })],
  ])('rebuilds the material for %s', (_name, after) => {
    expect(change(ground(), after)).toBe('material');
  });

  it('only reloads for a different height field', () => {
    expect(change(ground(), ground({ heightField: 'terrain/other-257.glb' }))).toBe('reload');
  });

  /**
   * The same block in a different zone is a different tile. The caller names
   * the tile after the world and the zone, and a world whose two zones happen
   * to describe the same ground must still redraw when the author switches.
   */
  it('reloads when the same ground belongs to another zone', () => {
    expect(change(ground(), ground(), 'village1:north')).toBe('reload');
  });

  it('reloads in and out of a zone that has no ground', () => {
    expect(change(ground(), undefined)).toBe('reload');
    expect(change(undefined, ground())).toBe('reload');
    expect(change(undefined, undefined)).toBe('none');
    expect(terrainKeys(NAME, undefined)).toEqual(NO_TERRAIN_KEYS);
  });

  /**
   * `heightSamples` is a regular-grid copy of the ground that `pnpm scatter`
   * reads and the renderer never touches. Rebuilding the tile for it would be
   * a reload for a field that cannot change a single pixel.
   */
  it('ignores the height-sample grid, which no renderer reads', () => {
    expect(change(ground(), ground({ heightSamples: 'terrain/village-grid.glb' }))).toBe('none');
  });

  it('starts from keys that differ from every real ground', () => {
    expect(terrainChange(NO_TERRAIN_KEYS, terrainKeys(NAME, ground()))).toBe('reload');
  });
});

describe('terrainSurface', () => {
  it('carries one entry per layer, in the tile’s own order', () => {
    expect(terrainSurface(ground())).toEqual({
      layers: [
        { tileSize: 8, normalScale: 1, metallic: 0, smoothness: 0.2 },
        { tileSize: 12, normalScale: undefined, metallic: 0.85, smoothness: 0.4 },
      ],
    });
  });

  it('is empty for a tile that is one flat colour', () => {
    const bare = {
      heightField: 'terrain/village-257.glb',
      position: [0, 0, 0],
      size: [300, 300],
    } as TerrainDefinition;
    expect(terrainSurface(bare)).toEqual({ layers: [] });
  });
});
