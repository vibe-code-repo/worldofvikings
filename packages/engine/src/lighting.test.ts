import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import { afterEach, describe, expect, it } from 'vitest';
import { applyLighting } from './lighting.js';
import { createTerrainMaterial } from './terrain.js';

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
  new FreeCamera('camera', new Vector3(0, 2, -10), created);
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

describe('applyLighting', () => {
  it('lights the scene from the profile, sun and fill both', () => {
    const target = scene();
    const handle = applyLighting(target, {
      profiles: [{ sun: { intensity: 2.5, color: '#ff8800' }, ambient: { intensity: 0.2 } }],
    });

    expect(handle.sun.intensity).toBe(2.5);
    expect(handle.sun.diffuse.toHexString().toLowerCase()).toBe('#ff8800');
    expect(handle.ambient.intensity).toBe(0.2);
    // The sun points somewhere, and downwards: an evening sun that points up
    // lights the underside of the world and nothing else.
    expect(handle.sun.direction.y).toBeLessThan(0);
  });

  it('takes over lights it is handed instead of adding a second sun', () => {
    const target = scene();
    const sun = new DirectionalLight('base-sun', new Vector3(0, -1, 0), target);
    const ambient = new HemisphericLight('base-ambient', new Vector3(0, 1, 0), target);

    const handle = applyLighting(target, { sun, ambient });

    expect(handle.sun).toBe(sun);
    expect(handle.ambient).toBe(ambient);
    expect(target.lights.filter((light) => light instanceof DirectionalLight)).toHaveLength(1);
    // And it leaves them behind on dispose: they are the base scene's.
    handle.dispose();
    expect(sun.isDisposed()).toBe(false);
    expect(ambient.isDisposed()).toBe(false);
  });

  it('sets linear fog from the profile and puts it back on dispose', () => {
    const target = scene();
    target.fogMode = Scene.FOGMODE_NONE;

    const handle = applyLighting(target, { profiles: [{ fog: { start: 20, end: 90 } }] });
    expect(target.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(target.fogStart).toBe(20);
    expect(target.fogEnd).toBe(90);

    handle.dispose();
    expect(target.fogMode).toBe(Scene.FOGMODE_NONE);
  });

  it('builds a shadow map at the size the profile asks for', () => {
    const target = scene();
    const handle = applyLighting(target, { profiles: [{ shadows: { mapSize: 512 } }] });

    expect(handle.shadows).not.toBeNull();
    expect(handle.shadows?.getShadowMap()?.getSize().width).toBe(512);
    // A fixed frustum, not the automatic one: the map covers `distance` metres
    // around the player rather than every caster in the world (ADR-0024).
    expect(handle.sun.shadowFrustumSize).toBe(handle.profile.shadows.distance);
  });

  it('builds no shadow map when the profile turns shadows off', () => {
    const target = scene();
    const handle = applyLighting(target, { profiles: [{ shadows: { enabled: false } }] });

    expect(handle.shadows).toBeNull();
    expect(handle.sun.shadowEnabled).toBe(false);
    expect(target.shadowsEnabled).toBe(false);
  });

  it('parks the sun behind whatever the shadow map is focused on', () => {
    const target = scene();
    const handle = applyLighting(target, {
      profiles: [{ sun: { direction: [0, -1, 0] }, shadows: { distance: 100 } }],
    });

    handle.focusShadows(10, 5, -20);
    expect(handle.sun.position.x).toBeCloseTo(10, 5);
    expect(handle.sun.position.y).toBeCloseTo(105, 5);
    expect(handle.sun.position.z).toBeCloseTo(-20, 5);
  });

  it('makes every mesh a receiver, including ones added afterwards', async () => {
    const target = scene();
    const before = CreateGround('before', { width: 4, height: 4 }, target);
    const handle = applyLighting(target);
    const after = CreateGround('after', { width: 4, height: 4 }, target);

    expect(before.receiveShadows).toBe(true);
    // Babylon announces a new mesh on the next tick, not inside `addMesh`, so
    // the assertion that matters has to wait for one — which is also why the
    // app never has to sequence anything: a village that arrives over seconds
    // is a stream of these announcements.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(after.receiveShadows).toBe(true);
    expect(handle.shadows).not.toBeNull();
  });

  it('excludes a mesh from the shadow map as caster and as receiver', () => {
    const target = scene();
    const ground = CreateGround('tile', { width: 4, height: 4 }, target);
    const house = CreateGround('house', { width: 1, height: 1 }, target);
    const handle = applyLighting(target);

    handle.excludeFromShadows([ground]);
    expect(ground.receiveShadows).toBe(false);

    const predicate = handle.shadows?.getShadowMap()?.renderListPredicate;
    expect(predicate).toBeTypeOf('function');
    expect(predicate?.(ground)).toBe(false);
    expect(predicate?.(house)).toBe(true);
    // And the sky it made itself is never a caster: a box around the camera
    // would fill the map and put the whole village in shade.
    expect(handle.sky).not.toBeNull();
    expect(handle.sky === null ? true : predicate?.(handle.sky)).toBe(false);
  });

  it('lets a mesh take shadow without casting one', () => {
    const target = scene();
    const ground = CreateGround('tile', { width: 4, height: 4 }, target);
    const grass = CreateGround('grass', { width: 1, height: 1 }, target);
    const house = CreateGround('house', { width: 1, height: 1 }, target);
    const handle = applyLighting(target);

    handle.excludeFromCasting([grass]);

    const predicate = handle.shadows?.getShadowMap()?.renderListPredicate;
    expect(predicate?.(grass)).toBe(false);
    expect(predicate?.(house)).toBe(true);
    // The whole point: it is out of the map as a caster and still in the
    // picture as a receiver. Excluding it outright would take both.
    expect(grass.receiveShadows).toBe(true);
    expect(ground.receiveShadows).toBe(true);
  });

  it('leaves the sky out when the profile turns it off', () => {
    const target = scene();
    const handle = applyLighting(target, { profiles: [{ sky: { enabled: false } }] });
    expect(handle.sky).toBeNull();
    // The clear colour still becomes the horizon, so there is no default grey.
    expect(target.clearColor.toHexString().toLowerCase()).toContain(
      handle.profile.sky.horizonColor.slice(1).toLowerCase(),
    );
  });

  it('leaves the grading chain out when post-processing is off', () => {
    const target = scene();
    const handle = applyLighting(target, { profiles: [{ postProcessing: { enabled: false } }] });
    expect(handle.pipeline).toBeNull();
    expect(handle.ssao).toBeNull();
  });

  it('gives the ground a shadow lookup only once a shadow map exists', () => {
    const dark = scene();
    applyLighting(dark, { profiles: [{ shadows: { enabled: false } }] });
    const unlit = createTerrainMaterial(dark, 'tile', {
      position: [0, 0, 0],
      size: [10, 10],
      receiveShadows: true,
    });

    const lit = scene();
    applyLighting(lit, { profiles: [{ shadows: { mapSize: 512 } }] });
    const shadowed = createTerrainMaterial(lit, 'tile', {
      position: [0, 0, 0],
      size: [10, 10],
      receiveShadows: true,
    });
    // The material declares the sampler exactly when there is a map to sample.
    expect(shadowed.material.options.samplers).toContain('uShadowMap');
    expect(unlit.material.options.samplers).not.toContain('uShadowMap');
  });
});
