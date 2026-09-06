/**
 * Turns a validated prefab catalogue into the exact text of its
 * `content/prefabs/*.json` file.
 *
 * Same two properties as `world-file.ts`, and for the same reason: the API
 * writes files that stay in the repository, so a catalogue the editor saved
 * must satisfy `pnpm format:check` and must differ from the file it opened only
 * where somebody changed something.
 *
 * The key order is read out of `@wov/world-schema` rather than listed here. A
 * prefab has eight optional-ish fields today and will have more, and a listed
 * order silently drops whatever it does not mention — which for a *collider*
 * means a wall the player walks through, discovered weeks later (ADR-0026,
 * ADR-0033).
 */
import { PrefabCollisionSchema, PrefabDefinitionSchema } from '@wov/world-schema';
import type { PrefabCatalog, PrefabCollision, PrefabDefinition } from '@wov/world-schema';
import { formatJsonDocument } from './json-format.js';

const PREFAB_KEYS = Object.keys(PrefabDefinitionSchema.shape) as (keyof PrefabDefinition)[];
const COLLISION_KEYS = Object.keys(PrefabCollisionSchema.shape) as (keyof PrefabCollision)[];

/** The named keys of `value` in this order, skipping the ones it does not have. */
function inOrder<T extends object>(value: T, keys: readonly (keyof T)[]): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      ordered[key as string] = value[key];
    }
  }
  return ordered;
}

function canonicalPrefab(prefab: PrefabDefinition): Record<string, unknown> {
  const ordered = inOrder(prefab, PREFAB_KEYS);
  if (prefab.collision !== undefined) {
    ordered['collision'] = inOrder(prefab.collision, COLLISION_KEYS);
  }
  return ordered;
}

export function serializePrefabCatalog(catalog: PrefabCatalog): string {
  return formatJsonDocument({
    schemaVersion: catalog.schemaVersion,
    id: catalog.id,
    prefabs: catalog.prefabs.map(canonicalPrefab),
  });
}
