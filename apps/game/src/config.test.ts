import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_URL,
  DEFAULT_WORLD_ID,
  resolveGameConfig,
  worldIdFromQuery,
} from './config.js';

describe('resolveGameConfig', () => {
  it('falls back to the local services when nothing is configured', () => {
    expect(resolveGameConfig().apiUrl).toBe(DEFAULT_API_URL);
  });

  it('takes a configured API URL without its trailing slash', () => {
    expect(resolveGameConfig({ VITE_API_URL: 'https://api.example.com/' }).apiUrl).toBe(
      'https://api.example.com',
    );
  });

  it('refuses a relative API URL instead of requesting one later', () => {
    expect(() => resolveGameConfig({ VITE_API_URL: '/api' })).toThrow(/VITE_API_URL/);
  });
});

describe('worldIdFromQuery', () => {
  it('opens the default world when the address bar names none', () => {
    expect(worldIdFromQuery('')).toBe(DEFAULT_WORLD_ID);
    expect(worldIdFromQuery('?spawn=1,2')).toBe(DEFAULT_WORLD_ID);
  });

  it('takes an id the world schema would accept', () => {
    expect(worldIdFromQuery('?world=harbour-2')).toBe('harbour-2');
  });

  it('refuses anything the schema would not, rather than sending it on', () => {
    // The query string is user input: a path segment must never reach the API.
    expect(worldIdFromQuery('?world=../../etc/passwd')).toBe(DEFAULT_WORLD_ID);
    expect(worldIdFromQuery('?world=Village1')).toBe(DEFAULT_WORLD_ID);
    expect(worldIdFromQuery('?world=')).toBe(DEFAULT_WORLD_ID);
  });
});
