/**
 * The manifest fields that version 2 adds: identity, geometry bounds,
 * provenance and where a file is actually served from.
 *
 * Kept in its own file rather than appended to `manifest.test.ts`, because it
 * tests one decision — assets may live outside the repository — and that
 * decision is what the whole private-store mechanism rests on.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_ASSET_MANIFEST_VERSION,
  assetIdFromPath,
  findMissingPlaceholders,
  parseAssetManifest,
  selectByVisibility,
} from './manifest.js';
import type { AssetEntry } from './manifest.js';

const HASH = `sha256-${'a1b2c3d4'.repeat(8)}`;

/** A public asset: it lives in `assets/` and is served as itself. */
const publicEntry = {
  id: 'environment/kenney-detail-barrel',
  path: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb',
  kind: 'mesh',
  bytes: 9968,
  hash: HASH,
  bounds: { min: [-0.15, 0, -0.15], max: [0.15, 0.3, 0.15] },
  origin: 'Downloaded from kenney.nl, vendored unmodified.',
  source: 'Retro Fantasy Kit 2.0',
  author: 'Kenney',
  license: 'CC0-1.0',
  redistributable: true,
  visibility: 'public',
};

/** A private asset: it lives in the store, and the repo only has a stand-in. */
const privateEntry = {
  id: 'vegetation/tree-1a3',
  path: 'vegetation/tree-1a3.glb',
  kind: 'prefab',
  bytes: 4_510_220,
  hash: `sha256-${'0'.repeat(64)}`,
  bounds: { min: [-8, -1, -8], max: [8, 25.5, 8] },
  origin: 'Origin kept as authored: ground-contact point, geometry may extend below y=0.',
  source: 'private asset collection — vegetation set',
  author: 'unconfirmed — third-party commercial pack, licence review open',
  license: 'NOASSERTION',
  redistributable: false,
  visibility: 'private',
  placeholder: 'placeholders/vegetation/tree-1a3.glb',
};

function manifest(assets: readonly unknown[]): unknown {
  return {
    manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
    generatedAt: '2026-09-06T10:00:00.000Z',
    assets,
  };
}

function errorsOf(data: unknown): string {
  const result = parseAssetManifest(data);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.errors.join(' | ');
}

describe('the version 2 asset entry', () => {
  it('accepts a public entry and a private one side by side', () => {
    const result = parseAssetManifest(manifest([publicEntry, privateEntry]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.assets.map((asset) => asset.visibility)).toEqual([
        'public',
        'private',
      ]);
    }
  });

  it('requires a placeholder for a private asset, because a clone has nothing else', () => {
    const { placeholder: _dropped, ...withoutPlaceholder } = privateEntry;
    expect(errorsOf(manifest([withoutPlaceholder]))).toMatch(/placeholder/);
  });

  it('rejects a placeholder on a public asset, which is served as itself', () => {
    expect(errorsOf(manifest([{ ...publicEntry, placeholder: 'placeholders/x.glb' }]))).toMatch(
      /placeholder/,
    );
  });

  it('requires bounds on private geometry — the placeholder box is built from them', () => {
    const { bounds: _dropped, ...withoutBounds } = privateEntry;
    expect(errorsOf(manifest([withoutBounds]))).toMatch(/bounds/);
  });

  it('rejects bounds that are inside out', () => {
    expect(
      errorsOf(manifest([{ ...privateEntry, bounds: { min: [0, 0, 0], max: [1, -1, 1] } }])),
    ).toMatch(/bounds/);
  });

  it('rejects bounds on a texture, which has no extent in metres', () => {
    const texture = {
      ...privateEntry,
      id: 'textures/bark',
      path: 'textures/bark.png',
      kind: 'texture',
      placeholder: 'placeholders/textures/bark.png',
    };
    expect(errorsOf(manifest([texture]))).toMatch(/bounds/);
  });

  it('rejects an unknown kind instead of ignoring it', () => {
    // `video` and not `audio`: audio became a real kind, and an example that is
    // silently valid would turn this test green while testing nothing.
    expect(errorsOf(manifest([{ ...publicEntry, kind: 'video' }]))).toMatch(/kind/);
  });

  it('accepts audio, and describes it as a file with no extent in metres', () => {
    const clip = {
      ...privateEntry,
      id: 'audio/footsteps/gravel-01',
      path: 'audio/footsteps/gravel-01.ogg',
      kind: 'audio',
      bytes: 2219,
      origin: '0.34 s, mono, 48 kHz, Opus at 48 kbps.',
      placeholder: 'placeholders/audio/silence.wav',
    };
    const { bounds: _dropped, ...withoutBounds } = clip;
    const result = parseAssetManifest(manifest([withoutBounds]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.assets[0]?.kind).toBe('audio');
    }
    // A sound has a falloff radius in metres, but that lives on the emitter
    // that plays it, never on the file.
    expect(errorsOf(manifest([clip]))).toMatch(/bounds/);
  });

  it('still demands a placeholder for a private clip, shared or not', () => {
    const { placeholder: _dropped, ...clip } = {
      ...privateEntry,
      id: 'audio/ambience/forest-wind-gusts',
      path: 'audio/ambience/forest-wind-gusts.ogg',
      kind: 'audio',
      bounds: undefined,
    };
    expect(errorsOf(manifest([clip]))).toMatch(/placeholder/);
  });

  it('never accepts a blank licence, author, source or origin', () => {
    for (const field of ['license', 'author', 'source', 'origin'] as const) {
      expect(errorsOf(manifest([{ ...publicEntry, [field]: '   ' }]))).toMatch(field);
    }
  });

  it('rejects duplicate ids, not only duplicate paths', () => {
    const twin = { ...publicEntry, path: 'environment/other.glb' };
    expect(errorsOf(manifest([publicEntry, twin]))).toMatch(/duplicate/);
  });

  it('keeps ids machine-readable: lower case, no spaces', () => {
    expect(errorsOf(manifest([{ ...publicEntry, id: 'Environment/Detail Barrel' }]))).toMatch(/id/);
  });
});

