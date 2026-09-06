import type {
  EntityDefinition,
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
    zones: world.zones.map(canonicalZone),
  });
}

function canonicalZone(zone: ZoneDefinition): Record<string, unknown> {
  return {
    id: zone.id,
    name: zone.name,
    entities: zone.entities.map(canonicalEntity),
    ...(zone.terrain === undefined ? {} : { terrain: canonicalTerrain(zone.terrain) }),
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
