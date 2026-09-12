#!/usr/bin/env node
/**
 * Test-Runner (Review-Punkt 26): fährt die kuratierte Testliste sequenziell
 * und aggregiert die Exit-Codes — vorher liefen 29 Testdateien nur einzeln
 * von Hand.
 *
 *   npm test              schnelle Kernliste (~2–3 min)
 *   npm test -- --alle    zusätzlich die langen Läufe (Placement, E2E-Wire)
 *
 * WEICHEN (S3): Einträge mit dritter Stelle laufen nur, wenn ihre
 * Voraussetzung da ist — `assets/` (liegt ausserhalb des Repos) und/oder
 * der Flatpak-Blender (`wov-dev` hat keinen). Fehlt sie, steht dort
 * ÜBERSPRUNGEN mit dem Grund im Klartext statt eines roten Tests. Proben
 * lässt sich beides ohne Umbau der Maschine:
 *
 *   WOV_OHNE_MODELLE=1 node scripts/run-tests.mjs   (CI-Checkout)
 *   WOV_OHNE_BLENDER=1 node scripts/run-tests.mjs   (wov-dev)
 *
 * Dass eine Weiche nicht IMMER überspringt, hält scripts/pruefe-weichen.mjs
 * fest — er steht selbst in der Liste.
 *
 * NICHT enthalten sind die C++-Golden-Tests (geo-compare, heightmap-compare,
 * geo-map): sie brauchen Referenz-Dumps als Argument und gehören zum
 * eingefrorenen Übergangspfad der radialen Weltgenerierung. Ebenso math-golden.ts (dieselbe Art
 * Referenz-Dumps, random_values.txt/perlin_values.txt) sowie geo-correlate.ts
 * — alle vier tragen die Begründung bereits im eigenen Kopfkommentar.
 *
 * Reine Werkzeuge/Messbänke, keine Tests (drucken Zahlen, behaupten nichts,
 * kein process.exit(1)-Pfad — s. jeweiliger Kopfkommentar):
 * shared/test/rain-freq.ts, shared/test/heightmap-bench.ts,
 * client/test/durchgangshoehe-mess.ts, client/test/torbogen-hoehe-mess.ts
 * (beide vom 11.09.2026, zur Umstellung auf die Original-Kapselhöhe 2,0 m:
 * wie hoch die niedrigste Stelle wirklich ist, durch die die Figur muss).
 *
 * Ebenfalls NICHT enthalten: shared/test/dungeon2-browser-check.ts. Das ist
 * kein Node-Test, sondern der BÜNDEL-EINSTIEG der Browser-Seite des
 * Determinismus-Prüfstands (AP5) — er benutzt `document` und stürbe unter
 * tsx sofort. Er wird per esbuild gebaut und im Browser geöffnet; die
 * Anleitung steht in seinem eigenen Kopfkommentar.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/*
  Die WEICHEN (S3, Elemente-Umzug): `brauchtModelle` fuer Tests, die
  `assets/` brauchen — es liegt ausserhalb des Repos —, `brauchtBlender`
  fuer die, die zusaetzlich den Flatpak-Blender brauchen. Fehlt die
  Voraussetzung, wird der Test als UEBERSPRUNGEN gemeldet statt rot; die
  Sonde selbst darf das nie entscheiden (sie wird rot, wenn sie nichts zu
  messen findet).

  Warum die beiden in einer eigenen Datei stehen: Eine Weiche, die IMMER
  ueberspringt, ist von einer richtigen nicht zu unterscheiden — der Lauf
  ist in beiden Faellen gruen. Pruefen laesst sie sich nur, wenn man sie
  importieren kann, und wer DIESE Datei importiert, faehrt die ganze
  Testliste. Der Zeuge dagegen ist `scripts/pruefe-weichen.mjs`; er steht
  weiter unten selbst in der Liste.

  Skip switches live in their own module so they can be tested.
*/
import {
  WURZEL,
  brauchtModelle,
  brauchtBlender,
  brauchtStore,
  brauchtBodenQuellen,
} from './testweichen.mjs';

/*
  Weiche fuer Pruefer, die eine `python3`-Datei befragen.

  Das Fels-Höhenfeld (F3) liegt bewusst als reines Python-Modul neben dem
  Blender-Bauskript — nur so laesst sie sich ohne Blender messen. Der
  Pruefer ruft `python3` also wirklich auf; fehlt es, misst er nichts und
  wuerde still gruen bleiben. Deshalb hier die Weiche und nicht dort.

  Skips when python3 is missing (the checker shells out to it).
*/
function brauchtPython() {
  return () =>
    spawnSync('python3', ['-c', 'pass'], { encoding: 'utf-8' }).status === 0
      ? null
      : 'python3 fehlt — das Fels-Höhenfeld wird per python3 befragt';
}

