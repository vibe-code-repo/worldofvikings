import { describe, expect, it } from 'vitest';
import { routeRequest } from './asset-routes.js';

const roots = { assets: '/repo/assets', store: '/srv/assets-export/store' };

describe('routeRequest', () => {
  it('serves an ordinary path from the repository assets', () => {
    expect(routeRequest('/environment/barrel.glb', roots)).toEqual({
      root: '/repo/assets',
      path: '/environment/barrel.glb',
    });
  });

  it('serves a /store path from the store, with the prefix removed', () => {
    expect(routeRequest('/store/vegetation/pine-1b1.glb', roots)).toEqual({
      root: '/srv/assets-export/store',
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
      root: '/srv/assets-export/store',
      path: '/a.glb?v=2',
    });
  });

  it('leaves traversal to the path resolver instead of pretending to handle it', () => {
    // Routing only picks the root. `resolveAssetPath` is what refuses to leave
    // it — and it is asserted below that the route still points into the store,
    // so the traversal check cannot be bypassed by prefixing `/store`.
    expect(routeRequest('/store/../../etc/passwd', roots)?.root).toBe('/srv/assets-export/store');
  });
});
