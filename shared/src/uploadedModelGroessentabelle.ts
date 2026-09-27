/**
 * uploadedModelGroessentabelle.ts — kleine Größentabelle je Art, dritte
 * Stufe des Zielgrößen-Vorschlags beim Hochladen (Karte „Editor
 * Upload-Größe", Auftrag Punkt 4b).
 *
 * Reihenfolge des ganzen Vorschlags (s. `uploadedModelGroessenvorschlag.ts`):
 *   (a) ein ähnliches VORHANDENES Prefab über den Namen,
 *   (b) DIESE Tabelle, über ein Namensmuster,
 *   (c) sonst die Rohgröße der Datei.
 *
 * Eine Zeile hier ist ein einziger Meterwert je Art — kein Breite/Höhe-Paar:
 * Mikes Vorgabe („Haus 8 m, Marktstand 4 m, …") nennt nur EINEN Wert, der
 * je nach Bedienung als Ziel-Breite ODER Ziel-Höhe gilt (welche Dimension
 * die Maske gerade steuert, entscheidet der Aufrufer, s.
 * `schlageZielgroesseVor`).
 */

export interface Groessenkategorie {
  readonly kategorie: string;
  /** Namensmuster, gegen den ANZEIGENAMEN geprüft (Groß-/Kleinschreibung egal). */
  readonly muster: RegExp;
  readonly meter: number;
}

export const GROESSENTABELLE: readonly Groessenkategorie[] = [
  { kategorie: 'Haus', muster: /haus|huette|hütte|hut|house|langhaus|halle/i, meter: 8 },
  { kategorie: 'Marktstand', muster: /markt|stand|market|bude/i, meter: 4 },
  { kategorie: 'Zaunstück', muster: /zaun|fence|palisad/i, meter: 2 },
  { kategorie: 'Fass', muster: /fass|barrel|tonne/i, meter: 0.7 },
  { kategorie: 'Kiste', muster: /kiste|box|crate|truhe|kasten/i, meter: 1 },
  { kategorie: 'Karren', muster: /karren|wagen|cart|kutsche/i, meter: 3 },
  { kategorie: 'Boot', muster: /boot|schiff|boat|ship|drachenboot|langschiff/i, meter: 10 },
];

/**
 * Die erste passende Kategorie für einen Anzeigenamen — `null`, wenn
 * keine passt. Reihenfolge der Tabelle entscheidet bei mehreren Treffern
 * (kommt in der Vorgabe-Liste nicht vor, aber z. B. ein „Marktstandzaun"
 * würde so „Marktstand" statt „Zaunstück" — Tabellenreihenfolge ist damit
 * bewusst von SPEZIFISCH nach ALLGEMEIN, nicht alphabetisch).
 */
export function kategorieFuerName(anzeigename: string): Groessenkategorie | null {
  for (const eintrag of GROESSENTABELLE) {
    if (eintrag.muster.test(anzeigename)) return eintrag;
  }
  return null;
}
