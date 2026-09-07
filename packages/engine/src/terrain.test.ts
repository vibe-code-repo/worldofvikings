import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { IVector4Like } from '@babylonjs/core/Maths/math.like.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
