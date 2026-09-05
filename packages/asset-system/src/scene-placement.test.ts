import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { describe, expect, it } from 'vitest';
import { AssetManager } from './asset-manager.js';
import type {
  AssetPlacement,
  InstantiatedNode,
  InstantiatedNodes,
  PlaceableNode,
} from './scene-placement.js';
import { placeAssets, summarizePlacement } from './scene-placement.js';

/** A stand-in for a Babylon `TransformNode` that records what was done to it. */
function fakeNode(
  initialScale = 1,
  mirrored = false,
): PlaceableNode & {
  readonly moves: [number, number, number][];
  scaleFactor: number;
} {
  const node = {
    name: 'source',
    moves: [] as [number, number, number][],
    // A glTF root arrives pre-scaled: Babylon mirrors x to convert handedness.
    scaleFactor: mirrored ? -initialScale : initialScale,
    position: {
      set(x: number, y: number, z: number): void {
        node.moves.push([x, y, z]);
      },
    },
    scaling: {
      scaleInPlace(factor: number): void {
        node.scaleFactor *= factor;
      },
    },
  };
  return node;
}

/** A root that is not a `TransformNode` — a light or camera root, say. */
function bareNode(): InstantiatedNode {
  return { name: 'source' };
}

function instantiatorFor(nodes: Record<string, readonly InstantiatedNode[]>): {
  instantiate(assetPath: string): Promise<InstantiatedNodes>;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    instantiate(assetPath: string): Promise<InstantiatedNodes> {
      calls.push(assetPath);
      const roots = nodes[assetPath];
      if (roots === undefined) {
        return Promise.reject(new Error(`no such asset: ${assetPath}`));
      }
      return Promise.resolve({ rootNodes: roots });
    },
  };
}

const barrel: AssetPlacement = {
  asset: 'environment/barrel.glb',
  name: 'barrel',
  position: [3, 0, -2],
};

