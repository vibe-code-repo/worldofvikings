/**
 * uploadedModelGroessentabelle.ts — kleine Größentabelle je Art, dritte
 * Stufe des Zielgrößen-Vorschlags beim Hochladen (Karte „Editor
 * Upload-Größe", Auftrag Punkt 4b).
 *
 * Reihenfolge des ganzen Vorschlags (s. `uploadedModelGroessenvorschlag.ts`):
 *   (a) ein ähnliches VORHANDENES Prefab über den Namen,
 *   (b) DIESE Tabelle, über ganze Namensbestandteile aus einer festen Liste,
 *   (c) sonst die Rohgröße der Datei.
 *
 * Eine Zeile hier ist ein einziger Meterwert je Art — kein Breite/Höhe-Paar:
 * Mikes Vorgabe („Haus 8 m, Marktstand 4 m, …") nennt nur EINEN Wert, der
 * je nach Bedienung als Ziel-Breite ODER Ziel-Höhe gilt (welche Dimension
 * die Maske gerade steuert, entscheidet der Aufrufer, s.
 * `schlageZielgroesseVor`).
 *
 * ── N4 (Nachangriff „Editor Upload-Größe N3", Befund N3-3): das KOPFWORT,
 *    nicht irgendein Bestandteil ─────────────────────────────────────────
 * B2–B6 (N2) stellten auf „ganzer Bestandteil aus einer festen Liste" um,
 * aber JEDER Bestandteil zählte gleich — „Haus Tür", „Bird House" und
 * „Hit Box" trafen dadurch über ihr ERSTES bzw. ein mittleres Wort, obwohl
 * das eigentlich gemeinte Objekt (Tür, Vogelhaus als Deko, Trefferzone) ein
 * ganz anderes ist. Auf Deutsch UND Englisch steht das namensgebende Wort
 * (Grundwort/Kopfwort) bei einer Wortgruppe zuletzt: „Haus-Tür" ist eine
 * Tür, „Bird House" ein House. Jetzt zählt nur noch der LETZTE Bestandteil,
 * der keine reine Zahl ist (Zahlen sind Instanz-Zähler wie in
 * „Marktstand2" oder „Fass (3)", nie das Kopfwort). Zusammengesetzte
 * Wörter wie „Marktbude Nord" oder „Drachenboot Rot", bei denen das
 * Kategoriewort selbst VOR einem Zusatz steht (Himmelsrichtung, Farbe),
 * bleiben nur über ihre eigene Umbenennung als Kopfwort erreichbar — siehe
 * Test, Abschnitt 3, und die ABWEICHUNGEN im Bericht.
 *
 * „hut" (Englisch, homograph mit der Kopfbedeckung) fliegt aus der
 * Haus-Liste: Die Karte N4 nimmt die N3-Vorgabe „Wooden Hut → Haus"
 * ausdrücklich zurück, weil Englisch „hut" die Lücke über „Hütte" nicht
 * aufwiegt. Aus demselben Grund („zu häufiges, zu generisches Kurzwort
 * eines fremden Vokabulars") fliegen „house"/„houses" und „box"/„boxes"
 * ebenfalls heraus: Als KOPFWORT träfen „Bird House"/„Dog House"/
 * „Tree House"/„Doll House" bzw. „Hit Box"/„Sky Box"/„Bounding Box"/
 * „Collision Box" sonst unweigerlich, obwohl das keine 8-m-Häuser oder
 * 1-m-Kisten sind, sondern Spielentwickler-Jargon bzw. Miniaturdeko. Die
 * deutschen Wörter „haus"/„häuser"/„kiste"/„kisten" bleiben unverändert –
 * betroffen sind nur die englischen Kurzwörter.
 *
 * „Boot"/„boat" sind — anders als in N3 — wieder in der Liste (Auftrag
 * N4, N3-3: „das fehlte, entgegen der Karte N3"). Das öffnet unvermeidbar
 * wieder den Doppelsinn mit dem englischen Schuh: „Leather_Boot" hat
 * „boot" als eigenes, LETZTES Wort (Kopfwort „ein Boot aus Leder") und
 * trifft jetzt „Boot" (10 m) — ein Homograph zwischen zwei Sprachen lässt
 * sich rein über den Text nicht auflösen, sobald das Wort selbst gebraucht
 * wird. Siehe ABWEICHUNGEN im Bericht.
 */

