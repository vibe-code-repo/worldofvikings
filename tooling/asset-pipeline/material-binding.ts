/**
 * Writes the material a scene bundle names into a store model's own glTF.
 *
 * The result is a model that needs nothing but itself and a texture file next
 * to it: one material per bound name, `pbrMetallicRoughness.baseColorTexture`
 * pointing at an `images[].uri` that is a *relative path*, never an embedded
 * blob. `environment/x.glb` refers to `textures/y.png`, which resolves against
 * the model's own URL in any glTF loader — the store is served at
 * `/store/environment/x.glb`, the texture at `/store/environment/textures/y.png`.
 *
 * The URI must not contain `..`: Babylon.js rejects such a reference before it
 * requests anything (`GLTFLoader._ValidateUri`), and the model then silently
 * falls back to its placeholder. That is why the textures sit *below* the model
 * group rather than beside it (ADR-0019).
 *
 * **What is never overwritten.** A primitive whose material already references
 * any texture is authored data — it came out of the export with its material
 * intact — and is left alone but for the metalness fix. Only the untextured
 * materials, `DefaultMaterial` among them, are replaced.
 *
 * **Why UVs are checked.** A base colour texture on a primitive without
 * `TEXCOORD_0` samples nothing and renders black or white depending on the
 * renderer. Three collision meshes in the store are in that state; they are
 * reported rather than given a texture that cannot be read.
 */
import type { Gltf, GltfPrimitive } from './glb.js';
import {
  ALPHA_CUTOFF,
  EMISSIVE_FACTOR,
  METALLIC_FACTOR,
  ROUGHNESS_FACTOR,
  isListedMaterial,
  surfaceFor,
  tintFor,
} from './materials.js';

/** A primitive that was left without a texture, and why. */
export interface UnboundPrimitive {
  readonly vertices: number;
  readonly reason: 'no UVs' | 'not in any scene bundle' | 'material has no texture';
}

/** What one model's binding produced. */
export interface BindingOutcome {
  readonly primitives: number;
  /** Primitives this step gave a textured material. */
  readonly bound: number;
  /** Primitives whose authored material already had a texture. */
  readonly kept: number;
  readonly unbound: readonly UnboundPrimitive[];
  /** Material names written, in the order they were created. */
  readonly materials: readonly string[];
  /** Material names met that the surface table does not list. */
  readonly unlisted: readonly string[];
}

const TEXTURE_SLOTS = [
  'baseColorTexture',
  'metallicRoughnessTexture',
  'normalTexture',
  'occlusionTexture',
  'emissiveTexture',
] as const;

/** Whether an authored material already carries any texture of its own. */
function hasTexture(json: Gltf, materialIndex: number | undefined): boolean {
  if (materialIndex === undefined) {
    return false;
  }
  const material = json.materials?.[materialIndex];
  if (material === undefined) {
    return false;
  }
  const pbr = material['pbrMetallicRoughness'] as Record<string, unknown> | undefined;
  return TEXTURE_SLOTS.some((slot) => (pbr?.[slot] ?? material[slot]) !== undefined);
}

/**
 * Gives one material the settings the surface table asks for.
 *
 * Applied to authored materials as well as written ones: metalness is wrong in
 * both, because the exporter wrote no factors and the glTF default is metal —
 * and so is colour, which is why the leaf and needle masks get their
 * `baseColorFactor` here too. The factor is written when the table names a tint
 * and *removed* when it does not, so that re-importing a store model can only
 * ever produce the colour the table currently states.
 */
function applySurface(material: Record<string, unknown>, name: string): void {
  const surface = surfaceFor(name);
  const pbr = (material['pbrMetallicRoughness'] ?? {}) as Record<string, unknown>;
  pbr['metallicFactor'] = METALLIC_FACTOR;
  pbr['roughnessFactor'] = ROUGHNESS_FACTOR;
  const tint = tintFor(name);
  if (tint === undefined) {
    delete pbr['baseColorFactor'];
  } else {
    pbr['baseColorFactor'] = [...tint];
  }
  material['pbrMetallicRoughness'] = pbr;

  if (surface.alphaMode === 'MASK') {
    material['alphaMode'] = 'MASK';
    material['alphaCutoff'] = ALPHA_CUTOFF;
  } else {
    delete material['alphaMode'];
    delete material['alphaCutoff'];
  }
  material['doubleSided'] = surface.doubleSided;

  if (surface.emissive) {
    material['emissiveFactor'] = [...EMISSIVE_FACTOR];
    const baseColour = pbr['baseColorTexture'];
    if (baseColour !== undefined) {
      // The export has no separate emission map, so the base colour doubles as
      // one: these materials belong to objects that glow as a whole — a crystal,
      // a lit window — not to objects with a glowing part.
      material['emissiveTexture'] = { ...(baseColour as Record<string, unknown>) };
    }
  }
}

