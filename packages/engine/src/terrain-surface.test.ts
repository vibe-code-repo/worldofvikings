import { describe, expect, it } from 'vitest';
import { terrainFragmentSource } from './terrain-shader.js';
import {
  UNPAINTED_WEIGHT_TOTAL,
  UV_FIT_TOLERANCE,
  createTerrainSurfaceProbe,
  dominantLayer,
  fitAxis,
  fitTileUv,
  splatWeightsAt,
  type SplatImage,
} from './terrain-surface.js';

describe('dominantLayer', () => {
  it('answers the largest weight', () => {
    expect(dominantLayer([0.1, 0.7, 0.2])).toBe(1);
  });

  it('breaks a tie towards the lower layer, so a boundary does not flicker', () => {
    expect(dominantLayer([0.5, 0.5])).toBe(0);
  });

  it('answers layer 0 on unpainted ground, exactly as the shader draws it', () => {
    expect(dominantLayer([0, 0, 0, 0, 0, 0])).toBe(0);
    expect(dominantLayer([0.00001, 0.00002])).toBe(0);
  });

  it('uses the threshold the generated shader compiles in', () => {
    // If this pin breaks, the CPU and the GPU disagree about which ground the
    // player is on — the exact failure ADR-0063 exists to prevent.
    expect(terrainFragmentSource(4, 1)).toContain(
      `if (total < ${UNPAINTED_WEIGHT_TOTAL.toFixed(4)})`,
    );
  });
});

describe('fitAxis', () => {
  it('recovers a line exactly', () => {
    const inputs = [0, 10, 20, 30];
    const outputs = inputs.map((x) => 0.25 + x / 40);
    const fit = fitAxis(inputs, outputs);
    expect(fit.offset).toBeCloseTo(0.25, 10);
    expect(fit.scale).toBeCloseTo(1 / 40, 10);
    expect(fit.residual).toBeLessThan(1e-9);
  });

  it('reports the worst error, not the average one', () => {
    // Three points on a line and one a long way off it: a mean residual would
    // hide the seam this is meant to catch.
    const fit = fitAxis([0, 1, 2, 3], [0, 1, 2, 9]);
    expect(fit.residual).toBeGreaterThan(1);
  });

  it('refuses an input that never varies rather than dividing by zero', () => {
    expect(fitAxis([5, 5, 5], [0, 1, 2]).residual).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fitTileUv', () => {
  /** A 2×2 tile spanning 0…300 m locally, with uv running 0…1 across it. */
  const positions = [0, 0, 0, 300, 0, 0, 0, 0, 300, 300, 0, 300];
  const uvs = [0, 0, 1, 0, 0, 1, 1, 1];

  it('fits u against x and v against z', () => {
    const fit = fitTileUv(positions, uvs);
    expect(fit.usable).toBe(true);
    expect(fit.u.scale).toBeCloseTo(1 / 300, 10);
    expect(fit.v.scale).toBeCloseTo(1 / 300, 10);
  });

  it('refuses a tile whose uv is not affine in x and z', () => {
    const twisted = [0, 0, 0, 300, 0, 0, 0, 0, 300, 300, 0, 300];
    const wrong = [0, 0, 1, 0, 0, 1, 0.2, 1];
    expect(fitTileUv(twisted, wrong).usable).toBe(false);
  });

  it('holds the tolerance it advertises', () => {
    expect(UV_FIT_TOLERANCE).toBeGreaterThan(0);
  });
});

/** One splat map, painted in horizontal bands, easy to reason about. */
function bandedMap(colours: readonly (readonly [number, number, number, number])[]): SplatImage {
  const height = colours.length;
  const data = new Uint8ClampedArray(height * 4);
  for (const [row, colour] of colours.entries()) {
    data.set(colour, row * 4);
  }
  return { width: 1, height, data };
}

describe('splatWeightsAt', () => {
  it('reads a layer out of the channel the shader reads it from', () => {
    const map = bandedMap([[0, 255, 0, 0]]);
    expect(splatWeightsAt([map], 0.5, 0.5, 4)).toEqual([0, 1, 0, 0]);
  });

  it('takes layers 5 and 6 from the second map', () => {
    const first = bandedMap([[255, 0, 0, 0]]);
    const second = bandedMap([[0, 255, 0, 0]]);
    expect(splatWeightsAt([first, second], 0.5, 0.5, 6)).toEqual([1, 0, 0, 0, 0, 1]);
  });

  it('flips v, because texture space runs up and image rows run down', () => {
    // Top image row is white in red; bottom row is black. v = 0.9 is near the
    // *top* of the texture, which is the *first* image row.
    const map = bandedMap([
      [255, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(splatWeightsAt([map], 0.5, 0.9, 1)).toEqual([1]);
    expect(splatWeightsAt([map], 0.5, 0.1, 1)).toEqual([0]);
  });

  it('answers zero for a layer whose map was never decoded', () => {
    expect(splatWeightsAt([], 0.5, 0.5, 2)).toEqual([0, 0]);
  });
});

describe('createTerrainSurfaceProbe', () => {
  const maps = [
    {
      width: 2,
      height: 1,
      // Left texel is layer 0, right texel is layer 1.
      data: new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0]),
    },
  ];
  const fit = fitTileUv([0, 0, 0, 300, 0, 0, 0, 0, 300, 300, 0, 300], [0, 0, 1, 0, 0, 1, 1, 1]);

  it('answers different layers at different places — the whole point', () => {
    const probe = createTerrainSurfaceProbe({
      maps,
      fit,
      layerCount: 2,
      worldToLocal: (x, z) => [x, z],
    });
    expect(probe.usable).toBe(true);
    expect(probe.layerAt(50, 150)).toBe(0);
    expect(probe.layerAt(250, 150)).toBe(1);
  });

  it('answers nothing off the tile rather than wrapping round to it', () => {
    const probe = createTerrainSurfaceProbe({
      maps,
      fit,
      layerCount: 2,
      worldToLocal: (x, z) => [x, z],
    });
    expect(probe.layerAt(-40, 150)).toBeNull();
    expect(probe.layerAt(150, 900)).toBeNull();
  });

  it('says "unmapped" and answers nothing when the fit does not hold', () => {
    const probe = createTerrainSurfaceProbe({
      maps,
      fit: { ...fit, usable: false },
      layerCount: 2,
      worldToLocal: (x, z) => [x, z],
    });
    expect(probe.usable).toBe(false);
    expect(probe.status).toContain('unmapped');
    expect(probe.layerAt(50, 150)).toBeNull();
  });

  it('goes through the caller’s world-to-local transform', () => {
    const probe = createTerrainSurfaceProbe({
      maps,
      fit,
      layerCount: 2,
      // A tile whose corner stands at x = 1000 in the world.
      worldToLocal: (x, z) => [x - 1000, z],
    });
    expect(probe.layerAt(1050, 150)).toBe(0);
    expect(probe.layerAt(1250, 150)).toBe(1);
  });
});
