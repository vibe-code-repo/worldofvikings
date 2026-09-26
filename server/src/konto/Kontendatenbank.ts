/**
 * Accounts and their characters, in SQLite.
 *
 * ── Why a database at all ────────────────────────────────────────────
 * Everything else this server owns is world state and lives in the packed
 * world file. Accounts are not world state: they survive a world reset,
 * they must not be lost when a save is rolled back, and they are written
 * far more rarely than they are read. Putting them in the world file
 * would tie a password to a snapshot.
 *
 * ── Why node:sqlite ──────────────────────────────────────────────────
 * It ships with Node 22 and needs no native build. The alternative,
 * better-sqlite3, is a compiled dependency; Postgres would be a second
 * container for a table that will hold a few thousand rows. SQLite is
 * still flagged experimental in Node 22 and prints a warning on import --
 * that is the price, and it is a warning, not an instability.
 *
 * ── The trick that keeps this cheap ──────────────────────────────────
 * A character is NOT a new concept for the game server. Every character
 * simply owns its own `spielerId` -- the identity the server already
 * mints (Identitaet.ts) and already keys saved players by
 * (WovServer.savedPlayers). An account is just the list of spielerIds a
 * person may use, plus the password that proves they may.
 *
 * That is why the world save format is untouched by all of this. Picking
 * a character means being handed a session token for that character's
 * spielerId, and from the game client's point of view nothing changed.
 *
 * ── One database per realm ───────────────────────────────────────────
 * dev and live keep separate files, like their worlds do. The test realm
 * is reset and broken on purpose; real credentials have no business
 * living there.
 *
 * ── Die Bannliste, und WORAUF sie bannt ──────────────────────────────
 * Seit der Server oeffentlich erreichbar ist und die Registrierung offen
 * steht, braucht es eine Moeglichkeit, jemanden dauerhaft fernzuhalten.
 * Die eigentliche Frage ist nicht, wie man das speichert, sondern WORAUF
 * gebannt wird — und jede Antwort fuer sich allein ist falsch:
 *
 *   • Nur der CHARAKTER (spielerId)? Ein zweiter Charakter ist im selben
 *     Konto in zehn Sekunden angelegt. Das waere ein Kick mit Nachhall,
 *     kein Bann.
 *   • Nur das KONTO? Das ist die richtige Standardantwort — ein Konto
 *     buendelt alle Charaktere einer Person, und der Name, unter dem ein
 *     Admin bannt, haengt genau dort. Aber ein neues Konto ist in einer
 *     Minute angelegt; die Registrierung ist nur auf fuenf je Stunde und
 *     Herkunft gedrosselt.
 *   • Nur die HERKUNFT (IP)? Trifft Unbeteiligte hinter demselben
 *     Anschluss: Wohnheim, Mobilfunk-CGNAT, ein Haushalt. Als Dauerzustand
 *     ist das eine Kollektivstrafe.
 *
 * Deshalb DREI Bannarten in EINER Tabelle (`banns.art`), mit klarer
 * Rollenverteilung:
 *   'konto'    — der Normalfall, das was ein Admin meint.
 *   'spieler'  — fuer Verbindungen OHNE Konto. Die gibt es weiterhin: wer
 *                den Spielclient ohne Anmeldung oeffnet, bekommt eine vom
 *                Server gewuerfelte spielerId und gar keine Kontozeile
 *                (NetManager.handlePasswordAuth). Bei solchen Gaesten
 *                greift ein Kontobann ins Leere.
 *   'herkunft' — die Notbremse gegen jemanden, der im Minutentakt neue
 *                Konten anlegt. ABSICHTLICH das grobe Werkzeug, und
 *                deshalb am besten befristet (`bis`) — gerade WEIL sie
 *                Unbeteiligte trifft. Erzwungen wird die Befristung hier
 *                nicht: eine Regel, die der Admin im Ernstfall nicht
 *                umgehen kann, ist keine Hilfe, sondern ein zweites
 *                Problem.
 *
 * Befristung: `bis` ist ein Zeitstempel in ms, NULL heisst dauerhaft.
 * Abgelaufene Banns wirken nicht mehr (jede Pruefung filtert nach Zeit),
 * werden aber nicht im selben Moment geloescht — die Zeile ist auch
 * Chronik. `abgelaufeneAufraeumen()` raeumt sie beim Serverstart weg.
 *
 * ENGLISH, in one sentence: bans live in one table with three possible
 * subjects — account (the default), player identity (for account-less
 * guests) and origin address (the blunt last resort, best time-limited) —
 * each optionally expiring at `bis`.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  spielerIdErzeugen, istSpielerId, type SpielerId,
} from '../net/Identitaet.js';
import { getStableHash } from '../util/Hash.js';

export interface Konto {
  id: number;
  benutzername: string;
  email: string;
  erstellt: number;
}

export interface Charakter {
  id: number;
  kontoId: number;
  spielerId: SpielerId;
  altlastUserId: bigint;
  name: string;
  figur: string;
  frisur: string;
  haarfarbe: string;
  augenfarbe: string;
  klasse: string;
  ober: string;
  beine: string;
  erstellt: number;
  zuletztGespielt: number | null;
}

/**
 * Worauf ein Bann zielt — Begruendung der drei Arten im Kopfkommentar.
 *
 * Die Werte sind die Strings, die auch in der Spalte `banns.art` stehen und
 * die der Adminbefehl entgegennimmt; sie sind damit Teil eines Vertrags und
 * werden nicht umbenannt.
 */
