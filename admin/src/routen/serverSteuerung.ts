/**
 * GET/POST /api/server — restart, stop or start the game service
 * (`wov-server`) on demand, independent of the test-world swap in
 * `/api/testwelt`.
 *
 * ── Mike's finding this fixes ────────────────────────────────────────
 * `/api/testwelt` toggles two things at once: the world SAVE file (moved
 * beside itself) and the game service (stopped, swapped, started). Once a
 * test world is running, the editor's "Karte live testen" button locks up
 * (`liveKnopf.disabled = aktiv` in editorMain.ts) and there was no other
 * way to just restart the service — a second, unrelated change (e.g. a
 * server.yml edit) had no button to apply it with. This route is the
 * missing "just restart/stop/start `wov-server`" primitive, with none of
 * the file-swap logic: the test-world markers (`<instanz>.db.zst.beiseite`)
 * are never read or written here, so an active test world stays exactly as
 * it was through any of the three actions.
 *
 * ── Why not widen `POST /dienst` ─────────────────────────────────────
 * That route already restarts/stops/starts a service, but takes the
 * service NAME from the caller (checked only against a positive list) and
 * is not reachable from the browser (the nginx/vite vorschalter forwards
 * only `/api/`). This route is the `/api/`-reachable, single-purpose
 * sibling: no service name travels in the body, only the action.
 *
 * ── Locking ───────────────────────────────────────────────────────────
 * The lock is now shared with `/api/testwelt` and `/api/welt-zuruecksetzen`
 * (`serverSperre.ts`, 2026-09-29 nachbessern): a second POST here while any
 * of the three is still running gets 409, not just a second POST to THIS
 * route (that was the gap the attack review found under B2 — a testwelt
 * swap and a plain restart could interleave their `systemctl` calls).
 * Token, origin and Content-Type checks all happen in main.ts before this
 * module is ever reached (see the header comment there). A `systemctl`
 * call that times out (main.ts, `SYSTEMCTL_ZEITLIMIT_MS`) throws and is
 * classified to 504 by the same catch-all in main.ts — this module only
 * has to make sure the lock is freed either way, which the `finally` below
 * already does.
 */
import { sperreFreigeben, sperreVersuchen } from './serverSperre.js';

export type ServerAktion = 'neustart' | 'stoppen' | 'starten';

export interface ServerSteuerungUmgebung {
  instanz: string;
  zustand(): Promise<{ aktiv: boolean; seit: string | null; roh?: string }>;
  neustart(): Promise<void>;
  stoppen(): Promise<void>;
  starten(): Promise<void>;
}

/** Same shape as `Antwort` in admin/src/main.ts. */
export type ServerSteuerungAntwort = { code: number; daten: unknown };

export async function serverStatusLesen(umg: ServerSteuerungUmgebung): Promise<ServerSteuerungAntwort> {
  return { code: 200, daten: { dienst: 'wov-server', zustand: await umg.zustand(), instanz: umg.instanz } };
}

export async function serverAktionBehandeln(leib: unknown, umg: ServerSteuerungUmgebung): Promise<ServerSteuerungAntwort> {
  const { aktion } = (leib ?? {}) as { aktion?: unknown };
  if (aktion !== 'neustart' && aktion !== 'stoppen' && aktion !== 'starten') {
    return { code: 400, daten: { fehler: 'aktion muss "neustart", "stoppen" oder "starten" sein' } };
  }
  if (!sperreVersuchen()) {
    return {
      code: 409,
      daten: { fehler: 'aktion-laeuft', message: 'Eine andere Serveraktion läuft bereits — bitte warten.' },
    };
  }
  try {
    if (aktion === 'neustart') await umg.neustart();
    else if (aktion === 'stoppen') await umg.stoppen();
    else await umg.starten();
  } finally {
    sperreFreigeben();
  }
  return { code: 200, daten: { dienst: 'wov-server', aktion, zustand: await umg.zustand() } };
}
