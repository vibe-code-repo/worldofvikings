/**
 * Das Thing — die Forendatenbank.
 *
 * ── Eigene Datei je Gestade, getrennt von den Konten ─────────────────
 * `konten.db` traegt Konten, Charaktere und Banns; die Forendaten liegen
 * daneben in `forum.db` (je Gestade eine, wie Welt und Konten). Getrennt,
 * weil beide unabhaengig wachsen: Ein Forum kann neu aufgebaut werden,
 * ohne dass ein Passwort in Gefahr geraet, und ein Konten-Backup muss
 * nicht die Beitragshistorie mitschleppen. Ein Fremdschluessel ueber
 * zwei Dateien gibt es in SQLite nicht — der Autor steht deshalb als
 * KOPIE im Beitrag: `author_name` (fuer die Anzeige, rename-fest genug,
 * weil Charaktere heute nicht umbenannt werden) und `author_character_id`
 * (fuer den Avatar, der spaeter live dazukommt). Faellt ein Konto weg,
 * bleibt der Text stehen — das ist gewollt, oeffentlicher Text ist keine
 * Kaskade wert.
 *
 * ── Warum `node:sqlite` und deutsche Kommentare, aber englische Namen ─
 * Dieselbe Datenbank wie `Kontendatenbank.ts`: `node:sqlite` faehrt in
 * Node 22 ohne Native-Build mit (nur eine Experimentalwarnung). Die
 * Bezeichner sind englisch (Projektregel fuer neuen Quelltext), die
 * Begruendungen deutsch wie im umgebenden Bestand.
 *
 * ── Was die Zahlen auf den Brettern bedeuten ─────────────────────────
 * `post_count`/`last_post_at` werden beim Schreiben mitgefuehrt, nicht
 * bei jeder Abfrage gezaehlt. Gelöschte Beitraege (`deleted_at`) zaehlen
 * fuer den Thread nicht mit, bleiben aber als Platzhalter stehen, damit
 * die Antworten darunter ihren Zusammenhang behalten.
 *
 * The Thing's forum store, one SQLite file per realm, separate from the
 * account database. Authors are stored as a name copy plus the character
 * id; public text survives account deletion.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BOARD_SLUGS,
  isBoardSlug,
  type BoardOverview,
  type BoardSlug,
  type PostView,
  type ThreadSummary,
} from '@wov/shared';

/** Autor, wie er beim Schreiben festgehalten wird. */
export interface ForumAutor {
  readonly charakterId: number | null;
  readonly kontoId: number | null;
  readonly name: string;
}

export class ForumDatabase {
  private readonly db: DatabaseSync;

  constructor(pfad: string) {
    mkdirSync(dirname(pfad), { recursive: true });
    this.db = new DatabaseSync(pfad);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.schemaAnlegen();
    // Die sechs Bretter sind die eine feste Liste (shared/forum/types.ts).
    // Idempotent: INSERT OR IGNORE, damit ein Neustart nichts doppelt und
    // eine spaetere Reihenfolgeaenderung uebernommen wird.
    this.ensureBoards(BOARD_SLUGS);
  }