export interface Groessenkategorie {
  readonly kategorie: string;
  /**
   * GANZE Wörter (Einzahl/Mehrzahl, Deutsch/Englisch) und ausdrücklich
   * gepflegte Komposita — geprüft wird nur gegen das KOPFWORT (den letzten,
   * nicht rein numerischen Bestandteil), nie gegen einen anderen. Groß-/
   * Kleinschreibung, CamelCase und NFC/NFD sind für den Vergleich gleich
   * (s. `namensBestandteile`).
   */
  readonly worte: readonly string[];
  readonly meter: number;
}

export const GROESSENTABELLE: readonly Groessenkategorie[] = [
  {
    kategorie: 'Haus',
    // Atomar: Haus/Hütte/Halle/Langhaus, Ein- und Mehrzahl, Deutsch. Kein
    // „house"/„hut" mehr (Kopfkommentar) — dazu die Holz-/Bauern-/
    // Fischer-Komposita aus N4-3.
    worte: [
      'haus', 'häuser', 'haeuser',
      'hütte', 'hütten', 'huette', 'huetten',
      'halle', 'hallen',
      'langhaus', 'langhäuser', 'langhaeuser',
      'holzhütte', 'holzhuette', 'holzhaus', 'holzhäuser', 'holzhaeuser',
      'bauernhaus', 'bauernhäuser', 'bauernhaeuser',
      'fischerhütte', 'fischerhuette',
    ],
    meter: 8,
  },
  {
    kategorie: 'Marktstand',
    // Kein bloßes „stand" (zu allgemein, träfe Gegenstand/Zustand/Abstand
    // als GANZES Wort nie, aber ein einzeln hochgeladenes „Stand" ist zu
    // uneindeutig, um 4 m vorzuschlagen). „Markt"/„Bude" bleiben atomar,
    // „Marktstand"/„Marktbude" sind die ausdrücklich gepflegten Zusammensetzungen.
    worte: ['markt', 'market', 'markets', 'bude', 'buden', 'marktstand', 'marktstände', 'marktstaende', 'marktbude', 'marktbuden'],
    meter: 4,
  },
  {
    kategorie: 'Zaunstück',
    // B2: „stück" ist KEIN eigenes Wort mehr — nur die vollen Komposita
    // „zaunstück"/„palisadenstück" (inkl. NFD-Nachweis „Zaunstück") sowie
    // „holzzaun" (N4-3).
    worte: [
      'zaun', 'zäune', 'zaeune', 'fence', 'fences',
      'palisade', 'palisaden', 'palisades',
      'zaunstück', 'zaunstueck', 'palisadenstück', 'palisadenstueck',
      'holzzaun', 'holzzäune', 'holzzaeune',
    ],
    meter: 2,
  },
  {
    kategorie: 'Fass',
    worte: [
      'fass', 'fässer', 'faesser', 'barrel', 'barrels', 'tonne', 'tonnen',
      'holzfass', 'holzfässer', 'holzfaesser',
      'bierfass', 'bierfässer', 'bierfaesser',
      'weinfass', 'weinfässer', 'weinfaesser',
    ],
    meter: 0.7,
  },
  {
    kategorie: 'Kiste',
    // Kein „box"/„boxes" mehr (Kopfkommentar) — „crate"/„truhe"/„kasten"
    // decken das Englische/Deutsche weiter ab, dazu die Holz-Komposita.
    worte: [
      'kiste', 'kisten', 'crate', 'crates', 'truhe', 'truhen',
      'kasten', 'kästen', 'kaesten',
      'schatztruhe', 'schatztruhen',
      'holzkiste', 'holzkisten', 'holztruhe', 'holztruhen',
    ],
    meter: 1,
  },
  {
    kategorie: 'Karren',
    worte: ['karren', 'wagen', 'cart', 'carts', 'kutsche', 'kutschen', 'handkarren', 'ochsenkarren'],
    meter: 3,
  },
  {
    kategorie: 'Boot',
    // N4: „boot"/„boots"/„boat" wieder aufgenommen (s. Kopfkommentar zum
    // dadurch unvermeidbaren Leather_Boot-Doppelsinn), dazu die üblichen
    // Wikinger-/Fischer-Komposita.
    worte: [
      'boot', 'boote', 'boots', 'boat', 'boats',
      'schiff', 'schiffe', 'ship', 'ships',
      'drachenboot', 'drachenboote', 'langschiff', 'langschiffe',
      'ruderboot', 'ruderboote',
      'wikingerschiff', 'wikingerschiffe', 'wikingerboot', 'wikingerboote',
      'fischerboot', 'fischerboote',
    ],
    meter: 10,
  },
];

