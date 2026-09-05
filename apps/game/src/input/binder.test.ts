import { NEUTRAL_INPUT, horizontalLength } from '@wov/gameplay';
import { describe, expect, it } from 'vitest';
import { createInputBinder } from './binder.js';
import { type BindingTable } from './bindings.js';

const HALF_DIAGONAL = Math.SQRT1_2;

describe('the binder at rest', () => {
  it('reports the neutral intent when nothing is pressed', () => {
    expect(createInputBinder().sample(0)).toEqual(NEUTRAL_INPUT);
  });

  it('ignores a source nothing binds', () => {
    const binder = createInputBinder();

    binder.pressKey('KeyZ');
    binder.pressButton(1);

    expect(binder.sample(0)).toEqual(NEUTRAL_INPUT);
  });
});

describe('movement axes', () => {
  it('maps the four movement keys onto the two axes', () => {
    const binder = createInputBinder();

    binder.pressKey('KeyW');
    expect(binder.sample(0)).toMatchObject({ moveX: 0, moveZ: 1 });

    binder.releaseKey('KeyW');
    binder.pressKey('KeyS');
    expect(binder.sample(0)).toMatchObject({ moveX: 0, moveZ: -1 });

    binder.releaseKey('KeyS');
    binder.pressKey('KeyD');
    expect(binder.sample(0)).toMatchObject({ moveX: 1, moveZ: 0 });

    binder.releaseKey('KeyD');
    binder.pressKey('KeyA');
    expect(binder.sample(0)).toMatchObject({ moveX: -1, moveZ: 0 });
  });

  it('cancels opposing keys instead of letting the last one win', () => {
    const binder = createInputBinder();

    binder.pressKey('KeyW');
    binder.pressKey('KeyS');

    expect(binder.sample(0)).toMatchObject({ moveX: 0, moveZ: 0 });
  });

  it('normalises a diagonal before it reaches the simulation', () => {
    const binder = createInputBinder();

    binder.pressKey('KeyW');
    binder.pressKey('KeyD');
    const input = binder.sample(0);

    expect(input.moveX).toBeCloseTo(HALF_DIAGONAL, 12);
    expect(input.moveZ).toBeCloseTo(HALF_DIAGONAL, 12);
    expect(horizontalLength(input.moveX, input.moveZ)).toBeCloseTo(1, 12);
  });
});

describe('camera-relative axes', () => {
  it('rotates forward into the camera direction', () => {
    const binder = createInputBinder();
    binder.pressKey('KeyW');

    const quarterTurn = binder.sample(Math.PI / 2);

    // Yaw π/2 looks down +x, so "forward" must become +x, not +z.
    expect(quarterTurn.moveX).toBeCloseTo(1, 12);
    expect(quarterTurn.moveZ).toBeCloseTo(0, 12);
  });

  it('keeps a diagonal pointing 45° off the camera at every yaw', () => {
    // Regression guard. The axes are clamped to [-1, 1] on their way into the
    // InputState, so rotating an un-normalised diagonal (length 1.41) clips one
    // component and bends the direction — the player would drift off-axis at
    // some camera angles and not at others. Normalising before the rotation is
    // what keeps this true.
    const binder = createInputBinder();
    binder.pressKey('KeyW');
    binder.pressKey('KeyD');

    for (let step = 0; step < 32; step += 1) {
      const yaw = (step / 32) * 2 * Math.PI;
      const input = binder.sample(yaw);
      const heading = Math.atan2(input.moveX, input.moveZ);
      const expected = Math.atan2(Math.sin(yaw + Math.PI / 4), Math.cos(yaw + Math.PI / 4));

      expect(heading).toBeCloseTo(expected, 10);
      expect(horizontalLength(input.moveX, input.moveZ)).toBeCloseTo(1, 10);
    }
  });
});

describe('held actions', () => {
  it('holds sprint for as long as the key is down', () => {
    const binder = createInputBinder();

    binder.pressKey('ShiftLeft');
    expect(binder.sample(0).sprint).toBe(true);
    expect(binder.sample(0).sprint).toBe(true);

    binder.releaseKey('ShiftLeft');
    expect(binder.sample(0).sprint).toBe(false);
  });

  it('holds block for as long as the right button is down', () => {
    const binder = createInputBinder();

    binder.pressButton(2);
    expect(binder.sample(0).block).toBe(true);
    expect(binder.sample(0).block).toBe(true);

    binder.releaseButton(2);
    expect(binder.sample(0).block).toBe(false);
  });
});

