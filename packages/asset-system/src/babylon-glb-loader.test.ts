import { GetRegisteredSceneLoaderPluginMetadata } from '@babylonjs/core/Loading/sceneLoader.js';
import { describe, expect, it } from 'vitest';
import { createBabylonGlbLoader } from './babylon-glb-loader.js';

/**
 * The part of Babylon's plugin metadata this test reads.
 *
 * `GetRegisteredSceneLoaderPluginMetadata` returns a `DeepImmutableArray`,
 * whose interface refers to itself through `DeepImmutable`; TypeScript cannot
 * resolve members through that, so `.map` on the result hands the callback an
 * implicit `any`. Naming the shape here keeps the assertion typed instead of
 * silently checking nothing.
 */
interface RegisteredPluginMetadata {
  readonly extensions: readonly { readonly extension: string }[];
}

/**
 * Babylon.js registers nothing by itself: a loader that is never registered
 * fails at runtime with "no plugin found", not at build time. This test is the
 * witness that importing this module actually teaches Babylon about `.glb`.
 */
describe('createBabylonGlbLoader', () => {
  it('registers a scene loader plugin for .glb and .gltf', async () => {
    await createBabylonGlbLoader();

    const plugins: readonly RegisteredPluginMetadata[] = GetRegisteredSceneLoaderPluginMetadata();
    const extensions = plugins.flatMap((plugin) =>
      plugin.extensions.map((entry) => entry.extension),
    );

    expect(extensions).toContain('.glb');
    expect(extensions).toContain('.gltf');
  });

  it('registers only glTF, so no second model format creeps in', async () => {
    await createBabylonGlbLoader();

    const plugins: readonly RegisteredPluginMetadata[] = GetRegisteredSceneLoaderPluginMetadata();
    const extensions = plugins.flatMap((plugin) =>
      plugin.extensions.map((entry) => entry.extension),
    );

    expect([...extensions].sort()).toEqual(['.glb', '.gltf']);
  });

  it('returns a callable loader', async () => {
    expect(typeof (await createBabylonGlbLoader())).toBe('function');
  });
});
