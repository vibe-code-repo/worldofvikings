import type { EntityDefinition, WorldDefinition, ZoneDefinition } from '@wov/world-schema';

/**
 * Fixtures shared by the tests in this package. Not exported from the package
 * entry point — it is test scaffolding, not public API.
 */
export function entity(id: string, overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return { id, prefab: 'barrel-01', position: [0, 0, 0], ...overrides };
}

export function zone(id: string, entities: readonly EntityDefinition[]): ZoneDefinition {
  return { id, name: id, entities: [...entities] };
}

export function world(zones: readonly ZoneDefinition[]): WorldDefinition {
  return { schemaVersion: 1, id: 'example', name: 'Example', zones: [...zones] };
}

/** The village world used by most tests: three barrels in one zone. */
export function villageWorld(): WorldDefinition {
  return world([
    zone('village', [entity('barrel_001'), entity('barrel_002'), entity('barrel_003')]),
  ]);
}

/** Entity ids of a zone, in file order — the thing most assertions compare. */
export function entityIds(worldDefinition: WorldDefinition, zoneId: string): string[] {
  const found = worldDefinition.zones.find((candidate) => candidate.id === zoneId);
  return (found?.entities ?? []).map((candidate) => candidate.id);
}