const KERN = [
  /*
    Ein Ursprung im Container (12.09.2026): Textnachweis über
    deploy/nginx/wov-lab.conf — alle sieben Wege (Webseite, /play/,
    /editor/, /api/accounts/, /api/, /assets/, /ws) stehen als eigener
    location-Block darin. Liest nur Text, ~0.1 s — deshalb ganz vorn,
    aus demselben Grund wie die drei Elemente-Umzug-Wächter direkt
    darunter.

    Text-only guard over the single-origin nginx config — all seven
    paths present as their own location block.
  */
  ['tools/test', 'nginx-wov-lab-pfade.ts'],
  /*
    S1 (Elemente-Umzug): Kopfzeilen-Wächter über `tools/elements/`. Steht
    ganz vorn, weil er der billigste Prüfer der Liste ist — er liest Text,
    sonst nichts: kein `assets/`, kein Blender, keine GPU, keine
    Netzverbindung. Damit läuft er auch im CI-Checkout, in dem die Modelle
    fehlen, und braucht als einziger Eintrag hier keine Weiche.

    Was er festhält: Jede Datei unter `tools/elements/` sagt in ihrer
    ersten Kommentarzeile, ob sie etwas ERZEUGT, etwas PRÜFT oder
    HILFSMITTEL ist. Diese Auskunft verfällt sonst still — eine fehlende
    Kopfzeile bricht nichts und fällt niemandem auf.

    Header convention guard for tools/elements/ — text only, ~0.1 s.
  */
  ['tools/elements', 'pruefe-koepfe.mjs'],
  /*
    S2 (Elemente-Umzug): der Pfad-Wächter, direkt neben dem Kopfzeilen-
    Wächter und aus demselben Grund hier vorn — er liest Text, sonst nichts.

    Er hält die Zusage des Umzugs fest: Kein Skript unter `tools/elements/`
    nennt einen Ort ausserhalb des Repos. Ohne ihn ist der Umzug nur auf
    Mikes Rechner fertig, denn dort gibt es `~/wov-ai` weiterhin — ein
    Skript, das seine Datei am alten Ort findet, sieht wie ein umgezogenes
    aus. Rot wird das erst beim nächsten Checkout, und dann erklärt es
    niemand mehr.

    Guards the move: no script under tools/elements/ names a path outside
    the repo. Text only, ~0.1 s.
  */
  ['tools/elements', 'pruefe-pfade.mjs'],
  /*
    S4 (Elemente-Umzug): der README-Wächter, der dritte und letzte im Bunde
    — und aus demselben Grund hier vorn: Er liest Text, sonst nichts.

    Er hält das Verzeichnis der Werkbank in beide Richtungen fest: Jeder
    Pfad, den `tools/README.md` oder `tools/elements/README.md` nennt,
    existiert, UND jede Datei unter `tools/elements/` steht in einer der
    beiden. Beide Richtungen sind nötig — ein README ohne tote Pfade kann
    trotzdem den halben Ordner verschweigen, und ein vollständiges kann
    trotzdem ins Leere zeigen.

    Warum das ein Prüfer sein muss und keine Bitte: Ein README wird nie
    ausgeführt. Ein verschobenes Skript hinterlässt einen toten Pfad, ein
    neues eine Lücke — beides bricht nichts, beides fällt niemandem auf.
    Sein erster Lauf fand neun tote Pfade und sechs unerwähnte Dateien.

    S4: guards both README files — no dead path, no unlisted file.
  */
  ['tools/elements', 'pruefe-readme.mjs'],
  /*
    S3 (Elemente-Umzug): der Zeuge gegen die Weichen selbst. Er steht VOR
    dem einzigen Test, der eine Weiche wirklich braucht, weil er dessen
    Voraussetzung prüft: dass `brauchtBlender` nur dann überspringt, wenn
    hier tatsächlich kein Blender läuft. Dafür fragt er nicht dieselbe
    Quelle noch einmal, sondern STARTET Blender (`flatpak run … --version`)
    und hält das Ergebnis gegen die billige Auskunft der Weiche
    (`flatpak info`). Dazu die Verdrahtung im Quelltext dieser Datei.

    Ohne ihn ist „übersprungen" nicht von „kaputt" zu unterscheiden — und
    ein Sammellauf, der nichts mehr misst, meldet trotzdem grün.

    Läuft überall: ohne Blender prüft er, dass die Weiche NEIN sagt, mit
    Blender, dass sie JA sagt. ~1 s (plus Blender-Start, wo einer da ist).

    S3: the witness against the skip switches — they must never always skip.
  */
  ['scripts', 'pruefe-weichen.mjs'],
  /*
    S2 (Elemente-Umzug): der volle Kit-Neubau als Prüfer. Baut alle zwölf
    `DG_StoneVault`-Module aus `tools/elements/blender/make-stonevault.py`
    neu und vergleicht je Objekt sechs Felder mit der Auslieferung unter
    `assets/models` — Dreiecke, Ecken, Materialslot, signiertes Volumen,
    Ursprung, Hüllbox. Er ist der einzige Test, der die BAUSKRIPTE selbst
    festhält; ohne ihn merkt niemand, dass eine verstellte Zahl im
    Blender-Skript und die ausgelieferten GLBs auseinandergelaufen sind.

    Der teuerste Eintrag dieses Blocks (~14 s, drei Blender-Starts) und der
    einzige, der Blender braucht — daher `brauchtBlender`. Er steht
    trotzdem hier vorn: Ein verstelltes Bauskript soll auffallen, bevor
    drei Minuten Server-Tests vergangen sind.

    S2: full kit rebuild measured against the shipped GLBs. Needs Blender.
  */
  [
    'tools/elements/pruefung',
    'kit-neubau.mjs',
    brauchtBlender('assets/models/StoneVaultHallVast.glb', 'assets/models/StoneVaultStairs.glb'),
  ],
  // Naht zwischen Kopf- und Rumpfdateien der Weltdaten (Bundle-Schnitt):
  // laeuft in Sekunden und faengt genau den Fehler, den sonst niemand sieht.
  ['shared', 'test/weltdaten-schnitt.ts'],
  ['shared', 'test/worldlayout.ts'],
  // B6/B7 (Roadmap): Zellbelegung fuers Ueberlappungs-Bild im Editor und
  // die Flaechenrechnung der Kopfzeile -- reine Geometrie, DOM-frei,
  // Sekunden.
  ['shared', 'test/karten-auswertung.ts'],
  ['shared', 'test/region-geo.ts'],
  ['shared', 'test/geo-smoke.ts'],
  // Die Hoehenfunktion aus shared/ fahren Server UND Client. Der Test haelt
  // 13 Zonen aus allen Biomlagen plus den Abfragepfad gegen eine Referenz
  // und laesst genau 0,000 m Abweichung zu — die Bremse gegen jede
  // Beschleunigung, die die Welt unter den Fuessen des Spielers verschiebt.
  ['shared', 'test/heightmap-determinismus.ts'],
  ['shared', 'test/dungeon-generator.ts'],
  ['shared', 'test/dungeon-raster.ts'],
  // `schliesseOffeneKanten`: Im Modul-Kit ist eine Wand ein EIGENER Raum
  // (`endCap`), den der Generator über jede sonst offene Kante zieht — von
  // Hand gebaute Gräber hatten deshalb Löcher. Gemessen wird die Zahl der
  // gesetzten Wände und die der offen gebliebenen Kanten (der Eingang
  // bleibt frei, alles andere wird dicht), für DG_StoneVault und
  // DG_Steingrab. Rein rechnerisch, Zehntelsekunden.
  // Sealing open cell edges with the kit's end caps — entrance stays open.
  ['shared', 'test/dungeon-kanten-schliessen.ts'],
  // G2 (Modul-Generierung 2.0): Jedes StoneVault-Modul beschreibt sich
  // selbst — Fussabdruck, Ebenen, sechs Kantenzustände je Zelle. Der Test
  // haelt die Erklärung (`RoomDef.gridEdges`) gegen die einzige Groesse,
  // die auch das Modell kennt: die Connectors. Jeder Connector liegt auf
  // einer offenen Aussenkante und umgekehrt; wer `make-stonevault.py`
  // aendert und das Kit vergisst, wird hier rot statt erst im Grab.
  // Rein rechnerisch, Zehntelsekunden.
  // Every module explains itself; connectors are the witness against drift.
  ['shared', 'test/dungeon-rastermodul.ts'],
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
  /*
    E2 (Elemente aus dem Editor): der GLB-Schreiber, der den Blender-Export
    ersetzt. Steht direkt hinter E1, weil er dessen Quaderliste verbraucht.

    Er haelt drei Dinge fest, die man der Datei nicht ansieht: 24 Ecken und
    36 Indizes je Quader (das IST "flach schattiert"), das NEGATIVE
    signierte Volumen (die Vorspiegelung — alle Saele sind punktsymmetrisch,
    ein Winding-Flip verschoebe also keinen Punkt) und dessen BETRAG (der
    Dichtheitszeuge: eine vergessene Flaeche aendert ihn, nicht nur sein
    Vorzeichen). Gelesen wird mit einem eigenen, kleinen glTF-Parser — ein
    Test, der den Schreiber mit dem Schreiber pruefte, pruefte nichts.

    Ohne Weiche: der Kern ist reine Rechnung. Liegen die fuenf
    StoneVaultHall*.glb da, vergleicht der Test zusaetzlich gegen sie
    (Eckenzahl, Dreieckszahl, Huellbox, signiertes Volumen) und meldet
    sonst im Klartext, dass er diesen Teil ausgelassen hat. Zehntelsekunden.

    E2: the GLB writer — 24/36 per box, negative signed volume, magnitude.
  */
  ['server', 'test/glb-schreiber.ts'],
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
  /*
    E5 (Elemente aus dem Editor): der Bauweg selbst — der erste
    Schreibweg dieses Projekts, dessen Eingabe eine Zahl aus dem Netz
    und dessen Ausgabe ein Pfad auf der Platte ist.

    Gemessen werden die beiden Tore (`peer.isAdmin` schuetzt heute
    nichts, `everyone-admin: true` — der Schalter `dungeons.modulbau`
    ist das einzige, das wirklich zu ist), die Klemmen, der
    Dreiecksdeckel (8x8 mit dem VORGABERASTER 2 ergibt 14 076 Dreiecke
    und faellt; mit Raster 4 sind es 12 636 und er geht durch — der
    Deckel liegt also mitten im erlaubten Bereich), der Namenswaechter
    an genau der Stelle, an der aus einem Namen ein Dateiname wird, und
    der volle Rundgang Bau -> GLB-Datei -> Registry -> registriertes
    Modul. Gebaut wird in ein Temp-Verzeichnis, nie in assets/.

    Ohne Weiche: rechnet und schreibt nur in os.tmpdir(), braucht kein
    `assets/`. Zehntelsekunden.

    E5: the module build path — both gates, clamps, triangle cap, name
    guard, throttle, and the build → file → registry → lookups round trip.
  */
  ['server', 'test/modulbau-grenzen.ts'],
  /*
    E6 — die Registry-Pruefsumme reist mit dem Dokument.

    `sanitizeDungeonDocument` verwirft unbekannte Raeume STILL (Kopf
    dort: "Unknown rooms are dropped"). Fuer eine Datei von der Platte
    ist das richtig; fuer ein Dokument aus dem Editor ist es der
    teuerste aller Fehler — ein Haekchen und ein Grab mit einem Loch.
    Abschnitt 3 des Tests MISST diesen stillen Verlust (zwei Raeume
    rein, einer raus), alles danach misst, dass er nicht mehr passieren
    kann.

    Gefahren wird der echte Draht: echter WovServer auf Port 2519,
    echter GameSocket, echter Nonce/HMAC-Handshake, echtes
    DungeonEditSave. Vier Absender — der Produktivweg
    (sendDungeonEditSave ohne Argument), eine veraltete Seite, ein
    Alt-Client ohne das Feld bei leerer Registry (angenommen) und
    derselbe bei gefuellter Registry (abgelehnt).

    Ohne Weiche: schreibt nur in os.tmpdir(), braucht kein `assets/`.
    Wenige Sekunden (vier Anmeldungen).

    E6: the module-registry checksum travels with every DungeonEditSave;
    the server compares it BEFORE the sanitizer and rejects a stale page.
  */
  ['server', 'test/registry-pruefsumme.ts'],
  /*
    E9 — der Loeschpfad. Das Gegenstueck zu E5, und der gefaehrlichere
    der beiden Wege: Der Name kommt hier AUS DEM NETZ und wird zu einem
    Dateipfad UND zu einem Schluessel in die Raumtabellen des laufenden
    Prozesses. Und ein fehlender Raum hat kein Symptom —
    `sanitizeDungeonDocument` verwirft unbekannte Raeume wortlos, aus
    einem geloeschten Saal wird also kein Fehler, sondern ein Loch im
    Grab, Tage spaeter.

    Gemessen werden die beiden Tore, der Namenswaechter (er ist es, der
    den von Hand getippten `StoneVaultHall` aus dem Kit heraushaelt),
    der Durchgang ueber ALLE Weltordner unter `data/dungeons` (der
    laufende Server kennt nur seine eigene Welt, die Registry teilen
    sich alle), Treffer ueber Namen UND Hash in beiden Dokumentformaten,
    das unlesbare Dokument als Blocker, der nie betretene Eingang, und
    zuletzt die Einigkeit von Prozess und Platte nach dem Loeschen.

    Ohne Weiche: schreibt nur in os.tmpdir(), braucht kein `assets/`.
    Zehntelsekunden.

    E9: the delete path — gates, the name guard, the disk-wide document
    scan, pending entrances, and process/file agreement afterwards.
  */
  ['server', 'test/modulbau-loeschen.ts'],
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
  // G4 (Modul-Generierung 2.0): der Kern des Rastergenerators — Zellmenge,
  // Spannbaum, Modulwahl, Versiegelung. Geprueft wird gegen das AUSGEGEBENE
  // Layout, nicht gegen die Zwischenstaende: Zellzahl trifft `maxRooms`,
  // jede ueberzaehlige Oeffnung zeigt auf Fels (sonst stossen zwei Raeume
  // aneinander, ohne dass man durchkommt — Mikes Befund), jede Platte liegt
  // genau auf einer offenen Fels-Kante, 100 % erreichbar, zwei Laeufe
  // byte-gleich. Rein rechnerisch, Sekunden.
  // The grid core: cells, spanning tree, module choice, sealing table.
  ['shared', 'test/dungeon-rasterkern.ts'],
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
  // G1/G8 (Modul-Generierung 2.0): Zwei Blöcke an derselben Messzelle.
  // Block A misst den 1.0-Pfad und hält die Ausgangslage fest — 952
  // Abschlussplatten im Körper des Nachbarmoduls (531 gegen eine volle
  // Wand, 414 gegen die Treppenflanke, 7 am Eingang), 1328 gestapelte
  // Zellen. Block B misst über den VERTEILER, also das, was Server und
  // Editor heute bauen: 0/0/0/0. `--streng` muss auf A rot und auf B grün
  // sein — ohne A wäre eine Messzelle, die nur noch Nullen kennt, von
  // einer kaputten nicht zu unterscheiden. ~2 s.
  // Freezes both the old baseline and the new grid result at one measuring cell.
  ['tools', 'test/messe-stonevault-metrik.ts'],
  // G8: Der Verteiler. 14 Bestandskits × 40 Saaten byte-gleich zu dem, was
  // vor dem Umbau in `tools/golden/` abgelegt wurde (SHA-256 über
  // `JSON.stringify(layout)`, plus ein vollständiges Layout als lesbarer
  // Zeuge), `DG_StoneVault` nachweislich über den Rasterpfad und
  // nachweislich NICHT mehr über den 1.0-Pfad, dazu die Laufzeitgrenze von
  // 10 ms je Layout bei 200 Zellen. Ohne diesen Test ist „die Fremdkits
  // bewegen sich nicht" eine Behauptung. ~20 s (das grösste Kit allein
  // ergibt 81 MiB JSON).
  // G8: the distributor — 14 legacy kits byte-identical, StoneVault on the grid path.
  ['server', 'test/golden-kits.ts'],
  // G4-Abnahme: dieselben G1-Metriken, gemessen am NEUEN Pfad. Die
  // Messzelle traegt ihre eigene Kantenerklaerung des Kits und ist damit
  // ein unabhaengiger Zeuge — der Generator kann sich nicht selbst
  // freisprechen. Abnahme ueber 40 Saaten und Mikes Kombination: 0 Platten
  // in belegten Zellen (heute 952), 0 unerklaerte Nachbarschaften (531),
  // 0 offene Kanten ohne Eingang, 0 Doppelbelegungen, 100 % Erreichbarkeit.
  // ~2 s.
  // The same G1 metrics measured against the new grid path.
  ['tools', 'test/raster-generator-g4.ts'],
  // G10 (Modul-Generierung 2.0): der BEGEHUNGSPLAN fuer die Spielprobe.
  // Prueft rein rechnerisch, dass die Route aus `tools/raster-begehungsplan.ts`
  // wirklich eine Begehung ist: jeder Schritt eine echte Zellkante, jede
  // Zelle versorgt, JEDE Graphkante in beide Richtungen gequert (sonst
  // blieben die Schleifenkanten aus G5 ungeprueft), kein Wegpunkt im
  // Luftraum einer Treppe, jede Treppe hoch UND herunter, und dieselbe
  // Saat dieselbe Route. Der Lauf im Spiel selbst laeuft NICHT hier mit
  // (er braucht play.dev und Minuten) — dieser Test ist seine
  // Voraussetzung: Ein roter Lauf soll das Grab beschuldigen, nicht den
  // Weg. ~4 s.
  // G10: the walking tour for the in-game probe, checked arithmetically.
  ['tools', 'test/raster-begehung.ts'],
  /*
    G11 (Modul-Generierung 2.0): die KANTENSONDE als Waechter. Sie liest
    die Modul-GLBs, rechnet ihre Eckpunkte in die Pose um, in der der
    Client sie zeigt (x gespiegelt ueber Babylons `__root__`), und fragt
    je Zellkante: Ist das Durchgangsfenster frei? Damit ist sie der
    einzige Test, der die Kit-ERKLAERUNG (`RoomDef.gridEdges`,
    `connections`) gegen die GEOMETRIE haelt statt gegen eine zweite
    Erklaerung — genau die Luecke, durch die G10 vier gespiegelte Kanten
    an Corner und Junction gefunden hat. Springt bei fehlenden Modellen.
    ~1 s.
    G11: the kit's edge declaration measured against the real GLB geometry.
  */
  // Seit F4 misst sie ohne Argument BEIDE Rasterkits — Ziegel und Fels.
  // Die Kit-Erklaerung ist fuer beide dieselbe (sie wird abgeleitet), die
  // GEOMETRIE ist es nicht: Ein Fels-Block, der ins Durchgangsfenster
  // ragt, aendert keine Zeile der Erklaerung. Deshalb stehen hier auch
  // die Fels-Dateien in der Weiche.
  [
    'tools/elements/pruefung',
    'stonevault-kantensonde.ts',
    brauchtModelle(
      'assets/models/StoneVaultCorner.glb',
      'assets/models/StoneVaultJunction.glb',
      'assets/models/RockVaultCorner.glb',
      'assets/models/RockVaultJunction.glb'
    ),
  ],
  // `flattenRooms`: Layout → Prefab-Instanzen für eine ANSICHT, mit dem
  // statischen Wächter, dass `dungeonKanten.ts` dafür NICHTS aus
  // `dungeonFlatten.ts`/`roomPieces.ts` (~5 MB) zieht — genau deshalb gibt
  // es die kleine Funktion neben der grossen. Rein rechnerisch.
  // `flattenRooms` for a VIEW, plus the static guard that no 5 MB furnishing
  // bundle sneaks in through it.
  ['shared', 'test/dungeon-flatten-rooms.ts'],
  ['shared', 'test/bauteile-kosten.ts'],
  ['server', 'test/h1-layout.ts'],
  ['server', 'test/h2-routen.ts'],
  ['server', 'test/h3-routen-vorschau.ts'],
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
  ['server', 'test/h4-graslandflora.ts'],
  /*
    Die Store-Vegetation, zwei Fragen und zwei Dateien:

      store-flora.ts       Steht jeder Name in `shared/src/storeFlora.ts`
                           auch im Store, und ergibt jede Biomliste eine
                           Landschaft (Baum, Strauch, Schnee nur im
                           Norden)? Misst die Hoehen aus prefabs.json —
                           am Namen liesse sich das nicht entscheiden.

      store-vegetation.ts  Laeuft die Aufbereitung durch, ist ihr Ergebnis
                           beim zweiten Lauf byteidentisch, und traegt
                           danach jedes Laubmaterial eine Toenung? Ohne
                           die waere das Laub grau — und grau sieht nicht
                           nach Fehler aus, sondern nach Herbst.

    WEICHE `brauchtModelle('assets/store')`: Der Store liegt ausserhalb
    des Repos (Symlink assets/store). Fehlt er GANZ, wird uebersprungen;
    fehlt eine EINZELNE Datei, werden die Tests rot — die Sonde
    entscheidet nie selbst, ob sie laufen darf.
  */
  ['tools/test', 'store-flora.ts', brauchtModelle('assets/store')],
  ['tools/test', 'store-vegetation.ts', brauchtModelle('assets/store')],
  /*
    Der Store-FELS, und die Fragen sind andere als beim Bewuchs:

      store-felsen.ts  Gibt es jede Art, liegt ihr Neigungsfenster
                       richtigherum, bevorzugt der grosse Fels wirklich
                       den Hang, und steckt jeder Stein zwischen 20 und
                       60 % seiner Hoehe im Boden? Die Zahlen kommen aus
                       den Huellboxen in prefabs.json und aus den GLBs
                       selbst — dem Namen sieht man keine davon an.

    Der teuerste stille Fehler, gegen den er steht, ist ein VERDREHTES
    Neigungsfenster: Bei minTilt > maxTilt ist die Bedingung in
    streuung.ts fuer jede Neigung falsch, die Art verschwindet
    vollstaendig aus der Welt — ohne Fehlermeldung, denn ein abgewiesener
    Kandidat ist der Normalfall.

    Er prueft ausserdem die Annahme, unter der der EntityManager ohne den
    Katalog ueber Store-Kollision entscheidet (STORE_NICHT_STREUEN statt
    `kollision: none`). Hier ist der Katalog umsonst, im Spiel-Buendel
    waere er es nicht.

    WEICHE wie bei den Nachbarn: fehlt `assets/store` GANZ, wird
    uebersprungen; fehlt eine EINZELNE Datei, wird er rot.
  */
  ['tools/test', 'store-felsen.ts', brauchtModelle('assets/store')],
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
  ['client', 'test/refraktion-huelle.ts'],
  ['client', 'test/wasser-farben.ts'],
  ['server', 'test/d6-zdo-delta.ts'],
  ['server', 'test/d8-save-async.ts'],
  ['server', 'test/d9-terrain-verdichtung.ts'],
  ['server', 'test/g2-persistence.ts'],
  // F5 (Roadmap): Fortschrittsmarken (GlobalKey-Laufzeitflaggen) — reine
  // WeltMarken-Logik (Idempotenz, Namensaufloesung), der Admin-Befehl
  // 'marke', ECHTES Speichern/Laden ueber zwei Zyklen, der Migrationspfad
  // fuer einen Altstand ohne globalKeys-Feld (handgebaut UND gegen eine
  // Kopie des echten 250k-ZDO-Standes dev.db.zst unter /tmp, niemals das
  // Original), und die einzige verdrahtete Anwendung: Eikthyr besiegen
  // setzt defeated_eikthyr, ein Reh NICHT (Regressionswache). ~2s.
  ['server', 'test/f5-weltmarken.ts'],
  ['server', 'test/g4-creatures.ts'],
  ['server', 'test/e2-vegetation.ts'],
  // A2 (Security-Review): reine Funktion — Paketwaffe zaehlt nur, wenn sie
  // im Server-Inventar liegt, sonst Faust. Sekunden, kein Server/Socket.
  ['server', 'test/a2-waffe-inventar.ts'],
  // A4 (Roadmap): Token-Bucket-Drosselung je Peer und Pakettyp. Reine
  // Funktion (Drossel.ts kennt weder Peer noch Socket), Zeit kommt als
  // Parameter herein — Sekunden, kein Server/Socket noetig.
  ['server', 'test/a4-drossel.ts'],
  // A14 (Roadmap): server.yml verspricht nichts, was niemand liest. Die
  // Dauer-Syntax, die Wache gegen einen neu eingetragenen toten Schluessel
  // in der ECHTEN server/data/server.yml, die Startwarnung — und der Draht
  // bis zum Ende: ein echter Server speichert wirklich im Takt der Datei
  // (400 ms statt der 30-min-Konstante). Startet dafuer kurz einen Server
  // auf Port 2593, raeumt sein Datenverzeichnis in `finally` weg. ~4s.
  ['server', 'test/a14-server-yml.ts'],
  /*
    S3: Der Test hält fest, dass zu jeder wählbaren Figur die GLBs WIRKLICH
    auf der Platte liegen — er braucht also `assets/` und gehört hinter die
    Weiche. Bis zum 04.09.2026 stand er ohne eine solche in der Liste und
    war in jedem Arbeitsbaum rot, der von `assets/models` nur den
    Dungeon-Ausschnitt sieht. Genau der Zustand, gegen den S3 gebaut ist:
    Ein dauerhaft roter Eintrag wird nicht gelesen, sondern übergangen —
    und dann fällt auch der echte Fehler nicht mehr auf.
  */
  [
    'server',
    'test/f17-figurenwahl.ts',
    brauchtModelle('assets/models/wikingerin/WikingerinKoerper.glb'),
  ],
  ['server', 'test/f18-haarfarbe.ts'],
  ['server', 'test/f19-wettervorgabe.ts'],
  // G12 (Roadmap): Betriebsmetriken -- reine Auswertung (Zaehler,
  // Sekundenabschluss, Prometheus-Formatierung), kein Server/Socket noetig
  // (Metriken.ts und shared/src/metrik.ts kennen beide weder Peer noch
  // WovServer). Sekunden.
  ['server', 'test/g12-metriken.ts'],
  ['server', 'test/k1-konten.ts'],
  // Anmeldung ohne Ticket-Sprung: der eingebaute Anmeldedialog fuer einen
  // lokalen Klon (client/src/ui/Anmeldung.ts) haengt vollstaendig an
  // dieser HTTP-API. Echter node:http-Server, Sekunden.
  ['server', 'test/konto-lokal.ts'],
  // Herkunft.ts hinter einem Reverse-Proxy: Loopback-Peer + X-Forwarded-For/
  // X-Real-IP wird geglaubt, jede andere Peer-Adresse nicht; und zwei
  // Herkuenfte sperren sich in der Anmelde-Drossel nicht gegenseitig.
  // Echter node:http-Server, Sekunden.
  ['server', 'test/konto-herkunft.ts'],
  // Registrierungs-Drossel (fuenf je Herkunft je Stunde, dann 429 mit
  // Retry-After) — `registrieren()` hatte bisher gar keine. Eigene Uhr
  // (Date.now gestellt) fuer den Ablauf des Fensters. Echter node:http-
  // Server, Sekunden.
  ['server', 'test/konto-registrierung-drossel.ts'],
  // F14 (Roadmap): Reichweiten-Auswahl der Chat-Empfänger (Whisper/
  // Normal/Shout, Herleitung s. Kopfkommentar von ChatReichweite.ts),
  // Grenzwert exakt auf der Reichweite, Absender immer dabei, sowie die
  // serverseitige Textlängengrenze. Reine Funktion, kein Server/Socket,
  // Sekunden.
  ['server', 'test/f14-chat-reichweite.ts'],
  // A3 (Security-Review): SetTimeOfDay ist admin-gated. E2E ueber echten
  // WebSocket-Handshake — haelt sowohl den Admin-Erfolgspfad als auch die
  // Ablehnung (InteractResult, kein TimeSync-Broadcast) fest.
  ['server', 'test/set-time-of-day.ts'],
  // F3/F4 (Security-Review): reine Logik aus Identitaet.ts — Spieler-ID,
  // SessionToken (Ausstellen/Pruefen/Ablauf/Faelschung, fremdes Geheimnis)
  // und der Nonce/HMAC-Passwort-Handshake inkl. des leeren-Passwort-Falls.
  // Sekunden, kein Server/Socket.
  ['server', 'test/f3-identitaet.ts'],
  // F3/F4 (Security-Review): der VERDRAHTETE Zustand, nicht nur die reine
  // Logik. E2E ueber echte WebSocket-Verbindungen: kein Client bekommt je
  // eine feste/geteilte userId ohne Token (Luecke A), ein anderer Name
  // bekommt NIE die Position eines fremden Namens, ein gefaelschtes Token
  // wird verworfen statt eine fremde Identitaet zu uebernehmen (Luecke B),
  // und ein gueltiges Token haelt die Identitaet ueber einen Reconnect
  // stabil.
  ['server', 'test/f3-einbau.ts'],
  // A5 (Schlusskontrolle Paket 2): Deckel fuer offene, nie authentifizierte
  // Verbindungen (MAX_PENDING_CONNECTIONS in NetManager.ts). Vorher zaehlte
  // die "Server voll"-Pruefung nur onlinePeers — der Pre-Auth-Timeout liess
  // sich per Ping endlos hinauszoegern. E2E ueber echte WebSocket-Verbindungen,
  // haelt sowohl das Offenbleiben bis zum Limit als auch die sofortige
  // Trennung darueber hinaus fest.
  ['server', 'test/verbindungsdeckel.ts'],
  // Die zwei Client-Tests der Kernliste. Beide kommen ohne Assets, Browser
  // und GPU aus — das ist die Bedingung, um hier zu stehen.
  //
  // Der Umkreis-Index sichert sich gegen die lineare Suche ab, die er
  // ersetzt hat: gleiche Eingabe, gleiche Treffermenge.
  // Der Waechter gegen den Unfall vom 16.08.2026: Der Editor hatte keinen
  // Ladeweg und ueberschrieb die echte Welt mit einem Testlayout, ohne dass
  // es jemandem auffiel. Prueft die Abgleichlogik gegen das ECHTE
  // Bestandsdokument — DOM-frei, Sekunden, gehoert damit hierher.
  ['client', 'test/welt-abgleich.ts'],
  // Account hand-off from wov-web: the legacy connection panel must be
  // absent from the static HTML, online entry requires a session, and
  // failures return to the one remaining login on the public website.
  // Source-level and DOM-free, so it belongs in the fast core list.
  ['client', 'test/direct-handoff.ts'],
  // The website URL is the language authority. Both character launch paths
  // must pass it to the game, where every loading-screen string is selected
  // from one complete locale object. Pure source/data assertions, no DOM.
  ['client', 'test/loading-language.ts'],
  ['client', 'test/spielhost.ts'],
  ['client', 'test/menu-i18n.ts'],
  // F6 (Roadmap): seq-Verwerfungsregel für Client-Vorhersage-
  // Reconciliation (client/src/net/Eingabeverwerfung.ts) — reine
  // Funktion. Seit dem Abgleich per Eingabesequenz nicht mehr tot:
  // Positionsverlauf.verwirfAelterAls ruft sie (s. naechster Eintrag).
  // DOM-frei, Sekunden.
  ['client', 'test/f6-seq-verwerfung.ts'],
  /*
    Der Abgleich Client<->Server gegen die eigene Position ZUM ZEITPUNKT
    der bestaetigten Eingabe (client/src/net/Positionsverlauf.ts).

    Warum das ein KERN-Test ist: Diese Regel entscheidet, ob die Figur
    beim Laufen zurueckgezogen wird. Ihr Fehlerbild ist kein Absturz,
    sondern „wirkt wie Lag" — und das faellt in keinem anderen Test auf.
    Geprueft werden Ringpuffer, Verwerfen (der bestaetigte seq bleibt
    liegen, weil Schaden/Respawn dasselbe Paket ausser der Reihe
    schicken), die Driftrechnung gegen den Verlaufspunkt statt gegen
    jetzt, das Abtragen des Versatzes ueber tau, die Selbstheilung nach
    einem Sprung des Clients und der Rueckfall auf das alte Verhalten.

    DOM-frei, Sekundenbruchteile.
  */
  ['client', 'test/positionsverlauf.ts'],
  ['client', 'test/entity-index.ts'],
  // Die Grafikoption begrenzt die gemeinsamen Bild-/Schattenmatrizen der
  // Vegetation. Der reine Kreisfilter sichert den unveraenderten Standard
  // (0 = voll), den eingeschlossenen Rand und die X/Z-Distanz ab.
  ['client', 'test/vegetations-grenze.ts'],
  // Weltzeit-Anzeige (Minimap): reine Umrechnung timeOfDay -> Stunde/
  // Minute/Sonnenstand, DOM-frei. Haelt Mitternacht, Mittag, die beiden
  // Uebergangsschwellen und den Tages-Ueberlauf fest.
  ['client', 'test/weltzeit.ts'],
  ['client', 'test/baumenue-hinweis.ts'],
  // Schweregrad-Klassifikation des Editor-Prüfberichts (Aufgabe B1): reine
  // Einstufung eines LayoutBefund nach Fehler/Hinweis, DOM-frei — anders
  // als editorMain.ts selbst, das beim Import sofort die Editor-Shell
  // aufbaut und einen Fetch anstößt und deshalb nicht isoliert testbar
  // ist. Prüft jeden Zweig einzeln UND gegen echte pruefeLayout-Ausgaben,
  // damit ein geänderter Wortlaut in pruefung.ts hier auffällt statt erst
  // als falsch gefärbte Zeile im Editor.
  ['client', 'test/befund-schwere.ts'],
  // Regions-Vorlagen, Feldvalidierung, Kontinente und Startpunkt-Logik
  // (Aufgaben B2/B10): reine Funktionen aus regionsWerkzeuge.ts, DOM-frei
  // aus demselben Grund wie befund-schwere.ts. Prueft jede Vorlage einzeln
  // UND gegen echte sanitizeWorldLayout-/pruefeLayout-Laeufe.
  ['client', 'test/region-werkzeuge.ts'],
  // WorldLayout-MCP-Server (Aufgabe B8): echter Client-Handshake gegen den
  // echten Server-Unterprozess (stdio), alle Werkzeuge vorhanden UND ihre
  // Wirkung im Dokument geprueft (Regionsregler, Kontinent/Fluss/See/
  // Route/Platzierung/Startpunkt, layout_pruefen, die meadows-Ablehnung,
  // die layout_deploy-Bremse unter WOV_LAYOUT_PFAD). Schreibt NIE in
  // server/data/welten/ -- baut sich eine eigene Welt unter /tmp und raeumt
  // sie in `finally` wieder weg (s. Kopfkommentar der Testdatei). ~2-3s.
  ['tools/worldlayout-mcp', 'probe.ts'],
  // Kuratierungskatalog (Roadmap B3): Katalogaufbau aus FOLIAGE/FEATURES/
  // SPAWN_TABLE, Suche und ordnungserhaltendes Hinzufuegen/Entfernen fuer
  // die Auswahl-Widgets der drei Kuratierungslisten. DOM-frei, Sekunden.
  ['client', 'test/kuratierungs-katalog.ts'],
  // Speicher-Katalog (Bauer C): die Einsortierungsregel des Asset-Speichers
  // gegen den ECHTEN Bestand — alle Manifest-Eintraege durch `einsortieren`,
  // Verteilung auf Art/Gruppe/Untergruppe, Uebersetzungstabelle ohne
  // Dubletten, Suche ueber Gruppe/Untergruppe/Kennzeichen. Die Zaehlung IST
  // der Test: Eine Regel, die stillschweigend alles in einen Sammeltopf
  // kippt, sieht im Katalog aus wie Ordnung. DOM-frei, Sekunden.
  // WEICHE: fehlt `assets/store` GANZ (CI-Checkout, der Speicher liegt
  // ausserhalb des Repos), wird uebersprungen. Fehlt nur EINE Datei darin,
  // wird der Test rot — dann ist der Speicher kaputt, nicht abwesend.
  // The store catalogue's sorting rule against the real inventory.
  ['client', 'test/store-katalog.ts', brauchtModelle('assets/store')],
  /*
    Stufe 2 (Bauer „Leistung"), Metall: `AssetManager.setzeMetallgrad`
    raet den Metallgrad aus dem MATERIALNAMEN — richtig fuer den alten
    Fremdexport, falsch fuer den Store, dessen GLBs ihren
    `metallicFactor` selbst tragen (durchweg 0). Ohne die Ausnahme
    rendern der Kristall und der Ring nahezu SCHWARZ: Das Labor hat keine
    `environmentTexture`, und ein volles Metall findet dann nichts zum
    Spiegeln. Der Test laeuft ueber die echte Klasse gegen die echten
    Materialnamen des Speichers und prueft die GEGENRICHTUNG mit — fuer
    den Altbestand muss die Namensregel weiter greifen, sonst waere er
    auch dann gruen, wenn jemand `setzeMetallgrad` ganz entfernt.
    NullEngine, keine GPU.
    WEICHE wie oben: ohne `assets/store` uebersprungen.
    Store materials must stay metallic 0 (the lab has no IBL).
  */
  ['client', 'test/store-metall.ts', brauchtModelle('assets/store')],
  /*
    Stufe 2, Toenung: Die Instanzfarbe, die den gestempelten Store-Wald
    aufbricht (`EntityManager.instanzToenung`). Geprueft wird, was ohne
    Test lautlos schiefginge — Determinismus je WELTPOSITION (an den
    Instanzindex gebunden wechselte ein Baum beim Vorbeilaufen die
    Farbe), die tatsaechliche Streuung (ein wirkungsloser Schalter sieht
    aus wie eine zu kleine Amplitude), das Fenster aus der Look-Analyse
    und ein Mittelwert von 1,0, damit die Toenung keine spaetere
    Look-Messung um einen unbekannten Betrag verschiebt. Reine
    Arithmetik, kein Babylon-Zustand, <1 s.
    Per-instance tint: deterministic, spread, amplitude, neutral mean.
  */
  ['client', 'test/instanz-toenung.ts'],
  /*
    Runde 2, Hebel 3: der Spitzen-Verlauf des Grases (`GRAS_SPITZEN`).
    Geprueft wird, dass der Faktor bei halber Halmhoehe auf 1,0 steht
    (der Verlauf verteilt Farbe, er hellt nicht auf — sonst waere jede
    Look-Messung danach verschoben), dass Mittel mal Faktor wieder die
    gemessenen Farben des Vorbilds ergibt (ein Tippfehler in einer der
    acht Farben faellt hier auf statt im Bild) und dass die aufbereitete
    GLB dasselbe Mittel traegt wie die Tabelle im Client. Der letzte
    Punkt braucht den Speicher und wird ohne ihn uebersprungen; der Rest
    ist reine Arithmetik, <1 s.
    Grass tip gradient: mean-preserving, endpoints, GLB factor in sync.
  */
  ['client', 'test/gras-spitzen.ts'],
  /*
    Stufe 2 (Integration): das zweite Netz gegen die verschachtelten
    Fernstufen des Speichers (`AssetManager.fernSchalen`). Abgetragen
    werden sie offline im Aufbereitungswerkzeug; die Regel im Client
    fängt nur, was ohne Aufbereitung ankommt.

    Der Test bewacht die Grenze in BEIDE Richtungen, und die zweite ist
    die wichtige: Der Speicher liefert dieselben Schalen AUCH als
    eigenständige Prefabs (`massive-tree-1a1-lod-1.glb` enthält einzig
    `Massive_Tree_1A1_LOD_1`, 9.185 Dreiecke). Eine Regel über den Namen
    — das nächste, wonach hier jemand greift — hätte diese Modelle leer
    gerendert, ohne Fehler und ohne dass irgendetwas rot geworden wäre.
    NullEngine, kein `assets/`, <1 s.
    The client-side net for nested LOD shells, and the standalone prefabs
    it must NOT touch.
  */
  ['client', 'test/lod-fernschalen.ts'],
  // Die Keulung der Schattenwerfer pro Instanz ist konservativ in genau
  // EINER Richtung: Was ueberlebt, wird eingereicht — verworfen wird nur,
  // was seitlich sicher ausserhalb des Lichtkastens liegt. Ein Fehler hier
  // loescht Schatten statt sie zu sparen, und zwar unauffaellig. Der Test
  // haelt drei Zusicherungen fest: entlang der Lichtachse wird NICHT
  // gekeult, der Bewegungsrand haelt die Packung bis zum naechsten
  // Neupacken, und entartete Eingaben liefern 0 statt Muell.
  ['client', 'test/schatten-instanz-keulung.ts'],
  // Das 100-FPS-Profil nutzt auf der niedrigen Stufe eine eigene
  // Schattenfassung. Der GPU-lose Test haelt 2 x 1024 px / 80 m fest und
  // prueft zugleich, dass alle normalen Stufen unveraendert bleiben.
  ['client', 'test/schatten-profil.ts'],
  // Die Schattenzeile des Farbprofils (`look.grading.schatten*`) stand bis
  // 12.09.2026 auf der Eins und tat nichts; seit sie den gemessenen Wert
  // traegt, haengt das halbe Bild an vier Zahlen, die niemand ansieht. Der
  // Test rechnet die Aufbereitung nach (Hex → 0,911/0,788/0,956), haelt
  // die Asymmetrie des Offsets fest (positiv wird VERVIERFACHT), zeigt am
  // Ueberlappungsfall, warum `setzeGrading` warnt, und prueft die
  // Eigenschaft der Lichterzeile, auf die es ankommt: sie zieht nur ZUR
  // unveraenderten Farbe hin. Dazu die eine Shaderzeile, auf der EINE
  // `nebelEnde`-Zahl fuer das ganze Bild steht — greift die Ersetzung in
  // `PbrNebelFix.ts` nicht, nebeln Fels und Gebaeude auf einer anderen
  // Kurve als der Boden, ohne Fehlermeldung. Reine Rechnung, keine GPU.
  ['client', 'test/grading-schatten.ts'],
  /*
    Runde 2, Hebel 3: der Farbverlauf der Blattkarten — gelbgruene Spitze
    ueber dunklem Ansatz, wie ihn das Vorbild im MATERIAL macht. glTF
    kennt nur einen Faktor, in der GLB steht deshalb das Mittel aus zwei
    Farben; der Verlauf dazwischen entsteht erst im Fragment-Shader. Vier
    Dinge daran koennen lautlos falsch sein, und genau die stehen im
    Test: die Richtung der V-Achse (Unity zaehlt von unten, glTF von
    oben — gedreht sitzt die helle Farbe am Ast statt an der Spitze, und
    das Laub wird flauer statt klarer), die Mittelwerttreue (der Verlauf
    darf die Krone nicht heimlich heller machen und damit die
    Helligkeitsmessung zweier anderer Bauer verschieben), der Abgleich
    der gepflegten Tabelle mit der ERZEUGTEN Zuordnung, und der Weg in
    den Shader (ein Plugin ohne `enable` landet in der passiven Liste und
    tut schlicht nichts — derselbe Fehler hat den Wind einmal ein halbes
    Jahr lang stillgelegt). Die Achsenprobe misst an der echten
    Speichergeometrie statt an einer Behauptung. NullEngine, keine GPU;
    ohne `assets/store-lab` fallen die beiden Speicherpruefungen weg.
    Foliage tip gradient: axis direction, mean preservation, tables, plugin.
  */
  ['client', 'test/laub-spitzen.ts'],
  // F3 „Ausfaelle": die drei Effekte, die liefen, kosteten und nichts
  // lieferten. Hier steht der GPU-lose Teil ihrer Reparatur — Kaskadendeckel
  // (Babylon klemmt `kaskaden: 1` auf 2, das Profil muss es auch),
  // Ankerdurchmesser aus einem WINKEL statt aus Metern, und der
  // 10-%-Konstantterm im Komposit-Shader, dessen Entfernung eine
  // Textersetzung ist und nach einem Babylon-Wechsel STILL ausbleiben kann.
  ['client', 'test/ausfaelle-zeugen.ts'],
  // Die Huellkoerper der Thin-Instance-Master entscheiden seit D10 ueber
  // die SICHTBARKEIT der Prefabs — ein Kasten, der eine Instanz auslaesst,
  // laesst das Objekt aus bestimmten Blickwinkeln verschwinden. Laeuft
  // ueber Babylons NullEngine: ohne GPU, ohne Assets, synthetische
  // Geometrie und Instanzlagen.
  ['client', 'test/master-huelle.ts'],
  // Die `_col`-Konvention (ein GLB-Mesh ist NUR Kollision): unsichtbar,
  // kein Schattenwerfer, und es ERSETZT die Kollision des Prefabs. Beide
  // Fehlerrichtungen sind im Spiel schwer zu sehen — ein grauer Klotz in
  // der Treppe, oder eine Treppe, an deren erster Stufe die Figur haengen
  // bleibt. Synthetischer Prototyp statt GLB (assets/ liegt ausserhalb des
  // Repos), NullEngine, Sekunden.
  ['client', 'test/kollisionsnetz.ts'],
  /*
    Die Gegenprobe dazu fuer den SPEICHER: Sein Fels muss ein Hindernis
    sein, seine Vegetation und seine Kulissen duerfen es nicht werden.

    Der Fehler, gegen den er steht, hat kein Symptom: `store-prefabs.mjs`
    gibt jedem Speicher-Prefab nur PERSISTENT, `COLLIDING_FLAGS` findet
    darin nichts, und die Klippe landet in `colliderless` — sie steht da,
    sieht richtig aus, und man laeuft hindurch. Gemessen wird der ganze
    Weg an echten Prefabnamen (getMasters -> applyStatic -> colliderSpecs),
    DOM-frei unter der NullEngine, Sekundenbruchteile.

    Ohne Weiche: Die GLBs werden nicht geladen, der Container ist
    synthetisch — gebraucht wird nur die Prefab-Registrierung.
  */
  ['client', 'test/store-fels-kollision.ts'],
  /*
    Die Spielfigur ist HAUTFARBEN und nicht weiss.

    Der Fehler dahinter hat kein Symptom im Testlauf: Als am 09.09. der
    Synty-Wikinger Vorgabefigur wurde, kam er ohne Toenung — sein
    Hautfeld ist sRGB 255/204/173, linear also eine Albedo von 1,0 im
    Rotkanal, und die laeuft unter unserer Sonne ueber. Die Datei laedt,
    die Clips laufen, npm test bleibt gruen, die Figur ist weiss.

    Geprueft wird deshalb die DECKUNG (jede Figur aus FIGUREN hat eine
    Zeile in FIGUR_TOENUNG — genau die vergessene Zeile), die HERLEITUNG
    der drei Zahlen (Atlas mal Toenung ergibt die Hautkarte der
    Wikingerin, der Figur aus dem Vorher-Bild) und die VERDRAHTUNG bis
    ins echte PBRMaterial, fuer beide Namensformen: der AssetManager
    reicht den Modellnamen durch, AvatarRig und die Charaktervorschau den
    Dateinamen.

    Ohne Weiche: Es wird kein GLB geladen, die beiden gemessenen Farben
    stehen als Konstanten im Test. NullEngine, Sekundenbruchteile.
  */
  ['client', 'test/figur-toenung.ts'],
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
  /*
    E2, zweite Haelfte: der geschriebene Saal durch Babylons ECHTEN
    glTF-Lader. `server/test/glb-schreiber.ts` liest mit einem eigenen,
    nachsichtigen Parser; im Spiel liest der Lader, und der ist streng.
    Was er beanstandet, meldet er ueber `Logger.Error`/`Logger.Warn` und
    NICHT als Ausnahme — ein Test, der nur auf `throw` wartet, sieht eine
    kaputte Datei als bestanden an. Deshalb haengt der Test einen
    Lauschposten in den Logger und misst zusaetzlich, wohin der `__root__`
    die drei Achsen dreht (die Rueckdrehung der Vorspiegelung). Ohne
    Weiche, weil er die Datei selbst erzeugt; den Vergleich mit
    StoneVaultHallLarge.glb laesst er ohne assets/ selbst aus. NullEngine,
    Sekunden.

    E2: the written hall through Babylon's real glTF loader.
  */
  ['client', 'test/glb-saal-laden.ts'],
  /*
    E7: Ein Modul mit `Gen_`-Praefix kommt aus `assets/generiert/`, alles
    andere aus `assets/models/` — und der Dev-Server liefert beides aus.
    Faellt eine der beiden Haelften weg, wird kein bestehender Test rot:
    die von Hand gepflegten Modelle laegen weiter richtig, und der Fehler
    zeigte sich erst im Browser als Platzhalter statt Saal. Gemessen wird
    deshalb an einem echten node:http-Server, der die ECHTE Ausliefer-Regel
    aus client/vite.config.ts faehrt und jeden angefragten Pfad
    mitschreibt; der AssetManager erfaehrt weder Port noch Ordner. Dieselbe
    Probe deckt den Ausbruch `/assets/..%2f…` mit ab. Ohne Weiche — der
    Test schreibt seine GLBs in einen Wegwerf-Ordner unter /tmp.
    NullEngine, Sekunden.

    E7: Gen_-prefixed modules load from the second base URL; the witness is
    an HTTP server running the real dev-server rule.
  */
  ['client', 'test/gen-basis-laden.ts'],
  // Der Wasser-Refraktionspass darf gestreute Vegetation nicht anhand der
  // weltweiten Thin-Instance-Hülle als "eingetaucht" einstufen. Auf der
  // Referenzinsel bedeutete dieser Fehler 36 Mio. unsichtbare Dreiecke pro
  // Bild. NullEngine reicht, weil Auswahl und Hüllen rein CPU-seitig sind.
  ['client', 'test/wasser-refraktion.ts'],
  // Der experimentelle WebGPU-Pfad verwendet fuer die bestehenden
  // Material-Plugins Babylons GLSL-Uebersetzung. Die Sprachflags muessen vor
  // dem ersten Material gesetzt sein und duerfen durch ein Babylon-Update
  // nicht still auf native WGSL-Shader umspringen.
  ['client', 'test/webgpu-kompatibilitaet.ts'],
  // Das Impostor-Fernfeld ersetzt ferne Vegetation durch Sprites. Sein
  // Fehlermodus ist nicht Ruckeln, sondern ein Baum, den WEDER der
  // Zell-Master NOCH das Sprite-Feld zeichnet — oder den beide zeichnen.
  // Beides ist blickwinkel- und positionsabhaengig, erzeugt keine
  // Meldung und ist beim Durchklicken nicht zu finden. Die Regel liegt
  // deshalb als reine Arithmetik in BaumImpostorKern.ts, und dieser Test
  // haelt sie fest: Der billige Zell-Vorfilter darf der
  // Pro-Instanz-Regel ueber tausende Faelle hinweg NIE widersprechen,
  // die Zuteilung ist eine echte Partition, das Atlasraster ueberlappt
  // nicht und bricht laut statt still, und ein Prototyp ohne Atlas
  // faellt auf die ECHTE Darstellung zurueck — nie auf gar keine.
  // DOM-frei, GPU-frei, Sekunden.
  ['client', 'test/baum-impostor.ts'],
  // Der Betriebsdienst haelt seit Block A/16 den Speicherweg des Editors.
  // Er gehoert in die KERNLISTE und nicht zu den langen Laeufen: Er
  // braucht keine Assets und keine GPU, ist in Sekunden durch — und die
  // Zusicherung, die er prueft, ist die teuerste im ganzen Projekt.
  // Ein misslungener Speichervorgang darf die Welt nicht beschaedigen;
  // wer das erst nach dem Ausrollen merkt, merkt es an der Welt.
  ['admin', 'test/betriebsdienst.ts'],
  // G4 (Testluecken-Durchsicht): ERGAENZT betriebsdienst.ts, deckt nicht
  // ab, was dort schon steht. Unbekannte WOV_INSTANZ (echter Prozessstart,
  // bricht vor jedem Dateizugriff ab), GET /status, GET/PUT /einstellungen/
  // server (Feldvalidierung, tatsaechlich geschriebener Wert, Sicherung),
  // GET /einstellungen/auslieferung (nur lesen), und der Testwelt-
  // Umschalter GET/POST /api/testwelt — dort NUR die Entscheidungslogik
  // vor dem echten systemctl-Aufruf (der Erfolgspfad wuerde den echten
  // wov-server neu starten, s. Kopfkommentar der Testdatei). Deckt
  // nebenbei einen echten Befund auf: ein ungueltiger Einstellungswert
  // (falscher Typ, Zahl ausserhalb der Grenzen) liefert heute HTTP 500
  // statt 400 (Sammel-catch in admin/src/main.ts stuft nur
  // LayoutUngueltig/SyntaxError als Eingabefehler ein). ~1s.
  ['admin', 'test/testwelt-einstellungen.ts'],
  // E8: der Betriebsdienst und die Modul-Registry. Steht neben den beiden
  // obigen und nicht in ihnen, weil er eine andere Frage stellt: nicht
  // „darf diese Anfrage", sondern „sieht dieser Dienst dasselbe wie der
  // Spielserver". Er haelt den STILLEN Raumverlust fest (18 Raeume rein,
  // 17 raus) und dazu, dass ein zur Laufzeit gebautes Modul OHNE Neustart
  // des Dienstes ankommt — und beim Loeschen wieder verschwindet. Braucht
  // weder Assets noch GPU, ~2 s.
  ['admin', 'test/modulregistry.ts'],
  // G1-Durchsicht (verwaiste Tests, 20.08.2026): init() ohne start() —
  // kein Port, kein Socket. Haelt getGroundHeight(0,0) gegen den
  // D1-verifizierten Wert UND die Fallphysik-Konvergenz fest, damit ein
  // Rueckfall auf den alten Radial-Spawnpunkt sofort auffiele.
  ['server', 'test/d6-smoke.ts'],
  // G1-Durchsicht: Admin-Befehlsregister + serverautoritativer Flugmodus
  // (Space/Ctrl/Shift), reiner Funktionsaufruf ueber echten Writer/Reader,
  // kein Socket. War tot wegen einer veralteten Fake-Peer-Attrappe (siehe
  // Kommentar im Test) — Fix ist NUR im Test, nicht in WovServer.ts.
  ['server', 'test/g1-admin-fly.ts'],
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
  ['server', 'test/kollision-schritt.ts'],
  /*
    Die Ausdauerregel, nach dem Umzug nach `shared/src/bewegung/ausdauer.ts`.

    Warum sie einen eigenen Eintrag bekommt: Sie entscheidet ueber das
    TEMPO (7,5 gegen 4,5 m/s) und damit ueber eine Wegstrecke. Solange nur
    der Server sie kannte, lief der Client nach 20 s Sprint 190 m weit,
    waehrend der Server bei 122 m stand — der weiche Abgleich zog die Figur
    die ganze Zeit zurueck, und das sah aus wie Lag. Der Test haelt fest,
    dass der Server nach dem Umbau BITGLEICH dasselbe rechnet (100 Pakete
    durch `handlePlayerInput` mit gestellter Uhr, dazu ein 20-s-Sprint bis
    in den Saegezahn) und dass zwei verschiedene Takte — Client 60 Hz,
    Server 20 Hz — dabei nicht auseinanderlaufen.

    Kein Netz, keine GPU, ~2 s.

    The stamina rule after its move into `shared`: server behaviour must be
    bit-identical, and client (60 Hz) and server (20 Hz) must stay in step.
  */
  ['server', 'test/ausdauer-abgleich.ts'],
  /*
    Gehoert `PlayerState.seq` zu der Position, die im selben Paket steht?

    Der Client rechnet seine Drift gegen die eigene Position ZUM
    ZEITPUNKT der bestaetigten Eingabe. Das setzt voraus, dass der Server
    beide Felder aus DEMSELBEN Takt schickt — bis zum Umbau tat er es
    nicht: `sendPlayerState` lief VOR der Positionsberechnung und meldete
    die Stelle des vorigen Takts mit der seq des aktuellen. Ein
    Client-Test kann das nicht sehen; er sieht nur, was aus dem Paket
    herauskommt, nicht was hineingeschrieben wurde.

    Fake-Peer wie g1-admin-fly, echter Writer/Reader, kein Netz. Prueft
    ausserdem den Takt (10 Hz statt 4 Hz) und dass Aufrufer ausserhalb
    des Eingabepfads (Schaden, Respawn) unveraendert sofort melden.
    ~1 s.
  */
  ['server', 'test/abgleich-seq-position.ts'],
  /*
    Der Kugel-Sweep (11.09.2026): Ecken, Wandenden und die laterale
    Luecke, die die drei versetzten Strahlen davor gelassen haben. Sein
    wichtigster Teil ist ein ZAEHLBEWEIS — ein Scan ueber Winkel und
    Standort rund um ein Wandende zaehlt die Einzelschritte, die die Wand
    beruehren wuerden und trotzdem nicht gemeldet werden. Mit den Strahlen
    waren es bis zu 18,9 %, jetzt sind es 0; die alten Zahlen stehen im
    Test, damit ein Rueckfall nicht nur „rot" ist, sondern beziffert.

    Ohne Welt und ohne Netz: dieselbe `nahfeldAus`-Bank wie in
    `kollision-schritt.ts`, reine Geometrie. ~2 s, obwohl der Scan rund
    16.000 Abfragen wirft — der Vorfilter des Nahfelds traegt.

    Swept-sphere collision: corners, wall ends, and the lateral gap the
    three offset rays used to leave. Counting proof plus fixed cases.
  */
  ['server', 'test/kollision-ecke.ts'],
  // G1-Durchsicht: einziger E2E-Test fuer Dungeon-Betreten/-Verlassen ueber
  // echten WebSocket-Handshake. War tot durch ZWEI unabhaengige
  // Test-Bugs (Handshake-HMAC und ZDOSync-Parser bauten die Produktivlogik
  // von Hand nach statt sie zu rufen — s. Importkommentare im Test).
  // ~4s, kein einziges Byte davon war ein echter Produktivfehler.
  ['server', 'test/g6-dungeon-e2e.ts'],
  // G1-Durchsicht: Wetter/Wind-Port (Timing aus den Assets, Determinismus,
  // Ziehungsgewichte, Windclamp/-rampe, windData-Alpha, Niederschlags-
  // zuordnung). Reine Funktion, kein Server/Socket, Sekunden.
  ['shared', 'test/weather.ts'],
  // G1-Durchsicht: Inventar-Paritaet zu Unity Inventory.cs (Stapeln,
  // Fuellrichtung, Hotbar, Verschieben/Tauschen, Kapazitaet, Speichern/
  // Laden, Gewicht). Reine Funktion, Sekunden.
  ['shared', 'test/inventory.ts'],
  // G1-Durchsicht: Terraforming-Paritaet (Level/Raise/Smooth-Grenzwerte,
  // Zonennaht bit-identisch, baseHeights bleibt unberuehrt, Cache-Eviktion,
  // Comp-Hygiene). War tot durch eine veraltete Annahme ueber den
  // applyTerrainOp-Rueckgabewert (frueher ein flaches Array, jetzt
  // {heights, paint}) — Fix nur im Test. ~7s, kein Server/Socket.
  ['shared', 'test/terrain-comp.ts'],
  // G1-Durchsicht: B5 modernes AshLands-Noise hinter dem Feature-Flag
  // (Legacy-Pfad unveraendert, Lava-Maske in [0,1] und variiert,
  // preGeneration bleibt zwischen den Modi identisch, das Terrain aendert
  // sich wirklich). Reine Funktion, Sekunden.
  ['shared', 'test/b5-ashlands-modern.ts'],
  // F16 (Roadmap): Fehlersammler fuer die HUD-Fehleranzeige — Dedupe
  // gleicher Meldungen ("3x"), Deckel fuer gleichzeitige Eintraege,
  // TTL-Ablauf. DOM-frei (Hud.ts rendert, diese Datei entscheidet nur
  // was/wie lange), Sekunden.
  ['client', 'test/fehlermeldungen.ts'],
  // G2 (Roadmap, "die groesste Testluecke"): Kampf ueber den ECHTEN
  // Paketpfad (handleAttack/handleHarvest) — Schaden nur aus dem
  // Server-Inventar (A2 im Draht), Ausdauerverbrauch, Reichweite gegen die
  // Server-Position, Cooldown ueber die Drossel, Tod und garantierte Beute.
  // Kein Server/Socket-Nachbau: echter WebSocket-Handshake, echte Pakete.
  ['server', 'test/g7-kampf.ts'],
  // G2: Bauen und Abreissen ueber den ECHTEN Paketpfad (handlePlacePiece/
  // handleRemovePiece) — Materialkosten, 'besitzer'-Member, Abriss durch
  // Fremde bleibt wirkungslos, halbe Rueckerstattung beim Eigentuemer,
  // Reichweitenpruefung.
  ['server', 'test/g7-bauen.ts'],
  // G2: Craften und Essen ueber den ECHTEN Paketpfad (handleCraft/
  // handleEat) — Rezeptpruefung, GAR KEIN Abzug bei nur einer fehlenden
  // Zutat, unbekanntes Rezept, Essens-Buff, wirkungsloses Essen ohne Item.
  ['server', 'test/g7-craft-essen.ts'],
  // G2: Terraforming ueber den ECHTEN Paketpfad (handleTerrainOp) —
  // d9-terrain-verdichtung.ts prueft die Datenstruktur direkt, dieser Test
  // den Paketpfad davor: anwenden, speichern, laden, keine Verdopplung des
  // WELTZUSTANDS. Deckt nebenbei einen echten Befund auf (s. Kopfkommentar
  // der Testdatei): der Broadcast-Sparpfad in handleTerrainOp greift beim
  // 'level'-Zweig NICHT — ein zweiter Klick auf bereits planierten Boden
  // loest trotzdem einen weiteren TerrainOpSync an alle Peers aus.
  ['server', 'test/g7-terraforming.ts'],
  // G2: Rate-Limits IM ECHTEN PAKETPFAD (NetManager.handlePacket →
  // Drossel) — a4-drossel.ts prueft nur die reine Token-Bucket-Logik.
  // Haelt fest, DASS die Drossel greift (PlacePiece-Stoss von 9: genau 8
  // kommen durch) UND dass legitimes Spielen nicht abgewuergt wird — allen
  // voran PlayerInput bei der ECHTEN 20-Hz-Client-Frequenz ueber eine volle
  // Sekunde ohne ein einziges verworfenes Paket.
  ['server', 'test/g7-drossel-einbau.ts'],
  // G2: Handshake-Fehlerpfade ueber den ECHTEN NetManager — falsches
  // Passwort, veraltete Client-Version, ein abgeschnittenes Paket (Server-
  // PROZESS ueberlebt, nur die eine Verbindung wird getrennt) und ein
  // Paket vor der Anmeldung (stumm verworfen, Verbindung bleibt offen).
  ['server', 'test/g7-handshake-fehler.ts'],
  // G2: ZDO-Interest-Management ueber den ECHTEN Sync-Pfad (syncZDOs →
  // ZonenFenster, echter Client-Parser wie d6-zdo-delta.ts) — ein Peer
  // bekommt, was in seiner Naehe liegt (256 m, SICHT_RADIUS_ZONEN), nicht
  // was weit weg liegt, und das Fenster folgt seiner Position.
  ['server', 'test/g7-zdo-interessen.ts'],
  // Etappe 5: von Hand gesetzte Deko ueberlebt Abriss und Neustart.
  // Kein Socket, kein Server — reine Dokument- und Instanzpruefung, Sekunden.
  ['server', 'test/g8-dungeon-deko.ts'],
  ['server', 'test/g9-editor-verbindung.ts'],
  // Licht-Hints kommen an der Registry an. Ein Prefab ohne `light` ist
  // nicht kaputt, es ist dunkel — und dunkel faellt nirgends auf.
  ['shared', 'test/licht-hints.ts'],
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
  // F1 (Roadmap, Security-Review-Paket 3): Truhen mit echtem, entnehmbarem
  // Inhalt statt des alten Ein-Bit-Schalters. E2E ueber echte WebSocket-
  // Verbindungen (handleTruheOeffnen/handleContainerAction sind private
  // Paket-Handler, nur so erreichbar): Erstbefuellung genau einmal,
  // Nehmen+Legen konserviert die Menge, eine bereits geplünderte Alt-Truhe
  // startet leer, ein Spieler ausserhalb der 6-m-Reichweite wird abgewiesen,
  // der Inhalt uebersteht Speichern/Laden. Drei gestartete Server + ein
  // init()-only Reload, ~5s.
  ['server', 'test/f1-truhe.ts'],
  // G3 (Testluecken-Durchsicht, "kein einziger Test mit zwei
  // gleichzeitigen Clients"): echte WebSocket-Handshakes fuer ZWEI+ Peers
  // gleichzeitig gegen einen echten WovServer. Gegenseitige ZDO-
  // Sichtbarkeit (echter Client-Parser parseZDOSync/ZDOSpiegel, wie
  // g7-zdo-interessen.ts), Chat-Reichweite (F14) ueber echte Pakete an
  // fuenf Peers in kontrollierten Abstaenden, gleichzeitiges Bauen am
  // selben Ort (Ist-Zustand: keine Kollisionspruefung, zwei ueberlappende
  // ZDOs), eine Truhe zu zweit (F1: gleichzeitig derselbe Stapel — in
  // Summe entsteht nichts), und ein Peer, der geht (der andere merkt es,
  // Drossel-/Peer-Zustand wird aufgeraeumt). Deckt nebenbei einen echten
  // Befund auf (s. Kopfkommentar der Testdatei, Test 1): verlaesst ein
  // ZDO nur das Sichtfenster eines Peers, OHNE zerstoert zu werden (ein
  // Spieler laeuft weg, bleibt aber verbunden), bekommt der Peer NIE eine
  // Abmeldung — ein eingefrorener Geist an der letzten bekannten Position
  // statt eines verschwindenden Spielers. ~4s.
  ['server', 'test/g3-mehrspieler-e2e.ts'],
  // F2 (Roadmap): assets/manifest.json (tools/asset-manifest.mjs) haelt Huellbox,
  // Dreieckszahl, Animationen und mesh-lose Rigs je GLB fest -- ohne diesen Test
  // veraltet es lautlos (neues Modell ohne Eintrag, geloeschtes mit Leiche im
  // Manifest). Liest nur Dateinamen gegeneinander, baut die glTF-Messung nicht
  // nach. Kein Server/Socket, Sekunden.
  //
  // S3: Er vergleicht das getrackte Manifest mit dem UNGETRACKTEN
  // Plattenbestand — sieht ein Arbeitsbaum nur einen Ausschnitt von
  // `assets/models`, meldet er jeden fehlenden Eintrag als Fehler und ist
  // dauerhaft rot. `PlayerAvatar.glb` steht hier stellvertretend für den
  // vollen Bestand: Es ist keine Dungeon-Datei und liegt deshalb nur dort,
  // wo wirklich alle Modelle liegen.
  [
    'tools',
    'test/manifest-vollstaendig.ts',
    brauchtModelle('assets/models/PlayerAvatar.glb'),
  ],
  /*
    E7: `assets/generiert/` ist ein SCHWESTERORDNER von `assets/models/`,
    kein Unterordner — und muss es bleiben. Unter `assets/` ist genau eine
    Datei getrackt (`assets/manifest.json`); schriebe der Spielserver seine
    gebauten Saele nach `assets/models/`, machte jeder Klick im Editor den
    Testlauf rot UND hinterliesse eine ungetrackte Aenderung an einer
    getrackten Datei, die das naechste `git pull` in tools/wov-update.sh
    blockiert. Heute stimmt die Trennung, aber nur als Zufall der Pfade —
    ein Zufall hat keine Bruchstelle, an der etwas anschlaegt. Der Test
    legt deshalb eine echte GLB an den kuenftigen Zielort und laesst BEIDE
    Manifest-Werkzeuge im Original laufen: Ausgabe und erzeugtes Manifest
    muessen Zeichen fuer Zeichen dieselben bleiben. Springt ueber, wenn
    assets/models/ fehlt; raeumt die Attrappe selbst weg. Ein paar
    Sekunden (vier tsx-Starts).

    E7: the generated-assets folder must stay invisible to both manifest
    tools — same output, same bytes, clean `git status assets/`.
  */
  ['tools', 'test/generiert-getrennt.ts'],
  // F5: die zwei Zuordnungen, mit denen `--abgleich` von einer Prefab-
  // Definition auf die GLB kommt, die sie wirklich laedt — MODELL_ALIAS
  // (aus dem Client-Quelltext gelesen) und Fels-Modul -> Stammmodul (aus
  // der Kit-Ableitung). Beide scheitern lautlos, indem sie etwas aus dem
  // Bericht FALLEN lassen. Braucht keine Modelldateien, laeuft also auch
  // im CI-Checkout. Sekundenbruchteile.
  ['tools', 'test/manifest-zuordnung.ts'],

  // ── Asset-Bruecke: der Speicher unter assets/store ─────────────────
  //
  // Drei Tests, absichtlich getrennt nach dem, was sie VORAUSSETZEN:
  //
  //  1. `shared/test/store-registry.ts` rechnet nur mit der erzeugten
  //     Tabelle (eingecheckt) — keine Dateien, keine Weiche, laeuft im
  //     CI-Checkout. Er haelt fest, dass die 569 Store-Prefabs wirklich
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
  ['client', 'test/store-ladepfad.ts'],

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
  /*
    Die GROESSENSTUFEN (11.09.2026). Die Form steht lokal zur Instanz,
    die Instanzgroesse muss also IN die Form — und die Streuung wuerfelt
    sie kontinuierlich. Mit dem alten Millimeterschluessel bekam damit
    jeder Stein sein eigenes Havok-Netz samt eigener Kopie der
    Vertexdaten. `skalierungsStufe` rastet die Groesse auf 20 Stufen je
    Oktave (<= 5 % relativ) ein, und Client wie Server rufen DIESELBE
    Funktion — eine Ersparnis, die nur einer von beiden macht, waere eine
    neue Abweichung.

    Der Test misst an einer echt gestreuten Region: 546 -> 282 Formen
    ueber die geladenen Zonen (320 m). Braucht keine Modelldatei,
    gezaehlt werden Groessen. ~2 s.

    Scale ladder shared by client and server; counts the shapes a real
    scattered region needs before and after.
  */
  ['server', 'test/kollision-formstufen.ts'],
  ['client', 'test/kollision-formen.ts', brauchtStore()],
  ['server', 'test/kollision-formen.ts', brauchtStore()],
  ['server', 'test/kollision-einhaengung.ts', brauchtStore()],
  ['tools', 'test/store-erzeugung.ts', brauchtStore()],
  ['tools', 'test/store-einsortierung.ts', brauchtModelle('assets/store')],

  // ── Stufe 2: die Bodenschichten des Vorbilds ──────────────────────
  //
  // `tools/test/terrain-schichten.ts` haelt vier Dinge fest, von denen
  // keines beim Ausfuehren auffaellt:
  //
  //  1. Das Werkzeug `store-terrain-schichten.mjs` laeuft DETERMINISTISCH
  //     — zweiter Lauf, byteidentische Dateien. Seine Ausgabe liegt unter
  //     `assets/generiert/` und damit ausserhalb von Git; ein `git
  //     status` wuerde eine wandernde Ausgabe nie melden.
  //
  //  2. Werkzeug und Shader nennen DIESELBEN Zahlen. Kachelmass,
  //     Normalstaerke, Metallic und Glaette stehen zwangslaeufig zweimal
  //     (das Werkzeug baut die Pixel, `TerrainSplat.ts` baut den Shader,
  //     und der entsteht, bevor `assets/generiert/` gelesen wird). Zwei
  //     Listen laufen auseinander, sobald jemand EINE korrigiert.
  //
  //  3. Jedes der fuenf Biome hat eine Kachel fuer flach, mittleren und
  //     steilen Hang. Fehlt eine, traegt der Berg weiter Gras — das sieht
  //     nicht falsch aus, nur nicht nach Berg.
  //
  //  4. Beide Schalter (`STORE_BODEN_AKTIV`, `BODEN_FACETTIERT`) sind als
  //     `boolean` typisiert. Mit einem Literaltyp narrowt TypeScript den
  //     anderen Zweig zu totem Code, und der Rueckfall auf Stufe 0 ist
  //     beim naechsten Umbau still kaputt.
  //
  // WEICHE `brauchtBodenQuellen()`: Der Test braucht ZWEI Ordner, nicht
  // einen. Fehlt einer davon GANZ, wird uebersprungen; fehlen EINZELNE
  // Dateien darin, wird der Test rot. Begruendung bei der Funktion.
  ['tools', 'test/terrain-schichten.ts', brauchtBodenQuellen()],

  /*
    Die Rauschmaske auf dem Felsanteil (A11, 11.09.2026).

    `tools/test/fels-rauschen.ts` rechnet ueber 4 Millionen Proben nach,
    was im Kopf von `client/src/engine/felsRauschen.ts` als Zahl steht:
    Der Erwartungswert bleibt der Deckel aus `RAMPEN` (der Ausschlag 1,45
    klemmt unten bei 0, und ein abgeschnittener Schwanz HEBT den Mittel-
    wert — der Ausgleich rechnet ihn heraus), der Fels wird nirgends rein
    (Vorbild 0,0 %), und es gibt wieder reines Moos (Vorbild 19,2 %; die
    alte Maske hatte 0,0 %). Dazu: die erzeugten GLSL-Zeilen tragen
    dieselben Zahlen wie die TypeScript-Fassung — ohne das ist die
    CPU-Fassung eine Abschrift, und jede Messmaske, die sie benutzt,
    misst eine andere Schicht als der Bildschirm zeigt.

    KEINE WEICHE: Die Datei importiert bewusst kein Babylon und braucht
    keine Assets, laeuft also auch im CI-Checkout.
  */
  ['tools', 'test/fels-rauschen.ts'],

  /*
    Der Boden gegen das VORBILD (10.09.2026, `design/original-boden.md`).
    `tools/test/look-referenz.ts` ist dabei umgedreht worden, und das ist
    der Kern der Sache: Bis dahin hat er vier TOENUNGEN bewacht, die am
    Referenzbild zurueckgerechnet waren. Die Spezifikation aus den
    Spieldateien sagt, dass es sie im Vorbild nicht gibt (alle
    `m_DiffuseRemap` 0…1, alle `m_Specular` schwarz) — ein Test, der eine
    Erfindung bewacht, macht sie unantastbar.

    Was er jetzt festhaelt:

     * KEINE Zeile traegt eine Toenung. Der naechste „der Hang ist zu
       hell"-Befund laesst sich in zehn Minuten mit einem Faktor
       erschlagen; wer einen braucht, braucht zuerst eine Messung.
     * Die Schichtoberflaechen stehen auf Tabelle A der Spezifikation.
       Metallic 0,85 auf `rock-a` und Kachel 3 m / Normale 5 auf
       `rock-rough` sind die zwei Paare, aus denen „ich lese den Fels als
       Erde" entstanden ist.
     * Die Rampe hat einen DECKEL. Das Vorbild hat bei ≥ 45° nur 0,425
       Felsgewicht — Moos bleibt in der Wand.
     * Die Halmhoehen sind die der Detail-Prototypen (0,50–0,75 m hoch,
       0,25–0,38 m kurz am Steilhang), und kurzes Gras haengt an der
       NEIGUNG statt an der Menge.
     * `TOENUNG_VORRANG` traegt nur noch, wofuer das Vorbild eine Zahl
       liefert (Ahorn ja, Gras nein).
     * Und unveraendert: Gras wirft keinen Schatten, kein Laubmaterial
       reisst aus, Schnee bleibt im Hohen Norden.

    Braucht `assets/store-lab/vegetation` nur fuer den Laub-Zensus; fehlt
    der Ordner, ueberspringt er DIESEN EINEN Abschnitt und prueft den
    Rest weiter. Deshalb keine Weiche.
  */
  ['tools', 'test/look-referenz.ts'],

  /*
    Stufe 2 (Bauer „Licht"): das Wetter „Klar-Comic", der `look:`-Block und
    die Nebelkurve. Reine Rechnung — kein Browser, keine GPU, kein
    `assets/`, rund 0,3 s; er braucht deshalb keine Weiche fuer den
    CI-Checkout.

    Er stand bis zum 09.09.2026 in LANG und lief damit nur bei
    `npm test -- --alle`. Das war eine Einordnung nach Thema statt nach
    Kosten: In LANG stehen Laeufe, die einen Server hochfahren oder
    Sekunden brauchen; dieser hier ist eine Rechnung von 0,3 s und
    gehoert zu den anderen reinen Rechnungen im Kernlauf. Ein Test, der
    im normalen Lauf nicht mitfaehrt, faellt beim Brechen nicht auf.

    Was er festhaelt, ist dreimal dieselbe Sorte Fehler: etwas, das
    aussieht wie ein gesetzter Wert und keiner ist. Ein fehlendes
    EnvSetup-Feld bekommt still den Wert von `Clear` untergeschoben; ein
    Tippfehler im `look:`-Block kommt nie im Client an; und eine
    Nebeldichte, die von exp2 nach exp uebernommen wird, aendert die
    Sichtweite um Faktor 1,2, ohne dass irgendwo eine Zahl falsch aussaehe.

    Stage 2 (lighting): the Klar-Comic weather, the look: block and the fog
    curve. Pure arithmetic, ~0.3 s, no browser and no assets.
  */
  ['server', 'test/stufe2-licht.ts'],

  /*
    Block A, Bauer „Himmel und Licht": der Verlauf der Kuppel (A5), die
    Wolkendeckung, der zweite Sonnenhof (A12) und die Schattendunkelheit
    (A7) — alles als DATEN, ohne Browser und ohne Bild.

    Warum ein eigener Test und nicht ein Abschnitt in stufe2-licht.ts:
    Er faehrt `shared/src/lookHimmel.ts` in BEIDEN Zustaenden — „noch
    nicht in LookHimmel eingehaengt" und „eingehaengt" —, und genau
    dieser Wechsel steht dem Integrator noch bevor. Faellt der Test beim
    Einhaengen um, hat er seine Arbeit getan.

    Block A, builder "sky and light": dome gradient, cloud cover, the
    second sun halo and the shadow darkness — data only, no browser.
  */
  ['server', 'test/a5-himmel.ts'],

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
  // Das eingefrorene Layout-Datenformat v1 samt Kanonisierung und
  // Prüfsumme. Ändert sich die Kanonisierung, fällt der Test — das ist
  // sein ganzer Zweck.
  ['shared', 'test/dungeon2-layout.ts'],
  // Ganzzahlige Positions-Hashes (`Math.imul`). Der `Math.sin`-Hash, den
  // die Vorlage benutzte, läuft in Node und im Browser verschieden — und
  // zwar still.
  ['shared', 'test/dungeon2-hashing.ts'],
  // Die Invarianten aus ARCHITECTURE.md §3.7, je Regel ein Positiv- UND
  // ein Negativfall.
  ['shared', 'test/dungeon2-invarianten.ts'],
  // Der Generator: Zyklen, Ebenen, Treppen, Mündungen, und das
  // Abnahmekriterium „eine zusätzliche Ziehung im Deko-Strom verändert
  // kein einziges Stempel-Feld". ~3 s.
  ['shared', 'test/dungeon2-generator.ts'],
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
  // Parität Zellgitter ↔ Geometrie: über eine halbe Million Proben hin
  // und her. ~2 s.
  ['shared', 'test/dungeon2-paritaet.ts'],
  // AP13: Das 2.0-Instanz-Dokument und die Weiche im Sanitizer — ein
  // 2.0-Dokument darf nie durch den Alt-Sanitizer laufen und umgekehrt,
  // beide Richtungen geprüft.
  ['shared', 'test/dungeon2-dokument.ts'],
  // Der Client-Bauer an einer NullEngine: Meshes je Block, Begehbarkeit
  // über die Kollisionsformen, und Bau/Abriss ×20 zurück auf exakt den
  // Ausgangsstand. ~7 s.
  ['client', 'test/dungeon2-bauer.ts'],
  // Das Triplanar-Plugin gegen den ECHTEN `pbrPixelShader` aus dem
  // ShaderStore — alle vier Einspritzpunkte inklusive Reihenfolge und
  // `highp`. Fällt, sobald ein Babylon-Update die Ankerzeilen verschiebt.
  ['client', 'test/dungeon2-material.ts'],
  // F1 (Fels-Relief 3a): der NORMAL-Kanal des 1.0-Steinmaterials. Prüft am
  // installierten Babylon nach, dass `normalW` am Einspritzpunkt beschreibbar
  // ist UND danach noch gelesen wird, fährt den erzeugten Shader durch alle
  // Präprozessor-Varianten (ohne Karte, Wand, Wand+Boden, alle drei) und
  // hält fest, dass eine fehlende Datei das heutige Verhalten ergibt statt
  // einer schwarzen Wand. Liegt `glslangValidator` auf dem PATH, wird jede
  // Variante zusätzlich wirklich übersetzt; sonst meldet sie sich als
  // übersprungen. Kein `assets/`, keine GPU, ~2 s.
  // F1: the stone material's normal channel — text-only, plus a real GLSL
  // compile when glslangValidator happens to be installed.
  ['client', 'test/stein-normal.ts'],
  // 05.09.2026: der ABFALL des Fackellichts. `1/d²` ist das Gesetz fuer
  // einen Punkt; eine 25 cm hohe Flamme ist keiner, und an der Wand 15 cm
  // dahinter liefert die Punktformel den Faktor 44. Der Test haelt fest,
  // dass der PBR-Zweig mit `1/(d²+r²)` rechnet, der StandardMaterial-Zweig
  // linear bleibt, und rechnet die Daempfung an vier Abstaenden nach.
  // Reiner Text, keine GPU, <1 s.
  ['client', 'test/fackel-licht.ts'],
  // F2 (Fels-Relief 3a): das Steinmaterial JE DOKUMENT — Erlaubnisliste,
  // Sanitizer und Raum-Override, dazu der Fels-Eintrag `stein_fels` und
  // die Zusage, dass KEINE Normal-Karte in der Liste steht (sie wäre im
  // Editor-Dropdown ein wählbares Albedo). Der Test lag bisher als
  // einziger der Steinkit-Reihe nicht im Sammellauf. Reine Logik, ~2 s.
  // F2: the per-document stone material allow-list and sanitizer.
  ['shared', 'test/dungeon-steinkit-dokument.ts'],
  // F2: Misst das Fels-TEXTURPAAR selbst — Format, Kachelnaht gegen das
  // Bildinnere, Anisotropie (waagerechte Fugen verrieten Mauerwerk) und
  // die Reliefstärke der Normal-Karte. Liest das PNG mit `node:zlib`,
  // braucht also weder PIL noch Blender — aber die Dateien, und die
  // liegen in `assets/`.
  // F2: measures the rock texture pair itself (tiling, format, relief).
  [
    'tools/elements',
    'pruefung/fels-textur.mjs',
    brauchtModelle('assets/models/stein_fels.png', 'assets/models/stein_fels_normal.png'),
  ],
  // F3 (Fels-Relief 3b): die BLOCKLAGE der Fels-Frontschicht — die Naht an
  // der Modulgrenze (jedes abgeschnittene Reststück trifft sein Gegenstück
  // in Höhe und Tiefe), die Hüllbox (kein Block steht weiter vor als das
  // Ziegelrelief, sonst wäre `DG_RockVault` kein abgeleitetes Kit mehr) und
  // das Dreiecksbudget von 1500 je Wandpaneel. Befragt `felsrelief.py` per
  // `python3 --dump`; kein Blender, kein `assets/`, ~1 s.
  // F3: the rock front layer's block lattice — seam, bounding box, budget.
  ['tools/elements', 'pruefung/fels-frontschicht.mjs', brauchtPython()],
  /*
    Mass A (05.09.2026): der WAECHTER ueber die Kollisionstrennung. Die
    Fels-Frontschicht darf seit heute 18 statt 9 cm tief sein — aber nur,
    weil jedes Fels-Wandmodul ein glattes `_col`-Netz mitbringt, an dem
    die Spielerkapsel entlanggleitet. Faellt das Netz aus einer GLB heraus,
    sieht man NICHTS; die Figur bleibt nur irgendwann in einer Kluft
    haengen. Dieser Pruefer misst die ausgelieferten GLB (Blender headless)
    und haelt fest, dass jedes Modul mit Frontschicht sein `_col` hat, dass
    es dieselbe Huellbox und mehr Volumen hat (also die Kluefte fuellt),
    und dass Zelle, Saele und das Ziegelkit KEINS bekommen haben.
    Guard for the rock kit's separated collision meshes.
  */
  [
    'tools/elements',
    'pruefung/fels-kollision.mjs',
    brauchtBlender('assets/models/RockVaultWall.glb', 'assets/models/StoneVaultStairs.glb'),
  ],
  /*
    Mass D (05.09.2026): die gebackene VERSCHATTUNG im Netz. In der Krypta
    steht kein gerichtetes Licht — gemessen war der Relieffaktor mit gegen
    ohne Normal-Kanal 1,001. Die Fels-Wandmodule tragen deshalb ein
    COLOR_0 aus der Kruemmung des Hoehenfeldes, das im Steinmaterial aufs
    Albedo multipliziert wird. Der haeufigste stille Ausfall ist NICHT die
    fehlende Spalte, sondern eine aus lauter Einsen; deshalb misst dieser
    Pruefer die Streuung mit. Liest die GLB mit `node` allein, ~0,1 s.
    Guard for the baked cavity term in the rock modules' COLOR_0.
  */
  [
    'tools/elements',
    'pruefung/fels-cavity.mjs',
    brauchtModelle('assets/models/RockVaultWall.glb', 'assets/models/StoneVaultWall.glb'),
  ],
  /*
    Mass D, die Client-Seite: der Einspritzpunkt im Shader, Babylons
    `vColor`-Deklaration am installierten Stand und das Alphaflag, das der
    glTF-Lader setzt, ohne in die Spalte zu sehen. Alle drei koennen still
    ausfallen und sehen dann genauso aus wie „die Verschattung wirkt
    nicht". NullEngine, keine GPU, <2 s.
    Mass D, client side: injection point, vColor declaration, alpha flag.
  */
  ['client', 'test/stein-cavity.ts'],
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
  // Sichtbare Deko als Thin Instances, gegen eine Attrappen-Modellquelle
  // statt echter GLBs (assets/ liegt ausserhalb des Repos).
  ['client', 'test/dungeon2-deko.ts'],
  // Der Läufer: eine echte Havok-Kapsel läuft durch erzeugte Gräber und
  // misst STRECKE statt Zeit — Durchfallen, Hängenbleiben, Treppen,
  // Türdurchgänge. ~5 s, echtes Havok unter Node.
  ['client', 'test/dungeon2-laeufer.ts'],
  // AP15.3/15.4/15.5: Die REINE Logik der Zellwerkzeuge des Editors — die
  // Picking-Mathematik (Weltkoord->Zellindex und ->Kante, Zoom/Pan) und die
  // Mutationen (Boden-Rasterung, Wandflag-Symmetrie über die kanonische Kante,
  // Materialpinsel-Radius, Stempel-Rundlauf, das Gebaut-Kippen beim ersten
  // Handeingriff). DOM-frei, Sekunden.
  // AP15.3/15.4/15.5: the pure logic of the editor's cell tools — picking maths
  // and mutations, DOM-free, seconds.
  ['client', 'test/dungeon2-zellwerkzeuge.ts'],
  // AP15.2: Die REINE Logik der Katalogseite (Laden/Speichern/Prüfen/Anlegen)
  // — Antwort-Parser gegen `/api/dungeons2*` (gute und kaputte Einträge),
  // die Speichern-Knopf-Zustandsmaschine (sauber→schmutzig→speichert→sauber,
  // Fehlerfall bleibt schmutzig), die Prüf-Trockenlauf-Verzweigung 'erzeugt'
  // vs. 'gebaut', ID-Muster und Zufalls-Seeds. DOM-frei, Sekunden.
  // AP15.2: the PURE logic of the catalogue sidebar (load/save/check/create)
  // — response parsers, the save-button state machine, the check-dry-run
  // branch, id pattern and random seeds. DOM-free, seconds.
  ['client', 'test/dungeon2-katalog.ts'],
  // Der 1.0-Editor-Weg des Modul-Kits `DG_StoneVault`: die Kantennamen und
  // die Optionsliste des Feldes „Ausrichtung" (`@wov/shared`, von BEIDEN
  // Editoren benutzt), die Durchreichung des fünften `attachRoom`-Parameters
  // durch `DungeonGrundriss.fuegeAn` (Index 0 vs. 1 = verschiedene Drehung,
  // wie server/test/m4-hand-bauen.ts), die Zeichenhülle gegen die
  // Innenmass-Falle (1,4 statt 2) und das leere Dokument aus einer Basis.
  // Über einen winzigen DOM-Stummel (Canvas ohne Kontext), Sekunden.
  // The 1.0 editor path of the module kit: edge naming, the `connIndex`
  // pass-through, the drawn cell hull, and the empty new document.
  ['client', 'test/dungeon-editor-kanten.ts'],
  // Das Formular „Neuer Saal" (E8): die sieben ServerConfig-Flagbits an
  // EINER Stelle samt Wächter gegen die zwei alten Kopien, die
  // Sichtbarkeit am Servertor, „Modulzellen" statt „Zellen" (zwei Felder
  // in einer Leiste meinten sonst Verschiedenes mit demselben Wort), die
  // Vorschau aus der GETEILTEN Formel und der Dreiecksdeckel VOR dem
  // Paket. Derselbe DOM-Stummel wie darüber, Sekunden, kein Netz.
  // The E8 hall form: flag bits in one place, gated visibility, distinct
  // labels, shared preview formula, triangle cap before the packet.
  ['client', 'test/dungeon-neuer-saal.ts'],
  // Kantenmarken sind ANKLICKBAR: der reine Treffertest `trifftKante`
  // (0,6 m in Weltmass, nicht in Pixeln) und die Rangfolge in `waehleBei` —
  // Kanten VOR Räumen, sonst ist eine Marke gezeichnet, aber nie zu
  // treffen, und der Klick markiert den Raum darunter. DOM-Stummel.
  // Edge markers are clickable: pure hit test plus edges-before-rooms order.
  ['client', 'test/dungeon-grundriss-kanten.ts'],
  // Die 3D-Ansicht des 1.0-Dokuments über NullEngine und synthetische
  // Würfel-Master (AssetManager injiziert wie in kollisionsnetz.ts): eine
  // Instanz je Raum an der Weltposition der Platzierung, eine Marke je
  // anbaubarer Kante, Auswahlwechsel, dispose-Idempotenz.
  // The 1.0 document's 3D view over NullEngine with synthetic cube masters.
  ['client', 'test/dungeon-vorschau3d.ts'],
  // AP15.6: Die REINE Steuerung der eingebetteten 3D-Live-Vorschau
  // (`vorschauSteuerung.ts`) — Entprellung (viele schnelle setzeLayout → EIN
  // Neubau nach Ruhe), die Zustandsmaschine sichtbar/unsichtbar ↔ Render-
  // Schleife an/aus, und dispose-Idempotenz (keine Schleife/kein Zeitgeber
  // danach). KEIN WebGL/Babylon/DOM: 3D ist in Node nicht render-testbar, die
  // Zustandslogik ist es sehr wohl. Über Attrappen für Treiber und Zeitgeber.
  // DOM-frei, Zehntelsekunden.
  // AP15.6: the PURE control of the embedded 3D live preview — debounce,
  // visible↔loop state machine, dispose idempotency. No WebGL/Babylon/DOM.
  ['client', 'test/dungeon2-vorschau.ts'],
  // AP13: Der Adapter an die Instanz-Infrastruktur über echte Pakete —
  // Teleport mit Thema/Seeds/Prüfsumme, Betreten/Verlassen ×20 ohne
  // ZDO-Leck, Anker-Änderung ohne Instanz-Abriss, ZDO-Zahl alt gegen neu.
  // ~10 s (die Leitungsrunden warten auf die AdminCommand-Drossel).
  ['server', 'test/g9-dungeon2-e2e.ts'],
  // AP15.1: Client-Speicherweg des Editors (`Dungeon2Speichern.ts`) gegen
  // einen echten WovServer — echter GameSocket, echter Handshake, echtes
  // DungeonEditSave/DungeonEditData-Paket, echte Weiche im Sanitizer.
  // Erfolg mit servergeprüfter Prüfsumme, Ablehnung (unbekanntes Thema) ohne
  // Server-Seiteneffekt, und ein unerreichbarer Server läuft sauber in den
  // Timeout statt zu hängen. ~10 s (der letzte Fall wartet FRIST_MS aus).
  // AP15.1: the editor's client save path against a real WovServer — real
  // GameSocket, real handshake, real packet pair, real sanitizer switch.
  ['server', 'test/dungeon2-speichern-e2e.ts'],
];

