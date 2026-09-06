import { describe, expect, it } from 'vitest';

import { swallowsKeystrokes, type FocusedElement } from './keyboard.js';

function input(inputType: string): FocusedElement {
  return { tagName: 'INPUT', inputType, contentEditable: false };
}

describe('swallowsKeystrokes', () => {
  it('leaves the keystroke to a text field', () => {
    for (const type of ['text', 'number', 'search', 'email', 'password', 'date']) {
      expect(swallowsKeystrokes(input(type))).toBe(true);
    }
    expect(swallowsKeystrokes({ tagName: 'TEXTAREA', contentEditable: false })).toBe(true);
    expect(swallowsKeystrokes({ tagName: 'SELECT', contentEditable: false })).toBe(true);
  });

  it('leaves the keystroke to a content-editable element', () => {
    expect(swallowsKeystrokes({ tagName: 'DIV', contentEditable: true })).toBe(true);
  });

  it('lets a shortcut through a checkbox — Ctrl+Z after ticking one is an undo', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'color', 'file']) {
      expect(swallowsKeystrokes(input(type))).toBe(false);
    }
  });

  it('treats an input type it does not know as a text field', () => {
    expect(swallowsKeystrokes(input('quantum'))).toBe(true);
    expect(swallowsKeystrokes({ tagName: 'INPUT', contentEditable: false })).toBe(true);
  });

  it('says no for a button, a canvas and no element at all', () => {
    expect(swallowsKeystrokes({ tagName: 'BUTTON', contentEditable: false })).toBe(false);
    expect(swallowsKeystrokes({ tagName: 'CANVAS', contentEditable: false })).toBe(false);
    expect(swallowsKeystrokes(null)).toBe(false);
  });
});
