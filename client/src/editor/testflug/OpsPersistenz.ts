/**
 * Second implementation of `TestflugPersistenz`: every Vorgang goes to the
 * operations service as `PATCH /api/worldlayout/ops` and the answer is shown.
 *
 *  - 200: applied (the running world has it).
 *  - 202: only written to the world file; `grund` says why it does not act
 *         yet (`server-aus`, `geo`, `abgelehnt`). The local draft stays written.
 *  - 409: one or more objects are no longer as the flight saw them; nothing
 *         was written. The local draft is put back and the `ids` are named.
 *  - anything else (422, 503, network): nothing was written, draft put back.
 *
 * The draft itself is still kept by the store underneath (the same working
 * copy the map editor edits); this class adds the remote side. Not wired into
 * the game yet (stage K5.4).
 *
 * Zweite Umsetzung der Testflug-Persistenz: jeder Vorgang geht als
 * `PATCH /api/worldlayout/ops` an den Betriebsdienst, die Antwort wird gezeigt
 * (200 angewendet, 202 nur geschrieben mit Grund, 409 je Objekt). Den Entwurf
 * hält weiter der darunterliegende Speicher.
 */
import type { Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import { mitVorgaengen } from './TestflugPersistenz';
import type { TestflugPersistenz, VorgangAntwort } from './TestflugPersistenz';

export const OPS_URL = '/api/worldlayout/ops';

const alsText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The remote side: one PATCH per Vorgang, the answer mapped to `VorgangAntwort`. Never throws. */
export function opsSender(fetchFn: typeof fetch = fetch, url: string = OPS_URL): (vorgang: Vorgang) => Promise<VorgangAntwort> {
  return async (vorgang) => {
    let antwort: Response;
    try {
      antwort = await fetchFn(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vorgang),
      });
    } catch (fehler) {
      return { art: 'fehler', message: `Senden fehlgeschlagen: ${String(fehler)}`, zurueckgenommen: false };
    }
    let d: Record<string, unknown> = {};
    try {
      const roh: unknown = JSON.parse(await antwort.text());
      if (typeof roh === 'object' && roh !== null) d = roh as Record<string, unknown>;
    } catch {
      // No JSON: decided by the status alone.
    }
    const message = alsText(d.message) ?? '';
    if (antwort.status === 409) {
      const ids = Array.isArray(d.ids) ? d.ids.filter((i): i is string => typeof i === 'string') : [];
      const ausStellen = Array.isArray(d.eintraege)
        ? d.eintraege.flatMap((e) => (typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string' ? [(e as { id: string }).id] : []))
        : [];
      // A 409 that names nobody still names the Vorgang's own objects: that is what did not stand.
      const genannt = ids.length > 0 ? ids : ausStellen.length > 0 ? ausStellen : [...new Set(vorgang.ops.map((o) => o.id))];
      return { art: 'konflikt', ids: genannt, message, zurueckgenommen: false };
    }
    if (antwort.status === 202) {
      return { art: 'nur-geschrieben', grund: alsText(d.grund) ?? 'unbekannt', message };
    }
    if (antwort.status === 200 && d.ok !== false) {
      return { art: 'angewendet', message: message === '' ? 'Angewendet' : message };
    }
    return { art: 'fehler', message: message || alsText(d.fehler) || `HTTP ${antwort.status}`, zurueckgenommen: false };
  };
}

/** The draft store `inner` plus the remote side: every Vorgang is sent as PATCH, in order. */
export function opsPersistenz(
  inner: Pick<TestflugPersistenz, 'laden' | 'rohtext' | 'aendern' | 'speichern'>,
  optionen: { fetchFn?: typeof fetch; url?: string } = {}
): TestflugPersistenz {
  return mitVorgaengen(inner, opsSender(optionen.fetchFn, optionen.url));
}
