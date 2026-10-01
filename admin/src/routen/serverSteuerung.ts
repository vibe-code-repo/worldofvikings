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
  /** Connected players, or `null` when unknown (no fresh metrics file). Optional: older callers omit it. */
  spieler?(): number | null;
}

/** A snapshot older than this no longer says who is connected (the server writes one per second). */
export const METRIK_ALTER_MAX_MS = 15_000;

/**
 * Connected players from the game server's metrics snapshot (`peers`,
 * `shared/src/metrik.ts`; no change to the game server needed). `null` when the
 * file is missing, unreadable, malformed or stale: a number from a stopped
 * server would be a false statement in the restart dialog.
 */
export function spielerAusMetriken(roh: string | null, jetztMs: number): number | null {
  if (roh === null) return null;
  try {
    const m = JSON.parse(roh) as { zeitMs?: unknown; peers?: unknown };
    if (typeof m.zeitMs !== 'number' || typeof m.peers !== 'number') return null;
    if (!Number.isInteger(m.peers) || m.peers < 0) return null;
    if (jetztMs - m.zeitMs > METRIK_ALTER_MAX_MS || m.zeitMs - jetztMs > METRIK_ALTER_MAX_MS) return null;
    return m.peers;
  } catch {
    return null;
  }
}

/** Same shape as `Antwort` in admin/src/main.ts. */
export type ServerSteuerungAntwort = { code: number; daten: unknown };

export async function serverStatusLesen(umg: ServerSteuerungUmgebung): Promise<ServerSteuerungAntwort> {
  const zustand = await umg.zustand();
  // `spieler` only while the service runs: the snapshot of a stopped server is stale or missing anyway.
  const spieler = zustand.aktiv ? (umg.spieler?.() ?? null) : null;
  return { code: 200, daten: { dienst: 'wov-server', zustand, instanz: umg.instanz, spieler } };
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
