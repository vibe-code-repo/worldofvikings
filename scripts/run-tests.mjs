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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KERN = [
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

for (const [paket, datei] of liste) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${paket}/${datei} … `);
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
  `\n${liste.length - fehler}/${liste.length} Tests grün in ${((Date.now() - start) / 1000).toFixed(0)}s`
);
process.exit(fehler > 0 ? 1 : 0);
