import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import { afterEach, describe, expect, it } from 'vitest';
import { applyLighting } from './lighting.js';
import type { LightingHandle } from './lighting.js';
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

/**
 * The meshes the shadow map would draw, as the rig has them now.
 *
 * The list is derived from the scene, not asked for mesh by mesh: it is
 * rebuilt on the pass after something changed rather than on every pass, so a
 * test has to announce a pass to see the answer. That is the behaviour under
 * test — a list rebuilt sixty times a second to reach the same conclusion was a
 * tenth of the frame.
 */
function shadowCasters(handle: LightingHandle): readonly unknown[] {
  const map = handle.shadows?.getShadowMap();
  map?.onBeforeRenderObservable.notifyObservers(0);
  return map?.renderList ?? [];
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
      profiles: [{ sun: { direction: [0, -1, 0] }, shadows: { distance: 100, mapSize: 1024 } }],
    });

    handle.focusShadows(10, 5, -20);
    // Behind the focus point by the full distance, along the light — that part
    // is exact. Across it the position is quantised onto the map's own texels
    // (ADR-0039), so it may sit up to half a texel away and must sit on the
    // lattice: 100 m over 1024 texels is 9.77 cm.
    const texel = 100 / 1024;
    expect(handle.sun.position.y).toBeCloseTo(105, 5);
    expect(Math.abs(handle.sun.position.x - 10)).toBeLessThanOrEqual(texel / 2 + 1e-9);
    expect(Math.abs(handle.sun.position.z - -20)).toBeLessThanOrEqual(texel / 2 + 1e-9);
    expect(handle.sun.position.x / texel).toBeCloseTo(Math.round(handle.sun.position.x / texel), 6);
    expect(handle.sun.position.z / texel).toBeCloseTo(Math.round(handle.sun.position.z / texel), 6);
  });

  it('keeps the shadow map on the same texel grid while the focus walks', () => {
    const target = scene();
    const handle = applyLighting(target, {
      // The village's own evening sun and map, so the numbers are the ones the
      // shimmer was measured with: 120 m over 2048 texels is 5.86 cm a texel.
      profiles: [{ sun: { direction: [0.58, -0.45, 0.68] }, shadows: { distance: 120 } }],
    });
    const generator = handle.shadows;
    expect(generator).not.toBeNull();

    /**
     * Where the world origin lands in the map, in texels, fraction only.
     *
     * This is the thing that used to move. The map is a grid of texels laid
     * over the world by the light matrix; if the fractional part of a fixed
     * world point's texel coordinate changes between frames, every silhouette
     * in the map is being rasterised onto a different grid and its edge
     * crawls. A still frame cannot show that, so it is measured here.
     */
    const phase = (): [number, number] => {
      // Babylon caches the light matrix per rendered frame, so a measurement
      // that never renders would read the first frame's matrix sixty times and
      // find it wonderfully stable. This is what makes each reading a frame.
      target.incrementRenderId();
      const matrix = generator?.getTransformMatrix();
      if (matrix === undefined) {
        throw new Error('no shadow transform to measure');
      }
      const inMap = Vector3.TransformCoordinates(Vector3.Zero(), matrix);
      const half = 2048 / 2;
      const fraction = (value: number): number => value - Math.floor(value);
      return [fraction(inMap.x * half), fraction(inMap.y * half)];
    };

    // A walk at full speed, sampled at 60 Hz: 4.5 m/s is 7.5 cm a frame, which
    // is more than one texel and lands on a different fraction of one every
    // time. Before the snap these phases swept the whole ±0.5 texel.
    handle.focusShadows(40, 6, -12);
    const first = phase();
    const parked = handle.sun.position.clone();
    for (let frame = 1; frame <= 60; frame += 1) {
      const walked = (frame * 4.5) / 60;
      handle.focusShadows(40 + walked * 0.8, 6 + Math.sin(frame) * 0.02, -12 + walked * 0.6);
      const now = phase();
      expect(now[0]).toBeCloseTo(first[0], 4);
      expect(now[1]).toBeCloseTo(first[1], 4);
    }

    // And it did follow the player rather than standing still, or the phase
    // above would be constant for the least interesting of reasons.
    // A second of walking is 4.5 m, and the map's centre went with it — bar
    // the half texel it is allowed to lag by.
    expect(Vector3.Distance(handle.sun.position, parked)).toBeGreaterThan(4.4);
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

    const casters = shadowCasters(handle);
    expect(casters).not.toContain(ground);
    expect(casters).toContain(house);
    // And the sky it made itself is never a caster: a box around the camera
    // would fill the map and put the whole village in shade.
    expect(handle.sky).not.toBeNull();
    expect(casters).not.toContain(handle.sky);
  });

  it('takes in a mesh that arrives after the rig did', async () => {
    const target = scene();
    const handle = applyLighting(target);
    expect(shadowCasters(handle)).toHaveLength(0);

    const late = CreateGround('late', { width: 1, height: 1 }, target);
    // Babylon announces a new mesh on the next tick, not inside `addMesh`.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowCasters(handle)).toContain(late);
  });

  it('lets go of a mesh the scene disposed', async () => {
    const target = scene();
    const handle = applyLighting(target);
    const doomed = CreateGround('doomed', { width: 1, height: 1 }, target);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowCasters(handle)).toContain(doomed);

    // The failure a list built once and never rebuilt would have: the map
    // keeps drawing a mesh nothing else in the scene has any more.
    doomed.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowCasters(handle)).not.toContain(doomed);
  });

  it('reuses the caster list while the scene stands still', async () => {
    const target = scene();
    const house = CreateGround('house', { width: 1, height: 1 }, target);
    const handle = applyLighting(target);
    await new Promise((resolve) => setTimeout(resolve, 0));

    shadowCasters(handle);
    const first = handle.shadows?.getShadowMap()?.renderList;
    shadowCasters(handle);
    const second = handle.shadows?.getShadowMap()?.renderList;
    // The same array object, not merely an equal one: rebuilding it is the
    // whole cost this change removes, and an equality check would pass just as
    // happily against a list rebuilt on every pass.
    expect(second).toBe(first);
    expect(second).toContain(house);
  });

  it('lets a mesh take shadow without casting one', () => {
    const target = scene();
    const ground = CreateGround('tile', { width: 4, height: 4 }, target);
    const grass = CreateGround('grass', { width: 1, height: 1 }, target);
    const house = CreateGround('house', { width: 1, height: 1 }, target);
    const handle = applyLighting(target);

    handle.excludeFromCasting([grass]);

    const casters = shadowCasters(handle);
    expect(casters).not.toContain(grass);
    expect(casters).toContain(house);
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

  it('grades colour out through the colour curves, and only when asked to', () => {
    const untouched = applyLighting(scene(), {});
    expect(untouched.pipeline?.imageProcessing?.colorCurvesEnabled).toBe(false);

    const matte = applyLighting(scene(), { profiles: [{ postProcessing: { saturation: 0.7 } }] });
    const image = matte.pipeline?.imageProcessing;
    expect(image?.colorCurvesEnabled).toBe(true);
    // Babylon states the same knob as -100…100 around zero.
    expect(image?.colorCurves?.globalSaturation).toBeCloseTo(-30, 6);
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
