import { describe, expect, it } from 'vitest';
import {
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  compareManifestWithFiles,
  formatManifestReport,
  immutableAssetPath,
  isIndexedAssetFile,
  isManifestInSync,
  parseAssetManifest,
} from './manifest.js';

/**
 * A minimal but complete version 2 entry. Provenance and visibility have their
 * own tests in `manifest-provenance.test.ts`; here the fields are just the price
 * of a valid entry, so this file can stay about paths, hashes and drift.
 */
const entry = {
  id: 'environment/pine-tree-01',
  path: 'environment/pine_tree_01.glb',
  kind: 'mesh' as const,
  bytes: 2048,
  hash: `sha256-${'a1b2c3d4'.repeat(8)}`,
  origin: 'Authored for this project.',
  source: 'World of Vikings',
  author: 'World of Vikings contributors',
  license: 'CC0-1.0',
  redistributable: true,
  visibility: 'public' as const,
};

function manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
    generatedAt: '2026-09-05T10:00:00.000Z',
    assets: [entry],
    ...overrides,
  };
}

describe('parseAssetManifest', () => {
  it('accepts a well-formed manifest', () => {
    const result = parseAssetManifest(manifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.assets).toHaveLength(1);
      expect(result.manifest.assets[0]?.path).toBe('environment/pine_tree_01.glb');
    }
  });

  it('accepts an empty asset list', () => {
    expect(parseAssetManifest(manifest({ assets: [] })).ok).toBe(true);
  });

  it('names the version problem first for an unsupported manifestVersion', () => {
    const result = parseAssetManifest(manifest({ manifestVersion: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        `unsupported manifestVersion 99, expected ${CURRENT_ASSET_MANIFEST_VERSION}`,
      ]);
    }
  });

  it('rejects unknown top-level keys instead of ignoring them', () => {
    const result = parseAssetManifest(manifest({ asssets: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects absolute paths and traversal', () => {
    expect(parseAssetManifest(manifest({ assets: [{ ...entry, path: '/x.glb' }] })).ok).toBe(false);
    expect(parseAssetManifest(manifest({ assets: [{ ...entry, path: '../x.glb' }] })).ok).toBe(
      false,
    );
    expect(parseAssetManifest(manifest({ assets: [{ ...entry, path: 'a\\b.glb' }] })).ok).toBe(
      false,
    );
  });

  it('rejects a hash that is not a sha256 digest', () => {
    const result = parseAssetManifest(manifest({ assets: [{ ...entry, hash: 'deadbeef' }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/hash/);
    }
  });

  it('rejects a negative or fractional byte size', () => {
    expect(parseAssetManifest(manifest({ assets: [{ ...entry, bytes: -1 }] })).ok).toBe(false);
    expect(parseAssetManifest(manifest({ assets: [{ ...entry, bytes: 1.5 }] })).ok).toBe(false);
  });

  it('rejects duplicate paths', () => {
    const result = parseAssetManifest(manifest({ assets: [entry, entry] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/duplicate/);
    }
  });

  it('reports a field path instead of a bare message', () => {
    const result = parseAssetManifest(manifest({ assets: [{ path: 'a.glb' }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/assets\.0\./);
    }
  });
});

describe('immutableAssetPath', () => {
  it('inserts the hash prefix before the extension', () => {
    expect(immutableAssetPath(entry)).toBe('environment/pine_tree_01.a1b2c3d4.glb');
  });

  it('appends the hash when the file has no extension', () => {
    expect(immutableAssetPath({ ...entry, path: 'environment/README' })).toBe(
      'environment/README.a1b2c3d4',
    );
  });

  it('changes when the content hash changes, which is what makes it cacheable forever', () => {
    expect(immutableAssetPath({ ...entry, hash: `sha256-${'0'.repeat(64)}` })).toBe(
      'environment/pine_tree_01.00000000.glb',
    );
  });

  it('keeps the directory of a nested path and works without one', () => {
    expect(immutableAssetPath({ ...entry, path: 'tree.glb' })).toBe('tree.a1b2c3d4.glb');
    expect(immutableAssetPath({ ...entry, path: 'a/b/c/tree.glb' })).toBe(
      'a/b/c/tree.a1b2c3d4.glb',
    );
  });
});

describe('compareManifestWithFiles', () => {
  const listed = [entry, { ...entry, path: 'environment/rock_01.glb' }];

  it('reports nothing when manifest and files agree', () => {
    const comparison = compareManifestWithFiles(listed, listed);
    expect(comparison).toEqual({ missing: [], unlisted: [], changed: [] });
    expect(isManifestInSync(comparison)).toBe(true);
  });

  it('reports files listed in the manifest but absent on disk', () => {
    const comparison = compareManifestWithFiles(listed, [entry]);
    expect(comparison.missing).toEqual(['environment/rock_01.glb']);
    expect(isManifestInSync(comparison)).toBe(false);
  });

  it('reports files on disk that the manifest does not list', () => {
    const comparison = compareManifestWithFiles([entry], listed);
    expect(comparison.unlisted).toEqual(['environment/rock_01.glb']);
    expect(isManifestInSync(comparison)).toBe(false);
  });

  it('reports a changed size and a changed hash separately', () => {
    const comparison = compareManifestWithFiles(
      [entry],
      [{ ...entry, bytes: 4096, hash: `sha256-${'0'.repeat(64)}` }],
    );
    expect(comparison.changed).toEqual([
      {
        path: entry.path,
        expected: { bytes: 2048, hash: entry.hash },
        actual: { bytes: 4096, hash: `sha256-${'0'.repeat(64)}` },
      },
    ]);
    expect(isManifestInSync(comparison)).toBe(false);
  });

  it('sorts its output so the validator prints a stable diff', () => {
    const comparison = compareManifestWithFiles(
      [],
      [
        { ...entry, path: 'z.glb' },
        { ...entry, path: 'a.glb' },
      ],
    );
    expect(comparison.unlisted).toEqual(['a.glb', 'z.glb']);
  });
});

describe('isIndexedAssetFile', () => {
  it('indexes the binary asset files', () => {
    expect(isIndexedAssetFile('environment/pine_tree_01.glb')).toBe(true);
    expect(isIndexedAssetFile('textures/bark.ktx2')).toBe(true);
    expect(isIndexedAssetFile('audio/wind.ogg')).toBe(true);
  });

  it('skips the manifest itself, so validating never reports its own file', () => {
    expect(isIndexedAssetFile(ASSET_MANIFEST_FILE_NAME)).toBe(false);
  });

  it('skips documentation, which is read by people and not shipped to the game', () => {
    expect(isIndexedAssetFile('README.md')).toBe(false);
    expect(isIndexedAssetFile('environment/README.md')).toBe(false);
  });

  it('skips dot files anywhere in the path', () => {
    expect(isIndexedAssetFile('environment/.gitkeep')).toBe(false);
    expect(isIndexedAssetFile('.DS_Store')).toBe(false);
    expect(isIndexedAssetFile('.hidden/tree.glb')).toBe(false);
  });

  it('does not skip a nested file merely called manifest.json', () => {
    expect(isIndexedAssetFile('worlds/manifest.json')).toBe(true);
  });
});

describe('formatManifestReport', () => {
  const inSync = { missing: [], unlisted: [], changed: [] };

  it('says nothing when the manifest matches the files', () => {
    expect(formatManifestReport(inSync)).toEqual([]);
  });

  it('names the file and the direction of every drift', () => {
    const lines = formatManifestReport({
      missing: ['environment/gone.glb'],
      unlisted: ['environment/new.glb'],
      changed: [
        {
          path: 'environment/tree.glb',
          expected: { bytes: 2048, hash: `sha256-${'a'.repeat(64)}` },
          actual: { bytes: 4096, hash: `sha256-${'b'.repeat(64)}` },
        },
      ],
    });

    expect(lines.join('\n')).toContain('environment/gone.glb');
    expect(lines.join('\n')).toContain('environment/new.glb');
    expect(lines.join('\n')).toContain('environment/tree.glb');
    // The size change must be readable without opening the manifest.
    expect(lines.join('\n')).toContain('2048');
    expect(lines.join('\n')).toContain('4096');
  });

  it('reports every drifted file, not just the first', () => {
    const lines = formatManifestReport({
      missing: ['a.glb', 'b.glb'],
      unlisted: ['c.glb'],
      changed: [],
    });
    expect(lines).toHaveLength(3);
  });
});
