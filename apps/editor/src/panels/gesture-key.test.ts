/** The counting behind "one drag, one undo step" (see `gesture-key.ts`). */
import { describe, expect, it } from 'vitest';
import { createGestureKeys } from './gesture-key.js';

describe('gesture keys', () => {
  it('keeps one key for the whole of one gesture', () => {
    const keys = createGestureKeys();
    keys.begin('ground-metallic-0');
    const during = [keys.key('ground-metallic-0'), keys.key('ground-metallic-0')];
    expect(new Set(during).size).toBe(1);
  });

  it('gives the next gesture on the same control a different key', () => {
    const keys = createGestureKeys();
    keys.begin('ground-metallic-0');
    const first = keys.key('ground-metallic-0');
    keys.begin('ground-metallic-0');
    expect(keys.key('ground-metallic-0')).not.toBe(first);
  });

  it('gives each fresh key press its own gesture and folds an auto-repeat', () => {
    // The panels call `begin` for a key press only when it is not a repeat, so
    // holding an arrow key is one gesture and five taps are five.
    const keys = createGestureKeys();
    keys.begin('lighting-shadows-darkness');
    const held = keys.key('lighting-shadows-darkness');
    expect(keys.key('lighting-shadows-darkness')).toBe(held);
    keys.begin('lighting-shadows-darkness');
    expect(keys.key('lighting-shadows-darkness')).not.toBe(held);
  });

  it('keeps two controls apart', () => {
    const keys = createGestureKeys();
    keys.begin('ground-metallic-0');
    keys.begin('ground-metallic-1');
    expect(keys.key('ground-metallic-0')).not.toBe(keys.key('ground-metallic-1'));
  });

  it('names the control, so a key says what it belongs to', () => {
    const keys = createGestureKeys();
    keys.begin('lighting-sun-intensity');
    expect(keys.key('lighting-sun-intensity')).toContain('lighting-sun-intensity');
  });

  it('answers for a control nothing has been done to yet', () => {
    const keys = createGestureKeys();
    expect(keys.key('never-touched')).toBe('never-touched#0');
  });
});
