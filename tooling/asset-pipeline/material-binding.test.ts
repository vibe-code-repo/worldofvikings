import { describe, expect, it } from 'vitest';
import type { Gltf } from './glb.js';
import { bindMaterials, pruneUnusedMaterials } from './material-binding.js';

/** A store model as the per-model export leaves it: one untextured material. */
function untexturedModel(vertexCounts: number[], withUvs = true): Gltf {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'tree-1a3', mesh: 0 }],
    meshes: [
      {
        primitives: vertexCounts.map((_, index) => ({
          attributes: withUvs
            ? { POSITION: index, TEXCOORD_0: index }
            : ({ POSITION: index } as Record<string, number>),
          material: 0,
        })),
      },
    ],
    accessors: vertexCounts.map((count) => ({ componentType: 5126, count, type: 'VEC3' })),
    materials: [{ name: 'DefaultMaterial' }],
  };
}

const trunkAndLeaves = (vertices: number): string | undefined =>
  vertices === 2564 ? 'Birch_Bark_A' : vertices === 14852 ? 'Leaves Birch 1' : undefined;

const textureFor = (material: string): string | undefined =>
  material === 'Birch_Bark_A'
    ? 'textures/birch-bark-a-c6f2bd38.png'
    : material === 'Leaves Birch 1'
      ? 'textures/leaves-birch-1-11223344.png'
      : undefined;

