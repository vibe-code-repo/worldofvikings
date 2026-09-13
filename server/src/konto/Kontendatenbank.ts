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
        .prepare('INSERT INTO konten (benutzername, email, passwort, erstellt) VALUES (?, ?, ?, ?)')
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

  /** Rewrite a password record, e.g. after raising the scrypt cost. */
  passwortErsetzen(kontoId: number, passwortEintrag: string): void {
    this.db.prepare('UPDATE konten SET passwort = ? WHERE id = ?').run(passwortEintrag, kontoId);
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
          (konto_id, spieler_id, altlast_user_id, name, figur, frisur, haarfarbe, augenfarbe, ober, beine, erstellt, klasse)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
