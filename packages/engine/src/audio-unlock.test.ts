import { describe, expect, it } from 'vitest';
import {
  initialAudioUnlockState,
  needsUserGesture,
  nextAudioUnlockState,
  summarizeAudioStatus,
} from './audio-unlock.js';
import type { AudioUnlockEvent, AudioUnlockState } from './audio-unlock.js';

/** Feeds a sequence of events through the machine. */
function run(...events: readonly AudioUnlockEvent[]): AudioUnlockState {
  return events.reduce(nextAudioUnlockState, initialAudioUnlockState);
}

const suspended: AudioUnlockEvent = { type: 'engine', state: 'suspended' };
const running: AudioUnlockEvent = { type: 'engine', state: 'running' };
const gesture: AudioUnlockEvent = { type: 'gesture' };

describe('the autoplay state machine', () => {
  it('starts knowing nothing', () => {
    expect(initialAudioUnlockState).toEqual({ status: 'starting', gestured: false });
  });

  it('calls a suspended engine blocked before the page has been touched', () => {
    expect(run(suspended)).toEqual({ status: 'blocked', gestured: false });
    expect(needsUserGesture(run(suspended))).toBe(true);
  });

  it('calls the same suspended engine interrupted once a gesture has happened', () => {
    // The whole reason this machine has memory. The audio context reads
    // `suspended` in both cases; only the gesture tells them apart, and telling
    // them apart is the difference between "click anywhere" and a prompt that
    // does nothing when clicked.
    const after = run(suspended, gesture, running, suspended);
    expect(after).toEqual({ status: 'interrupted', gestured: true });
    expect(needsUserGesture(after)).toBe(false);
  });

  it('does not report sound on the click — only when the engine says it is running', () => {
    // `resumeAsync()` inside a gesture handler can still fail. A client that
    // said "sound: on" here would be lying about something audible.
    expect(run(suspended, gesture)).toEqual({ status: 'blocked', gestured: true });
    expect(run(suspended, gesture, running).status).toBe('unlocked');
  });

  it('records a gesture even before the engine has said anything', () => {
    expect(run(gesture)).toEqual({ status: 'starting', gestured: true });
    expect(run(gesture, suspended).status).toBe('interrupted');
  });

  it('is idempotent for a repeated gesture', () => {
    expect(run(gesture, gesture, gesture)).toEqual(run(gesture));
    // Identity, not merely equality: the engine's change listeners are only
    // notified when something moved.
    const once = run(gesture);
    expect(nextAudioUnlockState(once, gesture)).toBe(once);
  });

  it('goes back to unlocked when an interruption ends', () => {
    expect(run(suspended, gesture, running, suspended, running).status).toBe('unlocked');
  });

  it('treats unavailable as terminal, whatever a later poll claims', () => {
    const dead = run(suspended, { type: 'unavailable' });
    expect(dead.status).toBe('unavailable');
    expect(run(suspended, { type: 'unavailable' }, running).status).toBe('unavailable');
    expect(needsUserGesture(dead)).toBe(false);
  });

  it('treats a disposed handle as terminal too', () => {
    expect(run(running, { type: 'disposed' }).status).toBe('closed');
    expect(run(running, { type: 'disposed' }, running).status).toBe('closed');
  });

  it('remembers the gesture through a disposal, because the document has not changed', () => {
    expect(run(gesture, { type: 'disposed' }).gestured).toBe(true);
  });

  it('passes a closed engine through as closed', () => {
    expect(run(running, { type: 'engine', state: 'closed' }).status).toBe('closed');
  });
});

describe('summarizeAudioStatus', () => {
  it('gives every status a line, and asks for a click on exactly one of them', () => {
    const lines = new Map(
      (['starting', 'blocked', 'unlocked', 'interrupted', 'unavailable', 'closed'] as const).map(
        (status) => [status, summarizeAudioStatus({ status, gestured: false })],
      ),
    );
    expect(lines.get('blocked')).toBe('sound: click to enable');
    expect(lines.get('unlocked')).toBe('sound: on');
    expect(lines.get('unavailable')).toBe('sound: unavailable');
    // Six statuses, six distinct lines: a status that reads like another one is
    // a status nobody can act on.
    expect(new Set(lines.values()).size).toBe(6);
    for (const line of lines.values()) {
      expect(line.startsWith('sound: ')).toBe(true);
    }
  });
});
