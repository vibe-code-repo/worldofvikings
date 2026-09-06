import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, resolveEditorConfig } from './config.js';

describe('resolveEditorConfig', () => {
  it('needs no environment at all, so a clean clone starts', () => {
    const config = resolveEditorConfig();

    expect(config.apiUrl).toBe(DEFAULT_API_URL);
    expect(config.assets.baseUrl).toMatch(/^http/);
  });

  it('reads the API and asset hosts from the environment', () => {
    const config = resolveEditorConfig({
      VITE_API_URL: 'https://api.example.test',
      VITE_ASSET_URL: 'https://assets.example.test',
    });

    expect(config.apiUrl).toBe('https://api.example.test');
    expect(config.assets.baseUrl).toBe('https://assets.example.test');
  });

  it('drops a trailing slash so paths are joined exactly once', () => {
    expect(resolveEditorConfig({ VITE_API_URL: 'http://localhost:3000/' }).apiUrl).toBe(
      'http://localhost:3000',
    );
  });

  it('refuses a relative URL instead of failing on every later request', () => {
    expect(() => resolveEditorConfig({ VITE_API_URL: '/api' })).toThrow(/VITE_API_URL/);
  });

  it('treats a blank value as unset', () => {
    expect(resolveEditorConfig({ VITE_API_URL: '   ' }).apiUrl).toBe(DEFAULT_API_URL);
  });
});
