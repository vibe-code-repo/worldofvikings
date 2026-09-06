/**
 * The checks that span two content files, which no single-file schema can make:
 * a prefab id must be unique across all catalogs, and an entity may only
 * reference a prefab that exists (ADR-0016).
 *
 * Pure functions so they are tested directly instead of through the script.
 */
import type { PrefabCatalog, WorldDefinition } from '@wov/world-schema';

/** One parsed catalog together with the file it came from, for the message. */
export interface LoadedCatalog {
  readonly file: string;
  readonly catalog: PrefabCatalog;
}

export interface PrefabIdIndex {
  /** Every prefab id known to the repository. */
  readonly ids: ReadonlySet<string>;
  /** One message per id claimed by more than one catalog. */
  readonly duplicates: readonly string[];
}

/**
 * Indexes all catalogs by prefab id.
 *
 * An entity references a prefab by its bare id, with no catalog name, so two
 * catalogs using the same id would make the reference ambiguous — which file
 * wins would depend on read order.
 */
export function collectPrefabIds(catalogs: readonly LoadedCatalog[]): PrefabIdIndex {
  const owners = new Map<string, string>();
  const ids = new Set<string>();
  const duplicates: string[] = [];

  for (const { file, catalog } of catalogs) {
    for (const prefab of catalog.prefabs) {
      const owner = owners.get(prefab.id);
      if (owner !== undefined) {
        duplicates.push(`prefab id "${prefab.id}" is defined in both ${owner} and ${file}`);
        continue;
      }
      owners.set(prefab.id, file);
      ids.add(prefab.id);
    }
  }

  return { ids, duplicates };
}

/** One message per entity whose `prefab` does not exist. */
export function findUnknownPrefabReferences(
  world: WorldDefinition,
  prefabIds: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];
  for (const zone of world.zones) {
    for (const entity of zone.entities) {
      if (!prefabIds.has(entity.prefab)) {
        messages.push(`${zone.id}/${entity.id} references unknown prefab "${entity.prefab}"`);
      }
    }
  }
  return messages;
}
