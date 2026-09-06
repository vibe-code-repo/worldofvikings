/**
 * The backdrop identity: the file list, the name test and the size limit.
 *
 * The half that rewrites GLB bytes is tested next to it, in
 * `tooling/asset-pipeline/backdrop.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKDROP_MODELS,
  backdropModelPath,
  backdropTexturePath,
  isBackdropName,
  skipsBundleCut,
} from './backdrop.js';

describe('the backdrop list', () => {
  it('gives every model a store path under environment/, with its texture beside it', () => {
    for (const model of BACKDROP_MODELS) {
      expect(backdropModelPath(model.stem)).toBe(`environment/${model.stem}.glb`);
      expect(backdropTexturePath(model.stem)).toBe(`environment/textures/${model.stem}.png`);
      // The reference a model writes must resolve against its own URL and carry
      // no `..`, which Babylon rejects outright (ADR-0019).
      const relative = backdropTexturePath(model.stem).slice('environment/'.length);
      expect(relative).not.toContain('..');
    }
  });

  it('names both mountain shells but keeps them apart by node', () => {
    const mountains = BACKDROP_MODELS.filter((model) =>
      model.stem.startsWith('backdrop-mountains'),
    );
    expect(mountains).toHaveLength(2);
    // Same geometry file, different painting: this is the whole reason the
    // models come from the export rather than out of the bundle, where both
    // shells point at one embedded image.
    expect(new Set(mountains.map((model) => model.model)).size).toBe(1);
    expect(new Set(mountains.map((model) => model.texture)).size).toBe(2);
    expect(new Set(mountains.flatMap((model) => model.nodes)).size).toBe(2);
  });
});

describe('isBackdropName', () => {
  it('knows this project’s own store stems by their prefix', () => {
    expect(isBackdropName('backdrop-mountains-snow')).toBe(true);
    expect(isBackdropName('backdrop-anything-later')).toBe(true);
  });

  it('knows the bundle node names from the list', () => {
    for (const node of BACKDROP_MODELS.flatMap((model) => model.nodes)) {
      expect(isBackdropName(node)).toBe(true);
    }
  });

  it('says no to an ordinary world object', () => {
    expect(isBackdropName('sm-env-stonewall-01')).toBe(false);
    expect(isBackdropName('sm-prop-barrel-01')).toBe(false);
  });
});

describe('skipsBundleCut', () => {
  it('lets an ordinary world object be cut', () => {
    expect(skipsBundleCut('sm-prop-barrel-01')).toBe(false);
    expect(skipsBundleCut('sm-item-sword', 'prop')).toBe(false);
  });

  /**
   * The reason this rule exists rather than a raised size limit.
   *
   * A backdrop comes from the modelling export, where the two mountain shells
   * are two files with two panoramas. In the scene bundle they are one mesh
   * pointing at one embedded image, because the exporter dropped the material
   * that told them apart (ADR-0031). Cutting one out of the bundle therefore
   * produces the wrong asset — one shell where there are two — under a store
   * name taken from the source spelling, which `docs/assets.md` forbids.
   */
  it('refuses to cut a backdrop out of a bundle, by name list', () => {
    expect(skipsBundleCut('MountainSkybox')).toBe(true);
    expect(skipsBundleCut('mountainskybox')).toBe(true);
  });

  it('refuses one by category too, for a name the list has never heard of', () => {
    expect(skipsBundleCut('something-nobody-listed', 'backdrop')).toBe(true);
  });

  it('refuses this project’s own backdrop stems, so a re-run never doubles them', () => {
    for (const model of BACKDROP_MODELS) {
      expect(skipsBundleCut(model.stem)).toBe(true);
    }
  });
});
