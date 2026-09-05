import { describe, expect, it, vi } from 'vitest';
import { createCameraLookInput } from './camera-input.js';
import type { CameraInputSink, CameraLookInputOptions } from './camera-input.js';

function recorder(): CameraInputSink & {
  readonly looks: [number, number][];
  readonly zooms: number[];
} {
  const looks: [number, number][] = [];
  const zooms: number[] = [];
  return {
    looks,
    zooms,
    look: (dx, dy) => void looks.push([dx, dy]),
    zoom: (ticks) => void zooms.push(ticks),
  };
}

function input(options: CameraLookInputOptions = {}) {
  const sink = recorder();
  return { sink, handlers: createCameraLookInput(sink, options) };
}

describe('createCameraLookInput', () => {
  it('ignores mouse movement until the player asks to look', () => {
    const { sink, handlers } = input();
    handlers.onPointerMove({ movementX: 20, movementY: 5 });
    expect(sink.looks).toEqual([]);
  });

  it('asks for pointer lock on the first press, and not again while locked', () => {
    const requestPointerLock = vi.fn();
    const { handlers } = input({ requestPointerLock });

    handlers.onPointerDown({ button: 0 });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);

    handlers.onPointerLockChange(true);
    handlers.onPointerDown({ button: 0 });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('keeps looking after the button is released once the pointer is locked', () => {
    const { sink, handlers } = input();
    handlers.onPointerDown({ button: 0 });
    handlers.onPointerLockChange(true);
    handlers.onPointerUp({ button: 0 });

    handlers.onPointerMove({ movementX: 4, movementY: -2 });
    expect(sink.looks).toEqual([[4, -2]]);
  });

  /**
   * Pointer lock needs a user gesture and can be refused outright. Without the
   * drag fallback the camera would simply not turn, with nothing on screen
   * saying why — so a held button looks around even while unlocked.
   */
  it('looks around while the button is held even without pointer lock', () => {
    const { sink, handlers } = input();
    handlers.onPointerDown({ button: 0 });
    handlers.onPointerMove({ movementX: 7, movementY: 3 });
    handlers.onPointerUp({ button: 0 });
    handlers.onPointerMove({ movementX: 9, movementY: 1 });

    expect(sink.looks).toEqual([[7, 3]]);
  });

  it('can be built without the drag fallback', () => {
    const { sink, handlers } = input({ dragLookFallback: false });
    handlers.onPointerDown({ button: 0 });
    handlers.onPointerMove({ movementX: 7, movementY: 3 });
    expect(sink.looks).toEqual([]);

    handlers.onPointerLockChange(true);
    handlers.onPointerMove({ movementX: 7, movementY: 3 });
    expect(sink.looks).toEqual([[7, 3]]);
  });

  it('leaves the other mouse buttons alone', () => {
    const requestPointerLock = vi.fn();
    const { sink, handlers } = input({ requestPointerLock });
    handlers.onPointerDown({ button: 2 });
    handlers.onPointerMove({ movementX: 7, movementY: 3 });

    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(sink.looks).toEqual([]);
  });

  it('stops looking when the pointer lock is lost', () => {
    const { sink, handlers } = input();
    handlers.onPointerDown({ button: 0 });
    handlers.onPointerLockChange(true);
    handlers.onPointerUp({ button: 0 });
    handlers.onPointerLockChange(false);

    handlers.onPointerMove({ movementX: 4, movementY: 4 });
    expect(sink.looks).toEqual([]);
  });

  /**
   * Alt-tab during a drag: the release lands in another window, so without this
   * the camera would keep turning with every later mouse move over the canvas.
   */
  it('cancels a drag when the window loses focus', () => {
    const { sink, handlers } = input();
    handlers.onPointerDown({ button: 0 });
    handlers.onBlur();
    handlers.onPointerMove({ movementX: 4, movementY: 4 });
    expect(sink.looks).toEqual([]);
  });

  it('zooms on the wheel whatever the look state is, normalised per delta mode', () => {
    const { sink, handlers } = input();
    handlers.onWheel({ deltaY: 100, deltaMode: 0 });
    handlers.onWheel({ deltaY: -3, deltaMode: 1 });

    expect(sink.zooms).toHaveLength(2);
    expect(sink.zooms[0]).toBeCloseTo(1, 12);
    expect(sink.zooms[1]).toBeCloseTo(-1, 12);
  });

  it('reports what it is doing, so a caller can show a hint', () => {
    const { handlers } = input();
    expect(handlers.isLooking()).toBe(false);
    handlers.onPointerDown({ button: 0 });
    expect(handlers.isLooking()).toBe(true);
  });
});
