import { type Transform, type Vec3 } from '@wov/gameplay';

/**
 * Render-side interpolation between two simulation steps (ADR-0008).
 *
 * Gameplay advances 60 times a second, the display may refresh 144 times. The
 * frame loop reports how far the frame sits past the last step, and the
 * presentation blends the two states with it — without this, a 144 Hz monitor
 * shows the same position for two or three frames and then a jump.
 *
 * This is presentation, not state: it produces numbers for a mesh and writes
 * nothing back (spec §25).
 */
export function interpolatePosition(previous: Transform, current: Transform, alpha: number): Vec3 {
  // A caller outside [0, 1) would put the mesh somewhere the simulation never
  // was, so the factor is clamped rather than trusted. NaN falls through to the
  // current state, which is the honest answer when the blend is unknown.
  const factor = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  const a = previous.position;
  const b = current.position;

  return {
    x: a.x + (b.x - a.x) * factor,
    y: a.y + (b.y - a.y) * factor,
    z: a.z + (b.z - a.z) * factor,
  };
}
