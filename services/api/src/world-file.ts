import type {
  EntityDefinition,
  LightingProfile,
  TerrainDefinition,
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
 */
function inOrder<T extends object>(value: T, keys: readonly (keyof T)[]): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      ordered[key as string] = value[key];
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
          ]),
        }),
    ...(lighting.fog === undefined
      ? {}
      : { fog: inOrder(lighting.fog, ['enabled', 'start', 'end', 'color']) }),
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
            ...inOrder(post, ['enabled', 'fxaa', 'toneMapping', 'exposure', 'contrast']),
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

function canonicalTerrain(terrain: TerrainDefinition): Record<string, unknown> {
  return {
    heightField: terrain.heightField,
    position: terrain.position,
    size: terrain.size,
    ...(terrain.layers === undefined
      ? {}
      : {
          layers: terrain.layers.map((layer) => ({
            texture: layer.texture,
            tileSize: layer.tileSize,
          })),
        }),
    ...(terrain.splat === undefined ? {} : { splat: terrain.splat }),
  };
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