export type BannArt = 'konto' | 'spieler' | 'herkunft';

export interface Bann {
  id: number;
  art: BannArt;
  /** Konto-ID als Text, spielerId oder Herkunfts-Adresse — je nach `art`. */
  wert: string;
  grund: string;
  /** Wer den Bann gesetzt hat (Spielername oder ''), nur fuer die Chronik. */
  gesetztVon: string;
  gesetzt: number;
  /** Zeitstempel in ms, ab dem der Bann nicht mehr wirkt. null = dauerhaft. */
  bis: number | null;
}

/** Everything that can go wrong in a way the caller must tell apart. */
/**
 * Everything that can go wrong in a way the caller must tell apart.
 *
 * These strings are ENGLISH because they are not internal: KontoApi hands
 * them to the browser unchanged (`{ error: r.fehler }`), so they are part
 * of the HTTP contract and belong to the same vocabulary as every other
 * error key there.
 *
 * They were German until 2026-08-24, and nobody noticed -- the website was
 * reading the response field under its old German name, so every error
 * came out as the generic "unexpected" message. Renaming that field made
 * nine of thirteen keys work and left these three broken in a way that was
 * now visible.
 */
export type KontoFehler =
  | 'username-taken'
  | 'name-taken'
  | 'unknown';

/** Laenge des oeffentlichen Profiltexts in Zeichen (Codepunkten). */
export const PROFILTEXT_MAX = 300;

/**
 * SQL-Ausdruck fuer die naechste freie Id einer Tabelle, die nie eine schon
 * einmal vergebene wiederholt — s. `hochwasser` in `schemaAnlegen`. Nur
 * feste Tabellennamen aus diesem Modul, nie Eingaben.
 */
function naechsteId(tabelle: 'konten' | 'charaktere'): string {
  return `(MAX(COALESCE((SELECT MAX(id) FROM ${tabelle}), 0),
    COALESCE((SELECT id FROM hochwasser WHERE tabelle = '${tabelle}'), 0)) + 1)`;
}

/** Ergebnis von `kontoLoeschen`: was mit dem Konto weggefallen ist. */
export interface GeloeschtesKonto {
  kontoId: number;
  benutzername: string;
  charaktere: Charakter[];
}

export class Kontendatenbank {
  private readonly db: DatabaseSync;

  constructor(pfad: string) {
    mkdirSync(dirname(pfad), { recursive: true });
    this.db = new DatabaseSync(pfad);
    // WAL: readers never block the writer. The HTTP API reads on every
    // request while a registration may be writing.
    this.db.exec('PRAGMA journal_mode = WAL');
    // Off by default in SQLite, and we rely on it for ON DELETE CASCADE.
    this.db.exec('PRAGMA foreign_keys = ON');
    this.schemaAnlegen();
    this.spaltenNachziehen();
    // Beim Start einmal ausmisten. Abgelaufene Banns wirken ohnehin nicht
    // mehr (jede Pruefung filtert nach Zeit) — das hier haelt nur die
    // Liste lesbar, die sich ein Admin anschaut.
    this.abgelaufeneAufraeumen();
  }

  /**
   * Columns added after the table already existed in the wild.
   *
   * CREATE TABLE IF NOT EXISTS silently does nothing once the table is
   * there, so a new column in the statement above never reaches a
   * database that has already been created. On dev that is exactly what
   * happened: characters existed, the column did not, and the missing
   * value only surfaced as "the hair colour picker is gone".
   *
   * Idempotent by construction: it asks what is there and adds only what
   * is missing, so it may run on every start.
   *
   * Nur SPALTEN brauchen diesen Weg. Eine ganze neue TABELLE (`banns`)
   * waechst einer bestehenden Datenbank von selbst zu, weil
   * CREATE TABLE IF NOT EXISTS sie dort schlicht anlegt — sie steht
   * deshalb in schemaAnlegen() und nicht hier.
   */
  private spaltenNachziehen(): void {
    this.spalteNachziehen('charaktere', 'haarfarbe', "TEXT NOT NULL DEFAULT ''");
    this.spalteNachziehen('charaktere', 'augenfarbe', "TEXT NOT NULL DEFAULT 'fjordblau'");
    this.spalteNachziehen('charaktere', 'klasse', "TEXT NOT NULL DEFAULT ''");
    // Das AVATAR des Kontos (M4, Das Thing): welcher eigene Charakter den
    // Menschen nach aussen vertritt. NULL heisst „noch keiner gewaehlt".
    // Eine Spalte auf `konten`, nicht auf `charaktere`: Der Avatar ist eine
    // Eigenschaft des Kontos, nicht des Charakters — und ein Charakter kann
    // geloescht werden, ohne den Datensatz des Kontos zu zerstoeren.
    this.spalteNachziehen('konten', 'avatar_charakter_id', 'INTEGER');
    // Konto-Verwaltung (W3). `token_ab`: Konto-Token, die vor oder genau zu
    // diesem Zeitpunkt (ms) ausgestellt wurden, sind ungueltig — so beendet
    // ein Passwortwechsel alle anderen Anmeldungen, obwohl die Token
    // zustandslos sind. 0 = nie gesetzt, jedes Token gilt.
    this.spalteNachziehen('konten', 'token_ab', 'INTEGER NOT NULL DEFAULT 0');
    // Oeffentlicher Profiltext (hoechstens PROFILTEXT_MAX Zeichen, reiner Text).
    this.spalteNachziehen('konten', 'profil_text', "TEXT NOT NULL DEFAULT ''");
  }

