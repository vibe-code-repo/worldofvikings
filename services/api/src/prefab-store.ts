import { join } from 'node:path';
import { parsePrefabCatalog, type PrefabCatalog, type PrefabDefinition } from '@wov/world-schema';
import { contentFilePath } from './content-ids.js';
import { listJsonFiles, readJsonFile, writeJsonFileAtomically } from './content-files.js';
import { serializePrefabCatalog } from './prefab-file.js';

/** The folder inside `CONTENT_DIR` that holds prefab catalogues. */
export const PREFABS_FOLDER = 'prefabs';

/**
 * The overlay catalogue: the one file that may redefine a prefab another
 * catalogue already declared (ADR-0033).
 *
 * `imported.json` is written whole by `generate:prefabs` from the asset
 * manifest, so a correction saved into it is reverted by the next regeneration
 * — silently, with no diff anybody reads. The editor therefore writes
 * corrections into `overrides.json`, and this store applies that file last.
 * Everything else keeps the old rule: the first definition of an id wins and a
 * second one is reported as a clash, because two catalogues claiming the same
 * prefab by accident is a mistake, not an intention.
 *
 * The name is repeated in `@wov/editor-core` (`OVERRIDE_CATALOG_ID`), which
 * cannot be imported here — it is editor-only by boundary rule. One lower-case
 * word, asserted on both sides.
 */
export const OVERRIDE_CATALOG_ID = 'overrides';

/** A prefab as the editor sees it: the catalogue entry plus where it came from. */
export type MergedPrefab = PrefabDefinition & { readonly catalog: string };

export interface PrefabCatalogSummary {
  readonly id: string;
  readonly file: string;
  readonly prefabs: number;
  /** Whether this catalogue may redefine another one's prefabs. */
  readonly overlay: boolean;
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

export type LoadedCatalog =
  | {
      readonly status: 'ok';
      readonly catalog: PrefabCatalog;
      readonly updatedAt: string;
      /** Bytes of the file this was parsed from, for the response's ETag (ADR-0052). */
      readonly size: number;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'invalid'; readonly errors: readonly string[] };

/**
 * Every catalogue in `CONTENT_DIR/prefabs`, merged into one list.
 *
 * Files are read in name order, so the result does not depend on the file
 * system: the first definition of an id wins and the later one is reported as
 * a clash instead of quietly replacing it. The overlay (see
 * {@link OVERRIDE_CATALOG_ID}) is the exception and is applied afterwards, so
 * its entries replace rather than clash, whatever the alphabet would have said.
 */
export async function listPrefabs(contentDir: string): Promise<PrefabListing> {
  const folder = join(contentDir, PREFABS_FOLDER);
  const byId = new Map<string, MergedPrefab>();
  const catalogs: PrefabCatalogSummary[] = [];
  const invalid: InvalidPrefabCatalog[] = [];
  let overlay: PrefabCatalog | undefined;

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

    const isOverlay = parsed.catalog.id === OVERRIDE_CATALOG_ID;
    catalogs.push({
      id: parsed.catalog.id,
      file,
      prefabs: parsed.catalog.prefabs.length,
      overlay: isOverlay,
    });
    if (isOverlay) {
      overlay = parsed.catalog;
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
  }

  // Last, and replacing: an override says "this prefab is wrong, here is what
  // it is instead". A prefab only the overlay names is added, so a hand-written
  // prefab can live there too.
  for (const prefab of overlay?.prefabs ?? []) {
    byId.set(prefab.id, { ...prefab, catalog: OVERRIDE_CATALOG_ID });
  }

  const prefabs = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return { prefabs, catalogs, invalid };
}

/** One catalogue file, validated. */
export async function loadCatalog(contentDir: string, id: string): Promise<LoadedCatalog> {
  const file = await readJsonFile(contentFilePath(contentDir, PREFABS_FOLDER, id));
  if (file.status === 'not-found') {
    return { status: 'not-found' };
  }
  if (file.status === 'unreadable') {
    return { status: 'invalid', errors: file.errors };
  }
  const parsed = parsePrefabCatalog(file.data);
  return parsed.ok
    ? { status: 'ok', catalog: parsed.catalog, updatedAt: file.updatedAt, size: file.size }
    : { status: 'invalid', errors: parsed.errors };
}

export async function saveCatalog(
  contentDir: string,
  catalog: PrefabCatalog,
): Promise<{ created: boolean; updatedAt: string }> {
  return writeJsonFileAtomically(
    contentFilePath(contentDir, PREFABS_FOLDER, catalog.id),
    serializePrefabCatalog(catalog),
  );
}
