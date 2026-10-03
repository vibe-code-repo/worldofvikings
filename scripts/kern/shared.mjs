/**
 * Testliste, Bereich `shared`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `shared/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `shared`: the KERN entries whose path starts with `shared/`, sorted by full path.
 */

export default [
  // G1-Durchsicht: B5 modernes AshLands-Noise hinter dem Feature-Flag
  // (Legacy-Pfad unveraendert, Lava-Maske in [0,1] und variiert,
  // preGeneration bleibt zwischen den Modi identisch, das Terrain aendert
  // sich wirklich). Reine Funktion, Sekunden.
  ['shared', 'test/b5-ashlands-modern.ts'],
  ['shared', 'test/bausatz-aufloesen.ts'],
  ['shared', 'test/bausatz-format.ts'],
  ['shared', 'test/bausatz-welt.ts'],
  ['shared', 'test/bauteile-kosten.ts'],
  /*
    Bewegungsschritt und Serverkollision: die reinen Regeln (Akkumulator,
    Gleiten, Wand-gegen-Hang, Bodenkleben) und die Strahlabfrage gegen
    Kiste, Kapsel und Netz — einmal ohne Welt, einmal ueber
    `handlePlayerInput` mit echten ZDOs und gestellter Uhr.

    Der wichtigste Eintrag der beiden ist der Regressionsteil: Mit LEERER
    Formquelle muss der Server nach 100 Eingabepaketen auf derselben
    Stelle stehen wie der Bestand vor dem Umbau. Ohne ihn liesse sich der
    Rueckfallweg („noch keine Formen") nur behaupten.

    Der Serverteil misst ausserdem die Kosten der Abfrage bei 200 Formen
    in Reichweite und wird rot, wenn sie ueber 1 ms je Paket steigen —
    die Zahl steht in der Ausgabe, damit eine Verschlechterung sichtbar
    ist, bevor sie die Grenze reisst. ~6 s zusammen, kein Netz.

    Fixed movement step and server-side collision: pure rules plus ray
    queries against box, capsule and mesh; includes the empty-source
    regression and the per-packet cost measurement.
  */
  ['shared', 'test/bewegung-schritt.ts'],
  // greyglen light and fog: its own clear-weather state (sun, ground light, fog) for biome 128 only, other biomes and the night unchanged. <1 s.
  ['shared', 'test/biom-greyglen-licht.ts'],
  // New biome bit 128 (greyglen): bit, names, region, sanitizer, ground tile, weather as a copy of grassland. <1 s.
  ['shared', 'test/biom-greyglen.ts'],
  /*
    Karte B4 (2026-09-29): Schrittgeraeusche je Untergrund.
    `shared/test/boden-mischung.ts` rechnet die Bodenmischung
    (shared/src/worldgen/bodenMischung.ts) an 676 Punkten der echten Insel
    gegen eine unabhaengige Nachrechnung der Shaderformel (Literale statt
    RAMPEN; <= 1e-6 je Anteil) und prueft am Quelltext, dass der Shader die
    gemeinsamen Konstanten benutzt. ~5 s, keine Assets.
  */
  ['shared', 'test/boden-mischung.ts'],
  /*
    Data references: no dangling prefab references in the dungeon data (room
    furnishing, door types, `childViews` indices) and environment names that
    stay paired between the `ENV_*` literals, the dungeon mapping and
    `envData.json`. A half-done rename or removal falls back silently at run
    time; this makes it loud. Pure data, ~1 s.
  */
  ['shared', 'test/daten-verweise.ts'],
  // `flattenRooms`: Layout → Prefab-Instanzen für eine ANSICHT, mit dem
  // statischen Wächter, dass `dungeonKanten.ts` dafür NICHTS aus
  // `dungeonFlatten.ts`/`roomPieces.ts` (~5 MB) zieht — genau deshalb gibt
  // es die kleine Funktion neben der grossen. Rein rechnerisch.
  // `flattenRooms` for a VIEW, plus the static guard that no 5 MB furnishing
  // bundle sneaks in through it.
  ['shared', 'test/dungeon-flatten-rooms.ts'],
  /*
    Paket 0.10 (verwaiste Tests): Testdateien, die im Baum lagen und nie im
    Sammellauf standen. Alle laufen ohne `assets/` (gemessen mit
    verschobenem Ordner), deshalb ohne Weiche. Was bewusst NICHT hier steht
    (Werkzeuge, bekannt rote Tests), führt `scripts/pruefe-runner-liste.mjs`
    mit Grund.

    Test files that sat in the tree but never ran in the collective run.
  */
  // Dokumentfassung 5 → 6: `generatorEinstellungen` wird geklemmt, ein Altdokument
  // säubert sich byte-gleich. Reine Datenprüfung, Zehntelsekunden.
  ['shared', 'test/dungeon-generator-einstellungen.ts'],
  ['shared', 'test/dungeon-generator.ts'],
  // `schliesseOffeneKanten`: Im Modul-Kit ist eine Wand ein EIGENER Raum
  // (`endCap`), den der Generator über jede sonst offene Kante zieht — von
  // Hand gebaute Gräber hatten deshalb Löcher. Gemessen wird die Zahl der
  // gesetzten Wände und die der offen gebliebenen Kanten (der Eingang
  // bleibt frei, alles andere wird dicht), für DG_StoneVault und
  // DG_Steingrab. Rein rechnerisch, Zehntelsekunden.
  // Sealing open cell edges with the kit's end caps — entrance stays open.
  ['shared', 'test/dungeon-kanten-schliessen.ts'],
  // Grundbeleuchtung je 1.0-Dokument (`ambientLicht`, 0..3): klemmen, Unbrauchbares
  // verwerfen, Altdokument byte-gleich, Dokumentfassung 6. Reine Datenprüfung.
  ['shared', 'test/dungeon-licht-dokument.ts'],
  ['shared', 'test/dungeon-raster.ts'],
  // G9 (Modul-Generierung 2.0): Der EDITOR auf derselben Regel. Prueft,
  // dass `computeOpenConnections(…, { ohneEingang: true })` Loecher zaehlt
  // statt Connectors (ein frisches StoneVault meldet 0 statt 86 ueber 40
  // Saaten), dass `attachRoom` einen Anbau in BEIDE Richtungen abweist,
  // der eine offen/wand-Kante erzeugte (Mikes Befund vom 04.09.2026),
  // dass `schliesseOffeneKanten` ueber 40 Saaten GENAU die Plattenmenge
  // des Generators setzt — und dass nach `removeRoom` plus erneutem
  // Schliessen alle G4-Invarianten wieder halten. Block 5 haelt dagegen,
  // dass ein Nicht-Rasterkit (DG_Steingrab) unveraendert zumauert.
  // Rein rechnerisch, Sekunden.
  // G9: the hand-built path filtered by the same edge table.
  ['shared', 'test/dungeon-rastereditor.ts'],
  // G4 (Modul-Generierung 2.0): der Kern des Rastergenerators — Zellmenge,
  // Spannbaum, Modulwahl, Versiegelung. Geprueft wird gegen das AUSGEGEBENE
  // Layout, nicht gegen die Zwischenstaende: Zellzahl trifft `maxRooms`,
  // jede ueberzaehlige Oeffnung zeigt auf Fels (sonst stossen zwei Raeume
  // aneinander, ohne dass man durchkommt — Mikes Befund), jede Platte liegt
  // genau auf einer offenen Fels-Kante, 100 % erreichbar, zwei Laeufe
  // byte-gleich. Rein rechnerisch, Sekunden.
  // The grid core: cells, spanning tree, module choice, sealing table.
  ['shared', 'test/dungeon-rasterkern.ts'],
  // G2 (Modul-Generierung 2.0): Jedes StoneVault-Modul beschreibt sich
  // selbst — Fussabdruck, Ebenen, sechs Kantenzustände je Zelle. Der Test
  // haelt die Erklärung (`RoomDef.gridEdges`) gegen die einzige Groesse,
  // die auch das Modell kennt: die Connectors. Jeder Connector liegt auf
  // einer offenen Aussenkante und umgekehrt; wer `make-stonevault.py`
  // aendert und das Kit vergisst, wird hier rot statt erst im Grab.
  // Rein rechnerisch, Zehntelsekunden.
  // Every module explains itself; connectors are the witness against drift.
  ['shared', 'test/dungeon-rastermodul.ts'],
  // G5 (Modul-Generierung 2.0): die beiden Regler aus Mikes Ergaenzung —
  // `loopFraction` (Schleifen, Vorgabe 0,35) und `archwayFraction`
  // (Torboegen, 0,25). Geprueft wird, dass der Schleifenanteil im Zielband
  // liegt, dass jede Schleifenkante im Grab wirklich ein Durchgang ist,
  // dass Torboegen nur auf Graphkanten und nie zwischen zwei Gangzellen
  // stehen, dass der Tuersatz aus `hashPos` kommt und deshalb eine
  // VERTAUSCHTE Zellreihenfolge nichts aendert — und dass die Doppelwaende
  // gegenueber `loopFraction` 0 messbar sinken. Rein rechnerisch, Sekunden.
  // The two G5 knobs: loops and archways, both drawn from the edge hash.
  ['shared', 'test/dungeon-rasterschleifen.ts'],
  // G6 (Modul-Generierung 2.0): Der STEMPEL — die Halle als 2 x 2 Zellen.
  // Prueft, dass alle acht Ports aus der RUECKRECHNUNG kommen und nicht
  // aus einer getippten Tafel (in allen vier Gierungen, sonst stimmt sie
  // unter einer und schweigt unter dreien), dass keine Zelle doppelt
  // belegt ist, dass die Halle in mindestens 10 von 40 Saaten steht — und
  // die Kernforderung: Eine unverbundene Hallenkante vor der eingebauten
  // Wand eines Nachbarn bekommt KEINE Platte (Zeile 3 der Kantentafel).
  // Rein rechnerisch, Sekunden.
  // G6: the hall as a 2x2 stamp, every port derived, never typed.
  ['shared', 'test/dungeon-rasterstempel.ts'],
  // G7 (Modul-Generierung 2.0): Die Treppe — das einzige Modul, das eine
  // EBENE wechselt. Prüft, dass sie drei Zellen auf e UND dieselben drei
  // auf e+1 belegt (die Gegenebene ist gesperrt, nicht leer), dass ihr
  // Ebenenwechsel als senkrechte Graphkante im Grundriss steht, dass die
  // Erreichbarkeit JE EBENE geprüft wird (eine gut vernetzte Ebene 0
  // verdeckt sonst eine abgehängte Treppenspitze) und dass beide Enden
  // eines Laufs begehbar sind statt zugemauert. Rein rechnerisch, Sekunden.
  // G7: the staircase, its two levels and the vertical graph edge.
  ['shared', 'test/dungeon-rastertreppe.ts'],
  // G3 (Modul-Generierung 2.0): Die Abbildung Raster ↔ Welt. Zellmitten
  // liegen auf (2i, 3,5e, 2j−1) — der z-Schluessel ist `round((z+1)/2)`, und
  // diese halbe Zelle Unterschied faellt in keiner Zaehlung auf, weil alle
  // Raeume gleich falsch laegen. Geprueft werden die Rundreise ueber 10 086
  // Zellen auf 6 Ebenen (plus 10 000 verrauschte), die Eingangszelle auf
  // pos (0,0,−1) mit 180°, und der Zeuge aus S6: jeder Connector jedes
  // Moduls landet unter jeder Gierung auf seiner Kantenmitte (1e-4).
  // Rein rechnerisch, Zehntelsekunden.
  // Grid ↔ world mapping: round-trip keys, entrance pose, connectors on edges.
  ['shared', 'test/dungeon-rasterwelt.ts'],
  // F2 (Fels-Relief 3a): das Steinmaterial JE DOKUMENT — Erlaubnisliste,
  // Sanitizer und Raum-Override, dazu der Fels-Eintrag `stein_fels` und
  // die Zusage, dass KEINE Normal-Karte in der Liste steht (sie wäre im
  // Editor-Dropdown ein wählbares Albedo). Der Test lag bisher als
  // einziger der Steinkit-Reihe nicht im Sammellauf. Reine Logik, ~2 s.
  // F2: the per-document stone material allow-list and sanitizer.
  ['shared', 'test/dungeon-steinkit-dokument.ts'],
  // Der Bauer: Optik und Kollision als zwei Ausgaben, blockweise und
  // reihenfolgefrei aufrufbar, Meter durch Multiplikation. ~8 s.
  ['shared', 'test/dungeon2-builder.ts'],
  // Der Bestücker: Rolle → Prefab, jeder Anker aus seinem eigenen Strom.
  // ~5 s.
  ['shared', 'test/dungeon2-decorator.ts'],
  // Determinismus gegen die eingefrorenen Golden-Dateien. Die Browser-
  // Seite desselben Prüfstands liegt daneben und läuft von Hand (s. o.).
  // ~4 s.
  ['shared', 'test/dungeon2-determinismus.ts'],
  // AP13: Das 2.0-Instanz-Dokument und die Weiche im Sanitizer — ein
  // 2.0-Dokument darf nie durch den Alt-Sanitizer laufen und umgekehrt,
  // beide Richtungen geprüft.
  ['shared', 'test/dungeon2-dokument.ts'],
  // Der Generator: Zyklen, Ebenen, Treppen, Mündungen, und das
  // Abnahmekriterium „eine zusätzliche Ziehung im Deko-Strom verändert
  // kein einziges Stempel-Feld". ~3 s.
  ['shared', 'test/dungeon2-generator.ts'],
  // Ganzzahlige Positions-Hashes (`Math.imul`). Der `Math.sin`-Hash, den
  // die Vorlage benutzte, läuft in Node und im Browser verschieden — und
  // zwar still.
  ['shared', 'test/dungeon2-hashing.ts'],
  // Die Invarianten aus ARCHITECTURE.md §3.7, je Regel ein Positiv- UND
  // ein Negativfall.
  ['shared', 'test/dungeon2-invarianten.ts'],
  // Das eingefrorene Layout-Datenformat v1 samt Kanonisierung und
  // Prüfsumme. Ändert sich die Kanonisierung, fällt der Test — das ist
  // sein ganzer Zweck.
  ['shared', 'test/dungeon2-layout.ts'],
  // Parität Zellgitter ↔ Geometrie: über eine halbe Million Proben hin
  // und her. ~2 s.
  ['shared', 'test/dungeon2-paritaet.ts'],
  // ── Dungeon Generator 2.0 ──────────────────────────────────────────
  //
  // Vierzehn Dateien, die bis zum 31.08.2026 nur von Hand liefen. Das ist
  // die gefährlichste Sorte Test: Er ist da, er ist grün, und niemand
  // merkt, wenn er es aufhört zu sein. Alle zusammen brauchen unter einer
  // Minute — es gab nie einen Grund ausser dem, dass es niemand getan hat.
  //
  // Fourteen files that ran by hand only until 2026-08-31 — the most
  // dangerous kind of test: present, green, and nobody notices when it
  // stops being green. Together under a minute.

  // Die harte Schichtgrenze: `shared/src/dungeon2/**` ohne Babylon, ohne
  // `node:`, ohne `window`/`document`, ohne `Math.random`/`Date.now`.
  // Erzwungen durch einen Dauertest, nicht durch Disziplin — genau der
  // Rückfall, der uns zwingen würde, Geometrie über die Leitung zu
  // schicken. Zehntelsekunden.
  ['shared', 'test/dungeon2-schichten.ts'],
  /*
    Der Vorposten von h4-graslandflora: dieselbe Regel („ein kuratierter
    Name ohne Streueintrag bleibt lautlos kahl"), aber als reine Aussage
    ueber zwei Listen statt ueber 11 x 11 gestreute Zonen. Er faellt in
    Millisekunden und nennt den Namen; h4 braucht dafuer den halben
    Server. Beide bleiben stehen — der eine prueft die Verdrahtung, der
    andere, dass am Ende wirklich etwas aus dem Boden kommt.

    Ohne Weiche: kein `assets/`, keine GPU, reine Tabellen.
  */
  ['shared', 'test/flora-verdrahtung.ts'],
  // GD1: Grundbestand der 29 Gegenstaende in der Datei (Felder, Rezepte, Format, immer da, alter Spielstand).
  ['shared', 'test/gd1-grundbestand.ts'],
  ['shared', 'test/gegenstands-daten.ts'],
  ['shared', 'test/geo-smoke.ts'],
  /*
    Stufe 2 „Look", Bauer Gras und Wasser — drei Waechter ueber drei
    Fehler, die alle NICHTS brechen und deshalb keinem auffallen:

      gras-clutter-streuung.ts  Steht ein `grass-short-clump-*` zugleich in
                                einer Biom-Streuliste UND im Gras-Clutter?
                                Dann setzt die Welt ein Prefab-Bueschel in
                                ein Clutter-Bueschel — unsichtbar, aber am
                                Referenzort 12.024 + 2.311 Instanzen teuer.

      refraktion-huelle.ts      Haelt die 100-m-Schranke des Unterwasser-
                                Passes (Lehre E23), und kommt ihr wirklich
                                kein streubares Store-Modell nahe? Ein
                                Bestands-Master im Pass kostet Millionen
                                Dreiecke, ohne das Bild zu aendern.

      wasser-farben.ts          Sind die neuen Ankerfarben (#a3afbd /
                                #dfa974) LINEAR gerechnet, und behaelt jede
                                Wasserfarbe die Helligkeit ihres gemessenen
                                Ausgangswerts? Ein roh eingesetztes Hex ist
                                in einer linearen Kette kein Fehler,
                                sondern nur zu dunkel und zu satt.

    OHNE WEICHE, alle drei: Sie lesen ausschliesslich versionierte
    Tabellen — `shared/src/storeFlora.ts`, die ERZEUGTEN, aber
    eingecheckten `storePrefabs.ts`/`storeKatalogDaten.ts` und die
    Farbrechnung aus `WaterPlugin.ts`. Kein `assets/`, keine GPU, keine
    GLB. Sie laufen deshalb auch im CI-Checkout ohne Store. Zusammen unter
    einer Sekunde (drei tsx-Starts).
  */
  ['shared', 'test/gras-clutter-streuung.ts'],
  /*
    E1 (Elemente aus dem Editor): Die geschlossene Arithmetik eines Saals.
    Ein Saal besteht nur aus achsenparallelen Quadern, also gilt exakt
    B = 2 + 16·cx·cz + 3·P, 12·B Dreiecke, 24·B Ecken. Daran haengt die
    Entscheidung, Saele in TypeScript statt in Blender zu bauen — auf
    `wov-dev` gibt es kein Blender. Der Test nennt die fuenf gemessenen
    Zahlen, prueft die Pfeilerstellen (ein Pfeiler auf einer Kantenmitte
    stuende im Durchgang) und die Vorspiegelung ueber das signierte
    Volumen: Die Saele sind punktsymmetrisch, ein vergessenes x-Negieren
    verschoebe also KEINEN Punkt und haette ohne diesen Zeugen kein
    Symptom. Liegen die GLBs da, misst er zusaetzlich gegen sie; sonst
    meldet er das und bleibt gruen. Reine Rechnung, Zehntelsekunden —
    deshalb ohne Weiche.

    Closed-form hall arithmetic plus the mirror witness; skips the GLB
    cross-check on its own when assets/ is absent.
  */
  ['shared', 'test/hallen-geometrie.ts'],
  // Die Hoehenfunktion aus shared/ fahren Server UND Client. Der Test haelt
  // 13 Zonen aus allen Biomlagen plus den Abfragepfad gegen eine Referenz
  // und laesst genau 0,000 m Abweichung zu — die Bremse gegen jede
  // Beschleunigung, die die Welt unter den Fuessen des Spielers verschiebt.
  ['shared', 'test/heightmap-determinismus.ts'],
  // Paket G13: Seit der Gelaendestrom Zonen ZEILENWEISE bauen darf (gegen
  // den 9-ms-Ruckler je neuer Zone), gibt es zwei Wege zu derselben Zone.
  // Der Test haelt beide gegeneinander — bitgleich, bei jeder Schrittgroesse
  // — und prueft, dass eine halbfertige Zone von aussen nie sichtbar wird.
  ['shared', 'test/heightmap-schrittweise.ts'],
  // Handkorrektur der Gelaendehoehe (heightDeltas, T1): Schema, Sanitizer, Einrechnung nach den
  // Regionen (Sockel gewinnt), Cache je Zone, Server = Client, 422-Weg.
  ['shared', 'test/hoehenkorrektur.ts'],
  // Karte M1: Vollstaendigkeitstest der Uebersetzungskataloge (client/src/i18n/katalog
  // UND shared/data/texte) -- gleiche Schluessel de/en, gleiche Platzhalter, keine
  // leeren/doppelten Eintraege, kanonische Formatierung, keine Namensraum-Ueberschneidung.
  ['shared', 'test/i18n-katalog.ts'],
  // G1-Durchsicht: Inventar-Paritaet zu Unity Inventory.cs (Stapeln,
  // Fuellrichtung, Hotbar, Verschieben/Tauschen, Kapazitaet, Speichern/
  // Laden, Gewicht). Reine Funktion, Sekunden.
  ['shared', 'test/inventory.ts'],
  // Item-Tooltip (2026-09-29): Itemlevel und Seltenheit jeder Definition nach
  // Tabelle B2, anzeigeName mit/ohne textKey (rein). Keine Assets noetig.
  ['shared', 'test/item-stufen.ts'],
  /*
    Kampfkern K1 (2026-09-29): Item-Attribute und Formeln (rein) und ihr Weg
    durch den Server (drei echte WebSocket-Spieler mit verschiedener
    Ausruestung). Keine Assets noetig. ~10 s bzw. ~25 s.
  */
  ['shared', 'test/kampf-attribute.ts'],
  // B6/B7 (Roadmap): Zellbelegung fuers Ueberlappungs-Bild im Editor und
  // die Flaechenrechnung der Kopfzeile -- reine Geometrie, DOM-frei,
  // Sekunden.
  ['shared', 'test/karten-auswertung.ts'],
  /*
    F4 (Fels-Relief 3b): der WAECHTER ueber die Ableitung `DG_RockVault`.
    Vergleicht das Kit Feld fuer Feld gegen die frische Ausgabe von
    `rockVariant()` — ein von Hand nachgetragener RoomDef ist damit rot,
    und zwar sofort und nicht erst bei der naechsten Nahtschluss-
    Aenderung. Dazu die Einzelaussagen: 12 Module umbenannt, Torbogen mit
    eigenem Hash, Fels-Albedo an der Wand, jeder neue Name in
    `EIGENE_MODELLE`, und ueber fuenf Saaten derselbe Grundriss wie das
    Stammkit. Reine Daten, kein `assets/`, Sekundenbruchteile.
    F4: the guard that DG_RockVault stays DERIVED from DG_StoneVault.
  */
  ['shared', 'test/kit-ableitung.ts'],
  // ── Kollisionsformen: Client und Server sehen DASSELBE ─────────────
  //
  // Seit dem 10.09.2026 leitet nicht mehr der Client allein die Form
  // eines Hindernisses ab, sondern `shared/src/kollision/formen.ts` fuer
  // beide Seiten. Drei Tests, getrennt nach dem, was sie VORAUSSETZEN:
  //
  //  1. `shared/test/kollision-mengen.ts` rechnet nur mit den
  //     eingecheckten Tabellen — keine Datei, keine Weiche, laeuft im
  //     CI-Checkout. Er haelt fest, dass die Menge "fest" nach dem
  //     Wechsel auf `storeKollisionDaten.ts` dieselbe geblieben ist
  //     (454 Speicher-Prefabs) und dass die geteilte Ableitung ohne
  //     `Math.hypot/pow/atan2` auskommt (Portierungsfalle: andere
  //     Laufzeit, andere Bits). Sekundenbruchteile.
  //
  //  2. `client/test/kollision-formen.ts` faehrt acht Prefabs ueber den
  //     ECHTEN Client-Weg (SceneLoader + AssetManager.getMasters) und
  //     haelt die Havok-Parameter gegen
  //     `shared/test/golden/kollision-formen.json` — dort steht neben
  //     dem Sollwert auch der von origin/main. Ausserdem: die Abbildung
  //     GLB -> Clientraum, Vertex fuer Vertex gegen den Node-Leser des
  //     Servers. Braucht `assets/store`. ~5 s.
  //
  //  3. `server/test/kollision-formen.ts` macht dasselbe OHNE Babylon
  //     und misst die Vorladung. Sein (c)-Teil laeuft absichtlich auch
  //     ohne Speicher (leere Quelle, kein Absturz) — die Weiche steht
  //     trotzdem, weil (a) und (b) die Dateien brauchen. ~2 s.
  //
  //  4. `server/test/kollision-einhaengung.ts` setzt eine ECHTE Felsform
  //     ueber die VORGABEWURZEL in die Kollisionswelt und schiesst
  //     darauf. Er deckt die Naht ab, die keiner der drei anderen sieht:
  //     Wurzel, Skalierungskette und die (−x,y,z)-Abbildung — letztere
  //     als Gleichung (Fels und Strahl gedreht ergeben R·P) und nicht als
  //     Plausibilitaet. ~3 s.
  ['shared', 'test/kollision-mengen.ts'],
  ['shared', 'test/kollision-upload-entscheid.ts'],
  // Licht-Hints kommen an der Registry an. Ein Prefab ohne `light` ist
  // nicht kaputt, es ist dunkel — und dunkel faellt nirgends auf.
  ['shared', 'test/licht-hints.ts'],
  /*
    E3 (Elemente aus dem Editor): die RoomDef eines Saals — das, was der
    GENERATOR von einem Modul sieht. Ein Modell allein reicht nicht: Wer
    einen Saal zur Laufzeit anlegt und die Connectors nur ungefaehr trifft,
    bekommt keinen Fehler, sondern einen Grundriss, in dem der Nachbar um
    einen Meter versetzt steht.

    Der Kern ist deshalb kein Nachrechnen, sondern ein Vergleich: Die fuenf
    ausgelieferten Saele sind von Hand getippt, gegen Blender gemessen und
    im Spiel gelaufen — `roomDefForHall` muss sie FELD FUER FELD
    reproduzieren, bis auf `nurManuell`. Dazu die Rot-Zuerst-Probe 4x3
    (rechteckig, damit eine vertauschte x/z-Achse nicht durchrutscht) durch
    `gridModuleFromRoomDef`: 14 Randkanten offen, levels 1.

    Ohne Weiche: reine Rechnung, kein `assets/`, Zehntelsekunden.

    E3: the generated hall RoomDef, field for field against the shipped five.
  */
  ['shared', 'test/module-registry.ts'],
  ['shared', 'test/platzierungen-fehler.ts'],
  // Stable placement ids: the sanitizer derives / keeps / sorts ids, folds exact duplicates.
  ['shared', 'test/platzierungs-ids.ts'],
  // Handshake version: a world with a biome older clients do not know demands a newer client (pure function). <1 s.
  ['shared', 'test/protokoll-version.ts'],
  ['shared', 'test/region-geo.ts'],
  // Armor names via translation keys: every set and piece has a textKey that follows the schema and
  // exists in de.json and en.json; no orphan inhalt.item.* / inhalt.set.* key, no German text in en. <1 s.
  ['shared', 'test/ruestung-namen.ts'],
  // Plateau diff and tie-break independent of list order: a live-patched geo matches a fresh compile.
  ['shared', 'test/sockel-diff.ts'],
  // ── Asset-Bruecke: der Speicher unter assets/store ─────────────────
  //
  // Drei Tests, absichtlich getrennt nach dem, was sie VORAUSSETZEN:
  //
  //  1. `shared/test/store-registry.ts` rechnet nur mit der erzeugten
  //     Tabelle (eingecheckt) — keine Dateien, keine Weiche, laeuft im
  //     CI-Checkout. Er haelt fest, dass die 572 Store-Prefabs wirklich
  //     in PREFAB_DEFS/EIGENE_MODELLE stehen und dass kein Hash
  //     zusammenstoesst. Sekundenbruchteile.
  //
  //  2. `client/test/store-ladepfad.ts` rechnet `modelBaseUrl()` durch —
  //     ebenfalls dateilos. Ein falscher Zweig dort ergibt eine URL, die
  //     plausibel aussieht und 404 liefert. Sekundenbruchteile.
  //
  //  3. `tools/test/store-erzeugung.ts` fasst die PLATTE an: zwei
  //     Generatorlaeufe (byteidentisch?), das Eingecheckte gegen den
  //     frischen Lauf, und jeder Modellpfad gegen die Datei dahinter.
  //     Nur DER braucht die Weiche — `brauchtStore()` ueberspringt, wenn
  //     `assets/store` ganz fehlt; fehlende EINZELDATEIEN darin sind ein
  //     Befund und machen ihn rot (Begruendung in testweichen.mjs).
  //     ~2 s (zwei tsx-Starts ueber 670 Manifest-Eintraege).
  //
  //  4. `tools/test/store-einsortierung.ts` haelt die EINE
  //     Einsortierregel fest: Der Generator holt sie aus
  //     `client/src/editor/StoreKatalogDaten.ts`, und dieser Test faehrt
  //     alle 670 Katalogeintraege dagegen. Vor der Zusammenfuehrung gab
  //     es die Regel zweimal, und sie widersprach sich bei 477 von 670
  //     Eintraegen — anzusehen war das keiner der beiden Seiten.
  //     Braucht `assets/store` fuer Sorte und Kategorie.
  ['shared', 'test/store-registry.ts'],
  // Welche Speicher-Prefabs etwas TUN (Findling, Bett, Truhe): Mengen je
  // Gruppe, nichts zusaetzlich, Streutabelle gedeckt. Dateilos.
  ['shared', 'test/store-verhalten.ts'],
  /*
    Findlinge und Klippen stehen nicht auf 1/1/1.

    Derselbe Fehlertyp wie eine Zeile darueber, nur an den Speicher-
    Modellen: Bei 593 von 635 Materialslots fehlt der `baseColorFactor`
    in der GLB, der Lader setzt 1/1/1, und der Fels steht bei sRGB-Luma
    85 statt im gemessenen Band 51–76. Nichts daran bricht, nichts meldet
    sich — man sieht es nur im Bild.

    Geprueft wird die TABELLE (kein 1/1/1, keine Vegetation, kein
    Namenszusammenstoss mit den aufbereiteten Laubmaterialien), die
    FELS-GRUPPE gegen zwei Listen (zehn Landschaftsfelsen ja, neun
    Bauwerke und Requisiten mit demselben Wortstamm nein), der VORRANG
    der gemessenen Zeile vor dem Gruppenwert, die VERDRAHTUNG bis in ein
    echtes PBRMaterial samt „gesetzt, nicht multipliziert" — und zuletzt
    die NACHRECHNUNG: aus dem gemessenen Spiegelungssockel folgt Luma
    61,9, gemessen wurden 62,0.

    Ohne Weiche: kein GLB, kein Speicher, NullEngine, Sekundenbruchteile.
  */
  ['shared', 'test/synty-grundfarben.ts'],
  // G1-Durchsicht: Terraforming-Paritaet (Level/Raise/Smooth-Grenzwerte,
  // Zonennaht bit-identisch, baseHeights bleibt unberuehrt, Cache-Eviktion,
  // Comp-Hygiene). War tot durch eine veraltete Annahme ueber den
  // applyTerrainOp-Rueckgabewert (frueher ein flaches Array, jetzt
  // {heights, paint}) — Fix nur im Test. ~7s, kein Server/Socket.
  ['shared', 'test/terrain-comp.ts'],
  /*
    Tod und Treffer sichtbar (2026-09-29): die reine Regel Seite → Clip (8 Richtungen, Wire-Indizes, Einmal-Member).
  */
  ['shared', 'test/tod-treffer.ts'],
  /*
    F1 „Tageslauf" (12.09.2026): der Tageslauf hat EINE Uhr.

    Bis dahin endete der Tagbogen der Phasengewichte bei f = 0,75, der
    Sonnenbogen erst bei f = 0,85 — auf 19,6 % des Zyklus stand die Sonne
    bis zu 19° hoch und es galt trotzdem nur das Nacht-Keyframe. Der Test
    faehrt 1440 Stuetzstellen ueber `evaluateEnv` und haelt fuenf
    Eigenschaften fest (kein Loch, Monotonie am Abend, Gewichtssumme,
    Mittag bitgleich, Nacht bitgleich) plus den Nichtwiderspruch zwischen
    Himmelskuppel und Licht. Reine Funktion, keine Szene, ~1 s.
  */
  ['shared', 'test/umgebung-tageslauf.ts'],
  // Nachbesserung M1: der Weltbau-Katalog (tools/worldlayout-mcp-Grundlage) meldet für
  // Uploads die GRUNDSKALIERTEN Maße, nicht die rohe Hüllbox der Datei.
  ['shared', 'test/upload-grundskala-katalog.ts'],
  // Karte „Editor Upload-Größe": Grundskala in Registry + Hülle (huellenAufloeser) —
  // Feld optional (fehlt = 1), Grenzen 0,01…100, Hülle multipliziert statt abschreibt.
  // Nachbesserung N1 (H1): applyUploadedModelRegistry übernimmt eine geänderte
  // grundskala bei bekanntem Namen; eine manipulierte Änderung verwirft nur SIE (N5).
  ['shared', 'test/upload-grundskala-registry.ts'],
  // Vorschlagslogik für die Zielgröße (DOM-frei): ähnliches Modell -> Kategorietabelle ->
  // Rohgröße, cm-Verdacht (>50 m), rohMasseAusGlb (Hüllbox browserseitig vor dem Upload).
  // Nachbesserung N2/N3: Tabellenmuster ohne echten Wortkern lösen nicht mehr aus
  // (Fassade/Shuttle/Abstandhalter/Wagenrad/Boxhandschuh), Namensvergleich umlaut-unabhängig.
  // Nachbesserung N2 (F5/F6): Abgleich auf ganze Namensbestandteile/Kompositum-Ende
  // umgestellt (Fassung/Standuhr/Boxsack/Abstandshalter/Wagenräder ebenfalls kein
  // Treffer mehr), Namensvergleich zusätzlich NFD-unabhängig (macOS-Dateinamen).
  ['shared', 'test/upload-grundskala-vorschlag.ts'],
  // Nachbesserung N4 (N3-4, Info): WOV_HOCHGELADEN_DIR robust gegen /proc-Umgehung
  // (//proc/x, /./proc/x — erst resolve(), dann Sperrliste, keine mkdirSync-
  // Endlosschleife mehr), Symlink-Ziel via realpathSync, Tippfehler bricht ab statt
  // still einen Baum anzulegen, Schreibprobe über zufälligen Namen mit O_EXCL.
  ['shared', 'test/upload-hochgeladen-dir-haerten.ts'],
  // U1 (uploaded-model editor upload): the runtime code/data seam
  // (shared/src/uploadedModelRegistry.ts) — registers/unregisters exactly
  // like a hand-built prefab, and pruefeLayout/istEigenesModell accept an
  // uploaded name (plus the counter-proof: it is flagged again once removed).
  ['shared', 'test/uploaded-model-registry.ts'],
  // Baeume entfernen V1: vegetationEntfernt (Sanitizer, 422-Weg, Raster-Pruefer, Baum-Liste, Text/Hash, Arbeitskopie).
  ['shared', 'test/vegetation-entfernt.ts'],
  // Waldambiente (2026-09-29): Walddichte gegen die echte Streuung der dev.json
  // (Korrelation, Drift-Waechter, ~40 s) und Lautstaerke-Regeln der Schleifen
  // (Dichte, Glaettung, Tag/Nacht, Aus-Faelle, Regler). Rein, keine Assets noetig.
  ['shared', 'test/wald-dichte.ts'],
  // G1-Durchsicht: Wetter/Wind-Port (Timing aus den Assets, Determinismus,
  // Ziehungsgewichte, Windclamp/-rampe, windData-Alpha, Niederschlags-
  // zuordnung). Reine Funktion, kein Server/Socket, Sekunden.
  ['shared', 'test/weather.ts'],
  ['shared', 'test/welt-abgleich-wettlauf.ts'],
  // K5.7 world working copy: the four start cases (missing / only repo changed / both changed / none), accept and discard;
  // 10 saves through the operations service leave `git status --porcelain` empty; tools/welt-abnehmen.sh commits only with --commit.
  ['shared', 'test/welt-arbeitskopie.ts'],
  // World operations (setze / aendere / entferne, undo, anchors): the pure part ...
  ['shared', 'test/welt-ops.ts'],
  ['shared', 'test/weltbau-beschreiben.ts'],
  ['shared', 'test/weltbau-diff.ts'],
  ['shared', 'test/weltbau-diffbasis.ts'],
  ['shared', 'test/weltbau-katalog.ts'],
  ['shared', 'test/weltbau-nachbesserung.ts'],
  ['shared', 'test/weltbau-pruefungen.ts'],
  ['shared', 'test/weltbau-stil.ts'],
  ['shared', 'test/weltbau-vorgang.ts'],
  // Naht zwischen Kopf- und Rumpfdateien der Weltdaten (Bundle-Schnitt):
  // laeuft in Sekunden und faengt genau den Fehler, den sonst niemand sieht.
  ['shared', 'test/weltdaten-schnitt.ts'],
  ['shared', 'test/worldlayout.ts'],
];