describe('bindMaterials', () => {
  it('gives each primitive the material its vertex count wears, not its position', () => {
    const json = untexturedModel([14852, 2564]);
    const outcome = bindMaterials(json, trunkAndLeaves, textureFor);

    expect(outcome.bound).toBe(2);
    expect(outcome.materials).toEqual(['Leaves Birch 1', 'Birch_Bark_A']);
    const names = json.meshes?.[0]?.primitives.map(
      (primitive) => json.materials?.[primitive.material as number]?.name,
    );
    expect(names).toEqual(['Leaves Birch 1', 'Birch_Bark_A']);
  });

  it('points the base colour at a relative file and embeds nothing', () => {
    const json = untexturedModel([2564]);
    bindMaterials(json, trunkAndLeaves, textureFor);

    expect(json.images).toEqual([
      { uri: 'textures/birch-bark-a-c6f2bd38.png', name: 'Birch_Bark_A' },
    ]);
    expect(json.images?.[0]?.bufferView).toBeUndefined();
    const material = json.materials?.[0] as Record<string, unknown>;
    const pbr = material['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(pbr['baseColorTexture']).toEqual({ index: 0 });
    expect(json.textures?.[0]).toEqual({ source: 0 });
  });

  it('writes metallic 0 and roughness 1, or the model renders as rough metal', () => {
    const json = untexturedModel([2564]);
    bindMaterials(json, trunkAndLeaves, textureFor);
    const pbr = json.materials?.[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(pbr['metallicFactor']).toBe(0);
    expect(pbr['roughnessFactor']).toBe(1);
  });

  it('cuts out and double-sides foliage, and leaves bark solid', () => {
    const json = untexturedModel([2564, 14852]);
    bindMaterials(json, trunkAndLeaves, textureFor);
    const bark = json.materials?.find((material) => material.name === 'Birch_Bark_A');
    const leaves = json.materials?.find((material) => material.name === 'Leaves Birch 1');

    expect(leaves?.['alphaMode']).toBe('MASK');
    expect(leaves?.['alphaCutoff']).toBe(0.5);
    expect(leaves?.['doubleSided']).toBe(true);
    expect(bark?.['alphaMode']).toBeUndefined();
    expect(bark?.['doubleSided']).toBe(false);
  });

  it('shares one material between primitives that wear the same one', () => {
    const json = untexturedModel([2564, 2564]);
    bindMaterials(json, trunkAndLeaves, textureFor);
    expect(json.materials).toHaveLength(1);
    expect(json.images).toHaveLength(1);
  });

  it('leaves an authored textured material alone but fixes its metalness', () => {
    const json = untexturedModel([2564]);
    json.materials = [
      {
        name: 'Oak_Bark_A',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      },
    ];
    json.textures = [{ source: 0 }];
    json.images = [{ uri: 'textures/oak-bark-a-deadbeef.png' }];

    const outcome = bindMaterials(json, trunkAndLeaves, textureFor);

    expect(outcome.kept).toBe(1);
    expect(outcome.bound).toBe(0);
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0]?.name).toBe('Oak_Bark_A');
    const pbr = json.materials[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(pbr['metallicFactor']).toBe(0);
    expect(pbr['baseColorTexture']).toEqual({ index: 0 });
  });

  it('refuses a primitive without UVs, where a texture would sample nothing', () => {
    const json = untexturedModel([2564], false);
    const outcome = bindMaterials(json, trunkAndLeaves, textureFor);
    expect(outcome.bound).toBe(0);
    expect(outcome.unbound).toEqual([{ vertices: 2564, reason: 'no UVs' }]);
  });

  it('reports a model no scene bundle knows', () => {
    const json = untexturedModel([999]);
    const outcome = bindMaterials(json, trunkAndLeaves, textureFor);
    expect(outcome.unbound).toEqual([{ vertices: 999, reason: 'not in any scene bundle' }]);
  });

  it('reports a material the export gave no texture', () => {
    const json = untexturedModel([2564]);
    const outcome = bindMaterials(json, trunkAndLeaves, () => undefined);
    expect(outcome.unbound).toEqual([{ vertices: 2564, reason: 'material has no texture' }]);
  });

  it('names a material the surface table does not list', () => {
    const json = untexturedModel([2564]);
    const outcome = bindMaterials(
      json,
      () => 'Some_New_Material',
      () => 'textures/x-00000000.png',
    );
    expect(outcome.unlisted).toEqual(['Some_New_Material']);
    expect(json.materials?.[0]?.['alphaMode']).toBeUndefined();
  });

  it('fixes the metalness of a material it could not bind, so it draws as grey and not as chrome', () => {
    const json = untexturedModel([999]);
    bindMaterials(json, trunkAndLeaves, textureFor);
    const pbr = json.materials?.[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(json.materials?.[0]?.name).toBe('DefaultMaterial');
    expect(pbr['metallicFactor']).toBe(0);
    expect(pbr['roughnessFactor']).toBe(1);
  });

  it('makes a crystal light itself from its own base colour', () => {
    const json = untexturedModel([2564]);
    bindMaterials(
      json,
      () => 'SM_Item_Crystal_04',
      () => 'textures/crystal-00000000.png',
    );
    const material = json.materials?.[0];
    expect(material?.['emissiveFactor']).toEqual([1, 1, 1]);
    expect(material?.['emissiveTexture']).toEqual({ index: 0 });
  });

  it('produces the same glTF twice for the same input', () => {
    const first = untexturedModel([14852, 2564]);
    const second = untexturedModel([14852, 2564]);
    bindMaterials(first, trunkAndLeaves, textureFor);
    bindMaterials(second, trunkAndLeaves, textureFor);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('pruneUnusedMaterials', () => {
  it('drops the material nothing points at and renumbers the rest', () => {
    const json = untexturedModel([2564]);
    json.materials = [{ name: 'DefaultMaterial' }, { name: 'Kept' }];
    const primitive = json.meshes?.[0]?.primitives[0];
    if (primitive !== undefined) {
      primitive.material = 1;
    }

    expect(pruneUnusedMaterials(json)).toBe(1);
    expect(json.materials).toEqual([{ name: 'Kept' }]);
    expect(json.meshes?.[0]?.primitives[0]?.material).toBe(0);
  });

  it('leaves a model with no materials alone', () => {
    const json = untexturedModel([2564]);
    delete json.materials;
    expect(pruneUnusedMaterials(json)).toBe(0);
  });
});
