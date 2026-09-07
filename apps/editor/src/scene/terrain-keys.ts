/**
 * How much of the ground a terrain block actually changed (ADR-0050).
 *
 * The editor draws a zone's ground from `zone.terrain`, and the document is
 * replaced on every edit — every gizmo drag, every keystroke in a panel — so
 * the viewport has to answer "is this the same ground?" thousands of times a
 * session. It used to answer with `JSON.stringify(terrain)`: one string, one
 * comparison, and any difference at all meant *reload the tile*. Turning a
 * metalness dial therefore disposed the tile, re-instantiated 3.5 MB of height
 * field, compiled a shader and created fourteen textures, measured at about
 * 1.5 s a keystroke on the village.
 *
 * The block is three things, not one, and they cost three very different
 * amounts:
 *
 * | change                                        | what it costs         |
 * | --------------------------------------------- | -------------------- |
 * | `tileSize`, `normalScale`, `metallic`, `smoothness` | a uniform write |
 * | textures, splat maps, `flatNormals`, position, size | a new material  |
 * | `heightField`                                  | a model to fetch     |
 *
 * This module is only the decision, and it is here on its own because that is
 * the part that can be wrong without a renderer noticing: a field that lands in
 * the wrong bucket is either a dial that rebuilds the world or — far worse — a
 * texture swap that silently does nothing. Both are one string away from each
 * other, so both are held still by a test.
 *
 * Free of Babylon and of React on purpose: the keys are made of world data, and
 * nothing about which bucket a field belongs in needs a scene to be decided.
 */
import type { TerrainDefinition } from '@wov/world-schema';

/** The three keys one terrain block reduces to, coarsest first. */
export interface TerrainKeys {
  /**
   * Which zone, and which height field. A change here is the only one that
   * needs a model loaded.
   */
  readonly tile: string;
  /**
   * Everything that ends up in a compiled program or in a texture: the layer
   * and splat images, the facet switch, where the tile sits and how big it is.
   */
  readonly material: string;
  /** The numbers that are uniforms in the program the tile already has. */
  readonly surface: string;
}

/** What has to happen to the drawn ground to catch up with the document. */
export type TerrainChange =
  /** Nothing: the same ground, stated again. Every gizmo drag lands here. */
  | 'none'
  /** Write the new numbers into the program the tile already carries. */
  | 'uniform'
  /** Build a new material over the height field that is already loaded. */
  | 'material'
  /** Fetch and instantiate a height field — the expensive one. */
  | 'reload';

/**
 * The keys of one zone's ground.
 *
 * `name` is part of them because the same terrain block in two zones is two
 * tiles: the caller names the tile after the world and the zone, and switching
 * zone must redraw even when the ground happens to be described identically.
 *
 * `undefined` — a zone with no ground — reduces to three empty strings, so it
 * differs from any real ground at the coarsest key and reaches `reload`, which
 * is where the tile is taken off the screen.
 */
export function terrainKeys(name: string, terrain: TerrainDefinition | undefined): TerrainKeys {
  if (terrain === undefined) {
    return { tile: '', material: '', surface: '' };
  }
  return {
    tile: JSON.stringify([name, terrain.heightField]),
    material: JSON.stringify([
      name,
      terrain.heightField,
      terrain.position,
      terrain.size,
      terrain.splat ?? [],
      terrain.flatNormals === true,
      // The path, not merely whether there is one: a swapped normal map is a
      // different texture even though the program's shape is unchanged.
      (terrain.layers ?? []).map((layer) => [layer.texture, layer.normalMap ?? null]),
    ]),
    // `heightSamples` is deliberately in none of the three: it is a grid copy
    // offline tools sample (`pnpm scatter`), and the renderer never reads it.
    surface: JSON.stringify(terrainSurface(terrain)),
  };
}

/** One layer's uniform numbers, in the order the engine writes them. */
export interface TerrainLayerSurface {
  readonly tileSize: number;
  readonly normalScale?: number | undefined;
  readonly metallic?: number | undefined;
  readonly smoothness?: number | undefined;
}

/**
 * The dials of every layer, ready to hand to `TerrainHandle.update`.
 *
 * Structurally `TerrainSurfaceUpdate` from `@wov/engine`, restated here so this
 * module keeps its one dependency and stays free of the renderer.
 */
export function terrainSurface(terrain: TerrainDefinition): {
  readonly layers: readonly TerrainLayerSurface[];
} {
  return {
    layers: (terrain.layers ?? []).map((layer) => ({
      tileSize: layer.tileSize,
      normalScale: layer.normalScale,
      metallic: layer.metallic,
      smoothness: layer.smoothness,
    })),
  };
}

/**
 * The cheapest thing that brings the drawn ground up to date.
 *
 * Coarsest key first: a different height field makes the other two irrelevant,
 * and a different material makes the surface irrelevant because the new
 * material is built with the new numbers already in it.
 */
export function terrainChange(before: TerrainKeys, after: TerrainKeys): TerrainChange {
  if (before.tile !== after.tile) {
    return 'reload';
  }
  if (before.material !== after.material) {
    return 'material';
  }
  return before.surface === after.surface ? 'none' : 'uniform';
}

/** The keys of a ground nothing has drawn yet; every real ground differs. */
export const NO_TERRAIN_KEYS: TerrainKeys = { tile: '', material: '', surface: '' };
