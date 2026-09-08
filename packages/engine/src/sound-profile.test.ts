import { describe, expect, it } from 'vitest';
import {
  bankForSurface,
  defaultSoundProfile,
  resolveSoundProfile,
  soundProfileClips,
  surfaceOfLayer,
} from './sound-profile.js';

describe('resolveSoundProfile', () => {
  it('resolves nothing at all to silence, not to a stand-in bed', () => {
    const profile = resolveSoundProfile();
    expect(profile).toEqual(defaultSoundProfile);
    expect(profile.ambience.clip).toBeNull();
    expect(profile.emitters).toEqual([]);
  });

  it('lets a zone override the world group by group', () => {
    const profile = resolveSoundProfile(
      { master: { volume: 0.8 }, ambience: { clip: 'audio/a.ogg', volume: 0.4 } },
      { ambience: { volume: 0.1 } },
    );
    expect(profile.master.volume).toBe(0.8);
    // The zone changed the volume and inherited the clip — field by field.
    expect(profile.ambience.clip).toBe('audio/a.ogg');
    expect(profile.ambience.volume).toBe(0.1);
  });

  it('lets a zone replace the emitter list rather than adding to it', () => {
    const profile = resolveSoundProfile(
      { emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg' }] },
      { emitters: [{ id: 'drip', position: [1, 2, 3], clip: 'audio/drip.ogg' }] },
    );
    expect(profile.emitters.map((emitter) => emitter.id)).toEqual(['drip']);
  });

  it('lets a zone say "no emitters at all" with an empty list', () => {
    const profile = resolveSoundProfile(
      { emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg' }] },
      { emitters: [] },
    );
    expect(profile.emitters).toEqual([]);
  });

  it('fills an emitter’s falloff from the Web Audio defaults', () => {
    const [emitter] = resolveSoundProfile({
      emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg' }],
    }).emitters;
    expect(emitter?.distanceModel).toBe('inverse');
    expect(emitter?.minDistance).toBe(1);
    expect(emitter?.rolloffFactor).toBe(1);
    expect(emitter?.panning).toBe('equalpower');
  });

  it('keeps the falloff a world file states', () => {
    const [emitter] = resolveSoundProfile({
      emitters: [
        {
          id: 'forge',
          entity: 'village-e0788',
          clip: 'audio/forge.ogg',
          minDistance: 3,
          rolloff: 1.2,
        },
      ],
    }).emitters;
    expect(emitter?.minDistance).toBe(3);
    expect(emitter?.rolloffFactor).toBe(1.2);
  });

  it('loops a placed sound unless it has an interval', () => {
    const profile = resolveSoundProfile({
      emitters: [
        { id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg' },
        { id: 'crow', position: [0, 0, 0], clip: 'audio/crow.ogg', intervalSeconds: [18, 55] },
      ],
    });
    expect(profile.emitters[0]?.loop).toBe(true);
    expect(profile.emitters[1]?.loop).toBe(false);
    expect(profile.emitters[1]?.intervalSeconds).toEqual([18, 55]);
  });

  it('puts the emitter’s own clip in front of its variants', () => {
    const [emitter] = resolveSoundProfile({
      emitters: [
        {
          id: 'crow',
          position: [0, 0, 0],
          clip: 'audio/crow-01.ogg',
          variants: ['audio/crow-02.ogg'],
        },
      ],
    }).emitters;
    expect(emitter?.clips).toEqual(['audio/crow-01.ogg', 'audio/crow-02.ogg']);
  });

  it('refuses a negative volume instead of playing it as silence', () => {
    expect(() => resolveSoundProfile({ master: { volume: -1 } })).toThrow(/master.volume/);
  });

  it('refuses a stride of zero, which would be a footstep every frame', () => {
    expect(() => resolveSoundProfile({ footsteps: { strideWalk: 0 } })).toThrow(
      /footsteps.strideWalk/,
    );
  });

  it('refuses a bank with no clips', () => {
    expect(() =>
      resolveSoundProfile({ footsteps: { banks: [{ surface: 'gravel', clips: [] }] } }),
    ).toThrow(/no clips/);
  });
});

describe('bankForSurface', () => {
  const footsteps = resolveSoundProfile({
    footsteps: {
      defaultSurface: 'gravel',
      banks: [
        { surface: 'gravel', clips: ['audio/g.ogg'] },
        { surface: 'grass', clips: ['audio/s.ogg'] },
      ],
    },
  }).footsteps;

  it('finds the bank for a surface', () => {
    expect(bankForSurface(footsteps, 'grass')?.surface).toBe('grass');
  });

  it('falls back to the default surface for a bank nobody wrote', () => {
    expect(bankForSurface(footsteps, 'lava')?.surface).toBe('gravel');
  });

  it('answers nothing when even the default has no bank', () => {
    const empty = resolveSoundProfile({ footsteps: { defaultSurface: 'sand' } }).footsteps;
    expect(bankForSurface(empty, 'sand')).toBeUndefined();
  });
});

describe('surfaceOfLayer', () => {
  const footsteps = resolveSoundProfile({
    footsteps: { layerSurfaces: ['gravel', 'gravel', 'grass'], defaultSurface: 'gravel' },
  }).footsteps;

  it('maps a layer index onto the surface the author gave it', () => {
    expect(surfaceOfLayer(footsteps, 2)).toBe('grass');
  });

  it('falls back rather than throwing when the array is shorter than the terrain', () => {
    expect(surfaceOfLayer(footsteps, 5)).toBe('gravel');
  });
});

describe('soundProfileClips', () => {
  it('lists every path once, so a shared clip is downloaded once', () => {
    const profile = resolveSoundProfile({
      ambience: { clip: 'audio/bed.ogg' },
      emitters: [
        { id: 'a', prefab: 'brazier', clip: 'audio/fire.ogg' },
        { id: 'b', prefab: 'candle', clip: 'audio/fire.ogg' },
      ],
      footsteps: { banks: [{ surface: 'gravel', clips: ['audio/g1.ogg', 'audio/g2.ogg'] }] },
    });
    expect(soundProfileClips(profile)).toEqual([
      'audio/bed.ogg',
      'audio/fire.ogg',
      'audio/g1.ogg',
      'audio/g2.ogg',
    ]);
  });
});
