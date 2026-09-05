/**
 * The only vector type gameplay knows.
 *
 * It is deliberately a plain readonly record and not a Babylon.js `Vector3`:
 * gameplay state must stay renderer-free (spec §25, agent rule 7), must survive
 * `structuredClone` for save games and must be comparable field by field in
 * tests. The renderer copies these numbers into its own vectors.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Origin, reused so a resting entity does not allocate. */
export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** Builds a {@link Vec3}. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * Length of the `x`/`z` part of a vector.
 *
 * `Math.sqrt` is IEEE-754 exact in every engine, `Math.hypot` is not — the
 * simulation must produce the same numbers on every machine, so the longer
 * expression is the deterministic one.
 */
export function horizontalLength(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
