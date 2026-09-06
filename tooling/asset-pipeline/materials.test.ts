import { describe, expect, it } from 'vitest';
import {
  ALPHA_CUTOFF,
  MATERIAL_ROWS,
  METALLIC_FACTOR,
  ROUGHNESS_FACTOR,
  SURFACE_BY_KIND,
  materialKey,
  surfaceFor,
} from './materials.js';

/**
 * The materials the export actually uses — the union of what the scene bundles
 * name and what the models in the store still carry, read off the export once
 * and pinned here as keys (see `materials.ts` for why keys and not names).
 *
 * This list is the point of the test file: the table is only worth having if it
 * is complete for the input it was written for, and an unlisted material is a
 * model that silently renders opaque.
 */
const KEYS_IN_THE_EXPORT = [
  '032aaf736d0a',
  '15b59a7c5177',
  '1bcc8efd1107',
  '1dae02e59b3c',
  '2219565ffa60',
  '28d03e41d8dd',
  '2a1a6355ed7e',
  '3204c1689cce',
  '3d5cfdf87c1b',
  '40e5ccfa665e',
  '43587e2626b3',
  '56d1c819966f',
  '586c7fe760c0',
  '60baf15804ad',
  '614bf44e147d',
  '696cbc98612c',
  '6a6ac8386005',
  '6c95d763e3e7',
  '6fa61097c48b',
  '70fcb7af3ba0',
  '7431a18b7845',
  '7e0df8755082',
  '87d7cbb528de',
  '922ad94ff9c6',
  '95f74a3961dd',
  '9b0540017f8b',
  '9bbaded93ab1',
  '9e70a6314092',
  'a1b5b4a25daa',
  'a23f0d988ea1',
  'a58af24a45c1',
  'a5d51f017740',
  'aa28d60f9197',
  'ae2aff3ee0b7',
  'b2c02ca97471',
  'b2c15737ca31',
  'b950e869e1fe',
  'ba494e629860',
  'c17454510b43',
  'c352383d9bba',
  'c3f7ea8117d8',
  'c41ecbe37729',
  'c608cbe1c4ab',
  'c6a59465fb27',
  'cae3a817bb06',
  'cd2d33391502',
  'd587e23e3064',
  'dc91ba7b27d8',
  'df815f8c3781',
  'dfc7125b7688',
  'e193742147d6',
  'e64becce006f',
  'e69bfc033a92',
  'ea2af043eb8c',
  'ebe5743ecc05',
  'ed4beb4a0f8f',
  'f0a25899c39a',
  'fe57438c34bf',
] as const;

describe('MATERIAL_ROWS', () => {
  it('has an answer for every material in the export', () => {
    const missing = KEYS_IN_THE_EXPORT.filter((key) => !Object.hasOwn(MATERIAL_ROWS, key));
    expect(missing).toEqual([]);
  });

  it('lists nothing beyond the export and the two spellings kept on purpose', () => {
    // Two spellings are listed that the current export does not reach — a maple
    // leaf card and a short plant leaf card without their instance number —
    // because a re-export can drop the number at any time.
    const extra = Object.keys(MATERIAL_ROWS).filter(
      (key) => !(KEYS_IN_THE_EXPORT as readonly string[]).includes(key),
    );
    expect(extra.map((key) => MATERIAL_ROWS[key]?.note).sort()).toEqual([
      'maple leaf card',
      'short plant leaf card',
    ]);
  });

  it('cuts out and double-sides every leaf, grass, glass, cloud and double-sided material', () => {
    for (const kind of ['leaf', 'grass', 'glass', 'cloud', 'double-sided'] as const) {
      expect({ kind, ...SURFACE_BY_KIND[kind] }).toEqual({
        kind,
        alphaMode: 'MASK',
        doubleSided: true,
        emissive: false,
      });
    }
  });

  it('makes the self-lit materials emissive and nothing else', () => {
    const emissive = Object.values(MATERIAL_ROWS)
      .filter((row) => SURFACE_BY_KIND[row.kind].emissive)
      .map((row) => row.note)
      .sort();
    expect(emissive).toEqual(['building atlas, self-lit variant', 'crystal item']);
  });

  it('leaves bark, the atlases and the one-offs opaque and single-sided', () => {
    for (const kind of ['bark', 'atlas', 'other'] as const) {
      expect({ kind, ...SURFACE_BY_KIND[kind] }).toEqual({
        kind,
        alphaMode: 'OPAQUE',
        doubleSided: false,
        emissive: false,
      });
    }
  });

  it('renders an unlisted material opaque rather than guessing from its name', () => {
    expect(Object.hasOwn(MATERIAL_ROWS, materialKey('Leaves Of Some Future Tree'))).toBe(false);
    expect(surfaceFor('Leaves Of Some Future Tree').alphaMode).toBe('OPAQUE');
  });

  it('keys a name to twelve stable hex characters', () => {
    expect(materialKey('Leaves Of Some Future Tree')).toMatch(/^[0-9a-f]{12}$/);
    expect(materialKey('a')).toBe(materialKey('a'));
    expect(materialKey('a')).not.toBe(materialKey('b'));
  });

  it('keeps the factors that stop a physically-based renderer drawing metal', () => {
    expect(METALLIC_FACTOR).toBe(0);
    expect(ROUGHNESS_FACTOR).toBe(1);
    expect(ALPHA_CUTOFF).toBe(0.5);
  });
});
