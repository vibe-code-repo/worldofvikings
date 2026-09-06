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
import { assetPathOf, turnedBy, Vector3Schema } from './common.js';

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

/** A weight between 0 and 1, inclusive. */
const UnitInterval = z.number().min(0).max(1);

/**
 * One ground texture, how large one tile of it is, and how its surface behaves.
 *
 * The four surface fields are optional and default to "plain diffuse", which is
 * exactly what the layers were before they existed: no normal map, no
 * reflection. A world file that says nothing renders as it did (ADR-0032).
 */
export const TerrainLayerSchema = z
  .strictObject({
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
    /**
     * Tangent-space normal map for this layer, tiled exactly like
     * {@link texture}.
     *
     * One map per layer rather than one per tile: the layers are blended per
     * pixel, so their bumps have to be blended in the same place and by the
     * same weights, and a single map for the whole tile could only describe the
     * ground it happens to sit on.
     */
    normalMap: assetPathOf('texture').optional(),
    /**
     * How strongly {@link normalMap} tilts the surface. 1 is the map as it was
     * painted; 0 is a flat surface; above 1 exaggerates it.
     *
     * The source ground layers were authored between 1.2 and 5, which is why
     * this is not a boolean: the rough rock reads as rock only at 5, and the
     * moss at 5 would read as gravel.
     */
    normalScale: turnedBy('terrainSurface', z.number().min(0).max(8).finite()).optional(),
    /**
     * How metallic this layer is, 0…1.
     *
     * A ground layer is not literally metal. It is the dial that decides how
     * much of what the surface shows is *reflected sky* rather than its own
     * colour, and the authored village layers use it that way: rock at 0.85 is
     * almost entirely cool reflected sky, moss at 0 is its own green
     * (ADR-0032).
     */
    metallic: turnedBy('terrainSurface', UnitInterval).optional(),
    /**
     * How smooth this layer is, 0…1 — the opposite end of roughness.
     *
     * Stated as smoothness rather than roughness because that is the number the
     * ground layers were authored with, and inverting it here once is better
     * than inverting it in a person's head every time they read a world file.
     */
    smoothness: turnedBy('terrainSurface', UnitInterval).optional(),
  })
  .superRefine((layer, ctx) => {
    // A strength for a map that is not there is a number that does nothing,
    // and a number that does nothing is a number someone will trust.
    if (layer.normalScale !== undefined && layer.normalMap === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['normalScale'],
        message: 'normalScale needs a normalMap to scale',
      });
    }
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
    /**
     * A regular-grid copy of the same ground, for tools that sample heights
     * without a renderer — `pnpm scatter`, above all.
     *
     * It exists because {@link heightField} stopped being a grid: the drawn
     * tile is adaptive, coarse where the ground is gentle and fine where it
     * stands up (ADR-0032), and a mesh whose vertices are not `rows × columns`
     * cannot be read as a height grid at all. Rather than have an offline tool
     * guess which file to sample, the world says it. Absent means the height
     * field is itself a grid, which is what it was through version 3.
     */
    heightSamples: assetPathOf('terrain').optional(),
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
    /**
     * Draw the ground facetted: one normal per triangle instead of the smooth
     * normals the height field carries.
     *
     * Off by default, and deliberately so. It is here because the source world
     * gets its hard, angular look from flat-shaded rock meshes standing on a
     * smooth height field, and it is worth being able to ask what the ground
     * itself looks like under the same rule — but a smooth height field drawn
     * facetted is a different ground, not a better-lit one, so nothing turns it
     * on for a world unless an author does (ADR-0032).
     */
    flatNormals: turnedBy('terrainSurface', z.boolean()).optional(),
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
  const layers = terrain.layers ?? [];
  return [
    terrain.heightField,
    ...(terrain.heightSamples === undefined ? [] : [terrain.heightSamples]),
    ...(terrain.splat ?? []),
    ...layers.map((layer) => layer.texture),
    ...layers.flatMap((layer) => (layer.normalMap === undefined ? [] : [layer.normalMap])),
  ];
}