  /**
   * Eine einzelne Spalte nachziehen, falls sie fehlt.
   *
   * Als Helfer herausgezogen, damit die naechste Erweiterung eine Zeile ist
   * und nicht wieder ein handgeschriebenes PRAGMA-Stueck — die Sorte
   * Wiederholung, bei der beim dritten Mal das console.log fehlt.
   */
  private spalteNachziehen(tabelle: string, spalte: string, definition: string): void {
    const vorhanden = new Set(
      (this.db.prepare(`PRAGMA table_info(${tabelle})`).all() as Record<string, unknown>[])
        .map((z) => String(z.name)),
    );
    if (vorhanden.has(spalte)) return;
    this.db.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${spalte} ${definition}`);
    console.log(`[Konto] Spalte ${tabelle}.${spalte} nachgezogen`);
  }

  private schemaAnlegen(): void {
    // COLLATE NOCASE on both names: "Mike" and "mike" must not be two
    // accounts, and two characters called "Bjorn" would collide at connect
    // time anyway -- NetManager refuses a duplicate name. Reserving the
    // name here turns a confusing failure during login into a clear one
    // during creation.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS konten (
        id           INTEGER PRIMARY KEY,
        benutzername TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email        TEXT NOT NULL,
        passwort     TEXT NOT NULL,
        erstellt     INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS charaktere (
        id               INTEGER PRIMARY KEY,
        konto_id         INTEGER NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
        spieler_id       TEXT NOT NULL UNIQUE,
        altlast_user_id  TEXT NOT NULL,
        name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
        figur            TEXT NOT NULL,
        frisur           TEXT NOT NULL,
        haarfarbe        TEXT NOT NULL DEFAULT '',
        augenfarbe       TEXT NOT NULL DEFAULT 'fjordblau',
        klasse           TEXT NOT NULL DEFAULT '',
        ober             TEXT NOT NULL DEFAULT '',
        beine            TEXT NOT NULL DEFAULT '',
        erstellt         INTEGER NOT NULL,
        zuletzt_gespielt INTEGER
      );
      CREATE INDEX IF NOT EXISTS charaktere_nach_konto ON charaktere(konto_id);
    `);

