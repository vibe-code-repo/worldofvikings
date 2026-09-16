/**
 * Zugriff auf die Forum-API des Spielservers — serverseitig.
 *
 * ── Warum serverseitig und nicht im Browser ──────────────────────────
 * Zwei Gruende, beide wichtig: Erstens sollen Themenseiten als fertiges
 * HTML bei Suchmaschinen ankommen (das ist der ganze Sinn des SSR-Dienstes),
 * zweitens ist der Weg im Container kurz — der Spielserver laeuft auf
 * 127.0.0.1:2467, ein Umweg ueber den oeffentlichen Proxy waere eine
 * ueberfluessige Runde durchs Netz.
 *
 * ── Warum ein `Ergebnis` und kein `null` ─────────────────────────────
 * „Brett gibt es nicht" (404) und „Spielserver antwortet nicht" (Netzfehler)
 * sind VERSCHIEDENE Faelle: Der erste ist eine echte 404, der zweite eine
 * Seite, die lesbar bleiben und es sagen soll. Ein blosses `null` wuerde
 * beide gleich behandeln — entweder wirft die Seite 500, wenn der
 * Spielserver hustet, oder sie tut bei einem Tippfehler so, als sei alles
 * in Ordnung.
 *
 * Server-side access to the game server's forum API, with a result that
 * keeps "not found" and "game server down" apart.
 */

import type { ReactionCount } from '@wov/shared';

const GAME_API = process.env.WOV_GAME_API ?? 'http://127.0.0.1:2467';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface BoardRow {
  slug: string;
  threadCount: number;
  postCount: number;
  lastActivity: number | null;
}

export interface ThreadRow {
  id: number;
  board: string;
  title: string;
  authorName: string;
  authorCharacterId: number | null;
  createdAt: number;
  lastPostAt: number;
  postCount: number;
  pinned: boolean;
  locked: boolean;
}

export interface PostRow {
  id: number;
  threadId: number;
  authorName: string;
  authorCharacterId: number | null;
  bodyMd: string;
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
  reactions: readonly ReactionCount[];
}

export interface ThreadPage {
  threads: ThreadRow[];
  page: number;
  pageCount: number;
}

export interface ThreadViewDaten {
  thread: ThreadRow;
  posts: PostRow[];
  page: number;
  pageCount: number;
}

export type Ergebnis<T> = { ok: true; data: T } | { ok: false; status: number };

async function hole<T>(fetch: Fetcher, pfad: string): Promise<Ergebnis<T>> {
  try {
    const res = await fetch(`${GAME_API}${pfad}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    // Netzfehler: status 0 — kein HTTP-Code, und genau so wird er behandelt.
    return { ok: false, status: 0 };
  }
}

export async function ladeBretter(fetch: Fetcher): Promise<Ergebnis<{ boards: BoardRow[] }>> {
  const r = await hole<{ boards?: unknown }>(fetch, '/forum/boards');
  if (!r.ok) return r;
  return {
    ok: true,
    data: { boards: Array.isArray(r.data.boards) ? (r.data.boards as BoardRow[]) : [] },
  };
}

export async function ladeThemenSeite(
  fetch: Fetcher,
  brett: string,
  seite: number,
): Promise<Ergebnis<ThreadPage>> {
  const r = await hole<{ threads?: unknown; page?: unknown; pageCount?: unknown }>(
    fetch,
    `/forum/boards/${encodeURIComponent(brett)}/threads?page=${seite}`,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      threads: Array.isArray(r.data.threads) ? (r.data.threads as ThreadRow[]) : [],
      page: zahlOder(r.data.page, 1),
      pageCount: zahlOder(r.data.pageCount, 1),
    },
  };
}

export async function ladeThemaSeite(
  fetch: Fetcher,
  id: number,
  seite: number,
): Promise<Ergebnis<ThreadViewDaten>> {
  const r = await hole<{ thread?: unknown; posts?: unknown; page?: unknown; pageCount?: unknown }>(
    fetch,
    `/forum/threads/${id}?page=${seite}`,
  );
  if (!r.ok) return r;
  // Ein fehlendes Thema ist ein Vertragsbruch, kein „nicht gefunden" — wie
  // ein Netzfehler behandelt, damit die Seite lesbar bleibt statt 500.
  const thread = r.data.thread as ThreadRow | undefined;
  if (!thread || typeof thread !== 'object') return { ok: false, status: 0 };
  return {
    ok: true,
    data: {
      thread,
      posts: Array.isArray(r.data.posts) ? (r.data.posts as PostRow[]) : [],
      page: zahlOder(r.data.page, 1),
      pageCount: zahlOder(r.data.pageCount, 1),
    },
  };
}

/** Ein Suchtreffer, wie die Suchseite ihn braucht. */
export interface SuchTreffer {
  postId: number;
  threadId: number;
  board: string;
  title: string;
  authorName: string;
  createdAt: number;
  snippet: string;
}

export async function ladeSuche(
  fetch: Fetcher,
  q: string,
  seite: number,
): Promise<Ergebnis<{ results: SuchTreffer[]; page: number; pageCount: number; total: number }>> {
  const r = await hole<{ results?: unknown; page?: unknown; pageCount?: unknown; total?: unknown }>(
    fetch,
    `/forum/search?q=${encodeURIComponent(q)}&page=${seite}`,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      results: Array.isArray(r.data.results) ? (r.data.results as SuchTreffer[]) : [],
      page: zahlOder(r.data.page, 1),
      pageCount: zahlOder(r.data.pageCount, 1),
      total: zahlOder(r.data.total, 0),
    },
  };
}

/** Zahl oder Vorgabe — schuetzt die Seite vor einer Ueberraschung an der Grenze. */
function zahlOder(v: unknown, vorgabe: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : vorgabe;
}

/** `?page=` als ganze Zahl >= 1; Muell wird zu 1. */
export function seiteAus(url: URL): number {
  const roh = Number(url.searchParams.get('page') ?? '1');
  return Number.isFinite(roh) && roh >= 1 ? Math.floor(roh) : 1;
}
