import { describe, expect, it } from 'vitest';
import { boxEdges } from './selection-outline.js';

describe('boxEdges', () => {
  const edges = boxEdges({ min: [0, 0, 0], max: [2, 3, 4] });

  it('draws all twelve edges of the box', () => {
    expect(edges).toHaveLength(12);
  });

  it('gives every edge a length along exactly one axis', () => {
    for (const [start, end] of edges) {
      const changed = [0, 1, 2].filter((axis) => start[axis] !== end[axis]);
      expect(changed).toHaveLength(1);
    }
  });

  it('touches all eight corners', () => {
    const corners = new Set(edges.flat().map((point) => point.join(',')));
    expect(corners.size).toBe(8);
  });

  it('spans exactly the bounds it was given', () => {
    const points = edges.flat();
    for (const axis of [0, 1, 2] as const) {
      expect(Math.min(...points.map((point) => point[axis]))).toBe([0, 0, 0][axis]);
      expect(Math.max(...points.map((point) => point[axis]))).toBe([2, 3, 4][axis]);
    }
  });
});
