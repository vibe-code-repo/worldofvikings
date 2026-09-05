import type { GlbLoader } from './glb-loader.js';

/**
 * The Babylon.js implementation of {@link GlbLoader}.
 *
 * Two things about Babylon.js drive the shape of this module:
 *
 * 1. **Nothing registers itself.** `@babylonjs/loaders` exports the glTF loader
 *    but does not install it; a scene loader call for an unregistered extension
 *    fails at runtime with "no plugin found", and no build step warns about it.
 *    So registration is explicit here, and `babylon-glb-loader.test.ts` asserts
 *    that it actually happened.
 * 2. **The loaders are heavy.** Both the plugin and the glTF extensions are
 *    registered as async factories, so the loader code is fetched on the first
 *    real load, not on page load, and only the extensions a model uses are
 *    fetched at all. The Babylon imports below are dynamic for the same reason:
 *    importing `@wov/asset-system` must not pull the renderer into Node tooling
 *    or into a bundle chunk that only needs `assetUrl`.
 *
 * Only glTF/GLB is registered. OBJ, STL and SPLAT are deliberately absent: GLB
 * is the project's model format (spec §37), and a loader that is not registered
 * cannot quietly become a second one.
 */

let registered = false;

/**
 * Registers the glTF 2.0 loader with Babylon.js (once) and returns a loader
 * function for {@link AssetManager}.
 */
export async function createBabylonGlbLoader(): Promise<GlbLoader> {
  const [sceneLoader, { GLTFFileLoaderMetadata }, { registerBuiltInGLTFExtensions }] =
    await Promise.all([
      import('@babylonjs/core/Loading/sceneLoader.js'),
      import('@babylonjs/loaders/glTF/glTFFileLoader.metadata.js'),
      import('@babylonjs/loaders/glTF/2.0/Extensions/dynamic.js'),
    ]);

  if (!registered) {
    registered = true;
    sceneLoader.RegisterSceneLoaderPlugin({
      ...GLTFFileLoaderMetadata,
      createPlugin: async (options) => {
        const { GLTFFileLoader } = await import('@babylonjs/loaders/glTF/2.0/glTFLoader.js');
        return new GLTFFileLoader(options[GLTFFileLoaderMetadata.name]);
      },
    });
    // KHR_draco_mesh_compression, EXT_meshopt_compression, KHR_texture_basisu
    // and friends (spec §37). Without these, a compressed model fails to load.
    registerBuiltInGLTFExtensions();
  }

  // `LoadAssetContainerAsync`, not the lower-case alias: that one is deprecated
  // in Babylon.js 8 and will go away.
  return (url, scene) => sceneLoader.LoadAssetContainerAsync(url, scene);
}