/**
 * Gives every material of one model its surface and its colour.
 *
 * Public because two importers write store models: `import-world-assets`
 * reaches it through {@link bindMaterials}, and `import:scene-models`, which
 * cuts a model out of a scene bundle with its authored material already
 * attached, has nothing to bind and calls this alone. Before it did, a bush cut
 * out of the bundle kept the glTF defaults — opaque, single-sided, metallic and
 * grey — while the same leaf card imported from the per-model export was cut
 * out, lit from both sides and green.
 */
export function applySurfaces(json: Gltf): void {
  for (const material of json.materials ?? []) {
    applySurface(material as Record<string, unknown>, material.name ?? '');
  }
}

/** Walks every primitive of every mesh, in file order. */
function primitivesOf(json: Gltf): GltfPrimitive[] {
  return (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
}

function vertexCountOf(json: Gltf, primitive: GltfPrimitive): number | undefined {
  const position = primitive.attributes['POSITION'];
  return position === undefined ? undefined : json.accessors?.[position]?.count;
}

/**
 * Drops materials no primitive points at any more and renumbers the rest.
 *
 * Without it, every rebound model keeps a dangling `DefaultMaterial`. Only
 * untextured materials are ever rebound, so a dropped material never takes a
 * texture or an image reference with it.
 */
export function pruneUnusedMaterials(json: Gltf): number {
  const materials = json.materials;
  if (materials === undefined) {
    return 0;
  }
  const used = new Set<number>();
  for (const primitive of primitivesOf(json)) {
    if (primitive.material !== undefined) {
      used.add(primitive.material);
    }
  }
  const remap = new Map<number, number>();
  const kept: typeof materials = [];
  materials.forEach((material, index) => {
    if (used.has(index)) {
      remap.set(index, kept.length);
      kept.push(material);
    }
  });
  for (const primitive of primitivesOf(json)) {
    if (primitive.material !== undefined) {
      primitive.material = remap.get(primitive.material) ?? primitive.material;
    }
  }
  const dropped = materials.length - kept.length;
  json.materials = kept;
  return dropped;
}

/**
 * Binds materials into one model.
 *
 * @param json the model's glTF, edited in place.
 * @param materialFor the material a primitive of this many vertices wears,
 *   from the scene bundles.
 * @param textureFor the relative URI of a material's base colour file, or
 *   `undefined` when that material has no texture in the export.
 */
export function bindMaterials(
  json: Gltf,
  materialFor: (vertexCount: number) => string | undefined,
  textureFor: (material: string) => string | undefined,
): BindingOutcome {
  const primitives = primitivesOf(json);
  const written = new Map<string, number>();
  const imageByUri = new Map<string, number>();
  const unbound: UnboundPrimitive[] = [];
  const unlisted = new Set<string>();
  let bound = 0;
  let kept = 0;

  const materialIndexFor = (name: string, uri: string): number => {
    const existing = written.get(name);
    if (existing !== undefined) {
      return existing;
    }
    let imageIndex = imageByUri.get(uri);
    if (imageIndex === undefined) {
      json.images ??= [];
      imageIndex = json.images.length;
      json.images.push({ uri, name });
      imageByUri.set(uri, imageIndex);
    }
    json.textures ??= [];
    const textureIndex = json.textures.length;
    json.textures.push({ source: imageIndex });

    const material: Record<string, unknown> = {
      name,
      pbrMetallicRoughness: { baseColorTexture: { index: textureIndex } },
    };
    json.materials ??= [];
    const index = json.materials.length;
    json.materials.push(material);
    written.set(name, index);
    return index;
  };

  for (const primitive of primitives) {
    const vertices = vertexCountOf(json, primitive) ?? 0;

    if (hasTexture(json, primitive.material)) {
      const material = json.materials?.[primitive.material as number];
      if (material !== undefined && !isListedMaterial(material.name ?? '')) {
        unlisted.add(material.name ?? '');
      }
      kept += 1;
      continue;
    }

    if (primitive.attributes['TEXCOORD_0'] === undefined) {
      unbound.push({ vertices, reason: 'no UVs' });
      continue;
    }
    const name = materialFor(vertices);
    if (name === undefined) {
      unbound.push({ vertices, reason: 'not in any scene bundle' });
      continue;
    }
    if (!isListedMaterial(name)) {
      unlisted.add(name);
    }
    const uri = textureFor(name);
    if (uri === undefined) {
      unbound.push({ vertices, reason: 'material has no texture' });
      continue;
    }
    primitive.material = materialIndexFor(name, uri);
    bound += 1;
  }

  pruneUnusedMaterials(json);

  // Every material, not only the bound ones: an untextured `DefaultMaterial`
  // left at the glTF defaults is metallic 1 / rough 1, which draws a model that
  // has no texture as dark chrome rather than as plain grey.
  applySurfaces(json);

  return {
    primitives: primitives.length,
    bound,
    kept,
    unbound,
    materials: [...written.keys()],
    unlisted: [...unlisted].sort(),
  };
}
