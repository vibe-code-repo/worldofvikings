/**
 * PATCH /api/worldlayout/ops: change single objects of the world document.
 *
 * ── Why a route of its own ───────────────────────────────────────────
 * POST /api/worldlayout replaces the whole document, so two people editing
 * two different objects collide (409 on the whole document). Here the body is
 * a `Vorgang` (shared/src/worldlayout/ops.ts): ops on single objects, each
 * carrying what the writer saw. The service applies them to the state on disk
 * NOW; only objects that really changed underneath the writer conflict.
 *
 * ── How it writes ────────────────────────────────────────────────────
 * Read the current file (one read, document and hash from the same bytes),
 * apply the Vorgang, write through `layoutSchreibenAsync` with the hash just
 * read as the base. That is the one write path of the world file: lock,
 * backup, sanitizer, atomic rename. If someone else saved in between, the
 * base check fails and the whole thing runs again on the new state: read,
 * apply, write. Several tries, not one, because a busy second writer can win
 * more than once; when the tries run out, nothing is written and the answer
 * is 503.
 *
 * Requests of this process are queued per file. Not for correctness (the base
 * check alone gives that), but so that many ops arriving together do not fight
 * each other into retries.
 *
 * Answers: 200 { ok, hash } · 404 file missing · 409 { fehler: 'konflikt',
 * ids, aktuell } · 422 invalid Vorgang or limit exceeded · 503 locked or the
 * file kept changing. Token and origin are checked before this code is reached,
 * exactly as for /api/worldlayout.
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  LayoutGesperrt,
  LayoutUngueltig,
  LayoutVeraltet,
  layoutLesenMitHash,
  layoutSchreibenAsync,
} from '@wov/shared/src/worldlayout/layoutDatei.js';
import { eintraegeVon, wende, type OpCollection, type OpEntry } from '@wov/shared/src/worldlayout/ops.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

/** Same shape as `Antwort` in admin/src/main.ts. */
export type OpsAntwort = { code: number; daten: unknown; kopf?: Record<string, string> };

/** How often one Vorgang is read, applied and written again after losing against a concurrent writer. */
export const OPS_VERSUCHE = 5;

export interface OpsOptionen {
  maxVersuche?: number;
  /** Test hook: runs between reading the file and writing, the window a concurrent writer wins in. */
  nachLesen?: (versuch: number) => void | Promise<void>;
}

type Konfliktstelle = { sammlung: OpCollection; id: string; eintrag: OpEntry | null };

export type OpsErgebnis =
  | { art: 'ok'; hash: string; sicherung: string | null; layout: WorldLayout; versuche: number }
  | { art: 'konflikt'; ids: string[]; aktuell: string; stellen: Konfliktstelle[] }
  | { art: 'grenze'; sammlung: OpCollection; anzahl: number; grenze: number; message: string }
  | { art: 'ungueltig'; message: string }
  | { art: 'wettlauf'; versuche: number };

async function anwendenSofort(pfad: string, eingabe: unknown, optionen: OpsOptionen): Promise<OpsErgebnis> {
  const max = optionen.maxVersuche ?? OPS_VERSUCHE;
  for (let versuch = 1; versuch <= max; versuch++) {
    // A file that cannot be read throws LayoutUngueltig; that is not the Vorgang's fault and stays a throw.
    const stand = layoutLesenMitHash(pfad);
    const r = wende(stand.layout, eingabe);
    if (!r.ok) {
      if (r.art === 'konflikt') {
        return {
          art: 'konflikt',
          ids: r.ids,
          aktuell: stand.hash,
          stellen: r.stellen.map((s) => ({
            ...s,
            eintrag: eintraegeVon(stand.layout, s.sammlung).find((e) => e.id === s.id) ?? null,
          })),
        };
      }
      if (r.art === 'grenze') return { art: 'grenze', sammlung: r.sammlung, anzahl: r.anzahl, grenze: r.grenze, message: r.message };
      return { art: 'ungueltig', message: r.message };
    }
    await optionen.nachLesen?.(versuch);
    try {
      const geschrieben = await layoutSchreibenAsync(pfad, r.layout, undefined, { basis: stand.hash });
      return { art: 'ok', hash: geschrieben.hash, sicherung: geschrieben.sicherung, layout: geschrieben.layout, versuche: versuch };
    } catch (fehler) {
      if (fehler instanceof LayoutVeraltet) continue;
      // `LayoutGesperrt` goes up (503); everything else the write path refuses is a document problem.
      if (fehler instanceof LayoutUngueltig) return { art: 'ungueltig', message: fehler.message };
      throw fehler;
    }
  }
  return { art: 'wettlauf', versuche: max };
}

