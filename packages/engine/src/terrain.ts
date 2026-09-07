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
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  TERRAIN_ATTRIBUTES,
  layerRepeats,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
  terrainVertexSource,
  type TerrainShadowShader,
  type TerrainSurfaceShader,
} from './terrain-shader.js';
import { sceneSkyGradient } from './sky-gradient.js';

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

/** One ground texture, how far it repeats, and how its surface behaves. */
export interface TerrainLayerSource extends TerrainTextureSource {
  /** Edge length of one repeat, in metres. */
  readonly tileSize: number;
  /**
   * Tangent-space normal map, tiled exactly like the colour texture.
   *
   * Absent means flat, and flat is not a placeholder for this: a layer with no
   * map contributes `(0, 0, 1)` to the blend, so the layers that do have one
   * still bump the ground where they are painted.
   */
  readonly normalMap?: TerrainTextureSource | undefined;
  /** How strongly {@link normalMap} tilts the surface; 1 is as painted. */
  readonly normalScale?: number | undefined;
  /** 0…1: how much of this layer is reflected sky rather than its own colour. */
  readonly metallic?: number | undefined;
  /** 0…1: how sharp that reflection is. */
  readonly smoothness?: number | undefined;
}

/**
 * One layer exactly as a world file states it: asset **paths**, not URLs.
 *
 * Structurally the same as `TerrainLayer` in `@wov/world-schema`, and named
 * separately rather than imported so that `@wov/engine` keeps its two
 * dependencies. The renderer does not validate world data; it draws what it is
 * handed, and the schema is what decides whether it was allowed to be handed
 * over.
 */
export interface TerrainLayerData {
  readonly texture: string;
  readonly tileSize: number;
  readonly normalMap?: string | undefined;
  readonly normalScale?: number | undefined;
  readonly metallic?: number | undefined;
  readonly smoothness?: number | undefined;
}

/**
 * Turns a world file's layers into loadable ones, through the caller's own
 * resolver.
 *
 * The game and the editor each own where bytes come from (see the note at the
 * top of `apps/editor/src/scene/zone-terrain.ts`), but the *shape* of the
 * mapping — which fields carry over, which are optional, which get a fallback
 * texture — is one thing, and this is it. It existed as two copies before the
 * layers grew a surface, and the second copy was the one that would have been
 * forgotten.
 */
export function terrainLayerSources(
  layers: readonly TerrainLayerData[],
  resolve: (path: string) => TerrainTextureSource,
): TerrainLayerSource[] {
  return layers.map((layer) => ({
    ...resolve(layer.texture),
    tileSize: layer.tileSize,
    normalMap: layer.normalMap === undefined ? undefined : resolve(layer.normalMap),
    normalScale: layer.normalScale,
    metallic: layer.metallic,
    smoothness: layer.smoothness,
  }));
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
  /**
   * Whether the ground takes the sun's shadow map into account (ADR-0024).
   *
   * A flag rather than `mesh.receiveShadows`, because that property means
   * nothing to a hand-written material: the lookup is compiled into the
   * generated program, so it has to be known when the material is built. If it
   * is on and the scene has no shadow-casting sun, the tile is simply lit — the
   * program still compiles and the uniform that switches the lookup off stays
   * at zero.
   */
  readonly receiveShadows?: boolean;
  /** Samples per pixel for the ground's shadow lookup: 1, 4 or 9. */
  readonly shadowTaps?: 1 | 4 | 9;
  /**
   * Draw the ground facetted rather than smooth (ADR-0032).
   *
   * Like {@link receiveShadows} this is compiled into the program rather than
   * set on the mesh, because the normal it changes is computed in the shader.
   */
  readonly flatNormals?: boolean;
}

/**
 * The numbers of one layer that live in a **uniform** rather than in a texture
 * or in the compiled program (ADR-0050).
 *
 * `tileSize` is here because it reaches the shader as `uLayerScale`, computed
 * by {@link layerRepeats} from the tile's size — a division, not a resource.
 */
export interface TerrainLayerUniforms {
  readonly tileSize: number;
  readonly normalScale?: number | undefined;
  readonly metallic?: number | undefined;
  readonly smoothness?: number | undefined;
}

