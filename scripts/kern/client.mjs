/**
 * Testliste, Bereich `client`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `client/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `client`: the KERN entries whose path starts with `client/`, sorted by full path.
 */
import { brauchtModelle, brauchtStore } from '../testweichen.mjs';

export default [
  // Dieselbe Regel, jetzt gegen die VERDRAHTUNG in EntityManager.updateDynamics():
  // echtes Kamera-Frustum + echte Distanz (nicht von Hand erfundene Booleans),
  // und die drei Ausnahmen der Karte — Spieler (Prefab `Player`), NPCs im
  // Kampfzustand (`anim: 'attack'`) und Rueckkehr ohne Sprung — an den echten
  // Klassen EntityManager/AssetManager (NullEngine, nur der Ladeweg ersetzt).
  ['client', 'test/animations-lod-wiring.ts'],
  // fps-analyse #9: Animations-LOD — Figuren ausserhalb des Sichtkegels
  // oder weiter als 60 m pausieren ihre Animationsgruppe statt sie jedes
  // Bild auszuwerten, und setzen bei Rueckkehr OHNE Sprung fort. [1]+[2]
  // pruefen die reine Regel gegen erfundene Gruppen (auch den Fall, dass
  // waehrend der Pause ein echter Zustandswechsel eine FRISCHE Gruppe
  // gestartet hat), [3] gegen eine echte Babylon-AnimationGroup auf der
  // NullEngine: `play()` nimmt das pausierte Bild wieder auf statt bei 0
  // neu zu beginnen. NullEngine, keine GPU, <1 s.
  ['client', 'test/animations-lod.ts'],
  // Der Anmeldedialog kennt die Antwort 409 `conflict` (gleichzeitiger
  // Passwortwechsel) und zeigt dafuer einen eigenen, uebersetzten Satz.
  ['client', 'test/anmeldung-konflikt.ts'],
  ['client/test', 'appearance-visibility.ts'],
  // AudibleRadius -- Rueckwaertsprobe der Umkehrformel des 'inverse'-
  // Abstandsmodells (Radius bei 2 % Lautstaerke), nicht gemessen. Pure.
  ['client', 'test/audio-audible-radius.ts'],
  // AutoplayAutomaton -- Sechs-Zustands-Automat fuer die Browser-
  // Autoplay-Regel, Pflichtpfad starting -> blocked -> unlocked sowie
  // beide Fehlerpfade. Pure, kein AudioContext.
  ['client', 'test/audio-autoplay-automaton.ts'],
  // Karte B2 N1 (Befund B2): ein fehlschlagender Klip-Ladeversuch liefert
  // null, warnt genau einmal je Klip, nie eine unhandled rejection
  // (per process.on('unhandledRejection') gezählt). Pure, DOM-frei.
  ['client', 'test/audio-clip-loader.ts'],
  ['client', 'test/audio-einstellungen.ts'],
  // ListenerSync -- der raeumliche Listener uebernimmt jeden Frame die
  // Kameraposition. NullEngine, echte UniversalCamera.
  ['client', 'test/audio-listener-sync.ts'],
  // Karte B2 N1 (Befund B1): AudioManifest liest B1s echten `toene`-
  // Abschnitt (nicht das erfundene `audio`), Bus/Gruppe aus dem Pfad,
  // Hintergrundmusik als fester Eintrag. Fixture-basiert plus
  // Echtdaten-Teil, der übersprungen meldet, bis B1 gemergt ist.
  ['client', 'test/audio-manifest.ts'],
  // PlaybackGate -- `?mute=1` bleibt in jedem Automatenzustand stumm;
  // AudioEngine.playAsync ruft genau dieses Praedikat. Pure.
  ['client', 'test/audio-mute.ts'],
  // Karte B2: Ton-Engine (client/src/engine/Audio/*, ersetzt GameAudio.ts).
  // ShuffleBag -- kein Klip zweimal hintereinander, auch nicht ueber die
  // Batch-Grenze. Pure, DOM-frei.
  ['client', 'test/audio-shuffle-bag.ts'],
  // Karte B2 N3: startAudioEngine kapselt create/.then/.catch aus main.ts;
  // ein fehlschlagendes create warnt genau einmal, nie unhandled rejection.
  ['client', 'test/audio-start.ts'],
  ['client', 'test/augenfarbe.ts'],
  // F3 „Ausfaelle": die drei Effekte, die liefen, kosteten und nichts
  // lieferten. Hier steht der GPU-lose Teil ihrer Reparatur — Kaskadendeckel
  // (Babylon klemmt `kaskaden: 1` auf 2, das Profil muss es auch),
  // Ankerdurchmesser aus einem WINKEL statt aus Metern, und der
  // 10-%-Konstantterm im Komposit-Shader, dessen Entfernung eine
  // Textersetzung ist und nach einem Babylon-Wechsel STILL ausbleiben kann.
  ['client', 'test/ausfaelle-zeugen.ts'],
  // B9.4 Client: Diagnose-Haken raeumen auf (zehn Aufrufe, eine Gruppe), Format
  // und Gruppensuche ohne Szene. ~2 s.
  ['client', 'test/b9-4-animation-client.ts'],
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
  ['client', 'test/baumenue-hinweis.ts'],
  // Schweregrad-Klassifikation des Editor-Prüfberichts (Aufgabe B1): reine
  // Einstufung eines LayoutBefund nach Fehler/Hinweis, DOM-frei — anders
  // als editorMain.ts selbst, das beim Import sofort die Editor-Shell
  // aufbaut und einen Fetch anstößt und deshalb nicht isoliert testbar
  // ist. Prüft jeden Zweig einzeln UND gegen echte pruefeLayout-Ausgaben,
  // damit ein geänderter Wortlaut in pruefung.ts hier auffällt statt erst
  // als falsch gefärbte Zeile im Editor.
  ['client', 'test/befund-schwere.ts'],
  /*
    D5: die Beute- und Inventarmeldungen des Servers (`@key` oder `@key|{json}`): jeder Schluessel in beiden Katalogen,
    Parameter fuellen die Platzhalter, Kreatur- und Itemnamen uebersetzt, kaputte Parameter verstecken die Meldung nicht.
  */
  ['client', 'test/beute-meldung.ts'],
  ['client', 'test/bewuchs-freiraum-vorschau.ts'],
  ['client', 'test/bewuchs-quellen.ts'],
  // Vegetation preview of the offline flight (K2.1): clears what the camera left, three levels, key L, client zone cache 1024. ~20 s.
  ['client', 'test/bewuchs-vorschau.ts'],
  // Namen, die andere Dateien per Zeichenkette suchen (Himmelskuppel, Refraktion,
  // Dungeon-Atmosphäre): Erzeuger und Verbraucher nennen denselben Namen.
  ['client', 'test/bild-namen.ts'],
  // D2: swing fields, AttackAck, combo follow-up and round trip on the client.
  ['client', 'test/d2-quittung.ts'],
  // Account hand-off from wov-web: the legacy connection panel must be
  // absent from the static HTML, online entry requires a session, and
  // failures return to the one remaining login on the public website.
  // Source-level and DOM-free, so it belongs in the fast core list.
  ['client', 'test/direct-handoff.ts'],
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
  // Das Formular „Neuer Saal" (E8): die sieben ServerConfig-Flagbits an
  // EINER Stelle samt Wächter gegen die zwei alten Kopien, die
  // Sichtbarkeit am Servertor, „Modulzellen" statt „Zellen" (zwei Felder
  // in einer Leiste meinten sonst Verschiedenes mit demselben Wort), die
  // Vorschau aus der GETEILTEN Formel und der Dreiecksdeckel VOR dem
  // Paket. Derselbe DOM-Stummel wie darüber, Sekunden, kein Netz.
  // The E8 hall form: flag bits in one place, gated visibility, distinct
  // labels, shared preview formula, triangle cap before the packet.
  ['client', 'test/dungeon-neuer-saal.ts'],
  // Die 3D-Ansicht des 1.0-Dokuments über NullEngine und synthetische
  // Würfel-Master (AssetManager injiziert wie in kollisionsnetz.ts): eine
  // Instanz je Raum an der Weltposition der Platzierung, eine Marke je
  // anbaubarer Kante, Auswahlwechsel, dispose-Idempotenz.
  // The 1.0 document's 3D view over NullEngine with synthetic cube masters.
  ['client', 'test/dungeon-vorschau3d.ts'],
  // Der Client-Bauer an einer NullEngine: Meshes je Block, Begehbarkeit
  // über die Kollisionsformen, und Bau/Abriss ×20 zurück auf exakt den
  // Ausgangsstand. ~7 s.
  ['client', 'test/dungeon2-bauer.ts'],
  // Sichtbare Deko als Thin Instances, gegen eine Attrappen-Modellquelle
  // statt echter GLBs (assets/ liegt ausserhalb des Repos).
  ['client', 'test/dungeon2-deko.ts'],
  // AP15.2: Die REINE Logik der Katalogseite (Laden/Speichern/Prüfen/Anlegen)
  // — Antwort-Parser gegen `/api/dungeons2*` (gute und kaputte Einträge),
  // die Speichern-Knopf-Zustandsmaschine (sauber→schmutzig→speichert→sauber,
  // Fehlerfall bleibt schmutzig), die Prüf-Trockenlauf-Verzweigung 'erzeugt'
  // vs. 'gebaut', ID-Muster und Zufalls-Seeds. DOM-frei, Sekunden.
  // AP15.2: the PURE logic of the catalogue sidebar (load/save/check/create)
  // — response parsers, the save-button state machine, the check-dry-run
  // branch, id pattern and random seeds. DOM-free, seconds.
  ['client', 'test/dungeon2-katalog.ts'],
  // Der Läufer: eine echte Havok-Kapsel läuft durch erzeugte Gräber und
  // misst STRECKE statt Zeit — Durchfallen, Hängenbleiben, Treppen,
  // Türdurchgänge. ~5 s, echtes Havok unter Node.
  ['client', 'test/dungeon2-laeufer.ts'],
  // Das Triplanar-Plugin gegen den ECHTEN `pbrPixelShader` aus dem
  // ShaderStore — alle vier Einspritzpunkte inklusive Reihenfolge und
  // `highp`. Fällt, sobald ein Babylon-Update die Ankerzeilen verschiebt.
  ['client', 'test/dungeon2-material.ts'],
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
  // AP15.3/15.4/15.5: Die REINE Logik der Zellwerkzeuge des Editors — die
  // Picking-Mathematik (Weltkoord->Zellindex und ->Kante, Zoom/Pan) und die
  // Mutationen (Boden-Rasterung, Wandflag-Symmetrie über die kanonische Kante,
  // Materialpinsel-Radius, Stempel-Rundlauf, das Gebaut-Kippen beim ersten
  // Handeingriff). DOM-frei, Sekunden.
  // AP15.3/15.4/15.5: the pure logic of the editor's cell tools — picking maths
  // and mutations, DOM-free, seconds.
  ['client', 'test/dungeon2-zellwerkzeuge.ts'],
  // T0a N2 (Auflagen A1/A2 aus dem Nachangriff): Sprachauswahl von t()/aktuelleSprache()
  // in editor/i18n.ts (?lang, dann gespeicherte Wahl, dann de), Gleichheit mit GameI18n/
  // main.ts fuer dieselben Eingaben, dazu editorI18nInstance() in zwei Kindprozessen
  // (memoisiert). DOM-frei, ein paar Sekunden wegen der zwei tsx-Kindprozesse.
  ['client', 'test/editor-i18n-sprache.ts'],
  // Boundary of the modules cut out of editorMain.ts (editor/biome.ts, formen.ts, seite/helfer.ts). They are
  // evaluated BEFORE the two registry awaits of editorMain.ts: values are imported from design.ts only,
  // nothing is read from a registry or from the page while they load, and editorMain.ts declares none of
  // the moved names itself. Syntax tree plus the behaviour that loads without a browser. ~2 s.
  ['client', 'test/editor-module-grenze.ts'],
  // Serversteuerung im Editor (29.09., Mikes Befund): die DOM-freie
  // Entscheidungslogik (welche der drei Knoepfe wann sichtbar/benutzbar
  // sind, was "Karte live testen" bei aktiver Testwelt jetzt tut, welche
  // Dialog-Optionen der Schmutz-Merker freischaltet). Kein DOM, keine
  // Netzanfrage. ~0,3s.
  ['client', 'test/editor-serversteuerung.ts'],
  // Editor save path with a base version, against a fetch fake.
  ['client', 'test/editor-speichern-basis.ts'],
  /*
    Karte G1 N1 (2026-09-29, Nachbesserung nach Angriff, Befunde B1/B3/B6):
    `EntityManager.aktualisiereGrundskala` — nur Buckets DES GEMELDETEN
    Modells werden dirty markiert, ein anderes schon gesetztes Modell
    bleibt unberührt (M3). Zählt den erneuten `getMasters()`-Aufruf AB
    einem Rücksetzpunkt statt mit `calls.includes(...)` (die Vorfassung
    hätte einen entfernten erneuten Aufruf nie gemerkt, M4), prüft dass ein
    NIE gesetztes Modell keinen einzigen `getMasters()`-Aufruf auslöst (B3
    — vorher lud das unbedingt eine GLB) und dass veralteter
    Collider-Cache samt `colliderless`-Eintrag wirklich entsorgt wird (B6,
    mit Entsorgungs-Zählern, kein Attrappen-Objekt daneben). DOM-frei wie
    entity-index.ts (steinKitOverride leer, kein Szene-Zugriff), < 1 s.
  */
  ['client', 'test/entity-grundskala.ts'],
  ['client', 'test/entity-index.ts'],
  // Refactor N1: what stood before and behind the class in EntityManager.ts lives in seven modules next to it.
  // The 13 names other files import are still exported there (values: the same object), each of the eight
  // module-level state holders is declared once under client/src, no module imports EntityManager.ts, and the
  // pure functions give the numbers measured before the move. Syntax tree and plain imports, DOM-free, ~2 s.
  ['client', 'test/entity-module-oberflaeche.ts'],
  // Draft store: two tabs, one localStorage key; undo stack, evicted ring.
  ['client', 'test/entwurfs-speicher.ts'],
  // F10: Wiederverbinden nach Serverneustart (client/src/net/Wiederverbinden.ts):
  // Wartezeiten 1..60 s, Kick gibt auf, Zeitlimit, Zaehler. DOM-frei, Sekunden.
  ['client', 'test/f10-wiederverbinden.ts'],
  // F6 (Roadmap): seq-Verwerfungsregel für Client-Vorhersage-
  // Reconciliation (client/src/net/Eingabeverwerfung.ts) — reine
  // Funktion. Seit dem Abgleich per Eingabesequenz nicht mehr tot:
  // Positionsverlauf.verwirfAelterAls ruft sie (s. naechster Eintrag).
  // DOM-frei, Sekunden.
  ['client', 'test/f6-seq-verwerfung.ts'],
  // 05.09.2026: der ABFALL des Fackellichts. `1/d²` ist das Gesetz fuer
  // einen Punkt; eine 25 cm hohe Flamme ist keiner, und an der Wand 15 cm
  // dahinter liefert die Punktformel den Faktor 44. Der Test haelt fest,
  // dass der PBR-Zweig mit `1/(d²+r²)` rechnet, der StandardMaterial-Zweig
  // linear bleibt, und rechnet die Daempfung an vier Abstaenden nach.
  // Reiner Text, keine GPU, <1 s.
  ['client', 'test/fackel-licht.ts'],
  // F16 (Roadmap): Fehlersammler fuer die HUD-Fehleranzeige — Dedupe
  // gleicher Meldungen ("3x"), Deckel fuer gleichzeitige Eintraege,
  // TTL-Ablauf. DOM-frei (Hud.ts rendert, diese Datei entscheidet nur
  // was/wie lange), Sekunden.
  ['client', 'test/fehlermeldungen.ts'],
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
  // Gelaende T4a N2: das ECHTE SpawnPanel im DOM-Nachbau, verdrahtet wie im Testflug (Frage, Ja, Sperre beider Knoepfe, einfaches Speichern im Lauf).
  ['client', 'test/gelaende-neustart-panel.ts'],
  // Gelaende T4a: Speichern & neu starten im Testflug (Entwurf speichern, nur bei Erfolg Neustart, Warten, Zeitlimit, F1-Schutz, Doppelklick,
  // Z3). DOM-frei mit Attrappen fuer fetch und Uhr.
  ['client', 'test/gelaende-neustart.ts'],
  // Gelaende T2: Pinsel im Testflug (Reiter Gelaende) - Kern (Stempel, Randabfall, Glaetten), Sperre unter Sockel/Gebaeude, Grenzen
  // (Strich wird abgelehnt statt gekuerzt), ein Strich = ein Vorgang, Umkehr, Anbindung an eine echte RegionGeo und Bitgleichheit mit
  // der frisch kompilierten Welt (Server-Weg), Tasten (deutsche Tastatur), Takt, Texte de/en. DOM-frei.
  // N1: Bauteil-Sperre (PIECE/sm-bld-), Wirkradius, Flug folgt dem Entwurf (fremder Tab), enthaelt() mit heightDeltas, Zonennaht, Wertgrenze.
  ['client', 'test/gelaende-pinsel.ts'],
  // Gelaende T3: Ebnen mit Pipette, Zuruecksetzen, Rueckgaengig/Wiederholen je Strich (eigener Stapel), lose Objekte wandern mit dem Boden
  // (Gebaeude und Sockel nicht), Bewuchs, storage-Hoerer nur bei offenem Reiter. DOM-frei, echte RegionGeo.
  ['client', 'test/gelaende-t3.ts'],
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
  // fps-analyse #8: Clutter-Zell-Master (Gras/Bewuchs) froren bislang NICHT
  // ein — 116 Master mit 47.426 Thin-Instanzen allein am Startdorf, unter
  // den 320 von 788 nicht eingefrorenen Meshes der Messung. Die Baulogik
  // steht jetzt in einer eigenen Funktion (`baueClutterZellMesh()`), die
  // hier gegen echte Babylon-Thin-Instances prueft: eingefroren, die Huelle
  // folgt trotzdem den Instanzen, und `clearArea()`s Puffer-Neuschreiben
  // (weniger Instanzen) platziert die Huelle richtig, ohne den Freeze zu
  // loesen. NullEngine, keine GPU, kein `assets/`.
  ['client', 'test/gras-zellen-einfrieren.ts'],
  /*
    Karte G1 N1 (2026-09-29, Nachbesserung nach Angriff, Befunde B1/B2):
    der volle Weg über ZWEI GETRENNTE Realms (Hauptthread = Katalog, ein
    `worker_thread` = Testflug, wie zwei Browserfenster mit je eigener
    Upload-Registry), verbunden nur über ein echtes, globales
    `BroadcastChannel` und eine echte HTTP-Antwort (Attrappe des
    Betriebsdienstes). Gemessen wird die EFFEKTIVE Weltskala
    (`localMatrix × ZDO-Weltmatrix`) eines im Testflug-Realm gesetzten
    Exemplars vor und nach einer simulierten PATCH-Änderung, an echter
    synthetischer Geometrie — keine Attrappe mit Identity-Matrix, die jede
    Grundskala gleich aussehen liesse (Angriffsbefund an der Vorfassung
    von `entity-grundskala.ts`). Dazu Quelltext-Wächter gegen einen
    stillen Wegfall der Verdrahtung in `Testflug.ts`/`GegenstandsKatalog.ts`
    (M2/M5/M6) — ein voller `starteTestflug()` mit echtem DOM ist für einen
    DOM-freien Lauf unverhältnismässig. DOM-frei (NullEngine), < 5 s.
  */
  ['client', 'test/grundskala-live-wirkung.ts'],
  /*
    Karte G1 N1 (2026-09-29, Nachbesserung nach Angriff — URTEIL
    BLOCKIEREN, Befunde B4/B5): der reine Übernahme-Filter für die
    Grundskala-Live-Meldung (BroadcastChannel, `grundskalaLive.ts`), jetzt
    WERT- statt zeitstempelbasiert (eine zurückspringende Absenderuhr
    verliert keine echte Änderung mehr), die strenge Formprüfung
    (`istGueltigesEreignis`, elf Angriffsproben: null/String/Liste, Name
    ausserhalb des Musters, Grundskala ausserhalb des erlaubten Bereichs)
    UND der volle Kanal-Weg über Node's globales `BroadcastChannel`
    (senden, hören, abmelden, rohe ungültige Nachrichten, Umgebung ohne
    Unterstützung). DOM-frei, < 1 s.
  */
  ['client', 'test/grundskala-live.ts'],
  ['client/test', 'head-skin.ts'],
  // Island pick and jump into the offline flight (K2.0): targets on land in every region, orientation display, way back, bounded search. ~20 s.
  ['client', 'test/inselwahl.ts'],
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
  ['client/test', 'ironward.ts'],
  // Item tooltip DOM path with a fake DOM, no innerHTML by syntax tree, comparison rule (N1 of the attack).
  // Item tooltip with data items (#152): data text in de/en, level and rarity from the entry, fallback without values.
  ['client', 'test/item-tooltip-daten.ts'],
  ['client', 'test/item-tooltip-dom.ts'],
  // Item tooltip: the five windows hide an open tooltip when they rebuild their cells (real panels, fake DOM).
  ['client', 'test/item-tooltip-panels.ts'],
  // Item-Tooltip (2026-09-29): Tooltip-Inhalt de/en mit den echten Katalogen und
  // Vergleich mit dem Getragenen (rein). Keine Assets noetig.
  ['client', 'test/item-tooltip.ts'],
  /*
    Kampftoene (client/src/engine/Audio/KampfToene.ts): Schwung zum
    Hiebzeitpunkt, Treffer/Parade nur mit HitEffect, Faust ohne Schwung,
    alle Gruppen im `toene`-Abschnitt der getrackten assets/manifest.json.
  */
  ['client', 'test/kampf-toene.ts'],
  ['client', 'test/kampf-waffe-abgleich.ts'],
  // Editor map image in tiles (K3.0): stage choice (4 m per pixel -> 4 m texel),
  // tile addressing and placement, tile colours against the world sample and
  // the coast against the height field, the tile cache cap, and the dispatch
  // service with stand-in workers (centre first, stale views never sent,
  // stale world generations dropped, 50 steps without growth). DOM-free, ~3 s.
  ['client', 'test/karte-kacheln.ts'],
  // Boundary of client/src/editor/katalog/ (refactoring step G1): kategorien.ts derives its
  // lists from the registries when it loads, so value imports of katalog/* may only stand in
  // GegenstandsKatalog.ts (loaded dynamically after the registrations) and in katalog/ itself,
  // and nothing imports GegenstandsKatalog.ts statically as a value. Read on the syntax tree,
  // with a teeth check of the scanner; plus the behaviour of fmt/fmtBytes and of the derived
  // lists. DOM-free, ~1 s.
  ['client', 'test/katalog-module-grenze.ts'],
  ['client', 'test/kollision-formen.ts', brauchtStore()],
  // Die `_col`-Konvention (ein GLB-Mesh ist NUR Kollision): unsichtbar,
  // kein Schattenwerfer, und es ERSETZT die Kollision des Prefabs. Beide
  // Fehlerrichtungen sind im Spiel schwer zu sehen — ein grauer Klotz in
  // der Treppe, oder eine Treppe, an deren erster Stufe die Figur haengen
  // bleibt. Synthetischer Prototyp statt GLB (assets/ liegt ausserhalb des
  // Repos), NullEngine, Sekunden.
  ['client', 'test/kollisionsnetz.ts'],
  // B9.2: die Abspielgeschwindigkeit der Geh- und Lauf-Clips folgt dem
  // Bodentempo (reine Regel + die Daten jedes ausgelieferten Tiers). ~2 s.
  ['client', 'test/kreaturen-clip-tempo.ts'],
  // Kuratierungskatalog (Roadmap B3): Katalogaufbau aus FOLIAGE/FEATURES/
  // SPAWN_TABLE, Suche und ordnungserhaltendes Hinzufuegen/Entfernen fuer
  // die Auswahl-Widgets der drei Kuratierungslisten. DOM-frei, Sekunden.
  ['client', 'test/kuratierungs-katalog.ts'],
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
  // The website URL is the language authority. Both character launch paths
  // must pass it to the game, where every loading-screen string is selected
  // from one complete locale object. Pure source/data assertions, no DOM.
  ['client', 'test/loading-language.ts'],
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
  // Die Huellkoerper der Thin-Instance-Master entscheiden seit D10 ueber
  // die SICHTBARKEIT der Prefabs — ein Kasten, der eine Instanz auslaesst,
  // laesst das Objekt aus bestimmten Blickwinkeln verschwinden. Laeuft
  // ueber Babylons NullEngine: ohne GPU, ohne Assets, synthetische
  // Geometrie und Instanzlagen.
  ['client', 'test/master-huelle.ts'],
  ['client', 'test/menu-i18n.ts'],
  // Die Werfer-Regel entscheidet seit G5 ueber die GEMESSENE Modellhoehe
  // statt ueber einen Namensregex. Der Test haelt fest, dass die
  // Skalenmessung ueberschaetzt statt zu unterschaetzen (ein zu kleiner
  // Wert loescht Schatten), dass eine Drehung nicht als Skalierung
  // durchgeht, und dass „nicht gemessen" nicht als „klein" gelesen wird —
  // sonst verloere das Gelaende seinen Schattenwurf.
  ['client', 'test/modell-hoehe.ts'],
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
  ['client', 'test/refraktion-huelle.ts'],
  // Regions-Vorlagen, Feldvalidierung, Kontinente und Startpunkt-Logik
  // (Aufgaben B2/B10): reine Funktionen aus regionsWerkzeuge.ts, DOM-frei
  // aus demselben Grund wie befund-schwere.ts. Prueft jede Vorlage einzeln
  // UND gegen echte sanitizeWorldLayout-/pruefeLayout-Laeufe.
  ['client', 'test/region-werkzeuge.ts'],
  ['client', 'test/schatten-buchhaltung.ts'],
  ['client', 'test/schatten-fern-takt.ts'],
  // Die Keulung der Schattenwerfer pro Instanz ist konservativ in genau
  // EINER Richtung: Was ueberlebt, wird eingereicht — verworfen wird nur,
  // was seitlich sicher ausserhalb des Lichtkastens liegt. Ein Fehler hier
  // loescht Schatten statt sie zu sparen, und zwar unauffaellig. Der Test
  // haelt drei Zusicherungen fest: entlang der Lichtachse wird NICHT
  // gekeult, der Bewegungsrand haelt die Packung bis zum naechsten
  // Neupacken, und entartete Eingaben liefern 0 statt Muell.
  ['client', 'test/schatten-instanz-keulung.ts'],
  // G18: Die scharfe Nahkaskade endete bei 9 m, dahinter 5,4-fach groebere
  // Texel. Rechnet Babylons Kaskadenteilung nach (an der Messung geeicht) und
  // prueft die ausgelieferte Look-Vorgabe gegen eine Mindestreichweite.
  ['client', 'test/schatten-kaskadengrenze.ts'],
  // G20 (18.09.2026): Ein Vegetationsklon (layerMask 0) wird nie im Farbpass
  // gezeichnet; sein Tiefen-Shader braucht aber die Vorlage genau dieses
  // Passes, sonst warf das Laub seit G6 keinen Schatten mehr. Der Test haelt
  // fest: Vorlage wird angemeldet, die Quelle wirft bis zur Bereitschaft
  // weiter, ein Klon ohne Instanzen wird nicht angemeldet. NullEngine, <1 s.
  ['client', 'test/schatten-laub-klon.ts'],
  // Zu jedem Vegetationsmaster gehoert ein Schattenklon mit EIGENER
  // GPU-Geometrie. Wird der Master entsorgt, muss beides weg — sonst
  // bleibt eine Buchung stehen, die jedes Bild mitgezaehlt und mitgepackt
  // wird und mit der Sitzungsdauer waechst. Ein Bild kann das nicht
  // zeigen (der Klon steht deckungsgleich oder abgeschaltet), deshalb
  // haengt der Test an der ZUSTANDSGROESSE
  // vegetationsSchattenStats().master. Er haelt zugleich die
  // Gegenrichtung fest: Ein GEPOOLTER Master behaelt seinen Klon.
  // NullEngine, kein `assets/`, <1 s.
  ['client', 'test/schatten-master-vergessen.ts'],
  // Das 100-FPS-Profil nutzt auf der niedrigen Stufe eine eigene
  // Schattenfassung. Der GPU-lose Test haelt 2 x 1024 px / 80 m fest und
  // prueft zugleich, dass alle normalen Stufen unveraendert bleiben.
  ['client', 'test/schatten-profil.ts'],
  // PR #119 N1 (Befund B4/M9): uebergebeAnKlon() gibt einen aufgegebenen
  // Klon aus vegetationsAufgegebeneKlone frei, BEVOR es ihn per nimmAuf()
  // anmeldet — sonst blockiert die Sperre die eigene Freigabe, und weder
  // Klon noch (schon entfernte) Quelle wirft bis zum naechsten Neupacken.
  // NullEngine, <1 s.
  ['client', 'test/schatten-werfer-uebergabe-reihenfolge.ts'],
  // WebGPU-Stillstand: Der Tiefen-Wrapper baut nie aus einer Vorlage ohne defines
  // (Draw-Cache zurueckgesetzt), er meldet stattdessen "nicht bereit". NullEngine, <1 s.
  ['client', 'test/schatten-wrapper-sicher.ts'],
  // G3 Stufe 1: Namensschilder, Objektnamen und das Fadenkreuz-Ziel projizierten
  // mit der TAA-verzitterten Projektionsmatrix und sprangen deshalb bei
  // stehender Kamera jedes Bild um den Halton-Versatz. transformOhneJitter()
  // (PostProcessing.ts) setzt den Versatz zurueck; drei echte Mutanten (je
  // Aufrufstelle) bestaetigen, dass der Test die Stellen einzeln trifft.
  ['client', 'test/schilder-transform-ohne-jitter.ts'],
  /*
    Untergrundwahl (Wiese -> Gras, Felshang -> Fels, Holz-Koerper -> Holz,
    Dungeon -> Stein, Wasser) und Vollstaendigkeit der Klanggruppen gegen den
    `toene`-Abschnitt der echten assets/manifest.json (getrackt, kein Asset
    noetig).
  */
  ['client', 'test/schritte-gruppe.ts'],
  /*
    Schritttakt (client/src/engine/Audio/Schritte.ts): Meter statt Zeit,
    Gehen 11 m -> 10, Rennen 15 m -> 10, Stand/Luft/Teleport -> 0,
    Mindestabstand 0,18 s. Pure, kein Babylon.
  */
  ['client', 'test/schritte-takt.ts'],
  ['client', 'test/settings-qualitaetsstufen.ts'],
  ['client', 'test/spielhost.ts'],
  /*
    Mass D, die Client-Seite: der Einspritzpunkt im Shader, Babylons
    `vColor`-Deklaration am installierten Stand und das Alphaflag, das der
    glTF-Lader setzt, ohne in die Spalte zu sehen. Alle drei koennen still
    ausfallen und sehen dann genauso aus wie „die Verschattung wirkt
    nicht". NullEngine, keine GPU, <2 s.
    Mass D, client side: injection point, vColor declaration, alpha flag.
  */
  ['client', 'test/stein-cavity.ts'],
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
  ['client', 'test/store-ladepfad.ts'],
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
  // G19 (A3): TAA gehoert hinter alle anderen Paesse; nach dem Umschalten
  // eines anderen Effekts stand es vorn (12 von 12 Umschaltungen).
  ['client', 'test/taa-reihenfolge.ts'],
  // Test flight: a click places while a prefab is chosen (Alt grabs), series switch, drag only past 4 px (8 touch) with grab offset; offline bytes unchanged.
  ['client', 'test/testflug-greifen.ts'],
  // Test flight shows the deletion-lock hint: PATCH answers (200/202) and the publish carry `loeschsperre`; the HUD line says how many are held back and to confirm in the map editor (de/en); no field, no hint.
  ['client', 'test/testflug-loeschsperre.ts'],
  // Offline-flight module (moved out of main.ts): what stays true afterwards.
  ['client', 'test/testflug-modul.ts'],
  // Test flight: one gesture = one Vorgang (1 op, by id), a 30-frame drag = 1; OpsPersistenz 200/202/409; plain way byte-identical.
  ['client', 'test/testflug-ops.ts'],
  // Offline flight draws the placement scale (`scale`) like the server: threshold, clamp 0.2-5, replaces localScale. ~5 s.
  ['client', 'test/testflug-skala.ts'],
  // ... N5 with the test flight (#91): its Sockel radius never exceeds the service's limit of 100 (real flight code against the real service).
  ['client', 'test/testflug-sockel-dienst.ts'],
  // Publishing from the offline flight carries the server base the editor left
  // in the draft's companion note: a newer editor save gives 409, nothing is
  // overwritten; no base, nothing is sent. Real operations service. ~5 s.
  ['client', 'test/testflug-speichern-basis.ts'],
  // Karte T0a (2026-09-29): Testflug, SpawnPanel und der Upload-Dialog
  // (GegenstandsKatalog.ts) sind jetzt uebersetzbar -- ein Scanner findet
  // verbliebene deutsche Klartext-Literale in diesen Dateien (Kommentare
  // und console.*-Zeilen zaehlen nicht), dazu prueft er, dass jeder
  // verwendete Uebersetzungsschluessel in de.json UND en.json existiert
  // (faengt einen Tippfehler im Schluessel). DOM-frei, <1 s.
  ['client', 'test/testflug-texte-vollstaendig.ts'],
  // Baeume entfernen V2 N3: der Speicherweg des Testflugs zeigt den Vegetationshinweis der Quittung wie der Editor. DOM-frei.
  ['client', 'test/testflug-vegetation-hinweis.ts'],
  // Textfeld-Fokus sperrt Spiel- und Testflug-Tasten (K, I, V, B, H, WASD): Helfer, echter InputManager mit Attrappen, Verdrahtung. DOM-frei.
  ['client', 'test/texteingabe-tasten.ts'],
  /*
    Tod und Treffer N1: die Wurzelbewegungs-Zeile in AssetManager.instantiate (Liegeclips fremder Koerper) am ECHTEN Pfad: echter
    AssetManager, echter Koerper (v1), Bodenweg des Falls flach, Hoehenkeys wie im File. In der CI ohne Assets uebersprungen.
  */
  ['client', 'test/tod-treffer-assetmanager.ts', brauchtModelle('assets/models/wikinger/WikingerKoerper.glb')],
  /*
    Tod und Treffer sichtbar: AvatarRig auf den ECHTEN Koerpern (48 Clips): Zustaende unveraendert, Tod liegt bei 0,12 m,
    Treffer-Schicht nur Oberkoerper, Mindestabstand. In der CI ohne Assets uebersprungen.
  */
  [
    'client',
    'test/tod-treffer-avatar.ts',
    brauchtModelle('assets/models/wikinger/WikingerKoerper.glb', 'assets/models/wikingerin/WikingerinKoerper.glb'),
  ],
  /*
    Tod und Treffer sichtbar: der Blut-Pool (KampfEffekte: die geteilte Textur wurde nach dem ersten Stoss entsorgt, deshalb Blut
    nur einmal). Ohne Assets.
  */
  ['client', 'test/tod-treffer-blut.ts'],
  /*
    Tod und Treffer sichtbar: der Eingabe-Riegel (InputManager.gesperrt), TodTreffer und die Verdrahtung in main.ts
    (Zeilenwaechter < 3700). Ohne Assets.
  */
  ['client', 'test/tod-treffer-eingabe.ts'],
  /*
    Die Figuren ANDERER Spieler (EntityManager mit Attrappen-Assets): Treffer-Schicht faellt auf `idle` zurueck (nicht auf den
    Prefab-Zustand `Walking`, der keine Gruppe nennt), Tod bleibt liegen, Spaeteinsteiger sehen die Liegepose, Beleben.
    Gefunden im Browserlauf auf mike-pc (Sicht des zweiten Spielers). Ohne Assets.
  */
  ['client', 'test/tod-treffer-fremd.ts'],
  /*
    Tod und Treffer N1: Servermeldungen als Katalogschluessel (`@tod.bett_verloren`) erreichen den Client uebersetzt (de/en),
    Klartext und unbekannte Schluessel laufen unveraendert durch.
  */
  ['client', 'test/tod-treffer-meldung.ts'],
  /*
    Tod und Treffer sichtbar: Wurzelbewegung der Liege-/Bueck-Clips (A4: nie die Hoehe festnageln, die 28 alten Clips bitgleich)
    auf den ECHTEN Koerpern (48 Clips). In der CI ohne Assets uebersprungen.
  */
  [
    'client',
    'test/tod-treffer-wurzel.ts',
    brauchtModelle('assets/models/wikinger/WikingerKoerper.glb', 'assets/models/wikingerin/WikingerinKoerper.glb'),
  ],
  // Grundskala im Loader (AssetManager.getMasters, synthetischer Container): wirkt
  // multiplikativ auf die Platzierungs-scale — 1,0×0,72×0,6 m ×Grundskala 4 -> 4,0×2,88×2,4 m
  // bei scale 1, 8,0×5,76×4,8 m bei scale 2. Gemessen im Szenengraph.
  ['client', 'test/upload-grundskala-loader.ts'],
  // Nachbesserung N1 (H1): eine geänderte Grundskala eines SCHON registrierten
  // Uploads wirkt ohne Neuladen der Seite — zweimal applyUploadedModelRegistry,
  // dann AssetManager.getMasters() erneut (in-place aktualisiert, kein Neuladen der GLB).
  // Nachbesserung N2 (F2/F3): zwei gleichzeitige getMasters() ergeben dieselbe Skala
  // (gebündelt), eine vorher gehaltene localMatrix-Referenz sieht eine spätere Änderung.
  ['client', 'test/upload-grundskala-neu-anwenden.ts'],
  // Baeume entfernen V1: Vergleich, enthaelt, Import und Speicherschutz F1 kennen vegetationEntfernt.
  ['client', 'test/vegetation-entfernt-dokument.ts'],
  // Baeume entfernen V2 N2: bei `angewendet` zeigt der Editor den Vegetationshinweis der Quittung (abgelehnte Kreise, Zonen ohne Marke), de/en.
  ['client', 'test/vegetation-quittung-anzeige.ts'],
  // Die Grafikoption begrenzt die gemeinsamen Bild-/Schattenmatrizen der
  // Vegetation. Der reine Kreisfilter sichert den unveraenderten Standard
  // (0 = voll), den eingeschlossenen Rand und die X/Z-Distanz ab.
  ['client', 'test/vegetations-grenze.ts'],
  ['client', 'test/village-biome.ts'],
  // Waldambiente (2026-09-29): Walddichte gegen die echte Streuung der dev.json
  // (Korrelation, Drift-Waechter, ~40 s) und Lautstaerke-Regeln der Schleifen
  // (Dichte, Glaettung, Tag/Nacht, Aus-Faelle, Regler). Rein, keine Assets noetig.
  ['client', 'test/wald-ambiente.ts'],
  ['client', 'test/wasser-farben.ts'],
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
  // ... N2: vergleiche() (Editor) prueft heightDeltas INHALTLICH (entfernt/geaendert = schwer, nicht nur die
  // Punktzahl); DOM-frei.
  ['client', 'test/welt-abgleich-hoehenkorrektur.ts'],
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
  // ... and the editor's side: the typed confirmation, the numbers in the dialog, the state after a success
  // (draft, base, empty undo stack), the wiring in editorMain.ts.
  ['client', 'test/welt-zuruecksetzen.ts'],
  // Weltzeit-Anzeige (Minimap): reine Umrechnung timeOfDay -> Stunde/
  // Minute/Sonnenstand, DOM-frei. Haelt Mitternacht, Mittag, die beiden
  // Uebergangsschwellen und den Tages-Ueberlauf fest.
  ['client', 'test/weltzeit.ts'],
  ['client', 'test/werkzeug-platzieren.ts'],
  // Editor E1 (integration I1): tool registry, stable placement ids, world
  // operations, zone reset.
  // Tool registry: the editor's tools behind one interface (start, abort, keys, bar).
  ['client', 'test/werkzeug-registry.ts'],
  // F9: Wetter vom Server im Client (DOM-frei): Paket lesen, Übergabe an den WeatherManager, Verdrahtung in main.ts.
  ['client', 'test/wetter-annahme.ts'],
  // Wildwarden clientseitig: Slot-Vertrag, Speicher-Rundlauf, Inventarersatz,
  // Körper-Wiederherstellung. NullEngine.
  ['client', 'test/wildwarden.ts'],
];
