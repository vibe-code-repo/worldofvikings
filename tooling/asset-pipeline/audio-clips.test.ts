import { describe, expect, it } from 'vitest';
import { AssetPathSchema, assetIdFromPath, isAudioAssetPath } from '@wov/asset-system/manifest';
import {
  AUDIO_CLIPS,
  AUDIO_ENCODE_SETTINGS,
  AUDIO_IMPORT_BUDGET_BYTES,
  AUDIO_SAMPLE_RATE,
  audioClipGroup,
  audioClipOrigin,
  ffmpegArgumentsFor,
} from './audio-clips.js';
import type { AudioClipSpec } from './audio-clips.js';

const oneShot: AudioClipSpec = {
  path: 'audio/footsteps/gravel-01.ogg',
  sourceHash: `sha256-${'a'.repeat(64)}`,
  profile: 'one-shot',
};

describe('the clip table', () => {
  it('names every clip itself, and never by where it came from', () => {
    // The rule this whole table exists to keep: a source file name may not
    // enter the repository. A hash cannot carry one.
    for (const clip of AUDIO_CLIPS) {
      expect(clip.sourceHash).toMatch(/^sha256-[0-9a-f]{64}$/);
      expect(clip.path).toMatch(/^audio\/[a-z]+\/[a-z-]+(?:-\d{2})?\.ogg$/);
    }
  });

  it('gives every clip a distinct name and a distinct source', () => {
    expect(new Set(AUDIO_CLIPS.map((clip) => clip.path)).size).toBe(AUDIO_CLIPS.length);
    // Two names for one recording would be one clip played twice under two
    // ids — a shuffle bag that repeats without looking like it repeats.
    expect(new Set(AUDIO_CLIPS.map((clip) => clip.sourceHash)).size).toBe(AUDIO_CLIPS.length);
  });

  it('produces a valid asset path and a valid manifest id for every clip', () => {
    for (const clip of AUDIO_CLIPS) {
      expect(AssetPathSchema.safeParse(clip.path).success).toBe(true);
      expect(assetIdFromPath(clip.path)).toBe(clip.path.replace(/\.ogg$/, ''));
      expect(isAudioAssetPath(clip.path)).toBe(true);
    }
  });

  it('carries the four groups this phase needs and nothing else', () => {
    const counted = new Map<string, number>();
    for (const clip of AUDIO_CLIPS) {
      const group = audioClipGroup(clip.path);
      counted.set(group, (counted.get(group) ?? 0) + 1);
    }
    expect([...counted].sort()).toEqual([
      ['ambience', 2],
      ['animals', 11],
      ['emitters', 3],
      ['footsteps', 28],
    ]);
  });

  it('covers the four village surfaces the footstep banks are for', () => {
    for (const surface of ['gravel', 'grass', 'wood', 'water']) {
      const bank = AUDIO_CLIPS.filter((clip) =>
        clip.path.startsWith(`audio/footsteps/${surface}-`),
      );
      // Fewer than three variants and a walk is audibly one sample repeating.
      expect(bank.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('only cuts a clip whose source is long enough to be worth cutting', () => {
    for (const clip of AUDIO_CLIPS) {
      if (clip.seconds !== undefined) {
        expect(clip.seconds).toBeGreaterThan(0);
        expect(clip.profile).not.toBe('one-shot');
      }
    }
  });

  it('keeps beds in stereo and everything a listener walks past in mono', () => {
    expect(AUDIO_ENCODE_SETTINGS.bed.channels).toBe(2);
    expect(AUDIO_ENCODE_SETTINGS['one-shot'].channels).toBe(1);
    // A spatialised source is panned by the listener; two channels of it are
    // downmixed by WebAudio anyway, so they would be bytes for nothing.
    expect(AUDIO_ENCODE_SETTINGS.loop.channels).toBe(1);
  });

  it('leaves headroom in the budget rather than sitting on it', () => {
    expect(AUDIO_IMPORT_BUDGET_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('ffmpegArgumentsFor', () => {
  it('strips every tag the source carries', () => {
    // A title or artist field is exactly the kind of trace that must not reach
    // the store, and it survives a re-encode unless this is passed.
    expect(ffmpegArgumentsFor(oneShot, 'in.ogg', 'out.ogg')).toContain('-map_metadata');
    const args = ffmpegArgumentsFor(oneShot, 'in.ogg', 'out.ogg');
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1');
  });

  it('drops an embedded cover image instead of muxing it into the Ogg', () => {
    expect(ffmpegArgumentsFor(oneShot, 'in.ogg', 'out.ogg')).toContain('-vn');
  });

  it('encodes a one-shot as mono Opus at 48 kHz', () => {
    const args = ffmpegArgumentsFor(oneShot, 'in.ogg', 'out.ogg');
    expect(args[args.indexOf('-ac') + 1]).toBe('1');
    expect(args[args.indexOf('-ar') + 1]).toBe(String(AUDIO_SAMPLE_RATE));
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args[args.indexOf('-b:a') + 1]).toBe('48k');
  });

  it('encodes a bed in stereo at the higher rate', () => {
    const args = ffmpegArgumentsFor({ ...oneShot, profile: 'bed' }, 'in.ogg', 'out.ogg');
    expect(args[args.indexOf('-ac') + 1]).toBe('2');
    expect(args[args.indexOf('-b:a') + 1]).toBe('64k');
  });

  it('puts the length limit after the input, where it trims instead of seeking', () => {
    // `-t` before `-i` limits how much of the input is read from the seek
    // point; after it, it limits the output. Same flag, different clip.
    const args = ffmpegArgumentsFor({ ...oneShot, profile: 'bed', seconds: 40 }, 'in', 'out');
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-t') + 1]).toBe('40');
  });

  it('passes no length limit at all when the clip keeps its full duration', () => {
    expect(ffmpegArgumentsFor(oneShot, 'in.ogg', 'out.ogg')).not.toContain('-t');
  });

  it('reads the input and writes the output it was given, in that order', () => {
    const args = ffmpegArgumentsFor(oneShot, '/export/a', '/store/b');
    expect(args[args.indexOf('-i') + 1]).toBe('/export/a');
    expect(args.at(-1)).toBe('/store/b');
  });
});

describe('audioClipOrigin', () => {
  it('states acoustic facts and claims nothing about where the sound came from', () => {
    const origin = audioClipOrigin({ profile: 'one-shot', seconds: 0.341_338 });
    expect(origin).toBe(
      '0.34 s, mono, 48 kHz, re-encoded to Opus at 48 kbps (VBR) by pnpm import:audio.',
    );
  });

  it('says stereo for a bed', () => {
    expect(audioClipOrigin({ profile: 'bed', seconds: 40 })).toContain('stereo');
    expect(audioClipOrigin({ profile: 'bed', seconds: 40 })).toContain('64 kbps');
  });
});

describe('audioClipGroup', () => {
  it('is the folder under audio/, which is what the report groups by', () => {
    expect(audioClipGroup('audio/animals/crow-01.ogg')).toBe('animals');
    expect(audioClipGroup('audio/ambience/forest-wind-gusts.ogg')).toBe('ambience');
  });
});
