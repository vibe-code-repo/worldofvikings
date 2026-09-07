import { describe, expect, it } from 'vitest';
import {
  freezeMaterialsWhenReady,
  freezeStaticNodes,
  unfreezeStaticNodes,
  type FreezableScene,
  type StaticNode,
} from './static-freeze.js';

/** A node that records what was done to it, in the order it happened. */
class FakeNode implements StaticNode {
  readonly log: string[] = [];
  frozen = false;
  doNotSyncBoundingInfo?: boolean;
  private readonly children: FakeNode[] = [];

  constructor(
    readonly name: string,
    private readonly trace: string[],
    mesh = false,
  ) {
    if (mesh) {
      this.doNotSyncBoundingInfo = false;
    }
  }

  add(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  computeWorldMatrix(force?: boolean): unknown {
    this.trace.push(`compute:${this.name}:${force === true ? 'forced' : 'lazy'}`);
    return null;
  }

  freezeWorldMatrix(): void {
    this.trace.push(`freeze:${this.name}`);
    this.frozen = true;
  }

  unfreezeWorldMatrix(): void {
    this.trace.push(`unfreeze:${this.name}`);
    this.frozen = false;
  }

  getDescendants(): StaticNode[] {
    // Babylon's own order: a child, then everything under it.
    return this.children.flatMap((child) => [child, ...child.getDescendants()]);
  }
}

function tree(trace: string[]): { root: FakeNode; child: FakeNode; grandchild: FakeNode } {
  const root = new FakeNode('root', trace);
  const child = root.add(new FakeNode('child', trace, true));
  const grandchild = child.add(new FakeNode('grandchild', trace, true));
  return { root, child, grandchild };
}

describe('freezeStaticNodes', () => {
  it('freezes the root and everything under it', () => {
    const trace: string[] = [];
    const { root, child, grandchild } = tree(trace);
    const report = freezeStaticNodes([root]);
    expect([root.frozen, child.frozen, grandchild.frozen]).toEqual([true, true, true]);
    expect(report.frozen).toBe(3);
  });

  it('computes a node before it freezes it, parents before children', () => {
    const trace: string[] = [];
    const { root } = tree(trace);
    freezeStaticNodes([root]);
    // The order is the correctness argument: a child frozen before its parent
    // was computed pins the parent's stale transform into itself.
    expect(trace).toEqual([
      'compute:root:forced',
      'freeze:root',
      'compute:child:forced',
      'freeze:child',
      'compute:grandchild:forced',
      'freeze:grandchild',
    ]);
  });

  it('forces the recompute rather than trusting a clean flag', () => {
    const trace: string[] = [];
    const { root } = tree(trace);
    freezeStaticNodes([root]);
    expect(trace.filter((entry) => entry.endsWith(':lazy'))).toEqual([]);
  });

  it('pins the bounding box on meshes only, never on a bare transform', () => {
    const trace: string[] = [];
    const { root, child, grandchild } = tree(trace);
    const report = freezeStaticNodes([root]);
    expect(root.doNotSyncBoundingInfo).toBeUndefined();
    expect([child.doNotSyncBoundingInfo, grandchild.doNotSyncBoundingInfo]).toEqual([true, true]);
    expect(report.boundsPinned).toBe(2);
  });

  it('is safe to run twice', () => {
    const trace: string[] = [];
    const { root } = tree(trace);
    freezeStaticNodes([root]);
    const again = freezeStaticNodes([root]);
    expect(again.frozen).toBe(3);
    expect(root.frozen).toBe(true);
  });

  it('does nothing when handed nothing', () => {
    expect(freezeStaticNodes([])).toEqual({ frozen: 0, boundsPinned: 0 });
  });
});

describe('unfreezeStaticNodes', () => {
  it('lets a subtree move again and recomputes it where it now stands', () => {
    const trace: string[] = [];
    const { root, child } = tree(trace);
    freezeStaticNodes([root]);
    trace.length = 0;
    const thawed = unfreezeStaticNodes([root]);
    expect(thawed).toBe(3);
    expect([root.frozen, child.frozen]).toEqual([false, false]);
    expect(child.doNotSyncBoundingInfo).toBe(false);
    expect(trace).toContain('unfreeze:root');
    expect(trace).toContain('compute:root:forced');
  });
});

describe('freezeMaterialsWhenReady', () => {
  /** A scene that hands its readiness callback back instead of running it. */
  function fakeScene(): {
    scene: FreezableScene;
    ready: () => void;
    frozen: () => number;
    checkedRenderTargets: () => boolean | undefined;
  } {
    let callback: (() => void) | null = null;
    let checkRenderTargets: boolean | undefined;
    let frozen = 0;
    return {
      scene: {
        executeWhenReady(next, check) {
          callback = next;
          checkRenderTargets = check;
        },
        freezeMaterials() {
          frozen += 1;
        },
      },
      ready: () => callback?.(),
      frozen: () => frozen,
      checkedRenderTargets: () => checkRenderTargets,
    };
  }

  it('does not freeze anything before the scene says it is ready', () => {
    const fake = fakeScene();
    freezeMaterialsWhenReady(fake.scene);
    // A material frozen while its textures are still arriving is pinned to
    // "not ready" and the ground stays grey for the life of the page.
    expect(fake.frozen()).toBe(0);
  });

  it('freezes once the scene is ready', () => {
    const fake = fakeScene();
    freezeMaterialsWhenReady(fake.scene);
    fake.ready();
    expect(fake.frozen()).toBe(1);
  });

  it('waits for the render targets too, because the shadow map is one', () => {
    const fake = fakeScene();
    freezeMaterialsWhenReady(fake.scene);
    expect(fake.checkedRenderTargets()).toBe(true);
  });
});
