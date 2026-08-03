/**
 * Unity-compatible xorshift128 RNG — 1:1 port of `valhalla::util::CSU::Random`
 * from Valhalla2.0 `VUtilsRandom.cpp` (alias `VUtils::Random::State`).
 *
 * This is THE random generator Unity uses (Random.InitState / Random.Range /
 * Random.value), reverse-engineered by the Valhalla project. It drives all
 * randomized world generation in GeoManager (seed offsets, river/stream
 * placement), so it must reproduce the exact same sequence as the C++ server.
 *
 * C++ reference (library/src/VUtilsRandom.cpp):
 *
 *   Random::Random(std::int32_t seed) {
 *     m_seed[0] = static_cast<std::uint32_t>(seed);
 *     m_seed[1] = m_seed[0] * 0x6c078965 + 1;
 *     m_seed[2] = m_seed[1] * 0x6c078965 + 1;
 *     m_seed[3] = m_seed[2] * 0x6c078965 + 1;
 *   }
 *
 *   std::uint32_t Random::next_int() {
 *     std::uint32_t mut1 = (m_seed[0] << 11) ^ m_seed[0];
 *     m_seed[0] = m_seed[1]; m_seed[1] = m_seed[2]; m_seed[2] = m_seed[3];
 *     mut1 = (((m_seed[3] >> 11) ^ mut1) >> 8) ^ m_seed[3] ^ mut1;
 *     m_seed[3] = mut1;
 *     return mut1;
 *   }
 *
 *   float Random::next_float() {
 *     return (float)(next_int() & 0x7FFFFF) * 1.192093e-7f;   // float32 mul!
 *   }
 *
 *   float Random::range(float minInclude, float maxExclude) {
 *     auto r = next_float();
 *     return (1.0f - r) * maxExclude + r * minInclude;         // NOTE: inverted lerp
 *   }
 *
 *   std::int32_t Random::range(std::int32_t minInclude, std::int32_t maxExclude) {
 *     if (minInclude > maxExclude) std::swap(minInclude, maxExclude);
 *     std::uint32_t diff = static_cast<std::uint32_t>(maxExclude - minInclude);
 *     if (diff) return minInclude + static_cast<std::int32_t>((next_int() % diff));
 *     return minInclude;
 *   }
 *
 * Float32 fidelity: C++ computes next_float()/range(float) in single
 * precision. Since float32 operands are exactly representable in float64 and
 * each float64 result of a single op is exact before rounding, `Math.fround`
 * after every operation reproduces IEEE float32 arithmetic bit-exactly.
 */

/** Round to nearest float32 (IEEE single), like a C++ `float` cast/store. */
const f32 = Math.fround;

/** float32 value of the C++ literal `1.192093e-7f` (nearest f32 to the decimal). */
const NEXT_FLOAT_FACTOR = f32(1.192093e-7);

export class XorShiftRandom {
  /** State words, kept as uint32 (0..2^32-1) in plain JS numbers. */
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // m_seed[0] = (u32)seed; m_seed[i+1] = m_seed[i] * 0x6c078965 + 1 (u32 wrap)
    this.s0 = seed >>> 0;
    this.s1 = (Math.imul(this.s0, 0x6c078965) + 1) >>> 0;
    this.s2 = (Math.imul(this.s1, 0x6c078965) + 1) >>> 0;
    this.s3 = (Math.imul(this.s2, 0x6c078965) + 1) >>> 0;
  }

  /** C++ `next_int()` — returns uint32 (0..2^32-1). */
  nextInt(): number {
    let mut1 = ((this.s0 << 11) ^ this.s0) >>> 0;
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.s2 = this.s3;
    // C++ uint32 shifts are logical: >>> 11 and >>> 8
    mut1 = ((((this.s3 >>> 11) ^ mut1) >>> 8) ^ this.s3 ^ mut1) >>> 0;
    this.s3 = mut1;
    return mut1;
  }

  /**
   * C++ `next_float()` — float32 in [0, 1).
   * `(float)(next_int() & 0x7FFFFF)` is exact; the multiply rounds to f32.
   */
  nextFloat(): number {
    return f32((this.nextInt() & 0x7fffff) * NEXT_FLOAT_FACTOR);
  }

  /**
   * C++ `range(float minInclude, float maxExclude)` — float32 arithmetic.
   * ATTENTION: inverted lerp — high `r` approaches `minInclude`, not max!
   * `(1.0f - r) * maxExclude + r * minInclude`
   */
  rangeFloat(minInclude: number, maxExclude: number): number {
    const r = this.nextFloat();
    return f32(f32(f32(1 - r) * maxExclude) + f32(r * minInclude));
  }

  /**
   * C++ `range(std::int32_t minInclude, std::int32_t maxExclude)`.
   * Returns int32 in [min, max) (max excluded).
   */
  rangeInt(minInclude: number, maxExclude: number): number {
    let min = minInclude | 0;
    let max = maxExclude | 0;
    if (min > max) {
      const t = min;
      min = max;
      max = t;
    }
    // (u32)(max - min): int32 subtraction wraps in C++; >>> 0 reproduces the wrap
    const diff = (max - min) >>> 0;
    if (diff !== 0) {
      return (min + (this.nextInt() % diff)) | 0;
    }
    return min;
  }

  /**
   * C++ `inside_unit_circle()` — uniform point in the unit disc.
   * NOTE: C++ uses float trig (cosf/sinf); Math.cos/sin + fround can differ by
   * ~1 ulp. Only used by GetTerrainDelta (building leveling), not by worldgen,
   * so world determinism is unaffected.
   */
  insideUnitCircle(): { x: number; y: number } {
    const rad = this.rangeFloat(0, f32(Math.PI * 2));
    const x = f32(Math.cos(rad));
    const y = f32(Math.sin(rad));
    const ze = this.rangeFloat(0, 1);
    const d = f32(Math.sqrt(ze));
    return { x: f32(x * d), y: f32(y * d) };
  }
}