/**
 * What {@link TerrainHandle.update} writes: everything about a tile that is a
 * value in the program it already has.
 *
 * A field left out is left alone, so turning one dial does not restate the
 * others. What is *not* here — a texture, a splat map, the facet switch, the
 * number of layers — is not an omission: each of those is a different program
 * or a different resource, and the caller has to rebuild for it
 * ({@link TerrainHandle.rebuildMaterial}).
 */
export interface TerrainSurfaceUpdate {
  /** Colour used where nothing is painted; `#rrggbb`. */
  readonly color?: string | undefined;
  /** One entry per layer, in the tile's own layer order. */
  readonly layers?: readonly TerrainLayerUniforms[] | undefined;
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
  /**
   * Writes new values into the program this tile already has (ADR-0050).
   *
   * The cheap half of editing the ground: no mesh is touched, no texture is
   * loaded, no shader is compiled. Turning a metalness dial is this.
   *
   * @throws when the update carries a different number of layers than the tile
   * was built with — that is a rebuild, and silently ignoring the extra layer
   * would leave a dial that writes into nothing.
   */
  update(surface: TerrainSurfaceUpdate): void;
  /**
   * Replaces this tile's material, keeping its loaded height field.
   *
   * The middle case: a layer texture swapped, a splat map replaced, the facet
   * switch flipped, a layer added. All of those are a different program or a
   * different set of textures, and none of them is a different *mesh* — the
   * height field is the same file with the same vertices, and re-instantiating
   * it is the most expensive part of the rebuild it does not need.
   *
   * The new material is built **before** the old one is disposed, so every
   * texture whose URL did not change is answered out of Babylon's own texture
   * cache instead of being downloaded and decoded again.
   *
   * `options.name`, `options.position` and `options.size` are honoured;
   * `options.heightField` does not exist here, because a different height field
   * is a different tile.
   */
  rebuildMaterial(options: TerrainOptions): void;
  /**
   * Whether the tile's compiled shadow lookup still fits the scene's map.
   *
   * The ground receives the sun through hand-written GLSL, and how it reads the
   * map — its size, whether depth is a float, whether it can be read at all —
   * is compiled into the program (ADR-0020, ADR-0024). Everything else about a
   * light can change under a tile and be picked up on the next bind; this
   * cannot.
   *
   * Which is a thing that happens. The editor relights whenever the Lighting
   * tab is used, and a tile built while shadows were off carries a program with
   * no shadow lookup in it *at all* — measured: `wovTerrain6x2n111111` where
   * the lit tile is `wovTerrain6x2s4f2048n111111` — so turning the shadows back
   * on leaves the ground the only thing in the village not in shade, with
   * 7 469 casters rendering into a map it never samples and nothing anywhere
   * saying so.
   *
   * `false` means the caller should call {@link TerrainHandle.rebuildMaterial}.
   * Until it does, the tile stops sampling rather than reading a map it was not
   * compiled for.
   */
  shadowsMatchScene(): boolean;
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

/**
 * A ShaderStore key that is unique per shape of program.
 *
 * The shadow shape is part of the shape: two tiles that differ only in whether
 * they sample a shadow map are two different programs, and sharing one key
 * between them would hand the second tile the first one's compiled shader.
 */
function registerProgram(
  layerCount: number,
  splatCount: number,
  shadows: TerrainShadowShader | undefined,
  surface: TerrainSurfaceShader,
): string {
  const suffix = shadowShapeKey(shadows);
  // The normal-map mask and the flat-normal switch are part of the shape for
  // the same reason the shadow shape is: two tiles that differ in either are
  // two different programs, and sharing a key would hand the second one the
  // first one's compiled shader — a ground bumped by textures it never bound.
  const bumps = surface.normalMaps.map((has) => (has ? '1' : '0')).join('');
  const facets = surface.flatNormals ? 'f' : '';
  const key = `wovTerrain${String(layerCount)}x${String(splatCount)}${suffix}n${bumps}${facets}`;
  ShaderStore.ShadersStore[`${key}VertexShader`] = terrainVertexSource(shadows !== undefined);
  ShaderStore.ShadersStore[`${key}FragmentShader`] = terrainFragmentSource(
    layerCount,
    splatCount,
    shadows,
    surface,
  );
  return key;
}

/**
 * The part of a program key that describes the shadow lookup, `''` for none.
 *
 * One function, so the key a tile is registered under and the answer to "does
 * this tile still fit the scene's shadow map" cannot be written two different
 * ways.
 */
function shadowShapeKey(shadows: TerrainShadowShader | undefined): string {
  return shadows === undefined
    ? ''
    : `s${String(shadows.taps)}${shadows.float ? 'f' : 'p'}${String(shadows.mapSize)}`;
}

/**
 * The sun's shadow generator, if the scene has one this shader can sample.
 *
 * Read off the scene rather than passed in, exactly like the lights in
 * {@link bindSceneLighting}: `applyLighting` owns the rig, and a second handle
 * to the same generator would be a second thing to keep in step.
 *
 * A PCF or PCSS generator is deliberately *not* one of them. Those two render
 * depth into a depth-stencil texture and hand it to a shader as a **comparison
 * sampler** (`effect.setDepthStencilTexture`), with colour writes switched off
 * while the map is drawn. The ground's program is hand-written GLSL that reads
 * the map as an ordinary `sampler2D` (`terrain-shader.ts`), and binding a
 * comparison texture to one of those is not a wrong number, it is a rejected
 * draw: `GL_INVALID_OPERATION: Mismatch between texture format and sampler
 * type`, every frame, until the console's message cap swallows it. Measured by
 * switching the editor's lighting to the Noon preset, whose profile asks for
 * `pcf` where the village's own asks for `poisson`.
 *
 * So a tile under a PCF sun is simply not shadowed, and says so in one warning
 * when its material is built rather than in a driver error every frame. A
 * comparison-sampler variant of the terrain program is the real answer and is a
 * change of its own.
 */
function sceneShadowGenerator(scene: Scene, announce = false): ShadowGenerator | null {
  for (const light of scene.lights) {
    if (!(light instanceof DirectionalLight)) {
      continue;
    }
    const generator = light.getShadowGenerator();
    if (!(generator instanceof ShadowGenerator) || generator.getShadowMap() === null) {
      continue;
    }
    if (
      generator.filter === ShadowGenerator.FILTER_PCF ||
      generator.filter === ShadowGenerator.FILTER_PCSS
    ) {
      if (announce) {
        // Once per material build, which is once per tile per lighting change:
        // an unshadowed ground under an otherwise shadowed village is exactly
        // the kind of thing that is noticed six weeks later and blamed on
        // something else.
        console.warn(
          '[terrain] this light filters its shadow map with a comparison sampler ' +
            '(pcf/pcss); the ground reads the map as a plain texture and is drawn ' +
            'without shadows under it',
        );
      }
      return null;
    }
    return generator;
  }
  return null;
}

/**
 * The shadow shape a tile compiles for, measured off the generator that exists.
 *
 * `float` comes from the shadow map's own `textureType`, because
 * `ShadowGenerator` falls back from float to half-float to a packed RGBA byte
 * target depending on what the hardware renders, and the three are not read the
 * same way. Guessing produces a ground that is entirely lit or entirely dark,
 * with nothing in any log to say why (agent principle: measure, do not assume).
 */
function shadowShaderShape(
  generator: ShadowGenerator | null,
  taps: 1 | 4 | 9,
): TerrainShadowShader | undefined {
  const map = generator?.getShadowMap();
  if (!generator || !map) {
    return undefined;
  }
  return {
    mapSize: map.getSize().width,
    float:
      map.textureType === Constants.TEXTURETYPE_FLOAT ||
      map.textureType === Constants.TEXTURETYPE_HALF_FLOAT,
    taps,
  };
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
 * Writes the uniform half of a tile's surface into a material that already has
 * the right program (ADR-0050).
 *
 * The one place those uniforms are written, called both when the material is
 * built and when a dial is turned — so a tile built at metalness 0.4 and a tile
 * turned to 0.4 cannot drift apart. A field the update leaves out is left as it
 * was; a layer count that disagrees is refused rather than partly applied.
 *
 * @throws when `surface.layers` is present and is not exactly `layerCount`
 * long. A dial that writes into a layer the program does not have is a dial
 * that does nothing, and a dial that does nothing is one someone will trust.
 */
export function applyTerrainUniforms(
  material: ShaderMaterial,
  size: readonly [number, number],
  layerCount: number,
  surface: TerrainSurfaceUpdate,
): void {
  if (surface.layers !== undefined) {
    if (surface.layers.length !== layerCount) {
      throw new Error(
        `terrain: this tile has ${String(layerCount)} layer(s), the update carries ` +
          `${String(surface.layers.length)}; adding or removing a layer is a rebuild`,
      );
    }
    surface.layers.forEach((layer, index) => {
      const [uScale, vScale] = layerRepeats([size[0], size[1]], layer.tileSize);
      material.setVector2(`uLayerScale${String(index)}`, new Vector2(uScale, vScale));
      material.setVector3(
        `uLayerSurface${String(index)}`,
        new Vector3(layer.normalScale ?? 1, layer.metallic ?? 0, layer.smoothness ?? 0),
      );
    });
  }
  if (surface.color !== undefined) {
    material.setColor3('uBaseColor', Color3.FromHexString(surface.color));
  }
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
): { material: ShaderMaterial; textures: Texture[]; shadows: TerrainShadowShader | undefined } {
  const layers = options.layers ?? [];
  const splat = options.splat ?? [];
  const shadows =
    options.receiveShadows === true
      ? shadowShaderShape(sceneShadowGenerator(scene, true), options.shadowTaps ?? 4)
      : undefined;
  const surface: TerrainSurfaceShader = {
    normalMaps: layers.map((layer) => layer.normalMap !== undefined),
    flatNormals: options.flatNormals === true,
  };
  const key = registerProgram(layers.length, splat.length, shadows, surface);

  const material = new ShaderMaterial(`${name}-material`, scene, key, {
    attributes: [...TERRAIN_ATTRIBUTES],
    uniforms: terrainUniformNames(layers.length, shadows !== undefined),
    samplers: terrainSamplerNames(layers.length, splat.length, shadows !== undefined, surface),
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
    if (layer.normalMap !== undefined) {
      const normal = loadTexture(scene, layer.normalMap, Texture.TRILINEAR_SAMPLINGMODE);
      normal.wrapU = Texture.WRAP_ADDRESSMODE;
      normal.wrapV = Texture.WRAP_ADDRESSMODE;
      textures.push(normal);
      material.setTexture(`uLayerNormal${String(index)}`, normal);
    }
  });

  // The same call an in-place dial makes, so a tile built with a metalness of
  // 0.4 and a tile turned to 0.4 are the same uniform written by the same line.
  applyTerrainUniforms(material, options.size, layers.length, {
    color: options.color ?? DEFAULT_TERRAIN_COLOR,
    layers,
  });
  bindSceneLighting(material, scene);
  if (shadows !== undefined) {
    bindShadows(material, scene, shadows);
  }
  // The lights and the fog can change after the tile is built (the base scene
  // hands both out for the caller to replace), so they are refreshed on bind
  // rather than captured once. The shadow matrix has to be: it is rebuilt every
  // frame as the map follows the player.
  material.onBindObservable.add(() => {
    bindSceneLighting(material, scene);
    if (shadows !== undefined) {
      bindShadows(material, scene, shadows);
    }
  });

  return { material, textures, shadows };
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

  // The sky the ground reflects, from the same profile the dome is drawn with
  // (`sky-gradient.ts`). Read here rather than passed in for the same reason
  // the lights are: `applyLighting` owns it, and a second copy is a second sky.
  const sky = sceneSkyGradient(scene);
  material.setColor3('uSkyZenith', Color3.FromHexString(sky.zenithColor));
  material.setColor3('uSkyHorizon', Color3.FromHexString(sky.horizonColor));
  material.setColor3('uSkyGlow', Color3.FromHexString(sky.sunColor));
  material.setVector2('uSkyParams', new Vector2(sky.sunSpread, sky.intensity));
}

/**
 * Copies the sun's shadow map and its transform into the material's uniforms.
 *
 * The matrix changes every frame — the map follows the player (ADR-0024) — so
 * this runs on every bind rather than once at build time. `uShadowInfo.z` is
 * the switch: a scene whose shadows were turned off after the tile was built
 * keeps its compiled program and stops sampling, instead of needing a rebuild.
 */
function bindShadows(material: ShaderMaterial, scene: Scene, shadows: TerrainShadowShader): void {
  // Looked up per bind rather than captured, because the rig can be replaced
  // while the tile stays: the editor relights when a different world is opened
  // and the game does it when the world file arrives (ADR-0024). A captured
  // generator would leave the ground reading a disposed shadow map — which
  // shows as ground that is simply never in shade, and says nothing anywhere.
  const generator = sceneShadowGenerator(scene);
  const map = generator?.getShadowMap() ?? null;
  const light = generator?.getLight();
  if (!generator || !map || !light || !scene.shadowsEnabled || !light.shadowEnabled) {
    material.setVector3('uShadowInfo', new Vector3(1, 1 / shadows.mapSize, 0));
    return;
  }
  // A rig can be replaced under a tile that stays — the editor relights
  // whenever the lighting panel is used — and the new map may be a different
  // size or a different depth format from the one this program was compiled
  // to read. Binding it anyway is a ground that is entirely lit or entirely
  // dark with nothing to say why. The tile stops sampling instead, and the
  // caller rebuilds it ({@link TerrainHandle.shadowsMatchScene}).
  if (shadowShapeKey(shadowShaderShape(generator, shadows.taps)) !== shadowShapeKey(shadows)) {
    material.setVector3('uShadowInfo', new Vector3(1, 1 / shadows.mapSize, 0));
    return;
  }

  const camera = scene.activeCamera;
  material.setMatrix('uShadowMatrix', generator.getTransformMatrix());
  material.setVector2(
    'uShadowDepthValues',
    new Vector2(
      light.getDepthMinZ(camera),
      light.getDepthMinZ(camera) + light.getDepthMaxZ(camera),
    ),
  );
  material.setVector3(
    'uShadowInfo',
    new Vector3(generator.getDarkness(), 1 / map.getSize().width, 1),
  );
  material.setTexture('uShadowMap', map);
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

  let built = createTerrainMaterial(scene, name, options);
  let size: readonly [number, number] = [options.size[0], options.size[1]];
  let layerCount = (options.layers ?? []).length;
  /** What the tile was asked for, so its fit can be re-checked later. */
  let wantsShadows = options.receiveShadows === true;
  let taps: 1 | 4 | 9 = options.shadowTaps ?? 4;
  const meshes = meshesUnder(root);
  const wear = (material: ShaderMaterial): void => {
    for (const mesh of meshes) {
      mesh.material = material;
      // Not `receiveShadows`: the flag drives Babylon's own generated materials
      // and this one is hand-written, so the lookup lives in the shader instead
      // (`TerrainOptions.receiveShadows`, ADR-0024). Left false so nothing reads
      // it as a promise the material does not keep.
      mesh.receiveShadows = false;
      // The ground never moves once it is placed; skip its per-frame world matrix
      // computation the same way the base ground does (spec §38).
      mesh.freezeWorldMatrix();
    }
  };
  wear(built.material);

  let disposed = false;
  return {
    root,
    meshes,
    get material() {
      return built.material;
    },
    get textures() {
      return built.textures;
    },

    update(surface) {
      if (disposed) {
        return;
      }
      applyTerrainUniforms(built.material, size, layerCount, surface);
    },

    shadowsMatchScene() {
      const now = wantsShadows ? shadowShaderShape(sceneShadowGenerator(scene), taps) : undefined;
      return shadowShapeKey(now) === shadowShapeKey(built.shadows);
    },

    rebuildMaterial(next) {
      if (disposed) {
        return;
      }
      const previous = built;
      // Built first, disposed second, and that order is the point: while the
      // old textures are still alive Babylon answers a `new Texture(url)` for
      // the same URL out of its own cache, so only the images that really
      // changed are fetched and decoded again.
      built = createTerrainMaterial(scene, next.name ?? name, next);
      size = [next.size[0], next.size[1]];
      layerCount = (next.layers ?? []).length;
      wantsShadows = next.receiveShadows === true;
      taps = next.shadowTaps ?? 4;
      // The meshes are re-frozen against the same transform they already had,
      // which is free; what matters is that the position may have moved.
      root.position.set(next.position[0], next.position[1], next.position[2]);
      wear(built.material);
      for (const texture of previous.textures) {
        texture.dispose();
      }
      previous.material.dispose();
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const texture of built.textures) {
        texture.dispose();
      }
      built.material.dispose();
      root.dispose(false, false);
    },
  };
}
