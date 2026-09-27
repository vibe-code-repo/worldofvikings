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
 * ── B2–B6 (Nachangriff „Editor Upload-Größe N2"): lieber kein Vorschlag
 *    als ein falscher ──────────────────────────────────────────────────
 * N1 hatte reine Teilzeichenketten-Muster mit gezielten negativen
 * Lookaheads gegen BEOBACHTETE Fehltreffer geflickt. N2 stellte das auf
 * „ganzer Bestandteil ODER Kompositum-ENDE" um (CamelCase getrennt) — das
 * behob die damals bekannten Fälle, aber:
 *   - **B2:** „stück" allein in der Zaun-Zeile machte JEDES „…stück"
 *     (Frühstück, Möbelstück, Werkstück, …) zu einem 2-m-Zaun.
 *   - **B3:** CamelCase-Trennung hob die Regel wieder auf — „StandUhr"
 *     (getrennt: „stand"+„uhr", „stand" endet ein Bestandteil) traf
 *     „Marktstand", aber „Standuhr" (ein Bestandteil, endet nicht auf
 *     „stand") traf nicht. Derselbe Gegenstand, zwei Ergebnisse.
 *   - **B4:** Kompositum-ENDE trifft weiterhin Wörter ohne jeden Bezug:
 *     Gegenstand/Zustand/Abstand (enden auf „stand"), Vogelhaus/Puppenhaus
 *     (enden auf „haus"), Skybox/Hitbox (enden auf „box"), Reboot/
 *     Leather_Boot (enthalten „boot").
 *   - **B5/B6:** Blender-/Windows-Suffixe (`Fass.001`, `Kiste(1)`), Plural
 *     (Kisten, Hütten, Boote) und NFD-Schreibweisen (macOS) trafen gar
 *     nicht mehr oder inkonsistent.
 *
 * Die Regel jetzt, wie von der Karte verlangt: **kein Kompositum-Ende mehr,
 * nur noch ganze Wörter aus einer FESTEN LISTE je Kategorie** (Einzahl,
 * Mehrzahl, Deutsch, Englisch). Ein zusammengesetztes Wort trifft NUR, wenn
 * es selbst — als GANZER Bestandteil — auf einer eigenen, von Hand
 * gepflegten Liste steht (`holzfass`, `zaunstück`, `marktstand`, …), nie
 * über ein Wortende. Das löst B2 (kein „stück" mehr, nur noch „zaunstück"/
 * „palisadenstück" als eigene Einträge), B4 (Gegenstand/Zustand/Vogelhaus/
 * Skybox/Reboot sind als GANZES Wort auf keiner Liste) und, zusammen mit
 * der Vorverarbeitung unten, B3/B5/B6.
 *
 * **Vorverarbeitung** (`namensBestandteile`): NFC, dann NFKD (faltet eine
 * ZERLEGT geschriebene Eingabe wie macOS-Dateinamen auf dieselbe Form wie
 * eine ZUSAMMENGESETZTE — B6), Kleinschreibung, ein Blender-Suffix
 * (`.001`) oder eine Windows-Dopplung (`(1)`) am Ende abschneiden (B5),
 * DANACH erst in Bestandteile zerlegen: Leerzeichen, `_`, `-` und jeder
 * Übergang zwischen Buchstabe und Ziffer trennen hart. **CamelCase trennt
 * NICHT mehr** (B3) — „StandUhr" und „Standuhr" ergeben jetzt denselben
 * EINEN Bestandteil „standuhr" und damit dasselbe Ergebnis (kein Treffer,
 * weil „standuhr" auf keiner Liste steht).
 *
 * **Doppelsinnige Kurzwörter** („hut", das englische Wort für eine kleine
 * Hütte, homograph mit der Kopfbedeckung; „boot", homograph mit dem
 * englischen Schuh/Kofferraum) werden nur für die Bedeutung aufgenommen,
 * die als GANZES, ISOLIERTES Wort im Spiel Sinn ergibt: „hut" bleibt in
 * der Haus-Liste (das Kopfbedeckungs-Risiko ist unvermeidbar, aber gering
 * und ausdrücklich gewünscht — B5 verlangt „Wooden Hut" → Haus zurück).
 * Das bloße, einzeln stehende „Boot" (deutsch) fehlt dagegen BEWUSST auf
 * der Liste: Kein Testfall verlangt es, und als isolierter Bestandteil
 * träfe es unweigerlich auch „Leather_Boot" oder „Boot_Left" (Englisch für
 * Schuh) — nur die eindeutige Mehrzahl „Boote"/„boats" und die
 * unzweideutigen Komposita (`drachenboot`, `langschiff`) stehen deshalb auf
 * der Liste. Siehe den Bericht für die als Zweifelsfall genannten Wörter
 * (z. B. Puppenhaus als möglicher Deko-Sonderfall).
 */

export interface Groessenkategorie {
  readonly kategorie: string;
  /**
   * GANZE Wörter (Einzahl/Mehrzahl, Deutsch/Englisch) und ausdrücklich
   * gepflegte Komposita — nie ein Wortanfang, nie ein Wortende, nie eine
   * Wortmitte. Groß-/Kleinschreibung, CamelCase und NFC/NFD sind für den
   * Vergleich gleich (s. `namensBestandteile`).
   */
  readonly worte: readonly string[];
  readonly meter: number;
}

export const GROESSENTABELLE: readonly Groessenkategorie[] = [
  {
    kategorie: 'Haus',
    // Atomar: Haus/Hütte/Halle/Langhaus (eigenständige Wörter des Spiels,
    // kein Kompositum aus zwei ANDEREN Kategoriewörtern), Ein- und
    // Mehrzahl, Deutsch/Englisch, dazu das englische Kurzwort für eine
    // kleine Hütte (Doppelsinn mit Kopfbedeckung akzeptiert, s.
    // Kopfkommentar). Komposita: nur der NFD-Nachweis „Holzhütte".
    worte: [
      'haus', 'häuser', 'haeuser', 'house', 'houses',
      'hütte', 'hütten', 'huette', 'huetten',
      'halle', 'hallen', 'langhaus', 'langhäuser', 'langhaeuser',
      'hut', 'huts',
      'holzhütte', 'holzhuette',
    ],
    meter: 8,
  },
  {
    kategorie: 'Marktstand',
    // Kein bloßes „stand" (zu allgemein, träfe Gegenstand/Zustand/Abstand
    // als GANZES Wort nie, aber ein einzeln hochgeladenes „Stand" ist zu
    // uneindeutig, um 4 m vorzuschlagen). „Markt"/„Bude" bleiben atomar,
    // „Marktstand" ist die ausdrücklich gepflegte Zusammensetzung.
    worte: ['markt', 'market', 'markets', 'bude', 'buden', 'marktstand', 'marktstände', 'marktstaende', 'marktbude', 'marktbuden'],
    meter: 4,
  },
  {
    kategorie: 'Zaunstück',
    // B2: „stück" ist KEIN eigenes Wort mehr — nur die vollen Komposita
    // „zaunstück"/„palisadenstück" (inkl. NFD-Nachweis „Zaunstück").
    worte: ['zaun', 'zäune', 'zaeune', 'fence', 'fences', 'palisade', 'palisaden', 'palisades', 'zaunstück', 'zaunstueck', 'palisadenstück', 'palisadenstueck'],
    meter: 2,
  },
  {
    kategorie: 'Fass',
    worte: ['fass', 'fässer', 'faesser', 'barrel', 'barrels', 'tonne', 'tonnen', 'holzfass', 'holzfässer', 'holzfaesser'],
    meter: 0.7,
  },
  {
    kategorie: 'Kiste',
    worte: ['kiste', 'kisten', 'crate', 'crates', 'truhe', 'truhen', 'kasten', 'kästen', 'kaesten', 'box', 'boxes'],
    meter: 1,
  },
  {
    kategorie: 'Karren',
    worte: ['karren', 'wagen', 'cart', 'carts', 'kutsche', 'kutschen'],
    meter: 3,
  },
  {
    kategorie: 'Boot',
    // Bewusst OHNE bloßes „boot"/„Boot" — s. Kopfkommentar (Doppelsinn mit
    // dem englischen Schuh/Kofferraum, kein Testfall braucht es).
    worte: ['boote', 'boat', 'boats', 'schiff', 'schiffe', 'ship', 'ships', 'drachenboot', 'drachenboote', 'langschiff', 'langschiffe'],
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
 */
function schneideEndungUndNummer(kanonisch: string): string {
  return kanonisch
    .replace(/\s*\([0-9]+\)$/, '') // "kiste(1)" -> "kiste"
    .replace(/\.[a-z0-9]{1,6}$/, ''); // "fass.001" / "haus.glb" -> "fass" / "haus"
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

/** Ob `wort` GENAU einen Bestandteil trifft — nie Anfang, Ende oder Mitte. */
function trifftBestandteil(bestandteile: readonly string[], wort: string): boolean {
  const kanonischesWort = kanon(wort);
  return bestandteile.some((b) => b === kanonischesWort);
}

/**
 * Die erste passende Kategorie für einen Anzeigenamen — `null`, wenn
 * keine passt. „Kein Vorschlag" ist der sichere Normalfall (Auftrag
 * B2–B6: „lieber kein Vorschlag als ein falscher"); die Tabellenreihenfolge
 * entscheidet nur, falls ein Name auf zwei Kategoriewörter zugleich passt
 * (kommt in der Vorgabeliste nicht vor).
 */
export function kategorieFuerName(anzeigename: string): Groessenkategorie | null {
  const bestandteile = namensBestandteile(anzeigename);
  for (const eintrag of GROESSENTABELLE) {
    if (eintrag.worte.some((wort) => trifftBestandteil(bestandteile, wort))) return eintrag;
  }
  return null;
}
