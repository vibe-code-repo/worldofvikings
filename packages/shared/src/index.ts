/**
 * @wov/shared — tiny, framework-free helpers.
 *
 * Nothing in here may import Babylon.js, React, Node built-ins or any other
 * runtime-specific API: this package is used by the game, the editor, the API
 * and the tooling scripts alike.
 */

/** Semantic version of the shared helpers, useful in debug overlays. */
export const SHARED_VERSION = '0.0.0';

/** Clamps `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) must not be greater than max (${max})`);
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Exhaustiveness helper for discriminated unions.
 * Calling it is a compile error unless every case has been handled.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
