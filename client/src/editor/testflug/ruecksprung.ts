/**
 * The way back from the offline flight to the 2D map.
 *
 * The flight opens in its own browser tab (`window.open`), the editor keeps
 * running in the first one. Both share the origin, so `localStorage` is the
 * channel: the flight writes the last position under one key, the editor
 * hears the `storage` event (it fires in the OTHER tabs only) and centres the
 * map there. Nothing is read at editor start — a stale value from an earlier
 * flight must never move the map on its own.
 *
 * Der Rückweg aus dem Testflug in die 2D-Karte: Der Flug schreibt seine
 * letzte Stelle in den localStorage, der Editor hört das `storage`-Ereignis.
 */

export const RETURN_KEY = 'wov-editor-testflug-rueckkehr';

export interface ReturnPoint {
  x: number;
  z: number;
  yaw: number;
  /** Write time (ms since epoch) — makes every write a value change, so the event always fires. */
  at: number;
}

export function encodeReturn(p: ReturnPoint): string {
  return JSON.stringify({ x: p.x, z: p.z, yaw: p.yaw, at: p.at });
}

/** Parse a stored value; null unless it is an object with four finite numbers. */
export function decodeReturn(raw: string | null | undefined): ReturnPoint | null {
  if (!raw) return null;
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

/** Flight side: leave the position for the editor. False when storage refuses (private mode, quota). */
export function sendReturn(storage: Pick<Storage, 'setItem'>, p: ReturnPoint): boolean {
  try {
    storage.setItem(RETURN_KEY, encodeReturn(p));
    return true;
  } catch {
    return false;
  }
}

/** Flight side in the browser: the same, on this tab's `localStorage`. */
export function sendReturnFromBrowser(p: ReturnPoint): boolean {
  try {
    return sendReturn(globalThis.localStorage, p);
  } catch {
    return false;
  }
}

interface StorageLike {
  addEventListener(type: 'storage', listener: (e: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (e: StorageEvent) => void): void;
}

/** Editor side: call `bei` for every return written by a flight. Returns the remover. */
export function onReturn(target: StorageLike, bei: (p: ReturnPoint) => void): () => void {
  const listener = (e: StorageEvent): void => {
    if (e.key !== RETURN_KEY) return;
    const p = decodeReturn(e.newValue);
    if (p) bei(p);
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