const warteschlange = new Map<string, Promise<void>>();

/** Apply one Vorgang to the world file. Queued per file within this process. */
export function opsAnwenden(pfad: string, eingabe: unknown, optionen: OpsOptionen = {}): Promise<OpsErgebnis> {
  const davor = warteschlange.get(pfad) ?? Promise.resolve();
  const lauf = davor.then(() => anwendenSofort(pfad, eingabe, optionen));
  const ende = lauf.then(
    () => undefined,
    () => undefined
  );
  warteschlange.set(pfad, ende);
  void ende.then(() => {
    if (warteschlange.get(pfad) === ende) warteschlange.delete(pfad);
  });
  return lauf;
}

/** The route itself: `body` is the parsed JSON body of the PATCH. */
export async function weltOpsBehandeln(body: unknown, umgebung: { datei: string; instanz: string }): Promise<OpsAntwort> {
  const name = basename(umgebung.datei);
  if (!existsSync(umgebung.datei)) {
    const fehlt = `${name} fehlt (Instanz ${umgebung.instanz}) — WOV_INSTANZ und server/data/welten/ pruefen.`;
    return { code: 404, daten: { ok: false, fehler: fehlt, message: fehlt } };
  }
  const vorgangId = typeof (body as { vorgangId?: unknown } | null)?.vorgangId === 'string' ? (body as { vorgangId: string }).vorgangId : '?';
  let r: OpsErgebnis;
  try {
    r = await opsAnwenden(umgebung.datei, body);
  } catch (fehler) {
    if (fehler instanceof LayoutGesperrt) {
      console.warn(`[Admin] PATCH /api/worldlayout/ops -> 503: ${fehler.message}`);
      return { code: 503, kopf: { 'Retry-After': '3' }, daten: { ok: false, fehler: 'gesperrt', message: fehler.message } };
    }
    throw fehler;
  }
  switch (r.art) {
    case 'ok':
      return {
        code: 200,
        kopf: { ETag: `"${r.hash}"` },
        daten: {
          ok: true,
          message: `Vorgang ${vorgangId} in ${name}: ${r.layout.regions.length} Region(en), ${r.layout.placements?.length ?? 0} Platzierung(en)`,
          instanz: umgebung.instanz,
          vorgangId,
          hash: r.hash,
          sicherung: r.sicherung ? basename(r.sicherung) : null,
          versuche: r.versuche,
        },
      };
    case 'konflikt': {
      const meldung = `Änderung an ${r.ids.join(', ')} passt nicht mehr zum Stand auf dem Server — nichts geschrieben.`;
      console.warn(`[Admin] PATCH /api/worldlayout/ops -> 409 konflikt (${r.ids.join(', ')})`);
      return {
        code: 409,
        kopf: { ETag: `"${r.aktuell}"` },
        daten: { ok: false, fehler: 'konflikt', ids: r.ids, aktuell: r.aktuell, eintraege: r.stellen, message: meldung },
      };
    }
    case 'grenze':
      console.warn(`[Admin] PATCH /api/worldlayout/ops -> 422 grenze: ${r.message}`);
      return {
        code: 422,
        daten: {
          ok: false,
          // The editor already understands this name from POST /api/worldlayout.
          fehler: r.sammlung === 'placements' ? 'zu-viele-platzierungen' : 'grenze',
          sammlung: r.sammlung,
          anzahl: r.anzahl,
          grenze: r.grenze,
          message: r.message,
        },
      };
    case 'ungueltig':
      console.warn(`[Admin] PATCH /api/worldlayout/ops -> 422 ungueltig: ${r.message}`);
      return { code: 422, daten: { ok: false, fehler: 'ungueltig', message: r.message } };
    case 'wettlauf': {
      const meldung = `Die Weltdatei hat sich ${r.versuche}-mal während des Anwendens geändert — nichts geschrieben, bitte erneut senden.`;
      console.warn(`[Admin] PATCH /api/worldlayout/ops -> 503 wettlauf: ${meldung}`);
      return { code: 503, kopf: { 'Retry-After': '1' }, daten: { ok: false, fehler: 'wettlauf', message: meldung } };
    }
  }
}
