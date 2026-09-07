import { z } from 'zod';
import {
  AssetPathSchema,
  IdentifierSchema,
  Vector3Schema,
  checkSchemaVersion,
  findDuplicates,
  formatIssues,
} from './common.js';

/**
 * Version of the prefab catalog format understood by this build.
 *
 * Same rule as the world format (spec §16, agent rule 11): never silently
 * accept or rewrite a different version — bump this together with a migration.
 */
export const CURRENT_PREFAB_SCHEMA_VERSION = 1;

/**
 * What a prefab is *for*, which is what the editor's asset browser groups by
 * (spec §13: "Models | Prefabs | … | Vegetation").
 *
 * Six values, each earning its place by being handled differently somewhere:
 * - `terrain` is placed once per zone and is the ground the player walks on.
 * - `vegetation` is scattered in bulk, needs wind/LOD treatment and is the one
 *   group a scatter tool writes into a world file (spec §12).
 * - `environment` is static scenery that shapes the world: buildings, rocks,
 *   walls, paths.
 * - `prop` is a small, movable object — barrels, crates, tools, loot — the
 *   group gameplay later attaches interaction to (spec §32).
 * - `dungeon` is the modular dungeon kit (spec §20), which is authored against
 *   a grid instead of freely placed.
 * - `backdrop` is painted distance: the mountain shell, the sky dome and the
 *   clouds. It is scenery nobody ever reaches, and it earns its own value
 *   because every reader treats it differently for that one reason — it
 *   collides with nothing, the scatter tool will not plant it and will not
 *   plant onto it, the viewport does not snap to it, it neither casts nor
 *   receives shadow, and it is exempt from fog, because fog is what distance
 *   already did to it in the painting.
 *
 * No asset carries `dungeon` yet; the value exists because the kit is a named
 * part of the spec and a hand-written catalog will use it before the importer
 * does. A seventh value must earn its place the same way.
 *
 * Adding `backdrop` was an **additive** change and needed no version bump: no
 * catalogue written before it used a value this list did not have, so every one
 * of them still parses. Removing a value would not be additive, and would need
 * a bump and a migration like any other format change (agent rule 11).
 */
export const PREFAB_CATEGORIES = [
  'environment',
  'vegetation',
  'terrain',
  'prop',
  'dungeon',
  'backdrop',
] as const;
export type PrefabCategory = (typeof PREFAB_CATEGORIES)[number];
export const PrefabCategorySchema = z.enum(PREFAB_CATEGORIES);

/**
 * Whether this prefab is painted distance rather than a thing in the world.
 *
 * A comparison, and it lives here rather than in the four readers that need it
 * because they must not be able to drift: the game leaves a backdrop out of the
 * fog and the shadow map, the editor leaves it out of the scatter tool and out
 * of the picking, and the catalogue gives it no collision shape. Those are four
 * behaviours of one decision, and one decision is one function.
 *
 * Takes only the field it reads, so a caller with a catalogue row, a manifest
 * row or a literal can all ask.
 */
export function isBackdrop(prefab: { readonly category: PrefabCategory }): boolean {
  return prefab.category === 'backdrop';
}

/**
 * Where the asset bytes are: in this repository, or in the private asset store
 * (ADR-0015).
 *
 * Deliberately duplicated from `@wov/asset-system`: this package describes
 * *data files* and must stay dependency-free apart from Zod, so that world data
 * can be validated without an asset pipeline (agent rule 9, ADR-0004). The two
 * lists are short, closed and change together with an ADR, never silently.
 */
export const PREFAB_VISIBILITIES = ['private', 'public'] as const;
export type PrefabVisibility = (typeof PREFAB_VISIBILITIES)[number];
export const PrefabVisibilitySchema = z.enum(PREFAB_VISIBILITIES);

/**
 * A path relative to whichever root serves the file — `assets/` or the private
 * store (see {@link PREFAB_VISIBILITIES}).
 *
 * The rule itself lives in `common.ts`, because a terrain names asset paths too
 * and a third copy would be a third thing to keep in step. The name is kept as
 * the package's public spelling for a prefab's asset path.
 */
export const PrefabAssetPathSchema = AssetPathSchema;

/**
 * The prefab's axis-aligned hull in metres, copied from the asset manifest.
 *
 * Recorded rather than assumed: height, origin and units differ per source file
 * and per exporting tool. The editor uses it for framing and grid fitting, so a
 * wrong hull is visible instead of silent.
 */
export const PrefabBoundsSchema = z
  .strictObject({
    min: Vector3Schema,
    max: Vector3Schema,
  })
  .refine((bounds) => bounds.max.every((value, axis) => value >= (bounds.min[axis] ?? 0)), {
    message: 'bounds.max must not be smaller than bounds.min on any axis',
  });

