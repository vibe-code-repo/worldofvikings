/**
 * The game's half of sound: where a clip's bytes are, and which ground the
 * player is standing on.
 *
 * `@wov/engine` owns the audio engine, the profile and `applyWorldSound`; this
 * module is the wiring only that side of the boundary can do — the asset store's
 * URLs (ADR-0015), the zone's entity list, and the terrain tile the splat probe
 * has to be fitted against (ADR-0053). The editor will have its own file with
 * the same shape and different answers, exactly as `zone-terrain.ts` is the
 * editor's answer to `loadZoneTerrain`.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { assetStoreUrl, assetUrl, type AssetSourceConfig } from '@wov/asset-system';
import {
  createTerrainSurfaceProbe,
  decodeSplatImage,
  fitTileUv,
  type ClipSource,
  type SplatImage,
  type TerrainSurfaceProbe,
} from '@wov/engine';

/**
 * The one stand-in every private audio clip falls back to (ADR-0054).
 *
 * A quarter second of silence, shared by all 44 rows. A mesh placeholder has to
 * have the right hull, which is why each mesh gets its own; silence has no hull.
 */
const AUDIO_PLACEHOLDER = 'placeholders/audio/silence.wav';

/** Where one clip's bytes are, and what to play instead if they are not there. */
export function clipSource(source: AssetSourceConfig, path: string): ClipSource {
  return { url: assetStoreUrl(source, path), fallbackUrl: assetUrl(source, AUDIO_PLACEHOLDER) };
}

/** What {@link createZoneSurfaceProbe} needs to fit a probe to a tile. */
export interface ZoneSurfaceProbeOptions {
  /** The ground meshes, as `loadZoneTerrain` handed them over. */
  readonly meshes: readonly AbstractMesh[];
  /** The splat map paths from the world file, in order. */
  readonly splat: readonly string[];
  /** How many layers the terrain has; the probe reads that many channels. */
  readonly layerCount: number;
  readonly source: AssetSourceConfig;
}

/**
 * Fits a splat probe to a zone's ground.
 *
 * Three things can go wrong and all three are answered with a probe that says
 * `unmapped` rather than with a throw, because a village whose footsteps are
 * all gravel is a worse village and a village that fails to load is not a
 * village: the splat maps may not decode (a clean clone has none), the tile may
 * carry no uv attribute, and the uv may not be affine in x and z.
 *
 * The largest mesh is the one fitted. The village's ground is a single adaptive
 * tile, but the format allows several, and the biggest one is the one the player
 * is overwhelmingly likely to be standing on — a choice worth stating, because
 * the alternative (fitting each and picking per query) is a matrix inverse per
 * mesh per footstep for a case that does not exist yet.
 */
export async function createZoneSurfaceProbe(
  options: ZoneSurfaceProbeOptions,
): Promise<TerrainSurfaceProbe> {
  const { meshes, splat, layerCount, source } = options;

  const maps: SplatImage[] = [];
  for (const path of splat) {
    try {
      maps.push(await decodeSplatImage(assetStoreUrl(source, path)));
    } catch {
      // The map the material is drawing with could not be decoded here. Not
      // fatal, and not silent: the probe reports `unmapped` below.
      break;
    }
  }

  const tile = largestMesh(meshes);
  const positions = tile?.getVerticesData(VertexBuffer.PositionKind) ?? null;
  const uvs = tile?.getVerticesData(VertexBuffer.UVKind) ?? null;
  if (tile === null || positions === null || uvs === null) {
    return createTerrainSurfaceProbe({
      maps: [],
      fit: {
        u: { offset: 0, scale: 0, residual: Number.POSITIVE_INFINITY },
        v: { offset: 0, scale: 0, residual: Number.POSITIVE_INFINITY },
        usable: false,
      },
      layerCount,
      worldToLocal: (x, z) => [x, z],
    });
  }

  const fit = fitTileUv(positions, uvs);

  // The tile does not move (ADR-0035), so its inverse world matrix is computed
  // once here rather than per footstep. `Matrix.Invert` allocates; a version of
  // this that ran per step would be an allocation sixty times a second for a
  // matrix that never changes.
  const toLocal = Matrix.Invert(tile.computeWorldMatrix(true));
  const probePoint = Vector3.Zero();

  return createTerrainSurfaceProbe({
    maps,
    fit,
    layerCount,
    worldToLocal: (x, z) => {
      probePoint.set(x, 0, z);
      const local = Vector3.TransformCoordinates(probePoint, toLocal);
      return [local.x, local.z];
    },
  });
}

/** The mesh with the most vertices, or `null` when there are none. */
function largestMesh(meshes: readonly AbstractMesh[]): AbstractMesh | null {
  let best: AbstractMesh | null = null;
  let bestCount = -1;
  for (const mesh of meshes) {
    const count = mesh.getTotalVertices();
    if (count > bestCount) {
      best = mesh;
      bestCount = count;
    }
  }
  return best;
}
