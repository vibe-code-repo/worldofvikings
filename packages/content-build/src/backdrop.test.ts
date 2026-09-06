/**
 * The backdrop identity: the file list, the name test and the size limit.
 *
 * The half that rewrites GLB bytes is tested next to it, in
 * `tooling/asset-pipeline/backdrop.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKDROP_MODELS,
  BACKDROP_SIZE_LIMIT,
  WORLD_OBJECT_SIZE_LIMIT,
  backdropModelPath,
  backdropTexturePath,
  cutSizeLimit,
  isBackdropName,
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

describe('cutSizeLimit', () => {
  it('keeps the 80 m limit for everything that is not a backdrop', () => {
    expect(cutSizeLimit('sm-prop-barrel-01')).toBe(WORLD_OBJECT_SIZE_LIMIT);
    expect(cutSizeLimit('sm-item-sword', 'prop')).toBe(WORLD_OBJECT_SIZE_LIMIT);
  });

  it('lifts it by name list', () => {
    expect(cutSizeLimit('MountainSkybox')).toBe(BACKDROP_SIZE_LIMIT);
  });

  it('lifts it by category', () => {
    // A name the list has never heard of, filed under `backdrop` by the
    // catalogue: the two halves of the rule are independent on purpose.
    expect(cutSizeLimit('something-nobody-listed', 'backdrop')).toBe(BACKDROP_SIZE_LIMIT);
  });

  it('is still a limit — a shell exported in centimetres is over even the backdrop one', () => {
    expect(118_800).toBeGreaterThan(BACKDROP_SIZE_LIMIT);
  });
});