const LANG = [
  ['server', 'test/g3-streaming.ts'],
  ['server', 'test/g5-dungeons.ts'],
  ['server', 'test/f3-leveling.ts'],
];

const liste = process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN;
let fehler = 0;
let uebersprungen = 0;
const start = Date.now();

/**
 * Ausgabe eines fehlgeschlagenen Tests aufbereiten.
 *
 * Vorher standen hier nur die letzten 15 Zeilen. Das ging so lange gut,
 * wie ein Test seine Fehlschläge zum Schluss zusammenfasst — und ging
 * am 23.08.2026 schief: g3-mehrspieler-e2e.ts meldete "4 FEHLGESCHLAGEN",
 * die vier FAIL-Zeilen selbst standen aber weiter oben und wurden
 * abgeschnitten. Übrig blieben fünf PASS-Zeilen und eine Zahl, die zu
 * ihnen nicht passte — der Sammellauf zeigte also genau die eine
 * Information NICHT, für die man ihn liest.
 *
 * Deshalb jetzt: JEDE Zeile, die nach Befund aussieht, plus der Schwanz
 * für den Zusammenhang. Der Schnitt bleibt, weil Server-Tests hunderte
 * Fortschrittszeilen drucken ("[WoV] Vegetation: +1 zone(s) …") — nur
 * schneidet er nicht mehr das weg, worum es geht.
 */
