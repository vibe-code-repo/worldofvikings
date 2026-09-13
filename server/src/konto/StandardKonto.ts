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
 * ── Why this module STILL has never heard of AdminListe ──────────────
 * Mike's original requirement was that the standard account can never be
 * an admin, and the guarantee was structural: this function has no
 * reference to `AdminListe` and therefore cannot add anything to it,
 * regardless of what `standard-konto:` says.
 *
 * Am 13.09.2026 hat Mike das fuer EIN Konto zurueckgenommen: Der
 * Anfangszustand einer frischen Installation soll ein Konto `admin` mit
 * Adminrechten sein ("es ist ja nur der initiale Zustand"), weil
 * `players.everyone-admin: true` — bis dahin der einzige Adminweg — jeden
 * Besucher zum Admin machte und der Server oeffentlich erreichbar ist.
 *
 * Die strukturelle Garantie bleibt trotzdem stehen, und zwar bewusst
 * genau in dieser Form: Dieses Modul vergibt weiterhin KEINE Rechte. Es
 * kennt `AdminListe` nach wie vor nicht, es importiert sie nicht und es
 * schreibt sie nicht. Was es tut, ist BERICHTEN — es gibt dem Aufrufer
 * die spielerIds der Charaktere zurueck, und zwar ausschliesslich fuer
 * ein Konto, dessen Block `admin: true` traegt. Eintragen tut sie der
 * `WovServer`-Konstruktor.
 *
 * Der Unterschied ist nicht kosmetisch: Fuer jedes NICHT markierte Konto
 * (`gast`, `guest` — die beiden, die auf der Anmeldeseite stehen) ist die
 * Garantie unveraendert strukturell. Dieses Modul liefert fuer sie eine
 * leere Liste, und selbst ein Fehler im Aufrufer koennte sie deshalb
 * nicht zu Admins machen. Genau das prueft `server/test/standard-konto.ts`
 * als die wichtigere der beiden Zusagen.
 *
 * Die zweite Tuer, `players.everyone-admin: true`, steht seit demselben
 * Tag auf `false` (server.yml) — die Warnung unten bleibt fuer den Fall,
 * dass jemand sie wieder aufmacht.
 */
import { FIGUR_VORGABE, FRISUR_VORGABE } from '@wov/shared';
import type { SpielerId } from '../net/Identitaet.js';
import type { Kontendatenbank } from './Kontendatenbank.js';
import { passwortEinlagernSync } from './Passwort.js';

/**
 * Das dokumentierte Anfangspasswort des Adminkontos.
 *
 * EN: the password this repository ships with. It stands in `server.yml`,
 * in `README.md` and in `docs/server-setup.md` — that is what makes it
 * "documented", and what makes an instance still using it a wide open
 * door. Diese Konstante ist die eine Wahrheit dafuer: `ServerKonfig`
 * setzt sie beim Lesen als Vergleichswert ein, `WovServer.init()` warnt
 * daran, und der Test prueft gegen sie statt gegen ein abgeschriebenes
 * Zeichenkettenliteral.
 */
export const ADMINKONTO_STANDARDPASSWORT = 'admin';

/**
 * Umgebungsvariable, mit der ein Betreiber das Passwort des Adminkontos
 * setzt, OHNE eine getrackte Datei zu aendern. Ausgewertet wird sie in
 * `ServerKonfig.ts` (dort steht auch die ausfuehrliche Begruendung,
 * warum Umgebung und nicht server.yml und warum ADMINKONTO_ statt
 * ADMIN_); hier steht nur der NAME, weil `WovServer` ihn in seiner
 * Startwarnung nennen muss und ein Wert-Import aus `ServerKonfig` ein
 * Ringschluss waere.
 */
export const ADMINKONTO_PASSWORT_ENV = 'WOV_ADMINKONTO_PASSWORT';

/** The validated `standard-konto:` block (see `ServerKonfig.ts`). */
export interface StandardKontoVorgabe {
  name: string;
  passwort: string;
  charakter: string;
  /**
   * `admin: true` in server.yml — die Charaktere dieses Kontos gehoeren
   * auf die Admin-Liste. Fehlt der Schluessel, ist er `false`: ein alter
   * `standard-konto:`-Block bekommt durch ein Update dieser Leseschicht
   * niemals stillschweigend Rechte dazu.
   */
  admin?: boolean;
}

