/**
 * Alle Angaben zum Anbieter — an EINER Stelle.
 *
 * Impressum und Datenschutzerklärung lesen ausschliesslich von hier. Wer die
 * Daten einträgt, ändert Werte in `ANBIETER`, nichts sonst.
 *
 * Ein Wert mit Platzhalter-Klammern (`[[`) ist offen. Ein Pflichtfeld, das fehlt,
 * leer ist oder nur aus Leerraum oder unsichtbaren Zeichen besteht, ebenso (Angriff 1,
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
 * Alle Felder von `Anbieter`. Die Zeilen darunter brechen `npm run check`, wenn
 * ein Feld der Schnittstelle hier fehlt.
 */
export const FELDER = [
  'name',
  'anschrift',
  'email',
  'telefon',
  'ustId',
  'inhaltlichVerantwortlich',
  'hosting',
  'aufsichtsbehoerde',
  'mindestalter',
] as const satisfies readonly (keyof Anbieter)[];
type FehlendeFelder = Exclude<keyof Anbieter, (typeof FELDER)[number]>;
const _alleFelderGelistet: [FehlendeFelder] extends [never] ? true : never = true;
void _alleFelderGelistet;

/**
 * Die ausdrücklich OPTIONALEN Felder. Alles andere ist Pflicht: Ein neues Feld
 * ist damit ohne weiteres Zutun Pflicht. Ein optionales Feld darf leer
 * bleiben, ein Platzhalter darin bleibt trotzdem offen.
 */
export const OPTIONALFELDER: readonly string[] = ['ustId'];

/**
 * Der Kern eines Werts: ohne Leerraum (`\p{White_Space}`, u. a. NBSP) und ohne
 * unsichtbare Formatzeichen (`\p{Cf}`: U+200B, U+200C, U+200D, U+2060,
 * U+180E, U+FEFF …).
 */
export function sichtbarerKern(wert: unknown): string {
  return typeof wert === 'string' ? wert.replace(/[\p{Cf}\p{White_Space}]/gu, '') : '';
}

/**
 * Unsichtbare „Füllbuchstaben“, die zwar Buchstaben sind (`\p{L}`), aber
 * nichts zeigen: Hangul-Füller U+115F, U+1160, U+3164, U+FFA0 und das
 * Braille-Leerzeichen U+2800 (eigentlich `\p{So}`, der Vollständigkeit halber).
 */
const FUELLZEICHEN = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x2800]);

/**
 * Hat der Wert sichtbaren Inhalt? Ein Wert zählt nur dann als gefüllt, wenn
 * sein Kern mindestens einen Buchstaben oder eine Ziffer (`[\p{L}\p{N}]`)
 * enthält, der kein Füllbuchstabe ist. Statt eine Liste unsichtbarer Zeichen
 * immer weiter zu verlängern (Angriff 3), fragt die Prüfung nach dem, was ein
 * echter Wert hat. Nebenwirkung, gewollt: Ein Wert nur aus Satzzeichen („-“,
 * „?“) gilt als leer. Die Seiten nutzen dieselbe Funktion für optionale Felder.
 */
export function hatWert(wert: unknown): boolean {
  for (const zeichen of sichtbarerKern(wert)) {
    if (/[\p{L}\p{N}]/u.test(zeichen) && !FUELLZEICHEN.has(zeichen.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}

/** Platzhalter-Klammern: `[[`, `]]`, `{{`, `}}` (auch `[ [NAME] ]`, siehe Kern). */
const PLATZHALTER = /\[\[|\]\]|\{\{|\}\}/;

/** Enthält der Text Platzhalter-Klammern? (Auch das Prüfskript nutzt das.) */
export function enthaeltPlatzhalter(text: unknown): boolean {
  return PLATZHALTER.test(sichtbarerKern(text));
}

/**
 * Welche Felder sind noch offen? Reine Funktion, deshalb einzeln testbar.
 *
 * Offen ist ein Feld, dessen Kern eine Platzhalter-Klammer enthält
 * (`[[`, `]]`, `{{`, `}}` — also auch `[ [NAME] ]`; in jedem Feld, auch in
 * optionalen), und bei einem Pflichtfeld zusätzlich, wenn es fehlt, kein Text
 * ist oder nicht `hatWert()` ist (kein Buchstabe, keine Ziffer). Pflicht ist jedes Feld, das nicht in
 * `optional` steht, auch eines, das `FELDER` (noch) nicht kennt.
 */
export function offeneFelder(
  angaben: object,
  optional: readonly string[] = OPTIONALFELDER,
): string[] {
  const werte = angaben as Record<string, unknown>;
  const offen: string[] = [];
  for (const schluessel of new Set<string>([...FELDER, ...Object.keys(werte)])) {
    const wert = werte[schluessel];
    if (enthaeltPlatzhalter(wert)) offen.push(schluessel);
    else if (!optional.includes(schluessel) && !hatWert(wert)) offen.push(schluessel);
  }
  return offen;
}

/** Die Namen aller noch offenen Felder — leer, wenn alles gefüllt ist. */
export const OFFENE_PLATZHALTER: string[] = offeneFelder(ANBIETER);

/** Wahr, solange irgendein Feld offen ist. */
export const MUSTER: boolean = OFFENE_PLATZHALTER.length > 0;
