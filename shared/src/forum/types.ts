/**
 * Das Thing — gemeinsame Typen und Grenzen des Forums.
 *
 * Diese Datei liegt in `shared/`, weil ZWEI Seiten sie lesen: der
 * Spielserver, der die Forendaten haelt und die API ausliefert
 * (`server/src/forum/`), und der SSR-Dienst, der die Seiten baut
 * (`wov-forum/`). Waeren die Typen zweimal geschrieben, liefen die
 * Grenzen (Titel-, Textlaenge, Seitengroesse) unweigerlich auseinander —
 * die Sorte Fehler, die auf einer Seite durchgeht und auf der anderen rot
 * wird, ohne dass ein Test es sieht.
 *
 * Reine Typen und Konstanten, keine Funktionen mit Nebenwirkung: die
 * Zusage `sideEffects: false` in `shared/package.json` gilt weiter.
 *
 * ── Die sechs Bretter sind fest ──────────────────────────────────────
 * Vorgabe aus dem Konzept: sechs Bretter, in der Reihenfolge dieser Liste.
 * Die Beschriftungen (Name, Zweck) stehen NICHT hier, sondern in der
 * Sprachdatei der Webseite unter `thing.boards.<slug>.name` /
 * `.description` — sie sind Text, kein Datum, und gehoeren damit in die
 * Uebersetzung, nicht in die Datenbank. Ein spaeteres Verwaltbar-Machen
 * der Bretter haengt damit an genau einer Liste und nicht an zwei.
 *
 * The Thing: shared types and limits for the forum. The six boards are
 * fixed and slugged here; their German/English labels live in the website
 * i18n catalog under `thing.boards.<slug>.*`.
 */

/** The six boards, in display order. Slugs are contract, never renamed. */
export const BOARD_SLUGS = [
  'mead_hall',
  'steadings',
  'voyages',
  'weapons',
  'clans',
  'forge',
] as const;

export type BoardSlug = (typeof BOARD_SLUGS)[number];

/** True for one of the six known board slugs. */
export function isBoardSlug(value: unknown): value is BoardSlug {
  return typeof value === 'string' && (BOARD_SLUGS as readonly string[]).includes(value);
}

/**
 * Grenzen der Eingaben. Sie stehen hier EINMAL und werden von der API
 * geprueft; die Oberflaeche liest sie fuer `maxlength` und den Zaehler.
 * Der Text ist Markdown und wird auf der Ausgabeseite streng gerendert —
 * die Laengengrenze ist eine Kostenbremse, kein Sicherheitsmerkmal.
 */
export const THREAD_TITLE_MIN = 3;
export const THREAD_TITLE_MAX = 120;
export const POST_BODY_MIN = 1;
export const POST_BODY_MAX = 20000;

/** Eintraege je Seite. Eine Zahl fuer Themenlisten und Beitragslisten. */
export const FORUM_PAGE_SIZE = 20;

/** Laengste Suchanfrage, die die API annimmt (danach gekappt). */
export const SEARCH_QUERY_MAX = 120;

/**
 * Die Reaktionen auf einen Beitrag — eine kleine FESTE Liste. Sie steht
 * hier und nicht in der Datenbank, weil sie ein Vertrag zwischen beiden
 * Seiten ist: Der Server lehnt unbekannte Arten ab, die Oberflaeche
 * beschriftet genau diese drei. Ein neuer Wert ist damit eine bewusste
 * Aenderung an einer Stelle, kein Datenbankinhalt, der irgendwann
 * unuebersetzt auf einer Seite auftaucht.
 *
 * Die Beschriftungen stehen in der Sprachdatei unter
 * `thing.reactions.<kind>` — Text gehoert in die Uebersetzung, nicht in
 * den Vertrag.
 */
export const REACTION_KINDS = ['hail', 'laugh', 'mourn'] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

/** True for one of the known reaction kinds. */
export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === 'string' && (REACTION_KINDS as readonly string[]).includes(value);
}

/** Eine Reaktion samt Zahl und der Angabe, ob sie vom Fragenden stammt. */
export interface ReactionCount {
  readonly kind: ReactionKind;
  readonly count: number;
  /** True, wenn das Konto der Anfrage diese Reaktion gesetzt hat. */
  readonly me: boolean;
}

/** Ein Brett samt den Zahlen, die die Uebersicht zeigt. */
export interface BoardOverview {
  readonly slug: BoardSlug;
  readonly threadCount: number;
  readonly postCount: number;
  /** Zeitstempel des letzten Beitrags in diesem Brett, oder null. */
  readonly lastActivity: number | null;
}

/**
 * Ein Thema in der Liste. `authorName` ist der KOPIERTE Name des
 * Charakters zur Schreibzeit, nicht ein Verweis: Die Forendatenbank ist
 * von der Kontendatenbank getrennt, und eine Autorensuche ueber zwei
 * Dateien waere eine Abfrage je Zeile. Ein Charakter kann heute nicht
 * umbenannt werden, die Kopie ist also nicht veraltet.
 */
export interface ThreadSummary {
  readonly id: number;
  readonly board: BoardSlug;
  readonly title: string;
  readonly authorCharacterId: number | null;
  readonly authorName: string;
  readonly createdAt: number;
  readonly lastPostAt: number;
  readonly postCount: number;
  readonly pinned: boolean;
  readonly locked: boolean;
}

/** Ein einzelner Beitrag. `deletedAt` gesetzt heisst „an dieser Stelle geloescht". */
export interface PostView {
  readonly id: number;
  readonly threadId: number;
  readonly authorCharacterId: number | null;
  readonly authorName: string;
  readonly bodyMd: string;
  readonly createdAt: number;
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  /**
   * Nur die Arten, die wirklich vorkommen; eine Art ohne Stimmen fehlt in
   * der Liste (statt mit 0 dazustehen). `me` ist nur dann wahr, wenn die
   * Anfrage angemeldet war — die Anzeige braucht das fuer den eigenen
   * Zustand, nicht fuer die Zaehlung.
   */
  readonly reactions: readonly ReactionCount[];
}

/** Eine Seite einer Themenliste. */
export interface ThreadPage {
  readonly threads: readonly ThreadSummary[];
  /** 1-basiert. */
  readonly page: number;
  readonly pageCount: number;
}

/** Ein Thema mit einer Seite seiner Beitraege. */
export interface ThreadView {
  readonly thread: ThreadSummary;
  readonly posts: readonly PostView[];
  readonly page: number;
  readonly pageCount: number;
}

/**
 * Ein Suchtreffer. Er zeigt auf den BEITRAG, nicht auf das Thema: Gefunden
 * wird Text, und die Stelle soll sichtbar sein. `snippet` ist reiner Text
 * (die API setzt ABSICHTLICH keine Markierungen) — die Oberflaeche zeigt
 * ihn ungeparst an, damit aus der Datenbank kein HTML wird.
 */
export interface SearchHit {
  readonly postId: number;
  readonly threadId: number;
  readonly board: BoardSlug;
  readonly title: string;
  readonly authorName: string;
  readonly createdAt: number;
  readonly snippet: string;
}

/** Eine Seite einer Trefferliste. */
export interface SearchPage {
  readonly results: readonly SearchHit[];
  readonly page: number;
  readonly pageCount: number;
  /** Treffer gesamt — die Anzeige nennt die Zahl, nicht nur die Seite. */
  readonly total: number;
}
