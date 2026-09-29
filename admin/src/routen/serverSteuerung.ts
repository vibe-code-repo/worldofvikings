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
 * One action at a time in this process (`laeuft` below), same pattern as
 * `routen/weltZuruecksetzen.ts`: a second POST while `systemctl restart`
 * is still running must not stack a second systemctl call — it gets 409
 * instead. Token, origin and Content-Type checks all happen in main.ts
 * before this module is ever reached (see the header comment there).
 */

export type ServerAktion = 'neustart' | 'stoppen' | 'starten';

export interface ServerSteuerungUmgebung {
  instanz: string;
  zustand(): Promise<{ aktiv: boolean; seit: string | null }>;
  neustart(): Promise<void>;
  stoppen(): Promise<void>;
  starten(): Promise<void>;
}

/** Same shape as `Antwort` in admin/src/main.ts. */
export type ServerSteuerungAntwort = { code: number; daten: unknown };

/** One action at a time in this process — not per instance: this process runs exactly one instance anyway (see WOV_INSTANZ). */
let laeuft = false;

export async function serverStatusLesen(umg: ServerSteuerungUmgebung): Promise<ServerSteuerungAntwort> {
  return { code: 200, daten: { dienst: 'wov-server', zustand: await umg.zustand(), instanz: umg.instanz } };
}

export async function serverAktionBehandeln(leib: unknown, umg: ServerSteuerungUmgebung): Promise<ServerSteuerungAntwort> {
  const { aktion } = (leib ?? {}) as { aktion?: unknown };
  if (aktion !== 'neustart' && aktion !== 'stoppen' && aktion !== 'starten') {
    return { code: 400, daten: { fehler: 'aktion muss "neustart", "stoppen" oder "starten" sein' } };
  }
  if (laeuft) {
    return {
      code: 409,
      daten: { fehler: 'aktion-laeuft', message: 'Eine Server-Aktion läuft bereits — bitte warten.' },
    };
  }
  laeuft = true;
  try {
    if (aktion === 'neustart') await umg.neustart();
    else if (aktion === 'stoppen') await umg.stoppen();
    else await umg.starten();
  } finally {
    laeuft = false;
  }
  return { code: 200, daten: { dienst: 'wov-server', aktion, zustand: await umg.zustand() } };
}
