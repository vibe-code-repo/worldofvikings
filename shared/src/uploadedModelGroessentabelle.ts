/**
 * uploadedModelGroessentabelle.ts — kleine Größentabelle je Art, dritte
 * Stufe des Zielgrößen-Vorschlags beim Hochladen (Karte „Editor
 * Upload-Größe", Auftrag Punkt 4b).
 *
 * Reihenfolge des ganzen Vorschlags (s. `uploadedModelGroessenvorschlag.ts`):
 *   (a) ein ähnliches VORHANDENES Prefab über den Namen,
 *   (b) DIESE Tabelle, über ganze Namensbestandteile,
 *   (c) sonst die Rohgröße der Datei.
 *
 * Eine Zeile hier ist ein einziger Meterwert je Art — kein Breite/Höhe-Paar:
 * Mikes Vorgabe („Haus 8 m, Marktstand 4 m, …") nennt nur EINEN Wert, der
 * je nach Bedienung als Ziel-Breite ODER Ziel-Höhe gilt (welche Dimension
 * die Maske gerade steuert, entscheidet der Aufrufer, s.
 * `schlageZielgroesseVor`).
 *
 * ── F5 (Nachangriff „Editor Upload-Größe N1"): gezielte Ausschlüsse reichen
 *    nicht, jedes neue Wort brauchte einen neuen Lookahead ────────────────
 * N1 (Angriff) hatte reine Teilzeichenketten-Muster mit gezielten negativen
 * Lookaheads gegen die damals BEOBACHTETEN Fehltreffer geflickt (`fass(?!
 * ade)`, `stand(?!halter)`, …). Der Nachangriff fand sofort neue Varianten,
 * die kein Lookahead abdeckte: „Fassung" (fass+UNG), „Standuhr" (stand+UHR),
 * „Boxsack" (box+SACK), „Abstandshalter" (mit Fugen-s: stand+SHALTER, der
 * alte Lookahead prüfte nur „halter" direkt danach), „Wagenräder" (Plural,
 * wagen+RÄDER/RAEDER statt „rad"). Jedes neue Wort hätte eine neue
 * Ausnahme gebraucht — ein Muster, das nie fertig wird.
 *
 * Die Regel jetzt: ein Tabellenwort trifft nur, wenn es GENAU einen ganzen
 * Namensbestandteil bildet (CamelCase, Ziffern, `_` und `-` trennen den
 * Namen in Bestandteile) ODER das ENDE eines Bestandteils ist — nie einen
 * Wortanfang, nie eine Wortmitte. Das erklärt beide Richtungen ohne jede
 * Ausnahmeliste:
 *   - „Fassade"/„Fassung" (fass ist der ANFANG, nicht das Ende) → kein Treffer.
 *   - „Standuhr"/„Boxsack"/„Abstandshalter"/„Wagenräder" (das jeweils
 *     verdächtige Wort steht in der MITTE oder am ANFANG) → kein Treffer.
 *   - „Holzfass" (fass ist das ENDE von „holzfass") → Treffer.
 *   - „Marktstand2"/„Marktbude" (stand/bude sind das ENDE) → Treffer.
 *   - „Marktstandzaun" endet auf „zaun", nicht auf „stand" — trifft jetzt
 *     GENAU „Zaunstück", nicht mehr „Marktstand" (Tabellenreihenfolge
 *     entscheidet hier nichts mehr, weil nur noch ein Eintrag passt).
 *   - „Zaunstück"/„Palisadenstück" enden beide auf „stück" (neu in der
 *     Zaunstück-Zeile) — „zaun" selbst steht dort nur als WORTANFANG und
 *     bräuchte eine eigene Ausnahme, „stück" macht das unnötig.
 * „Hut" (Kopfbedeckung) ist aus der Haus-Zeile entfernt: `\bhut\b` aus N1
 * traf zwar gezielt nur das ganze Wort, aber ein Hut ist keine 8-m-Struktur
 * (Faktor ~30, Nachangriff-Befund F5) — kein Ersatzwort dafür.
 */

export interface Groessenkategorie {
  readonly kategorie: string;
  /** Wörter, gegen GANZE Namensbestandteile bzw. das ENDE eines Bestandteils geprüft (Groß-/Kleinschreibung egal). */
  readonly worte: readonly string[];
  readonly meter: number;
}

export const GROESSENTABELLE: readonly Groessenkategorie[] = [
  { kategorie: 'Haus', worte: ['haus', 'huette', 'hütte', 'house', 'langhaus', 'halle'], meter: 8 },
  { kategorie: 'Marktstand', worte: ['markt', 'stand', 'market', 'bude'], meter: 4 },
  { kategorie: 'Zaunstück', worte: ['zaun', 'fence', 'palisade', 'stueck', 'stück'], meter: 2 },
  { kategorie: 'Fass', worte: ['fass', 'barrel', 'tonne'], meter: 0.7 },
  { kategorie: 'Kiste', worte: ['kiste', 'box', 'crate', 'truhe', 'kasten'], meter: 1 },
  { kategorie: 'Karren', worte: ['karren', 'wagen', 'cart', 'kutsche'], meter: 3 },
  { kategorie: 'Boot', worte: ['boot', 'schiff', 'boat', 'ship', 'drachenboot', 'langschiff'], meter: 10 },
];

/**
 * `anzeigename` in Bestandteile zerlegen: Leerzeichen, `_` und `-` trennen
 * hart, dazu jeder CamelCase-Übergang (Kleinbuchstabe → Großbuchstabe) und
 * jeder Übergang zwischen Buchstabe und Ziffer — als Nullbreite-Trennstellen
 * direkt im Split-Muster (`.split()` trennt dort, ohne Zeichen zu
 * verschlucken). Zwei aufeinanderfolgende Großbuchstaben trennen NICHT (eine
 * Abkürzung wie „NPC" bleibt ein Stück) — hier nicht gebraucht, aber ein
 * Randfall, den die Regel richtig macht.
 */
function namensBestandteile(anzeigename: string): readonly string[] {
  return anzeigename
    .split(/[\s_-]+|(?<=[a-zà-öø-ÿ])(?=[A-ZÀ-Ö])|(?<=[A-Za-zÀ-ÖØ-öø-ÿ])(?=[0-9])|(?<=[0-9])(?=[A-Za-zÀ-ÖØ-öø-ÿ])/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);
}

/** Ob `wort` einen ganzen Bestandteil trifft oder das ENDE eines Bestandteils ist — nie Wortanfang/-mitte. */
function trifftBestandteil(bestandteile: readonly string[], wort: string): boolean {
  return bestandteile.some((b) => b === wort || b.endsWith(wort));
}

/**
 * Die erste passende Kategorie für einen Anzeigenamen — `null`, wenn
 * keine passt. Reihenfolge der Tabelle entscheidet nur noch, wenn ein Name
 * auf ZWEI verschiedene Kategoriewörter zugleich endet (kommt in der
 * Vorgabe-Liste nicht vor); die Reihenfolge bleibt trotzdem von SPEZIFISCH
 * nach ALLGEMEIN, nicht alphabetisch.
 */
export function kategorieFuerName(anzeigename: string): Groessenkategorie | null {
  const bestandteile = namensBestandteile(anzeigename);
  for (const eintrag of GROESSENTABELLE) {
    if (eintrag.worte.some((wort) => trifftBestandteil(bestandteile, wort))) return eintrag;
  }
  return null;
}
