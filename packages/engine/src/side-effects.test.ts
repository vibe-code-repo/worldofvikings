/**
 * Proves that the Babylon.js side-effect imports the shared bootstrap promises
 * are actually in effect.
 *
 * Why this test exists: with the ES6 packages a missing side-effect import
 * produces no error. `scene.pickWithRay` is *declared on `Scene` in
 * `scene.d.ts`* and is a real function at runtime even when
 * `@babylonjs/core/Culling/ray.js` was never imported — it is a stub that
 * throws the moment it is called. So neither `tsc` nor a `typeof` check is a
 * witness. Only calling the feature and looking at the result is.
 *
 * Every case below therefore exercises the feature end to end. The test file
 * deliberately imports the Babylon modules that only *define* things
 * (`ray.core.js` for the `Ray` class, a single mesh builder) and never the
 * modules that *register* them — otherwise the test would install the very
 * side effect it claims to verify.
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// `ray.core.js` exports the `Ray` class without patching `Scene`. Importing
// `Culling/ray.js` here instead would make this test pass unconditionally.
import { Ray } from '@babylonjs/core/Culling/ray.core.js';
// A single builder module: it defines `CreateBox` and registers nothing.
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderer } from './renderer.js';
import type { RendererHandle } from './renderer.js';

let renderer: RendererHandle | undefined;

afterEach(() => {
  renderer?.dispose();
  renderer = undefined;
});

async function headlessRenderer(): Promise<RendererHandle> {
  renderer = await createRenderer(null, {
    createEngine: () =>
      new NullEngine({
        renderWidth: 64,
        renderHeight: 64,
        textureSize: 64,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      }),
    autoStart: false,
    resizeHost: null,
  });
  return renderer;
}

describe('side effects guaranteed by @wov/engine', () => {
  it('makes ray picking actually hit a mesh (@babylonjs/core/Culling/ray.js)', async () => {
    const { scene } = await headlessRenderer();
    const box = CreateBox('probe', { size: 2 }, scene);
    box.position = new Vector3(0, 0, 10);

    const hit = scene.pickWithRay(new Ray(Vector3.Zero(), new Vector3(0, 0, 1), 100));

    // Without the import this call throws; a `typeof` check would not notice.
    expect(hit?.hit).toBe(true);
    expect(hit?.pickedMesh?.name).toBe('probe');
  });

  it('leaves a ray that misses everything as a non-hit rather than an error', async () => {
    const { scene } = await headlessRenderer();
    const box = CreateBox('probe', { size: 2 }, scene);
    box.position = new Vector3(0, 0, 10);

    // Fires away from the box: picking must answer "nothing", not blow up.
    const miss = scene.pickWithRay(new Ray(Vector3.Zero(), new Vector3(0, 0, -1), 100));

    expect(miss?.hit).toBe(false);
    expect(miss?.pickedMesh).toBeNull();
  });

  it('gives the scene a usable default material (@babylonjs/core/Materials/standardMaterial.js)', async () => {
    const { scene } = await headlessRenderer();

    // `Scene.DefaultMaterialFactory` is a function either way; without the
    // import calling it throws, so reading the material is the real witness.
    expect(scene.defaultMaterial.getClassName()).toBe('StandardMaterial');
  });

  it('gives a mesh created without a material the default one', async () => {
    const { scene } = await headlessRenderer();
    const box = CreateBox('probe', { size: 1 }, scene);

    expect(box.material).toBeNull();
    expect(scene.getMaterialByName(scene.defaultMaterial.name)).toBe(scene.defaultMaterial);
  });
});
