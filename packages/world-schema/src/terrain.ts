/**
 * Terrain as world data: a height field asset, where it stands, and the
 * texture layers a splat map blends across it (ADR-0020).
 *
 * The ground is authored, never generated (agent rule 16). What a zone stores
 * is a *reference* to a height field that the asset pipeline produced once,
 * exactly as an entity stores a reference to a prefab — no vertex, no noise
 * function and no seed ever enters a world file.
 */
import { z } from 'zod';
import { assetPathOf, Vector3Schema } from './common.js';

/**
 * How many texture layers a splat map carries: one weight per colour channel.
 *
 * Four, because a splat map is an RGBA image and each channel is one layer's
 * weight. It is not a taste limit — a fifth layer in one map has nowhere to
 * live.
 */
export const LAYERS_PER_SPLAT_MAP = 4;

/**
 * The most layers one terrain tile can have: two RGBA maps, eight weights.
 *
 * Stated here rather than left implicit because it is also the renderer's
 * limit — `MixMaterial` takes exactly two mix maps (ADR-0020) — and a world
 * file that asks for nine layers must fail in validation, not on screen.
 */
export const MAX_TERRAIN_LAYERS = 2 * LAYERS_PER_SPLAT_MAP;

/** A metre count that is a real, positive distance. */
const PositiveMetres = z.number().positive().finite();

/** One ground texture and how large one tile of it is on the ground. */
export const TerrainLayerSchema = z.strictObject({
  /** The image, relative to the asset root or the private store. */
  texture: assetPathOf('texture'),
  /**
   * Edge length in metres of one repeat of {@link texture}.
   *
   * Metres rather than a repeat count, because it is the number that stays
   * right when a tile is resized: a 2 m gravel texture is 2 m of gravel on a
   * 300 m tile and on a 50 m one. The renderer divides `size` by it.
   */
  tileSize: PositiveMetres,
});

/**
 * The ground of one zone.
 *
 * `position` is where the height field's **own origin** lands in world space,
 * so a tile whose file spans `0…size` locally covers `position … position +
 * size` in the world. The pipeline writes height fields with their local origin
 * at the tile corner and does not centre them (`docs/world-format.md` says why),
 * which makes `position` the tile's minimum corner in x and z.
 *
 * `size` is what the *world* says the tile measures, and the renderer uses it
 * for texture tiling. It is not read back out of the model: a height field
 * whose hull disagrees with it is a content bug worth seeing, and silently
 * trusting the model would make the same world file render differently after a
 * re-import.
 */
export const TerrainDefinitionSchema = z
  .strictObject({
    /** The height field model, e.g. `terrain/village-257.glb`. */
    heightField: assetPathOf('terrain'),
    /** Where the height field's own origin sits, `[x, y, z]` in metres. */
    position: Vector3Schema,
    /** `[width, depth]` of the tile in metres, along x and z. */
    size: z.tuple([PositiveMetres, PositiveMetres]),
    /** Ground textures, blended by {@link splat}. Absent means one flat colour. */
    layers: z.array(TerrainLayerSchema).max(MAX_TERRAIN_LAYERS).optional(),
    /**
     * One or two splat maps. The first weights layers 1–4 through its RGBA
     * channels, the second layers 5–8.
     */
    splat: z.array(assetPathOf('texture')).min(1).max(2).optional(),
  })
  .superRefine((terrain, ctx) => {
    const layers = terrain.layers ?? [];
    const splat = terrain.splat ?? [];

    // A layer with no weight would be drawn at full strength over everything
    // below it, so the count of maps and the count of layers must agree.
    if (splat.length === 0 && layers.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['splat'],
        message: 'more than one layer needs a splat map to weight them',
      });
    }
    if (splat.length > 0 && layers.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers'],
        message: 'a splat map without layers weights nothing',
      });
    }
    if (layers.length > splat.length * LAYERS_PER_SPLAT_MAP && splat.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['layers'],
        message:
          `${String(layers.length)} layers need ` +
          `${String(Math.ceil(layers.length / LAYERS_PER_SPLAT_MAP))} splat map(s), ` +
          `got ${String(splat.length)}`,
      });
    }
  });

export type TerrainLayer = z.infer<typeof TerrainLayerSchema>;
export type TerrainDefinition = z.infer<typeof TerrainDefinitionSchema>;

/**
 * Every asset path a terrain names, in file order.
 *
 * One function so `pnpm validate:content`, the editor and the renderer agree on
 * what a terrain needs from the asset store; a second list would drift the
 * first time a field is added.
 */
export function terrainAssetPaths(terrain: TerrainDefinition): string[] {
  return [
    terrain.heightField,
    ...(terrain.splat ?? []),
    ...(terrain.layers ?? []).map((layer) => layer.texture),
  ];
}
