/**
 * Schreiben ins Thing — die Client-Seite.
 *
 * Der Browser schickt den Schreibweg an `/api/forum/…` (derselbe Ursprung,
 * nginx reicht ihn an den Spielserver weiter) und legt das Kontotoken in
 * den Kopf `x-wov-account` — genau wie `account.ts` es fuer die Konten-API
 * tut. Kein CSRF-Fall, weil nichts automatisch mitgeschickt wird.
 *
 * Fehler kommen als `ForumFehler` mit einem Code aus der API; die
 * Oberflaeche uebersetzt ihn ueber `fehlerSchluessel` in einen Satz.
 *
 * Client side of writing. Posts go to `/api/forum/…` on the same origin,
 * carrying the account token in `x-wov-account`.
 */
import { me, readToken, signedInShore } from './account';
import type { MessageKey } from './i18n';

const BASIS = '/api/forum';

export class ForumFehler extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'ForumFehler';
  }
}

const FEHLER_SCHLUESSEL: Record<string, MessageKey> = {
  'not-signed-in': 'thing.write.error.not-signed-in',
  'character-invalid': 'thing.write.error.character-invalid',
  'title-invalid': 'thing.write.error.title-invalid',
  'body-invalid': 'thing.write.error.body-invalid',
  'too-fast': 'thing.write.error.too-fast',
  locked: 'thing.write.error.locked',
  net: 'thing.write.error.net',
};

/** Uebersetzt einen Fehler in einen Katalogsatz; Unbekanntes wird „Netz". */
export function fehlerSchluessel(fehler: unknown): MessageKey {
  if (fehler instanceof ForumFehler) {
    return FEHLER_SCHLUESSEL[fehler.code] ?? 'thing.write.error.net';
  }
  return 'thing.write.error.net';
}

async function sende<T>(pfad: string, method: string, koerper?: unknown): Promise<T> {
  const shore = signedInShore();
  const token = shore ? readToken(shore) : null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-wov-account'] = token;

  let res: Response;
  try {
    res = await fetch(BASIS + pfad, {
      method,
      headers,
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
    });
  } catch {
    throw new ForumFehler(0, 'net');
  }

  const daten = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new ForumFehler(res.status, typeof daten.error === 'string' ? daten.error : 'net');
  }
  return daten as T;
}

export function neuesThema(
  brett: string,
  daten: { title: string; body: string; characterId: number },
): Promise<{ threadId: number; postId: number }> {
  return sende(`/boards/${encodeURIComponent(brett)}/threads`, 'POST', daten);
}

export function neueAntwort(
  threadId: number,
  daten: { body: string; characterId: number },
): Promise<{ postId: number }> {
  return sende(`/threads/${threadId}/posts`, 'POST', daten);
}

export function bearbeiteBeitrag(
  postId: number,
  daten: { body: string; characterId: number },
): Promise<{ ok: true }> {
  return sende(`/posts/${postId}`, 'PATCH', daten);
}

export function loescheBeitrag(postId: number): Promise<{ ok: true }> {
  return sende(`/posts/${postId}`, 'DELETE');
}

// ── Melden und Moderieren (M5) ────────────────────────────────────────

export function melde(postId: number, reason: string): Promise<{ reportId: number }> {
  return sende(`/posts/${postId}/report`, 'POST', { reason });
}

export function holeModerator(): Promise<{ moderator: boolean }> {
  return sende('/moderator', 'GET');
}

export function threadSchalter(
  threadId: number,
  art: 'pin' | 'lock',
  wert: boolean,
): Promise<{ ok: true }> {
  return sende(`/threads/${threadId}/${art}`, 'POST', { value: wert });
}

/** Eine offene Meldung, wie `GET /forum/reports` sie liefert. */
export interface Meldung {
  id: number;
  postId: number;
  threadId: number;
  board: string;
  threadTitle: string;
  authorName: string;
  bodyMd: string;
  grund: string;
  createdAt: number;
}

export function holeMeldungen(): Promise<{ reports: Meldung[] }> {
  return sende('/reports', 'GET');
}

export function erledigeMeldung(id: number): Promise<{ ok: true }> {
  return sende(`/reports/${id}/resolve`, 'POST');
}

/** Charaktere des angemeldeten Kontos — einmal je Sitzung geladen, dann gemerkt. */
export interface EigenesKonto {
  angemeldet: boolean;
  charaktere: Array<{ id: number; name: string }>;
}

let kontoVersprechen: Promise<EigenesKonto> | null = null;

export function eigenesKonto(): Promise<EigenesKonto> {
  if (!kontoVersprechen) {
    const shore = signedInShore();
    const token = shore ? readToken(shore) : null;
    kontoVersprechen = !shore || !token
      ? Promise.resolve({ angemeldet: false, charaktere: [] })
      : me(shore, token)
          .then((m) => ({
            angemeldet: true,
            charaktere: m.characters.map((c) => ({ id: c.id, name: c.name })),
          }))
          .catch(() => ({ angemeldet: false, charaktere: [] }));
  }
  return kontoVersprechen;
}
