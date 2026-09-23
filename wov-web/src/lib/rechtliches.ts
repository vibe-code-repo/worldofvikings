/**
 * Alle Angaben zum Anbieter — an EINER Stelle.
 *
 * Impressum und Datenschutzerklärung lesen ausschliesslich von hier. Wer die
 * Daten einträgt, ändert Werte in `ANBIETER`, nichts sonst.
 *
 * Ein Wert, der `[[` enthält, ist ein Platzhalter. Ein Pflichtfeld, das fehlt,
 * leer ist oder nur aus Leerraum besteht, gilt ebenso als offen (Angriff 1,
 * Befund M1: ein leerer String hebelte die alte `[[`-Prüfung aus). Solange
 * es ein offenes Feld gibt, ist `MUSTER` wahr: Beide Seiten zeigen oben den Hinweis „Muster,
 * Angaben folgen“ und tragen `noindex`. Sobald das letzte offene Feld
 * gefüllt ist, verschwindet beides von selbst — es gibt keinen Schalter, den
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
  /** Umsatzsteuer-Identifikationsnummer nach § 27a UStG. OPTIONAL: Wer keine hat, lässt den Wert leer, dann entfällt der Abschnitt im Impressum. */
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

/**
 * Die Felder, ohne die weder Impressum noch Datenschutzerklärung veröffentlicht
 * werden dürfen. `ustId` fehlt hier mit Absicht: Sie ist optional.
 */
export const PFLICHTFELDER: readonly (keyof Anbieter)[] = [
  'name',
  'anschrift',
  'email',
  'telefon',
  'inhaltlichVerantwortlich',
  'hosting',
  'aufsichtsbehoerde',
  'mindestalter',
];

/**
 * Welche Felder sind noch offen? Reine Funktion, deshalb einzeln testbar.
 *
 * Offen ist ein Wert, der `[[` enthält (in jedem Feld, auch in optionalen),
 * und bei einem Pflichtfeld zusätzlich ein Wert, der fehlt, kein Text ist, leer
 * ist oder nur aus Leerraum besteht. Ein optionales Feld darf leer bleiben.
 */
export function offeneFelder(
  angaben: Partial<Record<keyof Anbieter, unknown>>,
  pflicht: readonly string[] = PFLICHTFELDER,
): string[] {
  const offen: string[] = [];
  for (const schluessel of new Set([...pflicht, ...Object.keys(angaben)])) {
    const wert = angaben[schluessel as keyof Anbieter];
    const text = typeof wert === 'string' ? wert : null;
    const istPflicht = pflicht.includes(schluessel);
    const fehlt = text === null || text.trim() === '';
    if (text?.includes('[[')) offen.push(schluessel);
    else if (istPflicht && fehlt) offen.push(schluessel);
  }
  return offen;
}

/** Die Namen aller noch offenen Felder — leer, wenn alles gefüllt ist. */
export const OFFENE_PLATZHALTER: string[] = offeneFelder(ANBIETER);

/** Wahr, solange irgendein Feld offen ist. */
export const MUSTER: boolean = OFFENE_PLATZHALTER.length > 0;
