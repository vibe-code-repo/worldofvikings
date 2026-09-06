import { describe, expect, it } from 'vitest';
import { resolveImportPath } from './import-paths.js';

const IMPORT_DIR = '/srv/bundles';

describe('resolveImportPath', () => {
  it('accepts a bundle inside the configured directory', () => {
    expect(resolveImportPath(IMPORT_DIR, 'village/Village1.glb')).toEqual({
      ok: true,
      path: '/srv/bundles/village/Village1.glb',
    });
  });

  /**
   * The action does not exist on a service nobody configured for it. That is
   * what makes it safe to leave in a deployed API: there is no default
   * directory to be talked into reading.
   */
  it('refuses everything when no directory is configured', () => {
    const result = resolveImportPath(undefined, 'Village1.glb');
    expect(result).toMatchObject({ ok: false, reason: 'not-configured' });
  });

  it('refuses a path that climbs out of the directory', () => {
    for (const attempt of [
      '../secrets.glb',
      'village/../../secrets.glb',
      './../../etc/passwd.glb',
    ]) {
      const result = resolveImportPath(IMPORT_DIR, attempt);
      expect(result, attempt).toMatchObject({ ok: false, reason: 'rejected' });
    }
  });

  /** `join('/srv/bundles', '/etc/passwd')` is inside; `resolve` is not. */
  it('refuses an absolute path instead of joining it', () => {
    expect(resolveImportPath(IMPORT_DIR, '/etc/passwd.glb')).toMatchObject({
      ok: false,
      reason: 'rejected',
    });
    expect(resolveImportPath(IMPORT_DIR, 'C:\\windows\\x.glb')).toMatchObject({ ok: false });
  });

  it('refuses the directory itself', () => {
    expect(resolveImportPath(IMPORT_DIR, '.')).toMatchObject({ ok: false });
    expect(resolveImportPath(IMPORT_DIR, '')).toMatchObject({ ok: false });
  });

  it('refuses anything that is not a scene bundle', () => {
    expect(resolveImportPath(IMPORT_DIR, 'village/notes.txt')).toMatchObject({
      ok: false,
      reason: 'rejected',
    });
    expect(resolveImportPath(IMPORT_DIR, 'village/Village1.GLB')).toMatchObject({ ok: true });
  });

  it('refuses a null byte, whatever the rest of the name says', () => {
    expect(resolveImportPath(IMPORT_DIR, 'village\0/x.glb')).toMatchObject({ ok: false });
  });
});
