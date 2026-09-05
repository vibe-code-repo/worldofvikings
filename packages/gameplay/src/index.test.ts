import { describe, expect, it } from 'vitest';
import { toEntityId } from './index.js';

describe('toEntityId', () => {
  it('passes the raw string through', () => {
    expect(toEntityId('player')).toBe('player');
  });

  it('rejects an empty id', () => {
    expect(() => toEntityId('')).toThrow();
  });
});
