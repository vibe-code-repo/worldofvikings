import { describe, expect, it } from 'vitest';
import { createDocument } from './document.js';
import { clearSelection, setActiveZone, setSelection, toggleSelection } from './selection.js';
import { entity, villageWorld, world, zone } from './test-support.js';

const document = createDocument(villageWorld());

describe('setSelection', () => {
  it('keeps order, drops duplicates and drops ids that are not in the active zone', () => {
    const selected = setSelection(document, [
      'barrel_003',
      'barrel_001',
      'barrel_003',
      'ghost_001',
    ]);
    expect(selected.selection).toEqual(['barrel_003', 'barrel_001']);
  });

  it('is view state, not a world change: it never makes the document dirty', () => {
    expect(setSelection(document, ['barrel_001']).dirty).toBe(false);
  });

  it('selects nothing while no zone is active', () => {
    const withoutZone = { ...document, activeZoneId: null };
    expect(setSelection(withoutZone, ['barrel_001']).selection).toEqual([]);
  });
});

describe('toggleSelection', () => {
  it('adds an unselected entity and removes a selected one', () => {
    const one = toggleSelection(document, 'barrel_001');
    expect(one.selection).toEqual(['barrel_001']);
    const two = toggleSelection(one, 'barrel_002');
    expect(two.selection).toEqual(['barrel_001', 'barrel_002']);
    expect(toggleSelection(two, 'barrel_001').selection).toEqual(['barrel_002']);
  });

  it('ignores an entity that is not in the active zone', () => {
    expect(toggleSelection(document, 'ghost_001').selection).toEqual([]);
  });
});

describe('clearSelection', () => {
  it('empties the selection', () => {
    expect(clearSelection(setSelection(document, ['barrel_001'])).selection).toEqual([]);
  });
});

describe('setActiveZone', () => {
  const twoZones = createDocument(
    world([zone('village', [entity('barrel_001')]), zone('forest', [entity('pine_001')])]),
  );

  it('switches zone and clears the selection, which belonged to the old zone', () => {
    const selected = setSelection(twoZones, ['barrel_001']);
    const switched = setActiveZone(selected, 'forest');
    expect(switched.activeZoneId).toBe('forest');
    expect(switched.selection).toEqual([]);
  });

  it('ignores a zone that does not exist', () => {
    expect(setActiveZone(twoZones, 'nowhere').activeZoneId).toBe('village');
  });

  it('accepts null for "no zone"', () => {
    expect(setActiveZone(twoZones, null).activeZoneId).toBe(null);
  });
});
