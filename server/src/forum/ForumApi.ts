/**
 * Das Thing — die lesende HTTP-API am Spielport (2467).
 *
 * ── Warum am Spielport und nicht am Betriebsdienst ───────────────────
 * Dieselbe Begruendung wie in `KontoApi.ts`: Port 2467 traegt den
 * vorhandenen Proxy-Weg (`/api/accounts/` → 2467, mit `auth_basic off`
 * und ohne Host-Tor). Die Forum-Wege liegen daneben unter `/api/forum/`
 * und werden von nginx genauso dorthin gereicht. Ein eigener Port haette
 * einen zweiten Proxy-Block, ein zweites Zertifikat und wieder eine
 * Host-Weiche gebraucht.
 *
 * ── Nur Lesen in dieser Ausbaustufe ──────────────────────────────────
 * Diese Datei liefert Bretter, Themenlisten und Beitraege — oeffentlich,
 * ohne Token, weil das Forum gelesen werden soll, auch bevor jemand ein
 * Konto hat. Schreiben (Thema, Antwort, Bearbeiten, Melden) kommt in der
 * naechsten Stufe und braucht dann ein Kontotoken; die Verifikation dafuer
 * liegt bereits in `KontoApi.kontoIdAus()`.
 *
 * The Thing's read API on the game port. Public, unauthenticated reads;
 * writes arrive in the next stage and will use the account token.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FORUM_PAGE_SIZE,
  type ThreadPage,
  type ThreadView,
} from '@wov/shared';
import { ForumDatabase } from './ForumDatabase.js';

/** Origins allowed to call this API from a browser (same set as KontoApi). */
const ERLAUBTE_URSPRUENGE = new Set([
  'https://world-of-vikings.com',
  'https://www.world-of-vikings.com',
]);

const PRAEFIX = '/forum';

export class ForumApi {
  constructor(private readonly db: ForumDatabase) {}

  /**
   * A request handler in the shape `WebSocketAcceptor` expects: returns
   * true when the path is ours, false so the caller can fall back to its
   * old 426 behaviour.
   */
  behandle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    const pfad = url.pathname.replace(/\/+$/, '') || '/';
    if (pfad !== PRAEFIX && !pfad.startsWith(`${PRAEFIX}/`)) return false;

    const ursprung = req.headers.origin;
    if (ursprung && ERLAUBTE_URSPRUENGE.has(ursprung)) {
      res.setHeader('Access-Control-Allow-Origin', ursprung);
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-wov-account');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }

    try {
      if (req.method === 'GET' && pfad === `${PRAEFIX}/boards`) {
        return void this.boards(res), true;
      }
      const themen = new RegExp(`^${PRAEFIX}/boards/([a-z_]+)/threads$`).exec(pfad);
      if (req.method === 'GET' && themen) {
        return void this.boardThreads(res, themen[1]!, seiteAus(url)), true;
      }
      const thema = new RegExp(`^${PRAEFIX}/threads/(\\d+)$`).exec(pfad);
      if (req.method === 'GET' && thema) {
        return void this.thread(res, Number(thema[1]), seiteAus(url)), true;
      }
      this.json(res, 404, { error: 'unknown-endpoint' });
      return true;
    } catch (e) {
      console.error('[Forum] unerwarteter Fehler:', e);
      this.json(res, 500, { error: 'server-error' });
      return true;
    }
  }

  // ── Endpunkte ───────────────────────────────────────────────────────

  private boards(res: ServerResponse): void {
    this.json(res, 200, { boards: this.db.boardList() });
  }

  private boardThreads(res: ServerResponse, slug: string, page: number): void {
    const brett = this.db.boardBySlug(slug);
    if (!brett) return this.json(res, 404, { error: 'unknown-board' });
    const gesamt = this.db.countThreads(brett.slug);
    const { page: p, pageCount, offset } = blaettern(gesamt, page);
    const threads = this.db.listThreads(brett.slug, FORUM_PAGE_SIZE, offset);
    const antwort: ThreadPage = { threads, page: p, pageCount };
    this.json(res, 200, antwort);
  }

  private thread(res: ServerResponse, id: number, page: number): void {
    const thread = this.db.threadById(id);
    if (!thread) return this.json(res, 404, { error: 'unknown-thread' });
    const gesamt = this.db.countPosts(id);
    const { page: p, pageCount, offset } = blaettern(gesamt, page);
    const posts = this.db.listPosts(id, FORUM_PAGE_SIZE, offset);
    const antwort: ThreadView = { thread, posts, page: p, pageCount };
    this.json(res, 200, antwort);
  }

  // ── Plumbing ────────────────────────────────────────────────────────

  private json(res: ServerResponse, status: number, koerper: unknown): void {
    const text = JSON.stringify(koerper);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
  }
}

/** `page` aus der URL, auf >= 1 gebracht; Muell wird zu 1. */
function seiteAus(url: URL): number {
  const roh = Number(url.searchParams.get('page') ?? '1');
  return Number.isFinite(roh) && roh >= 1 ? Math.floor(roh) : 1;
}

/**
 * Seite, Seitenzahl und Versatz aus einer Gesamtzahl. `page` wird auf den
 * gueltigen Bereich geklemmt — eine Seite hinter dem Ende liefert eine
 * leere Liste und nicht „unbekannt", damit ein Link mit alter Seitenzahl
 * nicht in einen 404 laeuft.
 */
function blaettern(gesamt: number, page: number): { page: number; pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(gesamt / FORUM_PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pageCount);
  return { page: p, pageCount, offset: (p - 1) * FORUM_PAGE_SIZE };
}
