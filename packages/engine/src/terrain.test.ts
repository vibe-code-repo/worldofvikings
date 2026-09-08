import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { IVector4Like } from '@babylonjs/core/Maths/math.like.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The shadow pass is a scene component; a `ShadowGenerator` without it throws.
import './side-effects.js';
import {
  DEFAULT_TERRAIN_COLOR,
  createTerrain,
  createTerrainMaterial,
  clearLoaderTransform,
} from './terrain.js';
import { sceneSkyGradient, setSceneSkyGradient } from './sky-gradient.js';

const scenes: Scene[] = [];

function scene(): Scene {
  const engine = new NullEngine({
    renderWidth: 64,
    renderHeight: 64,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const created = new Scene(engine);
  scenes.push(created);
  return created;
}

/**
 * The `vec4` a freshly built terrain material sends under `name`.
 *
 * A `ShaderMaterial` does not hand its uniform values back, so the value is
 * caught on the way in. The recorded calls are read before the spy is restored,
 * because `mockRestore` clears them along with the spy.
 */
function uniformSentTo(target: Scene, name: string): IVector4Like | undefined {
  const sent = vi.spyOn(ShaderMaterial.prototype, 'setVector4');
  try {
    createTerrainMaterial(target, 'village', { position: [0, 0, 0], size: [300, 300] });
    return sent.mock.calls.find((call) => call[0] === name)?.[1];
  } finally {
    sent.mockRestore();
  }
}

/**
 * A stand-in for what the glTF loader hands back: a `__root__` carrying the
 * loader's handedness conversion — a half turn about y and a -1 scale on z —
 * with the tile under it, sitting at its own corner-anchored middle.
 */
function loadedHeightField(target: Scene): TransformNode {
  const root = new TransformNode('__root__', target);
  root.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
  root.scaling = new Vector3(1, 1, -1);
  const ground = CreateGround('tile', { width: 300, height: 300, subdivisions: 2 }, target);
  ground.parent = root;
  ground.position.set(150, 0, 150);
  return root;
}

afterEach(() => {
  for (const created of scenes.splice(0)) {
    const engine = created.getEngine();
    created.dispose();
    engine.dispose();
  }
});

describe('clearLoaderTransform', () => {
  it('clears the half turn as well as the mirror, not just the mirror', () => {
    const target = scene();
    const root = loadedHeightField(target);
    const mesh = root.getChildMeshes(false)[0];
    expect(mesh).toBeDefined();
    // Before: the half turn alone has already moved the tile's middle from
    // (150, 150) to (-150, 150) — undoing only the mirror would leave that.
    mesh?.computeWorldMatrix(true);
    expect(mesh?.getAbsolutePosition().x).toBeCloseTo(-150, 4);
    expect(mesh?.getAbsolutePosition().z).toBeCloseTo(150, 4);

    clearLoaderTransform(root);
    mesh?.computeWorldMatrix(true);
    expect(mesh?.getAbsolutePosition().x).toBeCloseTo(150, 4);
    expect(mesh?.getAbsolutePosition().z).toBeCloseTo(150, 4);
  });

  it('leaves an already-neutral node alone', () => {
    const root = new TransformNode('plain', scene());
    clearLoaderTransform(root);
    expect([root.scaling.x, root.scaling.y, root.scaling.z]).toEqual([1, 1, 1]);
    expect(root.rotationQuaternion).toBeNull();
  });
});

describe('createTerrain', () => {
  it('puts the tile where the world file says, unmirrored', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), {
      name: 'village',
      position: [10, -2, 30],
      size: [300, 300],
    });

    expect([terrain.root.position.x, terrain.root.position.y, terrain.root.position.z]).toEqual([
      10, -2, 30,
    ]);
    const mesh = terrain.meshes[0];
    expect(mesh).toBeDefined();
    expect(mesh?.getWorldMatrix().determinant()).toBeGreaterThan(0);
  });

  it('gives every ground mesh the terrain material', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), {
      position: [0, 0, 0],
      size: [300, 300],
    });
    expect(terrain.meshes.length).toBeGreaterThan(0);
    for (const mesh of terrain.meshes) {
      expect(mesh.material).toBe(terrain.material);
    }
  });

  it('removes its meshes, material and textures again', () => {
    const target = scene();
    const before = target.meshes.length;
    const terrain = createTerrain(target, loadedHeightField(target), {
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ url: 'grass.png', tileSize: 2 }],
    });
    expect(target.meshes.length).toBeGreaterThan(before);

    terrain.dispose();
    expect(target.meshes.length).toBe(before);
    expect(target.materials).not.toContain(terrain.material);
    terrain.dispose(); // idempotent
  });
});

