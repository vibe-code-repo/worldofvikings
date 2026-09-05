import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * Loads one GLB into an `AssetContainer` (spec §37, §38).
 *
 * This is a port, not an implementation detail: `AssetManager` is written
 * against this function type, `createBabylonGlbLoader` is one implementation of
 * it, and a test supplies another. That is what lets the cache be tested
 * without starting a renderer.
 *
 * It lives in its own module because both sides need it: the manager imports
 * the Babylon implementation lazily, and the implementation must satisfy the
 * type — putting the type in either of them makes the two import each other.
 */
export type GlbLoader = (url: string, scene: Scene) => Promise<AssetContainer>;
