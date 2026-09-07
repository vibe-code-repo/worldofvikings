/**
 * What can be asserted about the audio owner without a browser.
 *
 * Vitest runs in Node, which has no `AudioContext`, so there is no listener to
 * move and no clip to decode here. Two things are still worth proving, and they
 * are the two that would otherwise only fail at runtime:
 *
 * 1. **The module loads.** Every `@babylonjs/core/AudioV2/…` specifier resolves
 *    and the file it names exists. AudioV2 is the newer half of Babylon's audio
 *    API; a specifier that was right in one minor version and moved in the next
 *    is a blank screen, not a compile error, because `tsc` reads `.d.ts` files
 *    that ship next to the code either way.
 * 2. **A browser that will not give audio is reported, not thrown past.** A game
 *    without sound is a game; a game that refuses to start is not.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_BUS_NAMES,
  AudioUnavailableError,
  createAudioEngine,
  engineStateOf,
} from './audio.js';

describe('createAudioEngine where there is no Web Audio', () => {
  it('reports the browser rather than crashing with whatever Babylon threw', async () => {
    // Node is the honest stand-in for a locked-down or ancient browser: no
    // `AudioContext` in the global scope at all.
    await expect(createAudioEngine({ statePollMs: 0 })).rejects.toBeInstanceOf(
      AudioUnavailableError,
    );
  });

  it('keeps the original failure as the cause, so the reason is not lost', async () => {
    const error = await createAudioEngine({ statePollMs: 0 }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AudioUnavailableError);
    expect((error as AudioUnavailableError).cause).toBeDefined();
  });
});

describe('the bus graph', () => {
  it('names the four buses a mixer slider will need', () => {
    // `ui` and `music` are empty today on purpose: adding either later is then
    // an `outBus` argument rather than a re-plumbing.
    expect([...AUDIO_BUS_NAMES]).toEqual(['ambience', 'world', 'ui', 'music']);
  });
});

describe('engineStateOf', () => {
  it('passes the three states that mean something through unchanged', () => {
    expect(engineStateOf({ state: 'running' })).toBe('running');
    expect(engineStateOf({ state: 'interrupted' })).toBe('interrupted');
    expect(engineStateOf({ state: 'closed' })).toBe('closed');
  });

  it('reads anything else as suspended — not making sound, reason unknown', () => {
    // A fifth state added by a browser or a future Babylon must land on a
    // status the app can render, not on one nothing handles.
    expect(engineStateOf({ state: 'suspended' })).toBe('suspended');
    expect(engineStateOf({ state: 'something-new' } as unknown as { state: 'running' })).toBe(
      'suspended',
    );
  });
});