describe('createTerrainMaterial', () => {
  it('creates one texture per splat map and per layer', () => {
    const target = scene();
    const { textures } = createTerrainMaterial(target, 'village', {
      position: [0, 0, 0],
      size: [300, 300],
      splat: [{ url: 'a.png' }, { url: 'b.png' }],
      layers: [
        { url: 'grass.png', tileSize: 2 },
        { url: 'rock.png', tileSize: 3 },
      ],
    });
    expect(textures).toHaveLength(4);
  });

  it('creates no texture for a tile that is one flat colour', () => {
    const { textures } = createTerrainMaterial(scene(), 'blockout', {
      position: [0, 0, 0],
      size: [50, 50],
      color: DEFAULT_TERRAIN_COLOR,
    });
    expect(textures).toHaveLength(0);
  });

  it('reads the sun and the fog off the scene instead of restating them', () => {
    const target = scene();
    target.fogMode = Scene.FOGMODE_LINEAR;
    target.fogEnabled = true;
    target.fogColor = Color3.FromHexString('#4d5b68');
    target.fogStart = 40;
    target.fogEnd = 95;

    const { material } = createTerrainMaterial(target, 'village', {
      position: [0, 0, 0],
      size: [300, 300],
    });

    // A NullEngine compiles no effect, so what is asserted is that binding the
    // scene's lighting is part of building the material and does not throw with
    // a scene that has no lights at all — the case a blank editor scene is in.
    expect(material.getScene()).toBe(target);
  });

  /**
   * The trap ADR-0041 was written around, and the one way to ship it broken.
   *
   * `uFogRange.z` used to be "1 when the scene is FOGMODE_LINEAR". Under an
   * exponential fog that is 0, which takes the ground out of the fog entirely
   * while every house standing on it keeps hazing — invisible in a diff, and at
   * village distances very nearly invisible on screen. So what is asserted is
   * the number itself: the scene's mode reaches the shader, and the density
   * with it.
   */
  it.each([
    ['linear' as const, Scene.FOGMODE_LINEAR, 3],
    ['exponential' as const, Scene.FOGMODE_EXP, 1],
  ])('sends the ground the scene’s %s fog mode, not a boolean', (_name, mode, code) => {
    const target = scene();
    target.fogEnabled = true;
    target.fogMode = mode;
    target.fogStart = 40;
    target.fogEnd = 95;
    target.fogDensity = 0.0007;

    // Read before restoring: `mockRestore` clears the recorded calls with it.
    const fog = uniformSentTo(target, 'uFogRange');
    expect(fog).toBeDefined();
    expect(fog?.x).toBe(40);
    expect(fog?.y).toBe(95);
    expect(fog?.z).toBe(code);
    expect(fog?.w).toBe(0.0007);
  });

  it('takes the ground out of the fog only when the scene has none', () => {
    const target = scene();
    target.fogEnabled = false;
    target.fogMode = Scene.FOGMODE_LINEAR;

    expect(uniformSentTo(target, 'uFogRange')?.z).toBe(0);
  });
});