/**
 * Was ein Aufruf ueber das Konto zu berichten hat. Kein Zustand, keine
 * Wirkung — nur das, was der Aufrufer wissen muss, um Rechte zu vergeben
 * und um zu warnen (siehe Kopfkommentar, Abschnitt AdminListe).
 */
export interface StandardKontoBericht {
  /**
   * Die Charaktere, die Admin werden sollen — LEER, ausser der Block
   * traegt `admin: true`. Enthaelt ALLE Charaktere des Kontos, nicht nur
   * den aus der Konfiguration: Wer sich auf dem Adminkonto einen zweiten
   * Charakter anlegt, erwartet zu Recht, dass auch der Admin ist.
   */
  adminCharaktere: { spielerId: SpielerId; name: string }[];
  /** Das Konto gab es beim Start noch nicht (erste Installation). */
  neuAngelegt: boolean;
  /**
   * Das Konto ist als Admin markiert UND die Konfiguration nennt das
   * dokumentierte Standardpasswort. Sagt NICHTS ueber das gespeicherte
   * Passwort eines bestehenden Kontos aus — das liest hier niemand (und
   * koennte es auch nicht, es ist ein scrypt-Hash). Siehe die Warnung in
   * `WovServer.init()`, die beide Faelle auseinanderhaelt.
   */
  standardpasswortInKonfig: boolean;
}

/**
 * Placeholder appearance — nobody chose it, so it uses exactly the same
 * defaults `figurZu()`/`frisurZu()` fall back to for any unset value.
 */
const STANDARD_AUSSEHEN = {
  figur: FIGUR_VORGABE,
  frisur: FRISUR_VORGABE,
  haarfarbe: '',
  augenfarbe: 'fjordblau',
  ober: '',
  beine: '',
};

/** Der leere Bericht — ein Konto, das es nicht gibt, macht niemanden zum Admin. */
const KEIN_BERICHT: StandardKontoBericht = {
  adminCharaktere: [],
  neuAngelegt: false,
  standardpasswortInKonfig: false,
};

/**
 * Create the standard account and its character if they are missing.
 * Never touches an existing password. Called once per server start.
 *
 * @returns was der Aufrufer daraus zu machen hat (siehe
 *          `StandardKontoBericht`) — diese Funktion selbst vergibt keine
 *          Rechte, sie kennt die AdminListe nicht.
 */
export function standardKontoSicherstellen(
  db: Kontendatenbank,
  vorgabe: StandardKontoVorgabe,
  everyoneAdmin: boolean,
): StandardKontoBericht {
  const bestehend = db.kontoNachName(vorgabe.name);
  let kontoId: number;
  let neuAngelegt = false;
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
      return KEIN_BERICHT;
    }
    kontoId = angelegt.konto.id;
    neuAngelegt = true;
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

  if (everyoneAdmin) {
    console.warn(
      `[Konto] players.everyone-admin ist aktiv — das Standardkonto "${vorgabe.name}" ` +
        'ist dadurch ebenfalls Admin, sobald es sich verbindet.',
    );
  }

  // Structural guarantee, not a check (siehe Kopfkommentar): dieses Modul
  // sieht keine AdminListe und kann niemanden eintragen. Fuer ein NICHT
  // markiertes Konto ist die Liste hier leer — es gibt also gar nichts,
  // was der Aufrufer eintragen koennte, selbst wenn er wollte.
  if (!vorgabe.admin) return { adminCharaktere: [], neuAngelegt, standardpasswortInKonfig: false };

  const adminCharaktere = db
    .charaktereVonKonto(kontoId)
    .map((c) => ({ spielerId: c.spielerId, name: c.name }));
  return {
    adminCharaktere,
    neuAngelegt,
    standardpasswortInKonfig: vorgabe.passwort === ADMINKONTO_STANDARDPASSWORT,
  };
}
