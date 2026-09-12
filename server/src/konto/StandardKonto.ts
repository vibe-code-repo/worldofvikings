/**
 * The standard account — try the game without registering.
 *
 * `server.yml` `standard-konto:` names one account (default `gast`/`gast`)
 * that every fresh clone or every visitor to a public instance can sign
 * in with immediately, no `/registrieren` needed. This module is the one
 * place that turns that config block into an actual row in
 * `Kontendatenbank`, called once from the `WovServer` constructor, right
 * where the database itself is opened (see the header comment there).
 *
 * ── Why this is idempotent by re-checking, not by an UPSERT ──────────
 * `kontoAnlegen` already rejects a duplicate username (UNIQUE constraint);
 * relying on that would mean hashing a password on every single server
 * start just to throw the hash away. Checking first is also what makes
 * "password unchanged" simple to state: if the account exists, this
 * module never calls `passwortEinlagernSync` again and never writes to
 * the `konten` row at all.
 *
 * ── Why it is synchronous ─────────────────────────────────────────────
 * `passwortEinlagernSync` (Passwort.ts) — see its comment for why the
 * usual async `passwortEinlagern` is not used here: this runs from the
 * `WovServer` constructor, which nothing in this codebase awaits.
 *
 * ── Why this module has never heard of AdminListe ────────────────────
 * Mike's requirement is that the standard account can never be an admin.
 * The simplest version of "never" is structural: this function has no
 * reference to `AdminListe` and therefore cannot add anything to it,
 * regardless of what `standard-konto:` says. The one thing that CAN make
 * the standard account an admin is `players.everyone-admin: true` — that
 * flag makes every connected player an admin, this account included —
 * and `WovServer.init()` already prints a loud warning whenever it is
 * set. The extra warning below repeats that fact specifically for the
 * standard account, because "everyone" easily reads as "the other
 * players" and not "also the one advertised on the website".
 */
import { FIGUR_VORGABE, FRISUR_VORGABE } from '@wov/shared';
import type { Kontendatenbank } from './Kontendatenbank.js';
import { passwortEinlagernSync } from './Passwort.js';

/** The validated `standard-konto:` block (see `ServerKonfig.ts`). */
export interface StandardKontoVorgabe {
  name: string;
  passwort: string;
  charakter: string;
}

/**
 * Placeholder appearance — nobody chose it, so it uses exactly the same
 * defaults `figurZu()`/`frisurZu()` fall back to for any unset value.
 */
const STANDARD_AUSSEHEN = {
  figur: FIGUR_VORGABE,
  frisur: FRISUR_VORGABE,
  haarfarbe: '',
  ober: '',
  beine: '',
};

/**
 * Create the standard account and its character if they are missing.
 * Never touches an existing password. Called once per server start.
 */
export function standardKontoSicherstellen(
  db: Kontendatenbank,
  vorgabe: StandardKontoVorgabe,
  everyoneAdmin: boolean,
): void {
  const bestehend = db.kontoNachName(vorgabe.name);
  let kontoId: number;
  if (bestehend) {
    kontoId = bestehend.id;
    console.log(`[Konto] Standardkonto "${vorgabe.name}" existiert bereits — Passwort bleibt unveraendert`);
  } else {
    const eintrag = passwortEinlagernSync(vorgabe.passwort);
    const angelegt = db.kontoAnlegen(vorgabe.name, 'standardkonto@world-of-vikings.com', eintrag);
    if (!angelegt.ok) {
      // Ein race mit gleichzeitigem echten Startvorgang oder eine
      // Datenbank, die den Namen aus anderem Grund schon vergeben hat --
      // beides darf den Serverstart nicht beenden.
      console.error(
        `[Konto] Standardkonto "${vorgabe.name}" konnte nicht angelegt werden: ${angelegt.fehler}`,
      );
      return;
    }
    kontoId = angelegt.konto.id;
    console.log(`[Konto] Standardkonto "${vorgabe.name}" angelegt`);
  }

  const hatCharakter = db
    .charaktereVonKonto(kontoId)
    .some((c) => c.name.toLowerCase() === vorgabe.charakter.toLowerCase());
  if (!hatCharakter) {
    const c = db.charakterAnlegen(kontoId, vorgabe.charakter, STANDARD_AUSSEHEN);
    if (c.ok) {
      console.log(`[Konto] Standardkonto "${vorgabe.name}": Charakter "${vorgabe.charakter}" angelegt`);
    } else {
      console.error(
        `[Konto] Standardkonto "${vorgabe.name}": Charakter "${vorgabe.charakter}" konnte nicht ` +
          `angelegt werden: ${c.fehler}`,
      );
    }
  }

  // Structural guarantee, not a check: standardKontoSicherstellen never
  // sees an AdminListe and cannot add this account's character to one.
  // The one door that still opens is everyone-admin (see header comment).
  if (everyoneAdmin) {
    console.warn(
      `[Konto] players.everyone-admin ist aktiv — das Standardkonto "${vorgabe.name}" ` +
        'ist dadurch ebenfalls Admin, sobald es sich verbindet.',
    );
  }
}