/**
 * The shapes a prefab can be collided against (spec §29, ADR-0026).
 *
 * Four values, each one a different bargain between cost and truth:
 * - `none` is for anything the player walks through — grass, a bush, a rug.
 * - `box` is the prefab's hull as one oriented box: one plane test per face,
 *   and the right answer for a crate, a wall segment or a sack.
 * - `hull` is the convex hull of the model, for a rock or a haystack whose
 *   silhouette a box would overstate but which has no hole in it.
 * - `mesh` is every triangle. It is the only shape with a hole in it, which is
 *   why an archway, a doorway and the terrain need it and nothing else does.
 *
 * There is deliberately no `capsule`: a tree trunk is a narrow `box` whose
 * width was measured at the trunk (see `collision.box`), and a second round
 * shape would be a second thing to keep in step for a difference the player
 * cannot feel at a 0.4 m trunk.
 */
export const PREFAB_COLLISION_KINDS = ['none', 'box', 'hull', 'mesh'] as const;
export type PrefabCollisionKind = (typeof PREFAB_COLLISION_KINDS)[number];
export const PrefabCollisionKindSchema = z.enum(PREFAB_COLLISION_KINDS);

/**
 * A separate, low-triangle model that carries the collision geometry.
 *
 * Named in full rather than derived from the prefab's own asset: where the
 * bytes live and what stands in for them is exactly the thing ADR-0015 refuses
 * to guess, and a collider quietly loaded from the wrong place is a wall the
 * player walks through.
 */
export const PrefabColliderAssetSchema = z
  .strictObject({
    path: PrefabAssetPathSchema,
    visibility: PrefabVisibilitySchema,
    placeholder: PrefabAssetPathSchema.optional(),
  })
  .superRefine((asset, ctx) => {
    if (asset.visibility === 'private' && asset.placeholder === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a private collider asset needs a placeholder',
      });
    }
    if (asset.visibility === 'public' && asset.placeholder !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a public collider asset must not carry a placeholder',
      });
    }
  });

/** What the world builder collides this prefab's entities against. */
export const PrefabCollisionSchema = z
  .strictObject({
    kind: PrefabCollisionKindSchema,
    /** Where the triangles come from, when they are not in the prefab's model. */
    asset: PrefabColliderAssetSchema.optional(),
    /**
     * An explicit box, in the same space as {@link PrefabDefinition.bounds} —
     * the model file's own space, before any renderer flips a handedness.
     *
     * Present when the hull is the wrong box: a tree's hull is its crown, and
     * colliding against that turns a wood into a wall. The importer measures
     * the trunk instead and writes it here.
     */
    box: PrefabBoundsSchema.optional(),
  })
  .superRefine((collision, ctx) => {
    if (collision.asset !== undefined && collision.kind !== 'mesh') {
      ctx.addIssue({
        code: 'custom',
        path: ['asset'],
        message: `a collider asset is only used by kind "mesh", not "${collision.kind}"`,
      });
    }
    if (collision.box !== undefined && collision.kind !== 'box') {
      ctx.addIssue({
        code: 'custom',
        path: ['box'],
        message: `a collision box is only used by kind "box", not "${collision.kind}"`,
      });
    }
  });

/**
 * One reusable placeable thing (spec §19). Entities in a world reference it by
 * `id`; geometry is never inlined into a world file.
 */
export const PrefabDefinitionSchema = z
  .strictObject({
    /** Referenced from `EntityDefinition.prefab`; unique across all catalogs. */
    id: IdentifierSchema,
    /** Human-readable label for the hierarchy and the asset browser. */
    name: z.string().min(1),
    /** The model this prefab places. */
    asset: PrefabAssetPathSchema,
    /** Whether {@link PrefabDefinition.asset} ships in the repository. */
    visibility: PrefabVisibilitySchema,
    /** Public stand-in used when the private asset is unavailable (ADR-0015). */
    placeholder: PrefabAssetPathSchema.optional(),
    category: PrefabCategorySchema,
    bounds: PrefabBoundsSchema.optional(),
    /** Author-chosen default scale; absent means `[1, 1, 1]`. */
    defaultScale: Vector3Schema.optional(),
    /**
     * What the player bumps into (ADR-0026).
     *
     * Optional so that adding it was an additive format change and every
     * hand-written catalogue kept parsing. Absent means *undecided*, and a
     * reader must treat it as `none` — which is what the game did before this
     * field existed — instead of inventing a shape for it.
     */
    collision: PrefabCollisionSchema.optional(),
  })
  .superRefine((prefab, ctx) => {
    // A private prefab without a stand-in is a hole in every clone that has no
    // asset store — the editor would have nothing to draw (ADR-0015).
    if (prefab.visibility === 'private' && prefab.placeholder === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a private prefab needs a placeholder',
      });
    }
    // A public asset is always there, so a placeholder for it would be a second
    // truth about which file to load.
    if (prefab.visibility === 'public' && prefab.placeholder !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a public prefab must not carry a placeholder',
      });
    }
  });

