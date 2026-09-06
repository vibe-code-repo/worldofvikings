import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_URL,
  DEFAULT_WORLD_ID,
  FLAT_LIGHTING,
  lightingProfiles,
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

describe('lightingProfiles', () => {
  const authored = [{ sun: { intensity: 3 } }];

  it('hands the world its own profile when the query asks for nothing', () => {
    expect(lightingProfiles('', authored)).toEqual(authored);
    expect(lightingProfiles('?world=village1&spawn=1,2', authored)).toEqual(authored);
  });

  it('replaces the world profile entirely for ?flat=1', () => {
    expect(lightingProfiles('?flat=1', authored)).toEqual([FLAT_LIGHTING]);
  });

  it('keeps the world profile and only turns the shadow map off for ?shadows=off', () => {
    const profiles = lightingProfiles('?shadows=off', authored);
    // The control a shadow measurement needs: same sun, same grade, no shadows.
    expect(profiles[0]).toBe(authored[0]);
    expect(profiles.at(-1)).toEqual({ shadows: { enabled: false } });
  });

  it('ignores a typo instead of half-applying it', () => {
    // A screenshot taken with `?flat=true` would silently be the lit one and be
    // reported as the flat one.
    expect(lightingProfiles('?flat=true', authored)).toEqual(authored);
    expect(lightingProfiles('?flat=0', authored)).toEqual(authored);
    expect(lightingProfiles('?flat', authored)).toEqual(authored);
    expect(lightingProfiles('?shadows=0', authored)).toEqual(authored);
  });
});

describe('FLAT_LIGHTING', () => {
  it('turns off everything the profile added, and still lights the scene', () => {
    expect(FLAT_LIGHTING.shadows?.enabled).toBe(false);
    expect(FLAT_LIGHTING.postProcessing?.enabled).toBe(false);
    expect(FLAT_LIGHTING.sky?.enabled).toBe(false);
    expect(FLAT_LIGHTING.fog?.enabled).toBe(false);
    // Not a black void: the comparison is against the flat noon the client had
    // before there was a profile, not against nothing.
    expect(FLAT_LIGHTING.sun?.intensity).toBeGreaterThan(0);
    expect(FLAT_LIGHTING.ambient?.intensity).toBeGreaterThan(0);
  });
});
