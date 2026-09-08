import { TerrainDefinitionSchema, TerrainLayerSchema } from '@wov/world-schema';
import type {
  EntityDefinition,
  LightingProfile,
  TerrainDefinition,
  TerrainLayer,
  WorldDefinition,
  ZoneDefinition,
} from '@wov/world-schema';
import { formatJsonDocument } from './json-format.js';

/**
 * Turns a validated world into the exact text of its `content/worlds/*.json`
 * file.
 *
 * Two properties matter, and both are about review, not about the runtime:
 *
 * - **Canonical field order.** Whatever order an editor client sends, the file
 *   comes back in schema order, so a saved world only shows the fields that
 *   actually changed in `git diff`.
 * - **Prettier formatting** (see `json-format.ts`), so `pnpm format:check`
 *   stays green on a world the editor wrote.
 */
export function serializeWorld(world: WorldDefinition): string {
  return formatJsonDocument({
    schemaVersion: world.schemaVersion,
    id: world.id,
    name: world.name,
    ...(world.lighting === undefined ? {} : { lighting: canonicalLighting(world.lighting) }),
    zones: world.zones.map(canonicalZone),
  });
}

/**
 * The named keys of `value`, in this order, skipping the ones it does not have.
 *
 * The lighting profile is six optional groups of optional fields (ADR-0024),
 * and spelling every one of them out as a ternary would be sixty lines that all
 * say the same thing. This says it once — and it still refuses to invent a
 * field, because a key that is absent stays absent.
 *
 * **Anything not on the list is kept, at the end.** `keys` decides the order of
 * the fields it names and nothing else; it is not a filter. It used to be one,
 * and that made it a silent way to lose world data: a field added to
 * `@wov/world-schema` validated, reached the editor, was written by an author
 * and then vanished the next time the world was saved, with no error anywhere.
 * The list is still worth keeping in step with the schema — a new field
 * otherwise lands at the bottom of its group rather than where it belongs — but
 * forgetting to now costs an ordering, not a value.
 */
function inOrder<T extends object>(
  value: T,
  keys: readonly (keyof T)[],
  /** Keys the caller writes itself, so the catch-all does not write them twice. */
  writtenByTheCaller: readonly (keyof T)[] = [],
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      ordered[key as string] = value[key];
    }
  }
  const skip = new Set<string>(writtenByTheCaller.map((key) => key as string));
  for (const [key, held] of Object.entries(value)) {
    if (held !== undefined && !(key in ordered) && !skip.has(key)) {
      ordered[key] = held;
    }
  }
  return ordered;
}

/**
 * A lighting profile in schema order, groups and fields alike.
 *
 * It is written out field by field rather than passed through, for the reason
 * the whole module exists: a world the editor saved must differ from the file
 * it opened only where somebody changed something. A profile that came back in
 * the order a JavaScript object happened to have it would rewrite the block on
 * every save.
 */
function canonicalLighting(lighting: LightingProfile): Record<string, unknown> {
  const post = lighting.postProcessing;
  return {
    ...(lighting.sun === undefined
      ? {}
      : { sun: inOrder(lighting.sun, ['direction', 'color', 'intensity']) }),
    ...(lighting.ambient === undefined
      ? {}
      : { ambient: inOrder(lighting.ambient, ['skyColor', 'groundColor', 'intensity']) }),
    ...(lighting.sky === undefined
      ? {}
      : {
          sky: inOrder(lighting.sky, [
            'enabled',
            'zenithColor',
            'horizonColor',
            'sunColor',
            'sunSpread',
            'groundReflection',
          ]),
        }),
    ...(lighting.fog === undefined
      ? {}
      : { fog: inOrder(lighting.fog, ['enabled', 'mode', 'start', 'end', 'density', 'color']) }),
    ...(lighting.shadows === undefined
      ? {}
      : {
          shadows: inOrder(lighting.shadows, [
            'enabled',
            'mapSize',
            'distance',
            'bias',
            'normalBias',
            'darkness',
            'filter',
          ]),
        }),
    ...(post === undefined
      ? {}
      : {
          postProcessing: {
            ...inOrder(
              post,
              ['enabled', 'fxaa', 'toneMapping', 'exposure', 'contrast', 'saturation'],
              // The sub-blocks are written below, in their own order.
              ['bloom', 'vignette', 'ssao', 'sunShafts'],
            ),
            ...(post.bloom === undefined
              ? {}
              : {
                  bloom: inOrder(post.bloom, ['enabled', 'threshold', 'weight', 'scale', 'kernel']),
                }),
            ...(post.vignette === undefined
              ? {}
              : { vignette: inOrder(post.vignette, ['enabled', 'weight', 'color']) }),
            ...(post.ssao === undefined
              ? {}
              : {
                  ssao: inOrder(post.ssao, ['enabled', 'radius', 'strength', 'samples', 'scale']),
                }),
            ...(post.sunShafts === undefined
              ? {}
              : {
                  sunShafts: inOrder(post.sunShafts, [
                    'enabled',
                    'exposure',
                    'decay',
                    'weight',
                    'density',
                    'samples',
                    'passScale',
                    'postScale',
                    'maxAngleDegrees',
                    'hysteresisDegrees',
                    'anchorDistance',
                    'anchorSize',
                  ]),
                }),
          },
        }),
  };
}

function canonicalZone(zone: ZoneDefinition): Record<string, unknown> {
  return {
    id: zone.id,
    name: zone.name,
    entities: zone.entities.map(canonicalEntity),
    ...(zone.terrain === undefined ? {} : { terrain: canonicalTerrain(zone.terrain) }),
    ...(zone.lighting === undefined ? {} : { lighting: canonicalLighting(zone.lighting) }),
  };
}

/** The declaration order of the terrain schema, which is also the file order. */
const TERRAIN_KEYS = Object.keys(TerrainDefinitionSchema.shape) as (keyof TerrainDefinition)[];
const TERRAIN_LAYER_KEYS = Object.keys(TerrainLayerSchema.shape) as (keyof TerrainLayer)[];

/**
 * The terrain block in schema order, read *from the schema* rather than listed.
 *
 * The lighting profile above is spelled out because its groups nest; this one
 * is not, and the difference is worth stating. A terrain layer is the block
 * this project is actively growing — `normalMap`, `normalScale`, `metallic`
 * and `smoothness` are being added as the terrain work lands. A hand-written
 * list of keys here would silently *drop* every new one on the first save, and
 * nothing would fail: the file would come back without the field, and the
 * ground would go flat some time later. Asking the schema means a field the
 * format accepts survives a round trip through the editor (ADR-0033).
 */
function canonicalTerrain(terrain: TerrainDefinition): Record<string, unknown> {
  const ordered = inOrder(terrain, TERRAIN_KEYS, ['layers']);
  if (terrain.layers !== undefined) {
    ordered['layers'] = terrain.layers.map((layer) => inOrder(layer, TERRAIN_LAYER_KEYS));
  }
  return ordered;
}

function canonicalEntity(entity: EntityDefinition): Record<string, unknown> {
  return {
    id: entity.id,
    prefab: entity.prefab,
    position: entity.position,
    // Optional fields stay absent when they were absent; writing defaults would
    // put values into the file that nobody authored.
    ...(entity.rotation === undefined ? {} : { rotation: entity.rotation }),
    ...(entity.scale === undefined ? {} : { scale: entity.scale }),
  };
}
