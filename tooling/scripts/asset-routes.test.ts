import { describe, expect, it } from 'vitest';
import { AUDIO_EXTENSIONS } from '@wov/asset-system';
import { FALLBACK_CONTENT_TYPE, contentTypeFor, routeRequest } from './asset-routes.js';

const roots = { assets: '/repo/assets', store: '/srv/assets/store' };

describe('routeRequest', () => {
  it('serves an ordinary path from the repository assets', () => {
    expect(routeRequest('/environment/barrel.glb', roots)).toEqual({
      root: '/repo/assets',
      path: '/environment/barrel.glb',
    });
  });

  it('serves a /store path from the store, with the prefix removed', () => {
    expect(routeRequest('/store/vegetation/pine-1b1.glb', roots)).toEqual({
      root: '/srv/assets/store',
      path: '/vegetation/pine-1b1.glb',
    });
  });

  it('answers nothing for a /store path when no store is mounted', () => {
    expect(
      routeRequest('/store/vegetation/pine-1b1.glb', { assets: '/repo/assets' }),
    ).toBeUndefined();
    expect(
      routeRequest('/store/vegetation/pine-1b1.glb', { assets: '/repo/assets', store: '' }),
    ).toBeUndefined();
  });

  it('does not mistake a repository folder whose name merely starts with "store"', () => {
    // `/storefront/...` is not the store. Getting this wrong would strip six
    // characters off a real path and serve the wrong file, or nothing at all.
    expect(routeRequest('/storefront/sign.glb', roots)?.root).toBe('/repo/assets');
  });

  it('keeps the query string with the path it belongs to', () => {
    expect(routeRequest('/store/a.glb?v=2', roots)).toEqual({
      root: '/srv/assets/store',
      path: '/a.glb?v=2',
    });
  });

  it('leaves traversal to the path resolver instead of pretending to handle it', () => {
    // Routing only picks the root. `resolveAssetPath` is what refuses to leave
    // it — and it is asserted below that the route still points into the store,
    // so the traversal check cannot be bypassed by prefixing `/store`.
    expect(routeRequest('/store/../../etc/passwd', roots)?.root).toBe('/srv/assets/store');
  });
});

describe('contentTypeFor', () => {
  it('names every audio extension this project can import', () => {
    // The "valid in four places, unknown in a fifth" check: importing a format
    // the server cannot name would only show up as a header nobody reads until
    // a strict client refuses it.
    for (const extension of AUDIO_EXTENSIONS) {
      expect(contentTypeFor(`audio/ambience/bed${extension}`)).toMatch(/^audio\//);
    }
  });

  it('serves an Opus file in an Ogg container as Ogg audio', () => {
    expect(contentTypeFor('audio/footsteps/gravel-01.ogg')).toBe('audio/ogg');
    expect(contentTypeFor('audio/footsteps/gravel-01.opus')).toBe('audio/ogg');
  });

  it('serves the silent placeholder as WAV rather than as bytes', () => {
    expect(contentTypeFor('placeholders/audio/silence.wav')).toBe('audio/wav');
  });

  it('ignores the case of the extension', () => {
    expect(contentTypeFor('environment/BARREL.GLB')).toBe('model/gltf-binary');
  });

  it('falls back rather than guessing for something it was never told about', () => {
    expect(contentTypeFor('environment/notes.xyz')).toBe(FALLBACK_CONTENT_TYPE);
  });
});
