import { describe, expect, it } from 'vitest';
import { cx } from './index.js';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, undefined, 'b')).toBe('a b');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, null)).toBe('');
  });
});
