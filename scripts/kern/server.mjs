/**
 * Testliste, Bereich `server`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `server/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `server`: the KERN entries whose path starts with `server/`, sorted by full path.
 */
import { brauchtModelle, brauchtStore } from '../testweichen.mjs';

export default [
  // A14 (Roadmap): server.yml verspricht nichts, was niemand liest. Die
  // Dauer-Syntax, die Wache gegen einen neu eingetragenen toten Schluessel
  // in der ECHTEN server/data/server.yml, die Startwarnung — und der Draht
  // bis zum Ende: ein echter Server speichert wirklich im Takt der Datei
  // (400 ms statt der 30-min-Konstante). Startet dafuer kurz einen Server
  // auf Port 2593, raeumt sein Datenverzeichnis in `finally` weg. ~4s.
  ['server', 'test/a14-server-yml.ts'],
  // A2 (Security-Review): reine Funktion — Paketwaffe zaehlt nur, wenn sie
  // im Server-Inventar liegt, sonst Faust. Sekunden, kein Server/Socket.
  ['server', 'test/a2-waffe-inventar.ts'],
  // A4 (Roadmap): Token-Bucket-Drosselung je Peer und Pakettyp. Reine
  // Funktion (Drossel.ts kennt weder Peer noch Socket), Zeit kommt als
  // Parameter herein — Sekunden, kein Server/Socket noetig.
  ['server', 'test/a4-drossel.ts'],
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
  // Die NAHT der drei Sicherheits-Pakete (13.09.2026): everyone-admin:
  // false, das Adminkonto und die Bannliste ergeben zusammen EINE
  // Berechtigungskette, und jedes der drei war fuer sich gruen. Dieser
  // Test laeuft an einem echten createWovServer die ganze Kette ab
  // (Konto -> Charakter -> spielerId -> Adminliste -> peer.isAdmin ->
  // Befehl), macht die Gegenprobe mit `gast` und prueft bann/entbann/
  // kick. Vor allem prueft er die eine Zeile `bannPruefen:` am
  // NetManager-Konstruktor — fehlt sie, ist die ganze Bannliste
  // wirkungslos, und zwar ohne Symptom.
  ['server', 'test/adminbefehle-bann.ts'],
  ['server/test', 'armor-body-variants.ts'],
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
  // B7: Findlinge, Betten und Truhen aus dem Speicher (Verhalten aus
  // shared/src/storeVerhalten.ts) ueber den echten Paketpfad: Spitzhacke gibt
  // Stein, Bett setzt den Wiedereinstieg (Tod -> Teleport dorthin), Truhe
  // oeffnet mit Inhalt und behaelt ihn nach dem Neustart. ~20 s.
  ['server', 'test/b7-entsperren.ts'],
  // B8: die eigenen NPCs (Surtr, Furlocs) tragen ANGREIFBAR und schlagen im
  // AggroSystem zurueck — ueber den echten Paketweg: Waffenschaden genau,
  // Takt ueber fuenf Schlaege gemessen, Parade, Friedliche, Reichweite, ohne
  // Spawnsystem. ~90 s.
  ['server', 'test/b8-angreifbar.ts'],
  // B9.4: Animationsweg. Falsch belegte clips-Listen scheitern laut (kein idle,
  // leer, unbekannt, die ohne Dauer), zwei Schreiber auf einer ZDO werden
  // abgelehnt, attack/hit/die kommen als Ereignis (animEinmal) an, der Wolf
  // ohne die-Clip stirbt wie bisher sofort; dazu die Clip-Namen gegen das
  // Manifest. Kein Server, keine Ports. ~10 s.
  ['server', 'test/b9-4-animationsweg.ts'],
  // B9.4 N1: Tod und Treffer ueber den echten Paketweg (handleAttack): zwei Spieler
  // zugleich, Sterbende nicht wieder treffbar, hit-Ereignis, Wolf ohne die sofort weg,
  // Instanzwelt mit gleicher ZDO-Id trifft die Hauptwelt nicht. Ephemerer Port. ~25 s.
  ['server', 'test/b9-4-tod-paketweg.ts'],
  // B9.6: das Huhn im Spiel — Tabellen (Spawn-Tabelle, Registry, Leben,
  // Manifest-Clips, renderScale gegen die IDLE-Pose aus B9.6/Blender statt
  // der Bindepose des Manifests), das Spawnsystem mit den ausgelieferten
  // Zahlen (Wiese, `anim`-Member folgt der Bewegung, greift nie an) und der
  // echte Paketweg: Treffer, Tod nach einem Steinaxt-Schlag, Beute im
  // Inventar. ~40 s.
  ['server', 'test/b9-6-huhn.ts'],
  // B9.2: Kuh und Wolf im Spiel. Tabellen (Spawn-Tabelle, Registry, Leben,
  // Manifest-Clips), das Spawnsystem mit den ausgelieferten Zahlen (Kuh auf
  // der Wiese, Wolf im Schwarzwald, `anim`-Member folgt der Bewegung, Kuh
  // schlaegt nie, Wolf jede 2 s mit 8) und der echte Paketweg: Treffer,
  // Tod nach gezaehlten Schlaegen, Beute im Inventar. ~70 s.
  ['server', 'test/b9-kreaturen-spiel.ts'],
  // Bannliste (Paket 0.5): ein gesperrter Zugang kommt nicht herein und
  // fliegt sofort, wenn er schon drin ist. E2E ueber echte WebSocket-
  // Verbindungen an einem echten NetManager, mit echter SQLite im
  // tmp-Ordner — die Ablehnung entscheidet sich erst hinter Nonce und
  // Tokenpruefung, und ein Bann muss einen Neustart ueberleben.
  ['server', 'test/bannliste.ts'],
  // Besitz und Grenzen: fremde Betten und Truhen bleiben dem Besitzer (Bett,
  // Oeffnen und ContainerAction), der Wiedereinstieg im Instanz-Band gilt nicht,
  // Chat und Graben ueberqueren die Weltgrenze nicht, der Zaehler
  // ohneWeltVerworfen steht im Betriebs-Schnappschuss — drei echte Clients,
  // eine Instanz, ephemerer Port. ~25 s.
  ['server', 'test/besitz-grenzen.ts'],
  // A foreign peer never gets the builder's account id (`besitzer`) or the ZDO owner field of a character, full state or delta, real clients + strict wire reader.
  ['server', 'test/besitzer-sichtbar.ts'],
  // Loot tables: the numbers of KREATUR_DROPS and TRUHEN frozen through the dice (scripted random), every pickable prefab of
  // the spawn/scatter data gives its item (BlueberryBush -> Blueberries), wuerfleTruhe('') gives an empty loot. No server. ~2 s.
  ['server', 'test/beute-daten.ts'],
  ['server', 'test/bewuchs-freiraum-huellen.ts'],
  ['server', 'test/bewuchs-freiraum.ts'],
  // D2: server decides hits from geometry and time (hit sphere, swing window, combo ack, cooldown).
  ['server', 'test/d2-treffer.ts'],
  // G1-Durchsicht (verwaiste Tests, 20.08.2026): init() ohne start() —
  // kein Port, kein Socket. Haelt getGroundHeight(0,0) gegen den
  // D1-verifizierten Wert UND die Fallphysik-Konvergenz fest, damit ein
  // Rueckfall auf den alten Radial-Spawnpunkt sofort auffiele.
  ['server', 'test/d6-smoke.ts'],
  ['server', 'test/d6-zdo-delta.ts'],
  ['server', 'test/d8-save-async.ts'],
  ['server', 'test/d9-terrain-verdichtung.ts'],
  // AP15.1: Client-Speicherweg des Editors (`Dungeon2Speichern.ts`) gegen
  // einen echten WovServer — echter GameSocket, echter Handshake, echtes
  // DungeonEditSave/DungeonEditData-Paket, echte Weiche im Sanitizer.
  // Erfolg mit servergeprüfter Prüfsumme, Ablehnung (unbekanntes Thema) ohne
  // Server-Seiteneffekt, und ein unerreichbarer Server läuft sauber in den
  // Timeout statt zu hängen. ~10 s (der letzte Fall wartet FRIST_MS aus).
  // AP15.1: the editor's client save path against a real WovServer — real
  // GameSocket, real handshake, real packet pair, real sanitizer switch.
  ['server', 'test/dungeon2-speichern-e2e.ts'],
  ['server', 'test/e2-vegetation.ts'],
  // Editor connection: dungeon enter/leave + disconnect leaves no hash-0 ZDO in the main world; a player keeps the character ZDO.
  ['server', 'test/editor-zdo-hash0.ts'],
  ['server/test', 'equipment-sets.ts'],
  // F1 (Roadmap, Security-Review-Paket 3): Truhen mit echtem, entnehmbarem
  // Inhalt statt des alten Ein-Bit-Schalters. E2E ueber echte WebSocket-
  // Verbindungen (handleTruheOeffnen/handleContainerAction sind private
  // Paket-Handler, nur so erreichbar): Erstbefuellung genau einmal,
  // Nehmen+Legen konserviert die Menge, eine bereits geplünderte Alt-Truhe
  // startet leer, ein Spieler ausserhalb der 6-m-Reichweite wird abgewiesen,
  // der Inhalt uebersteht Speichern/Laden. Drei gestartete Server + ein
  // init()-only Reload, ~5s.
  ['server', 'test/f1-truhe.ts'],
  // F10: Serverstopp kuendigt den Neustart an (Paket ServerNeustart, Grund
  // "restart", <= 1 s vor dem Trennen), Anna verbindet mit dem Backoff des
  // Client-Moduls neu und steht <= 1 m an der gesicherten Position; Befund:
  // anderes Geheimnis = neue Figur. Drei echte Serverprozesse, rund 30 s.
  ['server/test', 'f10-neustart-ansage.ts'],
  // F12 (Roadmap): Zonenbudget je Spieler statt einer globalen Schlange nach
  // Abstand: Spieler mit wenigen offenen Zonen kommt in <= 2 Ticks dran
  // (simulierte Uhr), keine O(Q×P)-Sortierung, dieselbe Menge Zonen/ZDOs wie
  // vorher (Golden), Abgang ohne Leck. Layoutwelt, ~20 s.
  ['server', 'test/f12-zonenbudget.ts'],
  // F14 (Roadmap): Reichweiten-Auswahl der Chat-Empfänger (Whisper/
  // Normal/Shout, Herleitung s. Kopfkommentar von ChatReichweite.ts),
  // Grenzwert exakt auf der Reichweite, Absender immer dabei, sowie die
  // serverseitige Textlängengrenze. Reine Funktion, kein Server/Socket,
  // Sekunden.
  ['server', 'test/f14-chat-reichweite.ts'],
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
  // F2 guard: the player-build index in ZDOManager (login build count) equals the old full scan after mixed
  // operations: build, demolish, owner change, flag removed and set again, fixed-id creation, member takeover,
  // loading into a fresh and a running manager, plus a 3000-step random run. A write path that bypasses the
  // index turns this red. Seconds, no socket.
  ['server', 'test/f2-spielerbau-index.ts'],
  // F2 (MMO hardening): the ZDO sync stops costing string keys and unbounded scans. 48,000 ZDOs, peers with a fake
  // socket, private syncZDOs ticked directly: zero ZDOID.toString() calls in the sync, a small budget never
  // yields a packet larger than budget + one record and everything still arrives, at most 4096 checks per
  // peer and tick with a cursor (the far rings still arrive), and the login build count equals the old
  // full-scan value (500 builds, two owners). Also prints tick times with 25 peers. ~10 s, no socket.
  ['server', 'test/f2-sync-deckel.ts'],
  // F3/F4 (Security-Review): der VERDRAHTETE Zustand, nicht nur die reine
  // Logik. E2E ueber echte WebSocket-Verbindungen: kein Client bekommt je
  // eine feste/geteilte userId ohne Token (Luecke A), ein anderer Name
  // bekommt NIE die Position eines fremden Namens, ein gefaelschtes Token
  // wird verworfen statt eine fremde Identitaet zu uebernehmen (Luecke B),
  // und ein gueltiges Token haelt die Identitaet ueber einen Reconnect
  // stabil.
  ['server', 'test/f3-einbau.ts'],
  // F3/F4 (Security-Review): reine Logik aus Identitaet.ts — Spieler-ID,
  // SessionToken (Ausstellen/Pruefen/Ablauf/Faelschung, fremdes Geheimnis)
  // und der Nonce/HMAC-Passwort-Handshake inkl. des leeren-Passwort-Falls.
  // Sekunden, kein Server/Socket.
  ['server', 'test/f3-identitaet.ts'],
  // F4: Gelaendeebnung fuer Locations (gleiche Rechnung auf Server und Client):
  // Regelwahl, Plateau und Uebergangsband auf einer Hangflaeche, und mit leerer
  // Feature-Tabelle bleibt das Gelaende Naturgelaende. Kein Server/Socket. ~3 s.
  ['server', 'test/f3-leveling.ts'],
  // F5 (Roadmap): Fortschrittsmarken (GlobalKey-Laufzeitflaggen) — reine
  // WeltMarken-Logik (Idempotenz, Namensaufloesung), der Admin-Befehl
  // 'marke', ECHTES Speichern/Laden ueber zwei Zyklen, der Migrationspfad
  // fuer einen Altstand ohne globalKeys-Feld (handgebaut UND gegen eine
  // Kopie des echten 250k-ZDO-Standes dev.db.zst unter /tmp, niemals das
  // Original), und die einzige verdrahtete Anwendung: Eikthyr besiegen
  // setzt defeated_eikthyr, ein Reh NICHT (Regressionswache). ~2s.
  ['server', 'test/f5-weltmarken.ts'],
  // F6: the far part of the sync window (beyond ring 1) is checked only every 2nd tick. Real client parser over the
  // private syncZDOs (fake socket): ring 0 change arrives the next tick (100 runs), ring 3/4 changes within 2 ticks
  // and at most every 2nd tick carries ring-3 records, destroys in ring 2 and 4 the next tick, idle checks between
  // 45 % and 65 % of the full window (fixed numbers, so "far never" and "far every tick" both turn it red), the
  // first transfer after zone/world change is full in all groups, per-peer byte counter equals the socket bytes;
  // prints bytes per peer and tickSyncMs with 25 peers, 48,000 ZDOs. ~15 s.
  ['server', 'test/f6-aoi-ringe.ts'],
  /*
    F8 N2 (2026-09-29): Truhen und Bauten im selben Schreibvorgang wie der
    Spielerzustand. Echte Serverprozesse mit SIGKILL, ein echter WebSocket-
    Spieler: Truhe nehmen/legen, Bauen/Abreissen, Kill zwischen zwei Takten,
    Ereignis; dazu welt_id (nur Seed + Modus, fremde Zeilen bleiben), die
    Takt-Klemme, der Offline-Stempel und die Stopp-Zeile. Keine Assets.
    Ephemerer Port, ~2 min.
  */
  ['server', 'test/f8n2-truhen-takt.ts'],
  /*
    F8 N3 (2026-09-30): Weltkennung in der Weltdatei (Testwelt hin und zurueck, alte Datei ohne
    Kennung), monotoner Stempel (Uhrsprung rueckwaerts/vorwaerts) und deterministische Kill-Proben
    ueber Test-Haken (NODE_ENV=test + WOV_KILL_PUNKT): in der Transaktion, vor der Datei
    (synchron/asynchron), Ereignis waehrend des Speicherns, Migration in einer Transaktion.
    Echte Serverprozesse mit SIGKILL. Keine Assets. Ephemerer Port, ~4 min.
  */
  ['server', 'test/f8n3-kennung-kill.ts'],
  /*
    Das Thing, M1: die lesende API (Wege, Blaettern, 404 statt leerer
    Liste). Fake-Request/Response, kein Netz — dieselbe Weiche wie oben.
  */
  ['server/test', 'forum-api.ts'],
  /*
    Das Thing (Forum), Stufe M1: die Datenschicht. Reine SQLite-Arbeit in
    einer Wegwerfdatei, kein Netz, kein Server, kein assets/ — laeuft
    deshalb im CI-Checkout wie auf wov-dev. Der Waechter haelt die Fragen
    fest, auf die sich die API still verlaesst: sechs Bretter, mitgefuehrte
    Zaehler, Reihenfolge „angeheftet zuerst, dann letzte Regung", Blaettern
    ohne Verlust, Beitraege in Schreibreihenfolge.
  */
  ['server/test', 'forum-database.ts'],
  /*
    Karte W3-Reste (2026-09-28), N-3: Die Forum-Schreibrouten pruefen das
    Konto-Token nach dem Lesen des Koerpers erneut (dasselbe Fenster wie
    N4 in KontoApi.ts, hier fuer ForumApi.ts). In-Process-Attrappen wie
    server/test/forum-api.ts, kein Netz, ~0.2 s.
  */
  ['server', 'test/forum-token-nach-koerper.ts'],
  // G1-Durchsicht: Admin-Befehlsregister + serverautoritativer Flugmodus
  // (Space/Ctrl/Shift), reiner Funktionsaufruf ueber echten Writer/Reader,
  // kein Socket. War tot wegen einer veralteten Fake-Peer-Attrappe (siehe
  // Kommentar im Test) — Fix ist NUR im Test, nicht in WovServer.ts.
  ['server', 'test/g1-admin-fly.ts'],
  // G12 (Roadmap): Betriebsmetriken -- reine Auswertung (Zaehler,
  // Sekundenabschluss, Prometheus-Formatierung), kein Server/Socket noetig
  // (Metriken.ts und shared/src/metrik.ts kennen beide weder Peer noch
  // WovServer). Sekunden.
  ['server', 'test/g12-metriken.ts'],
  // Paket 0.10: die Tick-Aufteilung im ECHTEN Server (WovServer.update stempelt
  // Welten/Sync/Rest, ZoneManager zählt die Budget-Abbrüche, beides landet als
  // Zeile im Tageslog; ein nicht schreibbares Log stoppt den Server nicht).
  // Echter WebSocket-Client, wandert in großen Sprüngen; Port 2575, ~15 s.
  // BEWUSST zwischen zwei reinen Client-Tests und nicht neben Tests mit
  // Tickzeit-Schwellen: Er belastet den Kern über Sekunden, und ein Test mit
  // Tickzeit-Schwelle direkt danach liefe gegen die Restlast.
  // Paket 0.10: the tick split in the REAL server, over a real socket.
  ['server', 'test/g12-tick-aufteilung.ts'],
  ['server', 'test/g2-persistence.ts'],
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
  // G3/G-POP: Warteschlange der Zonen-Erzeugung — naechste Zone zuerst, veraltete
  // fliegen raus, ein Bild mit Budget erzeugt wirklich Zonen. Kein Netz, keine
  // Assets. ~4 s.
  ['server', 'test/g3-streaming.ts'],
  ['server', 'test/g4-creatures.ts'],
  // G5: DungeonManager (Dokumente, Eingaenge, Instanzen) — Platten-Rundlauf,
  // Instanz je eigener Welt, Abbau. Kein Server/Socket, schreibt in einen
  // eigenen Ordner unter server/test und raeumt ihn wieder weg. ~1 s, kalt bis 4 s.
  ['server', 'test/g5-dungeons.ts'],
  // G1-Durchsicht: einziger E2E-Test fuer Dungeon-Betreten/-Verlassen ueber
  // echten WebSocket-Handshake. War tot durch ZWEI unabhaengige
  // Test-Bugs (Handshake-HMAC und ZDOSync-Parser bauten die Produktivlogik
  // von Hand nach statt sie zu rufen — s. Importkommentare im Test).
  // ~4s, kein einziges Byte davon war ein echter Produktivfehler.
  ['server', 'test/g6-dungeon-e2e.ts'],
  // G2: Bauen und Abreissen ueber den ECHTEN Paketpfad (handlePlacePiece/
  // handleRemovePiece) — Materialkosten, 'besitzer'-Member, Abriss durch
  // Fremde bleibt wirkungslos, halbe Rueckerstattung beim Eigentuemer,
  // Reichweitenpruefung.
  ['server', 'test/g7-bauen.ts'],
  // G2: Craften und Essen ueber den ECHTEN Paketpfad (handleCraft/
  // handleEat) — Rezeptpruefung, GAR KEIN Abzug bei nur einer fehlenden
  // Zutat, unbekanntes Rezept, Essens-Buff, wirkungsloses Essen ohne Item.
  ['server', 'test/g7-craft-essen.ts'],
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
  // G2 (Roadmap, "die groesste Testluecke"): Kampf ueber den ECHTEN
  // Paketpfad (handleAttack/handleHarvest) — Schaden nur aus dem
  // Server-Inventar (A2 im Draht), Ausdauerverbrauch, Reichweite gegen die
  // Server-Position, Cooldown ueber die Drossel, Tod und garantierte Beute.
  // Kein Server/Socket-Nachbau: echter WebSocket-Handshake, echte Pakete.
  ['server', 'test/g7-kampf.ts'],
  // G2: Terraforming ueber den ECHTEN Paketpfad (handleTerrainOp) —
  // d9-terrain-verdichtung.ts prueft die Datenstruktur direkt, dieser Test
  // den Paketpfad davor: anwenden, speichern, laden, keine Verdopplung des
  // WELTZUSTANDS. Deckt nebenbei einen echten Befund auf (s. Kopfkommentar
  // der Testdatei): der Broadcast-Sparpfad in handleTerrainOp greift beim
  // 'level'-Zweig NICHT — ein zweiter Klick auf bereits planierten Boden
  // loest trotzdem einen weiteren TerrainOpSync an alle Peers aus.
  ['server', 'test/g7-terraforming.ts'],
  // G2: ZDO-Interest-Management ueber den ECHTEN Sync-Pfad (syncZDOs →
  // ZonenFenster, echter Client-Parser wie d6-zdo-delta.ts) — ein Peer
  // bekommt, was in seiner Naehe liegt (256 m, SICHT_RADIUS_ZONEN), nicht
  // was weit weg liegt, und das Fenster folgt seiner Position.
  ['server', 'test/g7-zdo-interessen.ts'],
  // Etappe 5: von Hand gesetzte Deko ueberlebt Abriss und Neustart.
  // Kein Socket, kein Server — reine Dokument- und Instanzpruefung, Sekunden.
  ['server', 'test/g8-dungeon-deko.ts'],
  // AP13: Der Adapter an die Instanz-Infrastruktur über echte Pakete —
  // Teleport mit Thema/Seeds/Prüfsumme, Betreten/Verlassen ×20 ohne
  // ZDO-Leck, Anker-Änderung ohne Instanz-Abriss, ZDO-Zahl alt gegen neu.
  // ~10 s (die Leitungsrunden warten auf die AdminCommand-Drossel).
  ['server', 'test/g9-dungeon2-e2e.ts'],
  ['server', 'test/g9-editor-verbindung.ts'],
  // A guest keeps state and ownership only with their token; nobody inherits a saved state by typing its name, and guests cannot wear an account name.
  ['server', 'test/gaeste-besitz.ts'],
  // Terrain T4b: save (layoutSchreibenAsync with base) -> boot from the same work copy -> getGroundHeight = base + delta;
  // damaged heightDeltas refused at save, work copy byte-identical. No network, no assets.
  ['server', 'test/gelaende-speichern-neustart.ts'],
  // `createGenerated` mit Generator-Einstellungen (maxRooms/zoneSize): Dokument
  // trägt den WIRKLICH benutzten Wert, ein neuer Seed behält die Einstellungen.
  ['server', 'test/generieren-server.ts'],
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
  // G8: Der Verteiler. 14 Bestandskits × 40 Saaten byte-gleich zu dem, was
  // vor dem Umbau in `tools/golden/` abgelegt wurde (SHA-256 über
  // `JSON.stringify(layout)`, plus ein vollständiges Layout als lesbarer
  // Zeuge), `DG_StoneVault` nachweislich über den Rasterpfad und
  // nachweislich NICHT mehr über den 1.0-Pfad, dazu das Verhältnis der Laufzeit
  // zu einer mitgemessenen Referenzarbeit (Schnitt < 1,25; seit #62, vorher eine feste
  // Grenze von 10 ms je Layout). Ohne diesen Test ist „die Fremdkits
  // bewegen sich nicht" eine Behauptung. ~20 s (das grösste Kit allein
  // ergibt 81 MiB JSON).
  // G8: the distributor — 14 legacy kits byte-identical, StoneVault on the grid path.
  ['server', 'test/golden-kits.ts'],
  ['server', 'test/h1-layout.ts'],
  ['server', 'test/h2-routen.ts'],
  ['server', 'test/h3-routen-vorschau.ts'],
  ['server', 'test/h4-graslandflora.ts'],
  // Height correction: real boot terrain and structured MCP reader diagnostics.
  ['server', 'test/height-correction-boot.ts'],
  // The client address is the trusted hop's (rightmost X-Forwarded-For), never a visitor-supplied prefix (F3).
  ['server', 'test/herkunft-xff.ts'],
  /*
    Refactoring I1, from step 2: the guard of Form k, the modules under server/src/spiel/ that hold methods of WovServer
    as functions with a context (`k` is the server itself). Per module: loading does nothing, the functions and the
    export list are the listed ones, the context type names exactly the members read as `k.<member>`, the value imports
    are a fixed list (`import { type X }` counts as a value import), `k` is never cast, passed on or shadowed. In the
    class: one forwarding per function with the frozen head and the one statement `return f(this, …);`, `onPacket`
    still calls it, and the list of the non-private members is frozen (a relaxation must be listed). A fixed sequence of
    calls (stand-in and real instance) gives the numbers measured before the move. Starts a server without binding a port.
    Section [0] shows each check can turn red. Seconds.
    Refactoring I1 ab Schritt 2: der Wächter der Form k für die Module unter spiel/.
  */
  ['server', 'test/i1-form-k.ts'],
  /*
    I1 step 0 (N1): the surface of WovServer that the cuts of steps 1-10 must not lose: the 20 `case PacketType` labels of
    `onPacket`, the 13 admin command names, the 33 private methods and 11 fields that tests reach by name, the 19
    methods tests replace on the instance, the text tests that read WovServer.ts, and a scan of all test folders that
    fails (with the line to add) when a test reaches a new private name. Builds one server without starting it, in a
    temp folder.
    Schritt 0 von I1: die Oberfläche, die die Schnitte nicht verlieren dürfen.
  */
  ['server', 'test/i1-oberflaeche.ts'],
  /*
    Refactoring I1, step 0b: the loot tables, the weapon helpers, the special spawn entries and one constant moved
    unchanged from WovServer.ts into four modules under server/src/spiel/. Holds what the step promises: WovServer.ts
    still exports the four weapon names and they are the same objects (no copy); no module under spiel/ names
    WovServer.ts (one named exception: the context file, type-only) or reaches it through value imports, which
    would be the import cycle; each of the 14 names is declared once, at module level, in its file; the dice give
    what they gave before the move. Reads the syntax tree, starts no server. Seconds.
    Schritt 0b von I1: Oberfläche, Importrichtung und Eindeutigkeit der ersten Module unter spiel/.
  */
  ['server', 'test/i1t-beute-waffe.ts'],
  // A dropped dungeon instance moves its players out first (no stale character id in another world); player list per connection.
  ['server', 'test/instanz-verwurf.ts'],
  // Der echte Trennungs-Handler: Inventar und angelegte Teile überleben das Abmelden.
  ['server', 'test/inventory-logout.ts'],
  ['server/test', 'ironward.ts'],
  ['server', 'test/k1-konten.ts'],
  ['server', 'test/kampf-attribute.ts'],
  /*
    Kampftoene N1: HitEffect traegt hinten ein Bool je Empfaenger „du bist der
    Angreifer“ (echter Server, zwei WebSocket-Spieler, Layout bleibt 17 Byte).
  */
  ['server/test', 'kampf-toene-hiteffect.ts'],
  /*
    Kampfkern K2a (2026-09-29): getragene Waffe am Server. Echter WebSocket-Weg
    (Equip/EquipStand/Attack/ContainerAction, zwei Spieler, Neuanmeldung mit
    Spielstand) und der reine Client-Abgleich mit Rueckrollen. Keine Assets
    noetig. ~35 s bzw. <1 s.
  */
  ['server', 'test/kampf-waffe.ts'],
  // Kartenmodus `radial` und sein Altname: eine Warnung, dieselbe Welt bitgleich.
  ['server', 'test/kartenmodus-alias.ts'],
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
  ['server', 'test/kollision-einhaengung.ts', brauchtStore()],
  ['server', 'test/kollision-formen.ts', brauchtStore()],
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
  ['server', 'test/kollision-schritt.ts'],
  // Ruestkammer-Lesewege (`/accounts/armory`): ohne Standardkonten, Positivliste der
  // Schluessel, Suche/Seiten, Puffer mit Uhr. Echter node:http-Server, Sekunden.
  ['server', 'test/konto-armory.ts'],
  // Herkunft.ts hinter einem Reverse-Proxy: Loopback-Peer + X-Forwarded-For/
  // X-Real-IP wird geglaubt, jede andere Peer-Adresse nicht; und zwei
  // Herkuenfte sperren sich in der Anmelde-Drossel nicht gegenseitig.
  // Echter node:http-Server, Sekunden.
  ['server', 'test/konto-herkunft.ts'],
  // Anmeldung ohne Ticket-Sprung: der eingebaute Anmeldedialog fuer einen
  // lokalen Klon (client/src/ui/Anmeldung.ts) haengt vollstaendig an
  // dieser HTTP-API. Echter node:http-Server, Sekunden.
  ['server', 'test/konto-lokal.ts'],
  /*
    Karte W3-Reste (2026-09-28), U1-U3/N3/N5/N6/Punkt 10: Namensorakel ueber
    Unicode-Schreibweisen (Kelvin-Zeichen, Å/å), ungekuerzte Schluessel,
    verfruehtes Aufraeumen, 409 bei Generationswechsel, IPv6-/64-Zaehlung,
    Variantenselektor hinter Keycap-Basen, "Editor" als reservierter
    Kontocharaktername. Echter node:http-Server, ~1-2 s (U3 stellt die Uhr).
  */
  ['server', 'test/konto-namensorakel.ts'],
  // Registrierungs-Drossel (fuenf je Herkunft je Stunde, dann 429 mit
  // Retry-After) — `registrieren()` hatte bisher gar keine. Eigene Uhr
  // (Date.now gestellt) fuer den Ablauf des Fensters. Echter node:http-
  // Server, Sekunden.
  ['server', 'test/konto-registrierung-drossel.ts'],
  // Account management against a real server (W3): delete in the main world and inside a dungeon instance (chest by CONTAINER, build ownerless, no leftovers in instance.players), password change and log-out-everywhere cut game and editor connections, old player token refused. ~20 s.
  ['server', 'test/konto-verwaltung-welt.ts'],
  // Konto-Verwaltung (W3): Passwort/E-Mail/Profil/Loeschung, Token-Sperre, Forum-
  // Anonymisierung, gleichzeitige Loeschung und play. Echter node:http-Server.
  ['server', 'test/konto-verwaltung.ts'],
  // A deleted object is gone: "delete + set again" is a new object, the old ZDO and its state go (K1.3, A-10).
  ['server', 'test/layout-abgleich-loeschen.ts'],
  // Editor E0 (world document and world building): the layout sync boots a
  // real server, the base version runs the real operations service, the
  // client tests run the editor modules against a fake localStorage / fetch.
  // Layout sync in place: a document edit reaches the saved ZDOs of a world
  // that boots again (rotation, scale, shift, ground; sync stamp; mass-loss rule).
  ['server', 'test/layout-abgleich.ts'],
  ['server', 'test/layout-live-grenze.ts'],
  // ... K5.0: heightDeltas ist eine geo-Aenderung wie Regionen/Wasser/Sockel (202, Neustart), reiner Klassifizierungstest.
  ['server', 'test/layout-live-hoehenkorrektur.ts'],
  // ... N2: a typo applies nothing live, defaults count as missing, the limit of changes and the receipts at that limit (N4: no milliseconds here, the timing is `tools/layout-live-messung.sh` under `sperre.sh measure`), boot without a baseline.
  ['server', 'test/layout-live-n2.ts'],
  // ... N3: limit 40, clamped typos count as dropped, swallowed re-set reported, one log prefix.
  ['server', 'test/layout-live-n3.ts'],
  // ... and the whole guard tick stays cheap: 2000 placements, one changed, median in ms (finding B2 of the attack).
  ['server', 'test/layout-live-takt.ts'],
  // World file goes live (K5.0): the running server applies a written document within a second (objects only,
  // geo and typos are refused with a receipt), and the operations service answers 200 / 202 from that receipt.
  ['server', 'test/layout-live.ts'],
  // Teleport-Paket trägt die Grundbeleuchtung des 1.0-Dokuments (echte Leitung,
  // Port 2521, ~9 s). Setzt `everyoneAdmin` selbst: Vorgabe seit 13.09.2026 false.
  ['server', 'test/licht-teleport.ts'],
  ['server', 'test/listen-bindefehler.ts'],
  // Saat-Test der Modul-Kits DG_StoneVault/DG_RockVault: 40 Seeds, Determinismus,
  // keine überlappenden Räume. Nur shared-Daten, keine GLBs.
  ['server', 'test/m3-stonevault-seeds.ts'],
  // Editor-Pfad `attachRoom` mit `connIndex`: der Mensch wählt die Andockkante.
  ['server', 'test/m4-hand-bauen.ts'],
  // Teleport-Paket trägt das dokumenteigene Steinmaterial hinter `layoutJson`
  // (echte Leitung, Port 2520, ~9 s). Setzt `everyoneAdmin` selbst.
  ['server', 'test/m5a-steinkit-teleport.ts'],
  // Eingänge, die bei jedem Betreten neu würfeln (`vorBetreten`, `setzeEingangsModus`).
  ['server', 'test/m5b-eingang.ts'],
  // ... and collision, at the real chain (KollisionsFormen -> Kollisionswelt
  // -> bewegungsSchritt, same functions the running game server uses): the
  // default box stops a walking step, an explicit "durchlaessig" choice
  // does not add a body at all.
  ['server', 'test/modell-upload-kollision.ts'],
  // ... and the upload gate itself (shared/src/uploadedModelUpload.ts):
  // eight-plus rejected cases with an unchanged directory afterwards, the
  // missing-texture/oversize hints that are accepted rather than rejected,
  // the collision box-vs-mesh default, and the confirm-then-remove flow.
  ['server', 'test/modell-upload-pruefung.ts'],
  // U1-N5: glb streng lesen (Kopf/Chunks), extensionsRequired ⊆ Used, Registry fail closed
  ['server', 'test/modell-upload-streng.ts'],
  /*
    Fremd-Installation, nie zuvor ein Saal gebaut: assets/generiert/
    existiert nicht, der Client bekommt auf modul-registry.json ein 404
    (der Normalfall, ModuleRegistryLoad.ts behandelt das still). Dieser
    Test misst die neue Stelle `sorgeFuerRegistryDatei`, die main.ts VOR
    ladeModulRegistrierung aufruft: legt Ordner+Datei mit einer echten,
    ueber registryPruefsumme([]) gerechneten Leer-Registry an, wenn
    beide fehlen; ruehrt eine vorhandene Datei nie an, auch nicht mit
    echten Modulen drin; und der volle Rundgang wie beim Serverstart.

    Ohne Weiche: schreibt nur in os.tmpdir(), braucht kein `assets/`.
    Zehntelsekunden.

    A fresh install has never built a hall: assets/generiert/ never
    existed, the client's fetch 404s (handled silently, the normal
    case). Guards the new sorgeFuerRegistryDatei() that main.ts calls
    before ladeModulRegistrierung: creates folder+file with a real
    empty-registry checksum when both are missing, never touches an
    existing file, and the full startup round trip.
  */
  ['server', 'test/modul-registry-start.ts'],
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
  // Steinmaterial je PLATZIERTEM Raum als Member am Raum-ZDO.
  ['server', 'test/p5-raum-steinkit.ts'],
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
  // A3 (Security-Review): SetTimeOfDay ist admin-gated. E2E ueber echten
  // WebSocket-Handshake — haelt sowohl den Admin-Erfolgspfad als auch die
  // Ablehnung (InteractResult, kein TimeSync-Broadcast) fest.
  ['server', 'test/set-time-of-day.ts'],
  // Privacy fix: PlayerList carries only name+ping now (no userId, no position),
  // and Chat's senderId field is a constant placeholder, not the sender's account
  // identity — real WS clients, strict wire reader (checks the packet is fully
  // consumed after the known fields).
  ['server', 'test/spielerliste-privat.ts'],
  /*
    F8 (2026-09-29): Spielerzustand write-behind in die Konten-SQLite. Echte
    Serverprozesse mit SIGKILL, ein echter WebSocket-Spieler: Takt, Ereignis,
    Stopp, neuester Stand gewinnt, fremde Welt, Fehlerweg. Keine Assets.
    Ephemerer Port, ~60 s.
  */
  ['server', 'test/spielerzustand-writebehind.ts'],
  ['server', 'test/spielwerte.ts'],
  // Standardkonto: Ausprobieren ohne Registrierung (server.yml
  // `standard-konto:`) -- Konto+Charakter entstehen einmal, ein zweiter
  // Start legt nichts doppelt an und laesst das Passwort unveraendert,
  // Login klappt ueber die echte HTTP-API, der Status meldet den Namen
  // (nie das Passwort), und das Konto bleibt admin-frei ausser durch
  // `everyone-admin` (dann warnt der Server). Dazu die Listenform: zwei
  // Konten (gast fuer die deutsche Anmeldeseite, guest fuer die
  // englische) entstehen beide und melden sich beide an, ein kaputter
  // oder doppelter Eintrag nimmt die anderen nicht mit, und ein einzelner
  // Block gilt weiter. Echter node:http-Server auf Port 0, Sekunden.
  ['server', 'test/standard-konto.ts'],
  ['server/test', 'starter-sets-e2e.ts'],
  ['server/test', 'starter-sets.ts'],
  // Stop path: a failing final save must still end the process (exit code, port closed).
  ['server/test', 'stopp-speichern.ts'],
  /*
    Stufe 2 (Bauer „Licht"): das Wetter „Klar-Comic", der `look:`-Block und
    die Nebelkurve. Reine Rechnung — kein Browser, keine GPU, kein
    `assets/`, rund 0,3 s; er braucht deshalb keine Weiche fuer den
    CI-Checkout.

    Er stand bis zum 09.09.2026 in einer zweiten Liste (LANG), die nur
    mit einem eigenen Schalter lief. Das war eine Einordnung nach Thema
    statt nach Kosten: Dort standen Laeufe, die einen Server hochfahren
    oder Sekunden brauchen; dieser hier ist eine Rechnung von 0,3 s und
    gehoert zu den anderen reinen Rechnungen im Kernlauf. Ein Test, der
    im normalen Lauf nicht mitfaehrt, faellt beim Brechen nicht auf.
    (Die Liste ist seit 20.09.2026 aufgeloest: ihre drei letzten Tests
    stehen in KERN, den Schalter gibt es nicht mehr.)

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
  // Death is saved at once: the revival calls the event save with the reason `tod`, the row is in the account database
  // right after it (tick one hour away), measured over a real WebSocket player. ~6 s.
  ['server', 'test/tod-sicherung.ts'],
  /*
    Tod und Treffer N1 (Nachbesserung zu #149): Der Tote bleibt in der Positionsliste (echte Woelfe bleiben, beissen im Tod 0x,
    danach wieder; allein tickt die Welt weiter), jeder TOT_GESPERRT-Eintrag ueber den echten WebSocket, Admin-Teleport im
    Tod abgelehnt, Bett-verloren-Meldung als Schluessel; Verfolger ohne Ziel gehen auf idle. Wartet ~30 s.
  */
  ['server', 'test/tod-treffer-n1.ts'],
  /*
    Tod und Treffer sichtbar (2026-09-29): der Weg durch den echten Server (zwei WebSocket-Spieler: Treffer-Schicht, Tod 5 s,
    tot = kein Schaden/keine Eingabe, Beleben durch den Server, Kreaturen lassen ab). Wartet ~5 s Liegezeit ein paar Mal, ~40 s.
  */
  ['server', 'test/tod-treffer.ts'],
  // A chest whose prefab has an empty name opens as an empty chest instead of throwing in the packet handler; a normal chest
  // afterwards still works. Real WebSocket player. ~2 s.
  ['server', 'test/truhe-leerer-name.ts'],
  // Truhe lesen: der Inhalt einer fremden Truhe reist nicht im ZDOSync mit
  // (Vollstand und Delta auf dem Draht mitgelesen, drei Runden), der Besitzer
  // mit offener Truhe sieht jede Aenderung, eigene/besitzerlose/Grab-Truhen
  // bleiben lesbar — zwei echte Clients, ephemerer Port. ~30 s.
  ['server', 'test/truhe-lesen.ts'],
  // Grundskala in der Server-Kollision (KollisionsFormen, echte Kette bewegungsSchritt/
  // Kollisionswelt) und im Nachträglich-ändern-Weg (aendereGrundskala): Registry-Datei UND
  // Laufzeit-Registrierung folgen, Grenzen greifen, unbekannter Name/Sperre lehnen ab.
  ['server', 'test/upload-grundskala-kollision.ts'],
  // Upload placements keep their ZDO (id, state) across a boot with an unreadable registry.
  ['server', 'test/upload-zdos-behalten.ts'],
  // A5 (Schlusskontrolle Paket 2): Deckel fuer offene, nie authentifizierte
  // Verbindungen (MAX_PENDING_CONNECTIONS in NetManager.ts). Vorher zaehlte
  // die "Server voll"-Pruefung nur onlinePeers — der Pre-Auth-Timeout liess
  // sich per Ping endlos hinauszoegern. E2E ueber echte WebSocket-Verbindungen,
  // haelt sowohl das Offenbleiben bis zum Limit als auch die sofortige
  // Trennung darueber hinaus fest.
  ['server', 'test/verbindungsdeckel.ts'],
  /*
    Karte D1 (Zweitdomains/Ablösung): die gemeinsame Ursprungs-Liste von
    KontoApi.ts und ForumApi.ts (world-of-mmorpg.com/.de, world-of-vikings.com
    während der Übergangszeit), dazu feindliche Ursprünge mit Präfix-/
    Suffix-Treffer (Angriffsbefund M5) — echtes HTTP für KontoApi,
    Fake-Request für ForumApi, kein assets/, keine GPU.
  */
  ['server/test', 'website-urspruenge.ts'],
  // F9 (Wetter serverautoritativ): Definitionsdatei, Würfel (bitgleich zum alten, Verteilung, Dauer, Tageszeit),
  // Wetterdienst und Admin-Befehl rein; dann echter Server mit echten Clients: Fensterwechsel, zwei Biome,
  // Biomwechsel, Override, Editor/Dungeonband ohne Paket. Zwei Server auf ephemeren Ports, ~25 s.
  ['server', 'test/wetter-server.ts'],
  // Wiedereinstieg nach Neustart mit Layout-Abgleich: das Bett wandert mit dem Gelände (der
  // Punkt zieht mit), ein versetztes oder gelöschtes Bett wird gemeldet. Echte Clients.
  ['server', 'test/wiedereinstieg-bett-wandert.ts'],
  // Wiedereinstieg an einem Bett, das nicht (mehr) gilt: kein fremdes Bett über die freie Höhe,
  // kein stiller Tausch in der x/z-Säule, Gast behält sein Spielerbett, Layout-Bett per Kennung.
  ['server', 'test/wiedereinstieg-fremdes-bett.ts'],
  // Wildwarden serverseitig: Aussehen-Paket (Besitz, Slot, Altclient), Admin-Befehl
  // `item wildwarden`, eine Editor-Sitzung überschreibt keinen gespeicherten Charakter.
  ['server', 'test/wildwarden.ts'],
  // Wolfsbalance: chase speed rescaled from the real B9.2 GPU trace stays
  // under 3 % p90 foot-sliding (was ~11-14 % at the old 5.5 m/s), and at
  // most two of three wolves pinned on one peer ever strike at once, with
  // the third taking a freed slot when an active attacker dies.
  ['server', 'test/wolf-rudel-begrenzung.ts'],
  ['server', 'test/wolf-zielschaden.ts'],
  // Card Z3 Folgen: the deletion lock also holds at server boot (a world file written while the server was stopped:
  // all / over 25 % / state / prefab swap with content; real main.ts child, kill windows, confirm, legacy ids), and the
  // operating service side: /api/welt/bestaetigen takes the shared server lock (F1), the test-world messages and the
  // leftover .beiseite request (F2/F3), the lock hint on an unchanged save (C2).
  ['server', 'test/z3f-boot-schutz.ts'],
  // Card Z3 N1 completion: the cases the first N1 left open — only ENOENT means "no lock" (EISDIR/broken JSON close),
  // a broken lock is never overwritten, a request arriving during a save is not lost, an invalid request is consumed
  // with a log line, confirming deletes only the locked ids (no geo/object take-over), more than 40 locked old
  // deletions do not block a small new placement, the felled-tree witness, the height-correction cross cases and the
  // 6 s tick witness (in-process; the real-main.ts cases are in z3n1-hauptprozess.ts).
  ['server', 'test/z3n1-abschluss.ts'],
  ['server', 'test/z3n1-hauptprozess.ts'],
  // Card Z3 N1: the deletion lock is now a DURABLE file, checked afresh on every boot and every live
  // apply, not an in-memory/receipt-only guard — this rules out mass deletion above AENDERUNGEN_MAX or
  // together with a geo change (finding A1), a kill mid-boot (A2) and a later, unrelated change (A3).
  // A1a/A2/A3 run against a REAL main.ts child process (server/test/z3n1-hauptprozess.ts); A1b/A1c and
  // the per-id lock/timing logic run in-process (server/test/z3n1-live-inproc.ts). This file now covers
  // only the confirm endpoint (exactly the locked ids, nothing else — no boot-style reconciliation,
  // finding A5), 409 with no open lock (finding A6), a stale hash, revocation and a reset.
  ['server', 'test/z3n1-live-inproc.ts'],
  // `zone reset` re-scatters generated zones and leaves layout objects, player
  // builds and admin trees alone.
  ['server', 'test/zonen-ruecksetzer.ts'],
];
