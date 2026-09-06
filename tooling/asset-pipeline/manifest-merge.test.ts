import { describe, expect, it } from 'vitest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import { mergeOwnedEntries } from './manifest-merge.js';

function entry(path: string, visibility: 'public' | 'private', bytes = 1): AssetEntry {
  return {
    id: path.replace(/\.[^./]+$/, ''),
    path,
    kind: 'mesh',
    bytes,
    hash: `sha256-${path}`,
    origin: 'test',
    source: 'test',
    author: 'test',
    license: 'CC0-1.0',
    redistributable: visibility === 'public',
    visibility,
  };
}

/** A store that holds exactly the listed paths. */
function store(...paths: readonly string[]): (path: string) => boolean {
  const held = new Set(paths);
  return (path) => held.has(path);
}

describe('mergeOwnedEntries', () => {
  it('replaces an entry this run produced rather than adding a second copy', () => {
    const previous = [entry('environment/a.glb', 'private', 10)];
    const produced = [entry('environment/a.glb', 'private', 20)];

    const merged = mergeOwnedEntries(previous, produced, store('environment/a.glb'));

    expect(merged.assets).toHaveLength(1);
    expect(merged.assets[0]?.bytes).toBe(20);
  });

  it('keeps a public entry it does not own', () => {
    const previous = [entry('placeholders/x.glb', 'public')];

    const merged = mergeOwnedEntries(previous, [], store());

    expect(merged.assets.map((asset) => asset.path)).toEqual(['placeholders/x.glb']);
    expect(merged.carriedOver).toEqual([]);
  });

  it('carries over a private entry another importer owns while its store file is there', () => {
    // The regression this rule exists for: `import:scene-models` writes private
    // entries for models it cuts out of a scene bundle, and re-running
    // `import:world-assets` must not delete them behind its back.
    const previous = [entry('environment/cut-from-a-bundle.glb', 'private')];

    const merged = mergeOwnedEntries(previous, [], store('environment/cut-from-a-bundle.glb'));

    expect(merged.assets.map((asset) => asset.path)).toEqual(['environment/cut-from-a-bundle.glb']);
    expect(merged.carriedOver).toEqual(['environment/cut-from-a-bundle.glb']);
    expect(merged.dropped).toEqual([]);
  });

  it('drops a private entry whose store file is gone', () => {
    const previous = [entry('environment/pruned.glb', 'private')];

    const merged = mergeOwnedEntries(previous, [], store());

    expect(merged.assets).toEqual([]);
    expect(merged.dropped).toEqual(['environment/pruned.glb']);
    expect(merged.carriedOver).toEqual([]);
  });

  it('sorts the result by path so the manifest diff stays stable', () => {
    const previous = [entry('b.glb', 'public'), entry('a.glb', 'public')];
    const produced = [entry('c.glb', 'private')];

    const merged = mergeOwnedEntries(previous, produced, store('c.glb'));

    expect(merged.assets.map((asset) => asset.path)).toEqual(['a.glb', 'b.glb', 'c.glb']);
  });

  it('does not report a produced path as dropped even when the store lacks it', () => {
    // A dry run writes nothing, so the store may legitimately not hold what the
    // run produced. Ownership decides, not the file system.
    const previous = [entry('environment/a.glb', 'private')];
    const produced = [entry('environment/a.glb', 'private', 20)];

    const merged = mergeOwnedEntries(previous, produced, store());

    expect(merged.dropped).toEqual([]);
    expect(merged.assets).toHaveLength(1);
  });
});
