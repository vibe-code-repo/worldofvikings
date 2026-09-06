/**
 * The terrain probe: one real height field with its real splat layers, loaded
 * over the asset server and put into the scene (ADR-0020).
 *
 * `VILLAGE_TERRAIN` is **not world data.** It is the same shape as a zone's
 * `terrain` in `content/worlds/*.json` and carries the same numbers, but it
 * lives here as a fixture that proves the whole path — store file, splat
 * material, collision mesh — the way `PROBE_PROPS` proves the model path. It
 * goes away when the game loads a world file in Phase 4, and the one thing that
 * has to change then is where these five fields come from.
 *
 * The layer *order* is the open question this probe exists to answer: the export
 * says which six textures the tile uses and which two maps weight them, but not
 * which channel drives which texture. `?terrain-layers=` permutes them so the
 * candidates can be compared in a screenshot instead of argued about; the order
 * below is the one that was chosen, and `docs/world-format.md` says why.
 */
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { createTerrain, type TerrainHandle, type TerrainTextureSource } from '@wov/engine';
import {
  AssetManager,
  assetStoreUrl,
  assetUrl,
  createAssetCatalog,
  resolveAssetSourceConfig,
} from '@wov/asset-system';
import type { AssetEnv, AssetSourceConfig } from '@wov/asset-system';

/** One ground texture of the probe, by store path. */
export interface TerrainProbeLayer {
  readonly asset: string;
  /** Edge length of one repeat of the texture, in metres. */
  readonly tileSize: number;
}

/** A zone's ground, in the shape `zone.terrain` has in a world file. */
export interface TerrainProbe {
  readonly name: string;
  readonly heightField: string;
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly layers: readonly TerrainProbeLayer[];
  readonly splat: readonly string[];
}

/** The stand-in a private texture falls back to when there is no store. */
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

/**
 * The village tile: 300 × 300 m, six ground textures, two splat maps.
 *
 * `position` is `[0, 0, 0]` because the thinned height field keeps the corner
 * origin the export gave it, so the tile covers `0…300 m` in x and z exactly as
 * the source data does. `tileSize` is 2 m for every layer except the rough rock,
 * which is authored at 3 m — both read off the source material settings.
 *
 * **The layer order is the channel order**, and it is the answer to the question
 * the export does not record: which splat channel drives which texture. It was
 * settled by correlating each channel's weight against the height field's own
 * slope over all 512² texels and then looking at the three candidates on screen
 * (ADR-0020, `docs/world-format.md`):
 *
 * | Channel | Coverage | Mean slope | Texture           |
 * | ------- | -------- | ---------- | ----------------- |
 * | A.r     | 3.5 %    | 0.54       | second grass      |
 * | A.g     | 16.8 %   | 0.85 ↑     | dark rock wall    |
 * | A.b     | 57.4 %   | 0.53       | meadow grass      |
 * | A.a     | 15.3 %   | 0.39 ↓     | gravel and sand   |
 * | B.r     | 0.1 %    | 0.67       | rough rock        |
 * | B.g     | 6.8 %    | 0.63       | dark moss         |
 *
 * The tile's mean slope is 0.57. `A.g` is the only channel that rises with the
 * ground and `A.a` the only one that falls with it, which is what fixes rock and
 * gravel; `A.b` is the majority surface and therefore the meadow.
 */
export const VILLAGE_TERRAIN: TerrainProbe = {
  name: 'village-terrain',
  heightField: 'terrain/terrain-village1-257.glb',
  position: [0, 0, 0],
  size: [300, 300],
  layers: [
    { asset: 'textures/terrain-grass-b.png', tileSize: 2 },
    { asset: 'textures/terrain-rock-a.png', tileSize: 2 },
    { asset: 'textures/terrain-grass-a.png', tileSize: 2 },
    { asset: 'textures/terrain-gravel.png', tileSize: 2 },
    { asset: 'textures/terrain-rock-rough.png', tileSize: 3 },
    { asset: 'textures/terrain-moss.png', tileSize: 2 },
  ],
  splat: ['textures/village-splat-a.png', 'textures/village-splat-b.png'],
};

/** Where the player is put down once the ground is there: the tile's middle. */
export const VILLAGE_SPAWN: readonly [number, number] = [150, 150];

