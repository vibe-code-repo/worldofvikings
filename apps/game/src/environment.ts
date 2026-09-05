/**
 * The environment probe.
 *
 * Licensed models, loaded through the asset server and placed next to the
 * ground, so that "the asset pipeline works" is something you can see and the
 * smoke test can assert instead of something we claim.
 *
 * `PROBE_PROPS` is **not world data.** The world is authored in the editor and
 * loaded from `content/` from Phase 4 on (agent rule 9); this list is a fixture
 * that proves the path from a served file into the scene, and it goes away when
 * a real world file takes over.
 *
 * Each prop names its own visibility, and `PROBE_CATALOG` is built from that
 * list rather than from `assets/manifest.json`: the manifest is Zod-validated
 * and the game must not be able to reach it (ADR-0012, ADR-0015). When world
 * data arrives, the catalog is built from the zone's asset list the same way.
 */
import type { Scene } from '@babylonjs/core/scene';
import {
  AssetManager,
  createAssetCatalog,
  placeAssets,
  resolveAssetSourceConfig,
} from '@wov/asset-system';
import type {
  AssetCatalogEntry,
  AssetEnv,
  AssetPlacement,
  AssetSourceCounts,
  PlacementResult,
} from '@wov/asset-system';

/** A placement plus where its bytes come from. */
export interface ProbeProp extends AssetPlacement {
  readonly catalog: AssetCatalogEntry;
}

/**
 * What the probe places: one public asset and two private ones.
 *
 * The public barrel proves the vendored path from `assets/`. The two private
 * assets prove the other one — a store request, and a fall back to the
 * committed hull box when there is no store (ADR-0015). Both are needed,
 * because they are different code paths and only one of them runs on a clean
 * clone.
 *
 * None of them is scaled: the imported assets are in metres with the origin
 * their author gave them, so `position` is where they stand. The Kenney barrel
 * is the exception — that kit is authored at roughly a third of a metre per
 * unit, so it is scaled up to read as a barrel rather than a speck. See
 * `docs/asset-licenses.md` for source, author, licence and modification status.
 */
export const PROBE_PROPS: readonly ProbeProp[] = [
  {
    asset: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb',
    name: 'probe-barrel',
    position: [4, 0, 0],
    scale: 8,
    catalog: {
      path: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb',
      visibility: 'public',
    },
  },
  {
    // A building: 8.5 x 8.8 x 6.8 m, standing beside the base ground.
    asset: 'environment/sm-bld-preset-shelter-02-optimized.glb',
    name: 'probe-shelter',
    position: [-10, 0, 6],
    catalog: {
      path: 'environment/sm-bld-preset-shelter-02-optimized.glb',
      visibility: 'private',
      placeholder: 'placeholders/environment/sm-bld-preset-shelter-02-optimized.glb',
    },
  },
  {
    // A terrain patch: 20 x 20 m of height field rising to 10 m, standing in
    // front of the player's start so it is visible without walking, and lifted
    // a few centimetres so its flat edge does not fight the base ground for
    // pixels.
    asset: 'terrain/terrain-customization.glb',
    name: 'probe-terrain',
    position: [0, 0.05, 24],
    catalog: {
      path: 'terrain/terrain-customization.glb',
      visibility: 'private',
      placeholder: 'placeholders/terrain/terrain-customization.glb',
    },
  },
];

/** Which of {@link PROBE_PROPS} live in the private store, and their stand-ins. */
export const PROBE_CATALOG = createAssetCatalog(PROBE_PROPS.map((prop) => prop.catalog));

/** What {@link loadEnvironment} reports: what was placed, and where it came from. */
export interface EnvironmentResult {
  readonly placement: PlacementResult;
  readonly sources: AssetSourceCounts;
}

/**
 * Loads and places {@link PROBE_PROPS} into a scene.
 *
 * The {@link AssetManager} it creates lives as long as the page: the cache is
 * the point, and there is nothing yet that would tear a scene down. When zone
 * streaming arrives, the manager becomes something the caller owns and disposes.
 *
 * @param scene the scene the loaded meshes belong to.
 * @param env `import.meta.env`; the asset host comes from `VITE_ASSET_URL` and
 * falls back to the local asset server, so a clean clone needs no `.env`.
 */
export async function loadEnvironment(scene: Scene, env: AssetEnv): Promise<EnvironmentResult> {
  const manager = new AssetManager({
    source: resolveAssetSourceConfig(env),
    scene,
    catalog: PROBE_CATALOG,
  });
  const placement = await placeAssets(manager, PROBE_PROPS);
  return { placement, sources: manager.sources() };
}