describe('edge-triggered actions', () => {
  it('reports dodge, interact and attack once per press, not once per tick', () => {
    const binder = createInputBinder();

    binder.pressKey('Space');
    binder.pressKey('KeyE');
    binder.pressButton(0);

    const first = binder.sample(0);
    expect(first).toMatchObject({ dodge: true, interact: true, attack: true });

    // Everything is still held down. A second tick must not fire again,
    // otherwise holding Space would dodge sixty times a second.
    const second = binder.sample(0);
    expect(second).toMatchObject({ dodge: false, interact: false, attack: false });
  });

  it('ignores a repeated press of a key that is already down', () => {
    // The OS repeats a held key several times a second. The press has to cross
    // a sample boundary for this to bite: without the "already held" guard the
    // second keydown arms the dodge again and the character rolls forever.
    const binder = createInputBinder();

    binder.pressKey('Space');
    expect(binder.sample(0).dodge).toBe(true);

    binder.pressKey('Space');

    expect(binder.sample(0).dodge).toBe(false);
  });

  it('ignores a repeated press of a button that is already down', () => {
    const binder = createInputBinder();

    binder.pressButton(0);
    expect(binder.sample(0).attack).toBe(true);

    binder.pressButton(0);

    expect(binder.sample(0).attack).toBe(false);
  });

  it('fires again after a release and a new press', () => {
    const binder = createInputBinder();

    binder.pressKey('Space');
    expect(binder.sample(0).dodge).toBe(true);
    binder.releaseKey('Space');
    binder.pressKey('Space');

    expect(binder.sample(0).dodge).toBe(true);
  });

  it('survives a press and release inside one tick', () => {
    // A 144 Hz mouse and a 60 Hz simulation: a click can begin and end between
    // two samples. Dropping it would lose the input entirely.
    const binder = createInputBinder();

    binder.pressButton(0);
    binder.releaseButton(0);

    expect(binder.sample(0).attack).toBe(true);
  });
});

describe('quick slots', () => {
  it('reports the pressed slot for exactly one tick', () => {
    const binder = createInputBinder();

    binder.pressKey('Digit3');
    expect(binder.sample(0).slot).toBe(3);
    expect(binder.sample(0).slot).toBe(0);
  });

  it('lets the last slot of a tick win, because a slot is exclusive', () => {
    const binder = createInputBinder();

    binder.pressKey('Digit2');
    binder.pressKey('Digit5');

    expect(binder.sample(0).slot).toBe(5);
  });

  it('accepts the numeric keypad as a second source', () => {
    const binder = createInputBinder();

    binder.pressKey('Numpad4');

    expect(binder.sample(0).slot).toBe(4);
  });
});

describe('releaseAll', () => {
  it('clears held keys, so losing focus does not leave the player running', () => {
    const binder = createInputBinder();

    binder.pressKey('KeyW');
    binder.pressKey('ShiftLeft');
    binder.releaseAll();

    expect(binder.sample(0)).toEqual(NEUTRAL_INPUT);
  });

  it('drops pending edges too, so a queued dodge does not fire on return', () => {
    const binder = createInputBinder();

    binder.pressKey('Space');
    binder.pressKey('Digit1');
    binder.releaseAll();

    expect(binder.sample(0)).toEqual(NEUTRAL_INPUT);
  });
});

describe('rebinding', () => {
  const esdf: BindingTable = [
    { action: 'moveForward', source: { device: 'keyboard', code: 'KeyE' } },
    { action: 'strafeRight', source: { device: 'keyboard', code: 'KeyF' } },
  ];

  it('takes effect immediately and drops the old table', () => {
    const binder = createInputBinder();

    binder.rebind(esdf);
    binder.pressKey('KeyE');
    expect(binder.sample(0)).toMatchObject({ moveZ: 1, interact: false });

    binder.releaseKey('KeyE');
    binder.pressKey('KeyW');
    expect(binder.sample(0)).toMatchObject({ moveX: 0, moveZ: 0 });
  });

  it('re-reads a key that is already held', () => {
    // Held state is kept per physical key, not per action. A key held while the
    // table changes therefore means the new action, not a stuck old one.
    const binder = createInputBinder();

    binder.pressKey('KeyW');
    expect(binder.sample(0).moveZ).toBe(1);

    binder.rebind([{ action: 'strafeRight', source: { device: 'keyboard', code: 'KeyW' } }]);

    expect(binder.sample(0)).toMatchObject({ moveX: 1, moveZ: 0 });
  });

  it('rejects a broken table and keeps the working one', () => {
    const binder = createInputBinder();

    expect(() =>
      binder.rebind([{ action: 'moveForward', source: { device: 'keyboard', code: '' } }]),
    ).toThrow();

    binder.pressKey('KeyW');
    expect(binder.sample(0).moveZ).toBe(1);
  });
});

describe('the look delta', () => {
  it('accumulates until it is taken, then resets', () => {
    const binder = createInputBinder();

    binder.addLook(3, -2);
    binder.addLook(1, 5);

    expect(binder.takeLook()).toEqual({ dx: 4, dy: 3 });
    expect(binder.takeLook()).toEqual({ dx: 0, dy: 0 });
  });
});
