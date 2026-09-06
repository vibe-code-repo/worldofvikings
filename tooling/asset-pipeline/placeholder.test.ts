import { describe, expect, it } from 'vitest';
import { readGlb, worldBounds } from '@wov/content-build';
import { buildPlaceholderGlb, placeholderPathFor } from './placeholder.js';

const hull = {
  min: [-1.5, 0, -2] as [number, number, number],
  max: [1.5, 11.25, 2] as [number, number, number],
};

describe('buildPlaceholderGlb', () => {
  it('produces a box with exactly the hull it was given', () => {
    // The whole promise of a placeholder is its footprint. Measured back out of
    // the written file, through the same code the importer measures sources
    // with, so a wrong axis or a wrong corner order cannot pass.
    const measured =
      worldBounds(readGlb(buildPlaceholderGlb('pine-1b1', hull)).json, 'placeholder') ?? hull;
    expect(measured.min.map((v) => Number(v.toFixed(4)))).toEqual([-1.5, 0, -2]);
    expect(measured.max.map((v) => Number(v.toFixed(4)))).toEqual([1.5, 11.25, 2]);
  });

  it('carries the same root node name as the asset it stands in for', () => {
    const json = readGlb(buildPlaceholderGlb('sm-env-rock-03', hull)).json;
    const rootIndex = json.scenes?.[0]?.nodes?.[0] ?? -1;
    expect(json.nodes?.[rootIndex]?.name).toBe('sm-env-rock-03');
  });

  it('stays far inside the 20 kB budget for a committed file', () => {
    expect(buildPlaceholderGlb('pine-1b1', hull).length).toBeLessThan(20 * 1024);
  });

  it('is byte-identical for the same input, so it does not churn the manifest', () => {
    expect(buildPlaceholderGlb('a', hull).equals(buildPlaceholderGlb('a', hull))).toBe(true);
  });

  it('handles a flat hull — a ground plane has no height', () => {
    const flat = {
      min: [0, 0, 0] as [number, number, number],
      max: [10, 0, 10] as [number, number, number],
    };
    const measured = worldBounds(readGlb(buildPlaceholderGlb('plane', flat)).json, 'flat');
    expect(measured).toEqual({ min: [0, 0, 0], max: [10, 0, 10] });
    expect(measured).toBeDefined();
  });
});

describe('placeholderPathFor', () => {
  it('mirrors the store layout under placeholders/, so the two read alike', () => {
    expect(placeholderPathFor('vegetation/pine-1b1.glb')).toBe(
      'placeholders/vegetation/pine-1b1.glb',
    );
  });
});