describe('reading a version 1 manifest', () => {
  const legacy = {
    manifestVersion: 1,
    generatedAt: '2026-09-05T21:48:58.059Z',
    assets: [
      { path: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb', bytes: 9968, hash: HASH },
    ],
  };

  it('still reads, so an older checkout is not a hard failure', () => {
    const result = parseAssetManifest(legacy);
    expect(result.ok).toBe(true);
  });

  it('migrates it to the current version rather than leaving two shapes around', () => {
    const result = parseAssetManifest(legacy);
    if (!result.ok) {
      throw new Error(result.errors.join(' | '));
    }
    expect(result.manifest.manifestVersion).toBe(CURRENT_ASSET_MANIFEST_VERSION);
    const [asset] = result.manifest.assets;
    expect(asset?.path).toBe('environment/kenney-retro-fantasy-kit/detail-barrel.glb');
    expect(asset?.visibility).toBe('public');
    expect(asset?.kind).toBe('mesh');
    // Nothing is invented: what version 1 could not say is said as "unknown".
    expect(asset?.license).toBe('NOASSERTION');
    expect(asset?.redistributable).toBe(false);
    expect(asset?.bounds).toBeUndefined();
  });

  it('still refuses a version from the future', () => {
    expect(errorsOf({ ...legacy, manifestVersion: 99 })).toMatch(/unsupported manifestVersion 99/);
  });
});

describe('assetIdFromPath', () => {
  it('drops the extension and kebab-cases every segment', () => {
    expect(assetIdFromPath('environment/SM_Env_Rock_03.glb')).toBe('environment/sm-env-rock-03');
    expect(assetIdFromPath('Terrain Village1.glb')).toBe('terrain-village1');
  });

  it('produces the same id for the same path, on every machine', () => {
    expect(assetIdFromPath('a/B c_d.glb')).toBe(assetIdFromPath('a/B c_d.glb'));
    expect(assetIdFromPath('a/B c_d.glb')).toBe('a/b-c-d');
  });
});

describe('selectByVisibility', () => {
  const entries = [publicEntry, privateEntry] as unknown as readonly AssetEntry[];

  it('separates what the repository holds from what the store holds', () => {
    expect(selectByVisibility(entries, 'public').map((asset) => asset.id)).toEqual([
      'environment/kenney-detail-barrel',
    ]);
    expect(selectByVisibility(entries, 'private').map((asset) => asset.id)).toEqual([
      'vegetation/tree-1a3',
    ]);
  });
});

describe('findMissingPlaceholders', () => {
  const entries = [publicEntry, privateEntry] as unknown as readonly AssetEntry[];

  it('says nothing when every private asset has its stand-in on disk', () => {
    expect(findMissingPlaceholders(entries, ['placeholders/vegetation/tree-1a3.glb'])).toEqual([]);
  });

  it('names the placeholder a clean clone would 404 on', () => {
    expect(findMissingPlaceholders(entries, [])).toEqual(['placeholders/vegetation/tree-1a3.glb']);
  });
});