/** The root object of every file in `content/prefabs/`. */
export const PrefabCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_PREFAB_SCHEMA_VERSION),
    /** Catalog name, matching the file name (`base.json` → `base`). */
    id: IdentifierSchema,
    prefabs: z.array(PrefabDefinitionSchema),
  })
  .superRefine((catalog, ctx) => {
    for (const duplicate of findDuplicates(catalog.prefabs.map((prefab) => prefab.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['prefabs'],
        message: `duplicate prefab id "${duplicate}"`,
      });
    }
  });

export type PrefabDefinition = z.infer<typeof PrefabDefinitionSchema>;
export type PrefabCatalog = z.infer<typeof PrefabCatalogSchema>;
export type PrefabBounds = z.infer<typeof PrefabBoundsSchema>;
export type PrefabCollision = z.infer<typeof PrefabCollisionSchema>;
export type PrefabColliderAsset = z.infer<typeof PrefabColliderAssetSchema>;

/** Result of {@link parsePrefabCatalog}: a catalog or human-readable errors. */
export type PrefabCatalogParseResult =
  | { readonly ok: true; readonly catalog: PrefabCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validates unknown data as a {@link PrefabCatalog}. */
export function parsePrefabCatalog(data: unknown): PrefabCatalogParseResult {
  const versionError = checkSchemaVersion(data, CURRENT_PREFAB_SCHEMA_VERSION);
  if (versionError !== null) {
    return { ok: false, errors: [versionError] };
  }

  const result = PrefabCatalogSchema.safeParse(data);
  if (result.success) {
    return { ok: true, catalog: result.data };
  }
  return { ok: false, errors: formatIssues(result.error) };
}

/**
 * Shortest a model may be and still be drawn into the sun's shadow map.
 *
 * Half a metre, from the two ends of the measurement. A tuft of the scattered
 * grass is 0.25 m tall (`content/prefabs/imported.json`) and the shadow map
 * covers 120 m in 2048 texels — 5.9 cm of ground each — so its whole shadow is
 * about four texels. The next thing up is a bush at 1.88 m, which is 32 texels
 * and a shape a player can see. Nothing in the village stands between the two.
 */
export const SHADOW_CASTER_MINIMUM_HEIGHT = 0.5;

/**
 * The part of a prefab this rule reads.
 *
 * Only the two fields, like {@link isBackdrop}, so a catalogue row, a manifest
 * row or a literal can all ask — and so the rule can be exercised without
 * building a whole {@link PrefabDefinition}.
 */
export interface ShadowCastingPrefab {
  readonly category: PrefabCategory;
  readonly bounds?:
    { readonly min: readonly number[]; readonly max: readonly number[] } | undefined;
}

/**
 * Whether this prefab's copies are drawn into the sun's shadow map.
 *
 * Everything does, except vegetation too short for its shadow to be a shape.
 * That is not only a saving, though it is a large one — the village scatters
 * 3 473 tufts of grass, each of them drawn a second time every frame by the
 * shadow pass. It is also what the picture wants: tufts that cast shadows cast
 * them on *each other*, and a dense field of grass then reads as a dark mat
 * rather than as grass. They still **receive**: a tuft in the shade of a house
 * is in the shade (`excludeFromCasting` in `@wov/engine`).
 *
 * Measured on the model rather than assumed from the category, because the
 * category says what a thing is and the bounds say how big it is — and a prefab
 * that was never measured casts, because "we do not know" must not read as
 * "it is small".
 *
 * It lives here beside {@link isBackdrop} for the reason that one does: the
 * game and the editor must not be able to drift about it. An author who lays
 * out a field of grass under an editor that shadows every tuft is being shown a
 * dark mat the game will never draw (ADR-0027, ADR-0049).
 */
export function castsShadows(prefab: ShadowCastingPrefab): boolean {
  const bounds = prefab.bounds;
  // A backdrop is out of the shadow map for a different reason and without a
  // measurement: the sun's map covers 120 m around the player, the nearest
  // shell stands 290 m away, and a shell 1 188 m across put into that map would
  // stretch it over the whole world. It receives nothing either — the game
  // hands every backdrop mesh to `excludeFromShadows`, which is both directions
  // at once (ADR-0031).
  if (isBackdrop(prefab)) {
    return false;
  }
  if (bounds === undefined || prefab.category !== 'vegetation') {
    return true;
  }
  return (bounds.max[1] ?? 0) - (bounds.min[1] ?? 0) >= SHADOW_CASTER_MINIMUM_HEIGHT;
}
