/**
 * The ground: a loaded height field, put where the world says and given a
 * multi-layer material driven by splat maps (ADR-0020).
 *
 * This module renders terrain. It does not decide where terrain is — that is
 * `zone.terrain` in a world file — and it does not load the model either: the
 * caller hands over the node an asset loader produced, because `@wov/engine`
 * owns the renderer and `@wov/asset-system` owns where bytes come from.
 *
 * **Why not `MixMaterial` from `@babylonjs/materials`.** It is the obvious
 * candidate — two mix maps, eight diffuse textures — and it was measured against
 * the actual export before being rejected. Two things make it wrong here, not
 * merely awkward:
 *
 * 1. Its blend is a chain of `mix()` in which the fourth and eighth layers are
 *    weighted by `1.0 - a`, not by `a`. The exported maps hold one weight per
 *    layer and sum to ~1 across all channels; a tile whose alpha averages 0.15
 *    would therefore be covered by layer 4 at 85 % strength — the ground would
 *    be one texture with faint patches of the rest.
 * 2. It refuses to become ready unless *all four* diffuse slots of a bound mix
 *    map are set. The village tile has six layers in two maps, so slots 7 and 8
 *    would have to be filled with something; and with the second map's alpha
 *    channel measured at a constant 0, `1.0 - a` makes that filler cover the
 *    whole tile.
 *
 * Both are properties of its formula, not settings. A normalised weighted sum is
 * a dozen lines of GLSL (`terrain-shader.ts`), so the material is generated here
 * for the number of layers the tile has, and `@babylonjs/materials` is not a
 * dependency of this repository.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Node } from '@babylonjs/core/node.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  TERRAIN_ATTRIBUTES,
  TERRAIN_VERTEX_SOURCE,
  layerRepeats,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
} from './terrain-shader.js';

/**
 * One image the terrain material samples, and where to get it.
 *
 * `fallbackUrl` exists because ground textures live in the private asset store
 * (ADR-0015) and a clean clone has none. Without a stand-in the material would
 * sample an unloaded texture and the ground would be black — a clone that looks
 * broken rather than one that looks plain.
 */
export interface TerrainTextureSource {
  /** URL the texture is loaded from — already resolved by the caller. */
  readonly url: string;
  /** Loaded instead when {@link url} fails; a committed placeholder. */
  readonly fallbackUrl?: string | undefined;
}

/** One ground texture and how many metres one repeat of it covers. */
export interface TerrainLayerSource extends TerrainTextureSource {
  /** Edge length of one repeat, in metres. */
  readonly tileSize: number;
}

/** Everything the renderer needs to draw one tile. */
export interface TerrainOptions {
  /** Name for the tile's root node, so it can be found in a scene dump. */
  readonly name?: string;
  /** Where the height field's own origin lands, `[x, y, z]` in metres. */
  readonly position: readonly [number, number, number];
  /** `[width, depth]` of the tile in metres — what the layer tiling divides. */
  readonly size: readonly [number, number];
  /** Ground textures, in the order the splat channels weight them. */
  readonly layers?: readonly TerrainLayerSource[];
  /** One or two splat maps: the first weights layers 1–4, the second 5–8. */
  readonly splat?: readonly TerrainTextureSource[];
  /** Colour used when there is no layer at all; `#rrggbb`. */
  readonly color?: string;
}

/** What {@link createTerrain} put into the scene, and how to take it out. */
export interface TerrainHandle {
  /** The tile's root; its transform is where the world file put the tile. */
  readonly root: TransformNode;
  /** The meshes that carry the ground — what physics collides against. */
  readonly meshes: readonly AbstractMesh[];
  readonly material: ShaderMaterial;
  /** Textures this handle created and therefore owns. */
  readonly textures: readonly Texture[];
  dispose(): void;
}

/** The colour a tile with no layers is drawn in, matching the base ground. */
export const DEFAULT_TERRAIN_COLOR = '#3d4a33';

/**
 * Loads one texture, switching to its stand-in if the first URL fails.
 *
 * The swap is done by pointing the same `Texture` at the other URL rather than
 * by creating a second one, so nothing that already holds the texture — the
 * material, the handle's dispose list — has to learn about the substitution.
 */
function loadTexture(scene: Scene, source: TerrainTextureSource, samplingMode: number): Texture {
  const texture = new Texture(
    source.url,
    scene,
    false,
    false,
    samplingMode,
    null,
    source.fallbackUrl === undefined
      ? null
      : () => {
          texture.updateURL(source.fallbackUrl as string);
        },
  );
  return texture;
}

/** A ShaderStore key that is unique per shape of program. */
function registerProgram(layerCount: number, splatCount: number): string {
  const key = `wovTerrain${String(layerCount)}x${String(splatCount)}`;
  ShaderStore.ShadersStore[`${key}VertexShader`] = TERRAIN_VERTEX_SOURCE;
  ShaderStore.ShadersStore[`${key}FragmentShader`] = terrainFragmentSource(layerCount, splatCount);
  return key;
}

/**
 * Clears the handedness conversion Babylon's glTF loader puts on a loaded root.
 *
 * The loader turns right-handed glTF into a left-handed scene with a transform
 * on the `__root__` node it creates: a half turn about y **and** a `-1` scale on
 * z. Measured, not assumed — the tile came out at `x, z ∈ [-300, 0]` when only
 * the scale was undone, which is what the half turn does on its own.
 *
 * For an ordinary model none of this shows: it is mirrored inside its own
 * bounding box and placed by a position that the loader never touches. For
 * terrain it shows immediately — a tile whose file says `0…300 m` would sit at
 * `-300…0 m`, on the opposite side of the world from every entity placed on it.
 *
 * So the whole local transform is cleared rather than one component of it, and
 * the height field's vertices become world metres exactly as the file states
 * them. That the tile is then mirrored with respect to a right-handed reading of
 * the file is the same mirror every model in the scene already carries; what
 * matters is that ground and entities agree.
 */
