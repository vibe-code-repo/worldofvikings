/**
 * `pnpm generate:prefabs` — writes `content/prefabs/imported.json` from
 * `assets/manifest.json` (ADR-0016).
 *
 * ```bash
 * pnpm generate:prefabs                       # store from WOV_ASSET_STORE
 * pnpm generate:prefabs --store <store>       # or named explicitly
 * ```
 *
 * Run it after the asset manifest changes. The result is committed: it is world
 * data derived once from the manifest, not something the game builds at
 * runtime, and a clone with no asset store still gets the full prefab list.
 *
 * **Where the work happens.** In `@wov/content-build`, not here — the editor's
 * *World → Regenerate prefab catalogue* runs the very same function through the
 * API (ADR-0033). This file is the command line around it.
 *
 * **Why a store is needed.** A tree's collision shape is a box around its
 * *trunk*, and the only place a trunk's width is written down is the model
 * (ADR-0026). A run without a store fails on the first tree instead of quietly
 * filing a crown as a trunk.
 *
 * The output is formatted with Prettier — the repository's own formatter,
 * already a dev dependency — so that a regeneration never shows up as a
 * `pnpm format` diff.
 */
import { join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { IMPORTED_CATALOG_ID, generatePrefabCatalog } from '@wov/content-build';
import type { PrefabCatalog } from '@wov/world-schema';
import { repoRoot } from './repo-root.js';

const storeArgument = process.argv.indexOf('--store');
const storeDir =
  storeArgument >= 0
    ? resolve(process.argv[storeArgument + 1] ?? '')
    : (process.env['WOV_ASSET_STORE']?.trim() ?? '') !== ''
      ? resolve(process.env['WOV_ASSET_STORE'] ?? '')
      : undefined;

const contentDir = join(repoRoot, 'content');
const catalogFile = join(contentDir, 'prefabs', `${IMPORTED_CATALOG_ID}.json`);

const result = await generatePrefabCatalog({
  manifestFile: join(repoRoot, 'assets', 'manifest.json'),
  assetsDir: join(repoRoot, 'assets'),
  storeDir,
  contentDir,
  dryRun: process.argv.includes('--dry-run'),
  serialize: async (catalog: PrefabCatalog) =>
    format(JSON.stringify(catalog), {
      ...(await resolveConfig(catalogFile)),
      filepath: catalogFile,
      parser: 'json',
    }),
});

if (!result.ok) {
  process.stderr.write('FAIL the prefab catalogue was not written\n');
  for (const message of result.errors) {
    process.stderr.write(`       ${message}\n`);
  }
  process.exit(1);
}

const { report } = result;
const shapes = report.collisionShapes
  .map(({ kind, count }) => `${String(count)} ${kind}`)
  .join(', ');

process.stdout.write(
  `${report.dryRun ? 'would write' : 'wrote'} content/prefabs/${IMPORTED_CATALOG_ID}.json ` +
    `(${String(report.prefabs)} prefabs from ${String(report.assets)} assets)\n` +
    `collision: ${shapes} — ${String(report.trunksMeasured)} trunk(s) measured on the model\n`,
);
