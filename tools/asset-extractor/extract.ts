/**
 * Asset Extractor — reads Unity AssetBundle manifest and catalogs available bundles.
 *
 * Source: a local export of the game's server files (StreamingAssets/SoftRef/).
 * Pass the SoftRef directory as the first argument or set WOV_SOFTREF_DIR;
 * the default is ../../../../server-export/StreamingAssets/SoftRef.
 *
 * The SoftRef system uses hash-named bundles with a YAML manifest describing
 * dependencies between bundles.
 *
 * Full extraction of Unity .assets requires an external Unity asset exporter
 * (a GUI exporter or a bundle extractor); none is bundled here.
 *
 * This script catalogs the bundles and prepares the extraction pipeline.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

// Paths (this package is an ES module: `__dirname` does not exist there)
const __dirname = dirname(fileURLToPath(import.meta.url));
const SOFTREF_DIR =
  process.argv[2] ??
  process.env.WOV_SOFTREF_DIR ??
  resolve(__dirname, '../../../../server-export/StreamingAssets/SoftRef');
const BUNDLES_DIR = join(SOFTREF_DIR, 'Bundles');
const OUTPUT_DIR = resolve(__dirname, '../../assets');

interface BundleInfo {
  hash: string;
  size: number;
  dependencies: string[];
}

function main(): void {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Asset Extractor                        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  // Check source exists
  if (!existsSync(SOFTREF_DIR)) {
    console.error(`[ERROR] SoftRef directory not found: ${SOFTREF_DIR}`);
    console.error('Pass the SoftRef directory as an argument or set WOV_SOFTREF_DIR.');
    process.exit(1);
  }

  // Read manifest
  const manifestPath = join(SOFTREF_DIR, 'manifest');
  if (!existsSync(manifestPath)) {
    console.error(`[ERROR] Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  console.log('[1/4] Reading manifest...');
  const manifestRaw = readFileSync(manifestPath, 'utf-8');
  const manifest = parseYaml(manifestRaw) as {
    version: number;
    'bundles directory': string;
    'bundle dependencies': Array<{ bundle: string; dependencies: string[] }>;
  };

  console.log(`  Manifest version: ${manifest.version}`);
  console.log(`  Bundle dependencies: ${manifest['bundle dependencies'].length} entries`);

  // Catalog bundles
  console.log('[2/4] Cataloging bundles...');
  const bundleFiles = readdirSync(BUNDLES_DIR);
  console.log(`  Found ${bundleFiles.length} bundle files`);

  const bundles: BundleInfo[] = [];
  let totalSize = 0;

  for (const file of bundleFiles) {
    const filePath = join(BUNDLES_DIR, file);
    const stat = readFileSync(filePath);
    const size = stat.length;
    totalSize += size;

    const dep = manifest['bundle dependencies'].find(d => d.bundle === file);
    bundles.push({
      hash: file,
      size,
      dependencies: dep?.dependencies ?? [],
    });
  }

  console.log(`  Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

  // Create output directory
  console.log('[3/4] Preparing output directory...');
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'models'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'textures'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'audio'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'catalog'), { recursive: true });

  // Write catalog
  console.log('[4/4] Writing bundle catalog...');
  const catalog = {
    version: manifest.version,
    totalBundles: bundles.length,
    totalSizeMB: totalSize / 1024 / 1024,
    bundles: bundles.map(b => ({
      hash: b.hash,
      sizeKB: b.size / 1024,
      dependencies: b.dependencies,
    })),
  };

  writeFileSync(
    join(OUTPUT_DIR, 'catalog/bundles.json'),
    JSON.stringify(catalog, null, 2)
  );

  console.log();
  console.log('═══════════════════════════════════════════');
  console.log('Bundle catalog written to assets/catalog/bundles.json');
  console.log();
  console.log('NEXT STEPS for full asset extraction:');
  console.log('  1. Get a Unity asset exporter that can open AssetBundles.');
  console.log('  2. Open each bundle from:');
  console.log(`     ${BUNDLES_DIR}`);
  console.log('  3. Export as glTF/GLB to:');
  console.log(`     ${join(OUTPUT_DIR, 'models')}`);
  console.log('  4. Convert textures to KTX2 using:');
  console.log('     npx @gltf-transform/cli ktx2 --format etc1s');
  console.log('  5. Optimize meshes with Draco:');
  console.log('     npx @gltf-transform/cli draco --method edgebreaker');
  console.log('═══════════════════════════════════════════');
}

main();
