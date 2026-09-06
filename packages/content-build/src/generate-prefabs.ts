/**
 * Regenerating `<contentDir>/prefabs/imported.json` from the asset manifest, as
 * one function (ADR-0016, ADR-0026, ADR-0033).
 *
 * Same arrangement as `import-scene.ts`: `pnpm generate:prefabs` and the
 * editor's *World → Regenerate prefab catalogue* both call
 * {@link generatePrefabCatalog}, so the two can never drift apart.
 *
 * **Why it reads the asset store.** A tree's collision shape is a box around
 * its *trunk*, and the only place a trunk's width is written down is the model
 * (ADR-0026). A run without a store therefore fails on the first tree instead
 * of quietly filing a crown as a trunk.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePrefabCatalog, type PrefabCatalog } from '@wov/world-schema';
import { parseAssetManifest, type AssetEntry } from '@wov/asset-system/manifest';
import { measureTrunkBox, roundBounds } from './collision.js';
import { readGlb, worldPositions, type Bounds } from './glb.js';
import {
  IMPORTED_CATALOG_ID,
  buildImportedCatalog,
  hasTrunk,
  isPlaceableAsset,
} from './prefab-catalog.js';

export interface GeneratePrefabsOptions {
  /** `assets/manifest.json` of the checkout being built. */
  readonly manifestFile: string;
  /** Root of the repository's public assets, for a `public` model's bytes. */
  readonly assetsDir: string;
  /** Root of the private asset store, or `undefined` when there is none. */
  readonly storeDir?: string | undefined;
  /** `content/` of a checkout, or the API's `CONTENT_DIR`. */
  readonly contentDir: string;
  /** Report only; nothing is written. */
  readonly dryRun?: boolean;
  /** How the catalogue file is spelled on disk — see `SceneImportOptions`. */
  readonly serialize?: (catalog: PrefabCatalog) => string | Promise<string>;
}

export interface GeneratePrefabsReport {
  readonly catalogId: string;
  readonly assets: number;
  readonly prefabs: number;
  /** How many trunks were measured on the model rather than guessed. */
  readonly trunksMeasured: number;
  /** Prefab count per collision kind, `undecided` for a prefab with none. */
  readonly collisionShapes: readonly { readonly kind: string; readonly count: number }[];
  readonly dryRun: boolean;
}

export type GeneratePrefabsResult =
  | { readonly ok: true; readonly catalog: PrefabCatalog; readonly report: GeneratePrefabsReport }
  | { readonly ok: false; readonly errors: readonly string[] };

function defaultSerialize(catalog: PrefabCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Where a model's bytes are: the store for a private asset, `assets/` for a public one. */
function fileOf(options: GeneratePrefabsOptions, entry: AssetEntry): string {
  return entry.visibility === 'private'
    ? join(options.storeDir ?? '', entry.path)
    : join(options.assetsDir, entry.path);
}

export async function generatePrefabCatalog(
  options: GeneratePrefabsOptions,
): Promise<GeneratePrefabsResult> {
  let manifestText: string;
  try {
    manifestText = await readFile(options.manifestFile, 'utf8');
  } catch {
    return { ok: false, errors: [`cannot read the asset manifest at ${options.manifestFile}`] };
  }
  const manifest = parseAssetManifest(JSON.parse(manifestText));
  if (!manifest.ok) {
    return { ok: false, errors: ['assets/manifest.json is not valid', ...manifest.errors] };
  }

  const trunkBoxes = new Map<string, Bounds>();
  for (const asset of manifest.manifest.assets) {
    if (
      !isPlaceableAsset(asset) ||
      !asset.path.startsWith('vegetation/') ||
      !hasTrunk(asset.path)
    ) {
      continue;
    }
    const file = fileOf(options, asset);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      return {
        ok: false,
        errors: [
          `cannot measure the trunk of "${asset.path}": ${file} is not readable`,
          "a tree's collision box is its trunk, and the manifest only knows its crown — " +
            'point WOV_ASSET_STORE (or --store) at the private asset store',
        ],
      };
    }
    const box = measureTrunkBox(worldPositions(readGlb(bytes)));
    if (box === undefined) {
      return { ok: false, errors: [`"${asset.path}" has no geometry to measure a trunk on`] };
    }
    trunkBoxes.set(asset.path, roundBounds(box));
  }

  let catalog: PrefabCatalog;
  try {
    catalog = buildImportedCatalog(manifest.manifest.assets, { trunkBoxes });
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  // The generator writes content that `pnpm validate:content` will check, so it
  // checks it here first: a broken generator must fail now, not in a pull request.
  const validation = parsePrefabCatalog(catalog);
  if (!validation.ok) {
    return {
      ok: false,
      errors: ['the generated catalogue does not satisfy the prefab schema', ...validation.errors],
    };
  }

  const directory = join(options.contentDir, 'prefabs');
  if (options.dryRun !== true) {
    await mkdir(directory, { recursive: true });
    const serialize = options.serialize ?? defaultSerialize;
    await writeFile(
      join(directory, `${IMPORTED_CATALOG_ID}.json`),
      await serialize(catalog),
      'utf8',
    );
  }

  const shapes = new Map<string, number>();
  for (const prefab of catalog.prefabs) {
    const kind = prefab.collision?.kind ?? 'undecided';
    shapes.set(kind, (shapes.get(kind) ?? 0) + 1);
  }

  return {
    ok: true,
    catalog,
    report: {
      catalogId: catalog.id,
      assets: manifest.manifest.assets.length,
      prefabs: catalog.prefabs.length,
      trunksMeasured: trunkBoxes.size,
      collisionShapes: [...shapes]
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([kind, count]) => ({ kind, count })),
      dryRun: options.dryRun === true,
    },
  };
}