export function clearLoaderTransform(root: TransformNode): void {
  root.position.setAll(0);
  root.rotation.setAll(0);
  root.rotationQuaternion = null;
  root.scaling.setAll(1);
}

/** Every mesh under a node, including the node itself when it is one. */
function meshesUnder(root: Node): AbstractMesh[] {
  const meshes = root.getChildMeshes(false);
  return meshes.filter((mesh) => mesh.getTotalVertices() > 0);
}

/**
 * Builds the material for a tile.
 *
 * Exported separately from {@link createTerrain} because the editor draws the
 * same ground without a physics world behind it, and because a material with no
 * mesh is the smallest thing a test can look at.
 */
export function createTerrainMaterial(
  scene: Scene,
  name: string,
  options: TerrainOptions,
): { material: ShaderMaterial; textures: Texture[] } {
  const layers = options.layers ?? [];
  const splat = options.splat ?? [];
  const key = registerProgram(layers.length, splat.length);

  const material = new ShaderMaterial(`${name}-material`, scene, key, {
    attributes: [...TERRAIN_ATTRIBUTES],
    uniforms: terrainUniformNames(layers.length),
    samplers: terrainSamplerNames(layers.length, splat.length),
    needAlphaBlending: false,
    needAlphaTesting: false,
  });
  // The tile is opaque and single-sided; both are the ground's own facts.
  material.backFaceCulling = true;

  const textures: Texture[] = [];
  splat.forEach((source, index) => {
    // Filtered, and clamped. Filtered because the map is one texel per ~60 cm
    // and nearest sampling turns every path edge into a staircase of half-metre
    // squares — measured on the village tile, it is the first thing you see.
    // Clamped because wrapping would fold the far edge of the tile onto the near
    // one, which paints the wrong ground along two edges instead of none.
    const texture = loadTexture(scene, source, Texture.BILINEAR_SAMPLINGMODE);
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    textures.push(texture);
    material.setTexture(`uSplat${String(index)}`, texture);
  });

  layers.forEach((layer, index) => {
    const texture = loadTexture(scene, layer, Texture.TRILINEAR_SAMPLINGMODE);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    textures.push(texture);
    material.setTexture(`uLayer${String(index)}`, texture);
    const [uScale, vScale] = layerRepeats([options.size[0], options.size[1]], layer.tileSize);
    material.setVector2(`uLayerScale${String(index)}`, new Vector2(uScale, vScale));
  });

  material.setColor3('uBaseColor', Color3.FromHexString(options.color ?? DEFAULT_TERRAIN_COLOR));
  bindSceneLighting(material, scene);
  // The lights and the fog can change after the tile is built (the base scene
  // hands both out for the caller to replace), so they are refreshed on bind
  // rather than captured once.
  material.onBindObservable.add(() => {
    bindSceneLighting(material, scene);
  });

  return { material, textures };
}

/**
 * Copies the scene's own sun, fill light and fog into the material's uniforms.
 *
 * Reading them off the scene instead of taking them as options is what keeps a
 * tile lit like everything around it: `createBaseScene` owns the light rig, and
 * a second set of numbers here would be a second sun to keep in step.
 */
function bindSceneLighting(material: ShaderMaterial, scene: Scene): void {
  const sun = scene.lights.find(
    (light): light is DirectionalLight => light instanceof DirectionalLight,
  );
  const fill = scene.lights.find(
    (light): light is HemisphericLight => light instanceof HemisphericLight,
  );

  const sunDirection = sun ? sun.direction.normalizeToNew() : new Vector3(0, -1, 0);
  material.setVector3('uSunDirection', sunDirection);
  material.setColor3(
    'uSunColor',
    (sun ? sun.diffuse : Color3.White()).scale(sun ? sun.intensity : 0),
  );
  material.setColor3(
    'uAmbientSky',
    (fill ? fill.diffuse : Color3.White()).scale(fill ? fill.intensity : 0.5),
  );
  material.setColor3(
    'uAmbientGround',
    (fill ? fill.groundColor : Color3.Black()).scale(fill ? fill.intensity : 0.5),
  );

  const fogOn = scene.fogEnabled && scene.fogMode === Scene.FOGMODE_LINEAR;
  material.setColor3('uFogColor', scene.fogColor);
  material.setVector3('uFogRange', new Vector3(scene.fogStart, scene.fogEnd, fogOn ? 1 : 0));
}

/**
 * Puts a loaded height field into the scene as the ground of a zone.
 *
 * @param heightField the root node an asset loader produced for the height
 * field model. It is re-parented, un-mirrored and moved; nothing else about it
 * is touched, so the same node could be handed to a different renderer.
 */
export function createTerrain(
  scene: Scene,
  heightField: TransformNode,
  options: TerrainOptions,
): TerrainHandle {
  const name = options.name ?? 'terrain';
  const root = new TransformNode(name, scene);

  clearLoaderTransform(heightField);
  heightField.parent = root;
  root.position.set(options.position[0], options.position[1], options.position[2]);

  const { material, textures } = createTerrainMaterial(scene, name, options);
  const meshes = meshesUnder(root);
  for (const mesh of meshes) {
    mesh.material = material;
    mesh.receiveShadows = false;
    // The ground never moves once it is placed; skip its per-frame world matrix
    // computation the same way the base ground does (spec §38).
    mesh.freezeWorldMatrix();
  }

  let disposed = false;
  return {
    root,
    meshes,
    material,
    textures,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const texture of textures) {
        texture.dispose();
      }
      material.dispose();
      root.dispose(false, false);
    },
  };
}