describe('a layer’s surface', () => {
  it('loads a normal map for the layers that have one, and binds a sampler for it', () => {
    const target = scene();
    const { material, textures } = createTerrainMaterial(target, 'ground', {
      position: [0, 0, 0],
      size: [300, 300],
      splat: [{ url: 'splat-a.png' }],
      layers: [
        {
          url: 'rock.png',
          tileSize: 2,
          normalMap: { url: 'rock-normal.png' },
          normalScale: 1.5,
          metallic: 0.85,
          smoothness: 0.1,
        },
        { url: 'moss.png', tileSize: 2 },
      ],
    });

    expect(textures.map((texture) => texture.name)).toEqual([
      'splat-a.png',
      'rock.png',
      'rock-normal.png',
      'moss.png',
    ]);
    expect(material.options.samplers).toContain('uLayerNormal0');
    expect(material.options.samplers).not.toContain('uLayerNormal1');
    expect(material.options.uniforms).toContain('uLayerSurface0');
    expect(material.options.uniforms).toContain('uLayerSurface1');
  });

  it('binds the sky uniforms the ground reflects through', () => {
    const target = scene();
    setSceneSkyGradient(target, {
      zenithColor: '#102040',
      horizonColor: '#804020',
      sunColor: '#ffffff',
      sunSpread: 0.25,
      intensity: 0.6,
    });
    const { material } = createTerrainMaterial(target, 'ground', {
      position: [0, 0, 0],
      size: [10, 10],
    });
    expect(material.options.uniforms).toEqual(
      expect.arrayContaining(['uSkyZenith', 'uSkyHorizon', 'uSkyGlow', 'uSkyParams']),
    );
    // The values come from the scene, not from a second set of options here.
    expect(sceneSkyGradient(target).intensity).toBe(0.6);
  });

  it('compiles a different program for a facetted tile than for a smooth one', () => {
    const target = scene();
    const smooth = createTerrainMaterial(target, 'a', {
      position: [0, 0, 0],
      size: [10, 10],
      layers: [{ url: 'rock.png', tileSize: 2 }],
    });
    const facetted = createTerrainMaterial(target, 'b', {
      position: [0, 0, 0],
      size: [10, 10],
      layers: [{ url: 'rock.png', tileSize: 2 }],
      flatNormals: true,
    });
    expect(smooth.material.shaderPath).not.toEqual(facetted.material.shaderPath);
  });

  it('compiles a different program for a bumped tile than for a plain one', () => {
    const target = scene();
    const plain = createTerrainMaterial(target, 'a', {
      position: [0, 0, 0],
      size: [10, 10],
      layers: [{ url: 'rock.png', tileSize: 2 }],
    });
    const bumped = createTerrainMaterial(target, 'b', {
      position: [0, 0, 0],
      size: [10, 10],
      layers: [{ url: 'rock.png', tileSize: 2, normalMap: { url: 'rock-normal.png' } }],
    });
    expect(plain.material.shaderPath).not.toEqual(bumped.material.shaderPath);
  });
});

/**
 * What the material actually holds for a uniform, read back through Babylon's
 * own serialiser rather than off a private field.
 *
 * `serialize()` writes `vectors2`, `vectors3` and `colors3` as plain arrays, so
 * a test can assert the number that would be sent to the GPU without compiling
 * an effect — which a `NullEngine` never does.
 */
function uniformsOf(material: ShaderMaterial): {
  vectors2: Record<string, number[]>;
  vectors3: Record<string, number[]>;
  colors3: Record<string, number[]>;
} {
  const serialized = material.serialize() as {
    vectors2: Record<string, number[]>;
    vectors3: Record<string, number[]>;
    colors3: Record<string, number[]>;
  };
  return serialized;
}

describe('turning a dial without rebuilding the tile (ADR-0050)', () => {
  const twoLayers = {
    position: [0, 0, 0],
    size: [300, 300],
    splat: [{ url: 'splat-a.png' }],
    layers: [
      { url: 'rock.png', tileSize: 2, metallic: 0.1, smoothness: 0.2 },
      { url: 'moss.png', tileSize: 4, metallic: 0.3, smoothness: 0.4 },
    ],
  } as const;

  it('writes the same uniforms an equally built tile would have', () => {
    const target = scene();
    // Two tiles that end up describing the same ground: one built with the
    // numbers, one built with others and then turned to them. If the dial and
    // the builder ever write different uniforms, the editor and the game show
    // the same world file differently — and nothing would say so.
    const turned = createTerrain(target, loadedHeightField(target), twoLayers);
    const built = createTerrain(target, loadedHeightField(target), {
      ...twoLayers,
      layers: [
        { url: 'rock.png', tileSize: 8, normalScale: 0.5, metallic: 0.75, smoothness: 0.9 },
        { url: 'moss.png', tileSize: 16, metallic: 0.05, smoothness: 0.6 },
      ],
    });

    turned.update({
      layers: [
        { tileSize: 8, normalScale: 0.5, metallic: 0.75, smoothness: 0.9 },
        { tileSize: 16, metallic: 0.05, smoothness: 0.6 },
      ],
    });

    const after = uniformsOf(turned.material);
    const reference = uniformsOf(built.material);
    expect(after.vectors3['uLayerSurface0']).toEqual([0.5, 0.75, 0.9]);
    expect(after.vectors3['uLayerSurface1']).toEqual([1, 0.05, 0.6]);
    // 300 m of tile at 8 m a repeat.
    expect(after.vectors2['uLayerScale0']).toEqual([37.5, 37.5]);
    expect(after.vectors2['uLayerScale1']).toEqual([18.75, 18.75]);
    expect(after.vectors3).toEqual(reference.vectors3);
    expect(after.vectors2).toEqual(reference.vectors2);
  });

  it('keeps the tile it had: same meshes, same material, same textures', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), twoLayers);
    const material = terrain.material;
    const textures = [...terrain.textures];
    const meshes = [...terrain.meshes];
    const programs = Object.keys(ShaderStore.ShadersStore).length;

    terrain.update({ layers: [{ tileSize: 2, metallic: 0.9 }, { tileSize: 4 }] });

    expect(terrain.material).toBe(material);
    expect(terrain.textures).toEqual(textures);
    expect(terrain.meshes).toEqual(meshes);
    // No new program registered: a turned dial is a value, not a compile.
    expect(Object.keys(ShaderStore.ShadersStore).length).toBe(programs);
    for (const texture of textures) {
      expect(target.textures).toContain(texture);
    }
  });

  it('leaves out what the update leaves out', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), {
      ...twoLayers,
      color: '#112233',
    });
    terrain.update({ layers: [{ tileSize: 2 }, { tileSize: 4 }] });
    // An update with no colour must not quietly reset the tile to the default:
    // a partial update that overwrites is worse than one that refuses.
    expect(uniformsOf(terrain.material).colors3['uBaseColor']).toEqual([
      0x11 / 255,
      0x22 / 255,
      0x33 / 255,
    ]);
  });

  it('refuses an update with a different number of layers', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), twoLayers);
    expect(() => {
      terrain.update({ layers: [{ tileSize: 2 }] });
    }).toThrow(/2 layer\(s\), the update carries 1/);
  });

  it('does nothing once the tile has been disposed', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), twoLayers);
    terrain.dispose();
    expect(() => {
      terrain.update({ layers: [{ tileSize: 2 }, { tileSize: 4 }] });
    }).not.toThrow();
  });
});

