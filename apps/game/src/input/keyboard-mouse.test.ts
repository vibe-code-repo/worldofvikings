import { describe, expect, it } from 'vitest';
import { attachKeyboardMouse } from './keyboard-mouse.js';

/**
 * A hand-written DOM stub instead of jsdom (ADR-0010).
 *
 * The adapter touches six event types and one pointer-lock member. A stub of
 * that surface fits on one screen, needs no dependency, and pins the surface:
 * the day the adapter reaches for layout, styles or timers it fails against
 * this stub instead of quietly working under a simulated browser.
 *
 * The stub also counts listeners, which is what makes the `dispose` leak test
 * at the bottom possible at all.
 */
interface Listener {
  readonly type: string;
  readonly fn: (event: Event) => void;
}

/** What a dispatched event reports back to the test. */
interface Dispatched {
  readonly defaultPrevented: boolean;
}

function createTargetStub() {
  const listeners: Listener[] = [];

  return {
    listeners,
    addEventListener(type: string, fn: (event: Event) => void): void {
      listeners.push({ type, fn });
    },
    removeEventListener(type: string, fn: (event: Event) => void): void {
      const index = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    /** Delivers an event to every listener registered for `type`. */
    dispatch(type: string, event: Record<string, unknown> = {}): Dispatched {
      const result = { defaultPrevented: false };
      const payload = {
        ...event,
        preventDefault(): void {
          result.defaultPrevented = true;
        },
      };
      for (const entry of [...listeners]) {
        if (entry.type === type) {
          // The only cast in the stub. The adapter reads `code`, `repeat`,
          // `button`, `movementX`, `movementY` and `preventDefault` and nothing
          // else — the interfaces in `keyboard-mouse.ts` say so — so a record
          // carrying those is everything a handler can observe.
          entry.fn(payload as unknown as Event);
        }
      }
      return result;
    },
  };
}

function createDom(options: { readonly lockFails?: boolean } = {}) {
  const keys = createTargetStub();
  const surface = createTargetStub();
  const owner = createTargetStub();
  let locked: object | null = null;
  let lockRequests = 0;

  const pointer = {
    ...surface,
    requestPointerLock(): unknown {
      lockRequests += 1;
      if (options.lockFails === true) {
        // Chrome rejects the promise when the document is not focused. The
        // adapter must survive that without an unhandled rejection.
        return Promise.reject(new Error('not focused'));
      }
      locked = pointer;
      return undefined;
    },
  };

  const lockOwner = {
    ...owner,
    get pointerLockElement(): object | null {
      return locked;
    },
  };

  return {
    keys,
    surface,
    owner,
    pointer,
    lockOwner,
    get lockRequests(): number {
      return lockRequests;
    },
    /** Simulates the browser entering or leaving pointer lock. */
    setLocked(next: boolean): Dispatched {
      locked = next ? pointer : null;
      return owner.dispatch('pointerlockchange');
    },
  };
}

function attach(dom: ReturnType<typeof createDom>) {
  return attachKeyboardMouse({ keys: dom.keys, pointer: dom.pointer, lockOwner: dom.lockOwner });
}

describe('keyboard wiring', () => {
  it('turns a keydown into intent and a keyup into rest', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.keys.dispatch('keydown', { code: 'KeyW', repeat: false });
    expect(adapter.sample(0).moveZ).toBe(1);

    dom.keys.dispatch('keyup', { code: 'KeyW' });
    expect(adapter.sample(0).moveZ).toBe(0);

    adapter.dispose();
  });

  it('ignores auto-repeat, so holding Space dodges once', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.keys.dispatch('keydown', { code: 'Space', repeat: false });
    expect(adapter.sample(0).dodge).toBe(true);

    // The OS keeps sending keydown while the key stays down.
    dom.keys.dispatch('keydown', { code: 'Space', repeat: true });
    dom.keys.dispatch('keydown', { code: 'Space', repeat: true });

    expect(adapter.sample(0).dodge).toBe(false);

    adapter.dispose();
  });

  it('swallows the browser default for a bound key only', () => {
    const dom = createDom();
    const adapter = attach(dom);

    // Space scrolls the page and the number row drives browser shortcuts.
    expect(dom.keys.dispatch('keydown', { code: 'Space', repeat: false }).defaultPrevented).toBe(
      true,
    );

    // F5 and the developer tools must keep working: never swallow a key the
    // game does not use.
    expect(dom.keys.dispatch('keydown', { code: 'F5', repeat: false }).defaultPrevented).toBe(
      false,
    );

    adapter.dispose();
  });

  it('keeps swallowing the default while a key auto-repeats', () => {
    // Holding Space must not start scrolling the page once the OS begins to
    // repeat the key. Every repeat is still a keydown and still needs its
    // default suppressed, even though the game ignores it as a press.
    const dom = createDom();
    const adapter = attach(dom);

    dom.keys.dispatch('keydown', { code: 'Space', repeat: false });

    expect(dom.keys.dispatch('keydown', { code: 'Space', repeat: true }).defaultPrevented).toBe(
      true,
    );

    adapter.dispose();
  });
});