const BEFUND = /\bFAIL\b|\bFEHL|✗|^\s*Error\b|\bAssertionError\b/;
function ausgabeAufbereiten(stdout) {
  const zeilen = (stdout ?? '').split('\n');
  const schwanzAb = Math.max(0, zeilen.length - 15);
  const befunde = [];
  for (let i = 0; i < schwanzAb; i++) {
    if (BEFUND.test(zeilen[i])) befunde.push(zeilen[i]);
  }
  const teile = [];
  if (befunde.length > 0) {
    teile.push(`  ── ${befunde.length} Befund-Zeile(n) weiter oben im Protokoll ──`);
    teile.push(...befunde);
    teile.push('  ── letzte 15 Zeilen ──');
  }
  teile.push(...zeilen.slice(schwanzAb));
  return teile.join('\n');
}

for (const [paket, datei, weiche] of liste) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${paket}/${datei} … `);
  const grund = weiche?.();
  if (grund) {
    uebersprungen++;
    console.log(`ÜBERSPRUNGEN — ${grund}`);
    continue;
  }
  const lauf = spawnSync(resolve(WURZEL, 'node_modules/.bin/tsx'), [datei], {
    cwd: resolve(WURZEL, paket),
    encoding: 'utf-8',
    timeout: 600_000,
  });
  const dauer = ((Date.now() - t0) / 1000).toFixed(1);
  if (lauf.status === 0) {
    console.log(`OK (${dauer}s)`);
  } else {
    fehler++;
    console.log(`FEHLGESCHLAGEN (${dauer}s)`);
    console.log(ausgabeAufbereiten(lauf.stdout));
    console.log(lauf.stderr ?? '');
  }
}

console.log(
  `\n${liste.length - fehler - uebersprungen}/${liste.length} Tests grün` +
    (uebersprungen > 0 ? `, ${uebersprungen} übersprungen` : '') +
    ` in ${((Date.now() - start) / 1000).toFixed(0)}s`
);
process.exit(fehler > 0 ? 1 : 0);