    // Bannliste. Kein Fremdschluessel auf konten(id), und das ist Absicht:
    // ein geloeschtes Konto darf seinen Bann nicht mitnehmen, und eine
    // Herkunfts-Adresse hat gar kein Konto, auf das sie zeigen koennte.
    //
    // COLLATE NOCASE auf `wert` aus demselben Grund wie bei den Namen:
    // eine spielerId oder IPv6-Adresse in anderer Schreibweise darf nicht
    // an einem Bann vorbeirutschen.
    //
    // Der eindeutige Index ueber (art, wert) macht das Setzen zu einem
    // Ersetzen: zweimal denselben Zugang bannen aendert Grund und Frist,
    // statt eine zweite, halb vergessene Zeile anzulegen.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS banns (
        id          INTEGER PRIMARY KEY,
        art         TEXT NOT NULL,
        wert        TEXT NOT NULL COLLATE NOCASE,
        grund       TEXT NOT NULL DEFAULT '',
        gesetzt_von TEXT NOT NULL DEFAULT '',
        gesetzt     INTEGER NOT NULL,
        bis         INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS banns_eindeutig ON banns(art, wert);
    `);

    // Konto-Verwaltung (W3). Drei kleine Tabellen, alle ohne Fremdschluessel
    // auf konten — sie muessen ein geloeschtes Konto ueberleben.
    //
    // `geloeschte_spieler`: spielerIds geloeschter Charaktere. Ein Spieler-
    // Token (Identitaet.ts) ist zustandslos und lebt nach der Loeschung
    // weiter; ohne diese Liste kaeme jemand mit einem vor der Loeschung
    // abgeholten Token wieder in die Welt und legte dort einen verwaisten
    // Spielstand an. `bannFuerZugang` lehnt diese Kennungen ab.
    //
    // `hochwasser`: hoechste je vergebene Id je Tabelle. INTEGER PRIMARY KEY
    // ohne AUTOINCREMENT vergibt nach dem Loeschen der letzten Zeile deren
    // Id NEU — ein altes Konto-Token oder ein Forum-Verweis (`author_
    // character_id`) gehoerte dann ploetzlich einem anderen. Ids werden
    // deshalb nie wiederverwendet.
    //
    // `forum_auftraege`: Was das Forum (eigene Datei!) nach einer Konto-
    // loeschung noch zu bereinigen hat. Wird in DERSELBEN Transaktion wie die
    // Loeschung geschrieben und erst nach getaner Arbeit entfernt — bricht
    // der Server dazwischen ab, holt der naechste Start es nach, statt
    // Beitraege mit toten Konto-Ids stehen zu lassen.
    //
    // `profil_meldungen`: Meldungen gegen einen Profiltext. Die Moderations-
    // ansicht dazu ist nicht Teil von W3; die Zeilen warten dort.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geloeschte_spieler (
        spieler_id TEXT PRIMARY KEY COLLATE NOCASE,
        geloescht  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hochwasser (
        tabelle TEXT PRIMARY KEY,
        id      INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS forum_auftraege (
        konto_id       INTEGER PRIMARY KEY,
        charakter_ids  TEXT NOT NULL,
        namen          TEXT NOT NULL,
        erstellt       INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profil_meldungen (
        id                INTEGER PRIMARY KEY,
        melder_konto_id   INTEGER NOT NULL,
        gemeldet_konto_id INTEGER NOT NULL,
        grund             TEXT NOT NULL DEFAULT '',
        erstellt          INTEGER NOT NULL,
        erledigt          INTEGER,
        UNIQUE (melder_konto_id, gemeldet_konto_id)
      );
    `);
  }

  // ── Accounts ────────────────────────────────────────────────────────

  /**
   * Create an account. The e-mail address is stored but NOT verified --
   * that is a deliberate product decision, the account is usable at once.
   */
  kontoAnlegen(benutzername: string, email: string, passwortEintrag: string):
    { ok: true; konto: Konto } | { ok: false; fehler: KontoFehler } {
    const jetzt = Date.now();
    try {
      const r = this.db
        .prepare(`INSERT INTO konten (id, benutzername, email, passwort, erstellt)
          VALUES (${naechsteId('konten')}, ?, ?, ?, ?)`)
        .run(benutzername, email, passwortEintrag, jetzt);
      return {
        ok: true,
        konto: { id: Number(r.lastInsertRowid), benutzername, email, erstellt: jetzt },
      };
    } catch (e) {
      // UNIQUE violation is the expected case, not an exception worth
      // logging: someone picked a name that is taken.
      if (String(e).includes('UNIQUE')) return { ok: false, fehler: 'username-taken' };
      throw e;
    }
  }

  kontoNachName(benutzername: string): (Konto & { passwort: string }) | null {
    const z = this.db
      .prepare('SELECT id, benutzername, email, passwort, erstellt FROM konten WHERE benutzername = ?')
      .get(benutzername) as Record<string, unknown> | undefined;
    if (!z) return null;
    return {
      id: Number(z.id),
      benutzername: String(z.benutzername),
      email: String(z.email),
      passwort: String(z.passwort),
      erstellt: Number(z.erstellt),
    };
  }

  kontoNachId(id: number): Konto | null {
    const z = this.db
      .prepare('SELECT id, benutzername, email, erstellt FROM konten WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!z) return null;
    return {
      id: Number(z.id),
      benutzername: String(z.benutzername),
      email: String(z.email),
      erstellt: Number(z.erstellt),
    };
  }

  /**
   * How many accounts and characters this realm holds.
   *
   * Public numbers: `/accounts/status` hands them to the website, where
   * they stand next to the players online. They are counts and nothing
   * else -- no name, no e-mail, no id leaves through this door.
   *
   * Counted on every call rather than cached: both tables are small (an
   * account is a row, and there are hundreds at most), SQLite answers a
   * COUNT over them from the index, and a cached number would be wrong
   * for exactly as long as the cache lives -- right after a registration,
   * which is the one moment somebody looks.
   */
  zaehlen(): { konten: number; charaktere: number } {
    const z = this.db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM konten) AS konten,' +
        ' (SELECT COUNT(*) FROM charaktere) AS charaktere',
      )
      .get() as Record<string, unknown>;
    return { konten: Number(z.konten), charaktere: Number(z.charaktere) };
  }

  /**
   * Rewrite a password record, e.g. after raising the scrypt cost.
   *
   * `erwartet` ist der Eintrag, den der Aufrufer gelesen und geprueft hat:
   * Steht in der Zeile inzwischen ein anderer (etwa weil das Passwort
   * waehrend des Hashens gewechselt wurde), passiert nichts. Ohne diese
   * Bedingung schriebe ein Login, der auf dem alten Passwort beruht, es
   * ueber den Wechsel zurueck. Liefert, ob geschrieben wurde.
   */
  passwortErsetzen(kontoId: number, passwortEintrag: string, erwartet?: string): boolean {
    const r = erwartet === undefined
      ? this.db.prepare('UPDATE konten SET passwort = ? WHERE id = ?').run(passwortEintrag, kontoId)
      : this.db.prepare('UPDATE konten SET passwort = ? WHERE id = ? AND passwort = ?')
        .run(passwortEintrag, kontoId, erwartet);
    return Number(r.changes) > 0;
  }

  // ── Konto-Verwaltung (W3) ───────────────────────────────────────────

  /** Konto samt Passwort-Eintrag, oder null. */
  kontoMitPasswort(id: number): (Konto & { passwort: string }) | null {
    const z = this.db
      .prepare('SELECT id, benutzername, email, passwort, erstellt FROM konten WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!z) return null;
    return {
      id: Number(z.id),
      benutzername: String(z.benutzername),
      email: String(z.email),
      passwort: String(z.passwort),
      erstellt: Number(z.erstellt),
    };
  }

  /** `token_ab` des Kontos, oder null, wenn es das Konto nicht (mehr) gibt. */
  tokenAbVon(kontoId: number): number | null {
    const z = this.db.prepare('SELECT token_ab FROM konten WHERE id = ?')
      .get(kontoId) as Record<string, unknown> | undefined;
    return z ? Number(z.token_ab) : null;
  }

  /**
   * Neues Passwort setzen UND alle bisher ausgestellten Token ungueltig
   * machen — in EINER Anweisung, damit es keinen Zustand mit neuem Passwort
   * und noch gueltigen alten Sitzungen gibt. Nur wenn der Eintrag noch der
   * ist, den der Aufrufer geprueft hat (`erwartet`); sonst false.
   */
  passwortWechseln(kontoId: number, neuerEintrag: string, erwartet: string, tokenAb: number): boolean {
    const r = this.db
      .prepare('UPDATE konten SET passwort = ?, token_ab = MAX(token_ab, ?) WHERE id = ? AND passwort = ?')
      .run(neuerEintrag, tokenAb, kontoId, erwartet);
    return Number(r.changes) > 0;
  }

  /** E-Mail-Adresse setzen, nur wenn das Passwort seit der Pruefung unveraendert ist. */
  emailSetzen(kontoId: number, email: string, erwartetPasswort: string): boolean {
    const r = this.db
      .prepare('UPDATE konten SET email = ? WHERE id = ? AND passwort = ?')
      .run(email, kontoId, erwartetPasswort);
    return Number(r.changes) > 0;
  }

  profilTextVon(kontoId: number): string {
    const z = this.db.prepare('SELECT profil_text FROM konten WHERE id = ?')
      .get(kontoId) as Record<string, unknown> | undefined;
    return z ? String(z.profil_text ?? '') : '';
  }

  profilTextSetzen(kontoId: number, text: string): void {
    this.db.prepare('UPDATE konten SET profil_text = ? WHERE id = ?').run(text, kontoId);
  }

  /**
   * Meldung gegen den Profiltext des Kontos, dem `charakterId` gehoert.
   * Eine je Melder und Konto (eine zweite ersetzt Grund und setzt sie wieder
   * offen). null, wenn der Charakter fehlt oder dem Melder selbst gehoert.
   */
  profilMelden(melderKontoId: number, charakterId: number, grund: string): { ok: true } | { ok: false } {
    const c = this.charakterNachId(charakterId);
    if (!c || c.kontoId === melderKontoId) return { ok: false };
    this.db
      .prepare(`INSERT INTO profil_meldungen (melder_konto_id, gemeldet_konto_id, grund, erstellt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(melder_konto_id, gemeldet_konto_id)
        DO UPDATE SET grund = excluded.grund, erstellt = excluded.erstellt, erledigt = NULL`)
      .run(melderKontoId, c.kontoId, grund, Date.now());
    return { ok: true };
  }

  /** Offene Profil-Meldungen (fuer eine spaetere Moderationsansicht), aelteste zuerst. */
  profilMeldungenOffen(): { id: number; gemeldetKontoId: number; grund: string; erstellt: number }[] {
    return (this.db
      .prepare('SELECT * FROM profil_meldungen WHERE erledigt IS NULL ORDER BY erstellt')
      .all() as Record<string, unknown>[])
      .map((z) => ({
        id: Number(z.id), gemeldetKontoId: Number(z.gemeldet_konto_id),
        grund: String(z.grund), erstellt: Number(z.erstellt),
      }));
  }

  /**
   * Konto samt Charakteren endgueltig loeschen.
   *
   * In EINER Transaktion: die spielerIds der Charaktere kommen auf die Liste
   * der geloeschten (s. `geloeschte_spieler`), die hoechsten Ids ins
   * Hochwasser, dann faellt das Konto und mit ihm per ON DELETE CASCADE
   * jeder Charakter. Meldungen des Kontos und gegen sein Profil gehen mit.
   * Banns bleiben absichtlich stehen (Chronik; `bannListe` kommt mit einem
   * fehlenden Konto zurecht, und Ids werden nie wiederverwendet).
   *
   * Das Passwort ist hier NICHT mehr Sache dieser Methode — die API hat es
   * vorher geprueft. `erwartetPasswort` schuetzt trotzdem vor einem Wechsel
   * zwischen Pruefung und Loeschung.
   */
  kontoLoeschen(kontoId: number, erwartetPasswort: string): GeloeschtesKonto | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const konto = this.kontoMitPasswort(kontoId);
      if (!konto || konto.passwort !== erwartetPasswort) {
        this.db.exec('ROLLBACK');
        return null;
      }
      const charaktere = this.charaktereVonKonto(kontoId);
      const jetzt = Date.now();
      for (const c of charaktere) {
        this.db.prepare('INSERT OR IGNORE INTO geloeschte_spieler (spieler_id, geloescht) VALUES (?, ?)')
          .run(c.spielerId, jetzt);
      }
      this.hochwasserAnheben('konten', kontoId);
      for (const c of charaktere) this.hochwasserAnheben('charaktere', c.id);
      this.db.prepare('DELETE FROM profil_meldungen WHERE melder_konto_id = ? OR gemeldet_konto_id = ?')
        .run(kontoId, kontoId);
      this.db.prepare('DELETE FROM konten WHERE id = ?').run(kontoId);
      this.db.prepare('INSERT OR REPLACE INTO forum_auftraege (konto_id, charakter_ids, namen, erstellt) VALUES (?, ?, ?, ?)')
        .run(kontoId, JSON.stringify(charaktere.map((c) => c.id)),
          JSON.stringify(charaktere.map((c) => c.name)), jetzt);
      this.db.exec('COMMIT');
      return { kontoId, benutzername: konto.benutzername, charaktere };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Forum-Bereinigungen, die noch ausstehen (nach Loeschungen). */
  forumAuftraege(): { kontoId: number; charakterIds: number[]; namen: string[] }[] {
    return (this.db.prepare('SELECT * FROM forum_auftraege ORDER BY erstellt').all() as Record<string, unknown>[])
      .map((z) => ({
        kontoId: Number(z.konto_id),
        charakterIds: JSON.parse(String(z.charakter_ids)) as number[],
        namen: JSON.parse(String(z.namen)) as string[],
      }));
  }

  forumAuftragErledigt(kontoId: number): void {
    this.db.prepare('DELETE FROM forum_auftraege WHERE konto_id = ?').run(kontoId);
  }

  private hochwasserAnheben(tabelle: 'konten' | 'charaktere', id: number): void {
    this.db
      .prepare(`INSERT INTO hochwasser (tabelle, id) VALUES (?, ?)
        ON CONFLICT(tabelle) DO UPDATE SET id = MAX(id, excluded.id)`)
      .run(tabelle, id);
  }

  /** Gehoerte diese spielerId einem inzwischen geloeschten Charakter? */
  istGeloeschterSpieler(spielerId: string): boolean {
    return this.db.prepare('SELECT 1 FROM geloeschte_spieler WHERE spieler_id = ?')
      .get(spielerId) !== undefined;
  }

  // ── Characters ──────────────────────────────────────────────────────

  /**
   * Create a character and mint its identity.
   *
   * The spielerId is generated HERE and never comes from the client --
   * same rule as in NetManager after security review F3. altlastUserId is
   * derived from it and frozen for the character's lifetime, because ZDO
   * ownership in the world save hangs off that number.
   */
  charakterAnlegen(
    kontoId: number,
    name: string,
    aussehen: { figur: string; frisur: string; haarfarbe: string; augenfarbe?: string; klasse?: string; ober: string; beine: string },
  ): { ok: true; charakter: Charakter } | { ok: false; fehler: KontoFehler } {
    const spielerId = spielerIdErzeugen();
    const altlastUserId = BigInt(getStableHash(spielerId) & 0x7fffffff);
    const jetzt = Date.now();
    const voll = { ...aussehen, augenfarbe: aussehen.augenfarbe ?? 'fjordblau', klasse: aussehen.klasse ?? '' };
    try {
      const r = this.db
        .prepare(`INSERT INTO charaktere
          (id, konto_id, spieler_id, altlast_user_id, name, figur, frisur, haarfarbe, augenfarbe, ober, beine, erstellt, klasse)
          VALUES (${naechsteId('charaktere')}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(kontoId, spielerId, altlastUserId.toString(16), name,
             voll.figur, voll.frisur, voll.haarfarbe, voll.augenfarbe,
             voll.ober, voll.beine, jetzt, voll.klasse);
      return {
        ok: true,
        charakter: {
          id: Number(r.lastInsertRowid), kontoId, spielerId, altlastUserId, name,
          ...voll, erstellt: jetzt, zuletztGespielt: null,
        },
      };
    } catch (e) {
      if (String(e).includes('UNIQUE')) return { ok: false, fehler: 'name-taken' };
      throw e;
    }
  }

  /**
   * Find a character by the identity the session token carries.
   *
   * This is what lets the play link be nothing but a ticket. Name and
   * appearance are properties OF THE CHARACTER; sending them along in the
   * address duplicated data the server already owns, and the name in
   * particular was a claim made by the browser.
   */
  charakterZuSpielerId(spielerId: SpielerId): Charakter | null {
    const z = this.db
      .prepare('SELECT * FROM charaktere WHERE spieler_id = ?')
      .get(spielerId) as Record<string, unknown> | undefined;
    return z ? this.zuCharakter(z) : null;
  }

  charaktereVonKonto(kontoId: number): Charakter[] {
    const zeilen = this.db
      .prepare('SELECT * FROM charaktere WHERE konto_id = ? ORDER BY erstellt')
      .all(kontoId) as Record<string, unknown>[];
    return zeilen.map((z) => this.zuCharakter(z));
  }

  charakterVonKonto(kontoId: number, charakterId: number): Charakter | null {
    const z = this.db
      .prepare('SELECT * FROM charaktere WHERE id = ? AND konto_id = ?')
      .get(charakterId, kontoId) as Record<string, unknown> | undefined;
    return z ? this.zuCharakter(z) : null;
  }

  gespieltVermerken(charakterId: number): void {
    this.db.prepare('UPDATE charaktere SET zuletzt_gespielt = ? WHERE id = ?')
      .run(Date.now(), charakterId);
  }

  charakterLoeschen(kontoId: number, charakterId: number): boolean {
    // Hochwasser zuerst: die Id darf nach der Loeschung nie wieder vergeben
    // werden (Forum-Verweise, Avatar, oeffentliche Adresse). Nur fuer eine
    // Zeile dieses Kontos.
    if (!this.charakterVonKonto(kontoId, charakterId)) return false;
    this.hochwasserAnheben('charaktere', charakterId);
    const r = this.db.prepare('DELETE FROM charaktere WHERE id = ? AND konto_id = ?')
      .run(charakterId, kontoId);
    return Number(r.changes) > 0;
  }

  /**
   * Charakter zu einem Namen — die Bruecke vom Adminbefehl zur Bannliste.
   *
   * Ein Admin tippt einen Spielernamen, die Bannliste braucht eine Konto-ID
   * oder eine spielerId. Ohne diese Abfrage muesste der Befehl den Namen im
   * NetManager suchen und koennte damit nur bannen, wer GERADE verbunden
   * ist — genau der Fall, der beim Nachtragen eines Banns nicht gilt.
   *
   * NOCASE liegt schon auf der Spalte, also findet auch "bjorn" den Bjorn.
   */
  charakterNachName(name: string): Charakter | null {
    const z = this.db
      .prepare('SELECT * FROM charaktere WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined;
    return z ? this.zuCharakter(z) : null;
  }

  /**
   * Charakter zu einer Id — fuer den OEFFENTLICHEN Charakterdatensatz
   * (`GET /accounts/characters/:id`) und den Avatar.
   *
   * Oeffentlich heisst: Name und Aussehen, sonst nichts. Konten-Id,
   * spielerId und altlastUserId bleiben hier drin; `nachAussen` in der
   * KontoApi gibt nur weiter, was jeder sehen darf.
   */
  charakterNachId(id: number): Charakter | null {
    const z = this.db.prepare('SELECT * FROM charaktere WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return z ? this.zuCharakter(z) : null;
  }

  // ── Avatar ──────────────────────────────────────────────────────────

  /** Der gewaehlte Avatar dieses Kontos, oder null. */
  avatarVon(kontoId: number): number | null {
    const z = this.db
      .prepare('SELECT avatar_charakter_id FROM konten WHERE id = ?')
      .get(kontoId) as Record<string, unknown> | undefined;
    if (!z || z.avatar_charakter_id === null || z.avatar_charakter_id === undefined) return null;
    return Number(z.avatar_charakter_id);
  }

  /**
   * Setzt den Avatar. `null` loescht die Wahl.
   *
   * Die Zugehoerigkeit zum Konto prueft die API (`charakterVonKonto`), bevor
   * sie hier aufruft — dieselbe Trennung wie beim Bann: Datenbank kennt nur
   * die Zeile, die Regel kennt der Aufrufer. Ein Fremd-Avatar kaeme damit gar
   * nicht erst bis hierher.
   */
  avatarSetzen(kontoId: number, charakterId: number | null): void {
    this.db
      .prepare('UPDATE konten SET avatar_charakter_id = ? WHERE id = ?')
      .run(charakterId, kontoId);
  }

  // ── Bannliste ───────────────────────────────────────────────────────
  //
  // Worauf gebannt wird und warum es drei Arten sind: Kopfkommentar.

  /**
   * Bann setzen oder einen bestehenden ueberschreiben.
   *
   * `bis` ist ein Zeitstempel in ms oder null fuer dauerhaft. Ein bereits
   * abgelaufenes `bis` ist erlaubt und ergibt einen Bann, der sofort nicht
   * mehr wirkt — das ist kein Fehlerfall, sondern dieselbe Rechnung wie bei
   * jedem anderen Zeitpunkt, und der Test nutzt es genau so.
   */
  bannSetzen(
    art: BannArt,
    wert: string,
    angaben: { grund?: string; gesetztVon?: string; bis?: number | null } = {},
  ): Bann {
    const jetzt = Date.now();
    const grund = angaben.grund ?? '';
    const gesetztVon = angaben.gesetztVon ?? '';
    const bis = angaben.bis ?? null;
    // ON CONFLICT statt DELETE+INSERT: der zweite Bann auf denselben
    // Zugang aktualisiert Grund und Frist, ohne dass zwischendurch eine
    // Luecke entsteht, in der niemand gebannt ist.
    this.db
      .prepare(`INSERT INTO banns (art, wert, grund, gesetzt_von, gesetzt, bis)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(art, wert) DO UPDATE SET
          grund = excluded.grund, gesetzt_von = excluded.gesetzt_von,
          gesetzt = excluded.gesetzt, bis = excluded.bis`)
      .run(art, wert, grund, gesetztVon, jetzt, bis);
    const z = this.db
      .prepare('SELECT * FROM banns WHERE art = ? AND wert = ?')
      .get(art, wert) as Record<string, unknown>;
    return this.zuBann(z);
  }

  /** Bann aufheben. false, wenn gar keiner eingetragen war. */
  bannAufheben(art: BannArt, wert: string): boolean {
    const r = this.db.prepare('DELETE FROM banns WHERE art = ? AND wert = ?').run(art, wert);
    return Number(r.changes) > 0;
  }

  /** Ein einzelner, JETZT wirksamer Bann — null, wenn keiner oder abgelaufen. */
  bannPruefen(art: BannArt, wert: string, jetzt = Date.now()): Bann | null {
    const z = this.db
      .prepare('SELECT * FROM banns WHERE art = ? AND wert = ? AND (bis IS NULL OR bis > ?)')
      .get(art, wert, jetzt) as Record<string, unknown> | undefined;
    return z ? this.zuBann(z) : null;
  }

  /**
   * Die eine Frage, die der Spielserver stellt: darf dieser Zugang herein?
   *
   * Nimmt alles, was zum Zeitpunkt der Anmeldung bekannt ist, und prueft
   * alle drei Arten in einem Aufruf — samt dem Umweg spielerId → Charakter
   * → Konto, den NetManager sonst selbst gehen muesste. Genau diesen Umweg
   * soll er nicht kennen: er weiss nichts von Konten (deshalb bekommt er
   * auch nur eine Funktion, nicht die Datenbank).
   *
   * Reihenfolge ist Absicht: der spezifischste Bann zuerst, damit die
   * Ablehnung den Grund nennt, der wirklich gemeint war, und der
   * Herkunftsbann — der Unbeteiligte treffen kann — zuletzt.
   *
   * `herkunft` darf leer sein (dann wird sie nicht geprueft); `spielerId`
   * ebenso, fuer eine Pruefung, bevor eine Identitaet feststeht.
   */
  bannFuerZugang(
    zugang: { spielerId?: string | null; herkunft?: string | null },
    jetzt = Date.now(),
  ): Bann | null {
    const spielerId = zugang.spielerId ?? '';
    if (spielerId && this.istGeloeschterSpieler(spielerId)) {
      // Ein Token, das vor der Kontoloeschung abgeholt wurde: keine Bannzeile,
      // sondern die Liste geloeschter Charaktere (s. `geloeschte_spieler`).
      return {
        id: 0, art: 'spieler', wert: spielerId, grund: 'Konto geloescht', gesetztVon: '',
        gesetzt: jetzt, bis: null,
      };
    }
    if (spielerId) {
      const eigener = this.bannPruefen('spieler', spielerId, jetzt);
      if (eigener) return eigener;
      const charakter = this.charakterZuSpielerId(spielerId as SpielerId);
      if (charakter) {
        const ausKonto = this.bannPruefen('konto', String(charakter.kontoId), jetzt);
        if (ausKonto) return ausKonto;
      }
    }
    const herkunft = zugang.herkunft ?? '';
    if (herkunft) {
      const ausHerkunft = this.bannPruefen('herkunft', herkunft, jetzt);
      if (ausHerkunft) return ausHerkunft;
    }
    return null;
  }

  /** Alle JETZT wirksamen Banns, aeltester zuerst — fuer eine Adminanzeige. */
  bannListe(jetzt = Date.now()): Bann[] {
    const zeilen = this.db
      .prepare('SELECT * FROM banns WHERE bis IS NULL OR bis > ? ORDER BY gesetzt')
      .all(jetzt) as Record<string, unknown>[];
    return zeilen.map((z) => this.zuBann(z));
  }

  /** Abgelaufene Zeilen loeschen; liefert, wie viele es waren. */
  abgelaufeneAufraeumen(jetzt = Date.now()): number {
    const r = this.db.prepare('DELETE FROM banns WHERE bis IS NOT NULL AND bis <= ?').run(jetzt);
    return Number(r.changes);
  }

  private zuBann(z: Record<string, unknown>): Bann {
    return {
      id: Number(z.id),
      art: String(z.art) as BannArt,
      wert: String(z.wert),
      grund: String(z.grund ?? ''),
      gesetztVon: String(z.gesetzt_von ?? ''),
      gesetzt: Number(z.gesetzt),
      bis: z.bis === null || z.bis === undefined ? null : Number(z.bis),
    };
  }

  private zuCharakter(z: Record<string, unknown>): Charakter {
    const spielerId = String(z.spieler_id);
    if (!istSpielerId(spielerId)) {
      // A row that cannot produce a valid identity is a bug, not a user
      // error -- fail loudly rather than hand out a broken token.
      throw new Error(`charaktere.id=${String(z.id)} traegt keine gueltige spielerId`);
    }
    return {
      id: Number(z.id),
      kontoId: Number(z.konto_id),
      spielerId,
      altlastUserId: BigInt(`0x${String(z.altlast_user_id)}`),
      name: String(z.name),
      figur: String(z.figur),
      frisur: String(z.frisur),
      haarfarbe: String(z.haarfarbe ?? ''),
      augenfarbe: String(z.augenfarbe ?? 'fjordblau'),
      klasse: String(z.klasse ?? ''),
      ober: String(z.ober),
      beine: String(z.beine),
      erstellt: Number(z.erstellt),
      zuletztGespielt: z.zuletzt_gespielt === null ? null : Number(z.zuletzt_gespielt),
    };
  }

  schliessen(): void {
    this.db.close();
  }
}
