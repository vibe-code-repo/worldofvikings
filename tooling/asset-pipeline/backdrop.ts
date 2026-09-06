/**
 * Building one backdrop store model out of a source shell and a panorama.
 *
 * A backdrop is the part of the view nobody ever walks to — the mountain range
 * on the horizon, the shell of sky above it, the clouds hanging in front of it.
 * Which files that is, what they are called here and how large one may be lives
 * in `@wov/content-build` (`backdrop.ts`), because the scene import needs the
 * same answers and the editor runs that import too. What is left here is the
 * part only `pnpm import:backdrop` needs: the panorama's pixel ceiling and the
 * rewrite that turns a source shell into a store model.
 *
 * **Why the models come from the export and not from the scene bundle.** The
 * bundle has both mountain shells pointing at *one* embedded image, because the
 * exporter wrote the mesh reference and dropped the material that told them
 * apart. The export folder still has both panoramas as separate files, so
 * reading them from there is the difference between two backdrops and one
 * backdrop drawn twice.
 *
 * Deterministic: the same export produces byte-identical store files.
 */
import { applySurfaces } from './material-binding.js';
import type { Glb, Gltf } from '@wov/content-build';

/**
 * The widest and tallest a backdrop panorama may be, in pixels.
 *
 * Twice the store's usual 2 048 px ceiling on the long side, and the exception
 * is measured rather than granted: this one image is stretched over the whole
 * 360° horizon, so 4 096 px is 11.4 texels per degree, while a 1 920 px viewport
 * at a 60° field of view wants 32. Halving it to 2 048 would put 5.7 texels per
 * degree behind the village — visibly soft on the one surface that fills the
 * top half of every outdoor screenshot. Every other texture in the store covers
 * a few metres of a model and gets nothing from the extra pixels.
 *
 * The height is *not* doubled: the panorama is 2:1, and its vertical half is
 * already 2 048 px over roughly 40° of elevation.
 */
export const PANORAMA_MAX_WIDTH = 4096;
export const PANORAMA_MAX_HEIGHT = 2048;

/** Whether an image may be stored at its full size as a panorama. */
export function fitsPanorama(width: number, height: number): boolean {
  return width <= PANORAMA_MAX_WIDTH && height <= PANORAMA_MAX_HEIGHT;
}

/**
 * Rewrites a source shell into a store model: one material, one texture URI.
 *
 * **No vertex is touched.** Positions, normals, tangents and UVs are the ones
 * the export wrote — the shell's smooth normals are what make a painted range
 * read as distance, and recomputing them would be the same mistake as
 * smoothing a flat-shaded cliff.
 *
 * The material is replaced rather than edited: the source file arrives with the
 * exporter's default material and no texture at all, so there is nothing in it
 * to keep. Its new name is what {@link applySurfaces} looks up in the surface
 * table, which is where `MASK`, `doubleSided` and the metalness fix come from.
 *
 * @param glb the source model, modified in place and returned.
 * @param stem the store stem; the root node, the material and the texture file
 *   all take their name from it, so a file says what it is on its own.
 */
export function buildBackdropModel(glb: Glb, stem: string, texture: string | undefined): Glb {
  const json: Gltf = glb.json;

  json.materials = [{ name: stem, pbrMetallicRoughness: {} }];
  if (texture !== undefined) {
    json.images = [{ uri: texture }];
    json.textures = [{ source: 0 }];
    const pbr = json.materials[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
    pbr['baseColorTexture'] = { index: 0 };
  } else {
    delete json.images;
    delete json.textures;
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      primitive.material = 0;
    }
  }

  // The store file, its placeholder and the node inside it share one name
  // (ADR-0015), and it is never the source file's name (rule 1 of docs/assets.md).
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const [index, node] of (json.nodes ?? []).entries()) {
    node.name = roots.includes(index) ? stem : `${stem}-${String(index)}`;
  }

  applySurfaces(json);
  return glb;
}