  private schemaAnlegen(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS boards (
        slug TEXT PRIMARY KEY,
        sort INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id                  INTEGER PRIMARY KEY,
        board               TEXT NOT NULL REFERENCES boards(slug),
        title               TEXT NOT NULL,
        author_konto_id     INTEGER,
        author_character_id INTEGER,
        author_name         TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        last_post_at        INTEGER NOT NULL,
        post_count          INTEGER NOT NULL DEFAULT 0,
        pinned              INTEGER NOT NULL DEFAULT 0,
        locked              INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS threads_nach_brett
        ON threads(board, pinned DESC, last_post_at DESC);
      CREATE TABLE IF NOT EXISTS posts (
        id                  INTEGER PRIMARY KEY,
        thread_id           INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        author_konto_id     INTEGER,
        author_character_id INTEGER,
        author_name         TEXT NOT NULL,
        body_md             TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        edited_at           INTEGER,
        edited_by_name      TEXT,
        deleted_at          INTEGER
      );
      CREATE INDEX IF NOT EXISTS posts_nach_thema ON posts(thread_id, created_at);
    `);
  }

  /** Legt fehlende Bretter an und zieht die Reihenfolge nach. */
  ensureBoards(slugs: readonly BoardSlug[]): void {
    const upsert = this.db.prepare(
      'INSERT INTO boards (slug, sort) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET sort = excluded.sort',
    );
    slugs.forEach((slug, i) => upsert.run(slug, i));
  }

  // ── Schreiben ──────────────────────────────────────────────────────

  /**
   * Ein neues Thema samt erstem Beitrag. Beides in EINER Transaktion:
   * Ein Thema ohne Beitrag waere in der Liste unsichtbar und trotzdem da.
   * Liefert die beiden neuen Ids.
   */
  createThread(
    board: BoardSlug,
    title: string,
    autor: ForumAutor,
    body: string,
    now = Date.now(),
  ): { threadId: number; postId: number } {
    this.db.exec('BEGIN');
    try {
      const t = this.db
        .prepare(`INSERT INTO threads
          (board, title, author_konto_id, author_character_id, author_name, created_at, last_post_at, post_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(board, title, autor.kontoId, autor.charakterId, autor.name, now, now);
      const threadId = Number(t.lastInsertRowid);
      const p = this.db
        .prepare(`INSERT INTO posts
          (thread_id, author_konto_id, author_character_id, author_name, body_md, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
        .run(threadId, autor.kontoId, autor.charakterId, autor.name, body, now);
      this.db.prepare('UPDATE threads SET post_count = 1 WHERE id = ?').run(threadId);
      this.db.exec('COMMIT');
      return { threadId, postId: Number(p.lastInsertRowid) };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Ein Beitrag an ein bestehendes Thema; zieht dessen Zahlen nach. */
  createPost(threadId: number, autor: ForumAutor, body: string, now = Date.now()): number {
    this.db.exec('BEGIN');
    try {
      const p = this.db
        .prepare(`INSERT INTO posts
          (thread_id, author_konto_id, author_character_id, author_name, body_md, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
        .run(threadId, autor.kontoId, autor.charakterId, autor.name, body, now);
      this.db
        .prepare('UPDATE threads SET last_post_at = ?, post_count = post_count + 1 WHERE id = ?')
        .run(now, threadId);
      this.db.exec('COMMIT');
      return Number(p.lastInsertRowid);
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ── Lesen ──────────────────────────────────────────────────────────

  /** Alle Bretter in Reihenfolge, mit Thread-/Beitragszahl und letzter Regung. */
  boardList(): BoardOverview[] {
    const zeilen = this.db
      .prepare(`
        SELECT b.slug AS slug,
          (SELECT COUNT(*) FROM threads t WHERE t.board = b.slug) AS thread_count,
          (SELECT COUNT(*) FROM posts p JOIN threads t2 ON t2.id = p.thread_id
             WHERE t2.board = b.slug AND p.deleted_at IS NULL) AS post_count,
          (SELECT MAX(t3.last_post_at) FROM threads t3 WHERE t3.board = b.slug) AS last_activity
        FROM boards b ORDER BY b.sort
      `)
      .all() as Record<string, unknown>[];
    const out: BoardOverview[] = [];
    for (const z of zeilen) {
      const slug = String(z.slug);
      // Defensiv: Ein unbekannter Slug kann nur aus einer aelteren Datei
      // stammen; er faellt still heraus, statt die Liste zu vergiften.
      if (!isBoardSlug(slug)) continue;
      out.push({
        slug,
        threadCount: Number(z.thread_count),
        postCount: Number(z.post_count),
        lastActivity: z.last_activity === null || z.last_activity === undefined
          ? null
          : Number(z.last_activity),
      });
    }
    return out;
  }

  /** Ein einzelnes Brett, oder null. */
  boardBySlug(slug: string): { slug: BoardSlug; threadCount: number } | null {
    if (!isBoardSlug(slug)) return null;
    const z = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM threads t WHERE t.board = ?) AS thread_count')
      .get(slug) as Record<string, unknown> | undefined;
    if (!z) return null;
    return { slug, threadCount: Number(z.thread_count) };
  }

  countThreads(board: BoardSlug): number {
    const z = this.db
      .prepare('SELECT COUNT(*) AS n FROM threads WHERE board = ?')
      .get(board) as Record<string, unknown>;
    return Number(z.n);
  }

  /** Themen eines Bretts: angeheftet zuerst, dann nach letzter Regung. */
  listThreads(board: BoardSlug, limit: number, offset: number): ThreadSummary[] {
    const zeilen = this.db
      .prepare(`SELECT * FROM threads WHERE board = ?
        ORDER BY pinned DESC, last_post_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(board, limit, offset) as Record<string, unknown>[];
    return zeilen.map((z) => this.zuThread(z));
  }

  threadById(id: number): ThreadSummary | null {
    const z = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return z ? this.zuThread(z) : null;
  }

  countPosts(threadId: number): number {
    const z = this.db
      .prepare('SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?')
      .get(threadId) as Record<string, unknown>;
    return Number(z.n);
  }

  /** Beitraege eines Themas in Schreibreihenfolge (geloeschte als Platzhalter). */
  listPosts(threadId: number, limit: number, offset: number): PostView[] {
    const zeilen = this.db
      .prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?')
      .all(threadId, limit, offset) as Record<string, unknown>[];
    return zeilen.map((z) => this.zuPost(z));
  }

  schliessen(): void {
    this.db.close();
  }

  // ── Zeilen -> Typen ────────────────────────────────────────────────

  private zuThread(z: Record<string, unknown>): ThreadSummary {
    const board = String(z.board);
    return {
      id: Number(z.id),
      // Ein unbekanntes Brett kann nur aus einer aelteren Datei stammen.
      // Es auf den ersten bekannten Slug zu biegen waere geraten — der
      // Beitrag faellt damit aus dem Brett heraus und bleibt auffindbar.
      board: isBoardSlug(board) ? board : BOARD_SLUGS[0],
      title: String(z.title),
      authorCharacterId: z.author_character_id === null || z.author_character_id === undefined
        ? null
        : Number(z.author_character_id),
      authorName: String(z.author_name),
      createdAt: Number(z.created_at),
      lastPostAt: Number(z.last_post_at),
      postCount: Number(z.post_count),
      pinned: Number(z.pinned) !== 0,
      locked: Number(z.locked) !== 0,
    };
  }

  private zuPost(z: Record<string, unknown>): PostView {
    return {
      id: Number(z.id),
      threadId: Number(z.thread_id),
      authorCharacterId: z.author_character_id === null || z.author_character_id === undefined
        ? null
        : Number(z.author_character_id),
      authorName: String(z.author_name),
      bodyMd: String(z.body_md),
      createdAt: Number(z.created_at),
      editedAt: z.edited_at === null || z.edited_at === undefined ? null : Number(z.edited_at),
      deletedAt: z.deleted_at === null || z.deleted_at === undefined ? null : Number(z.deleted_at),
    };
  }
}
