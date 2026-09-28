import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Narrow interfaces so tests can pass plain stubs instead of a real camera/listener. */
export interface CameraPositionLike {
  readonly position: Vector3;
}
export interface ListenerPositionLike {
  position: Vector3;
}

/**
 * Copies the camera's position onto the spatial audio listener. Called
 * every frame from AudioEngine (scene.onBeforeRenderObservable) instead
 * of AbstractSpatialAudioListener.attach(), so the sync is our own
 * testable code path rather than opaque library behaviour.
 *
 * The player camera (client/src/player/PlayerController.ts) is never
 * parented — its `position` is set absolutely each frame — so no world
 * matrix decomposition is needed here.
 */
export function syncListenerPosition(camera: CameraPositionLike, listener: ListenerPositionLike): void {
  listener.position.copyFrom(camera.position);
}
