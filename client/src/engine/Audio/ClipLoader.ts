/**
 * Load-once-warn-once wrapper: a failed load (404, decode error, …)
 * must not throw out of playAsync() and must not produce an unhandled
 * promise rejection, and a clip that keeps failing must not spam the
 * console on every replay (karte B2 N1, Befund B2). Pulled out of
 * AudioEngine.loadClip so the failure path is testable without a real
 * AudioContext.
 */
export async function loadWithWarnOnce<T>(
  key: string,
  load: () => Promise<T>,
  warned: Set<string>,
  onFail: (key: string, err: unknown) => void,
): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (!warned.has(key)) {
      warned.add(key);
      onFail(key, err);
    }
    return null;
  }
}