describe('rebuilding a tile’s material over the height field it already has', () => {
  const smooth = {
    name: 'ground',
    position: [0, 0, 0],
    size: [300, 300],
    splat: [{ url: 'splat-a.png' }],
    layers: [{ url: 'rock.png', tileSize: 2 }],
  } as const;

  it('keeps the meshes and swaps the program', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), smooth);
    const meshes = [...terrain.meshes];
    const before = terrain.material;
    const beforeTextures = [...terrain.textures];

    terrain.rebuildMaterial({ ...smooth, flatNormals: true });

    // The expensive half — the loaded height field — was not touched.
    expect(terrain.meshes).toEqual(meshes);
    for (const mesh of meshes) {
      expect(mesh.isDisposed()).toBe(false);
      expect(mesh.material).toBe(terrain.material);
    }
    // The cheap half really was rebuilt: a facetted tile is another program.
    expect(terrain.material).not.toBe(before);
    expect(terrain.material.shaderPath).not.toEqual(before.shaderPath);
    // And the old one is gone rather than left in the scene as a leak.
    expect(target.materials).not.toContain(before);
    for (const texture of beforeTextures) {
      expect(target.textures).not.toContain(texture);
    }
  });

  it('moves the tile when the rebuild puts it somewhere else', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), smooth);
    terrain.rebuildMaterial({ ...smooth, position: [10, 2, -5] });
    expect([terrain.root.position.x, terrain.root.position.y, terrain.root.position.z]).toEqual([
      10, 2, -5,
    ]);
  });

  it('takes the new layer count with it, so a later dial is checked against it', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), smooth);
    terrain.rebuildMaterial({
      ...smooth,
      layers: [
        { url: 'rock.png', tileSize: 2 },
        { url: 'moss.png', tileSize: 3 },
      ],
    });
    expect(() => {
      terrain.update({ layers: [{ tileSize: 2 }] });
    }).toThrow(/2 layer\(s\), the update carries 1/);
    terrain.update({ layers: [{ tileSize: 2 }, { tileSize: 6 }] });
    expect(uniformsOf(terrain.material).vectors2['uLayerScale1']).toEqual([50, 50]);
  });

  it('disposes the material it ended up with, not the one it started from', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), smooth);
    terrain.rebuildMaterial({ ...smooth, flatNormals: true });
    const material = terrain.material;
    const textures = [...terrain.textures];
    terrain.dispose();
    expect(target.materials).not.toContain(material);
    for (const texture of textures) {
      expect(target.textures).not.toContain(texture);
    }
  });
});

/**
 * How the ground reads the sun's shadow map is compiled into its program
 * (ADR-0020, ADR-0024), and the rig above it can be replaced at any moment —
 * the editor relights whenever the Lighting tab is used. Everything else about
 * a light is picked up on the next bind; this is the one thing that cannot be.
 */
