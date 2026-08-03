/**
 * Unity-compatible 2D Perlin noise — 1:1 port of `VUtils::Math::PerlinNoise`
 * from Valhalla2.0 `VUtilsMath.cpp` (HEIGHTFIX-02 double-precision variant).
 *
 * This is UnityEngine.Mathf.PerlinNoise, reverse-engineered by the Valhalla
 * project, with the Valhalla2.0 "HEIGHTFIX-02" patch: all intermediates are
 * computed in DOUBLE precision. Since JS numbers are float64, the port is
 * bit-exact without any float32 emulation — as long as callers pass the same
 * argument values. (Where the C++ caller computes the ARGUMENT in float32,
 * the fround happens at the call site in GeoManager.ts, not here.)
 *
 * C++ reference (library/src/VUtilsMath.cpp):
 *
 *   static double myfade(double t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
 *   static double mylerp(double t, double a, double b) { return a + t*(b-a); }
 *   static double mygrad(int hash, double x, double y) {
 *     int h = hash & 15;
 *     double u = h < 8 ? x : y,
 *            v = h < 4 ? y : h == 12 || h == 14 ? x : 0.0;
 *     return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
 *   }
 *
 *   double PerlinNoise(double x, double y) {
 *     x = std::abs(x); y = std::abs(y);
 *     int X = (int)x & 0xFF, Y = (int)y & 0xFF;
 *     x -= (int)x; y -= (int)y;
 *     int A = p[X] + Y, B = p[X+1] + Y;
 *     int BB = p[p[B+1]], AB = p[p[A+1]], BA = p[p[B+0]], AA = p[p[A+0]];
 *     double u = myfade(x), v = myfade(y);
 *     double res = mylerp(v, mylerp(u, mygrad(AA, x, y),     mygrad(BA, x-1.0, y)),
 *                             mylerp(u, mygrad(AB, x, y-1.0), mygrad(BB, x-1.0, y-1.0)));
 *     return (res + 0.69) / 1.483;
 *   }
 *
 * The permutation table below was extracted programmatically from the C++
 * source (512 entries = the 256-value Ken Perlin permutation duplicated;
 * verified: first half is a true permutation of 0..255, second half identical).
 */

// Base 256-value permutation (C++ p[] first half; the C++ array repeats it).
const PERM_BASE: readonly number[] = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

/** C++ p[512] — the base permutation duplicated (indices up to p[511] used). */
const p = new Uint8Array(512);
for (let i = 0; i < 512; i++) p[i] = PERM_BASE[i & 0xff];

function myfade(t: number): number {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

function mylerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

function mygrad(hash: number, x: number, y: number): number {
  const h = hash & 15; // CONVERT LO 4 BITS OF HASH CODE
  const u = h < 8 ? x : y; // INTO 12 GRADIENT DIRECTIONS.
  const v = h < 4 ? y : h === 12 || h === 14 ? x : 0.0;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * C++ `VUtils::Math::PerlinNoise(double x, double y)`.
 * Result roughly in [0, 1) (centered around ~0.465; NOT centered on 0.5).
 */
export function perlinNoise(x: number, y: number): number {
  x = Math.abs(x);
  y = Math.abs(y);

  // C++ (int)x — truncation; inputs in worldgen stay well below 2^31.
  const xi = Math.trunc(x);
  const yi = Math.trunc(y);
  const X = xi & 0xff;
  const Y = yi & 0xff;

  x -= xi;
  y -= yi;

  const A = p[X] + Y;
  const B = p[X + 1] + Y;

  const BB = p[p[B + 1]];
  const AB = p[p[A + 1]];
  const BA = p[p[B + 0]];
  const AA = p[p[A + 0]];

  const u = myfade(x);
  const v = myfade(y);

  const gradBB = mygrad(BB, x - 1.0, y - 1.0);
  const gradAB = mygrad(AB, x, y - 1.0);
  const gradBA = mygrad(BA, x - 1.0, y);
  const gradAA = mygrad(AA, x, y);

  const res = mylerp(v, mylerp(u, gradAA, gradBA), mylerp(u, gradAB, gradBB));

  return (res + 0.69) / 1.483;
}
