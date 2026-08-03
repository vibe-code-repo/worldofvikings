/**
 * Phase E — f32 3D math for vegetation placement: 1:1 ports of the C++
 * Vector3f/Quaternion operations used by PopulateFoliage.
 *
 * C++ reference:
 *   Quaternion::euler         (Quaternion.cpp:150-177) — all float32
 *   Quaternion::look_rotation (Quaternion.cpp:180-238)
 *   Quaternion::operator*(Vector3f) (Quaternion.cpp:97-118)
 *   Vector3f::cross / normal  (Vector.h)
 *
 * All arithmetic is float32-emulated via Math.fround per operation, like the
 * rest of the worldgen port. std::sin/cos on floats (sinf/cosf) can differ
 * from Math.sin/cos in the last bit — same accepted 1-ulp class as the C6
 * river points.
 */

import type { Vector3, Quaternion } from '../types.js';

const f32 = Math.fround;
const DEG2RAD = f32(0.0174532924);

/** C++ Vector3f::cross. */
export function crossF(a: Vector3, b: Vector3): Vector3 {
  return {
    x: f32(f32(a.y * b.z) - f32(a.z * b.y)),
    y: f32(f32(a.z * b.x) - f32(a.x * b.z)),
    z: f32(f32(a.x * b.y) - f32(a.y * b.x)),
  };
}

/** C++ Vector3f::normal() — v / magnitude (float32). */
export function normalF(v: Vector3): Vector3 {
  const m = f32(Math.sqrt(f32(f32(f32(v.x * v.x) + f32(v.y * v.y)) + f32(v.z * v.z))));
  if (m === 0) return { x: 0, y: 0, z: 0 };
  return { x: f32(v.x / m), y: f32(v.y / m), z: f32(v.z / m) };
}

/** C++ Quaternion::euler(x°, y°, z°) (Quaternion.cpp:150-177). */
export function quatEuler(x: number, y: number, z: number): Quaternion {
  const yaw = f32(x * DEG2RAD);
  const sinYawOver2 = f32(Math.sin(f32(yaw * 0.5)));
  const cosYawOver2 = f32(Math.cos(f32(yaw * 0.5)));

  const pitch = f32(y * DEG2RAD);
  const sinPitchOver2 = f32(Math.sin(f32(pitch * 0.5)));
  const cosPitchOver2 = f32(Math.cos(f32(pitch * 0.5)));

  const roll = f32(z * DEG2RAD);
  const sinRollOver2 = f32(Math.sin(f32(roll * 0.5)));
  const cosRollOver2 = f32(Math.cos(f32(roll * 0.5)));

  // Important for precision (manual inlining might affect precision)
  const sinYawCosPitch = f32(sinYawOver2 * cosPitchOver2);
  const cosYawSinPitch = f32(cosYawOver2 * sinPitchOver2);
  const cosYawCosPitch = f32(cosYawOver2 * cosPitchOver2);
  const negSinYawSinPitch = f32(-sinYawOver2 * sinPitchOver2);

  return {
    x: f32(f32(cosRollOver2 * sinYawCosPitch) + f32(sinRollOver2 * cosYawSinPitch)),
    y: f32(f32(cosRollOver2 * cosYawSinPitch) - f32(sinRollOver2 * sinYawCosPitch)),
    z: f32(f32(cosRollOver2 * negSinYawSinPitch) + f32(sinRollOver2 * cosYawCosPitch)),
    w: f32(f32(cosRollOver2 * cosYawCosPitch) - f32(sinRollOver2 * negSinYawSinPitch)),
  };
}

/** C++ Quaternion::operator*(Quaternion rhs) (Quaternion.cpp:120-125).
 *  All float32; C++ evaluates each component left-to-right as f32 ops. */
