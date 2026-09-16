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
  type ReactionCount,
  type ReactionKind,
  type ThreadSummary,
} from '@wov/shared';

/** Autor, wie er beim Schreiben festgehalten wird. */
export interface ForumAutor {
  readonly charakterId: number | null;
  readonly kontoId: number | null;
  readonly name: string;
}

/** Eine offene Meldung mit dem, was eine Moderation zum Entscheiden braucht. */
export interface MeldungRow {
  readonly id: number;
  readonly postId: number;
  readonly threadId: number;
  readonly board: string;
  readonly threadTitle: string;
  readonly authorName: string;
  readonly bodyMd: string;
  readonly grund: string;
  readonly createdAt: number;
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
      CREATE TABLE IF NOT EXISTS reports (
        id                 INTEGER PRIMARY KEY,
        post_id            INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        reporter_konto_id  INTEGER,
        grund              TEXT NOT NULL DEFAULT '',
        created_at         INTEGER NOT NULL,
        resolved_at        INTEGER,
        resolved_by_name   TEXT
      );
      CREATE INDEX IF NOT EXISTS reports_offen ON reports(resolved_at, created_at);
      /*
        Reaktionen: je Konto, Beitrag und Art hoechstens EINE Stimme. Der
        Primaerschluessel ist die Regel selbst — ein zweites „Beifall" ist
        damit kein Zaehlfehler, sondern ein Konflikt, den die Toggle-Logik
        als „schon da" liest. Die Konto-Id ist bewusst NICHT der Charakter:
        Wer reagiert, ist die Person hinter dem Konto; mehrere Charaktere
        sollen nicht mehrfach stimmen koennen.
      */
      CREATE TABLE IF NOT EXISTS reactions (
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        konto_id   INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (post_id, konto_id, kind)
      );
      CREATE INDEX IF NOT EXISTS reactions_nach_post ON reactions(post_id, kind);
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
  listPosts(threadId: number, limit: number, offset: number, kontoId: number | null = null): PostView[] {
    const zeilen = this.db
      .prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?')
      .all(threadId, limit, offset) as Record<string, unknown>[];
    const posts = zeilen.map((z) => this.zuPost(z));
    // Reaktionen in EINER Abfrage fuer die ganze Seite, nicht je Beitrag.
    // `kontoId` ist optional: Ohne Anmeldung bleiben alle `me` falsch, die
    // Zaehlung stimmt trotzdem — Lesen ist oeffentlich.
    const karte = this.reaktionenFuer(posts.map((p) => p.id), kontoId);
    return posts.map((p) => ({ ...p, reactions: karte.get(p.id) ?? [] }));
  }

