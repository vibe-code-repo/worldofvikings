import { describe, expect, it } from 'vitest';
import { parseWorldDefinition } from '@wov/world-schema';
import { createEmptyWorld } from './index.js';

describe('createEmptyWorld', () => {
  it('creates a document that validates against the world schema', () => {
    const result = parseWorldDefinition(createEmptyWorld('draft', 'Draft World'));
    expect(result.ok).toBe(true);
  });
});