describe('placeAssets', () => {
  it('places nothing and instantiates nothing for an empty list', async () => {
    const instantiator = instantiatorFor({});

    const result = await placeAssets(instantiator, []);

    expect(result.placed).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(instantiator.calls).toEqual([]);
  });

  it('instantiates every placement and reports them in input order', async () => {
    const instantiator = instantiatorFor({
      'environment/barrel.glb': [fakeNode()],
      'environment/crate.glb': [fakeNode()],
    });
    const crate: AssetPlacement = {
      asset: 'environment/crate.glb',
      name: 'crate',
      position: [0, 0, 0],
    };

    const result = await placeAssets(instantiator, [barrel, crate]);

    expect(result.failures).toEqual([]);
    expect(result.placed).toEqual([barrel, crate]);
    expect(instantiator.calls).toEqual(['environment/barrel.glb', 'environment/crate.glb']);
  });

  it('moves the instantiated root to the placement position', async () => {
    const node = fakeNode();
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [node] });

    await placeAssets(instantiator, [barrel]);

    expect(node.moves).toEqual([[3, 0, -2]]);
  });

  it('names the instantiated root after the placement', async () => {
    const node = fakeNode();
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [node] });

    await placeAssets(instantiator, [barrel]);

    expect(node.name).toBe('barrel');
  });

  it('numbers the roots when an asset instantiates more than one', async () => {
    const first = fakeNode();
    const second = fakeNode();
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [first, second] });

    await placeAssets(instantiator, [barrel]);

    expect([first.name, second.name]).toEqual(['barrel.0', 'barrel.1']);
  });

  it('leaves the scaling untouched when no scale is given', async () => {
    const node = fakeNode(1, true);
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [node] });

    await placeAssets(instantiator, [barrel]);

    expect(node.scaleFactor).toBe(-1);
  });

  it('multiplies the existing scaling instead of replacing it', async () => {
    // Babylon's glTF loader mirrors the root on x to convert handedness. A
    // placement that assigns scaling would flip the model inside out; it has to
    // multiply, so the sign survives.
    const node = fakeNode(1, true);
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [node] });

    await placeAssets(instantiator, [{ ...barrel, scale: 6 }]);

    expect(node.scaleFactor).toBe(-6);
  });

  it('moves only the roots that carry a transform', async () => {
    // Babylon types `rootNodes` as `Node[]`, and a `Node` need not have one: a
    // light or camera can be a root too. Placement has to check, not assume.
    const movable = fakeNode();
    const light = bareNode();
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [light, movable] });

    const result = await placeAssets(instantiator, [barrel]);

    expect(result.placed).toEqual([barrel]);
    expect(movable.moves).toEqual([[3, 0, -2]]);
    expect([light.name, movable.name]).toEqual(['barrel.0', 'barrel.1']);
  });

  it('fails the placement when nothing instantiated can be positioned', async () => {
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [] });

    const result = await placeAssets(instantiator, [barrel]);

    expect(result.placed).toEqual([]);
    expect(result.failures[0]?.error.message).toContain('environment/barrel.glb');
    expect(result.failures[0]?.error.message).toContain('no root node that can be positioned');
  });

  it('reports a failed placement without losing the others', async () => {
    const node = fakeNode();
    const instantiator = instantiatorFor({ 'environment/barrel.glb': [node] });
    const missing: AssetPlacement = {
      asset: 'environment/missing.glb',
      name: 'missing',
      position: [0, 0, 0],
    };

    const result = await placeAssets(instantiator, [missing, barrel]);

    expect(result.placed).toEqual([barrel]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.placement).toEqual(missing);
    expect(result.failures[0]?.error.message).toContain('no such asset');
    expect(node.moves).toEqual([[3, 0, -2]]);
  });

  it('wraps a non-Error rejection so callers always get an Error', async () => {
    const instantiator = {
      instantiate: (): Promise<InstantiatedNodes> => Promise.reject('boom'),
    };

    const result = await placeAssets(instantiator, [barrel]);

    expect(result.failures[0]?.error).toBeInstanceOf(Error);
    expect(result.failures[0]?.error.message).toContain('boom');
  });

  it('accepts a real AssetManager as its instantiator', async () => {
    // The port only pays off if the real manager fits through it. Nothing but a
    // type change is needed to break that, and nothing but this test notices.
    const node = fakeNode();
    const container = {
      instantiateModelsToScene: () => ({ rootNodes: [node] }) as unknown as InstantiatedEntries,
    } as unknown as AssetContainer;
    const manager = new AssetManager({
      source: { baseUrl: 'http://localhost:9000' },
      scene: {} as unknown as Scene,
      loadContainer: () => Promise.resolve(container),
    });

    const result = await placeAssets(manager, [barrel]);

    expect(result.placed).toEqual([barrel]);
    expect(node.moves).toEqual([[3, 0, -2]]);
  });
});

describe('summarizePlacement', () => {
  it('reports how many assets were placed', () => {
    expect(summarizePlacement({ placed: [barrel], failures: [] })).toBe('assets: 1 loaded');
  });

  it('says "0 loaded" rather than staying silent when there is nothing to place', () => {
    expect(summarizePlacement({ placed: [], failures: [] })).toBe('assets: 0 loaded');
  });

  it('names the failed assets, because a silent 404 is the failure mode to avoid', () => {
    const summary = summarizePlacement({
      placed: [barrel],
      failures: [
        {
          placement: { asset: 'environment/missing.glb', name: 'missing', position: [0, 0, 0] },
          error: new Error('404'),
        },
      ],
    });

    expect(summary).toBe('assets: 1 loaded, 1 failed (environment/missing.glb)');
  });

  it('lists every failed asset', () => {
    const summary = summarizePlacement({
      placed: [],
      failures: [
        { placement: { asset: 'a.glb', name: 'a', position: [0, 0, 0] }, error: new Error('x') },
        { placement: { asset: 'b.glb', name: 'b', position: [0, 0, 0] }, error: new Error('y') },
      ],
    });

    expect(summary).toBe('assets: 0 loaded, 2 failed (a.glb, b.glb)');
  });
});
