/**
 * The way back from the offline flight to the 2D map.
 *
 * The flight opens in its own browser tab (`window.open`), the editor keeps
 * running in the first one. Both share the origin, so a `BroadcastChannel` is
 * the wire: the flight posts the last position, the editor tab hears it and
 * centres the map there. A channel keeps nothing — with no editor listening
 * (a flight tab of its own, a private window) nothing is written anywhere,
 * and a stale position from an earlier flight can never move the map on its
 * own. Every message carries its write time (`at`): with two flights open the
 * editor keeps the newest and drops an older one that arrives late.
 *
 * Der Rückweg aus dem Testflug in die 2D-Karte: Der Flug schickt seine letzte
 * Stelle über einen BroadcastChannel, der Editor hört mit. Kein Speicher, kein
 * Rest: ohne Editor bleibt nichts liegen.
 */

export const RETURN_CHANNEL = 'wov-editor-testflug-rueckkehr';

export interface ReturnPoint {
  x: number;
  z: number;
  yaw: number;
  /** Write time (ms since epoch) — the editor keeps the newest of several flights. */
  at: number;
}

export function encodeReturn(p: ReturnPoint): string {
  return JSON.stringify({ x: p.x, z: p.z, yaw: p.yaw, at: p.at });
}

/** Parse a message; null unless it is an object with four finite numbers. */
export function decodeReturn(raw: unknown): ReturnPoint | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { x, z, yaw, at } = o;
  if (
    typeof x !== 'number' ||
    typeof z !== 'number' ||
    typeof yaw !== 'number' ||
    typeof at !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(yaw) ||
    !Number.isFinite(at)
  ) {
    return null;
  }
  return { x, z, yaw, at };
}

/** The part of `BroadcastChannel` used here (a fake stands in for it in the test). */
export interface ReturnChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  close(): void;
}

/** A channel on the browser's `BroadcastChannel`, or null where there is none. */
export function openReturnChannel(): ReturnChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(RETURN_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Flight side: tell the editor tabs the last position. False when no channel
 * can be opened. The channel is closed again at once; a message already posted
 * is still delivered.
 */
export function sendReturn(open: () => ReturnChannel | null, p: ReturnPoint): boolean {
  let channel: ReturnChannel | null = null;
  try {
    channel = open();
    if (!channel) return false;
    channel.postMessage(encodeReturn(p));
    return true;
  } catch {
    return false;
  } finally {
    try {
      channel?.close();
    } catch {
      /* nothing to close */
    }
  }
}

/** Flight side in the browser. */
export function sendReturnFromBrowser(p: ReturnPoint): boolean {
  return sendReturn(openReturnChannel, p);
}

/**
 * A return older than the newest handled one by less than this is a late
 * arrival from another flight and dropped; older by more, the system clock
 * went back and the return counts as new (else the map would ignore every
 * return until the editor is reloaded).
 */
export const LATE_MS = 60_000;

/**
 * Editor side: call `bei` for every return a flight sends, but not for one
 * that another flight wrote earlier and that arrives after a newer one.
 * Returns the remover (which also closes the channel).
 */
export function onReturn(channel: ReturnChannel | null, bei: (p: ReturnPoint) => void): () => void {
  if (!channel) return () => undefined;
  let newest = -Infinity;
  const listener = (e: { data: unknown }): void => {
    const p = decodeReturn(e.data);
    if (!p || (p.at < newest && newest - p.at < LATE_MS)) return;
    newest = p.at;
    bei(p);
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
    channel.close();
  };
}

export type ReturnPlan = 'send' | 'close-only' | 'stay';

/**
 * What Q does. After a refused jump the figure stands in the open sea at the
 * origin — that is no place to show on the map, so nothing is sent; the tab
 * closes itself when it may (the editor opened it), otherwise it stays and says so.
 */
export function planReturn(jumpRefused: boolean, canClose: boolean): ReturnPlan {
  if (!jumpRefused) return 'send';
  return canClose ? 'close-only' : 'stay';
}
