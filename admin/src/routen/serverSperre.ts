/**
 * One shared process lock for every route that touches the game service or
 * the world save: `/api/server`, `/api/testwelt` (all actions) and
 * `/api/welt-zuruecksetzen`. Each of the three used to guard only itself
 * (`let laeuft` local to its own module) — a double click within the SAME
 * route was caught, but a second route triggered from another tab, another
 * user, or by the same person a moment later was not: `/api/testwelt
 * starten` and `/api/server stoppen` could run their `systemctl` calls
 * interleaved (2026-09-29 attack review, B2). This module is the one lock
 * all three now go through, so only one of them ever runs at a time.
 */
let sperreLaeuft = false;

/** Take the lock. `false` means someone else already holds it — caller answers 409. */
export function sperreVersuchen(): boolean {
  if (sperreLaeuft) return false;
  sperreLaeuft = true;
  return true;
}

/** Release the lock. Always call this from a `finally`, even on the way out through an exception. */
export function sperreFreigeben(): void {
  sperreLaeuft = false;
}

/** For `/status` and the like: is anything holding the lock right now? */
export function sperreAktiv(): boolean {
  return sperreLaeuft;
}
