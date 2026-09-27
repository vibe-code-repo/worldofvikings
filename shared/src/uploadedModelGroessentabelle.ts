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
    // N4: „boot"/„boat" wieder aufgenommen (s. Kopfkommentar zum dadurch
    // unvermeidbaren Leather_Boot-Doppelsinn), dazu die üblichen
    // Wikinger-/Fischer-Komposita. N5 (Nachangriff N4, Befund A3): „boots"
    // wieder gestrichen — kein deutscher Plural („Boote"), sondern der
    // englische Plural von Schuh/Stiefel. Anders als beim Einzahl-Homograph
    // „boot" (unvermeidbar, weil beide Bedeutungen dasselbe Wort sind) traf
    // „boots" gerade die im Editor übliche Schreibweise für ein PAAR Stiefel
    // (Leather Boots, Iron Boots) und hätte den automatischen Vorschlag
    // (10 m) ungefragt in ein leeres Zielfeld eingetragen — ohne dass „lieber
    // kein Vorschlag" das noch auffängt, weil hier ein FALSCHER Vorschlag
    // entsteht, keiner ausbleibt.
    worte: [
      'boot', 'boote', 'boat', 'boats',
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
 * Eine ECHTE Dateiendung (`.glb`, `.gltf`, `.fbx`, `.obj`), ein
 * Blender-Suffix (`.001`…`.999`) oder eine Windows-Dopplung (`(1)`) am ENDE
 * abschneiden — auch in Kombination und in beliebiger Reihenfolge
 * (`Fass.001(1)`, `Fass(1).001`, `Fass.glb.001`). Läuft NACH der
 * Kanonisierung, also auf bereits kleingeschriebenem Text (deckt „ohne
 * Beachtung der Groß-/Kleinschreibung" ab, ohne ein eigenes `i`-Flag).
 *
 * N5 (Nachangriff N4, Befund A2): Die alte Fassung schnitt JEDES 1–6
 * Zeichen lange Wort nach einem Punkt ab (`/\.[a-z0-9]{1,6}$/`) — „Neues"
 * blieb aus „Neues.Fass" nie übrig, weil „.Fass" selbst als Endung galt,
 * und `Boot.links` wurde zu „Boot", weil „.links" ebenfalls durchging. Die
 * Karte verlangt jetzt eine FESTE Liste echter Endungen. Ein Punkt, der
 * KEINER dieser Endungen bzw. keinem Suffixmuster vorausgeht, bleibt daher
 * stehen — `namensBestandteile` trennt ihn wie Leerzeichen/`_`/`-` (unten),
 * damit „Neues.Fass" trotzdem in die Bestandteile „neues" und „fass"
 * zerfällt und „fass" als Kopfwort zählt.
 *
 * Die Schleife wendet alle drei Muster wiederholt an, bis sich nichts mehr
 * ändert (höchstens 5 Durchläufe, weit über jeder realistischen
 * Verkettung) — das deckt jede Reihenfolge (Endung vor/nach Nummer vor/nach
 * Klammer) mit drei einfachen, am Ende verankerten Mustern ohne
 * Mehrdeutigkeit ab, keines davon rückverfolgt quadratisch (N3-2 bleibt
 * behoben, s. Test Abschnitt 10).
 */
function schneideEndungUndNummer(kanonisch: string): string {
  let s = kanonisch;
  for (let i = 0; i < 5; i++) {
    const vorher = s;
    s = s.replace(/\.(glb|gltf|fbx|obj)$/, ''); // echte Endung
    s = s.replace(/\.\d{3}$/, ''); // Blender-Suffix .001….999
    s = s.trimEnd().replace(/\(\d+\)$/, '').trimEnd(); // Windows-Dopplung "(1)"
    if (s === vorher) break;
  }
  return s;
}

/**
 * `anzeigename` in Bestandteile zerlegen: erst NFC+NFKD+Kleinschreibung
 * (`kanon`), dann Endung/Suffix/Nummer abschneiden
 * (`schneideEndungUndNummer`), dann an Leerzeichen, `_`, `-`, **`.`** (N5,
 * s. Kopfkommentar von `schneideEndungUndNummer`) und jedem Übergang
 * zwischen Buchstabe und Ziffer trennen. **CamelCase trennt NICHT** (B3) —
 * nach `kanon()` gibt es ohnehin keine Großbuchstaben mehr, die Regel ist
 * also strukturell ausgeschlossen, nicht nur unterlassen.
 */
function namensBestandteile(anzeigename: string): readonly string[] {
  const vorbereitet = schneideEndungUndNummer(kanon(anzeigename));
  return vorbereitet
    .split(/[\s_.-]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/)
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
