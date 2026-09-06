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

/**
 * Normalises a configured service URL, or falls back to the local default.
 *
 * Both apps read one of these out of `import.meta.env` and both had the same
 * three lines: an empty value means "the local development service", anything
 * else has to be an absolute http(s) URL, and a trailing slash would turn
 * `${base}/worlds` into a double slash. A malformed value throws here rather
 * than turning every later request into an unexplained failure.
 *
 * @param configured the raw environment value, or `undefined` when unset.
 * @param fallback the local default, used when `configured` is empty.
 * @param name the variable's name, so the error says which one is wrong.
 */
export function resolveServiceUrl(
  configured: string | undefined,
  fallback: string,
  name: string,
): string {
  const raw = (configured ?? '').trim();
  const url = raw === '' ? fallback : raw;
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`${name} must be an absolute http(s) URL, got "${url}"`);
  }
  return url.replace(/\/+$/, '');
}

/**
 * Whether the page was opened with `?debug=1`.
 *
 * The other half of the debug-bridge gate (ADR-0030). A development build
 * always publishes its bridge; a *built* bundle publishes one only when it was
 * compiled with `WOV_DEBUG_BRIDGE=1` — a build-time constant, so a default
 * `pnpm build` folds the branch away and drops the module — and the visitor
 * asked for it here. Staging serves built bundles and has to stay measurable;
 * a handle into the running client should still not be the default.
 */
export function isDebugRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}