describe('a tile and the shadow map it was compiled for', () => {
  const ground = {
    name: 'ground',
    position: [0, 0, 0],
    size: [300, 300],
    layers: [{ url: 'rock.png', tileSize: 2 }],
    receiveShadows: true,
  } as const;

  /**
   * A sun with a shadow map of its own, the way `applyLighting` builds one.
   *
   * `pcf` is written onto the private field rather than through
   * `usePercentageCloserFiltering`, and that is not a shortcut. Babylon
   * downgrades a PCF request to Poisson when the engine reports no shadow
   * samplers (`set filter`, "Weblg1 fallback for PCF"), and `NullEngine`
   * reports none — so the public setter cannot produce the filter a real
   * WebGL2 browser produces, which is the one under test.
   */
  function sun(target: Scene, options: { mapSize?: number; pcf?: boolean } = {}): ShadowGenerator {
    const light = new DirectionalLight('sun', new Vector3(0.5, -1, 0.5), target);
    const generator = new ShadowGenerator(options.mapSize ?? 1024, light);
    generator.useFloat32TextureType = true;
    generator.usePoissonSampling = true;
    if (options.pcf === true) {
      (generator as unknown as { _filter: number })._filter = ShadowGenerator.FILTER_PCF;
    }
    return generator;
  }

  it('fits the map it was built under', () => {
    const target = scene();
    sun(target);
    const terrain = createTerrain(target, loadedHeightField(target), ground);
    expect(terrain.material.options.samplers).toContain('uShadowMap');
    expect(terrain.shadowsMatchScene()).toBe(true);
  });

  it('does not fit a map that arrived after it was built', () => {
    const target = scene();
    // Built under a profile with the shadows switched off, which is a program
    // with no shadow lookup in it at all.
    const terrain = createTerrain(target, loadedHeightField(target), ground);
    expect(terrain.material.options.samplers).not.toContain('uShadowMap');
    expect(terrain.shadowsMatchScene()).toBe(true);

    sun(target);

    expect(terrain.shadowsMatchScene(), 'the shadows came back and the tile cannot see them').toBe(
      false,
    );
    terrain.rebuildMaterial(ground);
    expect(terrain.material.options.samplers).toContain('uShadowMap');
    expect(terrain.shadowsMatchScene()).toBe(true);
  });

  it('does not fit a map of a different size', () => {
    const target = scene();
    const first = sun(target, { mapSize: 1024 });
    const terrain = createTerrain(target, loadedHeightField(target), ground);
    expect(terrain.shadowsMatchScene()).toBe(true);

    first.getLight().dispose();
    first.dispose();
    sun(target, { mapSize: 2048 });

    expect(terrain.shadowsMatchScene()).toBe(false);
  });

  /**
   * PCF renders depth into a depth-stencil texture and hands it to a shader as
   * a comparison sampler. The ground's hand-written program reads an ordinary
   * `sampler2D`, and binding one to the other is not a wrong number but a
   * rejected draw — `GL_INVALID_OPERATION: Mismatch between texture format and
   * sampler type`, every frame. So a tile under a PCF sun is unshadowed.
   */
  it('does not try to read a comparison shadow map', () => {
    const target = scene();
    sun(target, { pcf: true });
    const terrain = createTerrain(target, loadedHeightField(target), ground);

    expect(terrain.material.options.samplers).not.toContain('uShadowMap');
    // And it is at rest, not waiting for a rebuild that cannot help.
    expect(terrain.shadowsMatchScene()).toBe(true);
  });

  it('stops sampling when the filter changes under it, rather than reading the wrong map', () => {
    const target = scene();
    const poisson = sun(target);
    const terrain = createTerrain(target, loadedHeightField(target), ground);
    expect(terrain.shadowsMatchScene()).toBe(true);

    // The Noon preset over a world whose own profile asks for poisson.
    poisson.getLight().dispose();
    poisson.dispose();
    sun(target, { pcf: true });

    expect(terrain.shadowsMatchScene()).toBe(false);
    terrain.rebuildMaterial(ground);
    expect(terrain.material.options.samplers).not.toContain('uShadowMap');
    expect(terrain.shadowsMatchScene()).toBe(true);
  });

  it('leaves a tile that never asked for shadows alone', () => {
    const target = scene();
    const terrain = createTerrain(target, loadedHeightField(target), {
      ...ground,
      receiveShadows: false,
    });
    sun(target);
    expect(terrain.shadowsMatchScene()).toBe(true);
  });
});