  /**
   * Eigentum und Zustand eines Beitrags — fuer Bearbeiten und Loeschen.
   *
   * Bewusst getrennt von `listPosts`: Die Anzeige braucht den Autor-NAMEN,
   * die Rechtepruefung die Autor-KONTO-ID. Letztere gehoert nicht in die
   * oeffentliche Antwort, deshalb steht sie in keinem `PostView`.
   */
  postOwnership(id: number): {
    id: number;
    threadId: number;
    authorKontoId: number | null;
    deletedAt: number | null;
  } | null {
    const z = this.db
      .prepare('SELECT id, thread_id, author_konto_id, deleted_at FROM posts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!z) return null;
    return {
      id: Number(z.id),
      threadId: Number(z.thread_id),
      authorKontoId: z.author_konto_id === null || z.author_konto_id === undefined
        ? null
        : Number(z.author_konto_id),
      deletedAt: z.deleted_at === null || z.deleted_at === undefined ? null : Number(z.deleted_at),
    };
  }

  /**
   * Bearbeitet einen EIGENEN, nicht geloeschten Beitrag. false, wenn es
   * ihn nicht gibt, er jemand anderem gehoert oder schon entfernt ist.
   * Die Pruefung sitzt in der WHERE-Klausel, nicht davor — so gibt es
   * keinen Weg, an dem ein fremder Beitrag getroffen werden koennte.
   */
  editPost(postId: number, kontoId: number, body: string, editorName: string, now = Date.now()): boolean {
    const r = this.db
      .prepare(`UPDATE posts SET body_md = ?, edited_at = ?, edited_by_name = ?
        WHERE id = ? AND author_konto_id = ? AND deleted_at IS NULL`)
      .run(body, now, editorName, postId, kontoId);
    return Number(r.changes) > 0;
  }

  /**
   * Entfernt einen EIGENEN Beitrag als Platzhalter (Soft-Delete) und zieht
   * die Beitragszahl des Themas nach. Der Text bleibt in der Zeile stehen
   * (Chronik, Nachvollziehbarkeit), nur `deleted_at` wird gesetzt; die
   * Anzeige ersetzt ihn durch „Dieser Beitrag wurde entfernt."
   */
  softDeletePost(postId: number, kontoId: number, now = Date.now()): boolean {
    this.db.exec('BEGIN');
    try {
      const r = this.db
        .prepare(`UPDATE posts SET deleted_at = ? WHERE id = ? AND author_konto_id = ? AND deleted_at IS NULL`)
        .run(now, postId, kontoId);
      if (Number(r.changes) > 0) {
        // max(0, …): Ein geloeschter Eroeffnungsbeitrag darf die Zahl nicht
        // unter null druecken.
        this.db
          .prepare(`UPDATE threads SET post_count = max(0, post_count - 1)
            WHERE id = (SELECT thread_id FROM posts WHERE id = ?)`)
          .run(postId);
      }
      this.db.exec('COMMIT');
      return Number(r.changes) > 0;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ── Moderation ──────────────────────────────────────────────────────

  /** Eine Meldung zu einem Beitrag. Liefert die Meldungs-Id. */
  reportPost(postId: number, kontoId: number | null, grund: string, now = Date.now()): number {
    const r = this.db
      .prepare('INSERT INTO reports (post_id, reporter_konto_id, grund, created_at) VALUES (?, ?, ?, ?)')
      .run(postId, kontoId, grund, now);
    return Number(r.lastInsertRowid);
  }

  /**
   * Offene Meldungen, aelteste zuerst, samt Thema und Autor.
   *
   * Ein JOIN ueber drei Tabellen, obwohl die Forendaten in EINER Datei
   * liegen — genau dafuer ist die eigene Datei da. Der Meldende bleibt
   * draussen: Wer gemeldet hat, geht die Moderation nichts an.
   */
  offeneMeldungen(): MeldungRow[] {
    const zeilen = this.db
      .prepare(`SELECT r.id, r.post_id, r.grund, r.created_at,
          p.thread_id, p.author_name, p.body_md,
          t.board, t.title
        FROM reports r
        JOIN posts p ON p.id = r.post_id
        JOIN threads t ON t.id = p.thread_id
        WHERE r.resolved_at IS NULL
        ORDER BY r.created_at ASC`)
      .all() as Record<string, unknown>[];
    return zeilen.map((z) => ({
      id: Number(z.id),
      postId: Number(z.post_id),
      threadId: Number(z.thread_id),
      board: String(z.board),
      threadTitle: String(z.title),
      authorName: String(z.author_name),
      bodyMd: String(z.body_md),
      grund: String(z.grund),
      createdAt: Number(z.created_at),
    }));
  }

  meldungErledigen(id: number, modName: string, now = Date.now()): boolean {
    const r = this.db
      .prepare('UPDATE reports SET resolved_at = ?, resolved_by_name = ? WHERE id = ? AND resolved_at IS NULL')
      .run(now, modName, id);
    return Number(r.changes) > 0;
  }

  threadAnheften(id: number, pinned: boolean): boolean {
    const r = this.db.prepare('UPDATE threads SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    return Number(r.changes) > 0;
  }

  threadSperren(id: number, locked: boolean): boolean {
    const r = this.db.prepare('UPDATE threads SET locked = ? WHERE id = ?').run(locked ? 1 : 0, id);
    return Number(r.changes) > 0;
  }

  threadVerschieben(id: number, board: BoardSlug): boolean {
    const r = this.db.prepare('UPDATE threads SET board = ? WHERE id = ?').run(board, id);
    return Number(r.changes) > 0;
  }

  /**
   * Entfernt einen BELIEBIGEN Beitrag (Moderation), Soft-Delete — dieselbe
   * Wirkung wie das eigene Loeschen, nur ohne die Eigentumsgrenze. Die
   * Grenze zieht der Aufrufer (ForumApi), nicht diese Methode; sie kennt
   * nur die Zeile.
   */
  postEntfernenModerativ(postId: number, now = Date.now()): boolean {
    this.db.exec('BEGIN');
    try {
      const r = this.db
        .prepare('UPDATE posts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, postId);
      if (Number(r.changes) > 0) {
        this.db
          .prepare(`UPDATE threads SET post_count = max(0, post_count - 1)
            WHERE id = (SELECT thread_id FROM posts WHERE id = ?)`)
          .run(postId);
      }
      this.db.exec('COMMIT');
      return Number(r.changes) > 0;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ── Reaktionen ──────────────────────────────────────────────────────

  /**
   * Setzt oder nimmt EINE Reaktion zurueck — ein Toggle, kein Zaehler.
   * Liefert den neuen Stand fuer genau diese Art, damit die Oberflaeche
   * nicht raten muss.
   */
  reactionToggle(
    postId: number,
    kontoId: number,
    kind: ReactionKind,
    now = Date.now(),
  ): { count: number; me: boolean } {
    const vorhanden = this.db
      .prepare('SELECT 1 FROM reactions WHERE post_id = ? AND konto_id = ? AND kind = ?')
      .get(postId, kontoId, kind) !== undefined;
    if (vorhanden) {
      this.db
        .prepare('DELETE FROM reactions WHERE post_id = ? AND konto_id = ? AND kind = ?')
        .run(postId, kontoId, kind);
    } else {
      this.db
        .prepare('INSERT INTO reactions (post_id, konto_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(postId, kontoId, kind, now);
    }
    const z = this.db
      .prepare('SELECT COUNT(*) AS n FROM reactions WHERE post_id = ? AND kind = ?')
      .get(postId, kind) as Record<string, unknown>;
    return { count: Number(z.n), me: !vorhanden };
  }

  /** Reaktionen eines ganzen Themas, nach Beitrag gebuendelt. */
  reaktionenVonThema(threadId: number, kontoId: number | null): Map<number, ReactionCount[]> {
    const zeilen = this.db
      .prepare('SELECT id FROM posts WHERE thread_id = ?')
      .all(threadId) as Record<string, unknown>[];
    return this.reaktionenFuer(zeilen.map((z) => Number(z.id)), kontoId);
  }

  /** Reaktionen mehrerer Beitraege, nach Beitrag gebuendelt. */
  private reaktionenFuer(ids: readonly number[], kontoId: number | null): Map<number, ReactionCount[]> {
    const karte = new Map<number, ReactionCount[]>();
    if (ids.length === 0) return karte;
    const platzhalter = ids.map(() => '?').join(', ');
    // `MAX(...)` in einem Durchgang: dieselbe Abfrage sagt Zahl UND ob die
    // Anfrage dabei ist. `-1` als Konto kann nie vorkommen (Ids sind > 0).
    const zeilen = this.db
      .prepare(`SELECT post_id, kind, COUNT(*) AS n,
          MAX(CASE WHEN konto_id = ? THEN 1 ELSE 0 END) AS me
        FROM reactions WHERE post_id IN (${platzhalter})
        GROUP BY post_id, kind
        ORDER BY post_id, kind`)
      .all(kontoId ?? -1, ...ids) as Record<string, unknown>[];
    for (const z of zeilen) {
      const postId = Number(z.post_id);
      const liste = karte.get(postId) ?? [];
      liste.push({
        kind: String(z.kind) as ReactionKind,
        count: Number(z.n),
        me: Number(z.me) !== 0,
      });
      karte.set(postId, liste);
    }
    return karte;
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
      // Leer als Grundzustand; `listPosts` fuellt die echten Zahlen.
      reactions: [],
    };
  }
}
