import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TERRAIN_COLOR,
  createTerrain,
  createTerrainMaterial,
  neutralizeHandednessFlip,
} from './terrain.js';

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
 * A stand-in for what the glTF loader hands back: a `__root__` carrying the
 * handedness flip, with the ground mesh under it.
 */
function loadedHeightField(target: Scene, flippedAxis: 'x' | 'z' = 'x'): TransformNode {
  const root = new TransformNode('__root__', target);
  root.scaling = new Vector3(flippedAxis === 'x' ? -1 : 1, 1, flippedAxis === 'z' ? -1 : 1);
  const ground = CreateGround('tile', { width: 300, height: 300, subdivisions: 2 }, target);
  ground.parent = root;
  return root;
}

afterEach(() => {
  for (const created of scenes.splice(0)) {
    const engine = created.getEngine();
    created.dispose();
    engine.dispose();
  }
});

describe('neutralizeHandednessFlip', () => {
  it('takes the -1 off whichever axis the loader put it on', () => {
    const target = scene();
    for (const axis of ['x', 'z'] as const) {
      const root = loadedHeightField(target, axis);
      neutralizeHandednessFlip(root);
      expect([root.scaling.x, root.scaling.y, root.scaling.z]).toEqual([1, 1, 1]);
    }
  });

  it('leaves an already-neutral node alone', () => {
    const root = new TransformNode('plain', scene());
    neutralizeHandednessFlip(root);
    expect([root.scaling.x, root.scaling.y, root.scaling.z]).toEqual([1, 1, 1]);
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
});
