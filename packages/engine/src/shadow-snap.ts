/**
 * Quantising the shadow map's centre onto its own texel grid (ADR-0039).
 *
 * The single shadow map (ADR-0024) follows the player: `focusShadows` moves it
 * every rendered frame, in metres, wherever the interpolated player position
 * happens to be. Babylon builds the light's view from that position
 * (`LookAtLH`) and, because the frustum size is fixed, an orthographic box
 * centred on it — so the grid of 2048² texels is pinned to a point that slides
 * in arbitrary fractions of a texel. Every silhouette in the map therefore
 * falls into different texels each frame, and the step comparison that reads
 * it turns that into an edge that crawls. Babylon 8 has no cure on
 * `ShadowGenerator`: the only texel snapping in the library lives inside the
 * cascaded generator, and this project has one map on purpose.
 *
 * So the snapping is done here, before the light is placed: the focus point is
 * rounded onto whole texels of the light's own lateral axes. Then a focus that
 * moved less than a texel produces the *same* light matrix as before, and one
 * that moved further steps by a whole texel — which lands the map's grid on the
 * same world positions either way.
 *
 * Plain numbers rather than `Vector3`, so the arithmetic that has to be right
 * can be tested without a scene, an engine or a device.
 */

/** A point or direction, as this module passes them around. */
export type ShadowVec3 = readonly [x: number, y: number, z: number];

/**
 * The light's own axes: where its map's texel rows and columns run.
 *
 * Built the way Babylon builds the light view it must agree with
 * (`Matrix.LookAtLHToRef`): the forward axis is the light direction, the right
 * axis is `up × forward` against world up, and the up axis closes the frame.
 * Disagreeing with Babylon here would snap onto a grid the map does not have.
 */
export interface ShadowBasis {
  /** Along the light. Depth in the map; deliberately never snapped. */
  readonly forward: ShadowVec3;
  /** One texel row of the map. */
  readonly right: ShadowVec3;
  /** One texel column of the map. */
  readonly up: ShadowVec3;
}

/** World up, the reference `LookAtLH` measures the other two axes against. */
const WORLD_UP: ShadowVec3 = [0, 1, 0];

/**
 * The reference used instead when the light points along world up.
 *
 * A sun straight down leaves `up × forward` zero and the right axis undefined —
 * which without this fallback is a division by zero, a NaN light matrix and a
 * shadow map that silently disappears. Babylon nudges its own direction by
 * 1e-13 for the same reason; a named axis is the same fix said out loud, and it
 * matters because a straight-down sun is what a flat diagnostic light uses.
 */
const FALLBACK_UP: ShadowVec3 = [0, 0, 1];

function dot(a: ShadowVec3, b: ShadowVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: ShadowVec3, b: ShadowVec3): ShadowVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: ShadowVec3): ShadowVec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 1] : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * The axes of the shadow map for a light pointing this way.
 *
 * @param direction Which way the light shines; need not be normalised.
 */
export function shadowBasis(direction: ShadowVec3): ShadowBasis {
  const forward = normalize(direction);
  // Parallel to within a millionth: past that the cross product's direction is
  // decided by rounding error rather than by the two axes.
  const reference = Math.abs(dot(forward, WORLD_UP)) > 1 - 1e-6 ? FALLBACK_UP : WORLD_UP;
  const right = normalize(cross(reference, forward));
  const up = cross(forward, right);
  return { forward, right, up };
}

/**
 * The focus point rounded onto whole texels of the map's two lateral axes.
 *
 * The component along the light is left exactly as it was, deliberately: a
 * shift along the light moves caster and receiver depth by the same amount and
 * cancels in the comparison, so quantising it would buy nothing and cost the
 * map depth range. It is the two lateral components that decide which texel a
 * silhouette lands in, and pinning those is the whole fix.
 *
 * @param texel Metres one texel covers — `distance / mapSize`. A texel of zero
 *   or less returns the focus point untouched rather than dividing by it.
 */
export function snapShadowFocus(focus: ShadowVec3, basis: ShadowBasis, texel: number): ShadowVec3 {
  if (!Number.isFinite(texel) || texel <= 0) {
    return focus;
  }
  const right = Math.round(dot(focus, basis.right) / texel) * texel;
  const up = Math.round(dot(focus, basis.up) / texel) * texel;
  const forward = dot(focus, basis.forward);
  return [
    basis.right[0] * right + basis.up[0] * up + basis.forward[0] * forward,
    basis.right[1] * right + basis.up[1] * up + basis.forward[1] * forward,
    basis.right[2] * right + basis.up[2] * up + basis.forward[2] * forward,
  ];
}
