/**
 * Alle Angaben zum Anbieter — an EINER Stelle.
 *
 * Impressum und Datenschutzerklärung lesen ausschliesslich von hier. Wer die
 * Daten einträgt, ändert Werte in `ANBIETER`, nichts sonst.
 *
 * Ein Wert, der noch mit `[[` beginnt, ist ein Platzhalter. Solange es einen
 * gibt, ist `MUSTER` wahr: Beide Seiten zeigen oben den Hinweis „Muster,
 * Angaben folgen“ und tragen `noindex`. Sobald der letzte Platzhalter
 * ersetzt ist, verschwindet beides von selbst — es gibt keinen Schalter, den
 * man vergessen könnte.
 *
 * Hier stehen keine erfundenen Angaben: Ein Platzhalter ist ehrlicher als ein
 * Wert, der echt aussieht und es nicht ist.
 */

export interface Anbieter {
  /** Vollständiger Name (bei einer Firma: Firma samt Rechtsform). */
  name: string;
  /** Ladungsfähige Anschrift, Zeilen mit `\n` getrennt. */
  anschrift: string;
  /** E-Mail-Adresse für Kontakt und Datenschutzanfragen. */
  email: string;
  /** Zweiter schneller Kontaktweg (Telefon oder Kontaktformular-Adresse). */
  telefon: string;
  /** Umsatzsteuer-Identifikationsnummer nach § 27a UStG. Gibt es keine, „keine“ eintragen — leer bleibt der Wert nicht. */
  ustId: string;
  /** Verantwortlich für Inhalte nach § 18 Abs. 2 MStV: Name und Anschrift. */
  inhaltlichVerantwortlich: string;
  /** Hosting-Dienstleister samt Standort (Auftragsverarbeiter, Empfänger). */
  hosting: string;
  /** Zuständige Datenschutz-Aufsichtsbehörde (richtet sich nach dem Bundesland). */
  aufsichtsbehoerde: string;
  /** Mindestalter bzw. Regel für Minderjährige, als fertiger Satz. */
  mindestalter: string;
}

export const ANBIETER: Anbieter = {
  name: '[[NAME]]',
  anschrift: '[[STRASSE HAUSNUMMER]]\n[[PLZ ORT]]',
  email: '[[E-MAIL]]',
  telefon: '[[TELEFON]]',
  ustId: '[[UST-ID]]',
  inhaltlichVerantwortlich: '[[NAME UND ANSCHRIFT DES INHALTLICH VERANTWORTLICHEN]]',
  hosting: '[[HOSTING-ANBIETER UND STANDORT]]',
  aufsichtsbehoerde: '[[ZUSTÄNDIGE DATENSCHUTZ-AUFSICHTSBEHÖRDE]]',
  mindestalter: '[[MINDESTALTER UND REGEL FÜR MINDERJÄHRIGE]]',
};

/** Die Namen aller noch offenen Platzhalter — leer, wenn alles gefüllt ist. */
export const OFFENE_PLATZHALTER: string[] = Object.entries(ANBIETER)
  .filter(([, wert]) => wert.includes('[['))
  .map(([schluessel]) => schluessel);

/** Wahr, solange irgendein Wert noch ein Platzhalter ist. */
export const MUSTER: boolean = OFFENE_PLATZHALTER.length > 0;
