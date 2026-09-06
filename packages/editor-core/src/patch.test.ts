import { describe, expect, it } from 'vitest';
import { applyFieldPatch, applyFieldPatches, restorePatch, valueAtPath } from './patch.js';

describe('valueAtPath', () => {
  it('walks objects and array indices', () => {
    const root = { layers: [{ tileSize: 2 }, { tileSize: 3 }] };
    expect(valueAtPath(root, ['layers', '1', 'tileSize'])).toBe(3);
  });

  it('answers the root for the empty path', () => {
    expect(valueAtPath({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it('answers undefined instead of throwing on a path that does not exist', () => {
    expect(valueAtPath({ a: 1 }, ['b', 'c'])).toBeUndefined();
    expect(valueAtPath(undefined, ['a'])).toBeUndefined();
  });
});

describe('applyFieldPatch', () => {
  it('sets a leaf without touching its siblings', () => {
    const before = { sun: { intensity: 2, color: '#ffffff' }, fog: { end: 400 } };
    const after = applyFieldPatch(before, { path: ['sun', 'intensity'], value: 3 });
    expect(after).toEqual({ sun: { intensity: 3, color: '#ffffff' }, fog: { end: 400 } });
  });

  it('does not mutate what it was given', () => {
    const before = { sun: { intensity: 2 } };
    applyFieldPatch(before, { path: ['sun', 'intensity'], value: 3 });
    expect(before.sun.intensity).toBe(2);
  });

  /**
   * The first slider drag of a session happens on a world that says nothing
   * about light. Without this, it would do nothing at all.
   */
  it('creates the levels a path needs', () => {
    expect(applyFieldPatch(undefined, { path: ['sun', 'intensity'], value: 3 })).toEqual({
      sun: { intensity: 3 },
    });
  });

  it('removes a key when the value is null', () => {
    expect(
      applyFieldPatch({ fog: { enabled: true, end: 400 } }, { path: ['fog', 'end'], value: null }),
    ).toEqual({
      fog: { enabled: true },
    });
  });

  it('replaces the whole block at the empty path, and clears it with null', () => {
    expect(applyFieldPatch({ a: 1 }, { path: [], value: { b: 2 } })).toEqual({ b: 2 });
    expect(applyFieldPatch({ a: 1 }, { path: [], value: null })).toBeUndefined();
  });

  it('sets an array element and splices one out', () => {
    const layers = { layers: [{ tileSize: 2 }, { tileSize: 3 }] };
    expect(applyFieldPatch(layers, { path: ['layers', '0', 'tileSize'], value: 5 })).toEqual({
      layers: [{ tileSize: 5 }, { tileSize: 3 }],
    });
    expect(applyFieldPatch(layers, { path: ['layers', '0'], value: null })).toEqual({
      layers: [{ tileSize: 3 }],
    });
  });

  /** An array with a hole is not a thing any of these schemas allows. */
  it('refuses an index that is not in the array', () => {
    const layers = { layers: [{ tileSize: 2 }] };
    expect(applyFieldPatch(layers, { path: ['layers', '4', 'tileSize'], value: 5 })).toEqual(
      layers,
    );
  });
});

describe('applyFieldPatches', () => {
  it('applies patches in order', () => {
    const after = applyFieldPatches(undefined, [
      { path: ['fog', 'enabled'], value: true },
      { path: ['fog', 'end'], value: 200 },
    ]);
    expect(after).toEqual({ fog: { enabled: true, end: 200 } });
  });
});

describe('restorePatch', () => {
  it('puts a block back exactly, including its absence', () => {
    expect(applyFieldPatch({ a: 1 }, restorePatch(undefined))).toBeUndefined();
    expect(applyFieldPatch(undefined, restorePatch({ a: 1 }))).toEqual({ a: 1 });
  });
});