describe('mouse wiring', () => {
  it('turns the left button into an attack and the right into a block', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.surface.dispatch('mousedown', { button: 0 });
    dom.surface.dispatch('mousedown', { button: 2 });
    expect(adapter.sample(0)).toMatchObject({ attack: true, block: true });

    dom.keys.dispatch('mouseup', { button: 2 });
    expect(adapter.sample(0).block).toBe(false);

    adapter.dispose();
  });

  it('sees a release that happens outside the render surface', () => {
    // Press inside the canvas, release over the HUD: listening for mouseup on
    // the canvas alone would leave the block held down for good.
    const dom = createDom();
    const adapter = attach(dom);

    dom.surface.dispatch('mousedown', { button: 2 });
    expect(adapter.sample(0).block).toBe(true);

    dom.keys.dispatch('mouseup', { button: 2 });

    expect(adapter.sample(0).block).toBe(false);

    adapter.dispose();
  });

  it('suppresses the context menu, so blocking does not open it', () => {
    const dom = createDom();
    const adapter = attach(dom);

    expect(dom.surface.dispatch('contextmenu').defaultPrevented).toBe(true);

    adapter.dispose();
  });
});

describe('pointer lock', () => {
  it('asks for the lock when the render surface is clicked', () => {
    const dom = createDom();
    const adapter = attach(dom);

    expect(adapter.pointerLocked).toBe(false);
    dom.surface.dispatch('mousedown', { button: 0 });

    expect(dom.lockRequests).toBe(1);

    adapter.dispose();
  });

  it('does not ask again while the lock is already held', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.setLocked(true);
    dom.surface.dispatch('mousedown', { button: 0 });

    expect(dom.lockRequests).toBe(0);
    expect(adapter.pointerLocked).toBe(true);

    adapter.dispose();
  });

  it('survives a rejected lock request', async () => {
    const dom = createDom({ lockFails: true });
    const adapter = attach(dom);

    expect(() => dom.surface.dispatch('mousedown', { button: 0 })).not.toThrow();
    await Promise.resolve();

    expect(adapter.pointerLocked).toBe(false);

    adapter.dispose();
  });

  it('collects mouse movement only while locked', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.keys.dispatch('mousemove', { movementX: 10, movementY: 4 });
    expect(adapter.takeLook()).toEqual({ dx: 0, dy: 0 });

    dom.setLocked(true);
    dom.keys.dispatch('mousemove', { movementX: 10, movementY: 4 });
    dom.keys.dispatch('mousemove', { movementX: -3, movementY: 1 });

    expect(adapter.takeLook()).toEqual({ dx: 7, dy: 5 });

    adapter.dispose();
  });

  it('leaves look and lock alone when it does not own them', () => {
    // The game client hands look and zoom to the third-person camera (ADR-0008)
    // and keeps only keys and buttons here. Two readers of the same mousemove
    // would turn the view twice as fast, and two lock requests would fight over
    // the same canvas — so with `ownsLook: false` neither happens.
    const dom = createDom();
    const adapter = attachKeyboardMouse({
      keys: dom.keys,
      pointer: dom.pointer,
      lockOwner: dom.lockOwner,
      ownsLook: false,
    });

    dom.pointer.dispatch('mousedown', { button: 0 });
    expect(dom.lockRequests).toBe(0);
    // The button itself still reaches gameplay.
    expect(adapter.sample(0).attack).toBe(true);

    dom.setLocked(true);
    dom.keys.dispatch('mousemove', { movementX: 10, movementY: 4 });
    expect(adapter.takeLook()).toEqual({ dx: 0, dy: 0 });

    // Losing the lock must still let go of the keys, whoever asked for it.
    dom.keys.dispatch('keydown', { code: 'KeyW', repeat: false });
    expect(adapter.sample(0).moveZ).toBe(1);
    dom.setLocked(false);
    expect(adapter.sample(0).moveZ).toBe(0);

    // Not merely ignored: never registered, so nothing is read twice.
    expect(dom.keys.listeners.some((entry) => entry.type === 'mousemove')).toBe(false);

    adapter.dispose();
  });

  it('releases every held key when the lock is lost', () => {
    // Escape leaves pointer lock. Without this the character keeps running,
    // because the keyup arrives at a page that is no longer listening.
    const dom = createDom();
    const adapter = attach(dom);

    dom.setLocked(true);
    dom.keys.dispatch('keydown', { code: 'KeyW', repeat: false });
    expect(adapter.sample(0).moveZ).toBe(1);

    dom.setLocked(false);

    expect(adapter.sample(0).moveZ).toBe(0);
    expect(adapter.pointerLocked).toBe(false);

    adapter.dispose();
  });

  it('releases every held key when the window loses focus', () => {
    const dom = createDom();
    const adapter = attach(dom);

    dom.keys.dispatch('keydown', { code: 'KeyW', repeat: false });
    dom.keys.dispatch('blur');

    expect(adapter.sample(0).moveZ).toBe(0);

    adapter.dispose();
  });
});

describe('dispose', () => {
  it('removes every listener it added', () => {
    const dom = createDom();
    const adapter = attach(dom);
    const attached =
      dom.keys.listeners.length + dom.surface.listeners.length + dom.owner.listeners.length;

    expect(attached).toBeGreaterThan(0);
    adapter.dispose();

    expect(dom.keys.listeners).toEqual([]);
    expect(dom.surface.listeners).toEqual([]);
    expect(dom.owner.listeners).toEqual([]);
  });

  it('is idempotent and deaf afterwards', () => {
    const dom = createDom();
    const adapter = attach(dom);

    adapter.dispose();
    adapter.dispose();
    dom.keys.dispatch('keydown', { code: 'KeyW', repeat: false });

    expect(adapter.sample(0).moveZ).toBe(0);
  });
});
