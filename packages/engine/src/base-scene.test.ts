import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createBaseScene, defaultBaseSceneOptions, resolveBaseSceneOptions } from './base-scene.js';

/** A NullEngine runs the real Babylon pipeline without a GPU or a DOM. */
function headlessScene(): Scene {
  const engine = new NullEngine({
    renderWidth: 64,
    renderHeight: 64,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  return new Scene(engine);
}

const scenes: Scene[] = [];

function scene(): Scene {
  const created = headlessScene();
  scenes.push(created);
  return created;
}

afterEach(() => {
  for (const created of scenes.splice(0)) {
    const engine = created.getEngine();
    created.dispose();
    engine.dispose();
  }
});

describe('resolveBaseSceneOptions', () => {
  it('defaults to a 100 x 100 ground', () => {
    expect(defaultBaseSceneOptions.groundSize).toBe(100);
    expect(resolveBaseSceneOptions().groundSize).toBe(100);
  });

  it('derives the fog distances from the ground size unless they are given', () => {
    const small = resolveBaseSceneOptions({ groundSize: 50 });
    const large = resolveBaseSceneOptions({ groundSize: 200 });

    expect(small.fogEnd).toBeLessThan(large.fogEnd);
    expect(small.fogStart).toBeLessThan(small.fogEnd);
    expect(resolveBaseSceneOptions({ groundSize: 50, fogStart: 5, fogEnd: 12 }).fogEnd).toBe(12);
  });

  it('rejects fog that ends before it starts', () => {
    // The derived start (40 % of 50 m) is 20 m, so a hand-set end of 12 m is a
    // contradiction — and one that renders as an unlit scene, not an error.
    expect(() => resolveBaseSceneOptions({ groundSize: 50, fogEnd: 12 })).toThrow(/fogEnd/);
  });

  it('rejects a malformed colour instead of silently rendering black', () => {
    // Color3.FromHexString returns black for anything it cannot parse, so an
    // unvalidated colour from world data would look like a lighting bug.
    expect(() => resolveBaseSceneOptions({ skyColor: 'sky-blue' })).toThrow(/skyColor/);
    expect(() => resolveBaseSceneOptions({ groundColor: '#12345' })).toThrow(/groundColor/);
  });

  it('rejects a ground that has no area', () => {
    expect(() => resolveBaseSceneOptions({ groundSize: 0 })).toThrow(/groundSize/);
  });
});

describe('createBaseScene', () => {
  it('builds a ground of the requested size', () => {
    const target = scene();
    const base = createBaseScene(target, { groundSize: 100 });

    // The bounding box is the witness, not the option we passed in.
    const extend = base.ground.getBoundingInfo().boundingBox.extendSize;
    expect(extend.x * 2).toBeCloseTo(100, 5);
    expect(extend.z * 2).toBeCloseTo(100, 5);
    expect(base.ground.position.y).toBe(0);
  });

  it('lights the ground with one hemispheric and one directional light', () => {
    const target = scene();
    const base = createBaseScene(target);

    expect(target.lights).toHaveLength(2);
    expect(base.ambientLight).toBeInstanceOf(HemisphericLight);
    expect(base.sun).toBeInstanceOf(DirectionalLight);
    expect(base.sun.direction.y).toBeLessThan(0);
  });

  it('creates no shadows (spec §38: shadows are selective and come later)', () => {
    const target = scene();
    const base = createBaseScene(target);

    expect(base.sun.shadowEnabled).toBe(false);
    expect(base.sun.getShadowGenerator()).toBeFalsy();
    expect(base.ground.receiveShadows).toBe(false);
  });

  it('paints sky and fog in the same colour so the ground edge disappears', () => {
    const target = scene();
    const base = createBaseScene(target, { skyColor: '#405060' });
    const sky = Color3.FromHexString('#405060');

    expect(target.clearColor.r).toBeCloseTo(sky.r, 5);
    expect(target.clearColor.g).toBeCloseTo(sky.g, 5);
    expect(target.clearColor.b).toBeCloseTo(sky.b, 5);
    expect(target.clearColor.a).toBe(1);
    expect(target.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(target.fogColor.equalsWithEpsilon(sky, 1e-5)).toBe(true);
    expect(target.fogStart).toBe(base.options.fogStart);
    expect(target.fogEnd).toBe(base.options.fogEnd);
  });

  it('leaves fog off when it is not wanted', () => {
    const target = scene();
    createBaseScene(target, { fog: false });

    expect(target.fogMode).toBe(Scene.FOGMODE_NONE);
  });

  it('gives the ground its own opaque material rather than the scene default', () => {
    const target = scene();
    const base = createBaseScene(target, { groundColor: '#3d4a33' });

    expect(base.ground.material).toBe(base.groundMaterial);
    expect(base.groundMaterial).not.toBe(target.defaultMaterial);
    expect(
      base.groundMaterial.diffuseColor.equalsWithEpsilon(Color3.FromHexString('#3d4a33'), 1e-5),
    ).toBe(true);
    // Flat stylised look (spec §23), and one less lighting term per pixel.
    expect(base.groundMaterial.specularColor.equals(Color3.Black())).toBe(true);
  });

  it('actually renders: the ground survives a real frame as an active mesh', () => {
    const target = scene();
    const base = createBaseScene(target);
    const camera = new FreeCamera('probe', new Vector3(0, 12, -24), target);
    camera.setTarget(Vector3.Zero());

    target.render();

    expect(target.getActiveMeshes().length).toBe(1);
    expect(target.getActiveMeshes().data[0]).toBe(base.ground);
  });

  it('removes everything it added on dispose', () => {
    const target = scene();
    const base = createBaseScene(target);

    base.dispose();
    base.dispose();

    expect(target.meshes).toHaveLength(0);
    expect(target.lights).toHaveLength(0);
    expect(target.materials).toHaveLength(0);
    expect(target.fogMode).toBe(Scene.FOGMODE_NONE);
  });
});
