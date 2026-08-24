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
  ober: string;
  beine: string;
  erstellt: number;
  zuletztGespielt: number | null;
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
        ober             TEXT NOT NULL DEFAULT '',
        beine            TEXT NOT NULL DEFAULT '',
        erstellt         INTEGER NOT NULL,
        zuletzt_gespielt INTEGER
      );
      CREATE INDEX IF NOT EXISTS charaktere_nach_konto ON charaktere(konto_id);
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
    aussehen: { figur: string; frisur: string; ober: string; beine: string },
  ): { ok: true; charakter: Charakter } | { ok: false; fehler: KontoFehler } {
    const spielerId = spielerIdErzeugen();
    const altlastUserId = BigInt(getStableHash(spielerId) & 0x7fffffff);
    const jetzt = Date.now();
    try {
      const r = this.db
        .prepare(`INSERT INTO charaktere
          (konto_id, spieler_id, altlast_user_id, name, figur, frisur, ober, beine, erstellt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(kontoId, spielerId, altlastUserId.toString(16), name,
             aussehen.figur, aussehen.frisur, aussehen.ober, aussehen.beine, jetzt);
      return {
        ok: true,
        charakter: {
          id: Number(r.lastInsertRowid), kontoId, spielerId, altlastUserId, name,
          ...aussehen, erstellt: jetzt, zuletztGespielt: null,
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
