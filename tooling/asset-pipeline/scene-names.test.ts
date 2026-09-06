import { describe, expect, it } from 'vitest';
import { matchStoreId, sceneNameCandidates } from './scene-names.js';

const store = new Set([
  'tree-1a3',
  'sm-prop-barrel-01',
  'sm-env-rock-02',
  'grass-short-clump-1',
  'pine-1b1-1',
]);

describe('sceneNameCandidates', () => {
  it('offers the literal name first', () => {
    expect(sceneNameCandidates('Tree_1A3')[0]).toBe('tree-1a3');
  });

  it('strips a parenthesised duplicate number', () => {
    expect(sceneNameCandidates('Tree_1A3 (2)')).toContain('tree-1a3');
  });

  it('strips a trailing duplicate count', () => {
    expect(sceneNameCandidates('SM_Prop_Barrel_01 3')).toContain('sm-prop-barrel-01');
  });

  it('strips a level-of-detail suffix', () => {
    expect(sceneNameCandidates('SM_Env_Rock_02_LOD0')).toContain('sm-env-rock-02');
    expect(sceneNameCandidates('SM_Env_Rock_02 lod 2')).toContain('sm-env-rock-02');
  });

  it('finds a model name embedded in a renamed instance', () => {
    expect(sceneNameCandidates('Wall wooden SM_Prop_Barrel_01')).toContain('sm-prop-barrel-01');
  });

  it('never repeats a candidate', () => {
    const candidates = sceneNameCandidates('Tree_1A3');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('offers nothing for a name that kebabs to nothing', () => {
    expect(sceneNameCandidates('   ')).toEqual([]);
  });
});

describe('matchStoreId', () => {
  it('prefers the literal reading over a rewritten one', () => {
    // `Pine_1B1 1` is a model of its own in the store, not a duplicate of
    // `pine-1b1` — the literal candidate has to win, or every numbered variant
    // collapses onto its base name.
    expect(matchStoreId('Pine_1B1 1', store)).toBe('pine-1b1-1');
  });

  it('falls back to the rewritten reading when the literal one is unknown', () => {
    expect(matchStoreId('Tree_1A3 (7)', store)).toBe('tree-1a3');
  });

  it('returns undefined for a node the store does not hold', () => {
    expect(matchStoreId('Directional Light', store)).toBeUndefined();
    expect(matchStoreId('PlayerSpawn', store)).toBeUndefined();
  });
});
