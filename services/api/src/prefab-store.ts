import { join } from 'node:path';
import { listJsonFiles, readJsonFile } from './content-files.js';
import { parsePrefabCatalog, type PrefabDefinition } from '@wov/world-schema';

/** The folder inside `CONTENT_DIR` that holds prefab catalogues. */
export const PREFABS_FOLDER = 'prefabs';

/** A prefab as the editor sees it: the catalogue entry plus where it came from. */
export type MergedPrefab = PrefabDefinition & { readonly catalog: string };

export interface PrefabCatalogSummary {
  readonly id: string;
  readonly file: string;
  readonly prefabs: number;
}

export interface InvalidPrefabCatalog {
  readonly file: string;
  readonly errors: readonly string[];
}

export interface PrefabListing {
  readonly prefabs: readonly MergedPrefab[];
  readonly catalogs: readonly PrefabCatalogSummary[];
  readonly invalid: readonly InvalidPrefabCatalog[];
}

/**
 * Every catalogue in `CONTENT_DIR/prefabs`, merged into one list.
 *
 * Files are read in name order, so the result does not depend on the file
 * system: the first definition of an id wins and the later one is reported as
 * a clash instead of quietly replacing it.
 */
export async function listPrefabs(contentDir: string): Promise<PrefabListing> {
  const folder = join(contentDir, PREFABS_FOLDER);
  const byId = new Map<string, MergedPrefab>();
  const catalogs: PrefabCatalogSummary[] = [];
  const invalid: InvalidPrefabCatalog[] = [];

  for (const file of await listJsonFiles(folder)) {
    const read = await readJsonFile(join(folder, file));
    if (read.status === 'not-found') {
      // Deleted between listing and reading; nothing to report.
      continue;
    }
    if (read.status === 'unreadable') {
      invalid.push({ file, errors: read.errors });
      continue;
    }

    const parsed = parsePrefabCatalog(read.data);
    if (!parsed.ok) {
      invalid.push({ file, errors: parsed.errors });
      continue;
    }

    const clashes: string[] = [];
    for (const prefab of parsed.catalog.prefabs) {
      const existing = byId.get(prefab.id);
      if (existing) {
        clashes.push(
          `prefabs: duplicate prefab id "${prefab.id}", already defined in catalog "${existing.catalog}"`,
        );
        continue;
      }
      byId.set(prefab.id, { ...prefab, catalog: parsed.catalog.id });
    }
    if (clashes.length > 0) {
      invalid.push({ file, errors: clashes });
    }

    catalogs.push({ id: parsed.catalog.id, file, prefabs: parsed.catalog.prefabs.length });
  }

  const prefabs = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return { prefabs, catalogs, invalid };
}
