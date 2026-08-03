/**
 * Math helpers — 1:1 ports from Valhalla2.0 `VUtilsMath.cpp` / `VUtilsMathf.cpp`.
 *
 * Two precision flavors exist side by side in the C++ code:
 *  - `VUtils::Math::*` double-precision variants (HEIGHTFIX-02) used in height
 *    calculations — JS float64 matches them bit-exactly.
 *  - `VUtils::Mathf::*` / float overloads — float32 arithmetic, emulated here
 *    with Math.fround at each step (f32 operands are exact in f64, and one
 *    f64 op + fround == the IEEE float32 result).
 *
 * Each function documents its exact C++ origin.
 */

import { perlinNoise } from './Perlin.js';

/** Round to nearest float32 (IEEE single), like a C++ `float` cast/store. */
const f32 = Math.fround;

// ── VUtils::Math (double, VUtilsMath.cpp) ─────────────────────────

/** C++ `double VUtils::Math::Clamp01(double)`. */
export function clamp01(value: number): number {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

/**
 * C++ `float Mathf::Clamp01(float)` applied to a double expression.
 * In C++ the argument is cast to float first (e.g. inside LerpStep).
 */
export function clamp01f(value: number): number {
  const v = f32(value);
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * C++ `double VUtils::Math::LerpStep(double l, double h, double v)`:
 *   return Mathf::Clamp01((float)((v - l) / (h - l)));
 * Division in double, then cast to float, then clamp — result is a
 * float32-valued double.
 */
export function lerpStep(l: number, h: number, v: number): number {
  return clamp01f((v - l) / (h - l));
}

/**
 * C++ `double VUtils::Math::SmoothStep(double p_Min, double p_Max, double p_X)`:
 *   double num = Clamp01((p_X - p_Min) / (p_Max - p_Min));   // double Clamp01!
 *   return num * num * (3.0 - 2.0 * num);
 * NOTE: unlike LerpStep this uses the DOUBLE Clamp01 (no float cast).
 */
export function smoothStep(pMin: number, pMax: number, pX: number): number {
  const num = clamp01((pX - pMin) / (pMax - pMin));
  return num * num * (3.0 - 2.0 * num);
}

/**
 * C++ `double VUtils::Math::Lerp(double a, double b, double t)` (HEIGHTFIX-02).
 * No clamping of t (unlike Mathf.Lerp).
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * C++ `double VUtils::Math::MathfLikeSmoothStep(double from, double to, double t)`
 * (ASHLANDS_2.0, exact port of the client's DUtils.MathfLikeSmoothStep):
 *   t = Mathf::Clamp01(static_cast<float>(t));
 *   t = -2.0*t*t*t + 3.0*t*t;
 *   return static_cast<float>(to * t + from * (1.0 - t));
 * Applies the smoothstep curve to t, THEN lerps. Result rounded to float32.
 */
export function mathfLikeSmoothStep(from: number, to: number, t: number): number {
  t = clamp01f(t);
  t = -2.0 * t * t * t + 3.0 * t * t;
  return f32(to * t + from * (1.0 - t));
}

/**
 * C++ `double VUtils::Math::Remap(double value, fromMin, fromMax, toMin, toMax)`
 * (ASHLANDS_2.0). No clamping.
 */
export function remap(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number
): number {
  const t = (value - fromMin) / (fromMax - fromMin);
  return toMin + t * (toMax - toMin);
}

/**
 * C++ `double VUtils::Math::BlendOverlay(double base, double blend)`
 * (ASHLANDS_2.0) — Photoshop-style overlay blend.
 */
export function blendOverlay(base: number, blend: number): number {
  if (base < 0.5) return 2.0 * base * blend;
  return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

// ── VUtils::Mathf (float32, VUtilsMathf.cpp) ──────────────────────

/**
 * C++ `float VUtils::Mathf::Lerp(float a, float b, float t)`:
 *   return a + (b - a) * Mathf::Clamp01(t);
 * Unity semantics: t IS clamped. All arithmetic float32.
 */
export function mathfLerp(a: number, b: number, t: number): number {
  return f32(a + f32((b - a) * clamp01f(t)));
}

/**
 * C++ `float VUtils::Mathf::SmoothStep(float from, float to, float t)`:
 *   t = Clamp01(t); t = -2t³ + 3t²; return to*t + from*(1-t);
 * All arithmetic float32.
 */
export function mathfSmoothStep(from: number, to: number, t: number): number {
  t = clamp01f(t);
  t = f32(f32(-2 * t * t * t) + f32(3 * t * t));
  return f32(f32(to * t) + f32(from * f32(1 - t)));
}

// ── VUtils::Math geometry (float32 overloads) ─────────────────────

/**
 * C++ `float VUtils::Math::magnitude(float x, float y)` — float32 throughout:
 *   return std::sqrt(x * x + y * y);   // each step rounds to f32
 */
export function magnitudeF(x: number, y: number): number {
  return f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
}

/**
 * C++ `float VUtils::Math::sq_magnitude(float x, float y)`:
 *   return x * x + y * y;   // float32
 */
export function sqMagnitudeF(x: number, y: number): number {
  return f32(f32(x * x) + f32(y * y));
}

/**
 * C++ `float VUtils::Math::distance_to(float x1, float y1, float x2, float y2)`:
 *   return std::sqrt(sq_magnitude(x1 - x2, y1 - y2));   // float32
 */
export function distanceToF(x1: number, y1: number, x2: number, y2: number): number {
  return f32(Math.sqrt(sqDistanceToF(x1, y1, x2, y2)));
}

/** C++ `float sq_distance_to(...)` — float32: (x1-x2)² + (y1-y2)². */
export function sqDistanceToF(x1: number, y1: number, x2: number, y2: number): number {
  return f32(f32(f32(x1 - x2) * f32(x1 - x2)) + f32(f32(y1 - y2) * f32(y1 - y2)));
}

// ── VUtils::Math::Fbm (float32 wrapper around double Perlin) ──────

/**
 * C++ `float VUtils::Math::Fbm(Vector2f p, int octaves, float lacunarity, float gain)`:
 *   float num = 0, num2 = 1;
 *   for (i < octaves) {
 *     num += num2 * PerlinNoise(p.x, p.y);  // double mul, += rounds to f32
 *     num2 *= gain;                         // f32
 *     p *= lacunarity;                      // f32 per component
 *   }
 *   return num;
 */
export function fbm(
  px: number,
  py: number,
  octaves: number,
  lacunarity: number,
  gain: number
): number {
  let num = 0;
  let num2 = 1;
  let x = px;
  let y = py;
  for (let i = 0; i < octaves; i++) {
    num = f32(num + num2 * perlinNoise(x, y));
    num2 = f32(num2 * gain);
    x = f32(x * lacunarity);
    y = f32(y * lacunarity);
  }
  return num;
}

/** C++ `float VUtils::Math::FbmMaxValue(int octaves, float gain)` — float32. */
export function fbmMaxValue(octaves: number, gain: number): number {
  let num = 0;
  let num2 = 1;
  for (let i = 0; i < octaves; i++) {
    num = f32(num + num2);
    num2 = f32(num2 * gain);
  }
  return num;
}
