/**
 * Das Thing — HTTP-API am Spielport (2467): Lesen UND Schreiben.
 *
 * ── Warum am Spielport und nicht am Betriebsdienst ───────────────────
 * Dieselbe Begruendung wie in `KontoApi.ts`: Port 2467 traegt den
 * vorhandenen Proxy-Weg (`/api/accounts/` → 2467) und damit auch
 * `/api/forum/`. Ein eigener Port haette einen zweiten Proxy-Block, ein
 * zweites Zertifikat und wieder eine Host-Weiche gebraucht.
 *
 * ── Lesen oeffentlich, Schreiben mit Kontotoken ──────────────────────
 * Lesen braucht kein Konto — das Forum soll lesbar sein, bevor jemand
 * eines hat (und Suchmaschinen sollen es lesen koennen). Schreiben
 * verlangt das Kontotoken, das `KontoApi` prueft: Der Browser schickt es
 * im Kopf `x-wov-account` (oder `Authorization`), wie bei der Konten-API.
 * Kein CSRF-Fall, weil nichts automatisch mitgeschickt wird.
 *
 * ── Wer schreibt: das Konto, sichtbar der Charakter ──────────────────
 * Der Client nennt eine Charakter-Id; der Server prueft, dass sie DEM
 * Konto gehoert (`charakterAus`), und nimmt den Namen von dort. Ein
 * Client kann sich also weder einen fremden Namen noch einen fremden
 * Charakter aneignen.
 *
 * ── Drossel ──────────────────────────────────────────────────────────
 * Ein einfaches Zeitfenster je Konto und Art (Thread/Beitrag). Die
 * vorhandene `Drossel.ts` ist auf Spielpakete geschluesselt und passt
 * hier nicht; die Regel ist deshalb bewusst klein und lokal.
 *
 * The Thing's HTTP API on the game port: public reads, account-token
 * writes, character-owned authorship, a small per-account throttle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FORUM_PAGE_SIZE,
  POST_BODY_MAX,
  POST_BODY_MIN,
  THREAD_TITLE_MAX,
  THREAD_TITLE_MIN,
  isBoardSlug,
  type ThreadPage,
  type ThreadView,
} from '@wov/shared';
import { ForumDatabase, type ForumAutor } from './ForumDatabase.js';

/** Origins allowed to call this API from a browser (same set as KontoApi). */
const ERLAUBTE_URSPRUENGE = new Set([
  'https://world-of-vikings.com',
  'https://www.world-of-vikings.com',
]);

const PRAEFIX = '/forum';
const MAX_KOERPER_BYTES = 64 * 1024;

/** Drossel: je Konto und Art hoechstens `max` in `fenster` Millisekunden. */
const DROSSEL: Record<'thread' | 'post', { max: number; fenster: number }> = {
  thread: { max: 3, fenster: 5 * 60_000 },
  post: { max: 5, fenster: 30_000 },
};

/** Konto-Id aus der Anfrage, oder null. Wird von KontoApi gestellt. */
export type KontoAus = (req: IncomingMessage) => number | null;
/** Charakter des Kontos, oder null — die Rechtepruefung beim Schreiben. */
export type CharakterAus = (kontoId: number, charakterId: number) => { id: number; name: string } | null;

export class ForumApi {
  /** Zeitstempel je `art:kontoId` fuer die Drossel. */
  private readonly zeiten = new Map<string, number[]>();