export function quatMul(a: Quaternion, rhs: Quaternion): Quaternion {
  return {
    x: f32(
      f32(f32(f32(a.w * rhs.x) + f32(a.x * rhs.w)) + f32(a.y * rhs.z)) - f32(a.z * rhs.y)
    ),
    y: f32(
      f32(f32(f32(a.w * rhs.y) + f32(a.y * rhs.w)) + f32(a.z * rhs.x)) - f32(a.x * rhs.z)
    ),
    z: f32(
      f32(f32(f32(a.w * rhs.z) + f32(a.z * rhs.w)) + f32(a.x * rhs.y)) - f32(a.y * rhs.x)
    ),
    w: f32(
      f32(f32(f32(a.w * rhs.w) - f32(a.x * rhs.x)) - f32(a.y * rhs.y)) - f32(a.z * rhs.z)
    ),
  };
}

/** C++ Quaternion::operator*(Vector3f) — rotate point by quaternion. */
export function quatMulVec3(q: Quaternion, point: Vector3): Vector3 {  const x2 = f32(q.x * 2);
  const y2 = f32(q.y * 2);
  const z2 = f32(q.z * 2);

  const x2s = f32(q.x * x2);
  const y2s = f32(q.y * y2);
  const z2s = f32(q.z * z2);

  const xy2 = f32(q.x * y2);
  const xz2 = f32(q.x * z2);
  const yz2 = f32(q.y * z2);

  const wx2 = f32(q.w * x2);
  const wy2 = f32(q.w * y2);
  const wz2 = f32(q.w * z2);

  return {
    x: f32(
      f32(f32(1 - f32(y2s + z2s)) * point.x) +
        f32(f32(xy2 - wz2) * point.y) +
        f32(f32(xz2 + wy2) * point.z)
    ),
    y: f32(
      f32(f32(xy2 + wz2) * point.x) +
        f32(f32(1 - f32(x2s + z2s)) * point.y) +
        f32(f32(yz2 - wx2) * point.z)
    ),
    z: f32(
      f32(f32(xz2 - wy2) * point.x) +
        f32(f32(yz2 + wx2) * point.y) +
        f32(f32(1 - f32(x2s + y2s)) * point.z)
    ),
  };
}

/** C++ Quaternion::look_rotation(forward, up) (Quaternion.cpp:180-238). */
export function quatLookRotation(forwardIn: Vector3, upIn: Vector3): Quaternion {
  const forward = normalF(forwardIn);
  const right = normalF(crossF(upIn, forward));
  const up = crossF(forward, right);

  const m00 = right.x, m01 = right.y, m02 = right.z;
  const m10 = up.x, m11 = up.y, m12 = up.z;
  const m20 = forward.x, m21 = forward.y, m22 = forward.z;

  const num8 = f32(f32(m00 + m11) + m22);
  if (num8 > 0) {
    let num = f32(Math.sqrt(f32(num8 + 1)));
    const w = f32(num * 0.5);
    num = f32(0.5 / num);
    return {
      x: f32(f32(m12 - m21) * num),
      y: f32(f32(m20 - m02) * num),
      z: f32(f32(m01 - m10) * num),
      w,
    };
  }

  if (m00 >= m11 && m00 >= m22) {
    const num7 = f32(Math.sqrt(f32(f32(f32(1 + m00) - m11) - m22)));
    const num4 = f32(0.5 / num7);
    return {
      x: f32(0.5 * num7),
      y: f32(f32(m01 + m10) * num4),
      z: f32(f32(m02 + m20) * num4),
      w: f32(f32(m12 - m21) * num4),
    };
  }

  if (m11 > m22) {
    const num6 = f32(Math.sqrt(f32(f32(f32(1 + m11) - m00) - m22)));
    const num3 = f32(0.5 / num6);
    return {
      x: f32(f32(m10 + m01) * num3),
      y: f32(0.5 * num6),
      z: f32(f32(m21 + m12) * num3),
      w: f32(f32(m20 - m02) * num3),
    };
  }

  const num5 = f32(Math.sqrt(f32(f32(f32(1 + m22) - m00) - m11)));
  const num2 = f32(0.5 / num5);
  return {
    x: f32(f32(m20 + m02) * num2),
    y: f32(f32(m21 + m12) * num2),
    z: f32(0.5 * num5),
    w: f32(f32(m01 - m10) * num2),
  };
}