/**
 * Reads a `x,z` spawn override off the query string.
 *
 * The probe covers 300 × 300 m and the interesting parts of it — the paths, the
 * cliffs — are nowhere near the middle. Putting the capsule down somewhere else
 * is how a screenshot can show them; anything malformed falls back to the
 * middle rather than dropping the player outside the tile.
 */
export function spawnFromQuery(
  value: string | null,
  size: readonly [number, number],
): readonly [number, number] {
  if (value === null) {
    return VILLAGE_SPAWN;
  }
  const parts = value.split(',').map((part) => Number.parseFloat(part.trim()));
  const [x, z] = parts;
  if (parts.length !== 2 || x === undefined || z === undefined) {
    return VILLAGE_SPAWN;
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return VILLAGE_SPAWN;
  }
  if (x < 0 || z < 0 || x > size[0] || z > size[1]) {
    return VILLAGE_SPAWN;
  }
  return [x, z];
}

/**
 * Reorders the layers, so two candidate channel assignments can be compared in
 * the same build.
 *
 * A permutation is a list of layer indices: `?terrain-layers=4,0,2,3,1,5` means
 * "channel R drives what is layer 4 in the table above". Anything malformed is
 * ignored and the table's own order is used — a probe that silently renders a
 * different ground than it says would answer the wrong question.
 */
export function permuteLayers(
  layers: readonly TerrainProbeLayer[],
  order: string | null,
): readonly TerrainProbeLayer[] {
  if (order === null || order.trim() === '') {
    return layers;
  }
  const indices = order.split(',').map((part) => Number.parseInt(part.trim(), 10));
  const valid =
    indices.length === layers.length &&
    indices.every((index) => Number.isInteger(index) && index >= 0 && index < layers.length) &&
    new Set(indices).size === indices.length;
  if (!valid) {
    return layers;
  }
  return indices.map((index) => layers[index] as TerrainProbeLayer);
}

/** Store URL plus the committed stand-in, for one private texture. */
function textureSource(source: AssetSourceConfig, path: string): TerrainTextureSource {
  return { url: assetStoreUrl(source, path), fallbackUrl: assetUrl(source, TEXTURE_PLACEHOLDER) };
}

/** What {@link loadTerrainProbe} reports back. */
export interface TerrainProbeResult {
  readonly terrain: TerrainHandle;
  /** How many of the height field's bytes came from where. */
  readonly fromPlaceholder: boolean;
}

/**
 * Loads the height field and puts the tile into the scene.
 *
 * The model goes through {@link AssetManager} so that a clone with no asset
 * store still gets the committed hull box instead of an exception (ADR-0015);
 * the textures go straight to a URL, because a texture has no container to load
 * and its stand-in is one shared grey image.
 *
 * @throws {Error} when the height field loads but carries no mesh — a tile with
 * nothing to stand on is worse than a missing one, because the player falls
 * through it silently.
 */
export async function loadTerrainProbe(
  scene: Scene,
  env: AssetEnv,
  probe: TerrainProbe,
  layerOrder: string | null = null,
): Promise<TerrainProbeResult> {
  const source = resolveAssetSourceConfig(env);
  const placeholder = `placeholders/${probe.heightField}`;
  const manager = new AssetManager({
    source,
    scene,
    catalog: createAssetCatalog([{ path: probe.heightField, visibility: 'private', placeholder }]),
  });

  const entries = await manager.instantiate(probe.heightField);
  const root = entries.rootNodes.find(
    (node): node is TransformNode => node instanceof TransformNode,
  );
  if (root === undefined) {
    throw new Error(`terrain "${probe.heightField}" instantiated no transform node`);
  }

  const layers = permuteLayers(probe.layers, layerOrder);
  const terrain = createTerrain(scene, root, {
    name: probe.name,
    position: [probe.position[0], probe.position[1], probe.position[2]],
    size: [probe.size[0], probe.size[1]],
    layers: layers.map((layer) => ({
      ...textureSource(source, layer.asset),
      tileSize: layer.tileSize,
    })),
    splat: probe.splat.map((path) => textureSource(source, path)),
  });

  if (terrain.meshes.length === 0) {
    terrain.dispose();
    throw new Error(`terrain "${probe.heightField}" has no mesh to stand on`);
  }

  return { terrain, fromPlaceholder: manager.sources().placeholder > 0 };
}