  constructor(
    private readonly db: ForumDatabase,
    /**
     * Konto-Id aus dem Token. Vorgabe: niemand ist angemeldet — so bleibt
     * der Dienst in Tests ohne Konten benutzbar, und Schreiben ist dann
     * schlicht gesperrt (401), nicht kaputt.
     */
    private readonly kontoIdAus: KontoAus = () => null,
    private readonly charakterAus: CharakterAus = () => null,
  ) {}

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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }

    void this.leite(req, res, pfad, url).catch((e) => {
      console.error('[Forum] unerwarteter Fehler:', e);
      if (!res.headersSent) this.json(res, 500, { error: 'server-error' });
    });
    return true;
  }

  private async leite(
    req: IncomingMessage,
    res: ServerResponse,
    pfad: string,
    url: URL,
  ): Promise<void> {
    const m = req.method ?? 'GET';

    if (m === 'GET' && pfad === `${PRAEFIX}/boards`) return this.boards(res);

    const themen = /^\/forum\/boards\/([a-z_]+)\/threads$/.exec(pfad);
    if (themen) {
      if (m === 'GET') return this.boardThreads(res, themen[1]!, seiteAus(url));
      if (m === 'POST') return this.neuesThema(req, res, themen[1]!);
    }

    const thema = /^\/forum\/threads\/(\d+)$/.exec(pfad);
    if (m === 'GET' && thema) return this.thread(res, Number(thema[1]), seiteAus(url));

    const antwort = /^\/forum\/threads\/(\d+)\/posts$/.exec(pfad);
    if (m === 'POST' && antwort) return this.neuerBeitrag(req, res, Number(antwort[1]));

    const post = /^\/forum\/posts\/(\d+)$/.exec(pfad);
    if (m === 'PATCH' && post) return this.bearbeiteBeitrag(req, res, Number(post[1]));
    if (m === 'DELETE' && post) return this.loescheBeitrag(req, res, Number(post[1]));

    this.json(res, 404, { error: 'unknown-endpoint' });
  }

  // ── Lesen ───────────────────────────────────────────────────────────

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

  // ── Schreiben ───────────────────────────────────────────────────────

  private async neuesThema(req: IncomingMessage, res: ServerResponse, brett: string): Promise<void> {
    const kontoId = this.kontoIdAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });
    if (!isBoardSlug(brett)) return this.json(res, 404, { error: 'unknown-board' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const autor = this.autorAus(kontoId, k.characterId);
    if (!autor) return this.json(res, 400, { error: 'character-invalid' });

    const titel = String(k.title ?? '').trim();
    const body = String(k.body ?? '').trim();
    if (titel.length < THREAD_TITLE_MIN || titel.length > THREAD_TITLE_MAX) {
      return this.json(res, 400, { error: 'title-invalid' });
    }
    if (body.length < POST_BODY_MIN || body.length > POST_BODY_MAX) {
      return this.json(res, 400, { error: 'body-invalid' });
    }

    // Die Drossel steht NACH den Pruefungen: Ein Tippfehler darf kein
    // Kontingent verbrauchen. Gezaehlt wird, was wirklich geschrieben wird.
    if (!this.erlaubt(kontoId, 'thread')) return this.json(res, 429, { error: 'too-fast' });

    const r = this.db.createThread(brett, titel, autor, body);
    this.json(res, 201, { threadId: r.threadId, postId: r.postId });
  }

  private async neuerBeitrag(req: IncomingMessage, res: ServerResponse, themaId: number): Promise<void> {
    const kontoId = this.kontoIdAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const thema = this.db.threadById(themaId);
    if (!thema) return this.json(res, 404, { error: 'unknown-thread' });
    if (thema.locked) return this.json(res, 409, { error: 'locked' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const autor = this.autorAus(kontoId, k.characterId);
    if (!autor) return this.json(res, 400, { error: 'character-invalid' });

    const body = String(k.body ?? '').trim();
    if (body.length < POST_BODY_MIN || body.length > POST_BODY_MAX) {
      return this.json(res, 400, { error: 'body-invalid' });
    }

    // Erst pruefen, dann drosseln (s. neuesThema).
    if (!this.erlaubt(kontoId, 'post')) return this.json(res, 429, { error: 'too-fast' });

    const postId = this.db.createPost(themaId, autor, body);
    this.json(res, 201, { postId });
  }

  private async bearbeiteBeitrag(req: IncomingMessage, res: ServerResponse, postId: number): Promise<void> {
    const kontoId = this.kontoIdAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const eigen = this.db.postOwnership(postId);
    if (!eigen) return this.json(res, 404, { error: 'unknown-post' });
    if (eigen.authorKontoId !== kontoId) return this.json(res, 403, { error: 'not-yours' });
    if (eigen.deletedAt !== null) return this.json(res, 409, { error: 'deleted' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const autor = this.autorAus(kontoId, k.characterId);
    if (!autor) return this.json(res, 400, { error: 'character-invalid' });

    const body = String(k.body ?? '').trim();
    if (body.length < POST_BODY_MIN || body.length > POST_BODY_MAX) {
      return this.json(res, 400, { error: 'body-invalid' });
    }

    const ok = this.db.editPost(postId, kontoId, body, autor.name);
    this.json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown' });
  }

  private loescheBeitrag(req: IncomingMessage, res: ServerResponse, postId: number): void {
    const kontoId = this.kontoIdAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const eigen = this.db.postOwnership(postId);
    if (!eigen) return this.json(res, 404, { error: 'unknown-post' });
    if (eigen.authorKontoId !== kontoId) return this.json(res, 403, { error: 'not-yours' });

    const ok = this.db.softDeletePost(postId, kontoId);
    this.json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown' });
  }

  // ── Helfer ──────────────────────────────────────────────────────────

  /** Charakter des Kontos aufloesen; null, wenn fremd, fehlend oder unbrauchbar. */
  private autorAus(kontoId: number, roh: unknown): ForumAutor | null {
    const id = Number(roh);
    if (!Number.isInteger(id) || id <= 0) return null;
    const c = this.charakterAus(kontoId, id);
    if (!c) return null;
    return { kontoId, charakterId: c.id, name: c.name };
  }

  /** Zeitfenster-Drossel je Konto und Art. */
  private erlaubt(kontoId: number, art: 'thread' | 'post', now = Date.now()): boolean {
    const { max, fenster } = DROSSEL[art];
    const key = `${art}:${kontoId}`;
    const liste = (this.zeiten.get(key) ?? []).filter((t) => now - t < fenster);
    if (liste.length >= max) {
      this.zeiten.set(key, liste);
      return false;
    }
    liste.push(now);
    this.zeiten.set(key, liste);
    return true;
  }

  /** JSON-Koerper lesen, gedeckelt; null bei zu gross, leer oder Muell. */
  private async koerper(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const teile: Buffer[] = [];
    let groesse = 0;
    for await (const stueck of req) {
      const b = stueck as Buffer;
      groesse += b.length;
      if (groesse > MAX_KOERPER_BYTES) return null;
      teile.push(b);
    }
    if (groesse === 0) return null;
    try {
      return JSON.parse(Buffer.concat(teile).toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private json(res: ServerResponse, status: number, koerper: unknown): void {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(koerper));
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
 * leere Liste und nicht „unbekannt".
 */
function blaettern(gesamt: number, page: number): { page: number; pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(gesamt / FORUM_PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pageCount);
  return { page: p, pageCount, offset: (p - 1) * FORUM_PAGE_SIZE };
}
