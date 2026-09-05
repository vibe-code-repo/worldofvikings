import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  INPUT_ACTIONS,
  compileBindings,
  unboundActions,
  type BindingTable,
} from './bindings.js';

describe('the binding table as data', () => {
  it('survives a JSON round trip, so a profile can store it', () => {
    // The whole point of a table instead of a switch statement: a rebinding
    // screen writes JSON to a profile and a later session reads it back. If a
    // row ever needs a function or a class this assertion breaks first.
    const roundTripped: BindingTable = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as BindingTable;

    expect(roundTripped).toEqual(DEFAULT_BINDINGS);
    expect(compileBindings(roundTripped)).toEqual(compileBindings(DEFAULT_BINDINGS));
  });

  it('binds every action the game knows — an unbound action is a dead feature', () => {
    expect(unboundActions(DEFAULT_BINDINGS)).toEqual([]);
  });

  it('binds exactly the desktop controls of spec §27', () => {
    const compiled = compileBindings(DEFAULT_BINDINGS);
    const keyboard = Object.fromEntries(compiled.keyboard);
    const mouse = Object.fromEntries(compiled.mouse);

    expect(keyboard['KeyW']).toBe('moveForward');
    expect(keyboard['KeyA']).toBe('strafeLeft');
    expect(keyboard['KeyS']).toBe('moveBackward');
    expect(keyboard['KeyD']).toBe('strafeRight');
    expect(keyboard['ShiftLeft']).toBe('sprint');
    expect(keyboard['Space']).toBe('dodge');
    expect(keyboard['KeyE']).toBe('interact');
    expect(keyboard['Digit1']).toBe('slot1');
    expect(keyboard['Digit5']).toBe('slot5');
    expect(mouse[0]).toBe('attack');
    expect(mouse[2]).toBe('block');
  });

  it('lets several sources share one action', () => {
    const compiled = compileBindings(DEFAULT_BINDINGS);

    expect(compiled.keyboard.get('ShiftLeft')).toBe('sprint');
    expect(compiled.keyboard.get('ShiftRight')).toBe('sprint');
    expect(compiled.keyboard.get('ArrowUp')).toBe('moveForward');
  });
});

describe('compileBindings', () => {
  it('turns rows into a lookup by device and source', () => {
    const compiled = compileBindings([
      { action: 'moveForward', source: { device: 'keyboard', code: 'KeyI' } },
      { action: 'attack', source: { device: 'mouse', button: 4 } },
    ]);

    expect(compiled.keyboard.get('KeyI')).toBe('moveForward');
    expect(compiled.mouse.get(4)).toBe('attack');
    expect(compiled.keyboard.get('KeyW')).toBeUndefined();
  });

  it('replaces the defaults completely instead of merging with them', () => {
    // A rebinding table is the whole truth. Merging would leave the old key
    // working as well, which is exactly the bug a player reports as "I still
    // walk forward when I press W".
    const esdf = compileBindings([
      { action: 'moveForward', source: { device: 'keyboard', code: 'KeyE' } },
    ]);

    expect(esdf.keyboard.get('KeyE')).toBe('moveForward');
    expect(esdf.keyboard.get('KeyW')).toBeUndefined();
  });

  it('rejects one source bound to two actions', () => {
    expect(() =>
      compileBindings([
        { action: 'attack', source: { device: 'keyboard', code: 'KeyE' } },
        { action: 'interact', source: { device: 'keyboard', code: 'KeyE' } },
      ]),
    ).toThrow(/KeyE/);

    expect(() =>
      compileBindings([
        { action: 'attack', source: { device: 'mouse', button: 0 } },
        { action: 'block', source: { device: 'mouse', button: 0 } },
      ]),
    ).toThrow(/mouse/i);
  });

  it('rejects an unknown action, because a table is external data', () => {
    const fromDisk = [{ action: 'fireball', source: { device: 'keyboard', code: 'KeyF' } }];

    expect(() => compileBindings(fromDisk as unknown as BindingTable)).toThrow(/fireball/);
  });

  it('rejects a malformed source', () => {
    const rows: readonly unknown[] = [
      { action: 'attack', source: { device: 'keyboard', code: '' } },
      { action: 'attack', source: { device: 'mouse', button: -1 } },
      { action: 'attack', source: { device: 'mouse', button: 1.5 } },
      { action: 'attack', source: { device: 'gamepad', button: 1 } },
      { action: 'attack' },
    ];

    for (const row of rows) {
      expect(() => compileBindings([row] as unknown as BindingTable)).toThrow();
    }
  });

  it('accepts an empty table — a player may unbind everything', () => {
    const compiled = compileBindings([]);

    expect(compiled.keyboard.size).toBe(0);
    expect(compiled.mouse.size).toBe(0);
    expect(unboundActions([])).toEqual([...INPUT_ACTIONS]);
  });
});