/** NFC (setzt eine zerlegte Eingabe zu EINEM Zeichen zusammen), dann NFKD, dann Kleinschreibung — dieselbe kanonische Form für Wort UND Vergleichsliste. */
function kanon(s: string): string {
  return s.normalize('NFC').normalize('NFKD').toLowerCase();
}

/**
 * Einen Blender-Suffix (`.001`, auch echte Dateiendungen wie `.glb`) bzw.
 * eine Windows-Dopplung (`(1)`) am ENDE abschneiden (B5). Läuft NACH der
 * Kanonisierung, also auf bereits kleingeschriebenem Text.
 *
 * N4 (Nachangriff N3, Befund N3-2): Die alte Reihenfolge prüfte zuerst
 * `\s*\([0-9]+\)$` — ein UNBEGRENZTES `\s*` unmittelbar vor einem starren
 * Literal `(`. Bei sehr vielen Leerzeichen ohne folgendes `(` probiert die
 * Engine dafür jede mögliche Aufteilung der Leerzeichen durch, bevor sie
 * aufgibt (quadratisch: 100 000 Leerzeichen + „(x" brauchten ~13 s). Die
 * Reihenfolge jetzt: erst die Dateiendung (fester, kurzer Rest am Ende,
 * kein Leerraum-Rückstau möglich), dann EIN lineares `trimEnd()` statt
 * eines `\s*` im Muster, dann `(n)$` ohne führendes `\s*` — jeder Schritt
 * einzeln linear in der Länge der Eingabe.
 */
function schneideEndungUndNummer(kanonisch: string): string {
  return kanonisch
    .replace(/\.[a-z0-9]{1,6}$/, '') // "fass.001" / "haus.glb" -> "fass" / "haus"
    .trimEnd()
    .replace(/\([0-9]+\)$/, '') // "kiste(1)" -> "kiste" (Leerraum davor schon per trimEnd weg)
    .trimEnd();
}

/**
 * `anzeigename` in Bestandteile zerlegen: erst NFC+NFKD+Kleinschreibung
 * (`kanon`), dann Dateiendung/Nummer abschneiden (`schneideEndungUndNummer`),
 * dann an Leerzeichen, `_`, `-` und jedem Übergang zwischen Buchstabe und
 * Ziffer trennen. **CamelCase trennt NICHT** (B3) — nach `kanon()` gibt es
 * ohnehin keine Großbuchstaben mehr, die Regel ist also strukturell
 * ausgeschlossen, nicht nur unterlassen.
 */
function namensBestandteile(anzeigename: string): readonly string[] {
  const vorbereitet = schneideEndungUndNummer(kanon(anzeigename));
  return vorbereitet
    .split(/[\s_-]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/)
    .filter((s) => s.length > 0);
}

/**
 * Das Kopfwort (N4/N3-3): der LETZTE Bestandteil, der nicht rein aus
 * Ziffern besteht — eine angehängte Nummer („Marktstand2", „Fass 3") ist
 * ein Instanz-Zähler, nie das namensgebende Wort. `null`, wenn kein
 * solcher Bestandteil übrig ist (z. B. der Name war nur eine Zahl).
 */
function kopfwort(bestandteile: readonly string[]): string | null {
  for (let i = bestandteile.length - 1; i >= 0; i--) {
    if (!/^[0-9]+$/.test(bestandteile[i]!)) return bestandteile[i]!;
  }
  return null;
}

/**
 * Die erste passende Kategorie für einen Anzeigenamen — `null`, wenn
 * keine passt. „Kein Vorschlag" ist der sichere Normalfall (Auftrag
 * B2–B6/N4: „lieber kein Vorschlag als ein falscher"); die Tabellenreihenfolge
 * entscheidet nur, falls ein Kopfwort auf zwei Kategorien zugleich passt
 * (kommt in der Vorgabeliste nicht vor).
 */
export function kategorieFuerName(anzeigename: string): Groessenkategorie | null {
  const kopf = kopfwort(namensBestandteile(anzeigename));
  if (kopf === null) return null;
  for (const eintrag of GROESSENTABELLE) {
    if (eintrag.worte.some((wort) => kopf === kanon(wort))) return eintrag;
  }
  return null;
}
