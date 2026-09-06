/**
 * Editing a prefab without fighting the generator (ADR-0033).
 *
 * `content/prefabs/imported.json` is written by `generate:prefabs` from the
 * asset manifest, and it is written *whole* — 565 prefabs, byte for byte, every
 * time the assets change. An editor that saved a corrected collision shape into
 * that file would have it silently reverted by the next regeneration, which is
 * the worst kind of data loss: no error, no diff anybody reads, and a wall the
 * player walks through three weeks later.
 *
 * So a correction goes into a second catalogue, `overrides.json`, which
 * `services/api` applies **after** the generated one and which the generator
 * never touches. A hand-written catalogue such as `base.json` is edited in
 * place, because nothing regenerates it.
 *
 * An override entry is a complete `PrefabDefinition`, not a diff. Two reasons:
 * the prefab schema has no partial form, so a diff could not be validated as it
 * is written; and a reader of `overrides.json` can see what a prefab *is*
 * rather than having to hold the generated file open next to it.
 */
import {
  CURRENT_PREFAB_SCHEMA_VERSION,
  type PrefabCatalog,
  type PrefabCategory,
  type PrefabCollision,
  type PrefabDefinition,
} from '@wov/world-schema';

/**
 * Catalogue id of the generated file, repeated from `@wov/content-build`.
 *
 * Deliberately a copy, for the same reason `AssetPathSchema` is copied into
 * `@wov/world-schema`: `@wov/content-build` reads and writes files with `node:`
 * built-ins, and importing it here would put them in the editor's browser
 * bundle. It is one lower-case word, it is covered by a test in
 * `prefab-overrides.test.ts`, and it changes with an ADR or not at all.
 */
export const IMPORTED_CATALOG_ID = 'imported';

/** Catalogue id and file name of the overlay: `content/prefabs/overrides.json`. */
export const OVERRIDE_CATALOG_ID = 'overrides';

/** What the prefab inspector can change. Everything else is the asset's own truth. */
export interface PrefabEdit {
  readonly category?: PrefabCategory;
  /** `null` removes the block, which means *undecided* — see the prefab schema. */
  readonly collision?: PrefabCollision | null;
}

/**
 * Which catalogue file an edit to this prefab belongs in.
 *
 * The generated catalogue is never edited; everything else is edited where it
 * lives.
 */
export function catalogForEdit(catalog: string): string {
  return catalog === IMPORTED_CATALOG_ID ? OVERRIDE_CATALOG_ID : catalog;
}

/** The prefab as it would be after the edit. Key order follows the schema. */
export function editedPrefab(prefab: PrefabDefinition, edit: PrefabEdit): PrefabDefinition {
  const next: PrefabDefinition = {
    ...prefab,
    ...(edit.category === undefined ? {} : { category: edit.category }),
  };
  if (edit.collision === undefined) {
    return next;
  }
  if (edit.collision === null) {
    const { collision: _collision, ...rest } = next;
    return rest;
  }
  return { ...next, collision: edit.collision };
}

/**
 * A catalogue with this prefab in it: replaced where it already is, appended
 * otherwise, and sorted by id when it is the overlay.
 *
 * Sorting the overlay is what keeps its diff readable — it grows one prefab at
 * a time over months, and append order is the order somebody happened to click
 * in. A hand-written catalogue keeps its own order, because that order is
 * authored.
 */
export function withPrefab(catalog: PrefabCatalog, prefab: PrefabDefinition): PrefabCatalog {
  const index = catalog.prefabs.findIndex((candidate) => candidate.id === prefab.id);
  const prefabs =
    index >= 0
      ? catalog.prefabs.map((candidate, at) => (at === index ? prefab : candidate))
      : [...catalog.prefabs, prefab];
  return {
    ...catalog,
    prefabs:
      catalog.id === OVERRIDE_CATALOG_ID
        ? [...prefabs].sort((left, right) => left.id.localeCompare(right.id, 'en'))
        : prefabs,
  };
}

/** An empty overlay catalogue, for the first correction anybody makes. */
export function emptyOverrideCatalog(): PrefabCatalog {
  return { schemaVersion: CURRENT_PREFAB_SCHEMA_VERSION, id: OVERRIDE_CATALOG_ID, prefabs: [] };
}
