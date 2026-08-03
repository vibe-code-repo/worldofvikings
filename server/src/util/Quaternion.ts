/**
 * Quaternion math utilities.
 * 1:1 port of Quaternion.h from Valhalla2.0 C++.
 */

import type { Quaternion, Vector3 } from '@wov/shared';

export function quat(x = 0, y = 0, z = 0, w = 1): Quaternion {
  return { x, y, z, w };
}

export const QUAT_IDENTITY: Quaternion = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function quatFromEuler(pitch: number, yaw: number, roll: number): Quaternion {
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  };
}

export function quatFromAxisAngle(axis: Vector3, angle: number): Quaternion {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

export function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatNormalize(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-8) return { ...QUAT_IDENTITY };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatInverse(q: Quaternion): Quaternion {
  const lenSqr = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (lenSqr < 1e-8) return { ...QUAT_IDENTITY };
  return { x: -q.x / lenSqr, y: -q.y / lenSqr, z: -q.z / lenSqr, w: q.w / lenSqr };
}

export function quatSlerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  if (dot > 0.9995) {
    return quatNormalize({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);

  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return {
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  };
}

export function quatRotateVec3(q: Quaternion, v: Vector3): Vector3 {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const vx = v.x, vy = v.y, vz = v.z;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  };
}

/**
 * C++ reference: Quaternion::ToEuler
 * Returns euler angles in radians (pitch, yaw, roll).
 */
export function quatToEuler(q: Quaternion): Vector3 {
  const sinp = 2 * (q.w * q.x - q.y * q.z);
  const pitch = Math.abs(sinp) >= 1
    ? (Math.sign(sinp) * Math.PI) / 2
    : Math.asin(sinp);

  const yaw = Math.atan2(
    2 * (q.w * q.y + q.x * q.z),
    1 - 2 * (q.x * q.x + q.y * q.y)
  );

  const roll = Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.x * q.x + q.z * q.z)
  );

  return { x: pitch, y: yaw, z: roll };
}
