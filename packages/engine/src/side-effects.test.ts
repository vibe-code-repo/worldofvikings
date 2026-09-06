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
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
// The generator class itself; `shadowGeneratorSceneComponent.js` is what
// registers the pass, and importing it here would make the case below pass
// unconditionally.
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
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

  it('renders a shadow map (@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js)', async () => {
    const { scene } = await headlessRenderer();
    scene.activeCamera = new FreeCamera('camera', new Vector3(0, 2, -10), scene);
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.5), scene);
    const caster = CreateBox('caster', { size: 2 }, scene);
    caster.position = new Vector3(0, 4, 0);

    const generator = new ShadowGenerator(256, sun);
    const map = generator.getShadowMap();
    map?.renderList?.push(caster);

    // The construction alone throws without the component. Rendering a frame
    // is the second half of the witness: the component is what asks the map to
    // render, so a map whose render count stays at zero is a map nothing ever
    // drew into — and every receiver would be lit as if there were no shadows.
    scene.render();

    expect(map?.getSize().width).toBe(256);
    expect(map?.renderList).toHaveLength(1);
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
