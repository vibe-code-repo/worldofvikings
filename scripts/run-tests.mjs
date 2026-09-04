#!/usr/bin/env node
/**
 * Test-Runner (Review-Punkt 26): fährt die kuratierte Testliste sequenziell
 * und aggregiert die Exit-Codes — vorher liefen 29 Testdateien nur einzeln
 * von Hand.
 *
 *   npm test              schnelle Kernliste (~2–3 min)
 *   npm test -- --alle    zusätzlich die langen Läufe (Placement, E2E-Wire)
 *
 * NICHT enthalten sind die C++-Golden-Tests (geo-compare, heightmap-compare,
 * geo-map): sie brauchen Referenz-Dumps als Argument und gehören zum
 * eingefrorenen Übergangspfad der radialen Weltgenerierung. Ebenso math-golden.ts (dieselbe Art
 * Referenz-Dumps, random_values.txt/perlin_values.txt) sowie geo-correlate.ts
 * — alle vier tragen die Begründung bereits im eigenen Kopfkommentar.
 *
 * Reine Werkzeuge/Messbänke, keine Tests (drucken Zahlen, behaupten nichts,
 * kein process.exit(1)-Pfad — s. jeweiliger Kopfkommentar):
 * shared/test/rain-freq.ts, shared/test/heightmap-bench.ts.
 *
 * Ebenfalls NICHT enthalten: shared/test/dungeon2-browser-check.ts. Das ist
 * kein Node-Test, sondern der BÜNDEL-EINSTIEG der Browser-Seite des
 * Determinismus-Prüfstands (AP5) — er benutzt `document` und stürbe unter
 * tsx sofort. Er wird per esbuild gebaut und im Browser geöffnet; die
 * Anleitung steht in seinem eigenen Kopfkommentar.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/*
  Weiche fuer Tests, die echte Modell-Dateien brauchen.

  `assets/` liegt bewusst AUSSERHALB des Repos (Mike sichert die Modelle
  selbst). Im CI-Checkout gibt es sie also nicht — ein Test, der sie
  misst, waere dort dauerhaft rot und wuerde in kurzer Zeit ignoriert.
  Deshalb: fehlt die Datei, wird der Test als UEBERSPRUNGEN gemeldet und
  zaehlt nicht als Fehler. Die Sonde selbst darf das NICHT entscheiden —
  sie wird rot, wenn sie nichts zu messen findet (siehe ihre letzte
  Zeile), damit ein leerer Lauf nicht als Bestehen durchgeht.

  Skips when the model files are absent (assets/ lives outside the repo).
*/
function brauchtModelle(...dateien) {
  return () =>
    dateien.every((d) => existsSync(resolve(WURZEL, d)))
      ? null
      : `Modell-Dateien fehlen (${dateien[0]} …) — assets/ liegt ausserhalb des Repos`;
}

/*
  Weiche fuer Pruefer, die eine `python3`-Datei befragen.

  Die Fels-Blocklage (F3) liegt bewusst als reines Python-Modul neben dem
  Blender-Bauskript — nur so laesst sie sich ohne Blender messen. Der
  Pruefer ruft `python3` also wirklich auf; fehlt es, misst er nichts und
  wuerde still gruen bleiben. Deshalb hier die Weiche und nicht dort.

  Skips when python3 is missing (the checker shells out to it).
*/
function brauchtPython() {
  return () =>
    spawnSync('python3', ['-c', 'pass'], { encoding: 'utf-8' }).status === 0
      ? null
      : 'python3 fehlt — die Fels-Blocklage wird per python3 befragt';
}

const KERN = [
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
  ['server', 'test/h4-graslandflora.ts'],
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
  ['server', 'test/f17-figurenwahl.ts'],
  ['server', 'test/f18-haarfarbe.ts'],
  ['server', 'test/f19-wettervorgabe.ts'],
  // G12 (Roadmap): Betriebsmetriken -- reine Auswertung (Zaehler,
  // Sekundenabschluss, Prometheus-Formatierung), kein Server/Socket noetig
  // (Metriken.ts und shared/src/metrik.ts kennen beide weder Peer noch
  // WovServer). Sekunden.
  ['server', 'test/g12-metriken.ts'],
  ['server', 'test/k1-konten.ts'],
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
  // Funktion, NICHT in eine Vorhersage-Warteschlange verdrahtet (die
  // gibt es im Client noch nicht, s. Kopfkommentar der Produktivdatei
  // und Bericht, Abschnitt "offen"). DOM-frei, Sekunden.
  ['client', 'test/f6-seq-verwerfung.ts'],
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
  ['tools', 'test/manifest-vollstaendig.ts'],
  // F5: die zwei Zuordnungen, mit denen `--abgleich` von einer Prefab-
  // Definition auf die GLB kommt, die sie wirklich laedt — MODELL_ALIAS
  // (aus dem Client-Quelltext gelesen) und Fels-Modul -> Stammmodul (aus
  // der Kit-Ableitung). Beide scheitern lautlos, indem sie etwas aus dem
  // Bericht FALLEN lassen. Braucht keine Modelldateien, laeuft also auch
  // im CI-Checkout. Sekundenbruchteile.
  ['tools', 'test/manifest-zuordnung.ts'],

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
  // das Dreiecksbudget von 1500 je Wandpaneel. Befragt `felsblock.py` per
  // `python3 --dump`; kein Blender, kein `assets/`, ~1 s.
  // F3: the rock front layer's block lattice — seam, bounding box, budget.
  ['tools/elements', 'pruefung/fels-frontschicht.mjs', brauchtPython()],
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
